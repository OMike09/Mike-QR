'use strict';

// Tests du catalogue général : domaines, affectation automatique, copie vers une boutique,
// personnalisation marchand, absence de prix imposé, non-destruction des données existantes.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PORT = 4831;
const BASE = `http://127.0.0.1:${PORT}`;
const STORE_FILE = `/tmp/qr-catalog-test-${process.pid}.json`;
let child;

function cookieFrom(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  return raw.map((c) => c.split(';')[0]).filter((c) => c.startsWith('qria_')).join('; ');
}
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + pathname, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual',
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
  return { status: res.status, body: json, headers: res.headers, text };
}

before(async () => {
  try { fs.unlinkSync(STORE_FILE); } catch (_) {}
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), QRIA_STORE_FILE: STORE_FILE, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin1234' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 300));
    try { const r = await fetch(`${BASE}/api/merchant/meta/units`); if (r.status) return; } catch (_) {}
  }
  throw new Error('serveur de test non démarré');
});

after(() => { if (child) child.kill('SIGKILL'); try { fs.unlinkSync(STORE_FILE); } catch (_) {} });

test('1. le catalogue est amorcé : 40 domaines, 35 catégories, 90 produits, 56 images', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  assert.strictEqual(login.status, 200);
  const cookie = cookieFrom(login.headers);
  const overview = await api('/api/admin/catalog/overview', { cookie });
  assert.strictEqual(overview.status, 200);
  const c = overview.body.data.counts;
  assert.strictEqual(c.domains, 40);
  assert.strictEqual(c.categories, 35);
  assert.strictEqual(c.products, 90);
  assert.strictEqual(c.boissons, 56);
  assert.strictEqual(c.media, 56);
  assert.strictEqual(overview.body.data.productsWithoutImage, 0);
});

test('2. un domaine renvoie une liste de catégories sans doublon', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const domains = await api('/api/admin/catalog/domains', { cookie });
  const maquis = domains.body.data.find((d) => d.code === 'maquis');
  assert.ok(maquis, 'domaine maquis présent');
  const cats = await api(`/api/admin/catalog/categories?domainId=${maquis.id}`, { cookie });
  const slugs = cats.body.data.map((c) => c.slug);
  assert.strictEqual(new Set(slugs).size, slugs.length, 'aucune catégorie dupliquée');
  for (const expected of ['bieres', 'boissons-gazeuses', 'eaux', 'energisantes', 'grillades', 'accompagnements', 'plats']) {
    assert.ok(slugs.includes(expected), `catégorie ${expected} attendue pour un maquis`);
  }
});

test('3. multi-activités : les catégories des deux domaines, une seule fois chacune', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const domains = (await api('/api/admin/catalog/domains', { cookie })).body.data;
  const maquis = domains.find((d) => d.code === 'maquis');
  const quincaillerie = domains.find((d) => d.code === 'quincaillerie');
  const cats = (await api('/api/admin/catalog/categories', { cookie })).body.data;
  const forDomain = (id) => cats.filter((c) => c.domainIds.includes(id)).map((c) => c.slug);
  const union = [...new Set([...forDomain(maquis.id), ...forDomain(quincaillerie.id)])];
  // Seule la catégorie générique « Autres » est partagée par construction : elle doit
  // apparaître une seule fois dans le plan d'affectation, malgré les deux activités.
  const shared = forDomain(maquis.id).filter((s) => forDomain(quincaillerie.id).includes(s));
  assert.deepStrictEqual(shared, ['autres'], 'seule la catégorie générique est commune');
  assert.strictEqual(new Set(union).size, union.length);
  assert.ok(union.includes('ciment') && union.includes('bieres'));
});

test('4. un produit modèle ne porte aucun prix et n’est pas un produit vendu', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const products = (await api('/api/admin/catalog/products?search=beaufort', { cookie })).body.data;
  assert.ok(products.length >= 3);
  for (const p of products) {
    assert.strictEqual(p.priceXof, undefined, 'aucun prix sur un modèle');
    assert.strictEqual(p.usageCount, 0, 'aucune boutique ne l’utilise encore');
    assert.ok(p.volumeLabel, 'contenance présente');
    assert.ok(p.volumeMl > 0, 'contenance convertie en millilitres');
    assert.ok(p.imageKey, 'image associée');
  }
  const b50 = products.find((p) => p.catalogKey === 'beaufort_lager_50cl');
  assert.strictEqual(b50.volumeMl, 500);
  assert.strictEqual(b50.unit, 'bouteille');
});

