'use strict';

// ============================================================================================
// MISSION 15 — Écran PDG « Apparence des espaces » (§9).
//
// Ce que ces tests protègent :
//   · les valeurs fermées (9 couleurs, 6 polices, 14-20 px, 300-700, 1,3-1,9, 8-24 px) ;
//   · le refus d'une apparence illisible (contraste WCAG AA 4,5:1 sur les 5 paires de texte) ;
//   · la publication des variables CSS réellement consommées par les espaces de travail,
//     y compris le texte du menu (--ui-sidebar-text, oublié jusqu'ici) ;
//   · le câblage réel de l'écran : entrée de menu, panneau, script, et les trois routes
//     (lire / enregistrer / revenir aux valeurs d'origine) — aucun bouton décoratif.
// ============================================================================================
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appearance = require('../interface-custom-appearance');
const root = path.resolve(__dirname, '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

const PUBLIC = ['public'];
const INDEX = read(...PUBLIC, 'index.html');
const ADMIN = read(...PUBLIC, 'admin.js');
const PANEL = read(...PUBLIC, 'admin-appearance-custom.js');
const ROUTES = read('admin-control-routes-2.js');
const SHELL_CSS = read(...PUBLIC, 'merchant-shell-m14.css');

const LISIBLE = {
  enabled: true, mode: 'imposed',
  colors: {
    bg: '#f3f7f4', surface: '#ffffff', sidebar: '#0d6b46', sidebarText: '#ffffff',
    ink: '#162622', muted: '#55655e', accent: '#0d725c', accentText: '#ffffff', line: '#dbe6df',
  },
  font: 'georgia', baseSize: 18, weight: 500, lineHeight: 1.6, radius: 18,
};

test('§9 — palette de couleurs et 6 polices, toutes nommées', () => {
  // §9 : le PDG règle aussi la couleur des PRIX → 10 couleurs réglables.
  assert.equal(appearance.COLOR_KEYS.length, 10);
  assert.ok(appearance.COLOR_KEYS.some(([key]) => key === 'price'), 'la couleur des prix est réglable');
  assert.equal(appearance.FONTS.length, 6);
  for (const [, label] of appearance.COLOR_KEYS) assert.ok(label && label.length > 2, 'chaque couleur a un libellé lisible');
  const ids = appearance.FONTS.map(([id]) => id);
  assert.deepEqual(ids, ['system', 'inter', 'georgia', 'trebuchet', 'verdana', 'mono']);
  for (const id of ids) assert.ok(appearance.FONT_STACKS[id], `la police ${id} a une pile CSS réelle`);
});

test('§9 — les plages demandées sont respectées : 14-20 px, graisse, interligne, arrondi', () => {
  const out = appearance.normalize({ baseSize: 5, weight: 900, lineHeight: 3, radius: 99 });
  assert.equal(out.baseSize, 14, 'une taille trop petite est ramenée à 14 px');
  assert.equal(out.weight, 700, 'une graisse trop forte est ramenée à 700');
  assert.equal(out.lineHeight, 1.9);
  assert.equal(out.radius, 24);
  const high = appearance.normalize({ baseSize: 40, weight: 100, lineHeight: 1, radius: 2 });
  assert.equal(high.baseSize, 20, 'une taille trop grande est ramenée à 20 px');
  assert.equal(high.weight, 300);
  assert.equal(high.lineHeight, 1.3);
  assert.equal(high.radius, 8);
});

test('§9 — rien d’inconnu n’entre : ni police inventée, ni couleur non hexadécimale', () => {
  const out = appearance.normalize({
    font: 'comic-sans', colors: { ink: 'red', accent: '#0d725c; background:url(x)', bg: ' #EEF3FF ' }, extra: { a: 1 },
  });
  assert.equal(out.font, 'system', 'une police hors liste retombe sur la police système');
  assert.equal(out.colors.ink, '#162622', 'une couleur non hexadécimale est ignorée');
  assert.equal(out.colors.accent, '#0d725c', 'aucune injection CSS ne peut passer');
  assert.equal(out.colors.bg, '#eef3ff', 'une couleur valide est normalisée en minuscules, sans espace');
  assert.equal(Object.hasOwn(out, 'extra'), false, 'les clés inconnues ne sont pas conservées');
});

test('§9 — une apparence illisible est refusée, avec la paire fautive nommée', () => {
  const bad = appearance.validate({ ...LISIBLE, colors: { ...LISIBLE.colors, sidebarText: '#0d6b46' } });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /Contraste insuffisant/);
  assert.match(bad.error, /Texte du menu sur le menu/);
  const pair = bad.pairs.find((p) => p.label === 'Texte du menu sur le menu');
  assert.equal(pair.ok, false);
  assert.ok(pair.ratio < 4.5);
  assert.equal(bad.pairs.length, 6, 'les 6 paires de texte sont toujours contrôlées (dont les prix)');
  assert.equal(appearance.readability(LISIBLE.colors).every((p) => p.ok), true, 'la palette par défaut reste lisible');
  assert.equal(appearance.validate(LISIBLE).ok, true);
});

