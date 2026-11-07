'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const QR_TEMPLATES = require('../public/qr-templates');

let child;
let base;
let tempDir;
let output = '';
const ONE_PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaHjwHwAExAKAc00zmAAAAABJRU5ErkJggg==';

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Oymike QR server exited (${child.exitCode}).\n${output}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch (_) { /* Starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Oymike QR server did not start in time.\n${output}`);
}
async function startServer(port, filePath) {
  output = '';
  const env = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, {
    NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: filePath,
    ADMIN_USERNAME: 'ceo-profile', ADMIN_PASSWORD: 'CEO-Profile-Strong-2026!',
    SESSION_SECRET: 'profile-workflow-test-session-secret-long-enough',
  });
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer();
}
async function stopServer() {
  if (!child || child.exitCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    new Promise((resolve) => setTimeout(resolve, 6000)),
  ]);
}
async function call(url, { cookie = '', method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { Origin: base, ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json().catch(() => ({})) : {};
  const text = contentType.includes('application/json') ? '' : await response.text().catch(() => '');
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const values = cookies.map((value) => value.split(';')[0]).filter((value) => /^qria_(?:admin|manager)=/.test(value));
  const active = values.find((value) => value.slice(value.indexOf('=') + 1) !== '');
  return { status: response.status, data, text, response, cookie: active || values[0] || cookie };
}
async function login(url, username, password) {
  const result = await call(url, { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.cookie.includes('='));
  return result.cookie;
}
function beneficiaryPayload(name, type = 'commerce') {
  return { type, name, logo: '', photos: [], phone: '+225 07 11 22 33 44', whatsapp: '+225 07 11 22 33 44', email: 'bonjour@example.ci', address: 'Cocody, Abidjan',
    locationUrl: '', website: '', socials: [], bio: '', offers: [], documents: [] };
}
function theme() {
  return { paletteId: 'forest', primary: '#176B52', secondary: '#DDF3E8', background: '#F6FBF8', surface: '#FFFFFF', text: '#18342B', button: '#176B52',
    style: 'modern', layout: 'catalog', font: 'system', textSize: 'normal', align: 'left' };
}
function fullTheme(overrides = {}) {
  const palette = QR_TEMPLATES.palettes.find((item) => item.id === 'forest');
  return { ...theme(), paletteId: 'custom', colors: { ...palette.colors, ...overrides.colors },
    style: 'professional', layout: 'grid',
    typography: {
      title: { family:'Poppins', size:42, weight:800, italic:true, align:'center', lineHeight:1.1, letterSpacing:-0.02, transform:'uppercase' },
      subtitle: { family:'Montserrat', size:18, weight:600, italic:false, align:'center', lineHeight:1.4, letterSpacing:0.01, transform:'none' },
      description: { family:'Merriweather', size:17, weight:400, italic:false, align:'left', lineHeight:1.7, letterSpacing:0, transform:'none' },
      price: { family:'Roboto', size:26, weight:800, italic:false, align:'left', lineHeight:1.15, letterSpacing:0, transform:'none' },
      button: { family:'Inter', size:15, weight:700, italic:false, align:'center', lineHeight:1.2, letterSpacing:0.02, transform:'none' },
    },
    backgroundStyle: { type:'gradient', color1:'#FF0000', color2:'#006B45', color3:'#FFFFFF', angle:135, image:ONE_PIXEL_PNG, imagePositionX:50, imagePositionY:50, imageOpacity:85, panelOpacity:92, pattern:'dots', patternOpacity:12 },
    components: { cardStyle:'rounded', radius:18, borderWidth:1, shadow:'medium', spacing:26, buttonShape:'pill', coverHeight:320, coverPositionX:55, coverPositionY:42, gridColumns:2, showLogo:true, showCover:true, showCategoryNav:true, collapsibleSections:true, galleryZoom:true, showBackToTop:true, sharePage:true, enableAnimation:true, bannerText:'Menu spécial du vendredi', bannerLabel:'À la une' },
    ...overrides, colors: { ...palette.colors, ...(overrides.colors || {}) },
  };
}
function profile(templateId, kind, entityName, items = [], extra = {}) {
  return { templateId, kind, entityName, subtitle: 'Bienvenue', description: 'Présentation publique', logo: '', coverImage: '', phone: '+225 07 11 22 33 44', whatsapp: '',
    email: 'bonjour@example.ci', address: 'Cocody, Abidjan', city: 'Abidjan', mapUrl: '', website: '', hours: 'Lundi | 08:00–18:00', deliveryInfo: '', eventDate: '', eventTime: '', venue: '', organizer: '',
    registrationUrl: '', bookingUrl: '', orderMode: 'simple', socials: [], documents: [], items, theme: theme(), ...extra };
}
function codePayload(beneficiaryId, name, templateId, kind, purpose, categoryId, items = [], extra = {}) {
  return { name, beneficiaryId, categoryId, purpose, destinationType: 'page', targetUrl: '', title: name, description: '', contentText: '', extraLinks: [],
    selectedFields: ['phone', 'whatsapp', 'email'], selectedPhotoIds: [], photos: [], saveMode: 'publish',
    style: { foreground: '#111111', background: '#FFFFFF', correction: 'M', dotStyle: 'square', textSize: 'default' },
    profileData: profile(templateId, kind, name, items, extra) };
}

// Covers the model-specific live-page API, additive legacy behavior and the manager flow on the JSON test store.
test('profils QR: restaurant, boutique, école, carte de visite, publication, prix modifiable, scan, droits, PDG et conservation', { timeout: 90000 }, async (t) => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oymike-qr-profile-test-'));
  const filePath = path.join(tempDir, 'store.json');
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  t.after(async () => { await stopServer(); if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }); });
  await startServer(port, filePath);
  const ceoPassword = 'CEO-Profile-Strong-2026!';
  let ceo = await login('/api/auth/login', 'ceo-profile', ceoPassword);

  const index = await call('/admin');
  assert.equal(index.status, 200);
  const indexHtml = index.text;
  assert.match(indexHtml, /qr-wizard\.js/);
  assert.match(indexHtml, /qr-wizard\.css/);
  assert.match(indexHtml, /fonts\.css/);
  const fontCss = await call('/fonts.css');
  assert.equal(fontCss.status, 200);
  assert.match(fontCss.text, /font-family:'Poppins'/);
  const fontFile = await fetch(`${base}/fonts/poppins-latin.woff2`);
  assert.equal(fontFile.status, 200);
  assert.match(fontFile.headers.get('content-type') || '', /font|woff/i);
  const managerHtml = await call('/manager');
  assert.equal(managerHtml.status, 200);
  assert.match(managerHtml.text, /qr-wizard\.js/);
  const csp = index.response.headers.get('content-security-policy') || '';
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /img-src 'self' data:/, 'les aperçus SVG sont rendus par data: autorisé par la CSP');
  assert.doesNotMatch(csp, /img-src[^;]*blob:/, 'le rendu n’a pas besoin d’élargir la CSP à blob:');
  assert.match(csp, /style-src 'self' 'unsafe-inline'/, 'les couleurs du thème sont générées dynamiquement; scripts restent strictement interdits en ligne');

  const beneResult = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: beneficiaryPayload('Le Jardin d’Awa') });
  assert.equal(beneResult.status, 201, JSON.stringify(beneResult.data));
  const beneId = beneResult.data.data.id;
  const restaurantItems = [{ id: 'item-poulet', group: 'Grillades', name: 'Poulet braisé', description: 'Alloco et attiéké', priceXof: 6500, promotionPriceXof: 5500, promotionLabel: 'Offre du midi', available: true, featured: true,
    photos: [{ id: 'item-photo-poulet', src: ONE_PIXEL_PNG, caption: 'Poulet braisé' }], variants: [{ name: 'Demi', priceXof: 4000 }, { name: 'Entier', priceXof: 6500 }], options: [{ name: 'Extra alloco', priceXof: 500 }] }];
  const restaurantBody = { ...codePayload(beneId, 'Menu du Jardin', 'restaurant', 'restaurant', 'menu', 'cat-shops', restaurantItems,
    { orderMode: 'simple', deliveryInfo: 'Retrait sur place', logo: ONE_PIXEL_PNG, theme: fullTheme({ colors: { pageBg:'#FF0000' } }) }), photos: [{ id: 'qr-gallery-one', src: ONE_PIXEL_PNG, caption: 'Salle du restaurant', isPrimary: true }] };
  const restaurantResult = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: restaurantBody });
  assert.equal(restaurantResult.status, 201, JSON.stringify(restaurantResult.data));
  const restaurant = restaurantResult.data.data;
  assert.equal(restaurant.status, 'active');
  assert.equal(restaurant.profileData.items[0].priceXof, 6500);
  assert.equal(restaurant.profileData.items[0].promotionPriceXof, 5500);
  assert.equal(restaurant.profileData.items[0].promotionLabel, 'Offre du midi');
  assert.equal(restaurant.profileData.items[0].variants[1].priceXof, 6500);
  assert.equal(restaurant.profileData.theme.colors.pageBg, '#FF0000');
  assert.equal(restaurant.profileData.theme.backgroundStyle.type, 'gradient');
  assert.equal(restaurant.profileData.theme.typography.title.family, 'Poppins');
  assert.equal(restaurant.profileData.theme.typography.description.family, 'Merriweather');
  assert.equal(restaurant.profileData.theme.components.bannerText, 'Menu spécial du vendredi');
  assert.equal(restaurant.profileData.themeVersion, 1);
  const firstPublic = await call(`/api/public/qr/${restaurant.publicCode}`);
  assert.equal(firstPublic.status, 200);
  assert.equal(firstPublic.data.profileData.templateId, 'restaurant');
  assert.equal(firstPublic.data.profileData.theme.colors.pageBg, '#FF0000');
  assert.equal(firstPublic.data.profileData.theme.typography.price.size, 26);
  assert.equal(firstPublic.data.profileData.theme.themeHistory, undefined);
  assert.equal(firstPublic.data.profileData.themeHistory, undefined);
  assert.equal(firstPublic.data.profileData.themeVersion, undefined);
  assert.equal(firstPublic.data.profileData.items[0].name, 'Poulet braisé');
  assert.equal(firstPublic.data.profileData.logo, ONE_PIXEL_PNG);
  assert.equal(firstPublic.data.profileData.items[0].photos[0].src, ONE_PIXEL_PNG);
  assert.equal(firstPublic.data.beneficiary.photos[0].src, `/api/public/qr/${restaurant.publicCode}/photos/qr-gallery-one?source=qr`);
  const durablePhoto = await fetch(`${base}${firstPublic.data.beneficiary.photos[0].src}`);
  assert.equal(durablePhoto.status, 200);
  assert.equal(durablePhoto.headers.get('content-type'), 'image/png');
  assert.equal((await durablePhoto.arrayBuffer()).byteLength, 70);

  // The stable /r/:code link uses the same profile record and records a scan.
  const publicCheck = await call(`/api/public/qr/${restaurant.publicCode}/check`);
  assert.equal(publicCheck.status, 200);
  assert.equal(publicCheck.data.data.publicCode, restaurant.publicCode);
  assert.equal(publicCheck.data.data.publicUrl, `${base}/r/${encodeURIComponent(restaurant.publicCode)}`);
  const publicScan = await call(`/r/${restaurant.publicCode}`);
  assert.equal(publicScan.status, 200);
  assert.match(publicScan.text, /qr-profile-renderer\.js/);
  assert.match(publicScan.text, /qr-profile\.css/);
  assert.match(publicScan.text, /fonts\.css/);
  const afterScan = await call(`/api/admin/codes/${restaurant.id}`, { cookie: ceo });
  assert.equal(afterScan.data.data.scanCount, 1);
  assert.equal(afterScan.data.data.publicCode, restaurant.publicCode);
  const publicHead = await call(`/r/${restaurant.publicCode}`, { method: 'HEAD' });
  assert.equal(publicHead.status, 200);
  assert.equal((await call(`/api/admin/codes/${restaurant.id}`, { cookie: ceo })).data.data.scanCount, 1, 'HEAD vérifie la route sans enregistrer de faux scan');

  // Updating a menu price changes the dynamic page without reprinting the code.
  const greenTheme = { ...restaurant.profileData.theme, colors: { ...restaurant.profileData.theme.colors, pageBg:'#006B45' }, backgroundStyle: { ...restaurant.profileData.theme.backgroundStyle, type:'gradient', color1:'#006B45', color2:'#F6FBF8', color3:'#DDF3E8', angle:120 } };
  const updatedBody = { ...restaurantBody, profileData: { ...restaurant.profileData, theme:greenTheme, items: [{ ...restaurant.profileData.items[0], priceXof: 7000 }] } };
  const update = await call(`/api/admin/codes/${restaurant.id}`, { cookie: ceo, method: 'PUT', body: updatedBody });
  assert.equal(update.status, 200, JSON.stringify(update.data));
  assert.equal(update.data.data.publicCode, restaurant.publicCode);
  assert.equal(update.data.data.profileData.themeVersion, 2);
  assert.equal(update.data.data.profileData.themeHistory.length, 1);
  assert.equal(update.data.data.profileData.themeHistory[0].theme.colors.pageBg, '#FF0000');
  const updatedPublic = await call(`/api/public/qr/${restaurant.publicCode}`);
  assert.equal(updatedPublic.data.profileData.theme.colors.pageBg, '#006B45');
  assert.equal(updatedPublic.data.profileData.theme.backgroundStyle.type, 'gradient');
  assert.equal(updatedPublic.data.profileData.items[0].priceXof, 7000);
  assert.equal(updatedPublic.data.profileData.items[0].promotionPriceXof, 5500);
  assert.equal(updatedPublic.data.profileData.items[0].variants[1].priceXof, 6500);
  assert.equal((await call(`/api/admin/codes/${restaurant.id}`, { cookie: ceo })).data.data.scanCount, 1);

  // Other sector templates serialize the fields appropriate for each page and remain editable.
  const shopBody = codePayload(beneId, 'Boutique Awa', 'boutique', 'catalog', 'catalog', 'cat-shops', [
    { name: 'Sac en raphia', group: 'Accessoires', description: 'Fabriqué en Côte d’Ivoire', priceXof: 12000, available: true, photos: [], variants: [], options: [] },
  ]);
  const shop = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: shopBody });
  assert.equal(shop.status, 201, JSON.stringify(shop.data));
  assert.equal((await call(`/api/public/qr/${shop.data.data.publicCode}`)).data.profileData.templateId, 'boutique');
  assert.equal((await call(`/api/public/qr/${shop.data.data.publicCode}`)).data.profileData.items[0].priceXof, 12000);
  const shopThemeBefore = (await call(`/api/public/qr/${shop.data.data.publicCode}`)).data.profileData.theme;
  assert.notEqual(shopThemeBefore.colors.pageBg, '#000000', 'un changement sur le QR restaurant ne modifie pas le thème boutique');

  const blackColors = { pageBg:'#000000', mainBg:'#000000', card:'#111111', panel:'#222222', title:'#FFFFFF', subtitle:'#EEEEEE', description:'#F3F3F3', price:'#F4D26D', button:'#333333', buttonText:'#FFFFFF', icon:'#F4D26D', border:'#555555', separator:'#444444', menuBg:'#222222', menuText:'#FFFFFF', link:'#79D8FF', badgeBg:'#444444', badgeText:'#FFFFFF' };
  const blackTheme = { ...update.data.data.profileData.theme, paletteId:'custom', colors:blackColors,
    typography:{ ...update.data.data.profileData.theme.typography, title:{...update.data.data.profileData.theme.typography.title,family:'Raleway',size:46,weight:800}, description:{...update.data.data.profileData.theme.typography.description,family:'Lato',size:18}, price:{...update.data.data.profileData.theme.typography.price,size:30} },
    backgroundStyle:{ ...update.data.data.profileData.theme.backgroundStyle, type:'image', color1:'#000000', image:ONE_PIXEL_PNG, imageOpacity:100, panelOpacity:96 },
    style:'premium', layout:'list' };
  const blackUpdate = await call(`/api/admin/codes/${restaurant.id}`, { cookie:ceo, method:'PUT', body:{ ...updatedBody, profileData:{ ...update.data.data.profileData, theme:blackTheme } } });
  assert.equal(blackUpdate.status, 200, JSON.stringify(blackUpdate.data));
  assert.equal(blackUpdate.data.data.profileData.theme.colors.pageBg, '#000000');
  assert.equal(blackUpdate.data.data.profileData.theme.typography.title.family, 'Raleway');
  assert.equal(blackUpdate.data.data.profileData.theme.typography.description.family, 'Lato');
  assert.equal(blackUpdate.data.data.profileData.theme.typography.price.size, 30);
  assert.equal(blackUpdate.data.data.profileData.theme.backgroundStyle.type, 'image');
  assert.equal(blackUpdate.data.data.profileData.theme.backgroundStyle.image, ONE_PIXEL_PNG);
  assert.equal(blackUpdate.data.data.profileData.themeVersion, 3);
  assert.equal(blackUpdate.data.data.profileData.themeHistory.length, 2);
  const publicBlack = await call(`/api/public/qr/${restaurant.publicCode}`);
  assert.equal(publicBlack.data.profileData.theme.colors.pageBg, '#000000');
  assert.equal(publicBlack.data.profileData.theme.colors.buttonText, '#FFFFFF');
  assert.equal(publicBlack.data.profileData.themeHistory, undefined);
  assert.equal((await call(`/api/public/qr/${shop.data.data.publicCode}`)).data.profileData.theme.colors.pageBg, shopThemeBefore.colors.pageBg);

  const schoolBene = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: beneficiaryPayload('École Les Flamboyants', 'organization') });
  assert.equal(schoolBene.status, 201);
  const school = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: codePayload(schoolBene.data.data.id, 'École Les Flamboyants', 'ecole', 'education', 'other', 'cat-organizations', [
    { name: 'Formation informatique', group: 'Programmes', description: 'Initiation et pratique', priceXof: null, available: true, photos: [], variants: [], options: [] },
  ]) });
  assert.equal(school.status, 201, JSON.stringify(school.data));
  assert.equal((await call(`/api/public/qr/${school.data.data.publicCode}`)).data.profileData.templateId, 'ecole');

  const contactBene = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: beneficiaryPayload('Awa Kone', 'individual') });
  assert.equal(contactBene.status, 201);
  const contact = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: codePayload(contactBene.data.data.id, 'Carte de visite Awa', 'carte-visite', 'contact', 'contact', 'cat-individuals') });
  assert.equal(contact.status, 201, JSON.stringify(contact.data));
  assert.equal((await call(`/api/public/qr/${contact.data.data.publicCode}`)).data.profileData.templateId, 'carte-visite');

  // PDG submissions and newly-created beneficiaries are also idempotent after an ambiguous network response.
  const retryBeneBody = { ...beneficiaryPayload('Bénéficiaire reprise réseau'), clientRequestId: 'admin-beneficiary-retry-0001' };
  const retryBeneFirst = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: retryBeneBody });
  const retryBeneAgain = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: retryBeneBody });
  assert.equal(retryBeneFirst.status, 201);assert.equal(retryBeneAgain.status, 200);assert.equal(retryBeneAgain.data.idempotent,true);
  assert.equal(retryBeneAgain.data.data.id,retryBeneFirst.data.data.id);
  const retryQrBody = { ...codePayload(retryBeneFirst.data.data.id, 'QR reprise réseau', 'carte-visite', 'contact', 'contact', 'cat-individuals'), clientRequestId: 'admin-qr-retry-request-0001' };
  const retryQrFirst = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: retryQrBody });
  const retryQrAgain = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: retryQrBody });
  assert.equal(retryQrFirst.status, 201, JSON.stringify(retryQrFirst.data));assert.equal(retryQrAgain.status, 200);assert.equal(retryQrAgain.data.idempotent,true);
  assert.equal(retryQrAgain.data.data.id,retryQrFirst.data.data.id);
  assert.equal(retryQrAgain.data.data.beneficiaryId,retryBeneFirst.data.data.id);
  const wrongBeneficiaryReplay = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: { ...retryQrBody, beneficiaryId: beneId } });
  assert.equal(wrongBeneficiaryReplay.status,409,'une clé réutilisée avec un autre bénéficiaire ne renvoie pas un QR trompeur');
  assert.equal(new Set([restaurant.publicCode,shop.data.data.publicCode,school.data.data.publicCode,contact.data.data.publicCode,retryQrFirst.data.data.publicCode]).size,5,'les créations successives gardent des identifiants différents');

  // Server validation rejects a fake template, weak page contrast and invalid image bytes.
  const invalidTemplate = { ...shopBody, name: 'Profil invalide', profileData: { ...shopBody.profileData, templateId: 'unknown-template' } };
  assert.equal((await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: invalidTemplate })).status, 400);
  const weakContrast = { ...shopBody, name: 'Contraste invalide', profileData: { ...shopBody.profileData, theme: { ...theme(), text: '#FFFFFF', background: '#FFFFFF' } } };
  assert.equal((await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: weakContrast })).status, 400);
  const badImage = { ...shopBody, name: 'Image invalide', profileData: { ...shopBody.profileData, logo: 'data:image/png;base64,PHNjcmlwdD4=' } };
  assert.equal((await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: badImage })).status, 400);
  const decimalPrice = { ...shopBody, name: 'Prix invalide', profileData: { ...shopBody.profileData, items: [{ ...shopBody.profileData.items[0], priceXof: 1.5 }] } };
  assert.equal((await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: decimalPrice })).status, 400);
  const invalidPromo = { ...shopBody, name: 'Promotion invalide', profileData: { ...shopBody.profileData, items: [{ ...shopBody.profileData.items[0], priceXof: 1000, promotionPriceXof: 1000 }] } };
  assert.equal((await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: invalidPromo })).status, 400);

  // Draft is private until explicit publication.
  const draft = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: { ...shopBody, name: 'Brouillon boutique', saveMode: 'draft' } });
  assert.equal(draft.status, 201);
  assert.equal(draft.data.data.status, 'draft');
  assert.equal((await call(`/api/public/qr/${draft.data.data.publicCode}`)).status, 404);

  // A legacy code without profileData continues through the generic public renderer.
  const legacyBene = await call('/api/admin/beneficiaries', { cookie: ceo, method: 'POST', body: beneficiaryPayload('Profil historique', 'individual') });
  const legacy = await call('/api/admin/codes', { cookie: ceo, method: 'POST', body: {
    name: 'QR historique', beneficiaryId: legacyBene.data.data.id, categoryId: 'cat-individuals', purpose: 'contact', destinationType: 'page', title: 'QR historique',
    description: '', contentText: '', extraLinks: [], selectedFields: ['phone'], selectedPhotoIds: [], photos: [], style: { foreground: '#111111', background: '#FFFFFF', correction: 'M' }, saveMode: 'publish',
  } });
  assert.equal(legacy.status, 201);
  const legacyPublic = await call(`/api/public/qr/${legacy.data.data.publicCode}`);
  assert.equal(legacyPublic.status, 200);
  assert.deepEqual(legacyPublic.data.profileData, {});

  // The manager flow is server-authorized, immediately active when allowed, idempotent, and isolated from PDG endpoints.
  const managerPassword = 'Manager-Profile-Strong-2026!';
  const managerCreate = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: { username: 'profile.manager', displayName: 'Gestionnaire Profil', email: 'manager@example.ci', phone: '+225 07 00 00 00 01', password: managerPassword,
    canCreateCodes: true, canEditCodes: true, canSelfActivateCodes: false, qrLimit: 0 } });
  assert.equal(managerCreate.status, 201, JSON.stringify(managerCreate.data));
  const managerCookie = await login('/api/manager/auth/login', 'profile.manager', managerPassword);
  assert.equal((await call('/api/admin/codes', { cookie: managerCookie })).status, 403);
  const managerBeneBody = { ...beneficiaryPayload('Ma Boutique Gestionnaire'), clientRequestId: 'manager-beneficiary-retry-0001' };
  const managerBene = await call('/api/manager/beneficiaries', { cookie: managerCookie, method: 'POST', body: managerBeneBody });
  assert.equal(managerBene.status, 201, JSON.stringify(managerBene.data));
  const managerBeneReplay = await call('/api/manager/beneficiaries', { cookie: managerCookie, method: 'POST', body: managerBeneBody });
  assert.equal(managerBeneReplay.status, 200);assert.equal(managerBeneReplay.data.idempotent,true);assert.equal(managerBeneReplay.data.data.id,managerBene.data.data.id);
  const managerCodeBody = { ...codePayload(managerBene.data.data.id, 'Menu du gestionnaire', 'restaurant', 'restaurant', 'menu', 'cat-shops', [
    { name: 'Attiéké poisson', group: 'Plats', description: 'Poisson braisé', priceXof: 8000, available: true, photos: [], variants: [], options: [] },
  ]), customerType: 'business', pricingPlanId: '', optionIds: [], createOrder: false, paymentMethod: 'cash', clientName: 'Ma Boutique Gestionnaire', companyName: 'Ma Boutique Gestionnaire', clientRequestId: 'profile-wizard-request-0001' };
  const managerCode = await call('/api/manager/codes', { cookie: managerCookie, method: 'POST', body: managerCodeBody });
  assert.equal(managerCode.status, 201, JSON.stringify(managerCode.data));
  assert.equal(managerCode.data.data.status, 'active');
  assert.equal(managerCode.data.order, null);
  assert.equal(managerCode.data.data.profileData.items[0].priceXof, 8000);
  const duplicateSubmission = await call('/api/manager/codes', { cookie: managerCookie, method: 'POST', body: managerCodeBody });
  assert.equal(duplicateSubmission.status, 200, JSON.stringify(duplicateSubmission.data));
  assert.equal(duplicateSubmission.data.idempotent, true);
  assert.equal(duplicateSubmission.data.data.id, managerCode.data.data.id);

  // PDG status controls still gate public access, and manager suspension revokes the manager session.
  const suspendQr = await call(`/api/admin/codes/${restaurant.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Test de contrôle PDG.' } });
  assert.equal(suspendQr.status, 200);
  assert.equal((await call(`/api/public/qr/${restaurant.publicCode}`)).status, 404);
  const reactivateQr = await call(`/api/admin/codes/${restaurant.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active' } });
  assert.equal(reactivateQr.status, 200);
  assert.equal((await call(`/api/public/qr/${restaurant.publicCode}`)).status, 200);
  const managerId = managerCreate.data.data.id;
  const suspendManager = await call(`/api/admin/managers/${managerId}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Test de suspension.', confirmUsername: 'profile.manager', adminPassword: ceoPassword } });
  assert.equal(suspendManager.status, 200, JSON.stringify(suspendManager.data));
  assert.equal((await call('/api/manager/dashboard', { cookie: managerCookie })).status, 401);

  // Download and print assets are wired to the styled QR renderer; print is still a manual browser action.
  const printPage = await call(`/print.html?id=${encodeURIComponent(restaurant.id)}`);
  assert.equal(printPage.status, 200);
  const printHtml = printPage.text;
  assert.match(printHtml, /print\.js/);
  const printScript = await call('/print.js');
  assert.match(printScript.text, /dotStyle/);
  const adminScript = await call('/admin.js');
  assert.match(adminScript.text, /downloadCode\(code, format\)/);
  assert.match(adminScript.text, /qrSvg\(code\)/);

  // A real process restart against the same JSON store preserves the new profile, price, QR and scan history.
  const expectedCode = restaurant.publicCode;
  const expectedId = restaurant.id;
  await stopServer();
  await startServer(port, filePath);
  ceo = await login('/api/auth/login', 'ceo-profile', ceoPassword);
  const durableCode = await call(`/api/admin/codes/${expectedId}`, { cookie: ceo });
  assert.equal(durableCode.data.data.publicCode, expectedCode);
  assert.equal(durableCode.data.data.profileData.items[0].priceXof, 7000);
  assert.equal(durableCode.data.data.profileData.logo, ONE_PIXEL_PNG);
  assert.equal(durableCode.data.data.profileData.items[0].photos[0].src, ONE_PIXEL_PNG);
  assert.equal(durableCode.data.data.profileData.theme.colors.pageBg, '#000000');
  assert.equal(durableCode.data.data.profileData.themeVersion, 3);
  assert.equal(durableCode.data.data.profileData.themeHistory.length, 2);
  assert.equal(durableCode.data.data.profileData.theme.backgroundStyle.image, ONE_PIXEL_PNG);
  assert.equal(durableCode.data.data.photos[0].src, ONE_PIXEL_PNG);
  assert.equal(durableCode.data.data.scanCount, 1);
  assert.equal((await call(`/api/public/qr/${expectedCode}`)).data.profileData.templateId, 'restaurant');
});
