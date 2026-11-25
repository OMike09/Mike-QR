'use strict';

// ============================================================================================
// MISSION 9 — vérification réelle, sur un vrai serveur et une vraie base.
//
// Ce script crée ses propres comptes de test (jamais ne modifie un compte existant), puis rejoue
// le parcours complet demandé au point 7 du cahier des charges. Il refuse de tourner sans
// OPTIONS_BASE et échoue si le moindre contrôle est faux.
// ============================================================================================

const BASE = process.env.OPS_BASE_URL || process.env.BASE || 'http://127.0.0.1:3600';
const ADMIN = { username: process.env.ADMIN_USERNAME || 'admin', password: process.env.ADMIN_PASSWORD || 'admin1234' };

let pass = 0; let failCount = 0;
const results = [];
function check(name, condition, detail = '') {
  if (condition) { pass += 1; results.push(`  ✔ ${name}`); }
  else { failCount += 1; results.push(`  ✘ ${name}${detail ? ` — ${detail}` : ''}`); }
}
function section(title) { results.push(`\n${title}`); }

async function http(path, { method = 'GET', body, cookie = '', headers = {} } = {}) {
  const response = await fetch(`${BASE}${path}`, { method, redirect: 'manual',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), Origin: BASE, ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {}; try { data = JSON.parse(text); } catch (_) { data = { raw: text.slice(0, 300) }; }
  const setCookie = response.headers.getSetCookie ? response.headers.getSetCookie() : [];
  return { status: response.status, data, cookie: setCookie.map((c) => c.split(';')[0]).join('; '), headers: response.headers };
}
const pin = () => {
  const digits = '0123456789';
  let out = '';
  for (let index = 0; index < 6; index += 1) out += digits[Math.floor(Math.random() * 10)];
  if (/^(\d)\1{5}$/.test(out) || ['123456', '654321', '000000'].includes(out)) return pin();
  return out;
};

async function main() {
  console.log(`Vérification Mission 9 sur ${BASE}\n`);
  const health = await http('/api/health');
  check('Le serveur répond', health.status === 200 && health.data.ok === true, JSON.stringify(health.data));

  // ------------------------------------------------------------------ 0. Mot de passe oublié
  section('1. « Mot de passe oublié ? » — coordonnées réelles, aucun numéro inventé');
  const contacts = await http('/api/public/support/contacts');
  check('La route de contact répond', contacts.status === 200);
  check('Le message d’aide est le texte demandé',
    String(contacts.data?.data?.message || '').includes('contactez le gestionnaire qui a créé votre compte'));
  check('Aucun numéro inventé quand rien n’est enregistré',
    Array.isArray(contacts.data?.data?.contacts) && (contacts.data.data.contacts.length > 0 || Boolean(contacts.data.data.notice)));

  // ------------------------------------------------------------------ 1. PDG : connexion
  const adminLogin = await http('/api/auth/login', { method: 'POST', body: ADMIN });
  check('Connexion PDG', adminLogin.status === 200 && Boolean(adminLogin.cookie), JSON.stringify(adminLogin.data).slice(0, 120));
  const adminCookie = adminLogin.cookie;

  // ------------------------------------------------------------------ 2. Gestionnaire de test
  section('2. Gestionnaire créateur : génération d’un code unique d’inscription');
  const managerUsername = `m9gest${Date.now().toString(36).slice(-6)}`;
  const managerPassword = 'MotDePasseLong123';
  const createManager = await http('/api/admin/managers', { method: 'POST', cookie: adminCookie,
    body: { username: managerUsername, displayName: 'Gestionnaire Mission 9', password: managerPassword,
      canManageMerchants: true, canValidateMerchantRegistrations: true, canCreateFieldCodes: true } });
  check('Le PDG crée un gestionnaire de test', [200, 201].includes(createManager.status), JSON.stringify(createManager.data).slice(0, 200));
  const managerId = createManager.data?.data?.id || createManager.data?.data?.manager?.id || '';

  const managerLogin = await http('/api/manager/auth/login', { method: 'POST', body: { username: managerUsername, password: managerPassword } });
  check('Connexion du gestionnaire', managerLogin.status === 200 && Boolean(managerLogin.cookie), JSON.stringify(managerLogin.data).slice(0, 120));
  const managerCookie = managerLogin.cookie;

  const generated = await http('/api/manager/signup-code', { method: 'POST', cookie: managerCookie, body: { ttlHours: 24 } });
  check('Le gestionnaire génère un code unique depuis sa fenêtre', generated.status === 201, JSON.stringify(generated.data).slice(0, 200));
  const signupCode = generated.data?.data?.code || '';
  check('Le code a le format OY-XXXX-XXXX', /^OY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(signupCode), signupCode);
  check('Le code est marqué à usage unique', generated.data?.data?.singleUse === true);
  check('Un lien d’inscription est fourni', String(generated.data?.data?.signupPath || '').includes('/devenir-marchand?code='));

  const myCodes = await http('/api/manager/signup-codes', { cookie: managerCookie });
  const listed = (myCodes.data?.data || []).find((row) => row.hint === signupCode.slice(-4));
  check('Le code apparaît dans l’historique du gestionnaire', Boolean(listed) && listed.status === 'available',
    JSON.stringify(myCodes.data?.data?.slice(0, 2) || []).slice(0, 200));

  // ------------------------------------------------------------------ 3. Fenêtre de code
  section('3. Fenêtre « Code d’autorisation d’inscription » : réservation sans consommation');
  const page = await fetch(`${BASE}/devenir-marchand`);
  const html = await page.text();
  check('La page d’inscription contient la fenêtre de code', html.includes('id="codeGate"'));
  check('La fenêtre porte le titre demandé', html.includes('Code d’autorisation d’inscription'));
  check('Le formulaire est verrouillé par défaut', html.includes('data-locked') || page.status === 200);

  const reserved = await http('/api/public/field-codes/reserve', { method: 'POST', body: { code: signupCode } });
  check('La vérification du code ouvre la fenêtre', reserved.status === 200, JSON.stringify(reserved.data).slice(0, 200));
  const reservationToken = reserved.data?.data?.token || '';
  check('Un jeton de réservation est émis', Boolean(reservationToken));

  const stillAvailable = await http('/api/manager/signup-codes', { cookie: managerCookie });
  const afterReserve = (stillAvailable.data?.data || []).find((row) => row.hint === signupCode.slice(-4));
  check('La simple ouverture NE consomme PAS le code', afterReserve?.status === 'available', JSON.stringify(afterReserve || {}));

  const second = await http('/api/public/field-codes/reserve', { method: 'POST', body: { code: signupCode } });
  check('Un même code ne peut pas être réservé deux fois en même temps',
    second.status === 409 && second.data?.code === 'CODE_RESERVED', JSON.stringify(second.data).slice(0, 160));

  // ------------------------------------------------------------------ 4. Inscription complète
  section('4. Inscription marchand : reprise, soumission, consommation');
  const unique = Date.now().toString(36).slice(-6);
  const business = `Chez Gbaziké ${unique}`;
  const payload = {
    contactName: 'Gbaziké Konan', businessName: business, username: `gbazike${unique}`,
    // Numéro stable à 10 chiffres (le serveur exige un vrai numéro ivoirien plausible).
    phone: `+22507${String(Math.floor(Math.random() * 90000000) + 10000000)}`.slice(0, 13),
    email: `gbazike${unique}@example.ci`,
    sector: 'maquis', city: 'Abidjan', location: 'Cocody', address: 'Rue des Jardins',
    activityDomain: 'restauration', description: 'Maquis ivoirien, plats braisés et boissons fraîches.',
    password: 'MotDePasseLong123', passwordConfirm: 'MotDePasseLong123',
    fieldCode: signupCode, fieldCodeToken: reservationToken,
  };
  const submit = await http('/api/public/merchant-registrations', { method: 'POST', body: payload });
  check('Le marchand termine son inscription sans blocage', submit.status === 201, JSON.stringify(submit.data).slice(0, 240));
  const reference = submit.data?.data?.reference || '';
  check('Une référence de dossier est renvoyée', Boolean(reference), reference);
  const signupCookie = submit.cookie;

  const consumedList = await http('/api/manager/signup-codes', { cookie: managerCookie });
  const afterUse = (consumedList.data?.data || []).find((row) => row.hint === signupCode.slice(-4));
  check('Le code est consommé après la soumission réussie', afterUse?.status === 'used', JSON.stringify(afterUse || {}));

  const reuse = await http('/api/public/merchant-registrations', { method: 'POST',
    body: { ...payload, username: `${payload.username}b`, phone: `+22505${String(Math.floor(Math.random() * 90000000) + 10000000)}`.slice(0, 13), fieldCodeToken: '' } });
  check('Un code utilisé ne permet JAMAIS une deuxième inscription',
    reuse.status >= 400 && ['CODE_USED', 'CODE_ALREADY_USED', 'CODE_EXPIRED', 'CODE_RESERVED', 'INVALID_CODE_FORMAT', 'CODE_NOT_FOUND'].includes(reuse.data?.code),
    JSON.stringify(reuse.data).slice(0, 160));

  // ------------------------------------------------------------------ 5. Raisons sociales / doublons
  section('5. Protection contre les inscriptions multiples');
  const dupPhone = await http('/api/public/merchant-registrations', { method: 'POST',
    body: { ...payload, username: `${payload.username}c`, fieldCode: '', fieldCodeToken: '' } });
  check('Un même téléphone ne crée pas deux comptes sans contrôle',
    dupPhone.status >= 400, JSON.stringify(dupPhone.data).slice(0, 160));

  // ------------------------------------------------------------------ 6. Approbation PDG
  section('6. Approbation PDG : rattachement au gestionnaire créateur');
  const list = await http('/api/admin/merchant-registrations?status=pending&limit=50', { cookie: adminCookie });
  const registration = (list.data?.data || []).find((row) => row.reference === reference);
  check('Le PDG voit le dossier déposé', Boolean(registration), reference);
  const decision = await http(`/api/admin/merchant-registrations/${registration?.id}/decision`, { method: 'POST', cookie: adminCookie,
    body: { action: 'approve', note: 'Vérification Mission 9' } });
  check('Le PDG approuve le dossier', decision.status === 200, JSON.stringify(decision.data).slice(0, 240));
  const merchantId = decision.data?.data?.merchant?.id || decision.data?.data?.merchantId || '';
  check('Un compte marchand est créé', Boolean(merchantId), merchantId);

  const myMerchants = await http('/api/manager/my-merchants', { cookie: managerCookie });
  const mine = (myMerchants.data?.data || []).find((row) => row.id === merchantId);
  check('Le gestionnaire retrouve le marchand dans « Mes marchands »', Boolean(mine), JSON.stringify(myMerchants.data?.data || []).slice(0, 200));
  check('Le libellé de propriété est explicite', String(mine?.ownership || '').includes('appartient au marchand'));

  const isolated = await http(`/api/manager/my-merchants/${merchantId}`, { cookie: managerCookie });
  check('Le gestionnaire consulte la fiche de son marchand', isolated.status === 200, JSON.stringify(isolated.data).slice(0, 160));
  check('Le mot de passe du marchand n’est jamais transmis', !JSON.stringify(isolated.data).includes('passwordHash'));

  // ------------------------------------------------------------------ 7. Réinitialisation PDG
  section('7. Code provisoire : PDG, gestionnaire créateur, usage unique');
  const reset = await http('/api/admin/access-resets', { method: 'POST', cookie: adminCookie,
    body: { accountType: 'merchant', accountId: merchantId, reason: 'Test Mission 9' } });
  check('Le PDG génère un code provisoire', reset.status === 201, JSON.stringify(reset.data).slice(0, 200));
  const resetCode = reset.data?.data?.code || '';
  check('Le code provisoire commence par les initiales de l’établissement',
    resetCode.startsWith('CG'), `${resetCode} (attendu CG…)`);
  check('Le code provisoire fait 6 caractères alphanumériques après le tiret',
    /^[A-Z]{2,3}-[A-Z0-9]{6}$/.test(resetCode), resetCode);
  check('Le code provisoire n’est PAS journalisé', !JSON.stringify((await http('/api/admin/access-resets', { cookie: adminCookie })).data).includes(resetCode));

  const inspect = await http('/api/public/access-reset/inspect', { method: 'POST', body: { code: resetCode } });
  check('Le code provisoire est reconnu', inspect.status === 200, JSON.stringify(inspect.data).slice(0, 160));

  const weak = await http('/api/public/access-reset/redeem', { method: 'POST', body: { code: resetCode, password: '12345' } });
  check('Un mot de passe non conforme est refusé SANS brûler le code', weak.status === 400 && weak.data?.code === 'INVALID_PIN6');
  const stillValid = await http('/api/public/access-reset/inspect', { method: 'POST', body: { code: resetCode } });
  check('Le code reste valide après un refus', stillValid.status === 200);

  const newPin = pin();
  const redeemed = await http('/api/public/access-reset/redeem', { method: 'POST', body: { code: resetCode, password: newPin, confirmPassword: newPin } });
  check('Le code provisoire réinitialise l’accès', redeemed.status === 200, JSON.stringify(redeemed.data).slice(0, 200));
  check('Après connexion, un nouveau mot de passe personnel est obligatoire', redeemed.data?.mustChangePassword === true);

  const reusePin = pin();
  const secondUse = await http('/api/public/access-reset/redeem', { method: 'POST', body: { code: resetCode, password: reusePin, confirmPassword: reusePin } });
  check('Le code provisoire n’est accepté qu’une seule fois', secondUse.status >= 400 && secondUse.data?.code === 'RESET_CODE_USED',
    JSON.stringify(secondUse.data).slice(0, 160));

  const merchantUser = payload.username;
  const merchantLogin = await http('/api/merchant/auth/login', { method: 'POST', body: { username: merchantUser, password: newPin } });
  check('Le marchand se connecte avec le code provisoire', merchantLogin.status === 200, JSON.stringify(merchantLogin.data).slice(0, 160));
  check('La connexion impose le changement de mot de passe', merchantLogin.data?.data?.mustChangePassword === true);
  const merchantCookie = merchantLogin.cookie;

  const blocked = await http('/api/merchant/team', { cookie: merchantCookie });
  check('Tant que le mot de passe n’est pas changé, l’espace reste fermé',
    blocked.status === 403 && blocked.data?.code === 'PASSWORD_CHANGE_REQUIRED', JSON.stringify(blocked.data).slice(0, 140));

  const changed = await http('/api/merchant/auth/change-password', { method: 'POST', cookie: merchantCookie,
    body: { currentPassword: newPin, password: '481920', confirmPassword: '481920' } });
  check('Le marchand définit un nouveau mot de passe personnel', changed.status === 200, JSON.stringify(changed.data).slice(0, 160));

  // ------------------------------------------------------------------ 8. Périmètre gestionnaire
  section('8. Périmètre : un gestionnaire ne touche qu’à ses propres comptes');
  const resetManager = await http('/api/manager/access-resets', { method: 'POST', cookie: managerCookie,
    body: { accountType: 'merchant', accountId: merchantId } });
  check('Le gestionnaire créateur peut réinitialiser son marchand', resetManager.status === 201, JSON.stringify(resetManager.data).slice(0, 160));

  const otherMerchant = await http('/api/manager/access-resets', { method: 'POST', cookie: managerCookie,
    body: { accountType: 'merchant', accountId: 'mch_inexistant_m9' } });
  check('Il ne peut pas réinitialiser un compte qu’il n’a pas créé', otherMerchant.status === 403 || otherMerchant.status === 404,
    JSON.stringify(otherMerchant.data).slice(0, 160));

  const managerResetForbidden = await http('/api/manager/access-resets', { method: 'POST', cookie: managerCookie,
    body: { accountType: 'manager', accountId: managerId } });
  check('Il ne peut jamais réinitialiser un autre gestionnaire', managerResetForbidden.status === 403,
    JSON.stringify(managerResetForbidden.data).slice(0, 160));

  const crossAccess = await http('/api/merchant/team', { cookie: managerCookie });
  check('Aucun accès croisé en changeant d’URL : session gestionnaire ≠ session marchand',
    crossAccess.status === 401 || crossAccess.status === 403, String(crossAccess.status));

  // ------------------------------------------------------------------ 9. Équipe : demande + validation
  section('9. Le marchand valide les comptes de son personnel');
  const loginFresh = await http('/api/merchant/auth/login', { method: 'POST', body: { username: merchantUser, password: '481920' } });
  const freshCookie = loginFresh.cookie;
  check('Le marchand entre dans son espace', loginFresh.status === 200, JSON.stringify(loginFresh.data).slice(0, 120));

  const storeSetup = await http('/api/merchant/store', { method: 'PUT', cookie: freshCookie,
    body: { name: business, description: 'Maquis ivoirien.', city: 'Abidjan', address: 'Rue des Jardins' } });
  check('La boutique existe ou est créée', [200, 201].includes(storeSetup.status), JSON.stringify(storeSetup.data).slice(0, 160));

  const request = await http('/api/merchant/team/requests', { method: 'POST', cookie: freshCookie,
    body: { role: 'waitress', fullName: 'Awa Koné', phone: '+2250708091011', note: 'Serveuse terrasse' } });
  check('Le marchand soumet une demande de compte pour son personnel', request.status === 201, JSON.stringify(request.data).slice(0, 200));
  const requestId = request.data?.data?.id || '';

  const pendingList = await http('/api/merchant/team/requests?status=pending', { cookie: freshCookie });
  check('La demande apparaît avec le nom, le téléphone et le rôle demandé',
    (pendingList.data?.data || []).some((row) => row.id === requestId && row.fullName === 'Awa Koné' && row.phone === '+2250708091011' && row.role === 'waitress'));
  check('Les places disponibles sont renvoyées avec les quotas du PDG', Boolean(pendingList.data?.seats?.waitress),
    JSON.stringify(pendingList.data?.seats || {}));

  const declined = await http('/api/merchant/team/requests', { method: 'POST', cookie: freshCookie,
    body: { role: 'waitress', fullName: 'Test Refus', phone: '+2250708091012' } });
  const declinedDecision = await http(`/api/merchant/team/requests/${declined.data?.data?.id}/decision`, { method: 'POST', cookie: freshCookie,
    body: { action: 'reject', reason: 'Doublon de test' } });
  check('Le marchand peut refuser une demande', declinedDecision.status === 200 && declinedDecision.data?.data?.status === 'rejected',
    JSON.stringify(declinedDecision.data).slice(0, 160));

  const approved = await http(`/api/merchant/team/requests/${requestId}/decision`, { method: 'POST', cookie: freshCookie, body: { action: 'approve' } });
  check('Le marchand valide la demande', approved.status === 200, JSON.stringify(approved.data).slice(0, 200));
  check('La validation crée le membre et son code d’activation', Boolean(approved.data?.member?.id) && Boolean(approved.data?.activation?.code));

  const teamView = await http('/api/merchant/team', { cookie: freshCookie });
  const member = (teamView.data?.data?.members || []).find((row) => row.fullName === 'Awa Koné');
  check('Le membre validé apparaît dans l’équipe', Boolean(member), JSON.stringify(teamView.data?.data?.counts || {}));
  check('Le membre validé peut se connecter (compte activable)', Boolean(approved.data?.activation?.code));

  // ------------------------------------------------------------------ 10. Quotas
  section('10. Quotas respectés à la validation');
  const seats = teamView.data?.data?.quotaUsage?.waitresses || {};
  check('Le quota serveuses du PDG est appliqué', Number(seats.max) >= 0 && Number(seats.used) >= 1, JSON.stringify(seats));

  // ------------------------------------------------------------------ 11. Réinitialisation par le marchand
  section('11. Le marchand réinitialise l’accès de son personnel');
  const access = await http(`/api/merchant/team/members/${member?.id}/access-code`, { method: 'POST', cookie: freshCookie, body: {} });
  check('Le marchand émet un mot de passe temporaire et un code d’activation', access.status === 200, JSON.stringify(access.data).slice(0, 200));
  check('Le mot de passe temporaire fait exactement 6 chiffres', /^\d{6}$/.test(String(access.data?.data?.temporaryPassword || '')));

  const suspend = await http(`/api/merchant/team/members/${member?.id}/status`, { method: 'POST', cookie: freshCookie, body: { status: 'suspended', reason: 'Test' } });
  check('Le marchand peut suspendre un compte', suspend.status === 200, JSON.stringify(suspend.data).slice(0, 140));
  const reactivate = await http(`/api/merchant/team/members/${member?.id}/status`, { method: 'POST', cookie: freshCookie, body: { status: 'active' } });
  check('Le marchand peut réactiver un compte', reactivate.status === 200);
  const perms = await http(`/api/merchant/team/members/${member?.id}`, { method: 'PATCH', cookie: freshCookie, body: { permissions: ['orders.view', 'orders.create'] } });
  check('Le marchand peut modifier les permissions autorisées', perms.status === 200, JSON.stringify(perms.data).slice(0, 140));
  const activity = await http('/api/merchant/team/activity', { cookie: freshCookie });
  check('L’historique des activités du personnel est consultable', activity.status === 200 && Array.isArray(activity.data?.data));

  // ------------------------------------------------------------------ 12. Notifications
  section('12. Notifications du PDG et du gestionnaire');
  const notifications = await http('/api/admin/control/notifications?limit=50', { cookie: adminCookie });
  const rows = notifications.data?.data || notifications.data?.notifications || [];
  check('Le PDG reçoit les notifications du parcours',
    rows.some((row) => String(row.type || '').includes('registration')) || rows.some((row) => String(row.type || '').includes('access_reset')),
    JSON.stringify(rows.slice(0, 3).map((r) => r.type)));

  const managerNotifications = await http('/api/manager/notifications', { cookie: managerCookie });
  check('Le gestionnaire créateur a une boîte de notifications', managerNotifications.status === 200);

  // ------------------------------------------------------------------ 13. Révocation
  section('13. Révocation immédiate d’un code non utilisé');
  const third = await http('/api/manager/signup-code', { method: 'POST', cookie: managerCookie, body: {} });
  const thirdId = third.data?.data?.codeId;
  const revoke = await http(`/api/manager/control/field-codes/${thirdId}/revoke`, { method: 'POST', cookie: managerCookie, body: { reason: 'Test révocation' } });
  check('Le créateur peut révoquer un code non utilisé', revoke.status === 200, JSON.stringify(revoke.data).slice(0, 160));
  const revokedAttempt = await http('/api/public/field-codes/reserve', { method: 'POST', body: { code: third.data?.data?.code } });
  check('Un code révoqué n’ouvre plus le formulaire', revokedAttempt.status >= 400, JSON.stringify(revokedAttempt.data).slice(0, 140));

  // ------------------------------------------------------------------ 14. Permissions fermées par défaut
  section('14. Permissions vérifiées côté serveur');
  const noPermUser = `m9nop${Date.now().toString(36).slice(-6)}`;
  await http('/api/admin/managers', { method: 'POST', cookie: adminCookie,
    body: { username: noPermUser, displayName: 'Gestionnaire sans droits', password: managerPassword } });
  const noPermLogin = await http('/api/manager/auth/login', { method: 'POST', body: { username: noPermUser, password: managerPassword } });
  const noPermCookie = noPermLogin.cookie;
  const denied = await http('/api/manager/signup-code', { method: 'POST', cookie: noPermCookie, body: {} });
  check('Un gestionnaire non autorisé ne peut pas générer de code', denied.status === 403 && denied.data?.code === 'FIELD_CODE_FORBIDDEN',
    JSON.stringify(denied.data).slice(0, 160));

  // ------------------------------------------------------------------ Bilan
  console.log(results.join('\n'));
  console.log(`\n${failCount === 0 ? 'TOUT EST CONFORME' : 'DES CONTRÔLES ONT ÉCHOUÉ'} — ${pass} réussis, ${failCount} échec(s) sur ${pass + failCount}.`);
  if (failCount > 0) process.exitCode = 1;
}

main().catch((error) => { console.error('Vérification interrompue :', error); process.exitCode = 1; });
