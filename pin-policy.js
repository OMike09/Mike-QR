'use strict';

// ============================================================================================
// MISSION 7 — Domaine « code marchand à 6 chiffres ».
//
// Règles appliquées ici, et nulle part ailleurs :
//   * exactement 6 chiffres, ni 5 ni 7, aucun espace, aucune lettre, aucun signe ;
//   * la valeur reste une CHAÎNE : « 000123 » n'est jamais converti en nombre ;
//   * le code n'est jamais renvoyé par une API, jamais journalisé en clair ;
//   * une connexion est comptée par COMPTE (pas seulement par IP) car 6 chiffres = 10^6 valeurs :
//     sans verrou progressif, une force brute serait triviale.
// ============================================================================================

const crypto = require('node:crypto');

const PIN_PATTERN = /^[0-9]{6}$/;
const MAX_FAILED_ATTEMPTS = 5;
// Durées appliquées À PARTIR du 5e échec consécutif, puis à chaque échec suivant.
// (Une durée nulle au 5e échec laisserait la porte ouverte : c'était un défaut, corrigé ici.)
const LOCK_STEPS_MS = [60_000, 5 * 60_000, 30 * 60_000, 60 * 60_000, 6 * 60 * 60_000];

function isPin6(value) {
  return typeof value === 'string' && PIN_PATTERN.test(value);
}

// Message unique, réutilisé par toutes les routes : le client ne doit jamais deviner la règle.
const PIN_RULE_MESSAGE = 'Le code doit comporter exactement 6 chiffres (0 à 9), sans espace, lettre ni caractère spécial. Les zéros au début sont conservés.';

function assertPin6(value, label = 'code') {
  const raw = typeof value === 'string' ? value : '';
  if (!isPin6(raw)) {
    const error = new Error(raw && /^\d+$/.test(raw)
      ? `Le ${label} doit comporter exactement 6 chiffres (${raw.length} reçu${raw.length > 1 ? 's' : ''}).`
      : PIN_RULE_MESSAGE);
    error.code = 'INVALID_PIN6';
    error.status = 400;
    throw error;
  }
  return raw;
}

// Un code à 6 chiffres est faible par nature : on refuse d'abord les suites les plus devinées,
// puis on laisse le verrou progressif faire le reste. On ne prétend pas que c'est fort — on
// l'empêche d'être deviné en une minute.
const TOO_COMMON = new Set([
  '000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '121212', '112233', '123123', '111000', '102030', '010203', '202020', '131313',
]);
function isWeakPin(pin) {
  if (!isPin6(pin)) return true;
  if (TOO_COMMON.has(pin)) return true;
  const digits = pin.split('').map(Number);
  const ascending = digits.every((d, i) => i === 0 || d === digits[i - 1] + 1);
  const descending = digits.every((d, i) => i === 0 || d === digits[i - 1] - 1);
  return ascending || descending;
}

// Hachage identique au reste du projet (scrypt + sel par compte), donc les anciens mots de passe
// continuent de fonctionner : aucune migration destructive.
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const digest = crypto.scryptSync(String(password), salt, 64);
  return `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
}
const DUMMY_SALT = Buffer.from('oymike-merchant-login-dummy-salt');
function checkPassword(password, stored) {
  const [algorithm, saltText, digestText] = String(stored || '').split('$');
  if (algorithm !== 'scrypt' || !saltText || !digestText) { crypto.scryptSync(String(password), DUMMY_SALT, 64); return false; }
  try {
    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(digestText, 'base64url');
    const actual = crypto.scryptSync(String(password), salt, expected.length || 64);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (_) { return false; }
}

// Durée de verrou après N échecs consécutifs. 0 = pas encore verrouillé.
function lockDurationFor(failedCount) {
  if (failedCount < MAX_FAILED_ATTEMPTS) return 0;
  const step = Math.min(failedCount - MAX_FAILED_ATTEMPTS, LOCK_STEPS_MS.length - 1);
  return LOCK_STEPS_MS[step];
}
// Durée réellement opposable : celle du compteur d'échecs s'il est déjà verrouillé, sinon 0.
function activeLockMs(failedCount, now = Date.now(), lockedUntil = null) {
  if (lockedUntil && new Date(lockedUntil).getTime() > now) return 1;
  return lockDurationFor(failedCount);
}

function lockedMessage(until, now = Date.now()) {
  const seconds = Math.max(1, Math.ceil((new Date(until).getTime() - now) / 1000));
  const minutes = Math.ceil(seconds / 60);
  return `Trop de tentatives. Ce compte est temporairement verrouillé : réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
}

function timingSafePinEquals(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

// Code temporaire sûr : 6 chiffres tirés uniformément (rejet du biais modulo).
function generatePin6() {
  for (;;) {
    const pin = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    if (!isWeakPin(pin)) return pin;
  }
}

module.exports = {
  PIN_PATTERN, PIN_RULE_MESSAGE, MAX_FAILED_ATTEMPTS,
  isPin6, isWeakPin, assertPin6, hashPassword, checkPassword,
  // Alias lisibles utilisés par la Mission 8 (code de sécurité des points).
  hashPin: hashPassword, verifyPin: checkPassword,
  lockDurationFor, activeLockMs, lockedMessage, timingSafePinEquals, generatePin6,
};
