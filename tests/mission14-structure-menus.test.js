'use strict';

// ============================================================================================
// MISSION 14 — Garde-fous de la structure de référence (menu latéral).
//
// Ces tests protègent les règles qui ont coûté des bugs réels dans cette mission :
//   · un seul menu, dans un seul ordre, avec la déconnexion en bas ;
//   · aucune page orpheline (aucun bouton de menu sans écran, aucun écran sans entrée) ;
//   · une seule règle « vue → panneau » (plus deux règles qui se contredisent) ;
//   · aucun appel API avant l'ouverture de la session (plus de 401 dans la console) ;
//   · un gestionnaire de clic qui ignore les boutons sans identifiant de vue.
// ============================================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (file) => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

const HTML = read('merchant.html');
const UI = read('workspace-ui.js');
const SHELL = read('merchant-shell-m14.css');
const MERCHANT = read('merchant.js');
const HOME = read('merchant-home.js');

test('1. la coquille « menu latéral + contenu » est en place', () => {
  assert.match(HTML, /<aside class="m14-side" id="m14Side"/, 'le menu latéral existe');
  assert.match(HTML, /<nav class="ws-menu" id="workspaceMenu"/, 'le menu est rendu dans la colonne de gauche');
  assert.match(HTML, /<div class="m14-content" id="m14Content">/, 'la zone de contenu est distincte du menu');
  // La déconnexion est dans le pied du menu, pas au bas d'une page qui défile.
  const sideBlock = HTML.slice(HTML.indexOf('id="m14Side"'), HTML.indexOf('id="m14Content"'));
  assert.match(sideBlock, /id="mhLogout"/, '« Se déconnecter » est dans le pied du menu');
  assert.match(SHELL, /grid-template-columns: var\(--m14-side-width\) minmax\(0, 1fr\)/, 'deux colonnes sur ordinateur');
});

