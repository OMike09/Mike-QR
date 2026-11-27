'use strict';

// ============================================================================================
// Mission 6 — Contrôle opérationnel côté MARCHAND.
//
//   GET   /api/merchant/overview                 vue d'ensemble (chiffres réels)
//   GET   /api/merchant/points                   points de l'équipe + barème + journal
//   PUT   /api/merchant/points/settings          barème modifiable
//   POST  /api/merchant/points/adjust            correction motivée, tracée, jamais effacée
//   GET   /api/merchant/leaderboard              classement par période
//   GET   /api/merchant/orders-tracking          commandes avec source, auteur, serveuse, table
//   GET   /api/merchant/orders/:id/tracking      détail + historique des changements + affectations
//   POST  /api/merchant/orders/:id/assign        affecter / transférer à une serveuse
//   GET   /api/merchant/tables                   tables, occupation, affectation, commandes
//   POST  /api/merchant/tables/:id/assign        affecter une table à une serveuse
//   GET   /api/merchant/notifications            notifications de supervision
//   GET   /api/merchant/messages                 fils de discussion
//   POST  /api/merchant/messages                 ouvrir un fil (support gestionnaire ou consigne)
//   GET   /api/merchant/messages/:id             fil + messages + statut de lecture
//   POST  /api/merchant/messages/:id/messages    répondre
//   POST  /api/merchant/messages/:id/close       clôturer
//   GET   /api/merchant/team/activity-feed       flux activité consolidé (pour la page équipe)
//
// Aucune route n'accepte un identifiant de boutique fourni par le client : tout est résolu depuis
// la session marchand. Une serveuse n'est jamais vue au travers de ces routes.
// ============================================================================================

const { overviewStats } = require('./team-analytics');

