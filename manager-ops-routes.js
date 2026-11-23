'use strict';

// ============================================================================================
// Mission 6 — Côté GÉRANT GÉNÉRAL et ADMINISTRATEUR GÉNÉRAL.
//
//   Gestionnaire (/api/manager/ops/*) :
//     GET  dashboard        tableau de bord de la boutique (commandes, scans, points, tables, tâches)
//     GET  team             serveuses et gérants de sa boutique, avec leurs chiffres
//     GET  tables           tables occupées / libres et leur affectation
//     GET  leaderboard      classement de l'équipe
//     GET  support          messages reçus de l'équipe
//     GET  support/:id      fil complet
//     POST support/:id/reply      répondre
//     POST support/:id/status     marquer reçu / lu / répondu / clôturé
//
//   Administrateur général (/api/admin/ops/*) : supervision en lecture + interventions
//   administratives. Il ne remplace jamais le marchand : aucune création de membre ici.
//
// Le gestionnaire est toujours ramené au marchand auquel il est rattaché (manager_id ou
// merchant_manager_assignments). Un managerId fourni par le client n'est jamais utilisé.
// ============================================================================================

const { overviewStats } = require('./team-analytics');

module.exports = function managerOpsRoutes({ app, store, commerce, team, ops, requireManager, requireAdmin, checkSameOrigin, apiError, writeAudit }) {
  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const fail = (res, error, fallback) => {
    if (error && error.status && error.status < 500) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error && error.message && !error.code) return res.status(400).json({ error: error.message });
    if (typeof apiError === 'function') return apiError(res, error, fallback);
    return res.status(500).json({ error: fallback });
  };
  // checkSameOrigin est un middleware Express : il faut lui passer `next`.
  const guard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || typeof checkSameOrigin !== 'function') return next();
    return checkSameOrigin(req, res, next);
  };

  async function merchantOf(managerId) {
    if (!team.pg) return null;
    const { rows } = await team.base.pool.query(
      `SELECT m.id, m.display_name AS "displayName", m.username, s.id AS "storeId", s.name AS "storeName"
         FROM merchant_accounts m LEFT JOIN merchant_stores s ON s.merchant_id=m.id
        WHERE m.deleted_at IS NULL AND (m.manager_id=$1 OR EXISTS (SELECT 1 FROM merchant_manager_assignments a WHERE a.merchant_id=m.id AND a.manager_id=$1))
        ORDER BY (m.manager_id=$1) DESC, m.created_at LIMIT 1`, [managerId]).catch(() => ({ rows: [] }));
    return rows[0] || null;
  }
  async function requireShop(req, res) {
    const merchant = await merchantOf(req.manager.id);
    if (!merchant) { res.status(404).json({ error: 'Aucune boutique n’est rattachée à votre compte pour le moment.', code: 'NO_MERCHANT' }); return null; }
    if (!merchant.storeId) { res.status(409).json({ error: 'Le marchand n’a pas encore publié sa boutique.', code: 'STORE_REQUIRED' }); return null; }
    return merchant;
  }

  // ------------------------------------------------------------------ tableau de bord gérant
  app.get('/api/manager/ops/dashboard', requireManager, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Ce tableau de bord nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const merchant = await requireShop(req, res); if (!merchant) return;
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'all';
      const from = period === 'all' ? null : require('./team-analytics').periodStart(period);
      const [stats, board, settings, member] = await Promise.all([
        overviewStats(team.base.pool, { merchantId: merchant.id, storeId: merchant.storeId, from }),
        ops.leaderboard(merchant.id, { period: period === 'all' ? 'month' : period }),
        ops.getPointSettings(merchant.id),
        store.getManager(req.manager.id),
      ]);
      // Le gérant général du marchand dispose des droits par défaut de son rôle. Un gestionnaire
      // de plateforme (comptes historiques) n'a aucun droit opérationnel sur la boutique.
      const permissions = Array.isArray(req.manager.permissions) ? req.manager.permissions : [];
      const canStats = !permissions.length || permissions.includes('stats.view');
      const canPoints = !permissions.length || permissions.includes('points.view');
      const canTasks = !permissions.length || permissions.includes('tasks.view_all');
      const [scansByWaitress, ordersByWaitress, myTasks, managerTeam] = await Promise.all([
        team.base.pool.query(
          `SELECT e.member_id AS "memberId", COALESCE(m.designation,m.full_name,'—') AS designation, COUNT(*)::int AS scans
             FROM merchant_scan_events e LEFT JOIN team_members m ON m.id=e.member_id
            WHERE e.merchant_id=$1 AND e.store_id=$2 AND e.category='staff'${from ? ' AND e.scanned_at >= $3' : ''}
            GROUP BY 1,2 ORDER BY scans DESC`, from ? [merchant.id, merchant.storeId, from] : [merchant.id, merchant.storeId]).then((r) => r.rows).catch(() => []),
        team.base.pool.query(
          `SELECT o.created_by_member_id AS "memberId", COALESCE(m.designation,m.full_name,'Client / direct') AS designation, o.status, COUNT(*)::int AS n
             FROM merchant_orders o LEFT JOIN team_members m ON m.id=o.created_by_member_id
            WHERE o.merchant_id=$1 AND o.store_id=$2${from ? ' AND o.created_at >= $3' : ''}
            GROUP BY 1,2,3`, from ? [merchant.id, merchant.storeId, from] : [merchant.id, merchant.storeId]).then((r) => r.rows).catch(() => []),
        team.listTasks(merchant.id, { memberId: req.manager.id }).catch(() => []),
        team.listMembers(merchant.id, {}).catch(() => []),
      ]);
      const managerOrders = ordersByWaitress.filter((row) => row.memberId === req.manager.id).reduce((sum, row) => sum + Number(row.n), 0);
      const clientOrders = ordersByWaitress.filter((row) => !row.memberId).reduce((sum, row) => sum + Number(row.n), 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        merchant: { id: merchant.id, name: merchant.displayName, storeId: merchant.storeId, storeName: merchant.storeName },
        manager: { id: req.manager.id, displayName: member?.designation || req.manager.displayName, permissions },
        period,
        permissions: { stats: canStats, points: canPoints, tasks: canTasks },
        store: stats.orders, revenue: canStats ? stats.revenue : null,
        scans: stats.scans,
        team: { ...stats.team, members: managerTeam.map((m) => ({ id: m.id, role: m.role, designation: m.designation || m.fullName, status: m.status })) },
        tasks: canTasks ? stats.tasks : { open: myTasks.filter((t) => ['todo', 'in_progress'].includes(t.status)).length, mine: true },
        scansByWaitress: canStats ? scansByWaitress : [],
        ordersByWaitress: canStats ? ordersByWaitress : [],
        ordersByManager: managerOrders,
        ordersByCustomers: clientOrders,
        leaderboard: canPoints ? board.rows : [],
        pointSettings: canPoints ? settings : null,
        statisticsAuthorized: canStats,
      } });
    } catch (error) { return fail(res, error, 'Impossible de charger le tableau de bord.'); }
  });

  // ------------------------------------------------------------------ équipe et tables vues du gérant
  app.get('/api/manager/ops/team', requireManager, async (req, res) => {
    try {
      const merchant = await requireShop(req, res); if (!merchant) return;
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'week';
      const members = (await team.listMembers(merchant.id, {})).filter((m) => m.status !== 'archived');
      const rows = [];
      for (const member of members) {
        const stats = await ops.memberStats(merchant.id, member.id, { period });
        rows.push({ id: member.id, role: member.role, designation: member.designation || member.fullName, status: member.status,
          lastLoginAt: member.lastLoginAt, points: stats.points, scans: stats.scans, orders: stats.orders,
          completedOrders: stats.completedOrders, tasksDone: stats.tasksDone, tasksLate: stats.tasksLate });
      }
      return res.json({ data: { period, members: rows } });
    } catch (error) { return fail(res, error, 'Impossible de charger l’équipe.'); }
  });

  app.get('/api/manager/ops/tables', requireManager, async (req, res) => {
    try {
      const merchant = await requireShop(req, res); if (!merchant) return;
      const points = await ops.listServicePointAssignments(merchant.storeId);
      const usage = await team.base.pool.query(
        `SELECT service_point_id AS "servicePointId", COUNT(*)::int AS "activeOrderCount"
           FROM merchant_orders WHERE store_id=$1 AND service_point_id IS NOT NULL AND status NOT IN ('completed','cancelled','rejected')
          GROUP BY 1`, [merchant.storeId]).then((r) => r.rows).catch(() => []);
      const list = await team.base.pool.query(
        `SELECT id, name, zone, point_type AS type, status, public_code AS "publicCode", qr_scan_count AS "scanCount"
           FROM merchant_service_points WHERE store_id=$1 ORDER BY zone, name`, [merchant.storeId]).then((r) => r.rows).catch(() => []);
      const assigned = new Map(points.map((a) => [a.servicePointId, a]));
      const usageMap = new Map(usage.map((u) => [u.servicePointId, Number(u.activeOrderCount) || 0]));
      return res.json({ data: { tables: list.map((point) => ({
        ...point, occupied: (usageMap.get(point.id) || 0) > 0, activeOrders: usageMap.get(point.id) || 0,
        assignedTo: assigned.get(point.id) ? { memberId: assigned.get(point.id).memberId, designation: assigned.get(point.id).designation || '' } : null,
      })) } });
    } catch (error) { return fail(res, error, 'Impossible de charger les tables.'); }
  });

  app.get('/api/manager/ops/leaderboard', requireManager, async (req, res) => {
    try {
      const merchant = await requireShop(req, res); if (!merchant) return;
      const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
      return res.json({ data: await ops.leaderboard(merchant.id, { period }) });
    } catch (error) { return fail(res, error, 'Impossible de charger le classement.'); }
  });

  // ------------------------------------------------------------------ support : messages de l'équipe
  app.get('/api/manager/ops/support', requireManager, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'La messagerie nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const merchant = await merchantOf(req.manager.id);
      if (!merchant) return res.json({ data: { conversations: [], unread: 0 } });
      const { rows } = await team.base.pool.query(
        `SELECT c.id, c.subject, c.category, c.status, c.created_by_type AS "createdByType", c.created_by_label AS "createdByLabel",
                c.created_at AS "createdAt", c.last_message_at AS "lastMessageAt",
                (SELECT COUNT(*)::int FROM team_messages tm WHERE tm.conversation_id=c.id AND tm.author_type <> 'manager') AS "messageCount",
                (SELECT body FROM team_messages tm WHERE tm.conversation_id=c.id ORDER BY tm.created_at DESC LIMIT 1) AS "lastBody"
           FROM team_conversations c WHERE c.merchant_id=$1 AND c.kind='support'
            AND (c.staff_manager_id=$2 OR (c.staff_manager_id IS NULL AND c.created_by_type='general_manager'))
          ORDER BY (c.status NOT IN ('closed','answered')) DESC, c.last_message_at DESC LIMIT 100`, [merchant.id, String(req.manager.id)]);
      const unread = rows.filter((row) => ['sent', 'received'].includes(row.status) && row.createdByType !== 'manager').length;
      return res.json({ data: { conversations: rows, unread, merchant: { id: merchant.id, name: merchant.displayName } } });
    } catch (error) { return fail(res, error, 'Impossible de charger les messages.'); }
  });

  app.get('/api/manager/ops/support/:conversationId', requireManager, async (req, res) => {
    try {
      const merchant = await merchantOf(req.manager.id);
      if (!merchant) return res.status(404).json({ error: 'Aucune boutique rattachée.' });
      const { rows } = await team.base.pool.query(
        `SELECT id, subject, category, status, created_by_type AS "createdByType", created_by_label AS "createdByLabel",
                created_at AS "createdAt", closed_at AS "closedAt"
           FROM team_conversations WHERE id=$1 AND merchant_id=$2 AND kind='support'
             AND (staff_manager_id=$3 OR staff_manager_id IS NULL)`, [String(req.params.conversationId), merchant.id, String(req.manager.id)]);
      if (!rows[0]) return res.status(404).json({ error: 'Conversation introuvable.' });
      const messages = await team.base.pool.query(
        `SELECT id, author_type AS "authorType", author_label AS "authorLabel", body,
                attachment_name AS "attachmentName", attachment_mime AS "attachmentMime", attachment_bytes AS "attachmentBytes",
                (attachment_data <> '') AS "hasAttachment", created_at AS "createdAt"
           FROM team_messages WHERE conversation_id=$1 ORDER BY created_at`, [rows[0].id]).then((r) => r.rows);
      await team.base.pool.query(
        `INSERT INTO team_message_reads (conversation_id, reader_type, reader_id, last_read_at) VALUES ($1,'manager',$2,NOW())
         ON CONFLICT (conversation_id, reader_type, reader_id) DO UPDATE SET last_read_at=NOW()`, [rows[0].id, String(req.manager.id)]);
      await team.base.pool.query(`UPDATE team_conversations SET status='read' WHERE id=$1 AND status IN ('sent','received')`, [rows[0].id]);
      return res.json({ data: { conversation: rows[0], messages } });
    } catch (error) { return fail(res, error, 'Impossible de charger cette conversation.'); }
  });

  app.post('/api/manager/ops/support/:conversationId/reply', requireManager, guard, async (req, res) => {
    try {
      const merchant = await merchantOf(req.manager.id);
      if (!merchant) return res.status(404).json({ error: 'Aucune boutique rattachée.' });
      const body = clean(req.body?.body, 4000);
      if (body.length < 1) return res.status(400).json({ error: 'Écrivez votre réponse.' });
      const { rows } = await team.base.pool.query(
        `SELECT id, status FROM team_conversations WHERE id=$1 AND merchant_id=$2 AND kind='support'
           AND (staff_manager_id=$3 OR staff_manager_id IS NULL)`,
        [String(req.params.conversationId), merchant.id, String(req.manager.id)]);
      if (!rows[0]) return res.status(404).json({ error: 'Conversation introuvable.' });
      if (rows[0].status === 'closed') return res.status(409).json({ error: 'Cette conversation est clôturée.', code: 'CONVERSATION_CLOSED' });
      const id = `tm_${require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 20)}`;
      await team.base.pool.query(
        `INSERT INTO team_messages (id, conversation_id, author_type, author_id, author_label, body)
         VALUES ($1,$2,'manager',$3,$4,$5)`,
        [id, rows[0].id, String(req.manager.id), req.manager.displayName || req.manager.username, body]);
      await team.base.pool.query(`UPDATE team_conversations SET status='answered', last_message_at=NOW() WHERE id=$1`, [rows[0].id]);
      // Notification au membre auteur du message (jamais à toute l'équipe).
      const { rows: author } = await team.base.pool.query(
        `SELECT created_by_id AS "createdById", created_by_type AS "createdByType", member_id AS "memberId" FROM team_conversations WHERE id=$1`, [rows[0].id]);
      if (author[0]?.createdByType !== 'merchant' && author[0]?.createdById) {
        await ops.notify({ merchantId: merchant.id, storeId: merchant.storeId, memberId: author[0].createdById,
          type: 'support_reply', title: 'Réponse de votre gestionnaire', message: body.slice(0, 140),
          data: { conversationId: rows[0].id }, dedupeKey: `support:${rows[0].id}:${id}` }).catch(() => {});
      }
      await team.recordActivity(merchant.id, merchant.storeId, author[0]?.createdById || null, 'support_reply',
        'Réponse du gestionnaire à un message de l’équipe.', 'success', { conversationId: rows[0].id }).catch(() => {});
      return res.status(201).json({ data: { id, conversationId: rows[0].id } });
    } catch (error) { return fail(res, error, 'Impossible d’envoyer cette réponse.'); }
  });

  app.post('/api/manager/ops/support/:conversationId/status', requireManager, guard, async (req, res) => {
    try {
      const merchant = await merchantOf(req.manager.id);
      if (!merchant) return res.status(404).json({ error: 'Aucune boutique rattachée.' });
      const status = ['received', 'read', 'answered', 'closed'].includes(req.body?.status) ? req.body.status : '';
      if (!status) return res.status(400).json({ error: 'Statut de conversation invalide.' });
      const { rows } = await team.base.pool.query(
        `UPDATE team_conversations SET status=$3,
           closed_at=CASE WHEN $3='closed' THEN NOW() ELSE closed_at END,
           closed_by_type=CASE WHEN $3='closed' THEN 'manager' ELSE closed_by_type END,
           closed_by_id=CASE WHEN $3='closed' THEN $4 ELSE closed_by_id END
         WHERE id=$1 AND merchant_id=$2 AND kind='support' AND (staff_manager_id=$5 OR staff_manager_id IS NULL)
         RETURNING id, status`,
        [String(req.params.conversationId), merchant.id, status, String(req.manager.id), String(req.manager.id)]);
      if (!rows[0]) return res.status(404).json({ error: 'Conversation introuvable.' });
      return res.json({ data: rows[0] });
    } catch (error) { return fail(res, error, 'Impossible de changer le statut.'); }
  });

  // ------------------------------------------------------------------ ADMINISTRATEUR GÉNÉRAL
  // Lecture globale : aucune création ni modification de membre. Le marchand reste responsable.
  app.get('/api/admin/ops/overview', requireAdmin, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'week';
      const from = period === 'all' ? null : require('./team-analytics').periodStart(period);
      const [global, merchants, staff] = await Promise.all([
        team.base.pool.query(
          `SELECT (SELECT COUNT(*)::int FROM merchant_accounts WHERE deleted_at IS NULL) AS merchants,
                  (SELECT COUNT(*)::int FROM merchant_accounts WHERE deleted_at IS NULL AND status='active') AS "merchantsActive",
                  (SELECT COUNT(*)::int FROM merchant_accounts WHERE deleted_at IS NULL AND status<>'active') AS "merchantsBlocked",
                  (SELECT COUNT(*)::int FROM managers WHERE deleted_at IS NULL) AS managers,
                  (SELECT COUNT(*)::int FROM team_members WHERE status='active') AS "membersActive",
                  (SELECT COUNT(*)::int FROM team_members WHERE status='blocked') AS "membersBlocked",
                  (SELECT COUNT(*)::int FROM merchant_orders${from ? ' WHERE created_at >= $1' : ''}) AS orders,
                  (SELECT COALESCE(SUM(total_amount_xof),0)::bigint FROM merchant_orders WHERE status <> 'cancelled'${from ? ' AND created_at >= $1' : ''}) AS revenue,
                  (SELECT COUNT(*)::int FROM merchant_scan_events${from ? ' WHERE scanned_at >= $1' : ''}) AS scans,
                  (SELECT COUNT(*)::int FROM team_conversations WHERE kind='support' AND status <> 'closed') AS "openMessages"`,
          from ? [from] : []).then((r) => r.rows[0]).catch(() => ({})),
        team.base.pool.query(
          `SELECT m.id, m.display_name AS "displayName", m.username, m.status, m.created_at AS "createdAt",
                  (SELECT s.name FROM merchant_stores s WHERE s.merchant_id=m.id ORDER BY s.created_at LIMIT 1) AS "storeName",
                  (SELECT COUNT(*)::int FROM team_members tm WHERE tm.merchant_id=m.id) AS "teamMembers",
                  (SELECT COUNT(*)::int FROM team_members tm WHERE tm.merchant_id=m.id AND tm.status='active') AS "teamActive",
                  (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.merchant_id=m.id) AS orders,
                  (SELECT COUNT(*)::int FROM merchant_scan_events e WHERE e.merchant_id=m.id) AS scans
             FROM merchant_accounts m WHERE m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 100`).then((r) => r.rows).catch(() => []),
        team.base.pool.query(
          `SELECT tm.id, tm.merchant_id AS "merchantId", tm.role, tm.designation, tm.full_name AS "fullName", tm.status,
                  tm.points, tm.last_login_at AS "lastLoginAt", m.display_name AS "merchantName",
                  EXISTS (SELECT 1 FROM merchant_orders o WHERE o.created_by_member_id=tm.id) AS "hasData"
             FROM team_members tm LEFT JOIN merchant_accounts m ON m.id=tm.merchant_id
            ORDER BY tm.created_at DESC LIMIT 200`).then((r) => r.rows).catch(() => []),
      ]);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { period, global, merchants, staff } });
    } catch (error) { return fail(res, error, 'Impossible de charger la supervision.'); }
  });

  // Historique consolidé : commandes et scans, toutes boutiques, avec l'auteur identifié.
  app.get('/api/admin/ops/history', requireAdmin, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const limit = Math.min(Number(req.query.limit) || 80, 200);
      const [orders, scans] = await Promise.all([
        team.base.pool.query(
          `SELECT o.id, o.public_reference AS reference, o.status, o.source, o.total_amount_xof AS "totalAmountXof",
                  o.created_at AS "createdAt", o.created_by_type AS "createdByType", o.created_by_designation AS "createdByDesignation",
                  o.assigned_designation AS "assignedDesignation", m.display_name AS "merchantName", s.name AS "storeName"
             FROM merchant_orders o LEFT JOIN merchant_accounts m ON m.id=o.merchant_id
             LEFT JOIN merchant_stores s ON s.id=o.store_id ORDER BY o.created_at DESC LIMIT $1`, [limit]).then((r) => r.rows).catch(() => []),
        team.base.pool.query(
          `SELECT e.id, e.category, e.qr_kind AS "qrKind", e.scanned_at AS "scannedAt", m.display_name AS "merchantName",
                  tm.designation AS "memberDesignation", sp.name AS "servicePointName"
             FROM merchant_scan_events e LEFT JOIN merchant_accounts m ON m.id=e.merchant_id
             LEFT JOIN team_members tm ON tm.id=e.member_id LEFT JOIN merchant_service_points sp ON sp.id=e.service_point_id
            ORDER BY e.scanned_at DESC LIMIT $1`, [limit]).then((r) => r.rows).catch(() => []),
      ]);
      return res.json({ data: { orders, scans } });
    } catch (error) { return fail(res, error, 'Impossible de charger l’historique global.'); }
  });

  // Messages de support : supervision en lecture seule (l'Administrateur général n'écrit pas à la
  // place du gestionnaire, il contrôle).
  app.get('/api/admin/ops/support', requireAdmin, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'Cette vue nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const { rows } = await team.base.pool.query(
        `SELECT c.id, c.subject, c.status, c.created_at AS "createdAt", c.last_message_at AS "lastMessageAt",
                c.created_by_label AS "createdByLabel", m.display_name AS "merchantName",
                (SELECT COUNT(*)::int FROM team_messages tm WHERE tm.conversation_id=c.id) AS "messageCount"
           FROM team_conversations c LEFT JOIN merchant_accounts m ON m.id=c.merchant_id
          WHERE c.kind='support' ORDER BY c.last_message_at DESC LIMIT 100`).then((r) => r.rows).catch(() => []);
      return res.json({ data: { conversations: rows } });
    } catch (error) { return fail(res, error, 'Impossible de charger les messages.'); }
  });

  return {};
};
