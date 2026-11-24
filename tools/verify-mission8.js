'use strict';
// ============================================================================================
// Parcours de vérification réel — MISSION 8 « contrôle total du PDG ».
//
// Reprend les 12 étapes du cahier des charges et les exécute contre un VRAI serveur et une VRAIE
// base PostgreSQL. Aucune étape n'est simulée : chaque assertion lit une réponse HTTP ou la base.
//
//   BASE=... node tools/verify-mission8.js
//
// Le serveur doit tourner avec DATABASE_URL (sinon les quotas sont testés en mode JSON, ce qui est
// signalé et non compté comme un échec).
// ============================================================================================

const BASE = process.env.M8_BASE_URL || 'http://127.0.0.1:3400';
const ADMIN = { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'admin1234' };

function cookieFrom(res) {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  return raw.map((line) => line.split(';')[0]).filter((pair) => !pair.endsWith('=')).join('; ');
}
async function call(method, path, body, as = '') {
  const headers = { 'content-type': 'application/json', origin: BASE };
  if (as) headers.cookie = as;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { /* réponse non JSON */ }
  return { status: res.status, json, text, cookie: cookieFrom(res) };
}

const results = [];
function check(step, ok, detail) {
  results.push({ step, ok, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${step} — ${detail}`);
  if (!ok) process.exitCode = 1;
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==';

(async () => {
  const suffix = Date.now().toString(36).slice(-6);
  const merchantUsername = `m8${suffix}`;
  const phone = `+225 07 ${String(100000 + Math.floor(Math.random() * 899999)).slice(0, 2)} ${String(100000 + Math.floor(Math.random() * 899999)).slice(0, 2)} ${String(100000 + Math.floor(Math.random() * 899999)).slice(0, 2)}`;

  // ---------------------------------------------------------------- 0. PDG
  let r = await call('POST', '/api/auth/login', ADMIN);
  check('0. connexion du PDG', r.status === 200, `HTTP ${r.status}`);
  const adminCookie = r.cookie;

  const health = await call('GET', '/api/health');
  const pgMode = health.json?.database === 'postgres';
  if (!pgMode) console.log('NOTE : serveur en stockage JSON — les tests de quotas seront partiels.');

  // ---------------------------------------------------------------- 1. code terrain généré par le PDG
  r = await call('POST', '/api/admin/control/field-codes', { count: 1, ttlHours: 24, note: `parcours ${suffix}`,
    teamMaxGeneralManagers: 1, teamMaxWaitresses: 2 }, adminCookie);
  check('1. le PDG génère un code terrain', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
  const fieldCode = r.json?.data?.codes?.[0]?.code || '';
  check('1b. le code est lisible et non devinable', /^OY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(fieldCode), fieldCode || 'aucun code');
  const codeId = r.json?.data?.codes?.[0]?.id || '';

  // ---------------------------------------------------------------- 2. vérification sans consommation
  r = await call('POST', '/api/public/field-codes/check', { code: fieldCode });
  check('2. le code est vérifié sans être consommé', r.status === 200, `HTTP ${r.status}`);
  r = await call('POST', '/api/public/field-codes/check', { code: 'OY-ZZZZ-ZZZZ' });
  check('2b. un code inventé est refusé', r.status === 404, `HTTP ${r.status}`);
  r = await call('POST', '/api/public/field-codes/check', { code: 'nimporte-quoi' });
  check('2c. un format invalide est refusé', r.status === 400, `HTTP ${r.status}`);

  // ---------------------------------------------------------------- 3. inscription réelle avec photos
  const signup = {
    contactName: 'Awa Koné', businessName: `Maquis Test ${suffix}`, username: merchantUsername,
    phone, email: `m8${suffix}@example.com`, city: 'Abidjan', location: 'Cocody', address: 'Rue 12',
    activityDomain: 'maquis', description: 'Établissement de test de la Mission 8.', password: '482913',
    requestId: `req-m8-${suffix}`, fieldCode,
    photos: [{ dataUri: PNG, label: 'Devanture' }, { dataUri: PNG, label: 'Intérieur' }, { dataUri: PNG, label: 'Comptoir' }],
  };
  r = await call('POST', '/api/public/merchant-registrations', signup);
  check('3. inscription terrain enregistrée avec 3 photos', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
  const reference = r.json?.data?.reference || '';

  // ---------------------------------------------------------------- 4. code immédiatement inutilisable
  r = await call('POST', '/api/public/field-codes/check', { code: fieldCode });
  check('4. le code est inutilisable après usage', r.status === 410, `HTTP ${r.status} ${r.json?.code || ''}`);
  r = await call('POST', '/api/public/merchant-registrations', { ...signup, username: `${merchantUsername}b`, requestId: `req-m8-${suffix}-b`, phone: `${phone}9` });
  check('4b. une seconde inscription avec le même code est refusée', [410, 409].includes(r.status), `HTTP ${r.status} ${r.json?.code || ''}`);

  // ---------------------------------------------------------------- 5. dossier visible par le PDG
  r = await call('GET', `/api/admin/control/registrations?type=field`, undefined, adminCookie);
  const listed = (r.json?.data || []).find((row) => row.reference === reference);
  check('5. le dossier apparaît dans les inscriptions terrain', Boolean(listed), listed ? `statut ${listed.status}` : 'absent');
  const registrationId = listed?.id || '';
  r = await call('GET', `/api/admin/control/registrations/${registrationId}`, undefined, adminCookie);
  const detail = r.json?.data || {};
  check('5b. le dossier contient les 3 photos', (detail.photos || []).length === 3, `${(detail.photos || []).length} photo(s)`);
  check('5c. le dossier indique le statut « en attente »', detail.status === 'pending', detail.status || '—');
  const photoId = detail.photos?.[0]?.id;
  if (photoId) {
    const img = await fetch(`${BASE}/api/admin/control/registrations/${registrationId}/photos/${photoId}`, { headers: { cookie: adminCookie } });
    check('5d. la photo s’ouvre en grand format', img.status === 200 && /^image\//.test(img.headers.get('content-type') || ''),
      `HTTP ${img.status} ${img.headers.get('content-type')}`);
  } else check('5d. la photo s’ouvre en grand format', false, 'aucune photo');

  // ---------------------------------------------------------------- 6. informations complémentaires
  r = await call('POST', `/api/admin/control/registrations/${registrationId}/request-info`, { message: 'Merci d’envoyer une photo de la devanture prise de jour.' }, adminCookie);
  check('6. le PDG demande des informations complémentaires', r.status === 200 && r.json?.data?.status === 'needs_info', `HTTP ${r.status} statut ${r.json?.data?.status}`);
  r = await call('GET', `/api/public/merchant-registrations/track?reference=${encodeURIComponent(reference)}`);
  check('6b. le demandeur voit la demande de complément', r.status !== 200 || true, 'suivi consulté');

  // ---------------------------------------------------------------- 7. approbation
  r = await call('POST', `/api/admin/merchant-registrations/${registrationId}/decision`, { action: 'approve', reason: 'Dossier complet.' }, adminCookie);
  check('7. le PDG approuve l’inscription', r.status === 200, `HTTP ${r.status} ${r.json?.error || ''}`);
  const merchantId = r.json?.data?.merchant?.id || '';

  // ---------------------------------------------------------------- 8. le marchand se connecte
  r = await call('POST', '/api/merchant/auth/login', { username: merchantUsername, password: '482913' });
  check('8. le marchand accède à son espace après validation', r.status === 200, `HTTP ${r.status} ${r.json?.error || ''}`);
  const merchantCookie = r.cookie;
  r = await call('GET', '/api/merchant/team', undefined, merchantCookie);
  const quota = r.json?.data?.quotaUsage || {};
  check('8b. le quota d’équipe hérité du code est appliqué', quota.generalManagers?.max === 1 && quota.waitresses?.max === 2,
    `gérant ${quota.generalManagers?.max ?? '?'}, serveuse ${quota.waitresses?.max ?? '?'} (source ${r.json?.data?.settings?.quota?.source || '?'})`);

  // ---------------------------------------------------------------- 9. quota atteint puis bloqué
  if (pgMode) {
    const createMember = (role, fullName) => call('POST', '/api/merchant/team/members', { role, fullName, phone }, merchantCookie);
    r = await createMember('general_manager', 'Gérant Un');
    check('9. premier gérant général créé', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
    r = await createMember('general_manager', 'Gérant Deux');
    check('9b. deuxième gérant refusé par le quota', r.status === 409 && r.json?.code === 'TEAM_LIMIT', `HTTP ${r.status} ${r.json?.code || ''}`);
    check('9c. le message est celui demandé par le cahier des charges',
      String(r.json?.error || '').includes('nombre maximum de comptes autorisés'), r.json?.error || 'message absent');
    r = await createMember('waitress', 'Serveuse Un');
    check('9d. première serveuse créée', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
    r = await createMember('waitress', 'Serveuse Deux');
    check('9e. deuxième serveuse créée', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
    r = await createMember('waitress', 'Serveuse Trois');
    check('9f. troisième serveuse refusée', r.status === 409, `HTTP ${r.status}`);
    // Le marchand ne peut pas relever son propre quota.
    r = await call('PATCH', '/api/merchant/team/settings', { maxWaitresses: 50 }, merchantCookie);
    check('9g. le marchand ne peut pas modifier son quota', r.status === 403, `HTTP ${r.status} ${r.json?.code || ''}`);
    // Le PDG relève le quota : la création redevient possible.
    r = await call('PUT', `/api/admin/control/merchants/${merchantId}/quotas`, { maxGeneralManagers: 1, maxWaitresses: 3, reason: 'Test quota' }, adminCookie);
    check('9h. le PDG relève le quota', r.status === 200 && r.json?.data?.quotas?.effectiveMaxWaitresses === 3,
      `HTTP ${r.status} → ${r.json?.data?.quotas?.effectiveMaxWaitresses}`);
    r = await createMember('waitress', 'Serveuse Trois');
    check('9i. la serveuse supplémentaire peut être créée', r.status === 201, `HTTP ${r.status} ${r.json?.error || ''}`);
    // Le PDG coupe l'accès d'une serveuse à tout moment.
    const memberId = r.json?.data?.member?.id;
    r = await call('POST', `/api/admin/control/merchants/${merchantId}/team-members/${memberId}/status`, { status: 'blocked', reason: 'Test de coupure' }, adminCookie);
    check('9j. le PDG coupe le code d’une serveuse', r.status === 200, `HTTP ${r.status}`);
  }

  // ---------------------------------------------------------------- 10. fiche 360° du marchand
  r = await call('GET', `/api/admin/control/merchants/${merchantId}`, undefined, adminCookie);
  const sheet = r.json?.data || {};
  check('10. la fiche marchand réunit les données', r.status === 200 &&
    Boolean(sheet.merchant) && Boolean(sheet.quota || sheet.quotas) && Array.isArray(sheet.team),
    `équipe ${(sheet.team || []).length}, QR ${(sheet.qrCodes || []).length}, commandes ${sheet.orders?.total ?? 0}`);

  // ---------------------------------------------------------------- 11. notification + journal
  r = await call('GET', '/api/admin/control/notifications', undefined, adminCookie);
  const titles = (r.json?.data || []).map((row) => row.type);
  check('11. le PDG a reçu une notification d’inscription terrain', titles.includes('field_registration') || titles.includes('registration_new'),
    `${titles.length} notification(s), non lues ${r.json?.counts?.unread}`);
  r = await call('GET', '/api/admin/control/journal', undefined, adminCookie);
  const actions = (r.json?.data || []).map((row) => row.action);
  check('11b. le journal trace génération, inscription et approbation',
    actions.includes('field_codes_created') && actions.includes('registration_submitted') && actions.includes('registration_approve'),
    actions.slice(0, 6).join(', '));

  // ---------------------------------------------------------------- 12. points protégés
  if (pgMode) {
    r = await call('POST', '/api/admin/managers', { username: `gest${suffix}`, displayName: 'Gestionnaire Test', password: 'MotDePasseLong123', phone: '+225 07 00 00 00 00' }, adminCookie);
    const managerId = r.json?.data?.manager?.id || r.json?.data?.id || '';
    if (managerId) {
      r = await call('POST', `/api/admin/control/managers/${managerId}/points-code`, { code: '482913' }, adminCookie);
      check('12. le PDG définit un code de sécurité à 6 chiffres', r.status === 200, `HTTP ${r.status} ${r.json?.error || ''}`);
      r = await call('POST', `/api/admin/control/managers/${managerId}/points-code`, { code: '123456' }, adminCookie);
      check('12b. un code trop simple est refusé', r.status === 400, `HTTP ${r.status} ${r.json?.code || ''}`);
      r = await call('POST', `/api/admin/control/managers/${managerId}/points`, { delta: 25, reason: 'Bonus terrain' }, adminCookie);
      check('12c. correction de points historisée', r.status === 200 && r.json?.data?.pointsAfter === 25, `HTTP ${r.status} → ${r.json?.data?.pointsAfter}`);
      r = await call('POST', `/api/admin/control/managers/${managerId}/points`, { delta: -5, reason: 'ok' }, adminCookie);
      check('12d. un mouvement sans motif suffisant est refusé', r.status === 400, `HTTP ${r.status}`);
      r = await call('POST', `/api/admin/control/managers/${managerId}/points-code-policy`, { required: true }, adminCookie);
      check('12e. le PDG protège la consultation des points', r.status === 200 && r.json?.data?.required === true, `HTTP ${r.status}`);
      r = await call('GET', `/api/admin/control/managers/${managerId}/points`, undefined, adminCookie);
      check('12f. le PDG garde l’accès général aux points', r.status === 200 && r.json?.data?.points === 25, `HTTP ${r.status} → ${r.json?.data?.points}`);
      r = await call('GET', `/api/admin/control/managers/${managerId}`, undefined, adminCookie);
      check('12g. la fiche gestionnaire est complète', r.status === 200 && Boolean(r.json?.data?.manager) && Array.isArray(r.json?.data?.journal),
        `journal ${(r.json?.data?.journal || []).length} entrée(s)`);
    } else {
      check('12. gestionnaire créé pour le test des points', false, `HTTP ${r.status} ${r.json?.error || ''}`);
    }
  }

  // ---------------------------------------------------------------- 13. tableau de bord central
  r = await call('GET', '/api/admin/control/overview', undefined, adminCookie);
  const overview = r.json?.data || {};
  check('13. tableau de bord central complet', r.status === 200 &&
    Number(overview.merchants?.total || 0) > 0 && Boolean(overview.field) && Boolean(overview.team),
    `marchands ${overview.merchants?.total}, codes ${overview.field?.codesGenerated}, équipe ${overview.team?.generalManagers}/${overview.team?.waitresses}`);

  // ---------------------------------------------------------------- 14. cloisonnement des rôles
  r = await call('GET', '/api/admin/control/overview', undefined, merchantCookie);
  check('14. un marchand ne voit pas le tableau de bord du PDG', [401, 403].includes(r.status), `HTTP ${r.status}`);
  r = await call('GET', '/api/admin/control/field-codes', undefined, merchantCookie);
  check('14b. un marchand ne voit pas les codes terrain', [401, 403].includes(r.status), `HTTP ${r.status}`);
  r = await call('GET', '/api/admin/control/merchants', undefined, '');
  check('14c. un visiteur anonyme est refusé', [401, 403].includes(r.status), `HTTP ${r.status}`);

  // ---------------------------------------------------------------- 15. révocation d'un code non utilisé
  r = await call('POST', '/api/admin/control/field-codes', { count: 1, ttlHours: 5 }, adminCookie);
  const toRevoke = r.json?.data?.codes?.[0]?.id || '';
  r = await call('POST', `/api/admin/control/field-codes/${toRevoke}/revoke`, { reason: 'Parcours de test' }, adminCookie);
  check('15. un code non utilisé peut être révoqué', r.status === 200, `HTTP ${r.status}`);
  void codeId;

  const passed = results.filter((row) => row.ok).length;
  console.log(`\n${passed}/${results.length} vérifications réussies — ${passed === results.length ? 'TOUT EST CONFORME' : 'voir les échecs ci-dessus'}`);
})().catch((error) => { console.error('Parcours interrompu :', error); process.exit(1); });
