'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const copy = (value) => JSON.parse(JSON.stringify(value));

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = new Map(); FakeEventSource.instances.push(this); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  close() {}
  emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
}

function response(data, status = 200) {
  return { ok: status >= 200 && status < 300, status, async json() { return copy(data); } };
}

function account(id) {
  return {
    id, username: id, displayName: `Marchand ${id.slice(-1).toUpperCase()}`, email: `${id}@example.test`, phone: '+225 0700000000',
    managerId: '', mustChangePassword: false, createdAt: '2026-01-01T00:00:00.000Z',
    deletedAt: id === 'merchant-c' ? '2026-01-03T00:00:00.000Z' : null,
    status: id === 'merchant-c' ? 'blocked' : 'active',
    store: { id: `store-${id}`, merchantId: id, slug: id, name: `Boutique ${id.slice(-1).toUpperCase()}`, status: 'active',
      isPublished: false, qrPublicCode: '', qrScanCount: 0, logo: '', coverImageUrl: '', description: '', phone: '', whatsapp: '', email: '',
      address: '', deliveryNote: '', theme: {} },
  };
}

function merchantRow(id) {
  const value = account(id);
  return { id, username: value.username, displayName: value.displayName, email: value.email, phone: value.phone, status: value.status,
    managerId: '', createdAt: value.createdAt, mustChangePassword: false, storeId: value.store.id, storeSlug: value.store.slug,
    storeName: value.store.name, storeStatus: 'active', storePublished: false, qrPublicCode: '', qrScanCount: 0, productCount: 0,
    orderCount: 0, assignment: null, ...(value.deletedAt ? { deletedAt: value.deletedAt } : {}) };
}

