'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../store');

test('JSON local corrompu : le démarrage échoue sans remplacer ni supprimer le fichier original', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qria-corrupt-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'store.json');
  const original = '{"beneficiaries":[{"id":"bene-not-recoverable-yet","name":"Boutique historique"}],"qrCodes":[';
  await fs.writeFile(filePath, original, 'utf8');

  const store = createStore({ filePath });
  await assert.rejects(store.init(), (error) => {
    assert.equal(error.code, 'JSON_STORE_INVALID');
    assert.match(error.message, /conservé sans modification/);
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });

  assert.equal(await fs.readFile(filePath, 'utf8'), original, 'le contenu récupérable est préservé octet pour octet');
  assert.deepEqual(await fs.readdir(directory), ['store.json'], 'aucun état vide ou fichier temporaire n’est écrit');
  assert.equal(store.state, null, 'l’application ne continue pas avec un magasin vide en mémoire');
});

test('JSON local absent : le magasin est initialisé comme avant', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'qria-missing-store-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'store.json');
  const store = createStore({ filePath });

  await store.init();

  assert.deepEqual(store.state.beneficiaries, []);
  assert.deepEqual(store.state.qrCodes, []);
  assert.ok(store.state.categories.some((row) => row.id === 'cat-shops'));
  assert.deepEqual(JSON.parse(await fs.readFile(filePath, 'utf8')).beneficiaries, []);
});
