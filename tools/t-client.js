const B = process.env.BASE || 'http://127.0.0.1:4931';
const ck = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((l) => l.split(';')[0]).filter((p) => !p.endsWith('=')).join('; ');
const call = async (m, p, b, c) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: (b && m !== 'GET') ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { s: r.status, j, c: ck(r) };
};
(async () => {
  const phone = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);
  console.log('--- 1. demande de code ---');
  let r = await call('POST', '/api/client/auth/request-code', { phone });
  console.log(r.s, JSON.stringify(r.j?.data).slice(0, 220));
  const code = r.j?.data?.devCode;

  console.log('\n--- 2. code faux ---');
  r = await call('POST', '/api/client/auth/verify-code', { phone, code: '000001' });
  console.log(r.s, r.j?.error);

  console.log('\n--- 3. code correct ---');
  r = await call('POST', '/api/client/auth/verify-code', { phone, code });
  console.log(r.s, JSON.stringify(r.j?.data));
  const cc = r.c;

  console.log('\n--- 4. profil ---');
  r = await call('GET', '/api/client/auth/me', null, cc);
  console.log(r.s, JSON.stringify(r.j?.data));

  console.log('\n--- 5. commandes du client ---');
  r = await call('GET', '/api/client/orders', null, cc);
  console.log(r.s, 'nombre:', r.j?.data?.length);

  console.log('\n--- 6. consignations du client ---');
  r = await call('GET', '/api/client/consignments', null, cc);
  console.log(r.s, 'nombre:', r.j?.data?.length);

  console.log('\n--- 7. notifications ---');
  r = await call('GET', '/api/client/notifications', null, cc);
  console.log(r.s, 'nombre:', r.j?.data?.length);

  console.log('\n--- 8. sans session ---');
  r = await call('GET', '/api/client/orders');
  console.log(r.s, r.j?.code);
})();
