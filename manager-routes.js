'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const DEFAULT_ALERTS = Object.freeze({
  loginFailures: true,
  loginSuccesses: false,
  statusChanges: true,
  qrChanges: true,
  authorizationDenials: true,
  accountChanges: true,
});
const STATUS_VALUES = new Set(['active', 'suspended', 'blocked']);
const ACTION_VALUES = new Set(['login_success', 'login_failure', 'logout', 'password_reset', 'password_change', 'session_revoked', 'custom_domain_change', 'action_failure', 'create', 'update', 'delete', 'activate', 'deactivate', 'block', 'unblock', 'suspend', 'reactivate', 'status_change', 'authorization_denied', 'view', 'stats_view', 'download_png', 'download_svg', 'share', 'print', 'assignment', 'request_validation', 'manager_message', 'reject']);
const ENTITY_VALUES = new Set(['manager', 'qr_code', 'beneficiary', 'authentication', 'admin_api', 'statistics', 'manager_notification']);
const DUMMY_SALT = Buffer.from('qria-manager-login-dummy-salt');
const DUMMY_HASH = crypto.scryptSync('qria-no-account-password', DUMMY_SALT, 64);
function ttlMs(testEnvName, productionDefault) {
  const testValue = process.env.NODE_ENV === 'test' ? Number(process.env[testEnvName]) : NaN;
  return Number.isSafeInteger(testValue) && testValue >= 100 ? Math.min(testValue, productionDefault) : productionDefault;
}
const TEMPORARY_PASSWORD_TTL_MS = ttlMs('QRIA_TEST_TEMP_PASSWORD_TTL_MS', 24 * 60 * 60 * 1000);
const RESET_LINK_TTL_MS = ttlMs('QRIA_TEST_RESET_LINK_TTL_MS', 30 * 60 * 1000);
const STEP_UP_WINDOW_MS = 15 * 60 * 1000;

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
function checkPassword(password, stored) {
  const [algorithm, saltText, digestText] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !digestText) {
    crypto.scryptSync(password, DUMMY_SALT, 64);
    return false;
  }
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(digestText, 'base64url');
    const actual = crypto.scryptSync(password, salt, expected.length || 64);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
