require('dotenv').config();
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createStore } = require('./store');
const { createFinanceStore } = require('./finance-store');

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER_SERVICE_ID);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || (IS_PRODUCTION ? '' : 'admin');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'admin1234');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'local-preview-secret-change-before-deploy');
const SESSION_COOKIE = 'qria_admin';
const MANAGER_SESSION_COOKIE = 'qria_manager';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = process.env.QRIA_STORE_FILE || path.join(__dirname, 'data', 'store.json');
const TYPE_VALUES = new Set(['individual', 'business', 'commerce', 'organization', 'other']);
const TEXT_SIZE_VALUES = new Set(['default', 'small', 'normal', 'large', 'xlarge']);
const GLOBAL_TEXT_SIZE_VALUES = new Set(['small', 'normal', 'large', 'xlarge']);
const MAX_BENEFICIARY_PHOTOS = 8;
const MAX_PHOTO_CHARS = 380 * 1024;
const MAX_QR_PHOTOS = 8;
const MAX_QR_PHOTO_BYTES = 350 * 1024;
const MAX_QR_PHOTO_CHARS = 500 * 1024;
function normalizePublicBaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('PUBLIC_BASE_URL doit être une URL HTTPS complète, par exemple https://votre-domaine.ci.'); }
  if (parsed.protocol !== 'https:' && IS_PRODUCTION) throw new Error('PUBLIC_BASE_URL doit commencer par https:// en production.');
  if (parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) throw new Error('PUBLIC_BASE_URL doit contenir uniquement le domaine, sans chemin ni identifiants.');
  return parsed.origin;
}
const PUBLIC_BASE_URL = normalizePublicBaseUrl(process.env.PUBLIC_BASE_URL);
const PURPOSE_VALUES = new Set(['contact', 'catalog', 'prices', 'menu', 'website', 'social', 'services', 'order', 'other']);
const PROFILE_FIELDS = new Set(['logo', 'phone', 'whatsapp', 'email', 'address', 'locationUrl', 'website', 'socials', 'bio', 'offers', 'documents']);
const DEFAULT_CATEGORY_BY_TYPE = {
  individual: 'cat-individuals', business: 'cat-businesses', commerce: 'cat-shops',
  organization: 'cat-organizations', other: 'cat-other',
};
const safeList = (value) => Array.isArray(value) ? value : [];

if (IS_PRODUCTION && (!ADMIN_USERNAME || ADMIN_USERNAME.length < 3 || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12 || !SESSION_SECRET || SESSION_SECRET.length < 32)) {
  console.error('Configuration requise : définissez ADMIN_USERNAME (3 caractères minimum), ADMIN_PASSWORD (12 caractères minimum) et SESSION_SECRET (32 caractères minimum).');
  process.exit(1);
}
if (IS_PRODUCTION && !process.env.DATABASE_URL) {
  console.error('Configuration requise : DATABASE_URL doit pointer vers une base PostgreSQL de production.');
  process.exit(1);
}

const store = createStore({ connectionString: process.env.DATABASE_URL, filePath: DATA_FILE });
const finance = createFinanceStore(store);
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'");
  next();
});
app.use(express.json({ limit: '8mb' }));
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const loginAttempts = new Map();

