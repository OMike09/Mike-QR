// Crée le compte de recette par le vrai parcours public, puis l'approuve via le PDG.
const base = process.env.BASE || 'http://127.0.0.1:3720';
const H = { 'Content-Type': 'application/json', Origin: base };
let cookies = '';
const keep = (r) => { cookies = (r.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; '); };
(async () => {
  let r = await fetch(base + '/api/auth/login', { method: 'POST', headers: H, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) });
  keep(r); if (r.status !== 200) throw new Error('PDG: ' + r.status);
  const stamp = Date.now().toString().slice(-6);
  const body = { contactName: 'Awa Koné', businessName: 'Maquis Le Baobab ' + stamp, username: 'baobab' + stamp,
    phone: '+225 07 ' + stamp.slice(0,2) + ' 00 00 ' + stamp.slice(2,4), email: 'baobab' + stamp + '@example.com', city: 'Abidjan', address: 'Cocody, Abidjan',
    sector: 'maquis', activityDomain: 'maquis', password: '482913', requestId: 'req-' + stamp, description: 'Maquis de recette M14' };
  r = await fetch(base + '/api/public/merchant-registrations', { method: 'POST', headers: { ...H, Cookie: cookies }, body: JSON.stringify(body) });
  if (r.status !== 201) throw new Error('inscription: ' + r.status + ' ' + (await r.text()).slice(0, 200));
  const reg = (await r.json()).data;
  r = await fetch(base + '/api/admin/merchant-registrations?status=pending&limit=5', { headers: { Cookie: cookies } });
  const raw = (await r.json()).data;
  const list = Array.isArray(raw) ? raw : (raw?.registrations || []);
  const target = list.find((x) => x.reference === reg.reference);
  r = await fetch(base + `/api/admin/merchant-registrations/${target.id}/decision`, { method: 'POST', headers: { ...H, Cookie: cookies }, body: JSON.stringify({ action: 'approve', note: 'Recette M14' }) });
  if (r.status !== 200) throw new Error('approbation: ' + r.status);
  const out = { username: body.username, password: body.password, reference: reg.reference, businessName: body.businessName };
  require('fs').writeFileSync(__dirname + '/recette.json', JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out));
})().catch((e) => { console.error('ECHEC', e.message); process.exit(1); });
