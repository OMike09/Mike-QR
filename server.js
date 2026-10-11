require('dotenv').config();
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { createStore } = require('./store');

const PORT = Number(process.env.PORT || 3000);
const IS_PRODUCTION = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER_SERVICE_ID);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || (IS_PRODUCTION ? '' : 'admin');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || (IS_PRODUCTION ? '' : 'admin1234');
const SESSION_SECRET = process.env.SESSION_SECRET || (IS_PRODUCTION ? '' : 'local-preview-secret-change-before-deploy');
const SESSION_COOKIE = 'qria_admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'store.json');
const TYPE_VALUES = new Set(['individual', 'business', 'commerce', 'organization', 'other']);
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
app.use(express.json({ limit: '2mb' }));
app.use('/api', (req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const loginAttempts = new Map();

function hashString(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}
function constantTimeMatch(value, expected) {
  return crypto.timingSafeEqual(hashString(value), hashString(expected));
}
function sign(value) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(value).digest('base64url');
}
function createSessionToken() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_TTL_SECONDS * 1000, nonce: crypto.randomBytes(18).toString('base64url') })).toString('base64url');
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
    return Number(data.exp) > Date.now();
  } catch (_) { return false; }
}
function setSessionCookie(res, token) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}
function clearSessionCookie(res) {
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
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
function requireAdmin(req, res, next) {
  if (!validSession(req)) return res.status(401).json({ error: 'Session expirée. Reconnectez-vous.' });
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return checkSameOrigin(req, res, next);
  next();
}
function apiError(res, error, fallback = 'Une erreur est survenue.') {
  if (error?.code === 'DUPLICATE') return res.status(409).json({ error: error.message });
  console.error(error);
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
function cleanImage(value) {
  const raw = cleanText(value, 1_450_000);
  if (!raw) return '';
  if (/^https:\/\//i.test(raw)) return httpUrl(raw, 'URL de l’image');
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(raw)) return raw;
  throw new Error('L’image doit être un lien HTTPS ou un fichier PNG, JPEG ou WebP de moins de 1 Mo.');
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
  const offers = cleanList(input.offers, 60).map((item) => ({
    name: cleanText(item.name, 120), description: cleanText(item.description, 500), price: cleanText(item.price, 60), url: httpUrl(item.url, 'Lien de produit ou service'),
  })).filter((item) => item.name || item.description);
  const documents = cleanList(input.documents, 40).map((item) => ({ name: cleanText(item.name, 140), url: httpUrl(item.url, 'Lien de document', false) })).filter((item) => item.name && item.url);
  return {
    type, name, logo: cleanImage(input.logo), phone: cleanText(input.phone, 50), whatsapp: cleanText(input.whatsapp, 50), email,
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
  const extraLinks = cleanList(input.extraLinks, 20).map((item) => ({ label: cleanText(item.label, 100), url: httpUrl(item.url, 'Lien associé', false) })).filter((item) => item.label && item.url);
  if (destinationType === 'page') {
    const hasVisibleProfileData = selectedFields.some((field) => {
      const value = beneficiary[field];
      return Array.isArray(value) ? value.length > 0 : Boolean(value);
    });
    if (!hasVisibleProfileData && !cleanText(input.description, 800) && !cleanText(input.contentText, 5000) && !extraLinks.length) {
      throw new Error('Ajoutez un texte, un lien ou sélectionnez au moins une information disponible pour cette page.');
    }
  }
  const foreground = /^#[0-9a-f]{6}$/i.test(input.style?.foreground || '') ? input.style.foreground.toUpperCase() : '#173B32';
  const background = /^#[0-9a-f]{6}$/i.test(input.style?.background || '') ? input.style.background.toUpperCase() : '#FFFFFF';
  const correction = ['L', 'M', 'Q', 'H'].includes(input.style?.correction) ? input.style.correction : 'M';
  return {
    name, beneficiaryId: beneficiary.id, categoryId: cleanText(input.categoryId, 100) || DEFAULT_CATEGORY_BY_TYPE[beneficiary.type] || 'cat-other',
    purpose, destinationType, targetUrl, title: cleanText(input.title, 140), description: cleanText(input.description, 800),
    contentText: cleanText(input.contentText, 5000), selectedFields, extraLinks,
    style: { foreground, background, correction },
  };
}
function publicSnapshot(row) {
  return row ? {
    id: row.id, publicCode: row.publicCode, name: row.name, beneficiaryId: row.beneficiaryId,
    beneficiaryName: row.beneficiaryName, categoryId: row.categoryId, categoryName: row.categoryName,
    purpose: row.purpose, destinationType: row.destinationType, targetUrl: row.targetUrl,
    title: row.title, description: row.description, contentText: row.contentText,
    selectedFields: row.selectedFields, extraLinks: row.extraLinks, style: row.style, status: row.status,
  } : null;
}
function beneficiarySnapshot(row) {
  return row ? {
    id: row.id, type: row.type, name: row.name, hasLogo: Boolean(row.logo), phone: row.phone,
    whatsapp: row.whatsapp, email: row.email, address: row.address, locationUrl: row.locationUrl,
    website: row.website, socials: row.socials, bio: row.bio, offers: row.offers, documents: row.documents,
  } : null;
}
function makeAudit(action, entityType, entityId, beforeData, afterData, summary) {
  return { action, entityType, entityId, beforeData: beforeData || null, afterData: afterData || null, summary };
}

app.get('/api/health', (req, res) => res.json({ ok: true, database: process.env.DATABASE_URL ? 'postgres' : 'local-json', demoMode: !IS_PRODUCTION }));

app.post('/api/auth/login', (req, res) => {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const current = loginAttempts.get(key);
  if (current && now - current.start < 60_000 && current.count >= 8) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans une minute.' });
  }
  const username = String(req.body?.username || (IS_PRODUCTION ? '' : 'admin')).trim().slice(0, 120);
  const password = String(req.body?.password || '').slice(0, 256);
  const validUsername = ADMIN_USERNAME && constantTimeMatch(username, ADMIN_USERNAME);
  const validPassword = ADMIN_PASSWORD && constantTimeMatch(password, ADMIN_PASSWORD);
  if (!validUsername || !validPassword) {
    const next = !current || now - current.start >= 60_000 ? { start: now, count: 1 } : { ...current, count: current.count + 1 };
    loginAttempts.set(key, next);
    return res.status(401).json({ error: 'Mot de passe incorrect.' });
  }
  loginAttempts.delete(key);
  setSessionCookie(res, createSessionToken());
  return res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => res.json({ authenticated: validSession(req) }));
app.post('/api/auth/logout', requireAdmin, (req, res) => { clearSessionCookie(res); res.json({ ok: true }); });

app.get('/api/admin/dashboard', requireAdmin, async (req, res) => {
  try {
    const [stats, codes, activity] = await Promise.all([
      store.stats(), store.listCodes({ page: 1, limit: 6 }), store.listAudit({ page: 1, limit: 5 }),
    ]);
    res.json({ stats, recentCodes: codes.data, recentActivity: activity.data });
  } catch (error) { apiError(res, error, 'Impossible de charger le tableau de bord.'); }
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
    const data = await store.listBeneficiaries({ search: cleanText(req.query.search, 160), type: TYPE_VALUES.has(req.query.type) ? req.query.type : '', page, limit });
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
app.delete('/api/admin/beneficiaries/:id', requireAdmin, async (req, res) => {
  try {
    const before = await store.getBeneficiary(req.params.id);
    if (!before) return res.status(404).json({ error: 'Bénéficiaire introuvable.' });
    await store.archiveBeneficiary(req.params.id);
    await store.addAudit(makeAudit('archive', 'beneficiary', before.id, beneficiarySnapshot(before), null, `Bénéficiaire « ${before.name} » archivé; ses QR codes ont été désactivés.`));
    res.json({ ok: true });
  } catch (error) { apiError(res, error, 'Impossible d’archiver le bénéficiaire.'); }
});

app.get('/api/admin/codes', requireAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const data = await store.listCodes({
      search: cleanText(req.query.search, 160), categoryId: cleanText(req.query.categoryId, 100),
      beneficiaryId: cleanText(req.query.beneficiaryId, 100),
      status: ['active', 'inactive'].includes(req.query.status) ? req.query.status : '', page, limit,
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
    const input = validateQr(req.body || {}, beneficiary);
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
    const status = req.body?.status;
    if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Statut invalide.' });
    const before = await store.getCode(req.params.id);
    if (!before || before.deletedAt) return res.status(404).json({ error: 'QR code introuvable.' });
    const data = await store.setCodeStatus(req.params.id, status);
    await store.addAudit(makeAudit(status === 'active' ? 'activate' : 'deactivate', 'qr_code', data.id, publicSnapshot(before), publicSnapshot(data), `QR code « ${data.name} » ${status === 'active' ? 'activé' : 'désactivé'}.`));
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
    const entityType = ['qr_code', 'beneficiary', 'category'].includes(req.query.entityType) ? req.query.entityType : '';
    res.json(await store.listAudit({ page, limit: 30, entityType }));
  } catch (error) { apiError(res, error, 'Impossible de charger l’historique.'); }
});

function publicProfile(data) {
  const qr = data.qr;
  const beneficiary = data.beneficiary;
  const selected = new Set(safeList(qr.selectedFields));
  const visibleBeneficiary = { name: beneficiary.name, type: beneficiary.type };
  for (const field of PROFILE_FIELDS) {
    if (selected.has(field)) visibleBeneficiary[field] = beneficiary[field];
  }
  return {
    qr: {
      publicCode: qr.publicCode, name: qr.name, purpose: qr.purpose, title: qr.title, description: qr.description,
      contentText: qr.contentText, extraLinks: safeList(qr.extraLinks), categoryName: qr.categoryName,
    },
    beneficiary: visibleBeneficiary,
  };
}

app.get('/r/:code', async (req, res, next) => {
  try {
    const found = await store.getPublicCode(req.params.code);
    if (!found) return res.status(404).sendFile(path.join(PUBLIC_DIR, 'not-found.html'));
    if (found.qr.destinationType === 'redirect') {
      await store.recordScan(found.qr.id);
      return res.redirect(302, found.qr.targetUrl);
    }
    return res.sendFile(path.join(PUBLIC_DIR, 'profile.html'));
  } catch (error) { next(error); }
});
app.get('/api/public/qr/:code', async (req, res) => {
  try {
    const found = await store.getPublicCode(req.params.code);
    if (!found) return res.status(404).json({ error: 'Ce QR code n’est pas disponible.' });
    if (found.qr.destinationType !== 'page') return res.status(404).json({ error: 'Cette destination redirige directement.' });
    await store.recordScan(found.qr.id);
    res.setHeader('Cache-Control', 'no-store');
    res.json(publicProfile(found));
  } catch (error) { apiError(res, error, 'Impossible de charger cette page.'); }
});

app.get('/admin', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
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
    if (!IS_PRODUCTION) console.log('Mot de passe admin local de démonstration : admin1234');
  });
  const shutdown = async () => {
    server.close(async () => { if (store.close) await store.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((error) => { console.error('Échec du démarrage de QRia :', error); process.exit(1); });