function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}
function constantTimeMatch(value, expected) {
  return crypto.timingSafeEqual(hashString(value), hashString(expected));
}
function verifyAdminPassword(password) {
  const supplied = String(password || '');
  return Boolean(ADMIN_PASSWORD && supplied.length > 0 && supplied.length <= 256 && constantTimeMatch(supplied, ADMIN_PASSWORD));
}
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}
function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ role: 'admin', exp: Date.now() + SESSION_TTL_SECONDS * 1000, nonce: crypto.randomBytes(18).toString('base64url') })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readCookie(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    if (item.slice(0, index).trim() === name) {
      try { return decodeURIComponent(item.slice(index + 1).trim()); } catch (_) { return ''; }
    }
  }
  return '';
}
function validSession(req) {
  const token = readCookie(req, SESSION_COOKIE);
  const split = token.lastIndexOf('.');
  if (split < 1) return false;
  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  const expected = sign(payload);
  if (!constantTimeMatch(signature, expected)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return (data.role === 'admin' || (!data.role && !data.managerId)) && Number(data.exp) > Date.now();
  } catch (_) { return false; }
}
function appendSetCookie(res, cookie) {
  const current = res.getHeader('Set-Cookie');
  const values = current == null ? [] : Array.isArray(current) ? current : [current];
  res.setHeader('Set-Cookie', [...values, cookie]);
}
function setSessionCookie(res, token) {
  clearManagerSession(res);
  const secure = IS_PRODUCTION ? '; Secure' : '';
  appendSetCookie(res, `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}
function clearSessionCookie(res) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  appendSetCookie(res, `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function readManagerSession(req) {
  const token = readCookie(req, MANAGER_SESSION_COOKIE);
  const split = token.lastIndexOf('.');
  if (split < 1) return null;
  const payload = token.slice(0, split);
  const signature = token.slice(split + 1);
  if (!constantTimeMatch(signature, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.role === 'manager' && data.managerId && Number(data.exp) > Date.now() ? data : null;
  } catch (_) { return null; }
}
function setManagerSession(res, manager) {
  clearSessionCookie(res);
  const payload = Buffer.from(JSON.stringify({ role: 'manager', managerId: manager.id, ver: manager.tokenVersion, exp: Date.now() + SESSION_TTL_SECONDS * 1000, nonce: crypto.randomBytes(18).toString('base64url') })).toString('base64url');
  const token = `${payload}.${sign(payload)}`;
  const secure = IS_PRODUCTION ? '; Secure' : '';
  appendSetCookie(res, `${MANAGER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}
function clearManagerSession(res) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  appendSetCookie(res, `${MANAGER_SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}
function sameOriginAllowed(req) {
  const origin = req.get('origin');
  if (!origin) return true;
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.get('x-forwarded-host') || req.get('host');
    return originHost === requestHost;
  } catch (_) { return false; }
}
function checkSameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (!origin) return next();
  try {
    const originHost = new URL(origin).host;
    const requestHost = req.get('x-forwarded-host') || req.get('host');
    if (originHost !== requestHost) return res.status(403).json({ error: 'Origine de requête non autorisée.' });
  } catch (_) { return res.status(403).json({ error: 'Origine de requête invalide.' }); }
  next();
}
async function requireAdmin(req, res, next) {
  if (readCookie(req, SESSION_COOKIE) && readCookie(req, MANAGER_SESSION_COOKIE)) {
    clearSessionCookie(res); clearManagerSession(res);
    return res.status(401).json({ error: 'Sessions de rôles différentes détectées. Reconnectez-vous.' });
  }
  if (!validSession(req)) {
    const managerSession = readManagerSession(req);
    if (managerSession) {
      const manager = await store.getManager(managerSession.managerId, { includeDeleted: true }).catch(() => null);
      await store.addAudit({ actor: manager ? `${manager.displayName} (@${manager.username})` : 'Gestionnaire', actorType: 'manager', actorId: managerSession.managerId,
        managerId: managerSession.managerId, action: 'authorization_denied', entityType: 'admin_api', entityId: req.path,
        summary: 'Accès refusé à une API réservée au PDG.', result: 'denied', metadata: { method: req.method, route: req.path } }).catch((error) => console.error('Audit refusal failed:', safeErrorMessage(error)));
      return res.status(403).json({ error: 'Accès refusé : cette fonction est réservée au PDG.' });
    }
    return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return checkSameOrigin(req, res, next);
  next();
}
async function requireManager(req, res, next) {
  if (readCookie(req, SESSION_COOKIE) && readCookie(req, MANAGER_SESSION_COOKIE)) {
    clearSessionCookie(res); clearManagerSession(res);
    return res.status(401).json({ error: 'Sessions de rôles différentes détectées. Reconnectez-vous.' });
  }
  const session = readManagerSession(req);
  if (!session) return res.status(401).json({ error: 'Session gestionnaire expirée. Reconnectez-vous.' });
  const manager = await store.getManager(session.managerId, { includeDeleted: true }).catch(() => null);
  if (!manager || manager.deletedAt || manager.status !== 'active' || Number(manager.tokenVersion) !== Number(session.ver)) {
    if (manager) await store.addAudit({ actor: `${manager.displayName} (@${manager.username})`, actorType: 'manager', actorId: manager.id,
      managerId: manager.id, action: 'authorization_denied', entityType: 'authentication', entityId: manager.id,
      summary: `Session refusée : le compte n’est plus actif${manager.statusReason ? ` (${manager.statusReason})` : ''}.`, result: 'denied',
      metadata: { status: manager.status, sessionInvalidated: true } }).catch((error) => console.error('Audit expired session failed:', safeErrorMessage(error)));
    clearManagerSession(res);
    return res.status(401).json({ error: 'Votre compte est suspendu, bloqué ou votre session a été révoquée. Contactez le PDG.' });
  }
  // Custom-domain bindings remain stored, but are intentionally ignored while all accounts use the shared main link.
  req.manager = manager;
  if (manager.mustChangePassword) {
    const resetExpiresAt = manager.passwordResetExpiresAt ? new Date(manager.passwordResetExpiresAt).getTime() : 0;
    if (!Number.isFinite(resetExpiresAt) || resetExpiresAt <= Date.now()) {
      await store.invalidateManagerSessions(manager.id).catch(() => null);
      await store.addAudit({ actor: `${manager.displayName} (@${manager.username})`, actorType: 'manager', actorId: manager.id,
        managerId: manager.id, action: 'authorization_denied', entityType: 'authentication', entityId: manager.id,
        summary: 'Accès refusé : le mot de passe temporaire a expiré avant son remplacement.', result: 'denied',
        metadata: { mustChangePassword: true, temporaryPasswordExpired: true } }).catch((error) => console.error('Audit expired temporary password failed:', safeErrorMessage(error)));
      clearManagerSession(res);
      return res.status(401).json({ error: 'Le mot de passe temporaire a expiré. Contactez le PDG pour en obtenir un nouveau.', code: 'TEMP_PASSWORD_EXPIRED' });
    }
    const allowedDuringForcedChange = (req.method === 'GET' && ['/api/manager/auth/me', '/api/auth/me'].includes(req.path)) ||
      (req.method === 'POST' && ['/api/manager/auth/change-password', '/api/manager/auth/logout'].includes(req.path));
    if (!allowedDuringForcedChange) {
      await store.addAudit({ actor: `${manager.displayName} (@${manager.username})`, actorType: 'manager', actorId: manager.id,
        managerId: manager.id, action: 'authorization_denied', entityType: 'authentication', entityId: req.path,
        summary: 'Accès refusé : le changement obligatoire du mot de passe doit être effectué avant toute autre action.', result: 'denied',
        metadata: { mustChangePassword: true, method: req.method, route: req.path } }).catch((error) => console.error('Audit password change gate failed:', safeErrorMessage(error)));
      return res.status(403).json({ error: 'Vous devez choisir un nouveau mot de passe avant de continuer.', code: 'PASSWORD_CHANGE_REQUIRED', mustChangePassword: true });
    }
  }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !sameOriginAllowed(req)) {
    await store.addAudit({ actor: `${manager.displayName} (@${manager.username})`, actorType: 'manager', actorId: manager.id,
      managerId: manager.id, action: 'authorization_denied', entityType: 'authentication', entityId: req.path,
      summary: 'Requête refusée : origine non autorisée.', result: 'denied', metadata: { method: req.method, route: req.path } })
      .catch((error) => console.error('Audit CSRF refusal failed:', safeErrorMessage(error)));
    return res.status(403).json({ error: 'Origine de requête non autorisée.' });
  }
  next();
}
function safeErrorMessage(error) {
  return String(error?.message || error || 'Erreur inconnue')
    .replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@/\s]+@/gi, '$1[redacted]@')
    .replace(/((?:password|passwd|token|secret|authorization)\s*[:=]\s*)[^\s,;]+/gi, '$1[redacted]');
}
function apiError(res, error, fallback = 'Une erreur est survenue.') {
  if (error?.code === 'DUPLICATE') return res.status(409).json({ error: error.message });
  console.error(safeErrorMessage(error));
  return res.status(500).json({ error: fallback });
}
function cleanText(value, max = 500) {
  return String(value == null ? '' : value).trim().slice(0, max);
}
function httpUrl(value, label = 'URL', optional = true) {
  let raw = cleanText(value, 2048);
  if (!raw && optional) return '';
  if (!raw) throw new Error(`${label} est obligatoire.`);
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  let url;
  try { url = new URL(raw); } catch (_) { throw new Error(`${label} n’est pas valide.`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} doit commencer par http:// ou https://.`);
  return url.toString();
}
function cleanImage(value, maxChars = 1_450_000) {
  const source = String(value == null ? '' : value).trim();
  if (!source) return '';
  if (source.length > maxChars) throw new Error('Cette image est trop volumineuse. Réduisez sa taille avant de l’ajouter.');
  if (/^https:\/\//i.test(source)) return httpUrl(source, 'URL de l’image');
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(source)) return source;
  throw new Error('L’image doit être un lien HTTPS ou un fichier PNG, JPEG ou WebP valide.');
}
function decodeUploadedImage(source) {
  const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(source || ''));
  if (!match) return null;
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[2]) return null;
  const mime = match[1] === 'jpeg' ? 'image/jpeg' : `image/${match[1]}`;
  const signatureValid = match[1] === 'jpeg'
    ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : match[1] === 'png'
      ? bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
  return signatureValid ? { mime, bytes } : null;
}
function validateQrPhotoSource(value) {
  const source = String(value == null ? '' : value).trim();
  if (!source) throw new Error('Chaque photo publicitaire doit contenir un fichier image.');
  if (source.length > MAX_QR_PHOTO_CHARS) throw new Error('Une photo dépasse la taille maximale autorisée. Réduisez-la et réessayez.');
  const image = decodeUploadedImage(source);
  if (!image) throw new Error('Le fichier ne contient pas une vraie image JPG, PNG ou WebP valide. Réimportez une image prise en charge.');
  if (image.bytes.length > MAX_QR_PHOTO_BYTES) throw new Error(`Chaque photo doit faire au maximum ${Math.round(MAX_QR_PHOTO_BYTES / 1024)} Kio après compression.`);
  return source;
}
function validateQrPhotos(value) {
  if (Array.isArray(value) && value.length > MAX_QR_PHOTOS) throw new Error(`Ajoutez au maximum ${MAX_QR_PHOTOS} photos publicitaires à un QR.`);
  const seen = new Set();
  let primaryAssigned = false;
  const photos = cleanList(value, MAX_QR_PHOTOS).map((item, index) => {
    const id = cleanText(item?.id, 80) || crypto.randomUUID();
    if (seen.has(id)) throw new Error('Chaque photo publicitaire doit avoir un identifiant unique.');
    seen.add(id);
    const src = validateQrPhotoSource(item?.src);
    const caption = cleanText(item?.caption ?? item?.alt, 140);
    const isPrimary = Boolean(item?.isPrimary) && !primaryAssigned;
    if (isPrimary) primaryAssigned = true;
    return { id, src, caption, alt: caption, isPrimary, sortOrder: index };
  });
  if (photos.length && !primaryAssigned) photos[0].isPrimary = true;
  return photos;
}
function cleanList(value, maxItems = 20) {
  return Array.isArray(value) ? value.slice(0, maxItems) : [];
}
function validateBeneficiary(input) {
  const type = cleanText(input.type, 30);
  if (!TYPE_VALUES.has(type)) throw new Error('Choisissez un type de bénéficiaire valide.');
  const name = cleanText(input.name, 140);
  if (!name) throw new Error('Le nom du bénéficiaire est obligatoire.');
  const email = cleanText(input.email, 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('L’adresse e-mail n’est pas valide.');
  const socials = cleanList(input.socials).map((item) => ({ label: cleanText(item.label, 50), url: httpUrl(item.url, 'Lien de réseau social', false) })).filter((item) => item.label && item.url);
  if (Array.isArray(input.photos) && input.photos.length > MAX_BENEFICIARY_PHOTOS) throw new Error(`Ajoutez au maximum ${MAX_BENEFICIARY_PHOTOS} photos par bénéficiaire.`);
  const seenPhotoIds = new Set();
  const photos = cleanList(input.photos, MAX_BENEFICIARY_PHOTOS).map((item) => {
    const id = cleanText(item?.id, 80) || crypto.randomUUID();
    if (seenPhotoIds.has(id)) throw new Error('Chaque photo doit avoir un identifiant unique.');
    seenPhotoIds.add(id);
    return { id, src: cleanImage(item?.src, MAX_PHOTO_CHARS), alt: cleanText(item?.alt, 140) };
  }).filter((item) => item.src);
  const offers = cleanList(input.offers, 60).map((item) => ({
    name: cleanText(item.name, 120), description: cleanText(item.description, 500), price: cleanText(item.price, 60), url: httpUrl(item.url, 'Lien de produit ou service'),
  })).filter((item) => item.name || item.description);
  const documents = cleanList(input.documents, 40).map((item) => ({ name: cleanText(item.name, 140), url: httpUrl(item.url, 'Lien de document', false) })).filter((item) => item.name && item.url);
  return {
    type, name, logo: cleanImage(input.logo), photos, phone: cleanText(input.phone, 50), whatsapp: cleanText(input.whatsapp, 50), email,
    address: cleanText(input.address, 300), locationUrl: httpUrl(input.locationUrl, 'Lien de localisation'),
    website: httpUrl(input.website, 'Site Internet'), socials, bio: cleanText(input.bio, 3000), offers, documents,
  };
}
function validateQr(input, beneficiary) {
  const name = cleanText(input.name, 120);
  if (!name) throw new Error('Le nom du QR code est obligatoire.');
  if (!beneficiary) throw new Error('Sélectionnez un bénéficiaire existant.');
  const destinationType = input.destinationType === 'redirect' ? 'redirect' : 'page';
  const targetUrl = destinationType === 'redirect' ? httpUrl(input.targetUrl, 'Destination Internet', false) : '';
  const purpose = PURPOSE_VALUES.has(input.purpose) ? input.purpose : 'other';
  const selectedFields = [...new Set(cleanList(input.selectedFields, 20).filter((item) => PROFILE_FIELDS.has(item)))];
  const availablePhotoIds = new Set(safeList(beneficiary.photos).map((photo) => photo.id));
  const selectedPhotoIds = [...new Set(cleanList(input.selectedPhotoIds, MAX_BENEFICIARY_PHOTOS).map((id) => cleanText(id, 80)).filter((id) => id && availablePhotoIds.has(id)))];
  const extraLinks = cleanList(input.extraLinks, 20).map((item) => ({ label: cleanText(item.label, 100), url: httpUrl(item.url, 'Lien associé', false) })).filter((item) => item.label && item.url);
  const photos = validateQrPhotos(input.photos);
  if (destinationType === 'page') {
    const hasVisibleProfileData = selectedFields.some((field) => {
      const value = beneficiary[field];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    if (!hasVisibleProfileData && !selectedPhotoIds.length && !photos.length && !cleanText(input.description, 800) && !cleanText(input.contentText, 5000) && !extraLinks.length) {
      throw new Error('Ajoutez un texte, un lien ou sélectionnez au moins une information disponible pour cette page.');
    }
  }
  const foreground = /^#[0-9a-f]{6}$/i.test(input.style?.foreground || '') ? input.style.foreground.toUpperCase() : '#173B32';
  const background = /^#[0-9a-f]{6}$/i.test(input.style?.background || '') ? input.style.background.toUpperCase() : '#FFFFFF';
  const correction = ['L', 'M', 'Q', 'H'].includes(input.style?.correction) ? input.style.correction : 'M';
  return {
    name, beneficiaryId: beneficiary.id, categoryId: cleanText(input.categoryId, 100) || DEFAULT_CATEGORY_BY_TYPE[beneficiary.type] || 'cat-other',
    purpose, destinationType, targetUrl, title: cleanText(input.title, 140), description: cleanText(input.description, 800),
    contentText: cleanText(input.contentText, 5000), selectedFields, selectedPhotoIds, photos, extraLinks,
    style: { foreground, background, correction, textSize: TEXT_SIZE_VALUES.has(input.style?.textSize) ? input.style.textSize : 'default' },
  };
}
function publicSnapshot(row) {
  if (!row) return null;
  let targetHost = '';
  try { targetHost = row.targetUrl ? new URL(row.targetUrl).host : ''; } catch (_) { targetHost = '[adresse non valide]'; }
  return {
    id: row.id, publicCode: row.publicCode, name: row.name, beneficiaryId: row.beneficiaryId,
    beneficiaryName: row.beneficiaryName, categoryId: row.categoryId, categoryName: row.categoryName,
    purpose: row.purpose, destinationType: row.destinationType, targetHost,
    title: row.title, hasDescription: Boolean(row.description), hasContentText: Boolean(row.contentText),
    selectedFields: row.selectedFields, selectedPhotoCount: safeList(row.selectedPhotoIds).length, photoCount: safeList(row.photos).length,
    extraLinkCount: safeList(row.extraLinks).length, style: row.style, status: row.status, statusReason: row.statusReason || '',
    managerId: row.managerId || null,
  };
}
function beneficiarySnapshot(row) {
  return row ? {
    id: row.id, type: row.type, name: row.name, status: row.status || 'active',
    hasLogo: Boolean(row.logo), photoCount: safeList(row.photos).length, hasPhone: Boolean(row.phone),
    hasWhatsapp: Boolean(row.whatsapp), hasEmail: Boolean(row.email), hasAddress: Boolean(row.address),
    hasLocation: Boolean(row.locationUrl), hasWebsite: Boolean(row.website), socialCount: safeList(row.socials).length,
    bioLength: String(row.bio || '').length, offerCount: safeList(row.offers).length, documentCount: safeList(row.documents).length,
  } : null;
}
function makeAudit(action, entityType, entityId, beforeData, afterData, summary) {
  return { actor: 'PDG', actorType: 'admin', actorId: 'admin', action, entityType, entityId,
    beforeData: beforeData || null, afterData: afterData || null, summary, result: 'success' };
}

app.get('/api/health', (req, res) => res.json({ ok: true, database: process.env.DATABASE_URL ? 'postgres' : 'local-json', demoMode: !IS_PRODUCTION && ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'admin1234', publicBaseUrl: PUBLIC_BASE_URL }));

app.post('/api/auth/login', checkSameOrigin, async (req, res) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && now - current.start < 60_000 && current.count >= 8) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
  }
  const username = String(req.body?.username || (IS_PRODUCTION ? '' : 'admin')).trim().slice(0, 120);
  const passwordRaw = String(req.body?.password || '');
  const password = passwordRaw.slice(0, 256);
  const validUsername = Boolean(ADMIN_USERNAME && constantTimeMatch(username, ADMIN_USERNAME));
  const validPassword = Boolean(ADMIN_PASSWORD && passwordRaw.length <= 256 && constantTimeMatch(password, ADMIN_PASSWORD));
  if (validUsername && validPassword) {
    loginAttempts.delete(key);
    setSessionCookie(res, createSessionToken());
    return res.json({ ok: true, role: 'admin' });
  }

  try {
    const authenticateManager = req.app.locals.authenticateManagerCredentials;
    if (typeof authenticateManager === 'function') {
      const result = await authenticateManager(req, username, passwordRaw);
      if (result.manager) {
        loginAttempts.delete(key);
        setManagerSession(res, result.manager);
        return res.json({ ok: true, role: 'manager' });
      }
      if (result.status === 429) return res.status(429).json({ error: result.error });
      if (result.error && result.error.startsWith('Le mot de passe temporaire a expiré')) return res.status(401).json({ error: result.error });
    }
  } catch (error) { return apiError(res, error, 'Impossible d’ouvrir la session.'); }

  const next = !current || now - current.start >= 60_000 ? { start: now, count: 1 } : { ...current, count: current.count + 1 };
  loginAttempts.set(key, next);
  return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
});
app.get('/api/auth/me', (req, res) => {
  const adminCookie = readCookie(req, SESSION_COOKIE);
  const managerCookie = readCookie(req, MANAGER_SESSION_COOKIE);
  if (adminCookie && managerCookie) {
    clearSessionCookie(res); clearManagerSession(res);
    return res.json({ authenticated: false });
  }
  if (adminCookie && validSession(req)) return res.json({ authenticated: true, role: 'admin' });
  if (managerCookie && readManagerSession(req)) {
    return requireManager(req, res, () => res.json({ authenticated: true, role: 'manager' }));
  }
  if (adminCookie) clearSessionCookie(res);
  if (managerCookie) clearManagerSession(res);
  return res.json({ authenticated: false });
});
app.post('/api/auth/logout', requireAdmin, (req, res) => { clearSessionCookie(res); clearManagerSession(res); res.json({ ok: true }); });

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, codes, activity] = await Promise.all([
      store.stats(), store.listCodes({ page: 1, limit: 6 }), store.listAudit({ page: 1, limit: 5 }),
    ]);
    res.json({ stats, recentCodes: codes.data, recentActivity: activity.data });
  } catch (error) { apiError(res, error, 'Impossible de charger le tableau de bord.'); }
});
app.get('/api/admin/settings', requireAdmin, async (req, res) => {
  try { res.json({ data: await store.getSettings() }); }
  catch (error) { apiError(res, error, 'Impossible de charger les réglages.'); }
});
app.put('/api/admin/settings', requireAdmin, async (req, res) => {
  try {
    const size = cleanText(req.body?.defaultPublicTextSize, 20);
    if (!GLOBAL_TEXT_SIZE_VALUES.has(size)) return res.status(400).json({ error: 'Choisissez une taille de texte valide.' });
    const before = await store.getSettings();
    const data = await store.updateSettings({ defaultPublicTextSize: size });
    await store.addAudit(makeAudit('update', 'settings', 'public-text-size', before, data, 'Taille générale des textes publics modifiée.'));
    res.json({ data });
  } catch (error) { apiError(res, error, 'Impossible d’enregistrer les réglages.'); }
});
app.get('/api/admin/scan-stats', requireAdmin, async (req, res) => {
  try {
    const period = String(req.query.period || 'all');
    if (!['all', '7', '30', '90'].includes(period)) return res.status(400).json({ error: 'Période invalide.' });
    res.json(await store.scanStats({ days: period === 'all' ? 0 : Number(period) }));
  } catch (error) { apiError(res, error, 'Impossible de charger les statistiques de scans.'); }
});