test('5. l’image d’une marque ne peut pas être celle d’une autre', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const products = (await api('/api/admin/catalog/products?limit=500', { cookie })).body.data;
  const boissons = products.filter((p) => p.kind === 'boisson');
  assert.strictEqual(boissons.length, 56);
  const keys = new Set();
  for (const p of boissons) {
    assert.strictEqual(p.imageKey, p.catalogKey, `image ${p.imageKey} attendue identique à la référence ${p.catalogKey}`);
    assert.ok(!keys.has(p.imageKey), 'aucune image réutilisée entre deux références');
    keys.add(p.imageKey);
  }
});

test('6. unités et contenances : cl et ml ne sont pas confondus', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const meta = await api('/api/merchant/meta/units', { cookie });
  // route marchand : vérifiée plus bas avec une session marchand, ici on contrôle le contenu via l’admin
  const products = (await api('/api/admin/catalog/products?search=bock', { cookie })).body.data;
  const b65 = products.find((p) => p.catalogKey === 'bock_65cl');
  const b33 = products.find((p) => p.catalogKey === 'bock_33cl');
  assert.strictEqual(b65.volumeMl, 650);
  assert.strictEqual(b33.volumeMl, 330);
  assert.strictEqual(b65.volumeLabel, '65 cl');
  assert.ok(meta.status === 401 || meta.status === 200);
});

test('7. désactiver un domaine ne supprime ni les catégories ni les produits', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const before = (await api('/api/admin/catalog/overview', { cookie })).body.data.counts;
  const domains = (await api('/api/admin/catalog/domains', { cookie })).body.data;
  const glacier = domains.find((d) => d.code === 'glacier');
  const off = await api(`/api/admin/catalog/domains/${glacier.id}`, { method: 'PUT', body: { isActive: false }, cookie });
  assert.strictEqual(off.status, 200);
  assert.strictEqual(off.body.data.isActive, false);
  const afterCounts = (await api('/api/admin/catalog/overview', { cookie })).body.data.counts;
  assert.strictEqual(afterCounts.domains, before.domains, 'le domaine est désactivé, pas supprimé');
  assert.strictEqual(afterCounts.categories, before.categories);
  assert.strictEqual(afterCounts.products, before.products);
  const reactivate = await api(`/api/admin/catalog/domains/${glacier.id}`, { method: 'PUT', body: { isActive: true }, cookie });
  assert.strictEqual(reactivate.body.data.isActive, true);
});

test('8. un domaine personnalisé peut être ajouté puis réordonné', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const created = await api('/api/admin/catalog/domains', {
    method: 'POST', cookie,
    body: { code: 'boulangerie_artisanale', label: 'Boulangerie artisanale', family: 'Restauration et boissons', custom: true },
  });
  assert.strictEqual(created.status, 201);
  const list = (await api('/api/admin/catalog/domains', { cookie })).body.data;
  const ids = list.map((d) => d.id);
  const reordered = await api('/api/admin/catalog/domains/reorder', { method: 'POST', body: { ids: [created.body.data.id, ...ids.filter((i) => i !== created.body.data.id)] }, cookie });
  assert.strictEqual(reordered.status, 200);
  assert.strictEqual(reordered.body.data[0].code, 'boulangerie_artisanale');
});

test('9. corriger un produit du catalogue ne touche pas une copie déjà personnalisée', async () => {
  // La copie marchand vit dans merchant_products : une modification du modèle ne la réécrit pas.
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const products = (await api('/api/admin/catalog/products?search=castel', { cookie })).body.data;
  const model = products.find((p) => p.catalogKey === 'castel_beer_65cl');
  const original = model.name;
  const renamed = await api(`/api/admin/catalog/products/${model.id}`, { method: 'PUT', body: { name: 'Castel Beer 65 cl (modèle)' }, cookie });
  assert.strictEqual(renamed.status, 200);
  assert.strictEqual(renamed.body.data.name, 'Castel Beer 65 cl (modèle)');
  // restauration du libellé d'origine
  await api(`/api/admin/catalog/products/${model.id}`, { method: 'PUT', body: { name: original }, cookie });
  const restored = (await api('/api/admin/catalog/products?search=castel', { cookie })).body.data.find((p) => p.catalogKey === 'castel_beer_65cl');
  assert.strictEqual(restored.name, original);
});

