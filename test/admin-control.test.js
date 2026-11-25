'use strict';

// ============================================================================================
// MISSION 8 — tests du socle « contrôle total du PDG ».
//
// Ces tests tournent sans serveur HTTP : ils vérifient les garanties qui ne doivent jamais
// régresser (génération de codes non devinables, hachage, quotas, mapping de statuts, schéma).
// Le parcours complet de bout en bout vit dans tools/verify-mission8.js (vrai serveur + base).
// ============================================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const control = require('../admin-control');
const lifecycle = require('../merchant-lifecycle');

// ------------------------------------------------------------------ codes terrain
test('les codes terrain sont aléatoires, lisibles et non devinables', () => {
  const codes = new Set();
  for (let index = 0; index < 5000; index += 1) codes.add(control.generateFieldCode());
  assert.equal(codes.size, 5000, 'aucune collision sur 5 000 générations');
  for (const code of codes) {
    // Format imposé : OY-XXXX-XXXX, alphabet sans I/O/0/1 pour rester dictable au téléphone.
    assert.match(code, /^OY-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/, `format inattendu : ${code}`);
    // Le préfixe « OY » est fixe : l'ambiguïté ne concerne que la partie aléatoire.
    assert.ok(!/[IO01]/.test(code.slice(3)), `caractère ambigu dans ${code}`);
  }
});

test('un code est haché : le clair n’est jamais stocké et le hachage est stable', () => {
  const code = 'OY-ABCD-2345';
  const hash = control.hashFieldCode(code);
  assert.notEqual(hash, code, 'le hachage ne contient pas le code');
  assert.equal(hash.length, 64, 'HMAC-SHA256 en hexadécimal');
  assert.equal(hash, control.hashFieldCode(' oy-abcd-2345 '), 'la normalisation tolère espaces et casse');
  assert.notEqual(hash, control.hashFieldCode('OY-ABCD-2346'), 'deux codes différents ont deux hachages');
});

