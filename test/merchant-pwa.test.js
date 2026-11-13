'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const origin = 'https://oymike.example.test';
const pathOf = (value) => new URL(typeof value === 'string' ? value : value.url, origin).pathname;

function responseCache() {
  const entries = new Map();
  const cache = {
    async put(key, response) { entries.set(pathOf(key), response.clone()); },
    async match(key) { const found = entries.get(pathOf(key)); return found ? found.clone() : undefined; },
  };
  return {
    entries,
    async open() { return cache; },
    async match(key) { const found = entries.get(pathOf(key)); return found ? found.clone() : undefined; },
    async keys() { return entries.size ? ['oymike-merchant-shell-v3'] : []; },
    async delete() { entries.clear(); return true; },
  };
}

test('PWA marchande : marque, manifeste et shell hors ligne simulé, sans cache des API', async () => {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'public/merchant/manifest.webmanifest'), 'utf8'));
  const html = await fs.readFile(path.join(root, 'public/merchant.html'), 'utf8');
  const workerSource = await fs.readFile(path.join(root, 'public/merchant/sw.js'), 'utf8');
  const frontend = await fs.readFile(path.join(root, 'public/merchant.js'), 'utf8');
  assert.equal(manifest.scope, '/merchant/'); assert.equal(manifest.start_url, '/merchant/');
  assert.match(html, /rel="manifest" href="\/merchant\/manifest\.webmanifest"/);
  assert.match(html, /src="\/icons\/qria-logo\.png"/); assert.match(frontend, /navigator\.serviceWorker\.register\('\/merchant\/sw\.js'/);
  for (const icon of manifest.icons) await fs.access(path.join(root, 'public', icon.src.replace(/^\//, '')));

  const listeners = new Map(); const cacheApi = responseCache(); let online = true; let fetchCount = 0;
  const self = {
    location: new URL(`${origin}/merchant/sw.js`), registration: { async showNotification() {} },
    clients: { async claim() {}, async matchAll() { return []; }, async openWindow() {} },
    async skipWaiting() {}, addEventListener(name, callback) { listeners.set(name, callback); },
  };
  class WorkerRequest {
    constructor(url, options = {}) { this.url = new URL(typeof url === 'string' ? url : url.url, origin).href; this.method = options.method || 'GET'; this.mode = options.mode || 'cors'; this.cache = options.cache; }
  }
  const fetchMock = async (input) => {
    fetchCount += 1; if (!online) throw new Error('offline');
    const pathname = pathOf(input); const body = pathname === '/merchant/' ? '<!doctype html><title>Marchand local</title>' : `cached shell ${pathname}`;
    return new Response(body, { status: 200, headers: { 'Content-Type': pathname.endsWith('.js') ? 'application/javascript' : 'text/html' } });
  };
  vm.runInNewContext(workerSource, { self, caches: cacheApi, fetch: fetchMock, Request: WorkerRequest, Response, URL, Promise, console });
  let installPromise; listeners.get('install')({ waitUntil(promise) { installPromise = promise; } }); await installPromise;
  assert.ok(cacheApi.entries.has('/merchant/'), 'the app shell is cached during installation');
  assert.ok(cacheApi.entries.has('/merchant.js')); assert.ok(cacheApi.entries.has('/merchant.css'));
  const requestsAfterInstall = fetchCount; online = false;

  let navigationPromise;
  listeners.get('fetch')({ request: { method: 'GET', url: `${origin}/merchant/`, mode: 'navigate' }, respondWith(promise) { navigationPromise = promise; } });
  const offlineDocument = await navigationPromise;
  assert.equal(offlineDocument.status, 200); assert.match(await offlineDocument.text(), /Marchand local/, 'the cached merchant shell opens offline');

  let staticPromise;
  listeners.get('fetch')({ request: { method: 'GET', url: `${origin}/merchant.js`, mode: 'same-origin' }, respondWith(promise) { staticPromise = promise; } });
  const offlineScript = await staticPromise; assert.equal(offlineScript.status, 200); assert.match(await offlineScript.text(), /cached shell \/merchant\.js/);

  let apiIntercepted = false;
  listeners.get('fetch')({ request: { method: 'GET', url: `${origin}/api/merchant/stats`, mode: 'cors' }, respondWith() { apiIntercepted = true; } });
  assert.equal(apiIntercepted, false, 'authenticated API data is deliberately never intercepted or cached');
  assert.equal(fetchCount, requestsAfterInstall + 2, 'offline navigation and stale-while-revalidate make a failed network attempt, then serve cached app files');
});
