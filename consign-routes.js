'use strict';

// ============================================================================================
// MISSION 7 — Routes « CONSIGNATION » côté marchand et côté équipe (gérant / serveuse).
//
//   Marchand (session marchand) :
//     GET  /api/merchant/consignments                liste filtrable
//     GET  /api/merchant/consignments/stats          tableau de bord
//     POST /api/merchant/consignments                enregistrer un dépôt (code généré)
//     GET  /api/merchant/consignments/:id            fiche + mouvements + événements
//     POST /api/merchant/consignments/:id/return     retour de bouteilles
//     POST /api/merchant/consignments/:id/use        crédit utilisé pour une commande
//     POST /api/merchant/consignments/:id/refund     remboursement
//     POST /api/merchant/consignments/:id/cancel     annulation motivée
//     POST /api/merchant/consignments/:id/rotate-code  renouveler le code client
//     GET  /api/merchant/consignments/lookup         recherche par code / téléphone / référence
//     GET  /api/merchant/consignment-settings        réglages + types de bouteilles
//     PUT  /api/merchant/consignment-settings        réglages
//     POST /api/merchant/consignment-settings/bottle-types        créer
//     PUT  /api/merchant/consignment-settings/bottle-types/:id    modifier
//
//   Équipe (session gérant/serveuse) : mêmes opérations, restreintes par permissions ET par les
//   réglages de la boutique (une serveuse ne peut pas rembourser si le marchand ne l'a pas autorisé).
//
//   PDG : /api/admin/consignments/* (supervision, réglages globaux, catégories par boutique).
//
// Rien n'est accepté du client : ni storeId, ni merchantId, ni solde. Tout est résolu en base.
// ============================================================================================

