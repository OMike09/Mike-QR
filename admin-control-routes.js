'use strict';

// ============================================================================================
// MISSION 8 — ROUTES DU CONTRÔLE TOTAL DU PDG (partie 1)
//
//   PDG (requireAdmin) :
//     GET  /api/admin/control/overview              tableau de bord central (14 indicateurs + filtres)
//     GET  /api/admin/control/team-limits           quotas plateforme + liste des marchands à quota
//     PATCH /api/admin/control/team-limits          quota général applicable à tous
//     GET  /api/admin/control/merchants/:id/quotas  quota d'un marchand (utilisé / restant)
//     PUT  /api/admin/control/merchants/:id/quotas  fixer / modifier le quota d'un marchand
//     POST /api/admin/control/merchants/:id/team-members/:memberId/status   couper un code serveuse
//
//   CODES D'INSCRIPTION TERRAIN
//     POST /api/admin/control/field-codes           générer 1 à 25 codes (PDG)
//     GET  /api/admin/control/field-codes           lister (PDG : tous, gestionnaire : les siens)
//     POST /api/admin/control/field-codes/:id/revoke
//     GET  /api/admin/control/field-codes/history   historique des inscriptions terrain
//     POST /api/manager/control/field-codes         générer (gestionnaire, si permission)
//     GET  /api/manager/control/field-codes         lister les siens
//     POST /api/manager/control/field-codes/:id/revoke
//     GET  /api/manager/control/field-codes/history
//     POST /api/public/field-codes/check            vérifier un code sans le consommer (limitée)
//
//   NOTIFICATIONS
//     GET  /api/admin/control/notifications
//     POST /api/admin/control/notifications/read
//     GET  /api/manager/control/notifications       (les notifications qui concernent le gestionnaire)
//     POST /api/manager/control/notifications/read
//
//   JOURNAL D'AUDIT
//     GET  /api/admin/control/journal
//     GET  /api/admin/control/journal/export        CSV
//     GET  /api/manager/control/journal             ses propres opérations uniquement
//
// Toutes les permissions sont vérifiées côté serveur. Un gestionnaire ne peut jamais atteindre une
// route /api/admin/* : requireAdmin s'en charge, et chaque route gestionnaire filtre par son id.
// ============================================================================================

const crypto = require('node:crypto');
const { resolveTeamQuotas } = require('./admin-control');

