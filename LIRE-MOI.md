# OYMIKE TECH — MISSION 12 : COLIS DU CHANGEMENT (delta)

**Date :** 10 octobre 2026
**Périmètre :** trois corrections demandées, et rien d'autre.
**Contenu :** uniquement les fichiers modifiés ou ajoutés pour cette mission. L'application complète n'est pas renvoyée.

---

## 1. Ce qui a été corrigé, et pourquoi (cause réelle)

### 1.1 Le scanner ne s'ouvrait pas / ne lisait pas

| Cause réelle constatée | Correction |
| --- | --- |
| **Deux flux vidéo concurrents** : un `<video>` dans une fenêtre modale et un autre dans l'écran Scanner. Selon l'ordre d'ouverture, l'aperçu restait noir et la lecture ne démarrait jamais. | `qr-camera.js` a été réécrit : **un seul flux**, monté dans la page (`inline`) ou dans la fenêtre, jamais les deux. |
| **Un clic sur « Scanner » n'ouvrait pas la caméra** : il fallait encore appuyer sur « Ouvrir la caméra ». Sur iPhone, un appel `getUserMedia` qui n'est pas dans le geste de l'utilisateur est refusé. | Le clic sur **Scanner** (barre permanente, tuile d'accueil) ouvre la caméra immédiatement, dans le même geste. Même comportement côté serveuse / gérant. |
| **Ancienne version servie par le cache** : le service worker servait d'abord le cache (`oymike-merchant-shell-v5`), donc un correctif pouvait ne jamais s'exécuter sur un téléphone déjà utilisé. | `sw.js` : cache `v6`, et **réseau d'abord** pour tous les `.js` / `.css` (le cache ne sert qu'en secours hors-ligne). |
| **L'aperçu s'affichait sous le contenu de l'accueil** (tuiles + vue d'ensemble restaient au-dessus) : la caméra tournait mais hors de l'écran. | Les blocs de l'accueil ne sont affichés que sur l'accueil ; l'aperçu est cadré automatiquement. |
| **Message resté sur « Ouverture de la caméra… »** alors que la caméra filmait (l'état était écrit dans la fenêtre masquée). | L'état s'affiche désormais dans le bloc réellement visible. |
| **Compatibilité** | Caméra **arrière** demandée en souplesse (`ideal`, 4 tentatives de repli), messages explicites en cas de refus / absence / caméra occupée / absence de HTTPS, **torche** quand l'appareil la propose, **saisie manuelle** toujours disponible. jsQR est maintenant chargé à l'avance. |
| **Aucun enregistrement** | Aucune photo, aucune vidéo, aucun enregistrement d'écran : seul le code est lu, puis la caméra est coupée **avant** d'ouvrir la page suivante. |

### 1.2 La gestion des tables avait disparu

- La gestion **existait déjà en base** (`merchant_service_points`, avec les QR `public_code`). Elle n'a **pas** été recréée : `table-management-routes.js` la relit, la complète et l'expose.
- Elle **n'était plus accessible** : aucune rubrique ne l'affichait (l'ancienne entrée passait par un sous-onglet d'« Opérations »). Elle redevient une rubrique visible : **« Tables et espaces »**, à un seul niveau, qui ouvre directement l'écran (pas de page intermédiaire).
- Le numéro de table est désormais une **vraie donnée** (`table_number`), avec reprise des anciennes tables (`Table 4` → `4`), **unicité par établissement** (insensible à la casse et aux espaces), mêmes numéros autorisés entre établissements.
- « Supprimer » = **désactiver** : aucune donnée, aucun QR, aucun historique n'est supprimé ; la réactivation rend le même QR valable.

### 1.3 « Mes comptes créés »

- La création de comptes existait (rubrique Mon équipe) mais **aucune vue ne permettait de voir et gérer les comptes déjà créés** en une seule page. Nouveau bloc **« Mes comptes créés »** en haut de Mon équipe : nom, téléphone, rôle, tables/salons, statut, quotas du PDG.
- Un compte s'ouvre **sur place** : identité, téléphone, tables et salons, permissions, suspension / réactivation, **réinitialisation du mot de passe à 6 chiffres** (choisi ou généré, affiché **une seule fois**, sessions coupées), **historique d'activité**.
- Aucun mécanisme dupliqué : les routes appellent les mêmes services que la rubrique Équipe (`team.js`). **Isolation stricte** : un compte d'un autre établissement répond 404 ; une table d'un autre établissement est refusée (403).

---

## 2. Installation (sans perte de données)

1. **Sauvegarder** la base et le dossier `public/` de production (réflexe, rien ne le remplace).
2. Copier les fichiers du colis en respectant l'arborescence :
   - `serveur/*.js` et `serveur/schema-mission12-tables.sql` → racine du projet (à côté de `server.js`) ;
   - `public/*` → dossier `public/` ;
   - `public/merchant/sw.js` → `public/merchant/sw.js` ;
   - `tests/*` → dossier `test/`.
3. **`server.js` et `store.js` ne sont pas dans ce colis** : ils ont reçu deux branchements en mission 12. Deux lignes suffisent (à appliquer si votre copie ne les a pas encore) :
   - dans `store.js`, boucle de schéma : `['schema-mission11-equipes.sql', 'schema-mission12-tables.sql']` ;
   - dans `server.js`, juste après `merchantOps` : montage de `table-management-routes` puis `member-accounts-routes` (voir `INSTALLATION.md`, section « Branchements »).
   
   > Si vous préférez recevoir ces deux fichiers complets plutôt que les deux lignes, dites-le : ils seront ajoutés au colis.
4. Redémarrer le serveur. Le schéma s'applique tout seul au démarrage (colonnes ajoutées, index créé, numéros repris). **Aucune table n'est supprimée, aucun QR n'est régénéré.**
5. Sur les téléphones déjà utilisés : **recharger une fois** l'espace marchand (le nouveau service worker prend le relais et le cache périmé est supprimé).

---

## 3. Ce qui a été réellement vérifié

### 3.1 Banc d'API (serveur local, base PostgreSQL de test)
- Gestion des tables : **18/18 étapes** — création, doublon refusé (409), salon et doublon de salon, résumé libres/occupées, modification numéro + salon, QR existant résolu par lien complet **et** par code seul, QR inconnu (404), table désactivée (409) puis réactivée, renommage de salon propagé aux tables, même numéro autorisé dans un autre établissement, QR d'une autre boutique refusé (403).
- Comptes créés : **22/22 étapes** — liste et compteurs, création gérant et serveuse, fiche (permissions, tables, historique), modification (nom, téléphone, 2 tables, permissions), isolation (404 autre établissement, 403 table d'une autre boutique), suspension (connexion refusée 403) puis réactivation (connexion acceptée), mot de passe généré (ancien refusé, nouveau accepté), code trop simple refusé, code choisi appliqué, historique alimenté.
- Quotas du PDG : plafond atteint ⇒ **409 `TEAM_LIMIT`** ; l'écran affiche 10/10 et 2/50 (mêmes valeurs que la rubrique Équipe).

### 3.2 Navigateur (Chromium, caméra simulée filmant le QR d'une table, écran téléphone 412×915 et ordinateur 1280×900)
- Marchand : clic sur **Scanner** ⇒ aperçu caméra **dans la page**, QR lu **sans second clic** ⇒ panneau « Prendre une commande » ouvert avec **Table 1** déjà sélectionnée ; caméra coupée après lecture.
- Permission refusée : message clair (« L'accès à la caméra a été refusé… »), saisie manuelle disponible, aucun blocage.
- Serveuse : clic sur **Scanner** ⇒ caméra ouverte, QR lu ⇒ commande ouverte avec **Table 1** sélectionnée.
- Tables : 4 tables listées avec leur QR dessiné, salons (Salle, Terrasse), filtres libres/occupées, **ajout d'une table** réussi, **doublon refusé** à l'écran avec le message métier, **modification du numéro** appliquée, désactivation/réactivation.
- Comptes : 12 comptes listés (nom, téléphone, rôle, tables, statut), fiche ouverte (4 tables proposées, 28 permissions, 2 blocs de sécurité, historique), **enregistrement** réussi (la fiche reste ouverte), **réinitialisation** avec code affiché une seule fois et bouton « Copier ».
- Aucune erreur JavaScript bloquante ; les seuls messages `401` visibles sont ceux de la page de connexion **avant** l'authentification, et le `409` est celui, attendu, du doublon de numéro refusé.
- Note de lecture : dans la capture `01`, l'aperçu caméra est le flux de test de Chromium (mire verte) — c'est bien la caméra qui tourne dans la page, pas une image fixe.

### 3.3 Tests automatiques
- Suite complète du projet : **160 réussis, 0 échec, 2 ignorés** (151 avant la mission + 9 nouveaux garde-fous ; les 2 ignorés le sont déjà hors mission 12).
- Nouveaux garde-fous mission 12 : **9/9** (`test/mission12-tables-comptes.test.js`).

---

## 4. Limites honnêtes (à lire)

- **Aucun essai sur un appareil physique** : les vérifications navigateur utilisent une **caméra simulée** (Chromium). iPhone/Safari et Android/Chrome n'ont pas été testés sur téléphone réel dans cet environnement.
- **Aucun QR scanné depuis une impression papier** : la lecture a été validée sur un QR affiché à l'écran, filmé par la caméra simulée.
- La lecture dépend de l'appareil : `BarcodeDetector` quand le navigateur le fournit, sinon la bibliothèque `jsQR` embarquée (aucun téléchargement externe).
- Le **téléchargement du QR en PNG** utilise la bibliothèque d'impression déjà présente ; à défaut, le QR affiché est enregistré tel quel.

---

## 5. Vérification finale à faire à l'écran (trois points séparés)

1. **Scanner** — ouvrir l'espace marchand sur le téléphone, toucher **Scanner** : la caméra s'ouvre tout de suite (caméra arrière), viser le QR d'une table ⇒ la prise de commande s'ouvre avec la bonne table. Refaire avec un compte serveuse.
2. **Gestion des tables** — **Tables et espaces** : ajouter une table avec un numéro déjà utilisé ⇒ refus clair ; modifier un numéro ⇒ le QR de la table est **le même** ; désactiver puis réactiver ⇒ le QR redevient valable ; créer un salon et le renommer.
3. **Comptes créés** — **Équipe → Mes comptes créés** : ouvrir un compte, changer le téléphone et les tables, suspendre puis réactiver, réinitialiser le mot de passe (noter le code affiché une seule fois), vérifier que la serveuse se connecte avec ce code.

---

## 6. Contenu du colis

```
OYMIKE-MISSION12/
  LIRE-MOI.md                     ce document
  INSTALLATION.md                 installation + branchements + retour arrière
  serveur/table-management-routes.js        (nouveau) gestion des tables et espaces
  serveur/member-accounts-routes.js         (nouveau) mes comptes créés
  serveur/schema-mission12-tables.sql       (nouveau) numéro de table + index d'unicité
  public/qr-camera.js                       (réécrit) scanner unique, sans étape
  public/table-manager.js                   (nouveau) écran « Tables et espaces »
  public/member-accounts.js                 (nouveau) écran « Mes comptes créés »
  public/merchant.html, merchant.js         (modifiés) panneaux, menu, chargement
  public/staff.html, staff.js               (modifiés) scanner de l'équipe
  public/workspace-ui.js, workspace.css     (modifiés) navigation, styles, cadrage
  public/merchant/sw.js                     (modifié) cache v6, réseau d'abord
  tests/mission12-tables-comptes.test.js    (nouveau) 9 garde-fous
  captures/                                 11 captures (téléphone et ordinateur)
  SHA256.txt                                empreinte du colis
```

Aucun compte, aucune table, aucun QR code, aucune permission et aucun historique n'a été supprimé.
