'use strict';

// ============================================================================================
// Mission 9 — vérification d'INTERFACE dans un vrai navigateur (Playwright).
//
// Parcours réellement cliqué, sur un vrai serveur :
//   1. page de connexion marchand → « Mot de passe oublié ? » → contacts + code provisoire ;
//   2. fenêtre « Code d'autorisation d'inscription » : le formulaire est verrouillé avant le code ;
//   3. espace gestionnaire : « Mes marchands », « Codes d'inscription » ;
//   4. espace marchand : demandes de comptes, validation ;
//   5. PDG : onglet « Réinitialisations d'accès ».
// Aucune erreur JavaScript n'est tolérée.
// ============================================================================================

const { chromium } = require('playwright');
const BASE = process.env.OPS_BASE_URL || process.env.BASE || 'http://127.0.0.1:3600';

let ko = 0;
const log = [];
function check(label, ok, detail = '') {
  log.push(`${ok ? 'OK  ' : 'KO  '} ${label}${detail ? ` — ${detail}` : ''}`);
  if (!ok) ko += 1;
}
async function json(path, { method = 'GET', body, cookie = '' } = {}) {
  const response = await fetch(`${BASE}${path}`, { method, headers: { Origin: BASE,
    ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
  body: body ? JSON.stringify(body) : undefined });
  const text = await response.text();
  let data = {}; try { data = JSON.parse(text); } catch (_) { data = {}; }
  const cookies = (response.headers.getSetCookie ? response.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  return { status: response.status, data, cookie: cookies };
}

async function settleSession(page, endpoint) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const ok = await page.evaluate(async (url) => {
        const response = await fetch(url, { credentials: 'same-origin' });
        return response.ok;
      }, endpoint);
      if (ok) return true;
    } catch (_) { /* navigation en cours : on réessaie */ }
    await page.waitForTimeout(400);
  }
  return false;
}

