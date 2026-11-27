'use strict';

// ============================================================================================
// MISSION 8 — ROUTES DU CONTRÔLE TOTAL DU PDG (partie 2)
//
//   INSCRIPTIONS
//     GET  /api/admin/control/registrations                 liste filtrée (statut, type, gestionnaire, dates)
//     GET  /api/admin/control/registrations/:id            dossier complet + photos + gestionnaire + marqueur terrain
//     GET  /api/admin/control/registrations/:id/photos/:pid  photo en grand (binaire)
//     POST /api/admin/control/registrations/:id/request-info  demander des informations complémentaires
//     POST /api/admin/control/merchants/:id/suspend         suspendre / réactiver un compte marchand
//
//   COMPTES MARCHANDS (fiche 360°)
//     GET  /api/admin/control/merchants                     liste + statut + quota
//     GET  /api/admin/control/merchants/:id                 fiche complète (identité, QR, produits, commandes,
//                                                           consignations, équipe, scans, activité)
//     PATCH /api/admin/control/merchants/:id                corriger les informations
//
//   COMPTES GESTIONNAIRES
//     GET  /api/admin/control/managers                      liste + compteurs
//     GET  /api/admin/control/managers/:id                  fiche détaillée
//     PATCH /api/admin/control/managers/:id                 permissions (dont codes terrain)
//     POST /api/admin/control/managers/:id/status           suspendre / réactiver / bloquer
//
//   POINTS DES GESTIONNAIRES (protégés)
//     GET  /api/admin/control/managers/:id/points           solde + journal
//     POST /api/admin/control/managers/:id/points           correction administrative motivée
//     POST /api/admin/control/managers/:id/points-code      définir / réinitialiser le code de sécurité
//     POST /api/admin/control/managers/:id/points-code-policy  exiger ou non le code à la consultation
//     GET  /api/manager/control/points                      consultation protégée par le code
//
// RÈGLES : toute écriture vérifie la permission côté serveur, écrit dans le journal, et déclenche
// la notification correspondante. Aucune route ne renvoie de code en clair après sa création.
// ============================================================================================

const { resolveTeamQuotas } = require('./admin-control');

