# OYMIKE TECH QR — Mission 15, passe de refonte §1 → §18

**Date** : 10 octobre 2026 · **Base d'essai** : PostgreSQL 17 (`oymike_m15`) · **Serveur de recette** : port 3720

Ce rapport ne déclare opérationnel que ce qui a été exécuté. Chaque point ci-dessous renvoie au
test qui le prouve. Les points non terminés sont en §7.

---

## 1. Problèmes détectés et corrigés (avec la cause technique)

| # | Défaut constaté | Cause réelle | Correction |
|---|---|---|---|
| 1 | « Valider et confirmer le paiement » répondait **400 `settlement is not defined`** | La dépendance `settlement` n'était pas déclarée dans la signature de `merchant-ops-routes.js` | Dépendance ajoutée ; 12 contrôles verts |
| 2 | Une table libérée restait affichée **« Occupée »** | Le calcul d'occupation retombait sur les commandes non réglées, même après libération | Les tables ayant un historique d'occupation sont pilotées par cet historique ; les commandes restent dans l'historique |
| 3 | **Deux compteurs rouges** sur « Commandes » dans le menu | Deux modules posaient chacun leur pastille | Une seule pastille, alimentée par le compteur serveur, conservée à chaque changement de page |
| 4 | Bouton « Valider et confirmer le paiement » **illisible** (texte clair sur fond clair) | Une règle de thème écrasait la couleur du bouton principal | Règle renforcée, contraste vérifié |
| 5 | Prix en **vert**, non italiques | Le réglage de typographie du PDG posait un style en ligne qui écrasait la feuille de style | Le bloc « prix » applique couleur réglée + italique ; défaut rouge `#b3261e` |
| 6 | « Livrai‑son », « À emporter / retrait » **coupés** sur mobile | Les boutons radio héritaient de la largeur 100 % des champs | Largeur fixe du radio, pastilles sur une seule ligne |
| 7 | Le **code d'autorisation d'inscription** était encore exigé | Parcours historique Mission 8/9 | Supprimé du HTML, du JS, du serveur et de la page gestionnaire ; il n'est plus ni vérifié ni consommé |
| 8 | Les gestionnaires autorisés **n'étaient pas notifiés** des nouvelles inscriptions | Seul le PDG recevait une notification | Une notification par gestionnaire disposant de la permission |
| 9 | Aucun réglage de l'**habillage du QR de table** | Fonction inexistante | Nouveau module `table-qr-artwork.js` + panneau « QR de table et numéro affiché » |
| 10 | **404 dans la console** de l'écran PDG | L'écran lisait `/api/admin/table-qr-artwork`, seule l'adresse publique existait | Les deux adresses sont servies (lecture PDG authentifiée) |
| 11 | Comptes de recette **codés en dur** et périmés dans `recette-roles.js` | Valeurs figées d'une passe précédente | Lecture de `tools-m15/recette-comptes.json` |

## 2. Ce qui a été ajouté

- **Occupation des tables** (§2.2–§2.4) : ligne d'occupation persistante (client, heure, commandes,
  montant), libération explicite tracée (auteur + motif), refus `409 TABLE_NOT_SETTLED` si une
  commande n'est pas réglée, libération forcée possible **avec confirmation** et journalisation.
  Fiche de table complète, bouton « Marquer comme disponible », historique par table.
- **Validation + paiement en une action** (§4.3) : dialogue exigeant le moyen de paiement
  réellement utilisé et le montant réellement reçu. Un paiement électronique non confirmé par le
  prestataire est **refusé** (`409 PAYMENT_NOT_CONFIRMED`) ; un écart de montant exige un motif ;
  une deuxième validation est refusée (`409 ALREADY_SETTLED`).
- **Apparence du QR de table** (§3.6) : taille d'affiche, taille du QR, taille/épaisseur/couleur du
  numéro, fond, alignement, position, libellé, **aperçu réel** et contrôle de contraste ≥ 4,5:1.
- **Compteur « N nouvelles »** (§4.6) dans le menu, alimenté par `/api/merchant/orders/new-count`.
- **Couleur des prix réglable par le PDG** (§9), italique imposé, 10ᵉ couleur ajoutée à la palette.
- **Boutons « Actualiser »** réels (marchand, PDG, gestionnaire, fournisseur, contrôle marchand)
  avec retour visuel et message d'échec explicite ; **« Télécharger l'application »** présent sur
  tous les espaces.

## 3. Ce qui a été supprimé (uniquement ce que le client a demandé)

- La fenêtre **« Code d'autorisation d'inscription »** (`#codeGate`) et son script `signup-gate.js`.
- La vérification et la consommation d'un code à l'inscription côté serveur.
- La rubrique gestionnaire **« Codes d'inscription »** (remplacée par « Inscriptions à valider »,
  qui ouvre la validation réelle et reste soumise à la permission du PDG).
