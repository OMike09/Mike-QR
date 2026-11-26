'use strict';

// ============================================================================================
// Mission 11 (sous-prompt 3) — Vue d'ensemble allégée et CLIQUABLE.
//
// GET /api/overview : quatre chiffres seulement (nouvelles, en cours, terminées, tables
// occupées/libres) + les derniers scans + l'activité du personnel AUTORISÉE. Chaque carte porte
// la destination exacte à ouvrir : l'interface n'a plus à deviner où aller.
//
// GET /api/overview/orders?view=new|active|done : la liste correspondant à une carte.
//
// Périmètre : toujours celui de la session.
//   · marchand       → sa boutique (merchantId + storeId du serveur)
//   · gérant général → sa boutique, avec sa permission orders.view
//   · serveuse/serveur → ses commandes (créées ou affectées), jamais celles d'un collègue
// Aucun identifiant d'établissement n'est accepté depuis le navigateur.
// ============================================================================================

module.exports = function overviewRoutes({ app, team, commerce, staffSessions, merchantGuard, apiError }) {
  const clean = (value, max = 200) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const pool = () => (team?.pg ? team.base.pool : null);

  function hasCookie(req, name) { return new RegExp(`(^|;)\\s*${name}=`).test(String(req.headers.cookie || '')); }

  // Un seul rôle à la fois : le même principe que partout dans l'application.
  async function resolveActor(req) {
    const cookies = ['qria_admin', 'qria_manager', 'qria_merchant', 'qria_staff'].filter((name) => hasCookie(req, name));
    if (cookies.length !== 1) return null;
    if (cookies[0] === 'qria_staff') {
      const member = await staffSessions.resolveSession(req);
      if (!member) return null;
      return { role: member.role === 'general_manager' ? 'general_manager' : 'waitress', member };
    }
    if (cookies[0] === 'qria_merchant') {
      const allowed = await new Promise((resolve) => {
        let settled = false;
        const res = { status() { return this; }, json() { if (!settled) { settled = true; resolve(false); } return this; }, setHeader() { return this; } };
        try { merchantGuard(req, res, () => { if (!settled) { settled = true; resolve(true); } }); } catch (_) { resolve(false); }
        setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 4000);
      });
      return allowed && req.merchant ? { role: 'merchant', merchant: req.merchant } : null;
    }
    // PDG et gestionnaire n'ont pas de « vue d'ensemble » d'établissement : leur écran est le
    // contrôle global (déjà en place), on ne leur en invente pas un autre ici.
    return null;
  }

  async function scopeOf(req) {
    const actor = await resolveActor(req);
    if (!actor) return null;
    const p = pool();
    if (!p) return null;
    if (actor.role === 'merchant') {
      const store = await p.query('SELECT id, name FROM merchant_stores WHERE merchant_id=$1 LIMIT 1', [actor.merchant.id]).then((r) => r.rows[0]).catch(() => null);
      return { role: actor.role, merchantId: actor.merchant.id, storeId: store?.id || '', storeName: store?.name || '',
        memberId: '', label: actor.merchant.displayName || actor.merchant.username };
    }
    const member = actor.member;
    return { role: actor.role, merchantId: member.merchantId, storeId: member.storeId, storeName: '',
      memberId: actor.role === 'waitress' ? member.id : '', label: member.designation || member.fullName,
      permissions: member.permissions || [] };
  }

  function orderScope(scope) {
    // `memberId` renseigné = serveuse : uniquement ses commandes.
    return scope.memberId ? ' AND (o.created_by_member_id=$3 OR o.assigned_member_id=$3)' : '';
  }

  const VIEWS = {
    new: { statuses: ['pending'], label: 'Nouvelles commandes' },
    active: { statuses: ['confirmed', 'preparing', 'ready', 'out_for_delivery'], label: 'Commandes en cours' },
    done: { statuses: ['completed'], label: 'Commandes terminées' },
  };

  app.get('/api/overview', async (req, res) => {
    try {
      const scope = await scopeOf(req);
      if (!scope) return res.status(401).json({ error: 'Session requise. Reconnectez-vous.' });
      const p = pool();
      const params = [scope.merchantId, scope.storeId];
      if (scope.memberId) params.push(scope.memberId);
      const mine = orderScope(scope);

      const [counts, tables, scans, staff] = await Promise.all([
        p.query(`SELECT COUNT(*) FILTER (WHERE o.status='pending')::int AS "new",
                        COUNT(*) FILTER (WHERE o.status IN ('confirmed','preparing','ready','out_for_delivery'))::int AS "active",
                        COUNT(*) FILTER (WHERE o.status='completed' AND o.created_at >= NOW()::date)::int AS "doneToday",
                        COUNT(*) FILTER (WHERE o.status='completed')::int AS "done",
                        COUNT(*) FILTER (WHERE o.status IN ('cancelled','rejected') AND o.created_at >= NOW()::date)::int AS "cancelledToday"
                   FROM merchant_orders o
                  WHERE o.merchant_id=$1 AND ($2='' OR o.store_id=$2)${mine}`, params).then((r) => r.rows[0]).catch(() => null),
        p.query(`SELECT COUNT(*)::int AS total,
                        COUNT(*) FILTER (WHERE EXISTS (
                          SELECT 1 FROM merchant_orders o WHERE o.service_point_id=sp.id
                           AND o.status NOT IN ('completed','cancelled','rejected')))::int AS occupied
                   FROM merchant_service_points sp
                  WHERE sp.store_id=$1 AND sp.status='active'`, [scope.storeId || '__none__']).then((r) => r.rows[0]).catch(() => null),
        p.query(`SELECT COUNT(*)::int AS n FROM merchant_scan_events e
                  WHERE e.merchant_id=$1 AND e.scanned_at >= NOW() - INTERVAL '24 hours'
                    ${scope.memberId ? 'AND e.member_id=$3' : ''}`, params).then((r) => r.rows[0]).catch(() => null),
        // Activité du personnel : seulement si le rôle y a droit, et seulement la sienne pour
        // une serveuse. Aucune donnée d'un collègue n'est renvoyée à une serveuse.
        (scope.role === 'waitress' || scope.permissions?.includes('activity.view'))
          ? p.query(`SELECT m.designation, m.action_label, m.at FROM (
                       SELECT tm.designation, a.summary AS action_label, a.created_at AS at
                         FROM team_activity_events a LEFT JOIN team_members tm ON tm.id=a.member_id
                        WHERE a.merchant_id=$1 AND a.store_id=$2 ${scope.memberId ? 'AND a.member_id=$3' : ''}
                        ORDER BY a.created_at DESC LIMIT 4) m`, params).then((r) => r.rows).catch(() => [])
          : Promise.resolve(null),
      ]);

      res.setHeader('Cache-Control', 'no-store');
      const cards = [
        { id: 'new', label: 'Nouvelles commandes', value: Number(counts?.new) || 0, target: 'orders', orderView: 'new' },
        { id: 'active', label: 'En cours', value: Number(counts?.active) || 0, target: 'orders', orderView: 'active' },
        { id: 'done', label: 'Terminées aujourd’hui', value: Number(counts?.doneToday) || 0, target: 'orders', orderView: 'done' },
      ];
      if (tables && Number(tables.total) > 0) {
        cards.push({ id: 'tables', label: 'Tables occupées', value: Number(tables.occupied) || 0,
          hint: `${Math.max(0, Number(tables.total) - Number(tables.occupied))} libre(s) sur ${Number(tables.total)}`,
          target: 'tables' });
      }
      return res.json({ data: {
        scope: { role: scope.role, label: scope.label, storeName: scope.storeName },
        cards,
        scans: { last24h: Number(scans?.n) || 0, target: 'history' },
        staff: staff ? staff.map((row) => ({ person: row.designation || 'Équipe', action: clean(row.action_label, 160), at: row.at })) : null,
      } });
    } catch (error) {
      console.error('[overview]', error.message);
      return apiError(res, error, 'Impossible de charger la vue d’ensemble.');
    }
  });

  app.get('/api/overview/orders', async (req, res) => {
    try {
      const scope = await scopeOf(req);
      if (!scope) return res.status(401).json({ error: 'Session requise. Reconnectez-vous.' });
      const view = VIEWS[String(req.query.view)] ? String(req.query.view) : 'active';
      const p = pool();
      const params = [scope.merchantId, scope.storeId];
      if (scope.memberId) params.push(scope.memberId);
      params.push(VIEWS[view].statuses);
      const { rows } = await p.query(
        `SELECT o.id, o.public_reference AS reference, o.status, o.total_amount_xof AS "totalAmountXof",
                o.customer_name AS "customerName", o.service_point_name AS "servicePointName",
                o.created_by_designation AS "createdByDesignation", o.assigned_designation AS "assignedDesignation",
                o.created_at AS "createdAt"
           FROM merchant_orders o
          WHERE o.merchant_id=$1 AND ($2='' OR o.store_id=$2)${orderScope(scope)}
            AND o.status = ANY($${params.length})
          ORDER BY o.created_at DESC LIMIT 200`, params);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { view, label: VIEWS[view].label, orders: rows } });
    } catch (error) {
      return apiError(res, error, 'Impossible de charger ces commandes.');
    }
  });

  // Le marchand peut garder l'ancien endpoint (statistiques complètes) ; celui-ci ne fait que
  // fournir la version allégée. Aucune route existante n'est modifiée ni supprimée.
  return { app };
};
