'use strict';

// ============================================================================================
// Correctif Mission 9 — « le code vient sans initiales et ça ne passe pas ».
//
// Deux réinitialisations coexistaient : un mot de passe temporaire à 6 chiffres (console
// marchands, ancien écran PDG) et un code provisoire INITIALES-XXXXXX (fenêtre « Mot de passe
// oublié ? »). Un code remis par un écran était illisible par l'autre.
//
// Ces tests verrouillent le comportement attendu : un seul format, une saisie tolérante, et un
// code réellement utilisable quel que soit l'écran qui l'a émis.
// ============================================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { normalizeResetCodeInput, initialsOf, hashResetCode } = require('../access-control');

test('M9-C1. un code se lit quelle que soit la saisie', () => {
  const expected = 'CG-A2Z4TD';
  for (const variant of ['CG-A2Z4TD', 'cg-a2z4td', 'CG A2Z4TD', ' CGA2Z4TD ', 'cg a2z4td', 'Cg-A2Z4Td']) {
    assert.equal(normalizeResetCodeInput(variant), expected, `saisie refusée : « ${variant} »`);
  }
});

test('M9-C2. six caractères seuls désignent aussi un code valide', () => {
  // Les codes émis par la console marchands et par l'ancien écran PDG sont des 6 caractères.
  assert.equal(normalizeResetCodeInput('A2Z4TD'), 'OY-A2Z4TD');
  assert.equal(normalizeResetCodeInput('a2z4td'), 'OY-A2Z4TD');
  assert.equal(hashResetCode(normalizeResetCodeInput('A2Z4TD')), hashResetCode('OY-A2Z4TD'),
    'les deux saisies doivent produire le même hachage, sinon le code est introuvable en base');
});

test('M9-C3. une saisie vide ou trop courte est refusée avec un message clair', () => {
  assert.throws(() => normalizeResetCodeInput(''), (error) => error.code === 'INVALID_RESET_CODE_FORMAT');
  assert.throws(() => normalizeResetCodeInput('AB1'), (error) => error.code === 'INVALID_RESET_CODE_FORMAT');
  assert.throws(() => normalizeResetCodeInput('CGTROP-LONGPOURETREUNCODE'), (error) => error.code === 'INVALID_RESET_CODE_FORMAT');
});

test('M9-C4. les initiales restent calculées automatiquement', () => {
  assert.equal(initialsOf('Chez Gbaziké'), 'CG');
  assert.equal(initialsOf('Maquis du Plateau'), 'MDP');
  assert.equal(initialsOf(''), 'OY');
});

test('M9-C5. les trois émetteurs produisent le même format', async () => {
  const [routes, merchant, adminUi, managerUi, controlUi] = await Promise.all([
    fs.readFile(path.join(root, 'access-routes.js'), 'utf8'),
    fs.readFile(path.join(root, 'merchant-routes.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/admin-control.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/manager-merchants-mine.js'), 'utf8'),
    fs.readFile(path.join(root, 'public/merchant-control.js'), 'utf8'),
  ]);
  // La console marchands émet AUSSI le code provisoire officiel.
  assert.ok(merchant.includes('accessModule.createResetCode('), 'la console marchands doit émettre le code officiel');
  assert.ok(merchant.includes('accessCode: accessCode?.code'), 'le code doit être renvoyé à l’écran');
  // Le PDG et le gestionnaire joignent un mot de passe à 6 chiffres au code.
  assert.ok(routes.includes("temporaryPassword: pin.pin"), 'le PDG renvoie un mot de passe utilisable');
  assert.ok(routes.includes('generatePin6'), 'un mot de passe est généré si le PDG n’en impose pas');
  // Les écrans affichent les deux valeurs, jamais une seule.
  // (le PDG et le gestionnaire nomment le code « data.code » ; la console marchands « accessCode »)
  assert.ok(/data\.code/.test(adminUi) && /temporaryPassword/.test(adminUi), 'PDG : les deux valeurs doivent être affichées');
  assert.ok(/data\.code/.test(managerUi) && /data\.temporaryPassword/.test(managerUi), 'gestionnaire : les deux valeurs doivent être affichées');
  assert.ok(/result\.accessCode/.test(controlUi) && /result\.temporaryPassword/.test(controlUi), 'console marchands : les deux valeurs doivent être affichées');
  // La réponse du PDG porte bien les deux champs.
  assert.ok(routes.includes("code: issued.code"), 'la réponse contient le code provisoire');
  assert.ok(routes.includes('temporaryPassword: pin.pin'), 'la réponse contient le mot de passe à 6 chiffres');
});

test('M9-C6. le mot de passe temporaire n’est jamais confondu avec un code provisoire', async () => {
  const control = await fs.readFile(path.join(root, 'access-control.js'), 'utf8');
  assert.ok(control.includes('PIN_IS_LOGIN_PASSWORD'), 'un message dédié doit expliquer où saisir le mot de passe');
  assert.ok(/\^\\d\{6\}\$/.test(control), 'un code à 6 chiffres doit être reconnu comme un mot de passe, pas comme un code');
  const routes = await fs.readFile(path.join(root, 'access-routes.js'), 'utf8');
  assert.ok(routes.includes('temporaryPassword: pin.pin'), 'le mot de passe accompagne le code, il ne le remplace pas');
});

test('M9-C7. les comptes du personnel peuvent recevoir un code provisoire', async () => {
  const sql = await fs.readFile(path.join(root, 'schema-access-mission9.sql'), 'utf8');
  assert.ok(sql.includes("CHECK (account_type IN ('merchant','manager','staff'))"), 'la contrainte doit accepter les comptes du personnel');
  assert.ok(/DROP CONSTRAINT IF EXISTS access_reset_codes_account_type_check/.test(sql), 'la contrainte est remplacée, jamais la table');
  const routes = await fs.readFile(path.join(root, 'access-routes.js'), 'utf8');
  assert.ok(routes.includes("consumed.accountType === 'staff'"), 'le code d’un membre d’équipe doit être utilisable');
});
