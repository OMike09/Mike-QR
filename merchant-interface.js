// Mission 10 — Réglages de présentation pilotés par l'Administrateur général (le PDG).
//
// Ce que ce module règle : les TAILLES DE TEXTE des espaces de travail (marchand, gérant,
// serveuse, serveur). Ce qu'il ne règle jamais : les permissions, les rôles, les accès.
// Un test le vérifie explicitement.
//
// Portée :
//   - une valeur globale, appliquée à tous les marchands ;
//   - une exception par établissement (boutique), qui prime sur la valeur globale ;
//   - une valeur par défaut sûre (16 px de texte, 24 px de titre) si rien n'est enregistré.
'use strict';

// Clés exposées comme variables CSS dans public/workspace.css (et lues par workspace-ui.js).
const TEXT_KEYS = Object.freeze([
  ['title', 'Titres', 24],
  ['subtitle', 'Sous-titres', 17],
  ['text', 'Textes', 16],
  ['label', 'Menus et libellés', 14],
  ['button', 'Boutons', 15],
  ['productName', 'Noms de produits', 16],
  ['price', 'Prix et montants', 18],
  ['orderInfo', 'Informations de commande', 14],
]);

const CSS_VARS = Object.freeze({
  title: '--ws-title', subtitle: '--ws-subtitle', text: '--ws-text', label: '--ws-label',
  button: '--ws-button', productName: '--ws-product-name', price: '--ws-price', orderInfo: '--ws-order-info',
});

const MIN_SIZE = 14;
const MAX_SIZE = 30;
const STORAGE_KEY = 'merchantInterface';

function defaultSizes() {
  return Object.fromEntries(TEXT_KEYS.map(([key, , size]) => [key, size]));
}

function clampSize(value, fallback) {
  const size = Number(value);
  if (!Number.isFinite(size)) return fallback;
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
}

// Nettoie une valeur reçue du client : aucune clé inconnue, aucune taille hors plage.
function normalizeSizes(input, base = defaultSizes()) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const result = { ...base };
  for (const [key] of TEXT_KEYS) {
    if (Object.hasOwn(source, key)) result[key] = clampSize(source[key], base[key]);
  }
  return result;
}

function normalizeSettings(input) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const global = normalizeSizes(source.global || source.sizes || {});
  const stores = {};
  const rawStores = source.stores && typeof source.stores === 'object' && !Array.isArray(source.stores) ? source.stores : {};
  for (const [storeId, value] of Object.entries(rawStores)) {
    if (!/^[A-Za-z0-9_-]{6,64}$/.test(storeId)) continue;
    // Une exception n'écrit que les tailles modifiées : elle hérite du global pour le reste.
    stores[storeId] = normalizeSizes(value, global);
  }
  return { global, stores, updatedAt: source.updatedAt || null, updatedBy: source.updatedBy || null };
}

// Tailles effectives pour un établissement donné.
function resolveSettings(settings, storeId = '') {
  const normalized = normalizeSettings(settings || {});
  const sizes = storeId && normalized.stores[storeId] ? normalized.stores[storeId] : normalized.global;
  return { sizes: { ...sizes }, source: storeId && normalized.stores[storeId] ? 'store' : 'global', global: normalized.global, store: storeId && normalized.stores[storeId] ? normalized.stores[storeId] : null };
}

// Feuille de style à injecter dans la page : uniquement des variables CSS de taille.
function toCssVars(sizes, overrides = {}) {
  const safe = normalizeSizes(sizes);
  const tokens = { ...safe, ...normalizeSizes({ ...safe, ...overrides }, safe) };
  return Object.entries(CSS_VARS).map(([key, variable]) => `${variable}:${tokens[key]}px`).join(';');
}

module.exports = {
  TEXT_KEYS, CSS_VARS, MIN_SIZE, MAX_SIZE, STORAGE_KEY,
  defaultSizes, normalizeSizes, normalizeSettings, resolveSettings, toCssVars,
};
