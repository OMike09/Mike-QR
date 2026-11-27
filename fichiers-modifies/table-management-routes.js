'use strict';

// ============================================================================================
// MISSION 12 — Gestion des tables et des espaces (marchand).
//
// POURQUOI CE FICHIER
// La gestion des tables EXISTE déjà et n'a jamais été supprimée : elle vit dans
// `merchant_service_points` (créée par le schéma, alimentée par /api/merchant/service-points et
// /api/merchant/tables) et c'est elle qui porte les QR imprimés (/t/<code>). Le problème n'était
// pas la donnée, mais l'ACCÈS : la rubrique s'appelait « Tables et salons », elle était rangée
// dans « Établissement », et la création n'était accessible que depuis un écran lointain. Un
// marchand pouvait donc croire qu'elle avait disparu.
//
// RÈGLE ABSOLUE : ce module ne crée AUCUNE deuxième gestion. Il lit et écrit la MÊME table
// `merchant_service_points`. Aucun `public_code` (donc aucun QR imprimé) n'est modifié, aucun
// emplacement n'est supprimé : « supprimer » = désactiver, et le QR reste traçable.
//
// Ce qui est ajouté ici :
//   · le numéro de table (`table_number`) choisi par le MARCHAND, unique par établissement ;
//   · les salons et espaces comme regroupements réels (`zone`), renommables sans casser les QR ;
//   · les routes /api/merchant/table-management/* utilisées par l'écran « Tables et espaces ».
// ============================================================================================

const crypto = require('node:crypto');

const TYPES = ['table', 'salon', 'counter', 'location'];
const TYPE_LABELS = { table: 'Table', salon: 'Salon / Espace', counter: 'Comptoir', location: 'Emplacement' };
const MAX_TABLES = 400;

function fail(message, code = 'BAD_REQUEST', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

// Mission 15 : capacité d'une table (nombre de couverts). Facultative ; vide ou 0 = non renseignée.
function failValidation(message, code = 'VALIDATION_ERROR', status = 400) {
  const error = new Error(message); error.status = status; error.code = code; return error;
}

function cleanCapacity(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 999) throw failValidation('La capacité doit être un nombre entre 1 et 999 (0 ou vide = non renseignée).');
  return n === 0 ? null : Math.round(n);
}

// Un numéro de table est une chaîne courte, lisible sur un QR imprimé : lettres, chiffres,
// tiret, point et espace (ex. « 12 », « A3 », « Terrasse 2 »). On refuse tout le reste.
function cleanNumber(value) {
  const raw = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  if (raw.length > 24) throw fail('Le numéro de table ne doit pas dépasser 24 caractères.');
  if (!/^[\p{L}\p{N}][\p{L}\p{N}\s.-]*$/u.test(raw)) throw fail('Le numéro de table ne peut contenir que des lettres, des chiffres, des espaces, des points et des tirets.');
  return raw;
}
const normalizeKey = (value) => String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr');

// `apiError` du serveur transforme toute erreur en 500 ; ici les refus métier doivent garder leur
// code (409 numéro déjà pris, 403 QR d'une autre boutique, 404 inconnu) pour que l'écran explique.
function respondError(res, error, fallback) {
  const status = Number(error?.status) || (error?.code === 'TABLE_NUMBER_TAKEN' || error?.code === 'ZONE_TAKEN' ? 409 : 400);
  if (status >= 500 || !error?.message) {
    console.error('[tables]', error?.stack || error?.message || error);
    return res.status(500).json({ error: fallback });
  }
  return res.status(status).json({ error: error.message, code: error.code || '' });
}

function cleanName(value, label = 'nom') {
  const raw = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!raw) throw fail(`Indiquez un ${label}.`);
  if (raw.length > 80) throw fail(`Le ${label} ne doit pas dépasser 80 caractères.`);
  return raw;
}

