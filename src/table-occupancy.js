'use strict';

// ============================================================================================
// MISSION 15 — OCCUPATION DES TABLES (§2.2 à §2.4 du prompt)
//
// Trois besoins réels, trois fonctions :
//   · savoir QUI occupe une table, DEPUIS QUAND, avec QUELLES commandes et QUEL montant ;
//   · libérer une table (« Marquer comme disponible ») en conservant tout l'historique ;
//   · retrouver l'historique d'occupation d'une table, par date.
//
// Règles tenues ici :
//   · une occupation est ouverte à la PREMIÈRE commande non terminée d'une table, et refermée
//     uniquement par une libération explicite (jamais automatiquement à la fin d'une commande :
//     le client peut encore commander, §2.4 « ne jamais écraser l'historique ») ;
//   · une libération n'efface AUCUNE commande : elle note l'heure, l'auteur et le motif, puis
//     rend la table disponible pour un nouvel occupant ;
//   · l'état d'occupation est aussi persisté sur la table (`occupation_status`,
//     `occupied_since`) : il survit à une actualisation et à une reconnexion ;
//   · si une commande est encore nouvelle ou si un paiement n'est pas confirmé, la libération
//     est REFUSÉE sans confirmation explicite (`force: true` + motif), et l'avertissement est
//     renvoyé au client pour qu'il soit affiché.
//
// Aucune permission n'est décidée ici : les routes appellent ces fonctions après avoir vérifié
// que le compte a le droit d'agir sur CETTE boutique.
// ============================================================================================

const crypto = require('node:crypto');

const id = () => `occ_${crypto.randomUUID().replace(/-/g, '')}`;

const OPEN_STATUSES = ['pending', 'confirmed', 'preparing', 'ready'];
// Le statut de paiement par défaut est « not_recorded » (aucun paiement enregistré) : c'est
// exactement le cas qui doit déclencher l'avertissement avant libération.
const PENDING_PAYMENT = ['not_recorded', 'unpaid', 'pending', '', null, undefined];

