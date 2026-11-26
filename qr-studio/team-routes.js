'use strict';

// ============================================================================================
// Rubrique « Mon équipe » (côté marchand) + paramètres plateforme (côté Administrateur général).
//
// Le marchand est propriétaire : il crée lui-même ses gérants généraux et ses serveuses, sans
// passer par l'Administrateur général. Toutes les routes exigent une session marchand valide.
// Aucun mot de passe n'est jamais renvoyé en clair : seul un code d'activation l'est, une fois.
// ============================================================================================

const crypto = require('node:crypto');
const seed = require('./team-seed');
const { publicMember } = require('./team');

module.exports = function teamRoutes({ app, store, commerce, team, requireMerchant, requireAdmin, apiError, assignments, extras, ops }) {
  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);

  const actorOf = (req) => ({ type: 'merchant', id: req.merchant.id, label: 'Marchand' });

  async function ownStore(req) {
    const shop = await commerce.getStoreByMerchantId?.(req.merchant.id).catch(() => null);
    if (!shop) { const error = new Error('Configurez d’abord votre boutique avant de créer une équipe.'); error.status = 409; error.code = 'STORE_REQUIRED'; throw error; }
    return shop;
  }

  function fail(res, error, fallback) {
    if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    if (typeof apiError === 'function') return apiError(res, error, fallback);
    return res.status(500).json({ error: fallback });
  }

  // ------------------------------------------------------------------ quotas Mission 8
  // Source de vérité unique : quota particulier du PDG > quota hérité du code terrain > quota
  // plateforme. La vérification se fait ICI, côté serveur, avant toute création de membre.
  const { resolveTeamQuotas } = require('./admin-control');
  async function quotasFor(merchantId) {
    return resolveTeamQuotas({ team: { pg: Boolean(team.pg), base: team.base }, store }, merchantId).catch(async () => ({
      maxGeneralManagers: 1, maxWaitresses: 2, effectiveMaxGeneralManagers: 1, effectiveMaxWaitresses: 2, source: 'platform',
    }));
  }
  // Comptage : un membre bloqué/suspendu peut encore réserver une place selon le réglage du PDG.
  async function countTeam(merchantId, role, { suspendedReservesSlot = false } = {}) {
    // Lecture directe : `listMembers` peut exclure les archivés selon la version, et le quota doit
    // compter exactement les comptes non archivés, suspendus compris si le PDG l'a décidé.
    let rows = [];
    if (team.pg) {
      const { rows: data } = await team.base.pool.query(
        'SELECT id, role, status FROM team_members WHERE merchant_id=$1 AND status <> \'archived\'', [merchantId]).catch(() => ({ rows: [] }));
      rows = data;
    } else {
      const members = await team.listMembers(merchantId).catch(() => []);
      rows = members.filter((m) => m.role === role && m.status !== 'archived');
    }
    rows = rows.filter((m) => m.role === role);
    const usable = rows.filter((m) => suspendedReservesSlot || !['blocked', 'suspended'].includes(m.status));
    return { used: usable.length, total: rows.length,
      available: rows.filter((m) => m.status === 'active' || m.status === 'pending').length,
      suspended: rows.filter((m) => ['blocked', 'suspended'].includes(m.status)).length };
  }

  // ------------------------------------------------------------------ vue d'ensemble
  app.get('/api/merchant/team', requireMerchant, async (req, res) => {
    try {
      const settings = await team.getSettings(req.merchant.id);
      const platform = await platformLimits();
      const quota = await quotasFor(req.merchant.id);
      const gmCount = await countTeam(req.merchant.id, 'general_manager', { suspendedReservesSlot: quota.suspendedReservesSlot });
      const wtCount = await countTeam(req.merchant.id, 'waitress', { suspendedReservesSlot: quota.suspendedReservesSlot });
      const tasks = await team.listTasks(req.merchant.id);
      // Mission 11 : le marchand choisit les tables et salons DÉJÀ créés, et voit les affectations.
      const shop = await ownStore(req).catch(() => null);
      let points = [];
      if (shop && extras && typeof extras.listServicePoints === 'function') {
        // On lit les tables et salons des DEUX façons connues : l'accès direct (rapide) et la route
        // service-points de l'établissement. Le repli évite une rubrique vide si l'une change.
        const fromExtras = await extras.listServicePoints(shop.id).catch(() => null);
        let fromCommerce = null;
        if (commerce && typeof commerce.listServicePoints === 'function') {
          fromCommerce = await commerce.listServicePoints(shop.storeId || shop.id).catch(() => null);
        }
        points = (Array.isArray(fromExtras) && fromExtras.length ? fromExtras : (Array.isArray(fromCommerce) ? fromCommerce : [])) || [];
        // Les points explicites de la boutique servent de référence de cloisonnement.
        points = points.filter((point) => !point.storeId || String(point.storeId) === String(shop.storeId || shop.id));
      }
      // `getServicePointUsage` renvoie un DICTIONNAIRE { pointId: nombre } : on le lit tel quel.
      const usage = shop && commerce && typeof commerce.getServicePointUsage === 'function'
        ? await commerce.getServicePointUsage(shop.id).catch(() => ({})) : {};
      const usageMap = new Map(Object.entries(usage || {}).map(([id, count]) => [id, Number(count) || 0]));
      const assignmentMap = assignments && shop ? await assignments.mapByMember(req.merchant.id).catch(() => new Map()) : new Map();
      const members = (await team.listMembers(req.merchant.id, { includeArchived: req.query.archived === '1' }))
        .map((member) => ({ ...publicMember(member), openTasks: member.openTasks, servicePoints: assignmentMap.get(member.id) || [] }));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        // Quotas effectifs : ceux du PDG, pas ceux que le marchand s'est attribués.
        settings: { ...settings, effectiveMaxWaitresses: quota.effectiveMaxWaitresses,
          effectiveMaxGeneralManagers: quota.effectiveMaxGeneralManagers,
          quota: { maxGeneralManagers: quota.effectiveMaxGeneralManagers, maxWaitresses: quota.effectiveMaxWaitresses,
            source: quota.source, suspendedReservesSlot: quota.suspendedReservesSlot,
            merchantCanEditQuotas: quota.merchantCanEditQuotas,
            extraGeneralManagers: quota.extraGeneralManagers, extraWaitresses: quota.extraWaitresses,
            extraExpiresAt: quota.extraExpiresAt } },
        quotaUsage: {
          generalManagers: { used: gmCount.used, max: quota.effectiveMaxGeneralManagers, remaining: Math.max(0, quota.effectiveMaxGeneralManagers - gmCount.used), suspended: gmCount.suspended },
          waitresses: { used: wtCount.used, max: quota.effectiveMaxWaitresses, remaining: Math.max(0, quota.effectiveMaxWaitresses - wtCount.used), suspended: wtCount.suspended },
          generalManagersDetail: { used: gmCount.used, max: quota.effectiveMaxGeneralManagers, remaining: Math.max(0, quota.effectiveMaxGeneralManagers - gmCount.used), label: 'Gérants généraux' },
          waitressesDetail: { used: wtCount.used, max: quota.effectiveMaxWaitresses, remaining: Math.max(0, quota.effectiveMaxWaitresses - wtCount.used), label: 'Serveuses et serveurs' },
          message: 'Vous avez atteint le nombre maximum de comptes autorisés pour votre établissement. Veuillez contacter l’Administrateur général.',
        },
        platformLimits: platform,
        permissions: seed.PERMISSIONS,
        roles: seed.ROLES,
        members,
        counts: { generalManagers: members.filter((m) => m.role === 'general_manager' && m.status !== 'archived').length,
          waitresses: members.filter((m) => m.role === 'waitress' && m.status !== 'archived').length,
          active: members.filter((m) => m.status === 'active').length, blocked: members.filter((m) => m.status === 'blocked').length },
        tasks,
        // Espaces de l'établissement : utilisés tels quels à la création d'un compte.
        servicePoints: (points || []).map((point) => ({
          id: point.id, name: point.name, zone: point.zone || '', type: point.type, status: point.status,
          occupied: (usageMap.get(point.id) || 0) > 0, activeOrders: usageMap.get(point.id) || 0,
          publicCode: point.publicCode || '',
        })),
        teamBlocked: settings.teamBlocked === true,
      } });
    } catch (error) { return fail(res, error, 'Impossible de charger votre équipe.'); }
  });

  app.patch('/api/merchant/team/settings', requireMerchant, async (req, res) => {
    try {
      const platform = await platformLimits();
      const settings = await team.getSettings(req.merchant.id);
      const quota = await quotasFor(req.merchant.id);
      // RÈGLE MISSION 8 : les effectifs autorisés sont fixés par le PDG (ou hérités du code terrain).
      // Le marchand ne peut les modifier que si le PDG l'a explicitement autorisé pour ce compte.
      const wantsQuotaChange = req.body?.maxGeneralManagers !== undefined || req.body?.maxWaitresses !== undefined;
      if (wantsQuotaChange && !quota.merchantCanEditQuotas) {
        return res.status(403).json({ error: 'Les effectifs autorisés sont fixés par l’Administrateur général. Contactez-le pour toute modification.',
          code: 'QUOTA_LOCKED', quota: { maxGeneralManagers: quota.effectiveMaxGeneralManagers, maxWaitresses: quota.effectiveMaxWaitresses } });
      }
      const requested = {
        activationCodeTtlHours: Math.min(Number(req.body?.activationCodeTtlHours) || settings.activationCodeTtlHours, platform.activationCodeTtlHours),
        maxGeneralManagers: Math.min(Number(req.body?.maxGeneralManagers ?? settings.maxGeneralManagers) || settings.maxGeneralManagers, quota.effectiveMaxGeneralManagers),
        maxWaitresses: Math.min(Number(req.body?.maxWaitresses ?? settings.maxWaitresses) || settings.maxWaitresses, quota.effectiveMaxWaitresses),
        waitressMaxDiscountPercent: req.body?.waitressMaxDiscountPercent,
        allowFreePrice: req.body?.allowFreePrice,
        freePriceMaxXof: req.body?.freePriceMaxXof,
      };
      const updated = await team.updateSettings(req.merchant.id, requested);
      return res.json({ data: { settings: updated } });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer les paramètres de l’équipe.'); }
  });

  // ------------------------------------------------------------------ membres
  app.post('/api/merchant/team/members', requireMerchant, async (req, res) => {
    try {
      // Module fermé par l'Administrateur général : la création est refusée côté serveur, pas masquée.
      const platform = await platformLimits();
      if (platform.teamModuleEnabled === false) {
        return res.status(503).json({ error: 'La création d’équipe est momentanément fermée par l’Administrateur général.', code: 'TEAM_MODULE_CLOSED' });
      }
      const quota = await quotasFor(req.merchant.id);
      const role = String(req.body?.role || '');
      if (['general_manager', 'waitress'].includes(role)) {
        const max = role === 'general_manager' ? quota.effectiveMaxGeneralManagers : quota.effectiveMaxWaitresses;
        const count = await countTeam(req.merchant.id, role, { suspendedReservesSlot: quota.suspendedReservesSlot });
        if (count.used >= max) {
          // Le message est celui demandé par le cahier des charges, et le refus est côté serveur :
          // aucun contournement par un appel direct à l'API n'est possible.
          await store.addAudit({ actor: 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: 'team_quota_blocked',
            entityType: 'merchant', entityId: req.merchant.id, result: 'denied',
            summary: `Création refusée : quota ${role === 'general_manager' ? 'gérant' : 'serveuse'} atteint (${count.used}/${max}).` }).catch(() => {});
          return res.status(409).json({
            error: 'Vous avez atteint le nombre maximum de comptes autorisés pour votre établissement. Veuillez contacter l’Administrateur général.',
            code: 'TEAM_LIMIT', quota: { role, max, used: count.used, remaining: 0 } });
        }
      }
      const shop = await ownStore(req);
      // `password` : six chiffres choisis par le marchand ; absent = généré par le serveur.
      const created = await team.createMember(req.merchant.id, shop.id, {
        role, fullName: req.body?.fullName, phone: req.body?.phone, designation: req.body?.designation,
        username: req.body?.username, permissions: req.body?.permissions, password: req.body?.password,
        // `approveNow` n'est vrai que si l'écran l'a demandé : par défaut, un compte attend la
        // validation du marchand (circuit d'approbation de la mission 5 conservé).
        approveNow: req.body?.approveNow === true,
      }, actorOf(req));
      // Mission 11 : les tables et salons cochés dans le formulaire sont attribués dans la foulée.
      let assignmentsResult = null;
      if (assignments) {
        const pointIds = assignments.uniqueIds(req.body?.servicePointIds).slice(0, 200);
        assignmentsResult = await assignments.replaceForMember({ merchantId: req.merchant.id, storeId: shop.id,
          memberId: created.member.id, points: pointIds, actor: actorOf(req) }).catch(() => null);
      }
      await store.addAudit({ actor: 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: 'team_member_created',
        entityType: 'merchant', entityId: req.merchant.id, summary: `${created.member.designation} créé (${created.member.role}${created.member.status === 'pending' ? ', en attente de validation' : ''}).`, result: 'success',
        metadata: { memberId: created.member.id, role: created.member.role,
          servicePoints: assignmentsResult ? assignmentsResult.assignments.map((row) => row.servicePointId) : [] } }).catch(() => {});
      res.setHeader('Cache-Control', 'no-store');
      // `code` et le mot de passe généré ne sont renvoyés QUE maintenant : jamais relisibles ensuite.
      return res.status(201).json({ data: { member: publicMember(created.member), activation: { code: created.code, expiresAt: created.expiresAt,
        hint: seed.codeHint(created.code) }, assignments: assignmentsResult,
        temporaryPassword: created.passwordGenerated ? created.password : '',
        notice: created.member.status === 'pending'
          ? 'Compte en attente de validation. Transmettez le code d’activation au membre : il ne sera plus affiché.'
          : 'Compte créé et validé. Transmettez l’identifiant et le mot de passe au membre.' } });
    } catch (error) { return fail(res, error, 'Impossible de créer ce membre.'); }
  });

  app.patch('/api/merchant/team/members/:memberId', requireMerchant, async (req, res) => {
    try {
      const member = await team.updateMember(String(req.params.memberId), req.merchant.id, {
        fullName: req.body?.fullName, phone: req.body?.phone, designation: req.body?.designation,
        role: req.body?.role, username: req.body?.username, permissions: req.body?.permissions,
      }, actorOf(req));
      if (assignments && req.body?.servicePointIds !== undefined) {
        const shop = await ownStore(req);
        await assignments.replaceForMember({ merchantId: req.merchant.id, storeId: shop.id, memberId: member.id,
          points: req.body.servicePointIds, actor: actorOf(req) });
      }
      await store.addAudit({ actor: 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: 'team_member_updated',
        entityType: 'merchant', entityId: req.merchant.id, summary: `Membre ${member.designation} modifié.`, result: 'success',
        metadata: { memberId: member.id } }).catch(() => {});
      return res.json({ data: { member: publicMember(member) } });
    } catch (error) { return fail(res, error, 'Impossible de modifier ce membre.'); }
  });

  app.post('/api/merchant/team/members/:memberId/status', requireMerchant, async (req, res) => {
    try {
      const status = clean(req.body?.status, 20);
      const member = await team.setStatus(String(req.params.memberId), req.merchant.id, status, clean(req.body?.reason, 200), actorOf(req));
      await store.addAudit({ actor: 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: `team_member_${status}`,
        entityType: 'merchant', entityId: req.merchant.id, summary: `Membre ${member.designation} → ${status}.`, result: 'success',
        metadata: { memberId: member.id, reason: clean(req.body?.reason, 200) } }).catch(() => {});
      return res.json({ data: { member: publicMember(member) }, notice: status === 'blocked' ? 'Accès coupé immédiatement, sessions ouvertes comprises.' : undefined });
    } catch (error) { return fail(res, error, 'Impossible de changer l’état de ce membre.'); }
  });

  // Blocage de TOUTE l'équipe : exige une confirmation explicite, jamais un simple clic.
  app.post('/api/merchant/team/status-all', requireMerchant, async (req, res) => {
    try {
      const status = clean(req.body?.status, 20);
      if (!['blocked', 'active'].includes(status)) return res.status(400).json({ error: 'Seuls le blocage et le déblocage de toute l’équipe sont autorisés ici.' });
      if (req.body?.confirm !== true || clean(req.body?.acknowledge, 40) !== 'TOUTE-EQUIPE') {
        return res.status(428).json({ error: 'Confirmez explicitement le blocage de toute l’équipe.', code: 'CONFIRMATION_REQUIRED' });
      }
      const result = await team.setAllStatus(req.merchant.id, status, clean(req.body?.reason, 200), actorOf(req));
      await store.addAudit({ actor: 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: `team_${status === 'blocked' ? 'block_all' : 'unblock_all'}`,
        entityType: 'merchant', entityId: req.merchant.id, summary: `${result.changed} membre(s) ${status === 'blocked' ? 'bloqué(s)' : 'réactivé(s)'}.`, result: 'success' }).catch(() => {});
      return res.json({ data: result, notice: status === 'blocked'
        ? 'Toute l’équipe est bloquée. Les sessions ouvertes ont été coupées. Les commandes et statistiques sont conservées.'
        : 'Toute l’équipe peut de nouveau se connecter.' });
    } catch (error) { return fail(res, error, 'Impossible de changer l’état de l’équipe.'); }
  });

  // ------------------------------------------------------------------ affectations (Mission 11)
  // Le marchand attribue plusieurs tables et salons à un même membre, et la même table à
  // plusieurs membres. Chaque changement est historisé : on sait qui était responsable et quand.
  app.get('/api/merchant/team/members/:memberId/assignments', requireMerchant, async (req, res) => {
    try {
      if (!assignments) return res.status(503).json({ error: 'Affectations indisponibles.' });
      const member = await team.getMember(String(req.params.memberId), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
      const rows = await assignments.forMember(req.merchant.id, member.id);
      const shop = await ownStore(req);
      const points = await assignments.pointsOfStore(shop.id);
      return res.json({ data: { member: publicMember(member), assignments: rows, servicePoints: points } });
    } catch (error) { return fail(res, error, 'Impossible de charger les affectations.'); }
  });

  app.put('/api/merchant/team/members/:memberId/assignments', requireMerchant, async (req, res) => {
    try {
      if (!assignments) return res.status(503).json({ error: 'Affectations indisponibles.' });
      const shop = await ownStore(req);
      const member = await team.getMember(String(req.params.memberId), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
      const result = await assignments.replaceForMember({ merchantId: req.merchant.id, storeId: shop.id,
        memberId: member.id, points: req.body?.servicePointIds, actor: actorOf(req) });
      await store.addAudit({ actor: 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: 'team_member_assignments_updated',
        entityType: 'merchant', entityId: req.merchant.id,
        summary: `Affectations de ${member.designation || member.fullName} mises à jour (${result.added.length} ajout, ${result.removed.length} retrait).`,
        result: 'success', metadata: { memberId: member.id, added: result.added, removed: result.removed } }).catch(() => {});
      return res.json({ data: result, notice: 'Affectations enregistrées. L’ancien responsable reste inscrit dans l’historique.' });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer les affectations.'); }
  });

  // Historique d'une table : qui en était responsable, et à quel moment.
  app.get('/api/merchant/team/service-points/:pointId/history', requireMerchant, async (req, res) => {
    try {
      if (!assignments) return res.status(503).json({ error: 'Affectations indisponibles.' });
      const shop = await ownStore(req);
      const rows = await assignments.historyForPoint(req.merchant.id, shop.id, String(req.params.pointId));
      return res.json({ data: { history: rows } });
    } catch (error) { return fail(res, error, 'Impossible de charger l’historique des affectations.'); }
  });

  // ------------------------------------------------------------------ codes d'activation
  app.get('/api/merchant/team/members/:memberId/codes', requireMerchant, async (req, res) => {
    try {
      const codes = await team.listActivationCodes(String(req.params.memberId), req.merchant.id);
      return res.json({ data: { codes } });
    } catch (error) { return fail(res, error, 'Impossible de charger les codes.'); }
  });

  app.post('/api/merchant/team/members/:memberId/codes', requireMerchant, async (req, res) => {
    try {
      const member = await team.getMember(String(req.params.memberId), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
      const issued = await team.issueActivationCode(member.id, actorOf(req));
      return res.status(201).json({ data: { activation: { code: issued.code, expiresAt: issued.expiresAt, hint: issued.hint },
        notice: 'Les codes précédents non utilisés ont été révoqués. Ce code ne sera plus affiché.' } });
    } catch (error) { return fail(res, error, 'Impossible de générer un code.'); }
  });

  app.delete('/api/merchant/team/members/:memberId/codes/:codeId', requireMerchant, async (req, res) => {
    try {
      await team.revokeActivationCode(String(req.params.codeId), req.merchant.id);
      return res.json({ data: { revoked: true } });
    } catch (error) { return fail(res, error, 'Impossible de révoquer ce code.'); }
  });

  // Réinitialisation d'accès : coupe les sessions et émet un nouveau code. Jamais de mot de passe en clair.
  app.post('/api/merchant/team/members/:memberId/reset-access', requireMerchant, async (req, res) => {
    try {
      const member = await team.getMember(String(req.params.memberId), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
      await team.revokeSessions(member.id);
      const issued = await team.issueActivationCode(member.id, actorOf(req));
      await team.recordActivity(req.merchant.id, member.storeId, member.id, 'access_reset', 'Accès réinitialisé par le marchand.', 'success');
      return res.json({ data: { activation: { code: issued.code, expiresAt: issued.expiresAt, hint: issued.hint },
        notice: 'Sessions coupées. Le membre doit activer ce nouveau code pour définir un mot de passe.' } });
    } catch (error) { return fail(res, error, 'Impossible de réinitialiser cet accès.'); }
  });

  // ------------------------------------------------------------------ activité et statistiques
  app.get('/api/merchant/team/activity', requireMerchant, async (req, res) => {
    try {
      const rows = await team.listActivity(req.merchant.id, { memberId: clean(req.query.memberId, 60), limit: Number(req.query.limit) || 100 });
      return res.json({ data: rows });
    } catch (error) { return fail(res, error, 'Impossible de charger l’activité.'); }
  });

  app.get('/api/merchant/team/members/:memberId/stats', requireMerchant, async (req, res) => {
    try {
      const member = await team.getMember(String(req.params.memberId), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
      const tasks = await team.listTasks(req.merchant.id, { memberId: member.id });
      let orders = { count: 0, totalXof: 0, lastAt: null };
      let scansCount = 0;
      if (team.pg) {
        const { rows } = await team.base.pool.query(
          `SELECT COUNT(*)::int AS count, COALESCE(SUM(total_amount_xof),0)::bigint AS "totalXof", MAX(created_at) AS "lastAt"
             FROM merchant_orders WHERE merchant_id=$1 AND created_by_member_id=$2 AND status <> 'cancelled'`, [req.merchant.id, member.id]);
        orders = { count: rows[0]?.count || 0, totalXof: Number(rows[0]?.totalXof) || 0, lastAt: rows[0]?.lastAt || null };
        // Les données conservées après un blocage incluent les scans et les points : le marchand
        // doit pouvoir les consulter même si le compte est bloqué ou désactivé.
        const scans = await team.base.pool.query('SELECT COUNT(*)::int AS n FROM merchant_scan_events WHERE merchant_id=$1 AND member_id=$2', [req.merchant.id, member.id]);
        scansCount = Number(scans.rows[0]?.n) || 0;
      }
      return res.json({ data: { member: publicMember(member), orders, scans: scansCount, points: Number(member.points) || 0,
        tasks: { total: tasks.length, done: tasks.filter((t) => t.status === 'done').length,
          open: tasks.filter((t) => ['todo', 'in_progress'].includes(t.status)).length } } });
    } catch (error) { return fail(res, error, 'Impossible de charger les statistiques de ce membre.'); }
  });

  // ------------------------------------------------------------------ tâches (marchand)
  app.get('/api/merchant/team/tasks', requireMerchant, async (req, res) => {
    try { return res.json({ data: await team.listTasks(req.merchant.id, { memberId: clean(req.query.memberId, 60), status: clean(req.query.status, 20) }) }); }
    catch (error) { return fail(res, error, 'Impossible de charger les tâches.'); }
  });

  app.post('/api/merchant/team/tasks', requireMerchant, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const task = await team.createTask(req.merchant.id, shop.id, req.body || {}, actorOf(req));
      return res.status(201).json({ data: { task } });
    } catch (error) { return fail(res, error, 'Impossible de créer cette tâche.'); }
  });

  app.post('/api/merchant/team/tasks/:taskId/status', requireMerchant, async (req, res) => {
    try {
      const task = await team.updateTaskStatus(String(req.params.taskId), req.merchant.id, clean(req.body?.status, 20), actorOf(req), clean(req.body?.note, 200));
      return res.json({ data: { task } });
    } catch (error) { return fail(res, error, 'Impossible de mettre à jour cette tâche.'); }
  });

  app.get('/api/merchant/team/tasks/:taskId/history', requireMerchant, async (req, res) => {
    try {
      const task = await team.getTask(String(req.params.taskId), req.merchant.id);
      if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
      return res.json({ data: { task, events: await team.listTaskEvents(task.id, req.merchant.id) } });
    } catch (error) { return fail(res, error, 'Impossible de charger l’historique.'); }
  });

  // ------------------------------------------------------------------ Administrateur général
  app.get('/api/admin/team-settings', requireAdmin, async (req, res) => {
    try { return res.json({ data: { limits: await platformLimits(true) } }); }
    catch (error) { return fail(res, error, 'Impossible de charger les paramètres plateforme.'); }
  });

  app.patch('/api/admin/team-settings', requireAdmin, async (req, res) => {
    try {
      const current = await platformLimits(true);
      const next = {
        maxGeneralManagersPerMerchant: clamp(Number(req.body?.maxGeneralManagersPerMerchant), 0, 200, current.maxGeneralManagersPerMerchant),
        maxWaitressesPerMerchant: clamp(Number(req.body?.maxWaitressesPerMerchant), 0, 500, current.maxWaitressesPerMerchant),
        activationCodeTtlHours: clamp(Number(req.body?.activationCodeTtlHours), 1, 720, current.activationCodeTtlHours),
        teamModuleEnabled: req.body?.teamModuleEnabled === undefined ? current.teamModuleEnabled !== false : req.body.teamModuleEnabled === true,
      };
      if (!team.pg) { if (store.state) { store.state.appSettings ||= {}; store.state.appSettings.teamLimits = next; await store.save?.(); } }
      else {
        await team.base.pool.query(
          `INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('teamLimits',$1::jsonb,NOW())
           ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`, [JSON.stringify(next)]);
      }
      await store.addAudit({ actor: 'Administrateur général', actorType: 'admin', action: 'team_limits_updated', entityType: 'settings',
        entityId: 'teamLimits', summary: 'Paramètres plateforme de l’équipe mis à jour.', result: 'success', metadata: next }).catch(() => {});
      return res.json({ data: { limits: next } });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer les paramètres plateforme.'); }
  });

  // Liste globale en lecture seule : l'Administrateur général ne crée ni ne modifie de membre d'équipe.
  app.get('/api/admin/team-overview', requireAdmin, async (req, res) => {
    try {
      if (!team.pg) return res.json({ data: { merchants: [] } });
      const { rows } = await team.base.pool.query(
        `SELECT m.merchant_id AS "merchantId", a.display_name AS "merchantName", COUNT(*)::int AS members,
                COUNT(*) FILTER (WHERE m.role='general_manager')::int AS "generalManagers",
                COUNT(*) FILTER (WHERE m.role='waitress')::int AS waitresses,
                COUNT(*) FILTER (WHERE m.status='active')::int AS active,
                COUNT(*) FILTER (WHERE m.status='blocked')::int AS blocked
           FROM team_members m JOIN merchant_accounts a ON a.id=m.merchant_id WHERE m.status <> 'archived'
          GROUP BY m.merchant_id, a.display_name ORDER BY members DESC LIMIT 200`);
      return res.json({ data: { merchants: rows } });
    } catch (error) { return fail(res, error, 'Impossible de charger la vue globale.'); }
  });

  async function platformLimits(strict = false) {
    const fallback = { maxGeneralManagersPerMerchant: 10, maxWaitressesPerMerchant: 50, activationCodeTtlHours: 72, teamModuleEnabled: true };
    try {
      if (!team.pg) return fallback;
      const { rows } = await team.base.pool.query("SELECT setting_value FROM app_settings WHERE setting_key='teamLimits'");
      return { ...fallback, ...(rows[0]?.setting_value || {}) };
    } catch (error) { if (strict) throw error; return fallback; }
  }

  function clamp(value, min, max, fallbackValue) {
    if (!Number.isFinite(value)) return fallbackValue;
    return Math.max(min, Math.min(max, Math.round(value)));
  }

  return { platformLimits };
};
