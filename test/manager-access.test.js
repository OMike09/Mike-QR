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
  const setCookie = response.headers.get('set-cookie');
  return { response, status: response.status, data: json, cookie: setCookie ? setCookie.split(';')[0] : cookie };
}
async function login(url, username, password) {
  const result = await call(url, { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.cookie.includes('='), 'session cookie was not issued');
  return result.cookie;
}
const managerPayload = (username, displayName, password) => ({ username, displayName, email: `${username}@example.ci`, password });
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

  const ceo = await login('/api/auth/login', 'ceo-test', 'CEO-Strong-Password-2026!');
  const password1 = 'Manager-One-Secret-2026!';
  const password2 = 'Manager-Two-Secret-2026!';
  const firstCreated = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('manager.one', 'Gestionnaire Un', password1) });
  const secondCreated = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('manager.two', 'Gestionnaire Deux', password2) });
  assert.equal(firstCreated.status, 201, JSON.stringify(firstCreated.data));
  assert.equal(secondCreated.status, 201, JSON.stringify(secondCreated.data));
  const manager1Id = firstCreated.data.data.id;
  const manager2Id = secondCreated.data.data.id;
  assert.ok(manager1Id && manager2Id && manager1Id !== manager2Id);
  assert.equal('passwordHash' in firstCreated.data.data, false, 'password hash must never be returned');

  let manager1 = await login('/api/manager/auth/login', 'manager.one', password1);
  let manager2 = await login('/api/manager/auth/login', 'manager.two', password2);
  const createdBene = await call('/api/manager/beneficiaries', { cookie: manager1, method: 'POST', body: benePayload('Bénéficiaire privé du gestionnaire un') });
  assert.equal(createdBene.status, 201, JSON.stringify(createdBene.data));
  const beneficiaryId = createdBene.data.data.id;
  const createdQr = await call('/api/manager/codes', { cookie: manager1, method: 'POST', body: codePayload(beneficiaryId) });
  assert.equal(createdQr.status, 201, JSON.stringify(createdQr.data));
  const qrId = createdQr.data.data.id;

  // Scénario 1 : deux comptes réels et isolement des listes/API de données.
  const firstList = await call('/api/manager/codes', { cookie: manager1 });
  const secondList = await call('/api/manager/codes', { cookie: manager2 });
  assert.equal(firstList.data.total, 1);
  assert.equal(firstList.data.data[0].id, qrId);
  assert.equal(secondList.data.total, 0);
  const crossAccess = await call(`/api/manager/codes/${qrId}`, { cookie: manager2 });
  assert.equal(crossAccess.status, 403, 'un gestionnaire ne doit pas lire le QR d’un autre');
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
  assert.equal(forbiddenSettings.status, 403);
  assert.equal(forbiddenManagerCreate.status, 403);
  const managerAudit = await call(`/api/admin/manager-activities?managerId=${manager1Id}&action=authorization_denied`, { cookie: ceo });
  assert.ok(managerAudit.data.total >= 2, 'les refus d’accès doivent être journalisés côté serveur');

  // Scénario 3 : seul le PDG réattribue un QR, sans ouvrir le compte du gestionnaire.
  const reassigned = await call(`/api/admin/codes/${qrId}/assignment`, { cookie: ceo, method: 'PATCH', body: { managerId: manager2Id } });
  assert.equal(reassigned.status, 200, JSON.stringify(reassigned.data));
  assert.equal(reassigned.data.data.managerId, manager2Id);
  assert.equal((await call(`/api/manager/codes/${qrId}`, { cookie: manager1 })).status, 403);
  assert.equal((await call(`/api/manager/codes/${qrId}`, { cookie: manager2 })).status, 200);

  // Scénario 4 : suspension invalide une session déjà ouverte, sans toucher aux QR ni aux scans.
  const suspend = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Test de suspension' } });
  assert.equal(suspend.status, 200);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1 })).status, 401);
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.one', password: password1 } })).status, 401);
  assert.equal((await call('/api/admin/codes/' + qrId, { cookie: ceo })).status, 200, 'le PDG garde son accès aux QR');
  assert.equal((await call('/api/admin/managers', { cookie: ceo })).data.data.find((m) => m.id === manager1Id).status, 'suspended');

  // Scénario 5 : réactivation possible; le gestionnaire peut se reconnecter avec ses identifiants.
  const reactivate = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active', reason: '' } });
  assert.equal(reactivate.status, 200);
  manager1 = await login('/api/manager/auth/login', 'manager.one', password1);
  assert.equal((await call('/api/manager/auth/me', { cookie: manager1 })).data.authenticated, true);

  // Scénario 6 : blocage et réactivation suivent la même révocation stricte des sessions.
  const block = await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'blocked', reason: 'Blocage de contrôle' } });
  assert.equal(block.status, 200);
  assert.equal((await call('/api/manager/auth/me', { cookie: manager1 })).status, 401);
  await call(`/api/admin/managers/${manager1Id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active', reason: '' } });
  manager1 = await login('/api/manager/auth/login', 'manager.one', password1);

  // Une réinitialisation de mot de passe révoque également les sessions et n’inscrit jamais le secret au journal.
  const resetPassword = 'Manager-One-New-Secret-2026!';
  const reset = await call(`/api/admin/managers/${manager1Id}/reset-password`, { cookie: ceo, method: 'POST', body: { password: resetPassword } });
  assert.equal(reset.status, 200);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1 })).status, 401);
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'manager.one', password: password1 } })).status, 401);
  manager1 = await login('/api/manager/auth/login', 'manager.one', resetPassword);

  // Suppression logique : attribution QR, bénéficiaire et historique sont conservés et réattribuables par le PDG.
  await call(`/api/admin/codes/${qrId}/assignment`, { cookie: ceo, method: 'PATCH', body: { managerId: manager1Id } });
  const deleted = await call(`/api/admin/managers/${manager1Id}`, { cookie: ceo, method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.equal((await call('/api/manager/dashboard', { cookie: manager1 })).status, 401);
  const stillThere = await call(`/api/admin/codes/${qrId}`, { cookie: ceo });
  assert.equal(stillThere.status, 200);
  assert.equal(stillThere.data.data.beneficiaryId, beneficiaryId);
  const listedManagers = await call('/api/admin/managers', { cookie: ceo });
  const deletedRecord = listedManagers.data.data.find((m) => m.id === manager1Id);
  assert.ok(deletedRecord.deletedAt);
  assert.equal(deletedRecord.qrCount, 1);
  const preservedActivities = await call(`/api/admin/manager-activities?managerId=${manager1Id}`, { cookie: ceo });
  assert.ok(preservedActivities.data.total >= 8);
  const csv = await fetch(`${base}/api/admin/manager-activities/export.csv?managerId=${manager1Id}`, { headers: { Cookie: ceo, Origin: base } });
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type'), /text\/csv/i);

  const rawStore = await fs.readFile(path.join(tempDir, 'store.json'), 'utf8');
  for (const secret of ['CEO-Strong-Password-2026!', password1, password2, resetPassword]) {
    assert.equal(rawStore.includes(secret), false, `plaintext secret must not be persisted: ${secret}`);
  }
  assert.equal(rawStore.includes('password_reset'), true, 'password reset event should be in audit without storing the new password');
});