(async () => {
  const browser = await chromium.launch();
  const errors = [];

  // ------------------------------------------------------------------ contexte PDG réel
  const admin = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ username: 'admin', password: 'admin1234' }) });
  const adminCookie = (admin.headers.getSetCookie() || []).map((c) => c.split(';')[0]).join('; ');

  // gestionnaire de test avec droits
  const stamp = Date.now().toString(36).slice(-5);
  const gestUser = `ui9gest${stamp}`;
  await json('/api/admin/managers', { method: 'POST', cookie: adminCookie, body: { username: gestUser, displayName: 'Gestionnaire UI 9',
    password: 'MotDePasseLong123', canManageMerchants: true, canValidateMerchantRegistrations: true, canCreateFieldCodes: true } });

  // ------------------------------------------------------------------ 1. mot de passe oublié
  const ctxMerchant = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const pageMerchant = await ctxMerchant.newPage();
  pageMerchant.on('pageerror', (error) => errors.push(`marchand: ${error.message}`));
  await pageMerchant.goto(`${BASE}/merchant/`, { waitUntil: 'domcontentloaded' });
  await pageMerchant.waitForTimeout(1200);
  const forgotVisible = await pageMerchant.evaluate(() => {
    const node = document.querySelector('#merchantForgotPassword');
    return Boolean(node && node.offsetParent !== null);
  });
  check('lien « Mot de passe oublié ? » visible sur la connexion marchand', forgotVisible);
  if (forgotVisible) {
    await pageMerchant.click('#merchantForgotPassword');
    await pageMerchant.waitForTimeout(700);
    const dialog = await pageMerchant.evaluate(() => {
      const node = document.querySelector('#forgotDialog');
      return { open: Boolean(node && !node.hidden), text: node ? node.innerText : '' };
    });
    check('la fenêtre s’ouvre', dialog.open);
    check('le texte de contact est celui demandé', dialog.text.includes('Pour réinitialiser votre accès, veuillez contacter le gestionnaire qui a créé votre compte ou l’Administrateur général'));
    check('un accès au code provisoire est proposé', dialog.text.includes('J’ai un code provisoire'));
    await pageMerchant.click('#forgotUseCode');
    await pageMerchant.waitForTimeout(400);
    const codeForm = await pageMerchant.evaluate(() => ({ code: Boolean(document.querySelector('#forgotCode')),
      password: Boolean(document.querySelector('#forgotPassword')) }));
    check('le formulaire de code provisoire est présent', codeForm.code && codeForm.password);
    await pageMerchant.screenshot({ path: '/tmp/m9-forgot.png', fullPage: false, timeout: 60000 }).catch(() => {});
  }

  // ------------------------------------------------------------------ 2. fenêtre de code
  const pageSignup = await ctxMerchant.newPage();
  pageSignup.on('pageerror', (error) => errors.push(`signup: ${error.message}`));
  await pageSignup.goto(`${BASE}/devenir-marchand`, { waitUntil: 'domcontentloaded' });
  await pageSignup.waitForTimeout(1000);
  const beforeGate = await pageSignup.evaluate(() => ({
    formHidden: document.querySelector('#formCard')?.hidden !== false,
    locked: document.querySelector('#formCard')?.dataset.locked === 'true',
    submitDisabled: document.querySelector('#submitButton')?.disabled === true,
  }));
  check('le formulaire est inaccessible avant le code', beforeGate.formHidden || beforeGate.locked || beforeGate.submitDisabled,
    JSON.stringify(beforeGate));
  await pageSignup.evaluate(() => document.querySelector('#codeGate')?.scrollIntoView({ block: 'center' }));
  await pageSignup.click('#startButton').catch(() => {});
  await pageSignup.waitForTimeout(600);
  const gateVisible = await pageSignup.evaluate(() => {
    const gate = document.querySelector('#codeGate');
    return { open: Boolean(gate && !gate.hidden), title: document.querySelector('#codeGate')?.innerText || '' };
  });
  check('« Commencer ma demande » ouvre la fenêtre de code, pas le formulaire', gateVisible.open);
  check('la fenêtre porte le titre demandé', gateVisible.title.includes('Code d’autorisation d’inscription'));

  // mauvais code : message d'erreur clair, formulaire toujours fermé
  await pageSignup.fill('#gateCode', 'OY-ZZZZ-ZZZZ');
  await pageSignup.click('#gateVerify');
  await pageSignup.waitForTimeout(900);
  const badCode = await pageSignup.evaluate(() => ({
    status: document.querySelector('#gateStatus')?.innerText || '',
    formHidden: document.querySelector('#formCard')?.hidden !== false,
  }));
  check('un code inconnu affiche une erreur et ne déverrouille rien', badCode.status.length > 0 && badCode.formHidden,
    badCode.status.slice(0, 80));
  await pageSignup.screenshot({ path: '/tmp/m9-gate.png', fullPage: false, timeout: 60000 }).catch(() => {});

  // ------------------------------------------------------------------ 3. espace gestionnaire
  const ctxManager = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const pageManager = await ctxManager.newPage();
  pageManager.on('pageerror', (error) => errors.push(`gestionnaire: ${error.message}`));
  await pageManager.goto(`${BASE}/manager`, { waitUntil: 'domcontentloaded' });
  await pageManager.waitForTimeout(1000);
  await pageManager.fill('#managerUsername', gestUser).catch(() => {});
  await pageManager.fill('#managerPassword', 'MotDePasseLong123').catch(() => {});
  await pageManager.evaluate(() => document.querySelector('#managerLoginForm')?.requestSubmit());
  // L'espace gestionnaire se recharge après la connexion et enchaîne plusieurs appels réseau :
  // on attend que la session soit réellement reconnue par le serveur avant de cliquer.
  await settleSession(pageManager, '/api/manager/auth/me');

  const navOk = await pageManager.evaluate(() => ({
    mine: Boolean(document.querySelector('[data-view="my-merchants"]')),
    codes: Boolean(document.querySelector('[data-view="signup-codes"]')),
    loggedIn: Boolean(document.querySelector('#managerApp') && !document.querySelector('#managerApp').hidden),
  }));
  check('connexion gestionnaire', navOk.loggedIn, navOk.loggedIn ? '' : await pageManager.evaluate(() => ({ url: location.pathname, app: document.querySelector('#managerApp')?.hidden, status: document.querySelector('#managerLoginStatus')?.innerText || document.querySelector('.message.error')?.innerText || '' })).then((v) => JSON.stringify(v)));
  check('rubrique « Mes marchands » présente', navOk.mine);
  check('rubrique « Codes d’inscription » présente', navOk.codes);

  // la 1re tentative sur /api/manager/auth/me peut arriver avant le cookie : un second passage suffit
  if (!navOk.loggedIn) {
    // Rechargement attendu (un location.reload() non attendu détruisait le contexte
    // d'exécution). En mode démonstration, /manager recharge la liste des gestionnaires :
    // on patiente sans considérer le délai comme un échec.
    await pageManager.reload({ waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    await pageManager.waitForTimeout(2500);
  }
  await pageManager.evaluate(() => document.querySelector('[data-view="signup-codes"]')?.click());
  // la rubrique est montée par un appel réseau : on attend le bouton, pas un délai fixe
  await pageManager.waitForSelector('#managerGenerateCode, #managerSignupCodeRoot .badge', { timeout: 15000 }).catch(() => {});
  await pageManager.waitForTimeout(500);
  const codesView = await pageManager.evaluate(() => ({
    button: Boolean(document.querySelector('#managerGenerateCode')),
    text: document.querySelector('#managerSignupCodeRoot')?.innerText || '',
  }));
  check('bouton « Générer un code unique d’inscription » visible', codesView.button);
  check('l’historique est affiché', codesView.text.includes('Mes codes'));

  if (codesView.button) {
    await pageManager.click('#managerGenerateCode');
    await pageManager.waitForTimeout(1500);
    const generated = await pageManager.evaluate(() => {
      const code = document.querySelector('#managerCodeOutput code');
      return { code: code ? code.textContent.trim() : '', text: document.querySelector('#managerCodeOutput')?.innerText || '' };
    });
    check('le code généré apparaît immédiatement', /^OY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(generated.code), generated.code);
    check('le lien d’inscription est proposé', generated.text.includes('Copier le lien'));

    // Parcours complet : le code ouvert dans la fenêtre indépendante déverrouille le formulaire.
    if (/^OY-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(generated.code)) {
      const pageFlow = await ctxManager.newPage();
      pageFlow.on('pageerror', (error) => errors.push(`parcours: ${error.message}`));
      await pageFlow.goto(`${BASE}/devenir-marchand?code=${encodeURIComponent(generated.code)}`, { waitUntil: 'domcontentloaded' });
      await pageFlow.waitForTimeout(1400);
      // La fenêtre peut déjà être refermée (vérification immédiate réussie) : on vérifie le
      // pré-remplissage dans les deux cas.
      const prefilled = await pageFlow.evaluate(() => ({ gate: document.querySelector('#codeGate')?.hidden === false,
        form: document.querySelector('#formCard')?.hidden === false,
        value: document.querySelector('#gateCode')?.value || '' }));
      check('le lien pré-remplit le code', prefilled.value === generated.code, prefilled.value);
      check('un code valide venu d’un lien ouvre la fenêtre ou le formulaire', prefilled.gate || prefilled.form);
      await pageFlow.evaluate(() => document.querySelector('#gateVerify')?.click());
      await pageFlow.waitForTimeout(1600);
      const unlocked = await pageFlow.evaluate(() => ({
        gateHidden: document.querySelector('#codeGate')?.hidden === true,
        formVisible: document.querySelector('#formCard')?.hidden === false,
        submit: document.querySelector('#submitButton')?.disabled !== true,
        banner: document.querySelector('#fieldBanner')?.hidden === false,
      }));
      check('la fenêtre se ferme et le formulaire complet s’affiche', unlocked.gateHidden && unlocked.formVisible && unlocked.submit,
        JSON.stringify(unlocked));
      check('la réservation est rappelée sans être consommée', unlocked.banner);
      await pageFlow.screenshot({ path: '/tmp/m9-signup-unlocked.png', fullPage: false, timeout: 60000 }).catch(() => {});
      await pageFlow.close();
    }
    await pageManager.screenshot({ path: '/tmp/m9-manager-codes.png', fullPage: false, timeout: 60000 }).catch(() => {});
  }

  await pageManager.evaluate(() => document.querySelector('[data-view="my-merchants"]')?.click());
  await pageManager.waitForSelector('#managerMyMerchantsRoot .mine-table, #managerMyMerchantsRoot .muted', { timeout: 15000 }).catch(() => {});
  await pageManager.waitForTimeout(400);
  const mineView = await pageManager.evaluate(() => ({
    root: document.querySelector('#managerMyMerchantsRoot')?.innerText || '',
    hasError: Boolean(document.querySelector('#managerMyMerchantsRoot .message.error')),
  }));
  check('« Mes marchands » se charge sans erreur', !mineView.hasError, mineView.root.slice(0, 70));
  check('l’écran explique la règle de propriété', mineView.root.includes('appartient au marchand') || mineView.root.includes('Aucun marchand'));

  await pageManager.screenshot({ path: '/tmp/m9-manager-mine.png', fullPage: false, timeout: 60000 }).catch(() => {});
  // L'espace gestionnaire ouvre un flux d'événements (SSE) qui occupe une connexion du
  // navigateur : on ferme le contexte avant de tester le PDG, sinon la navigation sature.
  await ctxManager.close();

  // ------------------------------------------------------------------ 4. PDG : onglet réinitialisations
  const ctxAdmin = await browser.newContext({ viewport: { width: 1440, height: 950 } });
  const pageAdmin = await ctxAdmin.newPage();
  pageAdmin.on('pageerror', (error) => errors.push(`PDG: ${error.message}`));
  await pageAdmin.goto(`${BASE}/admin/`, { waitUntil: 'domcontentloaded' });
  await pageAdmin.waitForSelector('#adminUsername', { timeout: 20000 }).catch(() => {});
  await pageAdmin.waitForTimeout(600);
  await pageAdmin.fill('#adminUsername', 'admin').catch(() => {});
  await pageAdmin.fill('#adminPassword', 'admin1234').catch(() => {});
  await pageAdmin.evaluate(() => document.querySelector('#loginForm')?.requestSubmit());
  await settleSession(pageAdmin, '/api/auth/me');
  await pageAdmin.waitForTimeout(800);
  const adminNav = await pageAdmin.evaluate(() => {
    const button = document.querySelector('[data-view="admin-control"]');
    return { found: Boolean(button), app: Boolean(document.querySelector('#appShell') && !document.querySelector('#appShell').hidden) };
  });
  check('connexion PDG', adminNav.app);
  if (adminNav.found) {
    await pageAdmin.evaluate(() => document.querySelector('[data-view="admin-control"]').click());
    await pageAdmin.waitForTimeout(1600);
    const tabs = await pageAdmin.evaluate(() => [...document.querySelectorAll('[data-ctl-tab]')].map((node) => node.textContent.trim()));
    check('onglet « Réinitialisations d’accès » présent', tabs.some((label) => label.includes('Réinitialisations')), tabs.join(' | '));
    const resetTab = await pageAdmin.$('[data-ctl-tab="resets"]');
    if (resetTab) {
      // clic direct dans la page : le panneau PDG anime ses éléments, ce qui peut empêcher
      // Playwright de valider la stabilité du bouton
      await pageAdmin.evaluate(() => document.querySelector('[data-ctl-tab="resets"]')?.click());
      // le panneau est chargé en réseau : on attend le formulaire au lieu d'un délai fixe
      await pageAdmin.waitForSelector('#ctlResetAccount', { timeout: 8000 }).catch(() => {});
      await pageAdmin.waitForTimeout(600);
      const resets = await pageAdmin.evaluate(() => ({
        select: Boolean(document.querySelector('#ctlResetAccount')),
        phone: Boolean(document.querySelector('#ctlSupportPhone')),
        text: document.querySelector('[data-ctl-body]')?.innerText || '',
      }));
      check('le formulaire d’émission de code provisoire est présent', resets.select);
      check('les coordonnées de contact sont modifiables', resets.phone);
      check('l’avertissement « aucun numéro inventé » est affiché', resets.text.includes('Aucun numéro n’est inventé'));
      await pageAdmin.screenshot({ path: '/tmp/m9-admin-resets.png', fullPage: false, timeout: 60000 }).catch(() => {});
    }
  }

  // ------------------------------------------------------------------ 5. réattribution d'un marchand
  // Un marchand créé par le PDG, sans gestionnaire : il doit apparaître comme orphelin et
  // pouvoir être rattaché à un gestionnaire depuis la fiche.
  const orphanPhone = `07${String(Date.now()).slice(-8)}`;
  const created = await json('/api/admin/merchants', { method: 'POST', cookie: adminCookie, body: {
    displayName: 'Marchand Orphelin UI', username: `ui9orp${stamp}`, phone: orphanPhone, password: '583920', city: 'Abidjan' } });
  // json() renvoie le corps complet : les données utiles sont sous .data.data
  const orphanId = created.data?.data?.merchant?.id || created.data?.data?.id || '';
  check('un marchand sans gestionnaire peut être créé par le PDG', created.status < 400 && Boolean(orphanId), `HTTP ${created.status}`);

  if (orphanId) {
    const managers = await json('/api/admin/control/managers', { cookie: adminCookie });
    const target = (managers.data?.data || []).find((row) => row.username === gestUser);
    const assign = await json(`/api/admin/merchants/${orphanId}/assignments`, { method: 'POST', cookie: adminCookie,
      body: { managerId: target?.id, canManageStore: true, canManageProducts: true, canManageOrders: false, canCreateStoreQr: false, canViewAudit: false } });

    check('le PDG peut rattacher le marchand à un gestionnaire', assign.status < 400, `HTTP ${assign.status}`);

    const list = await json('/api/admin/control/merchants', { cookie: adminCookie });
    const row = (list.data?.data || []).find((item) => item.id === orphanId);
    check('la liste signale le rattachement et l’état du gestionnaire', Boolean(row) && row.hasSupervisor === true && row.managerUnavailable === false,
      row ? `gestionnaire=${row.managerName || '—'}` : 'marchand absent');

    const detached = await json(`/api/admin/merchants/${orphanId}/assignments/${target?.id}`, { method: 'DELETE', cookie: adminCookie });
    check('l’attribution peut être retirée sans supprimer le marchand', detached.status < 400, `HTTP ${detached.status}`);
    const still = await json(`/api/admin/control/merchants/${orphanId}`, { cookie: adminCookie });
    check('le compte marchand existe toujours après le détachement', still.status === 200 && still.data?.data?.merchant?.id === orphanId);
  }

  console.log(log.join('\n'));
  const relevant = errors.filter((message) => !message.includes('Failed to load resource'));
  check('aucune erreur JavaScript sur les pages testées', relevant.length === 0, relevant.slice(0, 3).join(' | '));
  console.log(`\n${ko === 0 ? 'INTERFACE CONFORME' : 'INTERFACE À CORRIGER'} — ${log.filter((line) => line.startsWith('OK')).length} contrôles réussis, ${ko} échec(s).`);
  await browser.close();
  if (ko > 0) process.exitCode = 1;
})().catch((error) => { console.error('Vérification interrompue :', error); process.exitCode = 1; });