test('§9 — les variables CSS publiées sont celles consommées par les espaces', () => {
  const vars = appearance.cssVariables(LISIBLE);
  for (const name of ['--ui-bg', '--ui-surface', '--ui-ink', '--ui-muted', '--ui-line', '--ui-accent', '--ui-accent-text',
    '--m14-side-bg', '--ui-sidebar-text', '--ui-radius', '--ui-font', '--ui-base-size', '--ui-weight', '--ui-line-height']) {
    assert.ok(Object.hasOwn(vars, name), `variable ${name} publiée`);
  }
  assert.equal(vars['--m14-side-bg'], '#0d6b46');
  assert.equal(vars['--ui-sidebar-text'], '#ffffff');
  assert.equal(vars['--ui-base-size'], '18px');
  assert.equal(vars['--ui-radius'], '18px');
  assert.match(vars['--ui-font'], /Georgia/);
  assert.deepEqual(appearance.cssVariables({ ...LISIBLE, enabled: false }), {}, 'désactivée, aucune variable n’est imposée');
});

test('§9 — le texte du menu suit réellement la couleur choisie (régression corrigée)', () => {
  // Le serveur publie --ui-sidebar-text et la feuille de style du menu la lit : avant, la règle
  // visait --ws-sidebar-text, jamais transmise, donc le texte ne suivait pas le fond.
  assert.match(SHELL_CSS, /\.m14-side \.ws-menu (button|a)[\s\S]{0,160}color: var\(--ui-sidebar-text/, 'le menu lit la couleur imposée');
  assert.doesNotMatch(SHELL_CSS, /color: var\(--ws-sidebar-text/, 'plus aucune règle ne lit une variable jamais transmise');
});

test('§9 — l’écran PDF est câblé : entrée de menu, panneau, script, montage', () => {
  assert.match(INDEX, /data-view="admin-interface"/, 'entrée de menu « Apparence des espaces »');
  assert.match(INDEX, /id="view-admin-interface"/, 'panneau correspondant');
  assert.match(INDEX, /src="\/admin-appearance-custom\.js"/, 'script chargé');
  assert.match(ADMIN, /'admin-interface'/, 'vue reconnue par la navigation');
  assert.match(ADMIN, /QRIAAdminAppearance\?\.mount/, 'montage réel de l’écran');
  assert.match(ADMIN, /'admin-interface': 'Apparence des espaces'/, 'fil d’Ariane renseigné');
});

test('§9 — les trois actions appellent les vraies routes, sans simulation locale', () => {
  assert.match(PANEL, /const API = '\/api\/admin\/control\/interface-custom'/);
  assert.match(PANEL, /method: 'PUT'/, 'enregistrement par PUT');
  assert.match(PANEL, /`\$\{API\}\/reset`/, 'retour aux valeurs d’origine');
  assert.match(PANEL, /POST/, 'reset en POST');
  assert.doesNotMatch(PANEL, /localStorage\.setItem/, 'l’apparence n’est pas simulée en local côté PDG');
  // Les 9 couleurs, la police et les quatre réglages sont tous présents dans le formulaire.
  assert.match(PANEL, /state\.colors\.map/, 'les couleurs viennent du serveur');
  assert.match(PANEL, /#aacBaseSize[\s\S]*#aacLineHeight[\s\S]*#aacRadius/, 'taille, interligne et arrondi réglables');
  assert.match(PANEL, /id="aacReset"[\s\S]*Revenir aux valeurs d’origine/, 'bouton de retour aux valeurs d’origine');
});

test('§9 — le serveur refuse un contraste insuffisant et journalise chaque changement', () => {
  assert.match(ROUTES, /CONTRAST_TOO_LOW/, 'code d’erreur explicite');
  assert.match(ROUTES, /status\(400\)/, 'refus en 400');
  assert.match(ROUTES, /interface_appearance_updated/, 'changement journalisé');
  assert.match(ROUTES, /interface_appearance_reset/, 'retour aux valeurs d’origine journalisé');
  assert.match(ROUTES, /updateSettings\(\{ interfaceCustom: value \}\)/, 'persistance dans les réglages');
});