- Un **doublon** de bouton d'installation dans l'écran PDG.

**Aucune donnée métier n'a été supprimée** : comptes, QR, produits, prix, images, commandes,
historiques et paramètres sont conservés.

## 4. Tests réussis

| Recette | Résultat |
|---|---|
| `npm test` (suite du projet) | **191 tests · 189 réussis · 0 échec · 2 ignorés** |
| `tools-m15/recette-roles.js` (5 espaces, clics réels) | **70/70** |
| `tools-m15/audit-contraste.js` (PDG, marchand, gestionnaire, serveuse, fournisseur) | **29/29** |
| `/tmp/test-occupation.js` (tables §2.2–§2.4) | **21/21** |
| `/tmp/test-settle.js` (validation + paiement) | **12/12** |
| `/tmp/test-settle2.js` (refus, doubles validations) | **5/5** |
| `/tmp/test-artwork.js` (QR de table §3.6) | **7/7** |
| `/tmp/test-perm.js` (permission gestionnaire, désactivée par défaut) | **4/4** |
| `/tmp/signup-submit.js` (inscription autonome, code hérité ignoré) | **2/2** |
| Navigateur : deux catégories de commandes, validation réelle, fiche de table, libération, compteur | **vérifié** (captures dans `captures/`) |

## 5. Tests échoués et causes

Aucun test en échec à la livraison. Deux échecs ont été rencontrés **pendant** la mise au point et
corrigés à la source :

1. `recette-roles.js` → 34/37, puis 69/70 : comptes figés et périmés (corrigé : lecture du fichier
   de comptes), puis 404 `/api/admin/table-qr-artwork` (corrigé : route de lecture ajoutée).
2. `npm test` → 6 échecs après l'ajout de la couleur des prix et du numéro de table verrouillé :
   deux tests décrivaient l'ancien comportement (9 couleurs, 5 paires de contraste) et quatre
   attendaient un champ `#tableNumber` modifiable. Tests mis à jour **et** champ conservé pour la
   saisie manuelle (une commande sur place sans QR reste possible).

## 6. Sauvegardes

| Fichier | Contenu |
|---|---|
| `sauvegardes/sauvegarde-avant-refonte-2026-11-27-2102.tar.gz` | code d'origine (7,4 Mo) |
| `sauvegardes/base-m15-2026-11-27-FINALE.sql` | base complète **livrable**, 96 tables, 428 Ko : commandes en attente, aucune occupation de test |

## 7. Ce qui reste à terminer

- **§6 catégories de commandes + compteur par catégorie** : le compteur global est livré ; le
  classement par catégorie n'est pas commencé.
- **§14.1–§14.7** : la matrice de recette exhaustive (une ligne par critère du prompt) reste à
  formaliser au-delà des 8 recettes automatisées ci-dessus.
- Revue sur téléphone physique (menus latéraux) : les tests sont faits en émulation 390×844.
- **Aucun envoi sur GitHub n'a été effectué** : le dépôt du client n'est pas accessible depuis cet
  environnement (l'outil GitHub n'est pas connecté ici). Le colis est prêt à être poussé tel quel,
  toutes les commandes sont dans `LIRE-MOI.md`, section « Mettre en ligne ».

## 8. Défauts connus, non corrigés dans cette passe

1. `PUT /api/admin/managers/:id` exige un identifiant même pour modifier un seul nom : le message
   d'erreur ne désigne pas le champ réellement fautif.
2. `PATCH /api/admin/managers/:id` annoncé dans le code répond **404** (les permissions passent par
   `PATCH /api/admin/control/managers/:managerId`, qui fonctionne et est testée).
3. Limiteur de connexion fournisseur : 8 tentatives / 10 minutes / IP — comportement voulu, à
   connaître avant une campagne de recette.
4. L'adresse affichée sous le QR fournisseur reprend l'hôte de la requête ; en production elle
   dépend de la configuration de liens publics existante. **Aucune variable d'environnement n'a été
   modifiée.**

## 9. Dernière vérification (avant expédition des corrections)

- **Installation sur base neuve** : base vide créée de zéro → au premier démarrage, `table_occupations`,
  `payment_confirmed_at/by`, `payment_confirmed_by_role` et `occupation_status` existent sans aucune
  commande `psql` manuelle (le schéma d'occupation est désormais appliqué par `store.js`, comme les
  autres migrations). Accueil → **200**.
- **Patch de correction rejoué sur le colis M15 complet** : `patch -p1` sort à 0, supprime bien
  `public/signup-gate.js`, et les **45 fichiers** obtenus sont identiques à l'octet au code expédié.
- `npm test` sur cette copie patchée : **189 réussis · 0 échec · 2 ignorés**. Recette par rôle : **70/70**.
