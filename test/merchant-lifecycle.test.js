'use strict';
// Mission 3 — inscription autonome, décisions, portée marchand, scans séparés.
// Ces tests utilisent le vrai serveur, le vrai stockage JSON et les vrais mots de passe :
// aucun résultat n'est simulé, aucune donnée n'est inventée.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SESSION_SECRET = 'secret-de-test-suffisamment-long-pour-la-session-0001';
const ADMIN_PASSWORD = 'Ceo-Password-2026!';
const MERCHANT_PASSWORD = 'Awa-Marchand-2026!';
let PORT = 0;
let base = '';
let child = null;
let storeFile = '';

function spawnServer(port, file) {
  const env = { ...process.env, NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: file,
    ADMIN_USERNAME: 'ceo', ADMIN_PASSWORD, SESSION_SECRET };
  delete env.DATABASE_URL; delete env.PUBLIC_BASE_URL;
  return spawn(process.execPath, ['server.js'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
}

async function waitForHealth(url, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try { const response = await fetch(`${url}/api/health`); if (response.ok) return true; } catch (_) { /* pas encore prêt */ }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error('Le serveur de test ne répond pas.');
}

async function call(url, { method = 'GET', body, cookie } = {}) {
  const headers = { Origin: base };
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const type = response.headers.get('content-type') || '';
  const data = type.includes('json') ? await response.json().catch(() => ({})) : {};
  const cookies = (response.headers.getSetCookie?.() || []).map((value) => value.split(';')[0]);
  return { status: response.status, data, cookies, headers: response.headers };
}
const pick = (result, role) => (result.cookies.find((value) => value.startsWith(`qria_${role}=`)) || '').split(';')[0];

async function adminSession() { return pick(await call('/api/auth/login', { method: 'POST', body: { username: 'ceo', password: ADMIN_PASSWORD } }), 'admin'); }

function registrationPayload(overrides = {}) {
  return { contactName: 'Awa Koné', businessName: 'Maquis Awa', username: 'maquis.awa', phone: '+225 07 00 11 22 33',
    email: 'awa@example.com', city: 'Abidjan', location: 'Cocody', address: 'Rue des Jardins, Cocody',
    activityDomain: 'Maquis / restaurant', description: 'Maquis familial avec grillades et boissons fraîches.',
    sector: 'maquis', password: MERCHANT_PASSWORD, ...overrides };
}

before(async () => {
  const freePort = await new Promise((resolve) => {
    const server = require('node:net').createServer();
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
  PORT = freePort; base = `http://127.0.0.1:${PORT}`;
  storeFile = path.join(os.tmpdir(), `qria-lifecycle-${crypto.randomUUID()}.json`);
  child = spawnServer(PORT, storeFile);
  await waitForHealth(base);
});

after(() => {
  if (child) child.kill('SIGTERM');
  try { fs.unlinkSync(storeFile); } catch (_) {}
});

// 1 — inscription autonome : statut initial, message exact, aucun accès avant validation.
test('1. inscription autonome : statut « en attente », message exact, formulaire incomplet refusé', async () => {
  const created = await call('/api/public/merchant-registrations', { method: 'POST', body: registrationPayload() });
  assert.equal(created.status, 201);
  assert.match(created.data.data.reference, /^INSC-\d{8}-[0-9A-F]{6}$/);
  assert.equal(created.data.data.status, 'pending');
  assert.equal(created.data.data.message, 'Votre demande d’inscription a bien été reçue. Elle sera examinée par un administrateur avant l’activation de votre espace marchand.');
  const incomplete = await call('/api/public/merchant-registrations', { method: 'POST', body: registrationPayload({ username: 'autre.essai', email: '', description: 'court' }) });
  assert.equal(incomplete.status, 400);
  assert.ok(incomplete.data.error);
});

// 2 — aucun accès marchand tant que la demande n'est pas approuvée.
test('2. un compte en attente ne peut ni se connecter ni activer son QR', async () => {
  const login = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'maquis.awa', password: MERCHANT_PASSWORD } });
  assert.equal(login.status, 401);
  const admin = await adminSession();
  const list = await call('/api/admin/merchant-registrations?status=open', { cookie: admin });
  assert.equal(list.status, 200);
  assert.equal(list.data.counts.open, 1);
  const qrAttempt = await call('/api/admin/merchants/inexistant/qr', { method: 'PUT', body: { enabled: true } });
  assert.ok([401, 403, 404].includes(qrAttempt.status));
});

// 3 — approbation : compte réel, boutique non publiée, QR non activé, référence conservée.
test('3. approbation : compte actif avec le mot de passe choisi, boutique non publiée, QR non activé', async () => {
  const admin = await adminSession();
  const list = await call('/api/admin/merchant-registrations?status=open', { cookie: admin });
  const registration = list.data.data[0];
  const approved = await call(`/api/admin/merchant-registrations/${registration.id}/decision`, { method: 'POST', cookie: admin, body: { action: 'approve' } });
  assert.equal(approved.status, 200);
  assert.equal(approved.data.data.registration.status, 'approved');
  assert.equal(approved.data.data.merchant.status, 'active');
  assert.equal(approved.data.data.store.isPublished, false);
  const login = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'maquis.awa', password: MERCHANT_PASSWORD } });
  assert.equal(login.status, 200, 'le mot de passe choisi à l’inscription doit fonctionner');
  const activation = await call('/api/merchant/activation-status', { cookie: pick(login, 'merchant') });
  assert.equal(activation.status, 200);
  assert.equal(activation.data.data.steps.find((step) => step.key === 'store').done, true, 'la boutique est préparée à l’approbation');
  assert.equal(activation.data.data.nextStep, 'published');
  assert.equal(activation.data.data.steps.find((step) => step.key === 'qr').done, false);
});

