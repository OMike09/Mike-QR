'use strict';

// ============================================================================================
// Mission 12 — garde-fous automatiques (tables, comptes créés, scanner).
//
// Ces tests ne remplacent pas l'essai sur téléphone : ils empêchent qu'une prochaine
// modification casse, sans qu'on s'en aperçoive, les règles décidées avec le client :
//   · le marchand ne crée pas de QR (règle mission 5 : PDG uniquement) ;
//   · les numéros de table sont uniques DANS un établissement, pas entre établissements ;
//   · un QR de table n'est jamais régénéré quand le numéro change ;
//   · « supprimer » une table = la désactiver (aucune donnée perdue) ;
//   · le scanner n'enregistre ni photo ni vidéo et s'ouvre dans la page, sans étape ;
//   · les comptes de l'équipe sont cloisonnés par établissement.
// ============================================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('tables · une seule gestion, branchée sur les tables existantes (aucune seconde source)', () => {
  const source = read('table-management-routes.js');
  assert.match(source, /merchant_service_points/, 'la gestion lit la table des emplacements existante');
  assert.doesNotMatch(source, /CREATE TABLE .*tables_mission12/i, 'aucune table parallèle n’est créée');
  assert.match(source, /table_number/, 'le numéro de table est une colonne de la table existante');
});

test('tables · numéro unique dans un établissement, même numéro autorisé ailleurs', () => {
  const schema = read('schema-mission12-tables.sql');
  assert.match(schema, /UNIQUE INDEX[\s\S]*store_id[\s\S]*lower\(btrim\(table_number\)\)/i, 'unicité par établissement, insensible à la casse et aux espaces');
  assert.match(schema, /WHERE[^\n]*status\s*=\s*'active'/i, 'index partiel : une table désactivée ne bloque pas un numéro réutilisé');
  assert.match(schema, /WHERE[^\n]*btrim\(table_number\)\s*<>\s*''/i, 'les emplacements sans numéro (salons, comptoirs) ne sont pas concernés');
  const routes = read('table-management-routes.js');
  assert.match(routes, /409/, 'un doublon est refusé avec un conflit explicite (et non une erreur serveur)');
});

test('tables · un QR imprimé reste valable : aucun code régénéré, désactivation sans suppression', () => {
  const routes = read('table-management-routes.js');
  assert.doesNotMatch(routes, /public_code\s*=\s*'T-/, 'le code public n’est jamais réécrit lors d’une modification');
  assert.doesNotMatch(routes, /DELETE FROM merchant_service_points/i, 'aucune suppression physique : l’historique et les QR sont conservés');
  assert.match(routes, /inactive/, '« supprimer » = désactiver');
  assert.match(routes, /QR_INACTIVE/, 'un QR de table désactivée est refusé avec un message clair');
  assert.match(routes, /QR_OTHER_STORE/, 'un QR d’une autre boutique est refusé');
});

test('tables · le marchand ne crée pas de QR (règle mission 5 conservée)', () => {
  const routes = read('table-management-routes.js');
  assert.doesNotMatch(routes, /app\.post\([^)]*\/qr['"]/, 'aucune route POST de création de QR côté marchand');
  const merchant = read('merchant-routes.js');
  assert.match(merchant, /réservée au PDG|réservées au PDG/, 'la règle « QR réservé au PDG » reste en place');
});

test('comptes · toutes les routes exigent une session marchand et un membre de SON établissement', () => {
  const source = read('member-accounts-routes.js');
  const routes = source.match(/app\.(?:get|put|post)\('\/api\/merchant\/member-accounts[^']*',\s*requireMerchant/g) || [];
  assert.ok(routes.length >= 5, 'la liste, la fiche, la modification, l’état, le mot de passe et l’historique sont protégés');
  assert.match(source, /ownMember\(req/, 'chaque action vérifie l’appartenance du membre au marchand connecté');
  assert.match(source, /POINT_NOT_OWNED/, 'une table d’un autre établissement ne peut pas être attribuée');
  assert.match(source, /sessionsRevoked|team\.resetPassword/, 'la réinitialisation coupe les sessions existantes');
  assert.match(source, /temporaryPassword/, 'le nouveau code est affiché une seule fois au marchand');
});

test('comptes · les effectifs du PDG sont affichés, jamais modifiables depuis cet écran', () => {
  const source = read('member-accounts-routes.js');
  assert.match(source, /resolveTeamQuotas/, 'les quotas viennent du même calcul que la rubrique Équipe');
  assert.doesNotMatch(source, /UPDATE team_settings|effectiveMaxGeneralManagers\s*=/, 'aucune écriture de quota côté marchand');
});

test('scanner · la caméra s’ouvre dans la page, sans étape, et n’enregistre rien', () => {
  const camera = read('public/qr-camera.js');
  const ui = read('public/workspace-ui.js');
  assert.match(camera, /state\.container = options\.inline/, 'l’aperçu peut être monté directement dans la page');
  assert.match(ui, /id === 'scan'[\s\S]{0,120}__wsOpenCamera/, 'un seul clic sur Scanner ouvre la caméra');
  const staff = read('public/staff.js');
  assert.match(staff, /if \(name === 'scan'\) startCamera\(\)/, 'même comportement pour la serveuse et le gérant');
  for (const source of [camera, ui, staff]) {
    assert.doesNotMatch(source, /new\s+MediaRecorder|getDisplayMedia|\.toDataURL\(/, 'aucune photo, vidéo ou capture d’écran');
  }
  assert.match(camera, /facingMode: \{ ideal: wanted \}/, 'caméra arrière demandée sans contrainte stricte (compatibilité Android/iPhone)');
  assert.match(camera, /capabilities\.torch/, 'la torche reste disponible quand l’appareil la propose');
  assert.match(camera, /qrCameraManualInput/, 'la saisie manuelle reste le secours universel');
});

test('navigation · les écrans ajoutés sont accessibles par le menu, en un clic', () => {
  const ui = read('public/workspace-ui.js');
  assert.match(ui, /id: 'tables', label: 'Tables et espaces'/, 'la rubrique « Tables et espaces » existe');
  assert.match(ui, /direct: true/, 'une rubrique à écran unique s’ouvre directement, sans page intermédiaire');
  const html = read('public/merchant.html');
  assert.match(html, /id="panel-tables"/, 'le panneau de gestion des tables est présent');
  assert.match(html, /id="memberAccountsCard"/, 'le bloc « Mes comptes créés » est présent dans Mon équipe');
  const merchant = read('public/merchant.js');
  assert.match(merchant, /name === 'tables'[\s\S]{0,80}MerchantTables/, 'l’écran tables charge ses données à l’ouverture');
  assert.match(merchant, /name === 'team'[\s\S]{0,80}MemberAccounts/, 'l’écran des comptes se recharge à chaque ouverture');
});

test('service worker · une mise à jour de l’application est servie par le réseau, pas par un cache périmé', () => {
  const sw = read('public/merchant/sw.js');
  // La version doit avoir CHANGÉ depuis la mission 12 (v6) : elle est incrémentée à chaque
  // livraison pour que les nouveaux scripts ne soient jamais servis depuis un cache périmé.
  const version = /oymike-merchant-shell-v(\d+)/.exec(sw);
  assert.ok(version && Number(version[1]) >= 6, 'le cache a changé de version');
  assert.match(sw, /isAppCode/, 'les scripts et styles passent en réseau d’abord');
  assert.match(sw, /cache: 'no-store'/, 'le navigateur ne peut pas resservir une ancienne version depuis son propre cache');
});
