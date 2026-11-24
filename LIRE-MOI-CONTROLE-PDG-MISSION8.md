# MISSION 8 — Contrôle total des inscriptions, codes terrain et comptes par le PDG

Tout est livré, branché sur la base et testé. **Aucune donnée existante n'a été supprimée** : les
comptes, les QR, les boutiques, les commandes, les consignations et les réglages restent en place.

---

## 1. Ce qui existait déjà (et que je n'ai pas refait)

| Demande du cahier des charges | État avant la Mission 8 |
|---|---|
| Formulaire d'inscription marchand, statut « en attente » | existait (`/devenir-marchand`, table `merchant_registrations`) |
| Validation PDG : approuver / refuser + motif / examen / suspendre | existait, avec trace de l'auteur et de la date |
| Un marchand non validé ne peut pas entrer | existait (contrôle serveur `requireMerchant`) |
| Gestionnaires : création, permissions, suspension | existait (6 permissions dont `canValidateMerchantRegistrations`) |
| Quotas d'équipe contrôlés côté serveur | existait, mais sans dépassement ni quota par code |
| Points des serveuses historisés | existait (`staff_point_events`) |
| Journal d'audit général | existait (`audit_logs`) |

## 2. Ce que la Mission 8 ajoute

### A. Inscriptions marchands
- **Photos de l'établissement** : jusqu'à 6 photos, prises **à l'appareil photo** (`capture="environment"`)
  ou choisies dans la galerie, compressées dans le navigateur, prévisualisées et supprimables.
- **Nouveau statut « Informations complémentaires demandées »** (`needs_info`) : le dossier reste ouvert,
  le demandeur est relancé avec un message, le PDG le retrouve dans sa file.
- **Notification au PDG** pour chaque nouvelle demande, avec l'origine (directe ou terrain).
- **Fiche dossier** : informations complètes, photos en grand format (servies en binaire, pas en base64),
  gestionnaire et code utilisés, historique des décisions.

### B. Codes d'inscription terrain à usage unique
- Génération par le **PDG** et par les **gestionnaires autorisés** (permission `canCreateFieldCodes`,
  accordée par le PDG, fausse par défaut).
- Format **OY-XXXX-XXXX**, alphabet sans I/O/0/1 (dictable au téléphone), ~40 bits d'entropie,
  haché en **HMAC-SHA256** : le code en clair n'est **jamais** stocké, affiché **une seule fois**.
- Durée de validité, note interne, quotas d'équipe portés par le code.
- **Consommation atomique** : une seule requête conditionnelle décide (`UPDATE … WHERE … uses < max_uses`),
  en transaction. Deux personnes qui envoient en même temps : une seule passe.
- Révocation immédiate ; un code révoqué, expiré ou consommé est refusé avec un message explicite.
- **Vérification sans consommation** (`/api/public/field-codes/check`) pour ouvrir le formulaire,
  limitée à 12 tentatives par 10 minutes.
- **Historique par gestionnaire** : chaque consommation est journalisée avec l'inscription obtenue.

### C. Contrôle des comptes
- **Fiche marchand 360°** : identité, boutique, QR, produits, commandes récentes, consignations,
  équipe, scans, quotas et source du quota, photos du dossier, activité.
- **Fiche gestionnaire** : coordonnées, permissions modifiables, codes générés, inscriptions terrain,
  points et historique, journal de ses opérations, marchands attribués.
- **Suspension / réactivation** d'un compte marchand : le compteur de version de session est incrémenté,
  donc **les sessions ouvertes sont révoquées** immédiatement.
- **Coupure d'accès d'une serveuse ou d'un gérant par le PDG** à tout moment, sans supprimer le compte
  (historique conservé, points conservés).

### D. Quotas d'équipe — selon votre décision
- **Les comptes existants gardent leurs codes et leurs membres.** Rien n'est supprimé ni rétrogradé.
- **Les nouveaux comptes sont limités** : par la limite générale du PDG, par un quota particulier du
  marchand, ou par le quota porté par le **code terrain** qui a servi à créer le compte.
