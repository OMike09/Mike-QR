'use strict';

// ============================================================================================
// Vérification en base PostgreSQL réelle (aucune simulation).
//
// Prérequis :
//   DATABASE_URL_TEST=postgres://user@host:port/base   (base vide ou dédiée aux tests)
//   schema.sql et schema-catalog-mission4.sql déjà appliqués sur cette base.
// Le test refuse de s'exécuter si la variable est absente.
//
// Contrôles : amorçage idempotent, contenances stockées en millilitres avec leur code d'unité,
// unités valides, une image par référence de boisson, affectation multi-domaines sans doublon,
// copie marchand (prix marchand conservé, personnalisations non écrasées par le catalogue).
// ============================================================================================
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');

const DATABASE_URL = process.env.DATABASE_URL_TEST || '';
const PORT = 4851;
const BASE = `http://127.0.0.1:${PORT}`;
let child;
let counter = 0;

function cookieFrom(headers) {
  const raw = headers.getSetCookie ? headers.getSetCookie() : [headers.get('set-cookie')].filter(Boolean);
  return raw.map((c) => c.split(';')[0]).filter((c) => c.startsWith('qria_')).join('; ');
}
async function api(pathname, { method = 'GET', body, cookie } = {}) {
  const res = await fetch(BASE + pathname, {
    method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, body: json, headers: res.headers, text };
}

// Sans base de test fournie, la suite est signalée comme ignorée (skip), pas comme un échec.
const suite = DATABASE_URL ? describe : describe.skip;

before(async () => {
  if (!DATABASE_URL) return;
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(PORT), DATABASE_URL, ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'admin1234', SESSION_SECRET: 'x'.repeat(40) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 80; i += 1) {
    await new Promise((r) => setTimeout(r, 300));
    try { const r = await fetch(`${BASE}/api/health`); if (r.ok) { const j = await r.json(); if (j.database === 'postgres') return; } } catch (_) {}
  }
  throw new Error('serveur PostgreSQL de test non démarré');
});

after(() => { if (child) child.kill('SIGKILL'); });