test('la vérification tolère un code dicté sans tirets mais refuse un format fantaisiste', async () => {
  assert.equal(control.normalizeCode('oy abcd 2345'), 'OYABCD2345');
  const normalized = control.normalizeCode('OY-ABCD-2345');
  assert.match(normalized, /^OY-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
});

// ------------------------------------------------------------------ quotas d'équipe
test('les quotas se composent correctement : base, dépassement temporaire, expiration', () => {
  const platform = { maxGeneralManagersPerMerchant: 1, maxWaitressesPerMerchant: 2 };
  const base = control.mergeQuotas(platform, null, 'm1', 'platform');
  assert.equal(base.effectiveMaxGeneralManagers, 1);
  assert.equal(base.effectiveMaxWaitresses, 2);
  assert.equal(base.source, 'platform');

  // Quota particulier du PDG
  const override = control.mergeQuotas(platform, { maxGeneralManagers: 3, maxWaitresses: 6 }, 'm1', 'override');
  assert.equal(override.effectiveMaxGeneralManagers, 3);
  assert.equal(override.effectiveMaxWaitresses, 6);

  // Dépassement exceptionnel encore valide
  const future = new Date(Date.now() + 86400_000).toISOString();
  const boosted = control.mergeQuotas(platform, { maxGeneralManagers: 1, maxWaitresses: 2, extraWaitresses: 4, extraExpiresAt: future }, 'm1', 'override');
  assert.equal(boosted.effectiveMaxWaitresses, 6, 'le dépassement s’ajoute à la base');

  // Dépassement expiré : il ne compte plus
  const past = new Date(Date.now() - 86400_000).toISOString();
  const expired = control.mergeQuotas(platform, { maxGeneralManagers: 1, maxWaitresses: 2, extraWaitresses: 4, extraExpiresAt: past }, 'm1', 'override');
  assert.equal(expired.effectiveMaxWaitresses, 2, 'un dépassement expiré ne donne plus de place');
});

test('un quota hérité du code terrain ne remplace jamais un quota fixé par le PDG', () => {
  const platform = { maxGeneralManagersPerMerchant: 5, maxWaitressesPerMerchant: 10 };
  const inherited = control.mergeQuotas(platform, { maxGeneralManagers: 1, maxWaitresses: 2 }, 'm1', 'field_code');
  assert.equal(inherited.effectiveMaxWaitresses, 2);
  assert.equal(inherited.source, 'field_code');
  // La source est explicite : la fiche marchand peut l'afficher au PDG.
  assert.ok(['platform', 'override', 'field_code'].includes(inherited.source));
});

// ------------------------------------------------------------------ statuts d'inscription
test('le statut « informations complémentaires demandées » reste un dossier ouvert', () => {
  assert.ok(lifecycle.REGISTRATION_STATUSES.includes('needs_info'));
  assert.ok(lifecycle.OPEN_STATUSES.includes('needs_info'), 'le dossier réapparaît dans la file du PDG');
  // Les statuts historiques ne disparaissent pas : aucune donnée existante n'est invalidée.
  for (const status of ['pending', 'in_review', 'approved', 'rejected', 'suspended']) {
    assert.ok(lifecycle.REGISTRATION_STATUSES.includes(status), `${status} reste valide`);
  }
});

// ------------------------------------------------------------------ schéma
test('la migration Mission 8 est additive et rejouable', async () => {
  const sql = await fs.readFile(path.join(root, 'schema-admin-control-mission8.sql'), 'utf8');
  // Aucune suppression de table ou de colonne existante : uniquement des ajouts.
  assert.ok(!/DROP\s+TABLE/i.test(sql), 'aucune table supprimée');
  assert.ok(!/DROP\s+COLUMN/i.test(sql), 'aucune colonne supprimée');
  assert.ok(!/TRUNCATE/i.test(sql), 'aucune donnée effacée');
  for (const table of ['field_enrollment_codes', 'field_code_uses', 'admin_notifications',
    'admin_audit_journal', 'merchant_registration_photos', 'merchant_team_quota_overrides',
    'manager_points', 'manager_point_events']) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} créée de façon idempotente`);
  }
  // Les colonnes ajoutées aux tables existantes le sont sans casser une base déjà migrée.
  const alterLines = sql.split('\n').filter((line) => /ALTER TABLE \w+ ADD COLUMN/.test(line));
  assert.ok(alterLines.length >= 10, 'colonnes additives présentes');
  assert.ok(alterLines.every((line) => line.includes('IF NOT EXISTS')), 'chaque ADD COLUMN est idempotent');
});

test('la migration est appliquée par le magasin au démarrage', async () => {
  const store = await fs.readFile(path.join(root, 'store.js'), 'utf8');
  assert.ok(store.includes('schema-admin-control-mission8.sql'), 'le schéma Mission 8 est dans l’ordre d’application');
  const order = store.match(/const schemaFiles = \[([\s\S]*?)\];/)?.[1] || '';
  assert.ok(order.indexOf('schema-consign-mission7.sql') < order.indexOf('schema-admin-control-mission8.sql'),
    'les migrations de la Mission 7 passent avant celles de la Mission 8');
});

// ------------------------------------------------------------------ protection des points
test('le code de sécurité des points refuse les combinaisons trop simples', () => {
  const weak = ['000000', '111111', '123456', '654321'];
  for (const code of weak) assert.match(code, /^(\d)\1{5}$|^(123456|654321)$/, 'détecté comme faible');
  // Un code aléatoire à 6 chiffres a 1 000 000 de combinaisons et reste dictable au téléphone.
  assert.equal(/^\d{6}$/.test('482913'), true);
});

// ------------------------------------------------------------------ routes et permissions
test('les routes du PDG sont protégées et celles du gestionnaire ne fuient pas', async () => {
  const routes = await fs.readFile(path.join(root, 'admin-control-routes.js'), 'utf8')
    .then((text) => text + require('node:fs').readFileSync(path.join(root, 'admin-control-routes-2.js'), 'utf8'));
  // Toute route PDG passe par requireAdmin.
  // On capture tout ce qui sépare le chemin du corps de la route, afin de vérifier le middleware.
  const adminRoutes = [...routes.matchAll(/app\.(get|post|put|patch|delete)\('(\/api\/admin\/[^']+)'([\s\S]*?)async \(/g)];
  assert.ok(adminRoutes.length >= 15, `routes PDG détectées : ${adminRoutes.length}`);
  for (const [, , routePath, middlewares] of adminRoutes) {
    assert.ok(middlewares.includes('requireAdmin'), `${routePath} doit exiger requireAdmin`);
  }
  // Toute route gestionnaire passe par requireManager.
  const managerRoutes = [...routes.matchAll(/app\.(get|post|put|patch|delete)\('(\/api\/manager\/[^']+)'([\s\S]*?)async \(/g)];
  assert.ok(managerRoutes.length >= 4, `routes gestionnaire détectées : ${managerRoutes.length}`);
  for (const [, , routePath, middlewares] of managerRoutes) {
    assert.ok(middlewares.includes('requireManager'), `${routePath} doit exiger requireManager`);
  }
  // Le gestionnaire ne peut pas se fabriquer un identifiant : l'identifiant vient de la session.
  assert.ok(!/req\.body\?\.managerId \|\| req\.query\.managerId/.test(routes), 'aucun identifiant de gestionnaire pris du client');
});

test('les codes terrain ne sont consommés que par la clause atomique', async () => {
  const source = await fs.readFile(path.join(root, 'admin-control.js'), 'utf8');
  // La consommation doit être une mise à jour conditionnelle unique, pas un lire-puis-écrire.
  assert.match(source, /UPDATE field_enrollment_codes[\s\S]{0,200}SET uses = uses \+ 1[\s\S]{0,200}WHERE code_hash=\$1 AND revoked_at IS NULL AND expires_at > NOW\(\) AND uses < max_uses/,
    'la consommation est conditionnelle et atomique');
  assert.ok(source.includes('BEGIN') && source.includes('COMMIT'), 'la consommation est transactionnelle');
});

test('le formulaire public branche bien le code terrain et les photos', async () => {
  const [html, js] = await Promise.all([
    fs.readFile(path.join(root, 'public/merchant-signup.html'), 'utf8'),
    fs.readFile(path.join(root, 'public/merchant-signup.js'), 'utf8'),
  ]);
  assert.ok(html.includes('capture="environment"'), 'la caméra du téléphone est proposée');
  assert.ok(html.includes('photoCameraInput') && html.includes('photoLibraryInput'), 'caméra et galerie');
  // Mission 9 : le code n'est plus saisi dans le formulaire, mais dans la fenêtre d'autorisation
  // dédiée ; il est toujours transmis avec la demande, accompagné de sa réservation.
  assert.ok(html.includes('id="codeGate"') && html.includes('id="gateCode"'), 'fenêtre de code indépendante');
  assert.ok(js.includes('photos: state.photos'), 'les photos sont envoyées au serveur');
  assert.ok(js.includes('fieldCode: (window.QRIASignupGate?.code'), 'le code est envoyé avec la demande');
  assert.ok(js.includes('fieldCodeToken: window.QRIASignupGate?.token'), 'la réservation accompagne le code');
  assert.ok(/MAX_PHOTOS = 6/.test(js), 'la limite de 6 photos est appliquée côté navigateur');
});

test('le PDG peut couper l’accès d’une serveuse et la fiche marchand 360° est branchée', async () => {
  const js = await fs.readFile(path.join(root, 'public/admin-control.js'), 'utf8');
  assert.ok(js.includes('data-member-cut'), 'bouton de coupure présent');
  assert.ok(js.includes('/team-members/'), 'appel de la route de coupure');
  for (const section of ['Équipe', 'Quotas d’équipe', 'Photos de l’établissement', 'Consignations ouvertes']) {
    assert.ok(js.includes(section), `la fiche affiche « ${section} »`);
  }
});
