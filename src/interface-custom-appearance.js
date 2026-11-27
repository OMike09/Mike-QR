'use strict';

// ============================================================================================
// MISSION 15 — APPARENCE GLOBALE DÉCIDÉE PAR LE PDG
//
// Le PDG choisit, pour tous les espaces de travail :
//   · les COULEURS      (fond, cartes, menus latéraux, textes, boutons, bordures, accent)
//   · les POLICES       (famille, taille de base, graisse, interligne)
//   · et peut PASSER OUTRE les préférences des comptes (mode « imposé »).
//
// Trois garde-fous, parce qu'une apparence imposée ne doit jamais rendre l'application illisible :
//   1. chaque couleur doit rester lisible : le serveur calcule le contraste et REFUSE (400) une
//      combinaison qui ferait passer un texte sous 4,5:1 ;
//   2. seules les valeurs connues sont acceptées (couleur hexadécimale, police d'une liste fermée,
//      tailles dans une plage) : aucune injection CSS possible ;
//   3. le module ne touche à AUCUNE donnée commerciale : il ne lit et n'écrit qu'un objet de style
//      rangé dans les réglages (`app_settings.interfaceCustom`).
//
// Le résultat est exposé au navigateur par les routes /api/*/interface qui renvoient des variables
// CSS prêtes à poser sur <html>. Aucune règle de permission n'est lue ni écrite ici.
// ============================================================================================

const FONTS = Object.freeze([
  ['system', 'Système (rapide, par défaut)'],
  ['inter', 'Inter (neutre, moderne)'],
  ['georgia', 'Georgia (serif, chaleureux)'],
  ['trebuchet', 'Trebuchet MS (rond, lisible)'],
  ['verdana', 'Verdana (très lisible, large)'],
  ['mono', 'Chasse fixe (technique)'],
]);

const FONT_STACKS = Object.freeze({
  system: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  inter: 'Inter, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  trebuchet: '"Trebuchet MS", "Segoe UI", Tahoma, sans-serif',
  verdana: 'Verdana, Geneva, Tahoma, sans-serif',
  mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
});

const COLOR_KEYS = Object.freeze([
  ['bg', 'Fond de page', '#f3f7f4'],
  ['surface', 'Cartes et panneaux', '#ffffff'],
  ['sidebar', 'Menu latéral', '#0d6b46'],
  ['sidebarText', 'Texte du menu', '#ffffff'],
  ['ink', 'Texte principal', '#162622'],
  ['muted', 'Texte secondaire', '#55655e'],
  ['accent', 'Boutons et accents', '#0d725c'],
  ['accentText', 'Texte des boutons', '#ffffff'],
  ['line', 'Bordures', '#dbe6df'],
  // §9 : le PDG règle la couleur des prix. Rouge par défaut ; l'italique est appliqué par la
  // feuille de style (choix validé avec le client) et n'est pas modifiable pour rester cohérent.
  ['price', 'Prix (rouge italique)', '#b3261e'],
]);

const DEFAULTS = Object.freeze({
  enabled: false,
  mode: 'default',              // 'default' : le compte garde son thème ; 'imposed' : le PDG impose
  colors: Object.fromEntries(COLOR_KEYS.map(([key, , value]) => [key, value])),
  font: 'system',
  baseSize: 16,                 // 14 à 20 px
  weight: 400,                  // 300 à 700
  lineHeight: 1.5,              // 1.3 à 1.9
  radius: 14,                   // 8 à 24 px (cartes et boutons)
  updatedAt: null,
  updatedBy: null,
});

const HEX = /^#[0-9a-f]{6}$/i;

function clampNumber(value, min, max, fallback, step = 1) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const rounded = step === 1 ? Math.round(n) : Math.round(n * 100) / 100;
  return Math.max(min, Math.min(max, rounded));
}

