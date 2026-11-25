'use strict';

// ============================================================================================
// MISSION 9 — Socle : accès (codes provisoires), demandes de comptes du personnel, rattachement
//             du marchand à son gestionnaire créateur.
//
// Ce module ne remplace AUCUNE fonctionnalité existante :
//   • la réinitialisation PDG (mot de passe temporaire 6 chiffres, lien 30 minutes) reste intacte ;
//   • « Mon équipe » (création directe + code d'activation) reste intacte ;
//   • les codes d'inscription terrain de la Mission 8 restent inchangés.
// Il ajoute les trois briques demandées et s'appuie sur les mêmes principes :
//   - code généré côté serveur, jamais relisible, stocké sous forme de HMAC ;
//   - usage unique garanti par une seule requête conditionnelle (jamais lire-puis-écrire) ;
//   - aucune donnée existante réécrite en masse ;
//   - double implémentation PostgreSQL / stockage JSON local.
// ============================================================================================

const crypto = require('node:crypto');

// Alphabet sans caractères ambigus : un code dicté au téléphone ne se confond pas.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;
const DEFAULT_TTL_HOURS = 48;
const MAX_TTL_HOURS = 720;

const fail = (message, code = 'INVALID', status = 400) => {
  const error = new Error(message);
  error.code = code; error.status = status;
  return error;
};
const text = (value, max = 500) => String(value == null ? '' : value)
  .replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
const nowIso = () => new Date().toISOString();
const uid = (prefix = 'id') => `${prefix}_${crypto.randomBytes(12).toString('base64url')}`;

function codeSecret() {
  return process.env.SESSION_SECRET || process.env.FIELD_CODE_SECRET || 'oymike-field-code-dev-secret';
}
function hashResetCode(code) {
  return crypto.createHmac('sha256', `${codeSecret()}|access-reset-v1`).update(String(code).trim().toUpperCase()).digest('hex');
}