app.get('/api/admin/categories', requireAdmin, async (req, res) => {
  try { res.json({ data: await store.listCategories() }); }
  catch (error) { apiError(res, error, 'Impossible de charger les catégories.'); }
});
app.post('/api/admin/categories', requireAdmin, async (req, res) => {
  try {
    const name = cleanText(req.body?.name, 60);
    if (!name) return res.status(400).json({ error: 'Le nom de la catégorie est obligatoire.' });
    const exists = (await store.listCategories()).some((item) => item.name.toLocaleLowerCase('fr') === name.toLocaleLowerCase('fr'));
    if (exists) return res.status(409).json({ error: 'Cette catégorie existe déjà.' });
    const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || crypto.randomUUID();
    const category = await store.createCategory({ name, slug });
    await store.addAudit(makeAudit('create', 'category', category.id, null, { id: category.id, name: category.name }, `Catégorie « ${name} » créée.`));
    res.status(201).json({ data: category });
  } catch (error) { apiError(res, error, 'Impossible de créer cette catégorie.'); }
});

app.get('/api/admin/beneficiaries', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const data = await store.listBeneficiaries({ search: cleanText(req.query.search, 160), type: TYPE_VALUES.has(req.query.type) ? req.query.type : '', status: ['active', 'blocked'].includes(req.query.status) ? req.query.status : '', page, limit });
    res.json(data);
  } catch (error) { apiError(res, error, 'Impossible de charger les bénéficiaires.'); }
});
app.get('/api/admin/beneficiaries/:id', requireAdmin, async (req, res) => {
  try {
    const data = await store.getBeneficiary(req.params.id);
    if (!data) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
    res.json({ data });
  } catch (error) { apiError(res, error); }
});
app.get('/api/admin/beneficiaries/:id/history', requireAdmin, async (req, res) => {
  try {
    const data = await store.listAudit({ page: 1, limit: 100, entityType: 'beneficiary', entityId: req.params.id });
    res.json({ data: data.data });
  } catch (error) { apiError(res, error, 'Impossible de charger l’historique du bénéficiaire.'); }
});
app.post('/api/admin/beneficiaries', requireAdmin, async (req, res) => {
  try {
    const input = validateBeneficiary(req.body || {});
    const data = await store.createBeneficiary(input);
    await store.addAudit(makeAudit('create', 'beneficiary', data.id, null, beneficiarySnapshot(data), `Bénéficiaire « ${data.name} » créé.`));
    res.status(201).json({ data });
  } catch (error) {
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    apiError(res, error, 'Impossible de créer le bénéficiaire.');
  }
});
app.put('/api/admin/beneficiaries/:id', requireAdmin, async (req, res) => {
  try {
    const before = await store.getBeneficiary(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
    const input = validateBeneficiary(req.body || {});
    const data = await store.updateBeneficiary(req.params.id, input);
    await store.addAudit(makeAudit('update', 'beneficiary', data.id, beneficiarySnapshot(before), beneficiarySnapshot(data), `Informations de « ${data.name} » modifiées.`));
    res.json({ data });
  } catch (error) {
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    apiError(res, error, 'Impossible de modifier le bénéficiaire.');
  }
});
app.patch('/api/admin/beneficiaries/:id/status', requireAdmin, async (req, res) => {
  try {
    const status = req.body?.status;
    if (!['active', 'blocked'].includes(status)) return res.status(400).json({ error: 'Statut de bénéficiaire invalide.' });
    const before = await store.getBeneficiary(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
    if (before.status === status) return res.json({ data: before });
    const data = await store.setBeneficiaryStatus(req.params.id, status);
    if (!data) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
    const action = status === 'blocked' ? 'block' : 'unblock';
    const summary = status === 'blocked'
      ? `Bénéficiaire « ${data.name} » bloqué; ses QR ne sont plus accessibles au public.`
      : `Bénéficiaire « ${data.name} » débloqué; les QR activés sont de nouveau accessibles.`;
    await store.addAudit(makeAudit(action, 'beneficiary', data.id, beneficiarySnapshot(before), beneficiarySnapshot(data), summary));
    res.json({ data });
  } catch (error) { apiError(res, error, 'Impossible de changer le statut du bénéficiaire.'); }
});
app.delete('/api/admin/beneficiaries/:id', requireAdmin, async (req, res) => {
  try {
    const before = await store.getBeneficiary(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
    await store.deleteBeneficiary(req.params.id);
    await store.addAudit(makeAudit('delete', 'beneficiary', before.id, beneficiarySnapshot(before), null, `Bénéficiaire « ${before.name} » supprimé logiquement; ses QR sont désactivés et l’historique est conservé.`));
    res.json({ ok: true });
  } catch (error) { apiError(res, error, 'Impossible de supprimer le bénéficiaire.'); }
});

app.get('/api/admin/codes', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const data = await store.listCodes({
      search: cleanText(req.query.search, 160), categoryId: cleanText(req.query.categoryId, 100),
      beneficiaryId: cleanText(req.query.beneficiaryId, 100), managerId: cleanText(req.query.managerId, 100),
      status: ['draft', 'pending_validation', 'active', 'suspended', 'rejected', 'inactive'].includes(req.query.status) ? req.query.status : '', page, limit,
    });
    res.json(data);
  } catch (error) { apiError(res, error, 'Impossible de charger les QR codes.'); }
});
app.get('/api/admin/codes/:id', requireAdmin, async (req, res) => {
  try {
    const data = await store.getCode(req.params.id);
    if (!data || data.deletedAt) return res.status(404).json({ error: 'QR code introuvable.' });
    res.json({ data });
  } catch (error) { apiError(res, error); }
});
app.post('/api/admin/codes', requireAdmin, async (req, res) => {
  try {
    const beneficiary = await store.getBeneficiary(cleanText(req.body?.beneficiaryId, 100));
    if (beneficiary?.status === 'blocked') return res.status(409).json({ error: 'Ce bénéficiaire est bloqué. Débloquez-le avant de lui créer un QR code.' });
    const input = validateQr(req.body || {}, beneficiary);
    if (!(await store.listCategories()).some((item) => item.id === input.categoryId)) return res.status(400).json({ error: 'Choisissez une catégorie existante.' });
    const data = await store.createCode(input);
    await store.addAudit(makeAudit('create', 'qr_code', data.id, null, publicSnapshot(data), `QR code « ${data.name} » créé pour ${data.beneficiaryName}.`));
    res.status(201).json({ data });
  } catch (error) {
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    apiError(res, error, 'Impossible de créer le QR code.');
  }
});
app.put('/api/admin/codes/:id', requireAdmin, async (req, res) => {
  try {
    const before = await store.getCode(req.params.id);
    if (!before || before.deletedAt) return res.status(404).json({ error: 'QR code introuvable.' });
    const beneficiary = await store.getBeneficiary(cleanText(req.body?.beneficiaryId, 100));
    if (beneficiary?.status === 'blocked' && beneficiary.id !== before.beneficiaryId) return res.status(409).json({ error: 'Ce bénéficiaire est bloqué. Débloquez-le avant de lui attribuer un QR code.' });
    const input = validateQr(req.body || {}, beneficiary);
    if (!Object.hasOwn(req.body || {}, 'photos')) input.photos = safeList(before.photos);
    if (!(await store.listCategories()).some((item) => item.id === input.categoryId)) return res.status(400).json({ error: 'Choisissez une catégorie existante.' });
    const data = await store.updateCode(req.params.id, input);
    if (!data) return res.status(404).json({ error: 'QR code introuvable.' });
    await store.addAudit(makeAudit('update', 'qr_code', data.id, publicSnapshot(before), publicSnapshot(data), `QR code « ${data.name} » modifié.`));
    res.json({ data });
  } catch (error) {
    if (error.message && !error.code) return res.status(400).json({ error: error.message });
    apiError(res, error, 'Impossible de modifier le QR code.');
  }
});
app.patch('/api/admin/codes/:id/status', requireAdmin, async (req, res) => {
  try {
    const status = String(req.body?.status || '');
    const allowed = ['draft', 'pending_validation', 'active', 'suspended', 'rejected', 'inactive'];
    if (!allowed.includes(status)) return res.status(400).json({ error: 'Statut QR invalide.' });
    const reason = cleanText(req.body?.reason, 500);
    if (['suspended', 'rejected'].includes(status) && !reason) return res.status(400).json({ error: 'Un motif est obligatoire pour suspendre ou refuser un QR.' });
    const before = await store.getCode(req.params.id);
    if (!before || before.deletedAt) return res.status(404).json({ error: 'QR code introuvable.' });
    if (status === 'active' && before.beneficiaryDeletedAt) return res.status(409).json({ error: 'Le bénéficiaire associé est supprimé; ce QR ne peut pas être activé.' });
    const normalizedStatus = status === 'inactive' ? 'suspended' : status;
    const normalizedReason = status === 'inactive' && !reason ? 'Désactivé par le PDG.' : reason;
    const data = await store.setCodeStatus(req.params.id, normalizedStatus, normalizedReason);
    if (!data) return res.status(404).json({ error: 'QR code introuvable.' });
    const action = normalizedStatus === 'active' ? 'activate' : normalizedStatus === 'suspended' ? 'suspend'
      : normalizedStatus === 'rejected' ? 'reject' : normalizedStatus === 'pending_validation' ? 'request_validation' : 'update';
    const label = { draft: 'enregistré en brouillon', pending_validation: 'soumis à validation', active: 'activé', suspended: 'suspendu', rejected: 'refusé' }[normalizedStatus] || normalizedStatus;
    await store.addAudit({ ...makeAudit(action, 'qr_code', data.id, publicSnapshot(before), publicSnapshot(data),
      `QR code « ${data.name} » ${label} par le PDG.${normalizedReason ? ` Motif : ${normalizedReason}` : ''}`),
      actor: 'PDG', actorType: 'admin', managerId: data.managerId || null, metadata: { status: normalizedStatus, reason: normalizedReason || null } });
    if (data.managerId) {
      const manager = await store.getManager(data.managerId, { includeDeleted: true }).catch(() => null);
      if (manager && !manager.deletedAt) {
        const preferences = { validationResults: true, suspensions: true, codeUpdates: true, ...(manager.notificationPreferences || {}) };
        const type = normalizedStatus === 'active' ? 'code_approved' : normalizedStatus === 'rejected' ? 'code_rejected'
          : normalizedStatus === 'suspended' ? 'code_suspended' : 'code_update';
        const preference = ['code_approved', 'code_rejected'].includes(type) ? preferences.validationResults
          : type === 'code_suspended' ? preferences.suspensions : preferences.codeUpdates;
        if (preference !== false) {
          const title = normalizedStatus === 'active' ? 'QR validé et activé' : normalizedStatus === 'rejected' ? 'QR refusé'
            : normalizedStatus === 'suspended' ? 'QR suspendu' : normalizedStatus === 'pending_validation' ? 'QR en attente de validation' : 'Statut QR modifié';
          const body = normalizedReason || `Le statut du QR « ${data.name} » a été mis à jour par le PDG.`;
          await store.createManagerNotification({ managerId: data.managerId, type, title, body, entityType: 'qr_code', entityId: data.id });
        }
      }
    }
    res.json({ data });
  } catch (error) { apiError(res, error, 'Impossible de changer le statut du QR code.'); }
});
app.delete('/api/admin/codes/:id', requireAdmin, async (req, res) => {
  try {
    const before = await store.getCode(req.params.id);
    if (!before || before.deletedAt) return res.status(404).json({ error: 'QR code introuvable.' });
    const data = await store.deleteCode(req.params.id);
    await store.addAudit(makeAudit('delete', 'qr_code', before.id, publicSnapshot(before), null, `QR code « ${before.name} » supprimé (conservé dans l’historique).`));
    res.json({ ok: true, data });
  } catch (error) { apiError(res, error, 'Impossible de supprimer le QR code.'); }
});
app.get('/api/admin/codes/:id/history', requireAdmin, async (req, res) => {
  try {
    const data = await store.listAudit({ page: 1, limit: 100, entityType: 'qr_code', entityId: req.params.id });
    res.json({ data: data.data });
  } catch (error) { apiError(res, error, 'Impossible de charger l’historique.'); }
});
app.get('/api/admin/activity', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const entityType = ['qr_code', 'beneficiary', 'category', 'settings'].includes(req.query.entityType) ? req.query.entityType : '';
    res.json(await store.listAudit({ page, limit: 30, entityType }));
  } catch (error) { apiError(res, error, 'Impossible de charger l’historique.'); }
});

