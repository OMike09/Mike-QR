'use strict';

// ============================================================================================
// MISSION 13 — Garde-fous de l'accueil marchand « maquette client ».
//
// Ces tests ne vérifient pas des couleurs : ils vérifient les RÈGLES qui empêchent les régressions
// déjà vécues sur ce projet (écran qui se superpose, bouton qui ne fait rien, seconde gestion de
// tables, données de démonstration présentées comme réelles, caméra qui redemande une photo…).
// ============================================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

const HTML = read('merchant.html');
const HOME_JS = read('merchant-home.js');
const HOME_CSS = read('merchant-home.css');
const WORKSPACE_UI = read('workspace-ui.js');

test('1. les quatre zones de la maquette existent dans l’accueil marchand', () => {
  for (const id of ['merchantHomeShell', 'mhHero', 'mhActivity', 'mhScanPanel', 'mhTablesPanel', 'mhTeamPanel', 'mhThemesPanel']) {
    assert.match(HTML, new RegExp(`id="${id}"`), `zone manquante : ${id}`);
  }
  // Les trois actions principales, avec leur destination explicite.
  assert.match(HTML, /data-mh-goto="orders"/);
  assert.match(HTML, /data-mh-goto="scan"/);
  assert.match(HTML, /data-mh-goto="overview"/);
  // La déconnexion reste en bas de la page d'accueil (mission 11 conservée).
  assert.match(HTML, /id="mhLogout"/);
});

test('2. aucun chiffre de démonstration n’est codé en dur dans l’accueil', () => {
  // Les valeurs de la maquette (5, 12, 28, 8/10) ne doivent jamais être écrites dans le code :
  // elles viennent toutes de /api/overview.
  const suspicious = [/Chez Gbaziké/i, /M\.?\s*Diallo/i, /Kouassi/i, /Table\s*1\b.*Disponible/i, /8\s*\/\s*10/];
  for (const pattern of suspicious) {
    assert.doesNotMatch(HOME_JS, pattern, `donnée de démonstration trouvée : ${pattern}`);
  }
  // Et les sources réelles sont bien appelées.
  for (const endpoint of ['/api/overview', '/api/merchant/table-management', '/api/merchant/member-accounts', '/api/merchant/appearance', '/api/merchant/store']) {
    assert.ok(HOME_JS.includes(endpoint), `source de données absente : ${endpoint}`);
  }
});

test('3. pas de seconde gestion des tables ni de seconde création de compte', () => {
  // Créer une table reste l'affaire de /api/merchant/table-management, appelée par la page
  // existante : l'accueil ne fait qu'ouvrir cet écran.
  assert.doesNotMatch(HOME_JS, /table-management\/tables/, 'l’accueil ne doit pas créer de table lui-même');
  assert.doesNotMatch(HOME_JS, /table-management\/salons/, 'l’accueil ne doit pas créer de salon lui-même');
  assert.doesNotMatch(HOME_JS, /\/api\/merchant\/team\/members/, 'l’accueil ne doit pas créer de membre lui-même');
  // En revanche, suspendre/réactiver un compte réutilise la route validée de la mission 12.
  assert.match(HOME_JS, /member-accounts\/\$\{[^}]+\}\/status/);
});

