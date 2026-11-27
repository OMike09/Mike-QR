'use strict';

// ============================================================================================
// MISSION 15 — NOUVELLES COMMANDES : compteur fiable, sans doublon, par rôle.
//
// Définition retenue (et vérifiable) :
//   est « nouvelle » toute commande de l'établissement, non annulée/rejetée, dont le statut est
//   encore en amont du service (pending, confirmed, preparing, ready, out_for_delivery) et que
//   AUCUN membre du personnel n'a encore ouverte.
//
// Pourquoi cette définition :
//   · une commande annulée disparaît immédiatement du compteur (exigence explicite) ;
//   · une commande déjà traitée (completed) n'est jamais comptée comme nouvelle ;
//   · le compteur ne peut pas gonfler par double validation : il compte des lignes de commandes,
//     pas des événements — un même identifiant ne peut donc pas être compté deux fois ;
//   · « consultée » est enregistrée par personne (merchant_order_views) : ouvrir la liste des
//     commandes ou une commande précise la fait sortir des nouveautés, pour tout le monde, car
//     le personnel travaille sur les mêmes commandes.
//
// L'isolation par établissement est portée par storeId : un marchand ne voit que ses commandes,
// un gérant/serveuse ne voit que celles de la boutique à laquelle il est rattaché (le rattachement
// est résolu par l'appelant, jamais envoyé par le client).
// ============================================================================================

function createNewOrderCounter({ pool }) {
  let ready = false;
  // Sans base SQL (stockage JSON local, tests), le compteur renvoie zéro : l'écran reste correct et
  // aucune erreur n'est affichée au marchand. La production utilise PostgreSQL.
  if (!pool) {
    return { count: async () => ({ count: 0, latest: null, byStatus: {} }),
      markSeen: async () => 0,
      summaryFor: async ({ storeId = null, viewerKind = 'merchant' } = {}) => ({ count: 0, latest: null, byStatus: {}, storeId, viewerKind, refreshedAt: new Date().toISOString() }),
      ACTIVE_STATUSES: ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'], ensureTable: async () => {}, enabled: false };
  }

  async function ensureTable() {
    if (ready) return;
    const fs = require('fs');
    const path = require('path');
    const file = path.join(__dirname, 'schema-mission15-compteur.sql');
    if (fs.existsSync(file)) await pool.query(fs.readFileSync(file, 'utf8'));
    ready = true;
  }

  const ACTIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery'];

  /** Compte les commandes non vues d'un établissement (et renvoie le détail minimal). */
  async function count(storeId) {
    await ensureTable();
    if (!storeId) return { count: 0, latest: null, byStatus: {} };
    const result = await pool.query(
      `SELECT o.status, COUNT(*)::int AS total, MAX(o.created_at) AS latest
       FROM merchant_orders o
       WHERE o.store_id = $1
         AND o.status = ANY($2::text[])
         AND NOT EXISTS (SELECT 1 FROM merchant_order_views v WHERE v.order_id = o.id)
       GROUP BY o.status`,
      [storeId, ACTIVE_STATUSES],
    );
    const byStatus = {};
    let count = 0;
    let latest = null;
    for (const row of result.rows) {
      byStatus[row.status] = row.total;
      count += row.total;
      if (!latest || new Date(row.latest) > new Date(latest)) latest = row.latest;
    }
    return { count, latest, byStatus };
  }

  /** Marque des commandes comme vues. `ids` vide = toutes les commandes ouvertes. */
  async function markSeen({ storeId, ids = [], viewerKind = 'merchant', viewerId }) {
    await ensureTable();
    if (!storeId || !viewerId) return 0;
    const params = [storeId, viewerKind, String(viewerId)];
    let filter = `AND o.status = ANY($4::text[])`;
    params.push(ACTIVE_STATUSES);
    if (ids.length) { filter += ` AND o.id = ANY($5::text[])`; params.push(ids.slice(0, 500)); }
    const result = await pool.query(
      `INSERT INTO merchant_order_views (order_id, viewer_kind, viewer_id)
       SELECT o.id, $2, $3 FROM merchant_orders o
       WHERE o.store_id = $1 ${filter}
       ON CONFLICT (order_id, viewer_kind, viewer_id) DO NOTHING`,
      params,
    );
    return result.rowCount;
  }

  /**
   * Vue par rôle. `scope` est résolu côté serveur :
   *   { storeId }                  → tout l'établissement (marchand)
   *   { storeId, staffId }         → la personne, mais le compteur porte sur la boutique
   *   { storeId: null }            → aucun accès : compteur à 0 (jamais une fuite)
   */
  async function summaryFor({ storeId, viewerKind = 'merchant', viewerId }) {
    const stats = await count(storeId);
    return { ...stats, storeId: storeId || null, viewerKind, refreshedAt: new Date().toISOString() };
  }

  return { count, markSeen, summaryFor, ACTIVE_STATUSES, ensureTable };
}

module.exports = { createNewOrderCounter };
