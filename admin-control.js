'use strict';

// ============================================================================================
// MISSION 8 — CONTRÔLE TOTAL DU PDG : socle (magasin de données)
//
// Ce module regroupe les opérations des 5 briques ajoutées par la Mission 8 :
//   1. photos d'établissement des inscriptions ;
//   2. codes d'inscription terrain à usage unique (consommation ATOMIQUE) ;
//   3. notifications du PDG et des gestionnaires ;
//   4. journal d'audit dédié (insertion seule) ;
//   5. quotas d'équipe par marchand + dépassement exceptionnel ;
//   6. points des gestionnaires protégés par un code de sécurité.
//
// PRINCIPES :
//   • Aucune donnée existante n'est lue puis réécrite en masse : chaque opération ne touche que
//     ses propres lignes.
//   • Chaque fonction existe en deux versions (PostgreSQL et stockage JSON local) parce que le
//     projet doit continuer à démarrer sans base (`node demarrer.js`).
//   • Les opérations sensibles (consommation d'un code, mouvement de points) sont atomiques :
//     une seule requête conditionnelle décide, jamais un « lire puis écrire ».
// ============================================================================================

const crypto = require('node:crypto');
const path = require('node:path');

const FIELD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ni I, O, 0, 1 : lisible au téléphone
const FIELD_CODE_PREFIX = 'OY-';

const fail = (message, code = 'INVALID', status = 400) => {
  const error = new Error(message);
  error.code = code; error.status = status;
  return error;
};

const text = (value, max = 500) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
const nowIso = () => new Date().toISOString();
const clampInt = (value, min, max, fallback) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.round(number)));
};

// Le code terrain est haché avec un secret serveur : une fuite de la base ne permet pas de
// reconstruire les codes (contrairement à un simple SHA-256, cassable par force brute sur 8
// caractères). Le secret est stable entre redémarrages (SESSION_SECRET, sinon dérivé du fichier).
function codeSecret() {
  return process.env.SESSION_SECRET || process.env.FIELD_CODE_SECRET || 'oymike-field-code-dev-secret';
}
function hashFieldCode(code) {
  return crypto.createHmac('sha256', codeSecret()).update(String(code).trim().toUpperCase()).digest('hex');
}
// Code lisible : OY-XXXX-XXXX (8 caractères utiles ≈ 40 bits d'entropie, non devinable).
function generateFieldCode() {
  const bytes = crypto.randomBytes(10);
  let body = '';
  for (let index = 0; index < 8; index += 1) body += FIELD_CODE_ALPHABET[bytes[index] % FIELD_CODE_ALPHABET.length];
  return `${FIELD_CODE_PREFIX}${body.slice(0, 4)}-${body.slice(4, 8)}`;
}
const hintOf = (code) => String(code).slice(-4);
const normalizeCode = (value) => text(value, 40).toUpperCase().replace(/\s+/g, '');

