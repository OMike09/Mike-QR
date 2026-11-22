'use strict';

// ============================================================================================
// Équipe marchande : gérants généraux et serveuses.
//
// Règles structurantes (vérifiées ici, côté serveur, jamais dans l'interface seule) :
//   1. Un membre appartient à UN marchand et à UNE boutique : `merchant_id` + `store_id` sont
//      figés à la création et ne peuvent jamais être modifiés.
//   2. Un compte ne s'active qu'avec un code unique, à usage unique, expirable et révocable.
//      Seul le HACHAGE du code est stocké ; le code en clair n'est affiché qu'une fois.
//   3. Le blocage incrémente `token_version` : toute session ouverte devient immédiatement
//      invalide, y compris pour les requêtes déjà en cours au tour suivant.
//   4. Un membre ne peut jamais modifier son rôle, ses permissions, ni ses propres blocages.
//   5. Les permissions réservées au propriétaire ne sont accordables à personne.
// ============================================================================================

const crypto = require('node:crypto');
const seed = require('./team-seed');

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const nowIso = () => new Date().toISOString();
const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

function fail(message, code = 'TEAM_INVALID', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

const HASH_ROUNDS = 120000;
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const derived = crypto.scryptSync(String(password), salt, 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return `scrypt$${HASH_ROUNDS}$${salt}$${derived}`;
}
function checkPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false;
  const derived = crypto.scryptSync(String(password), parts[2], 32, { N: 16384, r: 8, p: 1 }).toString('base64url');
  const a = Buffer.from(derived); const b = Buffer.from(parts[3]);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const DEFAULT_SETTINGS = Object.freeze({
  activationCodeTtlHours: 72, maxGeneralManagers: 10, maxWaitresses: 50,
  waitressMaxDiscountPercent: 0, allowFreePrice: true, freePriceMaxXof: 100000, teamBlocked: false,
});

class TeamStore {
  constructor({ base, commerce }) {
    this.base = base;
    this.commerce = commerce;
    this.pg = Boolean(base && base.pool);
  }

  state() {
    const s = this.base.state;
    s.teamMembers ||= [];
    s.teamActivationCodes ||= [];
    s.teamMemberSessions ||= [];
    s.teamTasks ||= [];
    s.teamTaskEvents ||= [];
    s.teamActivityEvents ||= [];
    s.merchantTeamSettings ||= [];
    return s;
  }
  async save() { if (!this.pg) await this.base.save(); }

  // ------------------------------------------------------------------ paramètres du marchand
  async getSettings(merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT activation_code_ttl_hours AS "activationCodeTtlHours", max_general_managers AS "maxGeneralManagers",
                max_waitresses AS "maxWaitresses", waitress_max_discount_percent AS "waitressMaxDiscountPercent",
                allow_free_price AS "allowFreePrice", free_price_max_xof AS "freePriceMaxXof", team_blocked AS "teamBlocked"
           FROM merchant_team_settings WHERE merchant_id=$1`, [merchantId]);
      return rows[0] || { ...DEFAULT_SETTINGS };
    }
    return clone(this.state().merchantTeamSettings.find((s) => s.merchantId === merchantId) || { ...DEFAULT_SETTINGS });
  }

  async updateSettings(merchantId, patch = {}) {
    const current = await this.getSettings(merchantId);
    const next = {
      activationCodeTtlHours: clampInt(patch.activationCodeTtlHours, 1, 720, current.activationCodeTtlHours),
      maxGeneralManagers: clampInt(patch.maxGeneralManagers, 0, 200, current.maxGeneralManagers),
      maxWaitresses: clampInt(patch.maxWaitresses, 0, 500, current.maxWaitresses),
      waitressMaxDiscountPercent: clampInt(patch.waitressMaxDiscountPercent, 0, 100, current.waitressMaxDiscountPercent),
      allowFreePrice: patch.allowFreePrice === undefined ? current.allowFreePrice !== false : patch.allowFreePrice === true,
      freePriceMaxXof: clampInt(patch.freePriceMaxXof, 0, 10000000, Number(current.freePriceMaxXof) || 0),
      teamBlocked: patch.teamBlocked === undefined ? current.teamBlocked === true : patch.teamBlocked === true,
    };
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO merchant_team_settings (merchant_id, activation_code_ttl_hours, max_general_managers, max_waitresses,
            waitress_max_discount_percent, allow_free_price, free_price_max_xof, team_blocked, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
         ON CONFLICT (merchant_id) DO UPDATE SET activation_code_ttl_hours=EXCLUDED.activation_code_ttl_hours,
           max_general_managers=EXCLUDED.max_general_managers, max_waitresses=EXCLUDED.max_waitresses,
           waitress_max_discount_percent=EXCLUDED.waitress_max_discount_percent, allow_free_price=EXCLUDED.allow_free_price,
           free_price_max_xof=EXCLUDED.free_price_max_xof, team_blocked=EXCLUDED.team_blocked, updated_at=NOW()`,
        [merchantId, next.activationCodeTtlHours, next.maxGeneralManagers, next.maxWaitresses,
          next.waitressMaxDiscountPercent, next.allowFreePrice, next.freePriceMaxXof, next.teamBlocked]);
      return this.getSettings(merchantId);
    }
    const s = this.state();
    const row = s.merchantTeamSettings.find((x) => x.merchantId === merchantId);
    if (row) Object.assign(row, next); else s.merchantTeamSettings.push({ merchantId, ...next });
    await this.save();
    return next;
  }

  // ------------------------------------------------------------------ permissions
  async ensurePermissionSeed() {
    if (this.pg) {
      for (const [index, permission] of seed.PERMISSIONS.entries()) {
        await this.base.pool.query(
          `INSERT INTO team_permissions (code, label, description, applies_to, sort_order) VALUES ($1,$2,$3,$4,$5)
           ON CONFLICT (code) DO UPDATE SET label=EXCLUDED.label, description=EXCLUDED.description,
             applies_to=EXCLUDED.applies_to, sort_order=EXCLUDED.sort_order`,
          [permission.code, permission.label, permission.description, permission.appliesTo, index * 10]);
      }
    }
    return seed.PERMISSIONS.length;
  }

  sanitizePermissions(role, requested) {
    const allowed = new Set(seed.permissionsForRole(role));
    const list = Array.isArray(requested) ? requested : [];
    const kept = [...new Set(list.map((code) => clean(code, 60)).filter((code) => allowed.has(code)))];
    // Aucune permission de propriétaire ne peut être accordée, même si elle est demandée explicitement.
    return kept.filter((code) => !seed.OWNER_ONLY_PERMISSIONS.includes(code));
  }

  // ------------------------------------------------------------------ membres
  async listMembers(merchantId, { includeArchived = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT m.id, m.merchant_id AS "merchantId", m.store_id AS "storeId", m.role, m.designation, m.full_name AS "fullName",
                m.phone, m.username, m.permissions, m.status, m.status_reason AS "statusReason", m.points,
                m.activated_at AS "activatedAt", m.last_login_at AS "lastLoginAt", m.created_at AS "createdAt",
                (SELECT COUNT(*)::int FROM team_tasks t WHERE t.member_id = m.id AND t.status IN ('todo','in_progress')) AS "openTasks"
           FROM team_members m WHERE m.merchant_id=$1 ${includeArchived ? '' : "AND m.status <> 'archived'"}
          ORDER BY m.role, m.created_at`, [merchantId]);
      return rows;
    }
    const s = this.state();
    return s.teamMembers.filter((m) => m.merchantId === merchantId && (includeArchived || m.status !== 'archived'))
      .map((m) => ({ ...publicMember(m), openTasks: s.teamTasks.filter((t) => t.memberId === m.id && ['todo', 'in_progress'].includes(t.status)).length }));
  }

  async getMember(id, merchantId = '') {
    if (this.pg) {
      const params = [id]; let where = 'm.id=$1';
      if (merchantId) { params.push(merchantId); where += ' AND m.merchant_id=$2'; }
      const { rows } = await this.base.pool.query(
        `SELECT m.id, m.merchant_id AS "merchantId", m.store_id AS "storeId", m.role, m.designation,
                m.full_name AS "fullName", m.phone, m.username, m.password_hash AS "passwordHash",
                m.permissions, m.status, m.status_reason AS "statusReason", m.token_version AS "tokenVersion",
                m.points, m.must_change_password AS "mustChangePassword", m.activated_at AS "activatedAt",
                m.last_login_at AS "lastLoginAt", m.blocked_at AS "blockedAt", m.archived_at AS "archivedAt",
                m.created_by_type AS "createdByType", m.created_by_id AS "createdById",
                m.created_at AS "createdAt", m.updated_at AS "updatedAt"
           FROM team_members m WHERE ${where}`, params);
      return rows[0] || null;
    }
    const s = this.state();
    return clone(s.teamMembers.find((m) => m.id === id && (!merchantId || m.merchantId === merchantId)) || null);
  }

  async createMember(merchantId, storeId, input = {}, actor = {}) {
    const settings = await this.getSettings(merchantId);
    if (settings.teamBlocked) throw fail('L’équipe entière est bloquée. Débloquez-la avant de créer un membre.', 'TEAM_BLOCKED', 409);
    const role = input.role;
    if (!seed.ROLES.some((r) => r.code === role)) throw fail('Choisissez une fonction valide : gérant général ou serveuse.');
    const fullName = clean(input.fullName, 120);
    if (fullName.length < 2 || !/[\p{L}\p{N}]/u.test(fullName)) throw fail('Indiquez le nom et le prénom du membre.');
    const phone = clean(input.phone, 32);
    if (phone && (phone.replace(/\D/g, '').length < 7 || !/^[0-9+().\s-]{7,32}$/.test(phone))) throw fail('Le numéro de téléphone n’est pas valide.');
    const designation = clean(input.designation, 60) || await this.nextDesignation(merchantId, role);

    const members = await this.listMembers(merchantId);
    const activeCount = members.filter((m) => m.role === role && m.status !== 'archived').length;
    if (role === 'general_manager' && activeCount >= Number(settings.maxGeneralManagers)) throw fail(`Limite atteinte : ${settings.maxGeneralManagers} gérant(s) général(aux) au maximum.`, 'TEAM_LIMIT', 409);
    if (role === 'waitress' && activeCount >= Number(settings.maxWaitresses)) throw fail(`Limite atteinte : ${settings.maxWaitresses} serveuse(s) au maximum.`, 'TEAM_LIMIT', 409);

    const permissions = input.permissions === undefined ? seed.defaultPermissionsFor(role) : this.sanitizePermissions(role, input.permissions);
    const username = await this.reserveUsername(merchantId, input.username || fullName);
    const id = uid('tm');
    const row = {
      id, merchantId, storeId, role, designation, fullName, phone, username, passwordHash: '',
      permissions, status: 'pending', statusReason: '', tokenVersion: 1, points: 0, mustChangePassword: false,
      activatedAt: null, lastLoginAt: null, blockedAt: null, archivedAt: null,
      createdByType: clean(actor.type, 20) || 'merchant', createdById: clean(actor.id, 60), createdAt: nowIso(), updatedAt: nowIso(),
    };
    if (this.pg) {
      try {
        await this.base.pool.query(
          `INSERT INTO team_members (id, merchant_id, store_id, role, designation, full_name, phone, username, password_hash,
             permissions, status, status_reason, token_version, points, must_change_password, created_by_type, created_by_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9::jsonb,'pending','',1,0,FALSE,$10,$11,NOW(),NOW())`,
          [id, merchantId, storeId, role, designation, fullName, phone, username, JSON.stringify(permissions), row.createdByType, row.createdById]);
      } catch (error) {
        if (error.code === '23505') throw fail('Cet identifiant de connexion est déjà utilisé. Choisissez-en un autre.', 'USERNAME_TAKEN', 409);
        throw error;
      }
    } else {
      const s = this.state();
      if (s.teamMembers.some((m) => m.status !== 'archived' && m.username.toLowerCase() === username.toLowerCase())) {
        throw fail('Cet identifiant de connexion est déjà utilisé. Choisissez-en un autre.', 'USERNAME_TAKEN', 409);
      }
      s.teamMembers.push(row); await this.save();
    }
    const issued = await this.issueActivationCode(id, actor);
    return { member: await this.getMember(id, merchantId), code: issued.code, codeId: issued.id, expiresAt: issued.expiresAt };
  }

  async nextDesignation(merchantId, role) {
    const existing = (await this.listMembers(merchantId, { includeArchived: true })).filter((m) => m.role === role);
    const label = seed.ROLES.find((r) => r.code === role)?.designationPrefix || 'Membre';
    let index = 1;
    const taken = new Set(existing.map((m) => String(m.designation || '').toLowerCase()));
    while (taken.has(`${label} ${index}`.toLowerCase())) index += 1;
    return `${label} ${index}`;
  }

  async reserveUsername(merchantId, base) {
    const slug = String(base || 'membre').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '').slice(0, 40) || 'membre';
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const candidate = attempt === 0 ? slug : `${slug}${attempt + 1}`;
      const taken = this.pg
        ? (await this.base.pool.query('SELECT 1 FROM team_members WHERE LOWER(username)=LOWER($1) AND status <> $2', [candidate, 'archived'])).rows.length
        : this.state().teamMembers.some((m) => m.status !== 'archived' && m.username.toLowerCase() === candidate.toLowerCase());
      if (!taken) return candidate;
    }
    return `${slug}.${crypto.randomBytes(3).toString('hex')}`;
  }

  // Le marchand modifie désignation, nom, téléphone, fonction et permissions. Jamais l'id, jamais le marchand.
  async updateMember(id, merchantId, patch = {}, actor = {}) {
    const member = await this.getMember(id, merchantId);
    if (!member) throw fail('Membre introuvable dans cette boutique.', 'NOT_FOUND', 404);
    let role = member.role;
    if (patch.role !== undefined && patch.role !== member.role) {
      if (member.status === 'active') throw fail('Archivez ou suspendez le membre avant de changer sa fonction.', 'ROLE_LOCKED', 409);
      if (!seed.ROLES.some((r) => r.code === patch.role)) throw fail('Fonction invalide.');
      role = patch.role;
    }
    const designation = patch.designation === undefined ? member.designation : clean(patch.designation, 60) || member.designation;
    const fullName = patch.fullName === undefined ? member.fullName : clean(patch.fullName, 120);
    if (!fullName || fullName.length < 2) throw fail('Indiquez le nom et le prénom.');
    const phone = patch.phone === undefined ? member.phone : clean(patch.phone, 32);
    if (phone && phone.replace(/\D/g, '').length < 7) throw fail('Le numéro de téléphone n’est pas valide.');
    let permissions = member.permissions || [];
    let bumpVersion = false;
    if (patch.permissions !== undefined) {
      const next = this.sanitizePermissions(role, patch.permissions);
      // Retirer une permission coupe l'accès en cours : la version change.
      if (next.length < permissions.length) bumpVersion = true;
      permissions = next;
    } else if (role !== member.role) {
      permissions = this.sanitizePermissions(role, permissions);
    }
    if (this.pg) {
      await this.base.pool.query(
        `UPDATE team_members SET role=$3, designation=$4, full_name=$5, phone=$6, permissions=$7::jsonb,
           token_version = token_version + $8, updated_at=NOW() WHERE id=$1 AND merchant_id=$2`,
        [id, merchantId, role, designation, fullName, phone, JSON.stringify(permissions), bumpVersion ? 1 : 0]);
    } else {
      const s = this.state();
      const row = s.teamMembers.find((m) => m.id === id && m.merchantId === merchantId);
      Object.assign(row, { role, designation, fullName, phone, permissions, tokenVersion: Number(row.tokenVersion) + (bumpVersion ? 1 : 0), updatedAt: nowIso() });
      if (bumpVersion) s.teamMemberSessions.filter((x) => x.memberId === id).forEach((x) => { x.revokedAt ||= nowIso(); });
      await this.save();
    }
    return this.getMember(id, merchantId);
  }

  async setStatus(id, merchantId, status, reason = '', actor = {}) {
    if (!['active', 'blocked', 'suspended', 'archived', 'pending'].includes(status)) throw fail('État invalide.');
    const member = await this.getMember(id, merchantId);
    if (!member) throw fail('Membre introuvable dans cette boutique.', 'NOT_FOUND', 404);
    if (status === 'archived' && member.status === 'pending') {
      // Un compte jamais activé peut être archivé directement : aucun historique à conserver.
    }
    const bump = ['blocked', 'suspended', 'archived'].includes(status);
    if (this.pg) {
      await this.base.pool.query(
        `UPDATE team_members SET status=$3, status_reason=$4, token_version = token_version + $5,
           blocked_at = CASE WHEN $3 IN ('blocked','suspended') THEN NOW() ELSE blocked_at END,
           archived_at = CASE WHEN $3 = 'archived' THEN NOW() ELSE archived_at END, updated_at=NOW()
         WHERE id=$1 AND merchant_id=$2`,
        [id, merchantId, status, clean(reason, 200), bump ? 1 : 0]);
      if (bump) await this.base.pool.query('UPDATE team_member_sessions SET revoked_at=NOW() WHERE member_id=$1 AND revoked_at IS NULL', [id]);
    } else {
      const s = this.state();
      const row = s.teamMembers.find((m) => m.id === id && m.merchantId === merchantId);
      Object.assign(row, { status, statusReason: clean(reason, 200), tokenVersion: Number(row.tokenVersion) + (bump ? 1 : 0), updatedAt: nowIso() });
      if (bump) { row.blockedAt = nowIso(); s.teamMemberSessions.filter((x) => x.memberId === id).forEach((x) => { x.revokedAt ||= nowIso(); }); }
      await this.save();
    }
    await this.recordActivity(member.merchantId, member.storeId, id, `member_${status}`,
      `${member.designation || member.fullName} : ${status === 'blocked' ? 'bloqué' : status === 'suspended' ? 'suspendu' : status === 'archived' ? 'archivé' : 'réactivé'} par ${actor.label || 'le marchand'}.`,
      'success', { reason: clean(reason, 200) });
    return this.getMember(id, merchantId);
  }

  async setAllStatus(merchantId, status, reason = '', actor = {}) {
    const members = (await this.listMembers(merchantId)).filter((m) => m.status !== 'archived');
    let changed = 0;
    for (const member of members) {
      if (member.status === status) continue;
      await this.setStatus(member.id, merchantId, status, reason, actor);
      changed += 1;
    }
    if (status === 'blocked') await this.updateSettings(merchantId, { teamBlocked: true });
    if (status === 'active') await this.updateSettings(merchantId, { teamBlocked: false });
    return { changed, total: members.length };
  }

  // ------------------------------------------------------------------ codes d'activation
  async issueActivationCode(memberId, actor = {}) {
    const member = await this.getMember(memberId);
    if (!member) throw fail('Membre introuvable.', 'NOT_FOUND', 404);
    if (['archived', 'blocked'].includes(member.status)) throw fail('Débloquez ou réactivez le membre avant de générer un code.', 'MEMBER_INACTIVE', 409);
    const settings = await this.getSettings(member.merchantId);
    const ttlHours = Number(settings.activationCodeTtlHours) || DEFAULT_SETTINGS.activationCodeTtlHours;
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    // Un seul code utilisable à la fois : les précédents sont révoqués.
    if (this.pg) {
      await this.base.pool.query("UPDATE team_activation_codes SET revoked_at=NOW(), revoked_by=$2 WHERE member_id=$1 AND used_at IS NULL AND revoked_at IS NULL", [memberId, clean(actor.id, 60) || 'merchant']);
    } else {
      const s = this.state();
      s.teamActivationCodes.filter((c) => c.memberId === memberId && !c.usedAt && !c.revokedAt).forEach((c) => { c.revokedAt = nowIso(); c.revokedBy = clean(actor.id, 60); });
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const code = seed.generateActivationCode(crypto.randomBytes);
      const row = { id: uid('tac'), memberId, merchantId: member.merchantId, role: member.role, codeHash: sha256(code),
        codeHint: seed.codeHint(code), expiresAt, usedAt: null, revokedAt: null, revokedBy: '', createdAt: nowIso() };
      try {
        if (this.pg) {
          await this.base.pool.query(
            `INSERT INTO team_activation_codes (id, member_id, merchant_id, role, code_hash, code_hint, expires_at, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
            [row.id, row.memberId, row.merchantId, row.role, row.codeHash, row.codeHint, row.expiresAt]);
        } else {
          const s = this.state();
          if (s.teamActivationCodes.some((c) => c.codeHash === row.codeHash)) continue;
          s.teamActivationCodes.push(row); await this.save();
        }
        await this.recordActivity(member.merchantId, member.storeId, memberId, 'activation_code_issued',
          `Nouveau code d’activation généré pour ${member.designation || member.fullName}.`, 'success', { expiresAt });
        return { id: row.id, code, expiresAt, hint: row.codeHint };
      } catch (error) {
        if (error.code !== '23505') throw error;
      }
    }
    throw fail('Impossible de générer un code unique. Réessayez.', 'CODE_GENERATION_FAILED', 500);
  }

  async listActivationCodes(memberId, merchantId) {
    const member = await this.getMember(memberId, merchantId);
    if (!member) throw fail('Membre introuvable dans cette boutique.', 'NOT_FOUND', 404);
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, code_hint AS "hint", expires_at AS "expiresAt", used_at AS "usedAt", revoked_at AS "revokedAt", created_at AS "createdAt"
           FROM team_activation_codes WHERE member_id=$1 ORDER BY created_at DESC LIMIT 20`, [memberId]);
      return rows.map((row) => ({ ...row, state: row.usedAt ? 'used' : row.revokedAt ? 'revoked' : new Date(row.expiresAt).getTime() <= Date.now() ? 'expired' : 'open' }));
    }
    const s = this.state();
    return s.teamActivationCodes.filter((c) => c.memberId === memberId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20)
      .map((c) => ({ id: c.id, hint: c.codeHint, expiresAt: c.expiresAt, usedAt: c.usedAt, revokedAt: c.revokedAt, createdAt: c.createdAt,
        state: c.usedAt ? 'used' : c.revokedAt ? 'revoked' : new Date(c.expiresAt).getTime() <= Date.now() ? 'expired' : 'open' }));
  }

  async revokeActivationCode(codeId, merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE team_activation_codes SET revoked_at=NOW(), revoked_by=$3
          WHERE id=$1 AND merchant_id=$2 AND used_at IS NULL AND revoked_at IS NULL RETURNING id`, [codeId, merchantId, merchantId]);
      if (!rows[0]) throw fail('Ce code est introuvable, déjà utilisé ou déjà révoqué.', 'CODE_NOT_REVOCABLE', 409);
      return { revoked: true };
    }
    const s = this.state();
    const row = s.teamActivationCodes.find((c) => c.id === codeId && c.merchantId === merchantId && !c.usedAt && !c.revokedAt);
    if (!row) throw fail('Ce code est introuvable, déjà utilisé ou déjà révoqué.', 'CODE_NOT_REVOCABLE', 409);
    row.revokedAt = nowIso(); row.revokedBy = merchantId; await this.save();
    return { revoked: true };
  }

  // Activation publique : le code seul ne suffit pas, le membre choisit ensuite son identifiant et
  // son mot de passe. Le code est consommé atomiquement (UPDATE ... WHERE used_at IS NULL).
  async activate(code, { password } = {}) {
    const normalized = seed.normalizeActivationCode(code);
    if (!normalized) throw fail('Code d’activation invalide. Vérifiez les 16 caractères.', 'CODE_INVALID', 400);
    if (String(password || '').length < 8) throw fail('Choisissez un mot de passe de 8 caractères minimum.', 'PASSWORD_WEAK', 400);
    const hash = sha256(normalized);
    let record = null;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE team_activation_codes SET used_at=NOW()
          WHERE code_hash=$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
          RETURNING id, member_id AS "memberId", merchant_id AS "merchantId"`, [hash]);
      record = rows[0] || null;
      if (!record) {
        const { rows: probe } = await this.base.pool.query('SELECT used_at AS "usedAt", revoked_at AS "revokedAt", expires_at AS "expiresAt" FROM team_activation_codes WHERE code_hash=$1', [hash]);
        throw describeCodeFailure(probe[0]);
      }
      const member = await this.getMember(record.memberId);
      if (!member || member.merchantId !== record.merchantId) throw fail('Ce code ne correspond à aucun membre de cette boutique.', 'CODE_INVALID', 400);
      if (['blocked', 'archived'].includes(member.status)) throw fail('Ce membre est bloqué ou archivé. Contactez votre marchand.', 'MEMBER_INACTIVE', 403);
      await this.base.pool.query(
        `UPDATE team_members SET password_hash=$2, status='active', activated_at=NOW(), token_version = token_version + 1, updated_at=NOW() WHERE id=$1`,
        [member.id, hashPassword(password)]);
      await this.recordActivity(member.merchantId, member.storeId, member.id, 'member_activated', `${member.designation || member.fullName} a activé son compte.`, 'success');
      return this.getMember(member.id);
    }
    const s = this.state();
    const row = s.teamActivationCodes.find((c) => c.codeHash === hash);
    if (!row) throw describeCodeFailure(null);
    if (row.usedAt) throw describeCodeFailure(row);
    if (row.revokedAt) throw describeCodeFailure(row);
    if (new Date(row.expiresAt).getTime() <= Date.now()) throw describeCodeFailure(row);
    const member = s.teamMembers.find((m) => m.id === row.memberId);
    if (!member) throw fail('Ce code ne correspond à aucun membre.', 'CODE_INVALID', 400);
    if (['blocked', 'archived'].includes(member.status)) throw fail('Ce membre est bloqué ou archivé. Contactez votre marchand.', 'MEMBER_INACTIVE', 403);
    row.usedAt = nowIso();
    Object.assign(member, { passwordHash: hashPassword(password), status: 'active', activatedAt: nowIso(), tokenVersion: Number(member.tokenVersion) + 1, updatedAt: nowIso() });
    await this.save();
    await this.recordActivity(member.merchantId, member.storeId, member.id, 'member_activated', `${member.designation || member.fullName} a activé son compte.`, 'success');
    return this.getMember(member.id);
  }

  // ------------------------------------------------------------------ authentification
  async authenticate(username, password) {
    const name = clean(username, 80);
    let member = null;
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id FROM team_members WHERE LOWER(username)=LOWER($1) AND status <> $2', [name, 'archived']);
      if (rows[0]) member = await this.getMember(rows[0].id);
    } else {
      const row = this.state().teamMembers.find((m) => m.status !== 'archived' && m.username.toLowerCase() === name.toLowerCase());
      member = row ? clone(row) : null;
    }
    if (!member || !member.passwordHash || !checkPassword(password, member.passwordHash)) return { error: 'Identifiant ou mot de passe incorrect.' };
    if (member.status === 'blocked') return { error: 'Votre accès a été bloqué par le marchand.', code: 'MEMBER_BLOCKED' };
    if (member.status === 'suspended') return { error: 'Votre compte est suspendu. Contactez votre marchand.', code: 'MEMBER_SUSPENDED' };
    if (member.status !== 'active') return { error: 'Ce compte n’est pas encore activé. Utilisez votre code d’activation.' , code: 'MEMBER_NOT_ACTIVE' };
    const settings = await this.getSettings(member.merchantId);
    if (settings.teamBlocked) return { error: 'Toute l’équipe est bloquée par le marchand.', code: 'TEAM_BLOCKED' };
    return { member };
  }

  async createSession(member) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 8 * 3600_000).toISOString();
    const id = uid('tms');
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO team_member_sessions (id, member_id, merchant_id, token_hash, token_version, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6)`, [id, member.id, member.merchantId, sha256(token), member.tokenVersion, expiresAt]);
      await this.base.pool.query('UPDATE team_members SET last_login_at=NOW() WHERE id=$1', [member.id]);
    } else {
      const s = this.state();
      s.teamMemberSessions.push({ id, memberId: member.id, merchantId: member.merchantId, tokenHash: sha256(token), tokenVersion: member.tokenVersion, expiresAt, createdAt: nowIso(), revokedAt: null });
      const row = s.teamMembers.find((m) => m.id === member.id); if (row) row.lastLoginAt = nowIso();
      await this.save();
    }
    await this.recordActivity(member.merchantId, member.storeId, member.id, 'login_success', `${member.designation || member.fullName} s’est connecté.`, 'success');
    return { token, expiresAt };
  }

  // Résolution de session : statut du membre, version de jeton, statut du marchand et blocage
  // d'équipe sont TOUS revérifiés à chaque requête. Un blocage coupe donc une session ouverte.
  async resolveSession(token) {
    if (!token) return null;
    const hash = sha256(token);
    let session = null;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, member_id AS "memberId", token_version AS "tokenVersion", expires_at AS "expiresAt", revoked_at AS "revokedAt"
           FROM team_member_sessions WHERE token_hash=$1`, [hash]);
      session = rows[0] || null;
    } else {
      session = this.state().teamMemberSessions.find((s) => s.tokenHash === hash) || null;
    }
    if (!session || session.revokedAt) return null;
    if (new Date(session.expiresAt).getTime() <= Date.now()) return null;
    const member = await this.getMember(session.memberId);
    if (!member || member.status !== 'active') return null;
    if (Number(member.tokenVersion) !== Number(session.tokenVersion)) return null;
    const settings = await this.getSettings(member.merchantId);
    if (settings.teamBlocked) return null;
    const merchant = await this.commerce.getMerchantForAuth(member.merchantId).catch(() => null);
    if (!merchant || merchant.status !== 'active' || merchant.deletedAt) return null;
    return member;
  }

  async revokeSessions(memberId) {
    if (this.pg) { await this.base.pool.query('UPDATE team_member_sessions SET revoked_at=NOW() WHERE member_id=$1 AND revoked_at IS NULL', [memberId]); return; }
    const s = this.state(); s.teamMemberSessions.filter((x) => x.memberId === memberId).forEach((x) => { x.revokedAt ||= nowIso(); }); await this.save();
  }

  async resetPassword(memberId, merchantId, newPassword) {
    const member = await this.getMember(memberId, merchantId);
    if (!member) throw fail('Membre introuvable dans cette boutique.', 'NOT_FOUND', 404);
    if (String(newPassword || '').length < 8) throw fail('Choisissez un mot de passe de 8 caractères minimum.', 'PASSWORD_WEAK', 400);
    if (this.pg) {
      await this.base.pool.query("UPDATE team_members SET password_hash=$2, must_change_password=TRUE, token_version=token_version+1, updated_at=NOW() WHERE id=$1", [memberId, hashPassword(newPassword)]);
      await this.base.pool.query('UPDATE team_member_sessions SET revoked_at=NOW() WHERE member_id=$1 AND revoked_at IS NULL', [memberId]);
    } else {
      const s = this.state();
      const row = s.teamMembers.find((m) => m.id === memberId);
      Object.assign(row, { passwordHash: hashPassword(newPassword), mustChangePassword: true, tokenVersion: Number(row.tokenVersion) + 1, updatedAt: nowIso() });
      s.teamMemberSessions.filter((x) => x.memberId === memberId).forEach((x) => { x.revokedAt ||= nowIso(); });
      await this.save();
    }
    await this.recordActivity(member.merchantId, member.storeId, memberId, 'password_reset_by_merchant', 'Mot de passe réinitialisé par le marchand.', 'success');
    return { ok: true };
  }

  // ------------------------------------------------------------------ tâches
  async createTask(merchantId, storeId, input = {}, actor = {}) {
    const title = clean(input.title, 160);
    if (title.length < 3) throw fail('Donnez un titre à la tâche (3 caractères minimum).');
    const memberId = clean(input.memberId, 60);
    if (memberId) {
      const member = await this.getMember(memberId, merchantId);
      if (!member) throw fail('Ce membre n’appartient pas à votre équipe.', 'MEMBER_NOT_OWNED', 403);
      if (member.status === 'archived') throw fail('Ce membre est archivé : impossible de lui attribuer une tâche.', 'MEMBER_ARCHIVED', 409);
    }
    const priority = ['low', 'normal', 'high', 'urgent'].includes(input.priority) ? input.priority : 'normal';
    const dueAt = input.dueAt ? new Date(input.dueAt) : null;
    if (input.dueAt && Number.isNaN(dueAt.getTime())) throw fail('L’échéance n’est pas une date valide.');
    const id = uid('tt');
    const row = { id, merchantId, storeId, memberId: memberId || null, title, description: clean(input.description, 1000),
      priority, status: 'todo', dueAt: dueAt ? dueAt.toISOString() : null,
      createdByType: clean(actor.type, 20) || 'merchant', createdById: clean(actor.id, 60), createdByLabel: clean(actor.label, 120),
      completedAt: null, createdAt: nowIso(), updatedAt: nowIso() };
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO team_tasks (id, merchant_id, store_id, member_id, title, description, priority, status, due_at, created_by_type, created_by_id, created_by_label, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'todo',$8,$9,$10,$11,NOW(),NOW())`,
        [id, merchantId, storeId, row.memberId, title, row.description, priority, row.dueAt, row.createdByType, row.createdById, row.createdByLabel]);
    } else {
      const s = this.state(); s.teamTasks.push(row); await this.save();
    }
    await this.addTaskEvent(id, { action: 'created', toStatus: 'todo', actor, note: title });
    if (memberId) await this.recordActivity(merchantId, storeId, memberId, 'task_assigned', `Tâche attribuée : ${title}`, 'success', { taskId: id });
    return this.getTask(id, merchantId);
  }

  async getTask(id, merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT t.id, t.merchant_id AS "merchantId", t.store_id AS "storeId", t.member_id AS "memberId", t.title, t.description,
                t.priority, t.status, t.due_at AS "dueAt", t.created_by_type AS "createdByType", t.created_by_label AS "createdByLabel",
                t.completed_at AS "completedAt", t.created_at AS "createdAt", t.updated_at AS "updatedAt", m.designation, m.full_name AS "fullName"
           FROM team_tasks t LEFT JOIN team_members m ON m.id = t.member_id WHERE t.id=$1 AND t.merchant_id=$2`, [id, merchantId]);
      return rows[0] || null;
    }
    const s = this.state();
    const row = s.teamTasks.find((t) => t.id === id && t.merchantId === merchantId);
    if (!row) return null;
    const member = s.teamMembers.find((m) => m.id === row.memberId);
    return { ...clone(row), designation: member?.designation || '', fullName: member?.fullName || '' };
  }

  async listTasks(merchantId, { memberId = '', status = '' } = {}) {
    if (this.pg) {
      const params = [merchantId]; const where = ['t.merchant_id=$1'];
      if (memberId) { params.push(memberId); where.push(`t.member_id=$${params.length}`); }
      if (status) { params.push(status); where.push(`t.status=$${params.length}`); }
      const { rows } = await this.base.pool.query(
        `SELECT t.id, t.member_id AS "memberId", t.title, t.description, t.priority, t.status, t.due_at AS "dueAt",
                t.created_by_label AS "createdByLabel", t.created_at AS "createdAt", m.designation, m.full_name AS "fullName"
           FROM team_tasks t LEFT JOIN team_members m ON m.id=t.member_id
          WHERE ${where.join(' AND ')} ORDER BY CASE t.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.created_at DESC LIMIT 200`, params);
      return rows;
    }
    const s = this.state();
    return s.teamTasks.filter((t) => t.merchantId === merchantId && (!memberId || t.memberId === memberId) && (!status || t.status === status))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 200)
      .map((t) => { const m = s.teamMembers.find((x) => x.id === t.memberId); return { ...clone(t), designation: m?.designation || '', fullName: m?.fullName || '' }; });
  }

  async updateTaskStatus(id, merchantId, status, actor = {}, note = '') {
    if (!['todo', 'in_progress', 'done', 'cancelled'].includes(status)) throw fail('Statut de tâche invalide.');
    const task = await this.getTask(id, merchantId);
    if (!task) throw fail('Tâche introuvable.', 'NOT_FOUND', 404);
    if (this.pg) {
      await this.base.pool.query(
        `UPDATE team_tasks SET status=$3, completed_at = CASE WHEN $3='done' THEN NOW() ELSE NULL END, updated_at=NOW() WHERE id=$1 AND merchant_id=$2`,
        [id, merchantId, status]);
    } else {
      const s = this.state(); const row = s.teamTasks.find((t) => t.id === id && t.merchantId === merchantId);
      Object.assign(row, { status, completedAt: status === 'done' ? nowIso() : null, updatedAt: nowIso() }); await this.save();
    }
    await this.addTaskEvent(id, { action: 'status_changed', fromStatus: task.status, toStatus: status, actor, note });
    return this.getTask(id, merchantId);
  }

  async addTaskEvent(taskId, { action, fromStatus = '', toStatus = '', actor = {}, note = '' }) {
    const row = { id: uid('tte'), taskId, action, fromStatus, toStatus, actorType: clean(actor.type, 20) || 'system',
      actorId: clean(actor.id, 60), actorLabel: clean(actor.label, 120), note: clean(note, 300), createdAt: nowIso() };
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO team_task_events (id, task_id, action, from_status, to_status, actor_type, actor_id, actor_label, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [row.id, taskId, action, fromStatus, toStatus, row.actorType, row.actorId, row.actorLabel, row.note]);
      return row;
    }
    const s = this.state(); s.teamTaskEvents.push(row); await this.save(); return row;
  }

  async listTaskEvents(taskId, merchantId) {
    const task = await this.getTask(taskId, merchantId);
    if (!task) throw fail('Tâche introuvable.', 'NOT_FOUND', 404);
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT action, from_status AS "fromStatus", to_status AS "toStatus", actor_label AS "actorLabel", note, created_at AS "createdAt"
           FROM team_task_events WHERE task_id=$1 ORDER BY created_at`, [taskId]);
      return rows;
    }
    return clone(this.state().teamTaskEvents.filter((e) => e.taskId === taskId));
  }

  // ------------------------------------------------------------------ activité et points
  async recordActivity(merchantId, storeId, memberId, action, summary, result = 'success', metadata = {}) {
    const row = { id: uid('tae'), merchantId, storeId, memberId: memberId || null, action: clean(action, 40),
      summary: clean(summary, 300), result, metadata, ip: clean(metadata.ip, 60) || '', createdAt: nowIso() };
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO team_activity_events (id, merchant_id, store_id, member_id, action, summary, result, metadata, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)`,
        [row.id, merchantId, storeId, row.memberId, row.action, row.summary, result, JSON.stringify(metadata || {}), row.ip]);
      return row;
    }
    const s = this.state(); s.teamActivityEvents.push(row); await this.save(); return row;
  }

  async listActivity(merchantId, { memberId = '', limit = 100 } = {}) {
    if (this.pg) {
      const params = [merchantId]; let where = 'merchant_id=$1';
      if (memberId) { params.push(memberId); where += ` AND member_id=$${params.length}`; }
      params.push(Math.min(Number(limit) || 100, 500));
      const { rows } = await this.base.pool.query(
        `SELECT a.id, a.member_id AS "memberId", a.action, a.summary, a.result, a.metadata, a.created_at AS "createdAt", m.designation
           FROM team_activity_events a LEFT JOIN team_members m ON m.id=a.member_id
          WHERE a.${where} ORDER BY a.created_at DESC LIMIT $${params.length}`, params);
      return rows;
    }
    const s = this.state();
    return s.teamActivityEvents.filter((e) => e.merchantId === merchantId && (!memberId || e.memberId === memberId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, Math.min(Number(limit) || 100, 500)).map(clone);
  }

  async addPoints(memberId, points, reason) {
    const safe = Math.max(0, Math.round(Number(points) || 0));
    if (!safe) return null;
    if (this.pg) {
      const { rows } = await this.base.pool.query('UPDATE team_members SET points = points + $2, updated_at=NOW() WHERE id=$1 RETURNING points', [memberId, safe]);
      return rows[0]?.points ?? null;
    }
    const s = this.state(); const row = s.teamMembers.find((m) => m.id === memberId);
    if (!row) return null; row.points = Number(row.points || 0) + safe; await this.save(); return row.points;
  }
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function describeCodeFailure(row) {
  if (!row) return fail('Ce code d’activation n’existe pas. Vérifiez les caractères saisis.', 'CODE_INVALID', 404);
  if (row.usedAt) return fail('Ce code a déjà été utilisé. Demandez un nouveau code à votre marchand.', 'CODE_USED', 409);
  if (row.revokedAt) return fail('Ce code a été révoqué par le marchand.', 'CODE_REVOKED', 409);
  if (new Date(row.expiresAt).getTime() <= Date.now()) return fail('Ce code a expiré. Demandez un nouveau code à votre marchand.', 'CODE_EXPIRED', 410);
  return fail('Ce code est inutilisable.', 'CODE_INVALID', 400);
}

function publicMember(row) {
  if (!row) return null;
  return {
    id: row.id, merchantId: row.merchantId, storeId: row.storeId, role: row.role, designation: row.designation,
    fullName: row.fullName, phone: row.phone, username: row.username, permissions: row.permissions || [],
    status: row.status, statusReason: row.statusReason || '', points: Number(row.points) || 0,
    mustChangePassword: row.mustChangePassword === true,
    activatedAt: row.activatedAt || null, lastLoginAt: row.lastLoginAt || null, createdAt: row.createdAt || null,
  };
}

module.exports = { TeamStore, publicMember, hashPassword, checkPassword, DEFAULT_SETTINGS, fail };