module.exports = function merchantOpsRoutes({ app, store, commerce, team, ops, extras, requireMerchant, checkSameOrigin, apiError, notifyMerchant, settlement = null }) {
  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const actorOf = (req) => ({ type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username });

  // checkSameOrigin est un middleware Express : il faut lui passer `next`.
  const guard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || typeof checkSameOrigin !== 'function') return next();
    return checkSameOrigin(req, res, next);
  };

  async function primaryStore(merchantId) {
    return commerce.getStoreByMerchantId(merchantId).catch(() => null);
  }
  // `storeIdFromQuery` n'est jamais accepté du client : la boutique est toujours celle du marchand
  // connecté (une seule boutique par compte marchand).
  async function resolveStore(req) { return primaryStore(req.merchant.id); }
  const fail = (res, error, fallback) => {
    if (error && error.status && error.status < 500) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error && error.message && !error.code) return res.status(400).json({ error: error.message });
    if (typeof apiError === 'function') return apiError(res, error, fallback);
    return res.status(500).json({ error: fallback });
  };

  // ------------------------------------------------------------------ 1. vue d'ensemble
  app.get('/api/merchant/overview', requireMerchant, guard, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'all';
      const shop = await resolveStore(req);
      const { periodStart } = require('./team-analytics');
      // Sans boutique publiée, les compteurs retombent naturellement à zéro : aucune erreur, aucun chiffre inventé.
      const storeId = shop?.id || '';
      const from = period === 'all' ? null : periodStart(period);
      const [stats, pointsSettings, assignmentCounts] = await Promise.all([
        overviewStats(team.base.pool, { merchantId: req.merchant.id, storeId, from }),
        ops.getPointSettings(req.merchant.id),
        team.base.pool.query(
          `SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE o.status IN ('pending','confirmed','preparing','ready'))::int AS active
             FROM merchant_service_points p
             LEFT JOIN merchant_orders o ON o.service_point_id=p.id AND o.status NOT IN ('completed','cancelled','rejected')
            WHERE ($1::text <> '' AND p.store_id=$1) AND p.status='active'`, [storeId]).then((r) => r.rows[0]).catch(() => ({ total: 0, active: 0 })),
      ]);
      // Tâches en cours du gérant et des serveuses, séparément : le marchand voit tout.
      const tasksByRole = await team.base.pool.query(
        `SELECT m.role, COUNT(t.id)::int AS open FROM team_tasks t JOIN team_members m ON m.id=t.member_id
          WHERE t.merchant_id=$1 AND ($2::text='' OR t.store_id=$2) AND t.status IN ('todo','in_progress') GROUP BY m.role`,
        [req.merchant.id, storeId]).then((r) => r.rows).catch(() => []);
      const unreadMessages = await team.base.pool.query(
        `SELECT COUNT(*)::int AS n FROM team_conversations c
          WHERE c.merchant_id=$1 AND c.status <> 'closed' AND c.created_by_type <> 'merchant'`,
        [req.merchant.id]).then((r) => r.rows[0]?.n || 0).catch(() => 0);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: {
        store: shop ? { id: shop.id, name: shop.name, slug: shop.slug } : null,
        period, stats,
        pointSettings: pointsSettings,
        servicePoints: { total: Number(assignmentCounts?.total) || 0, occupied: Number(assignmentCounts?.active) || 0 },
        tasksByRole: Object.fromEntries(tasksByRole.map((row) => [row.role, Number(row.open) || 0])),
        unreadMessages: Number(unreadMessages) || 0,
      } });
    } catch (error) { return fail(res, error, 'Impossible de calculer la vue d’ensemble.'); }
  });

  // ------------------------------------------------------------------ 3. points
  app.get('/api/merchant/points', requireMerchant, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'all';
      const members = (await team.listMembers(req.merchant.id, {})).filter((m) => m.role === 'waitress');
      const rows = [];
      for (const member of members) {
        const stats = await ops.memberStats(req.merchant.id, member.id, { period });
        rows.push({ id: member.id, designation: member.designation || member.fullName, fullName: member.fullName,
          status: member.status, points: stats.points, scans: stats.scans, orders: stats.orders,
          completedOrders: stats.completedOrders, validatedOrders: stats.validatedOrders,
          tasksDone: stats.tasksDone, tasksLate: stats.tasksLate, byDay: stats.byDay });
      }
      const [settings, history] = await Promise.all([ops.getPointSettings(req.merchant.id), ops.pointsHistory(req.merchant.id, { limit: 80 })]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { period, settings, waitresses: rows, history,
        rules: [
          'Un scan ne compte qu’une fois, même si la serveuse le relance.',
          'Une commande annulée n’est jamais comptée comme commande terminée.',
          'Une commande crédite celle qui l’a enregistrée ; attribuer les points à la serveuse responsable demande une règle activée explicitement.',
          'Un scan et une commande sont deux actions différentes : les deux peuvent compter.',
        ] } });
    } catch (error) { return fail(res, error, 'Impossible de charger les points.'); }
  });

  app.put('/api/merchant/points/settings', requireMerchant, guard, async (req, res) => {
    try {
      const body = req.body || {};
      const settings = await ops.updatePointSettings(req.merchant.id, {
        pointsScan: body.pointsScan, pointsOrder: body.pointsOrder,
        pointsOrderCompleted: body.pointsOrderCompleted, pointsTask: body.pointsTask,
        creditAssignedServer: body.creditAssignedServer,
      });
      await store.addAudit({ actor: `${req.merchant.displayName} (@${req.merchant.username})`, actorType: 'merchant', actorId: req.merchant.id,
        action: 'points_settings_update', entityType: 'team', entityId: req.merchant.id,
        summary: 'Barème des points mis à jour.', result: 'success', metadata: settings });
      return res.json({ data: settings });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer le barème.'); }
  });

  app.post('/api/merchant/points/adjust', requireMerchant, guard, async (req, res) => {
    try {
      const body = req.body || {};
      const member = await team.getMember(String(body.memberId || ''), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
      const row = await ops.manualAdjust({ merchantId: req.merchant.id, storeId: member.storeId || '', memberId: member.id,
        points: body.points, reason: clean(body.reason, 200), actor: actorOf(req) });
      await store.addAudit({ actor: `${req.merchant.displayName} (@${req.merchant.username})`, actorType: 'merchant', actorId: req.merchant.id,
        action: 'points_adjust', entityType: 'team_member', entityId: member.id,
        summary: `Points corrigés (${row.points > 0 ? '+' : ''}${row.points}) : ${row.reason}`, result: 'success', metadata: { points: row.points, reason: row.reason } });
      return res.status(201).json({ data: { event: row, points: await team.getMember(member.id, req.merchant.id).then((m) => Number(m?.points) || 0) } });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer cette correction.'); }
  });

  app.get('/api/merchant/leaderboard', requireMerchant, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
      const board = await ops.leaderboard(req.merchant.id, { period });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: board });
    } catch (error) { return fail(res, error, 'Impossible de calculer le classement.'); }
  });

  // ------------------------------------------------------------------ 5. traçabilité des commandes
  app.get('/api/merchant/orders-tracking', requireMerchant, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const shop = await resolveStore(req);
      if (!shop) return res.status(409).json({ error: 'Publiez d’abord votre boutique.', code: 'STORE_REQUIRED' });
      const params = [shop.id]; const where = ['o.store_id=$1'];
      if (req.query.status) { params.push(clean(req.query.status, 20)); where.push(`o.status=$${params.length}`); }
      if (req.query.source) { params.push(clean(req.query.source, 30)); where.push(`o.source=$${params.length}`); }
      if (req.query.memberId) { params.push(clean(req.query.memberId, 60)); where.push(`(o.created_by_member_id=$${params.length} OR o.assigned_member_id=$${params.length})`); }
      params.push(Math.min(Number(req.query.limit) || 60, 200));
      const { rows } = await team.base.pool.query(
        `SELECT o.id, o.public_reference AS reference, o.status, o.source, o.created_at AS "createdAt", o.updated_at AS "updatedAt",
                o.total_amount_xof AS "totalAmountXof", o.currency, o.order_type AS "orderType",
                o.customer_name AS "customerName", o.customer_phone AS "customerPhone",
                o.service_point_id AS "servicePointId", o.service_point_name AS "servicePointName",
                o.created_by_type AS "createdByType", o.created_by_member_id AS "createdByMemberId",
                o.created_by_designation AS "createdByDesignation",
                o.assigned_member_id AS "assignedMemberId", o.assigned_designation AS "assignedDesignation",
                (SELECT COUNT(*)::int FROM merchant_order_items i WHERE i.order_id=o.id) AS "itemCount",
                (SELECT MIN(e.created_at) FROM merchant_order_events e WHERE e.order_id=o.id) AS "firstEventAt"
           FROM merchant_orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at DESC LIMIT $${params.length}`, params);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { rows: rows.map((row) => ({
        ...row,
        sourceLabel: SOURCE_LABELS[row.source] || row.source,
        createdBy: row.createdByMemberId
          ? { type: row.createdByType, id: row.createdByMemberId, label: row.createdByDesignation || 'Membre de l’équipe' }
          : { type: row.createdByType, id: '', label: row.createdByType === 'customer' ? 'Client (QR)' : (SOURCE_LABELS[row.source] || row.source) },
      })) } });
    } catch (error) { return fail(res, error, 'Impossible de charger la traçabilité des commandes.'); }
  });

  app.get('/api/merchant/orders/:orderId/tracking', requireMerchant, async (req, res) => {
    try {
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.merchant.id) return res.status(404).json({ error: 'Commande introuvable.' });
      const [events, assignments, scan] = await Promise.all([
        Promise.resolve(order.events || []),
        ops.assignmentHistory(order.id, req.merchant.id),
        order.scanEventId ? team.base.pool.query('SELECT id, category, channel, scanned_at AS "scannedAt", qr_code AS "qrCode" FROM merchant_scan_events WHERE id=$1', [order.scanEventId]).then((r) => r.rows[0] || null).catch(() => null) : null,
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { order, events, assignments, scan,
        sourceLabel: SOURCE_LABELS[order.source] || order.source } });
    } catch (error) { return fail(res, error, 'Impossible de charger le détail de cette commande.'); }
  });

  app.post('/api/merchant/orders/:orderId/assign', requireMerchant, guard, async (req, res) => {
    try {
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.merchant.id) return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      const result = await ops.assignOrder({ merchantId: req.merchant.id, storeId: order.storeId, orderId: order.id,
        memberId: clean(req.body?.memberId, 60), reason: clean(req.body?.reason, 200), actor: actorOf(req) });
      await store.addAudit({ actor: `${req.merchant.displayName} (@${req.merchant.username})`, actorType: 'merchant', actorId: req.merchant.id,
        action: 'order_assign', entityType: 'merchant_order', entityId: order.id,
        summary: `Commande ${order.reference} : ${result.action}${result.memberId ? ' à une serveuse' : ''}.`, result: 'success', metadata: result });
      try { module.exports.onOrderAssigned?.({ merchantId: req.merchant.id, orderId: order.id, memberId: result.memberId }); } catch (_) {}
      return res.json({ data: { order: await commerce.getOrder(order.id), assignment: result } });
    } catch (error) { return fail(res, error, 'Impossible d’affecter cette commande.'); }
  });

  // ------------------------------------------------------------------ 8 bis. règlement (§4.3)
  //   POST /api/merchant/orders/:orderId/settle
  //   Une seule action : validation + confirmation du paiement réellement reçu.
  //   Refus explicite si le prestataire n'a pas confirmé un paiement électronique.
  app.post('/api/merchant/orders/:orderId/settle', requireMerchant, guard, async (req, res) => {
    try {
      if (!settlement) return res.status(503).json({ error: 'La validation des paiements est indisponible.' });
      const shop = await resolveStore(req);
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.merchant.id) return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      const result = await settlement.settle({ storeId: shop.id, orderId: order.id, method: req.body?.method,
        receivedXof: req.body?.receivedXof, reason: clean(req.body?.reason, 300),
        actor: { type: 'merchant', id: req.merchant.id, label: `${req.merchant.displayName || 'Marchand'} (@${req.merchant.username || ''})` } });
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error, code: result.code || '',
        expectedXof: result.expectedXof, receivedXof: result.receivedXof, canValidateOnly: Boolean(result.canValidateOnly) });
      await store.addAudit({ actor: `${req.merchant.displayName} (@${req.merchant.username})`, actorType: 'merchant', actorId: req.merchant.id,
        action: 'order_settled', entityType: 'merchant_order', entityId: order.id, result: 'success',
        summary: `Commande ${order.reference} validée, paiement confirmé (${result.methodLabel || result.method}, ${result.receivedXof} XOF).`,
        metadata: { paymentStatus: result.paymentStatus, totalXof: result.totalXof, receivedXof: result.receivedXof } }).catch(() => {});
      return res.json({ data: result });
    } catch (error) { return fail(res, error, 'Impossible de valider cette commande.'); }
  });

  // ------------------------------------------------------------------ 9. tables et emplacements
  app.get('/api/merchant/tables', requireMerchant, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const shop = await resolveStore(req);
      if (!shop) return res.status(409).json({ error: 'Publiez d’abord votre boutique.', code: 'STORE_REQUIRED' });
      const [points, assignments] = await Promise.all([extras.listServicePoints(shop.id), ops.listServicePointAssignments(shop.id)]);
      const { rows: orders } = await team.base.pool.query(
        `SELECT o.id, o.public_reference AS reference, o.status, o.service_point_id AS "servicePointId",
                o.assigned_designation AS "assignedDesignation", o.created_by_designation AS "createdByDesignation",
                o.total_amount_xof AS "totalAmountXof", o.created_at AS "createdAt"
           FROM merchant_orders o WHERE o.store_id=$1 AND o.service_point_id IS NOT NULL
            AND o.status NOT IN ('completed','cancelled','rejected') ORDER BY o.created_at DESC`, [shop.id]);
      const assignmentByPoint = new Map(assignments.map((a) => [a.servicePointId, a]));
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { store: { id: shop.id, name: shop.name }, tables: points.map((point) => {
        const activeOrders = orders.filter((o) => o.servicePointId === point.id);
        const assignment = assignmentByPoint.get(point.id);
        return { id: point.id, name: point.name, zone: point.zone, type: point.type, status: point.status,
          publicCode: point.publicCode, qrScanCount: Number(point.qrScanCount) || 0,
          occupied: activeOrders.length > 0, activeOrders,
          assignedTo: assignment ? { memberId: assignment.memberId, designation: assignment.designation || '' } : null };
      }) } });
    } catch (error) { return fail(res, error, 'Impossible de charger les tables.'); }
  });

  app.post('/api/merchant/tables/:pointId/assign', requireMerchant, guard, async (req, res) => {
    try {
      const shop = await resolveStore(req);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable.', code: 'STORE_REQUIRED' });
      const result = await ops.assignServicePoint({ merchantId: req.merchant.id, storeId: shop.id,
        servicePointId: String(req.params.pointId), memberId: clean(req.body?.memberId, 60), actor: actorOf(req) });
      return res.json({ data: result });
    } catch (error) { return fail(res, error, 'Impossible d’affecter cette table.'); }
  });

  // ------------------------------------------------------------------ 8. notifications de supervision
  app.get('/api/merchant/notifications', requireMerchant, async (req, res) => {
    try {
      const rows = await commerce.listNotifications(req.merchant.id, { limit: 40 });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { notifications: rows.data, unreadCount: rows.unreadCount } });
    } catch (error) { return fail(res, error, 'Impossible de charger les notifications.'); }
  });

  // ------------------------------------------------------------------ 7. messagerie
  app.get('/api/merchant/messages', requireMerchant, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'La messagerie nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const kind = ['support', 'internal'].includes(req.query.kind) ? req.query.kind : '';
      const params = [req.merchant.id]; let kindClause = '';
      if (kind) { params.push(kind); kindClause = ` AND c.kind=$${params.length}`; }
      const { rows } = await team.base.pool.query(
        `SELECT c.id, c.kind, c.subject, c.category, c.status, c.created_by_type AS "createdByType", c.created_by_label AS "createdByLabel",
                c.last_message_at AS "lastMessageAt", c.created_at AS "createdAt", c.closed_at AS "closedAt",
                m.designation AS "memberDesignation",
                (SELECT COUNT(*)::int FROM team_messages tm WHERE tm.conversation_id=c.id) AS "messageCount",
                (SELECT body FROM team_messages tm WHERE tm.conversation_id=c.id ORDER BY tm.created_at DESC LIMIT 1) AS "lastBody"
           FROM team_conversations c LEFT JOIN team_members m ON m.id=c.member_id
          WHERE c.merchant_id=$1${kindClause} ORDER BY c.last_message_at DESC LIMIT 100`, params);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { conversations: rows, unread: rows.filter((row) => row.status !== 'closed' && row.createdByType !== 'merchant').length,
        manager: await primaryManager(req.merchant.id) } });
    } catch (error) { return fail(res, error, 'Impossible de charger la messagerie.'); }
  });

  app.post('/api/merchant/messages', requireMerchant, guard, async (req, res) => {
    try {
      const body = req.body || {};
      const subject = clean(body.subject, 140);
      const message = clean(body.body, 4000);
      if (subject.length < 3) return res.status(400).json({ error: 'Indiquez un sujet de 3 caractères au moins.' });
      if (message.length < 3) return res.status(400).json({ error: 'Écrivez votre message.' });
      const kind = body.kind === 'internal' ? 'internal' : 'support';
      let managerId = null; let memberId = null;
      if (kind === 'support') {
        const manager = await primaryManager(req.merchant.id);
        if (!manager) return res.status(409).json({ error: 'Aucun gestionnaire n’est rattaché à votre boutique pour le moment.', code: 'NO_MANAGER' });
        managerId = manager.id;
      } else {
        const member = await team.getMember(clean(body.memberId, 60), req.merchant.id);
        if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.' });
        memberId = member.id;
      }
      const conversation = await createConversation({ merchantId: req.merchant.id, storeId: clean(body.storeId, 60) || null, kind,
        managerId, memberId, subject, category: clean(body.category, 30) || 'other',
        author: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username },
        body: message, attachment: normalizeAttachment(body.attachment) });
      if (memberId) await ops.notify({ merchantId: req.merchant.id, storeId: conversation.storeId, memberId, type: 'internal_message',
        title: 'Consigne du marchand', message: subject, data: { conversationId: conversation.id }, dedupeKey: `conv:${conversation.id}:open` });
      return res.status(201).json({ data: { conversation } });
    } catch (error) { return fail(res, error, 'Impossible d’envoyer ce message.'); }
  });

  app.get('/api/merchant/messages/:conversationId', requireMerchant, async (req, res) => {
    try {
      const conversation = await getConversation(String(req.params.conversationId), req.merchant.id);
      if (!conversation) return res.status(404).json({ error: 'Conversation introuvable.' });
      const messages = await listMessages(conversation.id);
      await markRead(conversation.id, 'merchant', req.merchant.id);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { conversation, messages } });
    } catch (error) { return fail(res, error, 'Impossible de charger cette conversation.'); }
  });

  app.post('/api/merchant/messages/:conversationId/messages', requireMerchant, guard, async (req, res) => {
    try {
      const conversation = await getConversation(String(req.params.conversationId), req.merchant.id);
      if (!conversation) return res.status(404).json({ error: 'Conversation introuvable.' });
      if (conversation.status === 'closed') return res.status(409).json({ error: 'Cette conversation est clôturée.', code: 'CONVERSATION_CLOSED' });
      const body = clean(req.body?.body, 4000);
      if (body.length < 1) return res.status(400).json({ error: 'Écrivez un message.' });
      const message = await addMessage(conversation.id, { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username },
        body, normalizeAttachment(req.body?.attachment));
      if (conversation.memberId) await ops.notify({ merchantId: conversation.merchantId, storeId: conversation.storeId, memberId: conversation.memberId,
        type: 'internal_message', title: 'Nouveau message du marchand', message: body.slice(0, 120),
        data: { conversationId: conversation.id }, dedupeKey: `conv:${conversation.id}:${message.id}` });
      return res.status(201).json({ data: { message } });
    } catch (error) { return fail(res, error, 'Impossible d’envoyer ce message.'); }
  });

  app.post('/api/merchant/messages/:conversationId/close', requireMerchant, guard, async (req, res) => {
    try {
      const conversation = await closeConversation(String(req.params.conversationId), req.merchant.id, 'merchant', req.merchant.id);
      if (!conversation) return res.status(404).json({ error: 'Conversation introuvable.' });
      return res.json({ data: { conversation } });
    } catch (error) { return fail(res, error, 'Impossible de clôturer cette conversation.'); }
  });

  // ------------------------------------------------------------------ flux consolidé pour la page équipe
  app.get('/api/merchant/team/activity-feed', requireMerchant, async (req, res) => {
    try {
      const limit = Math.min(Number(req.query.limit) || 40, 120);
      const activity = await team.listActivity(req.merchant.id, { limit });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { activity } });
    } catch (error) { return fail(res, error, 'Impossible de charger l’activité de l’équipe.'); }
  });

  // ------------------------------------------------------------------ helpers partagés (utilisés aussi par manager/admin)
  async function primaryManager(merchantId) {
    if (!team.pg) return null;
    const { rows } = await team.base.pool.query(
      `SELECT id, display_name AS "displayName", username FROM managers
        WHERE (id = (SELECT manager_id FROM merchant_accounts WHERE id=$1) OR id IN (SELECT manager_id FROM merchant_manager_assignments WHERE merchant_id=$1))
          AND deleted_at IS NULL AND status='active' ORDER BY (id = (SELECT manager_id FROM merchant_accounts WHERE id=$1)) DESC LIMIT 1`, [merchantId]).catch(() => ({ rows: [] }));
    return rows[0] || null;
  }

  function normalizeAttachment(attachment) {
    if (!attachment || !attachment.data) return null;
    const data = String(attachment.data);
    const bytes = Math.ceil((data.length * 3) / 4);
    if (bytes > 3 * 1024 * 1024) { const error = new Error('La pièce jointe dépasse 3 Mo.'); error.status = 413; throw error; }
    const mime = clean(attachment.mime, 80) || 'application/octet-stream';
    if (!/^(image\/(png|jpe?g|webp|gif)|application\/pdf|text\/plain)$/.test(mime)) {
      const error = new Error('Format de pièce jointe non accepté (image, PDF ou texte).'); error.status = 415; throw error;
    }
    return { data, name: clean(attachment.name, 120) || 'piece-jointe', mime, bytes };
  }

  async function createConversation({ merchantId, storeId, kind, managerId, memberId, subject, category, author, body, attachment }) {
    const id = `tc_${require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const messageId = `tm_${require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await team.base.pool.query(
      `INSERT INTO team_conversations (id, merchant_id, store_id, kind, manager_id, member_id, subject, category, status, created_by_type, created_by_id, created_by_label)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [id, merchantId, storeId, kind, managerId, memberId, subject, category, 'sent', author.type, String(author.id), author.label]);
    await team.base.pool.query(
      `INSERT INTO team_messages (id, conversation_id, author_type, author_id, author_label, body, attachment_data, attachment_name, attachment_mime, attachment_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [messageId, id, author.type, String(author.id), author.label, body,
        attachment?.data || '', attachment?.name || '', attachment?.mime || '', attachment?.bytes || 0]);
    return getConversation(id, merchantId);
  }

  async function getConversation(id, merchantId) {
    const { rows } = await team.base.pool.query(
      `SELECT id, merchant_id AS "merchantId", store_id AS "storeId", kind, manager_id AS "managerId", member_id AS "memberId",
              subject, category, status, created_by_type AS "createdByType", created_by_label AS "createdByLabel",
              last_message_at AS "lastMessageAt", created_at AS "createdAt", closed_at AS "closedAt", closed_by_type AS "closedByType"
         FROM team_conversations WHERE id=$1 AND merchant_id=$2`, [id, merchantId]);
    return rows[0] || null;
  }

  async function listMessages(conversationId) {
    const { rows } = await team.base.pool.query(
      `SELECT id, author_type AS "authorType", author_label AS "authorLabel", body,
              attachment_name AS "attachmentName", attachment_mime AS "attachmentMime", attachment_bytes AS "attachmentBytes",
              (attachment_data <> '') AS "hasAttachment", created_at AS "createdAt"
         FROM team_messages WHERE conversation_id=$1 ORDER BY created_at`, [conversationId]);
    return rows;
  }

  async function addMessage(conversationId, author, body, attachment) {
    const id = `tm_${require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 20)}`;
    await team.base.pool.query(
      `INSERT INTO team_messages (id, conversation_id, author_type, author_id, author_label, body, attachment_data, attachment_name, attachment_mime, attachment_bytes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, conversationId, author.type, String(author.id), author.label, body,
        attachment?.data || '', attachment?.name || '', attachment?.mime || '', attachment?.bytes || 0]);
    await team.base.pool.query(
      `UPDATE team_conversations SET last_message_at=NOW(),
         status=CASE WHEN created_by_type=$2 THEN 'answered' ELSE 'received' END
       WHERE id=$1 AND status <> 'closed'`, [conversationId, author.type]);
    const { rows } = await team.base.pool.query(
      `SELECT id, author_type AS "authorType", author_label AS "authorLabel", body,
              attachment_name AS "attachmentName", attachment_mime AS "attachmentMime", attachment_bytes AS "attachmentBytes",
              (attachment_data <> '') AS "hasAttachment", created_at AS "createdAt"
         FROM team_messages WHERE id=$1`, [id]);
    return rows[0];
  }

  async function markRead(conversationId, readerType, readerId) {
    await team.base.pool.query(
      `INSERT INTO team_message_reads (conversation_id, reader_type, reader_id, last_read_at) VALUES ($1,$2,$3,NOW())
       ON CONFLICT (conversation_id, reader_type, reader_id) DO UPDATE SET last_read_at=NOW()`, [conversationId, readerType, String(readerId)]);
    await team.base.pool.query(
      `UPDATE team_conversations SET status=CASE WHEN status='sent' THEN 'read' WHEN status='received' THEN 'read' ELSE status END WHERE id=$1 AND status <> 'closed'`,
      [conversationId]);
  }

  async function closeConversation(conversationId, merchantId, byType, byId) {
    const { rows } = await team.base.pool.query(
      `UPDATE team_conversations SET status='closed', closed_at=NOW(), closed_by_type=$3, closed_by_id=$4
        WHERE id=$1 AND merchant_id=$2 RETURNING id`, [conversationId, merchantId, byType, String(byId)]);
    if (!rows[0]) return null;
    await team.base.pool.query(
      `INSERT INTO team_messages (id, conversation_id, author_type, author_label, body)
       VALUES ($1,$2,'system','Système','Conversation clôturée par le marchand.')`,
      [`tm_${require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 20)}`, conversationId]);
    return getConversation(conversationId, merchantId);
  }

  Object.assign(module.exports, { createConversation, getConversation, listMessages, addMessage, markRead, closeConversation, normalizeAttachment });
  // Mission 12 : la résolution de la boutique du marchand est réutilisée par les modules
  // « Gestion des tables » et « Mes comptes créés » (une seule définition, pas de copie).
  return { createConversation, getConversation, listMessages, addMessage, markRead, closeConversation, normalizeAttachment, primaryManager, resolveStore };
};

const SOURCE_LABELS = {
  customer_qr: 'Client (QR boutique)', customer_table_qr: 'Client (QR table)', customer_link: 'Client (lien)',
  merchant_manual: 'Marchand', manager_assisted: 'Gérant général', staff_assisted: 'Serveuse', admin: 'Administrateur général',
};