async function openControl(t, options = {}) {
  FakeEventSource.instances = [];
  const html = await fs.readFile(path.join(root, 'public/merchant-control.html'), 'utf8');
  const script = await fs.readFile(path.join(root, 'public/merchant-control.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://control.example.test/merchant-control/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window; const calls = []; const intervals = [];
  const rows = [merchantRow('merchant-a'), merchantRow('merchant-b')];
  const archivedRow = merchantRow('merchant-c');
  const mainAttempts = new Map(); let orderAttempts = 0; let creationCount = 0; let releaseMerchantA = null; let releaseMerchantB = null; const productUpdates = []; const creationBodies = []; let scopedBlocks = [];

  w.fetch = async (url, request = {}) => {
    const pathname = String(url); const method = request.method || 'GET';
    calls.push({ pathname, method, body: request.body ? JSON.parse(request.body) : {} });
    if (pathname === '/api/admin/merchants' && method === 'POST') {
      creationCount += 1; const id = `merchant-${String.fromCharCode(98 + creationCount)}`; const body = JSON.parse(request.body || '{}'); creationBodies.push(body); rows.push(merchantRow(id));
      return response({ data: { id, displayName: body.displayName }, temporaryPassword: `M-temp-${creationCount}`, expiresAt: '2026-12-01T00:00:00.000Z' }, 201);
    }
    if (pathname === '/api/auth/me') return response({ authenticated: true, role: 'admin' });
    if ((pathname === '/api/admin/merchants' || pathname === '/api/admin/merchants?includeDeleted=1') && method === 'GET') {
      return response({ data: copy(pathname.includes('includeDeleted=1') ? [...rows, archivedRow] : rows) });
    }
    if (pathname === '/api/admin/managers' && method === 'GET') return response({ data: [] });
    const detailMatch = pathname.match(/^\/api\/admin\/merchants\/(merchant-[a-z])$/);
    if (detailMatch && method === 'GET') {
      const id = detailMatch[1]; mainAttempts.set(id, (mainAttempts.get(id) || 0) + 1);
      if (id === 'merchant-a' && options.failMainOnce && mainAttempts.get(id) === 1) return response({ error: 'Réseau indisponible.' }, 503);
      if (id === 'merchant-a' && options.hangMain && mainAttempts.get(id) === 1) return new Promise(() => {});
      if (id === 'merchant-a' && options.delayMerchantA) {
        return new Promise((resolve) => { releaseMerchantA = () => resolve(response({ data: account(id) })); });
      }
      if (id === 'merchant-b' && options.delayMerchantB) {
        return new Promise((resolve) => { releaseMerchantB = () => resolve(response({ data: account(id) })); });
      }
      return response({ data: account(id) });
    }
    if (pathname.includes('/customer-blocks?') && method === 'GET') return response({ data: copy(scopedBlocks), total: scopedBlocks.length, page: 1, limit: 50 });
    if (pathname.endsWith('/customer-blocks') && method === 'POST') {
      const body = JSON.parse(request.body || '{}'); const digits = body.phone.replace(/\\D/g, '');
      const block = { id: 'control-block-1', phoneLast4: digits.slice(-4), phoneMasked: `•••• ${digits.slice(-4)}`, reason: body.reason, status: 'active', createdAt: '2026-10-10T00:00:00.000Z', attemptCount: 0, history: [{ eventType: 'blocked', reason: body.reason, actorType: 'admin', createdAt: '2026-10-10T00:00:00.000Z' }], recentAttempts: [] };
      scopedBlocks = [block]; return response({ data: copy(block), idempotent: false }, 201);
    }
    if (pathname.endsWith('/unblock') && method === 'POST') {
      scopedBlocks = scopedBlocks.map((row) => ({ ...row, status: 'unblocked', unblockReason: JSON.parse(request.body || '{}').reason, unblockedAt: '2026-10-10T00:30:00.000Z', history: [...row.history, { eventType: 'unblocked', reason: JSON.parse(request.body || '{}').reason, actorType: 'admin', createdAt: '2026-10-10T00:30:00.000Z' }] }));
      return response({ data: copy(scopedBlocks[0]), idempotent: false });
    }
    if (pathname.endsWith('/orders?page=1&limit=30')) {
      orderAttempts += 1;
      if (options.failOrdersOnce && orderAttempts === 1) return response({ error: 'Commandes momentanément indisponibles.' }, 503);
      return response({ data: [] });
    }
    if (/\/products\/[^/]+$/.test(pathname) && method === 'PUT') {
      const body = JSON.parse(request.body || '{}'); productUpdates.push({ pathname, body }); return response({ data: { ...(options.products || [])[0], ...body } });
    }
    if (pathname.endsWith('/products')) return response({ data: copy(options.products || []) });
    if (pathname.endsWith('/assignments')) return response({ data: [] });
    if (pathname.endsWith('/audit?page=1')) return response({ data: [] });
    if (pathname.endsWith('/qr')) return response({ data: null });
    return response({ data: {} });
  };
  w.EventSource = FakeEventSource;
  w.setInterval = (callback, delay) => { intervals.push({ callback, delay }); return intervals.length; };
  if (options.shortTimeout) {
    const realSetTimeout = w.setTimeout.bind(w);
    w.setTimeout = (callback, delay, ...args) => realSetTimeout(callback, delay >= 10_000 ? 10 : delay, ...args);
  }
  Object.defineProperty(w.document, 'hidden', { configurable: true, value: false });
  w.confirm = () => true; w.prompt = () => 'Vérification après déblocage';
  w.eval(script);
  await settle(40);
  return { w, calls, intervals, mainAttempts, productUpdates, creationBodies, get orderAttempts() { return orderAttempts; }, get creationCount() { return creationCount; }, releaseMerchantA: () => releaseMerchantA?.(), releaseMerchantB: () => releaseMerchantB?.() };
}

test('les comptes archivés sont visibles uniquement sur demande et en lecture seule pour le PDG', async (t) => {
  const { w, calls } = await openControl(t);
  const archivedFilter = w.document.querySelector('#archivedFilterLabel');
  const checkbox = w.document.querySelector('#showArchivedMerchants');
  assert.equal(archivedFilter.hidden, false, 'le filtre est disponible après authentification du PDG');
  assert.equal(w.document.querySelector('[data-select-merchant="merchant-c"]'), null, 'les comptes archivés restent masqués par défaut');
  checkbox.checked = true; checkbox.dispatchEvent(new w.Event('change', { bubbles: true })); await settle();
  assert.ok(calls.some((call) => call.pathname === '/api/admin/merchants?includeDeleted=1'), 'le filtre demande explicitement les comptes supprimés à l’API');
  const archivedCard = w.document.querySelector('[data-select-merchant="merchant-c"]');
  assert.ok(archivedCard); assert.match(archivedCard.textContent, /Archivé/);
  archivedCard.click(); await settle(50);
  assert.match(w.document.querySelector('#detailRoot').textContent, /COMPTE ARCHIVÉ/);
  assert.ok(w.document.querySelector('[data-control-action="restore-account"]'), 'la restauration est la seule action sensible offerte au PDG');
  assert.equal(w.document.querySelector('[data-control-action="archive-account"]'), null);
  assert.equal(w.document.querySelector('[data-control-action="reset-password"]'), null);
  assert.equal(w.document.querySelector('#accountForm'), null, 'le compte archivé est en lecture seule jusqu’à restauration');
});

test('le PDG gère les restrictions dans le détail boutique, avec historique et déblocage audités', async (t) => {
  const { w, calls } = await openControl(t);
  w.document.querySelector('[data-select-merchant="merchant-a"]').click(); await settle(50);
  assert.ok(w.document.querySelector('[data-customer-block-form]'), 'le formulaire est accessible au PDG dans la fiche du marchand');
  w.document.querySelector('[name="phone"]').value = '+225 0100000000'; w.document.querySelector('[name="reason"]').value = 'Commandes frauduleuses documentées';
  w.document.querySelector('[data-customer-block-form]').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await settle(40);
  assert.ok(calls.some((row) => row.pathname === '/api/admin/merchants/merchant-a/customer-blocks' && row.method === 'POST' && row.body.phone === '+225 0100000000'), 'PDG action uses the scoped merchant route and persists the block');
  assert.match(w.document.querySelector('#detailRoot').textContent, /0000/); assert.match(w.document.querySelector('#detailRoot').textContent, /frauduleuses/);
  assert.doesNotMatch(w.document.querySelector('#detailRoot').textContent, /225 0100000000/, 'only the masked suffix is rendered');
  w.prompt = () => 'Contrôle terminé';
  w.document.querySelector('[data-unblock-customer-block="control-block-1"]').click(); await settle(40);
  assert.ok(calls.some((row) => row.pathname === '/api/admin/merchants/merchant-a/customer-blocks/control-block-1/unblock' && row.method === 'POST' && row.body.reason === 'Contrôle terminé'), 'PDG unblock is persisted with an audit reason');
  assert.match(w.document.querySelector('#detailRoot').textContent, /Débloqué/); assert.match(w.document.querySelector('#detailRoot').textContent, /Contrôle terminé/);
});

test('actualiser la liste et recevoir des événements ne remonte pas le détail sélectionné ni le formulaire de création', async (t) => {
  const { w, calls, intervals, mainAttempts } = await openControl(t);
  assert.equal(w.document.querySelectorAll('.brand-mark img[src="/icons/qria-logo.png"]').length, 2, 'la connexion et le contrôle utilisent le logo officiel fourni');
  assert.equal(mainAttempts.get('merchant-a'), 1, 'un seul chargement initial du compte sélectionné');
  const originalStoreName = w.document.querySelector('#controlStoreName');
  originalStoreName.value = 'Brouillon à conserver';
  const imageDraft = w.document.querySelector('#controlStoreLogoData');
  imageDraft.value = 'data:image/webp;base64,cGhvdG8=';
  originalStoreName.dispatchEvent(new w.Event('input', { bubbles: true }));
  imageDraft.dispatchEvent(new w.Event('change', { bubbles: true }));
  assert.equal(mainAttempts.get('merchant-a'), 1, 'la saisie et la sélection de photo n’entraînent aucun rechargement des détails');

  w.document.querySelector('#refreshMerchants').click();
  await settle();
  intervals.find((item) => item.delay === 30000)?.callback();
  await settle();
  w.document.dispatchEvent(new w.Event('visibilitychange'));
  await settle();
  FakeEventSource.instances[0].emit('commerce', { type: 'new_order', merchantId: 'merchant-b', reference: 'OTHER' });
  await settle();

  assert.equal(mainAttempts.get('merchant-a'), 1, 'les rafraîchissements de liste ne relancent pas la fiche du même marchand');
  assert.strictEqual(w.document.querySelector('#controlStoreName'), originalStoreName, 'le formulaire n’est pas démonté lors d’un rafraîchissement de fond');
  assert.equal(originalStoreName.value, 'Brouillon à conserver');
  assert.equal(imageDraft.value, 'data:image/webp;base64,cGhvdG8=', 'la référence photo reste intacte');

  w.document.querySelector('[data-control-action="refresh-detail"]').click();
  await settle(50);
  assert.equal(mainAttempts.get('merchant-a'), 2, 'le rafraîchissement explicite charge une seule fois le détail');
  const refreshedStoreName = w.document.querySelector('#controlStoreName');
  assert.equal(refreshedStoreName.value, 'Brouillon à conserver', 'un rafraîchissement explicite conserve les champs modifiés');
  assert.equal(w.document.querySelector('#controlStoreLogoData').value, 'data:image/webp;base64,cGhvdG8=', 'la photo déjà sélectionnée reste conservée');
  FakeEventSource.instances[0].emit('commerce', { type: 'product_updated', merchantId: 'merchant-a' });
  await settle();
  assert.equal(mainAttempts.get('merchant-a'), 2, 'un événement reçu pendant une saisie ne déclenche pas un démontage');
  assert.strictEqual(w.document.querySelector('#controlStoreName'), refreshedStoreName);

  w.document.querySelector('#createMerchantButton').click();
  const modalName = w.document.querySelector('#newMerchantName'); const modalUsername = w.document.querySelector('#newMerchantUsername');
  modalName.value = 'Compte en cours de saisie'; modalUsername.value = 'compte.brouillon';
  modalName.dispatchEvent(new w.Event('input', { bubbles: true })); modalUsername.dispatchEvent(new w.Event('input', { bubbles: true }));
  intervals.find((item) => item.delay === 30000)?.callback();
  await settle();
  assert.equal(modalName.value, 'Compte en cours de saisie');
  assert.equal(modalUsername.value, 'compte.brouillon');
  assert.equal(mainAttempts.get('merchant-a'), 2, 'le polling ne recharge pas les détails pendant la création d’un compte');
  assert.strictEqual(w.document.querySelector('#controlStoreName'), refreshedStoreName);
  assert.ok(calls.some((call) => call.pathname === '/api/admin/merchants'));
});

test('deux créations successives ajoutent chacune un compte sans relancer les détails du précédent', async (t) => {
  const app = await openControl(t); const { w } = app;
  async function create(name, username, expectedId, previousId) {
    w.document.querySelector('#createMerchantButton').click();
    w.document.querySelector('#newMerchantName').value = name;
    w.document.querySelector('#newMerchantUsername').value = username;
    w.document.querySelector('#newMerchantPasswordLength').value = expectedId === 'merchant-c' ? '6' : '18';
    w.document.querySelector('#createMerchantForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    await settle(40);
    assert.equal(app.creationCount, 1 + (expectedId === 'merchant-d' ? 1 : 0));
    assert.equal(app.creationBodies.at(-1).temporaryPasswordLength, expectedId === 'merchant-c' ? 6 : 18);
    assert.equal(app.mainAttempts.get(previousId), 1, 'l’ouverture de l’écran secret ne recharge pas l’ancien marchand');
    assert.equal(app.mainAttempts.get(expectedId) || 0, 0, 'le détail du nouveau compte attend la confirmation explicite');
    assert.match(w.document.querySelector('#modalRoot').textContent, /M-temp-/);
    w.document.querySelector('#finishSecret').click(); await settle(50);
    assert.equal(app.mainAttempts.get(expectedId), 1, 'le nouveau compte est chargé une seule fois après confirmation');
    assert.match(w.document.querySelector('#detailRoot').textContent, new RegExp(`Marchand ${expectedId.slice(-1).toUpperCase()}`));
  }
  await create('Nouvelle boutique C', 'marchand.c', 'merchant-c', 'merchant-a');
  await create('Nouvelle boutique D', 'marchand.d', 'merchant-d', 'merchant-c');
  assert.equal(app.creationCount, 2);
  assert.equal(w.document.querySelectorAll('#merchantCards [data-select-merchant]').length, 4, 'les comptes existants restent listés sans duplication');
});

test('l’édition PDG/gestionnaire conserve et transmet catégorie, prix promotionnel, variantes et toutes les photos', async (t) => {
  const product = { id: 'product-1', storeId: 'store-merchant-a', name: 'Robe', sku: 'ROB-01', priceXof: 10000, compareAtPriceXof: 12000,
    stockQuantity: 4, trackStock: true, status: 'active', sortOrder: 3, category: 'Vêtements', description: 'Coton tissé',
    variants: [{ name: 'Taille', values: ['S', 'M', 'L'] }], imageData: '/media/merchant/photo-1', imageUrls: ['/media/merchant/photo-1', '/media/merchant/photo-2'] };
  const app = await openControl(t, { products: [product] }); const { w, productUpdates } = app;
  const edit = w.document.querySelector('[data-edit-product="product-1"]'); assert.ok(edit);
  edit.click();
  assert.equal(w.document.querySelector('#controlProductCategory').value, 'Vêtements');
  assert.equal(w.document.querySelector('#controlProductComparePrice').value, '12000');
  assert.equal(w.document.querySelector('#controlProductVariants').value, 'Taille | S, M, L');
  assert.equal(w.document.querySelector('#controlProductImageUrls').value, JSON.stringify(product.imageUrls));
  w.document.querySelector('#controlProductName').value = 'Robe modifiée';
  w.document.querySelector('#controlProductForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await settle(30);
  const submitted = productUpdates[0]?.body; assert.ok(submitted, 'la modification est transmise à l’API');
  assert.equal(submitted.category, 'Vêtements'); assert.equal(submitted.compareAtPriceXof, 12000);
  assert.deepEqual(submitted.variants, product.variants); assert.deepEqual(submitted.imageUrls, product.imageUrls);
  assert.equal(submitted.imageData, product.imageData);
});

test('une ressource en erreur a son propre bouton Réessayer sans effacer les autres brouillons', async (t) => {
  const app = await openControl(t, { failOrdersOnce: true }); const { w } = app;
  const storeName = w.document.querySelector('#controlStoreName'); storeName.value = 'Texte non enregistré';
  storeName.dispatchEvent(new w.Event('input', { bubbles: true }));
  const retry = w.document.querySelector('[data-retry-resource="orders"]');
  assert.ok(retry, 'l’échec des commandes est visible et peut être réessayé');
  retry.click(); await settle();
  assert.equal(app.orderAttempts, 2, 'le bouton relance uniquement la ressource qui a échoué');
  assert.equal(w.document.querySelector('#controlStoreName').value, 'Texte non enregistré');
  assert.equal(app.mainAttempts.get('merchant-a'), 1, 'le réessai d’une ressource ne recharge pas le compte entier');
  assert.equal(w.document.querySelector('[data-retry-resource="orders"]'), null, 'le message d’échec disparaît après une réponse réussie');
});

test('un échec du détail principal expose un vrai bouton de nouvelle tentative', async (t) => {
  const app = await openControl(t, { failMainOnce: true });
  const { w } = app;
  const retry = w.document.querySelector('[data-retry-detail]');
  assert.ok(retry, 'l’erreur conserve une action de réessai visible');
  assert.match(w.document.querySelector('#detailRoot').textContent, /Réseau indisponible/);
  retry.click(); await settle(50);
  assert.equal(app.mainAttempts.get('merchant-a'), 2);
  assert.match(w.document.querySelector('#detailRoot').textContent, /COMPTE MARCHAND/);
});

test('une requête de détails bloquée sort du chargement infini et propose un vrai réessai', async (t) => {
  const app = await openControl(t, { hangMain: true, shortTimeout: true }); const { w, mainAttempts } = app;
  const detail = w.document.querySelector('#detailRoot');
  assert.equal(mainAttempts.get('merchant-a'), 1);
  assert.match(detail.textContent, /ne répond pas dans le délai prévu/i);
  assert.ok(w.document.querySelector('[data-retry-detail]'), 'le timeout affiche une action de nouvelle tentative');
  w.document.querySelector('[data-retry-detail]').click(); await settle(80);
  assert.equal(mainAttempts.get('merchant-a'), 2, 'le nouvel essai est unique');
  assert.match(detail.textContent, /COMPTE MARCHAND/, 'une réponse rétablie remplace le message d’erreur');
});

test('les sélections simultanées du même marchand partagent la requête de détails en cours', async (t) => {
  const app = await openControl(t, { delayMerchantA: true }); const { w, mainAttempts } = app;
  const card = w.document.querySelector('[data-select-merchant="merchant-a"]');
  card.click(); card.click(); await settle(10);
  assert.equal(mainAttempts.get('merchant-a'), 1, 'la sélection répétée ne lance pas de requête identique concurrente');
  app.releaseMerchantA(); await settle(80);
  assert.match(w.document.querySelector('#detailRoot').textContent, /COMPTE MARCHAND/);
  assert.equal(mainAttempts.get('merchant-a'), 1);
});

test('une réponse tardive d’un ancien marchand ne remplace pas la sélection courante', async (t) => {
  const app = await openControl(t, { delayMerchantB: true }); const { w } = app;
  w.document.querySelector('[data-select-merchant="merchant-b"]').click();
  w.document.querySelector('[data-select-merchant="merchant-a"]').click();
  await settle();
  app.releaseMerchantB(); await settle(50);
  assert.match(w.document.querySelector('#detailRoot').textContent, /Marchand A/);
  assert.equal(w.document.querySelector('.merchant-card.selected')?.dataset.selectMerchant, 'merchant-a');
});
