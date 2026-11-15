'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const templates = require('../public/qr-templates');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const turn = () => new Promise((resolve) => setImmediate(resolve));
const categories = [
  { id: 'cat-shops', name: 'Commerces' }, { id: 'cat-businesses', name: 'Entreprises' },
  { id: 'cat-organizations', name: 'Organisations' }, { id: 'cat-individuals', name: 'Particuliers' }, { id: 'cat-other', name: 'Autres' },
];

function makeFakeIndexedDB() {
  const records = new Map();
  const db = {
    objectStoreNames: { contains: (name) => name === 'drafts' },
    createObjectStore() { return {}; },
    close() {},
    transaction() {
      const transaction = {};
      const store = {
        get(key) {
          const request = {};
          queueMicrotask(() => { request.result = records.get(key); request.onsuccess?.(); });
          return request;
        },
        put(value) { records.set(value.key, value); queueMicrotask(() => transaction.oncomplete?.()); },
        delete(key) { records.delete(key); queueMicrotask(() => transaction.oncomplete?.()); },
      };
      transaction.objectStore = () => store;
      return transaction;
    },
  };
  const factory = {
    open() {
      const request = { result: db };
      queueMicrotask(() => { request.onupgradeneeded?.({ target: request }); request.onsuccess?.({ target: request }); });
      return request;
    },
  };
  return { factory, records };
}

function savedRecord(entries, database) {
  const [key, raw] = entries.find(([itemKey]) => itemKey.startsWith('qria-qr-wizard-draft-v2:')) || [];
  if (!key) return null;
  const index = JSON.parse(raw);
  const serialized = index.storage === 'indexeddb' ? database.records.get(key)?.serialized : raw;
  return serialized ? JSON.parse(serialized) : null;
}

function makePage(storageEntries, api, onSaved, indexedDB) {
  const dom = new JSDOM('<!doctype html><html><body><div id="modalRoot" hidden></div></body></html>', {
    url: 'https://qr.oymiketech.example/admin/', runScripts: 'dangerously', pretendToBeVisual: true,
  });
  const { window } = dom;
  for (const [key, value] of storageEntries || []) window.localStorage.setItem(key, value);
  window.QRIA_TEMPLATES = templates;
  window.QRIAProfile = {};
  window.TextDecoder = TextDecoder;
  if (indexedDB) window.indexedDB = indexedDB;
  window.createImageBitmap = async () => ({ width: 900, height: 650, close() {} });
  window.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {}, clearRect() {} });
  window.HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    callback(new window.Blob(['optimized-photo-data'], { type: type || 'image/jpeg' }));
  };
  window.QRIAQRArtwork = { async renderCanvas(canvas) { canvas.width = 240; canvas.height = 240; } };
  window.eval(readPublic('qr-profile-renderer.js'));
  window.eval(readPublic('qr-wizard.js'));
  const modal = window.document.getElementById('modalRoot');
  const opened = window.QRIAQRWizard.open({ role: 'admin', draftScope: 'recovery-test-admin', draftLocalLimit: 1, modalRoot: modal, api, categories, onSaved });
  return { dom, window, modal, opened };
}

function storageEntries(storage) {
  return Array.from({ length: storage.length }, (_, index) => {
    const key = storage.key(index);
    return [key, storage.getItem(key)];
  });
}

async function settle(rounds = 18) {
  for (let index = 0; index < rounds; index += 1) await turn();
}