module.exports = function registerAdminControlRoutes2(deps) {
  const { app, store, adminControl, team, commerce, lifecycle, requireAdmin, requireManager, checkSameOrigin, apiError, sessions = null,
    customAppearance = null } = deps;
  const text = (value, max = 500) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const adminActor = () => ({ type: 'admin', id: String(process.env.ADMIN_USERNAME || 'admin'), label: 'PDG' });
  const managerActor = (req) => ({ type: 'manager', id: String(req.manager.id), label: `Gestionnaire ${req.manager.displayName} (@${req.manager.username})` });
  const page = (value) => Math.max(1, Number(value) || 1);
  const limit = (value, max = 100) => Math.min(max, Math.max(1, Number(value) || 25));
  const fail = (res, error, fallback) => {
    if (error?.status && error?.code) return res.status(error.status).json({ error: error.message, code: error.code });
    return apiError(res, error, fallback);
  };

  // ---------------------------------------------------------------------------------------------
  // MISSION 15 — APPARENCE GLOBALE (couleurs, polices, tailles)
  //   GET  /api/admin/control/interface-custom       réglage courant + palette + polices + contrastes
  //   PUT  /api/admin/control/interface-custom       enregistrer (refus si un texte devient illisible)
  //   POST /api/admin/control/interface-custom/reset revenir aux valeurs d'origine
  // Aucune donnée commerciale n'est touchée : seul un objet de style est rangé dans les réglages.
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/interface-custom', requireAdmin, async (_req, res) => {
    try {
      const settings = await store.getSettings();
      const current = customAppearance.normalize(settings?.interfaceCustom || {});
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: {
        custom: current,
        colors: customAppearance.COLOR_KEYS.map(([key, label, value]) => ({ key, label, value })),
        fonts: customAppearance.FONTS.map(([id, label]) => ({ id, label })),
        ranges: { baseSize: [14, 20], weight: [300, 700], lineHeight: [1.3, 1.9], radius: [8, 24] },
        readability: customAppearance.readability(current.colors),
        describe: customAppearance.describe(current),
      } });
    } catch (error) { fail(res, error, 'Impossible de lire l’apparence globale.'); }
  });

  app.put('/api/admin/control/interface-custom', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      if (!customAppearance) return res.status(503).json({ error: 'Personnalisation indisponible.' });
      const settings = await store.getSettings();
      const before = customAppearance.normalize(settings?.interfaceCustom || {});
      const checked = customAppearance.validate(req.body || {}, before);
      if (!checked.ok) {
        return res.status(400).json({ error: checked.error, code: 'CONTRAST_TOO_LOW', readability: checked.pairs });
      }
      const value = { ...checked.value, updatedAt: new Date().toISOString(), updatedBy: 'PDG' };
      await store.updateSettings({ interfaceCustom: value });
      await adminControl.journal({ actor: adminActor(), action: 'interface_appearance_updated',
        entityType: 'settings', entityId: 'interfaceCustom', summary: customAppearance.describe(value),
        before: { enabled: before.enabled, mode: before.mode, colors: before.colors, font: before.font },
        after: { enabled: value.enabled, mode: value.mode, colors: value.colors, font: value.font }, req });
      res.json({ ok: true, data: { custom: value, variables: customAppearance.cssVariables(value),
        readability: customAppearance.readability(value.colors), describe: customAppearance.describe(value) } });
    } catch (error) { fail(res, error, 'Impossible d’enregistrer l’apparence globale.'); }
  });

  app.post('/api/admin/control/interface-custom/reset', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const settings = await store.getSettings();
      const before = customAppearance.normalize(settings?.interfaceCustom || {});
      const value = { ...customAppearance.DEFAULTS, enabled: false, updatedAt: new Date().toISOString(), updatedBy: 'PDG' };
      await store.updateSettings({ interfaceCustom: value });
      await adminControl.journal({ actor: adminActor(), action: 'interface_appearance_reset',
        entityType: 'settings', entityId: 'interfaceCustom',
        summary: 'Apparence globale remise aux valeurs par défaut : chaque compte retrouve son thème.',
        before: { enabled: before.enabled, mode: before.mode }, after: { enabled: false }, req });
      res.json({ ok: true, data: { custom: value } });
    } catch (error) { fail(res, error, 'Impossible de réinitialiser l’apparence.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // MISSION 15 — SESSIONS MARCHANDES
  //   GET  /api/admin/control/merchant-sessions                 toutes les sessions connues
  //   POST /api/admin/control/merchant-sessions/:merchantId/revoke   révoquer la session active
  // Chaque révocation est journalisée : le PDG doit pouvoir retrouver qui a coupé quoi.
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/merchant-sessions', requireAdmin, async (req, res) => {
    try {
      if (!sessions) return res.json({ data: [], limits: null });
      const rows = await sessions.list({ onlyLive: String(req.query.live || '') === '1' });
      res.json({ data: rows, limits: { idleMinutes: Math.round(sessions.IDLE_SECONDS / 60), maxHours: sessions.MAX_HOURS } });
    } catch (error) { fail(res, error, 'Impossible de lire les sessions marchandes.'); }
  });

  app.post('/api/admin/control/merchant-sessions/:merchantId/revoke', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      if (!sessions) return res.status(503).json({ error: 'Gestion des sessions indisponible.' });
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const revoked = await sessions.revoke(merchant.id, 'PDG');
      if (!revoked) return res.status(409).json({ error: 'Ce compte n’a aucune session active à révoquer.' });
      await adminControl.journal({ actor: adminActor(), action: 'merchant_session_revoked',
        entityType: 'merchant', entityId: merchant.id, merchantId: merchant.id,
        summary: `Session marchande révoquée par le PDG pour « ${merchant.displayName} » (@${merchant.username}).`,
        before: { sessionId: revoked.sessionId, startedAt: revoked.startedAt }, after: { revoked: true }, req });
      res.json({ ok: true, data: revoked });
    } catch (error) { fail(res, error, 'Impossible de révoquer cette session.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // INSCRIPTIONS — liste filtrée
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/registrations', requireAdmin, async (req, res) => {
    try {
      const filters = {
        status: text(req.query.status, 20), search: text(req.query.search, 120),
        from: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || '')) ? String(req.query.from) : '',
        to: /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || '')) ? String(req.query.to) : '',
        // type : self_service (demande directe) | field (par code terrain)
        type: ['self_service', 'field'].includes(String(req.query.type)) ? String(req.query.type) : '',
        managerId: text(req.query.managerId, 80),
      };
      const result = await lifecycle.listRegistrations({ status: filters.status || 'all', search: filters.search,
        limit: limit(req.query.limit, 100), page: page(req.query.page) });
      // Les filtres complémentaires (date, type, gestionnaire) sont appliqués ici car la couche
      // historique ne les connaît pas : aucune ligne n'est perdue, seules les colonnes ajoutées
      // par la Mission 8 servent à filtrer.
      let rows = Array.isArray(result.data) ? result.data : Object.values(result.data || {});
      if (filters.from) rows = rows.filter((row) => String(row.createdAt || '').slice(0, 10) >= filters.from);
      if (filters.to) rows = rows.filter((row) => String(row.createdAt || '').slice(0, 10) <= filters.to);
      if (filters.type === 'field') rows = rows.filter((row) => Boolean(row.fieldManagerId || row.fieldCodeId));
      if (filters.type === 'self_service') rows = rows.filter((row) => !row.fieldManagerId && !row.fieldCodeId);
      if (filters.managerId) rows = rows.filter((row) => row.fieldManagerId === filters.managerId);
      // Libellé du gestionnaire : relu depuis le compte pour ne pas dépendre d'un champ figé.
      const managerIds = [...new Set(rows.map((row) => row.fieldManagerId).filter(Boolean))];
      const managers = managerIds.length ? await Promise.all(managerIds.map((id) => store.getManager(id, { includeDeleted: true }).catch(() => null))) : [];
      const labelById = new Map(managers.filter(Boolean).map((manager) => [manager.id, `${manager.displayName} (@${manager.username})`]));
      rows = rows.map((row) => ({ ...row, fieldManagerLabel: labelById.get(row.fieldManagerId) || '',
        source: row.fieldManagerId || row.fieldCodeId ? 'field' : 'self_service' }));
      // Compteurs par statut : toujours globaux (le PDG voit l'ampleur réelle de la file).
      const counts = await lifecycle.registrationCounts().catch(() => ({}));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: rows, total: rows.length, counts, filters,
        pagination: { page: result.page || 1, limit: result.limit || 25, total: result.total || rows.length } });
    } catch (error) { return apiError(res, error, 'Impossible de charger les inscriptions.'); }
  });

  app.get('/api/admin/control/registrations/:registrationId', requireAdmin, async (req, res) => {
    try {
      const registration = await lifecycle.getRegistration(String(req.params.registrationId)).catch(() => null);
      if (!registration) return res.status(404).json({ error: 'Dossier introuvable.' });
      const photos = await adminControl.listRegistrationPhotos(registration.id, { withData: false });
      const events = await lifecycle.listEvents(registration.id).catch(() => []);
      const manager = registration.fieldManagerId ? await store.getManager(registration.fieldManagerId, { includeDeleted: true }).catch(() => null) : null;
      const codeRow = registration.fieldCodeId && team?.pg
        ? (await team.base.pool.query('SELECT id, code_hint AS hint, created_at AS "createdAt", used_at AS "usedAt" FROM field_enrollment_codes WHERE id=$1', [registration.fieldCodeId]).catch(() => ({ rows: [] }))).rows[0]
        : null;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { ...registration, photos, events,
        field: manager ? { managerId: manager.id, managerName: manager.displayName, managerUsername: manager.username,
          phone: manager.phone, codeHint: codeRow?.hint || '' } : null } });
    } catch (error) { return apiError(res, error, 'Impossible de charger ce dossier.'); }
  });

  // Photo en grand : servie en binaire (jamais en JSON base64) pour ne pas alourdir la fiche.
  app.get('/api/admin/control/registrations/:registrationId/photos/:photoId', requireAdmin, async (req, res) => {
    try {
      const photo = await adminControl.getRegistrationPhoto(String(req.params.registrationId), String(req.params.photoId));
      if (!photo) return res.status(404).json({ error: 'Photo introuvable.' });
      const match = /^data:(image\/(?:png|jpeg|webp));base64,(.+)$/i.exec(String(photo.dataUri || ''));
      if (!match) return res.status(422).json({ error: 'Photo illisible.' });
      const bytes = Buffer.from(match[2], 'base64');
      res.setHeader('Content-Type', match[1].toLowerCase());
      res.setHeader('Content-Length', String(bytes.length));
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      return res.end(bytes);
    } catch (error) { return apiError(res, error, 'Impossible d’ouvrir cette photo.'); }
  });

  app.post('/api/admin/control/registrations/:registrationId/request-info', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const message = text(req.body?.message, 800);
      if (message.length < 10) return res.status(400).json({ error: 'Précisez ce qui manque au demandeur (10 caractères minimum).' });
      const registration = await lifecycle.getRegistration(String(req.params.registrationId), { includeSecrets: false }).catch(() => null);
      if (!registration) return res.status(404).json({ error: 'Dossier introuvable.' });
      // Statut dédié : le demandeur est relancé sans que le dossier soit refusé.
      const updated = await lifecycle.requestMoreInfo(registration.id, { message, actor: adminActor() });
      await adminControl.journal({ actor: adminActor(), action: 'registration_info_requested', entityType: 'merchant_registration',
        entityId: registration.id, summary: `Informations complémentaires demandées pour ${registration.reference}.`, after: { message }, req });
      await adminControl.notify({ type: 'registration_info_requested', severity: 'info', title: 'Informations complémentaires demandées',
        body: `${registration.businessName} — ${message}`, linkView: 'admin-registrations', linkId: registration.id,
        dedupeKey: `info:${registration.id}:${Date.now()}` });
      return res.json({ data: updated });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer cette demande.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // SUSPENDRE / RÉACTIVER UN COMPTE MARCHAND
  // ---------------------------------------------------------------------------------------------
  app.post('/api/admin/control/merchants/:merchantId/account-status', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const status = text(req.body?.status, 20);
      if (!['active', 'suspended', 'blocked'].includes(status)) return res.status(400).json({ error: 'Statut invalide (active, suspended ou blocked).' });
      const reason = text(req.body?.reason, 300);
      if (status !== 'active' && reason.length < 3) return res.status(400).json({ error: 'Indiquez le motif de cette suspension.' });
      const before = { status: merchant.status, statusReason: merchant.statusReason };
      await commerce.updateMerchant(merchant.id, { ...merchant, status, statusReason: status === 'active' ? '' : reason });
      // Une suspension doit révoquer les sessions actives du marchand. updateMerchant incrémente
      // `token_version`, ce qui invalide immédiatement tous les cookies déjà émis pour ce compte
      // (le middleware marchand compare la version de session) — sans toucher aux autres comptes.
      await adminControl.journal({ actor: adminActor(), action: status === 'active' ? 'account_reactivated' : 'account_suspended',
        entityType: 'merchant', entityId: merchant.id, merchantId: merchant.id,
        summary: `Compte « ${merchant.displayName} » ${status === 'active' ? 'réactivé' : `suspendu (${status})`} : ${reason || 'sans motif'}.`,
        before, after: { status, reason }, req });
      await adminControl.notify({ type: 'account_status', severity: status === 'active' ? 'success' : 'warning',
        title: status === 'active' ? 'Compte marchand réactivé' : 'Compte marchand suspendu',
        body: `${merchant.displayName} — ${reason || (status === 'active' ? 'réactivé' : status)}`,
        linkView: 'admin-merchants', linkId: merchant.id, dedupeKey: `acct:${merchant.id}:${status}:${Date.now()}` });
      await commerce.addNotification({ merchantId: merchant.id, type: 'account_status', dedupeKey: `acct:${merchant.id}:${status}:${Date.now()}`,
        title: status === 'active' ? 'Votre compte est réactivé' : 'Votre compte est suspendu',
        message: status === 'active' ? 'Le PDG a réactivé votre espace marchand.' : `Le PDG a suspendu votre compte : ${reason}`,
        data: { status } }).catch(() => {});
      return res.json({ data: { merchant: await commerce.getMerchant(merchant.id) } });
    } catch (error) { return apiError(res, error, 'Impossible de changer le statut de ce compte.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // COMPTES MARCHANDS — liste
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/merchants', requireAdmin, async (req, res) => {
    try {
      const search = text(req.query.search, 120).toLowerCase();
      const status = text(req.query.status, 20);
      let merchantRows = [];
      // Valeurs par défaut de la plateforme (jamais inventées : ce sont les limites réellement
      // appliquées par le contrôle PDG quand le marchand n'a ni dépassement ni héritage).
      const platformQuotas = await resolveTeamQuotas(deps, '__platform__').catch(() => null);
      const limits = { maxGeneralManagers: Number(platformQuotas?.platform?.maxGeneralManagersPerMerchant ?? 1),
        maxWaitresses: Number(platformQuotas?.platform?.maxWaitressesPerMerchant ?? 2) };
      if (team?.pg) {
        const { rows } = await team.base.pool.query(
          `SELECT a.id, a.username, a.display_name AS "displayName", a.phone, a.email, a.status,
                  a.created_at AS "createdAt", a.last_login_at AS "lastLoginAt",
                  s.name AS "storeName", s.slug AS "storeSlug", s.is_published AS "storePublished",
                  COALESCE(o.max_general_managers, a.team_quota_general_managers, $1::int) AS "maxGeneralManagers",
                  COALESCE(o.max_waitresses, a.team_quota_waitresses, $2::int) AS "maxWaitresses",
                  COUNT(tm.id) FILTER (WHERE tm.role='general_manager' AND tm.status <> 'archived')::int AS "usedGeneralManagers",
                  COUNT(tm.id) FILTER (WHERE tm.role='waitress' AND tm.status <> 'archived')::int AS "usedWaitresses",
                  -- Le nombre de QR vit dans le module commerce : la table qr_codes ne porte pas de
                  -- marchand. On compte donc les QR de la boutique du marchand.
                  (CASE WHEN s.qr_public_code IS NOT NULL THEN 1 ELSE 0 END) AS "qrCount",
                  (SELECT COUNT(*)::int FROM merchant_orders o2 WHERE o2.merchant_id=a.id) AS "orderCount",
                  (SELECT COUNT(*)::int FROM merchant_scan_events e WHERE e.merchant_id=a.id) AS "scanCount",
                  -- Mission 9 : gestionnaire qui accompagne réellement le marchand (rattachement
                  -- d'inscription ou attribution manuelle du PDG) et état de son compte, pour
                  -- repérer les marchands devenus orphelins (gestionnaire parti, suspendu).
                  COALESCE(a.manager_id, am.manager_id) AS "managerId",
                  COALESCE(mgr.display_name, smgr.display_name) AS "managerName",
                  COALESCE(mgr.username, smgr.username) AS "managerUsername",
                  COALESCE(mgr.status, smgr.status) AS "managerStatus",
                  (COALESCE(mgr.id, smgr.id) IS NULL OR COALESCE(mgr.deleted_at, smgr.deleted_at) IS NOT NULL
                    OR COALESCE(mgr.status, smgr.status) <> 'active') AS "managerUnavailable",
                  (COALESCE(mgr.id, smgr.id) IS NOT NULL) AS "hasSupervisor"
             FROM merchant_accounts a
             LEFT JOIN managers mgr ON mgr.id = a.manager_id
             LEFT JOIN LATERAL (SELECT ma.manager_id FROM merchant_manager_assignments ma
                                 WHERE ma.merchant_id = a.id ORDER BY ma.manager_id LIMIT 1) am ON TRUE
             LEFT JOIN managers smgr ON smgr.id = am.manager_id
             LEFT JOIN merchant_stores s ON s.merchant_id = a.id
             LEFT JOIN merchant_team_quota_overrides o ON o.merchant_id = a.id
             LEFT JOIN team_members tm ON tm.merchant_id = a.id
            WHERE a.deleted_at IS NULL
            GROUP BY a.id, a.username, a.display_name, a.phone, a.email, a.status, a.created_at, a.last_login_at,
                     s.name, s.slug, s.is_published, s.qr_public_code, o.max_general_managers, o.max_waitresses,
                     a.team_quota_general_managers, a.team_quota_waitresses,
                     a.manager_id, am.manager_id, mgr.id, mgr.display_name, mgr.username, mgr.status, mgr.deleted_at,
                     smgr.id, smgr.display_name, smgr.username, smgr.status, smgr.deleted_at
            ORDER BY a.created_at DESC LIMIT 300`, [limits.maxGeneralManagers, limits.maxWaitresses])
          .catch((error) => { console.error('[control] liste marchands :', error.message); return { rows: [] }; });
        merchantRows = rows;
      } else {
        merchantRows = (await commerce.listMerchants({ includeDeleted: false }).catch(() => [])).map((merchant) => ({
          id: merchant.id, username: merchant.username, displayName: merchant.displayName, phone: merchant.phone,
          email: merchant.email, status: merchant.status, createdAt: merchant.createdAt,
        }));
      }
      const filtered = merchantRows.filter((row) => (!status || row.status === status) &&
        (!search || [row.displayName, row.username, row.phone, row.storeName].some((value) => String(value || '').toLowerCase().includes(search))));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: filtered, total: filtered.length });
    } catch (error) { return apiError(res, error, 'Impossible de charger les comptes marchands.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // COMPTES MARCHANDS — fiche 360°
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/merchants/:merchantId', requireAdmin, async (req, res) => {
    try {
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const quotas = await resolveTeamQuotas(deps, merchant.id);
      const storeRow = await commerce.getStoreByMerchantId(merchant.id).catch(() => null);
      const registration = team?.pg
        ? (await team.base.pool.query(
          `SELECT id, reference, status, contact_name AS "contactName", business_name AS "businessName", phone, email,
                  city, location, address, activity_domain AS "activityDomain", description, created_at AS "createdAt",
                  decided_at AS "decidedAt", decided_by_label AS "decidedByLabel", field_manager_id AS "fieldManagerId",
                  field_code_id AS "fieldCodeId", info_requested AS "infoRequested"
             FROM merchant_registrations WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 1`, [merchant.id]).catch(() => ({ rows: [] }))).rows[0] : null;
      const photos = registration ? await adminControl.listRegistrationPhotos(registration.id, { withData: false }).catch(() => []) : [];

      let detail = { team: [], qrCodes: [], products: [], orders: [], consignments: [], scans: { total: 0, last30: 0 }, activity: [], counts: {} };
      if (team?.pg) {
        const pool = team.base.pool;
        const [members, qrCodes, products, orders, consignments, scanCounts, activity] = await Promise.all([
          pool.query(`SELECT id, role, designation, full_name AS "fullName", phone, username, status, points,
                             last_login_at AS "lastLoginAt", created_at AS "createdAt"
                        FROM team_members WHERE merchant_id=$1 ORDER BY role, designation`, [merchant.id]).catch(() => ({ rows: [] })),
          pool.query(`SELECT id, name, public_code AS "publicCode", kind, status, scan_count AS "scanCount", created_at AS "createdAt"
                        FROM qr_codes WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 50`, [merchant.id]).catch(() => ({ rows: [] })),
          pool.query(`SELECT COUNT(*)::int AS total FROM merchant_products WHERE merchant_id=$1`, [merchant.id]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query(`SELECT id, public_reference AS reference, status, total_amount_xof AS "totalXof",
                             payment_status AS "paymentStatus", created_at AS "createdAt",
                             COALESCE(created_by_designation, created_by_type) AS "createdBy"
                        FROM merchant_orders WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT 15`, [merchant.id]).catch(() => ({ rows: [] })),
          pool.query(`SELECT COUNT(*)::int AS total,
                             COUNT(*) FILTER (WHERE status='open')::int AS open,
                             COALESCE(SUM(quantity) FILTER (WHERE status='open'),0)::int AS "openUnits"
                        FROM consignments WHERE merchant_id=$1`, [merchant.id]).catch(() => ({ rows: [{ total: 0, open: 0, openUnits: 0 }] })),
          pool.query(`SELECT COUNT(*)::int AS total,
                             COUNT(*) FILTER (WHERE scanned_at > NOW() - INTERVAL '30 days')::int AS last30
                        FROM merchant_scan_events WHERE merchant_id=$1`, [merchant.id]).catch(() => ({ rows: [{ total: 0, last30: 0 }] })),
          adminControl.listJournal({ merchantId: merchant.id, limit: 25 }).catch(() => []),
        ]);
        detail = { team: members.rows,
          qrCodes: qrCodes.rows,
          products: { total: Number(products.rows[0]?.total || 0) },
          orders: { recent: orders.rows, total: Number((await pool.query('SELECT COUNT(*)::int AS total FROM merchant_orders WHERE merchant_id=$1', [merchant.id]).catch(() => ({ rows: [{ total: 0 }] }))).rows[0]?.total || 0) },
          consignments: consignments.rows[0] || { total: 0, open: 0, openUnits: 0 },
          scans: scanCounts.rows[0] || { total: 0, last30: 0 },
          activity,
          counts: {
            generalManagers: members.rows.filter((m) => m.role === 'general_manager' && m.status !== 'archived').length,
            waitresses: members.rows.filter((m) => m.role === 'waitress' && m.status !== 'archived').length,
          } };
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { merchant, store: storeRow, registration: registration ? { ...registration, photos } : null,
        quotas, ...detail } });
    } catch (error) { return apiError(res, error, 'Impossible de charger la fiche de ce marchand.'); }
  });

  app.patch('/api/admin/control/merchants/:merchantId', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const patch = {};
      for (const key of ['displayName', 'phone', 'email']) if (req.body?.[key] !== undefined) patch[key] = text(req.body[key], 160);
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Aucune information modifiable fournie.' });
      const before = Object.fromEntries(Object.keys(patch).map((key) => [key, merchant[key]]));
      await commerce.updateMerchant(merchant.id, { ...merchant, ...patch });
      await adminControl.journal({ actor: adminActor(), action: 'merchant_updated', entityType: 'merchant', entityId: merchant.id,
        merchantId: merchant.id, summary: `Informations du compte « ${merchant.displayName} » corrigées par le PDG.`, before, after: patch, req });
      return res.json({ data: { merchant: await commerce.getMerchant(merchant.id) } });
    } catch (error) { return apiError(res, error, 'Impossible de corriger ces informations.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // COMPTES GESTIONNAIRES
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/managers', requireAdmin, async (_req, res) => {
    try {
      const managers = await store.listManagers({ includeDeleted: true }).catch(() => []);
      const enriched = [];
      for (const manager of managers) {
        const counters = { codesGenerated: 0, codesUsed: 0, enrollments: 0, points: 0 };
        if (team?.pg) {
          const { rows } = await team.base.pool.query(
            `SELECT (SELECT COUNT(*)::int FROM field_enrollment_codes WHERE manager_id=$1) AS "codesGenerated",
                    (SELECT COUNT(*)::int FROM field_enrollment_codes WHERE manager_id=$1 AND uses > 0) AS "codesUsed",
                    (SELECT COUNT(*)::int FROM field_code_uses WHERE manager_id=$1) AS enrollments,
                    COALESCE((SELECT points FROM manager_points WHERE manager_id=$1),0)::int AS points`,
            [manager.id]).catch(() => ({ rows: [counters] }));
          Object.assign(counters, rows[0] || {});
        } else {
          counters.codesGenerated = (store.state?.fieldEnrollmentCodes || []).filter((row) => row.managerId === manager.id).length;
          counters.enrollments = (store.state?.fieldCodeUses || []).filter((row) => row.managerId === manager.id).length;
        }
        enriched.push({ id: manager.id, username: manager.username, displayName: manager.displayName, email: manager.email,
          phone: manager.phone, status: manager.status, createdAt: manager.createdAt, lastLoginAt: manager.lastLoginAt,
          permissions: { canCreateCodes: manager.canCreateCodes, canValidateMerchantRegistrations: manager.canValidateMerchantRegistrations,
            canManageMerchants: manager.canManageMerchants, canCreateFieldCodes: manager.canCreateFieldCodes === true },
          pointsProtected: manager.pointsCodeRequired === true || Boolean(manager.pointsCodeHash),
          ...counters });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: enriched });
    } catch (error) { return apiError(res, error, 'Impossible de charger les comptes gestionnaires.'); }
  });

  app.get('/api/admin/control/managers/:managerId', requireAdmin, async (req, res) => {
    try {
      const managerId = String(req.params.managerId);
      const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const codes = await adminControl.listFieldCodes({ actor: adminActor(), managerId }).catch(() => ({ data: [], counts: {} }));
      const history = await adminControl.fieldCodeHistory({ managerId, limit: 50 }).catch(() => []);
      const journal = await adminControl.listJournal({ managerId, limit: 50 }).catch(() => []);
      let points = { points: 0, events: [] };
      if (team?.pg) {
        points = await managerPoints(managerId).catch(() => points);
      } else {
        const row = (store.state?.managerPoints || []).find((item) => item.managerId === managerId);
        points = { points: Number(row?.points || 0), events: (store.state?.managerPointEvents || []).filter((item) => item.managerId === managerId).slice(0, 50) };
      }
      // Marchands attribués au gestionnaire (affectation explicite ou rattachement historique).
      const merchants = team?.pg
        ? (await team.base.pool.query(
          `SELECT a.id, a.display_name AS "displayName", a.status,
                  mm.manager_id IS NOT NULL AS "assigned",
                  COALESCE(mm.can_manage_store,false) AS "canManageStore",
                  COALESCE(mm.can_manage_orders,false) AS "canManageOrders"
             FROM merchant_accounts a
             LEFT JOIN merchant_manager_assignments mm ON mm.merchant_id = a.id AND mm.manager_id = $1
            WHERE mm.manager_id = $1 OR a.manager_id = $1
            ORDER BY a.display_name LIMIT 200`, [managerId]).catch(() => ({ rows: [] }))).rows : [];
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { manager: { ...manager, pointsCodeHash: undefined, pointsCodeHint: manager.pointsCodeHash ? 'défini' : '' },
        codes, history, journal, points, merchants } });
    } catch (error) { return apiError(res, error, 'Impossible de charger la fiche de ce gestionnaire.'); }
  });

  app.patch('/api/admin/control/managers/:managerId', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const managerId = String(req.params.managerId);
      const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const allowed = ['canCreateCodes', 'canEditCodes', 'canManageMerchants', 'canValidateMerchantRegistrations', 'canCreateFieldCodes', 'canViewFieldHistory'];
      const patch = {};
      for (const key of allowed) if (typeof req.body?.[key] === 'boolean') patch[key] = req.body[key];
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Aucune permission valide fournie.' });
      // Colonnes ajoutées par la Mission 8 : écrites ici pour ne pas dépendre du formulaire historique.
      if (team?.pg) {
        const columns = Object.keys(patch).map((key, index) => [key, `$${index + 2}`]);
        const snake = { canCreateFieldCodes: 'can_create_field_codes', canViewFieldHistory: 'can_view_field_history' };
        const assignments = columns.map(([key], index) => `${snake[key] || key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)}=$${index + 2}`);
        await team.base.pool.query(`UPDATE managers SET ${assignments.join(', ')}, updated_at=NOW() WHERE id=$1`,
          [managerId, ...columns.map(([key]) => patch[key])]);
      } else {
        const row = (store.state.managers || []).find((item) => item.id === managerId);
        Object.assign(row, patch);
        if (typeof store.save === 'function') await store.save();
      }
      await adminControl.journal({ actor: adminActor(), action: 'manager_permissions_updated', entityType: 'manager', entityId: managerId,
        managerId, summary: `Permissions de ${manager.displayName} mises à jour.`, after: patch, req });
      return res.json({ data: { manager: await store.getManager(managerId, { includeDeleted: true }) } });
    } catch (error) { return apiError(res, error, 'Impossible de modifier ces permissions.'); }
  });

  app.post('/api/admin/control/managers/:managerId/status', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const managerId = String(req.params.managerId);
      const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const status = text(req.body?.status, 20);
      if (!['active', 'suspended', 'blocked'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
      const reason = text(req.body?.reason, 300);
      if (status !== 'active' && reason.length < 3) return res.status(400).json({ error: 'Indiquez le motif.' });
      await store.updateManagerStatus(managerId, status, reason).catch(async () => {
        // Repli : mise à jour directe si la méthode n'existe pas dans cette version du store.
        if (team?.pg) await team.base.pool.query('UPDATE managers SET status=$2, status_reason=$3, token_version=token_version+1, updated_at=NOW() WHERE id=$1', [managerId, status, reason]);
      });
      await adminControl.journal({ actor: adminActor(), action: status === 'active' ? 'manager_reactivated' : 'manager_suspended',
        entityType: 'manager', entityId: managerId, managerId,
        summary: `Gestionnaire ${manager.displayName} : ${status}.${reason ? ` Motif : ${reason}` : ''}`, after: { status, reason }, req });
      await adminControl.notify({ type: 'manager_status', severity: status === 'active' ? 'success' : 'warning',
        title: status === 'active' ? 'Gestionnaire réactivé' : 'Gestionnaire suspendu',
        body: `${manager.displayName} (@${manager.username}) : ${status}.`,
        linkView: 'admin-managers', linkId: managerId, dedupeKey: `mgr:${managerId}:${status}:${Date.now()}` });
      return res.json({ data: { manager: await store.getManager(managerId, { includeDeleted: true }) } });
    } catch (error) { return apiError(res, error, 'Impossible de changer le statut de ce gestionnaire.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // POINTS DES GESTIONNAIRES — lecture interne
  // ---------------------------------------------------------------------------------------------
  async function managerPoints(managerId) {
    if (!team?.pg) {
      const row = (store.state?.managerPoints || []).find((item) => item.merchantId === managerId || item.managerId === managerId);
      return { points: Number(row?.points || 0), events: (store.state?.managerPointEvents || []).filter((item) => item.managerId === managerId) };
    }
    const pool = team.base.pool;
    const [{ rows: [balance] }, { rows: events }] = await Promise.all([
      pool.query('SELECT COALESCE(points,0)::int AS points FROM manager_points WHERE manager_id=$1', [managerId]),
      pool.query(`SELECT id, points_before AS "pointsBefore", points_after AS "pointsAfter", delta, reason, source,
                         actor_type AS "actorType", actor_label AS "actorLabel", created_at AS "createdAt"
                    FROM manager_point_events WHERE manager_id=$1 ORDER BY created_at DESC LIMIT 100`, [managerId]),
    ]);
    return { points: Number(balance?.points || 0), events };
  }

  app.get('/api/admin/control/managers/:managerId/points', requireAdmin, async (req, res) => {
    try { return res.json({ data: await managerPoints(String(req.params.managerId)) }); }
    catch (error) { return apiError(res, error, 'Impossible de charger les points de ce gestionnaire.'); }
  });

  app.post('/api/admin/control/managers/:managerId/points', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const managerId = String(req.params.managerId);
      const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      const delta = Math.trunc(Number(req.body?.delta));
      const reason = text(req.body?.reason, 300);
      if (!Number.isFinite(delta) || delta === 0) return res.status(400).json({ error: 'Indiquez un nombre de points à ajouter ou à retirer (non nul).' });
      if (Math.abs(delta) > 100000) return res.status(400).json({ error: 'Mouvement trop important.' });
      if (reason.length < 5) return res.status(400).json({ error: 'Un motif est obligatoire (5 caractères minimum).' });
      const result = await applyPointDelta({ managerId, delta, reason, actor: adminActor(), source: 'correction', req });
      await adminControl.journal({ actor: adminActor(), action: 'points_changed', entityType: 'manager', entityId: managerId, managerId,
        summary: `Points de ${manager.displayName} : ${delta > 0 ? '+' : ''}${delta} (${reason}).`,
        before: { points: result.pointsBefore }, after: { points: result.pointsAfter, delta, reason }, req });
      await adminControl.notify({ type: 'points_changed', severity: 'warning', title: 'Opération sensible sur des points',
        body: `${manager.displayName} : ${delta > 0 ? '+' : ''}${delta} point(s) — ${reason}`,
        linkView: 'admin-managers', linkId: managerId, dedupeKey: `points:${result.id}` });
      return res.json({ data: result });
    } catch (error) { return fail(res, error, 'Impossible de modifier les points de ce gestionnaire.'); }
  });

  // Mouvement de points atomique et historisé (jamais de solde négatif non voulu).
  async function applyPointDelta({ managerId, delta, reason, actor, source = 'correction', req = null }) {
    if (!team?.pg) {
      store.state.managerPoints ||= [];
      store.state.managerPointEvents ||= [];
      let row = store.state.managerPoints.find((item) => item.managerId === managerId);
      if (!row) { row = { managerId, points: 0, updatedAt: new Date().toISOString() }; store.state.managerPoints.push(row); }
      const before = Number(row.points) || 0;
      const after = before + delta;
      if (after < 0) { const error = new Error('Le solde de points ne peut pas devenir négatif.'); error.status = 409; error.code = 'NEGATIVE_BALANCE'; throw error; }
      row.points = after; row.updatedAt = new Date().toISOString();
      const event = { id: `mpe_${Math.random().toString(36).slice(2)}`, managerId, pointsBefore: before, pointsAfter: after, delta,
        reason, source, actorType: actor.type, actorId: actor.id, actorLabel: actor.label, sourceKey: `manual:${managerId}:${Date.now()}:${Math.random()}`, createdAt: new Date().toISOString() };
      store.state.managerPointEvents.unshift(event);
      if (typeof store.save === 'function') await store.save();
      return event;
    }
    const pool = team.base.pool;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('INSERT INTO manager_points (manager_id, points) VALUES ($1, 0) ON CONFLICT (manager_id) DO NOTHING', [managerId]);
      // Verrou de ligne : deux corrections simultanées ne peuvent pas produire un solde faux.
      const { rows: [current] } = await client.query('SELECT points FROM manager_points WHERE manager_id=$1 FOR UPDATE', [managerId]);
      const before = Number(current?.points || 0);
      const after = before + delta;
      if (after < 0) { await client.query('ROLLBACK'); const error = new Error('Le solde de points ne peut pas devenir négatif.'); error.status = 409; error.code = 'NEGATIVE_BALANCE'; throw error; }
      await client.query('UPDATE manager_points SET points=$2, updated_at=NOW() WHERE manager_id=$1', [managerId, after]);
      const sourceKey = `manual:${managerId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
      const { rows: [event] } = await client.query(
        `INSERT INTO manager_point_events (id, manager_id, points_before, points_after, delta, reason, source, actor_type, actor_id, actor_label, source_key)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, points_before AS "pointsBefore", points_after AS "pointsAfter", delta, reason, source, created_at AS "createdAt"`,
        [`mpe_${require('node:crypto').randomBytes(10).toString('base64url')}`, managerId, before, after, delta, reason, source,
          actor.type, actor.id, actor.label, sourceKey]);
      await client.query('COMMIT');
      return event;
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
  }

  // ---------------------------------------------------------------------------------------------
  // CODE DE SÉCURITÉ DES POINTS (6 chiffres, défini ou réinitialisé par le PDG)
  // ---------------------------------------------------------------------------------------------
  async function setPointsCode(managerId, code, { actor, requireOnRead = null, req = null } = {}) {
    const plain = String(code || '').replace(/\s/g, '');
    if (!/^\d{6}$/.test(plain)) { const error = new Error('Le code de sécurité doit comporter exactement 6 chiffres.'); error.status = 400; error.code = 'INVALID_POINTS_CODE'; throw error; }
    if (/^(\d)\1{5}$/.test(plain) || ['123456', '654321', '000000', '111111'].includes(plain)) {
      const error = new Error('Ce code est trop facile à deviner. Choisissez 6 chiffres différents.'); error.status = 400; error.code = 'WEAK_POINTS_CODE'; throw error;
    }
    // Le code est haché comme les mots de passe du projet (scrypt + sel) : jamais stocké en clair.
    const { hashPin } = require('./pin-policy');
    const hashed = hashPin(plain);
    if (team?.pg) {
      const sets = requireOnRead === null ? '' : `, points_code_required=$3`;
      const params = requireOnRead === null ? [managerId, hashed] : [managerId, hashed, requireOnRead];
      await team.base.pool.query(
        `UPDATE managers SET points_code_hash=$2, points_code_set_at=NOW(), points_code_failed_count=0, points_code_locked_until=NULL${sets}, updated_at=NOW() WHERE id=$1`, params);
    } else {
      const row = (store.state.managers || []).find((item) => item.id === managerId);
      if (row) { row.pointsCodeHash = hashed; row.pointsCodeSetAt = new Date().toISOString(); row.pointsCodeFailedCount = 0; row.pointsCodeLockedUntil = null;
        if (requireOnRead !== null) row.pointsCodeRequired = requireOnRead; }
      if (typeof store.save === 'function') await store.save();
    }
    return true;
  }

  app.post('/api/admin/control/managers/:managerId/points-code', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const managerId = String(req.params.managerId);
      const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
      if (!manager) return res.status(404).json({ error: 'Gestionnaire introuvable.' });
      await setPointsCode(managerId, req.body?.code, { actor: adminActor(), req });
      await adminControl.journal({ actor: adminActor(), action: 'points_code_reset', entityType: 'manager', entityId: managerId, managerId,
        summary: `Code de sécurité des points défini pour ${manager.displayName}.`, req });
      await adminControl.notify({ type: 'points_code_reset', severity: 'warning', title: 'Code de sécurité des points modifié',
        body: `${manager.displayName} (@${manager.username}) : nouveau code de sécurité.`,
        linkView: 'admin-managers', linkId: managerId, dedupeKey: `pcode:${managerId}:${Date.now()}` });
      return res.json({ data: { ok: true, notice: 'Transmettez ce code au gestionnaire de vive voix. Il n’est plus affichable ensuite.' } });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer ce code de sécurité.'); }
  });

  app.post('/api/admin/control/managers/:managerId/points-code-policy', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const managerId = String(req.params.managerId);
      const required = req.body?.required === true;
      if (team?.pg) await team.base.pool.query('UPDATE managers SET points_code_required=$2, updated_at=NOW() WHERE id=$1', [managerId, required]);
      else { const row = (store.state.managers || []).find((item) => item.id === managerId); if (row) row.pointsCodeRequired = required; if (typeof store.save === 'function') await store.save(); }
      await adminControl.journal({ actor: adminActor(), action: 'points_code_policy', entityType: 'manager', entityId: managerId, managerId,
        summary: `Consultation des points ${required ? 'protégée' : 'libre'} pour ce gestionnaire.`, after: { required }, req });
      return res.json({ data: { required } });
    } catch (error) { return apiError(res, error, 'Impossible d’enregistrer cette règle.'); }
  });

  // Le gestionnaire consulte SES points : protégé par son code si le PDG l'a activé.
  app.get('/api/manager/control/points', requireManager, async (req, res) => {
    try {
      const managerId = String(req.manager.id);
      const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
      const protectedRead = manager?.pointsCodeRequired === true;
      const provided = String(req.query.code || '').replace(/\s/g, '');
      if (protectedRead) {
        if (!manager?.pointsCodeHash) return res.status(409).json({ error: 'Le PDG doit d’abord définir votre code de sécurité des points.', code: 'POINTS_CODE_MISSING' });
        const check = await verifyPointsCode(managerId, provided, { req });
        if (!check.ok) return res.status(check.status).json({ error: check.error, code: check.code, attemptsLeft: check.attemptsLeft });
      }
      return res.json({ data: { ...(await managerPoints(managerId)), protectedRead } });
    } catch (error) { return apiError(res, error, 'Impossible de charger vos points.'); }
  });

  async function verifyPointsCode(managerId, provided, { req = null } = {}) {
    const manager = await store.getManager(managerId, { includeDeleted: true }).catch(() => null);
    if (!manager) return { ok: false, status: 404, code: 'NOT_FOUND', error: 'Compte introuvable.' };
    if (!manager.pointsCodeHash) return { ok: false, status: 409, code: 'POINTS_CODE_MISSING', error: 'Aucun code de sécurité défini.' };
    const lockedUntil = manager.pointsCodeLockedUntil ? new Date(manager.pointsCodeLockedUntil).getTime() : 0;
    if (lockedUntil > Date.now()) return { ok: false, status: 429, code: 'POINTS_CODE_LOCKED',
      error: `Trop de tentatives. Réessayez dans ${Math.ceil((lockedUntil - Date.now()) / 60000)} minute(s).` };
    const { verifyPin } = require('./pin-policy');
    if (!/^\d{6}$/.test(provided) || !verifyPin(provided, manager.pointsCodeHash)) {
      const failed = Number(manager.pointsCodeFailedCount || 0) + 1;
      const lock = failed >= 5 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
      if (team?.pg) await team.base.pool.query('UPDATE managers SET points_code_failed_count=$2, points_code_locked_until=$3 WHERE id=$1', [managerId, failed, lock]).catch(() => {});
      else { const row = (store.state.managers || []).find((item) => item.id === managerId); if (row) { row.pointsCodeFailedCount = failed; row.pointsCodeLockedUntil = lock; } if (typeof store.save === 'function') await store.save(); }
      await adminControl.journal({ actor: { type: 'manager', id: managerId, label: manager.displayName }, action: 'points_code_failed',
        entityType: 'manager', entityId: managerId, managerId, summary: `Code de sécurité des points incorrect (${failed}/5).`, req });
      return { ok: false, status: lock ? 429 : 401, code: lock ? 'POINTS_CODE_LOCKED' : 'POINTS_CODE_INVALID',
        error: lock ? 'Trop de tentatives. Le code est bloqué 15 minutes.' : 'Code de sécurité incorrect.', attemptsLeft: Math.max(0, 5 - failed) };
    }
    if (failedResetNeeded(manager)) {
      if (team?.pg) await team.base.pool.query('UPDATE managers SET points_code_failed_count=0, points_code_locked_until=NULL WHERE id=$1', [managerId]).catch(() => {});
    }
    return { ok: true };
  }
  const failedResetNeeded = (manager) => Number(manager?.pointsCodeFailedCount || 0) > 0;

  return { applyPointDelta, verifyPointsCode };
};