require('./manager-routes')({
  app, store, finance, requireAdmin, requireManager, checkSameOrigin, verifyAdminPassword, publicBaseUrl: PUBLIC_BASE_URL,
  setManagerSession, clearManagerSession, validateBeneficiary, validateQr,
  makeAudit, publicSnapshot, beneficiarySnapshot, apiError,
});
require('./finance-routes')({ app, store, finance, requireAdmin, requireManager, checkSameOrigin, apiError });

function publicProfile(data, defaultPublicTextSize = 'normal') {
  const qr = data.qr;
  const beneficiary = data.beneficiary;
  const selected = new Set(safeList(qr.selectedFields));
  const visibleBeneficiary = { name: beneficiary.name, type: beneficiary.type };
  for (const field of PROFILE_FIELDS) {
    if (selected.has(field)) visibleBeneficiary[field] = beneficiary[field];
  }
  const selectedPhotoIds = new Set(safeList(qr.selectedPhotoIds));
  const photoUrl = (photoId, source) => `/api/public/qr/${encodeURIComponent(qr.publicCode)}/photos/${encodeURIComponent(photoId)}?source=${source}`;
  const beneficiaryPhotos = safeList(beneficiary.photos).filter((photo) => selectedPhotoIds.has(photo.id)).map((photo, sortOrder) => ({
    ...photo, caption: photo.caption || photo.alt || '', sortOrder: Number.isSafeInteger(photo.sortOrder) ? photo.sortOrder : sortOrder,
    ...(String(photo.src || '').startsWith('data:image/') ? { src: photoUrl(photo.id, 'beneficiary') } : {}),
  }));
  const qrPhotos = safeList(qr.photos).map((photo, sortOrder) => ({
    ...photo, caption: photo.caption || photo.alt || '', sortOrder: Number.isSafeInteger(photo.sortOrder) ? photo.sortOrder : sortOrder,
    src: photoUrl(photo.id, 'qr'),
  }));
  visibleBeneficiary.photos = [...qrPhotos, ...beneficiaryPhotos].sort((a, b) => Number(Boolean(b.isPrimary)) - Number(Boolean(a.isPrimary)) || a.sortOrder - b.sortOrder);
  const requestedSize = qr.style?.textSize || 'default';
  const textSize = TEXT_SIZE_VALUES.has(requestedSize) && requestedSize !== 'default' ? requestedSize : defaultPublicTextSize;
  return {
    qr: {
      publicCode: qr.publicCode, name: qr.name, purpose: qr.purpose, title: qr.title, description: qr.description,
      contentText: qr.contentText, extraLinks: safeList(qr.extraLinks), categoryName: qr.categoryName, textSize,
    },
    beneficiary: visibleBeneficiary,
  };
}