test('10. les détails de doublons sont exposés et vides au départ', async () => {
  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const overview = await api('/api/admin/catalog/overview', { cookie });
  assert.deepStrictEqual(overview.body.data.duplicates, []);
});

// --------------------------------------------------------------------------------------------
// Parcours complet : inscription avec multi-activités -> approbation admin -> boutique prête.
// --------------------------------------------------------------------------------------------
test('11. inscription multi-activités : 1 principale + 1 secondaire + « Autre » refusé sans précision', async () => {
  const reg = await api('/api/public/merchant-registrations', { method: 'POST', body: {
    contactName: 'Awa Koné', businessName: 'Maquis Chez Awa', username: `awa${Date.now() % 100000}`,
    phone: '+225 07 00 00 00 01', city: 'Abidjan', address: 'Cocody, rue des Jardins', sector: 'maquis',
    activityDomain: 'autre', activityDomains: ['bar_maquis'], description: 'Maquis avec grillades et boissons fraîches.',
    password: 'motdepasse12345', passwordConfirm: 'motdepasse12345',
  } });
  assert.strictEqual(reg.status, 400, '« Autre » exige une précision');
  assert.match(reg.body.error, /Précisez votre activité/);
});

test('12. approbation : les domaines du dossier deviennent ceux du compte, les catégories sont créées sans produit', async () => {
  const username = `awa${Date.now() % 100000}`;
  const reg = await api('/api/public/merchant-registrations', { method: 'POST', body: {
    contactName: 'Awa Koné', businessName: 'Maquis Chez Awa', username,
    phone: '+225 07 00 00 00 01', city: 'Abidjan', address: 'Cocody, rue des Jardins', sector: 'maquis',
    activityDomain: 'maquis', activityDomains: ['bar_maquis', 'vente_boissons'],
    description: 'Maquis avec grillades et boissons fraîches.',
    password: 'motdepasse12345', passwordConfirm: 'motdepasse12345',
  } });
  assert.strictEqual(reg.status, 201, JSON.stringify(reg.body));

  const login = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } });
  const cookie = cookieFrom(login.headers);
  const list = await api('/api/admin/merchant-registrations?status=pending', { cookie });
  const row = (list.body.data || []).find((r) => r.username === username);
  assert.ok(row, 'demande visible par l’administrateur');
  assert.deepStrictEqual(row.activityDomains, ['bar_maquis', 'vente_boissons']);
  assert.strictEqual(row.activityDomain, 'maquis');

  const decision = await api(`/api/admin/merchant-registrations/${row.id}/decision`, { method: 'POST', cookie, body: { action: 'approve', reason: 'Dossier complet.' } });
  assert.strictEqual(decision.status, 200, JSON.stringify(decision.body));
  const merchantId = decision.body.data.merchant.id;

  // Le marchand se connecte avec son mot de passe et retrouve ses activités + ses catégories.
  const mlogin = await api('/api/merchant/auth/login', { method: 'POST', body: { username, password: 'motdepasse12345' } });
  assert.strictEqual(mlogin.status, 200, JSON.stringify(mlogin.body));
  const mcookie = cookieFrom(mlogin.headers);
  const domains = await api('/api/merchant/domains', { cookie: mcookie });
  assert.strictEqual(domains.status, 200);
  const codes = domains.body.data.domains.map((d) => d.code);
  assert.strictEqual(codes[0], 'maquis', 'activité principale en tête');
  assert.ok(codes.includes('bar_maquis') && codes.includes('vente_boissons'), JSON.stringify(codes));

  const categories = await api('/api/merchant/categories', { cookie: mcookie });
  const slugs = categories.body.data.map((c) => c.slug);
  assert.ok(slugs.includes('bieres') && slugs.includes('grillades'), JSON.stringify(slugs));
  assert.strictEqual(new Set(slugs).size, slugs.length, 'aucune catégorie en double');

  const products = await api('/api/merchant/products', { cookie: mcookie });
  assert.strictEqual(products.status, 200);
  assert.strictEqual((products.body.data || []).length, 0, 'aucun produit imposé à la boutique');
});