function numberOrZero(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

module.exports = function tableOccupancy({ pool, store = null }) {
  const memory = { occupations: [] };

  function jsonStore() {
    if (!store) return null;
    if (!Array.isArray(store.state.tableOccupations)) store.state.tableOccupations = [];
    return store.state.tableOccupations;
  }

  async function q(text, params = []) {
    if (!pool) throw new Error('PostgreSQL indisponible.');
    const result = await pool.query(text, params);
    return result;
  }

  /**
   * Ouvre une occupation pour une table si la table est réellement occupée et qu'aucune
   * occupation n'est en cours. Idempotent : appelée à chaque commande, elle ne crée pas de doublon.
   */
  async function ensureOpen({ storeId, point, order = null, customerName = '' }) {
    if (!storeId || !point?.id) return null;
    if (!pool) {
      const rows = jsonStore() || memory.occupations;
      const open = rows.find((row) => row.servicePointId === point.id && !row.releasedAt);
      if (open) {
        if (order && !open.orderIds.includes(order.id)) open.orderIds.push(order.id);
        return open;
      }
      const row = {
        id: id(), storeId, servicePointId: point.id, pointName: point.name || '',
        tableNumber: point.number || '', zone: point.zone || '',
        customerName: customerName || '', occupiedAt: new Date().toISOString(), releasedAt: null,
        releasedByType: '', releasedById: '', releasedByLabel: '', releaseReason: '',
        orderIds: order ? [order.id] : [], ordersTotalXof: numberOrZero(order?.totalAmountXof),
      };
      rows.push(row);
      return row;
    }
    const existing = await q(
      `SELECT * FROM table_occupations WHERE service_point_id=$1 AND released_at IS NULL ORDER BY occupied_at DESC LIMIT 1`, [point.id]);
    if (existing.rows[0]) {
      const open = existing.rows[0];
      if (order) {
        const ids = Array.isArray(open.order_ids) ? open.order_ids : [];
        if (!ids.includes(order.id)) {
          ids.push(order.id);
          await q(`UPDATE table_occupations SET order_ids=$2::jsonb, orders_total_xof=orders_total_xof+$3 WHERE id=$1`,
            [open.id, JSON.stringify(ids), numberOrZero(order.totalAmountXof)]);
        }
      }
      return open;
    }
    const row = {
      id: id(), storeId, servicePointId: point.id, pointName: point.name || '',
      tableNumber: point.number || '', zone: point.zone || '', customerName: customerName || '',
      occupiedAt: new Date().toISOString(), orderIds: order ? [order.id] : [],
      ordersTotalXof: numberOrZero(order?.totalAmountXof),
    };
    await q(
      `INSERT INTO table_occupations (id, store_id, service_point_id, point_name, table_number, zone, customer_name,
                                     occupied_at, order_ids, orders_total_xof)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
      [row.id, storeId, point.id, row.pointName, row.tableNumber, row.zone, row.customerName,
        row.occupiedAt, JSON.stringify(row.orderIds), row.ordersTotalXof]);
    await q(`UPDATE merchant_service_points SET occupation_status='occupied', occupied_since=COALESCE(occupied_since, NOW()) WHERE id=$1`, [point.id]);
    return row;
  }

  /**
   * Détail complet d'une table : occupation en cours, client, commandes, montants, responsable.
   * Toutes les valeurs proviennent de la base ; rien n'est inventé.
   */
  async function detail({ storeId, pointId }) {
    if (!pool) {
      const rows = jsonStore() || memory.occupations;
      const open = rows.find((row) => row.servicePointId === pointId && !row.releasedAt) || null;
      return { occupied: Boolean(open), occupation: open, orders: [], warning: null };
    }
    const point = await q(
      `SELECT id, name, table_number AS number, zone, capacity, status, occupation_status AS "occupationStatus",
              occupied_since AS "occupiedSince"
         FROM merchant_service_points WHERE id=$1 AND store_id=$2`, [pointId, storeId]);
    if (!point.rows[0]) return null;
    const open = await q(
      `SELECT id, customer_name AS "customerName", occupied_at AS "occupiedAt", order_ids AS "orderIds",
              orders_total_xof AS "ordersTotalXof"
         FROM table_occupations WHERE service_point_id=$1 AND released_at IS NULL ORDER BY occupied_at DESC LIMIT 1`, [pointId]);
    const orders = await q(
      `SELECT o.id, o.public_reference AS reference, o.status, o.payment_status AS "paymentStatus", o.customer_name AS "customerName",
              o.total_amount_xof AS "totalAmountXof", o.created_at AS "createdAt",
              COALESCE(o.delivery_address,'') AS "deliveryAddress"
         FROM merchant_orders o
        WHERE o.store_id=$1 AND o.service_point_id=$2 AND o.status NOT IN ('cancelled','rejected')
        ORDER BY o.created_at ASC`, [storeId, pointId]);
    const openOrders = orders.rows.filter((row) => OPEN_STATUSES.includes(row.status));
    const unpaid = openOrders.filter((row) => PENDING_PAYMENT.includes(row.paymentStatus));
    const total = openOrders.reduce((sum, row) => sum + numberOrZero(row.totalAmountXof), 0);
    const first = openOrders[0] || orders.rows[0] || null;
    return {
      point: point.rows[0],
      occupied: openOrders.length > 0 || Boolean(open.rows[0]),
      occupation: open.rows[0] || null,
      customerName: open.rows[0]?.customerName || first?.customerName || '',
      occupiedAt: open.rows[0]?.occupiedAt || first?.createdAt || null,
      orders: orders.rows,
      openOrders,
      ordersTotalXof: total,
      assignedTo: null,
      warning: unpaid.length
        ? `${unpaid.length} commande(s) de cette table ne sont pas encore payées. Libérer la table ne les annule pas : elles restent dans l’historique et devront être traitées.`
        : null,
    };
  }

  /**
   * Libère une table. Refuse si une commande est encore nouvelle ou impayée, sauf confirmation
   * explicite (`force`) accompagnée d'un motif — la décision reste tracée.
   */
  async function release({ storeId, pointId, actor = {}, force = false, reason = '' }) {
    const info = await detail({ storeId, pointId });
    if (!info) return { ok: false, status: 404, error: 'Cette table n’appartient pas à votre établissement.' };
    if (!info.occupied) return { ok: false, status: 409, error: 'Cette table est déjà disponible.', code: 'ALREADY_FREE' };

    const blocking = info.openOrders.filter((row) => row.status === 'pending' || PENDING_PAYMENT.includes(row.paymentStatus));
    if (blocking.length && !force) {
      return {
        ok: false, status: 409, code: 'TABLE_NOT_SETTLED',
        error: 'Des commandes de cette table ne sont pas encore payées ou pas encore traitées. Confirmez la libération en connaissance de cause : les commandes seront conservées.',
        warning: info.warning,
        blocking: blocking.map((row) => ({ reference: row.reference, status: row.status, paymentStatus: row.paymentStatus, totalAmountXof: row.totalAmountXof })),
      };
    }
    if (!String(reason || '').trim()) {
      return { ok: false, status: 400, error: 'Indiquez un motif de libération (ex. « client parti, table nettoyée »).', code: 'REASON_REQUIRED' };
    }

    const now = new Date().toISOString();
    const orderIds = info.openOrders.map((row) => row.id);
    const total = info.openOrders.reduce((sum, row) => sum + numberOrZero(row.totalAmountXof), 0);
    if (!pool) {
      const rows = jsonStore() || memory.occupations;
      const open = rows.find((row) => row.servicePointId === pointId && !row.releasedAt);
      if (open) {
        Object.assign(open, { releasedAt: now, releasedByType: actor.type || '', releasedById: actor.id || '',
          releasedByLabel: actor.label || '', releaseReason: reason, orderIds, ordersTotalXof: total });
      }
      return { ok: true, releasedAt: now, orderIds, ordersTotalXof: total, actor, reason };
    }
    // Une seule occupation ouverte par table : la ligne est verrouillée pendant l'écriture.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const open = await client.query(
        `SELECT id FROM table_occupations WHERE service_point_id=$1 AND released_at IS NULL ORDER BY occupied_at DESC LIMIT 1 FOR UPDATE`, [pointId]);
      const occupationId = open.rows[0]?.id || id();
      if (open.rows[0]) {
        await client.query(
          `UPDATE table_occupations SET released_at=$2, released_by_type=$3, released_by_id=$4, released_by_label=$5,
                  release_reason=$6, order_ids=$7::jsonb, orders_total_xof=$8 WHERE id=$1`,
          [occupationId, now, actor.type || '', actor.id || '', actor.label || '', reason, JSON.stringify(orderIds), total]);
      } else {
        await client.query(
          `INSERT INTO table_occupations (id, store_id, service_point_id, point_name, table_number, zone, occupied_at,
                                         released_at, released_by_type, released_by_id, released_by_label, release_reason, order_ids, orders_total_xof)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14)`,
          [occupationId, storeId, pointId, info.point.name || '', info.point.number || '', info.point.zone || '',
            info.occupiedAt || now, now, actor.type || '', actor.id || '', actor.label || '', reason,
            JSON.stringify(orderIds), total]);
      }
      await client.query(`UPDATE merchant_service_points SET occupation_status='free', occupied_since=NULL WHERE id=$1`, [pointId]);
      await client.query('COMMIT');
      return { ok: true, occupationId, releasedAt: now, orderIds, ordersTotalXof: total, actor, reason };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  /** Historique d'occupation d'une table (ou de tout l'établissement), du plus récent au plus ancien. */
  async function history({ storeId, pointId = '', from = '', to = '', limit = 50 }) {
    const bounded = Math.max(1, Math.min(200, Number(limit) || 50));
    if (!pool) {
      const rows = jsonStore() || memory.occupations;
      return rows.filter((row) => row.storeId === storeId && (!pointId || row.servicePointId === pointId))
        .sort((a, b) => String(b.occupiedAt).localeCompare(String(a.occupiedAt))).slice(0, bounded);
    }
    const params = [storeId];
    let where = 'store_id=$1';
    if (pointId) { params.push(pointId); where += ` AND service_point_id=$${params.length}`; }
    if (from) { params.push(from); where += ` AND occupied_at >= $${params.length}::timestamptz`; }
    if (to) { params.push(to); where += ` AND occupied_at <= $${params.length}::timestamptz`; }
    params.push(bounded);
    const { rows } = await q(
      `SELECT id, service_point_id AS "servicePointId", point_name AS "pointName", table_number AS "tableNumber",
              zone, customer_name AS "customerName", occupied_at AS "occupiedAt", released_at AS "releasedAt",
              released_by_type AS "releasedByType", released_by_label AS "releasedByLabel", release_reason AS "releaseReason",
              order_ids AS "orderIds", orders_total_xof AS "ordersTotalXof"
         FROM table_occupations WHERE ${where} ORDER BY occupied_at DESC LIMIT $${params.length}`, params);
    return rows;
  }

  /** Occupations ouvertes de tout l'établissement (une requête, pas de N+1). */
  async function openOccupations(storeId) {
    if (!pool) {
      const rows = jsonStore() || memory.occupations;
      return rows.filter((row) => row.storeId === storeId && !row.releasedAt);
    }
    const { rows } = await q(
      `SELECT service_point_id AS "servicePointId", customer_name AS "customerName", occupied_at AS "occupiedAt",
              order_ids AS "orderIds", orders_total_xof AS "ordersTotalXof"
         FROM table_occupations WHERE store_id=$1 AND released_at IS NULL`, [storeId]);
    return rows;
  }

  return { ensureOpen, detail, release, history, openOccupations, OPEN_STATUSES };
};
