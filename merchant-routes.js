'use strict';

const crypto = require('node:crypto');
const { REQUEST_ID_RE } = require('./merchant-commerce');

const MERCHANT_COOKIE = 'qria_merchant';
const MANAGER_COOKIE = 'qria_manager';
const ADMIN_COOKIE = 'qria_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_IMAGE_BYTES = 350 * 1024;
const MAX_IMAGE_CHARS = 500_000;
const PERMISSION_KEYS = ['canManageStore', 'canManageProducts', 'canManageOrders', 'canCreateStoreQr', 'canViewAudit'];
const streams = new Set();
const loginAttempts = new Map();
const orderAttempts = new Map();

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
const DUMMY_SALT = Buffer.from('oymike-merchant-login-dummy-salt');
function checkPassword(password, stored) {
  const [algorithm, saltText, digestText] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !digestText) { crypto.scryptSync(String(password), DUMMY_SALT, 64); return false; }
  try {
    const salt = Buffer.from(saltText, 'base64url'); const expected = Buffer.from(digestText, 'base64url');
    const actual = crypto.scryptSync(String(password), salt, expected.length || 64);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}
function hashToken(value) { return crypto.createHash('sha256').update(String(value)).digest('hex'); }
function safeText(value, max = 500) { return String(value == null ? '' : value).trim().slice(0, max); }
function jsonClone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function readCookie(req, name) {
  for (const part of String(req.headers.cookie || '').split(';')) {
    const index = part.indexOf('='); if (index < 0 || part.slice(0, index).trim() !== name) continue;
    try { return decodeURIComponent(part.slice(index + 1).trim()); } catch (_) { return ''; }
  }
  return '';
}
function timingSafeTextEqual(a, b) {
  const left = Buffer.from(String(a)); const right = Buffer.from(String(b));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function validateImage(value, field) {
  const raw = String(value || '');
  if (!raw) return '';
  if (raw.length > MAX_IMAGE_CHARS) throw new Error(`${field} dépasse la taille maximale de 350 Ko.`);
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);
  if (!match) throw new Error(`${field} doit être une image JPG, PNG ou WebP valide.`);
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString('base64') !== match[2]) throw new Error(`${field} dépasse la taille maximale de 350 Ko.`);
  const mime = match[1].toLowerCase();
  const valid = mime === 'jpeg' ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : mime === 'png' ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  if (!valid) throw new Error(`${field} ne correspond pas au format de fichier annoncé.`);
  return `data:image/${mime};base64,${bytes.toString('base64')}`;
}
function normalizeSlug(value) {
  const slug = String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
  if (slug.length < 3) throw new Error('L’adresse publique doit contenir au moins 3 caractères.');
  return slug;
}
function validPhone(value, label = 'Téléphone') {
  const phone = safeText(value, 32);
  if (phone && (!/^[0-9+().\s-]{7,32}$/.test(phone) || phone.replace(/\D/g, '').length < 7)) throw new Error(`${label} n’est pas valide.`);
  return phone;
}
function publicOrder(order) {
  return { reference: order.reference, status: order.status, customerName: order.customerName, customerPhone: order.customerPhone,
    customerEmail: order.customerEmail, deliveryAddress: order.deliveryAddress, note: order.note, items: order.items,
    totalAmountXof: order.totalAmountXof, currency: order.currency,
    events: (order.events || []).map((event) => ({ status: event.status, note: event.note, createdAt: event.createdAt })), createdAt: order.createdAt, updatedAt: order.updatedAt };
}
function publicMerchantAccount(merchant) {
  if (!merchant) return null;
  const { passwordHash, tokenVersion, passwordResetTokenHash, ...safe } = merchant;
  return safe;
}
function publicStoreDetails(store) {
  if (!store) return null;
  const { qrPublicCode, qrScanCount, ...safe } = store;
  return safe;
}
function actorInfo(role, req) {
  if (role === 'merchant') return { actor: `${req.merchant.displayName} (@${req.merchant.username})`, actorType: 'merchant', actorId: req.merchant.id, managerId: req.merchant.managerId || null };
  if (role === 'manager') return { actor: `${req.manager.displayName} (@${req.manager.username})`, actorType: 'manager', actorId: req.manager.id, managerId: req.manager.id };
  if (role === 'client') return { actor: 'Client sans compte', actorType: 'client', actorId: null, managerId: null };
  return { actor: `PDG (@${String(process.env.ADMIN_USERNAME || 'admin')})`, actorType: 'admin', actorId: String(process.env.ADMIN_USERNAME || 'admin'), managerId: null };
}

