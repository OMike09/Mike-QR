// Mission 11 — Apparence des espaces de travail (marchand, gérant général, serveuse, serveur).
//
// Trois thèmes choisis par le marchand, un thème par défaut (ou une imposition) décidé par le PDG.
// Ce module ne règle QUE des couleurs et des styles visuels : il ne lit et n'écrit aucune
// permission, aucun rôle, aucun accès. Un test le vérifie explicitement.
//
// Ce qui est stocké :
//   - `merchant_stores.interface_theme` : le choix du marchand ('green' | 'black-gold' | 'blue-white'),
//     conservé en base, donc identique après déconnexion/reconnexion et sur un autre appareil ;
//   - `app_settings.merchantInterface.appearance` : la décision du PDG
//     ({ defaultTheme, mode: 'default' | 'imposed' }).
//
// Le PDG peut donc : définir le thème par défaut, imposer un thème à tous les marchands,
// et relire les thèmes réellement utilisés (tableau de bord des réglages).
'use strict';

const THEME_IDS = Object.freeze(['green', 'black-gold', 'blue-white']);

// Contraste WCAG : (L1 + 0,05) / (L2 + 0,05).
function luminance(hex) {
  const value = String(hex || '').replace('#', '');
  if (!/^[0-9a-f]{6}$/i.test(value)) return 0;
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

const THEMES = Object.freeze({
  green: Object.freeze({
    id: 'green', label: 'Vert et blanc', hint: 'Le thème actuel, nature et lisible.',
    colors: {
      bg: '#f3f7f4', surface: '#ffffff', surfaceAlt: '#f7fbf8', ink: '#162622', muted: '#55655e',
      line: '#dbe6df', accent: '#0d725c', accentDark: '#0a5443', accentText: '#ffffff', soft: '#e9f5ef',
      highlight: '#a8761c', highlightSoft: '#fdf5e4', danger: '#b3261e', onDark: '#ffffff',
    },
  }),
  'black-gold': Object.freeze({
    id: 'black-gold', label: 'Noir et or', hint: 'Élégant et haut de gamme.',
    colors: {
      bg: '#111214', surface: '#1a1c1f', surfaceAlt: '#202327', ink: '#f6f1e6', muted: '#b8b1a1',
      line: '#33373d', accent: '#d4af37', accentDark: '#b3901f', accentText: '#141414', soft: '#2a2a24',
      highlight: '#f0cf6a', highlightSoft: '#332d1c', danger: '#ff8f86', onDark: '#f6f1e6',
    },
  }),
  'blue-white': Object.freeze({
    id: 'blue-white', label: 'Blanc et bleu', hint: 'Moderne, clair et professionnel.',
    colors: {
      bg: '#f4f7fc', surface: '#ffffff', surfaceAlt: '#f7f9fd', ink: '#12203a', muted: '#55627a',
      line: '#d8e2f1', accent: '#1f5fd0', accentDark: '#17479c', accentText: '#ffffff', soft: '#e8f0fe',
      highlight: '#a2620c', highlightSoft: '#fdf3e2', danger: '#b3261e', onDark: '#ffffff',
    },
  }),
});

const DEFAULT_THEME = 'green';

function themeIds() { return [...THEME_IDS]; }
function isThemeId(value) { return THEME_IDS.includes(String(value || '')); }

// Normalise la décision du PDG. Toute valeur inconnue retombe sur le thème par défaut :
// un réglage corrompu ne doit jamais rendre un espace inutilisable.
function normalizeAppearance(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const defaultTheme = isThemeId(source.defaultTheme) ? source.defaultTheme : DEFAULT_THEME;
  return {
    defaultTheme,
    // 'imposed' : le thème du PDG s'applique à tous, le choix du marchand est ignoré (mais conservé).
    mode: source.mode === 'imposed' ? 'imposed' : 'default',
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : null,
    updatedBy: typeof source.updatedBy === 'string' ? source.updatedBy : null,
  };
}

// Thème effectivement appliqué à un établissement.
function resolveTheme(appearance, merchantChoice) {
  const settings = normalizeAppearance(appearance);
  const choice = isThemeId(merchantChoice) ? merchantChoice : '';
  const theme = settings.mode === 'imposed' ? settings.defaultTheme : (choice || settings.defaultTheme);
  return {
    theme,
    definition: THEMES[theme],
    source: settings.mode === 'imposed' ? 'imposed' : (choice ? 'merchant' : 'default'),
    merchantChoice: choice || null,
    defaultTheme: settings.defaultTheme,
    mode: settings.mode,
  };
}

// Aperçus envoyés au navigateur (le marchand voit le thème avant de l'appliquer).
function themeCatalog() {
  return THEME_IDS.map((id) => ({ id, label: THEMES[id].label, hint: THEMES[id].hint, colors: { ...THEMES[id].colors } }));
}

// Vérification de lisibilité : le serveur refuse de servir un thème dont un texte
// essentiel passerait sous le seuil de confort (4,5:1 pour le texte courant).
function checkContrast(id) {
  const colors = THEMES[id]?.colors;
  if (!colors) return { ok: false, ratio: 0, pairs: [] };
  const pairs = [
    ['Texte sur fond de page', colors.ink, colors.bg, 4.5],
    ['Texte sur cartes', colors.ink, colors.surface, 4.5],
    ['Texte secondaire sur cartes', colors.muted, colors.surface, 4.5],
    ['Bouton principal', colors.accentText, colors.accent, 4.5],
    ['Texte sur fond d’accent doux', colors.ink, colors.soft, 4.5],
  ].map(([label, foreground, background, minimum]) => {
    const ratio = contrast(foreground, background);
    return { label, foreground, background, ratio, minimum, ok: ratio >= minimum };
  });
  return { ok: pairs.every((pair) => pair.ok), ratio: Math.min(...pairs.map((pair) => pair.ratio)), pairs };
}

module.exports = {
  THEME_IDS, DEFAULT_THEME, THEMES,
  themeIds, isThemeId, normalizeAppearance, resolveTheme, themeCatalog, checkContrast, contrast, luminance,
};
