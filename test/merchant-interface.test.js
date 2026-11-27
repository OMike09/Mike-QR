'use strict';
// Mission 10 — réglages de présentation : bornes, héritage, et surtout AUCUNE permission touchée.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const iface = require('../merchant-interface');

const root = path.resolve(__dirname, '..');

test('tailles : 8 catégories, plage 14–30 px, valeurs initiales confortables', () => {
  assert.equal(iface.TEXT_KEYS.length, 8);
  assert.equal(iface.MIN_SIZE, 14);
  assert.equal(iface.MAX_SIZE, 30);
  const defaults = iface.defaultSizes();
  assert.equal(defaults.text, 16, 'le texte courant part de 16 px');
  assert.equal(defaults.title, 24);
  for (const size of Object.values(defaults)) assert.ok(size >= 14 && size <= 30);
});

test('les valeurs hors plage sont bornées et les clés inconnues ignorées', () => {
  const sizes = iface.normalizeSizes({ title: 99, text: 2, price: '21', inconnu: 50 });
  assert.equal(sizes.title, 30);
  assert.equal(sizes.text, 14);
  assert.equal(sizes.price, 21);
  assert.equal(Object.hasOwn(sizes, 'inconnu'), false);
});

test('une exception d’établissement hérite de la valeur globale', () => {
  const settings = iface.normalizeSettings({ global: { title: 28, text: 18 }, stores: { 'store-abc123': { title: 30 } } });
  const resolved = iface.resolveSettings(settings, 'store-abc123');
  assert.equal(resolved.source, 'store');
  assert.equal(resolved.sizes.title, 30);
  assert.equal(resolved.sizes.text, 18, 'la taille non modifiée vient du global');
  const other = iface.resolveSettings(settings, 'store-zzz999');
  assert.equal(other.source, 'global');
  assert.equal(other.sizes.title, 28);
});

test('les variables CSS générées ne contiennent que des tailles en pixels', () => {
  const css = iface.toCssVars({ title: 28, text: 18 });
  assert.match(css, /--ws-title:28px/);
  assert.match(css, /--ws-text:18px/);
  assert.doesNotMatch(css, /permission|role|access/i);
});

test('le réglage ne touche ni aux rôles ni aux permissions', () => {
  // Mission 11 : `appearance` (thème d'affichage) rejoint les tailles, mais reste une préférence
  // visuelle : le test continue d'interdire toute clé de rôle, de permission ou d'accès.
  const fields = Object.keys(iface.normalizeSettings({ global: {}, stores: {} }));
  assert.deepEqual(fields.sort(), ['appearance', 'global', 'stores', 'updatedAt', 'updatedBy']);
  for (const forbidden of ['permissions', 'roles', 'access', 'members']) assert.equal(fields.includes(forbidden), false);
});

test('la page marchand et l’espace équipe appliquent les tailles reçues du serveur', () => {
  const merchant = fs.readFileSync(path.join(root, 'public/merchant.js'), 'utf8');
  const staff = fs.readFileSync(path.join(root, 'public/staff.js'), 'utf8');
  const workspace = fs.readFileSync(path.join(root, 'public/workspace.css'), 'utf8');
  assert.match(merchant, /interfaceSizes/);
  assert.match(staff, /interfaceSizes/);
  for (const variable of ['--ws-title', '--ws-text', '--ws-price', '--ws-button', '--ws-order-info']) {
    assert.ok(workspace.includes(variable), `la variable ${variable} est utilisée dans la feuille de style`);
  }
  // Aucune taille ne peut déborder : les tailles sont plafonnées par min() dans la feuille.
  assert.match(workspace, /min\(var\(--ws-(title|text|price|product-name|button)/);
});