async function waitFor(predicate, message) {
  for (let index = 0; index < 120; index += 1) {
    await turn();
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error(typeof message === 'function' ? message() : (message || 'Échéance dépassée pendant le scénario de reprise.'));
}

function apiFor(backend) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    const body = init.body ? JSON.parse(init.body) : null;
    backend.calls.push({ url, method, body });
    if (url.includes('/api/public/qr-templates')) return { data: [] };
    if (url.includes('/api/public/design-gallery')) return { data: [] };
    if (url.includes('/beneficiaries?')) return { data: backend.beneficiary ? [backend.beneficiary] : [] };
    if (url.endsWith('/categories')) return { data: categories };
    if (url.endsWith('/beneficiaries') && method === 'POST') {
      const wasCommitted = Boolean(backend.beneficiary);
      backend.beneficiaryPosts.push(body);
      if (!wasCommitted) backend.beneficiary = { ...body, id: 'bene-recovery-001' };
      if (!wasCommitted) throw new TypeError('Failed to fetch after server commit');
      return { data: { ...backend.beneficiary, id: 'bene-recovery-001' }, idempotent: true };
    }
    if (url.endsWith('/beneficiaries/bene-recovery-001') && method === 'GET') return { data: backend.beneficiary };
    if (url.endsWith('/beneficiaries/bene-recovery-001') && method === 'PUT') {
      backend.beneficiary = { ...backend.beneficiary, ...body, id: 'bene-recovery-001' };
      backend.beneficiaryUpdates += 1;
      return { data: backend.beneficiary };
    }
    if (url.endsWith('/codes') && method === 'POST') {
      backend.codePosts.push(body);
      if (!backend.qr) {
        backend.qr = { id: 'qr-recovery-001', publicCode: 'stableRecovery01', beneficiaryId: body.beneficiaryId, name: body.name, status: 'active' };
        backend.qrCommits += 1;
        throw new TypeError('Failed to fetch after QR commit');
      }
      return { data: backend.qr, idempotent: true };
    }
    throw new Error(`API inattendue dans le scénario de reprise : ${method} ${url}`);
  };
}

async function startAndSubmitFirstAttempt(page) {
  const { modal, window } = page;
  await settle();
  modal.querySelector('[data-template-id="restaurant"]').click();
  modal.querySelector('[data-wizard-action="next"]').click();
  await settle();
  modal.querySelector('[data-wizard-action="beneficiary-new"]').click();
  const name = modal.querySelector('[data-profile-field="entityName"]');
  name.value = 'Maquis Awa Reprise';
  name.dispatchEvent(new window.Event('input', { bubbles: true }));
  const phone = modal.querySelector('[data-profile-field="phone"]');
  phone.value = '+2250711223344';
  phone.dispatchEvent(new window.Event('input', { bubbles: true }));

  const input = modal.querySelector('[data-upload-qr-gallery]');
  const images = Array.from({ length: 5 }, (_, index) => new window.File([`photo bytes ${index}`], `menu-maquis-${index + 1}.jpg`, { type: 'image/jpeg' }));
  Object.defineProperty(input, 'files', { configurable: true, value: images });
  input.dispatchEvent(new window.Event('change', { bubbles: true }));
  const uploadStatus = () => input.closest('.wizard-upload-action')?.querySelector('[data-upload-status]');
  await waitFor(() => uploadStatus()?.textContent.includes('optimisées'), () => `Les photos optimisées ne sont pas apparues; statut=${uploadStatus()?.textContent}; erreur=${modal.querySelector('.wizard-error')?.textContent}; fichiers=${input.files?.length}`);
  assert.equal(modal.querySelectorAll('.wizard-gallery-card').length, 5);

  modal.querySelector('[data-wizard-action="next"]').click();
  await settle();
  modal.querySelector('[data-wizard-action="next"]').click();
  await settle();
  assert.match(modal.querySelector('.wizard-progress-step.is-active')?.textContent || '', /Aperçu/);
  modal.querySelector('#wizardConfirmPublish').checked = true;
  modal.querySelector('[data-wizard-action="publish"]').click();
  await waitFor(() => modal.querySelector('.wizard-error')?.textContent.includes('Connexion interrompue'), 'La coupure simulée du bénéficiaire n’a pas été traitée.');
}

