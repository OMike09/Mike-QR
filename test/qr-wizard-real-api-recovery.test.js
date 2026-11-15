'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { JSDOM } = require('jsdom');
const templates = require('../public/qr-templates');

const projectDir = path.resolve(__dirname, '..');
const readPublic = (name) => require('node:fs').readFileSync(path.join(projectDir, 'public', name), 'utf8');
const turn = () => new Promise((resolve) => setImmediate(resolve));
const validJpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAoHBwgHBgoICAgLCgoLDhgQDg0NDh0VFhEYIx8lJCIfIiEmKzcvJik0KSEiMEExNDk7Pj4+JS5ESUM8SDc9Pjv/2wBDAQoLCw4NDhwQEBw7KCIoOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozv/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDlaKKK+dP2Y//Z', 'base64');

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

async function waitForServer(child, base) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Le serveur local s’est arrêté (${child.exitCode}).`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch (_) { /* The test server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Le serveur local n’a pas démarré dans le délai prévu.');
}

function makePage(base, cookie, storageEntries, api, onSaved) {
  const dom = new JSDOM('<!doctype html><html><body><div id="modalRoot" hidden></div></body></html>', {
    url: 'https://qr.oymiketech.example/admin/', runScripts: 'dangerously', pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const [key, value] of storageEntries || []) window.localStorage.setItem(key, value);
  window.QRIA_TEMPLATES = templates;
  window.QRIAProfile = {};
  window.TextDecoder = TextDecoder;
  window.createImageBitmap = async () => ({ width: 800, height: 600, close() {} });
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, clearRect() {} });
  window.HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    callback(new window.Blob([validJpeg], { type: type || 'image/jpeg' }));
  };
  window.QRIAQRArtwork = { async renderCanvas(canvas) { canvas.width = 240; canvas.height = 240; } };
  window.eval(readPublic('qr-profile-renderer.js'));
  window.eval(readPublic('qr-wizard.js'));
  const modal = window.document.getElementById('modalRoot');
  const opened = window.QRIAQRWizard.open({ role: 'admin', draftScope: 'real-api-recovery-admin', modalRoot: modal, api, onSaved });
  return { dom, window, modal, opened };
}

function getStorageEntries(storage) {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return [key, storage.getItem(key)];
  });
}

async function settle(rounds = 20) {
  for (let index = 0; index < rounds; index += 1) await turn();
}

async function waitFor(predicate, message) {
  for (let index = 0; index < 120; index += 1) {
    await turn();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(typeof message === 'function' ? message() : message);
}

async function loginAsAdmin(base) {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'recovery-admin', password: 'Recovery-Admin-2026-Strong!' }),
  });
  const data = await response.json().catch(() => ({}));
  assert.equal(response.status, 200, JSON.stringify(data));
  const cookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  const cookie = cookies.map((value) => value.split(';')[0]).find((value) => value.startsWith('qria_admin='));
  assert.ok(cookie, 'le cookie de session PDG est établi');
  return cookie;
}

async function prepareDraft(page) {
  const { modal, window } = page;
  await waitFor(() => modal.querySelector('[data-template-id="restaurant"]'), `Le modèle restaurant n’a pas été rendu. ${modal.textContent}`);
  modal.querySelector('[data-template-id="restaurant"]').click();
  modal.querySelector('[data-wizard-action="next"]').click();
  await settle();
  modal.querySelector('[data-wizard-action="beneficiary-new"]').click();
  const name = modal.querySelector('[data-profile-field="entityName"]');
  name.value = 'Maquis Réel Local'; name.dispatchEvent(new window.Event('input', { bubbles: true }));
  const phone = modal.querySelector('[data-profile-field="phone"]');
  phone.value = '+2250711223344'; phone.dispatchEvent(new window.Event('input', { bubbles: true }));

  const input = modal.querySelector('[data-upload-qr-gallery]');
  Object.defineProperty(input, 'files', { configurable: true, value: [new window.File(['small photo'], 'maquis.jpg', { type: 'image/jpeg' })] });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  const uploadStatus = () => input.closest('.wizard-upload-action')?.querySelector('[data-upload-status]');
  await waitFor(() => uploadStatus()?.textContent.includes('optimisée'), 'La photo locale n’a pas été optimisée.');

  modal.querySelector('[data-wizard-action="next"]').click(); await settle();
  modal.querySelector('[data-wizard-action="next"]').click(); await settle();
  assert.match(modal.querySelector('.wizard-progress-step.is-active')?.textContent || '', /Aperçu/);
}

test('workflow QR contre le vrai serveur local : pertes de réponse rejouées sans doublon après rechargement', { timeout: 60000 }, async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qria-real-recovery-'));
  const filePath = path.join(directory, 'store.json');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, {
    NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: filePath, PUBLIC_BASE_URL: base,
    ADMIN_USERNAME: 'recovery-admin', ADMIN_PASSWORD: 'Recovery-Admin-2026-Strong!',
    SESSION_SECRET: 'test-only-recovery-session-secret-long-enough-2026',
  });
  const child = spawn(process.execPath, ['server.js'], { cwd: projectDir, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let serverOutput = '';
  child.stdout.on('data', (chunk) => { serverOutput += chunk.toString(); });
  child.stderr.on('data', (chunk) => { serverOutput += chunk.toString(); });
  t.after(async () => {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        new Promise((resolve) => child.once('exit', resolve)),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);
    }
    await fs.rm(directory, { recursive: true, force: true });
  });

  try { await waitForServer(child, base); }
  catch (error) { throw new Error(`${error.message}\n${serverOutput}`); }
  const cookie = await loginAsAdmin(base);
  let dropBeneficiaryResponse = true;
  let dropQrResponse = true;
  const calls = [];
  const api = async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    const headers = { Origin: base, Cookie: cookie };
    if (init.body) headers['Content-Type'] = 'application/json';
    const response = await fetch(`${base}${url}`, { method, headers, body: init.body });
    const result = await response.json().catch(() => ({}));
    calls.push({ url, method, body, status: response.status, result });
    if (!response.ok) {
      const error = new Error(result.error || `Erreur ${response.status}`);
      error.status = response.status;
      throw error;
    }
    // The Express route and JSON store have committed. The client adapter intentionally drops
    // the successful response to exercise the real server-side idempotency/recovery path.
    if (url.endsWith('/beneficiaries') && method === 'POST' && dropBeneficiaryResponse) {
      dropBeneficiaryResponse = false;
      throw new TypeError('Failed to fetch after the real server committed the beneficiary');
    }
    if (url.endsWith('/codes') && method === 'POST' && dropQrResponse) {
      dropQrResponse = false;
      throw new TypeError('Failed to fetch after the real server committed the QR');
    }
    return result;
  };

  let first = makePage(base, cookie, [], api);
  await prepareDraft(first);
  first.modal.querySelector('#wizardConfirmPublish').checked = true;
  first.modal.querySelector('[data-wizard-action="publish"]').click();
  await waitFor(() => first.modal.querySelector('.wizard-error')?.textContent.includes('Connexion interrompue'), 'La perte simulée de réponse bénéficiaire n’a pas été gérée.');
  assert.equal(calls.filter((call) => call.url.endsWith('/beneficiaries') && call.method === 'POST').length, 1);
  assert.equal(calls.filter((call) => call.url.endsWith('/codes') && call.method === 'POST').length, 0);
  let entries = getStorageEntries(first.window.localStorage);
  assert.equal(entries.length, 1);
  first.opened.close(); await settle(); first.dom.window.close();

  let second = makePage(base, cookie, entries, api);
  await waitFor(() => second.modal.querySelector('.wizard-draft-recovery'), () => `Le brouillon n’a pas été restauré : ${second.modal.textContent}; clés=${JSON.stringify(entries.map(([key]) => key))}`);
  assert.match(second.modal.querySelector('.wizard-draft-recovery')?.textContent || '', /demande QR interrompue est protégée/);
  second.modal.querySelector('#wizardConfirmPublish').checked = true;
  second.modal.querySelector('[data-wizard-action="publish"]').click();
  await waitFor(() => second.modal.querySelector('.wizard-error')?.textContent.includes('Connexion interrompue'), () => `La perte simulée de réponse QR n’a pas été gérée : erreur=${second.modal.querySelector('.wizard-error')?.textContent}; appels=${JSON.stringify(calls.slice(-6).map(({ url, method, status, result }) => ({ url, method, status, error: result?.error, idempotent: result?.idempotent })))}; serveur=${serverOutput}`);
  assert.equal(calls.filter((call) => call.url.endsWith('/beneficiaries') && call.method === 'POST').length, 2);
  assert.equal(calls.filter((call) => call.url.endsWith('/codes') && call.method === 'POST').length, 1);
  entries = getStorageEntries(second.window.localStorage);
  second.opened.close(); await settle(); second.dom.window.close();

  let saved = null;
  const third = makePage(base, cookie, entries, api, (result) => { saved = result; });
  await waitFor(() => third.modal.querySelector('.wizard-draft-recovery'), () => `Le brouillon interrompu n’a pas été restauré à la troisième ouverture : ${third.modal.textContent}`);
  assert.match(third.modal.querySelector('.wizard-draft-recovery')?.textContent || '', /demande QR interrompue est protégée/);
  third.modal.querySelector('#wizardConfirmPublish').checked = true;
  third.modal.querySelector('[data-wizard-action="publish"]').click();
  await waitFor(() => third.modal.hidden, 'Le serveur n’a pas confirmé la reprise idempotente du QR.');

  const beneficiaryRequests = calls.filter((call) => call.url.endsWith('/beneficiaries') && call.method === 'POST');
  const qrRequests = calls.filter((call) => call.url.endsWith('/codes') && call.method === 'POST');
  assert.equal(beneficiaryRequests[0].result.data.id, beneficiaryRequests[1].result.data.id);
  assert.equal(beneficiaryRequests[1].result.idempotent, true);
  assert.equal(qrRequests[0].result.data.id, qrRequests[1].result.data.id);
  assert.equal(qrRequests[1].result.idempotent, true);
  assert.equal(beneficiaryRequests[0].body.clientRequestId, beneficiaryRequests[1].body.clientRequestId);
  assert.equal(beneficiaryRequests[0].body.clientRequestId, qrRequests[0].body.clientRequestId);
  assert.equal(qrRequests[0].body.clientRequestId, qrRequests[1].body.clientRequestId);
  assert.equal(qrRequests[0].body.photos.length, 1);
  assert.equal(saved?.idempotent, true);

  const store = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(store.beneficiaries.length, 1, 'le stockage JSON local contient un seul bénéficiaire');
  assert.equal(store.qrCodes.length, 1, 'le stockage JSON local contient un seul QR');
  const qr = store.qrCodes[0];
  assert.equal(qr.beneficiaryId, store.beneficiaries[0].id);
  const publicCheckResponse = await fetch(`${base}/api/public/qr/${encodeURIComponent(qr.publicCode)}/check`);
  assert.equal(publicCheckResponse.status, 200);
  const publicCheck = await publicCheckResponse.json();
  assert.equal(publicCheck.data.publicUrl, `${base}/r/${encodeURIComponent(qr.publicCode)}`);
  assert.equal((await fetch(`${base}/api/public/qr/${encodeURIComponent(qr.publicCode)}`)).status, 200);
  assert.equal((await fetch(`${base}/r/${encodeURIComponent(qr.publicCode)}`)).status, 200);
  third.dom.window.close();
});