module.exports = function consignmentRoutes({ app, store, consign, commerce, team, requireMerchant, requireStaff,
  requirePermission, requireAdmin, checkSameOrigin, apiError }) {

  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const guard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || typeof checkSameOrigin !== 'function') return next();
    return checkSameOrigin(req, res, next);
  };
  function fail(res, error, fallback) {
    const status = Number(error?.status) || (error?.code === 'PG_REQUIRED' ? 409 : 400);
    if (error?.code === 'PG_REQUIRED') return res.status(409).json({ error: error.message, code: 'PG_REQUIRED' });
    if (status >= 500) return apiError(res, error, fallback);
    return res.status(status).json({ error: error.message || fallback, code: error.code || undefined });
  }
  const ipHashOf = (req) => consign.codeOf(`ip:${req.ip || 'unknown'}`).slice(0, 32);

  // La boutique « principale » du marchand (même règle que le reste de l'espace marchand).
  async function primaryStore(merchantId) {
    return commerce.getStoreByMerchantId(merchantId).catch(() => null);
  }

  // ============================================================================ MARCHAND
  app.get('/api/merchant/consignments', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.json({ data: { consignments: [], store: null } });
      const list = await consign.listConsignments({
        storeId: storeRow.id, kind: clean(req.query.kind, 20) || '', status: clean(req.query.status, 20) || '',
        period: clean(req.query.period, 20) || 'all', search: clean(req.query.search, 80),
        staffId: clean(req.query.staffId, 80), limit: Number(req.query.limit) || 100,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { consignments: list, store: { id: storeRow.id, name: storeRow.name }, currency: 'XOF' } });
    } catch (error) { fail(res, error, 'Impossible de charger les consignations.'); }
  });

  app.get('/api/merchant/consignments/stats', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.json({ data: null });
      res.json({ data: await consign.stats({ storeId: storeRow.id, period: clean(req.query.period, 20) || 'all' }) });
    } catch (error) { fail(res, error, 'Impossible de calculer les statistiques de consignation.'); }
  });

  app.get('/api/merchant/consignments/lookup', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const code = clean(req.query.code, 12).toUpperCase();
      const reference = clean(req.query.reference, 40);
      const phone = clean(req.query.phone, 40);
      let found = [];
      if (code) found = [await consign.findByCode({ storeId: storeRow.id, code, ipHash: ipHashOf(req) })];
      else if (reference) {
        const all = await consign.listConsignments({ storeId: storeRow.id, search: reference, limit: 5 });
        found = all.filter((row) => row.reference.toLowerCase() === reference.toLowerCase());
      } else if (phone) found = await consign.listByCustomer({ storeId: storeRow.id, phone, limit: 50 });
      else return res.status(400).json({ error: 'Indiquez un code, une référence ou un téléphone.' });
      res.setHeader('Cache-Control', 'no-store');
      // `data` reste TOUJOURS un tableau : les écrans marchand lisent une liste, l'écran équipe lit
      // le premier élément. Renvoyer tantôt un objet, tantôt un tableau cassait l'un des deux.
      res.json({ data: found.filter(Boolean) });
    } catch (error) { fail(res, error, 'Recherche impossible.'); }
  });

  app.get('/api/merchant/consignments/:id', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const detail = await consign.getDetail(storeRow.id, String(req.params.id));
      if (!detail) return res.status(404).json({ error: 'Consignation introuvable dans votre boutique.' });
      const { rows } = await store.pool.query(
        `SELECT action, actor_label, detail, created_at FROM consignment_events WHERE consignment_id=$1 ORDER BY created_at DESC LIMIT 60`, [detail.id]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { ...detail, events: rows.map((r) => ({ action: r.action, actorLabel: r.actor_label, detail: r.detail, createdAt: r.created_at })) } });
    } catch (error) { fail(res, error, 'Impossible de charger cette consignation.'); }
  });

  app.post('/api/merchant/consignments', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const actor = { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username };
      const result = await consign.createConsignment({
        merchantId: req.merchant.id, storeId: storeRow.id, kind: clean(req.body?.kind, 20), actor,
        customerName: clean(req.body?.customerName, 120), customerPhone: clean(req.body?.customerPhone, 40),
        bottleTypeId: clean(req.body?.bottleTypeId, 80), quantity: req.body?.quantity,
        unitValueXof: req.body?.unitValueXof, amountXof: req.body?.amountXof,
        reason: clean(req.body?.reason, 200), observation: clean(req.body?.observation, 500),
        servicePointId: clean(req.body?.servicePointId, 80), servicePointName: clean(req.body?.servicePointName, 120),
        idempotencyKey: clean(req.body?.idempotencyKey, 80),
      });
      res.status(result.idempotent ? 200 : 201).json({ data: result });
    } catch (error) { fail(res, error, 'Impossible d’enregistrer cette consignation.'); }
  });

  const MOVES = ['return', 'use', 'refund', 'cancel'];
  for (const type of MOVES) {
    app.post(`/api/merchant/consignments/:id/${type}`, requireMerchant, guard, async (req, res) => {
      try {
        const storeRow = await primaryStore(req.merchant.id);
        if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
        const actor = { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username };
        const idempotencyKey = clean(req.body?.idempotencyKey, 80) || `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
        const result = await consign.applyMovement({
          storeId: storeRow.id, consignmentId: String(req.params.id), type,
          quantity: req.body?.quantity, amountXof: req.body?.amountXof,
          idempotencyKey, actor, orderId: clean(req.body?.orderId, 80),
          reason: clean(req.body?.reason, 200), observation: clean(req.body?.observation, 500),
        });
        res.status(result.idempotent ? 200 : 201).json({ data: result });
      } catch (error) { fail(res, error, 'Impossible d’enregistrer ce mouvement.'); }
    });
  }

  app.post('/api/merchant/consignments/:id/rotate-code', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const result = await consign.rotateCode({ storeId: storeRow.id, consignmentId: String(req.params.id),
        actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || req.merchant.username } });
      res.json({ data: result });
    } catch (error) { fail(res, error, 'Impossible de renouveler le code.'); }
  });

  app.get('/api/merchant/consignment-settings', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.json({ data: { settings: null, bottleTypes: [] } });
      const settings = await consign.getSettings(storeRow.id);
      const bottleTypes = await consign.listBottleTypes(storeRow.id, { includeInactive: true });
      res.json({ data: { settings, bottleTypes, store: { id: storeRow.id, name: storeRow.name } } });
    } catch (error) { fail(res, error, 'Impossible de charger les réglages de consignation.'); }
  });

  app.put('/api/merchant/consignment-settings', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const settings = await consign.saveSettings({ merchantId: req.merchant.id, storeId: storeRow.id, patch: req.body || {} });
      await store.addAudit({ actor: req.merchant.displayName || req.merchant.username, actorType: 'merchant', actorId: req.merchant.id,
        managerId: req.merchant.managerId || null, action: 'consignment_settings_updated', entityType: 'store', entityId: storeRow.id,
        summary: 'Réglages de consignation modifiés.', metadata: { settings } }).catch(() => {});
      res.json({ data: settings });
    } catch (error) { fail(res, error, 'Impossible d’enregistrer ces réglages.'); }
  });

  app.post('/api/merchant/consignment-settings/bottle-types', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const row = await consign.saveBottleType({ merchantId: req.merchant.id, storeId: storeRow.id, input: req.body || {} });
      res.status(201).json({ data: row });
    } catch (error) { fail(res, error, 'Impossible de créer ce type de bouteille.'); }
  });

  app.put('/api/merchant/consignment-settings/bottle-types/:id', requireMerchant, guard, async (req, res) => {
    try {
      const storeRow = await primaryStore(req.merchant.id);
      if (!storeRow) return res.status(404).json({ error: 'Aucune boutique rattachée à ce compte.' });
      const row = await consign.saveBottleType({ merchantId: req.merchant.id, storeId: storeRow.id, typeId: String(req.params.id), input: req.body || {} });
      res.json({ data: row });
    } catch (error) { fail(res, error, 'Impossible de modifier ce type de bouteille.'); }
  });

  // ============================================================================ ÉQUIPE (gérant / serveuse)
  if (typeof requireStaff === 'function') {
    async function staffSettings(member) {
      const settings = await consign.getSettings(member.storeId);
      return settings;
    }
    function staffActor(member) {
      return { type: 'staff', id: member.id, label: member.designation || member.fullName || 'Équipe' };
    }

    app.get('/api/staff/consignments', requireStaff, requirePermission('consignment.view'), async (req, res) => {
      try {
        const list = await consign.listConsignments({
          storeId: req.staff.storeId, kind: clean(req.query.kind, 20) || '', status: clean(req.query.status, 20) || '',
          period: clean(req.query.period, 20) || 'all', search: clean(req.query.search, 80), limit: Number(req.query.limit) || 100,
        });
        const stats = await consign.stats({ storeId: req.staff.storeId, period: clean(req.query.period, 20) || 'all' });
        const settings = await staffSettings(req.staff);
        res.setHeader('Cache-Control', 'no-store');
        res.json({ data: { consignments: list, stats, settings: {
          waitressCanCreateBottles: settings.waitress_can_create_bottles, waitressCanCreateMoney: settings.waitress_can_create_money,
          waitressCanReturn: settings.waitress_can_return, waitressCanRefund: settings.waitress_can_refund,
          requirePhoneForMoney: settings.require_phone_for_money }, role: req.staff.role } });
      } catch (error) { fail(res, error, 'Impossible de charger les consignations.'); }
    });

    app.get('/api/staff/consignments/bottle-types', requireStaff, requirePermission('consignment.view'), async (req, res) => {
      try { res.json({ data: await consign.listBottleTypes(req.staff.storeId) }); }
      catch (error) { fail(res, error, 'Impossible de charger les types de bouteilles.'); }
    });

    app.get('/api/staff/consignments/lookup', requireStaff, requirePermission('consignment.view'), async (req, res) => {
      try {
        const code = clean(req.query.code, 12).toUpperCase();
        if (!code) return res.status(400).json({ error: 'Indiquez le code client.' });
        const found = await consign.findByCode({ storeId: req.staff.storeId, code, ipHash: ipHashOf(req) });
        res.setHeader('Cache-Control', 'no-store');
        res.json({ data: found });
      } catch (error) { fail(res, error, 'Recherche impossible.'); }
    });

    app.post('/api/staff/consignments', requireStaff, requirePermission('consignment.create'), async (req, res) => {
      try {
        const settings = await staffSettings(req.staff);
        const kind = clean(req.body?.kind, 20);
        // Les réglages « serveuse » ne s'appliquent qu'aux serveuses : un gérant général tient ses
        // droits de la permission que le marchand lui a accordée (et peut la perdre de la même façon).
        const waitress = req.staff.role === 'waitress';
        if (waitress && kind === 'bottle' && !settings.waitress_can_create_bottles) return res.status(403).json({ error: 'Le marchand n’autorise pas la consignation de bouteilles pour votre fonction.', code: 'CONSIGN_FORBIDDEN' });
        if (waitress && kind === 'money' && !settings.waitress_can_create_money) return res.status(403).json({ error: 'Le marchand n’autorise pas la consignation de monnaie pour votre fonction.', code: 'CONSIGN_FORBIDDEN' });
        if (kind === 'money' && settings.require_phone_for_money && !clean(req.body?.customerPhone, 40)) return res.status(400).json({ error: 'La boutique exige un numéro de téléphone pour une consignation de monnaie.', code: 'PHONE_REQUIRED' });
        const result = await consign.createConsignment({
          merchantId: req.staff.merchantId, storeId: req.staff.storeId, kind, actor: staffActor(req.staff),
          customerName: clean(req.body?.customerName, 120), customerPhone: clean(req.body?.customerPhone, 40),
          bottleTypeId: clean(req.body?.bottleTypeId, 80), quantity: req.body?.quantity, unitValueXof: req.body?.unitValueXof,
          amountXof: req.body?.amountXof, reason: clean(req.body?.reason, 200), observation: clean(req.body?.observation, 500),
          idempotencyKey: clean(req.body?.idempotencyKey, 80),
        });
        res.status(result.idempotent ? 200 : 201).json({ data: result });
      } catch (error) { fail(res, error, 'Impossible d’enregistrer cette consignation.'); }
    });

    // (Pas de contrainte de chemin `:type(...)` : Express 4 la passe à path-to-regexp qui la refuse.)
    app.post('/api/staff/consignments/:id/:type', requireStaff, requirePermission('consignment.create'), async (req, res) => {
      try {
        const type = String(req.params.type);
        if (!['return', 'use', 'refund'].includes(type)) return res.status(404).json({ error: 'Opération inconnue.', code: 'UNKNOWN_OPERATION' });
        const settings = await staffSettings(req.staff);
        // Deux verrous : la permission attribuée par le marchand ET le réglage de la boutique.
        const permissions = Array.isArray(req.staff.permissions) ? req.staff.permissions : [];
        if (!permissions.includes('consignment.return')) return res.status(403).json({ error: 'Votre fonction ne permet pas les retours ni les remboursements.', code: 'PERMISSION_DENIED', permission: 'consignment.return' });
        const waitress = req.staff.role === 'waitress';
        if (waitress && type === 'return' && !settings.waitress_can_return) return res.status(403).json({ error: 'Le marchand n’autorise pas les retours pour votre fonction.', code: 'CONSIGN_FORBIDDEN' });
        if (waitress && (type === 'use' || type === 'refund') && !settings.waitress_can_refund) return res.status(403).json({ error: 'Le marchand n’autorise pas les remboursements pour votre fonction.', code: 'CONSIGN_FORBIDDEN' });
        const result = await consign.applyMovement({
          storeId: req.staff.storeId, consignmentId: String(req.params.id), type,
          quantity: req.body?.quantity, amountXof: req.body?.amountXof,
          idempotencyKey: clean(req.body?.idempotencyKey, 80) || `${type}:${Date.now()}:${Math.random().toString(36).slice(2)}`,
          actor: staffActor(req.staff), orderId: clean(req.body?.orderId, 80),
          reason: clean(req.body?.reason, 200), observation: clean(req.body?.observation, 500),
        });
        res.status(result.idempotent ? 200 : 201).json({ data: result });
      } catch (error) { fail(res, error, 'Impossible d’enregistrer ce mouvement.'); }
    });
  }

  // ============================================================================ PDG
  app.get('/api/admin/consignments/overview', requireAdmin, guard, async (req, res) => {
    try {
      if (!consign.isPg()) return res.status(409).json({ error: 'La supervision des consignations nécessite PostgreSQL.', code: 'PG_REQUIRED' });
      const { rows } = await store.pool.query(
        `SELECT s.id AS "storeId", s.name AS "storeName", a.id AS "merchantId", a.display_name AS "merchantName",
                COUNT(c.id)::int AS "total",
                COUNT(c.id) FILTER (WHERE c.status='open')::int AS "open",
                COALESCE(SUM(c.balance_quantity) FILTER (WHERE c.kind='bottle' AND c.status='open'),0)::bigint AS "bottlesRemaining",
                COALESCE(SUM(c.balance_amount_xof) FILTER (WHERE c.kind='money' AND c.status='open'),0)::bigint AS "moneyRemaining",
                COALESCE(SUM(c.amount_deposited_xof),0)::bigint AS "moneyDeposited",
                COALESCE(SUM(c.amount_refunded_xof),0)::bigint AS "moneyRefunded",
                COUNT(c.id) FILTER (WHERE c.status='settled')::int AS "settled",
                MAX(c.created_at) AS "lastActivityAt",
                a.username AS "merchantUsername"
           FROM merchant_stores s
           JOIN merchant_accounts a ON a.id = s.merchant_id AND a.deleted_at IS NULL
           LEFT JOIN consignments c ON c.store_id = s.id
          GROUP BY s.id, s.name, a.id, a.display_name
          ORDER BY COUNT(c.id) DESC, s.name ASC
          LIMIT 200`);
      const totals = rows.reduce((acc, r) => ({
        total: acc.total + Number(r.total), open: acc.open + Number(r.open),
        bottlesRemaining: acc.bottlesRemaining + Number(r.bottlesRemaining),
        moneyRemaining: acc.moneyRemaining + Number(r.moneyRemaining),
        moneyDeposited: acc.moneyDeposited + Number(r.moneyDeposited),
        moneyRefunded: acc.moneyRefunded + Number(r.moneyRefunded),
        settled: acc.settled + Number(r.settled),
        stores: acc.stores + (Number(r.total) > 0 ? 1 : 0),
        storesTotal: acc.storesTotal + 1,
      }), { total: 0, open: 0, bottlesRemaining: 0, moneyRemaining: 0, moneyDeposited: 0, moneyRefunded: 0, settled: 0, stores: 0, storesTotal: 0 });
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { stores: rows.map((r) => ({ ...r, total: Number(r.total), open: Number(r.open),
        bottlesRemaining: Number(r.bottlesRemaining), moneyRemaining: Number(r.moneyRemaining),
        moneyDeposited: Number(r.moneyDeposited), moneyRefunded: Number(r.moneyRefunded),
        settled: Number(r.settled) })), totals } });
    } catch (error) { fail(res, error, 'Impossible de charger la supervision des consignations.'); }
  });

  // Historique de supervision : deux registres distincts, tous deux non modifiables.
  //  - `consignments` : les fiches créées (filtrables par période, type, recherche) ;
  //  - `movements`    : les opérations sensibles (retours, crédits utilisés, remboursements, annulations).
  app.get('/api/admin/consignments/history', requireAdmin, guard, async (req, res) => {
    try {
      if (!consign.isPg()) return res.status(409).json({ error: 'Nécessite PostgreSQL.', code: 'PG_REQUIRED' });
      const limit = Math.min(300, Number(req.query.limit) || 100);
      const kind = ['bottle', 'money'].includes(clean(req.query.kind, 20)) ? clean(req.query.kind, 20) : '';
      const search = clean(req.query.search, 80);
      const period = clean(req.query.period, 20) || 'all';
      const since = { today: 'CURRENT_DATE', week: "NOW() - INTERVAL '7 days'", month: "NOW() - INTERVAL '30 days'" }[period] || null;
      const where = [];
      const params = [];
      const push = (value) => { params.push(value); return `$${params.length}`; };
      if (kind) where.push(`c.kind = ${push(kind)}`);
      if (since) where.push(`c.created_at >= ${since}`);
      if (search) { const p = push(`%${search.toLowerCase()}%`); where.push(`(LOWER(c.reference) LIKE ${p} OR LOWER(COALESCE(c.customer_name,'')) LIKE ${p} OR COALESCE(c.customer_phone_hash,'') = ${push(search.replace(/\D/g, ''))})`); }
      const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const { rows: consignments } = await store.pool.query(
        `SELECT c.id, c.reference, c.kind, c.status, c.customer_name AS "customerName", c.customer_phone AS "customerPhone",
                c.balance_quantity AS "balanceQuantity", c.balance_amount_xof::bigint AS "balanceAmountXof",
                c.created_at AS "createdAt", c.created_by_label AS "createdByLabel", s.name AS "storeName"
           FROM consignments c JOIN merchant_stores s ON s.id = c.store_id
           ${clause} ORDER BY c.created_at DESC LIMIT ${push(limit)}`, params);
      const { rows: movements } = await store.pool.query(
        `SELECT m.id, m.movement_type AS "type", m.quantity_delta AS "quantity", m.amount_delta_xof::bigint AS "amountXof",
                m.reason, m.created_at AS "createdAt", m.actor_label AS "actorLabel",
                c.reference, c.kind, s.name AS "storeName"
           FROM consignment_movements m
           JOIN consignments c ON c.id = m.consignment_id
           JOIN merchant_stores s ON s.id = c.store_id
          ORDER BY m.created_at DESC LIMIT $1`, [limit]);
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { consignments, movements: movements.map((m) => ({ ...m, amountXof: Number(m.amountXof) })),
        filters: { kind, period, search } } });
    } catch (error) { fail(res, error, 'Impossible de charger l’historique.'); }
  });

  app.get('/api/admin/consignments/bottle-types', requireAdmin, guard, async (req, res) => {
    try {
      if (!consign.isPg()) return res.status(409).json({ error: 'Nécessite PostgreSQL.', code: 'PG_REQUIRED' });
      const { rows } = await store.pool.query(
        `SELECT t.id, t.label, t.reference, t.unit_value_xof AS "unitValueXof", t.active, t.store_id AS "storeId",
                s.name AS "storeName", a.display_name AS "merchantName"
           FROM consign_bottle_types t
           JOIN merchant_stores s ON s.id = t.store_id
           JOIN merchant_accounts a ON a.id = t.merchant_id AND a.deleted_at IS NULL
          ORDER BY s.name, LOWER(t.label) LIMIT 500`);
      res.json({ data: rows.map((r) => ({ ...r, unitValueXof: Number(r.unitValueXof) })) });
    } catch (error) { fail(res, error, 'Impossible de charger les catégories de bouteilles.'); }
  });

  return {};
};
