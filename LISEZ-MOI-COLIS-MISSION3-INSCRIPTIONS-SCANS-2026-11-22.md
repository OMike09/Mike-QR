# Mission 3 — Inscriptions autonomes, commande par scan, scans séparés

Date : 22 novembre 2026 · Périmètre : colis delta (fichiers modifiés/créés uniquement)

## 1. Ce qui est livré

| Module | Livrable | État |
|---|---|---|
| M1 Inscription autonome | Page publique `/devenir-marchand` (+ `/devenir-marchand/suivi`), API publiques, dossier de demande, décisions PDG et gestionnaire agréé | Codé et testé (API + interface, mobile et bureau) |
| M2 Commande par le marchand avec scan | Scanner caméra dans l’écran « Prendre une commande », résolution serveur du QR, provenance complète sur la commande | Codé et testé (caméra simulée Chromium + parcours réel) |
| M3 Scans séparés | `merchant_scan_events` (catégorie client / marchand / historique), statistiques marchand et PDG, anti-doublon | Codé et testé |
| M4 Contrôle PDG | Rubrique « Inscriptions marchands » (demandes, décisions, historique, scans, commandes marchands, bascules de fonctionnalités) | Codé et testé |
| M5 Tests | 10 scénarios automatisés + parcours navigateur des 3 rôles + suite complète 92 tests | Exécuté |

## 2. Fichiers du colis

Nouveaux :

- `merchant-lifecycle.js` — logique des demandes (PG ou JSON), décisions idempotentes, création du compte après approbation, journal des scans.
- `merchant-lifecycle-routes.js` — routes publiques, PDG, gestionnaire et marchand.
- `public/merchant-signup.html`, `public/merchant-signup.js` — formulaire public responsive.
- `public/merchant-scanner.js` — scanner caméra (caméra arrière, détection automatique, arrêt propre, repli manuel).
- `public/merchant-registrations.js`, `public/merchant-registrations.css` — rubrique PDG.
- `public/manager-merchants.js` — rubrique gestionnaire (inscriptions + commandes de ses marchands).
- `public/vendor/jsQR.js` + `public/vendor/jsQR.LICENSE-APACHE-2.0.txt` — décodeur QR vendorisé (Apache 2.0), aucun CDN.
- `test/merchant-lifecycle.test.js` — 10 tests mission 3.

Modifiés :

- `schema.sql` (migration additive en fin de fichier), `server.js` (montage du module), `store.js` (permission gestionnaire + réglages fonctionnalités), `merchant-commerce.js`, `merchant-extras.js`, `merchant-routes.js`, `manager-routes.js`, `public/merchant.html`, `public/merchant.js`, `public/merchant-assisted-orders.css`, `public/index.html`, `public/admin.js`, `public/manager.html`, `public/manager.js`.

## 2 bis. Committer dans le dépôt

Le colis contient deux aides :

- `APPLIQUER-ET-COMMITTER-MISSION3.sh` — à lancer **depuis la racine de votre dépôt** :
  `bash APPLIQUER-ET-COMMITTER-MISSION3.sh colis-mission3-inscriptions-scans-2026-11-22.zip`
  Il fait une sauvegarde `tar.gz` de l'existant, copie les fichiers en conservant les chemins,
  vérifie `node --check` sur les 15 fichiers JavaScript, contrôle la présence de la migration
  et du montage dans `server.js`, puis crée **un seul commit** avec le message de `COMMIT-MISSION3.txt`.
  Il n'envoie rien : relancez avec `--push` (confirmation demandée) pour pousser.
- `COMMIT-MISSION3.txt` — le message de commit complet, si vous préférez committer à la main.

Testé localement sur un dépôt git de contrôle : 24 fichiers commités, contrôles passés, aucun envoi.

## 3. Application

1. Déposer les fichiers en respectant les chemins (`public/…` pour le frontal, racine pour les modules serveur et `schema.sql`).
2. Exécuter la fin de `schema.sql` (migration additive : uniquement des `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`, index et contraintes conditionnelles). Aucune colonne existante n’est supprimée ou réécrite ; les compteurs historiques (`merchant_stores.qr_scan_count`, `merchant_service_points.qr_scan_count`, `qr_scans`) sont conservés.
3. Redémarrer le service. Aucune variable d’environnement nouvelle.
4. Vérifier en production, dans cet ordre :
   - `GET /devenir-marchand` → 200 (formulaire) ;
   - `GET /api/public/merchant-registration/status` → 200 ;
   - espace PDG → rubrique « Inscriptions marchands » : les compteurs s’affichent ;
   - espace marchand → onglet « Scans & activation » : l’état d’activation s’affiche ;
   - un QR de table existant (`/t/…`) continue de s’ouvrir normalement.