// « Chez Gbaziké » → « CG » : première lettre de chacun des trois premiers mots, accents retirés.
// Aucun mot n'est ignoré : « Chez » fait partie du nom commercial, donc de ses initiales.
function initialsOf(label) {
  const words = String(label || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9\s'-]/g, ' ')
    .split(/[\s'-]+/).filter(Boolean);
  const source = words;
  let initials = source.slice(0, 3).map((word) => word[0]).join('');
  if (!initials) initials = 'OY';
  if (initials.length === 1) {
    const second = (source[0] || '').slice(1, 2);
    initials = second ? initials + second : initials + 'X';
  }
  return initials.slice(0, 3);
}

function randomBody() {
  const bytes = crypto.randomBytes(CODE_LENGTH * 2);
  let body = '';
  for (let index = 0; index < CODE_LENGTH; index += 1) body += CODE_ALPHABET[bytes[index] % CODE_ALPHABET.length];
  return body;
}

function createAccessControl({ store, team, commerce }) {
  const pg = () => (team?.pg ? team.base.pool : null);
  const state = () => store.state || {};
  const persist = async () => { if (typeof store.save === 'function') await store.save(); };

  // ----------------------------------------------------------------------------------- contacts
  async function supportContacts() {
    const settings = await store.getSettings().catch(() => ({}));
    const raw = settings.supportContact || {};
    const list = [];
    const phone = text(raw.phone, 32);
    const email = text(raw.email, 160);
    if (phone) list.push({ type: 'phone', label: 'Téléphone', value: phone, href: `tel:${phone.replace(/[^\d+]/g, '')}` });
    if (email) list.push({ type: 'email', label: 'E-mail', value: email, href: `mailto:${email}` });
    return list;
  }

  // ------------------------------------------------------------------ codes provisoires d'accès
  // Génère INITIALES-XXXXXX. La collision est traitée par la base (index unique sur code_hash) :
  // si un code identique existe déjà, on en génère un autre — jamais deux comptes sur un code.
  async function createResetCode({ accountType, accountId, accountLabel = '', reason = '', actor = {}, ttlHours = DEFAULT_TTL_HOURS }) {
    if (!['merchant', 'manager'].includes(accountType)) throw fail('Type de compte inconnu.', 'INVALID_ACCOUNT_TYPE');
    if (!accountId) throw fail('Compte introuvable.', 'ACCOUNT_NOT_FOUND', 404);
    const ttl = Math.max(1, Math.min(MAX_TTL_HOURS, Math.round(Number(ttlHours) || DEFAULT_TTL_HOURS)));
    const prefix = initialsOf(accountLabel);
    const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString();
    const base = {
      accountType, accountId, accountLabel: text(accountLabel, 160), reason: text(reason, 240),
      requestedByType: text(actor.type || 'admin', 20), requestedById: text(actor.id, 80), requestedByLabel: text(actor.label, 160),
      expiresAt, usedAt: null, revokedAt: null,
    };
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = `${prefix}-${randomBody()}`;
      const hash = hashResetCode(code);
      const row = { id: uid('arc'), ...base, codePrefix: prefix, codeHash: hash, codeHint: `••••${code.slice(-2)}`, createdAt: nowIso() };
      if (pg()) {
        try {
          // Un seul code actif par compte : les codes précédents non utilisés sont révoqués
          // d'abord (comme pour les codes terrain), puis le nouveau est inséré.
          await pg().query('UPDATE access_reset_codes SET revoked_at=NOW() WHERE account_type=$1 AND account_id=$2 AND used_at IS NULL AND revoked_at IS NULL',
            [accountType, accountId]);
          await pg().query(
            `INSERT INTO access_reset_codes (id, account_type, account_id, account_label, code_prefix, code_hash, code_hint,
               reason, requested_by_type, requested_by_id, requested_by_label, expires_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::timestamptz,NOW())`,
            [row.id, accountType, accountId, row.accountLabel, prefix, hash, row.codeHint, row.reason,
              row.requestedByType, row.requestedById, row.requestedByLabel, expiresAt]);
        } catch (error) {
          if (error.code === '23505') continue; // collision réelle : on retire un code
          throw error;
        }
      } else {
        state().accessResetCodes ||= [];
        state().accessResetCodes.forEach((item) => {
          if (item.accountType === accountType && item.accountId === accountId && !item.usedAt && !item.revokedAt) item.revokedAt = nowIso();
        });
        if (state().accessResetCodes.some((item) => item.codeHash === hash)) continue;
        state().accessResetCodes.unshift(row);
        await persist();
      }
      return { id: row.id, code, expiresAt, prefix, hint: row.codeHint, ttlHours: ttl };
    }
    throw fail('Impossible de générer un code unique. Réessayez.', 'CODE_GENERATION_FAILED', 500);
  }

  async function findResetCode(plainCode) {
    const code = text(plainCode, 40).toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9]{1,4}-[A-Z0-9]{6}$/.test(code)) {
      throw fail('Ce code n’a pas le bon format. Il ressemble à CG-A2Z4TD.', 'INVALID_RESET_CODE_FORMAT', 400);
    }
    const hash = hashResetCode(code);
    let row = null;
    if (pg()) {
      const { rows } = await pg().query(
        `SELECT id, account_type AS "accountType", account_id AS "accountId", account_label AS "accountLabel",
                code_prefix AS "codePrefix", code_hint AS "hint", expires_at AS "expiresAt", used_at AS "usedAt", revoked_at AS "revokedAt"
           FROM access_reset_codes WHERE code_hash=$1`, [hash]);
      row = rows[0] || null;
    } else {
      row = (state().accessResetCodes || []).find((item) => item.codeHash === hash) || null;
    }
    if (!row) throw fail('Ce code n’existe pas. Vérifiez la saisie.', 'RESET_CODE_NOT_FOUND', 404);
    if (row.revokedAt) throw fail('Ce code a été révoqué. Demandez-en un nouveau.', 'RESET_CODE_REVOKED', 410);
    if (row.usedAt) throw fail('Ce code a déjà servi. Un code provisoire ne sert qu’une fois.', 'RESET_CODE_USED', 410);
    if (new Date(row.expiresAt).getTime() <= Date.now()) throw fail('Ce code a expiré. Demandez-en un nouveau.', 'RESET_CODE_EXPIRED', 410);
    return row;
  }

  // Consommation ATOMIQUE : la clause WHERE décide seule. Deux connexions simultanées avec le
  // même code ne peuvent pas aboutir toutes les deux.
  async function consumeResetCode(plainCode) {
    const row = await findResetCode(plainCode);
    if (pg()) {
      const { rows } = await pg().query(
        `UPDATE access_reset_codes SET used_at=NOW()
          WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
        RETURNING id, account_type AS "accountType", account_id AS "accountId", account_label AS "accountLabel"`, [row.id]);
      if (!rows[0]) throw fail('Ce code vient d’être utilisé. Demandez-en un nouveau.', 'RESET_CODE_USED', 409);
      return rows[0];
    }
    const stored = (state().accessResetCodes || []).find((item) => item.id === row.id);
    if (!stored || stored.usedAt || stored.revokedAt || new Date(stored.expiresAt).getTime() <= Date.now()) {
      throw fail('Ce code vient d’être utilisé. Demandez-en un nouveau.', 'RESET_CODE_USED', 409);
    }
    stored.usedAt = nowIso();
    await persist();
    return { id: stored.id, accountType: stored.accountType, accountId: stored.accountId, accountLabel: stored.accountLabel };
  }

  async function revokeResetCode(codeId, actor = {}, reason = '') {
    if (pg()) {
      const { rowCount } = await pg().query('UPDATE access_reset_codes SET revoked_at=NOW() WHERE id=$1 AND used_at IS NULL AND revoked_at IS NULL', [codeId]);
      if (!rowCount) throw fail('Ce code est déjà utilisé ou révoqué.', 'RESET_CODE_NOT_REVOCABLE', 409);
      return { id: codeId, revoked: true };
    }
    const row = (state().accessResetCodes || []).find((item) => item.id === codeId);
    if (!row || row.usedAt || row.revokedAt) throw fail('Ce code est déjà utilisé ou révoqué.', 'RESET_CODE_NOT_REVOCABLE', 409);
    row.revokedAt = nowIso(); row.revokedBy = text(actor.label, 160); row.revokeReason = text(reason, 240);
    await persist();
    return { id: codeId, revoked: true };
  }

  async function listResetCodes({ accountType = '', accountId = '', limit = 60 } = {}) {
    if (pg()) {
      const params = []; let where = '1=1';
      if (accountType) { params.push(accountType); where += ` AND account_type=$${params.length}`; }
      if (accountId) { params.push(accountId); where += ` AND account_id=$${params.length}`; }
      params.push(Math.max(1, Math.min(200, Number(limit) || 60)));
      const { rows } = await pg().query(
        `SELECT id, account_type AS "accountType", account_id AS "accountId", account_label AS "accountLabel", code_prefix AS "codePrefix",
                code_hint AS "hint", reason, requested_by_type AS "requestedByType", requested_by_label AS "requestedByLabel",
                expires_at AS "expiresAt", used_at AS "usedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
           FROM access_reset_codes WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
      return rows.map(withStatus);
    }
    const rows = (state().accessResetCodes || []).filter((item) => (!accountType || item.accountType === accountType) && (!accountId || item.accountId === accountId))
      .slice(0, Math.max(1, Math.min(200, Number(limit) || 60)))
      .map((row) => ({ id: row.id, accountType: row.accountType, accountId: row.accountId, accountLabel: row.accountLabel,
        codePrefix: row.codePrefix, hint: row.codeHint, reason: row.reason, requestedByType: row.requestedByType,
        requestedByLabel: row.requestedByLabel, expiresAt: row.expiresAt, usedAt: row.usedAt, revokedAt: row.revokedAt, createdAt: row.createdAt }));
    return rows.map(withStatus);
  }

  function withStatus(row) {
    const now = Date.now();
    const status = row.usedAt ? 'used' : row.revokedAt ? 'revoked'
      : new Date(row.expiresAt).getTime() <= now ? 'expired' : 'available';
    return { ...row, status };
  }

  // ------------------------------------------------------------------- demandes de comptes équipe
  async function createJoinRequest(merchantId, input = {}, actor = {}) {
    const role = ['general_manager', 'waitress'].includes(input.role) ? input.role : '';
    if (!role) throw fail('Choisissez la fonction demandée : gérant général ou serveur / serveuse.', 'INVALID_ROLE');
    const fullName = text(input.fullName, 120);
    if (fullName.length < 2) throw fail('Indiquez le nom et le prénom du candidat.', 'INVALID_NAME');
    const phone = text(input.phone, 32);
    if (phone && (phone.replace(/\D/g, '').length < 7 || !/^[0-9+().\s-]{7,32}$/.test(phone))) {
      throw fail('Le numéro de téléphone n’est pas valide.', 'INVALID_PHONE');
    }
    const row = {
      id: uid('tjr'), merchantId, storeId: text(input.storeId, 80), role, fullName, phone,
      designation: text(input.designation, 60), note: text(input.note, 300),
      permissions: Array.isArray(input.permissions) ? input.permissions.slice(0, 40) : null,
      status: 'pending', reason: '', memberId: null,
      decidedByType: '', decidedById: '', decidedByLabel: '', decidedAt: null,
      createdByType: text(actor.type || 'merchant', 20), createdById: text(actor.id, 80), createdAt: nowIso(), updatedAt: nowIso(),
    };
    if (pg()) {
      await pg().query(
        `INSERT INTO team_join_requests (id, merchant_id, store_id, role, full_name, phone, designation, note, permissions,
           status, reason, created_by_type, created_by_id, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'pending','',$10,$11,NOW(),NOW())`,
        [row.id, row.merchantId, row.storeId, row.role, row.fullName, row.phone, row.designation, row.note,
          row.permissions === null ? null : JSON.stringify(row.permissions), row.createdByType, row.createdById]);
    } else {
      state().teamJoinRequests ||= [];
      state().teamJoinRequests.unshift(row);
      await persist();
    }
    return row;
  }

  async function listJoinRequests(merchantId, { status = '', limit = 100 } = {}) {
    if (pg()) {
      const params = [merchantId]; let where = 'merchant_id=$1';
      if (status) { params.push(status); where += ` AND status=$${params.length}`; }
      params.push(Math.max(1, Math.min(300, Number(limit) || 100)));
      const { rows } = await pg().query(
        `SELECT id, merchant_id AS "merchantId", store_id AS "storeId", role, full_name AS "fullName", phone, designation, note,
                permissions, status, reason, member_id AS "memberId", decided_by_type AS "decidedByType",
                decided_by_label AS "decidedByLabel", decided_at AS "decidedAt", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM team_join_requests WHERE ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
      return rows;
    }
    return (state().teamJoinRequests || []).filter((row) => row.merchantId === merchantId && (!status || row.status === status))
      .slice(0, Math.max(1, Math.min(300, Number(limit) || 100)));
  }

  async function getJoinRequest(requestId, merchantId = '') {
    if (pg()) {
      const params = [requestId]; let where = 'id=$1';
      if (merchantId) { params.push(merchantId); where += ' AND merchant_id=$2'; }
      const { rows } = await pg().query(
        `SELECT id, merchant_id AS "merchantId", store_id AS "storeId", role, full_name AS "fullName", phone, designation, note,
                permissions, status, reason, member_id AS "memberId", decided_by_type AS "decidedByType",
                decided_by_label AS "decidedByLabel", decided_at AS "decidedAt", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM team_join_requests WHERE ${where}`, params);
      return rows[0] || null;
    }
    return (state().teamJoinRequests || []).find((row) => row.id === requestId && (!merchantId || row.merchantId === merchantId)) || null;
  }

  // Décision ATOMIQUE sur une demande : seule une demande encore « pending » peut être tranchée.
  async function decideJoinRequest(requestId, merchantId, action, { reason = '', actor = {}, memberId = null } = {}) {
    if (!['approve', 'reject'].includes(action)) throw fail('Décision inconnue.', 'INVALID_DECISION');
    const request = await getJoinRequest(requestId, merchantId);
    if (!request) throw fail('Demande introuvable pour votre établissement.', 'NOT_FOUND', 404);
    if (request.status !== 'pending') throw fail('Cette demande a déjà été traitée.', 'ALREADY_DECIDED', 409);
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const decided = { decidedByType: text(actor.type || 'merchant', 20), decidedById: text(actor.id, 80), decidedByLabel: text(actor.label, 160) };
    if (pg()) {
      const { rowCount } = await pg().query(
        `UPDATE team_join_requests SET status=$3, reason=$4, member_id=$5, decided_by_type=$6, decided_by_id=$7,
           decided_by_label=$8, decided_at=NOW(), updated_at=NOW() WHERE id=$1 AND merchant_id=$2 AND status='pending'`,
        [request.id, merchantId, nextStatus, text(reason, 300), memberId || request.memberId || null,
          decided.decidedByType, decided.decidedById, decided.decidedByLabel]);
      if (!rowCount) throw fail('Cette demande vient d’être traitée. Actualisez la liste.', 'CONCURRENT_DECISION', 409);
    } else {
      const row = (state().teamJoinRequests || []).find((item) => item.id === request.id && item.merchantId === merchantId);
      if (!row || row.status !== 'pending') throw fail('Cette demande vient d’être traitée. Actualisez la liste.', 'CONCURRENT_DECISION', 409);
      Object.assign(row, { status: nextStatus, reason: text(reason, 300), memberId: memberId || row.memberId || null, ...decided, decidedAt: nowIso(), updatedAt: nowIso() });
      await persist();
    }
    return getJoinRequest(request.id);
  }

  // ----------------------------------------------------------------------- rattachement gestionnaire
  // Le gestionnaire qui a créé le marchand reste identifié sur le compte. Il ne devient JAMAIS
  // propriétaire : c'est une attribution, que le PDG peut retirer ou réattribuer à tout moment.
  async function managerOwnsMerchant(managerId, merchantId) {
    const merchant = await commerce.getMerchant(merchantId).catch(() => null);
    return Boolean(merchant && merchant.managerId && String(merchant.managerId) === String(managerId));
  }

  async function listManagerMerchantsForReset(managerId) {
    const all = await commerce.listMerchants({}).catch(() => []);
    return all.filter((merchant) => String(merchant.managerId || '') === String(managerId) && !merchant.deletedAt);
  }

  return {
    supportContacts,
    createResetCode, findResetCode, consumeResetCode, revokeResetCode, listResetCodes,
    createJoinRequest, listJoinRequests, getJoinRequest, decideJoinRequest,
    managerOwnsMerchant, listManagerMerchantsForReset,
    initialsOf, hashResetCode, DEFAULT_TTL_HOURS,
  };
}

module.exports = { createAccessControl, initialsOf, hashResetCode };
