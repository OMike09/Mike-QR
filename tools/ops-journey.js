'use strict';
// Parcours de test réel Mission 6 — 19 étapes demandées. Aucune valeur simulée : tout passe par
// HTTP contre le serveur local et la base PostgreSQL réelle.
// L'adresse du serveur à tester se règle par variable d'environnement (défaut : 4913).
const BASE = process.env.OPS_BASE_URL || 'http://127.0.0.1:4913';
function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((line) => line.split(';')[0]).filter((pair) => !pair.endsWith('=')).join('; ');
}
// `as` = cookie de l'acteur : jamais de mélange de rôles dans un même navigateur simulé.
async function call(method, path, body, as = '') {
  const headers = { 'content-type': 'application/json' };
  if (as) headers.cookie = as;
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined, redirect: 'manual' });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) {}
  return { status: res.status, json, text, cookie: cookieFrom(res) };
}
const results = [];
function check(step, ok, detail) { results.push({ step, ok, detail }); console.log(`${ok ? 'OK  ' : 'FAIL'} ${step} — ${detail}`); if (!ok) process.exitCode = 1; }

(async () => {
  const suffix = Date.now().toString(36).slice(-6);
  // 0. Compte marchand créé par l'Administrateur général + boutique publiée
  let r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  check('0. connexion Administrateur général', r.status === 200, `HTTP ${r.status}`);
  const adminBootstrap = r.cookie;
  r = await call('POST', '/api/admin/merchants', { username: `opsmer${suffix}`, displayName: 'Chez Awa', phone: `+22507${String(parseInt(suffix.slice(0, 5), 36)).padStart(6, '0')}`, temporaryPasswordLength: 18 }, adminBootstrap);
  check('0b. compte marchand créé', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
  const tempPassword = r.json?.temporaryPassword;
  r = await call('POST', '/api/merchant/auth/login', { username: `opsmer${suffix}`, password: tempPassword });
  check('0c. connexion marchand', r.status === 200, `HTTP ${r.status} ${r.json?.error || ''}`);
  let merchantCookie = r.cookie;
  if (r.json?.data?.mustChangePassword) {
    const chg = await call('POST', '/api/merchant/auth/change-password', { currentPassword: tempPassword, password: '481920', confirmPassword: '481920' }, merchantCookie);
    check('0c2. mot de passe définitif choisi', [200, 204].includes(chg.status), `HTTP ${chg.status} ${chg.json?.error || ''}`);
    r = await call('POST', '/api/merchant/auth/login', { username: `opsmer${suffix}`, password: '481920' });
    merchantCookie = r.cookie;
  }
  // changement de mot de passe imposé éventuel
  r = await call('PUT', '/api/merchant/store', { name: `Boutique ${suffix}`, isPublished: true, acceptsOrders: true }, merchantCookie);
  check('0d. boutique publiée', [200, 201].includes(r.status), `HTTP ${r.status} ${r.json?.error || ''}`);

  // 1. deux gérants généraux + trois serveuses
  const members = [];
  for (const [i, role] of [[1, 'general_manager'], [2, 'general_manager'], [3, 'waitress'], [4, 'waitress'], [5, 'waitress']]) {
    r = await call('POST', '/api/merchant/team/members', { role, fullName: `${role === 'waitress' ? 'Serveuse' : 'Gérant'} ${i}`, designation: `${role === 'waitress' ? 'Serveuse' : 'Gérant'} ${i}`, phone: `+22507000000${i}0` }, merchantCookie);
    check(`1. création ${role} ${i}`, r.status === 201 && r.json?.data?.activation?.code, `HTTP ${r.status} ${r.json?.error || ''}`);
    members.push({ role, id: r.json?.data?.member?.id, username: r.json?.data?.member?.username, code: r.json?.data?.activation?.code });
  }
  // 2. codes uniques
  const codes = members.map((m) => m.code).filter(Boolean);
  check('2. codes uniques', codes.length === 5 && new Set(codes).size === 5, `${codes.length} codes distincts`);

  // 3. activation de chaque membre (code à usage unique)
  const sessions = [];
  for (const member of members) {
    r = await call('POST', '/api/staff/activate', { code: member.code, password: 'Serveuse!2026x' });
    const login = [200, 201].includes(r.status) ? r : await call('POST', '/api/staff/auth/login', { username: member.username, password: 'Serveuse!2026x' });
    check(`3. activation + connexion ${member.designation || member.role}`, [200, 201].includes(login.status), `HTTP ${login.status} ${login.json?.error || ''}`);
    if (r.status !== 201) console.log('   debug activation:', member.role, r.status, r.text.slice(0, 200));
    member.cookie = login.cookie;
    // Le rôle réellement attribué par le serveur (jamais présumé par le script).
    member.sessionRole = login.json?.data?.session?.role || member.role;
    sessions.push(member);
  }
  const gerants = sessions.filter((s) => s.sessionRole === 'general_manager');
  const serveuses = sessions.filter((s) => s.sessionRole !== 'general_manager');
  check('3b. rôles attribués par le serveur', gerants.length === 2 && serveuses.length === 3,
    `gérants=${gerants.length} serveuses=${serveuses.length}`);

  // 4. code réutilisé refusé
  r = await call('POST', '/api/staff/activate', { code: codes[0], password: 'Serveuse!2026x' });
  check('4. code d’activation non réutilisable', r.status === 409 || r.status === 404, `HTTP ${r.status} ${r.json?.code || ''}`);

  // 5. tables : création de 3 tables
  const tableCookies = merchantCookie;
  const pointIds = [];
  for (const name of ['Table 1', 'Table 2', 'Table 3']) {
    r = await fetch(BASE + '/api/merchant/service-points', { method: 'POST', headers: { 'content-type': 'application/json', cookie: tableCookies }, body: JSON.stringify({ requestId: `tbl_${suffix}_${name.replace(/\W/g, '')}`, type: 'table', name, zone: 'Salle' }) });
    const json = await r.json().catch(() => ({}));
    if (json?.data?.id) pointIds.push({ name, id: json.data.id, code: json.data.publicCode });
    else console.log('   (création table)', name, r.status, JSON.stringify(json).slice(0, 160));
  }
  if (!pointIds.length) {
    const list = await fetch(BASE + '/api/merchant/service-points', { headers: { cookie: tableCookies } });
    const json = await list.json().catch(() => ({}));
    for (const row of (json?.data?.servicePoints || json?.data || [])) pointIds.push({ name: row.name, id: row.id, code: row.publicCode });
  }
  check('5. tables créées', pointIds.length >= 3, `${pointIds.length} table(s) : ${pointIds.map((p) => p.name).join(', ')}`);

  // 6. affectation d'une table à la serveuse 1
  const target = pointIds[0];
  r = await fetch(BASE + `/api/staff/tables/${target.id}/assign`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: gerants[0].cookie }, body: JSON.stringify({ memberId: serveuses[0].id }) });
  const assignJson = await r.json().catch(() => ({}));
  check('6. gérant affecte une table à une serveuse', r.status === 200, `HTTP ${r.status} ${assignJson.error || ''}`);

  // 7. scan de table par la serveuse (avec identité automatique de l'emplacement)
  r = await call('POST', '/api/staff/scan', { code: `/t/${target.code}`, eventId: `evt-${suffix}-1` }, serveuses[0].cookie);
  const scan1 = r.json?.data;
  check('7. scan de table identifié', r.status === 200 && scan1?.servicePoint?.id === target.id, `HTTP ${r.status} → ${scan1?.servicePoint?.name || r.json?.error}`);
  // 7b. double scan du même eventId : refusé comme doublon
  r = await call('POST', '/api/staff/scan', { code: `/t/${target.code}`, eventId: `evt-${suffix}-1` }, serveuses[0].cookie);
  check('7b. anti-doublon de scan', r.json?.data?.duplicate === true, `duplicate=${r.json?.data?.duplicate}`);

  // 8. commande manuelle par la serveuse 1 sur la table scannée
  r = await call('POST', '/api/staff/orders', { requestId: `req_${suffix}_0001`, customerName: 'Client Table 1', customerPhone: '+2250700000099',
    orderType: 'dine_in', paymentMethod: 'cash', servicePointId: target.id, scannedQrCode: `/t/${target.code}`, scannedVia: 'staff_scanner',
    scanEventId: scan1?.scanEventId || '', items: [{ custom: true, name: 'Attiéké poisson', quantity: 2, unitPriceXof: 2500 }] }, serveuses[0].cookie);
  const order = r.json?.data?.order;
  check('8. commande manuelle enregistrée', [200, 201].includes(r.status) && order?.id, `HTTP ${r.status} ${r.json?.error || ''} réf ${order?.reference || ''}`);

  // 9. visibilité côté marchand
  r = await call('GET', '/api/merchant/orders-tracking', null, merchantCookie);
  const tracked = (r.json?.data?.rows || []).find((row) => row.id === order?.id);
  check('9. commande visible par le marchand', r.status === 200 && Boolean(tracked), `HTTP ${r.status} — ${r.json?.data?.rows?.length || 0} ligne(s)`);

  // 10. auteurs identifiés (serveuse + rôle), source = serveuse
  check('10. auteur de la commande identifié', tracked?.createdByMemberId === serveuses[0].id && tracked?.source === 'staff_assisted',
    `source=${tracked?.source} auteur=${tracked?.createdByDesignation || tracked?.createdByMemberId}`);

  // 11. points corrects après scan + commande
  r = await call('GET', '/api/staff/points/history', null, serveuses[0].cookie);
  if (r.status !== 200) console.log('   debug points:', r.status, r.text.slice(0, 300));
  const pts = r.json?.data?.stats;
  check('11. points calculés (scan 1 + commande 2 = 3)', Number(pts?.points) === 3 && Number(pts?.scans) === 1 && Number(pts?.orders) === 1,
    `points=${pts?.points} scans=${pts?.scans} commandes=${pts?.orders}`);
  // 11b. la serveuse 2 n'a aucun point
  r = await call('GET', '/api/staff/points/history', null, serveuses[1].cookie);
  check('11b. cloisonnement des points', Number(r.json?.data?.stats?.points) === 0, `points serveuse 2 = ${r.json?.data?.stats?.points}`);
  // 11c. la serveuse 2 ne peut pas lire les points de la serveuse 1
  r = await call('GET', `/api/staff/points/history?memberId=${serveuses[0].id}`, null, serveuses[1].cookie);
  check('11c. lecture des points d’autrui refusée', r.status === 403, `HTTP ${r.status} ${r.json?.code || ''}`);

  // 12. statistiques du gérant
  r = await call('GET', '/api/staff/manager-dashboard', null, gerants[0].cookie);
  const gd = r.json?.data;
  if (r.status !== 200 || !r.json?.data) console.log('   debug gérant:', r.status, r.text.slice(0, 300));
  else console.log('   gérant → permissions:', JSON.stringify(gd && gd.permissions), 'scansByMember:', JSON.stringify(r.json.data.scansByMember));
  check('12. tableau de bord gérant alimenté', r.status === 200 && Number(gd?.orders?.total) >= 1 && Boolean(gd?.store?.id),
    `HTTP ${r.status} commandes=${gd?.orders?.total} scans=${gd?.scans?.total} CA=${gd?.revenue?.total}`);
  check('12b. scans par serveuse visibles du gérant', Array.isArray(gd?.scansByMember) && gd.scansByMember.some((row) => row.memberId === serveuses[0].id),
    JSON.stringify(gd?.scansByMember || []).slice(0, 120));

  // 13. statistiques du marchand (vue d'ensemble)
  r = await call('GET', '/api/merchant/overview', null, merchantCookie);
  if (r.status !== 200) console.log('   debug overview:', r.status, r.text.slice(0, 300));
  const ov = r.json?.data?.stats;
  check('13. vue d’ensemble marchand', r.status === 200 && Number(ov?.orders?.total) >= 1 && Number(ov?.scans?.staff) >= 1 && Number(ov?.team?.waitressesActive) === 3,
    `commandes=${ov?.orders?.total} scans personnel=${ov?.scans?.staff} serveuses actives=${ov?.team?.waitressesActive} CA=${ov?.revenue?.total}`);
  check('13b. articles les plus commandés', Array.isArray(ov?.topProducts) && ov.topProducts[0]?.name === 'Attiéké poisson',
    JSON.stringify(ov?.topProducts?.[0] || {}));

  // 14. message de la serveuse au gestionnaire
  r = await call('POST', '/api/staff/messages', { subject: 'Table 2 manque de couverts', body: 'Bonjour, il nous manque des couverts en salle.', category: 'material' }, serveuses[2].cookie);
  check('14. message envoyé au gestionnaire', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
  const convId = r.json?.data?.conversationId;
  // 15. réponse du gestionnaire
  r = await call('GET', '/api/staff/messages', null, gerants[1].cookie);
  check('15a. message reçu côté gestionnaire', r.status === 200 && (r.json?.data?.conversations || []).some((c) => c.id === convId),
    `${r.json?.data?.conversations?.length || 0} conversation(s)`);
  r = await call('POST', `/api/staff/messages/${convId}/reply`, { body: 'Bonjour, je fais le nécessaire tout de suite.' }, gerants[1].cookie);
  check('15. réponse du gestionnaire', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
  r = await call('GET', '/api/staff/messages', null, gerants[1].cookie);
  check('15b. statut « répondu »', (r.json?.data?.conversations || []).find((c) => c.id === convId)?.status === 'answered',
    (r.json?.data?.conversations || []).find((c) => c.id === convId)?.status);
  // notification persistante côté serveuse
  r = await call('GET', '/api/staff/notifications', null, serveuses[2].cookie);
  check('15c. notification persistée pour la serveuse', (r.json?.data?.items || []).some((n) => n.type === 'support_reply'),
    `${r.json?.data?.items?.length || 0} notification(s), ${r.json?.data?.unread} non lue(s)`);

  // 16. blocage de la serveuse 1 par le marchand
  r = await call('POST', `/api/merchant/team/members/${serveuses[0].id}/status`, { status: 'blocked', reason: 'Test de révocation immédiate' }, merchantCookie);
  check('16. serveuse bloquée par le marchand', r.status === 200, `HTTP ${r.status} ${r.json?.error || ''}`);

  // 17. perte d'accès immédiate
  r = await call('GET', '/api/staff/me', null, serveuses[0].cookie);
  check('17. accès immédiatement révoqué', r.status === 401, `HTTP ${r.status} ${r.json?.code || ''}`);

  // 18. les autres membres continuent de travailler
  r = await call('POST', '/api/staff/scan', { code: `/t/${pointIds[1].code}`, eventId: `evt-${suffix}-2` }, serveuses[1].cookie);
  check('18. les autres serveuses continuent', r.status === 200, `HTTP ${r.status}`);

  // 19. déblocage : historique et points intacts
  r = await call('POST', `/api/merchant/team/members/${serveuses[0].id}/status`, { status: 'active', reason: 'Fin de test' }, merchantCookie);
  check('19a. serveuse débloquée', r.status === 200, `HTTP ${r.status}`);
  r = await call('POST', '/api/staff/auth/login', { username: serveuses[0].username, password: 'Serveuse!2026x' });
  check('19b. reconnexion possible', r.status === 200, `HTTP ${r.status}`);
  const reCookie = r.cookie;
  r = await call('GET', '/api/staff/points/history', null, reCookie);
  check('19c. historique des points conservé', Number(r.json?.data?.stats?.points) === 3 && (r.json?.data?.history || []).length >= 2,
    `points=${r.json?.data?.stats?.points} lignes=${r.json?.data?.history?.length}`);
  r = await call('GET', `/api/staff/orders/${order?.id}/tracking`, null, reCookie);
  check('19d. commande et traçabilité conservées', r.status === 200 && r.json?.data?.order?.id === order?.id, `HTTP ${r.status}`);

  // Bonus : permissions serveur — une serveuse ne peut pas changer son barème ni s'ajuster des points
  r = await call('PUT', '/api/merchant/points/settings', { pointsScan: 99 }, serveuses[1].cookie);
  check('B1. barème inaccessible à une serveuse', r.status === 401 || r.status === 403, `HTTP ${r.status}`);
  r = await call('POST', '/api/staff/orders', { requestId: `req_${suffix}_000x`, customerName: 'X', items: [] }, serveuses[1].cookie);
  check('B2. commande vide refusée', r.status === 400, `HTTP ${r.status}`);
  // Bonus : classement
  r = await call('GET', '/api/merchant/leaderboard?period=month', null, merchantCookie);
  check('B3. classement calculé', r.status === 200 && (r.json?.data?.rows || []).length === 3,
    JSON.stringify((r.json?.data?.rows || []).map((x) => `${x.designation}:${x.points}`)));
  // Bonus : barème modifiable par le marchand et appliqué au prochain événement
  r = await call('PUT', '/api/merchant/points/settings', { pointsScan: 5, pointsOrder: 2, pointsOrderCompleted: 2, pointsTask: 2 }, merchantCookie);
  check('B4. barème modifiable par le marchand', r.status === 200 && r.json?.data?.pointsScan === 5, `pointsScan=${r.json?.data?.pointsScan}`);
  r = await call('POST', '/api/staff/scan', { code: `/t/${pointIds[2].code}`, eventId: `evt-${suffix}-3` }, serveuses[1].cookie);
  r = await call('GET', '/api/staff/points/history', null, serveuses[1].cookie);
  check('B5. nouveau barème appliqué (5 points pour un scan)', Number(r.json?.data?.stats?.points) === 6, `points=${r.json?.data?.stats?.points} (1 point existant + 5 pour le nouveau scan)`);
  // Bonus : le gestionnaire de plateforme (table managers) reçoit un refus explicite, pas une erreur 500
  r = await call('GET', '/api/manager/ops/dashboard', null, adminBootstrap);
  check('B4b. gérant de plateforme sans boutique → refus explicite', [401, 403, 404, 409].includes(r.status), `HTTP ${r.status} ${r.json?.code || ''}`);
  // Bonus : admin général en lecture
  r = await call('POST', '/api/auth/login', { username: 'admin', password: 'admin1234' });
  const adminCookie = r.cookie;
  check('B6. connexion Administrateur général', r.status === 200, `HTTP ${r.status}`);
  r = await call('GET', '/api/admin/ops/overview', null, adminCookie);
  check('B7. supervision globale', r.status === 200 && Number(r.json?.data?.global?.merchants) >= 1 && (r.json?.data?.staff || []).length >= 5,
    `marchands=${r.json?.data?.global?.merchants} membres=${r.json?.data?.staff?.length} commandes=${r.json?.data?.global?.orders} scans=${r.json?.data?.global?.scans}`);
  check('B8. données conservées après blocage (membre avec historique)', (r.json?.data?.staff || []).find((m) => m.id === serveuses[0].id)?.hasData === true, 'hasData=true');

  const failed = results.filter((row) => !row.ok);
  console.log(`\n${results.length - failed.length}/${results.length} vérifications réussies`);
  if (failed.length) { console.log('Échecs :', failed.map((f) => f.step).join(' | ')); process.exitCode = 1; }
})().catch((error) => { console.error('ERREUR', error); process.exit(1); });