module.exports = function registerMerchantRoutes(deps) {
  const { app, store, commerce, requireAdmin, requireManager, checkSameOrigin, apiError, sessionSecret, isProduction, publicBaseUrl, setMerchantSession, clearMerchantSession } = deps;

  function sign(payload) { return crypto.createHmac('sha256', sessionSecret).update(payload).digest('base64url'); }
  function readMerchantSession(req) {
    const token = readCookie(req, MERCHANT_COOKIE); const split = token.lastIndexOf('.');
    if (split < 1) return null;
    const payload = token.slice(0, split); const signature = token.slice(split + 1);
    if (!timingSafeTextEqual(signature, sign(payload))) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      return data.role === 'merchant' && data.merchantId && Number(data.exp) > Date.now() ? data : null;
    } catch (_) { return null; }
  }

  async function requireMerchant(req, res, next) {
    const hasOther = readCookie(req, ADMIN_COOKIE) && readCookie(req, MANAGER_COOKIE);
    const current = readCookie(req, MERCHANT_COOKIE);
    if (hasOther || (current && (readCookie(req, ADMIN_COOKIE) || readCookie(req, MANAGER_COOKIE)))) {
      clearMerchantSession(res);
      return res.status(401).json({ error: 'Sessions de rôles différentes détectées. Reconnectez-vous.' });
    }
    const session = readMerchantSession(req);
    if (!session) return res.status(401).json({ error: 'Session marchand expirée. Reconnectez-vous.' });
    const merchant = await commerce.getMerchantForAuth(session.merchantId).catch(() => null);
    if (!merchant || merchant.deletedAt || merchant.status !== 'active' || Number(merchant.tokenVersion) !== Number(session.ver)) {
      clearMerchantSession(res);
      return res.status(401).json({ error: 'Votre compte marchand est suspendu ou votre session a été révoquée.' });
    }
    req.merchant = merchant;
    if (merchant.mustChangePassword) {
      const expiresAt = merchant.passwordResetExpiresAt ? new Date(merchant.passwordResetExpiresAt).getTime() : 0;
      if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
        clearMerchantSession(res);
        return res.status(401).json({ error: 'Le mot de passe temporaire a expiré. Contactez le PDG.', code: 'TEMP_PASSWORD_EXPIRED' });
      }
      const allowed = (req.method === 'GET' && req.path === '/api/merchant/auth/me') || (req.method === 'POST' && ['/api/merchant/auth/logout', '/api/merchant/auth/change-password'].includes(req.path));
      if (!allowed) return res.status(403).json({ error: 'Vous devez choisir un nouveau mot de passe avant de continuer.', code: 'PASSWORD_CHANGE_REQUIRED', mustChangePassword: true });
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      if (origin && !sameOrigin(req)) return res.status(403).json({ error: 'Origine de requête non autorisée.' });
    }
    next();
  }
  function sameOrigin(req) {
    const origin = req.get('origin'); if (!origin) return true;
    try { return new URL(origin).host === (req.get('x-forwarded-host') || req.get('host')); } catch (_) { return false; }
  }

  function buildTrackingToken(storeId, clientRequestId) {
    return crypto.createHmac('sha256', sessionSecret).update(`merchant-order-v1\0${storeId}\0${clientRequestId}`).digest('base64url');
  }
  function sendSse(res, filter) {
    res.status(200); res.setHeader('Content-Type', 'text/event-stream; charset=utf-8'); res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive'); res.setHeader('X-Accel-Buffering', 'no'); res.flushHeaders?.(); res.write('retry: 3000\n\n');
    const entry = { res, filter }; streams.add(entry);
    const heartbeat = setInterval(() => { try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); streams.delete(entry); } }, 20_000);
    heartbeat.unref?.();
    res.on('close', () => { clearInterval(heartbeat); streams.delete(entry); });
  }
  function publish(event) {
    const payload = `event: commerce\ndata: ${JSON.stringify(event)}\n\n`;
    for (const entry of streams) {
      try { if (entry.filter(event)) entry.res.write(payload); }
      catch (_) { streams.delete(entry); }
    }
  }
  function merchantEvent(merchantId, type, extra = {}) { publish({ type, merchantId, at: new Date().toISOString(), ...extra }); }

  async function audit(role, req, { action, merchantId, entityId, summary, beforeData = null, afterData = null, metadata = {} }) {
    const actor = actorInfo(role, req);
    await store.addAudit({ ...actor, action, entityType: 'merchant', entityId: String(entityId || merchantId), summary,
      beforeData, afterData, result: 'success', metadata: { merchantId, ...metadata } });
  }
  async function auditDenial(req, summary, merchantId = '') {
    const actor = req.manager ? actorInfo('manager', req) : req.merchant ? actorInfo('merchant', req) : actorInfo('admin', req);
    await store.addAudit({ ...actor, action: 'authorization_denied', entityType: 'merchant', entityId: merchantId || 'scope', summary, result: 'denied', metadata: { merchantId: merchantId || null } }).catch(() => {});
  }

  async function managerHas(req, merchantId, permission) {
    const merchant = await commerce.getMerchant(merchantId);
    if (!merchant) return false;
    if (merchant.managerId === req.manager.id && req.manager.canManageMerchants === true) return true;
    const assignment = await commerce.getAssignment(req.manager.id, merchantId);
    return Boolean(assignment && assignment[permission] === true);
  }
  async function requireManagerScope(req, res, merchantId, permission) {
    if (req.manager.canManageMerchants === true && (await commerce.getMerchant(merchantId))?.managerId === req.manager.id) return true;
    if (await managerHas(req, merchantId, permission)) return true;
    await auditDenial(req, 'Accès marchand refusé : aucune attribution ou permission appropriée.', merchantId);
    res.status(403).json({ error: 'Ce marchand ne vous est pas attribué ou votre permission ne permet pas cette action.' });
    return false;
  }
  async function managerMayList(req, merchantId) {
    const merchant = await commerce.getMerchant(merchantId);
    if (!merchant) return false;
    if (merchant.managerId === req.manager.id && req.manager.canManageMerchants === true) return true;
    const assignment = await commerce.getAssignment(req.manager.id, merchantId);
    return Boolean(assignment && PERMISSION_KEYS.some((key) => assignment[key] === true));
  }
  async function ensureManagerExists(managerId) {
    if (!managerId) return null;
    const manager = await store.getManager(managerId);
    if (!manager || manager.status !== 'active') throw new Error('Sélectionnez un gestionnaire actif.');
    return manager;
  }
  async function getOrCreateStore(merchantId, body, role, req) {
    let existing = await commerce.getStoreByMerchantId(merchantId);
    if (!existing) {
      const data = validateStoreInput(body, { firstCreate: true });
      existing = await commerce.createStore(merchantId, data);
      await audit(role, req, { action: 'store_created', merchantId, entityId: existing.id, summary: `Boutique « ${existing.name} » créée.`, afterData: storeSnapshot(existing) });
      merchantEvent(merchantId, 'store_updated');
      return existing;
    }
    const data = validateStoreInput(body, { previous: existing, role });
    const updated = await commerce.updateStore(existing.id, data);
    await audit(role, req, { action: 'store_updated', merchantId, entityId: existing.id, summary: `Boutique « ${updated.name} » modifiée.`, beforeData: storeSnapshot(existing), afterData: storeSnapshot(updated) });
    merchantEvent(merchantId, 'store_updated');
    return updated;
  }
  function storeSnapshot(row) {
    return row ? { id: row.id, merchantId: row.merchantId, slug: row.slug, name: row.name, status: row.status, isPublished: row.isPublished,
      hasLogo: Boolean(row.logo), hasPhone: Boolean(row.phone), hasAddress: Boolean(row.address), descriptionLength: String(row.description || '').length } : null;
  }
  function validateStoreInput(input, { firstCreate = false, previous = null, role = '' } = {}) {
    const name = safeText(input?.name, 120);
    if (!name) throw new Error('Le nom de la boutique est obligatoire.');
    const email = safeText(input?.email, 254).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail de la boutique n’est pas valide.');
    const slug = firstCreate ? normalizeSlug(input?.slug || name) : previous.slug;
    const managerOrAdmin = role !== 'merchant';
    const status = managerOrAdmin && ['active', 'suspended'].includes(input?.status) ? input.status : (previous?.status || 'active');
    return { slug, name, description: safeText(input?.description, 3000), logo: validateImage(input?.logo, 'Logo de boutique'),
      phone: validPhone(input?.phone, 'Téléphone de la boutique'), whatsapp: validPhone(input?.whatsapp, 'WhatsApp'), email,
      address: safeText(input?.address, 500), deliveryNote: safeText(input?.deliveryNote, 1000), status,
      isPublished: input?.isPublished === true };
  }
  function validateProductInput(input) {
    const name = safeText(input?.name, 120); if (!name) throw new Error('Le nom du produit est obligatoire.');
    const priceXof = Number(input?.priceXof); const stockQuantity = Number(input?.stockQuantity);
    if (!Number.isSafeInteger(priceXof) || priceXof < 0 || priceXof > 2_000_000_000) throw new Error('Le prix doit être un montant entier en XOF, égal ou supérieur à zéro.');
    if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1_000_000) throw new Error('Le stock doit être un nombre entier entre 0 et 1 000 000.');
    const status = ['active', 'unavailable'].includes(input?.status) ? input.status : 'active';
    const sortOrder = Number(input?.sortOrder || 0);
    return { name, description: safeText(input?.description, 2000), sku: safeText(input?.sku, 80), priceXof, stockQuantity,
      trackStock: input?.trackStock !== false, imageData: validateImage(input?.imageData, 'Image du produit'), status,
      sortOrder: Number.isSafeInteger(sortOrder) ? Math.max(-10000, Math.min(10000, sortOrder)) : 0 };
  }
  function pagination(query) {
    const page = Math.max(1, Number.parseInt(query.page, 10) || 1); const limit = Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25));
    return { page, limit, search: safeText(query.search, 120), status: safeText(query.status, 30) };
  }

  // Merchant authentication is deliberately isolated from the CEO and manager sessions.
  app.post('/api/merchant/auth/login', checkSameOrigin, async (req, res) => {
    const key = req.ip || 'unknown'; const now = Date.now(); const current = loginAttempts.get(key);
    if (current && now - current.start < 60_000 && current.count >= 8) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
    const username = safeText(req.body?.username, 120).toLowerCase(); const passwordRaw = String(req.body?.password || '').slice(0, 256);
    const merchant = await commerce.getMerchantByUsername(username).catch(() => null);
    const valid = Boolean(merchant && !merchant.deletedAt && merchant.status === 'active' && checkPassword(passwordRaw, merchant.passwordHash));
    if (!valid) {
      if (!current || now - current.start >= 60_000) loginAttempts.set(key, { start: now, count: 1 }); else current.count++;
      await store.addAudit({ actor: merchant ? `${merchant.displayName} (@${merchant.username})` : 'Identifiant marchand inconnu', actorType: 'anonymous', actorId: merchant?.id || null,
        managerId: merchant?.managerId || null, action: 'login_failure', entityType: 'merchant', entityId: merchant?.id || 'authentication', summary: 'Échec de connexion à un compte marchand.', result: 'failure', metadata: { merchantId: merchant?.id || null } }).catch(() => {});
      return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect, ou compte suspendu.' });
    }
    loginAttempts.delete(key);
    if (merchant.mustChangePassword) {
      const expires = merchant.passwordResetExpiresAt ? new Date(merchant.passwordResetExpiresAt).getTime() : 0;
      if (!Number.isFinite(expires) || expires <= now) return res.status(401).json({ error: 'Le mot de passe temporaire a expiré. Contactez le PDG.', code: 'TEMP_PASSWORD_EXPIRED' });
    }
    const updated = await commerce.markMerchantLogin(merchant.id);
    setMerchantSession(res, updated || merchant);
    await store.addAudit({ actor: `${merchant.displayName} (@${merchant.username})`, actorType: 'merchant', actorId: merchant.id, managerId: merchant.managerId || null,
      action: 'login_success', entityType: 'merchant', entityId: merchant.id, summary: 'Connexion marchand réussie.', metadata: { merchantId: merchant.id } }).catch(() => {});
    res.json({ ok: true, data: publicMerchantAccount(updated || merchant) });
  });
  app.get('/api/merchant/auth/me', requireMerchant, async (req, res) => res.json({ data: publicMerchantAccount(req.merchant) }));
  app.post('/api/merchant/auth/logout', requireMerchant, async (req, res) => {
    await store.addAudit({ ...actorInfo('merchant', req), action: 'logout', entityType: 'merchant', entityId: req.merchant.id, summary: 'Déconnexion marchand.', metadata: { merchantId: req.merchant.id } }).catch(() => {});
    clearMerchantSession(res); res.json({ ok: true });
  });
  app.post('/api/merchant/auth/change-password', requireMerchant, async (req, res) => {
    const password = String(req.body?.password || ''); const confirm = String(req.body?.confirmPassword || '');
    if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Le mot de passe doit contenir entre 12 et 128 caractères.' });
    if (password !== confirm) return res.status(400).json({ error: 'Les deux mots de passe ne correspondent pas.' });
    if (checkPassword(password, req.merchant.passwordHash)) return res.status(400).json({ error: 'Choisissez un mot de passe différent du mot de passe actuel.' });
    const updated = await commerce.changeMerchantPassword(req.merchant.id, hashPassword(password));
    if (!updated) return res.status(409).json({ error: 'Le changement de mot de passe n’est plus disponible. Reconnectez-vous.' });
    setMerchantSession(res, updated);
    await store.addAudit({ ...actorInfo('merchant', req), action: 'password_change', entityType: 'merchant', entityId: req.merchant.id, summary: 'Mot de passe marchand remplacé; anciennes sessions révoquées.', metadata: { merchantId: req.merchant.id } }).catch(() => {});
    res.json({ ok: true, data: publicMerchantAccount(updated) });
  });

  // Explicitly reject attempts to create or manage QR from the merchant role.
  app.all(/^\/api\/merchant\/.*(?:qr|codes)(?:\/.*)?$/i, requireMerchant, async (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    await auditDenial(req, 'Création ou modification de QR refusée : le rôle marchand ne peut jamais créer de QR.', req.merchant.id);
    res.status(403).json({ error: 'La création et la gestion des QR sont réservées au PDG et aux gestionnaires autorisés.' });
  });

  app.get('/api/public/shops/:slug', async (req, res) => {
    try {
      const result = await commerce.getPublicShopBySlug(safeText(req.params.slug, 80));
      if (!result) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      res.setHeader('Cache-Control', 'no-store'); res.json({ data: result });
    } catch (error) { apiError(res, error, 'Impossible de charger cette boutique.'); }
  });
  app.post('/api/public/shops/:slug/orders', checkSameOrigin, async (req, res) => {
    const key = req.ip || 'unknown'; const now = Date.now(); const current = orderAttempts.get(key);
    if (current && now - current.start < 60_000 && current.count >= 15) return res.status(429).json({ error: 'Trop de commandes depuis cette connexion. Réessayez dans une minute.' });
    if (!current || now - current.start >= 60_000) orderAttempts.set(key, { start: now, count: 1 }); else current.count++;
    try {
      const shop = await commerce.getPublicShopBySlug(safeText(req.params.slug, 80));
      if (!shop) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      const clientRequestId = safeText(req.body?.clientRequestId, 100);
      if (!REQUEST_ID_RE.test(clientRequestId)) return res.status(400).json({ error: 'Identifiant de commande invalide. Actualisez le panier puis réessayez.' });
      const customerName = safeText(req.body?.customerName, 120); const customerPhone = validPhone(req.body?.customerPhone, 'Téléphone du client');
      const customerEmail = safeText(req.body?.customerEmail, 254).toLowerCase(); const deliveryAddress = safeText(req.body?.deliveryAddress, 500); const note = safeText(req.body?.note, 500);
      if (customerName.length < 2) throw new Error('Le nom du client doit contenir au moins 2 caractères.');
      if (!customerPhone || customerPhone.replace(/\D/g, '').length < 7) throw new Error('Un numéro de téléphone valide est obligatoire pour le suivi de la commande.');
      if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error('L’adresse e-mail du client n’est pas valide.');
      if (deliveryAddress.length < 3) throw new Error('Indiquez une adresse ou un mode de remise pour la commande.');
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const trackingToken = buildTrackingToken(shop.store.id, clientRequestId);
      const result = await commerce.createOrder({ storeId: shop.store.id, merchantId: shop.store.merchantId, clientRequestId,
        customerName, customerPhone, customerEmail, deliveryAddress, note, items, trackingTokenHash: hashToken(trackingToken) });
      if (!result.idempotent) {
        await audit('client', req, { action: 'order_received', merchantId: result.order.merchantId, entityId: result.order.id,
          summary: `Commande ${result.order.reference} reçue.`, metadata: { storeId: result.order.storeId, orderReference: result.order.reference,
            totalAmountXof: result.order.totalAmountXof, itemCount: result.order.items.length } }).catch(() => {});
        merchantEvent(result.order.merchantId, 'new_order', { orderId: result.order.id, reference: result.order.reference });
      }
      res.status(result.idempotent ? 200 : 201).json({ data: { order: publicOrder(result.order), trackingToken, idempotent: result.idempotent } });
    } catch (error) {
      if (error.code === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: error.message });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      apiError(res, error, 'Impossible d’enregistrer la commande.');
    }
  });
  app.get('/api/public/shops/orders/:reference', async (req, res) => {
    const token = safeText(req.query.token, 200);
    if (token.length < 32) return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
    try {
      const order = await commerce.getOrderTracking(safeText(req.params.reference, 40), hashToken(token));
      if (!order) return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
      res.setHeader('Cache-Control', 'no-store'); res.json({ data: publicOrder(order) });
    } catch (error) { apiError(res, error, 'Impossible de charger le suivi de la commande.'); }
  });

  // Read-only QR links are provisioned only through admin/manager endpoints below.
  app.get('/s/:code', async (req, res) => {
    try {
      const result = await commerce.getPublicShopByQr(safeText(req.params.code, 100));
      if (!result) return res.status(404).sendFile(require('node:path').join(__dirname, 'public', 'not-found.html'));
      if (result.id) await commerce.recordStoreQrScan(result.id);
      return res.redirect(302, `/shop/${encodeURIComponent(result.slug)}`);
    } catch (error) { apiError(res, error, 'Impossible d’ouvrir la boutique.'); }
  });

  async function loadOwnStore(merchantId) { return commerce.getStoreByMerchantId(merchantId); }
  async function merchantOwnStore(req, res) {
    const row = await loadOwnStore(req.merchant.id);
    if (!row) { res.status(404).json({ error: 'Configurez d’abord les informations de votre boutique.' }); return null; }
    return row;
  }
  app.get('/api/merchant/store', requireMerchant, async (req, res) => {
    const row = await loadOwnStore(req.merchant.id); res.json({ data: publicStoreDetails(row) });
  });
  app.put('/api/merchant/store', requireMerchant, async (req, res) => {
    try {
      const row = await getOrCreateStore(req.merchant.id, req.body || {}, 'merchant', req);
      res.json({ data: publicStoreDetails(row) });
    } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer la boutique.'); }
  });
  app.get('/api/merchant/products', requireMerchant, async (req, res) => {
    const row = await merchantOwnStore(req, res); if (!row) return;
    res.json({ data: await commerce.listProducts(row.id), storeId: row.id });
  });
  app.post('/api/merchant/products', requireMerchant, async (req, res) => {
    try {
      const row = await merchantOwnStore(req, res); if (!row) return;
      const product = await commerce.saveProduct(row.id, validateProductInput(req.body || {}));
      await audit('merchant', req, { action: 'product_created', merchantId: req.merchant.id, entityId: product.id, summary: `Produit « ${product.name} » créé.`, afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.merchant.id, 'product_updated', { productId: product.id }); res.status(201).json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer le produit.'); }
  });
  app.put('/api/merchant/products/:productId', requireMerchant, async (req, res) => {
    try {
      const row = await merchantOwnStore(req, res); if (!row) return;
      const before = await commerce.getProduct(req.params.productId); if (!before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
      const product = await commerce.saveProduct(row.id, validateProductInput(req.body || {}), before.id);
      await audit('merchant', req, { action: 'product_updated', merchantId: req.merchant.id, entityId: product.id, summary: `Produit « ${product.name} » modifié.`, beforeData: productSnapshot(before), afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.merchant.id, 'product_updated', { productId: product.id }); res.json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de modifier le produit.'); }
  });
  app.delete('/api/merchant/products/:productId', requireMerchant, async (req, res) => {
    const row = await merchantOwnStore(req, res); if (!row) return;
    const before = await commerce.getProduct(req.params.productId); if (!before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
    const product = await commerce.archiveProduct(row.id, before.id);
    await audit('merchant', req, { action: 'product_archived', merchantId: req.merchant.id, entityId: before.id, summary: `Produit « ${before.name} » archivé.`, beforeData: productSnapshot(before), metadata: { storeId: row.id } });
    merchantEvent(req.merchant.id, 'product_updated', { productId: before.id }); res.json({ data: product });
  });
  app.get('/api/merchant/orders', requireMerchant, async (req, res) => {
    const storeRow = await loadOwnStore(req.merchant.id); if (!storeRow) return res.json({ data: [], total: 0, page: 1, limit: 25 });
    const { page, limit, search, status } = pagination(req.query);
    res.json(await commerce.listOrders({ merchantId: req.merchant.id, storeId: storeRow.id, status: ['pending','confirmed','preparing','ready','completed','cancelled'].includes(status) ? status : '', search, page, limit }));
  });
  app.get('/api/merchant/stats', requireMerchant, async (req, res) => res.json({ data: await commerce.stats(req.merchant.id) }));
  app.get('/api/merchant/qr', requireMerchant, async (req, res) => {
    const row = await loadOwnStore(req.merchant.id); res.json({ data: row ? { path: row.qrPublicCode ? `/s/${row.qrPublicCode}` : '', url: row.qrPublicCode ? `${publicBaseUrl || ''}/s/${row.qrPublicCode}` : '', created: Boolean(row.qrPublicCode) } : null });
  });

  async function loadManagerContext(req, merchantId, permission, res) {
    if (!await requireManagerScope(req, res, merchantId, permission)) return null;
    return commerce.getMerchant(merchantId);
  }
  async function listManagerMerchants(req) {
    const all = await commerce.listMerchants({ managerId: '' }); const result = [];
    for (const merchant of all) if (await managerMayList(req, merchant.id)) {
      const assignment = await commerce.getAssignment(req.manager.id, merchant.id);
      const primaryManager = merchant.managerId === req.manager.id && req.manager.canManageMerchants === true;
      const canStore = primaryManager || assignment?.canManageStore === true;
      const canProducts = primaryManager || assignment?.canManageProducts === true;
      const canOrders = primaryManager || assignment?.canManageOrders === true;
      const canQr = primaryManager || assignment?.canCreateStoreQr === true;
      result.push({ id: merchant.id, username: merchant.username, displayName: merchant.displayName, status: merchant.status,
        managerId: merchant.managerId, storeId: merchant.storeId, storeSlug: merchant.storeSlug, storeName: merchant.storeName,
        storeStatus: merchant.storeStatus, storePublished: merchant.storePublished,
        ...(canStore ? { email: merchant.email, phone: merchant.phone, statusReason: merchant.statusReason, mustChangePassword: merchant.mustChangePassword } : {}),
        ...(canQr || canStore ? { qrPublicCode: merchant.qrPublicCode, qrScanCount: merchant.qrScanCount } : {}),
        ...(canProducts ? { productCount: merchant.productCount } : {}), ...(canOrders ? { orderCount: merchant.orderCount } : {}),
        assignment: assignment || null });
    }
    return result;
  }
  app.get('/api/manager/merchants', requireManager, async (req, res) => {
    try { res.json({ data: await listManagerMerchants(req) }); }
    catch (error) { apiError(res, error, 'Impossible de charger les marchands attribués.'); }
  });
  app.post('/api/manager/merchants', requireManager, async (req, res) => {
    if (req.manager.canManageMerchants !== true) { await auditDenial(req, 'Création de marchand refusée : permission de gestion des marchands désactivée.'); return res.status(403).json({ error: 'Le PDG ne vous a pas autorisé à créer des marchands.' }); }
    return createMerchantAccount(req, res, 'manager');
  });
  app.get('/api/manager/merchants/:merchantId', requireManager, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    if (!await managerMayList(req, merchant.id)) { await auditDenial(req, 'Consultation marchand refusée : compte hors du périmètre attribué.', merchant.id); return res.status(403).json({ error: 'Marchand non attribué.' }); }
    const assignment = await commerce.getAssignment(req.manager.id, merchant.id);
    const primaryManager = merchant.managerId === req.manager.id && req.manager.canManageMerchants === true;
    const canSeeAccount = primaryManager || assignment?.canManageStore === true;
    const accountData = { id: merchant.id, username: merchant.username, displayName: merchant.displayName, status: merchant.status,
      statusReason: canSeeAccount ? merchant.statusReason : '', managerId: merchant.managerId, mustChangePassword: canSeeAccount ? merchant.mustChangePassword : undefined,
      createdAt: merchant.createdAt, updatedAt: canSeeAccount ? merchant.updatedAt : undefined };
    if (canSeeAccount) { accountData.email = merchant.email || ''; accountData.phone = merchant.phone || ''; }
    res.json({ data: { ...accountData, store: primaryManager || assignment?.canManageStore ? await commerce.getStoreByMerchantId(merchant.id) : null, assignment } });
  });
  app.put('/api/manager/merchants/:merchantId', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageStore')) return;
    try { return updateMerchantAccount(req, res, req.params.merchantId, 'manager'); }
    catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de modifier le marchand.'); }
  });
  app.get('/api/manager/merchants/:merchantId/store', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageStore')) return;
    res.json({ data: publicStoreDetails(await commerce.getStoreByMerchantId(req.params.merchantId)) });
  });
  app.put('/api/manager/merchants/:merchantId/store', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageStore')) return;
    try { const row = await getOrCreateStore(req.params.merchantId, req.body || {}, 'manager', req); res.json({ data: publicStoreDetails(row) }); }
    catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer la boutique.'); }
  });
  app.get('/api/manager/merchants/:merchantId/products', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageProducts')) return;
    const row = await commerce.getStoreByMerchantId(req.params.merchantId); res.json({ data: row ? await commerce.listProducts(row.id) : [], storeId: row?.id || '' });
  });
  app.post('/api/manager/merchants/:merchantId/products', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageProducts')) return;
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); if (!row) return res.status(409).json({ error: 'Créez d’abord la boutique.' });
      const product = await commerce.saveProduct(row.id, validateProductInput(req.body || {})); await audit('manager', req, { action: 'product_created', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » créé.`, afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.params.merchantId, 'product_updated', { productId: product.id }); res.status(201).json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer le produit.'); }
  });
  app.put('/api/manager/merchants/:merchantId/products/:productId', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageProducts')) return;
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); const before = await commerce.getProduct(req.params.productId);
      if (!row || !before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
      const product = await commerce.saveProduct(row.id, validateProductInput(req.body || {}), before.id); await audit('manager', req, { action: 'product_updated', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » modifié.`, beforeData: productSnapshot(before), afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.params.merchantId, 'product_updated', { productId: product.id }); res.json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de modifier le produit.'); }
  });
  app.delete('/api/manager/merchants/:merchantId/products/:productId', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageProducts')) return;
    const row = await commerce.getStoreByMerchantId(req.params.merchantId); const before = await commerce.getProduct(req.params.productId);
    if (!row || !before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
    await commerce.archiveProduct(row.id, before.id); await audit('manager', req, { action: 'product_archived', merchantId: req.params.merchantId, entityId: before.id, summary: `Produit « ${before.name} » archivé.`, beforeData: productSnapshot(before), metadata: { storeId: row.id } });
    merchantEvent(req.params.merchantId, 'product_updated', { productId: before.id }); res.json({ ok: true });
  });
  app.get('/api/manager/merchants/:merchantId/orders', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const { page, limit, search, status } = pagination(req.query); res.json(await commerce.listOrders({ merchantId: req.params.merchantId,
      status: ['pending','confirmed','preparing','ready','completed','cancelled'].includes(status) ? status : '', search, page, limit }));
  });
  app.get('/api/manager/merchants/:merchantId/qr', requireManager, async (req, res) => {
    if (req.manager.canCreateCodes === false) { await auditDenial(req, 'Création de QR boutique refusée : la permission QR du gestionnaire est désactivée.', req.params.merchantId); return res.status(403).json({ error: 'Le PDG a désactivé la création de QR pour votre compte.' }); }
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canCreateStoreQr')) return;
    const row = await commerce.getStoreByMerchantId(req.params.merchantId);
    if (!row) return res.json({ data: null });
    const path = row.qrPublicCode ? `/s/${row.qrPublicCode}` : '';
    const url = path ? `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}${path}` : '';
    res.json({ data: { path, url, created: Boolean(path) } });
  });
  app.post('/api/manager/merchants/:merchantId/qr', requireManager, async (req, res) => {
    if (req.manager.canCreateCodes === false) { await auditDenial(req, 'Création de QR boutique refusée : la permission QR du gestionnaire est désactivée.', req.params.merchantId); return res.status(403).json({ error: 'Le PDG a désactivé la création de QR pour votre compte.' }); }
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canCreateStoreQr')) return;
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); if (!row) return res.status(409).json({ error: 'Créez d’abord la boutique.' });
      const result = await commerce.createStoreQr(row.id); await audit('manager', req, { action: result.created ? 'qr_created' : 'qr_viewed', merchantId: req.params.merchantId,
        entityId: row.id, summary: result.created ? `QR de la boutique « ${row.name} » créé.` : `QR de la boutique « ${row.name} » consulté.`, metadata: { storeId: row.id } });
      const url = `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}/s/${result.store.qrPublicCode}`; res.status(result.created ? 201 : 200).json({ data: { url, path: `/s/${result.store.qrPublicCode}`, created: result.created } });
    } catch (error) { apiError(res, error, 'Impossible de créer le QR de la boutique.'); }
  });
  app.get('/api/manager/merchants/:merchantId/audit', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canViewAudit')) return;
    res.json(await commerce.listAudit({ merchantId: req.params.merchantId, page: Math.max(1, Number.parseInt(req.query.page, 10) || 1) }));
  });

  // CEO-only merchant controls and assignments.
  app.get('/api/admin/merchants', requireAdmin, async (_req, res) => {
    try { res.json({ data: await commerce.listMerchants() }); } catch (error) { apiError(res, error, 'Impossible de charger les marchands.'); }
  });
  app.post('/api/admin/merchants', requireAdmin, async (req, res) => createMerchantAccount(req, res, 'admin'));
  app.get('/api/admin/merchants/:merchantId', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    res.json({ data: { ...merchant, store: await commerce.getStoreByMerchantId(merchant.id) } });
  });
  app.put('/api/admin/merchants/:merchantId', requireAdmin, async (req, res) => updateMerchantAccount(req, res, req.params.merchantId, 'admin'));
  app.post('/api/admin/merchants/:merchantId/status', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const status = safeText(req.body?.status, 20); if (!['active','suspended','blocked'].includes(status)) return res.status(400).json({ error: 'Choisissez un statut valide.' });
    const updated = await commerce.updateMerchant(merchant.id, { ...merchant, status, statusReason: safeText(req.body?.reason, 500) });
    await audit('admin', req, { action: `account_${status}`, merchantId: merchant.id, entityId: merchant.id, summary: `Compte marchand « ${merchant.displayName} » ${status === 'active' ? 'réactivé' : status === 'suspended' ? 'suspendu' : 'bloqué'}; sessions révoquées.`, beforeData: accountSnapshot(merchant), afterData: accountSnapshot(updated) });
    merchantEvent(merchant.id, 'account_status'); res.json({ data: updated });
  });
  app.post('/api/admin/merchants/:merchantId/reset-password', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const temporaryPassword = `M-${crypto.randomBytes(12).toString('base64url')}`; const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
    const updated = await commerce.setMerchantTemporaryPassword(merchant.id, hashPassword(temporaryPassword), expiresAt);
    await audit('admin', req, { action: 'password_reset', merchantId: merchant.id, entityId: merchant.id, summary: `Mot de passe temporaire de « ${merchant.displayName} » réinitialisé; sessions révoquées.`, beforeData: accountSnapshot(merchant), afterData: accountSnapshot(updated) });
    res.json({ temporaryPassword, expiresAt });
  });
  app.get('/api/admin/merchants/:merchantId/qr', requireAdmin, async (req, res) => {
    const row = await commerce.getStoreByMerchantId(req.params.merchantId);
    if (!row) return res.json({ data: null });
    const path = row.qrPublicCode ? `/s/${row.qrPublicCode}` : '';
    const url = path ? `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}${path}` : '';
    res.json({ data: { path, url, created: Boolean(path) } });
  });
  app.post('/api/admin/merchants/:merchantId/qr', requireAdmin, async (req, res) => {
    const row = await commerce.getStoreByMerchantId(req.params.merchantId); if (!row) return res.status(409).json({ error: 'Créez d’abord la boutique.' });
    try {
      const result = await commerce.createStoreQr(row.id);
      await audit('admin', req, { action: result.created ? 'qr_created' : 'qr_viewed', merchantId: req.params.merchantId,
        entityId: row.id, summary: result.created ? `QR de la boutique « ${row.name} » créé.` : `QR de la boutique « ${row.name} » consulté.`, metadata: { storeId: row.id } });
      const url = `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}/s/${result.store.qrPublicCode}`;
      res.status(result.created ? 201 : 200).json({ data: { url, path: `/s/${result.store.qrPublicCode}`, created: result.created } });
    } catch (error) { apiError(res, error, 'Impossible de créer le QR de la boutique.'); }
  });
  app.get('/api/admin/merchants/:merchantId/assignments', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    res.json({ data: await commerce.listAssignments(merchant.id) });
  });

  app.put('/api/admin/merchants/:merchantId/store', requireAdmin, async (req, res) => {
    try { const row = await getOrCreateStore(req.params.merchantId, req.body || {}, 'admin', req); res.json({ data: publicStoreDetails(row) }); }
    catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer la boutique.'); }
  });
  app.get('/api/admin/merchants/:merchantId/products', requireAdmin, async (req, res) => {
    const row = await commerce.getStoreByMerchantId(req.params.merchantId); res.json({ data: row ? await commerce.listProducts(row.id) : [], storeId: row?.id || '' });
  });
  app.post('/api/admin/merchants/:merchantId/products', requireAdmin, async (req, res) => {
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); if (!row) return res.status(409).json({ error: 'Créez d’abord la boutique.' });
      const product = await commerce.saveProduct(row.id, validateProductInput(req.body || {})); await audit('admin', req, { action: 'product_created', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » créé.`, afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.params.merchantId, 'product_updated', { productId: product.id }); res.status(201).json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer le produit.'); }
  });
  app.put('/api/admin/merchants/:merchantId/products/:productId', requireAdmin, async (req, res) => {
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); const before = await commerce.getProduct(req.params.productId);
      if (!row || !before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
      const product = await commerce.saveProduct(row.id, validateProductInput(req.body || {}), before.id); await audit('admin', req, { action: 'product_updated', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » modifié.`, beforeData: productSnapshot(before), afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.params.merchantId, 'product_updated', { productId: product.id }); res.json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de modifier le produit.'); }
  });
  app.delete('/api/admin/merchants/:merchantId/products/:productId', requireAdmin, async (req, res) => {
    const row = await commerce.getStoreByMerchantId(req.params.merchantId); const before = await commerce.getProduct(req.params.productId);
    if (!row || !before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
    const product = await commerce.archiveProduct(row.id, before.id); await audit('admin', req, { action: 'product_archived', merchantId: req.params.merchantId, entityId: before.id, summary: `Produit « ${before.name} » archivé.`, beforeData: productSnapshot(before), metadata: { storeId: row.id } });
    merchantEvent(req.params.merchantId, 'product_updated', { productId: before.id }); res.json({ data: product });
  });
  app.get('/api/admin/merchant-orders', requireAdmin, async (req, res) => {
    const { page, limit, search, status } = pagination(req.query);
    res.json(await commerce.listOrders({ merchantId: safeText(req.query.merchantId, 100), status: ['pending','confirmed','preparing','ready','completed','cancelled'].includes(status) ? status : '', search, page, limit }));
  });
  app.get('/api/admin/merchants/:merchantId/orders', requireAdmin, async (req, res) => {
    const { page, limit, search, status } = pagination(req.query);
    res.json(await commerce.listOrders({ merchantId: req.params.merchantId, status: ['pending','confirmed','preparing','ready','completed','cancelled'].includes(status) ? status : '', search, page, limit }));
  });
  app.post('/api/admin/merchant-orders/:orderId/status', requireAdmin, async (req, res) => updateOrderStatus(req, res, req.params.orderId, 'admin'));
  app.post('/api/manager/merchants/:merchantId/orders/:orderId/status', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const order = await commerce.getOrder(req.params.orderId); if (!order || order.merchantId !== req.params.merchantId) return res.status(404).json({ error: 'Commande introuvable.' });
    return updateOrderStatus(req, res, order.id, 'manager');
  });
  app.post('/api/merchant/orders/:orderId/status', requireMerchant, async (req, res) => {
    const order = await commerce.getOrder(req.params.orderId); if (!order || order.merchantId !== req.merchant.id) return res.status(404).json({ error: 'Commande introuvable.' });
    return updateOrderStatus(req, res, order.id, 'merchant');
  });
  app.post('/api/admin/merchants/:merchantId/assignments', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const managerId = safeText(req.body?.managerId, 100); if (!managerId) return res.status(400).json({ error: 'Sélectionnez un gestionnaire.' });
    try { const manager = await ensureManagerExists(managerId); const permissions = Object.fromEntries(PERMISSION_KEYS.map((key) => [key, req.body?.[key] === true]));
      const assignment = await commerce.setAssignment(manager.id, merchant.id, permissions);
      await audit('admin', req, { action: 'manager_assignment', merchantId: merchant.id, entityId: merchant.id, summary: `Permissions marchand attribuées à « ${manager.displayName} ».`, afterData: assignment, metadata: { managerId: manager.id } });
      res.json({ data: assignment });
    } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’attribuer le marchand.'); }
  });
  app.delete('/api/admin/merchants/:merchantId/assignments/:managerId', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const assignment = await commerce.getAssignment(req.params.managerId, merchant.id); if (!assignment) return res.status(404).json({ error: 'Attribution introuvable.' });
    await commerce.removeAssignment(req.params.managerId, merchant.id);
    await audit('admin', req, { action: 'manager_unassignment', merchantId: merchant.id, entityId: merchant.id, summary: 'Attribution d’un marchand à un gestionnaire retirée.', beforeData: assignment, metadata: { managerId: req.params.managerId } });
    res.json({ ok: true });
  });
  app.get('/api/admin/merchants/:merchantId/audit', requireAdmin, async (req, res) => res.json(await commerce.listAudit({ merchantId: req.params.merchantId, page: Math.max(1, Number.parseInt(req.query.page, 10) || 1) })));
  app.get('/api/admin/merchant-stats', requireAdmin, async (_req, res) => res.json({ data: await commerce.stats() }));
  app.get('/api/manager/merchant-stats', requireManager, async (req, res) => {
    const merchants = await listManagerMerchants(req); const ids = new Set(merchants.filter((m) => req.manager.canManageMerchants || m.assignment?.canManageOrders || m.assignment?.canManageProducts).map((m) => m.id));
    const all = await Promise.all([...ids].map((id) => commerce.stats(id)));
    const summary = all.reduce((sum, item) => { for (const [key, value] of Object.entries(item)) sum[key] = (sum[key] || 0) + value; return sum; }, {});
    res.json({ data: summary });
  });

  app.get('/api/admin/merchants/events', requireAdmin, async (_req, res) => sendSse(res, () => true));
  app.get('/api/manager/merchants/events', requireManager, async (req, res) => {
    const merchants = await listManagerMerchants(req); const ids = new Set(merchants.map((m) => m.id)); sendSse(res, (event) => ids.has(event.merchantId));
  });
  app.get('/api/merchant/events', requireMerchant, async (req, res) => sendSse(res, (event) => event.merchantId === req.merchant.id));

  async function createMerchantAccount(req, res, role) {
    try {
      const username = safeText(req.body?.username, 80).toLowerCase(); const displayName = safeText(req.body?.displayName, 120);
      const email = safeText(req.body?.email, 254).toLowerCase(); const phone = validPhone(req.body?.phone, 'Téléphone du marchand');
      if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) throw new Error('L’identifiant doit contenir 3 à 80 caractères (lettres, chiffres, point, tiret ou soulignement).');
      if (!displayName) throw new Error('Le nom du marchand est obligatoire.');
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail n’est pas valide.');
      const managerId = role === 'manager' ? req.manager.id : safeText(req.body?.managerId, 100);
      if (role === 'admin' && managerId) await ensureManagerExists(managerId);
      const temporaryPassword = `M-${crypto.randomBytes(12).toString('base64url')}`; const passwordExpiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
      const merchant = await commerce.createMerchant({ username, displayName, email, phone, passwordHash: hashPassword(temporaryPassword), managerId, passwordExpiresAt });
      await audit(role, req, { action: 'account_created', merchantId: merchant.id, entityId: merchant.id, summary: `Compte marchand « ${merchant.displayName} » créé avec un mot de passe temporaire.`, afterData: accountSnapshot(merchant) });
      res.status(201).json({ data: merchant, temporaryPassword, expiresAt: passwordExpiresAt });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de créer le compte marchand.'); }
  }
  async function updateMerchantAccount(req, res, merchantId, role) {
    try {
      const before = await commerce.getMerchant(merchantId); if (!before) return res.status(404).json({ error: 'Marchand introuvable.' });
      const displayName = safeText(req.body?.displayName ?? before.displayName, 120); if (!displayName) throw new Error('Le nom du marchand est obligatoire.');
      const email = safeText(req.body?.email ?? before.email, 254).toLowerCase(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail n’est pas valide.');
      const phone = validPhone(req.body?.phone ?? before.phone, 'Téléphone du marchand');
      const managerId = role === 'manager' ? before.managerId : (Object.hasOwn(req.body || {}, 'managerId') ? safeText(req.body.managerId, 100) : before.managerId);
      if (role === 'manager' && managerId !== before.managerId) throw new Error('Un gestionnaire ne peut pas réattribuer un compte marchand.');
      if (managerId) await ensureManagerExists(managerId);
      const updated = await commerce.updateMerchant(merchantId, { ...before, displayName, email, phone, managerId });
      await audit(role, req, { action: 'account_updated', merchantId, entityId: merchantId, summary: `Profil marchand « ${updated.displayName} » modifié; sessions révoquées.`, beforeData: accountSnapshot(before), afterData: accountSnapshot(updated) });
      res.json({ data: updated });
    } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de modifier le compte marchand.'); }
  }
  async function updateOrderStatus(req, res, orderId, role) {
    const before = await commerce.getOrder(orderId); if (!before) return res.status(404).json({ error: 'Commande introuvable.' });
    const status = safeText(req.body?.status, 30);
    try {
      const order = await commerce.setOrderStatus(orderId, status, { actorType: role, actorId: role === 'merchant' ? req.merchant.id : role === 'manager' ? req.manager.id : String(process.env.ADMIN_USERNAME || 'admin') });
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
      await audit(role, req, { action: `order_${status}`, merchantId: order.merchantId, entityId: order.id, summary: `Commande ${order.reference} : statut ${status}.`,
        beforeData: { status: before.status }, afterData: { status: order.status }, metadata: { storeId: order.storeId, reference: order.reference } });
      merchantEvent(order.merchantId, 'order_status', { orderId: order.id, reference: order.reference, status: order.status });
      res.json({ data: order });
    } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de changer le statut de la commande.'); }
  }
  function accountSnapshot(row) {
    return row ? { id: row.id, username: row.username, displayName: row.displayName, managerId: row.managerId || null, status: row.status,
      hasEmail: Boolean(row.email), hasPhone: Boolean(row.phone), mustChangePassword: Boolean(row.mustChangePassword), deletedAt: row.deletedAt || null } : null;
  }
  function productSnapshot(row) {
    return row ? { id: row.id, storeId: row.storeId, name: row.name, sku: row.sku, priceXof: row.priceXof,
      stockQuantity: row.stockQuantity, trackStock: row.trackStock, status: row.status, hasImage: Boolean(row.imageData) } : null;
  }
};