test('4. l’ancien accueil est conservé mais ne se superpose plus', () => {
  // Rien n'est supprimé du document (les modules continuent de l'alimenter)…
  assert.match(HTML, /id="panel-home"/);
  assert.match(HTML, /id="homeOverview"/);
  // …mais il n'est plus affiché sur l'accueil : une seule vue à l'écran. Le masquage est fait par
  // le script (setPanels) pour « home », et #panel-home ne sert plus que d'écran « Vue d'ensemble ».
  assert.match(HOME_CSS, /#panel-home n'est plus l'accueil/);
  assert.match(WORKSPACE_UI, /name === 'home' && document\.getElementById\('merchantHomeShell'\)\) \? 'aucun-panneau'/);
  // Le bloc d'accueil est explicitement masqué sur toutes les autres vues.
  assert.match(WORKSPACE_UI, /merchantHomeShell'\)[\s\S]{0,80}hidden = name !== 'home'/);
});

test('5. le scanner réutilise le moteur existant, sans photo ni vidéo', () => {
  assert.match(HOME_JS, /window\.QrCamera\.open\(/);
  assert.doesNotMatch(HOME_JS, /MediaRecorder|toDataURL|getDisplayMedia|captureStream/);
  // La caméra est bien arrêtée en quittant l'accueil.
  assert.match(HOME_JS, /function showHome\([\s\S]{0,400}closeCamera\(\)/);
  // Un QR refusé (autre boutique, désactivé) ne doit pas rediriger l'utilisateur.
  assert.match(HOME_JS, /window\.__wsLastScan/);
  assert.match(HOME_JS, /if \(!outcome\.ok\)/);
});

test('6. un seul branchement d’écouteurs (pas de double caméra)', () => {
  assert.match(HOME_JS, /let bound = false/);
  assert.match(HOME_JS, /if \(!node \|\| bound\) return/);
});

test('7. le thème choisi est enregistré sur le serveur, pas seulement dans le navigateur', () => {
  assert.match(HOME_JS, /method:\s*'PUT'[\s\S]{0,120}\/api\/merchant\/appearance|\/api\/merchant\/appearance'[\s\S]{0,200}method:\s*'PUT'/);
  // Les trois thèmes de la mission 11 sont proposés, avec leur libellé français.
  for (const label of ['Vert - Blanc', 'Noir - Or', 'Blanc - Bleu']) assert.ok(HOME_JS.includes(label), `thème manquant : ${label}`);
  // Un échec d'enregistrement revient à l'ancien thème : jamais un état incohérent.
  assert.match(HOME_JS, /applyTheme\?\.\(previous\)|applyTheme\?\.\(state\.savedTheme\)/);
});

test('8. les boutons de l’accueil ouvrent les écrans existants (aucun bouton décoratif)', () => {
  // Tous les boutons portent soit une destination, soit une action identifiée.
  const handlers = ['data-mh-goto', 'data-mh-go', 'data-mh-theme', 'data-mh-theme-option', 'data-mh-edit-table', 'data-mh-member', 'data-mh-retry'];
  const htmlButtons = HTML.match(/<button[^>]*>/g) || [];
  const homeButtons = htmlButtons.filter((tag) => /mh-/.test(tag));
  assert.ok(homeButtons.length >= 8, 'les boutons de l’accueil sont attendus');
  for (const tag of homeButtons) {
    const identified = handlers.some((name) => tag.includes(name)) || /id="mh[A-Za-z]+"/.test(tag);
    assert.ok(identified, `bouton sans action : ${tag}`);
  }
  // Chaque destination annoncée est traitée par go().
  for (const target of ['orders', 'scan', 'overview', 'tables', 'tables-add', 'team', 'team-create', 'appearance']) {
    assert.match(HOME_JS, new RegExp(`case '${target}':`), `destination non traitée : ${target}`);
  }
});

test('9. la page reste lisible et utilisable sur téléphone', () => {
  // Les trois actions passent en grille de 3 à taille lisible, et les colonnes s'empilent.
  assert.match(HOME_CSS, /@media \(max-width: 720px\)/);
  assert.match(HOME_CSS, /\.mh-alt \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(HOME_CSS, /\.mh-activity-grid \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  // Aucun texte tronqué par une largeur fixe sur les libellés de boutons.
  assert.doesNotMatch(HOME_CSS, /\.mh-action-label \{[^}]*white-space:\s*nowrap/);
});

test('10. le service worker est versionné après ce changement', () => {
  const sw = read(path.join('merchant', 'sw.js'));
  const version = /oymike-merchant-shell-v(\d+)/.exec(sw);
  assert.ok(version, 'version du cache introuvable');
  assert.ok(Number(version[1]) >= 7, 'le cache doit être incrémenté (v7) pour servir les nouveaux fichiers');
  assert.match(sw, /merchant-home\.js/);
  assert.match(sw, /merchant-home\.css/);
});