function hashResetToken(token) { return crypto.createHash('sha256').update(String(token)).digest('base64url'); }
function normalizeCustomDomain(value, reservedDomain = '') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch (_) { throw new Error('Le sous-domaine doit être un nom d’hôte valide, sans chemin.'); }
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const labels = hostname.split('.');
  const validLabels = labels.every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label));
  const reservedHostnames = [reservedDomain, 'https://manager.oymiketech.com'].filter(Boolean).map((domain) => {
    try { return new URL(String(domain)).hostname.toLowerCase().replace(/\.$/, ''); }
    catch (_) { return String(domain).trim().toLowerCase().replace(/\.$/, ''); }
  });
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.pathname !== '/' || parsed.search || parsed.hash ||
    hostname.length > 253 || labels.length < 3 || !validLabels || net.isIP(hostname) || reservedHostnames.includes(hostname)) {
    throw new Error('Saisissez un sous-domaine HTTPS dédié (ex. qr-rakesh.oymiketech.com), différent des domaines publics QRia.');
  }
  return hostname;
}
function safeManager(manager, withAuth = false, withAvatar = false) {
  if (!manager) return null;
  const data = {
    id: manager.id, username: manager.username, displayName: manager.displayName,
    email: manager.email || '', phone: manager.phone || '', customDomain: manager.customDomain || '', status: manager.status, statusReason: manager.statusReason || '',
    createdAt: manager.createdAt, updatedAt: manager.updatedAt, lastLoginAt: manager.lastLoginAt || null,
    mustChangePassword: Boolean(manager.mustChangePassword), passwordResetExpiresAt: manager.passwordResetExpiresAt || null,
    deletedAt: manager.deletedAt || null, hasAvatar: Boolean(manager.avatarData),
    canCreateCodes: manager.canCreateCodes !== false, canEditCodes: manager.canEditCodes !== false,
    canSelfActivateCodes: manager.canSelfActivateCodes === true, qrLimit: Math.max(0, Number(manager.qrLimit) || 0),
    notificationPreferences: { codeUpdates: true, validationResults: true, suspensions: true, pdgMessages: true, securityAlerts: true, ...(manager.notificationPreferences || {}) },
    installPath: manager.installToken ? `/manager/install/${manager.installToken}` : '',
  };
  if (withAuth) data.sessionVersion = manager.tokenVersion;
  if (withAvatar) data.avatarData = manager.avatarData || '';
  return data;
}
function normalizeManagerInput(input, { allowPassword = false, customDomainFallback = '', reservedDomain = '' } = {}) {
  const username = String(input?.username || '').trim().toLowerCase();
  const displayName = String(input?.displayName || '').trim().slice(0, 120);
  const email = String(input?.email || '').trim().slice(0, 254);
  const phone = String(input?.phone || '').trim().slice(0, 32);
  const customDomain = normalizeCustomDomain(input?.customDomain ?? customDomainFallback, reservedDomain);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) throw new Error('L’identifiant doit contenir 3 à 80 caractères (lettres, chiffres, point, tiret ou soulignement).');
  if (!displayName) throw new Error('Le nom du gestionnaire est obligatoire.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail n’est pas valide.');
  if (phone && (!/^[0-9+().\s-]{7,32}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw new Error('Le numéro de téléphone n’est pas valide.');
  const canCreateCodes = input?.canCreateCodes === undefined ? true : input.canCreateCodes;
  const canEditCodes = input?.canEditCodes === undefined ? true : input.canEditCodes;
  const canSelfActivateCodes = input?.canSelfActivateCodes === undefined ? false : input.canSelfActivateCodes;
  const qrLimit = input?.qrLimit === undefined ? 0 : Number(input.qrLimit);
  if (typeof canCreateCodes !== 'boolean' || typeof canEditCodes !== 'boolean' || typeof canSelfActivateCodes !== 'boolean') throw new Error('Les permissions QR doivent être définies avec des choix valides.');
  if (!Number.isSafeInteger(qrLimit) || qrLimit < 0 || qrLimit > 100000) throw new Error('La limite doit être un nombre entier entre 0 et 100000 (0 = illimitée).');
  const result = { username, displayName, email, phone, customDomain, canCreateCodes, canEditCodes, canSelfActivateCodes, qrLimit };
  if (allowPassword) {
    const password = String(input?.password || '');
    if (password.length < 12 || password.length > 128) throw new Error('Le mot de passe doit contenir entre 12 et 128 caractères.');
    result.passwordHash = hashPassword(password);
  }
  return result;
}
function normalizeAvatarData(value) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length > 500_000) throw new Error('La photo doit faire au maximum 350 Ko après recadrage.');
  const match = raw.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
  if (!match) throw new Error('La photo doit être au format JPG, PNG ou WebP.');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 350 * 1024) throw new Error('La photo doit faire au maximum 350 Ko après recadrage.');
  const mime = match[1].toLowerCase();
  const valid = mime === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : mime === 'png' ? bytes.length > 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      : bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error('Le contenu du fichier ne correspond pas à son format image.');
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}
function managerAudit(manager, action, entityType, entityId, summary, extras = {}) {
  return {
    actor: manager ? `${manager.displayName} (@${manager.username})` : 'Identifiant gestionnaire inconnu',
    actorType: manager ? 'manager' : 'anonymous', actorId: manager?.id || null,
    managerId: manager?.id || null, action, entityType, entityId: String(entityId || 'unknown'),
    summary, result: extras.result || 'success', beforeData: extras.beforeData || null,
    afterData: extras.afterData || null, metadata: extras.metadata || null,
  };
}
function adminAudit(action, entityType, entityId, summary, extras = {}) {
  const adminId = String(process.env.ADMIN_USERNAME || 'admin');
  return {
    actor: `PDG (@${adminId})`, actorType: 'admin', actorId: adminId, managerId: extras.managerId || null,
    action, entityType, entityId: String(entityId || 'unknown'), summary,
    result: extras.result || 'success', beforeData: extras.beforeData || null,
    afterData: extras.afterData || null, metadata: extras.metadata || null,
  };
}
function parseDate(value, endOfDay = false) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw) && Number.isNaN(Date.parse(raw))) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}Z`;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
}
function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function csvForActivities(rows) {
  const headers = ['date_utc', 'gestionnaire', 'identifiant', 'action', 'entite', 'id_entite', 'resultat', 'resume', 'avant', 'apres'];
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push([
    row.createdAt, row.actor, row.managerId || row.actorId || '', row.action, row.entityType,
    row.entityId, row.result, row.summary, row.beforeData || '', row.afterData || '',
  ].map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}

module.exports = function registerManagerRoutes(deps) {
  const {
    app, store, finance, requireAdmin, requireManager, checkSameOrigin, verifyAdminPassword, publicBaseUrl,
    setManagerSession, clearManagerSession, validateBeneficiary, validateQr,
    makeAudit, publicSnapshot, beneficiarySnapshot, apiError,
  } = deps;
  const loginAttempts = new Map();
  const stepUpFailures = new Map();

  const writeAudit = async (event) => store.addAudit(event);
  async function notifyManager(managerId, { type, title, body = '', entityType = '', entityId = '' }) {
    if (!managerId) return null;
    const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
    if (!manager || manager.deletedAt) return null;
    const prefs = { codeUpdates: true, validationResults: true, suspensions: true, pdgMessages: true, securityAlerts: true, ...(manager.notificationPreferences || {}) };
    const preferenceByType = { code_approved: 'validationResults', code_rejected: 'validationResults', code_suspended: 'suspensions', account_status: 'securityAlerts' };
    const preference = preferenceByType[type];
    if (preference && prefs[preference] === false) return null;
    return store.createManagerNotification({ managerId, type, title, body, entityType, entityId });
  }
  async function auditManagerFailure(req, entityType, entityId, summary) {
    await writeAudit(managerAudit(req.manager, 'action_failure', entityType, entityId || 'unknown', summary, { result: 'failure' }))
      .catch((error) => console.error('Audit failed operation failed:', error?.message || 'unknown error'));
  }
  const snapshotManager = (manager) => manager ? ({
    id: manager.id, username: manager.username, displayName: manager.displayName,
    hasEmail: Boolean(manager.email), hasPhone: Boolean(manager.phone), status: manager.status, statusReason: manager.statusReason || '',
    mustChangePassword: Boolean(manager.mustChangePassword), deletedAt: manager.deletedAt || null, hasAvatar: Boolean(manager.avatarData),
    customDomain: manager.customDomain || '', canCreateCodes: manager.canCreateCodes !== false, canEditCodes: manager.canEditCodes !== false,
    canSelfActivateCodes: manager.canSelfActivateCodes === true, qrLimit: Math.max(0, Number(manager.qrLimit) || 0),
    notificationPreferences: manager.notificationPreferences || {},
  }) : null;
  async function requireManagerAdminConfirmation(req, res, manager, action) {
    const targetUsername = String(req.body?.confirmUsername || '').trim().toLowerCase();
    if (!targetUsername || targetUsername !== String(manager.username || '').toLowerCase()) {
      await writeAudit(adminAudit(action, 'manager', manager.id, `Action de sécurité refusée pour « ${manager.displayName} » : confirmation du compte incorrecte.`, {
        managerId: manager.id, result: 'failure', metadata: { reason: 'target_confirmation_mismatch' },
      })).catch(() => {});
      res.status(400).json({ error: 'Saisissez exactement l’identifiant du gestionnaire concerné pour confirmer.' });
      return false;
    }
    const now = Date.now(); const key = req.ip || 'unknown'; const current = stepUpFailures.get(key);
    if (current && now - current.start < STEP_UP_WINDOW_MS && current.count >= 5) {
      await writeAudit(adminAudit(action, 'manager', manager.id, `Action de sécurité limitée pour « ${manager.displayName} » : trop de tentatives de vérification PDG.`, {
        managerId: manager.id, result: 'failure', metadata: { reason: 'step_up_rate_limited' },
      })).catch(() => {});
      res.status(429).json({ error: 'Trop de vérifications échouées. Réessayez dans 15 minutes.' });
      return false;
    }
    const valid = typeof verifyAdminPassword === 'function' && verifyAdminPassword(req.body?.adminPassword);
    if (!valid) {
      const next = !current || now - current.start >= STEP_UP_WINDOW_MS ? { start: now, count: 1 } : { ...current, count: current.count + 1 };
      stepUpFailures.set(key, next);
      await writeAudit(adminAudit(action, 'manager', manager.id, `Action de sécurité refusée pour « ${manager.displayName} » : réauthentification PDG échouée.`, {
        managerId: manager.id, result: 'failure', metadata: { reason: 'admin_reauthentication_failed' },
      })).catch(() => {});
      res.status(403).json({ error: 'Vérification du mot de passe PDG échouée.' });
      return false;
    }
    stepUpFailures.delete(key);
    return true;
  }
  const canReachBeneficiary = (managerId, beneficiaryId) => store.canManagerAccessBeneficiary(managerId, beneficiaryId);
  async function denyManager(req, res, { entityType = 'authorization', entityId = '', summary = 'Accès refusé à une ressource non autorisée.' } = {}) {
    const manager = req.manager;
    await writeAudit(managerAudit(manager, 'authorization_denied', ENTITY_VALUES.has(entityType) ? entityType : 'authentication', entityId || req.path,
      summary, { result: 'denied', metadata: { method: req.method, route: req.path } })).catch((error) => console.error('Audit authorization denial failed:', error));
    return res.status(403).json({ error: 'Accès refusé : cette ressource n’est pas autorisée pour votre compte.' });
  }
  async function managerCode(req, res, codeId) {
    const code = await store.getCode(codeId);
    if (!code || code.deletedAt) { res.status(404).json({ error: 'QR code introuvable.' }); return null; }
    if (!(await store.canManagerAccessCode(req.manager.id, codeId))) {
      await denyManager(req, res, { entityType: 'qr_code', entityId: codeId, summary: 'Tentative d’accès à un QR code non attribué.' });
      return null;
    }
    return code;
  }
  async function managerBeneficiary(req, res, beneficiaryId) {
    const beneficiary = await store.getBeneficiary(beneficiaryId);
    if (!beneficiary) { res.status(404).json({ error: 'Bénéficiaire introuvable.' }); return null; }
    if (!(await canReachBeneficiary(req.manager.id, beneficiaryId))) {
      await denyManager(req, res, { entityType: 'beneficiary', entityId: beneficiaryId, summary: 'Tentative d’accès à un bénéficiaire non attribué.' });
      return null;
    }
    return beneficiary;
  }

  async function managerMayMutateBeneficiary(req, res, beneficiaryId) {
    if (await store.canManagerMutateBeneficiary(req.manager.id, beneficiaryId)) return true;
    await denyManager(req, res, { entityType: 'beneficiary', entityId: beneficiaryId, summary: 'Modification refusée : au moins un QR du bénéficiaire n’est pas attribué à ce gestionnaire.' });
    return false;
  }
  async function alertEvents() {
    const settings = await store.getSettings();
    const config = { ...DEFAULT_ALERTS, ...(settings.managerActivityAlerts || {}) };
    const result = await store.listManagerActivities({ page: 1, limit: 250 });
    const rows = result.data.filter((row) => {
      if (config.loginFailures && row.action === 'login_failure') return true;
      if (config.loginSuccesses && ['login_success', 'logout'].includes(row.action)) return true;
      if (config.statusChanges && ['status_change', 'suspend', 'block', 'unblock', 'reactivate'].includes(row.action)) return true;
      if (config.authorizationDenials && row.action === 'authorization_denied') return true;
      if (config.accountChanges && row.entityType === 'manager' && !['login_success', 'logout', 'login_failure'].includes(row.action)) return true;
      if (config.qrChanges && row.entityType === 'qr_code' && ['create', 'update', 'delete', 'activate', 'deactivate', 'assignment', 'action_failure'].includes(row.action)) return true;
      return false;
    });
    return { settings: config, data: rows.slice(0, 30), total: rows.length };
  }

  // CEO-only manager account administration.
  app.get('/api/admin/managers', requireAdmin, async (_req, res) => {
    try {
      res.json({ data: await store.listManagers({ includeDeleted: true }) });
    } catch (error) { apiError(res, error, 'Impossible de charger les gestionnaires.'); }
  });
  app.get('/api/admin/managers/:id', requireAdmin, async (req, res) => {
    try {
      const manager = await store.getManager(req.params.id, { includeDeleted: true });
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      res.json({ data: { ...safeManager(manager), avatarData: manager.avatarData || '' } });
    } catch (error) { apiError(res, error, 'Impossible de charger ce profil gestionnaire.'); }
  });
  app.post('/api/admin/managers', requireAdmin, async (req, res) => {
    try {
      const input = normalizeManagerInput(req.body, { allowPassword: true, reservedDomain: publicBaseUrl });
      input.avatarData = normalizeAvatarData(req.body?.avatarData);
      input.installToken = crypto.randomBytes(24).toString('base64url');
      const manager = await store.createManager(input);
      const safe = safeManager(manager);
      await writeAudit(adminAudit('create', 'manager', manager.id, `Compte gestionnaire « ${manager.displayName} » créé.`, { managerId: manager.id, afterData: snapshotManager(manager) }));
      res.status(201).json({ data: safe });
    } catch (error) {
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      apiError(res, error, 'Impossible de créer le compte gestionnaire.');
    }
  });
  app.put('/api/admin/managers/:id', requireAdmin, async (req, res) => {
    try {
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const input = normalizeManagerInput({ ...(req.body || {}),
        canCreateCodes: Object.hasOwn(req.body || {}, 'canCreateCodes') ? req.body.canCreateCodes : before.canCreateCodes !== false,
        canEditCodes: Object.hasOwn(req.body || {}, 'canEditCodes') ? req.body.canEditCodes : before.canEditCodes !== false,
        canSelfActivateCodes: Object.hasOwn(req.body || {}, 'canSelfActivateCodes') ? req.body.canSelfActivateCodes : before.canSelfActivateCodes === true,
        qrLimit: Object.hasOwn(req.body || {}, 'qrLimit') ? req.body.qrLimit : (Number(before.qrLimit) || 0),
      }, { customDomainFallback: before.customDomain || '', reservedDomain: publicBaseUrl });
      const domainChanged = input.customDomain !== String(before.customDomain || '').trim().toLowerCase();
      if (domainChanged && !await requireManagerAdminConfirmation(req, res, before, 'custom_domain_change')) return;
      let manager = await store.updateManager(req.params.id, input);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      if (Object.prototype.hasOwnProperty.call(req.body || {}, 'avatarData')) {
        const avatarData = normalizeAvatarData(req.body.avatarData);
        manager = await store.updateManagerAvatar(req.params.id, avatarData) || manager;
      }
      const auditAction = domainChanged ? 'custom_domain_change' : 'update';
      const auditSummary = domainChanged
        ? `Association de sous-domaine de « ${manager.displayName} » modifiée; ses sessions précédentes ont été invalidées.`
        : `Profil du gestionnaire « ${manager.displayName} » modifié; ses sessions précédentes ont été invalidées.`;
      await writeAudit(adminAudit(auditAction, 'manager', manager.id, auditSummary, {
        managerId: manager.id, beforeData: snapshotManager(before), afterData: snapshotManager(manager),
      }));
      res.json({ data: safeManager(manager) });
    } catch (error) {
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      apiError(res, error, 'Impossible de modifier le compte gestionnaire.');
    }
  });
  app.post('/api/admin/managers/:id/reset-password', requireAdmin, async (req, res) => {
    try {
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      if (!await requireManagerAdminConfirmation(req, res, before, 'password_reset')) return;
      const method = String(req.body?.method || 'temporary');
      if (!['temporary', 'link'].includes(method)) return res.status(400).json({ error: 'Choisissez un mot de passe temporaire ou un lien de réinitialisation.' });
      const expiresAt = new Date(Date.now() + (method === 'temporary' ? TEMPORARY_PASSWORD_TTL_MS : RESET_LINK_TTL_MS)).toISOString();
      if (method === 'temporary') {
        const temporaryPassword = crypto.randomBytes(24).toString('base64url');
        const manager = await store.setManagerTemporaryPassword(req.params.id, hashPassword(temporaryPassword), expiresAt);
        if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
        await writeAudit(adminAudit('password_reset', 'manager', manager.id, `Mot de passe temporaire émis pour « ${manager.displayName} »; le changement est obligatoire et toutes les sessions sont révoquées.`, {
          managerId: manager.id, beforeData: { mustChangePassword: Boolean(before.mustChangePassword) },
          afterData: { mustChangePassword: true, expiresAt }, metadata: { method, ttlHours: 24, sessionsRevoked: true },
        }));
        return res.json({ ok: true, method, temporaryPassword, expiresAt, data: safeManager(manager) });
      }
      const token = crypto.randomBytes(32).toString('base64url');
      const discardedPassword = crypto.randomBytes(32).toString('base64url');
      const manager = await store.setManagerPasswordResetLink(req.params.id, hashPassword(discardedPassword), hashResetToken(token), expiresAt);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      await writeAudit(adminAudit('password_reset', 'manager', manager.id, `Lien sécurisé de réinitialisation émis pour « ${manager.displayName} »; toutes les sessions sont révoquées.`, {
        managerId: manager.id, beforeData: { mustChangePassword: Boolean(before.mustChangePassword) },
        afterData: { mustChangePassword: true, expiresAt }, metadata: { method, ttlMinutes: 30, sessionsRevoked: true },
      }));
      res.json({ ok: true, method, resetPath: `/manager/reset-password#token=${token}`, expiresAt, data: safeManager(manager) });
    } catch (error) { apiError(res, error, 'Impossible de réinitialiser le mot de passe.'); }
  });
  app.post('/api/admin/managers/:id/revoke-sessions', requireAdmin, async (req, res) => {
    try {
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      if (!await requireManagerAdminConfirmation(req, res, before, 'session_revoked')) return;
      const manager = await store.invalidateManagerSessions(req.params.id);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      await writeAudit(adminAudit('session_revoked', 'manager', manager.id, `Toutes les sessions de « ${manager.displayName} » ont été révoquées par le PDG.`, {
        managerId: manager.id, beforeData: { lastLoginAt: before.lastLoginAt || null }, afterData: { allSessionsRevoked: true },
      }));
      res.json({ ok: true, data: safeManager(manager) });
    } catch (error) { apiError(res, error, 'Impossible de révoquer les sessions du gestionnaire.'); }
  });
  app.post('/api/admin/managers/:id/messages', requireAdmin, async (req, res) => {
    try {
      const manager = await store.getManager(req.params.id);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const title = String(req.body?.title || '').trim().slice(0, 160);
      const body = String(req.body?.body || '').trim().slice(0, 2000);
      if (!title || !body) return res.status(400).json({ error: 'Le titre et le message sont obligatoires.' });
      if (String(req.body?.body || '').trim().length > 2000) return res.status(400).json({ error: 'Le message ne doit pas dépasser 2000 caractères.' });
      const notification = await store.createManagerNotification({ managerId: manager.id, type: 'pdg_message', title, body, entityType: 'manager', entityId: manager.id });
      await writeAudit(adminAudit('manager_message', 'manager_notification', notification.id, `Message du PDG envoyé à « ${manager.displayName} »; contenu ${body.length} caractères.`, {
        managerId: manager.id, afterData: { id: notification.id, type: notification.type, title: notification.title, bodyLength: body.length },
      }));
      res.status(201).json({ data: { id: notification.id, createdAt: notification.createdAt } });
    } catch (error) { apiError(res, error, 'Impossible d’envoyer le message au gestionnaire.'); }
  });
  app.patch('/api/admin/managers/:id/status', requireAdmin, async (req, res) => {
    try {
      const status = String(req.body?.status || '');
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      if (!STATUS_VALUES.has(status)) return res.status(400).json({ error: 'Choisissez un statut actif, suspendu ou bloqué.' });
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      if (!await requireManagerAdminConfirmation(req, res, before, 'status_change')) return;
      const manager = await store.setManagerStatus(req.params.id, status, reason);
      const action = status === 'active' ? 'reactivate' : status === 'suspended' ? 'suspend' : 'block';
      const label = { active: 'réactivé', suspended: 'suspendu', blocked: 'bloqué' }[status];
      await writeAudit(adminAudit(action, 'manager', manager.id, `Compte « ${manager.displayName} » ${label}; toutes les sessions précédentes ont été invalidées.`, {
        managerId: manager.id, beforeData: snapshotManager(before), afterData: snapshotManager(manager), metadata: { reason: reason || null },
      }));
      await notifyManager(manager.id, { type: 'account_status', title: `Compte ${label}`, body: reason || `Le PDG a ${label} votre compte.`, entityType: 'manager', entityId: manager.id });
      res.json({ data: safeManager(manager) });
    } catch (error) { apiError(res, error, 'Impossible de changer le statut du gestionnaire.'); }
  });
  app.delete('/api/admin/managers/:id', requireAdmin, async (req, res) => {
    try {
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      if (!await requireManagerAdminConfirmation(req, res, before, 'delete')) return;
      const manager = await store.deleteManager(req.params.id);
      await writeAudit(adminAudit('delete', 'manager', manager.id, `Compte gestionnaire « ${before.displayName} » supprimé logiquement; QR et journal conservés.`, {
        managerId: manager.id, beforeData: snapshotManager(before), afterData: { id: manager.id, deleted: true, status: 'blocked' },
      }));
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de supprimer le compte gestionnaire.'); }
  });

  app.patch('/api/admin/codes/:id/assignment', requireAdmin, async (req, res) => {
    try {
      const before = await store.getCode(req.params.id);
      if (!before || before.deletedAt) return res.status(404).json({ error: 'QR code introuvable.' });
      const managerId = String(req.body?.managerId || '').trim();
      if (managerId && !(await store.getManager(managerId))) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const code = await store.assignCodeToManager(req.params.id, managerId || null);
      const manager = managerId ? await store.getManager(managerId) : null;
      await writeAudit(adminAudit('assignment', 'qr_code', code.id,
        manager ? `QR « ${code.name} » attribué à « ${manager.displayName} ».` : `QR « ${code.name} » retiré de l’espace gestionnaire.`, {
          managerId: managerId || before.managerId || null,
          beforeData: { id: before.id, managerId: before.managerId || null }, afterData: { id: code.id, managerId: managerId || null },
        }));
      res.json({ data: code });
    } catch (error) {
      if (error.code === 'MANAGER_NOT_ACTIVE') return res.status(409).json({ error: error.message });
      apiError(res, error, 'Impossible de réattribuer le QR code.');
    }
  });

  // Manager activity journal, in-dashboard alerts and export (CEO permissions only).
  function activityFilters(query) {
    const managerId = String(query.managerId || '').slice(0, 100);
    const action = ACTION_VALUES.has(String(query.action || '')) ? String(query.action) : '';
    const result = ['success', 'denied', 'failure'].includes(String(query.result || '')) ? String(query.result) : '';
    const entityType = ENTITY_VALUES.has(String(query.entityType || '')) ? String(query.entityType) : '';
    return {
      managerId, action, result, entityType,
      search: String(query.search || '').trim().slice(0, 160),
      since: parseDate(query.since), until: parseDate(query.until, true),
    };
  }
  app.get('/api/admin/manager-activities', requireAdmin, async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
      res.json(await store.listManagerActivities({ ...activityFilters(req.query), page, limit }));
    } catch (error) { apiError(res, error, 'Impossible de charger le journal des gestionnaires.'); }
  });
  app.get('/api/admin/manager-activities/export.csv', requireAdmin, async (req, res) => {
    try {
      const rows = await store.listManagerActivities({ ...activityFilters(req.query), page: 1, limit: 10000 });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="qria-activites-gestionnaires.csv"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(csvForActivities(rows.data));
    } catch (error) { apiError(res, error, 'Impossible d’exporter les activités des gestionnaires.'); }
  });
  app.get('/api/admin/manager-activity-settings', requireAdmin, async (_req, res) => {
    try {
      const settings = await store.getSettings();
      res.json({ data: { ...DEFAULT_ALERTS, ...(settings.managerActivityAlerts || {}) } });
    } catch (error) { apiError(res, error, 'Impossible de charger les alertes.'); }
  });
  app.put('/api/admin/manager-activity-settings', requireAdmin, async (req, res) => {
    try {
      const alerts = {};
      for (const key of Object.keys(DEFAULT_ALERTS)) {
        if (typeof req.body?.[key] !== 'boolean') return res.status(400).json({ error: 'La configuration d’alerte est invalide.' });
        alerts[key] = req.body[key];
      }
      const before = (await store.getSettings()).managerActivityAlerts || DEFAULT_ALERTS;
      await store.updateSettings({ managerActivityAlerts: alerts });
      await writeAudit(adminAudit('update', 'settings', 'manager-activity-alerts', 'Configuration des alertes d’activité des gestionnaires modifiée.', { beforeData: before, afterData: alerts }));
      res.json({ data: alerts });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer les alertes.'); }
  });
  app.get('/api/admin/manager-alerts', requireAdmin, async (_req, res) => {
    try { res.json(await alertEvents()); }
    catch (error) { apiError(res, error, 'Impossible de charger les alertes des gestionnaires.'); }
  });

  // Install URLs disclose only the manager's display name and logo; they never authenticate a user.
  function installToken(req) { return /^[A-Za-z0-9_-]{32,64}$/.test(String(req.params.token || '')); }
  async function publicInstallManager(req, res, next) {
    if (!installToken(req)) return res.status(404).json({ error: 'Lien d’installation introuvable.' });
    const manager = await store.getManagerByInstallToken(req.params.token).catch(() => null);
    if (!manager) return res.status(404).json({ error: 'Lien d’installation introuvable.' });
    req.installManager = manager;
    next();
  }
  app.get('/manager/install/:token', publicInstallManager, async (req, res, next) => {
    try {
      const token = encodeURIComponent(req.params.token);
      const prefix = `/api/manager/install/${token}`;
      const html = await require('node:fs/promises').readFile(require('node:path').join(__dirname, 'public', 'manager.html'), 'utf8');
      const branded = html.replace('href="data:application/manifest+json,%7B%7D"', `href="${prefix}/manifest.webmanifest"`);
      res.setHeader('Cache-Control', 'no-store');
      res.type('html').send(branded);
    } catch (error) { next(error); }
  });
  app.get('/api/manager/install/:token', publicInstallManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ name: req.installManager.displayName, iconUrl: `/api/manager/install/${req.params.token}/icon`, manifestUrl: `/api/manager/install/${req.params.token}/manifest.webmanifest` });
  });
  app.get('/api/manager/install/:token/manifest.webmanifest', publicInstallManager, (req, res) => {
    const token = req.params.token;
    const icons = [
      { src: '/icons/qria-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/qria-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/qria-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ];
    res.setHeader('Cache-Control', 'no-store');
    res.type('application/manifest+json').send(JSON.stringify({
      id: `/manager/install/${token}`, name: `QRia — ${req.installManager.displayName}`, short_name: req.installManager.displayName.slice(0, 20),
      description: `Espace QRia personnel de ${req.installManager.displayName}.`, start_url: `/manager/install/${token}`, scope: '/manager',
      display: 'standalone', background_color: '#F3F3F3', theme_color: '#111111',
      prefer_related_applications: false,
      related_applications: [{ platform: 'webapp', id: `/manager/install/${token}` }],
      icons,
    }));
  });
  app.get('/api/manager/install/:token/icon', publicInstallManager, (req, res) => {
    res.setHeader('Cache-Control', 'no-store, max-age=0');
    res.type('image/png').sendFile(require('node:path').join(__dirname, 'public', 'icons', 'qria-512.png'));
  });

  // The reset form is public, but changing a password still requires a valid one-time token.
  app.get('/manager/reset-password', async (_req, res, next) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const html = await require('node:fs/promises').readFile(require('node:path').join(__dirname, 'public', 'manager.html'), 'utf8');
      res.type('html').send(html);
    } catch (error) { next(error); }
  });

  // Shared login on the primary application link. The account role is resolved only from verified credentials.
  async function authenticateManagerCredentials(req, usernameValue, passwordValue) {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (current && now - current.start < 60_000 && current.count >= 8) {
      return { status: 429, error: 'Trop de tentatives. Réessayez dans une minute.' };
    }
    const username = String(usernameValue || '').trim();
    const passwordRaw = String(passwordValue || '');
    const password = passwordRaw.slice(0, 128);
    const manager = username.length <= 80 ? await store.getManagerByUsername(username) : null;
    const passwordMatches = manager ? checkPassword(password, manager.passwordHash) : (() => { const probe = crypto.scryptSync(password, DUMMY_SALT, DUMMY_HASH.length); return crypto.timingSafeEqual(probe, DUMMY_HASH); })();
    const validPassword = passwordRaw.length <= 128 && passwordMatches;
    const temporaryExpiry = manager?.passwordResetExpiresAt ? new Date(manager.passwordResetExpiresAt).getTime() : 0;
    const temporaryPasswordExpired = Boolean(manager?.mustChangePassword && (!Number.isFinite(temporaryExpiry) || temporaryExpiry <= now));
    if (!manager || !validPassword || temporaryPasswordExpired || manager.status !== 'active' || manager.deletedAt) {
      const next = !current || now - current.start >= 60_000 ? { start: now, count: 1 } : { ...current, count: current.count + 1 };
      loginAttempts.set(key, next);
      const status = manager?.status || 'unknown';
      await writeAudit(managerAudit(manager, 'login_failure', 'authentication', manager?.id || 'unknown',
        manager?.status === 'suspended' ? 'Connexion refusée : compte gestionnaire suspendu.' : manager?.status === 'blocked' ? 'Connexion refusée : compte gestionnaire bloqué.' : 'Échec de connexion à l’espace gestionnaire.',
        { result: 'failure', metadata: { status, temporaryPasswordExpired, loginMode: 'shared_link' } })).catch((error) => console.error('Audit login failure failed:', error));
      return { status: 401, error: manager && validPassword && temporaryPasswordExpired
        ? 'Le mot de passe temporaire a expiré. Contactez le PDG pour en obtenir un nouveau.'
        : 'Identifiant ou mot de passe incorrect, ou compte indisponible.' };
    }
    loginAttempts.delete(key);
    const currentManager = await store.markManagerLogin(manager.id);
    await writeAudit(managerAudit(currentManager, 'login_success', 'authentication', manager.id, 'Connexion à l’espace gestionnaire réussie.', { metadata: { mustChangePassword: Boolean(currentManager.mustChangePassword), loginMode: 'shared_link' } }));
    return { manager: currentManager };
  }
  app.locals.authenticateManagerCredentials = authenticateManagerCredentials;

  // Legacy manager route stays available on the same host, but it uses the same backend verifier and ignores custom-domain bindings.
  app.post('/api/manager/auth/login', checkSameOrigin, async (req, res) => {
    try {
      const result = await authenticateManagerCredentials(req, req.body?.username, req.body?.password);
      if (!result.manager) return res.status(result.status || 401).json({ error: result.error || 'Identifiant ou mot de passe incorrect.' });
      setManagerSession(res, result.manager);
      res.json({ ok: true, manager: safeManager(result.manager) });
    } catch (error) { apiError(res, error, 'Impossible d’ouvrir la session gestionnaire.'); }
  });
  app.get('/api/manager/auth/me', requireManager, (req, res) => res.json({ authenticated: true, manager: safeManager(req.manager, false, true) }));
  app.post('/api/manager/auth/change-password', requireManager, async (req, res) => {
    try {
      const password = String(req.body?.password || '');
      if (!req.manager.mustChangePassword) return res.status(409).json({ error: 'Aucune réinitialisation obligatoire n’est en attente.' });
      const temporaryExpiry = req.manager.passwordResetExpiresAt ? new Date(req.manager.passwordResetExpiresAt).getTime() : 0;
      if (!Number.isFinite(temporaryExpiry) || temporaryExpiry <= Date.now()) {
        await writeAudit(managerAudit(req.manager, 'password_change', 'manager', req.manager.id, 'Changement du mot de passe temporaire refusé : échéance dépassée.', { result: 'failure', metadata: { reason: 'temporary_password_expired' } })).catch(() => {});
        return res.status(410).json({ error: 'Le mot de passe temporaire a expiré. Contactez le PDG pour en obtenir un nouveau.' });
      }
      if (password.length < 12 || password.length > 128) {
        await writeAudit(managerAudit(req.manager, 'password_change', 'manager', req.manager.id, 'Changement du mot de passe refusé : politique de longueur non satisfaite.', { result: 'failure', metadata: { reason: 'password_policy' } })).catch(() => {});
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir entre 12 et 128 caractères.' });
      }
      if (checkPassword(password, req.manager.passwordHash)) {
        await writeAudit(managerAudit(req.manager, 'password_change', 'manager', req.manager.id, 'Changement du mot de passe refusé : le nouveau secret doit être différent.', { result: 'failure', metadata: { reason: 'same_as_temporary_password' } })).catch(() => {});
        return res.status(400).json({ error: 'Choisissez un mot de passe différent du mot de passe temporaire.' });
      }
      const manager = await store.completeManagerPasswordChange(req.manager.id, hashPassword(password));
      if (!manager) {
        await writeAudit(managerAudit(req.manager, 'password_change', 'manager', req.manager.id, 'Changement du mot de passe refusé : réinitialisation déjà consommée ou invalide.', { result: 'failure', metadata: { reason: 'reset_not_pending' } })).catch(() => {});
        return res.status(409).json({ error: 'La réinitialisation a déjà été utilisée ou n’est plus valide.' });
      }
      await writeAudit(managerAudit(manager, 'password_change', 'manager', manager.id, 'Mot de passe temporaire remplacé par un nouveau mot de passe choisi par le gestionnaire.', {
        beforeData: { mustChangePassword: true }, afterData: { mustChangePassword: false }, metadata: { method: 'temporary_password' },
      }));
      setManagerSession(res, manager);
      res.json({ ok: true, manager: safeManager(manager, false, true) });
    } catch (error) { apiError(res, error, 'Impossible de modifier le mot de passe.'); }
  });
  const auditResetLinkFailure = async (reason) => writeAudit({ actor: 'Lien de réinitialisation', actorType: 'anonymous', actorId: null, managerId: null,
    action: 'password_change', entityType: 'authentication', entityId: 'reset-link',
    summary: 'Tentative de réinitialisation par lien refusée.', result: 'failure', metadata: { reason },
  }).catch(() => {});
  app.post('/api/manager/auth/reset-password', checkSameOrigin, async (req, res) => {
    try {
      const token = String(req.body?.token || '');
      const password = String(req.body?.password || '');
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) {
        await auditResetLinkFailure('invalid_token_format');
        return res.status(400).json({ error: 'Lien de réinitialisation invalide.' });
      }
      if (password.length < 12 || password.length > 128) {
        await auditResetLinkFailure('password_policy');
        return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir entre 12 et 128 caractères.' });
      }
      const tokenHash = hashResetToken(token);
      const resetTarget = await store.getManagerByResetTokenHash(tokenHash);
      const manager = await store.completeManagerPasswordResetByToken(tokenHash, hashPassword(password));
      if (!manager) {
        if (resetTarget) {
          await writeAudit(managerAudit(resetTarget, 'password_change', 'manager', resetTarget.id, 'Tentative de réinitialisation par lien refusée : le lien est arrivé à échéance ou n’est plus valide.', {
            result: 'failure', metadata: { reason: 'expired_or_invalid_reset_link' },
          })).catch(() => {});
        } else await auditResetLinkFailure('expired_used_or_invalid_token');
        return res.status(410).json({ error: 'Ce lien a expiré, a déjà été utilisé ou n’est plus valide. Contactez le PDG.' });
      }
      await writeAudit(managerAudit(manager, 'password_change', 'manager', manager.id, 'Mot de passe renouvelé à partir du lien sécurisé fourni par le PDG.', {
        beforeData: { mustChangePassword: true }, afterData: { mustChangePassword: false }, metadata: { method: 'reset_link' },
      }));
      const authenticated = manager.status === 'active';
      if (authenticated) setManagerSession(res, manager);
      res.json({ ok: true, authenticated, manager: safeManager(manager, false, true) });
    } catch (error) { apiError(res, error, 'Impossible de finaliser la réinitialisation.'); }
  });
  app.get('/api/manager/profile', requireManager, async (req, res) => {
    const manager = await store.getManager(req.manager.id);
    res.json({ data: safeManager(manager, false, true) });
  });
  app.put('/api/manager/profile', requireManager, async (req, res) => {
    try {
      const displayName = String(req.body?.displayName ?? req.manager.displayName).trim().slice(0, 120);
      const email = String(req.body?.email ?? req.manager.email ?? '').trim().toLowerCase().slice(0, 254);
      const phone = String(req.body?.phone ?? req.manager.phone ?? '').trim().slice(0, 32);
      if (!displayName) return res.status(400).json({ error: 'Le nom affiché est obligatoire.' });
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'L’adresse e-mail n’est pas valide.' });
      if (phone && (!/^[0-9+().\s-]{7,32}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) return res.status(400).json({ error: 'Le numéro de téléphone n’est pas valide.' });
      const emailChanged = email.toLowerCase() !== String(req.manager.email || '').toLowerCase();
      if (emailChanged && !checkPassword(String(req.body?.currentPassword || ''), req.manager.passwordHash)) {
        await writeAudit(managerAudit(req.manager, 'update', 'manager', req.manager.id, 'Modification de l’adresse e-mail refusée : nouvelle vérification du mot de passe requise.', { result: 'denied', metadata: { reason: 'reauthentication_failed' } })).catch(() => {});
        return res.status(403).json({ error: 'Pour changer votre e-mail, saisissez votre mot de passe actuel.' });
      }
      const avatarData = Object.hasOwn(req.body || {}, 'avatarData') ? normalizeAvatarData(req.body.avatarData) : (req.manager.avatarData || '');
      let notificationPreferences = { codeUpdates: true, validationResults: true, suspensions: true, pdgMessages: true, securityAlerts: true, ...(req.manager.notificationPreferences || {}) };
      if (Object.hasOwn(req.body || {}, 'notificationPreferences')) {
        const supplied = req.body.notificationPreferences;
        const keys = Object.keys(notificationPreferences);
        if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied) || keys.some((key) => typeof supplied[key] !== 'boolean')) {
          return res.status(400).json({ error: 'Les préférences de notification sont invalides.' });
        }
        notificationPreferences = Object.fromEntries(keys.map((key) => [key, supplied[key]]));
      }
      const manager = await store.updateManagerSelfProfile(req.manager.id, { displayName, email, phone, avatarData, notificationPreferences });
      if (!manager) return res.status(404).json({ error: 'Profil gestionnaire introuvable.' });
      await writeAudit(managerAudit(manager, 'update', 'manager', manager.id, 'Profil personnel ou préférences du gestionnaire modifiés.', {
        beforeData: { emailChanged: emailChanged, hasAvatar: Boolean(req.manager.avatarData) },
        afterData: { emailChanged: emailChanged, hasAvatar: Boolean(manager.avatarData), notificationPreferences },
      }));
      res.json({ data: safeManager(manager, false, true) });
    } catch (error) {
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      if (error.code === 'DUPLICATE_EMAIL') return res.status(409).json({ error: error.message });
      apiError(res, error, 'Impossible de modifier le profil.');
    }
  });
  app.post('/api/manager/auth/update-password', requireManager, async (req, res) => {
    try {
      const currentPassword = String(req.body?.currentPassword || '');
      const password = String(req.body?.newPassword || '');
      const confirmation = String(req.body?.confirmPassword || '');
      if (!checkPassword(currentPassword, req.manager.passwordHash)) {
        await writeAudit(managerAudit(req.manager, 'password_change', 'authentication', req.manager.id, 'Changement du mot de passe refusé : vérification du mot de passe actuel échouée.', { result: 'failure', metadata: { reason: 'current_password_invalid' } })).catch(() => {});
        return res.status(403).json({ error: 'Le mot de passe actuel est incorrect.' });
      }
      if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir entre 12 et 128 caractères.' });
      if (password !== confirmation) return res.status(400).json({ error: 'Les deux nouveaux mots de passe ne correspondent pas.' });
      if (checkPassword(password, req.manager.passwordHash)) return res.status(400).json({ error: 'Choisissez un mot de passe différent de l’actuel.' });
      const manager = await store.changeManagerPassword(req.manager.id, hashPassword(password));
      if (!manager) return res.status(409).json({ error: 'Le mot de passe ne peut pas être modifié dans l’état actuel du compte.' });
      await writeAudit(managerAudit(manager, 'password_change', 'authentication', manager.id, 'Mot de passe changé par le gestionnaire après vérification du mot de passe actuel; les autres sessions sont révoquées.', { metadata: { sessionsRevoked: true, method: 'authenticated_reauthentication' } }));
      await notifyManager(manager.id, { type: 'security_alert', title: 'Mot de passe modifié', body: 'Le mot de passe de votre compte QRia vient d’être modifié.', entityType: 'authentication', entityId: manager.id });
      setManagerSession(res, manager);
      res.json({ ok: true, manager: safeManager(manager, false, true) });
    } catch (error) { apiError(res, error, 'Impossible de modifier le mot de passe.'); }
  });
  app.post('/api/manager/auth/logout', requireManager, async (req, res) => {
    try {
      await store.invalidateManagerSessions(req.manager.id);
      await writeAudit(managerAudit(req.manager, 'logout', 'authentication', req.manager.id, 'Déconnexion de l’espace gestionnaire; toutes les sessions du compte ont été révoquées.'));
      clearManagerSession(res);
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de fermer la session.'); }
  });

  // Notifications and recent account activity are always scoped to the authenticated manager.
  app.get('/api/manager/notifications', requireManager, async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 30));
      res.json(await store.listManagerNotifications(req.manager.id, { page, limit }));
    } catch (error) { apiError(res, error, 'Impossible de charger les notifications.'); }
  });
  app.patch('/api/manager/notifications/read-all', requireManager, async (req, res) => {
    try { res.json({ updated: await store.markManagerNotificationRead(req.manager.id) }); }
    catch (error) { apiError(res, error, 'Impossible de marquer les notifications comme lues.'); }
  });
  app.patch('/api/manager/notifications/:id/read', requireManager, async (req, res) => {
    try {
      const updated = await store.markManagerNotificationRead(req.manager.id, String(req.params.id));
      if (!updated) return res.status(404).json({ error: 'Notification introuvable.' });
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de mettre à jour la notification.'); }
  });
  app.get('/api/manager/activity', requireManager, async (req, res) => {
    try {
      const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 10));
      res.json(await store.listManagerActivities({ managerId: req.manager.id, page: 1, limit }));
    } catch (error) { apiError(res, error, 'Impossible de charger vos activités récentes.'); }
  });

  // Manager-scoped workspace. Every record lookup is additionally scoped on the server.
  app.get('/api/manager/dashboard', requireManager, async (req, res) => {
    try {
      const [stats, codes, activity, notifications] = await Promise.all([
        store.managerStats(req.manager.id),
        store.listCodes({ page: 1, limit: 6, managerId: req.manager.id }),
        store.listManagerActivities({ managerId: req.manager.id, page: 1, limit: 8 }),
        store.listManagerNotifications(req.manager.id, { page: 1, limit: 5 }),
      ]);
      await writeAudit(managerAudit(req.manager, 'stats_view', 'statistics', req.manager.id, 'Consultation du tableau de bord et des statistiques.'));
      res.json({ stats, recentCodes: codes.data, recentActivity: activity.data, notifications: notifications.data, unreadNotifications: notifications.unread });
    } catch (error) { apiError(res, error, 'Impossible de charger le tableau de bord.'); }
  });
  app.get('/api/manager/categories', requireManager, async (_req, res) => {
    try { res.json({ data: await store.listCategories() }); }
    catch (error) { apiError(res, error, 'Impossible de charger les catégories.'); }
  });
  app.get('/api/manager/beneficiaries', requireManager, async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const type = ['individual', 'business', 'commerce', 'organization', 'other'].includes(req.query.type) ? req.query.type : '';
      const status = ['active', 'blocked'].includes(req.query.status) ? req.query.status : '';
      res.json(await store.listBeneficiaries({ search: String(req.query.search || '').trim().slice(0, 160), type, status, page, limit, managerId: req.manager.id }));
    } catch (error) { apiError(res, error, 'Impossible de charger les bénéficiaires.'); }
  });
  app.get('/api/manager/beneficiaries/:id', requireManager, async (req, res) => {
    try {
      const beneficiary = await managerBeneficiary(req, res, req.params.id);
      if (!beneficiary) return;
      await writeAudit(managerAudit(req.manager, 'view', 'beneficiary', beneficiary.id, `Consultation du bénéficiaire « ${beneficiary.name} ».`));
      res.json({ data: beneficiary });
    } catch (error) { apiError(res, error); }
  });
  app.post('/api/manager/beneficiaries', requireManager, async (req, res) => {
    try {
      const input = validateBeneficiary(req.body || {});
      const beneficiary = await store.createBeneficiary(input, req.manager.id);
      await writeAudit(managerAudit(req.manager, 'create', 'beneficiary', beneficiary.id, `Bénéficiaire « ${beneficiary.name} » créé.`, {
        afterData: beneficiarySnapshot(beneficiary),
      }));
      res.status(201).json({ data: beneficiary });
    } catch (error) {
      if (error.message && !error.code) { await auditManagerFailure(req, 'beneficiary', 'new', 'Échec de création d’un bénéficiaire : données invalides.'); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de créer le bénéficiaire.');
    }
  });
  app.put('/api/manager/beneficiaries/:id', requireManager, async (req, res) => {
    try {
      const before = await managerBeneficiary(req, res, req.params.id);
      if (!before) return;
      if (!(await managerMayMutateBeneficiary(req, res, req.params.id))) return;
      const input = validateBeneficiary(req.body || {});
      const beneficiary = await store.updateBeneficiary(req.params.id, input);
      if (!beneficiary) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
      await writeAudit(managerAudit(req.manager, 'update', 'beneficiary', beneficiary.id, `Informations de « ${beneficiary.name} » modifiées.`, {
        beforeData: beneficiarySnapshot(before), afterData: beneficiarySnapshot(beneficiary),
      }));
      res.json({ data: beneficiary });
    } catch (error) {
      if (error.message && !error.code) { await auditManagerFailure(req, 'beneficiary', req.params.id, 'Échec de modification du bénéficiaire : données invalides.'); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de modifier le bénéficiaire.');
    }
  });
  app.patch('/api/manager/beneficiaries/:id/status', requireManager, async (req, res) => {
    try {
      const status = String(req.body?.status || '');
      if (!['active', 'blocked'].includes(status)) { await auditManagerFailure(req, 'beneficiary', req.params.id, 'Échec de changement de statut du bénéficiaire : statut invalide.'); return res.status(400).json({ error: 'Statut de bénéficiaire invalide.' }); }
      const before = await managerBeneficiary(req, res, req.params.id);
      if (!before) return;
      if (!(await managerMayMutateBeneficiary(req, res, req.params.id))) return;
      const updatedBeneficiary = await store.setBeneficiaryStatus(req.params.id, status);
      if (!updatedBeneficiary) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
      await writeAudit(managerAudit(req.manager, status === 'blocked' ? 'block' : 'unblock', 'beneficiary', updatedBeneficiary.id,
        `Bénéficiaire « ${updatedBeneficiary.name} » ${status === 'blocked' ? 'bloqué' : 'débloqué'}.`, {
          beforeData: beneficiarySnapshot(before), afterData: beneficiarySnapshot(updatedBeneficiary),
        }));
      res.json({ data: updatedBeneficiary });
    } catch (error) { apiError(res, error, 'Impossible de changer le statut du bénéficiaire.'); }
  });
  app.delete('/api/manager/beneficiaries/:id', requireManager, async (req, res) => {
    try {
      const before = await managerBeneficiary(req, res, req.params.id);
      if (!before) return;
      if (!(await managerMayMutateBeneficiary(req, res, before.id))) return;
      await store.deleteBeneficiary(before.id);
      await writeAudit(managerAudit(req.manager, 'delete', 'beneficiary', before.id, `Bénéficiaire « ${before.name} » supprimé logiquement; QR et scans conservés.`, { beforeData: beneficiarySnapshot(before) }));
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de supprimer le bénéficiaire.'); }
  });
  app.get('/api/manager/codes', requireManager, async (req, res) => {
    try {
      const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
      const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
      const status = ['draft', 'pending_validation', 'active', 'suspended', 'rejected', 'inactive'].includes(req.query.status) ? req.query.status : '';
      res.json(await store.listCodes({
        search: String(req.query.search || '').trim().slice(0, 160), categoryId: String(req.query.categoryId || '').slice(0, 100),
        beneficiaryId: String(req.query.beneficiaryId || '').slice(0, 100), status, page, limit, managerId: req.manager.id,
      }));
    } catch (error) { apiError(res, error, 'Impossible de charger les QR codes.'); }
  });
  app.get('/api/manager/codes/:id', requireManager, async (req, res) => {
    try {
      const code = await managerCode(req, res, req.params.id);
      if (!code) return;
      await writeAudit(managerAudit(req.manager, 'view', 'qr_code', code.id, `Consultation du QR « ${code.name} ».`));
      res.json({ data: code });
    } catch (error) { apiError(res, error); }
  });
  app.post('/api/manager/codes', requireManager, async (req, res) => {
    try {
      if (req.manager.canCreateCodes === false) {
        await auditManagerFailure(req, 'qr_code', 'new', 'Création de QR refusée : permission désactivée par le PDG.');
        return res.status(403).json({ error: 'Le PDG a désactivé la création de QR pour votre compte.' });
      }
      const saveMode = String(req.body?.saveMode || 'publish');
      if (!['draft', 'publish'].includes(saveMode)) return res.status(400).json({ error: 'Choisissez brouillon ou publication/validation.' });
      const beneficiary = await managerBeneficiary(req, res, String(req.body?.beneficiaryId || ''));
      if (!beneficiary) return;
      if (beneficiary.status === 'blocked') { await auditManagerFailure(req, 'qr_code', 'new', 'Création de QR refusée : le bénéficiaire est bloqué.'); return res.status(409).json({ error: 'Ce bénéficiaire est bloqué. Réactivez-le avant de créer un QR.' }); }
      const input = validateQr(req.body || {}, beneficiary);
      if (!(await store.listCategories()).some((item) => item.id === input.categoryId)) return res.status(400).json({ error: 'Choisissez une catégorie existante.' });
      input.managerId = req.manager.id;
      input.status = saveMode === 'draft' ? 'draft' : (req.manager.canSelfActivateCodes === true ? 'active' : 'pending_validation');
      input.statusReason = '';
      const customerType = String(req.body?.customerType || (['business','commerce','organization'].includes(beneficiary.type) ? 'business' : beneficiary.type === 'individual' ? 'individual' : 'custom'));
      const quote = finance.quote(await finance.getPricing(), { customerType, qrPurpose: input.purpose, destinationType: input.destinationType, planId: req.body?.pricingPlanId, optionIds: req.body?.optionIds });
      const manager = await store.getManager(req.manager.id);
      const orderInput = { reference: finance.makeReference('QR'), managerId: req.manager.id, managerName: manager?.displayName || 'Gestionnaire', beneficiaryId: beneficiary.id, beneficiaryName: beneficiary.name,
        clientName: String(req.body?.clientName || beneficiary.name).trim().slice(0, 140), companyName: String(req.body?.companyName || (customerType === 'business' ? beneficiary.name : '')).trim().slice(0, 140),
        customerType, qrPurpose: input.purpose, destinationType: input.destinationType, pricingPlanId: quote.planId, pricingPlanName: quote.planName,
        unitAmountXof: quote.unitAmountXof, selectedOptions: quote.options, totalAmountXof: quote.totalAmountXof, paymentMethod: 'cash', createdByType: 'manager', createdById: req.manager.id };
      const result = await finance.createCodeAndOrder(input, req.manager.id, orderInput);
      const statusText = result.code.status === 'active' ? 'actif' : result.code.status === 'draft' ? 'enregistré comme brouillon' : 'soumis à validation du PDG';
      await writeAudit(managerAudit(req.manager, result.code.status === 'pending_validation' ? 'request_validation' : 'create', 'qr_code', result.code.id, `QR « ${result.code.name} » créé pour ${result.code.beneficiaryName}, statut : ${statusText}; commande ${result.order.reference} enregistrée pour ${result.order.totalAmountXof} XOF, paiement en attente.`, { afterData: publicSnapshot(result.code), metadata: { orderId: result.order.id, orderReference: result.order.reference, amountXof: result.order.totalAmountXof, status: result.code.status } }));
      res.status(201).json({ data: result.code, order: result.order });
    } catch (error) {
      if (['MANAGER_CREATE_FORBIDDEN', 'MANAGER_ACTIVATION_FORBIDDEN', 'MANAGER_QR_LIMIT', 'MANAGER_NOT_ACTIVE'].includes(error.code)) { await auditManagerFailure(req, 'qr_code', 'new', `Création QR refusée côté serveur : ${error.code}.`); return res.status(error.code === 'MANAGER_QR_LIMIT' ? 409 : 403).json({ error: error.message }); }
      if (['PRICE_NOT_CONFIGURED', 'INVALID_QUOTE'].includes(error.code)) { await auditManagerFailure(req, 'qr_code', 'new', 'Création de QR refusée : tarif absent ou sélection invalide.'); return res.status(error.code === 'PRICE_NOT_CONFIGURED' ? 409 : 400).json({ error: error.message }); }
      if (error.message && !error.code) { await auditManagerFailure(req, 'qr_code', 'new', 'Échec de création d’un QR : données invalides.'); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de créer le QR code.');
    }
  });
  app.put('/api/manager/codes/:id', requireManager, async (req, res) => {
    try {
      if (req.manager.canEditCodes === false) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Modification QR refusée : permission désactivée par le PDG.'); return res.status(403).json({ error: 'Le PDG a désactivé la modification de vos QR.' }); }
      const before = await managerCode(req, res, req.params.id);
      if (!before) return;
      const beneficiary = await managerBeneficiary(req, res, String(req.body?.beneficiaryId || ''));
      if (!beneficiary) return;
      if (beneficiary.status === 'blocked' && beneficiary.id !== before.beneficiaryId) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Modification de QR refusée : le nouveau bénéficiaire est bloqué.'); return res.status(409).json({ error: 'Ce bénéficiaire est bloqué.' }); }
      const input = validateQr(req.body || {}, beneficiary);
      if (!(await store.listCategories()).some((item) => item.id === input.categoryId)) return res.status(400).json({ error: 'Choisissez une catégorie existante.' });
      const saveMode = String(req.body?.saveMode || 'publish');
      if (!['draft', 'publish'].includes(saveMode)) return res.status(400).json({ error: 'Choisissez brouillon ou publication/validation.' });
      const requiresPdgReview = ['suspended', 'inactive', 'rejected'].includes(before.status) || req.manager.canSelfActivateCodes !== true;
      input.status = saveMode === 'draft' ? 'draft' : (requiresPdgReview ? 'pending_validation' : 'active');
      input.statusReason = saveMode === 'draft' ? '' : (requiresPdgReview ? 'Modification soumise à validation du PDG.' : '');
      const code = await store.updateCode(req.params.id, input);
      if (!code) return res.status(404).json({ error: 'QR code introuvable.' });
      const resubmitted = code.status === 'pending_validation';
      await writeAudit(managerAudit(req.manager, resubmitted ? 'request_validation' : 'update', 'qr_code', code.id,
        resubmitted ? `QR « ${code.name} » modifié et soumis à validation; il n’est pas public avant décision du PDG.` : `QR « ${code.name} » modifié.`,
        { beforeData: publicSnapshot(before), afterData: publicSnapshot(code), metadata: { previousStatus: before.status, newStatus: code.status } }));
      res.json({ data: code });
    } catch (error) {
      if (error.message && !error.code) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Échec de modification du QR : données invalides.'); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de modifier le QR code.');
    }
  });
  app.patch('/api/manager/codes/:id/status', requireManager, async (req, res) => {
    try {
      const status = String(req.body?.status || '');
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      if (!['active', 'suspended'].includes(status)) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Échec de changement de statut QR : statut invalide.'); return res.status(400).json({ error: 'Choisissez Actif ou Suspendu.' }); }
      const before = await managerCode(req, res, req.params.id);
      if (!before) return;
      if (before.beneficiaryDeletedAt) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Réactivation du QR refusée : le bénéficiaire est supprimé.'); return res.status(409).json({ error: 'Le bénéficiaire a été supprimé.' }); }
      if (status === 'active') {
        if (req.manager.canSelfActivateCodes !== true) { await auditManagerFailure(req, 'qr_code', before.id, 'Activation QR refusée : le PDG exige une validation préalable.'); return res.status(403).json({ error: 'Le PDG doit valider ce QR avant son activation.' }); }
        if (!['draft', 'pending_validation'].includes(before.status)) { await auditManagerFailure(req, 'qr_code', before.id, 'Réactivation QR refusée : seul le PDG peut réactiver un QR suspendu ou refusé.'); return res.status(403).json({ error: 'Seul le PDG peut réactiver un QR suspendu ou refusé.' }); }
      }
      const code = await store.setCodeStatus(req.params.id, status, reason || (status === 'suspended' ? 'Suspendu par le gestionnaire.' : ''));
      const action = status === 'active' ? 'activate' : 'suspend';
      await writeAudit(managerAudit(req.manager, action, 'qr_code', code.id,
        `QR « ${code.name} » ${status === 'active' ? 'activé par son gestionnaire' : 'suspendu par son gestionnaire'}.`,
        { beforeData: publicSnapshot(before), afterData: publicSnapshot(code), metadata: { reason: reason || null } }));
      res.json({ data: code });
    } catch (error) { apiError(res, error, 'Impossible de changer le statut du QR.'); }
  });
  app.delete('/api/manager/codes/:id', requireManager, async (req, res) => {
    try {
      if (req.manager.canEditCodes === false) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Suppression QR refusée : permission désactivée par le PDG.'); return res.status(403).json({ error: 'Le PDG a désactivé la modification de vos QR.' }); }
      const before = await managerCode(req, res, req.params.id);
      if (!before) return;
      await store.deleteCode(req.params.id);
      await writeAudit(managerAudit(req.manager, 'delete', 'qr_code', before.id, `QR « ${before.name} » supprimé logiquement; journal conservé.`, { beforeData: publicSnapshot(before) }));
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de supprimer le QR code.'); }
  });
  app.get('/api/manager/scan-stats', requireManager, async (req, res) => {
    try {
      const period = String(req.query.period || 'all');
      if (!['all', '7', '30', '90'].includes(period)) return res.status(400).json({ error: 'Période invalide.' });
      const data = await store.managerScanStats(req.manager.id, { days: period === 'all' ? 0 : Number(period) });
      await writeAudit(managerAudit(req.manager, 'stats_view', 'statistics', req.manager.id, `Consultation des statistiques de scans (${period === 'all' ? 'toute la période' : `${period} jours`}).`));
      res.json(data);
    } catch (error) { apiError(res, error, 'Impossible de charger les statistiques.'); }
  });
  app.post('/api/manager/activity', requireManager, async (req, res) => {
    try {
      const action = String(req.body?.action || '');
      const codeId = String(req.body?.codeId || '').slice(0, 100);
      if (!['download_png', 'download_svg', 'share', 'print', 'preview'].includes(action)) return res.status(400).json({ error: 'Action non reconnue.' });
      const code = await managerCode(req, res, codeId);
      if (!code) return;
      const mapped = action === 'preview' ? 'view' : action;
      await writeAudit(managerAudit(req.manager, mapped, 'qr_code', code.id, `Action « ${mapped} » sur le QR « ${code.name} ».`));
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer l’activité.'); }
  });
};