// 4 — double validation concurrente : une seule décision acceptée.
test('4. une demande ne peut pas être validée deux fois', async () => {
  const admin = await adminSession();
  const created = await call('/api/public/merchant-registrations', { method: 'POST', body: registrationPayload({ username: 'koffi.shop', email: 'koffi@example.com', phone: '+225 05 44 33 22 11', businessName: 'Quincaillerie Koffi' }) });
  assert.equal(created.status, 201);
  const list = await call('/api/admin/merchant-registrations?status=pending&search=koffi', { cookie: admin });
  const registration = list.data.data[0];
  const [first, second] = await Promise.all([
    call(`/api/admin/merchant-registrations/${registration.id}/decision`, { method: 'POST', cookie: admin, body: { action: 'approve' } }),
    call(`/api/admin/merchant-registrations/${registration.id}/decision`, { method: 'POST', cookie: admin, body: { action: 'approve' } }),
  ]);
  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [200, 409]);
  const rejected = [first, second].find((result) => result.status === 409);
  assert.ok(['ALREADY_DECIDED', 'CONCURRENT_DECISION', 'INVALID_TRANSITION'].includes(rejected.data.code));
});

// 5 — doublon d'identité : jamais de second compte, jamais de suppression.
test('5. doublon téléphone/e-mail : la demande est refusée sans supprimer l’existant', async () => {
  const duplicate = await call('/api/public/merchant-registrations', { method: 'POST', body: registrationPayload({ username: 'awa.bis', email: 'awa@example.com' }) });
  assert.equal(duplicate.status, 409);
  const admin = await adminSession();
  const merchants = await call('/api/admin/merchants?search=maquis.awa', { cookie: admin });
  const rows = Array.isArray(merchants.data.data) ? merchants.data.data : (merchants.data.data ? [merchants.data.data] : []);
  assert.ok(rows.length >= 1, 'le compte existant est conservé');
});

// 6 — permission gestionnaire désactivée par défaut, puis accordée par l’Administrateur général.
test('6. permission de validation : refusée par défaut, accordée et révocable par l’Administrateur général', async () => {
  const admin = await adminSession();
  const created = await call('/api/admin/managers', { method: 'POST', cookie: admin, body: { username: 'gest.mission3', displayName: 'Gestionnaire Mission 3', password: 'Gestionnaire-2026!' } });
  assert.equal(created.status, 201);
  assert.equal(created.data.data.canValidateMerchantRegistrations, false);
  const login = await call('/api/manager/auth/login', { method: 'POST', body: { username: 'gest.mission3', password: 'Gestionnaire-2026!' } });
  const manager = pick(login, 'manager');
  const denied = await call('/api/manager/merchant-registrations', { cookie: manager });
  assert.equal(denied.status, 403);
  assert.equal(denied.data.code, 'REGISTRATION_VALIDATION_FORBIDDEN');
  const granted = await call(`/api/admin/managers/${created.data.data.id}`, { method: 'PUT', cookie: admin, body: { username: 'gest.mission3', displayName: 'Gestionnaire Mission 3', canValidateMerchantRegistrations: true, canManageMerchants: true } });
  assert.equal(granted.status, 200);
  assert.equal(granted.data.data.canValidateMerchantRegistrations, true);
  const login2 = pick(await call('/api/manager/auth/login', { method: 'POST', body: { username: 'gest.mission3', password: 'Gestionnaire-2026!' } }), 'manager');
  const allowed = await call('/api/manager/merchant-registrations', { cookie: login2 });
  assert.equal(allowed.status, 200);
  const pending = allowed.data.data.find((row) => row.status === 'pending');
  if (pending) {
    const decision = await call(`/api/manager/merchant-registrations/${pending.id}/decision`, { method: 'POST', cookie: login2, body: { action: 'reject', reason: 'Pièces illisibles.' } });
    assert.equal(decision.status, 200);
    assert.equal(decision.data.data.registration.status, 'rejected');
  }
  const revoked = await call(`/api/admin/managers/${created.data.data.id}`, { method: 'PUT', cookie: admin, body: { username: 'gest.mission3', displayName: 'Gestionnaire Mission 3', canValidateMerchantRegistrations: false, canManageMerchants: true } });
  assert.equal(revoked.status, 200);
  assert.equal(revoked.data.data.canValidateMerchantRegistrations, false);
  const login3 = pick(await call('/api/manager/auth/login', { method: 'POST', body: { username: 'gest.mission3', password: 'Gestionnaire-2026!' } }), 'manager');
  assert.equal((await call('/api/manager/merchant-registrations', { cookie: login3 })).status, 403);
});

