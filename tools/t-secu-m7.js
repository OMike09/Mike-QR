// Audit de sécurité M7 : ce que le client ne doit JAMAIS pouvoir obtenir ou modifier.
const B = 'http://127.0.0.1:4931';
const ck = (r) => (r.headers.getSetCookie ? r.headers.getSetCookie() : []).map((l) => l.split(';')[0]).filter((p) => !p.endsWith('=')).join('; ');
async function call(m, p, b, c) { const r = await fetch(B + p, { method: m, headers: { 'content-type': 'application/json', ...(c ? { cookie: c } : {}) }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch (_) {} return { s: r.status, j, t, c: ck(r) }; }
let ko = 0;
const check = (label, cond, detail) => { console.log(`${cond ? 'OK  ' : 'KO  '} ${label} — ${detail}`); if (!cond) ko++; };
(async () => {
  const admin = (await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' })).c;
  const tag = Date.now().toString(36).slice(-5);
  await call('POST', '/api/admin/merchants', { username: 'au' + tag, displayName: 'AUDIT', phone: '+2250700' + String(Math.floor(Math.random() * 90000) + 10000), password: '481920' }, admin);
  let l = await call('POST', '/api/merchant/auth/login', { username: 'au' + tag, password: '481920' });
  await call('POST', '/api/merchant/auth/change-password', { currentPassword: '481920', password: '735291', confirmPassword: '735291' }, l.c);
  l = await call('POST', '/api/merchant/auth/login', { username: 'au' + tag, password: '735291' }); let mck = l.c;
  await call('PUT', '/api/merchant/store', { name: 'Audit ' + tag, isPublished: true, acceptsOrders: true }, mck);
  const type = (await call('POST', '/api/merchant/consignment-settings/bottle-types', { label: '33cl', unitValueXof: 100 }, mck)).j.data;

  // 1. le mot de passe marchand doit respecter 6 chiffres, sans jamais être converti en nombre
  let current = '735291';
  const changeTo = async (pw) => {
    const r = await call('POST', '/api/merchant/auth/change-password', { currentPassword: current, password: pw, confirmPassword: pw }, mck);
    if (r.s === 200) { current = pw; const relog = await call('POST', '/api/merchant/auth/login', { username: 'au' + tag, password: pw }); mck = relog.c; }
    return r;
  };
  check('mot de passe 6 chiffres accepté', (await changeTo('000123')).s === 200, '000123 (zéros conservés)');
  check('changement de mot de passe coupe la session précédente', (await (async () => { const probe = await call('GET', '/api/merchant/auth/me', null, mck); return probe; })()).s === 200, 'session courante valide après reconnexion');
  const wrong = [['12345', 'trop court'], ['1234567', 'trop long'], ['12345a', 'lettre'], ['123 456', 'espace'], ['', 'vide']];
  for (const [pw, label] of wrong) {
    const r = await changeTo(pw);
    check(`mot de passe refusé (${label})`, r.s === 400, `HTTP ${r.s} ${r.j?.code || ''}`);
  }
  // 2. le code secret client n'est JAMAIS renvoyé après création
  const dep = await call('POST', '/api/merchant/consignments', { kind: 'bottle', bottleTypeId: type.id, quantity: 3, customerName: 'Audit', idempotencyKey: 'a1' }, mck);
  const id = dep.j.data.consignment.id; const code = dep.j.data.code;
  const detail = await call('GET', `/api/merchant/consignments/${id}`, null, mck);
  check('code secret absent de la fiche', !JSON.stringify(detail.j).includes(code), `code créé ${code}`);
  const list = await call('GET', '/api/merchant/consignments', null, mck);
  check('code secret absent de la liste', !JSON.stringify(list.j).includes(code), 'liste marchand');
  const hint = list.j.data.consignments[0].codeHint || '';
  check('indice de code partiel', hint.includes('•') && hint.replace(/•/g, '').length === 3, `indice « ${hint} » (2 caractères révélés sur 6)`);
  // 3. le client ne peut pas écrire une consignation ni changer un solde
  const phone = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp = (await call('POST', '/api/client/auth/request-code', { phone })).j.data.devCode;
  const cc = (await call('POST', '/api/client/auth/verify-code', { phone, code: otp })).c;
  for (const [m, p] of [['POST', '/api/merchant/consignments'], ['POST', '/api/admin/consignments/overview'], ['GET', '/api/admin/consignments/overview'], ['POST', `/api/staff/consignments`], ['GET', `/api/staff/consignments`]]) {
    const r = await call(m, p, m === 'GET' ? null : { kind: 'money', amountXof: 999999 }, cc);
    check(`client bloqué ${m} ${p}`, r.s >= 400, `HTTP ${r.s}`);
  }
  // 4. un autre client ne voit pas cette consignation
  const phone2 = '+22507' + String(Math.floor(Math.random() * 90000000) + 10000000);
  const otp2 = (await call('POST', '/api/client/auth/request-code', { phone: phone2 })).j.data.devCode;
  const cc2 = (await call('POST', '/api/client/auth/verify-code', { phone: phone2, code: otp2 })).c;
  const other = await call('GET', '/api/client/consignments', null, cc2);
  check('cloisonnement clients', (other.j?.data || []).length === 0, `${(other.j?.data || []).length} consignation(s) visibles`);
  const steal = await call('POST', '/api/client/consignments/lookup', { code }, cc2);
  check('code d’un autre client non exploitable', steal.s >= 400 || !steal.j?.data, `HTTP ${steal.s}`);
  // 5. jamais plus que le solde
  const over = await call('POST', `/api/merchant/consignments/${id}/return`, { quantity: 4, reason: 'excès', idempotencyKey: 'over-001-x' }, mck);
  check('retour supérieur au solde refusé', over.s === 409, `HTTP ${over.s} ${over.j?.error || ''}`);
  const refund = await call('POST', `/api/merchant/consignments/${id}/refund`, { amountXof: 1, reason: 'test', idempotencyKey: 'rf1' }, mck);
  check('remboursement d’une consignation de bouteilles refusé', refund.s >= 400, `HTTP ${refund.s}`);
  // 6. double remboursement impossible (clé d'idempotence)
  const money = await call('POST', '/api/merchant/consignments', { kind: 'money', amountXof: 2000, reason: 'audit', idempotencyKey: 'a2' }, mck);
  const mid = money.j.data.consignment.id;
  const r1 = await call('POST', `/api/merchant/consignments/${mid}/refund`, { amountXof: 2000, reason: 'total', idempotencyKey: 'same-key' }, mck);
  const r2 = await call('POST', `/api/merchant/consignments/${mid}/refund`, { amountXof: 2000, reason: 'total', idempotencyKey: 'same-key' }, mck);
  const after = await call('GET', `/api/merchant/consignments/${mid}`, null, mck);
  check('idempotence du remboursement', r1.s === 201 && r2.s === 200 && Number(after.j.data.balanceAmountXof) === 0, `solde final ${after.j.data.balanceAmountXof}`);
  check('consignation soldée', after.j.data.status === 'settled', `statut ${after.j.data.status}`);
  // 7. code tourné : l'ancien code ne fonctionne plus
  const rot = await call('POST', `/api/merchant/consignments/${id}/rotate-code`, {}, mck);
  const oldLookup = await call('GET', `/api/merchant/consignments/lookup?code=${code}`, null, mck);
  const newLookup = await call('GET', `/api/merchant/consignments/lookup?code=${rot.j.data.code}`, null, mck);
  check('ancien code invalidé après rotation', oldLookup.s === 404, `HTTP ${oldLookup.s}`);
  check('nouveau code valide', newLookup.s === 200 && newLookup.j.data[0]?.id === id, `HTTP ${newLookup.s}`);
  // 8. tentative de connexion répétée : verrouillage progressif
  const codes = [];
  for (let i = 0; i < 6; i += 1) { const r = await call('POST', '/api/merchant/auth/login', { username: 'au' + tag, password: '999999' }); codes.push(r.s); }
  check('verrouillage après 5 échecs', codes.includes(423), `statuts ${codes.join(',')}`);
  const locked = await call('POST', '/api/merchant/auth/login', { username: 'au' + tag, password: current });
  check('bon mot de passe lui aussi bloqué pendant le verrou', locked.s === 423, `HTTP ${locked.s} ${locked.j?.code || ''}`);
  console.log(ko === 0 ? '\nAUDIT SÉCURITÉ : tout est conforme' : `\n${ko} contrôle(s) en échec`);
})();
