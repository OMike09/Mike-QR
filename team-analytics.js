'use strict';

// ============================================================================================
// Helpers de périmètre (partagés par les routes marchand / gérant général / administrateur).
// ============================================================================================

function periodStart(period) {
  const now = new Date();
  if (period === 'today') { const d = new Date(now); d.setHours(0, 0, 0, 0); return d; }
  if (period === 'week') { const d = new Date(now); d.setDate(d.getDate() - 6); d.setHours(0, 0, 0, 0); return d; }
  if (period === 'month') { const d = new Date(now); d.setDate(d.getDate() - 29); d.setHours(0, 0, 0, 0); return d; }
  return null;
}

const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };

// Statistiques d'une boutique ou d'un marchand entier. `point` = '' pour tout le marchand.
// Tout est lu dans les tables d'opérations : aucune valeur n'est simulée.
async function overviewStats(pool, { merchantId, storeId = '', from = null }) {
  const params = [merchantId, storeId || ''];
  const storeClause = "($2='' OR o.store_id=$2)";
  const dateClause = (alias) => (from ? ` AND ${alias}.created_at >= $3` : '');
  const q = async (sql, extra = []) => (await pool.query(sql, [...params, ...extra])).rows;

  const [ordersByStatus, revenue, todayCounts, scans, members, tasks, topProducts, activity, pointsToday] = await Promise.all([
    q(`SELECT o.status, COUNT(*)::int AS n FROM merchant_orders o WHERE o.merchant_id=$1 AND ${storeClause}${dateClause('o')} GROUP BY o.status`,
      from ? [from] : []),
    q(`SELECT COALESCE(SUM(o.total_amount_xof),0)::bigint AS revenue, COUNT(*)::int AS n
         FROM merchant_orders o WHERE o.merchant_id=$1 AND ${storeClause} AND o.status <> 'cancelled'${dateClause('o')}`,
      from ? [from] : []),
    q(`SELECT COUNT(*)::int AS n, COALESCE(SUM(total_amount_xof),0)::bigint AS revenue FROM merchant_orders o
        WHERE o.merchant_id=$1 AND ${storeClause} AND o.created_at >= ${from ? '$3' : 'NOW()::date'} AND o.status <> 'cancelled'`,
      from ? [from] : []),
    q(`SELECT COUNT(*) FILTER (WHERE e.category='customer')::int AS customer,
              COUNT(*) FILTER (WHERE e.category='staff')::int AS staff,
              COUNT(*)::int AS total
         FROM merchant_scan_events e WHERE e.merchant_id=$1 AND ($2='' OR e.store_id=$2)${from ? ' AND e.scanned_at >= $3' : ''}`,
      from ? [from] : []),
    q(`SELECT m.id, m.role, m.designation, m.full_name AS "fullName", m.status, m.points, m.last_login_at AS "lastLoginAt"
         FROM team_members m WHERE m.merchant_id=$1 AND ($2='' OR m.store_id=$2) ORDER BY m.role, m.designation`),
    q(`SELECT COUNT(*) FILTER (WHERE t.status IN ('todo','in_progress'))::int AS open,
              COUNT(*) FILTER (WHERE t.status='done')::int AS done,
              COUNT(*) FILTER (WHERE t.status IN ('todo','in_progress') AND t.due_at IS NOT NULL AND t.due_at < NOW())::int AS late
         FROM team_tasks t WHERE t.merchant_id=$1 AND ($2='' OR t.store_id=$2)`),
    q(`SELECT i.product_name AS name, SUM(i.quantity)::int AS quantity, (SUM(i.quantity * i.unit_price_xof))::bigint AS revenue
         FROM merchant_order_items i JOIN merchant_orders o ON o.id=i.order_id
        WHERE o.merchant_id=$1 AND ${storeClause} AND o.status <> 'cancelled'${dateClause('o')}
        GROUP BY i.product_name ORDER BY quantity DESC LIMIT 8`, from ? [from] : []),
    q(`SELECT m.id, m.role, m.designation, m.full_name AS "fullName",
              COUNT(DISTINCT o.id)::int AS orders, COUNT(DISTINCT e.id)::int AS scans,
              COALESCE(SUM(p.points),0)::int AS points
         FROM team_members m
         LEFT JOIN merchant_orders o ON o.created_by_member_id=m.id AND o.merchant_id=$1 AND o.status <> 'cancelled'${dateClause('o')}
         LEFT JOIN merchant_scan_events e ON e.member_id=m.id AND e.merchant_id=$1${from ? ' AND e.scanned_at >= $3' : ''}
         LEFT JOIN staff_point_events p ON p.member_id=m.id AND p.merchant_id=$1${from ? ' AND p.created_at >= $3' : ''}
        WHERE m.merchant_id=$1 AND ($2='' OR m.store_id=$2)
        GROUP BY m.id ORDER BY orders DESC, scans DESC`, from ? [from] : []),
    (from
      ? pool.query('SELECT COALESCE(SUM(points),0)::int AS n FROM staff_point_events WHERE merchant_id=$1 AND created_at >= $2', [merchantId, from])
      : pool.query('SELECT COALESCE(SUM(points),0)::int AS n FROM staff_point_events WHERE merchant_id=$1', [merchantId])
    ).then((r) => r.rows).catch(() => [{ n: 0 }]),
  ]);

  const status = Object.fromEntries(ordersByStatus.map((row) => [row.status, Number(row.n)]));
  const statusTotal = Object.values(status).reduce((sum, n) => sum + n, 0);
  return {
    orders: {
      total: statusTotal, today: Number(todayCounts[0]?.n) || 0,
      pending: status.pending || 0, confirmed: status.confirmed || 0, preparing: status.preparing || 0,
      ready: status.ready || 0, completed: status.completed || 0, cancelled: status.cancelled || 0,
      byStatus: status,
    },
    revenue: { total: Number(revenue[0]?.revenue) || 0, orderCount: Number(revenue[0]?.n) || 0, today: Number(todayCounts[0]?.revenue) || 0 },
    scans: {
      customer: Number(scans[0]?.customer) || 0, staff: Number(scans[0]?.staff) || 0,
      total: Number(scans[0]?.total) || 0,
    },
    team: {
      members: members.length,
      managersActive: members.filter((m) => m.role === 'general_manager' && m.status === 'active').length,
      managersTotal: members.filter((m) => m.role === 'general_manager').length,
      waitressesActive: members.filter((m) => m.role === 'waitress' && m.status === 'active').length,
      waitressesTotal: members.filter((m) => m.role === 'waitress').length,
      blocked: members.filter((m) => m.status === 'blocked').length,
    },
    tasks: { open: Number(tasks[0]?.open) || 0, done: Number(tasks[0]?.done) || 0, late: Number(tasks[0]?.late) || 0 },
    topProducts: topProducts.map((row) => ({ name: row.name, quantity: Number(row.quantity) || 0, revenue: Number(row.revenue) || 0 })),
    memberActivity: activity.map((row) => ({ id: row.id, role: row.role, designation: row.designation || row.fullName,
      orders: Number(row.orders) || 0, scans: Number(row.scans) || 0, points: Number(row.points) || 0 })),
    pointsAwarded: Number(pointsToday[0]?.n) || 0,
    period: from ? from.toISOString() : 'all',
    serverTime: new Date().toISOString(),
  };
}

module.exports = { periodStart, startOfToday, overviewStats };