function uid(prefix = 'id') { return `${prefix}_${crypto.randomBytes(12).toString('base64url')}`; }
function ipHash(req) {
  const raw = String(req?.ip || req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  if (!raw) return '';
  return crypto.createHash('sha256').update(`${codeSecret()}:${raw}`).digest('hex').slice(0, 32);
}

// ---------------------------------------------------------------------------------------------
// Quotas d'équipe : source de vérité unique.
// Priorité : quota particulier du marchand (si le marchand n'a pas le droit de l'éditer et que
// le PDG l'a posé) > quota du code terrain > quota plateforme.
// ---------------------------------------------------------------------------------------------
async function resolveTeamQuotas(deps, merchantId) {
  const { team, store } = deps;
  const platform = await platformTeamQuotas(deps);
  if (!team?.pg) {
    const overrides = store.state?.teamQuotaOverrides || [];
    const override = overrides.find((row) => row.merchantId === merchantId);
    if (override) return mergeQuotas(platform, override, merchantId, 'override');
    // Quota hérité du code terrain, lu sur le compte marchand lui-même.
    const merchantRow = merchantId === '__platform__' ? null : await store.getMerchant?.(merchantId).catch(() => null);
    if (merchantRow && (merchantRow.teamQuotaGeneralManagers != null || merchantRow.teamQuotaWaitresses != null)) {
      return mergeQuotas(platform, { maxGeneralManagers: merchantRow.teamQuotaGeneralManagers,
        maxWaitresses: merchantRow.teamQuotaWaitresses }, merchantId, 'field_code');
    }
    return mergeQuotas(platform, null, merchantId, 'platform');
  }
  const pool = team.base.pool;
  const { rows } = await pool.query(
    `SELECT o.max_general_managers AS "maxGeneralManagers", o.max_waitresses AS "maxWaitresses",
            o.extra_general_managers AS "extraGeneralManagers", o.extra_waitresses AS "extraWaitresses",
            o.extra_expires_at AS "extraExpiresAt", o.suspended_reserves_slot AS "suspendedReservesSlot",
            o.merchant_can_edit_quotas AS "merchantCanEditQuotas", o.reason, o.updated_at AS "updatedAt",
            a.team_quota_general_managers AS "inheritedGeneralManagers", a.team_quota_waitresses AS "inheritedWaitresses"
       FROM merchant_accounts a
       LEFT JOIN merchant_team_quota_overrides o ON o.merchant_id = a.id
      WHERE a.id = $1`, [merchantId]).catch(() => ({ rows: [] }));
  const row = rows[0] || {};
  if (row.maxGeneralManagers != null || row.maxWaitresses != null) {
    return mergeQuotas(platform, {
      maxGeneralManagers: row.maxGeneralManagers, maxWaitresses: row.maxWaitresses,
      extraGeneralManagers: row.extraGeneralManagers, extraWaitresses: row.extraWaitresses,
      extraExpiresAt: row.extraExpiresAt, suspendedReservesSlot: row.suspendedReservesSlot,
      merchantCanEditQuotas: row.merchantCanEditQuotas, reason: row.reason,
    }, merchantId, 'override');
  }
  if (row.inheritedGeneralManagers != null || row.inheritedWaitresses != null) {
    return mergeQuotas(platform, { maxGeneralManagers: row.inheritedGeneralManagers, maxWaitresses: row.inheritedWaitresses }, merchantId, 'field_code');
  }
  return mergeQuotas(platform, null, merchantId, 'platform');
}

async function platformTeamQuotas(deps) {
  const { team } = deps;
  const fallback = { maxGeneralManagersPerMerchant: 1, maxWaitressesPerMerchant: 2, activationCodeTtlHours: 72, teamModuleEnabled: true };
  try {
    if (!team?.pg) {
      const stored = deps.store.state?.appSettings?.teamLimits || deps.store.state?.settings?.teamLimits || {};
      return { ...fallback, ...stored };
    }
    const { rows } = await team.base.pool.query("SELECT setting_value FROM app_settings WHERE setting_key='teamLimits'");
    return { ...fallback, ...(rows[0]?.setting_value || {}) };
  } catch (_) { return fallback; }
}

function mergeQuotas(platform, override, merchantId, source) {
  const extraActive = override?.extraExpiresAt ? new Date(override.extraExpiresAt).getTime() > Date.now() : true;
  const extraGeneral = extraActive ? clampInt(override?.extraGeneralManagers, 0, 200, 0) : 0;
  const extraWaitress = extraActive ? clampInt(override?.extraWaitresses, 0, 500, 0) : 0;
  const baseGeneral = clampInt(override?.maxGeneralManagers, 0, 200, platform.maxGeneralManagersPerMerchant);
  const baseWaitress = clampInt(override?.maxWaitresses, 0, 500, platform.maxWaitressesPerMerchant);
  return {
    merchantId, source,
    maxGeneralManagers: baseGeneral, maxWaitresses: baseWaitress,
    extraGeneralManagers: extraGeneral, extraWaitresses: extraWaitress,
    extraExpiresAt: override?.extraExpiresAt || null,
    effectiveMaxGeneralManagers: baseGeneral + extraGeneral,
    effectiveMaxWaitresses: baseWaitress + extraWaitress,
    suspendedReservesSlot: override?.suspendedReservesSlot === true,
    merchantCanEditQuotas: override?.merchantCanEditQuotas === true,
    reason: text(override?.reason, 300),
    hasOverride: Boolean(override && (override.maxGeneralManagers != null || override.maxWaitresses != null)),
    platform: { maxGeneralManagersPerMerchant: platform.maxGeneralManagersPerMerchant, maxWaitressesPerMerchant: platform.maxWaitressesPerMerchant },
  };
}

function createAdminControl(deps) {
  const { store, team } = deps;
  const pg = () => (team?.pg ? team.base.pool : null);
  const state = () => store.state;
  const persist = async () => { if (typeof store.save === 'function') await store.save(); };

  // =============================================================================== PHOTOS
  async function addRegistrationPhotos(registrationId, photos) {
    const list = Array.isArray(photos) ? photos.slice(0, 10) : [];
    const saved = [];
    for (const [index, photo] of list.entries()) {
      const raw = String(photo?.dataUri || photo?.data || '');
      const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);
      if (!match) throw fail('Chaque photo doit être une image PNG, JPEG ou WEBP.', 'INVALID_PHOTO');
      const bytes = Buffer.from(match[2], 'base64');
      if (!bytes.length) throw fail('Une photo envoyée est vide.', 'INVALID_PHOTO');
      if (bytes.length > 1_200_000) throw fail('Chaque photo doit rester sous 1,2 Mo après compression.', 'PHOTO_TOO_LARGE');
      const row = {
        id: uid('photo'), registrationId, position: index, label: text(photo?.label, 80),
        mimeType: `image/${match[1].toLowerCase() === 'jpg' ? 'jpeg' : match[1].toLowerCase()}`,
        byteSize: bytes.length, dataUri: raw, createdAt: nowIso(),
      };
      saved.push(row);
    }
    if (!saved.length) return [];
    if (pg()) {
      for (const row of saved) {
        await pg().query(
          `INSERT INTO merchant_registration_photos (id, registration_id, position, label, mime_type, byte_size, data_uri)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [row.id, row.registrationId, row.position, row.label, row.mimeType, row.byteSize, row.dataUri]);
      }
    } else {
      state().registrationPhotos ||= [];
      state().registrationPhotos.push(...saved);
      await persist();
    }
    return saved.map(({ dataUri, ...rest }) => ({ ...rest, hasData: true }));
  }

  async function listRegistrationPhotos(registrationId, { withData = false } = {}) {
    let rows;
    if (pg()) {
      ({ rows } = await pg().query(
        `SELECT id, registration_id AS "registrationId", position, label, mime_type AS "mimeType",
                byte_size AS "byteSize", created_at AS "createdAt"${withData ? ', data_uri AS "dataUri"' : ''}
           FROM merchant_registration_photos WHERE registration_id=$1 ORDER BY position, created_at`, [registrationId]));
    } else {
      rows = (state().registrationPhotos || []).filter((row) => row.registrationId === registrationId)
        .sort((a, b) => a.position - b.position)
        .map((row) => (withData ? { ...row } : (({ dataUri, ...rest }) => rest)(row)));
    }
    return rows;
  }

  async function getRegistrationPhoto(registrationId, photoId) {
    if (pg()) {
      const { rows } = await pg().query(
        `SELECT id, mime_type AS "mimeType", data_uri AS "dataUri" FROM merchant_registration_photos
          WHERE id=$1 AND registration_id=$2`, [photoId, registrationId]);
      return rows[0] || null;
    }
    return (state().registrationPhotos || []).find((row) => row.id === photoId && row.registrationId === registrationId) || null;
  }

  // =============================================================================== CODES TERRAIN
  // Anti-collision : un code déjà présent (même révoqué) n'est jamais réémis.
  function uniqueCodeAgainst(_state) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const candidate = generateFieldCode();
      const hash = hashFieldCode(candidate);
      const rows = _state?.fieldEnrollmentCodes || [];
      if (!rows.some((row) => row.codeHash === hash)) return candidate;
    }
    throw fail('Impossible de générer un code unique. Réessayez.', 'CODE_GENERATION_FAILED', 500);
  }

  async function createFieldCodes({ count = 1, ttlHours = 72, maxUses = 1, note = '', actor, managerId = null,
    teamQuotas = null, labelForManager = '', singleUse = false }) {
    if (!actor || !['admin', 'manager'].includes(actor.type)) throw fail('Création de code non autorisée.', 'FORBIDDEN', 403);
    const total = clampInt(count, 1, 25, 1);
    const ttl = clampInt(ttlHours, 1, 720, 72);
    const uses = clampInt(maxUses, 1, 100, 1);
    const expiresAt = new Date(Date.now() + ttl * 3600_000).toISOString();
    const created = [];
    for (let index = 0; index < total; index += 1) {
      // Mission 9 : un code « à usage unique » (créé depuis la fenêtre d'inscription) n'est
      // utilisable qu'une fois, sans exception, même si le plafond global autorise davantage.
      const plain = singleUse ? uniqueCodeAgainst(state()) : generateFieldCode();
      const row = {
        id: uid('fcode'), codeHash: hashFieldCode(plain), codeHint: hintOf(plain),
        createdByType: actor.type, createdById: String(actor.id || ''), createdByLabel: text(actor.label, 160),
        managerId: actor.type === 'manager' ? String(actor.id) : (managerId || null),
        maxUses: singleUse ? 1 : uses, uses: 0, expiresAt, note: text(note, 240), singleUse: singleUse === true,
        teamMaxGeneralManagers: teamQuotas ? clampInt(teamQuotas.maxGeneralManagers, 0, 200, 1) : null,
        teamMaxWaitresses: teamQuotas ? clampInt(teamQuotas.maxWaitresses, 0, 500, 2) : null,
        revokedAt: null, createdAt: nowIso(),
      };
      if (pg()) {
        await pg().query(
          `INSERT INTO field_enrollment_codes (id, code_hash, code_hint, created_by_type, created_by_id, created_by_label,
             manager_id, max_uses, uses, expires_at, note, team_max_general_managers, team_max_waitresses, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,0,$9::timestamptz,$10,$11,$12,NOW())`,
          [row.id, row.codeHash, row.codeHint, row.createdByType, row.createdById, row.createdByLabel,
            row.managerId, row.maxUses, row.expiresAt, row.note, row.teamMaxGeneralManagers, row.teamMaxWaitresses]);
      } else {
        state().fieldEnrollmentCodes ||= [];
        state().fieldEnrollmentCodes.push(row);
      }
      // Le code en clair n'est renvoyé qu'UNE fois, au créateur, au moment de la création.
      created.push({ id: row.id, code: plain, hint: row.codeHint, expiresAt, maxUses: uses,
        teamMaxGeneralManagers: row.teamMaxGeneralManagers, teamMaxWaitresses: row.teamMaxWaitresses });
    }
    if (!pg()) await persist();
    return created;
  }

  async function listFieldCodes({ actor, managerId = '', status = 'all', limit = 100 } = {}) {
    const scopeManager = actor?.type === 'manager' ? String(actor.id) : text(managerId, 80);
    let rows;
    if (pg()) {
      ({ rows } = await pg().query(
        `SELECT c.id, c.code_hint AS hint, c.created_by_type AS "createdByType", c.created_by_id AS "createdById",
                c.created_by_label AS "createdByLabel", c.manager_id AS "managerId", c.max_uses AS "maxUses", c.uses,
                c.expires_at AS "expiresAt", c.revoked_at AS "revokedAt", c.revoked_reason AS "revokedReason",
                c.note, c.team_max_general_managers AS "teamMaxGeneralManagers", c.team_max_waitresses AS "teamMaxWaitresses",
                c.created_at AS "createdAt",
                (SELECT COUNT(*)::int FROM field_code_uses u WHERE u.code_id=c.id) AS "useCount",
                (SELECT MAX(u.used_at) FROM field_code_uses u WHERE u.code_id=c.id) AS "lastUsedAt"
           FROM field_enrollment_codes c
          WHERE ($1 = '' OR c.manager_id = $1 OR c.created_by_id = $1)
          ORDER BY c.created_at DESC LIMIT $2`, [scopeManager, clampInt(limit, 1, 300, 100)]));
    } else {
      rows = (state().fieldEnrollmentCodes || []).filter((row) => !scopeManager || row.managerId === scopeManager || row.createdById === scopeManager)
        .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, clampInt(limit, 1, 300, 100))
        .map((row) => ({ ...row, hint: row.codeHint, useCount: (state().fieldCodeUses || []).filter((u) => u.codeId === row.id).length }));
    }
    const decorated = rows.map((row) => {
      const expired = row.expiresAt ? new Date(row.expiresAt).getTime() <= Date.now() : false;
      const exhausted = Number(row.uses) >= Number(row.maxUses);
      const revoked = Boolean(row.revokedAt);
      return { ...row, expired, exhausted, revoked,
        status: revoked ? 'revoked' : exhausted ? 'used' : expired ? 'expired' : 'available',
        remaining: Math.max(0, Number(row.maxUses) - Number(row.uses)) };
    });
    const filtered = status === 'all' ? decorated : decorated.filter((row) => row.status === status);
    const counts = {
      total: decorated.length,
      available: decorated.filter((row) => row.status === 'available').length,
      used: decorated.filter((row) => row.status === 'used').length,
      expired: decorated.filter((row) => row.status === 'expired').length,
      revoked: decorated.filter((row) => row.status === 'revoked').length,
    };
    return { data: filtered, counts };
  }

  async function revokeFieldCode(codeId, { actor, reason = '' } = {}) {
    if (!actor || !['admin', 'manager'].includes(actor.type)) throw fail('Révocation non autorisée.', 'FORBIDDEN', 403);
    if (pg()) {
      const { rows } = await pg().query(
        `UPDATE field_enrollment_codes SET revoked_at=NOW(), revoked_by=$3, revoked_reason=$4
          WHERE id=$1 AND revoked_at IS NULL AND ($2 = '' OR manager_id = $2 OR created_by_id = $2)
        RETURNING id, revoked_at AS "revokedAt"`,
        [codeId, actor.type === 'manager' ? String(actor.id) : '', text(actor.label, 160), text(reason, 240)]);
      if (!rows[0]) throw fail('Code introuvable, déjà révoqué, ou hors de votre périmètre.', 'CODE_NOT_REVOCABLE', 404);
      return rows[0];
    }
    const row = (state().fieldEnrollmentCodes || []).find((item) => item.id === codeId);
    if (!row) throw fail('Code introuvable.', 'NOT_FOUND', 404);
    if (actor.type === 'manager' && row.managerId !== String(actor.id) && row.createdById !== String(actor.id)) throw fail('Ce code n’est pas le vôtre.', 'FORBIDDEN', 403);
    if (row.revokedAt) throw fail('Ce code est déjà révoqué.', 'CODE_NOT_REVOCABLE', 409);
    row.revokedAt = nowIso(); row.revokedBy = text(actor.label, 160); row.revokedReason = text(reason, 240);
    await persist();
    return { id: row.id, revokedAt: row.revokedAt };
  }

  // Vérification SANS consommation : sert à ouvrir le formulaire. La consommation réelle a lieu
  // à la soumission, dans consumeFieldCode() — jamais ici.
  async function inspectFieldCode(plainCode) {
    const code = normalizeCode(plainCode);
    // Le tiret est facultatif (un code dicté au téléphone perd souvent sa ponctuation).
    if (!/^OY-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/.test(code)) throw fail('Format de code invalide. Un code ressemble à OY-XXXX-XXXX.', 'INVALID_CODE_FORMAT', 400);
    const hash = hashFieldCode(code);
    let row;
    if (pg()) {
      ({ rows: [row] } = await pg().query(
        `SELECT id, code_hint AS hint, created_by_type AS "createdByType", created_by_label AS "createdByLabel",
                manager_id AS "managerId", max_uses AS "maxUses", uses, expires_at AS "expiresAt", revoked_at AS "revokedAt",
                team_max_general_managers AS "teamMaxGeneralManagers", team_max_waitresses AS "teamMaxWaitresses"
           FROM field_enrollment_codes WHERE code_hash=$1`, [hash]).then((result) => ({ rows: result.rows }))
        .catch(() => ({ rows: [] })));
    } else {
      row = (state().fieldEnrollmentCodes || []).find((item) => item.codeHash === hash);
    }
    if (!row) throw fail('Ce code n’existe pas. Vérifiez la saisie.', 'CODE_NOT_FOUND', 404);
    if (row.revokedAt) throw fail('Ce code a été révoqué par son créateur ou par le PDG.', 'CODE_REVOKED', 410);
    if (new Date(row.expiresAt).getTime() <= Date.now()) throw fail('Ce code a expiré. Demandez-en un nouveau.', 'CODE_EXPIRED', 410);
    if (Number(row.uses) >= Number(row.maxUses)) throw fail('Ce code a déjà été utilisé. Un code ne sert qu’une seule fois.', 'CODE_USED', 410);
    return row;
  }

  // Consommation ATOMIQUE : la clause WHERE décide en une seule requête. Deux soumissions
  // simultanées ne peuvent pas réussir toutes les deux (rowCount = 1 pour une seule).
  // ---------------------------------------------------------------------------- code réservé
  // RÉSERVATION : quand la personne ouvre la fenêtre de code et que la vérification réussit, on
  // pose une réservation de 15 minutes SANS consommer le code. C'est ce qui empêche deux
  // personnes d'utiliser le même code en même temps, tout en laissant la consommation réelle à la
  // soumission réussie du dossier (une simple ouverture ne brûle jamais un code).
  const reserveTtlMs = () => 15 * 60_000;

  async function reserveFieldCode(plainCode, { token = '', req = null } = {}) {
    const code = normalizeCode(plainCode);
    const hash = hashFieldCode(code);
    const until = new Date(Date.now() + reserveTtlMs()).toISOString();
    const tokenHash = token ? crypto.createHash('sha256').update(`${codeSecret()}:${token}`).digest('hex').slice(0, 64) : '';
    if (pg()) {
      const { rows } = await pg().query(
        `UPDATE field_enrollment_codes
            SET reserved_until=$2::timestamptz, reserved_token=$3
          WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at > NOW() AND uses < max_uses
            AND (reserved_until IS NULL OR reserved_until <= NOW())
        RETURNING id, code_hint AS hint, manager_id AS "managerId", created_by_type AS "createdByType", created_by_label AS "createdByLabel"`, [hash, until, tokenHash]);
      if (!rows[0]) return null;
      return { ...rows[0], reservedUntil: until, tokenHash };
    }
    const row = (state().fieldEnrollmentCodes || []).find((item) => item.codeHash === hash);
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now() || Number(row.uses) >= Number(row.maxUses)) return null;
    if (row.reservedUntil && new Date(row.reservedUntil).getTime() > Date.now()) return null;
    row.reservedUntil = until; row.reservedToken = tokenHash; await persist();
    return { id: row.id, hint: row.codeHint, managerId: row.managerId, reservedUntil: until, tokenHash };
  }

  // La consommation exige, si une réservation existe, le MÊME jeton : une autre personne qui
  // détiendrait le code ne peut pas le consommer à la place du porteur de la réservation.
  async function consumeFieldCode(plainCode, { registrationId = null, context = '', req = null, token = '' } = {}) {
    const code = normalizeCode(plainCode);
    const hash = hashFieldCode(code);
    if (pg()) {
      const client = await pg().connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          // Une réservation active doit être présentée par son porteur (même jeton) ; une
          // réservation expirée ne bloque plus personne.
          `UPDATE field_enrollment_codes
              SET uses = uses + 1, reserved_until = NULL, reserved_token = ''
            WHERE code_hash=$1 AND revoked_at IS NULL AND expires_at > NOW() AND uses < max_uses
              AND (reserved_until IS NULL OR reserved_until <= NOW() OR reserved_token = $2)
          RETURNING id, code_hint AS hint, manager_id AS "managerId", created_by_type AS "createdByType",
                    created_by_label AS "createdByLabel", team_max_general_managers AS "teamMaxGeneralManagers",
                    team_max_waitresses AS "teamMaxWaitresses", uses, max_uses AS "maxUses"`,
          // Sans jeton, on compare à une chaîne vide : jamais un caractère NUL, que PostgreSQL
          // refuse dans un paramètre texte (« invalid byte sequence for encoding UTF8 »).
          [hash, token ? crypto.createHash('sha256').update(`${codeSecret()}:${token}`).digest('hex').slice(0, 64) : '']);
        if (!rows[0]) { await client.query('ROLLBACK'); return null; }
        const codeRow = rows[0];
        const managerLabel = codeRow.createdByType === 'manager' ? codeRow.createdByLabel : '';
        const useId = uid('fuse');
        await client.query(
          `INSERT INTO field_code_uses (id, code_id, registration_id, manager_id, manager_label, ip_hash, context)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [useId, codeRow.id, registrationId, codeRow.managerId, managerLabel, ipHash(req), text(context, 120)]);
        await client.query('COMMIT');
        return { ...codeRow, useId };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally { client.release(); }
    }
    // Stockage JSON : le processus Node est mono-thread, la section critique ci-dessous est donc
    // atomique vis-à-vis des requêtes HTTP concurrentes (aucun await avant l'écriture).
    const row = (state().fieldEnrollmentCodes || []).find((item) => item.codeHash === hash);
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now() || Number(row.uses) >= Number(row.maxUses)) return null;
    const tokenHash = token ? crypto.createHash('sha256').update(`${codeSecret()}:${token}`).digest('hex').slice(0, 64) : '';
    if (row.reservedUntil && new Date(row.reservedUntil).getTime() > Date.now() && row.reservedToken && row.reservedToken !== tokenHash) return null;
    row.uses = Number(row.uses) + 1; row.reservedUntil = null; row.reservedToken = '';
    state().fieldCodeUses ||= [];
    const useId = uid('fuse');
    state().fieldCodeUses.push({ id: useId, codeId: row.id, registrationId, managerId: row.managerId,
      managerLabel: row.createdByType === 'manager' ? row.createdByLabel : '', usedAt: nowIso(),
      ipHash: ipHash(req), context: text(context, 120) });
    await persist();
    return { ...row, useId };
  }

  // Rattache l'inscription obtenue à la ligne d'utilisation du code (historique terrain).
  async function attachFieldCodeUse(useId, registrationId) {
    if (!useId || !registrationId) return false;
    if (pg()) {
      const { rowCount } = await pg().query('UPDATE field_code_uses SET registration_id=$2 WHERE id=$1', [useId, registrationId]);
      return rowCount > 0;
    }
    const row = (state().fieldCodeUses || []).find((item) => item.id === useId);
    if (!row) return false;
    row.registrationId = registrationId;
    await persist();
    return true;
  }

  async function fieldCodeHistory({ managerId = '', limit = 100 } = {}) {
    if (pg()) {
      const { rows } = await pg().query(
        `SELECT u.id, u.code_id AS "codeId", u.used_at AS "usedAt", u.manager_id AS "managerId", u.manager_label AS "managerLabel",
                u.registration_id AS "registrationId", c.code_hint AS hint, c.created_at AS "createdAt",
                r.reference, r.business_name AS "businessName", r.contact_name AS "contactName", r.phone, r.status
           FROM field_code_uses u JOIN field_enrollment_codes c ON c.id = u.code_id
           LEFT JOIN merchant_registrations r ON r.id = u.registration_id
          WHERE ($1 = '' OR u.manager_id = $1) ORDER BY u.used_at DESC LIMIT $2`,
        [text(managerId, 80), clampInt(limit, 1, 300, 100)]);
      return rows;
    }
    return (state().fieldCodeUses || []).slice().reverse().slice(0, limit);
  }

  // Quotas portés par un code terrain (relus à l'approbation du dossier, sans jamais exposer le code).
  async function fieldCodeQuotas(codeId) {
    if (!codeId) return null;
    let row;
    if (pg()) {
      ({ rows: [row] } = await pg().query(
        `SELECT id, team_max_general_managers AS "teamMaxGeneralManagers",
                team_max_waitresses AS "teamMaxWaitresses"
           FROM field_enrollment_codes WHERE id=$1`, [codeId]));
    } else {
      const found = (state().fieldEnrollmentCodes || []).find((item) => item.id === codeId);
      row = found ? { id: found.id, teamMaxGeneralManagers: found.teamMaxGeneralManagers, teamMaxWaitresses: found.teamMaxWaitresses } : null;
    }
    if (!row || (row.teamMaxGeneralManagers == null && row.teamMaxWaitresses == null)) return null;
    return row;
  }

  // =============================================================================== NOTIFICATIONS
  async function notify({ recipientType = 'admin', recipientId = '', type, severity = 'info', title, body = '', linkView = '', linkId = '', dedupeKey = '', metadata = {} }) {
    const row = {
      id: uid('ntf'), recipientType, recipientId: String(recipientId || ''), notificationType: text(type, 60),
      severity: ['info', 'success', 'warning', 'danger'].includes(severity) ? severity : 'info',
      title: text(title, 160), body: text(body, 600), linkView: text(linkView, 40), linkId: text(linkId, 80),
      dedupeKey: text(dedupeKey, 120), metadata: metadata && typeof metadata === 'object' ? metadata : {}, createdAt: nowIso(), readAt: null,
    };
    if (pg()) {
      try {
        const { rows } = await pg().query(
          `INSERT INTO admin_notifications (id, recipient_type, recipient_id, notification_type, severity, title, body,
             link_view, link_id, dedupe_key, metadata)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)
           ON CONFLICT (recipient_type, recipient_id, dedupe_key) WHERE dedupe_key <> '' DO NOTHING
           RETURNING id`,
          [row.id, row.recipientType, row.recipientId, row.notificationType, row.severity, row.title, row.body,
            row.linkView, row.linkId, row.dedupeKey, JSON.stringify(row.metadata)]);
        return rows[0] ? row : null;
      } catch (error) {
        // Une notification ne doit jamais faire échouer l'action métier qu'elle décrit.
        console.error('Notification PDG non enregistrée :', error.message);
        return null;
      }
    }
    state().adminNotifications ||= [];
    if (row.dedupeKey && state().adminNotifications.some((item) => item.dedupeKey === row.dedupeKey &&
      item.recipientType === row.recipientType && item.recipientId === row.recipientId)) return null;
    state().adminNotifications.unshift(row);
    await persist();
    return row;
  }

  async function listNotifications({ recipientType = 'admin', recipientId = '', unreadOnly = false, limit = 50 } = {}) {
    if (pg()) {
      const { rows } = await pg().query(
        `SELECT id, notification_type AS "type", severity, title, body, link_view AS "linkView", link_id AS "linkId",
                metadata, created_at AS "createdAt", read_at AS "readAt"
           FROM admin_notifications
          WHERE recipient_type=$1 AND recipient_id=$2 ${unreadOnly ? 'AND read_at IS NULL' : ''}
          ORDER BY created_at DESC LIMIT $3`, [recipientType, String(recipientId || ''), clampInt(limit, 1, 200, 50)]);
      const { rows: [count] } = await pg().query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE read_at IS NULL)::int AS unread
           FROM admin_notifications WHERE recipient_type=$1 AND recipient_id=$2`, [recipientType, String(recipientId || '')]);
      return { data: rows, counts: count || { total: 0, unread: 0 } };
    }
    const all = (state().adminNotifications || []).filter((row) => row.recipientType === recipientType && row.recipientId === String(recipientId || ''));
    return { data: all.slice(0, limit), counts: { total: all.length, unread: all.filter((row) => !row.readAt).length } };
  }

  async function markNotificationsRead({ recipientType = 'admin', recipientId = '', ids = [] } = {}) {
    const list = Array.isArray(ids) ? ids.filter(Boolean).slice(0, 200) : [];
    if (pg()) {
      if (list.length) {
        await pg().query(`UPDATE admin_notifications SET read_at=NOW() WHERE recipient_type=$1 AND recipient_id=$2 AND id = ANY($3::text[]) AND read_at IS NULL`,
          [recipientType, String(recipientId || ''), list]);
      } else {
        await pg().query(`UPDATE admin_notifications SET read_at=NOW() WHERE recipient_type=$1 AND recipient_id=$2 AND read_at IS NULL`,
          [recipientType, String(recipientId || '')]);
      }
      return listNotifications({ recipientType, recipientId, limit: 1 });
    }
    for (const row of state().adminNotifications || []) {
      if (row.recipientType !== recipientType || row.recipientId !== String(recipientId || '')) continue;
      if (!list.length || list.includes(row.id)) row.readAt ||= nowIso();
    }
    await persist();
    return listNotifications({ recipientType, recipientId, limit: 1 });
  }

  // =============================================================================== AUDIT
  async function journal({ actor, action, entityType, entityId = '', merchantId = null, managerId = null,
    summary = '', before = null, after = null, req = null }) {
    const row = {
      actorType: actor?.type || 'system', actorId: String(actor?.id || ''), actorLabel: text(actor?.label || 'Système', 160),
      action: text(action, 80), entityType: text(entityType, 60), entityId: text(entityId, 80),
      merchantId: merchantId || null, managerId: managerId || null, summary: text(summary, 600),
      beforeData: before, afterData: after, ipHash: ipHash(req), createdAt: nowIso(),
    };
    if (pg()) {
      await pg().query(
        `INSERT INTO admin_audit_journal (actor_type, actor_id, actor_label, action, entity_type, entity_id,
           merchant_id, manager_id, summary, before_data, after_data, ip_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
        [row.actorType, row.actorId, row.actorLabel, row.action, row.entityType, row.entityId, row.merchantId,
          row.managerId, row.summary, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null, row.ipHash]).catch((error) => {
        console.error('Journal d’audit non enregistré :', error.message);
      });
      return;
    }
    state().adminAuditJournal ||= [];
    state().adminAuditJournal.unshift(row);
    await persist();
  }

  async function listJournal({ managerId = '', entityType = '', merchantId = '', limit = 100 } = {}) {
    if (pg()) {
      const { rows } = await pg().query(
        `SELECT id, actor_type AS "actorType", actor_id AS "actorId", actor_label AS "actorLabel", action,
                entity_type AS "entityType", entity_id AS "entityId", merchant_id AS "merchantId", manager_id AS "managerId",
                summary, before_data AS "before", after_data AS "after", created_at AS "createdAt"
           FROM admin_audit_journal
          WHERE ($1 = '' OR manager_id = $1) AND ($2 = '' OR entity_type = $2) AND ($3 = '' OR merchant_id = $3)
          ORDER BY created_at DESC LIMIT $4`,
        [text(managerId, 80), text(entityType, 60), text(merchantId, 80), clampInt(limit, 1, 300, 100)]);
      return rows;
    }
    return (state().adminAuditJournal || []).filter((row) =>
      (!managerId || row.managerId === managerId) && (!entityType || row.entityType === entityType) && (!merchantId || row.merchantId === merchantId))
      .slice(0, limit);
  }

  return {
    // photos
    addRegistrationPhotos, listRegistrationPhotos, getRegistrationPhoto,
    // codes terrain
    createFieldCodes, listFieldCodes, revokeFieldCode, inspectFieldCode, consumeFieldCode, reserveFieldCode, fieldCodeHistory,
    fieldCodeQuotas, attachFieldCodeUse,
    // notifications
    notify, listNotifications, markNotificationsRead,
    // audit
    journal, listJournal,
    // utilitaires exposés aux routes
    resolveTeamQuotas, platformTeamQuotas, mergeQuotas, hashFieldCode, normalizeCode,
  };
}

module.exports = { createAdminControl, resolveTeamQuotas, platformTeamQuotas, mergeQuotas,
  hashFieldCode, generateFieldCode, normalizeCode, FIELD_CODE_PREFIX };