test('brouillon QR : champs, étape, photos et clé idempotente survivent à deux rechargements simulés', async () => {
  const backend = { calls: [], beneficiary: null, beneficiaryPosts: [], beneficiaryUpdates: 0, codePosts: [], qr: null, qrCommits: 0 };
  const api = apiFor(backend);
  const database = makeFakeIndexedDB();
  let first = makePage([], api, null, database.factory);
  await startAndSubmitFirstAttempt(first);

  let entries = storageEntries(first.window.localStorage);
  assert.equal(entries.length, 1, 'un seul index de brouillon local est présent');
  assert.equal(JSON.parse(entries[0][1]).storage, 'indexeddb', 'le stockage IndexedDB est utilisé lorsque le seuil localStorage est dépassé');
  let draftRecord = savedRecord(entries, database);
  assert.equal(draftRecord.version, 2);
  assert.equal(draftRecord.draft.profileData.entityName, 'Maquis Awa Reprise');
  assert.equal(draftRecord.draft.step, 4);
  assert.equal(draftRecord.draft.pendingRetry, true);
  assert.equal(draftRecord.draft.photos.length, 5);
  assert.match(draftRecord.draft.photos[0].src, /^data:image\/jpeg;base64,/);
  assert.ok(JSON.stringify(draftRecord).length > 1, 'le brouillon dépasse le seuil IndexedDB configuré pour le test');
  const firstClientRequestId = draftRecord.draft.clientRequestId;
  assert.equal(backend.beneficiaryPosts.length, 1);
  assert.equal(backend.codePosts.length, 0);

  first.opened.close();
  await settle();
  first.dom.window.close();

  let secondSaved = null;
  let second = makePage(entries, api, (result) => { secondSaved = result; }, database.factory);
  await settle();
  assert.match(second.modal.querySelector('.wizard-draft-recovery')?.textContent || '', /demande QR interrompue est protégée/);
  assert.match(second.modal.querySelector('.wizard-progress-step.is-active')?.textContent || '', /Aperçu/);
  assert.equal(second.modal.querySelector('[data-wizard-action="publish"]').disabled, false);
  second.modal.querySelector('#wizardConfirmPublish').checked = true;
  second.modal.querySelector('[data-wizard-action="publish"]').click();
  await waitFor(() => second.modal.querySelector('.wizard-error')?.textContent.includes('Connexion interrompue'), 'La coupure simulée du QR n’a pas été traitée.');
  assert.equal(backend.beneficiaryPosts.length, 2, 'la même requête bénéficiaire est rejouée avec idempotence');
  assert.equal(backend.beneficiaryUpdates, 1, 'le bénéficiaire déjà créé est réconcilié sans doublon');
  assert.equal(backend.codePosts.length, 1);
  assert.equal(backend.qrCommits, 1, 'le serveur simulé n’a enregistré qu’un QR malgré la réponse perdue');
  assert.equal(backend.beneficiaryPosts[0].clientRequestId, backend.beneficiaryPosts[1].clientRequestId);
  assert.equal(backend.beneficiaryPosts[0].clientRequestId, firstClientRequestId);
  assert.equal(backend.codePosts[0].clientRequestId, firstClientRequestId);
  assert.equal(backend.codePosts[0].photos.length, 5, 'les cinq photos optimisées sont incluses dans la soumission après reprise');
  assert.match(backend.codePosts[0].profileData.entityName, /Maquis Awa Reprise/);

  entries = storageEntries(second.window.localStorage);
  draftRecord = savedRecord(entries, database);
  assert.equal(draftRecord.draft.createdBeneficiaryId, 'bene-recovery-001');
  assert.equal(draftRecord.draft.pendingRetry, true);
  second.opened.close();
  await settle();
  second.dom.window.close();

  let finalSaved = null;
  const third = makePage(entries, api, (result) => { finalSaved = result; }, database.factory);
  await settle();
  assert.equal(third.modal.querySelectorAll('.wizard-gallery-card').length, 0, 'à l’étape finale la photo reste dans l’aperçu, pas dans l’éditeur de galerie');
  assert.ok(third.modal.textContent.includes('Maquis Awa Reprise'));
  assert.equal(third.modal.querySelector('[data-wizard-action="publish"]').disabled, false);
  third.modal.querySelector('#wizardConfirmPublish').checked = true;
  third.modal.querySelector('[data-wizard-action="publish"]').click();
  await waitFor(() => third.modal.hidden, 'Le QR idempotent n’a pas été confirmé après la seconde reprise.');

  assert.equal(backend.beneficiaryPosts.length, 2, 'la reprise finale n’ajoute aucun bénéficiaire');
  assert.equal(backend.codePosts.length, 2, 'la clé client est rejouée pour récupérer le même QR');
  assert.equal(backend.qrCommits, 1, 'un seul QR a été créé côté serveur simulé');
  assert.equal(backend.codePosts[1].clientRequestId, backend.codePosts[0].clientRequestId);
  assert.deepEqual(backend.codePosts[1], backend.codePosts[0], 'le corps rejoué est identique à celui dont la réponse a été perdue');
  assert.equal(finalSaved?.idempotent, true);
  assert.equal(finalSaved?.data?.publicCode, 'stableRecovery01');
  assert.equal(finalSaved?.data?.beneficiaryId, 'bene-recovery-001');
  assert.ok(storageEntries(third.window.localStorage).every(([key, value]) => !key.startsWith('qria-qr-wizard-draft-v2:') || JSON.parse(value).storage === 'deleted'), 'le brouillon est retiré après confirmation; seul un tombstone local peut rester');
  third.dom.window.close();
});