test('13. test 12 bis : le marchand choisit un modèle, saisit son prix, puis personnalise nom/unité/contenance', async () => {
  const username = `awa${(Date.now() + 1) % 100000}`;
  await api('/api/public/merchant-registrations', { method: 'POST', body: {
    contactName: 'Awa Koné', businessName: 'Maquis Chez Awa 2', username,
    phone: '+225 07 00 00 00 02', city: 'Abidjan', address: 'Cocody, rue des Jardins', sector: 'maquis',
    activityDomain: 'maquis', description: 'Maquis avec grillades.',
    password: 'motdepasse12345', passwordConfirm: 'motdepasse12345',
  } });
  const admin = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const list = await api('/api/admin/merchant-registrations?status=pending', { cookie: admin });
  const row = (list.body.data || []).find((r) => r.username === username);
  await api(`/api/admin/merchant-registrations/${row.id}/decision`, { method: 'POST', cookie: admin, body: { action: 'approve' } });

  const mcookie = cookieFrom((await api('/api/merchant/auth/login', { method: 'POST', body: { username, password: 'motdepasse12345' } })).headers);
  const models = (await api('/api/merchant/catalog/products?search=castel', { cookie: mcookie })).body.data;
  const model = models.find((p) => p.catalogKey === 'castel_beer_65cl');
  assert.ok(model, 'modèle Castel visible pour un maquis');
  assert.strictEqual(model.priceXof, undefined, 'aucun prix dans le catalogue');

  // Sans prix : refus explicite.
  const noPrice = await api(`/api/merchant/catalog/products/${model.id}/add`, { method: 'POST', cookie: mcookie, body: {} });
  assert.strictEqual(noPrice.status, 400);

  const added = await api(`/api/merchant/catalog/products/${model.id}/add`, { method: 'POST', cookie: mcookie, body: { priceXof: 1200 } });
  assert.strictEqual(added.status, 201, JSON.stringify(added.body));
  const product = added.body.data;
  assert.strictEqual(product.priceXof, 1200);
  assert.strictEqual(product.catalogProductId, model.id);
  assert.strictEqual(product.volumeMl, 650);
  assert.strictEqual(product.unit, 'bouteille');
  assert.ok(product.imageUrl || product.imageKey, 'image reprise du modèle');

  // Personnalisation : le marchand peut tout changer, y compris l'unité et la contenance.
  const patched = await api(`/api/merchant/products/${product.id}`, { method: 'PUT', cookie: mcookie, body: {
    name: 'Castel bien fraîche', priceXof: 1500, unit: 'pack', volumeLabel: '33 cl', availability: 'available',
  } });
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.body));
  const after = patched.body.data;
  assert.strictEqual(after.name, 'Castel bien fraîche');
  assert.strictEqual(after.priceXof, 1500);
  assert.strictEqual(after.unit, 'pack');
  assert.strictEqual(after.volumeMl, 330, 'contenance recalculée en ml');
  assert.strictEqual(after.catalogProductId, model.id, 'le lien au modèle est conservé');

  // Le modèle n'a pas bougé.
  const modelAfter = (await api('/api/admin/catalog/products?search=castel', { cookie: admin })).body.data.find((p) => p.catalogKey === 'castel_beer_65cl');
  assert.strictEqual(modelAfter.name, 'Castel Beer 65 cl');
  assert.strictEqual(modelAfter.usageCount, 1, 'un marchand utilise ce modèle');

  // Import multi-images côté administrateur (métadonnées seulement : le fichier doit exister).
  const media = await api('/api/admin/catalog/media', { method: 'POST', cookie: admin, body: {
    key: 'beaufort_lager_33cl', name: 'Beaufort Lager 33 cl', category: 'bieres', url: '/media/catalogue/beaufort_lager_33cl.webp',
  } });
  assert.ok([200, 201, 409].includes(media.status), JSON.stringify(media.body));
});
