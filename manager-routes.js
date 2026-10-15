'use strict';

const crypto = require('node:crypto');

const DEFAULT_ALERTS = Object.freeze({
  loginFailures: true,
  loginSuccesses: false,
  statusChanges: true,
  qrChanges: true,
  authorizationDenials: true,
  accountChanges: true,
});
const STATUS_VALUES = new Set(['active', 'suspended', 'blocked']);
const ACTION_VALUES = new Set(['login_success', 'login_failure', 'logout', 'password_reset', 'action_failure', 'create', 'delete', 'activate', 'deactivate', 'block', 'unblock', 'status_change', 'authorization_denied', 'view', 'stats_view', 'download_png', 'download_svg', 'share', 'print', 'assignment']);
const ENTITY_VALUES = new Set(['manager', 'qr_code', 'beneficiary', 'authentication', 'admin_api', 'statistics']);
const DUMMY_SALT = Buffer.from('qria-manager-login-dummy-salt');
const DUMMY_HASH = crypto.scryptSync('qria-no-account-password', DUMMY_SALT, 64);

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
function safeManager(manager, withAuth = false) {
  if (!manager) return null;
  const data = {
    id: manager.id, username: manager.username, displayName: manager.displayName,
    email: manager.email || '', status: manager.status, statusReason: manager.statusReason || '',
    createdAt: manager.createdAt, updatedAt: manager.updatedAt, lastLoginAt: manager.lastLoginAt || null,
    deletedAt: manager.deletedAt || null,
  };
  if (withAuth) data.sessionVersion = manager.tokenVersion;
  return data;
}
function normalizeManagerInput(input, { allowPassword = false } = {}) {
  const username = String(input?.username || '').trim().toLowerCase();
  const displayName = String(input?.displayName || '').trim().slice(0, 120);
  const email = String(input?.email || '').trim().slice(0, 254);
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) throw new Error('L’identifiant doit contenir 3 à 80 caractères (lettres, chiffres, point, tiret ou soulignement).');
  if (!displayName) throw new Error('Le nom du gestionnaire est obligatoire.');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail n’est pas valide.');
  const result = { username, displayName, email };
  if (allowPassword) {
    const password = String(input?.password || '');
    if (password.length < 12 || password.length > 128) throw new Error('Le mot de passe doit contenir entre 12 et 128 caractères.');
    result.passwordHash = hashPassword(password);
  }
  return result;
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
  return {
    actor: 'PDG', actorType: 'admin', actorId: 'admin', managerId: extras.managerId || null,
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
    app, store, requireAdmin, requireManager, checkSameOrigin,
    setManagerSession, clearManagerSession, validateBeneficiary, validateQr,
    makeAudit, publicSnapshot, beneficiarySnapshot, apiError,
  } = deps;
  const loginAttempts = new Map();

  const writeAudit = async (event) => store.addAudit(event);
  async function auditManagerFailure(req, entityType, entityId, summary) {
    await writeAudit(managerAudit(req.manager, 'action_failure', entityType, entityId || 'unknown', summary, { result: 'failure' }))
      .catch((error) => console.error('Audit failed operation failed:', error?.message || 'unknown error'));
  }
  const snapshotManager = (manager) => manager ? ({
    id: manager.id, username: manager.username, displayName: manager.displayName,
    hasEmail: Boolean(manager.email), status: manager.status, statusReason: manager.statusReason || '',
    deletedAt: manager.deletedAt || null,
  }) : null;
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
  app.post('/api/admin/managers', requireAdmin, async (req, res) => {
    try {
      const input = normalizeManagerInput(req.body, { allowPassword: true });
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
      const input = normalizeManagerInput(req.body);
      const manager = await store.updateManager(req.params.id, input);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      await writeAudit(adminAudit('update', 'manager', manager.id, `Profil du gestionnaire « ${manager.displayName} » modifié; ses sessions précédentes ont été invalidées.`, {
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
      const password = String(req.body?.password || '');
      if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir entre 12 et 128 caractères.' });
      const manager = await store.updateManagerPassword(req.params.id, hashPassword(password));
      await writeAudit(adminAudit('password_reset', 'manager', manager.id, `Mot de passe réinitialisé pour « ${manager.displayName} »; toutes les sessions ont été invalidées.`, {
        managerId: manager.id, beforeData: { id: manager.id, username: manager.username }, afterData: { id: manager.id, passwordReset: true },
      }));
      res.json({ ok: true, data: safeManager(manager) });
    } catch (error) { apiError(res, error, 'Impossible de réinitialiser le mot de passe.'); }
  });
  app.patch('/api/admin/managers/:id/status', requireAdmin, async (req, res) => {
    try {
      const status = String(req.body?.status || '');
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      if (!STATUS_VALUES.has(status)) return res.status(400).json({ error: 'Choisissez un statut actif, suspendu ou bloqué.' });
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const manager = await store.setManagerStatus(req.params.id, status, reason);
      const action = status === 'active' ? 'reactivate' : status === 'suspended' ? 'suspend' : 'block';
      const label = { active: 'réactivé', suspended: 'suspendu', blocked: 'bloqué' }[status];
      await writeAudit(adminAudit(action, 'manager', manager.id, `Compte « ${manager.displayName} » ${label}; toutes les sessions précédentes ont été invalidées.`, {
        managerId: manager.id, beforeData: snapshotManager(before), afterData: snapshotManager(manager), metadata: { reason: reason || null },
      }));
      res.json({ data: safeManager(manager) });
    } catch (error) { apiError(res, error, 'Impossible de changer le statut du gestionnaire.'); }
  });
  app.delete('/api/admin/managers/:id', requireAdmin, async (req, res) => {
    try {
      const before = await store.getManager(req.params.id);
      if (!before) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
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

  // Separate manager login/session. No public registration endpoint exists.
  app.post('/api/manager/auth/login', checkSameOrigin, async (req, res) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const current = loginAttempts.get(key);
    if (current && now - current.start < 60_000 && current.count >= 8) {
      return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
    }
    const username = String(req.body?.username || '').trim();
    const passwordRaw = String(req.body?.password || '');
    const password = passwordRaw.slice(0, 128);
    try {
      const manager = username.length <= 80 ? await store.getManagerByUsername(username) : null;
      const passwordMatches = manager ? checkPassword(password, manager.passwordHash) : (() => { const probe = crypto.scryptSync(password, DUMMY_SALT, DUMMY_HASH.length); return crypto.timingSafeEqual(probe, DUMMY_HASH); })();
      const validPassword = passwordRaw.length <= 128 && passwordMatches;
      if (!manager || !validPassword || manager.status !== 'active' || manager.deletedAt) {
        const next = !current || now - current.start >= 60_000 ? { start: now, count: 1 } : { ...current, count: current.count + 1 };
        loginAttempts.set(key, next);
        const status = manager?.status || 'unknown';
        await writeAudit(managerAudit(manager, 'login_failure', 'authentication', manager?.id || 'unknown',
          manager?.status === 'suspended' ? 'Connexion refusée : compte gestionnaire suspendu.' : manager?.status === 'blocked' ? 'Connexion refusée : compte gestionnaire bloqué.' : 'Échec de connexion à l’espace gestionnaire.',
          { result: 'failure', metadata: { status } })).catch((error) => console.error('Audit login failure failed:', error));
        return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect, ou compte indisponible.' });
      }
      loginAttempts.delete(key);
      const currentManager = await store.markManagerLogin(manager.id);
      await writeAudit(managerAudit(currentManager, 'login_success', 'authentication', manager.id, 'Connexion à l’espace gestionnaire réussie.'));
      setManagerSession(res, currentManager);
      res.json({ ok: true, manager: safeManager(currentManager) });
    } catch (error) { apiError(res, error, 'Impossible d’ouvrir la session gestionnaire.'); }
  });
  app.get('/api/manager/auth/me', requireManager, (req, res) => res.json({ authenticated: true, manager: safeManager(req.manager) }));
  app.post('/api/manager/auth/logout', requireManager, async (req, res) => {
    try {
      await store.invalidateManagerSessions(req.manager.id);
      await writeAudit(managerAudit(req.manager, 'logout', 'authentication', req.manager.id, 'Déconnexion de l’espace gestionnaire; toutes les sessions du compte ont été révoquées.'));
      clearManagerSession(res);
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de fermer la session.'); }
  });

  // Manager-scoped workspace. Every record lookup is additionally scoped on the server.
  app.get('/api/manager/dashboard', requireManager, async (req, res) => {
    try {
      const [stats, codes] = await Promise.all([
        store.managerStats(req.manager.id),
        store.listCodes({ page: 1, limit: 6, managerId: req.manager.id }),
      ]);
      await writeAudit(managerAudit(req.manager, 'stats_view', 'statistics', req.manager.id, 'Consultation du tableau de bord et des statistiques.'));
      res.json({ stats, recentCodes: codes.data });
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
      const status = ['active', 'inactive'].includes(req.query.status) ? req.query.status : '';
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
      const beneficiary = await managerBeneficiary(req, res, String(req.body?.beneficiaryId || ''));
      if (!beneficiary) return;
      if (beneficiary.status === 'blocked') { await auditManagerFailure(req, 'qr_code', 'new', 'Création de QR refusée : le bénéficiaire est bloqué.'); return res.status(409).json({ error: 'Ce bénéficiaire est bloqué. Réactivez-le avant de créer un QR.' }); }
      const input = validateQr(req.body || {}, beneficiary);
      if (!(await store.listCategories()).some((item) => item.id === input.categoryId)) return res.status(400).json({ error: 'Choisissez une catégorie existante.' });
      input.managerId = req.manager.id;
      const code = await store.createCode(input, req.manager.id);
      await writeAudit(managerAudit(req.manager, 'create', 'qr_code', code.id, `QR « ${code.name} » créé pour ${code.beneficiaryName}.`, { afterData: publicSnapshot(code) }));
      res.status(201).json({ data: code });
    } catch (error) {
      if (error.message && !error.code) { await auditManagerFailure(req, 'qr_code', 'new', 'Échec de création d’un QR : données invalides.'); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de créer le QR code.');
    }
  });
  app.put('/api/manager/codes/:id', requireManager, async (req, res) => {
    try {
      const before = await managerCode(req, res, req.params.id);
      if (!before) return;
      const beneficiary = await managerBeneficiary(req, res, String(req.body?.beneficiaryId || ''));
      if (!beneficiary) return;
      if (beneficiary.status === 'blocked' && beneficiary.id !== before.beneficiaryId) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Modification de QR refusée : le nouveau bénéficiaire est bloqué.'); return res.status(409).json({ error: 'Ce bénéficiaire est bloqué.' }); }
      const input = validateQr(req.body || {}, beneficiary);
      if (!(await store.listCategories()).some((item) => item.id === input.categoryId)) return res.status(400).json({ error: 'Choisissez une catégorie existante.' });
      const code = await store.updateCode(req.params.id, input);
      if (!code) return res.status(404).json({ error: 'QR code introuvable.' });
      await writeAudit(managerAudit(req.manager, 'update', 'qr_code', code.id, `QR « ${code.name} » modifié.`, { beforeData: publicSnapshot(before), afterData: publicSnapshot(code) }));
      res.json({ data: code });
    } catch (error) {
      if (error.message && !error.code) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Échec de modification du QR : données invalides.'); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de modifier le QR code.');
    }
  });
  app.patch('/api/manager/codes/:id/status', requireManager, async (req, res) => {
    try {
      const status = String(req.body?.status || '');
      if (!['active', 'inactive'].includes(status)) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Échec de changement de statut du QR : statut invalide.'); return res.status(400).json({ error: 'Statut de QR invalide.' }); }
      const before = await managerCode(req, res, req.params.id);
      if (!before) return;
      if (before.beneficiaryDeletedAt) { await auditManagerFailure(req, 'qr_code', req.params.id, 'Réactivation du QR refusée : le bénéficiaire est supprimé.'); return res.status(409).json({ error: 'Le bénéficiaire a été supprimé.' }); }
      const code = await store.setCodeStatus(req.params.id, status);
      await writeAudit(managerAudit(req.manager, status === 'active' ? 'activate' : 'deactivate', 'qr_code', code.id,
        `QR « ${code.name} » ${status === 'active' ? 'activé' : 'désactivé'}.`, { beforeData: publicSnapshot(before), afterData: publicSnapshot(code) }));
      res.json({ data: code });
    } catch (error) { apiError(res, error, 'Impossible de changer le statut du QR.'); }
  });
  app.delete('/api/manager/codes/:id', requireManager, async (req, res) => {
    try {
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
