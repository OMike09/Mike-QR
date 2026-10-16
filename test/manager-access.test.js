'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child;
let base;
let tempDir;

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
    if (child.exitCode !== null) throw new Error(`QRia server exited (${child.exitCode}).`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch (_) { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('QRia server did not start in time.');
}
async function call(url, { cookie = '', method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { Origin: base, ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, {
    method, headers: requestHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  const setCookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const cookieValues = setCookies.map((value) => value.split(';')[0]).filter((value) => /^qria_(?:admin|manager)=/.test(value));
  const activeCookie = cookieValues.find((value) => value.slice(value.indexOf('=') + 1) !== '');
  return { response, status: response.status, data: json, cookies: setCookies, cookie: activeCookie || cookieValues[0] || cookie };
}
async function login(url, username, password) {
  const result = await call(url, { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.cookie.includes('='), 'session cookie was not issued');
  return result.cookie;
}
const managerAvatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADUlEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
const managerPayload = (username, displayName, password, avatarData = '') => ({ username, displayName, email: `${username}@example.ci`, phone: '+225 07 00 00 01 01', password, avatarData });
const benePayload = (name) => ({
  type: 'individual', name, logo: '', photos: [], phone: '+225 0102030405', whatsapp: '', email: '', address: '',
  locationUrl: '', website: '', socials: [], bio: '', offers: [], documents: [],
});
const codePayload = (beneficiaryId, name = 'QR de test') => ({
  name, beneficiaryId, categoryId: 'cat-individuals', purpose: 'contact', destinationType: 'page', targetUrl: '',
  title: '', description: '', contentText: '', extraLinks: [], selectedFields: ['phone'], selectedPhotoIds: [],
  style: { foreground: '#173B32', background: '#FFFFFF', correction: 'M', textSize: 'default' },
});

test('séparation des rôles, révocation immédiate, attribution et conservation des données', { timeout: 60000 }, async (t) => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qria-manager-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, {
    NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: path.join(tempDir, 'store.json'),
    ADMIN_USERNAME: 'ceo-test', ADMIN_PASSWORD: 'CEO-Strong-Password-2026!',
    SESSION_SECRET: 'test-session-secret-with-more-than-thirty-two-characters',
    QRIA_TEST_TEMP_PASSWORD_TTL_MS: '5000', QRIA_TEST_RESET_LINK_TTL_MS: '5000',
  });
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  try { await waitForServer(); } catch (error) { throw new Error(`${error.message}\n${serverOutput}`); }
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  const initialCeoLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'ceo-test', password: 'CEO-Strong-Password-2026!' } });
  assert.equal(initialCeoLogin.status, 200, JSON.stringify(initialCeoLogin.data));
  assert.equal(initialCeoLogin.data.role, 'admin', 'le rôle PDG est déterminé côté serveur après vérification');
  assert.equal((await call('/api/auth/me', { cookie: initialCeoLogin.cookie })).data.role, 'admin');
  const invalidCeoLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'ceo-test', password: 'incorrect' } });
  assert.equal(invalidCeoLogin.status, 401);
  assert.match(invalidCeoLogin.data.error, /Identifiant ou mot de passe incorrect/);
  const ceoLogout = await call('/api/auth/logout', { cookie: initialCeoLogin.cookie, method: 'POST' });
  assert.equal(ceoLogout.status, 200);
  assert.equal((await call('/api/auth/me', { cookie: ceoLogout.cookie })).data.authenticated, false, 'la déconnexion PDG efface la session du lien partagé');
  const ceo = await login('/api/auth/login', 'ceo-test', 'CEO-Strong-Password-2026!');
  const password1 = 'Manager-One-Secret-2026!';
  const password2 = 'Manager-Two-Secret-2026!';
  const firstCreated = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('manager.one', 'Gestionnaire Un', password1, managerAvatar) });
  const secondCreated = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('manager.two', 'Gestionnaire Deux', password2) });
  assert.equal(firstCreated.status, 201, JSON.stringify(firstCreated.data));
  assert.equal(secondCreated.status, 201, JSON.stringify(secondCreated.data));
  const manager1Id = firstCreated.data.data.id;
  const manager2Id = secondCreated.data.data.id;
  assert.ok(manager1Id && manager2Id && manager1Id !== manager2Id);
  assert.equal('passwordHash' in firstCreated.data.data, false, 'password hash must never be returned');
  assert.equal(firstCreated.data.data.phone, '+225 07 00 00 01 01');
  const customDomain = 'manager-one.example.test';
  const domainChangeWithoutStepUp = await call(`/api/admin/managers/${manager1Id}`, { cookie: ceo, method: 'PUT', body: { username: 'manager.one', displayName: 'Gestionnaire Un', email: 'manager.one.updated@example.ci', phone: '+225 05 00 00 02 02', customDomain, confirmUsername: 'manager.one' } });
  assert.equal(domainChangeWithoutStepUp.status, 403, 'une session PDG seule ne suffit pas à rattacher le domaine');
  assert.equal((await call('/api/admin/managers', { cookie: ceo })).data.data.find((manager) => manager.id === manager1Id)?.customDomain, '');
  const editedManager = await call(`/api/admin/managers/${manager1Id}`, { cookie: ceo, method: 'PUT', body: { username: 'manager.one', displayName: 'Gestionnaire Un', email: 'manager.one.updated@example.ci', phone: '+225 05 00 00 02 02', customDomain, adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(editedManager.status, 200, JSON.stringify(editedManager.data));
  assert.equal(editedManager.data.data.email, 'manager.one.updated@example.ci');
  assert.equal(editedManager.data.data.phone, '+225 05 00 00 02 02');
  assert.equal(editedManager.data.data.customDomain, customDomain, 'le sous-domaine doit être enregistré sur le compte existant');
  const duplicateDomain = await call(`/api/admin/managers/${manager2Id}`, { cookie: ceo, method: 'PUT', body: { username: 'manager.two', displayName: 'Gestionnaire Deux', email: 'manager.two@example.ci', phone: '+225 07 00 00 01 01', customDomain, adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(duplicateDomain.status, 409, 'un même domaine ne peut pas être associé à deux gestionnaires');
  const managersAfterBinding = await call('/api/admin/managers', { cookie: ceo });
  assert.equal(managersAfterBinding.data.data.length, 2, 'rattacher un domaine modifie le Gestionnaire existant sans créer de second compte');
  assert.equal(managersAfterBinding.data.data.find((manager) => manager.id === manager1Id)?.customDomain, customDomain);
  const domainChangeAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=custom_domain_change`, { cookie: ceo });
  assert.ok(domainChangeAudit.data.data.some((event) => event.result === 'success' && event.afterData?.customDomain === customDomain), 'le rattachement est tracé dans l’audit PDG');
  const domainHeaders = { 'x-forwarded-host': customDomain, Origin: `http://${customDomain}` };
  const domainRoot = await fetch(base, { headers: { 'x-forwarded-host': customDomain } });
  assert.equal(domainRoot.status, 200);
  const domainRootHtml = await domainRoot.text();
  assert.match(domainRootHtml, /ACCÈS SÉCURISÉ/, 'la racine du domaine personnalisé affiche le même écran de connexion principal');
  assert.match(domainRootHtml, /<label for="adminUsername">Identifiant<\/label>/, 'le libellé partagé n’est plus réservé au PDG');
  assert.doesNotMatch(domainRootHtml, /Identifiant PDG|Votre espace gestionnaire/);
  assert.match(domainRootHtml, /data-pwa-install/, 'l’espace PDG expose une action d’installation');
  assert.match(domainRootHtml, /pwa-install\.js/, 'le contrôleur PWA est chargé dans l’espace principal');
  assert.match(domainRootHtml, /brand-theme\.css/, 'la palette partagée est chargée sur la connexion et le tableau de bord');
  assert.match(domainRootHtml, /icons\/qria-192\.png/, 'le logo fourni est référencé par l’interface');
  assert.ok(domainRootHtml.includes('rel="apple-touch-icon" sizes="180x180" href="/icons/qria-180.png"'), 'l’icône dédiée iOS est déclarée');
  const appleTouchIcon = await fetch(`${base}/icons/qria-180.png`);
  assert.equal(appleTouchIcon.status, 200);
  assert.match(appleTouchIcon.headers.get('content-type') || '', /image\/png/i);
  const rootManifestResponse = await fetch(`${base}/manifest.webmanifest`);
  assert.equal(rootManifestResponse.status, 200);
  assert.match(rootManifestResponse.headers.get('content-type') || '', /application\/manifest\+json/i);
  const rootManifest = await rootManifestResponse.json();
  assert.equal(rootManifest.start_url, '/');
  assert.equal(rootManifest.scope, '/');
  assert.equal(rootManifest.theme_color, '#111111');
  assert.equal(rootManifest.background_color, '#F3F3F3');
  assert.ok(rootManifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(rootManifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.ok(rootManifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of rootManifest.icons) {
    const iconResponse = await fetch(`${base}${icon.src}`);
    assert.equal(iconResponse.status, 200, `l’icône PWA ${icon.src} doit être servie`);
    assert.match(iconResponse.headers.get('content-type') || '', /image\/png/i);
  }
  const rootWorkerResponse = await fetch(`${base}/sw.js`);
  assert.equal(rootWorkerResponse.status, 200);
  assert.equal(rootWorkerResponse.headers.get('service-worker-allowed'), '/');
  const rootWorkerText = await rootWorkerResponse.text();
  assert.match(rootWorkerText, /respondWith\(fetch\(event\.request\)\)/);
  assert.doesNotMatch(rootWorkerText, /caches\.open|cache\.put/, 'le service worker ne met aucune donnée en cache');
  const sharedThemeResponse = await fetch(`${base}/brand-theme.css`);
  assert.equal(sharedThemeResponse.status, 200);
  const sharedTheme = await sharedThemeResponse.text();
  for (const color of ['#111111', '#1C1C1C', '#D4AF37', '#F2D675', '#FFFFFF', '#F3F3F3']) {
    assert.ok(sharedTheme.includes(color), `la feuille de thème contient la couleur ${color}`);
  }
  const managerDashboardPage = await fetch(`${base}/manager`);
  assert.equal(managerDashboardPage.status, 200);
  const managerDashboardHtml = await managerDashboardPage.text();
  assert.match(managerDashboardHtml, /Votre espace gestionnaire/, 'la destination du Gestionnaire est accessible sur le même hostname');
  assert.match(managerDashboardHtml, /data-pwa-install/, 'l’espace Gestionnaire expose une action d’installation');
  assert.match(managerDashboardHtml, /pwa-install\.js/, 'le contrôleur PWA est chargé dans l’espace Gestionnaire');
  assert.match(managerDashboardHtml, /brand-theme\.css/, 'le Gestionnaire partage la nouvelle palette de marque');

  let manager1 = await login('/api/manager/auth/login', 'manager.one', password1);
  let manager2 = await login('/api/manager/auth/login', 'manager.two', password2);
  const ambiguousRoleSession = await call('/api/auth/me', { cookie: `${ceo}; ${manager1}` });
  assert.equal(ambiguousRoleSession.data.authenticated, false, 'une session contenant les deux rôles est refusée plutôt que d’accorder le rôle PDG');
  const invalidSharedLogin = await call('/api/auth/login', { method: 'POST', headers: domainHeaders, body: { username: 'manager.one', password: 'wrong-password' } });
  assert.equal(invalidSharedLogin.status, 401);
  assert.match(invalidSharedLogin.data.error, /Identifiant ou mot de passe incorrect/);
  const sharedManager2Login = await call('/api/auth/login', { method: 'POST', headers: domainHeaders, body: { username: 'manager.two', password: password2 } });
  assert.equal(sharedManager2Login.status, 200, JSON.stringify(sharedManager2Login.data));
  assert.equal(sharedManager2Login.data.role, 'manager', 'le backend reconnaît le rôle à partir du compte et du mot de passe');
  assert.match(sharedManager2Login.cookie, /^qria_manager=/);
  assert.ok(sharedManager2Login.cookies.some((value) => /^qria_manager=.*HttpOnly/i.test(value)));
  assert.doesNotMatch(sharedManager2Login.cookies.join(';'), /Domain=/i, 'la session reste limitée à l’hôte courant');
  const sharedManager2Auth = await call('/api/auth/me', { cookie: sharedManager2Login.cookie, headers: domainHeaders });
  assert.equal(sharedManager2Auth.status, 200);
  assert.equal(sharedManager2Auth.data.role, 'manager');
  const sharedManager2AdminAccess = await call('/api/admin/settings', { cookie: sharedManager2Login.cookie, headers: domainHeaders });
  assert.equal(sharedManager2AdminAccess.status, 403, 'la session Gestionnaire ne donne aucun droit PDG');
  const sharedManager2Logout = await call('/api/manager/auth/logout', { cookie: sharedManager2Login.cookie, method: 'POST', headers: domainHeaders });
  assert.equal(sharedManager2Logout.status, 200);
  assert.equal((await call('/api/auth/me', { cookie: sharedManager2Logout.cookie, headers: domainHeaders })).data.authenticated, false);
  const sharedManager2Relogin = await call('/api/auth/login', { method: 'POST', body: { username: 'manager.two', password: password2 } });
  assert.equal(sharedManager2Relogin.status, 200);
  assert.equal(sharedManager2Relogin.data.role, 'manager', 'le Gestionnaire peut se reconnecter sur le lien partagé');
  manager2 = sharedManager2Relogin.cookie;

  const manager1SharedLogin = await call('/api/auth/login', { method: 'POST', body: { username: 'manager.one', password: password1 } });
  assert.equal(manager1SharedLogin.status, 200, JSON.stringify(manager1SharedLogin.data));
  assert.equal(manager1SharedLogin.data.role, 'manager');
  assert.match(manager1SharedLogin.cookie, /^qria_manager=/);
  const customHostMe = await call('/api/auth/me', { cookie: manager1SharedLogin.cookie });
  assert.equal(customHostMe.status, 200, 'la session Gestionnaire survit à une actualisation sur le même lien');
  assert.equal(customHostMe.data.role, 'manager');
  const crossDomainSession = await call('/api/manager/auth/me', { cookie: manager2, headers: domainHeaders });
  assert.equal(crossDomainSession.status, 200, 'l’association personnalisée est ignorée : le second compte peut aussi se connecter sur le même lien');
  assert.equal(crossDomainSession.data.manager.id, manager2Id);
  const domainLogout = await call('/api/manager/auth/logout', { cookie: manager1SharedLogin.cookie, method: 'POST' });
  assert.equal(domainLogout.status, 200);
  assert.equal((await call('/api/auth/me', { cookie: domainLogout.cookie })).data.authenticated, false, 'la déconnexion ferme la session du lien partagé');
  const rootAfterLogout = await fetch(base, { headers: { 'x-forwarded-host': customDomain } });
  assert.match(await rootAfterLogout.text(), /ACCÈS SÉCURISÉ/, 'après déconnexion, le même écran de connexion principal reste disponible');
  manager1 = await login('/api/manager/auth/login', 'manager.one', password1);
  const firstProfile = await call('/api/manager/profile', { cookie: manager1 });
  const secondProfile = await call('/api/manager/profile', { cookie: manager2 });
  assert.equal(firstProfile.status, 200, JSON.stringify(firstProfile.data));
  assert.equal(secondProfile.status, 200, JSON.stringify(secondProfile.data));
  assert.equal(firstProfile.data.data.phone, '+225 05 00 00 02 02');
  assert.equal(firstProfile.data.data.avatarData, managerAvatar, 'la photo personnelle du compte Un reste enregistrée et lui est retournée');
  assert.equal(secondProfile.data.data.avatarData, '', 'la photo du compte Un ne doit pas fuiter au compte Deux');
  const installToken1 = firstProfile.data.data.installPath.split('/').pop();
  const installToken2 = secondProfile.data.data.installPath.split('/').pop();
  assert.notEqual(installToken1, installToken2, 'chaque gestionnaire doit avoir son lien personnel');
  const logo1 = await fetch(`${base}/api/manager/install/${installToken1}/icon`);
  const logo2 = await fetch(`${base}/api/manager/install/${installToken2}/icon`);
  assert.match(logo1.headers.get('content-type'), /image\/png/i);
  assert.match(logo2.headers.get('content-type'), /image\/png/i);
  assert.deepEqual(Buffer.from(await logo1.arrayBuffer()), Buffer.from(await logo2.arrayBuffer()), 'les Gestionnaires partagent le logo QRia comme icône d’application, sans exposer leur photo personnelle');
  const manifest1 = await fetch(`${base}/api/manager/install/${installToken1}/manifest.webmanifest`).then((response) => response.json());
  assert.equal(manifest1.id, `/manager/install/${installToken1}`);
  assert.equal(manifest1.start_url, `/manager/install/${installToken1}`);
  assert.equal(manifest1.scope, '/manager');
  assert.equal(manifest1.theme_color, '#111111');
  assert.equal(manifest1.background_color, '#F3F3F3');
  assert.deepEqual(manifest1.related_applications, [{ platform: 'webapp', id: `/manager/install/${installToken1}` }], 'la PWA personnalisée référence son propre identifiant pour la détection native');
  assert.equal(manifest1.icons[0].src, '/icons/qria-192.png');
  assert.equal(manifest1.icons[0].sizes, '192x192', 'le manifeste Gestionnaire utilise le nouveau logo de marque');
  assert.ok(manifest1.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.ok(manifest1.icons.some((icon) => icon.purpose === 'maskable'));
  assert.equal((await fetch(`${base}/manager/install/${installToken1}`)).status, 200, 'lien d’installation personnel accessible');
  const customInstallHtml = await fetch(`${base}/manager/install/${installToken1}`).then((response) => response.text());
  assert.match(customInstallHtml, new RegExp(`/api/manager/install/${installToken1}/manifest\\.webmanifest`));
  assert.ok(customInstallHtml.includes('src="/icons/qria-192.png"'), 'la connexion personnalisée conserve le logo de marque commun');
  const manager2Manifest = await fetch(`${base}/api/manager/install/${installToken2}/manifest.webmanifest`).then((response) => response.json());
  assert.ok(manager2Manifest.icons.some((icon) => icon.sizes === '192x192' && icon.type === 'image/png'));
  assert.ok(manager2Manifest.icons.some((icon) => icon.sizes === '512x512' && icon.type === 'image/png'));
  assert.ok(manager2Manifest.icons.some((icon) => icon.purpose === 'maskable'));
  const defaultManagerInstallHtml = await fetch(`${base}/manager/install/${installToken2}`).then((response) => response.text());
  assert.ok(defaultManagerInstallHtml.includes('id="managerTouchIcon" rel="apple-touch-icon" href="/icons/qria-180.png"'));
  const forbiddenCrossProfile = await call(`/api/admin/managers/${manager1Id}`, { cookie: manager2 });
  assert.equal(forbiddenCrossProfile.status, 403);
  const selfPhotoChange = await call('/api/manager/profile', { cookie: manager1, method: 'PUT', body: { avatarData: '' } });
  assert.equal(selfPhotoChange.status, 200);
  assert.equal((await call('/api/manager/profile', { cookie: manager1 })).data.data.avatarData, '');
  assert.equal((await call('/api/manager/profile', { cookie: manager2 })).data.data.avatarData, '', 'la modification du profil Un ne touche pas au compte Deux');
  await call('/api/manager/profile', { cookie: manager1, method: 'PUT', body: { avatarData: managerAvatar } });

  const emptyPricing = await call('/api/admin/finance/pricing', { cookie: ceo });
  assert.equal(emptyPricing.status, 200);
  assert.equal(emptyPricing.data.data.length, 0, 'aucun tarif réel ou tarif par défaut ne doit être inventé');
  const createdBene = await call('/api/manager/beneficiaries', { cookie: manager1, method: 'POST', body: benePayload('Bénéficiaire privé du gestionnaire un') });
  assert.equal(createdBene.status, 201, JSON.stringify(createdBene.data));
  const beneficiaryId = createdBene.data.data.id;
  const blockedByMissingPrice = await call('/api/manager/codes', { cookie: manager1, method: 'POST', body: { ...codePayload(beneficiaryId), customerType: 'individual', pricingPlanId: 'absent', optionIds: [] } });
  assert.equal(blockedByMissingPrice.status, 409, 'la création doit être refusée si le PDG n’a pas configuré de tarif');
  const pricing = await call('/api/admin/finance/pricing', { cookie: ceo, method: 'PUT', body: { plans: [{ id: 'test-plan', name: 'Formule de test uniquement', customerType: 'individual', qrPurpose: 'contact', destinationType: 'page', amountXof: 10000, options: [{ id: 'test-option', name: 'Option de test', amountXof: 2000, active: true }], active: true }] } });
  assert.equal(pricing.status, 200, JSON.stringify(pricing.data));
  const createdQr = await call('/api/manager/codes', { cookie: manager1, method: 'POST', body: { ...codePayload(beneficiaryId), customerType: 'individual', pricingPlanId: 'test-plan', optionIds: ['test-option'], clientName: 'Client QR initial' } });
  assert.equal(createdQr.status, 201, JSON.stringify(createdQr.data));
  const qrId = createdQr.data.data.id;
  const orderA = createdQr.data.order;
  assert.ok(orderA.id && orderA.reference);
  assert.equal(orderA.paymentMethod, 'cash');
  assert.equal(orderA.paymentStatus, 'unpaid', 'sélectionner espèces ne marque jamais la commande payée');
  assert.equal(orderA.unitAmountXof, 10000);
  assert.equal(orderA.totalAmountXof, 12000);
  assert.equal(orderA.selectedOptions[0].amountXof, 2000);

  // Scénario 1 : deux comptes réels et isolement des listes/API de données.
  const firstList = await call('/api/manager/codes', { cookie: manager1 });
  const secondList = await call('/api/manager/codes', { cookie: manager2 });
  assert.equal(firstList.data.total, 1);
  assert.equal(firstList.data.data[0].id, qrId);
  assert.equal(secondList.data.total, 0);
  const crossAccess = await call(`/api/manager/codes/${qrId}`, { cookie: manager2 });
  assert.equal(crossAccess.status, 403, 'un gestionnaire ne doit pas lire le QR d’un autre');
  assert.equal((await call(`/api/manager/finance/orders/${orderA.id}`, { cookie: manager2 })).status, 404, 'un gestionnaire ne doit pas lire une commande étrangère');
  assert.equal((await call(`/api/manager/finance/orders/${orderA.id}/cash-payments`, { cookie: manager2, method: 'POST', body: { amountXof: 1, receivedAt: new Date().toISOString(), payerName: 'Intrus' } })).status, 404);
  const initialOrderList = await call('/api/manager/finance/orders', { cookie: manager1 });
  assert.equal(initialOrderList.data.total, 1);
  assert.equal(initialOrderList.data.data[0].paymentStatus, 'unpaid');

  // Les déclarations sont distinctes des encaissements et ne peuvent être validées que par le PDG.
  const firstDeclaration = await call(`/api/manager/finance/orders/${orderA.id}/cash-payments`, { cookie: manager1, method: 'POST', body: { amountXof: 4000, receivedAt: new Date().toISOString(), payerName: 'Payeur test initial' } });
  assert.equal(firstDeclaration.status, 201, JSON.stringify(firstDeclaration.data));
  assert.equal(firstDeclaration.data.data.netReceivedXof, 0);
  assert.equal(firstDeclaration.data.data.pendingAmountXof, 4000);
  assert.equal(firstDeclaration.data.data.outstandingXof, 12000);
  const rejectedPayment = firstDeclaration.data.data.payments.find((payment) => payment.status === 'pending');
  assert.equal(rejectedPayment.clientName, 'Payeur test initial');
  assert.equal((await call(`/api/admin/finance/payments/${rejectedPayment.id}/review`, { cookie: manager1, method: 'POST', body: { decision: 'approve', orderId: orderA.id } })).status, 403, 'le gestionnaire ne peut pas valider sa déclaration');
  const rejection = await call(`/api/admin/finance/payments/${rejectedPayment.id}/review`, { cookie: ceo, method: 'POST', body: { decision: 'reject', reason: 'Montant à revérifier', orderId: orderA.id } });
  assert.equal(rejection.status, 200, JSON.stringify(rejection.data));
  assert.equal(rejection.data.data.paymentStatus, 'unpaid');
  assert.equal(rejection.data.data.pendingAmountXof, 0);
  assert.equal(rejection.data.data.payments.find((payment) => payment.id === rejectedPayment.id).rejectionReason, 'Montant à revérifier');

  const partialDeclaration = await call(`/api/manager/finance/orders/${orderA.id}/cash-payments`, { cookie: manager1, method: 'POST', body: { amountXof: 5000, receivedAt: new Date().toISOString(), payerName: 'Payeur test partiel' } });
  assert.equal(partialDeclaration.status, 201, JSON.stringify(partialDeclaration.data));
  const partialPayment = partialDeclaration.data.data.payments.find((payment) => payment.status === 'pending');
  const partialApproval = await call(`/api/admin/finance/payments/${partialPayment.id}/review`, { cookie: ceo, method: 'POST', body: { decision: 'approve', orderId: orderA.id } });
  assert.equal(partialApproval.status, 200, JSON.stringify(partialApproval.data));
  assert.equal(partialApproval.data.data.paymentStatus, 'partial');
  assert.equal(partialApproval.data.data.netReceivedXof, 5000);
  assert.equal(partialApproval.data.data.outstandingXof, 7000);
  const remainingDeclaration = await call(`/api/manager/finance/orders/${orderA.id}/cash-payments`, { cookie: manager1, method: 'POST', body: { amountXof: 7000, receivedAt: new Date().toISOString(), payerName: 'Payeur test solde' } });
  assert.equal(remainingDeclaration.status, 201, JSON.stringify(remainingDeclaration.data));
  const remainingPayment = remainingDeclaration.data.data.payments.find((payment) => payment.status === 'pending');
  const finalApproval = await call(`/api/admin/finance/payments/${remainingPayment.id}/review`, { cookie: ceo, method: 'POST', body: { decision: 'approve', orderId: orderA.id } });
  assert.equal(finalApproval.status, 200, JSON.stringify(finalApproval.data));
  assert.equal(finalApproval.data.data.paymentStatus, 'paid');
  assert.equal(finalApproval.data.data.netReceivedXof, 12000);
  assert.equal(finalApproval.data.data.outstandingXof, 0);

  // Une mise à jour de tarif ne recalcule jamais les commandes existantes.
  const changedPricing = await call('/api/admin/finance/pricing', { cookie: ceo, method: 'PUT', body: { plans: [{ id: 'test-plan', name: 'Formule de test modifiée', customerType: 'individual', qrPurpose: 'contact', destinationType: 'page', amountXof: 15000, options: [{ id: 'test-option', name: 'Option de test', amountXof: 3000, active: true }], active: true }] } });
  assert.equal(changedPricing.status, 200, JSON.stringify(changedPricing.data));
  const historicOrder = await call(`/api/admin/finance/orders/${orderA.id}`, { cookie: ceo });
  assert.equal(historicOrder.data.data.totalAmountXof, 12000);
  assert.equal(historicOrder.data.data.unitAmountXof, 10000);
  assert.equal(historicOrder.data.data.selectedOptions[0].amountXof, 2000);
  const qrB = await call('/api/manager/codes', { cookie: manager1, method: 'POST', body: { ...codePayload(beneficiaryId, 'QR test impayé après changement de prix'), customerType: 'individual', pricingPlanId: 'test-plan', optionIds: [], clientName: 'Client test impayé' } });
  assert.equal(qrB.status, 201, JSON.stringify(qrB.data));
  const orderB = qrB.data.order;
  assert.equal(orderB.totalAmountXof, 15000);
  assert.equal(orderB.paymentStatus, 'unpaid');
  const qrC = await call('/api/manager/codes', { cookie: manager1, method: 'POST', body: { ...codePayload(beneficiaryId, 'QR test paiement intégral'), customerType: 'individual', pricingPlanId: 'test-plan', optionIds: ['test-option'], clientName: 'Client test intégral' } });
  assert.equal(qrC.status, 201, JSON.stringify(qrC.data));
  const orderC = qrC.data.order;
  assert.equal(orderC.totalAmountXof, 18000);
  const fullDeclaration = await call(`/api/manager/finance/orders/${orderC.id}/cash-payments`, { cookie: manager1, method: 'POST', body: { amountXof: 18000, receivedAt: new Date().toISOString(), payerName: 'Payeur test intégral' } });
  assert.equal(fullDeclaration.status, 201, JSON.stringify(fullDeclaration.data));
  const fullPayment = fullDeclaration.data.data.payments.find((payment) => payment.status === 'pending');
  const fullApproval = await call(`/api/admin/finance/payments/${fullPayment.id}/review`, { cookie: ceo, method: 'POST', body: { decision: 'approve', orderId: orderC.id } });
  assert.equal(fullApproval.data.data.paymentStatus, 'paid');
  assert.equal(fullApproval.data.data.netReceivedXof, 18000);
  const refund = await call(`/api/admin/finance/orders/${orderC.id}/refunds`, { cookie: ceo, method: 'POST', body: { amountXof: 3000, method: 'cash', reason: 'Remboursement partiel de test' } });
  assert.equal(refund.status, 201, JSON.stringify(refund.data));
  assert.equal(refund.data.data.refundedXof, 3000);
  assert.equal(refund.data.data.netReceivedXof, 15000);
  assert.equal(refund.data.data.paymentStatus, 'partial');
  assert.ok(refund.data.data.history.some((event) => event.action === 'refund_recorded'));
  assert.equal((await call(`/api/admin/finance/orders/${orderC.id}/refunds`, { cookie: manager1, method: 'POST', body: { amountXof: 1, reason: 'Intrusion' } })).status, 403);
  const qrD = await call('/api/manager/codes', { cookie: manager1, method: 'POST', body: { ...codePayload(beneficiaryId, 'QR test annulation'), customerType: 'individual', pricingPlanId: 'test-plan', optionIds: [], clientName: 'Client test annulation' } });
  assert.equal(qrD.status, 201, JSON.stringify(qrD.data));
  const orderD = qrD.data.order;
  const cancelled = await call(`/api/admin/finance/orders/${orderD.id}/cancel`, { cookie: ceo, method: 'POST', body: { reason: 'Annulation de test' } });
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.data.orderState, 'cancelled');
  assert.equal(cancelled.data.data.paymentStatus, 'cancelled');
  assert.ok(cancelled.data.data.history.some((event) => event.action === 'order_cancelled'));
  assert.equal((await call(`/api/admin/finance/orders/${orderD.id}/cancel`, { cookie: manager1, method: 'POST', body: { reason: 'Intrusion' } })).status, 403);
  const cancellationAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&search=${encodeURIComponent(orderD.reference)}`, { cookie: ceo });
  assert.ok(cancellationAudit.data.data.some((event) => event.summary.includes('annulée par le PDG')), 'l’annulation doit être auditée avec le lien gestionnaire');
  const correction = await call(`/api/admin/finance/orders/${orderB.id}`, { cookie: ceo, method: 'PATCH', body: { clientName: 'Client test impayé corrigé', totalAmountXof: 16000, reason: 'Correction audit de test' } });
  assert.equal(correction.status, 200, JSON.stringify(correction.data));
  assert.equal(correction.data.data.originalTotalAmountXof, 15000);
  assert.equal(correction.data.data.totalAmountXof, 16000);
  assert.ok(correction.data.data.history.some((event) => event.action === 'order_corrected'));
  const correctionAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&search=${encodeURIComponent(orderB.reference)}`, { cookie: ceo });
  assert.ok(correctionAudit.data.data.some((event) => event.summary.includes('corrigée par le PDG')), 'la correction doit rester dans le journal serveur avec l’acteur PDG');
  const financeDashboard = await call('/api/admin/finance/dashboard', { cookie: ceo });
  assert.deepEqual({ orders: financeDashboard.data.summary.ordersValueXof, gross: financeDashboard.data.summary.grossReceivedXof, refunded: financeDashboard.data.summary.refundedXof, net: financeDashboard.data.summary.netReceivedXof, pending: financeDashboard.data.summary.pendingDeclaredXof, outstanding: financeDashboard.data.summary.outstandingXof, qr: financeDashboard.data.summary.qrSold, cancelled: financeDashboard.data.summary.cancelledCount, partial: financeDashboard.data.summary.partialCount, paid: financeDashboard.data.summary.paidCount, unpaid: financeDashboard.data.summary.unpaidCount }, { orders: 46000, gross: 30000, refunded: 3000, net: 27000, pending: 0, outstanding: 19000, qr: 3, cancelled: 1, partial: 1, paid: 1, unpaid: 1 });
  assert.equal(financeDashboard.data.byManager.find((item) => item.managerId === manager1Id).ordersValueXof, 46000);
  assert.equal(financeDashboard.data.byManager.find((item) => item.managerId === manager1Id).netReceivedXof, 27000);
  const unpaidOrders = await call(`/api/admin/finance/orders?managerId=${manager1Id}&status=unpaid`, { cookie: ceo });
  assert.equal(unpaidOrders.data.total, 1);
  assert.equal(unpaidOrders.data.data[0].id, orderB.id);
  const byClient = await call('/api/admin/finance/orders?client=Client%20QR%20initial', { cookie: ceo });
  assert.equal(byClient.data.total, 1);
  assert.equal(byClient.data.data[0].id, orderA.id);
  const byQr = await call('/api/admin/finance/orders?qr=QR%20test%20impay%C3%A9', { cookie: ceo });
  assert.equal(byQr.data.total, 1);
  assert.equal(byQr.data.data[0].id, orderB.id);
  const byMode = await call('/api/admin/finance/orders?method=cash', { cookie: ceo });
  assert.equal(byMode.data.total, 4);
  const byPeriod = await call('/api/admin/finance/orders?from=2000-01-01&to=2099-12-31', { cookie: ceo });
  assert.equal(byPeriod.data.total, 4);
  const provider = await call('/api/admin/finance/provider-status', { cookie: ceo });
  assert.equal(provider.data.electronic.configured, false);
  assert.equal((await call(`/api/manager/finance/orders/${orderA.id}/electronic-intent`, { cookie: manager1, method: 'POST', body: {} })).status, 503);
  const financeCsv = await fetch(`${base}/api/admin/finance/export.csv?managerId=${manager1Id}`, { headers: { Cookie: ceo, Origin: base } });
  assert.equal(financeCsv.status, 200);
  assert.match(await financeCsv.text(), /reference_commande/);
  const secondManagerOrders = await call('/api/manager/finance/orders', { cookie: manager2 });
  assert.equal(secondManagerOrders.data.total, 0, 'la liste financière d’un autre gestionnaire ne doit pas exposer les ventes');

  const logout = await call('/api/manager/auth/logout', { cookie: manager2, method: 'POST' });
  assert.equal(logout.status, 200);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager2 })).status, 401, 'la déconnexion révoque aussi le cookie serveur');
  manager2 = await login('/api/manager/auth/login', 'manager.two', password2);

  // Scénario 2 : les cookies signés sont liés à leur rôle; leur renommage ne change pas les privilèges.
  assert.equal((await call('/api/admin/settings', { cookie: manager1.replace('qria_manager=', 'qria_admin=') })).status, 401);
  assert.equal((await call('/api/manager/dashboard', { cookie: ceo.replace('qria_admin=', 'qria_manager=') })).status, 401);

  // Toutes les fonctions PDG restent interdites par API directe.
  const forbiddenSettings = await call('/api/admin/settings', { cookie: manager1 });
  const forbiddenManagerCreate = await call('/api/admin/managers', { cookie: manager1, method: 'POST', body: managerPayload('intruder', 'Intrus', password1) });
  const forbiddenManagerReset = await call(`/api/admin/managers/${manager2Id}/reset-password`, { cookie: manager1, method: 'POST', body: { method: 'temporary', adminPassword: password1, confirmUsername: 'manager.two' } });
  const forbiddenSessionRevoke = await call(`/api/admin/managers/${manager2Id}/revoke-sessions`, { cookie: manager1, method: 'POST', body: { adminPassword: password1, confirmUsername: 'manager.two' } });
  const forbiddenManagerStatus = await call(`/api/admin/managers/${manager2Id}/status`, { cookie: manager1, method: 'PATCH', body: { status: 'blocked', adminPassword: password1, confirmUsername: 'manager.two' } });
  const forbiddenManagerDelete = await call(`/api/admin/managers/${manager2Id}`, { cookie: manager1, method: 'DELETE', body: { adminPassword: password1, confirmUsername: 'manager.two' } });
  assert.equal(forbiddenSettings.status, 403);
  assert.equal(forbiddenManagerCreate.status, 403);
  assert.equal(forbiddenManagerReset.status, 403);
  assert.equal(forbiddenSessionRevoke.status, 403);
  assert.equal(forbiddenManagerStatus.status, 403);
  assert.equal(forbiddenManagerDelete.status, 403);
  const managerAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=authorization_denied`, { cookie: ceo });
  assert.ok(managerAudit.data.total >= 2, 'les refus d’accès doivent être journalisés côté serveur');

  // Scénario 3 : seul le PDG réattribue un QR, sans ouvrir le compte du gestionnaire.
  const reassigned = await call(`/api/admin/codes/${qrId}/assignment`, { cookie: ceo, method: 'PATCH', body: { managerId: manager2Id } });
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
  assert.equal(reassigned.data.data.managerId, manager2Id);
  assert.equal((await call(`/api/manager/codes/${qrId}`, { cookie: manager1 })).status, 403);
  assert.equal((await call(`/api/manager/codes/${qrId}`, { cookie: manager2 })).status, 200);

  // Scénario 4 : suspension invalide une session déjà ouverte, après confirmation explicite et réauthentification PDG.
  const suspendWithoutReauth = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Test de suspension', confirmUsername: 'manager.one' } });
  assert.equal(suspendWithoutReauth.status, 403);
  assert.equal((await call('/api/admin/managers', { cookie: ceo })).data.data.find((manager) => manager.id === manager1Id).status, 'active');
  const suspend = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Test de suspension', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(suspend.status, 200);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1 })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'manager.one', password: password1 } })).status, 401, 'le Gestionnaire suspendu est refusé par le lien partagé');
  assert.equal((await call('/api/admin/codes/' + qrId, { cookie: ceo })).status, 200, 'le PDG garde son accès aux QR');
  assert.equal((await call('/api/admin/managers', { cookie: ceo })).data.data.find((m) => m.id === manager1Id).status, 'suspended');

  // Scénario 5 : réactivation possible; le gestionnaire peut se reconnecter avec ses identifiants.
  const reactivate = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active', reason: '', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(reactivate.status, 200);
  manager1 = await login('/api/manager/auth/login', 'manager.one', password1);
  assert.equal((await call('/api/manager/auth/me', { cookie: manager1 })).data.authenticated, true);

  // Scénario 6 : blocage et réactivation suivent la même révocation stricte des sessions.
  const block = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'blocked', reason: 'Blocage de contrôle', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(block.status, 200);
  assert.equal((await call('/api/manager/auth/me', { cookie: manager1 })).status, 401);
  assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: 'manager.one', password: password1 } })).status, 401, 'un compte bloqué ne peut pas se reconnecter via le lien partagé');
  await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active', reason: '', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  manager1 = await login('/api/manager/auth/login', 'manager.one', password1);

  // Réinitialisation temporaire : confirmation du compte + nouvelle authentification PDG, révocation et changement obligatoire.
  const resetWithoutStepUp = await call(`/api/admin/managers/${manager1Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'temporary', confirmUsername: 'manager.one' } });
  assert.equal(resetWithoutStepUp.status, 403, 'une session PDG seule ne suffit pas à réinitialiser un secret');
  const resetWrongTarget = await call(`/api/admin/managers/${manager1Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'temporary', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(resetWrongTarget.status, 400, 'la confirmation doit nommer le compte ciblé');
  const manager1OtherSession = await login('/api/manager/auth/login', 'manager.one', password1);
  const reset = await call(`/api/admin/managers/${manager1Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'temporary', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(reset.status, 200, JSON.stringify(reset.data));
  assert.equal(reset.data.method, 'temporary');
  assert.ok(reset.data.temporaryPassword.length >= 24);
  assert.ok(new Date(reset.data.expiresAt).getTime() > Date.now());
  assert.equal(reset.data.data.mustChangePassword, true);
  assert.equal('passwordHash' in reset.data.data, false);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1 })).status, 401);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1OtherSession })).status, 401);
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.one', password: password1 } })).status, 401);
  const temporaryLogin = await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.one', password: reset.data.temporaryPassword } });
  assert.equal(temporaryLogin.status, 200, JSON.stringify(temporaryLogin.data));
  assert.equal(temporaryLogin.data.manager.mustChangePassword, true);
  const temporarySession = temporaryLogin.cookie;
  const temporaryMainAuth = await call('/api/auth/me', { cookie: temporarySession });
  assert.equal(temporaryMainAuth.status, 200, 'la session Gestionnaire temporaire reste reconnue depuis le lien commun');
  assert.equal(temporaryMainAuth.data.role, 'manager');
  const forcedGate = await call('/api/manager/dashboard', { cookie: temporarySession });
  assert.equal(forcedGate.status, 403);
  assert.equal(forcedGate.data.code, 'PASSWORD_CHANGE_REQUIRED');
  const resetPassword = 'Manager-One-New-Secret-2026!';
  const changedTemporary = await call('/api/manager/auth/change-password', { cookie: temporarySession, method: 'POST', body: { password: resetPassword } });
  assert.equal(changedTemporary.status, 200, JSON.stringify(changedTemporary.data));
  assert.equal(changedTemporary.data.manager.mustChangePassword, false);
  assert.equal((await call('/api/manager/auth/me', { cookie: temporarySession })).status, 401, 'la session temporaire est remplacée après le changement');
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.one', password: reset.data.temporaryPassword } })).status, 401);
  manager1 = await login('/api/manager/auth/login', 'manager.one', resetPassword);

  // Option A : lien de réinitialisation à usage unique; l’ancien mot de passe et toutes les sessions sont invalidés.
  const manager2OtherSession = await login('/api/manager/auth/login', 'manager.two', password2);
  const linkReset = await call(`/api/admin/managers/${manager2Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'link', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(linkReset.status, 200, JSON.stringify(linkReset.data));
  assert.match(linkReset.data.resetPath, /^\/manager\/reset-password#token=/);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager2 })).status, 401);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager2OtherSession })).status, 401);
  const resetToken = decodeURIComponent(linkReset.data.resetPath.split('#token=')[1]);
  assert.equal((await fetch(`${base}/manager/reset-password`)).status, 200);
  const manager2NewPassword = 'Manager-Two-New-Secret-2026!';
  const completeLink = await call('/api/manager/auth/reset-password', { method: 'POST', body: { token: resetToken, password: manager2NewPassword } });
  assert.equal(completeLink.status, 200, JSON.stringify(completeLink.data));
  assert.equal(completeLink.data.authenticated, true);
  manager2 = completeLink.cookie;
  const replayedLink = await call('/api/manager/auth/reset-password', { method: 'POST', body: { token: resetToken, password: manager2NewPassword } });
  assert.equal(replayedLink.status, 410, 'le lien est à usage unique');
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.two', password: password2 } })).status, 401);
  manager2 = await login('/api/manager/auth/login', 'manager.two', manager2NewPassword);

  // Révocation PDG dédiée : confirmation et vérification d’identité, toutes les sessions existantes expirent immédiatement.
  const manager1SecondSession = await login('/api/manager/auth/login', 'manager.one', resetPassword);
  const revoke = await call(`/api/admin/managers/${manager1Id}/revoke-sessions`, { cookie: ceo, method: 'POST', body: { adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.data));
  assert.equal((await call('/api/manager/auth/me', { cookie: manager1 })).status, 401);
  assert.equal((await call('/api/manager/auth/me', { cookie: manager1SecondSession })).status, 401);
  manager1 = await login('/api/manager/auth/login', 'manager.one', resetPassword);
  const resetAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=password_reset`, { cookie: ceo });
  const resetEvent = resetAudit.data.data.find((event) => event.actorType === 'admin' && event.actorId === 'ceo-test');
  assert.ok(resetEvent, 'l’auteur PDG du reset doit être conservé');
  assert.equal(resetEvent.managerId, manager1Id);
  assert.equal(resetEvent.action, 'password_reset');
  assert.equal(resetEvent.result, 'success');
  assert.ok(resetEvent.createdAt);
  const passwordChangeAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=password_change`, { cookie: ceo });
  const passwordChangeEvent = passwordChangeAudit.data.data.find((event) => event.actorType === 'manager' && event.managerId === manager1Id);
  assert.ok(passwordChangeEvent);
  assert.equal(passwordChangeEvent.result, 'success');
  assert.ok(passwordChangeEvent.createdAt);
  const sessionAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=session_revoked`, { cookie: ceo });
  assert.equal(sessionAudit.data.total, 1);
  const deniedStatusAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=status_change&result=failure`, { cookie: ceo });
  assert.ok(deniedStatusAudit.data.data.some((event) => event.actorType === 'admin' && event.metadata?.reason === 'admin_reauthentication_failed' && event.createdAt));

  // Expiration effective du mot de passe temporaire et du lien (TTL raccourci uniquement dans l’environnement de test).
  const shortTemporary = await call(`/api/admin/managers/${manager2Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'temporary', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(shortTemporary.status, 200);
  const shortTemporaryLogin = await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.two', password: shortTemporary.data.temporaryPassword } });
  assert.equal(shortTemporaryLogin.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 5100));
  const expiredTemporarySession = await call('/api/manager/auth/me', { cookie: shortTemporaryLogin.cookie });
  assert.equal(expiredTemporarySession.status, 401);
  assert.equal(expiredTemporarySession.data.code, 'TEMP_PASSWORD_EXPIRED');
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.two', password: shortTemporary.data.temporaryPassword } })).status, 401);

  const expiringLink = await call(`/api/admin/managers/${manager2Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'link', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(expiringLink.status, 200);
  const expiringToken = decodeURIComponent(expiringLink.data.resetPath.split('#token=')[1]);
  await new Promise((resolve) => setTimeout(resolve, 5100));
  const expiredLink = await call('/api/manager/auth/reset-password', { method: 'POST', body: { token: expiringToken, password: 'Manager-Two-Expired-Link-Secret-2026!' } });
  assert.equal(expiredLink.status, 410, 'un lien arrivé à échéance ne peut plus modifier le mot de passe');
  const expiredLinkAudit = await call(`/api/admin/manager-activities?managerId=${manager2Id}&action=password_change&result=failure`, { cookie: ceo });
  assert.ok(expiredLinkAudit.data.data.some((event) => event.metadata?.reason === 'expired_or_invalid_reset_link'));
  const finalManager2Password = 'Manager-Two-Final-Secret-2026!';
  const recoveryLink = await call(`/api/admin/managers/${manager2Id}/reset-password`, { cookie: ceo, method: 'POST', body: { method: 'link', adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(recoveryLink.status, 200);
  const recoveryToken = decodeURIComponent(recoveryLink.data.resetPath.split('#token=')[1]);
  const recoveredManager2 = await call('/api/manager/auth/reset-password', { method: 'POST', body: { token: recoveryToken, password: finalManager2Password } });
  assert.equal(recoveredManager2.status, 200);
  manager2 = recoveredManager2.cookie;
  assert.equal((await call('/api/manager/auth/me', { cookie: manager2 })).status, 200);

  // La liaison personnalisée reste enregistrée, même si tous les comptes utilisent le lien principal.
  const retainedDomainManagers = await call('/api/admin/managers', { cookie: ceo });
  assert.equal(retainedDomainManagers.data.data.find((manager) => manager.id === manager1Id)?.customDomain, customDomain, 'le sous-domaine existant reste conservé en base et n’est pas supprimé par la connexion partagée');
  const manager1AtMainLink = await call('/api/auth/login', { method: 'POST', body: { username: 'manager.one', password: resetPassword } });
  assert.equal(manager1AtMainLink.status, 200);
  assert.equal(manager1AtMainLink.data.role, 'manager');
  manager1 = manager1AtMainLink.cookie;

  // Suppression logique : attribution QR, bénéficiaire et historique sont conservés et réattribuables par le PDG.
  await call(`/api/admin/codes/${qrId}/assignment`, { cookie: ceo, method: 'PATCH', body: { managerId: manager1Id } });
  const deleteWrongTarget = await call(`/api/admin/managers/${manager1Id}`, { cookie: ceo, method: 'DELETE', body: { adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.two' } });
  assert.equal(deleteWrongTarget.status, 400);
  const deleteWithoutReauth = await call(`/api/admin/managers/${manager1Id}`, { cookie: ceo, method: 'DELETE', body: { confirmUsername: 'manager.one' } });
  assert.equal(deleteWithoutReauth.status, 403);
  const deleted = await call(`/api/admin/managers/${manager1Id}`, { cookie: ceo, method: 'DELETE', body: { adminPassword: 'CEO-Strong-Password-2026!', confirmUsername: 'manager.one' } });
  assert.equal(deleted.status, 200, JSON.stringify(deleted.data));
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1 })).status, 401);
  const stillThere = await call(`/api/admin/codes/${qrId}`, { cookie: ceo });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.data.data.beneficiaryId, beneficiaryId);
  const listedManagers = await call('/api/admin/managers', { cookie: ceo });
  const deletedRecord = listedManagers.data.data.find((m) => m.id === manager1Id);
  assert.ok(deletedRecord.deletedAt);
  assert.equal(deletedRecord.qrCount, 4);
  const preservedActivities = await call(`/api/admin/manager-activities?managerId=${manager1Id}`, { cookie: ceo });
  assert.ok(preservedActivities.data.total >= 8);
  const csv = await fetch(`${base}/api/admin/manager-activities/export.csv?managerId=${manager1Id}`, { headers: { Cookie: ceo, Origin: base } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/i);

  const rawStore = await fs.readFile(path.join(tempDir, 'store.json'), 'utf8');
  for (const secret of ['CEO-Strong-Password-2026!', password1, password2, resetPassword, reset.data.temporaryPassword, manager2NewPassword, resetToken, shortTemporary.data.temporaryPassword, expiringToken, recoveryToken, finalManager2Password]) {
    assert.equal(rawStore.includes(secret), false, `plaintext secret must not be persisted: ${secret}`);
  }
  const persisted = JSON.parse(rawStore);
  const managerTwoPersisted = persisted.managers.find((manager) => manager.id === manager2Id);
  assert.match(managerTwoPersisted.passwordHash, /^scrypt\$/);
  assert.equal(managerTwoPersisted.mustChangePassword, false);
  assert.equal(managerTwoPersisted.passwordResetTokenHash, '');
  assert.equal(rawStore.includes('password_reset'), true, 'password reset event should be in audit without storing the new password');
});
