'use strict';

// ============================================================================================
// Mission 11 · sous-prompt 3 — vérifications automatiques du scanner, des historiques et de
// l'accueil stable (marchand et équipe).
//
// Ces tests protègent les exigences du terrain, pas l'implémentation :
//   1. la caméra démarre directement et accepte les appareils qui refusent `facingMode` strict ;
//   2. aucun enregistrement vidéo / photo / capture d'écran n'est possible depuis le scanner ;
//   3. la saisie manuelle reste disponible quand la caméra échoue, avec un message clair ;
//   4. Commandes, Scanner et Vue d'ensemble ne disparaissent jamais (tuiles + barre permanente) ;
//   5. la vue active est restaurée après actualisation ;
//   6. les historiques sont filtrés par le serveur selon le rôle (jamais un autre établissement).
// ============================================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFile(path.join(root, file), 'utf8');
const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

// ------------------------------------------------------------------ jsdom utilitaire
async function staffDom(t, { fetchImpl, session = { role: 'waitress', permissions: ['orders.view', 'scans.use', 'orders.create', 'orders.update'] } } = {}) {
  const html = await read('public/staff.html');
  const dom = new JSDOM(html, { url: 'https://equipe.example.test/equipe/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  w.fetch = fetchImpl || (async () => ({ ok: true, status: 200, async json() { return { data: {} }; } }));
  w.HTMLMediaElement.prototype.play = async () => {};
  w.HTMLMediaElement.prototype.pause = () => {};
  w.scrollTo = () => {};
  w.confirm = () => true;
  for (const script of ['public/lazy-scripts.js', 'public/qr-camera.js', 'public/history-view.js', 'public/workspace-shell.js', 'public/staff-workspace.js', 'public/overview-view.js']) {
    w.eval(await read(script));
  }
  if (t?.after) t.after(() => { try { dom.window.close(); } catch (_) {} });
  return { w, session, dom };
}

// ------------------------------------------------------------------ 1. caméra : contraintes souples
test('scanner : la caméra arrière est demandée sans contrainte stricte, avec des replis successifs', async () => {
  const source = await read('public/qr-camera.js');
  assert.match(source, /facingMode: \{ ideal: wanted \}/, 'la caméra arrière est demandée en « idéal », jamais en contrainte stricte');
  assert.doesNotMatch(source, /facingMode: 'environment' \}/, 'aucune contrainte stricte ne peut provoquer un écran noir');
  assert.match(source, /video: true, audio: false/, 'un dernier repli ouvre la caméra disponible (ordinateur, ancien téléphone)');
  assert.match(source, /if \(\['NotAllowedError', 'SecurityError', 'PermissionDeniedError'\]\.includes/, 'un refus explicite arrête les tentatives au lieu de boucler');
  assert.match(source, /qrCameraManualInput/, 'la saisie manuelle est présente dans la fenêtre du scanner');
  assert.match(source, /MESSAGES\.insecure|isSecureContext/, 'le manque de HTTPS est expliqué à l’utilisateur');
  assert.match(source, /MESSAGES\.denied/, 'le refus de permission est expliqué');
  assert.match(source, /MESSAGES\.missing/, 'l’absence de caméra est expliquée');
  assert.match(source, /MESSAGES\.busy/, 'une caméra occupée est expliquée');
  assert.match(source, /capabilities\.torch/, 'la torche est proposée quand l’appareil la permet');
});

// ------------------------------------------------------------------ 2. aucun enregistrement
test('scanner : aucune photo, aucune vidéo, aucun enregistrement d’écran n’est possible', async () => {
  // Seuls les fichiers du scanner sont concernés : la compression des photos de produits
  // (merchant.js) est un autre usage, autorisé et inchangé.
  const sources = await Promise.all([read('public/qr-camera.js'), read('public/staff.js'), read('public/merchant-scanner.js'), read('public/workspace-ui.js')]);
  for (const source of sources) {
    // On ne cherche pas le mot dans un commentaire : seulement un usage réel de l'API.
    assert.doesNotMatch(source, /new\s+MediaRecorder|MediaRecorder\s*\(/, 'aucun enregistrement vidéo');
    assert.doesNotMatch(source, /getDisplayMedia/, 'aucun enregistrement d’écran');
    assert.doesNotMatch(source, /capture\s*[:=]|accept="video\/\*"|accept="image\/\*"/, 'aucune capture photo ou vidéo');
    // `drawImage` sur un canvas est nécessaire pour décoder ; ce qui est interdit, c'est de
    // conserver l'image (téléchargement, blob, data URL envoyée au serveur).
    assert.doesNotMatch(source, /\.toDataURL\(|\.toBlob\(/, 'aucune image du flux n’est conservée');
  }
  const html = await read('public/staff.html');
  assert.doesNotMatch(html, /accept="video\/\*"|enregistrer la vidéo|record/i, 'aucun bouton d’enregistrement dans l’espace équipe');
  const merchantHtml = await read('public/merchant.html');
  assert.match(merchantHtml, /aucune photo, aucune vidéo/, 'l’absence d’enregistrement est annoncée clairement');
});

// ------------------------------------------------------------------ 3. saisie manuelle si échec
test('scanner : si la caméra échoue, la saisie manuelle reste utilisable et le message est explicite', async (t) => {
  const { w } = await staffDom(t);
  const mediaDevices = {
    getUserMedia: async () => { const error = new Error('refusée'); error.name = 'NotAllowedError'; throw error; },
    enumerateDevices: async () => [],
  };
  Object.defineProperty(w.navigator, 'mediaDevices', { value: mediaDevices, configurable: true });
  Object.defineProperty(w, 'isSecureContext', { value: true, configurable: true });
  w.QrCamera.open({ onRead: () => {} });
  await tick(40);
  const overlay = w.document.getElementById('qrCameraOverlay');
  assert.ok(overlay && !overlay.hidden, 'la fenêtre du scanner s’ouvre');
  assert.match(w.document.getElementById('qrCameraStatus').textContent, /refusé|autoris/i, 'le refus est expliqué sans jargon');
  assert.equal(w.document.getElementById('qrCameraManualInput') !== null, true, 'la saisie manuelle est proposée');
  assert.match(w.document.getElementById('qrCameraManualForm').textContent, /Vérifier|Vérifiez/i);
  assert.notEqual(w.document.getElementById('qrCameraRetry').hidden, true, 'un bouton « Réessayer » est proposé');
});

test('scanner : la saisie manuelle renvoie le code saisi au même contrôle que la caméra', async (t) => {
  const { w } = await staffDom(t);
  let received = null;
  w.QrCamera.open({ onRead: (value, via) => { received = { value, via }; } });
  await tick(10);
  w.document.getElementById('qrCameraManualInput').value = '/t/table-1';
  w.document.getElementById('qrCameraManualForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await tick(10);
  assert.deepEqual(received, { value: '/t/table-1', via: 'manual' }, 'le code manuel est traité par le même chemin, avec sa provenance');
});

// ------------------------------------------------------------------ 4. permanence des trois fonctions
test('accueil équipe : Commandes, Scanner et Vue d’ensemble restent présents et visibles', async (t) => {
  const { w } = await staffDom(t);
  const rail = w.document.getElementById('staffPermanentRail');
  assert.ok(rail, 'la barre permanente existe');
  assert.deepEqual([...rail.querySelectorAll('[data-staff-rail]')].map((b) => b.dataset.staffRail), ['orders', 'scan', 'home']);
  // On quitte l'accueil : la barre reste affichée et les tuiles ne sont pas retirées.
  w.StaffWorkspace.openRubric('activity');
  await tick(10);
  assert.equal(rail.hidden, false, 'la barre reste affichée après un changement de rubrique');
  assert.equal(w.document.getElementById('staffTiles').hidden, false, 'les tuiles d’accueil ne sont pas masquées');
  assert.equal(w.document.querySelectorAll('#staffTiles [data-staff-action]').length, 3, 'les trois actions restent dans le document');
  w.StaffWorkspace.openRubric('history');
  await tick(10);
  assert.equal(rail.hidden, false, 'la barre reste affichée dans les historiques');
  assert.equal(w.document.getElementById('panel-history').hidden, false, 'le panneau d’historiques s’ouvre');
});

test('accueil marchand : la barre permanente reste visible sur chaque page', async () => {
  const html = await read('public/merchant.html');
  const source = await read('public/workspace-ui.js');
  assert.match(html, /id="wsPermanentRail"/, 'la barre permanente est dans la page');
  assert.match(html, /data-rail="orders"[\s\S]*data-rail="scan"[\s\S]*data-rail="home"/, 'Commandes, Scanner, Vue d’ensemble');
  assert.match(source, /function toggleTiles\(\) \{ \/\* les raccourcis permanents ne sont plus masqués \*\/ \}/, 'les tuiles ne sont plus masquées quand on change de vue');
  assert.match(source, /function renderRail\(\)/, 'l’état actif de la barre est recalculé à chaque changement de vue');
});

// ------------------------------------------------------------------ 5. restauration de vue
test('actualisation : la vue active est retrouvée après rechargement (équipe et marchand)', async () => {
  const staffSource = await read('public/staff-workspace.js');
  const merchantSource = await read('public/workspace-ui.js');
  assert.match(staffSource, /oymike:staff-view:v1/, 'la vue équipe est mémorisée');
  assert.match(staffSource, /function restoreView\(\)/, 'elle est restaurée au chargement');
  assert.match(merchantSource, /oymike:workspace-view:v1/, 'la vue marchand est mémorisée');
  assert.match(merchantSource, /function restoreView\(\)/, 'elle est restaurée au chargement');
  assert.match(merchantSource, /rememberView\(\)/, 'chaque ouverture d’écran met la mémoire à jour');
});

// ------------------------------------------------------------------ 6. historiques : périmètre serveur
test('historiques : la route serveur résout le périmètre depuis la session, jamais depuis le navigateur', async () => {
  const source = await read('history-routes.js');
  assert.match(source, /app\.get\('\/api\/history'/, 'une seule route pour tous les rôles');
  assert.match(source, /CATEGORY_DENIED/, 'une catégorie non autorisée est refusée côté serveur');
  assert.match(source, /actor\.role === 'manager'[\s\S]*manager_id=\$1/, 'le gestionnaire ne voit que ses marchands');
  assert.match(source, /actor\.role === 'merchant'\) return \{ all: false, merchantIds: \[actor\.id\]/, 'le marchand ne voit que son établissement');
  assert.match(source, /function selfOnly\(actor\)[\s\S]*waitress/, 'une serveuse ne voit que ses propres actions');
  assert.match(source, /periodBounds/, 'les cinq périodes demandées sont prises en charge');
  for (const period of ['today', 'yesterday', 'week', 'month', 'custom']) {
    assert.match(source, new RegExp(`case '${period}'`), `période ${period}`);
  }
  assert.doesNotMatch(source, /req\.query\.(merchantId|storeId|memberId)/, 'aucun identifiant d’établissement n’est accepté depuis l’URL');
});

test('historiques : la page propose les filtres et la recherche demandés', async () => {
  const source = await read('public/history-view.js');
  for (const label of ['Aujourd’hui', 'Hier', 'Cette semaine', 'Ce mois', 'Période personnalisée']) {
    assert.ok(source.includes(label), `filtre « ${label} »`);
  }
  assert.match(source, /placeholder="Nom, n° de commande, table, membre/, 'recherche par nom, commande, table, membre');
  assert.match(source, /history-status/, 'chaque ligne porte un statut');
  assert.match(source, /history-row-meta[\s\S]*when\.date[\s\S]*when\.time[\s\S]*row\.person/, 'chaque ligne porte action, date, heure et personne');
  assert.match(source, /history-steps|meta\.events/, 'les étapes d’une commande sont détaillées');
});

test('vue d’ensemble : quatre chiffres cliquables, aucun texte long', async () => {
  const source = await read('public/overview-view.js');
  assert.match(source, /\/api\/overview/, 'les chiffres viennent du serveur');
  assert.match(source, /data-ov-card/, 'les cartes sont cliquables');
  assert.match(source, /overviewView/, 'une carte ouvre la liste correspondante');
  assert.doesNotMatch(source, /rgba\(|linear-gradient/, 'aucun style décoratif dans la logique');
  const routes = await read('overview-routes.js');
  assert.match(routes, /app\.get\('\/api\/overview'/, 'route serveur de la vue d’ensemble');
  assert.match(routes, /scope\.memberId \? ' AND \(o\.created_by_member_id=\$3 OR o\.assigned_member_id=\$3\)'/, 'une serveuse ne voit que ses commandes');
});
