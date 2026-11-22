'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { Client } = require('pg');

const TEST_DATABASE_URL = String(process.env.TEST_DATABASE_URL || '').trim();

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
function cookieFrom(response, role) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  return cookies.map((value) => value.split(';')[0]).find((value) => value.startsWith(`qria_${role}=`) && value.slice(value.indexOf('=') + 1)) || '';
}
async function api(base, url, { cookie = '', method = 'GET', body } = {}) {
  const headers = { Origin: base }; if (cookie) headers.Cookie = cookie; if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({})); return { response, status: response.status, data };
}
async function waitForServer(child, base, getOutput) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`PostgreSQL test server exited ${child.exitCode}\n${getOutput()}`);
    try { if ((await fetch(`${base}/api/health`)).ok) return; } catch (_) { /* server is starting */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`PostgreSQL test server startup timeout\n${getOutput()}`);
}
async function stopServer(child) {
  if (child && child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolve) => child.once('exit', resolve)); }
}

// Opt-in only: the test creates and drops a randomly named schema; it never truncates an existing database.
test('PostgreSQL isolé : commandes assistées transactionnelles, idempotence, stock, provenance et occupation', { skip: !TEST_DATABASE_URL }, async (t) => {
  const schema = `oymike_assisted_test_${randomBytes(6).toString('hex')}`;
  const adminClient = new Client({ connectionString: TEST_DATABASE_URL });
  let schemaCreated = false; let child = null; let output = '';
  t.after(async () => {
    await stopServer(child).catch(() => {});
    if (schemaCreated) await adminClient.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
    await adminClient.end().catch(() => {});
  });

  await adminClient.connect();
  await adminClient.query(`CREATE SCHEMA "${schema}"`); schemaCreated = true;
  const isolatedUrl = new URL(TEST_DATABASE_URL);
  isolatedUrl.searchParams.set('options', `-c search_path=${schema},public`);
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const env = { ...process.env, DATABASE_URL: isolatedUrl.toString(), NODE_ENV: 'test', PORT: String(port),
    ADMIN_USERNAME: 'assisted-pg-ceo', ADMIN_PASSWORD: 'Assisted-PG-CEO-Password-2026!',
    SESSION_SECRET: 'assisted-postgres-test-session-secret-long-enough-2026' };
  delete env.QRIA_STORE_FILE;
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (chunk) => { output += chunk.toString(); }); child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  await waitForServer(child, base, () => output);

  const ceoResponse = await api(base, '/api/auth/login', { method: 'POST', body: { username: 'assisted-pg-ceo', password: 'Assisted-PG-CEO-Password-2026!' } });
  assert.equal(ceoResponse.status, 200, JSON.stringify(ceoResponse.data)); const ceoCookie = cookieFrom(ceoResponse.response, 'admin'); assert.ok(ceoCookie);
  const createdMerchant = await api(base, '/api/admin/merchants', { cookie: ceoCookie, method: 'POST', body: { username: 'assisted.pg.merchant', displayName: 'Marchand PG' } });
  assert.equal(createdMerchant.status, 201, JSON.stringify(createdMerchant.data));
  const login = await api(base, '/api/merchant/auth/login', { method: 'POST', body: { username: 'assisted.pg.merchant', password: createdMerchant.data.temporaryPassword } });
  assert.equal(login.status, 200, JSON.stringify(login.data)); let merchantCookie = cookieFrom(login.response, 'merchant'); assert.ok(merchantCookie);
  const changed = await api(base, '/api/merchant/auth/change-password', { cookie: merchantCookie, method: 'POST', body: {
    currentPassword: createdMerchant.data.temporaryPassword,
    password: 'Assisted-PG-Merchant-Personal-2026!', confirmPassword: 'Assisted-PG-Merchant-Personal-2026!',
  } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data)); merchantCookie = cookieFrom(changed.response, 'merchant') || merchantCookie;
  const storeResponse = await api(base, '/api/merchant/store', { cookie: merchantCookie, method: 'PUT', body: {
    name: 'Boutique transactionnelle PG', slug: `assisted-pg-${schema.slice(-8)}`, sector: 'restaurant', deliveryEnabled: true, pickupEnabled: true, isPublished: true,
  } });
  assert.equal(storeResponse.status, 200, JSON.stringify(storeResponse.data));
  const productResponse = await api(base, '/api/merchant/products', { cookie: merchantCookie, method: 'POST', body: {
    name: 'Plat PostgreSQL', category: 'Menu', priceXof: 1500, stockQuantity: 5, trackStock: true, status: 'active',
  } });
  assert.equal(productResponse.status, 201, JSON.stringify(productResponse.data)); const productId = productResponse.data.data.id;
  const pointResponse = await api(base, '/api/merchant/service-points', { cookie: merchantCookie, method: 'POST', body: {
    requestId: 'assisted_pg_point_creation_request_001', type: 'table', name: 'Table PG 1', zone: 'Salle',
  } });
  assert.equal(pointResponse.status, 201, JSON.stringify(pointResponse.data)); const pointId = pointResponse.data.data.id;
  const context = await api(base, '/api/merchant/assisted-orders/context', { cookie: merchantCookie });
  assert.equal(context.status, 200, JSON.stringify(context.data)); assert.ok(context.data.data.products.some((row) => row.id === productId));
  assert.equal(context.data.data.servicePoints.find((row) => row.id === pointId).activeOrderCount, 0);

  const assistedOrder = { requestId: 'assisted_pg_order_creation_request_001', customerName: 'Client PostgreSQL', customerPhone: '+225 0700000123',
    orderType: 'dine_in', servicePointId: pointId, confirmOccupiedPoint: false, paymentMethod: 'mobile_money', discountAmountXof: 300,
    note: 'Saisie de test PostgreSQL', items: [{ productId, quantity: 1 }] };
  const createdOrder = await api(base, '/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: assistedOrder });
  assert.equal(createdOrder.status, 201, JSON.stringify(createdOrder.data));
  assert.equal(createdOrder.data.data.order.source, 'merchant_assisted'); assert.equal(createdOrder.data.data.order.paymentStatus, 'not_recorded');
  assert.equal(createdOrder.data.data.order.grandTotalXof, 1200);
  const retry = await api(base, '/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: assistedOrder });
  assert.equal(retry.status, 200, JSON.stringify(retry.data)); assert.equal(retry.data.data.idempotent, true);
  assert.equal(retry.data.data.order.reference, createdOrder.data.data.order.reference, 'retry after the table has become occupied returns the same transaction, not a false conflict');
  const unconfirmedSecond = await api(base, '/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: {
    ...assistedOrder, requestId: 'assisted_pg_order_creation_request_002', customerName: 'Deuxième Client',
  } });
  assert.equal(unconfirmedSecond.status, 409); assert.equal(unconfirmedSecond.data.code, 'OCCUPIED_SERVICE_POINT');
  const confirmedSecond = await api(base, '/api/merchant/assisted-orders', { cookie: merchantCookie, method: 'POST', body: {
    ...assistedOrder, requestId: 'assisted_pg_order_creation_request_002', customerName: 'Deuxième Client', confirmOccupiedPoint: true,
  } });
  assert.equal(confirmedSecond.status, 201, JSON.stringify(confirmedSecond.data));

  const pgClient = new Client({ connectionString: isolatedUrl.toString() }); await pgClient.connect();
  try {
    const rows = await pgClient.query('SELECT source,payment_status AS "paymentStatus",created_by_type AS "createdByType",discount_amount_xof AS "discountAmountXof" FROM merchant_orders WHERE merchant_id=$1 ORDER BY created_at', [createdMerchant.data.data.id]);
    assert.equal(rows.rowCount, 2); assert.ok(rows.rows.every((row) => row.source === 'merchant_assisted' && row.paymentStatus === 'not_recorded' && row.createdByType === 'merchant'));
    const stock = await pgClient.query('SELECT stock_quantity AS quantity FROM merchant_products WHERE id=$1', [productId]); assert.equal(Number(stock.rows[0].quantity), 3, 'only the two distinct orders reserve stock; idempotent retry reserves none');
    const events = await pgClient.query("SELECT COUNT(*)::int AS count FROM merchant_order_events e JOIN merchant_orders o ON o.id=e.order_id WHERE o.merchant_id=$1 AND e.actor_type='merchant'", [createdMerchant.data.data.id]); assert.equal(events.rows[0].count, 2);
    const audits = await pgClient.query("SELECT COUNT(*)::int AS count FROM audit_logs WHERE entity_type='merchant' AND action='assisted_order_created' AND entity_id IN (SELECT id FROM merchant_orders WHERE merchant_id=$1)", [createdMerchant.data.data.id]); assert.equal(audits.rows[0].count, 2);
  } finally { await pgClient.end(); }

  const visibleHistory = await api(base, '/api/merchant/orders', { cookie: merchantCookie });
  assert.equal(visibleHistory.status, 200); assert.equal(visibleHistory.data.data.filter((row) => row.source === 'merchant_assisted').length, 2);
  const occupiedContext = await api(base, '/api/merchant/assisted-orders/context', { cookie: merchantCookie });
  assert.equal(occupiedContext.data.data.servicePoints.find((row) => row.id === pointId).activeOrderCount, 2);
});
