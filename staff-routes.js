'use strict';

// ============================================================================================
// Routes du personnel marchand : espace gérant général + espace serveuse.
//
// Deux cookies distincts, jamais mélangés avec celui du marchand :
//   qria_staff  → session serveuse / gérant général (jeton opaque, haché en base)
//
// Toute route est protégée par requireStaff + requirePermission. Une permission refusée renvoie
// 403 côté serveur : l'interface n'est qu'un reflet, jamais la sécurité.
//
// Cloisonnement : `req.staff.merchantId` et `req.staff.storeId` proviennent de la base, jamais
// du corps de la requête. Aucune route n'accepte un storeId fourni par le client.
// ============================================================================================

const crypto = require('node:crypto');
const merchantInterface = require('./merchant-interface');

const STAFF_COOKIE = 'qria_staff';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

module.exports = function staffRoutes({ app, store, commerce, team, ops, extras, lifecycle, checkSameOrigin, apiError, sessionSecret = '' }) {
  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const isProduction = process.env.NODE_ENV === 'production';

  // ------------------------------------------------------------------ cookies
  function setStaffCookie(res, token) {
    const secure = isProduction ? '; Secure' : '';
    const previous = res.getHeader('Set-Cookie');
    const list = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
    list.push(`${STAFF_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
    res.setHeader('Set-Cookie', list);
  }
  function clearStaffCookie(res) {
    const secure = isProduction ? '; Secure' : '';
    const previous = res.getHeader('Set-Cookie');
    const list = previous ? (Array.isArray(previous) ? previous : [previous]) : [];
    list.push(`${STAFF_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
    res.setHeader('Set-Cookie', list);
  }
  function readStaffToken(req) {
    const header = String(req.headers.cookie || '');
    for (const part of header.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === STAFF_COOKIE) { try { return decodeURIComponent(rest.join('=')); } catch (_) { return ''; } }
    }
    return '';
  }
  function sameOrigin(req) {
    const origin = req.get('origin');
    if (!origin) return true;
    try { return new URL(origin).host === String(req.get('host') || ''); } catch (_) { return false; }
  }

  // ------------------------------------------------------------------ garde commune
  async function requireStaff(req, res, next) {
    const token = readStaffToken(req);
    if (!token) return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.', code: 'STAFF_AUTH_REQUIRED' });
    // Refus si un cookie d'un autre rôle coexiste : jamais deux identités dans le même navigateur.
    const otherCookies = ['qria_merchant', 'qria_admin', 'qria_manager', 'qria_supplier']
      .filter((name) => new RegExp(`(^|;)\\s*${name}=`).test(String(req.headers.cookie || '')));
    if (otherCookies.length) {
      clearStaffCookie(res);
      return res.status(401).json({ error: 'Sessions de rôles différentes détectées. Reconnectez-vous.', code: 'ROLE_CONFLICT' });
    }
    const member = await team.resolveSession(token).catch(() => null);
    if (!member) {
      clearStaffCookie(res);
      return res.status(401).json({ error: 'Votre accès a été révoqué, bloqué ou a expiré. Reconnectez-vous.', code: 'STAFF_SESSION_INVALID' });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOrigin(req)) {
      return res.status(403).json({ error: 'Origine de requête non autorisée.' });
    }
    req.staff = member;
    next();
  }

  function requirePermission(permission) {
    return (req, res, next) => {
      const permissions = Array.isArray(req.staff?.permissions) ? req.staff.permissions : [];
      if (!permissions.includes(permission)) {
        team.recordActivity(req.staff.merchantId, req.staff.storeId, req.staff.id, 'permission_denied',
          `Accès refusé : ${permission}.`, 'denied', { permission, path: req.path }).catch(() => {});
        return res.status(403).json({ error: 'Votre fonction ne permet pas cette action.', code: 'PERMISSION_DENIED', permission });
      }
      next();
    };
  }

  // ------------------------------------------------------------------ activation (public)
  app.post('/api/staff/activate', async (req, res) => {
    try {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Origine de requête non autorisée.' });
      const member = await team.activate(req.body?.code, { password: req.body?.password });
      const session = await team.createSession(member);
      setStaffCookie(res, session.token);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(201).json({ data: { session: staffSessionPayload(member), expiresAt: session.expiresAt } });
    } catch (error) {
      return fail(res, error, 'Impossible d’activer ce compte.');
    }
  });

  app.post('/api/staff/auth/login', async (req, res) => {
    try {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Origine de requête non autorisée.' });
      const username = clean(req.body?.username, 80);
      const password = String(req.body?.password || '');
      if (!username || !password) return res.status(400).json({ error: 'Indiquez votre identifiant et votre mot de passe.' });
      const result = await team.authenticate(username, password);
      if (result.error) {
        team.recordActivity('', '', null, 'login_failure', `Échec de connexion pour « ${username} ».`, 'failure').catch(() => {});
        return res.status(result.code ? 403 : 401).json({ error: result.error, code: result.code || 'STAFF_LOGIN_FAILED' });
      }
      const session = await team.createSession(result.member);
      setStaffCookie(res, session.token);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { session: staffSessionPayload(result.member), expiresAt: session.expiresAt } });
    } catch (error) {
      return fail(res, error, 'Connexion impossible pour le moment.');
    }
  });

  app.post('/api/staff/auth/logout', async (req, res) => {
    const token = readStaffToken(req);
    if (token) { const member = await team.resolveSession(token).catch(() => null); if (member) await team.revokeSessions(member.id).catch(() => {}); }
    clearStaffCookie(res);
    res.status(204).end();
  });

  // ------------------------------------------------------------------ session courante
  app.get('/api/staff/me', requireStaff, async (req, res) => {
    const shop = await shopContext(req.staff);
    res.setHeader('Cache-Control', 'no-store');
    // Mission 10 : tailles de texte décidées par le PDG pour cet établissement (lecture seule).
    let interfaceSizes = merchantInterface.defaultSizes();
    try {
      const settings = await store.getSettings();
      interfaceSizes = merchantInterface.resolveSettings(settings?.merchantInterface || {}, req.staff.storeId || shop?.id || '').sizes;
    } catch (_) { interfaceSizes = merchantInterface.defaultSizes(); }
    return res.json({ data: { session: staffSessionPayload(req.staff), shop, settings: await staffSettings(req.staff), interfaceSizes } });
  });

  app.post('/api/staff/auth/change-password', requireStaff, async (req, res) => {
    try {
      const current = String(req.body?.currentPassword || '');
      const next = String(req.body?.newPassword || '');
      if (next.length < 8) return res.status(400).json({ error: 'Choisissez un mot de passe de 8 caractères minimum.' });
      const check = await team.authenticate(req.staff.username, current);
      if (check.error) return res.status(403).json({ error: 'Le mot de passe actuel est incorrect.' });
      await team.resetPassword(req.staff.id, req.staff.merchantId, next);
      clearStaffCookie(res);
      return res.json({ data: { ok: true }, notice: 'Mot de passe modifié. Reconnectez-vous.' });
    } catch (error) {
      return fail(res, error, 'Impossible de modifier le mot de passe.');
    }
  });

  // ------------------------------------------------------------------ contexte boutique
  app.get('/api/staff/dashboard', requireStaff, async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable. Contactez votre marchand.' });
      const can = (p) => (req.staff.permissions || []).includes(p);
      const data = { shop, session: staffSessionPayload(req.staff), settings: await staffSettings(req.staff), points: Number(req.staff.points) || 0 };
      if (can('tasks.view_all') || req.staff.role === 'waitress') {
        data.tasks = await team.listTasks(req.staff.merchantId, { memberId: req.staff.role === 'waitress' ? req.staff.id : '' });
      }
      if (can('stats.view')) data.stats = await commerce.stats(req.staff.merchantId).catch(() => null);
      if (can('orders.view')) data.recentOrders = await recentOrders(req.staff, 10);
      if (can('activity.view')) data.activity = await team.listActivity(req.staff.merchantId, { limit: 20 });
      if (can('points.view')) data.teamPoints = (await team.listMembers(req.staff.merchantId)).map((m) => ({ id: m.id, designation: m.designation, role: m.role, points: m.points, openTasks: m.openTasks }));
      data.permissions = req.staff.permissions;
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data });
    } catch (error) { return fail(res, error, 'Impossible de charger votre espace.'); }
  });

  // ------------------------------------------------------------------ commandes
  app.get('/api/staff/orders', requireStaff, requirePermission('orders.view'), async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
      const mine = req.query.mine === '1';
      const rows = await recentOrders(req.staff, limit, mine);
      return res.json({ data: rows });
    } catch (error) { return fail(res, error, 'Impossible de charger les commandes.'); }
  });

  app.get('/api/staff/orders/:orderId', requireStaff, requirePermission('orders.view'), async (req, res) => {
    try {
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.staff.merchantId || order.storeId !== req.staff.storeId) {
        return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { order, customLines: await customLines(order.id) } });
    } catch (error) { return fail(res, error, 'Impossible de charger cette commande.'); }
  });

  // Scan : uniquement les QR de la boutique du membre. Le code QR est vérifié, pas seulement l'URL.
  app.post('/api/staff/scan', requireStaff, requirePermission('scans.use'), async (req, res) => {
    try {
      const raw = clean(req.body?.code, 2000);
      if (!raw) return res.status(400).json({ error: 'Aucun QR détecté. Rapprochez le code et réessayez.' });
      let value = raw;
      try { const url = new URL(raw); value = `${url.pathname}${url.search}`; } catch (_) { value = raw; }
      const table = /^\/t\/([^/?#]+)/.exec(value);
      const storeQr = /^\/s\/([^/?#]+)/.exec(value);
      const bare = !table && !storeQr && /^[A-Za-z0-9_-]{6,60}$/.test(value) ? value : '';
      if (!table && !storeQr && !bare) return res.status(400).json({ error: 'Ce QR ne correspond pas à une table, un emplacement ou une boutique Oymike.' });
      const scannedCode = decodeURIComponent(table?.[1] || storeQr?.[1] || bare);
      const point = table || bare ? await extras.getPublicServicePointByCode(scannedCode) : null;
      const scannedStore = storeQr ? await commerce.getPublicShopByQr(scannedCode) : null;
      if (!point && !scannedStore) return res.status(404).json({ error: 'Ce QR est inactif, désactivé ou n’existe plus.', code: 'QR_INVALID' });
      const ownerMerchantId = point?.merchantId || scannedStore?.merchantId || '';
      if (ownerMerchantId !== req.staff.merchantId) {
        await team.recordActivity(req.staff.merchantId, req.staff.storeId, req.staff.id, 'scan_refused',
          'Scan refusé : QR d’une autre boutique.', 'denied', { scannedCode: String(scannedCode).slice(0, 60) });
        return res.status(403).json({ error: 'Ce QR appartient à une autre boutique. Utilisez uniquement les QR de votre établissement.', code: 'QR_OTHER_STORE' });
      }
      const pointStoreId = point?.storeId || '';
      if (pointStoreId && pointStoreId !== req.staff.storeId) {
        return res.status(403).json({ error: 'Ce QR n’appartient pas à votre boutique.', code: 'QR_OTHER_STORE' });
      }
      const shop = await shopContext(req.staff);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable.' });
      const event = await lifecycle.recordScanEvent({ storeId: shop.id, merchantId: req.staff.merchantId,
        qrKind: point ? 'service_point' : 'store', servicePointId: point?.id || '', qrCode: scannedCode, category: 'staff',
        actorId: req.staff.id, channel: 'staff_scanner',
        eventKey: `staff:${req.staff.id}:${clean(req.body?.eventId, 80) || Date.now()}`,
        userAgentClass: /Mobi|Android|iPhone|iPad/i.test(String(req.get('user-agent') || '')) ? 'mobile' : 'desktop' }).catch(() => null);
      // Traçabilité du membre auteur du scan (colonne ajoutée par la migration Mission 5).
      if (event?.id && team.pg) await team.base.pool.query('UPDATE merchant_scan_events SET member_id=$2 WHERE id=$1', [event.id, req.staff.id]).catch(() => {});
      if (event?.id && !event.duplicate) {
        await creditPoints(req.staff, shop, { action: 'scan', sourceKey: `scan:${event.id}`, reason: point ? `Scan ${point.name}` : 'Scan boutique' });
      }
      await team.recordActivity(req.staff.merchantId, shop.id, req.staff.id, 'scan_success',
        point ? `Table scannée : ${point.name}.` : 'QR de boutique scanné.', 'success', { servicePointId: point?.id || '' });
      const points = point ? [] : await extras.listServicePoints(shop.id);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { kind: point ? (point.type === 'table' ? 'table' : 'location') : 'store',
        store: { id: shop.id, name: shop.name, slug: shop.slug },
        servicePoint: point ? { id: point.id, type: point.type, name: point.name, zone: point.zone, publicCode: point.publicCode } : null,
        scanEventId: event && !event.duplicate ? event.id : '', duplicate: Boolean(event?.duplicate),
        points: points.map((row) => ({ id: row.id, type: row.type, name: row.name, zone: row.zone, publicCode: row.publicCode })) } });
    } catch (error) { return fail(res, error, 'Impossible de lire ce QR.'); }
  });

  // Prise de commande manuelle : articles du catalogue OU lignes libres. Aucune ligne libre n'est
  // ajoutée au catalogue ; elle est stockée sur la commande uniquement.
  app.post('/api/staff/orders', requireStaff, requirePermission('orders.create'), async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      if (!shop || shop.status !== 'active') return res.status(409).json({ error: 'Boutique inactive.' });
      const settings = await staffSettings(req.staff);
      const body = req.body || {};
      const requestId = clean(body.requestId, 100);
      if (!REQUEST_ID_RE.test(requestId)) return res.status(400).json({ error: 'Identifiant de commande invalide. Actualisez la fiche et réessayez.' });

      const customerName = clean(body.customerName, 120) || 'Client sur place';
      const customerPhone = clean(body.customerPhone, 32);
      const note = clean(body.note, 500);
      const orderType = ['dine_in', 'pickup', 'delivery', 'other'].includes(body.orderType) ? body.orderType : 'dine_in';
      const paymentMethod = ['not_recorded', 'cash', 'mobile_money', 'bank_transfer', 'card', 'other'].includes(body.paymentMethod) ? body.paymentMethod : 'not_recorded';
      const servicePoints = await extras.listServicePoints(shop.id);
      const servicePointId = clean(body.servicePointId, 100);
      const servicePoint = servicePointId ? servicePoints.find((p) => p.id === servicePointId && p.status === 'active') : null;
      if (servicePointId && !servicePoint) return res.status(400).json({ error: 'Cette table n’est pas active dans cette boutique.' });

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (!rawItems.length || rawItems.length > 20) return res.status(400).json({ error: 'Ajoutez entre 1 et 20 articles.' });
      const catalogItems = [];
      const customItems = [];
      for (const item of rawItems) {
        const quantity = Number(item.quantity);
        if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) return res.status(400).json({ error: 'Quantité invalide.' });
        if (item.custom === true || item.productId === '__custom__') {
          if (!(req.staff.permissions || []).includes('orders.free_price')) return res.status(403).json({ error: 'Votre fonction ne permet pas de saisir un article libre.', code: 'PERMISSION_DENIED' });
          if (settings.allowFreePrice === false) return res.status(403).json({ error: 'La saisie d’articles hors catalogue est désactivée par le marchand.', code: 'FREE_PRICE_DISABLED' });
          const name = clean(item.name, 120) || 'Article saisi manuellement';
          const unitPrice = Number(item.unitPriceXof);
          if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) return res.status(400).json({ error: 'Indiquez un prix entier en XOF pour l’article libre.' });
          if (unitPrice > Number(settings.freePriceMaxXof || 0)) return res.status(400).json({ error: `Le prix d’un article libre ne peut pas dépasser ${Number(settings.freePriceMaxXof).toLocaleString('fr-FR')} XOF.`, code: 'FREE_PRICE_TOO_HIGH' });
          customItems.push({ name, quantity, unitPriceXof: unitPrice, note: clean(item.note, 200) });
        } else {
          const productId = clean(item.productId, 80);
          if (!productId) return res.status(400).json({ error: 'Article invalide.' });
          const existing = catalogItems.find((x) => x.productId === productId);
          if (existing) existing.quantity += quantity; else catalogItems.push({ productId, quantity });
        }
      }
      const customTotal = customItems.reduce((sum, item) => sum + item.quantity * item.unitPriceXof, 0);
      if (customTotal > 2_000_000_000) return res.status(400).json({ error: 'Le total de la commande dépasse le montant autorisé.' });

      const discountAmountXof = body.discountAmountXof === '' || body.discountAmountXof == null ? 0 : Number(body.discountAmountXof);
      if (!Number.isSafeInteger(discountAmountXof) || discountAmountXof < 0) return res.status(400).json({ error: 'Remise invalide.' });
      if (discountAmountXof > 0 && !(req.staff.permissions || []).includes('orders.discount')) {
        return res.status(403).json({ error: 'Votre fonction ne permet pas d’accorder une remise.', code: 'PERMISSION_DENIED' });
      }

      const deliveryAddress = orderType === 'dine_in'
        ? (servicePoint ? `${servicePoint.name}${servicePoint.zone ? ` · ${servicePoint.zone}` : ''}` : 'Sur place')
        : (orderType === 'pickup' ? 'Retrait à la boutique' : clean(body.deliveryAddress, 500) || 'Sur place');

      // Plafond de remise vérifié AVANT toute écriture : jamais de commande créée puis annulée.
      if (catalogItems.length) {
        const catalog = await commerce.listProducts(shop.id, { activeOnly: true });
        const byId = new Map(catalog.map((p) => [p.id, p]));
        const missing = catalogItems.find((line) => !byId.has(line.productId));
        if (missing) return res.status(400).json({ error: 'Un article a été retiré ou n’est plus disponible. Actualisez le catalogue.' });
        const catalogTotal = catalogItems.reduce((sum, line) => sum + line.quantity * Number(byId.get(line.productId).priceXof || 0), 0);
        const subtotal = catalogTotal + customTotal;
        if (discountAmountXof > subtotal) return res.status(400).json({ error: 'La remise ne peut pas dépasser le sous-total.' });
        const maxPercent = Number(settings.waitressMaxDiscountPercent || 0);
        const ceiling = Math.floor(subtotal * maxPercent / 100);
        const isManagerWithDiscount = req.staff.role === 'general_manager' && (req.staff.permissions || []).includes('orders.discount');
        if (discountAmountXof > ceiling && !isManagerWithDiscount) {
          return res.status(403).json({ error: `La remise dépasse le plafond autorisé par le marchand (${maxPercent} %).`, code: 'DISCOUNT_TOO_HIGH', ceiling });
        }
      } else if (discountAmountXof > 0) {
        const maxPercent = Number(settings.waitressMaxDiscountPercent || 0);
        const ceiling = Math.floor(customTotal * maxPercent / 100);
        const isManagerWithDiscount = req.staff.role === 'general_manager' && (req.staff.permissions || []).includes('orders.discount');
        if (discountAmountXof > ceiling && !isManagerWithDiscount) {
          return res.status(403).json({ error: `La remise dépasse le plafond autorisé par le marchand (${maxPercent} %).`, code: 'DISCOUNT_TOO_HIGH', ceiling });
        }
      }

      // Une commande composée UNIQUEMENT d'articles libres ne passe pas par le catalogue :
      // elle est enregistrée directement avec ses lignes, jamais transformée en produit.
      if (catalogItems.length) {
        const result = await commerce.createOrder({
          storeId: shop.id, merchantId: req.staff.merchantId, clientRequestId: requestId,
          source: req.staff.role === 'general_manager' ? 'manager_assisted' : 'staff_assisted',
          createdById: req.staff.id, orderType, paymentMethod, discountAmountXof, customerName, customerPhone,
          deliveryAddress, note, items: catalogItems, servicePointId: servicePoint?.id || '',
          occupiedPointConfirmed: body.confirmOccupiedPoint === true,
          scannedQrCode: clean(body.scannedQrCode, 120), scannedVia: clean(body.scannedVia, 20) || 'manual',
          scanEventId: clean(body.scanEventId, 100),
          trackingTokenHash: crypto.createHash('sha256').update(`${shop.id}:${requestId}`).digest('hex'),
          customerContactStatus: customerPhone ? 'provided' : 'not_available',
        });
        if (result.idempotent) return res.json({ data: { order: await staffOrderView(result.order.id, req.staff), idempotent: true } });
        const order = result.order;
        if (customItems.length) await insertCustomLines(shop, req.staff, order.id, customItems);
        await afterOrderCreated(req.staff, shop, order, { customItems, settings });
        res.setHeader('Cache-Control', 'no-store');
        return res.status(201).json({ data: { order: await staffOrderView(order.id, req.staff), idempotent: false } });
      }

      // Commande 100 % libre : mêmes tables, source « staff_assisted », aucune fiche produit créée.
      const order = await createManualOnlyOrder(req.staff, shop, { requestId, customerName, customerPhone, note, orderType,
        paymentMethod, deliveryAddress, servicePoint, customItems, discountAmountXof, settings, body });
      await afterOrderCreated(req.staff, shop, order, { customItems, settings });
      res.setHeader('Cache-Control', 'no-store');
      return res.status(201).json({ data: { order: await staffOrderView(order.id, req.staff), idempotent: false } });
    } catch (error) {
      console.error('[staff-orders]', error.code || '', error.message);
      if (error.code === 'PERMISSION_DENIED') return res.status(403).json({ error: error.message, code: error.code });
      if (error.code === 'OCCUPIED_SERVICE_POINT') return res.status(409).json({ error: error.message, code: error.code, activeOrderCount: error.activeOrderCount });
      if (error.code === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: error.message, code: error.code });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      return fail(res, error, 'Impossible d’enregistrer cette commande.');
    }
  });

  // Changement d'état d'une commande par le personnel (jamais au-delà de ses droits).
  app.post('/api/staff/orders/:orderId/status', requireStaff, requirePermission('orders.update'), async (req, res) => {
    try {
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.staff.merchantId || order.storeId !== req.staff.storeId) return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      const status = clean(req.body?.status, 20);
      if (!['confirmed', 'preparing', 'ready', 'completed'].includes(status)) return res.status(400).json({ error: 'État de commande invalide.' });
      const updated = await commerce.setOrderStatus(order.id, status, { actorType: req.staff.role, actorId: req.staff.id, note: clean(req.body?.note, 200) });
      await team.recordActivity(req.staff.merchantId, req.staff.storeId, req.staff.id, 'order_status',
        `Commande ${order.reference} → ${status}.`, 'success', { orderId: order.id });
      if (status === 'completed') {
        // Règle explicite seulement : la serveuse responsable de la commande est créditée si le
        // marchand a activé « créditer la serveuse affectée ». Sinon, seule l'auteure est créditée.
        const settings = await ops.getPointSettings(req.staff.merchantId);
        const target = settings.creditAssignedServer && updated?.assignedMemberId ? updated.assignedMemberId : req.staff.id;
        await creditPoints(req.staff, shop, { action: 'order_completed', sourceKey: `order:${order.id}:completed`,
          reason: `Commande ${order.reference} terminée`, memberId: target });
      }
      return res.json({ data: { order: updated } });
    } catch (error) { return fail(res, error, 'Impossible de changer l’état de cette commande.'); }
  });

  app.post('/api/staff/orders/:orderId/cancel', requireStaff, requirePermission('orders.cancel'), async (req, res) => {
    try {
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.staff.merchantId || order.storeId !== req.staff.storeId) return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      const reason = clean(req.body?.reason, 200);
      if (reason.length < 3) return res.status(400).json({ error: 'Indiquez le motif d’annulation.' });
      const updated = await commerce.setOrderStatus(order.id, 'cancelled', { actorType: req.staff.role, actorId: req.staff.id, note: reason });
      await team.recordActivity(req.staff.merchantId, req.staff.storeId, req.staff.id, 'order_cancelled',
        `Commande ${order.reference} annulée : ${reason}.`, 'success', { orderId: order.id });
      return res.json({ data: { order: updated } });
    } catch (error) { return fail(res, error, 'Impossible d’annuler cette commande.'); }
  });

  // ------------------------------------------------------------------ produits et disponibilités
  app.get('/api/staff/products', requireStaff, requirePermission('products.view'), async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable.' });
      const rows = await commerce.listProducts(shop.id, { activeOnly: false });
      // La serveuse n'a pas le droit de voir les prix d'achat : seuls les champs de vente sortent.
      const canPrice = (req.staff.permissions || []).includes('products.price');
      return res.json({ data: rows.map((p) => ({ id: p.id, name: p.name, sku: p.sku, category: p.category, status: p.status,
        available: p.available, stockQuantity: p.stockQuantity, trackStock: p.trackStock, imageData: p.imageData,
        volumeLabel: p.volumeLabel, unit: p.unit, priceXof: canPrice || (req.staff.permissions || []).includes('orders.create') ? p.priceXof : null })) });
    } catch (error) { return fail(res, error, 'Impossible de charger les produits.'); }
  });

  app.post('/api/staff/products/:productId/availability', requireStaff, requirePermission('products.availability'), async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      const product = await commerce.getProduct(String(req.params.productId)).catch(() => null);
      if (!product || product.storeId !== shop.id) return res.status(404).json({ error: 'Produit introuvable dans votre boutique.' });
      const status = req.body?.available === false ? 'inactive' : 'active';
      const updated = await commerce.saveProduct(shop.id, { ...product, status }, product.id);
      await team.recordActivity(req.staff.merchantId, shop.id, req.staff.id, 'product_availability',
        `${product.name} : ${status === 'active' ? 'disponible' : 'indisponible'}.`, 'success', { productId: product.id });
      return res.json({ data: { product: updated } });
    } catch (error) { return fail(res, error, 'Impossible de changer la disponibilité.'); }
  });

  app.post('/api/staff/products/:productId/price', requireStaff, requirePermission('products.price'), async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      const product = await commerce.getProduct(String(req.params.productId)).catch(() => null);
      if (!product || product.storeId !== shop.id) return res.status(404).json({ error: 'Produit introuvable dans votre boutique.' });
      const price = Number(req.body?.priceXof);
      if (!Number.isSafeInteger(price) || price < 0) return res.status(400).json({ error: 'Prix invalide.' });
      const updated = await commerce.saveProduct(shop.id, { ...product, priceXof: price }, product.id);
      await team.recordActivity(req.staff.merchantId, shop.id, req.staff.id, 'product_price',
        `Prix de ${product.name} : ${price} XOF.`, 'success', { productId: product.id, from: product.priceXof, to: price });
      return res.json({ data: { product: updated } });
    } catch (error) { return fail(res, error, 'Impossible de changer le prix.'); }
  });

  // ------------------------------------------------------------------ tâches
  app.get('/api/staff/tasks', requireStaff, async (req, res) => {
    try {
      const memberId = req.staff.role === 'waitress' ? req.staff.id : clean(req.query.memberId, 60);
      const rows = await team.listTasks(req.staff.merchantId, { memberId, status: clean(req.query.status, 20) });
      return res.json({ data: rows });
    } catch (error) { return fail(res, error, 'Impossible de charger les tâches.'); }
  });

  app.post('/api/staff/tasks', requireStaff, requirePermission('tasks.assign'), async (req, res) => {
    try {
      const memberId = clean(req.body?.memberId, 60);
      if (!memberId) return res.status(400).json({ error: 'Choisissez le membre à qui attribuer la tâche.' });
      const target = await team.getMember(memberId, req.staff.merchantId);
      if (!target) return res.status(403).json({ error: 'Ce membre n’appartient pas à votre équipe.' });
      const shop = await shopContext(req.staff);
      const task = await team.createTask(req.staff.merchantId, shop.id, { ...req.body, memberId },
        { type: req.staff.role, id: req.staff.id, label: req.staff.designation || req.staff.fullName });
      await notifyMember(req.staff.merchantId, memberId, 'Nouvelle tâche', task.title).catch(() => {});
      return res.status(201).json({ data: { task } });
    } catch (error) { return fail(res, error, 'Impossible de créer cette tâche.'); }
  });

  app.post('/api/staff/tasks/:taskId/status', requireStaff, async (req, res) => {
    try {
      const task = await team.getTask(String(req.params.taskId), req.staff.merchantId);
      if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
      // Une serveuse ne peut changer que l'état de SES tâches ; un gérant avec tasks.assign, toutes.
      const canAssign = (req.staff.permissions || []).includes('tasks.assign');
      if (!canAssign && task.memberId !== req.staff.id) return res.status(403).json({ error: 'Cette tâche n’est pas la vôtre.', code: 'PERMISSION_DENIED' });
      const newStatus = clean(req.body?.status, 20);
      const updated = await team.updateTaskStatus(task.id, req.staff.merchantId, newStatus,
        { type: req.staff.role, id: req.staff.id, label: req.staff.designation || req.staff.fullName }, clean(req.body?.note, 200));
      // Points de tâche validée : une seule fois par tâche, même si l'état est renvoyé deux fois.
      if (newStatus === 'done' && task.status !== 'done') {
        const shop = await shopContext(req.staff);
        await creditPoints(req.staff, shop, { action: 'task', sourceKey: `task:${task.id}`,
          reason: `Tâche terminée : ${task.title}`, memberId: task.memberId || req.staff.id });
      }
      return res.json({ data: { task: updated } });
    } catch (error) { return fail(res, error, 'Impossible de mettre à jour cette tâche.'); }
  });

  app.get('/api/staff/tasks/:taskId/history', requireStaff, async (req, res) => {
    try {
      const task = await team.getTask(String(req.params.taskId), req.staff.merchantId);
      if (!task) return res.status(404).json({ error: 'Tâche introuvable.' });
      const canAssign = (req.staff.permissions || []).includes('tasks.assign');
      if (!canAssign && task.memberId !== req.staff.id) return res.status(403).json({ error: 'Cette tâche n’est pas la vôtre.' });
      return res.json({ data: { task, events: await team.listTaskEvents(task.id, req.staff.merchantId) } });
    } catch (error) { return fail(res, error, 'Impossible de charger l’historique.'); }
  });

  // ------------------------------------------------------------------ notifications et points
  // Notifications persistantes (team_notifications) : elles survivent au redémarrage du serveur et
  // ne sont jamais dupliquées (clé de dédoublonnage en base). Les tâches restent visibles à part.
  app.get('/api/staff/notifications', requireStaff, async (req, res) => {
    try {
      const settings = await staffSettings(req.staff);
      const tasks = await team.listTasks(req.staff.merchantId, { memberId: req.staff.id });
      const [items, unread] = await Promise.all([
        ops.listNotifications(req.staff.id, { limit: 50, unreadOnly: req.query.unread === '1' }),
        ops.unreadCount(req.staff.id),
      ]);
      return res.json({ data: { items, unread, teamBlocked: settings.teamBlocked === true,
        taskItems: tasks.slice(0, 20).map((t) => ({ type: 'task', id: t.id, title: t.title, status: t.status,
          dueAt: t.dueAt, priority: t.priority, createdAt: t.createdAt })) } });
    } catch (error) { return fail(res, error, 'Impossible de charger les notifications.'); }
  });

  app.post('/api/staff/notifications/read', requireStaff, async (req, res) => {
    try {
      const unread = await ops.markNotificationsRead(req.staff.id, clean(req.body?.id, 60));
      return res.json({ data: { unread } });
    } catch (error) { return fail(res, error, 'Impossible de marquer ces notifications comme lues.'); }
  });

  // Compteur de non-lus : léger, appelé par le bandeau de l'espace équipe.
  app.get('/api/staff/notifications/count', requireStaff, async (req, res) => {
    try { return res.json({ data: { unread: await ops.unreadCount(req.staff.id) } }); }
    catch (error) { return fail(res, error, 'Compteur indisponible.'); }
  });

  // ------------------------------------------------------------------ points et classement côté serveuse
  app.get('/api/staff/points/history', requireStaff, async (req, res) => {
    try {
      const canSeeAll = (req.staff.permissions || []).includes('points.view');
      const memberId = req.query.memberId && canSeeAll ? String(req.query.memberId) : req.staff.id;
      if (!canSeeAll && req.query.memberId && String(req.query.memberId) !== req.staff.id) {
        return res.status(403).json({ error: 'Vous ne pouvez consulter que vos propres points.', code: 'PERMISSION_DENIED' });
      }
      const [history, period, settings] = await Promise.all([
        ops.pointsHistory(req.staff.merchantId, { memberId, limit: Number(req.query.limit) || 60 }),
        ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'month',
        ops.getPointSettings(req.staff.merchantId),
      ]);
      const stats = await ops.memberStats(req.staff.merchantId, memberId, { period });
      return res.json({ data: { memberId, history, stats, settings,
        canSeeAll, note: 'Vos points sont calculés automatiquement : scan, commande enregistrée, commande terminée et tâche validée.' } });
    } catch (error) { console.error('[staff-points]', error.message); return fail(res, error, 'Impossible de charger l’historique des points.'); }
  });

  // Classement « Performance de l'équipe ». Une serveuse voit sa position ; sans la permission
  // points.view, elle ne voit que sa propre ligne.
  app.get('/api/staff/leaderboard', requireStaff, async (req, res) => {
    try {
      const period = ['today', 'week', 'month'].includes(req.query.period) ? req.query.period : 'week';
      const board = await ops.leaderboard(req.staff.merchantId, { period });
      const canSeeAll = (req.staff.permissions || []).includes('points.view');
      const rows = canSeeAll ? board.rows : board.rows.filter((row) => row.id === req.staff.id);
      return res.json({ data: { period, canSeeAll, rows,
        myPosition: board.rows.find((row) => row.id === req.staff.id)?.rank || null, teamSize: board.rows.length,
        wording: 'Classement d’activité : il reflète le travail réalisé sur la période, pas la valeur des personnes.' } });
    } catch (error) { return fail(res, error, 'Impossible de charger le classement.'); }
  });

  // ------------------------------------------------------------------ tables et emplacements
  app.get('/api/staff/tables', requireStaff, requirePermission('tables.view_all'), async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable.' });
      const [points, assignments, usage] = await Promise.all([
        extras.listServicePoints(shop.id), ops.listServicePointAssignments(shop.id), commerce.getServicePointUsage(shop.id).catch(() => []),
      ]);
      const assignedByPoint = new Map((assignments || []).map((a) => [a.servicePointId, a]));
      const usageMap = new Map((usage || []).map((u) => [u.servicePointId, Number(u.activeOrderCount) || 0]));
      return res.json({ data: { tables: (points || []).map((point) => ({
        id: point.id, name: point.name, zone: point.zone, type: point.type, status: point.status, publicCode: point.publicCode,
        occupied: (usageMap.get(point.id) || 0) > 0, activeOrders: usageMap.get(point.id) || 0,
        assignedTo: assignedByPoint.get(point.id) ? { memberId: assignedByPoint.get(point.id).memberId, designation: assignedByPoint.get(point.id).designation || '' } : null,
        mine: assignedByPoint.get(point.id)?.memberId === req.staff.id,
      })) } });
    } catch (error) { return fail(res, error, 'Impossible de charger les tables.'); }
  });

  app.post('/api/staff/tables/:pointId/assign', requireStaff, requirePermission('tables.assign'), async (req, res) => {
    try {
      const shop = await shopContext(req.staff);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable.' });
      const result = await ops.assignServicePoint({ merchantId: req.staff.merchantId, storeId: shop.id,
        servicePointId: String(req.params.pointId), memberId: clean(req.body?.memberId, 60),
        actor: { type: req.staff.role, id: req.staff.id, label: req.staff.designation || req.staff.fullName } });
      return res.json({ data: result });
    } catch (error) { return fail(res, error, 'Impossible d’affecter cette table.'); }
  });

  // ------------------------------------------------------------------ affectation des commandes
  app.post('/api/staff/orders/:orderId/assign', requireStaff, async (req, res) => {
    try {
      const canAssign = (req.staff.permissions || []).includes('tasks.assign');
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.staff.merchantId || order.storeId !== req.staff.storeId) {
        return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      }
      const memberId = clean(req.body?.memberId, 60);
      // Une serveuse ne peut prendre que pour elle-même ; un gérant autorisé peut transférer.
      if (!canAssign && memberId !== req.staff.id) return res.status(403).json({ error: 'Vous ne pouvez affecter une commande qu’à vous-même.', code: 'PERMISSION_DENIED' });
      const result = await ops.assignOrder({ merchantId: req.staff.merchantId, storeId: req.staff.storeId, orderId: order.id,
        memberId, reason: clean(req.body?.reason, 200),
        actor: { type: req.staff.role, id: req.staff.id, label: req.staff.designation || req.staff.fullName } });
      return res.json({ data: { order: await commerce.getOrder(order.id), assignment: result } });
    } catch (error) { return fail(res, error, 'Impossible d’affecter cette commande.'); }
  });

  app.get('/api/staff/orders/:orderId/tracking', requireStaff, requirePermission('orders.view'), async (req, res) => {
    try {
      const order = await commerce.getOrder(String(req.params.orderId)).catch(() => null);
      if (!order || order.merchantId !== req.staff.merchantId || order.storeId !== req.staff.storeId) {
        return res.status(404).json({ error: 'Commande introuvable dans votre boutique.' });
      }
      return res.json({ data: { order, assignments: await ops.assignmentHistory(order.id, req.staff.merchantId) } });
    } catch (error) { return fail(res, error, 'Impossible de charger cette commande.'); }
  });

  // ------------------------------------------------------------------ tableau de bord du gérant général
  // Les chiffres viennent des mêmes requêtes que la vue marchand : le gérant ne voit jamais
  // au-delà des permissions que le marchand lui a accordées.
  app.get('/api/staff/manager-dashboard', requireStaff, async (req, res) => {
    try {
      if (req.staff.role !== 'general_manager') {
        return res.status(403).json({ error: 'Ce tableau de bord est réservé au gérant général.', code: 'PERMISSION_DENIED' });
      }
      if (!team.pg) return res.status(409).json({ error: 'Ce tableau de bord nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const shop = await shopContext(req.staff);
      if (!shop) return res.status(409).json({ error: 'Boutique introuvable.' });
      const period = ['today', 'week', 'month', 'all'].includes(req.query.period) ? req.query.period : 'all';
      const { overviewStats, periodStart } = require('./team-analytics');
      const from = period === 'all' ? null : periodStart(period);
      const permissions = req.staff.permissions || [];
      const can = (code) => permissions.includes(code);
      const [stats, board, settings, members] = await Promise.all([
        overviewStats(team.base.pool, { merchantId: req.staff.merchantId, storeId: shop.id, from }),
        ops.leaderboard(req.staff.merchantId, { period: period === 'all' ? 'month' : period }),
        ops.getPointSettings(req.staff.merchantId),
        team.listMembers(req.staff.merchantId, {}),
      ]);
      const params = [req.staff.merchantId, shop.id];
      const dateClause = from ? ' AND o.created_at >= $3' : '';
      if (from) params.push(from);
      const [ordersByMember, scansByMember, tables] = await Promise.all([
        team.base.pool.query(
          `SELECT o.created_by_member_id AS "memberId", o.created_by_designation AS designation, o.status, COUNT(*)::int AS n
             FROM merchant_orders o WHERE o.merchant_id=$1 AND o.store_id=$2${dateClause} GROUP BY 1,2,3`, params).then((r) => r.rows).catch(() => []),
        team.base.pool.query(
          `SELECT e.member_id AS "memberId", COALESCE(MAX(m.designation), MAX(m.full_name), '—') AS designation, COUNT(*)::int AS scans
             FROM merchant_scan_events e LEFT JOIN team_members m ON m.id=e.member_id
            WHERE e.merchant_id=$1 AND e.store_id=$2 AND e.category='staff'${from ? ' AND e.scanned_at >= $3' : ''}
            GROUP BY 1 ORDER BY scans DESC`, params).then((r) => r.rows).catch(() => []),
        team.base.pool.query(
          `SELECT p.id, p.name, p.zone, p.point_type AS type, p.status,
                  (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.service_point_id=p.id AND o.status NOT IN ('completed','cancelled','rejected')) AS "activeOrders",
                  (SELECT m.designation FROM team_service_point_assignments a JOIN team_members m ON m.id=a.member_id WHERE a.service_point_id=p.id) AS "assignedDesignation"
             FROM merchant_service_points p WHERE p.store_id=$1 ORDER BY p.zone, p.name`, [shop.id]).then((r) => r.rows).catch(() => []),
      ]);
      const myTasks = await team.listTasks(req.staff.merchantId, { memberId: req.staff.id }).catch(() => []);
      const byManager = ordersByMember.filter((row) => row.memberId === req.staff.id).reduce((sum, row) => sum + Number(row.n), 0);
      const byCustomers = ordersByMember.filter((row) => !row.memberId).reduce((sum, row) => sum + Number(row.n), 0);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        store: { id: shop.id, name: shop.name },
        manager: { id: req.staff.id, designation: req.staff.designation || req.staff.fullName, permissions },
        period,
        permissions: { stats: can('stats.view'), points: can('points.view'), tasks: can('tasks.view_all'), tables: can('tables.view_all'), messaging: can('messaging.manage') },
        orders: stats.orders,
        revenue: can('stats.view') ? stats.revenue : null,
        scans: stats.scans,
        team: { ...stats.team, members: members.filter((m) => m.status !== 'archived').map((m) => ({ id: m.id, role: m.role, designation: m.designation || m.fullName, status: m.status })) },
        tasks: stats.tasks,
        myTasks: myTasks.slice(0, 20),
        ordersByManager: byManager,
        ordersByCustomers: byCustomers,
        ordersByMember: can('stats.view') ? ordersByMember : [],
        scansByMember: can('stats.view') ? scansByMember : [],
        leaderboard: can('points.view') ? board.rows : [],
        pointSettings: can('points.view') ? settings : null,
        tables: can('tables.view_all') ? tables.map((row) => ({ ...row, occupied: Number(row.activeOrders) > 0 })) : [],
        statisticsAuthorized: can('stats.view'),
      } });
    } catch (error) { console.error('[manager-dashboard]', error.message); return fail(res, error, 'Impossible de charger le tableau de bord.'); }
  });

  // ------------------------------------------------------------------ « Contacter mon gestionnaire »
  app.get('/api/staff/messages', requireStaff, async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'La messagerie nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const params = [req.staff.merchantId]; const scopes = [];
      if (req.staff.role === 'general_manager' && (req.staff.permissions || []).includes('messaging.manage')) scopes.push('c.staff_manager_id IS NOT NULL');
      scopes.push('c.created_by_id=$2', 'c.member_id=$2');
      params.push(req.staff.id);
      const { rows } = await team.base.pool.query(
        `SELECT c.id, c.kind, c.subject, c.status, c.created_by_label AS "createdByLabel", c.created_at AS "createdAt",
                c.last_message_at AS "lastMessageAt",
                (SELECT COUNT(*)::int FROM team_messages tm WHERE tm.conversation_id=c.id) AS "messageCount"
           FROM team_conversations c WHERE c.merchant_id=$1 AND (${scopes.join(' OR ')}) ORDER BY c.last_message_at DESC LIMIT 60`, params);
      return res.json({ data: { conversations: rows } });
    } catch (error) { return fail(res, error, 'Impossible de charger la messagerie.'); }
  });

  app.post('/api/staff/messages', requireStaff, requirePermission('messaging.reply'), async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'La messagerie nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const subject = clean(req.body?.subject, 140);
      const body = clean(req.body?.body, 4000);
      if (subject.length < 3) return res.status(400).json({ error: 'Indiquez un sujet de 3 caractères au moins.' });
      if (body.length < 3) return res.status(400).json({ error: 'Écrivez votre message.' });
      // Destinataire : le gérant général de l'équipe (table team_members). Un gérant qui écrit
      // s'adresse au marchand : la conversation n'a alors pas de destinataire interne.
      const shop = await shopContext(req.staff);
      const { rows: managers } = await team.base.pool.query(
        `SELECT id, designation, full_name AS "fullName" FROM team_members
          WHERE merchant_id=$1 AND role='general_manager' AND status='active' ORDER BY created_at LIMIT 1`, [req.staff.merchantId]);
      const staffManagerId = req.staff.role === 'general_manager' ? null : (managers[0]?.id || null);
      if (req.staff.role !== 'general_manager' && !staffManagerId) {
        return res.status(409).json({ error: 'Aucun gérant général actif n’est disponible. Signalez-le au marchand.', code: 'NO_MANAGER' });
      }
      const id = `tc_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      // `created_by_type` accepte le vocabulaire du module équipe (« waitress », « general_manager »).
      const authorType = req.staff.role === 'general_manager' ? 'general_manager' : 'waitress';
      await team.base.pool.query(
        `INSERT INTO team_conversations (id, merchant_id, store_id, kind, staff_manager_id, subject, category, status, created_by_type, created_by_id, created_by_label)
         VALUES ($1,$2,$3,'support',$4,$5,$6,'sent',$7,$8,$9)`,
        [id, req.staff.merchantId, shop?.id || null, staffManagerId, subject, clean(req.body?.category, 30) || 'other',
          authorType, req.staff.id, req.staff.designation || req.staff.fullName]);
      await team.base.pool.query(
        `INSERT INTO team_messages (id, conversation_id, author_type, author_id, author_label, body)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [`tm_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, id, authorType, req.staff.id, req.staff.designation || req.staff.fullName, body]);
      await ops.notify({ merchantId: req.staff.merchantId, storeId: shop?.id || '', memberId: staffManagerId || req.staff.id,
        type: 'support_message', title: 'Nouveau message de l’équipe', message: `${subject} — ${req.staff.designation || req.staff.fullName}`,
        data: { conversationId: id }, dedupeKey: `support:${id}:open` });
      await team.recordActivity(req.staff.merchantId, shop?.id || '', req.staff.id, 'message_sent',
        `Message au gestionnaire : ${subject}.`, 'success', { conversationId: id }).catch(() => {});
      return res.status(201).json({ data: { conversationId: id } });
    } catch (error) { return fail(res, error, 'Impossible d’envoyer ce message.'); }
  });

  app.get('/api/staff/points', requireStaff, async (req, res) => {
    try {
      const member = await team.getMember(req.staff.id);
      const tasks = await team.listTasks(req.staff.merchantId, { memberId: req.staff.id });
      return res.json({ data: { points: Number(member?.points) || 0, tasksDone: tasks.filter((t) => t.status === 'done').length,
        tasksOpen: tasks.filter((t) => ['todo', 'in_progress'].includes(t.status)).length } });
    } catch (error) { return fail(res, error, 'Impossible de charger vos points.'); }
  });

  app.get('/api/staff/history', requireStaff, async (req, res) => {
    try {
      const rows = await team.listActivity(req.staff.merchantId, { memberId: req.query.scope === 'team' && (req.staff.permissions || []).includes('activity.view') ? '' : req.staff.id, limit: 100 });
      return res.json({ data: rows });
    } catch (error) { return fail(res, error, 'Impossible de charger l’historique.'); }
  });

  // ------------------------------------------------------------------ outils internes
  // Crédit des points : une seule ligne de journal par événement source (jamais deux fois le
  // même scan, la même commande ou la même tâche). Le barème vient du marchand ; à défaut, des
  // valeurs par défaut raisonnables s'appliquent.
  async function creditPoints(member, shop, { action, sourceKey, reason, fallback, memberId = '', storeId = '' }) {
    try {
      const settings = await ops.getPointSettings(member.merchantId);
      const map = { scan: settings.pointsScan, order: settings.pointsOrder, order_completed: settings.pointsOrderCompleted, task: settings.pointsTask };
      const points = Number.isFinite(map[action]) ? map[action] : fallback;
      if (!points) return null;
      const target = memberId || member.id;
      return await ops.awardPoints({ merchantId: member.merchantId, storeId: storeId || shop?.id || member.storeId,
        memberId: target, memberLabel: target === member.id ? (member.designation || member.fullName) : '',
        action, points, reason, sourceKey,
        actor: { type: member.role === 'general_manager' ? 'general_manager' : 'system', id: member.id, label: member.designation || member.fullName } });
    } catch (error) { console.error('[points]', error.message); return null; }
  }

  async function shopContext(member) {
    const shop = await commerce.getStoreByMerchantId(member.merchantId).catch(() => null);
    if (!shop || shop.id !== member.storeId) return null;
    return shop;
  }

  async function staffSettings(member) {
    const settings = await team.getSettings(member.merchantId);
    const platform = await loadPlatformLimits(member.merchantId);
    return { ...settings, platform, effectiveMaxWaitresses: Math.min(Number(settings.maxWaitresses) || 0, platform.maxWaitressesPerMerchant),
      effectiveMaxGeneralManagers: Math.min(Number(settings.maxGeneralManagers) || 0, platform.maxGeneralManagersPerMerchant) };
  }

  async function loadPlatformLimits() {
    const fallback = { maxGeneralManagersPerMerchant: 10, maxWaitressesPerMerchant: 50, activationCodeTtlHours: 72, teamModuleEnabled: true };
    try {
      if (!team.pg) return fallback;
      const { rows } = await team.base.pool.query("SELECT setting_value FROM app_settings WHERE setting_key='teamLimits'");
      return { ...fallback, ...(rows[0]?.setting_value || {}) };
    } catch (_) { return fallback; }
  }

  function staffSessionPayload(member) {
    return { id: member.id, role: member.role, designation: member.designation, fullName: member.fullName,
      username: member.username, merchantId: member.merchantId, storeId: member.storeId,
      permissions: member.permissions || [], mustChangePassword: member.mustChangePassword === true };
  }

  async function recentOrders(member, limit = 50, mineOnly = false) {
    if (team.pg) {
      const params = [member.merchantId, member.storeId, limit];
      let extra = '';
      if (mineOnly) { params.push(member.id); extra = ` AND o.created_by_member_id=$4`; }
      const { rows } = await team.base.pool.query(
        `SELECT o.id, o.public_reference AS reference, o.status, o.total_amount_xof AS "totalAmountXof", o.discount_amount_xof AS "discountAmountXof",
                o.customer_name AS "customerName", o.customer_phone AS "customerPhone", o.service_point_name AS "servicePointName",
                o.order_type AS "orderType", o.source, o.created_by_type AS "createdByType", o.created_by_member_id AS "createdByMemberId",
                o.created_by_designation AS "createdByDesignation", o.created_at AS "createdAt",
                COALESCE((SELECT SUM(i.quantity) FROM merchant_order_items i WHERE i.order_id=o.id),0)::int AS "itemCount"
           FROM merchant_orders o WHERE o.merchant_id=$1 AND o.store_id=$2${extra}
          ORDER BY o.created_at DESC LIMIT $3`, params);
      return rows;
    }
    const state = store.state;
    return (state.merchantOrders || []).filter((o) => o.merchantId === member.merchantId && o.storeId === member.storeId && (!mineOnly || o.createdByMemberId === member.id))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, limit)
      .map((o) => ({ id: o.id, reference: o.reference, status: o.status, totalAmountXof: o.totalAmountXof, customerName: o.customerName,
        servicePointName: o.servicePointName, orderType: o.orderType, createdAt: o.createdAt, createdByMemberId: o.createdByMemberId || '',
        createdByDesignation: o.createdByDesignation || '', itemCount: (o.items || []).reduce((n, i) => n + (Number(i.quantity) || 0), 0) }));
  }

  async function staffOrderView(orderId, member) {
    const order = await commerce.getOrder(orderId);
    return { ...order, customLines: await customLines(orderId, member) };
  }

  async function customLines(orderId) {
    if (!team.pg) return [];
    const { rows } = await team.base.pool.query(
      `SELECT i.product_name AS name, i.quantity, i.unit_price_xof AS "unitPriceXof", i.custom_note AS note
         FROM merchant_order_items i WHERE i.order_id=$1 AND i.is_custom=TRUE ORDER BY i.id`, [orderId]).catch(() => ({ rows: [] }));
    return rows;
  }

  async function insertCustomLines(shop, member, orderId, lines) {
    if (!team.pg) return;
    for (const line of lines) {
      await team.base.pool.query(
        `INSERT INTO merchant_order_items (id, order_id, product_id, product_name, quantity, unit_price_xof, image_data, is_custom, custom_note)
         VALUES ($1,$2,NULL,$3,$4,$5,'',TRUE,$6)`,
        [`moi_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, orderId, line.name, line.quantity, line.unitPriceXof, line.note || '']).catch(() => {});
    }
    const customTotal = lines.reduce((sum, l) => sum + l.quantity * l.unitPriceXof, 0);
    if (customTotal) {
      await team.base.pool.query('UPDATE merchant_orders SET total_amount_xof = total_amount_xof + $2 WHERE id=$1 AND store_id=$3', [orderId, customTotal, shop.id]).catch(() => {});
    }
    await team.recordActivity(member.merchantId, shop.id, member.id, 'custom_lines_added',
      `${lines.length} article(s) libre(s) ajouté(s) à la commande.`, 'success', { orderId, customTotal });
  }

  // Commande sans aucun article du catalogue : insertion directe, même contrat que createOrder.
  async function createManualOnlyOrder(member, shop, ctx) {
    const total = ctx.customItems.reduce((sum, l) => sum + l.quantity * l.unitPriceXof, 0) - ctx.discountAmountXof;
    if (total < 0) { const error = new Error('La remise ne peut pas dépasser le sous-total.'); error.code = 'DISCOUNT_TOO_HIGH'; throw error; }
    if (!team.pg) { const error = new Error('La commande entièrement libre nécessite la base PostgreSQL.'); error.code = 'PG_REQUIRED'; throw error; }
    const id = `ord_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
    const reference = `CMD-${Date.now().toString(36).toUpperCase().slice(-6)}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
    const client = await team.base.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO merchant_orders (id, store_id, merchant_id, public_reference, client_request_id, intent_hash, customer_name, customer_phone,
            customer_email, delivery_address, note, total_amount_xof, status, stock_reserved, tracking_token_hash, service_point_id, service_point_name,
            delivery_fee_xof, discount_amount_xof, source, created_by_type, created_by_id, order_type, payment_method,
            scanned_qr_code, scanned_via, scan_event_id, customer_contact_status, created_by_member_id, created_by_designation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'',$9,$10,$11,'pending',FALSE,$12,$13,$14,0,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [id, shop.id, member.merchantId, reference, ctx.requestId, crypto.createHash('sha256').update(JSON.stringify(ctx.customItems)).digest('hex'),
          ctx.customerName, ctx.customerPhone, ctx.deliveryAddress, ctx.note, Math.max(total, 0),
          crypto.createHash('sha256').update(`${shop.id}:${ctx.requestId}`).digest('hex'), ctx.servicePoint?.id || null, ctx.servicePoint?.name || '',
          ctx.discountAmountXof || 0, member.role === 'general_manager' ? 'manager_assisted' : 'staff_assisted', member.role, member.id,
          ctx.orderType, ctx.paymentMethod, clean(ctx.body?.scannedQrCode, 120), clean(ctx.body?.scannedVia, 20) || 'manual',
          clean(ctx.body?.scanEventId, 100), ctx.customerPhone ? 'provided' : 'not_available', member.id, member.designation || '']);
      for (const line of ctx.customItems) {
        await client.query(
          `INSERT INTO merchant_order_items (id, order_id, product_id, product_name, quantity, unit_price_xof, image_data, is_custom, custom_note)
           VALUES ($1,$2,NULL,$3,$4,$5,'',TRUE,$6)`,
          [`moi_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, id, line.name, line.quantity, line.unitPriceXof, line.note || '']);
      }
      await client.query(`INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id)
        VALUES ($1,$2,'pending',$3,$4,$5)`, [`moe_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, id, `Commande saisie par ${member.designation || member.fullName}.`, member.role, member.id]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      if (error.code === '23505') { const conflict = new Error('Cette commande a déjà été enregistrée.'); conflict.code = 'IDEMPOTENCY_CONFLICT'; throw conflict; }
      throw error;
    } finally { client.release(); }
    return commerce.getOrder(id);
  }

  async function afterOrderCreated(member, shop, order, { customItems, settings }) {
    if (team.pg) {
      await team.base.pool.query('UPDATE merchant_orders SET created_by_member_id=$2, created_by_designation=$3 WHERE id=$1 AND created_by_member_id=$4',
        [order.id, member.id, member.designation || '', '']).catch(() => {});
    }
    await creditPoints(member, shop, { action: 'order', sourceKey: `order:${order.id}`, reason: `Commande ${order.reference}` });
    // Affectation automatique : si la table est affectée à une serveuse, la commande la suit.
    try {
      if (order.servicePointId) {
        const auto = await ops.autoAssignFromServicePoint(member.merchantId, shop.id, order.servicePointId);
        if (auto && auto !== member.id) {
          await ops.assignOrder({ merchantId: member.merchantId, storeId: shop.id, orderId: order.id, memberId: auto,
            reason: 'Affectation automatique depuis la table scannée',
            actor: { type: member.role, id: member.id, label: member.designation || member.fullName } });
        }
      }
    } catch (error) { console.error('[auto-assign]', error.message); }
    await team.recordActivity(member.merchantId, shop.id, member.id, 'order_created',
      `Commande ${order.reference} enregistrée (${customItems.length} article(s) libre(s)).`, 'success', { orderId: order.id });
    await notifyMerchant(member.merchantId, 'staff_order', `Commande ${order.reference}`, `${member.designation || member.fullName} a saisi une commande.`, { orderId: order.id }).catch(() => {});
  }

  async function notifyMember(merchantId, memberId, title, message) {
    if (!team.pg) return;
    await team.base.pool.query(
      `INSERT INTO merchant_notifications (id, merchant_id, order_id, notification_type, dedupe_key, title, message, data)
       VALUES ($1,$2,NULL,'staff_task',$3,$4,$5,$6::jsonb) ON CONFLICT (merchant_id, dedupe_key) DO NOTHING`,
      [`mn_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, merchantId, `staff-task:${memberId}:${Date.now()}`, title, message, JSON.stringify({ memberId })]).catch(() => {});
  }

  async function notifyMerchant(merchantId, type, title, message, data) {
    if (!team.pg) return;
    await team.base.pool.query(
      `INSERT INTO merchant_notifications (id, merchant_id, order_id, notification_type, dedupe_key, title, message, data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (merchant_id, dedupe_key) DO NOTHING`,
      [`mn_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`, merchantId, data?.orderId || null, type,
        `${type}:${data?.orderId || Date.now()}`, title, message, JSON.stringify(data || {})]).catch(() => {});
  }

  function fail(res, error, fallback) {
    if (error.status && error.status < 500) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    if (typeof apiError === 'function') return apiError(res, error, fallback);
    return res.status(500).json({ error: fallback });
  }

  // Le gérant général répond dans un fil de support qui lui est adressé (jamais dans un fil d'une autre boutique).
  app.post('/api/staff/messages/:conversationId/reply', requireStaff, requirePermission('messaging.manage'), async (req, res) => {
    try {
      if (!team.pg) return res.status(409).json({ error: 'La messagerie nécessite la base PostgreSQL.', code: 'PG_REQUIRED' });
      const body = clean(req.body?.body, 4000);
      if (body.length < 1) return res.status(400).json({ error: 'Écrivez votre réponse.' });
      const { rows } = await team.base.pool.query(
        `SELECT id, status, created_by_id AS "createdById", created_by_type AS "createdByType"
           FROM team_conversations WHERE id=$1 AND merchant_id=$2 AND kind='support'`,
        [String(req.params.conversationId), req.staff.merchantId]);
      if (!rows[0]) return res.status(404).json({ error: 'Conversation introuvable.' });
      if (rows[0].status === 'closed') return res.status(409).json({ error: 'Cette conversation est clôturée.', code: 'CONVERSATION_CLOSED' });
      const messageId = `tm_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
      await team.base.pool.query(
        `INSERT INTO team_messages (id, conversation_id, author_type, author_id, author_label, body)
         VALUES ($1,$2,'general_manager',$3,$4,$5)`,
        [messageId, rows[0].id, req.staff.id, req.staff.designation || req.staff.fullName, body]);
      await team.base.pool.query(`UPDATE team_conversations SET status='answered', last_message_at=NOW() WHERE id=$1`, [rows[0].id]);
      if (rows[0].createdByType !== 'merchant' && rows[0].createdById) {
        await ops.notify({ merchantId: req.staff.merchantId, storeId: req.staff.storeId, memberId: rows[0].createdById,
          type: 'support_reply', title: 'Réponse de votre gérant', message: body.slice(0, 140),
          data: { conversationId: rows[0].id }, dedupeKey: `support:${rows[0].id}:${messageId}` }).catch(() => {});
      }
      return res.status(201).json({ data: { id: messageId, conversationId: rows[0].id } });
    } catch (error) { return fail(res, error, 'Impossible d’envoyer cette réponse.'); }
  });

  return { requireStaff, requirePermission, readStaffToken, STAFF_COOKIE };
};
