const B = process.env.BASE || 'http://127.0.0.1:4931';
const ck = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((l) => l.split(';')[0]).filter((p) => !p.endsWith('=')).join('; ');
const call = async (m, p, b, c) => {
  const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: (b && m !== 'GET') ? JSON.stringify(b) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { s: r.status, j, c: ck(r) };
};
(async () => {
  let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' }); const admin = r.c;
  const tag = Date.now().toString(36).slice(-5);
  let c = await call('POST', '/api/admin/merchants', { username: 'cs' + tag, displayName: 'Maquis Consigne', phone: '+22507005' + String(Math.floor(Math.random() * 9000) + 1000), password: '481920' }, admin);
  if (c.s !== 201) { console.log('création marchand échouée', c.s, JSON.stringify(c.j).slice(0, 200)); return; }
  let l = await call('POST', '/api/merchant/auth/login', { username: 'cs' + tag, password: '481920' }, {});
  await call('POST', '/api/merchant/auth/change-password', { currentPassword: '481920', password: '735291', confirmPassword: '735291' }, l.c);
  l = await call('POST', '/api/merchant/auth/login', { username: 'cs' + tag, password: '735291' }); const mck = l.c;
  if (l.s !== 200) { console.log('login marchand échoué', l.s, JSON.stringify(l.j).slice(0, 200)); return; }
  await call('PUT', '/api/merchant/store', { name: 'Maquis Consigne ' + tag, isPublished: true, acceptsOrders: true }, mck);
  console.log('boutique prête');

  console.log('\n--- types de bouteilles ---');
  let bt = await call('POST', '/api/merchant/consignment-settings/bottle-types', { label: 'Bouteille 33cl', reference: '33cl', unitValueXof: 100 }, mck);
  console.log('création type ->', bt.s, bt.j?.data?.label, bt.j?.data?.unitValueXof, 'FCFA', bt.s >= 400 ? JSON.stringify(bt.j).slice(0, 150) : '');
  if (bt.s >= 400) return;
  const typeId = bt.j.data.id;
  bt = await call('POST', '/api/merchant/consignment-settings/bottle-types', { label: 'Bouteille 65cl', reference: '65cl', unitValueXof: 150 }, mck);
  console.log('second type ->', bt.s);

  console.log('\n--- consignation de 5 bouteilles ---');
  const dep = await call('POST', '/api/merchant/consignments', { kind: 'bottle', customerName: 'Awa Koffi', customerPhone: '+2250708070807', bottleTypeId: typeId, quantity: 5, observation: 'Caisse laissée au comptoir', idempotencyKey: 'dep-' + tag }, mck);
  console.log('->', dep.s, dep.j?.data?.consignment?.reference, 'code:', dep.j?.data?.code, 'solde:', dep.j?.data?.consignment?.balanceQuantity, dep.s >= 400 ? JSON.stringify(dep.j).slice(0, 200) : '');
  if (dep.s >= 400) return;
  const code = dep.j.data.code; const cid = dep.j.data.consignment.id;

  console.log('\n--- double clic sur la création (même clé) ---');
  const dep2 = await call('POST', '/api/merchant/consignments', { kind: 'bottle', customerName: 'Awa Koffi', bottleTypeId: typeId, quantity: 5, idempotencyKey: 'dep-' + tag }, mck);
  console.log('->', dep2.s, 'idempotent:', dep2.j?.data?.idempotent, 'même fiche:', dep2.j?.data?.consignment?.id === cid);

  console.log('\n--- retrouver par le code secret ---');
  let look = await call('GET', '/api/merchant/consignments/lookup?code=' + code, null, mck);
  console.log('->', look.s, look.j?.data?.[0]?.reference, 'solde', look.j?.data?.[0]?.balanceQuantity);
  look = await call('GET', '/api/merchant/consignments/lookup?code=ZZZZZZ', null, mck);
  console.log('code faux ->', look.s, look.j?.error);

  console.log('\n--- retour de 2 bouteilles ---');
  const ret = await call('POST', `/api/merchant/consignments/${cid}/return`, { quantity: 2, idempotencyKey: 'ret-' + tag }, mck);
  console.log('->', ret.s, 'solde restant:', ret.j?.data?.consignment?.balanceQuantity);
  const retDup = await call('POST', `/api/merchant/consignments/${cid}/return`, { quantity: 2, idempotencyKey: 'ret-' + tag }, mck);
  console.log('rejeu même clé ->', retDup.s, 'idempotent:', retDup.j?.data?.idempotent, 'solde:', retDup.j?.data?.consignment?.balanceQuantity);
  const ret4 = await call('POST', `/api/merchant/consignments/${cid}/return`, { quantity: 4, idempotencyKey: 'ret4-' + tag }, mck);
  console.log('retour supérieur au solde ->', ret4.s, ret4.j?.error);

  console.log('\n--- consignation de 10 000 FCFA ---');
  const mon = await call('POST', '/api/merchant/consignments', { kind: 'money', customerName: 'Ibrahim Traoré', customerPhone: '+2250709070907', amountXof: 10000, reason: 'Avance sur prochaine visite', idempotencyKey: 'mon-' + tag }, mck);
  console.log('->', mon.s, mon.j?.data?.consignment?.reference, 'code:', mon.j?.data?.code, 'solde:', mon.j?.data?.consignment?.balanceAmountXof, mon.s >= 400 ? JSON.stringify(mon.j).slice(0, 200) : '');
  if (mon.s >= 400) return;
  const mid = mon.j.data.consignment.id;

  console.log('\n--- utilisation de 4 000 FCFA ---');
  const use = await call('POST', `/api/merchant/consignments/${mid}/use`, { amountXof: 4000, reason: 'Commande du 23/11', idempotencyKey: 'use-' + tag }, mck);
  console.log('->', use.s, 'solde:', use.j?.data?.consignment?.balanceAmountXof);
  const useDup = await call('POST', `/api/merchant/consignments/${mid}/use`, { amountXof: 4000, reason: 'Commande du 23/11', idempotencyKey: 'use-' + tag }, mck);
  console.log('rejeu ->', useDup.s, 'solde inchangé:', useDup.j?.data?.consignment?.balanceAmountXof);

  console.log('\n--- remboursement de 3 000 FCFA ---');
  const ref = await call('POST', `/api/merchant/consignments/${mid}/refund`, { amountXof: 3000, reason: 'Remboursement partiel', idempotencyKey: 'ref-' + tag }, mck);
  console.log('->', ref.s, 'solde:', ref.j?.data?.consignment?.balanceAmountXof, 'statut:', ref.j?.data?.consignment?.status);
  const ref2 = await call('POST', `/api/merchant/consignments/${mid}/refund`, { amountXof: 3000, reason: 'Remboursement partiel', idempotencyKey: 'ref-' + tag }, mck);
  console.log('second remboursement identique ->', ref2.s, 'solde:', ref2.j?.data?.consignment?.balanceAmountXof);
  const over = await call('POST', `/api/merchant/consignments/${mid}/refund`, { amountXof: 9999, idempotencyKey: 'over-' + tag }, mck);
  console.log('remboursement > solde ->', over.s, over.j?.error);

  console.log('\n--- statistiques ---');
  const st = await call('GET', '/api/merchant/consignments/stats', null, mck);
  console.log(JSON.stringify(st.j?.data));

  console.log('\n--- fiche détaillée (mouvements) ---');
  const det = await call('GET', `/api/merchant/consignments/${mid}`, null, mck);
  console.log('mouvements:', det.j?.data?.movements?.map((m) => `${m.type}:${m.amountDeltaXof}`).join(' | '));
  console.log('événements:', det.j?.data?.events?.length);
})();