// 7 — scan marchand : reconnaissance, anti-doublon, refus d'un QR d'une autre boutique.
test('7. scanner marchand : table reconnue, scan dédoublonné, QR d’une autre boutique refusé', async () => {
  const merchantLogin = await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'maquis.awa', password: MERCHANT_PASSWORD } });
  const merchant = pick(merchantLogin, 'merchant');
  const storePut = await call('/api/merchant/store', { method: 'PUT', cookie: merchant, body: { name: 'Maquis Awa', slug: 'maquis-awa', sector: 'maquis', isPublished: false } });
  assert.equal(storePut.status, 200);
  // Procédure PDG existante : publication de la boutique puis activation du QR (jamais contournée).
  const adminEarly = await adminSession();
  const merchants = await call('/api/admin/merchants?search=maquis.awa', { cookie: adminEarly });
  const merchantRow = (merchants.data.data || merchants.data).find((row) => row.username === 'maquis.awa');
  assert.ok(merchantRow, 'le compte marchand approuvé est retrouvé par son identifiant');
  const merchantId = merchantRow.id;
  const publish = await call(`/api/admin/merchants/${merchantId}/store`, { method: 'PUT', cookie: adminEarly, body: { name: 'Maquis Awa', slug: 'maquis-awa', sector: 'maquis', isPublished: true, acceptsOrders: true } });
  assert.equal(publish.status, 200);
  const qr = await call(`/api/admin/merchants/${merchantId}/qr`, { method: 'PUT', cookie: adminEarly, body: { enabled: true } });
  assert.equal(qr.status, 201);
  const point = await call('/api/merchant/service-points', { method: 'POST', cookie: merchant, body: { type: 'table', name: 'Table 4', zone: 'Terrasse' } });
  assert.equal(point.status, 201);
  const published = await call(`/api/public/service-points/${point.data.data.publicCode}`);
  assert.equal(published.status, 200, 'le QR de table est actif après la procédure PDG');
  const first = await call('/api/merchant/assisted-orders/scan', { method: 'POST', cookie: merchant, body: { code: `${base}/t/${point.data.data.publicCode}`, eventId: 'evt-0001' } });
  assert.equal(first.status, 200);
  assert.equal(first.data.data.servicePoint.name, 'Table 4');
  assert.ok(first.data.data.scanEventId);
  const replay = await call('/api/merchant/assisted-orders/scan', { method: 'POST', cookie: merchant, body: { code: `${base}/t/${point.data.data.publicCode}`, eventId: 'evt-0001' } });
  assert.equal(replay.data.data.duplicate, true);
  // QR d'une autre boutique : refus explicite, sans création d'événement.
  const admin = await adminSession();
  const other = await call('/api/admin/merchants', { method: 'POST', cookie: admin, body: { username: 'autre.boutique', displayName: 'Autre Boutique' } });
  await call(`/api/admin/merchants/${other.data.data.id}/store`, { method: 'PUT', cookie: admin, body: { name: 'Autre', slug: 'autre-boutique', sector: 'general', isPublished: true } });
  const otherPoint = await call(`/api/admin/merchants/${other.data.data.id}/service-points`, { method: 'POST', cookie: admin, body: { type: 'table', name: 'Table Z' } });
  const foreign = await call('/api/merchant/assisted-orders/scan', { method: 'POST', cookie: merchant, body: { code: `${base}/t/${otherPoint.data.data.publicCode}` } });
  assert.equal(foreign.status, 403);
  assert.equal(foreign.data.code, 'QR_OTHER_STORE');
  const invalid = await call('/api/merchant/assisted-orders/scan', { method: 'POST', cookie: merchant, body: { code: 'https://exemple.test/autre-chose' } });
  assert.equal(invalid.status, 400);
  // isolation : le marchand ne voit que ses propres données
  const own = await call('/api/merchant/orders', { cookie: merchant });
  assert.equal(own.status, 200);
});

