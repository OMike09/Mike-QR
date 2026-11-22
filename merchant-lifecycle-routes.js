'use strict';

// ============================================================================================
// Routes du module « cycle de vie marchand » :
//   • inscription autonome (publique, sans session) et suivi par le demandeur ;
//   • validation PDG / gestionnaire expressément agréé ;
//   • activation/désactivation globale des nouvelles fonctionnalités par le PDG ;
//   • statistiques de scans (clients / marchands / historique) pour marchand et PDG.
// Toutes les routes privées réutilisent les middlewares existants (requireAdmin, requireManager,
// requireMerchant) : aucune protection des espaces privés n'est affaiblie.
// ============================================================================================

const crypto = require('node:crypto');
const path = require('node:path');
const { REGISTRATION_STATUSES } = require('./merchant-lifecycle');

const FEATURE_KEYS = ['selfServiceRegistration', 'merchantAssistedOrders', 'merchantScanner', 'scanSplitStatistics'];

function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
  }
  return '';
}

module.exports = function registerMerchantLifecycleRoutes(deps) {
  const { app, store, commerce, extras, lifecycle, requireAdmin, requireManager, requireMerchant, checkSameOrigin, apiError } = deps;
  const PUBLIC_DIR = path.join(__dirname, 'public');
  const SIGNUP_COOKIE = 'qria_signup';
  const attempts = new Map();
  function allow(key, limit, windowMs) {
    const now = Date.now(); const current = attempts.get(key);
    if (current && now - current.start < windowMs) { if (current.count >= limit) return false; current.count += 1; }
    else attempts.set(key, { start: now, count: 1 });
    if (attempts.size > 5000) for (const [entry, value] of attempts) if (now - value.start >= windowMs) attempts.delete(entry);
    return true;
  }
  const mapError = (res, error, fallback) => {
    if (error.status && error.code) return res.status(error.status).json({ error: error.message, code: error.code, duplicate: error.duplicate });
    if (error.code === 'DUPLICATE' || error.code === 'DUPLICATE_OPEN_REGISTRATION') return res.status(409).json({ error: error.message, code: error.code });
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    return apiError(res, error, fallback);
  };
  const actorFor = (role, req) => role === 'manager'
    ? { type: 'manager', id: req.manager.id, label: `Gestionnaire ${req.manager.displayName} (@${req.manager.username})` }
    : { type: 'admin', id: String(process.env.ADMIN_USERNAME || 'admin'), label: 'PDG' };

  // Suivi de demande : jeton opaque en mémoire, le dossier en base reste la source de vérité.
  const trackingTokens = new Map();

  async function featureFlags() {
    const settings = await store.getSettings().catch(() => ({}));
    const stored = settings.merchantLifecycleFeatures || {};
    return Object.fromEntries(FEATURE_KEYS.map((key) => [key, stored[key] !== false]));
  }

  // ------------------------------------------------------------------------------------------
  // Pages publiques
  // ------------------------------------------------------------------------------------------
  app.get(['/devenir-marchand', '/devenir-marchand/'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'merchant-signup.html'));
  });
  app.get(['/devenir-marchand/suivi', '/devenir-marchand/suivi/'], (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(path.join(PUBLIC_DIR, 'merchant-signup.html'));
  });

  // ------------------------------------------------------------------------------------------
  // Inscription autonome (aucune session requise, aucune donnée privée renvoyée)
  // ------------------------------------------------------------------------------------------
  app.get('/api/public/merchant-registration/status', async (req, res) => {
    const flags = await featureFlags();
    const settings = await store.getSettings().catch(() => ({}));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { open: flags.selfServiceRegistration, sectors: ['general', 'restaurant', 'maquis', 'hardware', 'clothing', 'outdoor'],
      serviceName: settings.serviceName || 'Oymike Tech', notice: 'Toute demande est examinée par le PDG ou un gestionnaire autorisé avant l’activation de l’espace marchand.' } });
  });

  app.post('/api/public/merchant-registrations', checkSameOrigin, async (req, res) => {
    const ip = req.ip || 'unknown';
    if (!allow(`register:${ip}`, 5, 60 * 60_000)) return res.status(429).json({ error: 'Trop de demandes depuis cette connexion. Réessayez dans une heure.' });
    try {
      const flags = await featureFlags();
      if (!flags.selfServiceRegistration) return res.status(503).json({ error: 'Les inscriptions autonomes sont momentanément fermées. Contactez le PDG pour ouvrir votre compte marchand.', code: 'REGISTRATION_CLOSED' });
      const registration = await lifecycle.createRegistration(req.body || {});
      const token = crypto.randomBytes(24).toString('base64url');
      trackingTokens.set(token, { registrationId: registration.id, createdAt: Date.now() });
      res.cookie(SIGNUP_COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 30 * 86400000, path: '/' });
      res.status(201).json({ data: { reference: registration.reference, status: registration.status, businessName: registration.businessName,
        trackingToken: token, message: 'Votre demande d’inscription a bien été reçue. Elle sera examinée par un administrateur avant l’activation de votre espace marchand.' } });
    } catch (error) { return mapError(res, error, 'Impossible d’enregistrer votre demande d’inscription.'); }
  });

  app.get('/api/public/merchant-registrations/track', async (req, res) => {
    const token = String(req.query.token || readCookie(req, SIGNUP_COOKIE) || '');
    const entry = token ? trackingTokens.get(token) : null;
    if (!entry || Date.now() - entry.createdAt > 30 * 86400000) return res.status(404).json({ error: 'Suivi de demande introuvable. Utilisez la référence reçue à la soumission ou contactez le PDG.' });
    const registration = await lifecycle.getRegistration(entry.registrationId);
    if (!registration) return res.status(404).json({ error: 'Demande introuvable.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { reference: registration.reference, businessName: registration.businessName, username: registration.username,
      status: registration.status, decisionReason: registration.decisionReason, decidedAt: registration.decidedAt, createdAt: registration.createdAt } });
  });

  app.post('/api/public/merchant-registrations/lookup', checkSameOrigin, async (req, res) => {
    if (!allow(`lookup:${req.ip || 'unknown'}`, 12, 10 * 60_000)) return res.status(429).json({ error: 'Trop de recherches. Réessayez dans quelques minutes.' });
    const reference = String(req.body?.reference || '').trim().toUpperCase();
    if (!/^INSC-[0-9]{8}-[0-9A-F]{6}$/.test(reference)) return res.status(400).json({ error: 'Référence de dossier invalide.' });
    const registration = await lifecycle.getRegistration(reference);
    if (!registration) return res.status(404).json({ error: 'Aucune demande ne correspond à cette référence.' });
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: { reference: registration.reference, businessName: registration.businessName, status: registration.status,
      decisionReason: registration.decisionReason, decidedAt: registration.decidedAt, createdAt: registration.createdAt } });
  });

  // ------------------------------------------------------------------------------------------
  // PDG : fonctionnalités, demandes, décisions, historique
  // ------------------------------------------------------------------------------------------
  // Lecture des bascules par un espace authentifié : permet de masquer une fonction coupée
  // sans exposer le moindre réglage du PDG en public.
  for (const [pathName, guard] of [['/api/merchant/merchant-lifecycle/features', requireMerchant], ['/api/manager/merchant-lifecycle/features', requireManager]]) {
    app.get(pathName, guard, async (_req, res) => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: await featureFlags() });
    });
  }
  app.get('/api/admin/merchant-lifecycle/features', requireAdmin, async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.json({ data: await featureFlags() });
  });
  app.put('/api/admin/merchant-lifecycle/features', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const settings = await store.getSettings();
      const current = { ...(settings.merchantLifecycleFeatures || {}) };
      for (const key of FEATURE_KEYS) if (typeof req.body?.[key] === 'boolean') current[key] = req.body[key];
      // Settings are stored per key: only the new key is written, nothing else is rewritten.
      await store.updateSettings({ merchantLifecycleFeatures: current });
      await store.addAudit({ actor: 'PDG', actorType: 'admin', actorId: String(process.env.ADMIN_USERNAME || 'admin'), action: 'features_updated',
        entityType: 'settings', entityId: 'merchantLifecycleFeatures', summary: 'Fonctionnalités du cycle de vie marchand mises à jour.', metadata: current });
      res.json({ data: await featureFlags() });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer ces réglages.'); }
  });

  app.get('/api/admin/merchant-registrations', requireAdmin, async (req, res) => {
    try {
      const status = String(req.query.status || '');
      if (status && status !== 'all' && status !== 'open' && !REGISTRATION_STATUSES.includes(status)) return res.status(400).json({ error: 'Filtre de statut invalide.' });
      const result = await lifecycle.listRegistrations({ status, search: String(req.query.search || ''), limit: Math.min(100, Number(req.query.limit) || 50), page: Math.max(1, Number(req.query.page) || 1) });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...result, counts: await lifecycle.registrationCounts() });
    } catch (error) { apiError(res, error, 'Impossible de charger les demandes d’inscription.'); }
  });
  app.get('/api/admin/merchant-registrations/:registrationId', requireAdmin, async (req, res) => {
    try {
      const registration = await lifecycle.getRegistration(req.params.registrationId);
      if (!registration) return res.status(404).json({ error: 'Demande introuvable.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { ...registration, events: await lifecycle.listEvents(registration.id) } });
    } catch (error) { apiError(res, error, 'Impossible de charger cette demande.'); }
  });
  app.post('/api/admin/merchant-registrations/:registrationId/decision', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const action = String(req.body?.action || '');
      if (!['approve', 'reject', 'review', 'suspend'].includes(action)) return res.status(400).json({ error: 'Décision invalide.' });
      const result = await lifecycle.decide(req.params.registrationId, action, { reason: req.body?.reason, note: req.body?.note, actor: actorFor('admin', req) });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: result });
    } catch (error) { return mapError(res, error, 'Impossible d’enregistrer cette décision.'); }
  });

  app.get('/api/admin/merchant-lifecycle/registrations-history', requireAdmin, async (req, res) => {
    try {
      const rows = await store.listAudit({ page: Math.max(1, Number(req.query.page) || 1), limit: Math.min(100, Number(req.query.limit) || 30), entityType: 'merchant_registration' });
      res.json(rows);
    } catch (error) { apiError(res, error, 'Impossible de charger l’historique des validations.'); }
  });

  // ------------------------------------------------------------------------------------------
  // Gestionnaire agréé : mêmes décisions, uniquement si le PDG a donné la permission
  // ------------------------------------------------------------------------------------------
  function requireRegistrationValidator(req, res, next) {
    if (req.manager?.canValidateMerchantRegistrations !== true) {
      store.addAudit({ actor: `${req.manager?.displayName || 'Gestionnaire'} (@${req.manager?.username || ''})`, actorType: 'manager',
        actorId: req.manager?.id, managerId: req.manager?.id, action: 'authorization_denied', entityType: 'merchant_registration',
        entityId: 'registration', summary: 'Validation d’inscription refusée : permission non accordée par le PDG.', result: 'denied' }).catch(() => {});
      return res.status(403).json({ error: 'Le PDG ne vous a pas autorisé à valider les inscriptions marchands.', code: 'REGISTRATION_VALIDATION_FORBIDDEN' });
    }
    return next();
  }
  app.get('/api/manager/merchant-registrations', requireManager, requireRegistrationValidator, async (req, res) => {
    try {
      const status = String(req.query.status || '');
      if (status && status !== 'all' && status !== 'open' && !REGISTRATION_STATUSES.includes(status)) return res.status(400).json({ error: 'Filtre de statut invalide.' });
      const result = await lifecycle.listRegistrations({ status, search: String(req.query.search || ''), limit: Math.min(100, Number(req.query.limit) || 50), page: Math.max(1, Number(req.query.page) || 1) });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ ...result, counts: await lifecycle.registrationCounts() });
    } catch (error) { apiError(res, error, 'Impossible de charger les demandes d’inscription.'); }
  });
  app.get('/api/manager/merchant-registrations/:registrationId', requireManager, requireRegistrationValidator, async (req, res) => {
    try {
      const registration = await lifecycle.getRegistration(req.params.registrationId);
      if (!registration) return res.status(404).json({ error: 'Demande introuvable.' });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { ...registration, events: await lifecycle.listEvents(registration.id) } });
    } catch (error) { apiError(res, error, 'Impossible de charger cette demande.'); }
  });
  app.post('/api/manager/merchant-registrations/:registrationId/decision', requireManager, checkSameOrigin, requireRegistrationValidator, async (req, res) => {
    try {
      const action = String(req.body?.action || '');
      if (!['approve', 'reject', 'review'].includes(action)) return res.status(400).json({ error: 'Décision invalide pour un gestionnaire.' });
      const result = await lifecycle.decide(req.params.registrationId, action, { reason: req.body?.reason, note: req.body?.note, actor: actorFor('manager', req) });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: result });
    } catch (error) { return mapError(res, error, 'Impossible d’enregistrer cette décision.'); }
  });

  // ------------------------------------------------------------------------------------------
  // Statistiques de scans (marchand : ses propres données uniquement)
  // ------------------------------------------------------------------------------------------
  app.get('/api/merchant/scan-stats', requireMerchant, async (req, res) => {
    try {
      const days = ['7', '30', '90', 'all'].includes(String(req.query.period || '')) ? String(req.query.period) : '30';
      const storeRow = await commerce.getStoreByMerchantId(req.merchant.id);
      if (!storeRow) return res.json({ data: { counts: { customer: 0, merchant: 0, unknown: 0, total: 0, legacy: 0, platformTotal: 0 }, timeline: [], weekly: [], monthly: [], top: [], history: [] } });
      const stats = await lifecycle.scanStats({ storeId: storeRow.id, days: days === 'all' ? 0 : Number(days) });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { ...stats, period: days, scope: { storeId: storeRow.id, storeName: storeRow.name } } });
    } catch (error) { apiError(res, error, 'Impossible de charger vos statistiques de scans.'); }
  });
  app.get('/api/admin/scan-stats/merchant-qr', requireAdmin, async (req, res) => {
    try {
      const days = ['7', '30', '90', 'all'].includes(String(req.query.period || '')) ? String(req.query.period) : '30';
      const storeId = String(req.query.storeId || '');
      const stats = await lifecycle.scanStats({ storeId, days: days === 'all' ? 0 : Number(days) });
      const stores = (await commerce.listMerchants()).map((row) => ({ id: row.storeId, name: row.storeName || row.displayName, slug: row.storeSlug, merchantId: row.id, managerId: row.managerId }));
      res.setHeader('Cache-Control', 'no-store');
      const byStore = [];
      for (const entry of stores.filter((row) => row.id)) {
        const scoped = await lifecycle.scanStats({ storeId: entry.id, days: days === 'all' ? 0 : Number(days) });
        byStore.push({ storeId: entry.id, name: entry.name, slug: entry.slug, managerId: entry.managerId, counts: scoped.counts });
      }
      res.json({ data: { ...stats, period: days, stores: stores.filter((row) => row.id), byStore } });
    } catch (error) { apiError(res, error, 'Impossible de charger les statistiques de scans marchands.'); }
  });
};