function safeZone(value) {
  const raw = String(value ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  if (raw.length > 120) throw fail('Le nom du salon ne doit pas dépasser 120 caractères.');
  return raw;
}

module.exports = function tableManagementRoutes(deps) {
  const { app, team, extras, requireMerchant, checkSameOrigin, apiError, audit, store, assignments = null, occupancy = null } = deps;
  const pg = () => team.pg && team.base && team.base.pool;
  const q = (sql, params) => team.base.pool.query(sql, params);

  // Le magasin du marchand connecté : une seule boutique par marchand dans ce produit.
  async function ownStore(req) {
    if (typeof deps.resolveStore === 'function') {
      const row = await deps.resolveStore(req).catch(() => null);
      if (row) return row;
    }
    const { rows } = await q('SELECT id, name, merchant_id AS "merchantId" FROM merchant_stores WHERE merchant_id=$1 AND status=\'active\' ORDER BY created_at ASC LIMIT 1', [req.merchant.id]);
    if (!rows[0]) throw fail('Publiez d’abord votre boutique pour gérer vos tables.', 'STORE_REQUIRED', 409);
    return rows[0];
  }

  function publicPoint(row) {
    return {
      id: row.id, storeId: row.storeId, type: row.type, name: row.name, number: row.tableNumber || '',
      capacity: row.capacity === null || row.capacity === undefined ? null : Number(row.capacity),
      zone: row.zone || '', instructions: row.instructions || '', status: row.status,
      publicCode: row.publicCode || '', path: row.publicCode ? `/t/${row.publicCode}` : '',
      qrScanCount: Number(row.qrScanCount) || 0, occupied: Boolean(row.occupied),
      activeOrders: Number(row.activeOrderCount) || 0, assignedTo: row.assignedTo || null,
      // §2.2 : le personnel doit voir qui occupe la table, depuis quand, et pour quel montant.
      occupancy: row.occupancy ? {
        customerName: row.occupancy.customerName || '',
        occupiedAt: row.occupancy.occupiedAt || null,
        ordersTotalXof: Number(row.occupancy.ordersTotalXof) || 0,
        openOrders: Number(row.occupancy.openOrders) || 0,
      } : null,
      createdAt: row.createdAt, updatedAt: row.updatedAt,
    };
  }

  // Liste commune : tables, salons et comptoirs de la boutique, avec occupation réelle et
  // affectation en cours. Une seule requête par famille d'informations, pas de N+1.
  async function loadPoints(storeId) {
    const { rows } = await q(
      `SELECT p.id, p.store_id AS "storeId", p.point_type AS type, p.name, p.table_number AS "tableNumber",
              p.capacity, p.zone, p.instructions, p.public_code AS "publicCode", p.status,
              p.qr_scan_count AS "qrScanCount", p.created_at AS "createdAt", p.updated_at AS "updatedAt",
              (SELECT COUNT(*)::int FROM merchant_orders o
                WHERE o.store_id=p.store_id AND o.service_point_id=p.id
                  AND o.status NOT IN ('completed','cancelled','rejected')) AS "activeOrderCount"
         FROM merchant_service_points p WHERE p.store_id=$1
        ORDER BY (p.point_type <> 'salon') ASC,
                 NULLIF(NULLIF(regexp_replace(COALESCE(p.table_number,''), '[^0-9]', '', 'g'), ''), '')::int NULLS LAST,
                 COALESCE(p.table_number,'') COLLATE "C", p.name COLLATE "C"`, [storeId]);
    // Affectation durable d'une table à une serveuse/un gérant : table existante de la mission 6.
    let assignedMap = new Map();
    try {
      const assigned = await q(
        `SELECT a.service_point_id AS "servicePointId", a.member_id AS "memberId",
                COALESCE(m.designation, m.full_name) AS designation
           FROM team_service_point_assignments a LEFT JOIN team_members m ON m.id=a.member_id
          WHERE a.store_id=$1`, [storeId]);
      assignedMap = new Map(assigned.rows.map((row) => [row.servicePointId, { memberId: row.memberId, designation: row.designation || '' }]));
    } catch (_) { assignedMap = new Map(); }
    // §2.2 : l'occupation vient de la table d'occupation (elle survit à une actualisation et
    // distingue « libérée par le personnel » de « plus aucune commande en cours »).
    let occupancyMap = new Map();
    let trackedPoints = new Set();
    try {
      const open = await q(
        `SELECT tc.service_point_id AS "servicePointId", tc.customer_name AS "customerName",
                tc.occupied_at AS "occupiedAt", tc.orders_total_xof AS "ordersTotalXof",
                (SELECT COUNT(*)::int FROM merchant_orders o
                  WHERE o.service_point_id=tc.service_point_id AND o.status NOT IN ('completed','cancelled','rejected')) AS "openOrders"
           FROM table_occupations tc WHERE tc.store_id=$1 AND tc.released_at IS NULL`, [storeId]);
      occupancyMap = new Map(open.rows.map((row) => [row.servicePointId, row]));
      // Une table qui a DÉJÀ un historique d'occupation est pilotée par cet historique : après une
      // libération volontaire, elle est disponible même s'il reste des commandes non réglées
      // (celles-ci ne sont jamais supprimées, elles restent dans l'historique — §2.3).
      const ever = await q('SELECT DISTINCT service_point_id AS id FROM table_occupations WHERE store_id=$1', [storeId]);
      trackedPoints = new Set(ever.rows.map((row) => row.id));
    } catch (_) { occupancyMap = new Map(); trackedPoints = new Set(); }
    return rows.map((row) => {
      const live = occupancyMap.get(row.id) || null;
      // Repli pour les occupations antérieures à la mission 15 (aucune ligne d'occupation) :
      // des commandes en cours suffisent à considérer la table occupée.
      const legacyBusy = !trackedPoints.has(row.id) && Number(row.activeOrderCount) > 0;
      const occupied = Boolean(live) || legacyBusy;
      return publicPoint({ ...row, occupied, assignedTo: assignedMap.get(row.id) || null, occupancy: live });
    });
  }

  async function zonesOf(storeId) {
    const { rows } = await q(
      `SELECT COALESCE(NULLIF(zone,''),'') AS zone, COUNT(*)::int AS count
         FROM merchant_service_points WHERE store_id=$1 AND status='active' AND btrim(zone)<>''
        GROUP BY COALESCE(NULLIF(zone,''),'') ORDER BY COALESCE(NULLIF(zone,''),'') COLLATE "C"`, [storeId]);
    return rows.filter((row) => row.zone);
  }

  // Unicité du numéro DANS l'établissement seulement : deux établissements différents peuvent
  // utiliser « Table 1 ». La contrainte est aussi posée en base (index partiel) : elle tient même
  // si deux appareils enregistrent au même instant.
  async function assertNumberFree(storeId, number, exceptId = '') {
    if (!number) return;
    const { rows } = await q(
      `SELECT id, name FROM merchant_service_points
        WHERE store_id=$1 AND status='active' AND lower(btrim(table_number))=lower(btrim($2))${exceptId ? ' AND id<>$3' : ''} LIMIT 1`,
      exceptId ? [storeId, number, exceptId] : [storeId, number]);
    if (rows[0]) throw fail(`Le numéro « ${number} » est déjà utilisé par « ${rows[0].name} » dans votre établissement. Choisissez un autre numéro.`, 'TABLE_NUMBER_TAKEN', 409);
  }

  async function salonIdByName(storeId, zone) {
    if (!zone) return '';
    const { rows } = await q(`SELECT id FROM merchant_service_points WHERE store_id=$1 AND point_type='salon' AND status='active' AND lower(btrim(name))=lower(btrim($2)) LIMIT 1`, [storeId, zone]);
    return rows[0]?.id || '';
  }

  async function auditAction(req, action, entityId, summary, metadata) {
    try {
      await audit('merchant', req, { action, merchantId: req.merchant.id, entityId, summary, metadata });
    } catch (_) {
      try {
        await store.addAudit({ actor: `${req.merchant.displayName || 'Marchand'} (@${req.merchant.username})`, actorType: 'merchant',
          actorId: req.merchant.id, action, entityType: 'merchant_service_point', entityId, summary, result: 'success', metadata });
      } catch (_) { /* l'audit ne doit jamais bloquer l'action du marchand */ }
    }
  }

  // ------------------------------------------------------------------ lecture
  app.get('/api/merchant/table-management', requireMerchant, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const points = await loadPoints(shop.id);
      const active = points.filter((point) => point.status === 'active');
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        store: { id: shop.id, name: shop.name },
        types: TYPES.map((id) => ({ id, label: TYPE_LABELS[id] })),
        points,
        zones: await zonesOf(shop.id),
        summary: {
          tables: active.filter((point) => point.type === 'table').length,
          salons: active.filter((point) => point.type === 'salon').length,
          counters: active.filter((point) => point.type === 'counter').length,
          locations: active.filter((point) => point.type === 'location').length,
          free: active.filter((point) => point.type === 'table' && !point.occupied).length,
          occupied: active.filter((point) => point.occupied).length,
          assigned: active.filter((point) => point.assignedTo).length,
          inactive: points.filter((point) => point.status !== 'active').length,
        },
        // Personnel, pour l'affectation d'une table à une serveuse ou un gérant.
        members: (await team.listMembers(req.merchant.id, {})).map((member) => ({ id: member.id, role: member.role,
          label: member.designation || member.fullName, status: member.status })),
      } });
    } catch (error) { return respondError(res, error, 'Impossible de charger vos tables et espaces.'); }
  });

  // ------------------------------------------------------------------ créer une table
  app.post('/api/merchant/table-management/tables', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const number = cleanNumber(req.body?.number);
      const zone = safeZone(req.body?.zone);
      if (!number) throw fail('Indiquez le numéro de la table (ex. 1, A3, Terrasse 2).');
      const name = String(req.body?.name || '').trim() ? cleanName(req.body.name, 'nom de table') : `Table ${number}`;
      const before = await q(`SELECT COUNT(*)::int AS n FROM merchant_service_points WHERE store_id=$1 AND status='active'`, [shop.id]);
      if ((before.rows[0]?.n || 0) >= MAX_TABLES) throw fail('Vous avez atteint la limite de tables pour un établissement.');
      await assertNumberFree(shop.id, number);
      // Mission 15 : capacité facultative, et affectation immédiate à un membre de l'équipe.
      const capacity = cleanCapacity(req.body?.capacity);
      const memberId = String(req.body?.memberId || '').trim();
      let member = null;
      if (memberId) {
        // L'appartenance est vérifiée côté serveur : un identifiant venu du client ne permet jamais
        // d'affecter la table d'un autre établissement.
        const check = await q('SELECT id, designation, full_name FROM team_members WHERE id=$1 AND merchant_id=$2', [memberId, req.merchant.id]);
        member = check.rows[0] || null;
        if (!member) throw fail('Ce membre de l’équipe n’appartient pas à votre établissement.', 'MEMBER_NOT_OWNED', 404);
      }
      const created = await extras.createServicePoint(shop.id, { type: 'table', name, zone, instructions: String(req.body?.instructions || '').trim().slice(0, 200), requestId: req.body?.requestId });
      await q('UPDATE merchant_service_points SET table_number=$2, capacity=$3, updated_at=NOW() WHERE id=$1 AND store_id=$4', [created.id, number, capacity, shop.id]);
      if (member && assignments) {
        await assignments.replaceForMember({ merchantId: req.merchant.id, storeId: shop.id, memberId: member.id, points: [created.id],
          actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' } });
      }
      await auditAction(req, 'table_created', created.id, `Table « ${number} » créée${zone ? ` dans le salon « ${zone} »` : ''}${member ? ` et attribuée à ${member.designation || member.full_name}` : ''}.`,
        { number, zone, capacity, publicCode: created.publicCode, assignedTo: member?.id || null });
      const points = await loadPoints(shop.id);
      // 200 = rejeu du même requestId (double clic) : aucune deuxième table n'est annoncée.
      return res.status(created.idempotent ? 200 : 201).json({ data: { table: points.find((point) => point.id === created.id) || null, points,
        created: !created.idempotent } });
    } catch (error) { return respondError(res, error, 'Impossible de créer cette table.'); }
  });

  // ------------------------------------------------------------------ créer un salon / espace
  app.post('/api/merchant/table-management/salons', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const name = cleanName(req.body?.name, 'nom de salon');
      const type = req.body?.type === 'location' ? 'location' : 'salon';
      const existing = await q(`SELECT id FROM merchant_service_points WHERE store_id=$1 AND point_type IN ('salon','location') AND status='active' AND lower(btrim(name))=lower(btrim($2))`, [shop.id, name]);
      if (existing.rows[0]) throw fail('Un salon ou un espace porte déjà ce nom dans votre établissement.', 'ZONE_TAKEN', 409);
      const created = await extras.createServicePoint(shop.id, { type, name, zone: '', instructions: String(req.body?.instructions || '').trim().slice(0, 200), requestId: req.body?.requestId });
      await auditAction(req, 'salon_created', created.id, `${TYPE_LABELS[type]} « ${name} » créé.`, { name, type });
      return res.status(created.idempotent ? 200 : 201).json({ data: { salon: publicPoint(created), points: await loadPoints(shop.id), zones: await zonesOf(shop.id) } });
    } catch (error) { return respondError(res, error, 'Impossible de créer ce salon.'); }
  });

  // ------------------------------------------------------------------ modifier (numéro, nom, salon)
  app.put('/api/merchant/table-management/points/:pointId', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const { rows } = await q(`SELECT * FROM merchant_service_points WHERE id=$1 AND store_id=$2`, [String(req.params.pointId), shop.id]);
      const before = rows[0];
      if (!before) return res.status(404).json({ error: 'Cette table ou cet espace n’appartient pas à votre établissement.' });
      const body = req.body || {};
      const number = body.number === undefined ? (before.table_number || '') : cleanNumber(body.number);
      if (before.point_type === 'table' && !number) throw fail('Une table doit avoir un numéro.');
      const name = body.name === undefined ? (before.point_type === 'table' ? `Table ${number}` : before.name) : cleanName(body.name, 'nom');
      const zone = body.zone === undefined ? (before.zone || '') : safeZone(body.zone);
      const status = ['active', 'inactive'].includes(body.status) ? body.status : before.status;
      if (status === 'active') await assertNumberFree(shop.id, number, before.id);
      const updated = await extras.updateServicePoint(shop.id, before.id, {
        type: before.point_type, name, zone, status, instructions: body.instructions === undefined ? before.instructions : String(body.instructions || '').trim().slice(0, 200) });
      const capacity = body.capacity === undefined ? (before.capacity === null || before.capacity === undefined ? null : Number(before.capacity)) : cleanCapacity(body.capacity);
      await q('UPDATE merchant_service_points SET table_number=$2, capacity=$3, updated_at=NOW() WHERE id=$1 AND store_id=$4', [before.id, number, capacity, shop.id]);
      const changes = [];
      if ((before.table_number || '') !== number) changes.push(`numéro ${before.table_number || '—'} → ${number}`);
      if ((before.name || '') !== name) changes.push(`nom → ${name}`);
      if ((before.zone || '') !== zone) changes.push(`salon → ${zone || 'aucun'}`);
      if (before.status !== status) changes.push(status === 'active' ? 'réactivée' : 'désactivée');
      await auditAction(req, 'table_updated', before.id, `« ${before.name} » modifiée${changes.length ? ` : ${changes.join(', ')}` : ''}. Le QR reste inchangé.`, { changes, publicCode: before.public_code });
      const points = await loadPoints(shop.id);
      return res.json({ data: { point: points.find((point) => point.id === before.id) || publicPoint(updated), points, zones: await zonesOf(shop.id) } });
    } catch (error) { return respondError(res, error, 'Impossible de modifier cette table.'); }
  });

  // ------------------------------------------------------------------ activer / désactiver
  app.post('/api/merchant/table-management/points/:pointId/status', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const status = req.body?.status === 'active' ? 'active' : 'inactive';
      const { rows } = await q(`SELECT * FROM merchant_service_points WHERE id=$1 AND store_id=$2`, [String(req.params.pointId), shop.id]);
      const before = rows[0];
      if (!before) return res.status(404).json({ error: 'Cette table ou cet espace n’appartient pas à votre établissement.' });
      if (status === 'active') await assertNumberFree(shop.id, before.table_number || '', before.id);
      if (status === 'inactive') {
        const busy = await q(`SELECT COUNT(*)::int AS n FROM merchant_orders WHERE store_id=$1 AND service_point_id=$2 AND status NOT IN ('completed','cancelled','rejected')`, [shop.id, before.id]);
        if ((busy.rows[0]?.n || 0) > 0) throw fail('Cette table porte encore des commandes en cours. Terminez-les avant de la désactiver.', 'TABLE_BUSY', 409);
      }
      await extras.updateServicePoint(shop.id, before.id, { type: before.point_type, name: before.name, zone: before.zone || '', instructions: before.instructions || '', status });
      await auditAction(req, status === 'active' ? 'table_reactivated' : 'table_deactivated', before.id,
        status === 'active' ? `« ${before.name} » réactivée. Son QR imprimé refonctionne.` : `« ${before.name} » désactivée. Son QR et son historique sont conservés.`, { publicCode: before.public_code });
      const points = await loadPoints(shop.id);
      return res.json({ data: { points, zones: await zonesOf(shop.id) } });
    } catch (error) { return respondError(res, error, 'Impossible de changer l’état de cette table.'); }
  });

  // ------------------------------------------------------------------ affecter à un membre
  app.post('/api/merchant/table-management/points/:pointId/assign', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const memberId = String(req.body?.memberId || '');
      if (memberId) {
        const member = await team.getMember(memberId, req.merchant.id);
        if (!member) return res.status(404).json({ error: 'Ce membre n’appartient pas à votre établissement.' });
      }
      const result = await deps.ops.assignServicePoint({ merchantId: req.merchant.id, storeId: shop.id,
        servicePointId: String(req.params.pointId), memberId, actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' } });
      return res.json({ data: { ...result, points: await loadPoints(shop.id) } });
    } catch (error) { return respondError(res, error, 'Impossible d’affecter cette table.'); }
  });

  // ------------------------------------------------------------------ nommer un salon
  app.put('/api/merchant/table-management/salons/:salonId', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const name = cleanName(req.body?.name, 'nom de salon');
      const { rows } = await q(`SELECT * FROM merchant_service_points WHERE id=$1 AND store_id=$2 AND point_type IN ('salon','location')`, [String(req.params.salonId), shop.id]);
      const salon = rows[0];
      if (!salon) return res.status(404).json({ error: 'Ce salon n’appartient pas à votre établissement.' });
      const clash = await q(`SELECT id FROM merchant_service_points WHERE store_id=$1 AND point_type IN ('salon','location') AND status='active' AND id<>$2 AND lower(btrim(name))=lower(btrim($3))`, [shop.id, salon.id, name]);
      if (clash.rows[0]) throw fail('Un autre salon porte déjà ce nom.', 'ZONE_TAKEN', 409);
      // Les tables rattachées au salon suivent le nouveau nom : leur QR ne change pas.
      await q(`UPDATE merchant_service_points SET zone=$3, updated_at=NOW() WHERE store_id=$1 AND zone=$2`, [shop.id, salon.zone || salon.name, name]);
      await q(`UPDATE merchant_service_points SET zone=$3, updated_at=NOW() WHERE store_id=$1 AND zone=$2`, [shop.id, salon.name, name]);
      await extras.updateServicePoint(shop.id, salon.id, { type: salon.point_type, name, zone: salon.zone || '', instructions: salon.instructions || '', status: salon.status });
      await auditAction(req, 'salon_renamed', salon.id, `Salon renommé « ${salon.name} » → « ${name} ». Les tables et leurs QR sont conservés.`, { before: salon.name, after: name });
      return res.json({ data: { points: await loadPoints(shop.id), zones: await zonesOf(shop.id) } });
    } catch (error) { return respondError(res, error, 'Impossible de renommer ce salon.'); }
  });

  // ------------------------------------------------------------------ QR déjà attaché à la table
  // RÈGLE MISSION 5 CONSERVÉE : le rôle marchand ne crée JAMAIS de QR de plateforme (garde
  // /api/merchant/…qr…). Ce module ne crée donc aucun QR : chaque table reçoit son code public
  // `T-…` à sa création (comportement existant) et l'écran affiche/imprime ce code inchangé.
  // C'est ce qui garantit qu'un QR déjà imprimé continue de fonctionner.

  // ------------------------------------------------------------------ reconnaissance d'un scan
  // Utilisée par les écrans marchand et équipe : à partir du contenu d'un QR (lien complet
  // /t/<code>, ou code seul), on renvoie la table reconnue après vérification côté serveur.
  // Aucune confiance n'est accordée au navigateur : le code doit appartenir à l'établissement.
  app.post('/api/merchant/table-management/resolve', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const raw = String(req.body?.code || '').trim();
      if (!raw || raw.length > 2000) throw fail('Aucun QR à vérifier.');
      const candidates = new Set([raw]);
      try {
        if (/^https?:\/\//i.test(raw)) {
          const url = new URL(raw);
          const match = url.pathname.match(/^\/t\/([A-Za-z0-9_-]+)\/?$/);
          if (match) candidates.add(match[1]);
          const param = url.searchParams.get('servicePoint');
          if (param) candidates.add(param);
        }
      } catch (_) { /* contenu non-URL : on utilise la chaîne telle quelle */ }
      const list = [...candidates].filter((value) => value && value.length <= 120);
      const { rows } = await q(
        `SELECT id, name, table_number AS "tableNumber", zone, point_type AS type, status, public_code AS "publicCode"
           FROM merchant_service_points WHERE store_id=$1 AND public_code = ANY($2::text[]) LIMIT 1`, [shop.id, list]);
      const point = rows[0];
      if (!point) {
        // Distinctement : QR d'une autre boutique vs QR inconnu / désactivé.
        const other = await q(`SELECT store_id FROM merchant_service_points WHERE public_code = ANY($1::text[]) LIMIT 1`, [list]).catch(() => ({ rows: [] }));
        throw fail(other.rows[0] ? 'Ce QR appartient à une autre boutique.' : 'Ce QR ne correspond à aucune table de votre établissement.',
          other.rows[0] ? 'QR_OTHER_STORE' : 'QR_NOT_FOUND', other.rows[0] ? 403 : 404);
      }
      if (point.status !== 'active') throw fail('Cette table a été désactivée. Son QR a été conservé mais n’est plus utilisable.', 'QR_INACTIVE', 409);
      return res.json({ data: { point: publicPoint({ ...point, occupied: false, activeOrderCount: 0 }), store: { id: shop.id, name: shop.name } } });
    } catch (error) { return respondError(res, error, 'Impossible de vérifier ce QR.'); }
  });

  // ------------------------------------------------------------------ livraison des commandes
  // Une commande doit toujours porter la bonne table : on expose une route unique utilisée par
  // l'écran de commande assistée pour confirmer la table déjà enregistrée sur la commande.
  app.get('/api/merchant/table-management/orders/:orderId', requireMerchant, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const { rows } = await q(
        `SELECT o.id, o.public_reference AS reference, o.status, o.service_point_id AS "servicePointId",
                o.service_point_name AS "servicePointName", p.table_number AS "tableNumber", p.zone
           FROM merchant_orders o LEFT JOIN merchant_service_points p ON p.id=o.service_point_id
          WHERE o.id=$1 AND o.store_id=$2`, [String(req.params.orderId), shop.id]);
      if (!rows[0]) return res.status(404).json({ error: 'Commande introuvable dans votre établissement.' });
      return res.json({ data: rows[0] });
    } catch (error) { return respondError(res, error, 'Impossible de lire la table de cette commande.'); }
  });

  // ------------------------------------------------------------------ occupation d'une table (§2.2-§2.4)
  //   GET  /api/merchant/table-management/points/:pointId/occupation      fiche détaillée
  //   POST /api/merchant/table-management/points/:pointId/release         « Marquer comme disponible »
  //   GET  /api/merchant/table-management/occupations                     historique par table et période
  // Toutes les routes vérifient que la table appartient à la boutique du compte connecté.
  async function ownPoint(shop, pointId) {
    const { rows } = await q(`SELECT id, name, table_number AS number, zone, capacity, status FROM merchant_service_points WHERE id=$1 AND store_id=$2`, [String(pointId), shop.id]);
    return rows[0] || null;
  }

  app.get('/api/merchant/table-management/points/:pointId/occupation', requireMerchant, async (req, res) => {
    try {
      const shop = await ownStore(req);
      if (!occupancy) return res.status(503).json({ error: 'Le suivi d’occupation est indisponible.' });
      const info = await occupancy.detail({ storeId: shop.id, pointId: String(req.params.pointId) });
      if (!info) return res.status(404).json({ error: 'Cette table n’appartient pas à votre établissement.' });
      return res.json({ data: info });
    } catch (error) { return respondError(res, error, 'Impossible de lire l’occupation de cette table.'); }
  });

  app.post('/api/merchant/table-management/points/:pointId/release', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const shop = await ownStore(req);
      if (!occupancy) return res.status(503).json({ error: 'La libération des tables est indisponible.' });
      const point = await ownPoint(shop, req.params.pointId);
      if (!point) return res.status(404).json({ error: 'Cette table n’appartient pas à votre établissement.' });
      const rawReason = String(req.body?.reason || '').trim();
      const reason = rawReason || (req.body?.force === true ? 'Libération confirmée par le personnel.' : '');
      const result = await occupancy.release({ storeId: shop.id, pointId: point.id,
        actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username || 'Marchand' },
        force: req.body?.force === true, reason });
      // Un motif vide est une erreur de saisie (400) : on ne le transforme pas en libération forcée.
      if (!result.ok) return res.status(result.status || 400).json({ error: result.error, code: result.code || '', warning: result.warning || '',
        blocking: result.blocking || [], needsConfirmation: result.code === 'TABLE_NOT_SETTLED' });
      // §2.3 : la libération est auditée avec l'ancien état et le nouvel état.
      await auditAction(req, 'table_released', point.id,
        `Table ${point.number || point.name} marquée disponible.`, { before: { status: 'occupied' }, after: { status: 'free', reason }, occupationId: result.occupationId });
      return res.json({ data: result });
    } catch (error) { return respondError(res, error, 'Impossible de libérer cette table.'); }
  });

  app.get('/api/merchant/table-management/occupations', requireMerchant, async (req, res) => {
    try {
      const shop = await ownStore(req);
      if (!occupancy) return res.json({ data: [] });
      const rows = await occupancy.history({ storeId: shop.id, pointId: String(req.query.pointId || ''),
        from: String(req.query.from || ''), to: String(req.query.to || ''), limit: req.query.limit });
      return res.setHeader('Cache-Control', 'no-store').json({ data: rows });
    } catch (error) { return respondError(res, error, 'Impossible de lire l’historique des tables.'); }
  });

  return { loadPoints, ownStore };
};