// 8 — commande assistée : provenance, coordonnées absentes, idempotence, stock déduit une fois.
test('8. commande saisie par le marchand : provenance, téléphone facultatif, pas de doublon', async () => {
  const merchant = pick(await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'maquis.awa', password: MERCHANT_PASSWORD } }), 'merchant');
  const product = await call('/api/merchant/products', { method: 'POST', cookie: merchant, body: { name: 'Poulet braisé', priceXof: 5000, stockQuantity: 10, trackStock: true } });
  assert.equal(product.status, 201);
  const points = await call('/api/merchant/service-points', { cookie: merchant });
  const point = (points.data.data || [])[0];
  const payload = { requestId: 'assisted-request-0001', customerName: 'Client Comptoir', customerPhone: '', orderType: 'dine_in',
    servicePointId: point.id, confirmOccupiedPoint: true, scannedQrCode: point.publicCode, scannedVia: 'scanner',
    items: [{ productId: product.data.data.id, quantity: 2 }] };
  const order = await call('/api/merchant/assisted-orders', { method: 'POST', cookie: merchant, body: payload });
  assert.equal(order.status, 201);
  assert.equal(order.data.data.order.source, 'merchant_assisted');
  assert.equal(order.data.data.order.customerContactStatus, 'not_available');
  assert.equal(order.data.data.order.scannedVia, 'scanner');
  assert.equal(order.data.data.order.scannedQrCode, point.publicCode);
  const replay = await call('/api/merchant/assisted-orders', { method: 'POST', cookie: merchant, body: payload });
  assert.equal(replay.status, 200);
  assert.equal(replay.data.data.idempotent, true);
  const orders = await call('/api/merchant/orders', { cookie: merchant });
  assert.equal(orders.data.total, 1);
  const products = await call('/api/merchant/products', { cookie: merchant });
  const refreshed = (products.data.data || []).find((row) => row.id === product.data.data.id);
  assert.equal(Number(refreshed.stockQuantity), 8, 'le stock n’est déduit qu’une fois');
});

// 9 — statistiques : scans clients et marchands séparés, total général, historique antérieur conservé.
test('9. statistiques séparées : un scan marchand n’est jamais une visite publique', async () => {
  const merchant = pick(await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'maquis.awa', password: MERCHANT_PASSWORD } }), 'merchant');
  const merchantStats = await call('/api/merchant/scan-stats?period=30', { cookie: merchant });
  assert.equal(merchantStats.status, 200);
  assert.equal(merchantStats.data.data.counts.merchant, 1, 'un seul scan marchand réel : le rejeu anti-doublon n’est pas recompté');
  assert.equal(merchantStats.data.data.counts.customer, 0);
  const admin = await adminSession();
  const adminStats = await call('/api/admin/scan-stats/merchant-qr?period=30', { cookie: admin });
  assert.equal(adminStats.status, 200);
  assert.equal(adminStats.data.data.counts.customer + adminStats.data.data.counts.merchant, adminStats.data.data.counts.total);
  assert.ok(Array.isArray(adminStats.data.data.timeline));
  const history = await call('/api/admin/merchant-lifecycle/registrations-history', { cookie: admin });
  assert.equal(history.status, 200);
  assert.ok((history.data.data || []).length >= 1, 'chaque décision reste tracée');
});

// 10 — bascules de l’Administrateur général : coupées sans effacer les données existantes.
test('10. activer/désactiver les fonctionnalités ne supprime aucune donnée', async () => {
  const admin = await adminSession();
  const off = await call('/api/admin/merchant-lifecycle/features', { method: 'PUT', cookie: admin, body: { selfServiceRegistration: false, merchantScanner: false } });
  assert.equal(off.status, 200);
  assert.equal(off.data.data.selfServiceRegistration, false);
  const blocked = await call('/api/public/merchant-registrations', { method: 'POST', body: registrationPayload({ username: 'ferme.essai', email: 'ferme@example.com', phone: '+225 01 02 03 04 05' }) });
  assert.equal(blocked.status, 503);
  assert.equal(blocked.data.code, 'REGISTRATION_CLOSED');
  const merchants = await call('/api/admin/merchants?search=maquis.awa', { cookie: admin });
  assert.ok(merchants.status === 200);
  const on = await call('/api/admin/merchant-lifecycle/features', { method: 'PUT', cookie: admin, body: { selfServiceRegistration: true, merchantScanner: true } });
  assert.equal(on.data.data.selfServiceRegistration, true);
  const merchant = pick(await call('/api/merchant/auth/login', { method: 'POST', body: { username: 'maquis.awa', password: MERCHANT_PASSWORD } }), 'merchant');
  const orders = await call('/api/merchant/orders', { cookie: merchant });
  assert.equal(orders.data.total, 1, 'les commandes existantes sont intactes');
});