## 4. Règles respectées

- **Aucune URL publique modifiée** : `/t/`, `/s/`, `/r/` sont inchangées ; les scans clients continuent d’être comptés par le mécanisme existant, en plus du nouvel événement catégorisé.
- **Activation des QR contrôlée par le PDG** : après approbation, le compte est actif, la boutique est **non publiée** et le QR **non activé** (`qrActivation: pending_pdg`). Le marchand ne peut pas activer son QR (route PDG protégée ; test 6 et parcours navigateur).
- **Une demande n’est jamais validée deux fois** : verrou + version d’examen + index unique sur le journal des décisions (`409 CONCURRENT_DECISION` / `ALREADY_DECIDED`).
- **Aucune suppression automatique** : un doublon de téléphone/e-mail/identifiant renvoie `409 ACCOUNT_EXISTS` ou `DUPLICATE_OPEN_REGISTRATION` avec la marche à suivre (connexion/récupération/suivi de dossier) ; l’existant n’est jamais touché.
- **Permission gestionnaire désactivée par défaut** : `canValidateMerchantRegistrations` vaut `false` ; sans elle, la route renvoie `403 REGISTRATION_VALIDATION_FORBIDDEN` et l’entrée de navigation n’existe pas à l’écran.
- **Scans marchands jamais comptés comme visites publiques** : catégorie `merchant`, total général = clients + marchands, historique antérieur affiché à part (`legacy`) sans remise à zéro.
- **Pas de double déduction ni de double création** : la commande passe par le circuit existant (`merchant_orders`), avec idempotence `clientRequestId` + hash d’intention ; le stock n’est déduit qu’une fois (test 8).
- **Contrôles côté serveur** : un marchand ne peut scanner que ses QR (`403 QR_OTHER_STORE`), ne lit que ses données ; un gestionnaire ne voit que les commandes de ses marchands.

## 5. Preuves exécutées (22 novembre 2026)

- `npm test` : **92 tests, 91 réussis, 0 échec, 1 ignoré** (dont les 10 nouveaux tests mission 3).
- Parcours navigateur (Chromium) :
  - inscription réelle depuis `/devenir-marchand` sur écran mobile (430 × 932) → `INSC-20261122-4E3347`, message exact affiché ;
  - approbation PDG depuis la rubrique → compte actif, boutique non publiée ;
  - publication + activation du QR par le PDG (procédure existante) ;
  - connexion marchand, onglet « Prendre une commande », clic « Scanner un QR code » : **caméra simulée lisant le QR réel de la table** → « Table reconnue : Table 4 · Terrasse. », table sélectionnée automatiquement ;
  - panier, commande validée → reçu « Table 4 · QR scanné par le marchand », commande unique, stock déduit une fois ;
  - statistiques : `Scans clients 0 · Scans marchands 1 · Total 1` ;
  - onglet PDG, gestionnaire autorisé et gestionnaire non autorisé vérifiés à l’écran ;
  - **aucune erreur JavaScript** dans les parcours ci-dessus.
- Captures : `preuve-inscription-mobile.png`, `preuve-commande-marchand-mobile.png`, `preuve-stats-marchand-mobile.png`, `preuve-pdg-inscriptions.png`, `preuve-gestionnaire-inscriptions.png`, `preuve-scanner-camera.png`.

## 6. Ce qui n’a pas pu être testé ici — à vérifier après déploiement

1. **PostgreSQL** : aucun serveur PostgreSQL n’est disponible dans cet environnement. La migration a été relue, découpée et vérifiée structuralement (parenthèses, `IF NOT EXISTS`, doublons supprimés), et les requêtes des modules ont été contrôlées (`$n` séquentiels, pas d’interpolation non résolue) ; **elle n’a pas été exécutée contre une base réelle**. À faire en premier sur l’environnement de production, avec sauvegarde préalable.
2. **Caméra sur téléphone physique** : la détection a été validée avec une caméra simulée dans Chromium, alimentée par un QR réel généré par l’application. Le comportement réel (autorisation, luminosité, mise au point) reste à confirmer sur un téléphone, en HTTPS.
3. **Déploiement** : les nouvelles routes renvoient encore `404` en production (`/devenir-marchand`, `/api/public/merchant-registration/status`, `/api/admin/merchant-registrations`, `/api/merchant/scan-stats`, `/api/admin/scan-stats/merchant-qr` vérifiées le 22/11/2026). Les pages existantes (`/admin/`, `/manager/`, `/merchant/`) répondent `200`.
4. **Statistiques historiques** : les anciens compteurs sont affichés comme « historique antérieur / origine inconnue » ; ils ne sont ni reclassés ni remis à zéro, conformément à la consigne.
