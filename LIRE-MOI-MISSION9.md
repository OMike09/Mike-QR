# Oymike QR — Mission 9

**Ce qui a changé, et comment l'utiliser**

Date de livraison : 10 octobre 2026
Base de référence : `OYMIKE-OUVRIR-ADMIN-2026-11-24.zip`

---

## 1. En une minute

La Mission 9 ajoute quatre choses, sans rien retirer de l'existant :

1. **Le marchand valide les comptes de son personnel.** Un gérant général ou une serveuse crée une
   demande de compte ; elle n'ouvre aucun accès tant que le marchand ne l'a pas validée. La
   validation vérifie automatiquement les places disponibles (quotas fixés par le PDG).
2. **« Mot de passe oublié »** sur la page de connexion marchand **et** gestionnaire, avec les
   coordonnées réellement enregistrées, et un **code provisoire** du type `CG-A2Z4TD`
   (initiales de l'établissement + 6 caractères), à usage unique, délivré par le PDG, le
   gestionnaire créateur ou le marchand.
3. **L'inscription par code unique dans une fenêtre indépendante.** Le tableau de bord n'est
   jamais un formulaire d'inscription : le code d'abord, le formulaire ensuite. Le code est
   consommé à l'envoi réussi du dossier, jamais à l'ouverture.
4. **Le gestionnaire accompagne les marchands qu'il a inscrits** (« Mes marchands », « Codes
   d'inscription ») — sans en devenir propriétaire.

Le reste du travail a consisté à **réparer** ce qui ne marchait pas (voir §6) et à **vérifier**
par des parcours réels, en base PostgreSQL, sur un serveur lancé pour de vrai.

---

## 2. Ce que voit chaque utilisateur

### 2.1 Le PDG — `/admin/`

Onglet **Contrôle des comptes**, nouvelle rubrique **Réinitialisations d'accès** :

- émettre un code provisoire pour n'importe quel compte (marchand, gestionnaire, personnel) ;
- fixer la durée de validité (1 h à 7 jours) et un motif ;
- voir la liste des codes (statut disponible / utilisé / expiré / révoqué) et révoquer ;
- enregistrer les **coordonnées de contact** affichées par « Mot de passe oublié ». Aucun numéro
  n'est inventé : tant que le PDG n'a rien enregistré, l'écran le dit explicitement.

Dans la liste des **Comptes marchands**, chaque ligne indique désormais le gestionnaire qui
accompagne le marchand, son état, et un bouton **Réattribuer** :

- rattacher un marchand orphelin (gestionnaire parti, supprimé ou suspendu) à un autre gestionnaire ;
- cocher précisément les permissions ouvertes (informations, produits, commandes, QR, journal) ;
- détacher le marchand pour le laisser autonome — **le compte et ses données ne sont jamais supprimés**.

### 2.2 Le gestionnaire — `/manager`

Deux nouvelles rubriques dans le menu :

- **Mes marchands** : les marchands qu'il a inscrits avec ses codes, leur activité, la
  réinitialisation d'accès d'un compte qu'il a créé (jamais celui d'un autre gestionnaire, jamais
  le PDG, jamais un marchand qu'il n'a pas créé).
- **Codes d'inscription** : bouton **« Générer un code unique d'inscription »** → le code
  s'affiche immédiatement, copiable, avec la validité, les places gérant/serveuse, et un lien
  direct vers le formulaire. L'historique indique pour chaque code : généré le, expire le,
  statut, qui s'est inscrit, quand.

### 2.3 Le marchand — `/merchant/`