function redirectToCanonicalDomain(req, res) {
  if (!PUBLIC_BASE_URL) return false;
  const canonicalHost = new URL(PUBLIC_BASE_URL).host.toLowerCase();
  const requestHost = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim().toLowerCase();
  if (!requestHost || requestHost === canonicalHost) return false;
  res.redirect(302, `${PUBLIC_BASE_URL}${req.originalUrl}`);
  return true;
}

app.get('/r/:code', async (req, res, next) => {
  try {
    if (redirectToCanonicalDomain(req, res)) return;
    const found = await store.getPublicCode(req.params.code);
    if (!found) return res.status(404).sendFile(path.join(PUBLIC_DIR, 'not-found.html'));
    if (req.method === 'GET') await store.recordScan(found.qr.id);
    if (found.qr.destinationType === 'redirect') return res.redirect(302, found.qr.targetUrl);
    return res.sendFile(path.join(PUBLIC_DIR, 'profile.html'));
  } catch (error) { next(error); }
});
app.get('/api/public/qr/:code/photos/:photoId', async (req, res) => {
  try {
    const found = await store.getPublicCode(req.params.code);
    if (!found || found.qr.destinationType !== 'page') return res.status(404).end();
    const source = String(req.query.source || 'qr');
    let photo = null;
    if (source === 'qr') photo = safeList(found.qr.photos).find((item) => item.id === req.params.photoId) || null;
    else if (source === 'beneficiary') {
      const selected = new Set(safeList(found.qr.selectedPhotoIds));
      photo = safeList(found.beneficiary.photos).find((item) => item.id === req.params.photoId && selected.has(item.id)) || null;
    }
    const image = decodeUploadedImage(photo?.src);
    if (!image) return res.status(404).end();
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type(image.mime).send(image.bytes);
  } catch (error) { apiError(res, error, 'Impossible de charger cette photo.'); }
});
app.get('/api/public/qr/:code', async (req, res) => {
  try {
    const found = await store.getPublicCode(req.params.code);
    if (!found) return res.status(404).json({ error: 'Ce code QR n’est pas disponible.' });
    if (found.qr.destinationType !== 'page') return res.status(404).json({ error: 'Cette destination redirige directement.' });
    const settings = await store.getSettings();
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicProfile(found, settings.defaultPublicTextSize));
  } catch (error) { apiError(res, error, 'Impossible de charger cette page.'); }
});