test('2. le menu suit exactement la structure de référence, dans l’ordre', () => {
  const order = [...UI.matchAll(/\{ id: '(\w+)', label: '([^']+)', icon:/g)].map((row) => row[2]);
  assert.deepEqual(order.slice(0, 8), [
    'Accueil', 'Commandes', 'Scanner', 'Vue d’ensemble',
    'Gestion des tables et espaces', 'Mon équipe', 'Voir les historiques', 'Paramètres',
  ]);
  // « Mon équipe › » a un sous-menu permanent sur ordinateur.
  assert.match(UI, /class="ws-chevron"/, 'le chevron « › » de Mon équipe');
  assert.match(UI, /function subMenuHtml\(\)/, 'le sous-menu est construit avec le menu (jamais effacé ensuite)');
});

test('3. rien n’est perdu : les anciennes rubriques sont devenues des entrées de Paramètres', () => {
  const settings = UI.slice(UI.indexOf("id: 'settings'"), UI.indexOf('];', UI.indexOf("id: 'settings'")));
  for (const entry of ['products', 'consignment', 'advanced', 'catalog', 'customize', 'account', 'appearance']) {
    assert.match(settings, new RegExp(`tab: '${entry}'`), `entrée « ${entry} » conservée dans Paramètres`);
  }
  // Les anciens panneaux restent dans le document (aucune suppression de données ni d'écran).
  for (const panel of ['panel-products', 'panel-consignment', 'panel-advanced', 'panel-tables', 'panel-orders']) {
    assert.match(HTML, new RegExp(`id="${panel}"`), `panneau ${panel} toujours présent`);
  }
});

test('4. une seule règle « vue → panneau », partagée par les deux modules', () => {
  assert.match(UI, /function targetPanelFor\(name\)/);
  assert.match(UI, /if \(name === 'overview'\) return 'panel-home'/);
  assert.match(UI, /return 'aucun-panneau'/);
  // merchant.js ne réinvente pas la règle : il l'emprunte.
  assert.match(MERCHANT, /WorkspaceUI\?\.targetPanelFor\?\.\(name\)/);
  // Et le panneau demandé est affiché AVANT le masquage des autres (sinon il s'éteint lui-même).
  const idxTarget = UI.indexOf('const target = document.getElementById(targetId)');
  const idxLoop = UI.indexOf("$$('.panel, .ws-hub').forEach((node) => { if (node.id !== targetId)");
  assert.ok(idxTarget > 0 && idxLoop > idxTarget, 'le panneau demandé passe en premier');
});

test('5. aucun écran n’est orphelin et aucun bouton n’est décoratif', () => {
  // Chaque entrée de rubrique pointe vers un panneau réellement présent dans la page.
  const tabs = [...new Set([...UI.matchAll(/\{ tab: '([a-z-]+)'/g)].map((row) => row[1]))];
  const missing = tabs.filter((tab) => {
    if (tab === 'home' || tab === 'overview') return false; // accueil + vue d'ensemble (panel-home)
    return !HTML.includes(`id="panel-${tab}"`);
  });
  assert.deepEqual(missing, [], `entrées sans panneau : ${missing.join(', ')}`);
  // L'ancienne barre d'onglets est retirée à l'exécution : plus de doublon de navigation.
  assert.match(UI, /if \(rail\.parentNode\) rail\.remove\(\)/);
  // Un bouton .tab sans data-tab ne doit plus déclencher tab(undefined).
  assert.match(MERCHANT, /if \(!button\.dataset\.tab\) return;/);
});

test('6. aucune requête avant l’ouverture de la session (plus de 401 au chargement)', () => {
  assert.match(read('member-accounts.js'), /if \(!document\.body\.dataset\.wsApp\) return;/);
  assert.match(read('member-accounts.js'), /workspace:session/);
});

test('7. le menu est utilisable au téléphone (tiroir) et ne cache jamais le contenu', () => {
  assert.match(HTML, /id="m14MenuToggle"/, 'bouton Menu du bandeau');
  assert.match(HTML, /id="m14MenuScrim"/, 'fond cliquable du tiroir');
  assert.match(SHELL, /transform: translateX\(-104%\)/, 'le tiroir est fermé par défaut');
  assert.match(SHELL, /\.m14-side\.is-open \{ transform: translateX\(0\)/, 'il s’ouvre au clic');
  assert.match(UI, /function closeMobileMenu\(\)/, 'il se referme après le choix d’une rubrique');
  assert.match(UI, /openTab\(button\.dataset\.subTab[\s\S]{0,120}closeMobileMenu\(\)|closeMobileMenu\(\);\n      openTab\(button\.dataset\.subTab/);
});

test('8. les trois thèmes pilotent aussi le menu latéral', () => {
  for (const theme of ['black-gold', 'blue-white']) {
    assert.match(SHELL, new RegExp(`html\\[data-interface-theme="${theme}"\\]`), `thème ${theme} pris en charge`);
  }
  // Les couleurs du menu sont des variables : aucun vert figé dans les règles du menu.
  assert.match(SHELL, /--m14-side-bg: var\(--ws-sidebar, #0d6b46\)/);
});

test('9. la déconnexion ne peut pas rester sans effet', () => {
  // Le bouton a quitté l'accueil pour le menu : son gestionnaire doit exister quel que soit
  // l'ordre de chargement des scripts.
  // Le bouton a quitté l'accueil pour le menu : trois voies de secours, dans cet ordre.
  assert.match(HOME, /const handler = window\.__wsLogout;/);
  assert.match(HOME, /if \(typeof handler === 'function'\) \{ handler\(\); return; \}/);
  assert.match(HOME, /shell\?\.confirmLogout && button\) \{ shell\.confirmLogout/);
  assert.match(HOME, /button\?\.click\(\);/);
});

test('10. la feuille de style de la coquille est chargée en dernier', () => {
  const links = [...HTML.matchAll(/href="\/([^"]+\.css)"/g)].map((row) => row[1]);
  assert.equal(links.at(-1), 'merchant-shell-m14.css', 'sinon les règles de menus historiques la recouvrent');
});