- **Gestion de mon équipe** : nouvelle rubrique **« Demandes de comptes de mon personnel »**
  (nom, téléphone, rôle) → **Valider** (un code d'activation est remis au membre) ou **Refuser**.
  Les places restantes sont affichées avant chaque décision.
- Les quotas d'équipe sont **en lecture seule** : ils viennent du PDG ou du code terrain du
  gestionnaire créateur. Le marchand ne les fixe plus lui-même.
- **Réinitialiser le mot de passe d'un membre** affiche désormais un mot de passe temporaire à
  6 chiffres **et** le code d'activation, une seule fois.
- Sous le formulaire de connexion : **« Mot de passe oublié ? »**.

### 2.4 Le futur marchand — `/devenir-marchand`

- À l'ouverture, la fenêtre **« Code d'autorisation d'inscription »** : champ, bouton
  **Vérifier le code**, message, retour à la connexion. **Aucun formulaire protégé n'est
  accessible avant la vérification.**
- Un lien `?code=OY-XXXX-XXXX` pré-remplit et vérifie le code automatiquement.
- Après vérification, la fenêtre se ferme, le formulaire complet s'affiche (photos comprises).
  Le code n'est **pas** consommé à ce stade : il l'est à l'envoi réussi du dossier.

---

## 3. Installation

### 3.1 Depuis le colis complet

Décompressez `OYMIKE-CONTROLE-PDG-MISSION9-2026-10-10.zip`, puis :

```
Windows        : double-clic sur DEMARRER-WINDOWS.bat
macOS / Linux  : ./DEMARRER-MAC-LINUX.command
```

Ouvrez ensuite `http://localhost:3000/admin/` — identifiant `admin`, mot de passe `admin1234`.

### 3.2 Depuis le colis delta (fichiers seuls)

Le delta s'applique **sur la base `OYMIKE-OUVRIR-ADMIN-2026-11-24`** :

1. copiez les fichiers du delta en respectant les chemins (ils écrasent les anciens) ;
2. redémarrez l'application.

Aucune commande SQL à lancer à la main : `schema-access-mission9.sql` est **additif et
rejouable**, et s'exécute automatiquement au démarrage, après les schémas précédents.

> Le delta ne contient **aucun** fichier supprimé. Vérifié : 0 suppression, 23 ajouts,
> 21 modifications.

---

## 4. Migrations

`schema-access-mission9.sql` crée ou complète, uniquement si nécessaire :

| Objet | Rôle |
|---|---|
| `team_join_requests` | demandes de compte du personnel (en attente / validée / refusée) |
| `access_reset_codes` | codes provisoires `INITIALES-XXXXXX` (hachés, usage unique, expiration) |
| `app_settings.supportContact` | coordonnées réelles affichées par « Mot de passe oublié » |
| `field_enrollment_codes.reserved_until` / `reserved_token` | réservation d'un code terrain pendant la saisie du dossier |

Aucun `DROP`, aucun `DELETE`, aucune colonne supprimée. Un code déjà émis par un marchand ou un
gestionnaire reste valide ; rien n'est régénéré en masse.

---

## 5. Vérifications exécutées

Toutes sur un vrai serveur, avec PostgreSQL.

| Contrôle | Résultat |
|---|---|
| `node tools/verify-mission9.js` — 14 sections, base + contrôles serveur | **71 / 71** |
| `node tools/verify-mission8.js` — non-régression Mission 8 | **43 / 43** |
| `NODE_PATH=… node tools/ui-mission9.js` — navigateur réel (Playwright) | **33 / 33** |
| `node tools/ops-journey.js` — parcours complets | **53 / 53** |
| `NODE_PATH=… node tools/ui-test-6.js` — écrans marchand / équipe / PDG | conforme, 0 erreur JS |
| `NODE_PATH=… node tools/t-ui-m7.js` — consignation | tout conforme |
| `node --test` — suite complète | **166 tests, 165 réussis, 0 échec, 1 ignoré** |

Points explicitement couverts par les tests : contacts publics sans numéro inventé ; limitation
d'un gestionnaire à ses propres comptes ; code `OY-XXXX-XXXX` à usage unique ; formulaire
verrouillé avant le code ; réservation sans consommation et blocage `409 CODE_RESERVED` ;
inscription → référence → approbation → rattachement au gestionnaire créateur ; anti-doublon de
téléphone ; code provisoire `INITIALES-XXXXXX` non journalisé en clair ; `INVALID_PIN6` sans
brûler le code ; `RESET_CODE_USED` au second usage ; nouveau mot de passe imposé à la connexion ;
isolation stricte entre marchands (aucun accès par modification d'URL ou d'identifiant).

---

## 6. Ce qui a été réparé au passage

Ces défauts existaient avant la Mission 9 et ont été corrigés, car ils empêchaient les parcours
demandés de fonctionner :

1. **Le code terrain n'était pas rattaché au dossier à l'approbation** : le marchand inscrit
   n'apparaissait pas chez le gestionnaire qui l'avait parrainé. Corrigé (`fieldManagerId`).
2. **Liste des gestionnaires (PDG)** : les colonnes de permissions n'étaient pas lues, donc le PDG
   voyait `canCreateFieldCodes = false` pour tout le monde et l'écran de génération de codes
   restait masqué. Corrigé dans `store.js`.
3. **Consommation d'un code terrain sans jeton** : PostgreSQL refusait la requête
   (« invalid byte sequence for encoding UTF8 ») parce qu'un caractère NUL était envoyé en
   paramètre. Corrigé — les codes sans réservation restent utilisables normalement.
4. **Liste « Comptes marchands » du PDG vide** : la requête citait des colonnes inexistantes
   (`qr_codes.merchant_id`, `store_qr_codes`). Corrigé, et les erreurs de cette requête sont
   désormais journalisées au lieu d'être avalées silencieusement.
5. **Formulaire d'inscription accessible sans code** : par défaut, le formulaire s'affichait et la
   fenêtre de code restait fermée. Inversé : la fenêtre d'abord, le formulaire après vérification.
6. **Limitation de débit trop stricte** sur la vérification des codes : douze vérifications dans
   dix minutes bloquaient tout un réseau, même avec des codes valides. Les vérifications réussies
   ne décomptent plus de tentative ; les codes invalides restent limités.
7. **Le code fraîchement généré disparaissait** de l'écran gestionnaire au rafraîchissement de
   l'historique — or il n'est plus jamais réaffiché. Il reste désormais affiché jusqu'au
   rechargement de la page.

---

## 7. Règles de sécurité appliquées

- Aucun mot de passe, aucun code n'est stocké en clair : seuls des hachages le sont.
- Un code provisoire est **lié à un seul compte**, à **usage unique**, avec expiration
  configurable ; il révoque l'ancien code encore disponible du même compte.
- La consommation est décidée par une **requête conditionnelle unique** (`UPDATE … WHERE used_at
  IS NULL AND revoked_at IS NULL AND expires_at > NOW()`), donc deux navigateurs simultanés ne
  peuvent pas utiliser le même code.
- Un compte réinitialisé **doit** choisir un nouveau mot de passe à la connexion ; tout le reste
  de l'espace est fermé jusque-là (`403 PASSWORD_CHANGE_REQUIRED`).
- Un gestionnaire ne peut pas réinitialiser le PDG, un autre gestionnaire, ni un marchand qu'il
  n'a pas créé (`RESET_FORBIDDEN`).
- Les mots de passe marchands restent **exactement 6 chiffres** ; le code provisoire est distinct
  (6 caractères alphanumériques après les initiales).
- Le gestionnaire n'est **jamais** propriétaire du marchand : il ne reçoit jamais son mot de passe
  et ses interventions sont tracées et visibles par le marchand.

---

## 8. Fichiers livrés

**Ajoutés (23)**

```
access-control.js                      socle serveur des codes provisoires et des demandes d'équipe
access-routes.js                       routes Mission 9 (public, PDG, gestionnaire, marchand)
admin-control.js / -routes.js / -routes-2.js   contrôle PDG, complété
schema-access-mission9.sql             migration additive et rejouable
public/signup-gate.js                  fenêtre « Code d'autorisation d'inscription »
public/merchant-team-requests.js       demandes de comptes côté marchand
public/manager-merchants-mine.js       « Mes marchands » et « Codes d'inscription »
public/forgot-password.html/.js/.css   fenêtre « Mot de passe oublié »
public/admin-control.js/.css           interface PDG (Mission 8 + Mission 9)
test/access-mission9.test.js           11 tests unitaires supplémentaires
tools/verify-mission9.js               vérification serveur, 71 contrôles
tools/ui-mission9.js                   vérification navigateur, 33 contrôles
LIRE-MOI-CONTROLE-PDG-MISSION8.md      notice de la Mission 8 (inchangée)
(+ fichiers Mission 8 déjà présents dans la base)
```

**Modifiés (21)** : `server.js`, `store.js`, `manager-routes.js`, `merchant-commerce.js`,
`merchant-lifecycle.js`, `merchant-lifecycle-routes.js`, `team.js`, `team-routes.js`,
`pin-policy.js`, `public/merchant.html`, `public/merchant-team.js`, `public/merchant-team.css`,
`public/merchant-signup.html`, `public/merchant-signup.js`, `public/merchant-registrations.js`,
`public/manager.html`, `public/manager.js`, `public/manager.css`, `public/admin.js`,
`public/index.html`, `tools/lib-equipe.js`.

---

## 9. Liens utiles

| Espace | Adresse |
|---|---|
| Administrateur général | `/admin/` |
| Gestionnaire | `/manager` |
| Marchand | `/merchant/` |
| Personnel (gérant, serveuse) | `/equipe/` |
| Console marchands | `/merchant-control` |
| Inscription par code | `/devenir-marchand` — ou `/devenir-marchand?code=OY-XXXX-XXXX` |
| Réinitialisation d'accès marchand | `/merchant/reset-password` |
| État du serveur | `/api/health` |

Le fichier `LIENS-MISSION9-A-COPIER.txt` reprend ces adresses en clair, prêtes à copier.