app.get('/manifest.webmanifest', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.type('application/manifest+json').sendFile(path.join(PUBLIC_DIR, 'manifest.webmanifest'));
});
app.get('/sw.js', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.type('application/javascript').sendFile(path.join(PUBLIC_DIR, 'sw.js'));
});
app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get(['/manager', '/manager/'], (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'manager.html')));
app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/generator', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'generator.html')));
app.use(express.static(PUBLIC_DIR, { extensions: ['html'], maxAge: 0 }));
app.use((err, req, res, next) => {
  console.error(err);
  if (res.headersSent) return next(err);
  res.status(500).send('Une erreur inattendue est survenue.');
});

async function start() {
  await store.init();
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`QRia écoute sur http://0.0.0.0:${PORT}`);
    console.log(`Stockage : ${process.env.DATABASE_URL ? 'PostgreSQL' : 'JSON local (développement)'}`);
    if (!IS_PRODUCTION && ADMIN_USERNAME === 'admin' && ADMIN_PASSWORD === 'admin1234') console.log('Mode de démonstration locale uniquement — remplacez les identifiants avant toute exposition réseau.');
  });
  const shutdown = async () => {
    server.close(async () => { if (store.close) await store.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => { console.error('Échec du démarrage de QRia :', error); process.exit(1); });
