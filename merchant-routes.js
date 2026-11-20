'use strict';

const crypto = require('node:crypto');
const webPush = require('web-push');
const { REQUEST_ID_RE } = require('./merchant-commerce');
const { SECTORS } = require('./merchant-extras');

const MERCHANT_COOKIE = 'qria_merchant';
const SUPPLIER_COOKIE = 'qria_supplier';
const MANAGER_COOKIE = 'qria_manager';
const ADMIN_COOKIE = 'qria_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const TEMP_PASSWORD_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_LINK_TTL_MS = 30 * 60 * 1000;
const MAX_IMAGE_BYTES = 350 * 1024;
function generateTemporaryPassword(requestedLength) {
  const length = requestedLength == null || requestedLength === '' ? 18 : Number(requestedLength);
  if (![6, 18].includes(length)) throw new Error('Choisissez un mot de passe temporaire de 6 ou 18 caractères.');
  return crypto.randomBytes(Math.ceil(length * 3 / 4)).toString('base64url').slice(0, length);
}
const MAX_IMAGE_CHARS = 500_000;
const PERMISSION_KEYS = ['canManageStore', 'canManageProducts', 'canManageOrders', 'canCreateStoreQr', 'canViewAudit'];
const streams = new Set();
const loginAttempts = new Map();
const orderAttempts = new Map();
const trackingReadAttempts = new Map();
const trackingRecoveryAttempts = new Map();
const cancellationAttempts = new Map();
const rewardAttempts = new Map();
const adEventAttempts = new Map();
const passwordResetRequests = new Map();
const merchantResetAttempts = new Map();
const DEFAULT_MERCHANT_ORDER_POLICY = Object.freeze({ trackingEnabled: true, clientBrowserNotifications: true, clientCancellationEnabled: true, autoAcceptPendingCancellation: true, cancellationRequestsPer24h: 3 });
function allowRateLimitedAttempt(map, key, limit, windowMs) {
  const now = Date.now(); const current = map.get(key);
  if (current && now - current.start < windowMs) {
    if (current.count >= limit) return false;
    current.count += 1;
  } else map.set(key, { start: now, count: 1 });
  if (map.size > 5000) for (const [entryKey, entry] of map) if (now - entry.start >= windowMs) map.delete(entryKey);
  return true;
}

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
const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
function openingHoursText(value) {
  if (typeof value === 'string' || typeof value === 'number') return safeText(value, 500);
  if (Array.isArray(value)) return safeText(value.map((row) => typeof row === 'string' ? row : '').filter(Boolean).join(' · '), 500);
  if (value && typeof value === 'object') return safeText(Object.entries(value).filter(([, hours]) => typeof hours === 'string' || typeof hours === 'number').map(([day, hours]) => `${day}: ${hours}`).join(' · '), 500);
  return '';
}
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
const MEDIA_URL_RE = /^\/media\/merchant\/([0-9a-f-]{36})$/i;
const THEME_FONTS = Object.freeze(['Poppins','Montserrat','Roboto','Open Sans','Lato','Inter','Nunito','Raleway','Ubuntu','Oswald','Playfair Display','Merriweather','Source Sans 3','DM Sans','Manrope','Rubik','Work Sans','Lora','Libre Baskerville','Archivo']);
const TYPOGRAPHY_LABELS = Object.freeze({ shopName:['Nom de la boutique',30], title:['Titres',24], subtitle:['Sous-titres',18], product:['Produits',16], price:['Prix',17], description:['Descriptions',16], category:['Catégories',16], button:['Boutons',16], advertisement:['Publicités',16], delivery:['Livraison',16], promotion:['Promotions',16], other:['Autres textes importants',16] });
const DEFAULT_TYPOGRAPHY = Object.freeze(Object.fromEntries(Object.entries(TYPOGRAPHY_LABELS).map(([key, [, size]]) => [key, {
  size, weight: key === 'shopName' || key === 'title' || key === 'price' ? 700 : 400, italic: false, decoration: 'none', lineHeight: 1.4,
  letterSpacing: 0, align: 'left', transform: 'none', color: '#162622', opacity: 1,
}])));
const DEFAULT_THEME = Object.freeze({ template: 'modern', colors: { primary: '#0d725c', secondary: '#d4af37', background: '#f3f7f4', text: '#162622', button: '#0d725c', card: '#ffffff' }, font: 'Inter', textSize: 'normal', typography: DEFAULT_TYPOGRAPHY, buttonShape: 'rounded', cardShape: 'rounded', menuStyle: 'pills', productLayout: 'grid', sections: { description: true, categories: true, contact: true, hours: true, contacts: true }, sectionOrder: ['cover', 'intro', 'categories', 'products', 'contact'] });
function mediaIdFromUrl(value) { return MEDIA_URL_RE.exec(String(value || ''))?.[1] || ''; }
const MAX_ORDER_PHOTO_BYTES = 300 * 1024;
function stripJpegMetadata(input) {
  const bytes=Buffer.from(input);if(bytes.length<4||bytes[0]!==0xff||bytes[1]!==0xd8)throw new Error('La photo JPEG ne peut pas être lue.');
  const chunks=[bytes.subarray(0,2)];let offset=2;
  while(offset<bytes.length){
    if(bytes[offset]!==0xff){chunks.push(bytes.subarray(offset));break;}
    const markerStart=offset;while(offset<bytes.length&&bytes[offset]===0xff)offset++;
    if(offset>=bytes.length)throw new Error('La photo JPEG est incomplète.');
    const marker=bytes[offset++];
    if(marker===0xda){chunks.push(bytes.subarray(markerStart));break;}
    if(marker===0xd9){chunks.push(bytes.subarray(markerStart,offset));if(offset<bytes.length)chunks.push(bytes.subarray(offset));break;}
    if(marker===0x01||(marker>=0xd0&&marker<=0xd7)){chunks.push(bytes.subarray(markerStart,offset));continue;}
    if(offset+2>bytes.length)throw new Error('La photo JPEG est incomplète.');
    const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)throw new Error('La photo JPEG est incomplète.');
    const end=offset+length;if(marker!==0xe1&&marker!==0xed)chunks.push(bytes.subarray(markerStart,end));offset=end;
  }
  return Buffer.concat(chunks);
}
function stripWebpMetadata(input) {
  const bytes=Buffer.from(input);if(bytes.length<20||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP'||bytes.readUInt32LE(4)+8>bytes.length)throw new Error('La photo WEBP ne peut pas être lue.');
  const chunks=[];let offset=12;const end=bytes.readUInt32LE(4)+8;
  while(offset+8<=end){const tag=bytes.toString('ascii',offset,offset+4);const size=bytes.readUInt32LE(offset+4);const chunkEnd=offset+8+size+(size&1);if(chunkEnd>end)throw new Error('La photo WEBP est incomplète.');
    if(tag!=='EXIF'&&tag!=='XMP '){const chunk=Buffer.from(bytes.subarray(offset,chunkEnd));if(tag==='VP8X'&&size>=1)chunk[8]&=~0x0c;chunks.push(chunk);}offset=chunkEnd;}
  if(offset!==end)throw new Error('La photo WEBP est incomplète.');
  const body=Buffer.concat([Buffer.from('WEBP'),...chunks]);const header=Buffer.alloc(8);header.write('RIFF',0);header.writeUInt32LE(body.length,4);return Buffer.concat([header,body]);
}
function validateOrderTablePhoto(value) {
  const raw=String(value||'');if(raw.length>450_000)throw new Error('La photo dépasse la limite autorisée de 300 Ko.');
  const match=/^data:image\/(jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);if(!match)throw new Error('La photo doit être une image JPEG ou WEBP prise avec la caméra.');
  let bytes=Buffer.from(match[2],'base64');if(!bytes.length||bytes.toString('base64')!==match[2])throw new Error('La photo n’est pas un fichier image valide.');
  const mime=match[1].toLowerCase();
  if(mime==='jpeg'){if(bytes.length<3||bytes[0]!==0xff||bytes[1]!==0xd8||bytes[2]!==0xff)throw new Error('La photo JPEG ne correspond pas au format annoncé.');bytes=stripJpegMetadata(bytes);}
  else {if(bytes.length<12||bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')throw new Error('La photo WEBP ne correspond pas au format annoncé.');bytes=stripWebpMetadata(bytes);}
  if(bytes.length>MAX_ORDER_PHOTO_BYTES)throw new Error('La photo dépasse la limite autorisée de 300 Ko après suppression des métadonnées.');
  return {mimeType:`image/${mime}`,bytes};
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
async function validateImageReference(value, field, merchantId, commerce) {
  const raw = String(value || '').trim(); if (!raw) return '';
  if (raw.startsWith('data:')) return validateImage(raw, field);
  const id = mediaIdFromUrl(raw);
  if (!id) throw new Error(`${field} doit provenir du stockage sécurisé Oymike Tech.`);
  const media = await commerce.getMedia(id);
  if (!media || media.merchantId !== merchantId) throw new Error(`${field} n’est pas accessible à ce compte.`);
  return `/media/merchant/${id}`;
}
function sanitizeTheme(input, previous = DEFAULT_THEME) {
  const raw = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const base = previous && typeof previous === 'object' ? previous : DEFAULT_THEME;
  const colors = { ...(base.colors || DEFAULT_THEME.colors), ...(raw.colors || {}) };
  const safeColors = {};
  for (const key of ['primary','secondary','background','text','button','card']) safeColors[key] = /^#[0-9a-f]{6}$/i.test(String(colors[key] || '')) ? String(colors[key]).toLowerCase() : DEFAULT_THEME.colors[key];
  const allowedOrder = ['cover','intro','categories','products','contact'];
  const requestedOrder = Array.isArray(raw.sectionOrder) ? raw.sectionOrder.filter((key) => allowedOrder.includes(key)) : (base.sectionOrder || DEFAULT_THEME.sectionOrder);
  const sectionOrder = [...new Set(requestedOrder)]; for (const key of allowedOrder) if (!sectionOrder.includes(key)) sectionOrder.push(key);
  const inputSections = raw.sections && typeof raw.sections === 'object' ? raw.sections : {};
  const baseSections = base.sections || DEFAULT_THEME.sections;
  const sections = Object.fromEntries(['description','categories','contact','hours','contacts'].map((key) => [key, Object.hasOwn(inputSections, key) ? inputSections[key] === true : baseSections[key] !== false]));
  const enumVal = (value, allowed, fallback) => allowed.includes(value) ? value : fallback;
  const rawTypography = raw.typography && typeof raw.typography === 'object' && !Array.isArray(raw.typography) ? raw.typography : {};
  const baseTypography = base.typography && typeof base.typography === 'object' ? base.typography : DEFAULT_TYPOGRAPHY;
  const typography = Object.fromEntries(Object.entries(TYPOGRAPHY_LABELS).map(([key]) => {
    const supplied = rawTypography[key] && typeof rawTypography[key] === 'object' ? rawTypography[key] : {};
    const previous = baseTypography[key] || DEFAULT_TYPOGRAPHY[key];
    const number = (value, fallback, min, max, integer = false) => {
      const parsed = Number(value); if (!Number.isFinite(parsed)) return fallback;
      const clamped = Math.max(min, Math.min(max, parsed)); return integer ? Math.round(clamped) : Math.round(clamped * 100) / 100;
    };
    const color = /^#[0-9a-f]{6}$/i.test(String(supplied.color || previous.color || '')) ? String(supplied.color || previous.color).toLowerCase() : DEFAULT_TYPOGRAPHY[key].color;
    return [key, {
      size: number(supplied.size, previous.size, 16, 30, true), weight: number(supplied.weight, previous.weight, 300, 900, true),
      italic: Object.hasOwn(supplied, 'italic') ? supplied.italic === true : previous.italic === true,
      decoration: enumVal(supplied.decoration || previous.decoration, ['none','underline'], 'none'),
      lineHeight: number(supplied.lineHeight, previous.lineHeight, 0.9, 2.2), letterSpacing: number(supplied.letterSpacing, previous.letterSpacing, -0.05, 0.3),
      align: enumVal(supplied.align || previous.align, ['left','center','right'], 'left'),
      transform: enumVal(supplied.transform || previous.transform, ['none','uppercase','lowercase','capitalize'], 'none'),
      color, opacity: number(supplied.opacity, previous.opacity, 0.35, 1),
    }];
  }));
  return { template: enumVal(raw.template || base.template, ['modern','minimal','elegant','professional','boutique','restaurant'], 'modern'), colors: safeColors,
    font: THEME_FONTS.includes(raw.font || base.font) ? raw.font || base.font : 'Inter', typography, textSize: enumVal(raw.textSize || base.textSize, ['small','normal','large'], 'normal'),
    buttonShape: enumVal(raw.buttonShape || base.buttonShape, ['square','rounded','pill'], 'rounded'),
    cardShape: enumVal(raw.cardShape || base.cardShape, ['square','rounded','soft'], 'rounded'),
    menuStyle: enumVal(raw.menuStyle || base.menuStyle, ['plain','pills','underline'], 'pills'),
    productLayout: enumVal(raw.productLayout || base.productLayout, ['grid','list'], 'grid'), sections, sectionOrder };
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
function normalizePublicContactPhone(value) {
  const phone = safeText(value, 32);
  if (!phone || !/^\+?[0-9().\s-]{7,32}$/.test(phone)) return '';
  const enteredDigits = phone.replace(/\D/g, '');
  if (enteredDigits.length < 7) return '';
  let internationalDigits; let isCoteDIvoire = false;
  if (phone.startsWith('+')) { internationalDigits = enteredDigits; isCoteDIvoire = internationalDigits.startsWith('225'); }
  else if (enteredDigits.startsWith('00')) { internationalDigits = enteredDigits.slice(2); isCoteDIvoire = internationalDigits.startsWith('225'); }
  else if (enteredDigits.startsWith('225')) { internationalDigits = enteredDigits; isCoteDIvoire = true; }
  else { internationalDigits = `225${enteredDigits}`; isCoteDIvoire = true; }
  if (internationalDigits.length < 7 || internationalDigits.length > 15) return '';
  if (isCoteDIvoire && internationalDigits.length - 3 < 8) return '';
  return `+${internationalDigits}`;
}
function publicContactActionUrls(store, { privateAccess = false } = {}) {
  if (!store || typeof store !== 'object') return {};
  const sections = store.theme && typeof store.theme === 'object' && store.theme.sections && typeof store.theme.sections === 'object' ? store.theme.sections : {};
  if (!privateAccess && (sections.contact === false || sections.contacts === false)) return {};
  const phone = normalizePublicContactPhone(store.phone);
  const whatsapp = normalizePublicContactPhone(store.whatsapp);
  return {
    ...(phone ? { phoneContactUrl: `tel:${phone}` } : {}),
    ...(whatsapp ? { whatsappContactUrl: `https://wa.me/${whatsapp.slice(1)}` } : {}),
  };
}
function publicStorefrontData(store) {
  if (!store) return null;
  const { phone, whatsapp, phoneContactUrl, whatsappContactUrl, ...safe } = store;
  return { ...safe, ...publicContactActionUrls(store) };
}
function customerFingerprint(secret, purpose, value) {
  return crypto.createHmac('sha256', String(secret || '')).update(`${purpose}\0${String(value || '')}`).digest('hex');
}
function customerPhoneDigits(value) { return String(value || '').replace(/\D/g, ''); }
function statusLabelsForPush(status) { return ({ confirmed: 'confirmée', preparing: 'en préparation', ready: 'prête', out_for_delivery: 'en livraison', completed: 'terminée / livrée', cancelled: 'annulée', rejected: 'refusée par la boutique' })[status] || status; }
function normalizeOrderPolicy(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const max = Number(raw.cancellationRequestsPer24h);
  return { trackingEnabled: raw.trackingEnabled !== false, clientBrowserNotifications: raw.clientBrowserNotifications !== false,
    clientCancellationEnabled: raw.clientCancellationEnabled !== false, autoAcceptPendingCancellation: raw.autoAcceptPendingCancellation !== false,
    cancellationRequestsPer24h: Number.isFinite(max) ? Math.max(1, Math.min(10, Math.round(max))) : 3 };
}
function publicOrder(order) {
  return { reference: order.reference, status: order.status, customerName: order.customerName, customerPhone: order.customerPhone,
    customerEmail: order.customerEmail, deliveryAddress: order.deliveryAddress, note: order.note, servicePointName: order.servicePointName || '', items: order.items,
    totalAmountXof: order.totalAmountXof, deliveryFeeXof: Number(order.deliveryFeeXof)||0, discountAmountXof: Number(order.discountAmountXof)||0, currency: order.currency,
    events: (order.events || []).map((event) => ({ status: event.status, note: event.note, createdAt: event.createdAt })),
    cancellationRequests: (order.cancellationRequests || []).map((request) => ({ id: request.id, reason: request.reason || '', status: request.status,
      decisionNote: request.decisionNote || '', requestedAt: request.requestedAt, decidedAt: request.decidedAt || null })),
    createdAt: order.createdAt, updatedAt: order.updatedAt };
}
function publicMerchantAccount(merchant) {
  if (!merchant) return null;
  const { passwordHash, tokenVersion, passwordResetTokenHash, ...safe } = merchant;
  return safe;
}
function publicStoreDetails(store) {
  if (!store) return null;
  const { qrPublicCode, qrEnabled, qrScanCount, ...safe } = store;
  return { ...safe, openingHours: openingHoursText(store.openingHours) };
}
function actorInfo(role, req) {
  if (role === 'merchant') return { actor: `${req.merchant.displayName} (@${req.merchant.username})`, actorType: 'merchant', actorId: req.merchant.id, managerId: req.merchant.managerId || null };
  if (role === 'manager') return { actor: `${req.manager.displayName} (@${req.manager.username})`, actorType: 'manager', actorId: req.manager.id, managerId: req.manager.id };
  if (role === 'client') return { actor: 'Client sans compte', actorType: 'client', actorId: null, managerId: null };
  return { actor: `PDG (@${String(process.env.ADMIN_USERNAME || 'admin')})`, actorType: 'admin', actorId: String(process.env.ADMIN_USERNAME || 'admin'), managerId: null };
}

module.exports = function registerMerchantRoutes(deps) {
  const { app, store, commerce, extras, suppliers, requireAdmin, requireManager, checkSameOrigin, apiError, sessionSecret, isProduction, publicBaseUrl, setMerchantSession, clearMerchantSession,
    setSupplierSession,clearSupplierSession,clearAdminSession,clearManagerSession } = deps;
  const vapidPublicKey = String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || '').trim();
  const vapidPrivateKey = String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || '').trim();
  const vapidSubject = String(process.env.WEB_PUSH_SUBJECT || (publicBaseUrl ? `mailto:admin@${new URL(publicBaseUrl).hostname}` : '')).trim();
  let pushConfigured = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
  if (pushConfigured) { try { webPush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey); } catch (_) { pushConfigured = false; } }
  async function getMerchantOrderPolicy() {
    try { const settings = await store.getSettings(); return normalizeOrderPolicy(settings?.merchantOrderPolicy); }
    catch (_) { return normalizeOrderPolicy(DEFAULT_MERCHANT_ORDER_POLICY); }
  }
  function publicTrackingOrder(order, shop, policy, trackingCode = '') {
    return { ...publicOrder(order), trackingCode, store: shop ? { name: safeText(shop.name, 120), slug: safeText(shop.slug, 70),
      ...publicContactActionUrls(shop, { privateAccess: true }) } : null,
      orderPolicy: { clientCancellationEnabled: policy.clientCancellationEnabled, clientBrowserNotifications: policy.clientBrowserNotifications } };
  }

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
    const current = readCookie(req, MERCHANT_COOKIE);
    const roleCookies = [current,readCookie(req,ADMIN_COOKIE),readCookie(req,MANAGER_COOKIE),readCookie(req,SUPPLIER_COOKIE)].filter(Boolean);
    if(roleCookies.length>1){clearMerchantSession(res);clearSupplierSession?.(res);clearAdminSession?.(res);clearManagerSession?.(res);
      return res.status(401).json({ error: 'Sessions de rôles différentes détectées. Reconnectez-vous.' });}
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
  function sendMedia(res, media) {
    res.setHeader('Content-Type', media.mimeType); res.setHeader('Content-Length', String(media.byteSize));
    res.setHeader('Cache-Control', 'private, max-age=300'); res.setHeader('X-Content-Type-Options', 'nosniff'); return res.send(media.bytes);
  }
  function sendOrderTablePhoto(res, photo, reference) {
    const ext=photo.mimeType==='image/webp'?'webp':'jpg';
    res.setHeader('Content-Type',photo.mimeType);res.setHeader('Content-Length',String(photo.byteSize));
    res.setHeader('Content-Disposition',`attachment; filename="table-${String(reference||'commande').replace(/[^A-Za-z0-9_-]/g,'')}.${ext}"`);
    res.setHeader('Cache-Control','private, no-store');res.setHeader('X-Content-Type-Options','nosniff');return res.send(photo.bytes);
  }
  async function saveMediaUpload(req, res, merchantId) {
    const normalized = validateImage(req.body?.dataUrl, 'Image');
    const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(normalized);
    if (!match) return res.status(400).json({ error: 'Format non accepté. Utilisez JPG, JPEG, PNG ou WEBP.' });
    const saved = await commerce.saveMedia(merchantId, { mimeType: `image/${match[1].toLowerCase()}`, bytes: Buffer.from(match[2], 'base64') });
    res.status(201).json({ data: saved });
  }
  async function sendMerchantPush(merchantId, payload) {
    if (!pushConfigured) return;
    const subscriptions = await commerce.listPushSubscriptions(merchantId).catch(() => []);
    await Promise.all(subscriptions.map(async (row) => {
      try { await webPush.sendNotification(row.subscription, JSON.stringify(payload)); }
      catch (error) { if (error.statusCode === 404 || error.statusCode === 410) await commerce.removePushSubscription(merchantId, row.endpoint).catch(() => {}); }
    }));
  }

  async function audit(role, req, { action, merchantId, entityId, summary, beforeData = null, afterData = null, metadata = {} }) {
    const actor = actorInfo(role, req);
    await store.addAudit({ ...actor, action, entityType: 'merchant', entityId: String(entityId || merchantId), summary,
      beforeData, afterData, result: 'success', metadata: { merchantId, ...metadata } });
  }
  async function auditDenial(req, summary, merchantId = '') {
    const actor = req.manager ? actorInfo('manager', req) : req.merchant ? actorInfo('merchant', req) : actorInfo('admin', req);
    await store.addAudit({ ...actor, action: 'authorization_denied', entityType: 'merchant', entityId: merchantId || 'scope', summary, result: 'denied', metadata: { merchantId: merchantId || null } }).catch(() => {});
  }
  async function auditPublicRecoveryFailure(req, { storeId = '', slug = '', reason = 'invalid_credentials' } = {}) {
    const actor = actorInfo('client', req);
    await store.addAudit({ ...actor, action: 'public_order_recovery_failed', entityType: 'merchant', entityId: storeId || safeText(slug, 80) || 'public-tracking',
      summary: 'Échec d’une tentative de récupération sécurisée de commandes.', result: 'failure',
      metadata: { storeId: storeId || null, shopSlug: safeText(slug, 80) || null, reason, ipHash: customerFingerprint(sessionSecret, 'order-recovery-ip-v1', req.ip || 'unknown') } }).catch(() => {});
  }
  function customerBlockHashes(storeId, phone, requestId = '', ip = '') {
    const digits = customerPhoneDigits(phone);
    return {
      phoneHash: customerFingerprint(sessionSecret, 'merchant-customer-block-phone-v1', `${storeId}\0${digits}`),
      requestHash: requestId ? customerFingerprint(sessionSecret, 'merchant-customer-block-request-v1', `${storeId}\0${requestId}`) : '',
      ipHash: customerFingerprint(sessionSecret, 'merchant-customer-block-ip-v1', `${storeId}\0${ip || 'unknown'}`),
      phoneLast4: digits.slice(-4),
    };
  }
  async function createCustomerBlock(req, res, { role, merchantId, storeId }) {
    try {
      const phone = validPhone(req.body?.phone, 'Téléphone du client');
      const reason = safeText(req.body?.reason, 300).replace(/[\t\n\r ]+/gu, ' ');
      if (customerPhoneDigits(phone).length < 7) throw new Error('Saisissez un numéro de téléphone valide.');
      if (reason.length < 4) throw new Error('Indiquez un motif de blocage d’au moins 4 caractères.');
      const hashes = customerBlockHashes(storeId, phone);
      const actorId = role === 'merchant' ? req.merchant.id : role === 'manager' ? req.manager.id : String(process.env.ADMIN_USERNAME || 'admin');
      const result = await commerce.createCustomerBlock({ storeId, merchantId, phoneHash: hashes.phoneHash, phoneLast4: hashes.phoneLast4,
        reason, actorType: role, actorId });
      if (!result.idempotent) {
        await audit(role, req, { action: 'customer_block_created', merchantId, entityId: result.block.id,
          summary: `Numéro client se terminant par ${hashes.phoneLast4} bloqué pour la boutique.`, afterData: { status: 'active', phoneLast4: hashes.phoneLast4, reason },
          metadata: { storeId, phoneLast4: hashes.phoneLast4 } });
        merchantEvent(merchantId, 'customer_block_updated', { blockId: result.block.id, status: 'active' });
      }
      res.setHeader('Cache-Control', 'no-store'); return res.status(result.idempotent ? 200 : 201).json({ data: result.block, idempotent: result.idempotent });
    } catch (error) {
      if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      return apiError(res, error, 'Impossible d’enregistrer le blocage du client.');
    }
  }
  async function unblockCustomer(req, res, { role, storeId = '' }) {
    const blockId = safeText(req.params.blockId, 100); const reason = safeText(req.body?.reason, 300).replace(/[\t\n\r ]+/gu, ' ');
    const beforeResult = await commerce.listCustomerBlocks({ storeId, blockId, limit: 1 }); const before = beforeResult.data[0];
    if (!before) return res.status(404).json({ error: 'Entrée introuvable.' });
    const actorId = role === 'merchant' ? req.merchant.id : role === 'manager' ? req.manager.id : String(process.env.ADMIN_USERNAME || 'admin');
    try {
      const result = await commerce.unblockCustomerBlock(blockId, { storeId, actorType: role, actorId, reason });
      if (!result) return res.status(404).json({ error: 'Entrée introuvable.' });
      if (!result.idempotent) {
        await audit(role, req, { action: 'customer_block_removed', merchantId: result.merchantId, entityId: blockId,
          summary: `Numéro client se terminant par ${before.phoneLast4} débloqué.`, beforeData: { status: before.status },
          afterData: { status: 'unblocked', reason }, metadata: { storeId: before.storeId, phoneLast4: before.phoneLast4 } });
        merchantEvent(result.merchantId, 'customer_block_updated', { blockId, status: 'unblocked' });
      }
      res.setHeader('Cache-Control', 'no-store'); return res.json({ data: result.block, idempotent: result.idempotent });
    } catch (error) {
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      return apiError(res, error, 'Impossible de débloquer ce numéro.');
    }
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
  function merchantQrPayload(req, row) {
    if (!row) return null;
    const code = row.qrPublicCode || '';
    const path = code ? `/s/${code}` : '';
    const baseUrl = publicBaseUrl || `${req.protocol}://${req.get('host')}`;
    return { path, url: path ? `${baseUrl}${path}` : '', created: Boolean(code), enabled: Boolean(code && row.qrEnabled !== false),
      store: { id: row.id, merchantId: row.merchantId, name: row.name, slug: row.slug } };
  }
  async function getMerchantQr(req, res, role) {
    const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: role === 'admin' });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const row = await commerce.getStoreByMerchantId(merchant.id);
    return res.json({ data: merchantQrPayload(req, row) });
  }
  async function recordMerchantQrView(req, res, role) {
    try {
      const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: role === 'admin' });
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const row = await commerce.getStoreByMerchantId(merchant.id);
      if (!row || row.merchantId !== merchant.id) return res.status(409).json({ error: 'Configurez d’abord la boutique de ce compte marchand.' });
      if (!row.qrPublicCode) return res.status(409).json({ error: 'Aucun QR n’a encore été créé pour cette boutique.' });
      await audit(role, req, { action: 'qr_viewed', merchantId: merchant.id, entityId: row.id,
        summary: `QR de la boutique « ${row.name} » consulté.`, metadata: { storeId: row.id } });
      return res.json({ data: merchantQrPayload(req, row) });
    } catch (error) { return apiError(res, error, 'Impossible d’enregistrer la consultation du QR.'); }
  }
  async function setMerchantQrState(req, res, role, enabled) {
    try {
      const merchantId = req.params.merchantId;
      const merchant = await commerce.getMerchant(merchantId, { includeDeleted: role === 'admin' });
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const row = await commerce.getStoreByMerchantId(merchant.id);
      if (!row || row.merchantId !== merchant.id) return res.status(409).json({ error: 'Configurez d’abord la boutique de ce compte marchand.' });
      if (enabled && merchant.deletedAt) return res.status(409).json({ error: 'Un compte archivé ne peut pas activer son QR.' });
      if (enabled && merchant.status !== 'active') return res.status(409).json({ error: 'Réactivez le compte marchand avant d’activer son QR.' });
      if (enabled && (row.status !== 'active' || row.isPublished !== true)) return res.status(409).json({ error: 'Activez et publiez la boutique avant d’activer son QR.' });

      const beforeEnabled = Boolean(row.qrPublicCode && row.qrEnabled !== false);
      const result = await commerce.setStoreQrEnabled(row.id, enabled);
      if (!result || result.store.merchantId !== merchant.id) return res.status(404).json({ error: 'Boutique introuvable.' });
      const afterEnabled = Boolean(result.store.qrPublicCode && result.store.qrEnabled !== false);
      const action = enabled ? (result.created ? 'qr_created' : result.changed ? 'qr_enabled' : 'qr_viewed') : 'qr_disabled';
      const summary = enabled
        ? result.created ? `QR de la boutique « ${row.name} » créé et activé.` : result.changed ? `QR de la boutique « ${row.name} » activé.` : `QR de la boutique « ${row.name} » consulté.`
        : `QR de la boutique « ${row.name} » désactivé; son lien et son historique sont conservés.`;
      await audit(role, req, { action, merchantId, entityId: row.id, summary,
        beforeData: { qrEnabled: beforeEnabled, qrExists: Boolean(row.qrPublicCode) },
        afterData: { qrEnabled: afterEnabled, qrExists: Boolean(result.store.qrPublicCode) },
        metadata: { storeId: row.id, qrCreated: result.created === true } });
      if (result.created || result.changed) merchantEvent(merchantId, 'store_qr_updated', { enabled: afterEnabled });
      const data = merchantQrPayload(req, result.store);
      // Keep the legacy POST response's `created` meaning while exposing the durable state explicitly.
      data.created = result.created === true;
      data.changed = result.changed === true;
      return res.status(enabled && result.created ? 201 : 200).json({ data });
    } catch (error) { return apiError(res, error, enabled ? 'Impossible d’activer le QR de la boutique.' : 'Impossible de désactiver le QR de la boutique.'); }
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
      const data = await validateStoreInput(body, { firstCreate: true, merchantId, commerce });
      existing = await commerce.createStore(merchantId, data);
      await audit(role, req, { action: 'store_created', merchantId, entityId: existing.id, summary: `Boutique « ${existing.name} » créée.`, afterData: storeSnapshot(existing) });
      merchantEvent(merchantId, 'store_updated');
      return existing;
    }
    const data = await validateStoreInput(body, { previous: existing, role, merchantId, commerce });
    const updated = await commerce.updateStore(existing.id, data);
    await audit(role, req, { action: 'store_updated', merchantId, entityId: existing.id, summary: `Boutique « ${updated.name} » modifiée.`, beforeData: storeSnapshot(existing), afterData: storeSnapshot(updated) });
    merchantEvent(merchantId, 'store_updated');
    return updated;
  }
  function storeSnapshot(row) {
    return row ? { id: row.id, merchantId: row.merchantId, slug: row.slug, name: row.name, status: row.status, isPublished: row.isPublished,
      hasLogo: Boolean(row.logo), hasPhone: Boolean(row.phone), hasAddress: Boolean(row.address), descriptionLength: String(row.description || '').length } : null;
  }
  async function validateStoreInput(input, { firstCreate = false, previous = null, role = '', merchantId, commerce }) {
    const name = safeText(input?.name ?? previous?.name, 120);
    if (!name) throw new Error('Le nom de la boutique est obligatoire.');
    const requestedSector = safeText(input?.sector ?? previous?.sector ?? 'general', 30).toLowerCase();
    if (!SECTORS.has(requestedSector)) throw new Error('Choisissez un secteur reconnu : général, restaurant, maquis, quincaillerie, vêtements ou espace plein air.');
    const email = safeText(input?.email ?? previous?.email, 254).toLowerCase();
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail de la boutique n’est pas valide.');
    const slug = firstCreate ? normalizeSlug(input?.slug || name) : previous.slug;
    const managerOrAdmin = role !== 'merchant';
    const status = managerOrAdmin && ['active', 'suspended'].includes(input?.status) ? input.status : (previous?.status || 'active');
    const logoValue = await validateImageReference(input?.logo ?? previous?.logo, 'Logo de boutique', merchantId, commerce);
    const coverImageUrl = await validateImageReference(input?.coverImageUrl ?? previous?.coverImageUrl, 'Photo de couverture', merchantId, commerce);
    const deliveryFeeXof = Number(input?.deliveryFeeXof ?? previous?.deliveryFeeXof ?? 0);
    if (!Number.isSafeInteger(deliveryFeeXof) || deliveryFeeXof < 0 || deliveryFeeXof > 2_000_000_000) throw new Error('Les frais de livraison doivent être un montant XOF valide.');
    const requireTablePhoto = ['restaurant','maquis'].includes(requestedSector) && (input?.requireTablePhoto === undefined ? previous?.requireTablePhoto === true : input.requireTablePhoto === true);
    return { slug, name, sector: requestedSector, description: safeText(input?.description ?? previous?.description, 3000), logo: logoValue,
      coverImageUrl, theme: sanitizeTheme(input?.theme, previous?.theme || DEFAULT_THEME),
      openingHours: openingHoursText(input?.openingHours ?? previous?.openingHours),
      deliveryEnabled: input?.deliveryEnabled === undefined ? previous?.deliveryEnabled !== false : input.deliveryEnabled === true,
      pickupEnabled: input?.pickupEnabled === undefined ? previous?.pickupEnabled !== false : input.pickupEnabled === true,
      deliveryFeeXof, acceptsOrders: input?.acceptsOrders === undefined ? previous?.acceptsOrders !== false : input.acceptsOrders === true, requireTablePhoto,
      phone: validPhone(input?.phone ?? previous?.phone, 'Téléphone de la boutique'), whatsapp: validPhone(input?.whatsapp ?? previous?.whatsapp, 'WhatsApp'), email,
      address: safeText(input?.address ?? previous?.address, 500), deliveryNote: safeText(input?.deliveryNote ?? previous?.deliveryNote, 1000), status,
      isPublished: input?.isPublished === undefined ? previous?.isPublished === true : input.isPublished === true };
  }
  async function validateProductInput(input, merchantId, commerce, previous = null) {
    const name = safeText(input?.name ?? previous?.name, 120); if (!name) throw new Error('Le nom du produit est obligatoire.');
    const priceXof = Number(input?.priceXof ?? previous?.priceXof); const stockQuantity = Number(input?.stockQuantity ?? previous?.stockQuantity ?? 0);
    if (!Number.isSafeInteger(priceXof) || priceXof < 0 || priceXof > 2_000_000_000) throw new Error('Le prix doit être un montant entier en XOF, égal ou supérieur à zéro.');
    if (!Number.isSafeInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1_000_000) throw new Error('Le stock doit être un nombre entier entre 0 et 1 000 000.');
    let rawImages;
    if (Array.isArray(input?.imageUrls)) rawImages = input.imageUrls;
    else if (Object.hasOwn(input || {}, 'imageData')) {
      const submittedImage = String(input.imageData || '');
      const previousImages = Array.isArray(previous?.imageUrls) ? previous.imageUrls : (previous?.imageData ? [previous.imageData] : []);
      rawImages = previous && submittedImage === String(previous.imageData || '') ? previousImages : (submittedImage ? [submittedImage] : []);
    } else rawImages = previous?.imageUrls || (previous?.imageData ? [previous.imageData] : []);
    if (rawImages.length > 8) throw new Error('Un produit peut avoir au maximum 8 photos.');
    const imageUrls = await Promise.all(rawImages.map((url) => validateImageReference(url, 'Photo du produit', merchantId, commerce)));
    const compareAtInput = Object.hasOwn(input || {}, 'compareAtPriceXof') ? input.compareAtPriceXof : previous?.compareAtPriceXof;
    const compareAtPriceXof = compareAtInput === '' || compareAtInput == null ? null : Number(compareAtInput);
    if (compareAtPriceXof != null && (!Number.isSafeInteger(compareAtPriceXof) || compareAtPriceXof <= priceXof || compareAtPriceXof > 2_000_000_000)) throw new Error('Le prix promotionnel de référence doit être supérieur au prix actuel.');
    const rawVariants = Array.isArray(input?.variants) ? input.variants : (Array.isArray(previous?.variants) ? previous.variants : []);
    const variants = rawVariants.slice(0, 20).map((row) => ({ name: safeText(row?.name, 60), values: (Array.isArray(row?.values) ? row.values : String(row?.values || '').split(',')).map((value) => safeText(value, 60)).filter(Boolean).slice(0, 30) })).filter((row) => row.name && row.values.length);
    const status = ['active', 'unavailable'].includes(input?.status) ? input.status : (previous?.status === 'unavailable' ? 'unavailable' : 'active');
    const sortOrder = Number(input?.sortOrder ?? previous?.sortOrder ?? 0);
    return { name, description: safeText(input?.description ?? previous?.description, 2000), sku: safeText(input?.sku ?? previous?.sku, 80), priceXof,
      compareAtPriceXof, category: safeText(input?.category ?? previous?.category, 80), variants,
      stockQuantity, trackStock: input?.trackStock === undefined ? previous?.trackStock !== false : input.trackStock === true,
      imageUrls, imageData: imageUrls[0] || '', status: input?.status === undefined ? (previous?.status || status) : status,
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
  // Self-service reset link, shared with the manager console: identity is verified by a manager/PDG first.
  app.get('/merchant/reset-password', async (_req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.sendFile(require('node:path').join(__dirname, 'public', 'merchant-reset-password.html'));
  });
  app.post('/api/merchant/auth/reset-password', checkSameOrigin, async (req, res) => {
    const key = req.ip || 'unknown';
    if (!allowRateLimitedAttempt(merchantResetAttempts, key, 10, 10 * 60_000)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans dix minutes.' });
    try {
      const token = String(req.body?.token || ''); const password = String(req.body?.password || ''); const confirm = String(req.body?.confirmPassword || '');
      if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return res.status(400).json({ error: 'Lien de réinitialisation invalide.' });
      if (password.length < 12 || password.length > 128) return res.status(400).json({ error: 'Le nouveau mot de passe doit contenir entre 12 et 128 caractères.' });
      if (password !== confirm) return res.status(400).json({ error: 'Les deux mots de passe ne correspondent pas.' });
      const tokenHash = hashToken(token);
      const target = await commerce.getMerchantByResetTokenHash(tokenHash);
      const updated = await commerce.completeMerchantPasswordResetByToken(tokenHash, hashPassword(password));
      if (!updated) {
        if (target) await store.addAudit({ actor: target.displayName || target.username, actorType: 'anonymous', actorId: target.id, managerId: target.managerId || null,
          action: 'password_change', entityType: 'merchant', entityId: target.id, summary: 'Tentative de réinitialisation marchand refusée : lien expiré ou déjà utilisé.', result: 'failure', metadata: { merchantId: target.id, reason: 'expired_or_used_link' } }).catch(() => {});
        return res.status(410).json({ error: 'Ce lien a expiré, a déjà été utilisé ou n’est plus valide. Demandez un nouveau lien à votre gestionnaire.' });
      }
      await store.addAudit({ actor: updated.displayName || updated.username, actorType: 'merchant', actorId: updated.id, managerId: updated.managerId || null,
        action: 'password_change', entityType: 'merchant', entityId: updated.id, summary: 'Mot de passe marchand redéfini à partir du lien sécurisé remis par un gestionnaire; sessions précédentes révoquées.', metadata: { merchantId: updated.id, method: 'reset_link' } }).catch(() => {});
      if (updated.status === 'active' && !updated.deletedAt) setMerchantSession(res, updated);
      res.json({ ok: true, authenticated: updated.status === 'active' && !updated.deletedAt, data: publicMerchantAccount(updated) });
    } catch (error) { apiError(res, error, 'Impossible de finaliser la réinitialisation.'); }
  });
  app.post('/api/merchant/auth/logout', requireMerchant, async (req, res) => {
    await store.addAudit({ ...actorInfo('merchant', req), action: 'logout', entityType: 'merchant', entityId: req.merchant.id, summary: 'Déconnexion marchand.', metadata: { merchantId: req.merchant.id } }).catch(() => {});
    clearMerchantSession(res); res.json({ ok: true });
  });
  const PASSWORD_RULES = (value) => typeof value === 'string' && value.length >= 12 && value.length <= 128;
  app.post('/api/merchant/auth/change-password', requireMerchant, async (req, res) => {
    const password = String(req.body?.password || ''); const confirm = String(req.body?.confirmPassword || '');
    const currentPassword = String(req.body?.currentPassword || '');
    if (!PASSWORD_RULES(password)) return res.status(400).json({ error: 'Le mot de passe doit contenir entre 12 et 128 caractères.' });
    if (password !== confirm) return res.status(400).json({ error: 'Les deux mots de passe ne correspondent pas.' });
    // The current password is always verified server-side, so a stolen session alone cannot take over the account.
    if (!currentPassword) return res.status(400).json({ error: 'Saisissez votre mot de passe actuel.', code: 'CURRENT_PASSWORD_REQUIRED' });
    if (!checkPassword(currentPassword, req.merchant.passwordHash)) {
      await store.addAudit({ ...actorInfo('merchant', req), action: 'password_change', entityType: 'merchant', entityId: req.merchant.id,
        summary: 'Changement de mot de passe refusé : mot de passe actuel incorrect.', result: 'failure', metadata: { merchantId: req.merchant.id, reason: 'invalid_current_password' } }).catch(() => {});
      return res.status(403).json({ error: 'Le mot de passe actuel est incorrect.', code: 'INVALID_CURRENT_PASSWORD' });
    }
    if (checkPassword(password, req.merchant.passwordHash)) return res.status(400).json({ error: 'Choisissez un mot de passe différent du mot de passe actuel.' });
    const updated = await commerce.changeMerchantPassword(req.merchant.id, hashPassword(password));
    if (!updated) return res.status(409).json({ error: 'Le changement de mot de passe n’est plus disponible. Reconnectez-vous.' });
    setMerchantSession(res, updated);
    await store.addAudit({ ...actorInfo('merchant', req), action: 'password_change', entityType: 'merchant', entityId: req.merchant.id, summary: 'Mot de passe marchand remplacé; anciennes sessions révoquées.', metadata: { merchantId: req.merchant.id, method: 'authenticated_change' } }).catch(() => {});
    res.json({ ok: true, data: publicMerchantAccount(updated) });
  });
  // Forgetful password: the merchant requests help; a manager/PDG verifies identity and issues a one-time link or temporary password.
  app.post('/api/merchant/auth/password-reset-request', requireMerchant, async (req, res) => {
    const hourKey = new Date().toISOString().slice(0, 13);
    if (!allowRateLimitedAttempt(passwordResetRequests, `${req.merchant.id}:${hourKey}`, 3, 60 * 60_000)) return res.status(429).json({ error: 'Une demande a déjà été envoyée récemment. Contactez directement votre gestionnaire si le besoin est urgent.' });
    await commerce.requestMerchantPasswordReset(req.merchant.id, { ipHash: customerFingerprint(sessionSecret, 'reset-request-ip', req.ip || 'unknown') });
    await store.addAudit({ ...actorInfo('merchant', req), action: 'password_reset_requested', entityType: 'merchant', entityId: req.merchant.id,
      summary: 'Le marchand a demandé une réinitialisation de mot de passe; vérification humaine requise.', metadata: { merchantId: req.merchant.id } }).catch(() => {});
    res.json({ ok: true, message: 'Votre demande est enregistrée. Un gestionnaire autorisé ou le PDG doit vérifier votre identité avant d’émettre un mot de passe temporaire.' });
  });

  // Explicitly reject attempts to create or manage QR from the merchant role.
  app.all(/^\/api\/merchant\/.*(?:qr|codes)(?:\/.*)?$/i, requireMerchant, async (req, res, next) => {
    if (['GET', 'HEAD'].includes(req.method)) return next();
    await auditDenial(req, 'Création ou modification de QR refusée : le rôle marchand ne peut jamais créer de QR.', req.merchant.id);
    res.status(403).json({ error: 'La création et la gestion des QR sont réservées au PDG et aux gestionnaires autorisés.' });
  });

  app.get('/api/public/search', async (req, res) => {
    try {
      const data = await extras.searchPublicCatalog(safeText(req.query.q, 80), { limit: Math.min(30, Number.parseInt(req.query.limit, 10) || 20) });
      res.setHeader('Cache-Control', 'public, max-age=30, stale-while-revalidate=60'); res.json({ data });
    } catch (error) { apiError(res, error, 'Impossible de rechercher les boutiques publiques.'); }
  });
  app.get('/api/public/shops/:slug', async (req, res) => {
    try {
      const result = await commerce.getPublicShopBySlug(safeText(req.params.slug, 80));
      if (!result) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      const requestedPointCode = safeText(req.query?.servicePoint, 100);
      const requestedPoint = requestedPointCode ? await extras.getPublicServicePointByCode(requestedPointCode) : null;
      const servicePointId = requestedPoint?.storeId === result.store.id && requestedPoint?.storeSlug === result.store.slug ? requestedPoint.id : '';
      const [ads, rewardCampaigns, orderPolicy] = await Promise.all([extras.listPublicAds(result.store.id), extras.listPublicRewardCampaigns(result.store.id, { servicePointId }), getMerchantOrderPolicy()]);
      res.setHeader('Cache-Control', 'no-store'); res.json({ data: { ...result, store: publicStorefrontData(result.store), ads, rewardCampaigns,
        orderPolicy: { trackingEnabled: orderPolicy.trackingEnabled, clientCancellationEnabled: orderPolicy.clientCancellationEnabled,
          clientBrowserNotifications: orderPolicy.clientBrowserNotifications } } });
    } catch (error) { apiError(res, error, 'Impossible de charger cette boutique.'); }
  });
  app.get('/api/public/service-points/:code', async (req, res) => {
    try {
      const point = await extras.getPublicServicePointByCode(safeText(req.params.code, 100));
      if (!point) return res.status(404).json({ error: 'Cette table ou cet emplacement n’est plus actif.' });
      res.setHeader('Cache-Control', 'no-store'); res.json({ data: point });
    } catch (error) { apiError(res, error, 'Impossible de vérifier ce QR de table.'); }
  });
  app.post('/api/public/shops/:slug/ads/:adId/impression', checkSameOrigin, async (req, res) => {
    if (!allowRateLimitedAttempt(adEventAttempts, req.ip || 'unknown', 120, 60_000)) return res.status(429).json({ error: 'Trop de signaux publicitaires depuis cette connexion.' });
    try {
      const shop = await commerce.getPublicShopBySlug(safeText(req.params.slug, 80));
      if (!shop) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      const data = await extras.recordAdEvent({ campaignId:safeText(req.params.adId,100), eventType:'impression', eventId:safeText(req.body?.eventId,100), storeSlug:shop.store.slug });
      if (!data) return res.status(404).json({ error: 'Cette annonce n’est plus active.' });
      res.status(202).json({ data });
    } catch (error) { if (error.message && !error.code) return res.status(400).json({ error:error.message }); apiError(res,error,'Impossible d’enregistrer cette impression.'); }
  });
  app.get('/ad/:adId', async (req, res) => {
    try {
      const ad = await extras.getPublicAdForClick(safeText(req.params.adId,100));
      if (!ad) return res.status(404).sendFile(require('node:path').join(__dirname, 'public', 'not-found.html'));
      const event = await extras.recordAdEvent({ campaignId:ad.id,eventType:'click',eventId:crypto.randomUUID() });
      if (!event) return res.status(404).sendFile(require('node:path').join(__dirname, 'public', 'not-found.html'));
      res.setHeader('Cache-Control','no-store'); return res.redirect(302,ad.destination);
    } catch (error) { apiError(res,error,'Impossible d’ouvrir cette annonce.'); }
  });
  app.post('/api/public/shops/:slug/rewards/:campaignId/claim', checkSameOrigin, async (req, res) => {
    const key = `reward:${req.ip || 'unknown'}`; const now = Date.now(); const current = rewardAttempts.get(key);
    if (current && now - current.start < 60_000 && current.count >= 8) return res.status(429).json({ error: 'Trop de demandes de participation depuis cette connexion. Réessayez dans une minute.' });
    if (!current || now - current.start >= 60_000) rewardAttempts.set(key, { start: now, count: 1 }); else current.count++;
    try {
      const shop = await commerce.getPublicShopBySlug(safeText(req.params.slug, 80));
      if (!shop) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      const storeRecord = await commerce.getStoreById(shop.store.id);
      const merchantId = storeRecord?.merchantId;
      const result = await extras.claimReward({ storeId: shop.store.id, campaignId: safeText(req.params.campaignId, 100),
        phone: safeText(req.body?.phone, 32), requestId: safeText(req.body?.requestId, 100), servicePointCode: safeText(req.body?.servicePointCode, 100) });
      await audit('client', req, { action: 'reward_claimed', merchantId, entityId: result.claim.id,
        summary: `Participation gratuite enregistrée à une offre de la boutique « ${shop.store.name} ».`, metadata: { storeId: shop.store.id, campaignId: result.claim.campaignId, prizeLabel: result.prizeLabel } }).catch(() => {});
      merchantEvent(merchantId, 'reward_claimed', { campaignId: result.claim.campaignId });
      res.status(result.idempotent ? 200 : 201).json({ data: result });
    } catch (error) { if (['ALREADY_PARTICIPATED','CAMPAIGN_CLOSED','SERVICE_POINT_REQUIRED','SERVICE_POINT_MISMATCH'].includes(error.code)) return res.status(409).json({ error: error.message, code: error.code });
      if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer cette participation.'); }
  });
  app.post('/api/public/shops/:slug/gift-cards/check', checkSameOrigin, async (req, res) => {
    const key = `gift-check:${req.ip || 'unknown'}`; const now = Date.now(); const current = rewardAttempts.get(key);
    if (current && now - current.start < 60_000 && current.count >= 20) return res.status(429).json({ error: 'Trop de vérifications de codes. Réessayez dans une minute.' });
    if (!current || now - current.start >= 60_000) rewardAttempts.set(key, { start: now, count: 1 }); else current.count++;
    try {
      const shop = await commerce.getPublicShopBySlug(safeText(req.params.slug, 80)); if (!shop) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      const data = await extras.checkGiftCard(shop.store.id, safeText(req.body?.code, 120));
      res.json({ data: data ? { valid: data.valid, faceValueXof: data.faceValueXof, balanceXof: data.balanceXof, status: data.status } : { valid: false } });
    } catch (error) { apiError(res, error, 'Impossible de vérifier ce bon cadeau.'); }
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
      const customerName = safeText(req.body?.customerName, 120).replace(/[\t\n\r ]+/gu, ' '); const customerPhone = validPhone(req.body?.customerPhone, 'Téléphone du client');
      const customerEmail = safeText(req.body?.customerEmail, 254).toLowerCase(); const deliveryAddress = safeText(req.body?.deliveryAddress, 500); const note = safeText(req.body?.note, 500);
      if ([...customerName].length < 2 || !/[\p{L}\p{N}]/u.test(customerName)) throw new Error('Saisissez un nom complet (ex. John Sery Michael). Les accents et espaces sont acceptés.');
      if (!customerPhone || customerPhone.replace(/\D/g, '').length < 7) throw new Error('Un numéro de téléphone valide est obligatoire pour le suivi de la commande.');
      if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error('L’adresse e-mail du client n’est pas valide.');
      // Optional delivery mode, table number and table note: a table order never needs a delivery address.
      const servicePointCode = safeText(req.body?.servicePointCode, 100);
      const requestedMode = safeText(req.body?.orderMode, 20);
      const orderMode = ['dine_in','pickup','delivery','other'].includes(requestedMode) ? requestedMode : '';
      const tableNumber = safeText(req.body?.tableNumber, 40);
      const tableNote = safeText(req.body?.tableNote, 160);
      if (orderMode === 'dine_in' && tableNumber && !/[\p{L}\p{N}]/u.test(tableNumber)) throw new Error('Le numéro de table indiqué n’est pas valide.');
      let finalAddress = deliveryAddress;
      if (orderMode === 'dine_in' || (orderMode && servicePointCode)) {
        const tableText = [tableNumber ? `Table ${tableNumber}` : '', tableNote].filter(Boolean).join(' · ');
        finalAddress = tableText || deliveryAddress || 'Sur place';
        if (!servicePointCode && !tableNumber) throw new Error('Indiquez votre numéro de table pour cette commande sur place.');
      } else if (orderMode === 'pickup') { finalAddress = 'Retrait à la boutique'; }
      else if (finalAddress.length < 3) throw new Error('Indiquez une adresse ou un mode de remise pour la commande.');
      const items = Array.isArray(req.body?.items) ? req.body.items : [];
      const servicePoint = servicePointCode ? await extras.getServicePointForOrder(shop.store.id, servicePointCode) : null;
      if (servicePointCode && !servicePoint) return res.status(400).json({ error: 'Le QR de table ou emplacement n’est pas valide pour cette boutique.' });
      const trackingToken = buildTrackingToken(shop.store.id, clientRequestId);
      const orderPolicy = await getMerchantOrderPolicy();
      const storeRecord = await commerce.getStoreById(shop.store.id);
      const blockHashes = customerBlockHashes(shop.store.id, customerPhone, clientRequestId, req.ip || 'unknown');
      const tablePhoto = req.body?.tablePhoto ? validateOrderTablePhoto(req.body.tablePhoto) : null;
      if (storeRecord?.requireTablePhoto && !tablePhoto) return res.status(400).json({ error: 'Cette boutique exige une photo prise directement avec la caméra. Autorisez la caméra et confirmez une photo avant de commander.' });
      const result = await commerce.createOrder({ storeId: shop.store.id, merchantId: storeRecord?.merchantId || '', clientRequestId,
        customerName, customerPhone, customerEmail, deliveryAddress: finalAddress, note, items, tablePhoto, orderType: orderMode || undefined,
        customerBlockPhoneHash: blockHashes.phoneHash, customerBlockRequestHash: blockHashes.requestHash, clientIpHash: blockHashes.ipHash,
        servicePointId: servicePoint?.id || '', servicePointName: servicePoint?.name || '', trackingTokenHash: hashToken(trackingToken) });
      if (!result.idempotent) {
        await audit('client', req, { action: 'order_received', merchantId: result.order.merchantId, entityId: result.order.id,
          summary: `Commande ${result.order.reference} reçue.`, metadata: { storeId: result.order.storeId, orderReference: result.order.reference,
            totalAmountXof: result.order.totalAmountXof, itemCount: result.order.items.length } }).catch(() => {});
        merchantEvent(result.order.merchantId, 'new_order', { orderId: result.order.id, reference: result.order.reference });
        sendMerchantPush(result.order.merchantId, { type: 'new_order', title: 'Nouvelle commande', body: `Commande ${result.order.reference} reçue`, orderId: result.order.id,
          url: `/merchant/?order=${encodeURIComponent(result.order.id)}` }).catch(() => {});
      }
      res.status(result.idempotent ? 200 : 201).json({ data: { order: publicOrder(result.order), idempotent: result.idempotent,
        trackingEnabled: orderPolicy.trackingEnabled, ...(orderPolicy.trackingEnabled ? { trackingToken } : {}),
        store: { name: storeRecord?.name || shop.store.name, ...publicContactActionUrls(storeRecord || shop.store) } } });
    } catch (error) {
      if (error.code === 'CUSTOMER_BLOCKED') {
        if (error.attemptRecorded) {
          const last4 = String(error.phoneLast4 || '').slice(-4);
          await audit('client', req, { action: 'customer_blocked_order_attempt', merchantId: error.merchantId, entityId: error.blockId,
            summary: `Tentative de commande refusée pour un numéro se terminant par ${last4}.`, afterData: { phoneLast4: last4 },
            metadata: { storeId: error.storeId, phoneLast4: last4 } }).catch(() => {});
          const hourKey = new Date().toISOString().slice(0, 13);
          await commerce.addNotification({ merchantId: error.merchantId, type: 'customer_block_attempt', dedupeKey: `customer-block:${error.blockId}:${hourKey}`,
            title: 'Tentative de commande à examiner', message: 'Une demande n’a pas pu être enregistrée selon les règles de la boutique. Consultez l’historique des tentatives.',
            data: { blockId: error.blockId } }).catch(() => {});
          merchantEvent(error.merchantId, 'customer_block_attempt', { blockId: error.blockId });
          sendMerchantPush(error.merchantId, { type: 'customer_block_attempt', title: 'Tentative de commande à examiner',
            body: 'Une demande nécessite une vérification dans votre espace marchand.' }).catch(() => {});
        }
        res.setHeader('Cache-Control', 'no-store');
        return res.status(409).json({ error: 'Une difficulté empêche l’enregistrement de cette commande. Contactez la boutique si vous avez besoin d’aide.' });
      }
      if (error.code === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: error.message });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      apiError(res, error, 'Impossible d’enregistrer la commande.');
    }
  });
  app.post('/api/public/shops/:slug/orders/recover', checkSameOrigin, async (req, res) => {
    const ipKey = `${req.ip || 'unknown'}:${safeText(req.params.slug, 80)}`;
    if (!allowRateLimitedAttempt(trackingRecoveryAttempts, ipKey, 5, 10 * 60_000)) return res.status(429).json({ error: 'Trop de tentatives de récupération. Réessayez dans dix minutes.' });
    try {
      const slug = safeText(req.params.slug, 80); const shop = await commerce.getPublicShopBySlug(slug);
      if (!shop) { await auditPublicRecoveryFailure(req, { slug, reason: 'store_unavailable' }); return res.status(404).json({ error: 'Aucune commande active trouvée. Vérifiez la boutique, la référence, le lien secret et le téléphone.' }); }
      const policy = await getMerchantOrderPolicy();
      if (!policy.trackingEnabled) { await auditPublicRecoveryFailure(req, { storeId: shop.store.id, slug, reason: 'tracking_disabled' }); return res.status(403).json({ error: 'Le suivi public est désactivé par cette boutique.' }); }
      const reference = safeText(req.body?.reference, 40); const token = safeText(req.body?.token, 200);
      const phone = validPhone(req.body?.phone, 'Téléphone');
      if (token.length < 32 || !reference || !phone || customerPhoneDigits(phone).length < 7) {
        await auditPublicRecoveryFailure(req, { storeId: shop.store.id, slug, reason: 'missing_or_invalid_fields' });
        return res.status(404).json({ error: 'Aucune commande active trouvée. Vérifiez la boutique, la référence, le lien secret et le téléphone.' });
      }
      const orders = await commerce.recoverPublicOrders({ storeId: shop.store.id, reference, tokenHash: hashToken(token), phone });
      if (!orders?.length) { await auditPublicRecoveryFailure(req, { storeId: shop.store.id, slug, reason: 'secret_or_phone_mismatch' }); return res.status(404).json({ error: 'Aucune commande active trouvée. Vérifiez la boutique, la référence, le lien secret et le téléphone.' }); }
      const storeRecord = await commerce.getStoreById(shop.store.id);
      await audit('client', req, { action: 'public_order_recovery', merchantId: storeRecord?.merchantId || '', entityId: reference,
        summary: `Récupération sécurisée des commandes actives pour la boutique « ${safeText(shop.store.name, 120)} ».`,
        metadata: { storeId: shop.store.id, orderCount: orders.length } }).catch(() => {});
      const data = orders.map((order) => publicTrackingOrder(order, storeRecord, policy, buildTrackingToken(order.storeId, order.clientRequestId)));
      res.setHeader('Cache-Control', 'no-store'); res.json({ data });
    } catch (error) {
      if (error.message && !error.code) { await auditPublicRecoveryFailure(req, { slug: safeText(req.params.slug, 80), reason: 'invalid_fields' }); return res.status(400).json({ error: error.message }); }
      apiError(res, error, 'Impossible de récupérer les commandes.');
    }
  });
  app.get('/api/public/shops/orders/:reference', async (req, res) => {
    const readKey = req.ip || 'unknown';
    if (!allowRateLimitedAttempt(trackingReadAttempts, readKey, 120, 60_000)) return res.status(429).json({ error: 'Trop de vérifications du suivi. Réessayez dans une minute.' });
    const token = safeText(req.query.token, 200);
    if (token.length < 32) return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
    try {
      const policy = await getMerchantOrderPolicy();
      if (!policy.trackingEnabled) return res.status(404).json({ error: 'Le suivi public est désactivé par cette boutique.' });
      const order = await commerce.getOrderTracking(safeText(req.params.reference, 40), hashToken(token));
      if (!order) return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
      const shop = await commerce.getStoreById(order.storeId);
      res.setHeader('Cache-Control', 'no-store'); res.json({ data: publicTrackingOrder(order, shop, policy, token) });
    } catch (error) { apiError(res, error, 'Impossible de charger le suivi de la commande.'); }
  });
  app.get('/api/public/shops/orders/:reference/cancellation', async (req, res) => {
    const token = safeText(req.query.token, 200);
    if (token.length < 32) return res.status(404).json({ error: 'Demande introuvable.' });
    try {
      const policy = await getMerchantOrderPolicy(); if (!policy.trackingEnabled) return res.status(404).json({ error: 'Demande introuvable.' });
      const result = await commerce.getPublicCancellationStatus(safeText(req.params.reference, 40), hashToken(token));
      if (!result) return res.status(404).json({ error: 'Demande introuvable.' });
      res.setHeader('Cache-Control', 'no-store'); return res.json({ data: result });
    } catch (error) { return apiError(res, error, 'Impossible de vérifier la demande d’annulation.'); }
  });
  app.post('/api/public/shops/orders/:reference/cancel', checkSameOrigin, async (req, res) => {
    const ip = req.ip || 'unknown'; const now = Date.now(); const attempt = cancellationAttempts.get(ip);
    if (attempt && now - attempt.start < 60_000 && attempt.count >= 8) return res.status(429).json({ error: 'Trop de demandes depuis cette connexion. Réessayez dans une minute.' });
    if (!attempt || now - attempt.start >= 60_000) cancellationAttempts.set(ip, { start: now, count: 1 }); else attempt.count += 1;
    const token = safeText(req.query.token, 200); const requestId = safeText(req.body?.requestId, 100);
    if (token.length < 32) return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
    if (!REQUEST_ID_RE.test(requestId)) return res.status(400).json({ error: 'Identifiant de demande invalide. Réessayez depuis le lien de suivi.' });
    try {
      const policy = await getMerchantOrderPolicy();
      if (!policy.trackingEnabled) return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
      if (!policy.clientCancellationEnabled) return res.status(403).json({ error: 'Les demandes d’annulation en ligne sont désactivées par cette boutique. Contactez-la directement.' });
      const result = await commerce.requestOrderCancellation(safeText(req.params.reference, 40), hashToken(token), requestId,
        safeText(req.body?.reason, 300), { cancellationRequestsPer24h: policy.cancellationRequestsPer24h, autoAcceptPendingCancellation: policy.autoAcceptPendingCancellation });
      const order = await commerce.getOrder(result.orderId);
      if (!result.idempotent) {
        await audit('client', req, { action: result.autoAccepted ? 'order_cancellation_auto_accepted' : 'order_cancellation_requested',
          merchantId: result.merchantId, entityId: result.orderId, summary: `Demande d’annulation ${result.request.status} pour la commande ${result.reference}.`,
          beforeData: null, afterData: { requestId: result.request.id, requestStatus: result.request.status, orderStatus: order?.status },
          metadata: { storeId: result.storeId, reference: result.reference } }).catch(() => {});
        merchantEvent(result.merchantId, 'order_cancellation_request', { orderId: result.orderId, reference: result.reference, status: result.request.status });
        sendMerchantPush(result.merchantId, { type: 'order_cancellation_request', title: 'Demande d’annulation', body: `Commande ${result.reference}`,
          orderId: result.orderId, url: `/merchant/?order=${encodeURIComponent(result.orderId)}` }).catch(() => {});
      }
      res.setHeader('Cache-Control', 'no-store');
      return res.status(result.idempotent ? 200 : 201).json({ data: { request: result.request, autoAccepted: result.autoAccepted,
        idempotent: result.idempotent, order: order ? publicOrder(order) : null } });
    } catch (error) {
      if (error.code === 'NOT_FOUND') return res.status(404).json({ error: 'Commande introuvable ou lien de suivi invalide.' });
      if (['CANCELLATION_NOT_ALLOWED', 'CANCELLATION_PENDING'].includes(error.code)) return res.status(409).json({ error: error.message, code: error.code });
      if (error.code === 'CANCELLATION_LIMIT') return res.status(429).json({ error: error.message, code: error.code });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      return apiError(res, error, 'Impossible d’enregistrer la demande d’annulation.');
    }
  });

  // Stable public QR links for dining tables/service locations and for the store itself.
  app.get('/t/:code', async (req, res) => {
    try {
      const point = await extras.getPublicServicePointByCode(safeText(req.params.code, 100));
      if (!point) return res.status(404).sendFile(require('node:path').join(__dirname, 'public', 'not-found.html'));
      await extras.recordServicePointQrScan(point.id);
      return res.redirect(302, `/shop/${encodeURIComponent(point.storeSlug)}?servicePoint=${encodeURIComponent(point.publicCode)}`);
    } catch (error) { apiError(res, error, 'Impossible d’ouvrir ce QR de table.'); }
  });
  // Read-only store QR links are provisioned only through admin/manager endpoints below.
  app.get('/s/:code', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
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
  app.post('/api/merchant/media', requireMerchant, async (req, res) => {
    try { await saveMediaUpload(req, res, req.merchant.id); }
    catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Échec de l’envoi de l’image.'); }
  });
  app.get('/api/merchant/media/:mediaId', requireMerchant, async (req, res) => {
    const media = await commerce.getMedia(req.params.mediaId);
    if (!media || media.merchantId !== req.merchant.id) return res.status(404).end();
    return sendMedia(res, media);
  });
  app.delete('/api/merchant/media/:mediaId', requireMerchant, async (req, res) => {
    const result = await commerce.deleteUnusedMedia(req.params.mediaId, req.merchant.id);
    if (!result.found) return res.status(404).json({ error: 'Image introuvable.' });
    if (result.inUse) return res.status(409).json({ error: 'Cette image est encore utilisée par la boutique ou un produit.' });
    res.json({ ok: true });
  });
  app.get('/media/merchant/:mediaId', async (req, res) => {
    const media = await commerce.getMedia(req.params.mediaId);
    if (!media || !await commerce.mediaIsPublic(media.id)) return res.status(404).end();
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Content-Type', media.mimeType); res.setHeader('Content-Length', String(media.byteSize));
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin'); return res.send(media.bytes);
  });

  app.get('/api/merchant/notifications', requireMerchant, async (req, res) => res.json(await commerce.listNotifications(req.merchant.id, { limit: req.query.limit })));
  app.post('/api/merchant/notifications/read-orders', requireMerchant, async (req, res) => {
    const orders = await commerce.listOrders({ merchantId: req.merchant.id, page: 1, limit: 100 });
    const allowed = new Set((orders.data || []).map((row) => row.id));
    const orderIds = (Array.isArray(req.body?.orderIds) ? req.body.orderIds : []).map(String).filter((id) => allowed.has(id));
    await commerce.markOrderNotificationsRead(req.merchant.id, orderIds);
    res.json(await commerce.listNotifications(req.merchant.id, { limit: 100 }));
  });
  app.post('/api/merchant/notifications/:notificationId/read', requireMerchant, async (req, res) => {
    if (!await commerce.markNotificationRead(req.merchant.id, req.params.notificationId)) return res.status(404).json({ error: 'Notification introuvable.' });
    res.json(await commerce.listNotifications(req.merchant.id, { limit: 100 }));
  });
  app.get('/api/merchant/push/config', requireMerchant, async (_req, res) => res.json({ enabled: pushConfigured, publicKey: pushConfigured ? vapidPublicKey : '' }));
  app.post('/api/merchant/push/subscriptions', requireMerchant, async (req, res) => {
    if (!pushConfigured) return res.status(503).json({ error: 'Les notifications push ne sont pas configurées sur le serveur; les notifications en direct restent actives tant que l’espace est ouvert.' });
    try { await commerce.savePushSubscription(req.merchant.id, req.body); res.status(201).json({ ok: true }); }
    catch (error) { res.status(400).json({ error: error.message || 'Abonnement de notification invalide.' }); }
  });
  app.delete('/api/merchant/push/subscriptions', requireMerchant, async (req, res) => {
    await commerce.removePushSubscription(req.merchant.id, safeText(req.body?.endpoint, 2000)); res.json({ ok: true });
  });

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
      const product = await commerce.saveProduct(row.id, await validateProductInput(req.body || {}, req.merchant.id, commerce));
      await audit('merchant', req, { action: 'product_created', merchantId: req.merchant.id, entityId: product.id, summary: `Produit « ${product.name} » créé.`, afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.merchant.id, 'product_updated', { productId: product.id }); res.status(201).json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer le produit.'); }
  });
  app.put('/api/merchant/products/:productId', requireMerchant, async (req, res) => {
    try {
      const row = await merchantOwnStore(req, res); if (!row) return;
      const before = await commerce.getProduct(req.params.productId); if (!before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
      const product = await commerce.saveProduct(row.id, await validateProductInput(req.body || {}, req.merchant.id, commerce, before), before.id);
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
    res.json(await commerce.listOrders({ merchantId: req.merchant.id, storeId: storeRow.id, status: ['pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled','rejected'].includes(status) ? status : '', search, page, limit }));
  });
  app.get('/api/merchant/assisted-orders/context', requireMerchant, async (req, res) => {
    const storeRow = await loadOwnStore(req.merchant.id); if (!storeRow) return res.status(409).json({ error: 'Configurez d’abord la boutique.' });
    const [products, points, usage] = await Promise.all([commerce.listProducts(storeRow.id, { activeOnly: true }), extras.listServicePoints(storeRow.id), commerce.getServicePointUsage(storeRow.id)]);
    res.setHeader('Cache-Control', 'no-store'); res.json({ data: { store: { id: storeRow.id, name: storeRow.name, slug: storeRow.slug,
      deliveryEnabled: storeRow.deliveryEnabled !== false, pickupEnabled: storeRow.pickupEnabled !== false, deliveryFeeXof: Number(storeRow.deliveryFeeXof) || 0 },
      products, servicePoints: points.map((point) => ({ ...point, activeOrderCount: usage[point.id] || 0 })) } });
  });
  app.post('/api/merchant/assisted-orders', requireMerchant, async (req, res) => {
    try {
      const storeRow = await loadOwnStore(req.merchant.id); if (!storeRow || storeRow.status !== 'active') return res.status(409).json({ error: 'Boutique inactive ou non configurée.' });
      const body = req.body || {}; const requestId = safeText(body.requestId, 100);
      if (!REQUEST_ID_RE.test(requestId)) return res.status(400).json({ error: 'Identifiant de commande invalide. Actualisez la fiche et réessayez.' });
      const customerName = safeText(body.customerName, 120).replace(/[\t\n\r ]+/gu, ' ');
      const customerPhone = validPhone(body.customerPhone, 'Téléphone du client');
      const customerEmail = safeText(body.customerEmail, 254).toLowerCase();
      const note = safeText(body.note, 500);
      if ([...customerName].length < 2 || !/[\p{L}\p{N}]/u.test(customerName)) throw new Error('Saisissez le nom du client.');
      if (!customerPhone || customerPhone.replace(/\D/g, '').length < 7) throw new Error('Un numéro de téléphone valide est obligatoire pour fournir le reçu et le lien privé.');
      if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) throw new Error('L’adresse e-mail du client n’est pas valide.');
      const orderType = safeText(body.orderType, 20);
      if (!['dine_in','pickup','delivery','other'].includes(orderType)) throw new Error('Choisissez un mode de commande valide.');
      if (orderType === 'delivery' && storeRow.deliveryEnabled === false) throw new Error('La livraison n’est pas activée pour cette boutique.');
      if (orderType === 'pickup' && storeRow.pickupEnabled === false) throw new Error('Le retrait n’est pas activé pour cette boutique.');
      const paymentMethod = safeText(body.paymentMethod, 30) || 'not_recorded';
      if (!['not_recorded','cash','mobile_money','bank_transfer','card','other'].includes(paymentMethod)) throw new Error('Choisissez un mode de paiement reconnu. Aucun paiement ne sera marqué comme reçu.');
      const items = Array.isArray(body.items) ? body.items : [];
      if (!items.length) throw new Error('Ajoutez au moins un produit au panier.');
      const discountAmountXof = body.discountAmountXof === '' || body.discountAmountXof == null ? 0 : Number(body.discountAmountXof);
      if (!Number.isSafeInteger(discountAmountXof) || discountAmountXof < 0 || discountAmountXof > 2_000_000_000) throw new Error('La remise doit être un montant entier positif en XOF.');
      const servicePoints = await extras.listServicePoints(storeRow.id);
      const servicePointId = safeText(body.servicePointId, 100);
      const servicePoint = servicePointId ? servicePoints.find((point) => point.id === servicePointId && point.status === 'active') : null;
      if (servicePointId && !servicePoint) throw new Error('Cette table ou cet emplacement n’est pas actif dans cette boutique.');
      if (orderType === 'dine_in' && servicePoints.some((point) => point.status === 'active' && ['table','location','salon'].includes(point.type)) && !servicePoint) throw new Error('Sélectionnez une table, un salon ou un emplacement actif pour cette commande sur place.');
      let deliveryAddress = safeText(body.deliveryAddress, 500);
      if (orderType === 'delivery' && deliveryAddress.length < 3) throw new Error('Indiquez l’adresse de livraison.');
      if (orderType === 'pickup' && deliveryAddress.length < 3) deliveryAddress = 'Retrait à la boutique';
      if (orderType === 'dine_in' && servicePoint) deliveryAddress = `${servicePoint.name}${servicePoint.zone ? ` · ${servicePoint.zone}` : ''}`;
      if (orderType === 'other' && deliveryAddress.length < 3) throw new Error('Précisez le mode ou le lieu de remise.');
      const trackingToken = buildTrackingToken(storeRow.id, requestId);
      const result = await commerce.createOrder({ storeId: storeRow.id, merchantId: req.merchant.id, clientRequestId: requestId,
        source: 'merchant_assisted', createdById: req.merchant.id, orderType, paymentMethod, discountAmountXof,
        occupiedPointConfirmed: body.confirmOccupiedPoint === true, customerName, customerPhone, customerEmail, deliveryAddress, note, items,
        servicePointId: servicePoint?.id || '', trackingTokenHash: hashToken(trackingToken) });
      if (!result.idempotent) {
        await audit('merchant', req, { action: 'assisted_order_created', merchantId: req.merchant.id, entityId: result.order.id,
          summary: `Commande ${result.order.reference} saisie par le marchand.`, metadata: { storeId: storeRow.id, source: 'merchant_assisted', orderType,
            paymentMethod, paymentStatus: 'not_recorded', discountAmountXof, itemCount: result.order.items.length } });
        merchantEvent(req.merchant.id, 'new_order', { orderId: result.order.id, reference: result.order.reference, source: 'merchant_assisted' });
      }
      const trackingUrl = `/order/${encodeURIComponent(result.order.reference)}?token=${encodeURIComponent(trackingToken)}`;
      res.setHeader('Cache-Control', 'no-store'); res.status(result.idempotent ? 200 : 201).json({ data: { order: { ...publicOrder(result.order), source: result.order.source || 'merchant_assisted',
        createdByType: result.order.createdByType || 'merchant', orderType: result.order.orderType || orderType, paymentMethod: result.order.paymentMethod || paymentMethod,
        paymentStatus: 'not_recorded', grandTotalXof: result.order.grandTotalXof },
        idempotent: result.idempotent, trackingToken, trackingUrl, notice: 'Aucun paiement n’a été vérifié ou encaissé par Oymike Tech. Transmettez le reçu et le lien au client par un canal disponible.' } });
    } catch (error) {
      if (error.code === 'IDEMPOTENCY_CONFLICT') return res.status(409).json({ error: error.message, code: error.code });
      if (error.code === 'OCCUPIED_SERVICE_POINT') return res.status(409).json({ error: error.message, code: error.code, activeOrderCount: Number(error.activeOrderCount) || 1 });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      apiError(res, error, 'Impossible de créer cette commande assistée.');
    }
  });
  app.get('/api/merchant/customer-blocks', requireMerchant, async (req, res) => {
    const storeRow = await loadOwnStore(req.merchant.id); if (!storeRow) return res.json({ data: [], total: 0, page: 1, limit: 50 });
    const { page, limit, search, status } = pagination(req.query);
    res.setHeader('Cache-Control', 'no-store'); return res.json(await commerce.listCustomerBlocks({ storeId: storeRow.id,
      status: ['active','unblocked'].includes(status) ? status : '', search, page, limit }));
  });
  app.post('/api/merchant/customer-blocks', requireMerchant, async (req, res) => {
    const storeRow = await loadOwnStore(req.merchant.id); if (!storeRow) return res.status(409).json({ error: 'Configurez d’abord la boutique.' });
    return createCustomerBlock(req, res, { role: 'merchant', merchantId: req.merchant.id, storeId: storeRow.id });
  });
  app.post('/api/merchant/customer-blocks/:blockId/unblock', requireMerchant, async (req, res) => {
    const storeRow = await loadOwnStore(req.merchant.id); if (!storeRow) return res.status(404).json({ error: 'Entrée introuvable.' });
    return unblockCustomer(req, res, { role: 'merchant', storeId: storeRow.id });
  });
  app.get('/api/merchant/stats', requireMerchant, async (req, res) => res.json({ data: await commerce.stats(req.merchant.id) }));
  app.get('/api/merchant/qr', requireMerchant, async (req, res) => {
    const row = await loadOwnStore(req.merchant.id); res.json({ data: row ? { path: row.qrPublicCode ? `/s/${row.qrPublicCode}` : '', url: row.qrPublicCode ? `${publicBaseUrl || ''}/s/${row.qrPublicCode}` : '',
      created: Boolean(row.qrPublicCode), enabled: Boolean(row.qrPublicCode && row.qrEnabled !== false) } : null });
  });

  async function loadManagerContext(req, merchantId, permission, res) {
    if (!await requireManagerScope(req, res, merchantId, permission)) return null;
    return commerce.getMerchant(merchantId);
  }
  async function managerHasMediaScope(req, res, merchantId) {
    const allowed = await managerHas(req, merchantId, 'canManageStore') || await managerHas(req, merchantId, 'canManageProducts');
    if (allowed) return true;
    await auditDenial(req, 'Accès média marchand refusé : aucune permission boutique ou produit.', merchantId);
    res.status(403).json({ error: 'Aucun droit sur les images de ce marchand.' }); return false;
  }
  async function listManagerMerchants(req) {
    const all = await commerce.listMerchants({ managerId: '' }); const result = [];
    for (const merchant of all) if (await managerMayList(req, merchant.id)) {
      const assignment = await commerce.getAssignment(req.manager.id, merchant.id);
      const primaryManager = merchant.managerId === req.manager.id && req.manager.canManageMerchants === true;
      const canStore = primaryManager || assignment?.canManageStore === true;
      const canProducts = primaryManager || assignment?.canManageProducts === true;
      const canOrders = primaryManager || assignment?.canManageOrders === true;
      const canQr = req.manager.canCreateCodes !== false && (primaryManager || assignment?.canCreateStoreQr === true);
      result.push({ id: merchant.id, username: merchant.username, displayName: merchant.displayName, status: merchant.status,
        managerId: merchant.managerId, storeId: merchant.storeId, storeSlug: merchant.storeSlug, storeName: merchant.storeName,
        storeStatus: merchant.storeStatus, storePublished: merchant.storePublished,
        ...(canStore ? { email: merchant.email, phone: merchant.phone, statusReason: merchant.statusReason, mustChangePassword: merchant.mustChangePassword } : {}),
        ...(canQr ? { qrPublicCode: merchant.qrPublicCode, qrEnabled: merchant.qrEnabled, qrScanCount: merchant.qrScanCount } : {}),
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
    const canSeeQr = req.manager.canCreateCodes !== false && (primaryManager || assignment?.canCreateStoreQr === true);
    const accountData = { id: merchant.id, username: merchant.username, displayName: merchant.displayName, status: merchant.status,
      statusReason: canSeeAccount ? merchant.statusReason : '', managerId: merchant.managerId, mustChangePassword: canSeeAccount ? merchant.mustChangePassword : undefined,
      createdAt: merchant.createdAt, updatedAt: canSeeAccount ? merchant.updatedAt : undefined };
    if (canSeeAccount) { accountData.email = merchant.email || ''; accountData.phone = merchant.phone || ''; }
    let storeData = primaryManager || assignment?.canManageStore ? await commerce.getStoreByMerchantId(merchant.id) : null;
    if (storeData && !canSeeQr) {
      const { qrPublicCode, qrEnabled, qrScanCount, ...storeWithoutQr } = storeData;
      storeData = storeWithoutQr;
    }
    res.json({ data: { ...accountData, store: storeData, assignment } });
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
      const product = await commerce.saveProduct(row.id, await validateProductInput(req.body || {}, req.params.merchantId, commerce)); await audit('manager', req, { action: 'product_created', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » créé.`, afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.params.merchantId, 'product_updated', { productId: product.id }); res.status(201).json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer le produit.'); }
  });
  app.put('/api/manager/merchants/:merchantId/products/:productId', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageProducts')) return;
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); const before = await commerce.getProduct(req.params.productId);
      if (!row || !before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
      const product = await commerce.saveProduct(row.id, await validateProductInput(req.body || {}, req.params.merchantId, commerce, before), before.id); await audit('manager', req, { action: 'product_updated', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » modifié.`, beforeData: productSnapshot(before), afterData: productSnapshot(product), metadata: { storeId: row.id } });
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
      status: ['pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled','rejected'].includes(status) ? status : '', search, page, limit }));
  });
  app.get('/api/manager/merchants/:merchantId/customer-blocks', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const storeRow = await commerce.getStoreByMerchantId(req.params.merchantId); if (!storeRow) return res.json({ data: [], total: 0, page: 1, limit: 50 });
    const { page, limit, search, status } = pagination(req.query); res.setHeader('Cache-Control', 'no-store');
    return res.json(await commerce.listCustomerBlocks({ storeId: storeRow.id, status: ['active','unblocked'].includes(status) ? status : '', search, page, limit }));
  });
  app.post('/api/manager/merchants/:merchantId/customer-blocks', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const storeRow = await commerce.getStoreByMerchantId(req.params.merchantId); if (!storeRow) return res.status(409).json({ error: 'Configurez d’abord la boutique.' });
    return createCustomerBlock(req, res, { role: 'manager', merchantId: req.params.merchantId, storeId: storeRow.id });
  });
  app.post('/api/manager/merchants/:merchantId/customer-blocks/:blockId/unblock', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const storeRow = await commerce.getStoreByMerchantId(req.params.merchantId); if (!storeRow) return res.status(404).json({ error: 'Entrée introuvable.' });
    return unblockCustomer(req, res, { role: 'manager', storeId: storeRow.id });
  });
  app.post('/api/manager/merchants/:merchantId/media', requireManager, async (req, res) => {
    if (!await managerHasMediaScope(req, res, req.params.merchantId)) return;
    try { await saveMediaUpload(req, res, req.params.merchantId); } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Échec de l’envoi de l’image.'); }
  });
  app.get('/api/manager/merchants/:merchantId/media/:mediaId', requireManager, async (req, res) => {
    if (!await managerHasMediaScope(req, res, req.params.merchantId)) return;
    const media = await commerce.getMedia(req.params.mediaId); if (!media || media.merchantId !== req.params.merchantId) return res.status(404).end(); return sendMedia(res, media);
  });
  app.delete('/api/manager/merchants/:merchantId/media/:mediaId', requireManager, async (req, res) => {
    if (!await managerHasMediaScope(req, res, req.params.merchantId)) return;
    const result = await commerce.deleteUnusedMedia(req.params.mediaId, req.params.merchantId); if (!result.found) return res.status(404).json({ error: 'Image introuvable.' });
    if (result.inUse) return res.status(409).json({ error: 'Cette image est encore utilisée.' }); res.json({ ok: true });
  });
  app.get('/api/manager/merchants/:merchantId/qr', requireManager, async (req, res) => {
    if (req.manager.canCreateCodes === false) { await auditDenial(req, 'Consultation du QR boutique refusée : la permission QR du gestionnaire est désactivée.', req.params.merchantId); return res.status(403).json({ error: 'Le PDG a désactivé la permission QR pour votre compte.' }); }
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canCreateStoreQr')) return;
    try { return await getMerchantQr(req, res, 'manager'); }
    catch (error) { return apiError(res, error, 'Impossible de consulter le QR de la boutique.'); }
  });
  app.post('/api/manager/merchants/:merchantId/qr/view', requireManager, async (req, res) => {
    if (req.manager.canCreateCodes === false) { await auditDenial(req, 'Consultation du QR boutique refusée : la permission QR du gestionnaire est désactivée.', req.params.merchantId); return res.status(403).json({ error: 'Le PDG a désactivé la permission QR pour votre compte.' }); }
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canCreateStoreQr')) return;
    return recordMerchantQrView(req, res, 'manager');
  });
  app.post('/api/manager/merchants/:merchantId/qr', requireManager, async (req, res) => {
    if (req.manager.canCreateCodes === false) { await auditDenial(req, 'Activation de QR boutique refusée : la permission QR du gestionnaire est désactivée.', req.params.merchantId); return res.status(403).json({ error: 'Le PDG a désactivé la permission QR pour votre compte.' }); }
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canCreateStoreQr')) return;
    return setMerchantQrState(req, res, 'manager', true);
  });
  app.put('/api/manager/merchants/:merchantId/qr', requireManager, async (req, res) => {
    if (req.manager.canCreateCodes === false) { await auditDenial(req, 'Modification du statut QR refusée : la permission QR du gestionnaire est désactivée.', req.params.merchantId); return res.status(403).json({ error: 'Le PDG a désactivé la permission QR pour votre compte.' }); }
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canCreateStoreQr')) return;
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Indiquez si le QR doit être activé ou désactivé.' });
    return setMerchantQrState(req, res, 'manager', req.body.enabled);
  });
  app.get('/api/manager/merchants/:merchantId/audit', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canViewAudit')) return;
    res.json(await commerce.listAudit({ merchantId: req.params.merchantId, page: Math.max(1, Number.parseInt(req.query.page, 10) || 1) }));
  });

  // CEO-only merchant controls and assignments.
  app.get('/api/admin/merchants', requireAdmin, async (req, res) => {
    try { res.json({ data: await commerce.listMerchants({ includeDeleted: req.query.includeDeleted === '1' }) }); } catch (error) { apiError(res, error, 'Impossible de charger les marchands.'); }
  });
  app.post('/api/admin/merchants', requireAdmin, async (req, res) => createMerchantAccount(req, res, 'admin'));
  app.get('/api/admin/merchants/:merchantId', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: true }); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
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
  app.post('/api/admin/merchants/:merchantId/archive', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: true });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    if (merchant.deletedAt) return res.status(409).json({ error: 'Ce compte est déjà archivé.' });
    if (safeText(req.body?.confirmUsername, 80).toLowerCase() !== merchant.username.toLowerCase()) return res.status(400).json({ error: 'Saisissez exactement l’identifiant du compte pour confirmer l’archivage.' });
    const reason = safeText(req.body?.reason, 500) || 'Compte archivé par le PDG.';
    const archived = await commerce.archiveMerchant(merchant.id, reason);
    await audit('admin', req, { action: 'account_archived', merchantId: merchant.id, entityId: merchant.id,
      summary: `Compte marchand « ${merchant.displayName} » archivé; données conservées et sessions révoquées.`, beforeData: accountSnapshot(merchant), afterData: accountSnapshot(archived), metadata: { reason } });
    merchantEvent(merchant.id, 'account_archived'); res.json({ data: archived });
  });
  app.post('/api/admin/merchants/:merchantId/restore', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: true });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    if (!merchant.deletedAt) return res.status(409).json({ error: 'Ce compte n’est pas archivé.' });
    if (safeText(req.body?.confirmUsername, 80).toLowerCase() !== merchant.username.toLowerCase()) return res.status(400).json({ error: 'Saisissez exactement l’identifiant du compte pour confirmer la restauration.' });
    try {
      const restored = await commerce.restoreMerchant(merchant.id);
      await audit('admin', req, { action: 'account_restored', merchantId: merchant.id, entityId: merchant.id,
        summary: `Compte marchand « ${merchant.displayName} » restauré; identifiant et historique conservés.`, beforeData: accountSnapshot(merchant), afterData: accountSnapshot(restored) });
      merchantEvent(merchant.id, 'account_restored'); res.json({ data: restored });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); apiError(res, error, 'Impossible de restaurer ce compte.'); }
  });
  app.get('/api/admin/merchant-password-reset-requests', requireAdmin, async (req, res) => {
    try { res.json({ data: await commerce.listMerchantPasswordResetRequests() }); }
    catch (error) { apiError(res, error, 'Impossible de charger les demandes de réinitialisation.'); }
  });
  // One-time secure link for a merchant who forgot the password: identity must be verified beforehand.
  app.post('/api/admin/merchants/:merchantId/password-reset-link', requireAdmin, async (req, res) => {
    try {
      const merchant = await commerce.getMerchant(req.params.merchantId);
      if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
      const confirmed = safeText(req.body?.confirmUsername, 80).toLowerCase();
      if (confirmed !== String(merchant.username || '').toLowerCase()) return res.status(400).json({ error: 'Saisissez exactement l’identifiant du compte pour confirmer la vérification d’identité.' });
      const token = crypto.randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + RESET_LINK_TTL_MS).toISOString();
      const discarded = crypto.randomBytes(32).toString('base64url');
      const updated = await commerce.setMerchantPasswordResetLink(merchant.id, hashPassword(discarded), hashToken(token), expiresAt);
      if (!updated) return res.status(404).json({ error: 'Marchand introuvable.' });
      await audit('admin', req, { action: 'password_reset', merchantId: merchant.id, entityId: merchant.id,
        summary: `Lien sécurisé de réinitialisation émis pour « ${merchant.displayName} »; sessions révoquées et changement obligatoire.`,
        beforeData: accountSnapshot(merchant), afterData: accountSnapshot(updated), metadata: { method: 'reset_link', ttlMinutes: Math.round(RESET_LINK_TTL_MS / 60000) } });
      res.json({ ok: true, method: 'link', resetPath: `/merchant/reset-password#token=${token}`, expiresAt, data: updated });
    } catch (error) { apiError(res, error, 'Impossible d’émettre le lien de réinitialisation.'); }
  });
  app.post('/api/admin/merchants/:merchantId/reset-password', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    let temporaryPassword; try { temporaryPassword = generateTemporaryPassword(req.body?.temporaryPasswordLength); } catch (error) { return res.status(400).json({ error: error.message }); }
    const expiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
    const updated = await commerce.setMerchantTemporaryPassword(merchant.id, hashPassword(temporaryPassword), expiresAt);
    await audit('admin', req, { action: 'password_reset', merchantId: merchant.id, entityId: merchant.id, summary: `Mot de passe temporaire de « ${merchant.displayName} » réinitialisé; sessions révoquées.`, beforeData: accountSnapshot(merchant), afterData: accountSnapshot(updated) });
    res.json({ temporaryPassword, expiresAt });
  });
  app.post('/api/admin/merchants/:merchantId/media', requireAdmin, async (req, res) => {
    if (!await commerce.getMerchant(req.params.merchantId)) return res.status(404).json({ error: 'Marchand introuvable.' });
    try { await saveMediaUpload(req, res, req.params.merchantId); } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Échec de l’envoi de l’image.'); }
  });
  app.get('/api/admin/merchants/:merchantId/media/:mediaId', requireAdmin, async (req, res) => {
    const media = await commerce.getMedia(req.params.mediaId); if (!media || media.merchantId !== req.params.merchantId) return res.status(404).end(); return sendMedia(res, media);
  });
  app.delete('/api/admin/merchants/:merchantId/media/:mediaId', requireAdmin, async (req, res) => {
    const result = await commerce.deleteUnusedMedia(req.params.mediaId, req.params.merchantId); if (!result.found) return res.status(404).json({ error: 'Image introuvable.' });
    if (result.inUse) return res.status(409).json({ error: 'Cette image est encore utilisée.' }); res.json({ ok: true });
  });
  app.get('/api/admin/merchants/:merchantId/qr', requireAdmin, async (req, res) => {
    try { return await getMerchantQr(req, res, 'admin'); }
    catch (error) { return apiError(res, error, 'Impossible de consulter le QR de la boutique.'); }
  });
  app.post('/api/admin/merchants/:merchantId/qr/view', requireAdmin, async (req, res) => recordMerchantQrView(req, res, 'admin'));
  app.post('/api/admin/merchants/:merchantId/qr', requireAdmin, async (req, res) => setMerchantQrState(req, res, 'admin', true));
  app.put('/api/admin/merchants/:merchantId/qr', requireAdmin, async (req, res) => {
    if (typeof req.body?.enabled !== 'boolean') return res.status(400).json({ error: 'Indiquez si le QR doit être activé ou désactivé.' });
    return setMerchantQrState(req, res, 'admin', req.body.enabled);
  });
  app.get('/api/admin/merchants/:merchantId/assignments', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    res.json({ data: await commerce.listAssignments(merchant.id) });
  });

  app.put('/api/admin/merchants/:merchantId/store', requireAdmin, async (req, res) => {
    try { const row = await getOrCreateStore(req.params.merchantId, req.body || {}, 'admin', req); res.json({ data: publicStoreDetails(row) }); }
    catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer la boutique.'); }
  });
  app.get('/api/admin/merchants/:merchantId/typography', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: true });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const row = await commerce.getStoreByMerchantId(req.params.merchantId);
    if (!row) return res.status(409).json({ error: 'Ce marchand n’a pas encore de boutique configurée.' });
    res.setHeader('Cache-Control', 'no-store');
    return res.json({ data: { merchantId: merchant.id, storeId: row.id, storeName: row.name, slug: row.slug,
      theme: sanitizeTheme(row.theme, DEFAULT_THEME) } });
  });
  app.put('/api/admin/merchants/:merchantId/typography', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId, { includeDeleted: true });
    if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const before = await commerce.getStoreByMerchantId(req.params.merchantId);
    if (!before) return res.status(409).json({ error: 'Ce marchand n’a pas encore de boutique configurée.' });
    if (!req.body?.reset && (!req.body?.typography || typeof req.body.typography !== 'object' || Array.isArray(req.body.typography)))
      return res.status(400).json({ error: 'Paramètres typographiques invalides.' });
    const previousTheme = sanitizeTheme(before.theme, DEFAULT_THEME);
    const nextTheme = sanitizeTheme({ ...previousTheme, typography: req.body.reset === true ? DEFAULT_TYPOGRAPHY : req.body.typography }, previousTheme);
    try {
      const updated = await commerce.updateStore(before.id, { ...before, theme: nextTheme });
      await audit('admin', req, { action: req.body.reset === true ? 'store_typography_reset' : 'store_typography_updated',
        merchantId: merchant.id, entityId: before.id, summary: req.body.reset === true ? `Réglages typographiques de « ${before.name} » réinitialisés.` : `Réglages typographiques de « ${before.name} » modifiés.`,
        beforeData: { typography: previousTheme.typography }, afterData: { typography: nextTheme.typography }, metadata: { storeId: before.id } });
      merchantEvent(merchant.id, 'store_updated', { storeId: before.id });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { merchantId: merchant.id, storeId: updated.id, storeName: updated.name, slug: updated.slug, theme: updated.theme } });
    } catch (error) { return apiError(res, error, 'Impossible d’enregistrer la typographie de la boutique.'); }
  });
  app.get('/api/admin/merchants/:merchantId/products', requireAdmin, async (req, res) => {
    const row = await commerce.getStoreByMerchantId(req.params.merchantId); res.json({ data: row ? await commerce.listProducts(row.id) : [], storeId: row?.id || '' });
  });
  app.post('/api/admin/merchants/:merchantId/products', requireAdmin, async (req, res) => {
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); if (!row) return res.status(409).json({ error: 'Créez d’abord la boutique.' });
      const product = await commerce.saveProduct(row.id, await validateProductInput(req.body || {}, req.params.merchantId, commerce)); await audit('admin', req, { action: 'product_created', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » créé.`, afterData: productSnapshot(product), metadata: { storeId: row.id } });
      merchantEvent(req.params.merchantId, 'product_updated', { productId: product.id }); res.status(201).json({ data: product });
    } catch (error) { if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message }); if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible d’enregistrer le produit.'); }
  });
  app.put('/api/admin/merchants/:merchantId/products/:productId', requireAdmin, async (req, res) => {
    try { const row = await commerce.getStoreByMerchantId(req.params.merchantId); const before = await commerce.getProduct(req.params.productId);
      if (!row || !before || before.storeId !== row.id) return res.status(404).json({ error: 'Produit introuvable.' });
      const product = await commerce.saveProduct(row.id, await validateProductInput(req.body || {}, req.params.merchantId, commerce, before), before.id); await audit('admin', req, { action: 'product_updated', merchantId: req.params.merchantId, entityId: product.id, summary: `Produit « ${product.name} » modifié.`, beforeData: productSnapshot(before), afterData: productSnapshot(product), metadata: { storeId: row.id } });
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
    const result = await commerce.listOrders({ merchantId: safeText(req.query.merchantId, 100), status: ['pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled','rejected'].includes(status) ? status : '', search, page, limit });
    const [merchants, stores] = await Promise.all([commerce.listMerchants({ includeDeleted: true }), Promise.all([...new Set(result.data.map((order) => order.storeId))].map((id) => commerce.getStoreById(id)))]);
    const merchantNames = new Map(merchants.map((merchant) => [merchant.id, merchant.displayName]));
    const storeNames = new Map(stores.filter(Boolean).map((store) => [store.id, store.name]));
    res.setHeader('Cache-Control', 'no-store');
    res.json({ ...result, data: result.data.map((order) => ({ ...order, storeName: storeNames.get(order.storeId) || 'Boutique archivée', merchantName: merchantNames.get(order.merchantId) || 'Compte archivé' })) });
  });
  app.get('/api/admin/merchant-customer-blocks', requireAdmin, async (req, res) => {
    const { page, limit, search, status } = pagination(req.query);
    res.setHeader('Cache-Control', 'no-store');
    try { return res.json(await commerce.listCustomerBlocks({ merchantId: safeText(req.query.merchantId, 100),
      status: ['active','unblocked'].includes(status) ? status : '', search, page, limit })); }
    catch (error) { return apiError(res, error, 'Impossible de charger la supervision des blocages clients.'); }
  });
  app.post('/api/admin/merchant-customer-blocks/:blockId/unblock', requireAdmin, async (req, res) => unblockCustomer(req, res, { role: 'admin' }));
  app.get('/api/admin/merchants/:merchantId/orders', requireAdmin, async (req, res) => {
    const { page, limit, search, status } = pagination(req.query);
    res.json(await commerce.listOrders({ merchantId: req.params.merchantId, status: ['pending','confirmed','preparing','ready','out_for_delivery','completed','cancelled','rejected'].includes(status) ? status : '', search, page, limit }));
  });
  app.get('/api/admin/merchants/:merchantId/customer-blocks', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const storeRow = await commerce.getStoreByMerchantId(merchant.id); if (!storeRow) return res.json({ data: [], total: 0, page: 1, limit: 50 });
    const { page, limit, search, status } = pagination(req.query); res.setHeader('Cache-Control', 'no-store');
    return res.json(await commerce.listCustomerBlocks({ storeId: storeRow.id, status: ['active','unblocked'].includes(status) ? status : '', search, page, limit }));
  });
  app.post('/api/admin/merchants/:merchantId/customer-blocks', requireAdmin, async (req, res) => {
    const merchant = await commerce.getMerchant(req.params.merchantId); if (!merchant) return res.status(404).json({ error: 'Marchand introuvable.' });
    const storeRow = await commerce.getStoreByMerchantId(merchant.id); if (!storeRow) return res.status(409).json({ error: 'Configurez d’abord la boutique.' });
    return createCustomerBlock(req, res, { role: 'admin', merchantId: merchant.id, storeId: storeRow.id });
  });
  app.post('/api/admin/merchants/:merchantId/customer-blocks/:blockId/unblock', requireAdmin, async (req, res) => {
    const storeRow = await commerce.getStoreByMerchantId(req.params.merchantId); if (!storeRow) return res.status(404).json({ error: 'Entrée introuvable.' });
    return unblockCustomer(req, res, { role: 'admin', storeId: storeRow.id });
  });
  app.post('/api/admin/merchant-orders/:orderId/status', requireAdmin, async (req, res) => updateOrderStatus(req, res, req.params.orderId, 'admin'));
  app.post('/api/admin/merchant-orders/:orderId/cancellations/:requestId', requireAdmin, async (req, res) => {
    const order = await commerce.getOrder(req.params.orderId); if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
    return decideOrderCancellation(req, res, order, 'admin');
  });
  app.get('/api/admin/merchant-orders/:orderId/table-photo',requireAdmin,async(req,res)=>{const order=await commerce.getOrder(req.params.orderId);if(!order)return res.status(404).json({error:'Photo introuvable ou expirée.'});return getOrderTablePhoto(req,res,order,'admin');});
  app.delete('/api/admin/merchant-orders/:orderId/table-photo',requireAdmin,async(req,res)=>{const order=await commerce.getOrder(req.params.orderId);if(!order)return res.status(404).json({error:'Photo introuvable ou expirée.'});return removeOrderTablePhoto(req,res,order,'admin');});
  app.get('/api/manager/merchants/:merchantId/orders/:orderId/table-photo',requireManager,async(req,res)=>{
    const order=await commerce.getOrder(req.params.orderId);if(!order||order.merchantId!==req.params.merchantId)return res.status(404).json({error:'Photo introuvable ou expirée.'});return getOrderTablePhoto(req,res,order,'manager');
  });
  app.delete('/api/manager/merchants/:merchantId/orders/:orderId/table-photo',requireManager,async(req,res)=>{
    const order=await commerce.getOrder(req.params.orderId);if(!order||order.merchantId!==req.params.merchantId)return res.status(404).json({error:'Photo introuvable ou expirée.'});
    if(!await requireManagerScope(req,res,order.merchantId,'canManageOrders'))return;return removeOrderTablePhoto(req,res,order,'manager');
  });
  app.post('/api/manager/merchants/:merchantId/orders/:orderId/status', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const order = await commerce.getOrder(req.params.orderId); if (!order || order.merchantId !== req.params.merchantId) return res.status(404).json({ error: 'Commande introuvable.' });
    return updateOrderStatus(req, res, order.id, 'manager');
  });
  app.post('/api/manager/merchants/:merchantId/orders/:orderId/cancellations/:requestId', requireManager, async (req, res) => {
    if (!await requireManagerScope(req, res, req.params.merchantId, 'canManageOrders')) return;
    const order = await commerce.getOrder(req.params.orderId); if (!order || order.merchantId !== req.params.merchantId) return res.status(404).json({ error: 'Commande introuvable.' });
    return decideOrderCancellation(req, res, order, 'manager');
  });
  app.get('/api/merchant/orders/:orderId/table-photo', requireMerchant, async (req,res)=>{
    const order=await commerce.getOrder(req.params.orderId);if(!order||order.merchantId!==req.merchant.id)return res.status(404).json({error:'Photo introuvable ou expirée.'});
    return getOrderTablePhoto(req,res,order,'merchant');
  });
  app.delete('/api/merchant/orders/:orderId/table-photo', requireMerchant, async (req,res)=>{
    const order=await commerce.getOrder(req.params.orderId);if(!order||order.merchantId!==req.merchant.id)return res.status(404).json({error:'Photo introuvable ou expirée.'});
    return removeOrderTablePhoto(req,res,order,'merchant');
  });
  app.post('/api/merchant/orders/:orderId/status', requireMerchant, async (req, res) => {
    const order = await commerce.getOrder(req.params.orderId); if (!order || order.merchantId !== req.merchant.id) return res.status(404).json({ error: 'Commande introuvable.' });
    return updateOrderStatus(req, res, order.id, 'merchant');
  });
  app.post('/api/merchant/orders/:orderId/cancellations/:requestId', requireMerchant, async (req, res) => {
    const order = await commerce.getOrder(req.params.orderId); if (!order || order.merchantId !== req.merchant.id) return res.status(404).json({ error: 'Commande introuvable.' });
    return decideOrderCancellation(req, res, order, 'merchant');
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
      const temporaryPassword = generateTemporaryPassword(req.body?.temporaryPasswordLength); const passwordExpiresAt = new Date(Date.now() + TEMP_PASSWORD_TTL_MS).toISOString();
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
  async function decideOrderCancellation(req, res, orderBefore, role) {
    const decision = safeText(req.body?.decision, 20);
    const note = safeText(req.body?.note, 300);
    if (!['accepted', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Choisissez accepter ou refuser la demande.' });
    const requestBefore = (orderBefore.cancellationRequests || []).find((item) => item.id === req.params.requestId);
    if (!requestBefore) return res.status(404).json({ error: 'Demande d’annulation introuvable.' });
    const actorId = role === 'merchant' ? req.merchant.id : role === 'manager' ? req.manager.id : String(process.env.ADMIN_USERNAME || 'admin');
    try {
      const result = await commerce.decideOrderCancellationRequest(orderBefore.id, req.params.requestId, decision, { actorType: role, actorId, note });
      if (!result) return res.status(404).json({ error: 'Demande d’annulation introuvable.' });
      const order = await commerce.getOrder(orderBefore.id);
      if (!result.idempotent) {
        await audit(role, req, { action: `order_cancellation_${decision}`, merchantId: orderBefore.merchantId, entityId: orderBefore.id,
          summary: `Demande d’annulation de ${orderBefore.reference} ${decision === 'accepted' ? 'acceptée' : 'refusée'}.`,
          beforeData: { requestStatus: requestBefore.status, orderStatus: orderBefore.status },
          afterData: { requestStatus: result.request.status, orderStatus: order?.status },
          metadata: { storeId: orderBefore.storeId, reference: orderBefore.reference, requestId: req.params.requestId } });
        merchantEvent(orderBefore.merchantId, 'order_cancellation_decision', { orderId: orderBefore.id, reference: orderBefore.reference, decision, status: order?.status });
        if (role !== 'merchant') sendMerchantPush(orderBefore.merchantId, { type: 'order_cancellation_decision', title: 'Demande d’annulation traitée',
          body: `Commande ${orderBefore.reference} ${decision === 'accepted' ? 'annulée' : 'maintenue'}.`, orderId: orderBefore.id,
          url: `/merchant/?order=${encodeURIComponent(orderBefore.id)}` }).catch(() => {});
      }
      return res.json({ data: { request: result.request, idempotent: result.idempotent, order } });
    } catch (error) {
      if (error.code === 'CANCELLATION_NOT_ALLOWED') return res.status(409).json({ error: error.message, code: error.code });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      return apiError(res, error, 'Impossible de traiter la demande d’annulation.');
    }
  }

  async function updateOrderStatus(req, res, orderId, role) {
    const before = await commerce.getOrder(orderId); if (!before) return res.status(404).json({ error: 'Commande introuvable.' });
    const status = safeText(req.body?.status, 30); const note = safeText(req.body?.reason ?? req.body?.note, 300);
    if (['cancelled', 'rejected'].includes(status) && !note) return res.status(400).json({ error: 'Indiquez le motif du refus ou de l’annulation.' });
    try {
      const order = await commerce.setOrderStatus(orderId, status, { actorType: role, actorId: role === 'merchant' ? req.merchant.id : role === 'manager' ? req.manager.id : String(process.env.ADMIN_USERNAME || 'admin'), note });
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
      await audit(role, req, { action: `order_${status}`, merchantId: order.merchantId, entityId: order.id, summary: `Commande ${order.reference} : statut ${status}.`,
        beforeData: { status: before.status }, afterData: { status: order.status }, metadata: { storeId: order.storeId, reference: order.reference } });
      merchantEvent(order.merchantId, 'order_status', { orderId: order.id, reference: order.reference, status: order.status });
      if (role !== 'merchant') sendMerchantPush(order.merchantId, { type: 'order_status', title: 'Mise à jour de commande', body: `Commande ${order.reference} : ${statusLabelsForPush(order.status)}`,
        orderId: order.id, url: `/merchant/?order=${encodeURIComponent(order.id)}` }).catch(() => {});
      res.json({ data: order });
    } catch (error) { if (error.message && !error.code) return res.status(400).json({ error: error.message }); apiError(res, error, 'Impossible de changer le statut de la commande.'); }
  }
  async function getOrderTablePhoto(req,res,order,role) {
    if(role==='manager'&&!await requireManagerScope(req,res,order.merchantId,'canManageOrders'))return;
    if(role==='merchant'&&order.merchantId!==req.merchant.id)return res.status(404).json({error:'Photo introuvable ou expirée.'});
    const photo=await commerce.getOrderPhoto(order.id,order.merchantId);if(!photo)return res.status(404).json({error:'Photo introuvable, supprimée ou expirée.'});
    return sendOrderTablePhoto(res,photo,order.reference);
  }
  async function removeOrderTablePhoto(req,res,order,role) {
    const actorId=role==='merchant'?req.merchant.id:role==='manager'?req.manager.id:String(process.env.ADMIN_USERNAME||'admin');
    const photo=await commerce.deleteOrderPhoto(order.id,order.merchantId,{actorType:role,actorId});if(!photo)return res.status(404).json({error:'Photo introuvable ou déjà supprimée.'});
    await audit(role,req,{action:'order_table_photo_deleted',merchantId:order.merchantId,entityId:order.id,
      summary:`Photo de table de la commande ${order.reference} supprimée.`,beforeData:{byteSize:photo.byteSize},afterData:{deletedAt:photo.deletedAt},metadata:{storeId:order.storeId,reference:order.reference}});
    merchantEvent(order.merchantId,'order_photo_deleted',{orderId:order.id,reference:order.reference});
    res.json({data:{orderId:order.id,deletedAt:photo.deletedAt}});
  }

  function registerExtraMerchantRoutes() {
    const errorResponse = (res, error, fallback) => {
      if (error.code === 'NOT_FOUND') return res.status(404).json({ error: error.message });
      if (['ALREADY_PARTICIPATED','CAMPAIGN_CLOSED','GIFT_CARD_UNAVAILABLE','INSUFFICIENT_BALANCE','IDEMPOTENCY_CONFLICT'].includes(error.code)) return res.status(409).json({ error: error.message, code: error.code });
      if (['AUTHORIZATION_REQUIRED','AUTHORIZATION_ATTESTATION_REQUIRED','AUTHORIZATION_REVIEW_REQUIRED','AUTHORIZATION_MISMATCH','AUTHORIZATION_ALREADY_APPROVED'].includes(error.code)) return res.status(400).json({ error: error.message, code: error.code });
      if (error.message && !error.code) return res.status(400).json({ error: error.message });
      return apiError(res, error, fallback);
    };
    app.get('/api/admin/merchant-ads', requireAdmin, async (_req,res)=>{
      try { res.setHeader('Cache-Control','no-store');res.json({data:await extras.listAdminAdCampaigns()}); }
      catch(error) { apiError(res,error,'Impossible de charger la supervision publicitaire.'); }
    });
    app.post('/api/admin/merchant-ads/:adId/status', requireAdmin, async (req,res)=>{
      try {
        const before=(await extras.listAdminAdCampaigns()).find((row)=>row.id===req.params.adId);if(!before)return res.status(404).json({error:'Publicité introuvable.'});
        const status=safeText(req.body?.status,20);const row=await extras.setAdminAdStatus(req.params.adId,status);if(!row)return res.status(404).json({error:'Publicité introuvable.'});
        await audit('admin',req,{action:'ad_admin_status',merchantId:row.merchantId,entityId:row.id,summary:`Supervision PDG : publicité « ${row.title} » ${status==='active'?'activée':status==='paused'?'mise en pause':'remise en brouillon'}.`,beforeData:before,afterData:row});
        merchantEvent(row.merchantId,'ad_updated',{campaignId:row.id});res.json({data:row});
      } catch(error) { errorResponse(res,error,'Impossible de modifier le statut publicitaire.'); }
    });
    app.delete('/api/admin/merchant-ads/:adId', requireAdmin, async (req,res)=>{
      try {
        const before=(await extras.listAdminAdCampaigns()).find((row)=>row.id===req.params.adId);if(!before)return res.status(404).json({error:'Publicité introuvable.'});
        const row=await extras.archiveAdminAdCampaign(req.params.adId);if(!row)return res.status(404).json({error:'Publicité introuvable.'});
        await audit('admin',req,{action:'ad_admin_archived',merchantId:row.merchantId,entityId:row.id,summary:`Publicité « ${row.title} » archivée par le PDG; statistiques conservées.`,beforeData:before,afterData:row});
        merchantEvent(row.merchantId,'ad_updated',{campaignId:row.id});res.json({data:row});
      } catch(error) { apiError(res,error,'Impossible d’archiver cette publicité.'); }
    });
    app.get('/api/admin/reward-authorizations', requireAdmin, async (_req, res) => {
      try { res.setHeader('Cache-Control','no-store'); res.json({ data:await extras.listRewardAuthorizationRequests() }); }
      catch (error) { apiError(res,error,'Impossible de charger les demandes d’autorisation promotionnelle.'); }
    });
    app.post('/api/admin/reward-authorizations/:campaignId/decision', requireAdmin, async (req, res) => {
      try {
        const decision=safeText(req.body?.decision,20); const reviewNote=safeText(req.body?.reviewNote,500);
        const before=(await extras.listRewardAuthorizationRequests()).find((row)=>row.id===req.params.campaignId);
        if(!before)return res.status(404).json({error:'Demande d’autorisation introuvable.'});
        const reviewedBy=String(process.env.ADMIN_USERNAME||'admin');
        const row=await extras.reviewRewardAuthorization(req.params.campaignId,{decision,reviewNote,reviewedBy});
        await audit('admin',req,{action:`reward_authorization_${decision}`,merchantId:row.merchantId,entityId:row.id,
          summary:`Demande d’autorisation de l’offre « ${row.title} » : ${decision}.`,beforeData:before,afterData:row,metadata:{decision,authorizationReference:row.authorizationReference}});
        merchantEvent(row.merchantId,'reward_campaign_updated',{campaignId:row.id});
        res.json({data:row});
      } catch (error) { errorResponse(res,error,'Impossible d’enregistrer la décision d’autorisation.'); }
    });
    const mountRole = (role) => {
      const prefix = role === 'merchant' ? '/api/merchant' : `/api/${role}/merchants/:merchantId`;
      const auth = role === 'merchant' ? requireMerchant : role === 'manager' ? requireManager : requireAdmin;
      const actorId = (req) => role === 'merchant' ? req.merchant.id : role === 'manager' ? req.manager.id : String(process.env.ADMIN_USERNAME || 'admin');
      const resolve = async (req, res, permission = 'canManageStore') => {
        const merchantId = role === 'merchant' ? req.merchant.id : req.params.merchantId;
        if (role === 'manager' && !await requireManagerScope(req, res, merchantId, permission)) return null;
        const merchant = await commerce.getMerchant(merchantId);
        if (!merchant) { res.status(404).json({ error: 'Marchand introuvable ou compte archivé.' }); return null; }
        const storeRow = await commerce.getStoreByMerchantId(merchant.id);
        if (!storeRow) { res.status(409).json({ error: 'Configurez d’abord la boutique.' }); return null; }
        return { merchantId: merchant.id, merchant, store: storeRow };
      };
      const mount = (method, suffix, permission, handler, fallback) => {
        app[method](`${prefix}/${suffix}`, auth, async (req, res) => {
          const context = await resolve(req, res, permission); if (!context) return;
          try { await handler(req, res, context); }
          catch (error) { errorResponse(res, error, fallback); }
        });
      };
      mount('get', 'ads', 'canManageStore', async (_req, res, ctx) => res.json({ data: await extras.listAdCampaigns(ctx.store.id) }), 'Impossible de charger les publicités.');
      mount('post', 'ads', 'canManageStore', async (req, res, ctx) => {
        const row = await extras.saveAdCampaign(ctx.store.id, ctx.merchantId, req.body || {});
        if (!row.idempotent) await audit(role, req, { action: 'ad_created', merchantId: ctx.merchantId, entityId: row.id, summary: `Annonce « ${row.title} » créée.`, afterData: row });
        if (!row.idempotent) merchantEvent(ctx.merchantId, 'ad_updated', { campaignId: row.id }); res.status(row.idempotent ? 200 : 201).json({ data: row });
      }, 'Impossible de créer cette publicité.');
      mount('put', 'ads/:adId', 'canManageStore', async (req, res, ctx) => {
        const before = (await extras.listAdCampaigns(ctx.store.id)).find((row) => row.id === req.params.adId);
        const row = await extras.saveAdCampaign(ctx.store.id, ctx.merchantId, req.body || {}, req.params.adId);
        if (!row) return res.status(404).json({ error: 'Publicité introuvable.' });
        await audit(role, req, { action: 'ad_updated', merchantId: ctx.merchantId, entityId: row.id, summary: `Annonce « ${row.title} » modifiée.`, beforeData: before, afterData: row });
        merchantEvent(ctx.merchantId, 'ad_updated', { campaignId: row.id }); res.json({ data: row });
      }, 'Impossible de modifier cette publicité.');
      mount('post', 'ads/:adId/status', 'canManageStore', async (req, res, ctx) => {
        const status = safeText(req.body?.status, 20); const before = (await extras.listAdCampaigns(ctx.store.id)).find((row) => row.id === req.params.adId);
        const row = await extras.setAdStatus(ctx.store.id, req.params.adId, status); if (!row) return res.status(404).json({ error: 'Publicité introuvable.' });
        await audit(role, req, { action: 'ad_status', merchantId: ctx.merchantId, entityId: row.id, summary: `Annonce « ${row.title} » ${status === 'active' ? 'activée' : 'mise en pause'}.`, beforeData: before, afterData: row });
        merchantEvent(ctx.merchantId, 'ad_updated', { campaignId: row.id }); res.json({ data: row });
      }, 'Impossible de modifier le statut de la publicité.');
      mount('delete', 'ads/:adId', 'canManageStore', async (req, res, ctx) => {
        const before=(await extras.listAdCampaigns(ctx.store.id)).find((row)=>row.id===req.params.adId);
        if(!before)return res.status(404).json({error:'Publicité introuvable.'});
        const row=await extras.archiveAdCampaign(ctx.store.id,req.params.adId);if(!row)return res.status(404).json({error:'Publicité introuvable.'});
        await audit(role,req,{action:'ad_archived',merchantId:ctx.merchantId,entityId:row.id,summary:`Publicité « ${row.title} » archivée; son historique statistique est conservé.`,beforeData:before,afterData:row});
        merchantEvent(ctx.merchantId,'ad_updated',{campaignId:row.id});res.json({data:row});
      }, 'Impossible d’archiver cette publicité.');

      mount('get', 'service-points', 'canManageStore', async (_req, res, ctx) => res.json({ data: await extras.listServicePoints(ctx.store.id) }), 'Impossible de charger les tables et emplacements.');
      mount('post', 'service-points', 'canManageStore', async (req, res, ctx) => {
        const row = await extras.createServicePoint(ctx.store.id, req.body || {});
        if (!row.idempotent) await audit(role, req, { action: 'service_point_created', merchantId: ctx.merchantId, entityId: row.id, summary: `QR d’emplacement « ${row.name} » créé.`, afterData: { ...row, publicCode: undefined } });
        if (!row.idempotent) merchantEvent(ctx.merchantId, 'service_point_updated', { pointId: row.id });
        const url = `${publicBaseUrl || `${req.protocol}://${req.get('host')}`}/t/${row.publicCode}`;
        res.status(row.idempotent ? 200 : 201).json({ data: { ...row, path: `/t/${row.publicCode}`, url } });
      }, 'Impossible de créer ce QR d’emplacement.');
      mount('put', 'service-points/:pointId', 'canManageStore', async (req, res, ctx) => {
        const before = (await extras.listServicePoints(ctx.store.id)).find((row) => row.id === req.params.pointId);
        const row = await extras.updateServicePoint(ctx.store.id, req.params.pointId, req.body || {}); if (!row) return res.status(404).json({ error: 'Table ou emplacement introuvable.' });
        await audit(role, req, { action: 'service_point_updated', merchantId: ctx.merchantId, entityId: row.id, summary: `Emplacement « ${row.name} » modifié.`, beforeData: before, afterData: { ...row, publicCode: undefined } });
        merchantEvent(ctx.merchantId, 'service_point_updated', { pointId: row.id }); res.json({ data: row });
      }, 'Impossible de modifier cette table ou cet emplacement.');
      mount('delete', 'service-points/:pointId', 'canManageStore', async (req, res, ctx) => {
        const before = (await extras.listServicePoints(ctx.store.id)).find((row) => row.id === req.params.pointId);
        if (!before) return res.status(404).json({ error: 'Table ou emplacement introuvable.' });
        const row = await extras.updateServicePoint(ctx.store.id, before.id, { ...before, status: 'inactive' });
        await audit(role, req, { action: 'service_point_archived', merchantId: ctx.merchantId, entityId: row.id, summary: `Emplacement « ${row.name} » désactivé; son QR historique est conservé.`, beforeData: before, afterData: { ...row, publicCode: undefined } });
        merchantEvent(ctx.merchantId, 'service_point_updated', { pointId: row.id }); res.json({ data: row });
      }, 'Impossible de désactiver cette table ou cet emplacement.');

      mount('get', 'reward-campaigns', 'canManageStore', async (_req, res, ctx) => res.json({ data: await extras.listRewardCampaigns(ctx.store.id) }), 'Impossible de charger les offres gratuites.');
      mount('post', 'reward-campaigns', 'canManageStore', async (req, res, ctx) => {
        const row = await extras.createRewardCampaign(ctx.store.id, ctx.merchantId, req.body || {});
        if (!row.idempotent) await audit(role, req, { action: 'reward_campaign_created', merchantId: ctx.merchantId, entityId: row.id, summary: `Offre gratuite « ${row.title} » créée.`, afterData: row });
        if (!row.idempotent) merchantEvent(ctx.merchantId, 'reward_campaign_updated', { campaignId: row.id }); res.status(row.idempotent ? 200 : 201).json({ data: row });
      }, 'Impossible de créer cette offre gratuite.');
      mount('post', 'reward-campaigns/:campaignId/authorization', 'canManageStore', async (req, res, ctx) => {
        const before=(await extras.listRewardCampaigns(ctx.store.id)).find((row)=>row.id===req.params.campaignId);
        const row=await extras.submitRewardAuthorizationReference(ctx.store.id,req.params.campaignId,req.body||{});
        if(!row)return res.status(404).json({error:'Offre introuvable.'});
        await audit(role,req,{action:'reward_authorization_submitted',merchantId:ctx.merchantId,entityId:row.id,
          summary:`Référence d’autorisation soumise pour l’offre « ${row.title} ».`,beforeData:before,afterData:row,metadata:{authorizationReference:row.authorizationReference}});
        merchantEvent(ctx.merchantId,'reward_campaign_updated',{campaignId:row.id});res.json({data:row});
      },'Impossible de soumettre cette référence d’autorisation.');
      mount('post', 'reward-campaigns/:campaignId/status', 'canManageStore', async (req, res, ctx) => {
        const status = safeText(req.body?.status, 20); const before = (await extras.listRewardCampaigns(ctx.store.id)).find((row) => row.id === req.params.campaignId);
        const row = await extras.setRewardCampaignStatus(ctx.store.id, req.params.campaignId, { ...(req.body || {}), status }); if (!row) return res.status(404).json({ error: 'Offre introuvable.' });
        await audit(role, req, { action: 'reward_campaign_status', merchantId: ctx.merchantId, entityId: row.id, summary: `Offre « ${row.title} » ${status === 'active' ? 'activée' : 'mise en pause'}.`, beforeData: before, afterData: row });
        merchantEvent(ctx.merchantId, 'reward_campaign_updated', { campaignId: row.id }); res.json({ data: row });
      }, 'Impossible de modifier cette offre.');
      mount('get', 'reward-claims', 'canManageOrders', async (_req, res, ctx) => res.json({ data: await extras.listRewardClaims(ctx.store.id) }), 'Impossible de charger les codes de récompense.');
      mount('post', 'reward-claims/redeem', 'canManageOrders', async (req, res, ctx) => {
        const row = await extras.redeemRewardCode(ctx.store.id, safeText(req.body?.code, 120)); if (!row) return res.status(404).json({ error: 'Code inconnu, déjà utilisé ou expiré.' });
        await audit(role, req, { action: 'reward_code_redeemed', merchantId: ctx.merchantId, entityId: row.id, summary: `Code d’offre (${row.codeLast4}) consommé une seule fois.`, afterData: row });
        merchantEvent(ctx.merchantId, 'reward_code_redeemed', { claimId: row.id }); res.json({ data: row });
      }, 'Impossible de vérifier ce code de récompense.');

      mount('get', 'gift-cards', 'canManageStore', async (_req, res, ctx) => res.json({ data: await extras.listGiftCards(ctx.store.id) }), 'Impossible de charger les bons cadeaux.');
      mount('post', 'gift-cards', 'canManageStore', async (req, res, ctx) => {
        const result = await extras.createGiftCard(ctx.store.id, ctx.merchantId, req.body || {});
        if (!result.idempotent) await audit(role, req, { action: 'gift_card_created', merchantId: ctx.merchantId, entityId: result.card.id, summary: `Bon cadeau de ${money(result.card.faceValueXof)} créé en attente de confirmation hors plateforme.`, afterData: result.card });
        res.status(result.idempotent ? 200 : 201).json({ data: result.card, code: result.code, idempotent: result.idempotent,
          notice: 'Code affiché pour cette session; activation manuelle après réception vérifiée hors plateforme.' });
      }, 'Impossible de créer le bon cadeau.');
      mount('post', 'gift-cards/:cardId/activate', 'canManageStore', async (req, res, ctx) => {
        const row = await extras.activateGiftCard(ctx.store.id, req.params.cardId, req.body?.confirmOfflinePayment === true);
        if (!row) return res.status(404).json({ error: 'Bon cadeau introuvable.' });
        await audit(role, req, { action: 'gift_card_activated', merchantId: ctx.merchantId, entityId: row.id,
          summary: `Bon cadeau (${row.codeLast4}) activé après confirmation du commerçant; le paiement n’est pas vérifié par Oymike Tech.`, afterData: row, metadata: { offlinePaymentConfirmedByMerchant: true } });
        merchantEvent(ctx.merchantId, 'gift_card_updated', { giftCardId: row.id }); res.json({ data: row });
      }, 'Impossible d’activer le bon cadeau.');
      mount('post', 'gift-cards/redeem', 'canManageOrders', async (req, res, ctx) => {
        const result = await extras.redeemGiftCard({ storeId: ctx.store.id, code: safeText(req.body?.code, 120), amountXof: req.body?.amountXof,
          requestId: safeText(req.body?.requestId, 100), reference: safeText(req.body?.reference, 100), actorId: actorId(req) });
        await audit(role, req, { action: 'gift_card_redeemed', merchantId: ctx.merchantId, entityId: result.redemption.id,
          summary: `Bon cadeau débité de ${money(result.redemption.amountXof)}; solde restant ${money(result.card?.balanceXof || 0)}.`, afterData: result.redemption, metadata: { giftCardId: result.redemption.giftCardId, idempotent: result.idempotent } });
        merchantEvent(ctx.merchantId, 'gift_card_updated', { giftCardId: result.redemption.giftCardId }); res.json({ data: result });
      }, 'Impossible de débiter le bon cadeau.');
      mount('post', 'gift-cards/check', 'canManageOrders', async (req, res, ctx) => {
        const row = await extras.checkGiftCard(ctx.store.id, safeText(req.body?.code, 120));
        res.json({ data: row ? { valid: row.valid, codeLast4: row.codeLast4, faceValueXof: row.faceValueXof, balanceXof: row.balanceXof, status: row.status } : { valid: false } });
      }, 'Impossible de vérifier le bon cadeau.');
    };
    for (const role of ['admin','manager','merchant']) mountRole(role);
  }
  registerExtraMerchantRoutes();
  require('./supplier-routes')({app,store,commerce,suppliers,requireAdmin,requireMerchant,checkSameOrigin,apiError,sessionSecret,isProduction,
    setSupplierSession,clearSupplierSession,clearAdminSession,clearManagerSession,clearMerchantSession,publicBaseUrl});

  function accountSnapshot(row) {
    return row ? { id: row.id, username: row.username, displayName: row.displayName, managerId: row.managerId || null, status: row.status,
      hasEmail: Boolean(row.email), hasPhone: Boolean(row.phone), mustChangePassword: Boolean(row.mustChangePassword), deletedAt: row.deletedAt || null } : null;
  }
  function productSnapshot(row) {
    return row ? { id: row.id, storeId: row.storeId, name: row.name, sku: row.sku, priceXof: row.priceXof,
      stockQuantity: row.stockQuantity, trackStock: row.trackStock, status: row.status, hasImage: Boolean(row.imageData) } : null;
  }
};