module.exports = function registerAdminControlRoutes(deps) {
  const { app, store, adminControl, team, commerce, requireAdmin, requireManager, checkSameOrigin, apiError, staffOps } = deps;

  const text = (value, max = 500) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const adminActor = () => ({ type: 'admin', id: String(process.env.ADMIN_USERNAME || 'admin'), label: 'PDG' });
  const managerActor = (req) => ({ type: 'manager', id: String(req.manager.id), label: `Gestionnaire ${req.manager.displayName} (@${req.manager.username})` });
  const guardFieldCodes = (req, res, next) => {
    // Permission explicite du PDG : un gestionnaire sans autorisation ne peut ni générer ni révoquer.
    if (req.manager?.canCreateFieldCodes !== true) {
      store.addAudit({ actor: `${req.manager?.displayName || 'Gestionnaire'} (@${req.manager?.username || ''})`, actorType: 'manager',
        actorId: req.manager?.id, managerId: req.manager?.id, action: 'authorization_denied', entityType: 'field_enrollment_code',
        entityId: 'code', summary: 'Génération de code terrain refusée : permission non accordée par le PDG.', result: 'denied' }).catch(() => {});
      return res.status(403).json({ error: 'Le PDG ne vous a pas autorisé à générer des codes d’inscription terrain.', code: 'FIELD_CODE_FORBIDDEN' });
    }
    return next();
  };
  const fail = (res, error, fallback) => {
    if (error?.status && error?.code) return res.status(error.status).json({ error: error.message, code: error.code });
    return apiError(res, error, fallback);
  };
  // Forme canonique d'un code : OY-XXXX-XXXX (le tiret est facultatif à la saisie).
  const normalizeClientCode = (value) => {
    const raw = String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/^OY/, '');
    return raw.length === 8 ? `OY-${raw.slice(0, 4)}-${raw.slice(4)}` : String(value || '').trim().toUpperCase();
  };

  // ---------------------------------------------------------------------------------------------
  // 1. TABLEAU DE BORD CENTRAL
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/overview', requireAdmin, async (req, res) => {
    try {
      const dateOk = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
      const from = dateOk(req.query.from) ? String(req.query.from) : null;
      const to = dateOk(req.query.to) ? String(req.query.to) : null;
      const platform = await resolveTeamQuotas(deps, '__platform__');
      const globalMaxGeneral = Number(platform.platform?.maxGeneralManagersPerMerchant ?? 1);
      const globalMaxWaitress = Number(platform.platform?.maxWaitressesPerMerchant ?? 2);
      const registrationCounts = await deps.lifecycle.registrationCounts().catch(() => ({}));
      const notes = await adminControl.listNotifications({ recipientType: 'admin', recipientId: '', limit: 1 })
        .catch(() => ({ counts: { unread: 0 } }));

      const overview = {
        filters: { from, to },
        merchants: {
          total: 0,
          pending: Number(registrationCounts.pending || 0), inReview: Number(registrationCounts.in_review || 0),
          approved: Number(registrationCounts.approved || 0), rejected: Number(registrationCounts.rejected || 0),
          suspended: Number(registrationCounts.suspended || 0), needsInfo: Number(registrationCounts.needs_info || 0),
        },
        managers: { total: 0, active: 0, suspended: 0, blocked: 0 },
        field: { enrollments: 0, codesGenerated: 0, codesUsed: 0, codesExpired: 0, codesAvailable: 0, codesRevoked: 0 },
        team: { generalManagers: 0, waitresses: 0, merchantsAtQuota: 0, merchantsAtQuotaList: [] },
        notifications: { unread: Number(notes?.counts?.unread || 0) },
        recent: { managerActivity: [], sensitive: [] },
        quotasPlatform: { maxGeneralManagersPerMerchant: globalMaxGeneral, maxWaitressesPerMerchant: globalMaxWaitress },
      };

      if (!team?.pg) {
        // Stockage JSON : mêmes indicateurs, dérivés de l'état local (aucun SQL disponible).
        const merchants = await commerce.listMerchants({ includeDeleted: false }).catch(() => []);
        const managers = store.state?.managers || [];
        const codes = await adminControl.listFieldCodes({ actor: adminActor() }).catch(() => ({ counts: {} }));
        const members = store.state?.teamMembers || [];
        overview.merchants.total = merchants.length;
        overview.managers = { total: managers.length, active: managers.filter((m) => m.status === 'active').length,
          suspended: managers.filter((m) => m.status === 'suspended').length, blocked: managers.filter((m) => m.status === 'blocked').length };
        overview.field = { enrollments: (store.state?.fieldCodeUses || []).length, codesGenerated: codes.counts?.total || 0,
          codesUsed: codes.counts?.used || 0, codesExpired: codes.counts?.expired || 0,
          codesAvailable: codes.counts?.available || 0, codesRevoked: codes.counts?.revoked || 0 };
        overview.team.generalManagers = members.filter((m) => m.role === 'general_manager' && m.status !== 'archived').length;
        overview.team.waitresses = members.filter((m) => m.role === 'waitress' && m.status !== 'archived').length;
        overview.recent.sensitive = await adminControl.listJournal({ limit: 12 }).catch(() => []);
        res.setHeader('Cache-Control', 'no-store');
        return res.json({ data: overview });
      }

      const pool = team.base.pool;
      // Filtre de date appliqué aux événements (journal, consommation de codes) et non aux totaux
      // absolus : le PDG veut voir l'activité d'une période sans perdre la vue globale.
      // Les requêtes qui ne filtrent pas par date ne reçoivent AUCUN paramètre : mélanger des
      // marqueurs et des valeurs produit l'erreur « bind message supplies 2 parameters, but
      // prepared statement requires 0 ».
      const dateClause = (column) => (from || to)
        ? `AND ${column} >= COALESCE($1::date, '-infinity'::date) AND ${column} < COALESCE($2::date, 'infinity'::date) + INTERVAL '1 day'`
        : '';
      const dateParams = (from || to) ? [from, to] : [];
      const [merchants, managers, codes, teamCounts, enrollments, quotaRows, journal] = await Promise.all([
        pool.query('SELECT COUNT(*)::int AS total FROM merchant_accounts WHERE deleted_at IS NULL'),
        pool.query(`SELECT COUNT(*)::int AS total,
                           COUNT(*) FILTER (WHERE status='active')::int AS active,
                           COUNT(*) FILTER (WHERE status='suspended')::int AS suspended,
                           COUNT(*) FILTER (WHERE status='blocked')::int AS blocked
                      FROM managers WHERE deleted_at IS NULL`),
        pool.query(`SELECT COUNT(*)::int AS total,
                           COUNT(*) FILTER (WHERE revoked_at IS NOT NULL)::int AS revoked,
                           COUNT(*) FILTER (WHERE revoked_at IS NULL AND uses >= max_uses)::int AS used,
                           COUNT(*) FILTER (WHERE revoked_at IS NULL AND uses < max_uses AND expires_at <= NOW())::int AS expired,
                           COUNT(*) FILTER (WHERE revoked_at IS NULL AND uses < max_uses AND expires_at > NOW())::int AS available
                      FROM field_enrollment_codes`),
        pool.query(`SELECT COUNT(*) FILTER (WHERE role='general_manager' AND status <> 'archived')::int AS "generalManagers",
                           COUNT(*) FILTER (WHERE role='waitress' AND status <> 'archived')::int AS waitresses
                      FROM team_members`),
        pool.query(`SELECT COUNT(*)::int AS total FROM field_code_uses WHERE TRUE ${dateClause('used_at')}`, dateParams),
        pool.query(
          `SELECT a.id, a.display_name AS "displayName",
                  COALESCE(o.max_general_managers, a.team_quota_general_managers, $1::int) AS "maxGeneralManagers",
                  COALESCE(o.max_waitresses, a.team_quota_waitresses, $2::int) AS "maxWaitresses",
                  COUNT(tm.id) FILTER (WHERE tm.role='general_manager' AND tm.status <> 'archived')::int AS "usedGeneralManagers",
                  COUNT(tm.id) FILTER (WHERE tm.role='waitress' AND tm.status <> 'archived')::int AS "usedWaitresses"
             FROM merchant_accounts a
             LEFT JOIN merchant_team_quota_overrides o ON o.merchant_id = a.id
             LEFT JOIN team_members tm ON tm.merchant_id = a.id
            WHERE a.deleted_at IS NULL
            GROUP BY a.id, a.display_name, o.max_general_managers, o.max_waitresses,
                     a.team_quota_general_managers, a.team_quota_waitresses
           HAVING COUNT(tm.id) FILTER (WHERE tm.role='general_manager' AND tm.status <> 'archived')
                    >= COALESCE(o.max_general_managers, a.team_quota_general_managers, $1::int)
               OR COUNT(tm.id) FILTER (WHERE tm.role='waitress' AND tm.status <> 'archived')
                    >= COALESCE(o.max_waitresses, a.team_quota_waitresses, $2::int)
            ORDER BY a.display_name LIMIT 200`, [globalMaxGeneral, globalMaxWaitress]),
        pool.query(`SELECT id, actor_label AS "actorLabel", actor_type AS "actorType", action,
                       entity_type AS "entityType", entity_id AS "entityId", summary, created_at AS "createdAt"
                  FROM admin_audit_journal
                 WHERE action IN ('points_changed','points_code_reset','account_suspended','quota_updated','team_member_cut')
                   ${dateClause('created_at')}
                 ORDER BY created_at DESC LIMIT 10`, dateParams),
      ]).catch((error) => { throw error; });

      overview.merchants.total = Number(merchants.rows[0]?.total || 0);
      overview.managers = {
        total: Number(managers.rows[0]?.total || 0), active: Number(managers.rows[0]?.active || 0),
        suspended: Number(managers.rows[0]?.suspended || 0), blocked: Number(managers.rows[0]?.blocked || 0),
      };
      overview.field = {
        enrollments: Number(enrollments.rows[0]?.total || 0), codesGenerated: Number(codes.rows[0]?.total || 0),
        codesUsed: Number(codes.rows[0]?.used || 0), codesExpired: Number(codes.rows[0]?.expired || 0),
        codesAvailable: Number(codes.rows[0]?.available || 0), codesRevoked: Number(codes.rows[0]?.revoked || 0),
      };
      overview.team = {
        generalManagers: Number(teamCounts.rows[0]?.generalManagers || 0),
        waitresses: Number(teamCounts.rows[0]?.waitresses || 0),
        merchantsAtQuota: quotaRows.rows.length, merchantsAtQuotaList: quotaRows.rows,
      };
      overview.recent.sensitive = journal.rows;
      overview.recent.managerActivity = await adminControl.listJournal({ limit: 12 }).catch(() => []);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: overview });
    } catch (error) { return apiError(res, error, 'Impossible de charger le tableau de bord central.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // 2. QUOTAS D'ÉQUIPE
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/team-limits', requireAdmin, async (_req, res) => {
    try {
      const platform = await resolveTeamQuotas(deps, '__platform__');
      let merchants = [];
      if (team?.pg) {
        const { rows } = await team.base.pool.query(
          `SELECT a.id, a.display_name AS "displayName", a.status,
                  COALESCE(o.max_general_managers, a.team_quota_general_managers, $1::int) AS "maxGeneralManagers",
                  COALESCE(o.max_waitresses, a.team_quota_waitresses, $2::int) AS "maxWaitresses",
                  COALESCE(o.extra_general_managers,0) AS "extraGeneralManagers", COALESCE(o.extra_waitresses,0) AS "extraWaitresses",
                  o.extra_expires_at AS "extraExpiresAt", COALESCE(o.suspended_reserves_slot,false) AS "suspendedReservesSlot",
                  COALESCE(o.merchant_can_edit_quotas,false) AS "merchantCanEditQuotas", o.reason,
                  (o.merchant_id IS NOT NULL) AS "hasOverride",
                  COUNT(tm.id) FILTER (WHERE tm.role='general_manager' AND tm.status <> 'archived')::int AS "usedGeneralManagers",
                  COUNT(tm.id) FILTER (WHERE tm.role='waitress' AND tm.status <> 'archived')::int AS "usedWaitresses",
                  COUNT(tm.id) FILTER (WHERE tm.role='general_manager' AND tm.status IN ('blocked','suspended'))::int AS "suspendedGeneralManagers",
                  COUNT(tm.id) FILTER (WHERE tm.role='waitress' AND tm.status IN ('blocked','suspended'))::int AS "suspendedWaitresses"
             FROM merchant_accounts a
             LEFT JOIN merchant_team_quota_overrides o ON o.merchant_id=a.id
             LEFT JOIN team_members tm ON tm.merchant_id=a.id
            WHERE a.deleted_at IS NULL
            GROUP BY a.id, a.display_name, a.status, o.merchant_id, o.max_general_managers, o.max_waitresses,
                     o.extra_general_managers, o.extra_waitresses, o.extra_expires_at, o.suspended_reserves_slot,
                     o.merchant_can_edit_quotas, o.reason, a.team_quota_general_managers, a.team_quota_waitresses
            ORDER BY a.display_name LIMIT 300`);
        merchants = rows;
      } else {
        merchants = (await commerce.listMerchants({ includeDeleted: false }).catch(() => [])).map((merchant) => ({
          id: merchant.id, displayName: merchant.displayName, status: merchant.status,
          maxGeneralManagers: platform.platform.maxGeneralManagersPerMerchant, maxWaitresses: platform.platform.maxWaitressesPerMerchant,
          extraGeneralManagers: 0, extraWaitresses: 0, hasOverride: false, usedGeneralManagers: 0, usedWaitresses: 0,
        }));
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { platform: platform.platform, merchants } });
    } catch (error) { return apiError(res, error, 'Impossible de charger les limites d’équipe.'); }
  });

  app.patch('/api/admin/control/team-limits', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const current = (await resolveTeamQuotas(deps, '__platform__')).platform;
      const next = {
        maxGeneralManagersPerMerchant: Math.max(0, Math.min(200, Number(req.body?.maxGeneralManagersPerMerchant ?? current.maxGeneralManagersPerMerchant) || 0)),
        maxWaitressesPerMerchant: Math.max(0, Math.min(500, Number(req.body?.maxWaitressesPerMerchant ?? current.maxWaitressesPerMerchant) || 0)),
        activationCodeTtlHours: Math.max(1, Math.min(720, Number(req.body?.activationCodeTtlHours ?? current.activationCodeTtlHours) || 72)),
        teamModuleEnabled: req.body?.teamModuleEnabled === undefined ? current.teamModuleEnabled !== false : req.body.teamModuleEnabled === true,
        // Nouveau : le marchand peut-il lui-même fixer ses quotas ? Par défaut NON (décision du PDG).
        merchantCanEditQuotas: req.body?.merchantCanEditQuotas === true,
      };
      if (!team?.pg) {
        store.state.appSettings ||= {};
        store.state.appSettings.teamLimits = next;
        if (typeof store.save === 'function') await store.save();
      } else {
        await team.base.pool.query(
          `INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('teamLimits',$1::jsonb,NOW())
           ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`, [JSON.stringify(next)]);
      }
      await adminControl.journal({ actor: adminActor(), action: 'team_limits_updated', entityType: 'settings', entityId: 'teamLimits',
        summary: `Quotas généraux modifiés : ${next.maxGeneralManagersPerMerchant} gérant(s), ${next.maxWaitressesPerMerchant} serveuse(s).`, before: current, after: next, req });
      await adminControl.notify({ type: 'team_limits_updated', severity: 'info', title: 'Quotas d’équipe généraux modifiés',
        body: `Désormais ${next.maxGeneralManagersPerMerchant} gérant(s) et ${next.maxWaitressesPerMerchant} serveuse(s) par marchand.`,
        linkView: 'admin-team-limits', dedupeKey: `team_limits:${Date.now()}` });
      return res.json({ data: { platform: next } });
    } catch (error) { return apiError(res, error, 'Impossible d’enregistrer les quotas généraux.'); }
  });

  app.get('/api/admin/control/merchants/:merchantId/quotas', requireAdmin, async (req, res) => {
    try {
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const quotas = await resolveTeamQuotas(deps, merchant.id);
      let usage = { generalManagers: 0, waitresses: 0, suspendedGeneralManagers: 0, suspendedWaitresses: 0, members: [] };
      if (team?.pg) {
        const { rows } = await team.base.pool.query(
          `SELECT id, role, designation, full_name AS "fullName", status, points, last_login_at AS "lastLoginAt"
             FROM team_members WHERE merchant_id=$1 ORDER BY role, designation`, [merchant.id]).catch(() => ({ rows: [] }));
        usage = { members: rows,
          generalManagers: rows.filter((m) => m.role === 'general_manager' && m.status !== 'archived').length,
          waitresses: rows.filter((m) => m.role === 'waitress' && m.status !== 'archived').length,
          suspendedGeneralManagers: rows.filter((m) => m.role === 'general_manager' && ['blocked', 'suspended'].includes(m.status)).length,
          suspendedWaitresses: rows.filter((m) => m.role === 'waitress' && ['blocked', 'suspended'].includes(m.status)).length };
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { merchant: { id: merchant.id, displayName: merchant.displayName, status: merchant.status }, quotas, usage } });
    } catch (error) { return apiError(res, error, 'Impossible de charger les quotas de ce marchand.'); }
  });

  app.put('/api/admin/control/merchants/:merchantId/quotas', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const before = await resolveTeamQuotas(deps, merchant.id);
      const general = Math.max(0, Math.min(200, Number(req.body?.maxGeneralManagers ?? before.maxGeneralManagers) || 0));
      const waitresses = Math.max(0, Math.min(500, Number(req.body?.maxWaitresses ?? before.maxWaitresses) || 0));
      const extraGeneral = Math.max(0, Math.min(200, Number(req.body?.extraGeneralManagers ?? 0) || 0));
      const extraWaitress = Math.max(0, Math.min(500, Number(req.body?.extraWaitresses ?? 0) || 0));
      const extraExpiresAt = req.body?.extraExpiresAt ? new Date(req.body.extraExpiresAt) : null;
      if (extraExpiresAt && Number.isNaN(extraExpiresAt.getTime())) return res.status(400).json({ error: 'Date d’expiration du dépassement invalide.' });
      const suspendedReservesSlot = req.body?.suspendedReservesSlot === true;
      const merchantCanEditQuotas = req.body?.merchantCanEditQuotas === true;
      const reason = text(req.body?.reason, 300);
      if (team?.pg) {
        await team.base.pool.query(
          `INSERT INTO merchant_team_quota_overrides
             (merchant_id, max_general_managers, max_waitresses, extra_general_managers, extra_waitresses,
              extra_expires_at, suspended_reserves_slot, merchant_can_edit_quotas, reason, updated_by, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
           ON CONFLICT (merchant_id) DO UPDATE SET
             max_general_managers=EXCLUDED.max_general_managers, max_waitresses=EXCLUDED.max_waitresses,
             extra_general_managers=EXCLUDED.extra_general_managers, extra_waitresses=EXCLUDED.extra_waitresses,
             extra_expires_at=EXCLUDED.extra_expires_at, suspended_reserves_slot=EXCLUDED.suspended_reserves_slot,
             merchant_can_edit_quotas=EXCLUDED.merchant_can_edit_quotas, reason=EXCLUDED.reason,
             updated_by=EXCLUDED.updated_by, updated_at=NOW()`,
          [merchant.id, general, waitresses, extraGeneral, extraWaitress, extraExpiresAt, suspendedReservesSlot,
            merchantCanEditQuotas, reason, adminActor().label]);
      } else {
        store.state.teamQuotaOverrides ||= [];
        const row = store.state.teamQuotaOverrides.find((item) => item.merchantId === merchant.id);
        const patch = { merchantId: merchant.id, maxGeneralManagers: general, maxWaitresses: waitresses, extraGeneralManagers: extraGeneral,
          extraWaitresses: extraWaitress, extraExpiresAt: extraExpiresAt?.toISOString() || null, suspendedReservesSlot,
          merchantCanEditQuotas, reason, updatedBy: adminActor().label, updatedAt: new Date().toISOString() };
        if (row) Object.assign(row, patch); else store.state.teamQuotaOverrides.push(patch);
        if (typeof store.save === 'function') await store.save();
      }
      const after = await resolveTeamQuotas(deps, merchant.id);
      await adminControl.journal({ actor: adminActor(), action: 'quota_updated', entityType: 'merchant', entityId: merchant.id,
        merchantId: merchant.id, summary: `Quotas de « ${merchant.displayName} » : ${after.effectiveMaxGeneralManagers} gérant(s), ${after.effectiveMaxWaitresses} serveuse(s).`,
        before, after, req });
      await adminControl.notify({ type: 'quota_updated', severity: 'info', title: 'Quotas d’équipe modifiés',
        body: `${merchant.displayName} : ${after.effectiveMaxGeneralManagers} gérant(s), ${after.effectiveMaxWaitresses} serveuse(s).`,
        linkView: 'admin-team-limits', linkId: merchant.id, dedupeKey: `quota:${merchant.id}:${Date.now()}` });
      return res.json({ data: { quotas: after } });
    } catch (error) { return apiError(res, error, 'Impossible d’enregistrer les quotas de ce marchand.'); }
  });

  // Couper le code d'une serveuse / d'un gérant à tout moment, depuis la fiche du marchand.
  app.post('/api/admin/control/merchants/:merchantId/team-members/:memberId/status', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      if (!team?.base?.pool) return res.status(409).json({ error: 'Cette action nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const status = text(req.body?.status, 20);
      if (!['active', 'blocked', 'suspended', 'archived', 'pending'].includes(status)) return res.status(400).json({ error: 'État invalide.' });
      const merchant = await commerce.getMerchant(String(req.params.merchantId)).catch(() => null);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      // Le PDG coupe l'accès d'un gérant ou d'une serveuse : même mécanisme que le marchand
      // (jeton de version incrémenté + sessions d'équipe révoquées), avec trace nominative.
      const member = await team.setStatus(String(req.params.memberId), merchant.id, status, text(req.body?.reason, 200),
        { type: 'admin', id: adminActor().id, label: 'PDG' });
      await adminControl.journal({ actor: adminActor(), action: status === 'active' ? 'team_member_reactivated' : 'team_member_cut',
        entityType: 'team_member', entityId: member.id, merchantId: merchant.id,
        summary: `Accès de ${member.designation || member.fullName} ${status === 'active' ? 'rétabli' : `coupé (${status})`} par le PDG.`,
        after: { status, reason: text(req.body?.reason, 200) }, req });
      await adminControl.notify({ type: 'team_member_cut', severity: status === 'active' ? 'success' : 'warning',
        title: status === 'active' ? 'Accès rétabli' : 'Accès coupé',
        body: `${merchant.displayName} — ${member.designation || member.fullName} : ${status}.`,
        linkView: 'admin-merchants', linkId: merchant.id, dedupeKey: `member:${member.id}:${status}:${Date.now()}` });
      return res.json({ data: { member } });
    } catch (error) { return fail(res, error, 'Impossible de changer l’état de ce membre.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // 3. CODES D'INSCRIPTION TERRAIN
  // ---------------------------------------------------------------------------------------------
  const codeBody = (body) => ({
    count: Math.max(1, Math.min(25, Number(body?.count) || 1)),
    ttlHours: Math.max(1, Math.min(720, Number(body?.ttlHours) || 72)),
    maxUses: 1, // un code = une inscription, sans exception (règle 8 du cahier des charges)
    note: text(body?.note, 240),
    teamQuotas: body?.teamMaxGeneralManagers != null || body?.teamMaxWaitresses != null
      ? { maxGeneralManagers: Number(body?.teamMaxGeneralManagers) || 0, maxWaitresses: Number(body?.teamMaxWaitresses) || 0 } : null,
  });

  app.post('/api/admin/control/field-codes', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const options = codeBody(req.body);
      if (options.maxUses !== 1) return res.status(400).json({ error: 'Un code terrain ne peut servir qu’une seule fois.' });
      const codes = await adminControl.createFieldCodes({ ...options, actor: adminActor(),
        managerId: req.body?.managerId ? String(req.body.managerId) : null });
      await adminControl.journal({ actor: adminActor(), action: 'field_codes_created', entityType: 'field_enrollment_code',
        entityId: codes.map((code) => code.id).join(','), summary: `${codes.length} code(s) d’inscription terrain généré(s).`,
        after: { count: codes.length, hints: codes.map((code) => code.hint), expiresAt: codes[0]?.expiresAt }, req });
      return res.status(201).json({ data: { codes, notice: 'Ces codes ne seront plus jamais affichés en clair. Notez-les ou transmettez-les maintenant.' } });
    } catch (error) { return fail(res, error, 'Impossible de générer les codes.'); }
  });

  app.get('/api/admin/control/field-codes', requireAdmin, async (req, res) => {
    try {
      const result = await adminControl.listFieldCodes({ actor: adminActor(), managerId: String(req.query.managerId || ''),
        status: String(req.query.status || 'all'), limit: Number(req.query.limit) || 100 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: result.data, counts: result.counts });
    } catch (error) { return apiError(res, error, 'Impossible de charger les codes terrain.'); }
  });

  app.post('/api/admin/control/field-codes/:codeId/revoke', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const result = await adminControl.revokeFieldCode(String(req.params.codeId), { actor: adminActor(), reason: text(req.body?.reason, 240) });
      await adminControl.journal({ actor: adminActor(), action: 'field_code_revoked', entityType: 'field_enrollment_code',
        entityId: result.id, summary: 'Code terrain révoqué par le PDG.', after: { reason: text(req.body?.reason, 240) }, req });
      return res.json({ data: result });
    } catch (error) { return fail(res, error, 'Impossible de révoquer ce code.'); }
  });

  app.get('/api/admin/control/field-codes/history', requireAdmin, async (req, res) => {
    try {
      const rows = await adminControl.fieldCodeHistory({ managerId: String(req.query.managerId || ''), limit: Number(req.query.limit) || 100 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: rows });
    } catch (error) { return apiError(res, error, 'Impossible de charger l’historique des inscriptions terrain.'); }
  });

  // --- côté gestionnaire ---
  app.post('/api/manager/control/field-codes', requireManager, guardFieldCodes, checkSameOrigin, async (req, res) => {
    try {
      const options = codeBody(req.body);
      // Mission 9 : « Générer un code unique d'inscription » — un seul code, à usage unique, TTL court.
      const singleUse = req.body?.singleUse === true;
      const codes = await adminControl.createFieldCodes({ ...options, count: singleUse ? 1 : options.count,
        maxUses: singleUse ? 1 : options.maxUses, ttlHours: singleUse ? (Number(req.body?.ttlHours) || 24) : options.ttlHours,
        singleUse, actor: managerActor(req), managerId: String(req.manager.id) });
      await adminControl.journal({ actor: managerActor(req), action: 'field_codes_created', entityType: 'field_enrollment_code',
        entityId: codes.map((code) => code.id).join(','), managerId: String(req.manager.id),
        summary: `Gestionnaire : ${codes.length} code(s) terrain généré(s).`, after: { count: codes.length }, req });
      await adminControl.notify({ type: 'field_codes_created', severity: 'info', title: 'Codes terrain générés par un gestionnaire',
        body: `${req.manager.displayName} (@${req.manager.username}) a généré ${codes.length} code(s) terrain.`,
        linkView: 'admin-field-codes', linkId: String(req.manager.id), dedupeKey: `fieldcodes:${codes[0]?.id}` });
      return res.status(201).json({ data: { codes, notice: 'Ces codes ne seront plus jamais affichés en clair. Notez-les ou transmettez-les maintenant.' } });
    } catch (error) { return fail(res, error, 'Impossible de générer les codes.'); }
  });

  app.get('/api/manager/control/field-codes', requireManager, async (req, res) => {
    try {
      const result = await adminControl.listFieldCodes({ actor: managerActor(req), status: String(req.query.status || 'all') });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: result.data, counts: result.counts, canCreate: req.manager.canCreateFieldCodes === true });
    } catch (error) { return apiError(res, error, 'Impossible de charger vos codes terrain.'); }
  });

  app.post('/api/manager/control/field-codes/:codeId/revoke', requireManager, guardFieldCodes, checkSameOrigin, async (req, res) => {
    try {
      const result = await adminControl.revokeFieldCode(String(req.params.codeId), { actor: managerActor(req), reason: text(req.body?.reason, 240) });
      await adminControl.journal({ actor: managerActor(req), action: 'field_code_revoked', entityType: 'field_enrollment_code',
        entityId: result.id, managerId: String(req.manager.id), summary: 'Code terrain révoqué par son gestionnaire.', req });
      return res.json({ data: result });
    } catch (error) { return fail(res, error, 'Impossible de révoquer ce code.'); }
  });

  app.get('/api/manager/control/field-codes/history', requireManager, async (req, res) => {
    try {
      const rows = await adminControl.fieldCodeHistory({ managerId: String(req.manager.id), limit: 100 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: rows });
    } catch (error) { return apiError(res, error, 'Impossible de charger vos inscriptions terrain.'); }
  });

  // --- vérification publique (limitée en débit) : ouvre le formulaire SANS consommer le code ---
  const attempts = new Map();
  // options.refund : l'opération a réussi, la tentative ne doit pas rester imputée au visiteur.
  const allowAttempt = (key, limit, windowMs, options = {}) => {
    const now = Date.now(); const entry = attempts.get(key);
    if (entry && now - entry.start < windowMs) { if (entry.count >= limit) return false; entry.count += 1; }
    else attempts.set(key, { start: now, count: 1 });
    if (attempts.size > 4000) for (const [k, v] of attempts) if (now - v.start >= windowMs) attempts.delete(k);
    return options.countOnlyFailure ? { refund: () => { const row = attempts.get(key); if (row && row.count > 1) row.count -= 1; } } : true;
  };
  app.post('/api/public/field-codes/check', checkSameOrigin, async (req, res) => {
    const key = `${req.ip || 'unknown'}`;
    // Throttle anti-devinette : les essais réussis ne comptent pas, seuls les codes invalides
    // consomment une tentative (sinon un même réseau légitime se bloquerait tout seul).
    if (!allowAttempt(`fieldcheck:${key}`, 12, 10 * 60_000, { countOnlyFailure: true })) return res.status(429).json({ error: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' });
    try {
      const row = await adminControl.inspectFieldCode(String(req.body?.code || ''));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { valid: true, hint: row.hint, expiresAt: row.expiresAt,
        createdByType: row.createdByType, managerLabel: row.createdByType === 'manager' ? row.createdByLabel : '',
        teamMaxGeneralManagers: row.teamMaxGeneralManagers, teamMaxWaitresses: row.teamMaxWaitresses,
        message: 'Code valide. Il sera consommé à l’envoi de la demande d’inscription.' } });
    } catch (error) { return fail(res, error, 'Ce code ne peut pas être utilisé.'); }
  });

  // Mission 9 : réservation du code à l'ouverture de la fenêtre d'autorisation.
  // Elle NE consomme PAS le code (usage : blocage mutuel 15 min), et renvoie un jeton que le
  // formulaire devra présenter pour consommer réellement le code à la soumission réussie.
  app.post('/api/public/field-codes/reserve', checkSameOrigin, async (req, res) => {
    const key = `${req.ip || 'unknown'}`;
    const quota = allowAttempt(`fieldreserve:${key}`, 12, 10 * 60_000, { countOnlyFailure: true });
    if (!quota) return res.status(429).json({ error: 'Trop de tentatives. Patientez quelques minutes avant de réessayer.' });
    let reserveOk = false;
    try {
      const code = String(req.body?.code || '').trim();
      const inspected = await adminControl.inspectFieldCode(code);
      const token = crypto.randomBytes(24).toString('base64url');
      const reserved = await adminControl.reserveFieldCode(code, { token, req });
      if (!reserved) {
        return res.status(409).json({ error: 'Ce code est en cours d’utilisation par une autre personne. Patientez quelques minutes ou demandez un nouveau code.',
          code: 'CODE_RESERVED' });
      }
      reserveOk = true;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { valid: true, code: normalizeClientCode(code), token, reservedUntil: reserved.reservedUntil,
        reservedForMinutes: 15, hint: inspected.hint,
        managerLabel: inspected.createdByType === 'manager' ? inspected.createdByLabel : '',
        message: 'Code valide. Le formulaire est ouvert ; le code ne sera consommé qu’à l’envoi réussi de votre dossier.' } });
    } catch (error) { return fail(res, error, 'Ce code ne peut pas être utilisé.'); }
    finally { if (reserveOk && typeof quota === 'object') quota.refund(); }
  });

  // ---------------------------------------------------------------------------------------------
  // 4. NOTIFICATIONS (PDG et gestionnaire)
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/notifications', requireAdmin, async (req, res) => {
    try {
      const result = await adminControl.listNotifications({ recipientType: 'admin', recipientId: '',
        unreadOnly: req.query.unread === '1', limit: Number(req.query.limit) || 50 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(result);
    } catch (error) { return apiError(res, error, 'Impossible de charger les notifications.'); }
  });

  app.post('/api/admin/control/notifications/read', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const result = await adminControl.markNotificationsRead({ recipientType: 'admin', recipientId: '',
        ids: Array.isArray(req.body?.ids) ? req.body.ids : [] });
      return res.json(result);
    } catch (error) { return apiError(res, error, 'Impossible de marquer ces notifications.'); }
  });

  app.get('/api/manager/control/notifications', requireManager, async (req, res) => {
    try {
      // Le gestionnaire ne voit que les notifications qui LUI sont adressées : jamais celles du PDG.
      const result = await adminControl.listNotifications({ recipientType: 'manager', recipientId: String(req.manager.id),
        unreadOnly: req.query.unread === '1', limit: Number(req.query.limit) || 50 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json(result);
    } catch (error) { return apiError(res, error, 'Impossible de charger vos notifications.'); }
  });

  app.post('/api/manager/control/notifications/read', requireManager, checkSameOrigin, async (req, res) => {
    try {
      const result = await adminControl.markNotificationsRead({ recipientType: 'manager', recipientId: String(req.manager.id),
        ids: Array.isArray(req.body?.ids) ? req.body.ids : [] });
      return res.json(result);
    } catch (error) { return apiError(res, error, 'Impossible de marquer ces notifications.'); }
  });

  // ---------------------------------------------------------------------------------------------
  // 5. JOURNAL D'AUDIT
  // ---------------------------------------------------------------------------------------------
  app.get('/api/admin/control/journal', requireAdmin, async (req, res) => {
    try {
      const rows = await adminControl.listJournal({ managerId: String(req.query.managerId || ''),
        entityType: String(req.query.entityType || ''), merchantId: String(req.query.merchantId || ''),
        limit: Number(req.query.limit) || 100 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: rows });
    } catch (error) { return apiError(res, error, 'Impossible de charger le journal d’audit.'); }
  });

  // Export CSV : le PDG doit pouvoir sortir le journal pour un contrôle externe.
  app.get('/api/admin/control/journal/export', requireAdmin, async (req, res) => {
    try {
      const rows = await adminControl.listJournal({ managerId: String(req.query.managerId || ''),
        entityType: String(req.query.entityType || ''), merchantId: String(req.query.merchantId || ''), limit: 500 });
      const escape = (value) => `"${String(value == null ? '' : value).replace(/"/g, '""')}"`;
      const header = ['date', 'acteur', 'type', 'action', 'objet', 'identifiant', 'resume'];
      const lines = [header.join(';')].concat(rows.map((row) => [row.createdAt, row.actorLabel, row.actorType, row.action,
        row.entityType, row.entityId, row.summary].map(escape).join(';')));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="journal-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.end(`\uFEFF${lines.join('\r\n')}`);
    } catch (error) { return apiError(res, error, 'Impossible d’exporter le journal.'); }
  });

  // Le gestionnaire ne voit QUE ses propres opérations : le filtre par identifiant est imposé
  // côté serveur, un `managerId` fourni par le client est ignoré.
  app.get('/api/manager/control/journal', requireManager, async (req, res) => {
    try {
      const rows = await adminControl.listJournal({ managerId: String(req.manager.id), limit: 100 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: rows });
    } catch (error) { return apiError(res, error, 'Impossible de charger votre historique.'); }
  });

  return { adminControl };
};