- Vous pouvez **modifier les quotas à tout moment** ; le marchand ne peut pas les changer (sauf si vous
  l'autorisez explicitement, case à cocher dans sa fiche).
- **Dépassement exceptionnel** avec date d'expiration : les places supplémentaires disparaissent seules.
- Case « un compte suspendu réserve encore une place », réglable par le PDG.
- Message de blocage exactement celui demandé : « Vous avez atteint le nombre maximum de comptes
  autorisés pour votre établissement. Veuillez contacter l'Administrateur général. »
- **Vérification côté serveur ET en base** : un appel direct à l'API est refusé comme l'interface.

### E. Points des gestionnaires
- Solde et journal **immuables** : chaque mouvement enregistre avant, après, variation, motif, auteur, date.
- **Code de sécurité à 6 chiffres** défini ou réinitialisé par le PDG (scrypt, jamais en clair).
- Consultation protégée si vous activez la règle ; **5 tentatives** puis blocage 15 minutes.
- Le PDG garde l'accès général et peut corriger avec trace nominative.
- Un gestionnaire ne peut **jamais** modifier ses points ni ceux d'un autre.

### F. Notifications et audit
- **Centre de notifications du PDG** : nouvelle inscription, inscription terrain, code utilisé,
  dépassement de quota, suspension / réactivation, opération sur les points, code perdu.
- Chaque alerte est cliquable et ouvre le dossier concerné ; marquage lu / non lu ; compteur dans le menu.
- **Journal d'audit dédié** en **insertion seule** : un déclencheur PostgreSQL refuse tout `UPDATE` ou
  `DELETE`. Export CSV pour un contrôle externe.

---

## 3. Où trouver les choses

| Élément | Chemin |
|---|---|
| Menu PDG | **Contrôle des comptes** et **Notifications** |
| Menu gestionnaire | **Codes terrain** et **Validation terrain** |
| Formulaire public | `/devenir-marchand` (photos + code) |
| Schéma | `schema-admin-control-mission8.sql` (additif, rejouable) |
| Socle serveur | `admin-control.js` |
| Routes PDG | `admin-control-routes.js`, `admin-control-routes-2.js` |
| Interface PDG | `public/admin-control.js`, `public/admin-control.css` |
| Interface gestionnaire | `public/manager-field.js` |
| Parcours de vérification | `node tools/verify-mission8.js` (43 vérifications) |
| Tests unitaires | `test/admin-control.test.js` (13 tests) |

## 4. Vérifications réelles effectuées

- **Parcours complet 43/43** contre un vrai serveur et une vraie base PostgreSQL :
  inscription avec 3 photos → code consommé → 2e envoi refusé → dossier complet → demande de
  complément → approbation → connexion marchand → quota hérité appliqué → 2e gérant refusé →
  3e serveuse refusée → PDG relève le quota → création acceptée → coupure d'accès → fiche 360° →
  notifications → journal → points protégés → tableau de bord → cloisonnement des rôles.
- **Suite complète : 155 tests, 154 réussis, 0 échec, 1 ignoré** (les 142 tests existants passent
  tous, plus 13 nouveaux).
- **Interfaces vérifiées dans un vrai navigateur** : tableau de bord PDG (11 indicateurs réels),
  génération de code côté gestionnaire (code affiché une fois), formulaire public avec 2 photos
  ajoutées via l'entrée fichier. **Aucune erreur JavaScript.**

## 5. Ce qu'il reste à décider

1. **Le code de sécurité des points** : vous n'avez pas tranché le format. J'ai retenu **6 chiffres
   définis par le PDG** (cohérent avec les codes marchands). Dites-moi si vous préférez 8 caractères.
2. **Qui peut générer des codes terrain** : la permission est **fermée par défaut**. Il faut l'accorder
   gestionnaire par gestionnaire depuis « Contrôle des comptes → Comptes gestionnaires → Fiche ».
3. **Anciens dossiers d'icônes** (`/icons/client`, `/icons/merchant`, `/icons/manager`) : toujours
   présents mais plus référencés. Je peux les retirer dans un colis séparé.