function luminance(hex) {
  const value = String(hex || '').replace('#', '');
  if (!HEX.test(`#${value}`)) return 0;
  const channel = (raw) => {
    const c = parseInt(raw, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(value.slice(0, 2)) + 0.7152 * channel(value.slice(2, 4)) + 0.0722 * channel(value.slice(4, 6));
}

function contrast(a, b) {
  const l1 = luminance(a); const l2 = luminance(b);
  const high = Math.max(l1, l2); const low = Math.min(l1, l2);
  return Math.round(((high + 0.05) / (low + 0.05)) * 100) / 100;
}

/** Paires qui doivent rester lisibles, avec le seuil WCAG AA (4,5:1 pour du texte courant). */
function readability(colors) {
  const pairs = [
    ['Texte principal sur le fond', colors.ink, colors.bg, 4.5],
    ['Texte principal sur les cartes', colors.ink, colors.surface, 4.5],
    ['Texte secondaire sur les cartes', colors.muted, colors.surface, 4.5],
    ['Texte du menu sur le menu', colors.sidebarText, colors.sidebar, 4.5],
    ['Texte des boutons sur le bouton', colors.accentText, colors.accent, 4.5],
    ['Prix sur les cartes', colors.price || '#b3261e', colors.surface, 4.5],
  ];
  return pairs.map(([label, foreground, background, minimum]) => {
    const ratio = contrast(foreground, background);
    return { label, foreground, background, ratio, minimum, ok: ratio >= minimum };
  });
}

/** Nettoie une entrée cliente : rien d'inconnu ne passe, rien d'illisible n'est accepté. */
function normalize(input, base = DEFAULTS) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const colors = { ...base.colors };
  for (const [key] of COLOR_KEYS) {
    const value = source.colors && source.colors[key];
    if (typeof value === 'string' && HEX.test(value.trim())) colors[key] = value.trim().toLowerCase();
  }
  const font = FONTS.some(([id]) => id === source.font) ? source.font : base.font;
  return {
    enabled: typeof source.enabled === 'boolean' ? source.enabled : base.enabled,
    mode: source.mode === 'imposed' ? 'imposed' : (source.mode === 'default' ? 'default' : base.mode),
    colors,
    font,
    baseSize: clampNumber(source.baseSize, 14, 20, base.baseSize),
    weight: clampNumber(source.weight, 300, 700, base.weight),
    lineHeight: clampNumber(source.lineHeight, 1.3, 1.9, base.lineHeight, 0.05),
    radius: clampNumber(source.radius, 8, 24, base.radius),
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : base.updatedAt,
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : base.updatedBy,
  };
}

/**
 * Valide une personnalisation. Renvoie { ok, value } ou { ok:false, error, pairs }.
 * Le refus est explicite : le PDG voit QUEL texte serait illisible et avec quel ratio.
 */
function validate(input, base = DEFAULTS) {
  const value = normalize(input, base);
  const pairs = readability(value.colors);
  const failing = pairs.filter((pair) => !pair.ok);
  if (failing.length) {
    return {
      ok: false,
      value,
      pairs,
      error: `Contraste insuffisant : ${failing.map((pair) => `${pair.label} (${pair.ratio}:1, minimum ${pair.minimum}:1)`).join(' ; ')}. Choisissez des couleurs plus contrastées.`,
    };
  }
  return { ok: true, value, pairs };
}

/** Variables CSS correspondant à la personnalisation (recalculées à partir de zéro, jamais concaténées). */
function cssVariables(custom) {
  const c = normalize(custom);
  if (!c.enabled) return {};
  const vars = {
    '--ui-bg': c.colors.bg,
    '--ui-surface': c.colors.surface,
    '--ui-ink': c.colors.ink,
    '--ui-text': c.colors.ink,
    '--ui-muted': c.colors.muted,
    '--ui-line': c.colors.line,
    '--ui-accent': c.colors.accent,
    '--ui-accent-text': c.colors.accentText,
    '--m14-side-bg': c.colors.sidebar,
    '--ui-sidebar-text': c.colors.sidebarText,
    '--ws-sidebar': c.colors.sidebar,
    '--ws-accent': c.colors.accent,
    '--ws-surface': c.colors.surface,
    '--ws-muted': c.colors.muted,
    '--ws-line': c.colors.line,
    // Le menu est peint avec ces deux variables par la coquille : on les aligne aussi.
    '--ws-sidebar-text': c.colors.sidebarText,
    '--ui-radius': `${c.radius}px`,
    '--ws-radius': `${c.radius}px`,
    '--ui-font': FONT_STACKS[c.font] || FONT_STACKS.system,
    '--ws-font': FONT_STACKS[c.font] || FONT_STACKS.system,
    '--ui-base-size': `${c.baseSize}px`,
    '--ui-weight': String(c.weight),
    '--ui-line-height': String(c.lineHeight),
  };
  return vars;
}

/** Résumé lisible pour le journal d'activité (jamais de secret, uniquement du style). */
function describe(custom) {
  const c = normalize(custom);
  if (!c.enabled) return 'Apparence personnalisée désactivée (chaque compte garde son thème).';
  return `Apparence ${c.mode === 'imposed' ? 'IMPOSÉE' : 'proposée'} : fond ${c.colors.bg}, accent ${c.colors.accent}, menu ${c.colors.sidebar}, police ${c.font} ${c.baseSize}px/${c.weight}.`;
}

module.exports = { DEFAULTS, COLOR_KEYS, FONTS, FONT_STACKS, normalize, validate, readability, cssVariables, describe, contrast, luminance, HEX };
