// Crée une boutique de test avec un gérant général et une serveuse, et renvoie les sessions.
const B='http://127.0.0.1:4931';
const ck = (r) => r.headers.getSetCookie().map((l) => l.split(';')[0]).join('; ');
async function j(method, path, body, cookie) {
  const r = await fetch(B + path, { method, headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => null), c: ck(r) };
}
module.exports = async function setup() {
  // La connexion PDG pose aussi des cookies de purge pour les autres rôles : on ne garde QUE le
  // cookie administrateur, sinon le navigateur simulé envoie des cookies vides qui écrasent la session.
  const admin = ck(await fetch(B + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'admin1234' }) }))
    .split('; ').filter((pair) => pair.startsWith('qria_admin=')).join('; ');
  const tag = Date.now().toString(36).slice(-5) + Math.random().toString(36).slice(2, 4);
  await j('POST', '/api/admin/merchants', { username: 'eq' + tag, displayName: 'EQ', phone: '+2250700' + String(Math.floor(Math.random() * 90000) + 10000), password: '481920' }, admin);
  let mck = (await j('POST', '/api/merchant/auth/login', { username: 'eq' + tag, password: '481920' })).c;
  await j('POST', '/api/merchant/auth/change-password', { currentPassword: '481920', password: '735291', confirmPassword: '735291' }, mck);
  mck = (await j('POST', '/api/merchant/auth/login', { username: 'eq' + tag, password: '735291' })).c;
  await j('PUT', '/api/merchant/store', { name: 'EQ ' + tag, isPublished: true, acceptsOrders: true }, mck);
  const type = (await j('POST', '/api/merchant/consignment-settings/bottle-types', { label: '33cl', unitValueXof: 100 }, mck)).j.data;
  const manager = (await j('POST', '/api/merchant/team/members', { role: 'general_manager', fullName: 'Gérant Test', designation: 'Gérant Test' }, mck));
  const waitress = (await j('POST', '/api/merchant/team/members', { role: 'waitress', fullName: 'Awa Test', designation: 'Awa Test' }, mck));
  const mgr = await j('POST', '/api/staff/activate', { code: manager.j.data.activation.code, password: 'Gerant123' });
  const wts = await j('POST', '/api/staff/activate', { code: waitress.j.data.activation.code, password: 'Serveuse123' });
  return { tag, merchant: mck, type, adminCookie: admin, managerCookie: mgr.c, waitressCookie: wts.c,
    managerPerms: mgr.j.data.session.permissions, waitressPerms: wts.j.data.session.permissions,
    managerRole: mgr.j.data.session.role, waitressRole: wts.j.data.session.role, j, B };
};