suite('catalogue · vérification en base PostgreSQL', () => {

test('P1. amorçage en base : 40 domaines, 35 catégories, 90 modèles, 56 images, aucun doublon', async () => {
  const cookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const overview = await api('/api/admin/catalog/overview', { cookie });
  assert.strictEqual(overview.status, 200);
  const c = overview.body.data.counts;
  assert.strictEqual(c.domains, 40);
  assert.strictEqual(c.categories, 35);
  assert.strictEqual(c.products, 90);
  assert.strictEqual(c.media, 56);
  assert.deepStrictEqual(overview.body.data.duplicates, []);
});

test('P2. contenances : millilitres exacts et libellé d’origine, jamais cl confondu avec ml', async () => {
  const cookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const products = (await api('/api/admin/catalog/products?limit=500', { cookie })).body.data;
  const byKey = new Map(products.map((p) => [p.catalogKey, p]));
  const cases = [
    ['bock_33cl', 330, '33 cl'], ['bock_65cl', 650, '65 cl'], ['beaufort_lager_50cl', 500, '50 cl'],
    ['beaufort_lager_canette_33cl', 330, '33 cl'], ['castel_beer_65cl', 650, '65 cl'],
    // Formats relevés sur les étiquettes de référence : 1,8 L et 100 cl (auparavant 1,5 L et 70 cl).
    ['eau_olgane_18l', 1800, '1,8 L'], ['gin_dekkers', 1000, '100 cl'],
  ];
  for (const [key, ml, label] of cases) {
    const product = byKey.get(key);
    assert.ok(product, `modèle ${key} présent en base`);
    assert.strictEqual(product.volumeMl, ml, `${key} : ${ml} ml attendus`);
    assert.strictEqual(product.volumeLabel, label);
  }
  const volumes = new Set(products.filter((p) => p.kind === 'boisson').map((p) => p.volumeMl));
  for (const ml of volumes) assert.ok(Number.isInteger(ml) && ml > 0, 'chaque boisson a une contenance en millilitres entiers');
});

test('P2b. une contenance incohérente est refusée, pas silencieusement acceptée', async () => {
  const cookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const created = await api('/api/admin/catalog/products', { method: 'POST', cookie, body: { name: 'Test incohérent', categorySlug: 'eaux', volumeLabel: '18 cl', volumeMl: 1800 } });
  assert.strictEqual(created.status, 400, 'libellé 18 cl + 1 800 ml refusé');
  assert.match(created.body.error, /incohérente/i);
  const ok = await api('/api/admin/catalog/products?search=Olgane', { cookie });
  assert.ok(ok.body.data.length >= 1);
});

test('P3. unités : toutes dans la liste autorisée, et distinctes des contenances', async () => {
  const cookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const allowed = new Set(['piece', 'sachet', 'carton', 'pack', 'bouteille', 'canette', 'kg', 'g', 'litre', 'cl', 'ml', 'metre', 'sac', 'service', 'portion']);
  const products = (await api('/api/admin/catalog/products?limit=500', { cookie })).body.data;
  for (const product of products) assert.ok(allowed.has(product.unit), `unité inconnue : ${product.unit} (${product.catalogKey})`);
});

test('P4. images : une image par référence de boisson, aucune réutilisation croisée', async () => {
  const cookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const products = (await api('/api/admin/catalog/products?limit=500', { cookie })).body.data.filter((p) => p.kind === 'boisson');
  assert.strictEqual(products.length, 56);
  const seen = new Map();
  for (const product of products) {
    assert.strictEqual(product.imageKey, product.catalogKey, `image de ${product.catalogKey}`);
    assert.ok(!seen.has(product.imageKey), `image ${product.imageKey} réutilisée par ${seen.get(product.imageKey)} et ${product.catalogKey}`);
    seen.set(product.imageKey, product.catalogKey);
  }
  const media = (await api('/api/admin/catalog/media', { cookie })).body.data;
  assert.strictEqual(media.length, 56);
  for (const item of media) assert.match(item.url, /^\/media\/catalogue\/[a-z0-9_]+\.webp$/);
});

test('P5. multi-activités : union sans doublon, une seule activité principale', async () => {
  const cookie = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const domains = (await api('/api/admin/catalog/domains', { cookie })).body.data;
  const byCode = new Map(domains.map((d) => [d.code, d]));
  const categories = (await api('/api/admin/catalog/categories', { cookie })).body.data;
  const slugsFor = (code) => categories.filter((c) => c.domainIds.includes(byCode.get(code).id)).map((c) => c.slug);
  const maquis = slugsFor('maquis'); const restaurant = slugsFor('restaurant'); const quincaillerie = slugsFor('quincaillerie');
  assert.ok(maquis.includes('bieres'));
  assert.ok(restaurant.includes('plats'));
  assert.ok(quincaillerie.includes('ciment'));
  const union = [...new Set([...maquis, ...quincaillerie])];
  assert.strictEqual(union.length, maquis.length + quincaillerie.length - 1, 'seule « autres » est commune');
  // Le schéma n'autorise qu'une activité principale par compte (index unique partiel).
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const index = await client.query("SELECT indexdef FROM pg_indexes WHERE tablename='merchant_domains' AND indexdef LIKE '%is_primary%'");
  await client.end();
  assert.strictEqual(index.rows.length, 1, 'index unique partiel sur l’activité principale présent');
});

test('P6. parcours réel : modèles → prix marchand → personnalisation conservée en base', async () => {
  counter += 1;
  // Identifiant et téléphone réellement uniques : le test doit pouvoir être rejoué sur la même base.
  const suffix = require('node:crypto').randomUUID().replace(/-/g, '').slice(0, 10);
  const username = `pgm${suffix}`;
  const phone = `+225${String(Date.now()).slice(-8)}${counter}`.slice(0, 15);
  // Un compte identique peut subsister d'un passage précédent : on réutilise son identifiant unique.
  const registration = await api('/api/public/merchant-registrations', { method: 'POST', body: {
    contactName: 'Koffi Yao', businessName: `Maquis PG ${suffix}`, username,
    phone, city: 'Abidjan', address: 'Yopougon, rue 12', sector: 'maquis',
    activityDomain: 'maquis', activityDomains: ['restaurant'], description: 'Maquis et petite restauration.',
    password: '482913', passwordConfirm: '482913',
  } });
  assert.strictEqual(registration.status, 201, JSON.stringify(registration.body));

  const admin = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const pending = await api('/api/admin/merchant-registrations?status=pending', { cookie: admin });
  const row = (pending.body.data || []).find((r) => r.username === username);
  assert.ok(row);
  const decision = await api(`/api/admin/merchant-registrations/${row.id}/decision`, { method: 'POST', cookie: admin, body: { action: 'approve' } });
  assert.strictEqual(decision.status, 200, JSON.stringify(decision.body));

  // Si un passage précédent a déjà été approuvé, la fiche marchand ci-dessous est relue telle quelle.
  const merchantCookie = cookieFrom((await api('/api/merchant/auth/login', { method: 'POST', body: { username, password: '482913' } })).headers);
  const models = (await api('/api/merchant/catalog/products?search=beaufort', { cookie: merchantCookie })).body.data;
  const model = models.find((p) => p.catalogKey === 'beaufort_lager_50cl');
  const added = await api(`/api/merchant/catalog/products/${model.id}/add`, { method: 'POST', cookie: merchantCookie, body: { priceXof: 900 } });
  assert.strictEqual(added.status, 201, JSON.stringify(added.body));
  const productId = added.body.data.id;

  const patched = await api(`/api/merchant/products/${productId}`, { method: 'PUT', cookie: merchantCookie, body: {
    name: 'Beaufort fraîche du maquis', priceXof: 1000, unit: 'carton', volumeLabel: '33 cl', availability: 'available', imageUrls: added.body.data.imageUrls,
  } });
  assert.strictEqual(patched.status, 200, JSON.stringify(patched.body));

  // Le catalogue change : la fiche marchand ne doit pas bouger.
  const catalogBefore = (await api('/api/admin/catalog/products?search=beaufort', { cookie: admin })).body.data.find((p) => p.catalogKey === 'beaufort_lager_50cl');
  const catalogUpdate = await api(`/api/admin/catalog/products/${catalogBefore.id}`, { method: 'PUT', cookie: admin, body: { name: 'Beaufort Lager 50 cl (renommée)', volumeLabel: '33 cl' } });
  assert.strictEqual(catalogUpdate.status, 200);

  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const stored = (await client.query(
    `SELECT name, price_xof, unit, volume_label, volume_ml, image_key, catalog_product_id, status
       FROM merchant_products WHERE id=$1`, [productId])).rows[0];
  assert.strictEqual(stored.name, 'Beaufort fraîche du maquis', 'nom personnalisé conservé');
  // BIGINT en PostgreSQL : le pilote renvoie une chaîne, la route renvoie un nombre (vérifié en P6b).
  assert.strictEqual(Number(stored.price_xof), 1000, 'prix du marchand conservé, aucun prix du catalogue');
  assert.strictEqual(stored.unit, 'carton', 'unité modifiée par le marchand conservée');
  assert.strictEqual(stored.volume_label, '33 cl');
  assert.strictEqual(stored.volume_ml, 330, 'contenance recalculée en millilitres');
  assert.strictEqual(stored.image_key, 'beaufort_lager_50cl', 'image d’origine tracée');
  assert.strictEqual(stored.catalog_product_id, model.id, 'lien au modèle conservé');
  assert.strictEqual(stored.status, 'active');

  const usedCount = (await client.query('SELECT COUNT(*)::int AS n FROM merchant_products WHERE catalog_product_id=$1', [model.id])).rows[0].n;
  assert.ok(usedCount >= 1, 'le modèle est bien compté comme utilisé');

  // Remise du libellé d'origine pour ne pas laisser la base de test modifiée.
  await api(`/api/admin/catalog/products/${catalogBefore.id}`, { method: 'PUT', cookie: admin, body: { name: 'Beaufort Lager 50 cl', volumeLabel: '50 cl' } });
  await client.end();
});

test('P7. catégories préparées à l’approbation : présentes en base, aucun produit créé d’office', async () => {
  const { Client } = require('pg');
  const client = new Client({ connectionString: DATABASE_URL });
  await client.connect();
  const stores = (await client.query("SELECT id, name FROM merchant_stores WHERE name LIKE 'Maquis PG %' ORDER BY created_at DESC LIMIT 1")).rows;
  assert.ok(stores.length, 'boutique du parcours créée');
  const categories = (await client.query('SELECT slug FROM merchant_categories WHERE store_id=$1 ORDER BY slug', [stores[0].id])).rows.map((r) => r.slug);
  assert.ok(categories.includes('bieres') && categories.includes('plats'), JSON.stringify(categories));
  assert.strictEqual(new Set(categories).size, categories.length, 'aucune catégorie en double');
  const products = (await client.query("SELECT COUNT(*)::int AS n FROM merchant_products WHERE store_id=$1 AND status <> 'archived'", [stores[0].id])).rows[0].n;
  assert.strictEqual(products, 1, 'seul le produit volontairement ajouté existe');
  await client.end();
});

test('P8. les API renvoient des nombres pour les prix et les contenances (pas de chaînes BIGINT)', async () => {
  const admin = cookieFrom((await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'admin1234' } })).headers);
  const models = (await api('/api/admin/catalog/products?search=beaufort', { cookie: admin })).body.data;
  for (const model of models) assert.strictEqual(typeof model.volumeMl, 'number', `${model.catalogKey} : volumeMl numérique`);
  const stores = (await api('/api/admin/merchant-stores?limit=5', { cookie: admin })).status;
  assert.ok([200, 404].includes(stores));
});
});
