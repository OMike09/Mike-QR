# Mission 5 — Équipes marchandes (gérants généraux et serveuses)

Delta additif sur la base de la Mission 4. **Aucun fichier de la Mission 4 n'est supprimé.**
Une seule décompression : le zip contient les fichiers à plat.

---

## 1. Installation (dans cet ordre)

1. **Sauvegarde** de la base et du dossier applicatif.
2. Copier les fichiers du zip **par-dessus** l'installation existante (mêmes chemins).
3. Appliquer les migrations, **dans cet ordre, avant le redémarrage** :
   ```bash
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema-team-mission5.sql
   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f schema-team-mission5-platform.sql
   ```
   Les deux scripts sont **rejouables** (aucune donnée supprimée). `schema.sql` a aussi été corrigé
   (voir §6) : il est réappliqué automatiquement au démarrage.
4. Redémarrer le service.
5. Vérifier :
   ```bash
   curl -s https://VOTRE-DOMAINE/equipe/ -o /dev/null -w '%{http_code}\n'   # 200
   curl -s -o /dev/null -w '%{http_code}\n' https://VOTRE-DOMAINE/staff.js  # 200
   ```
   Puis : se connecter en marchand → onglet **Mon équipe** → créer une serveuse → le code
   s'affiche **une seule fois**.

Le serveur applique désormais lui-même `schema.sql`, `schema-catalog-mission4.sql`,
`schema-team-mission5.sql` et `schema-team-mission5-platform.sql` au démarrage (tous additifs et
rejouables). Une base neuve (ou un schéma isolé de test) possède donc les mêmes colonnes que la
production. Les fichiers absents sont ignorés.

---

## 2. Contenu du delta

### Nouveaux fichiers
| Fichier | Rôle |
|---|---|
| `schema-team-mission5.sql` | 8 tables (`team_members`, `team_activation_codes`, `team_member_sessions`, `team_permissions`, `team_tasks`, `team_task_events`, `team_activity_events`, `merchant_team_settings`) + colonnes additives sur commandes, lignes de commande et scans. |
| `schema-team-mission5-platform.sql` | Paramètre plateforme `teamLimits` + extension des contraintes `merchant_orders.source` et `created_by_type`. |
| `team-seed.js` | Référentiel : 2 rôles, 19 permissions, génération des codes (alphabet sans I/O/0/1). |
| `team.js` | Moteur : membres, codes, sessions, tâches, activité, points, paramètres. Toutes les règles sont ici, côté serveur. |
| `team-routes.js` | Routes marchand `/api/merchant/team/*` + routes administration `/api/admin/team-*`. |
| `staff-routes.js` | Routes du personnel `/api/staff/*` (session propre, permissions, commandes, scan, tâches, produits). |
| `public/staff.html` / `staff.css` / `staff.js` | Espace équipe mobile-first, servi sur `/equipe/`. |
| `public/merchant-team.js` / `public/merchant-team.css` | Rubrique « Mon équipe » du tableau de bord marchand. |
| `public/admin-team.js` / `public/admin-team.css` | Vue « Équipes marchands » de l'Administrateur général (lecture seule + limites). |
| `test/team-postgres.test.js` | 17 tests HTTP sur base PostgreSQL réelle. |
| `LIRE-MOI-EQUIPES-MISSION5.md` | Ce document. |

### Fichiers modifiés
| Fichier | Modification |
|---|---|
| `schema.sql` | Correctifs de dérive (§6), aucune suppression. |
| `store.js` | `init()` applique tous les scripts de schéma du projet, dans l'ordre. |
| `server.js` | Instancie l'équipe, monte `team-routes` et `staff-routes`, ajoute la page `/equipe/`. |
| `merchant-commerce.js` | Sources `staff_assisted` / `manager_assisted` acceptées ; `customItems` (lignes libres) conservées sur la commande, **jamais** dans le catalogue ; `payment_status` écrit correctement. |
| `merchant-routes.js` | Cookie d'équipe ajouté au contrôle de conflit de rôles ; la garde anti-QR marchand ne bloque plus `/api/merchant/team/...`. |
| `public/merchant.html` | Onglet « Mon équipe », panneau complet, 2 fichiers liés. |
| `public/index.html` | Entrée de menu « Équipes marchands » et panneau de supervision. |
| `public/admin.js` | Vue `team-overview` déclarée (titre + chargement). |
| `test/pwa-apps.test.js` | Contrôle des images de démarrage : ratio du nom de fichier + hauteur ≤ 512 px (conséquence du redimensionnement déjà livré), plus une résolution native qui n'existe plus. |
| `test/merchant-assisted-postgres.test.js` | Envoie `currentPassword` au changement de mot de passe, comme le serveur l'exige déjà. |

---

## 3. Ce qui est réellement vérifié

Batterie complète : `node --test` → **104 tests passent, 0 échec** (1 suite ignorée faute de base de
test fournie).

Tests PostgreSQL réels (`DATABASE_URL_TEST=… node --test test/team-postgres.test.js`) — **17/17** :

1. Deux marchands/boutiques distincts.
2. Création par le marchand seul (aucun passage par l'Administrateur général), code à 16 caractères.
3. Fonction invalide refusée, aucun membre fantôme.
4. Code à usage unique : rejeu refusé (`CODE_USED`), code inexistant refusé.
5. Le gérant activé ne voit que **sa** boutique.
6. Codes : régénération ⇒ l'ancien est révoqué, un seul code ouvert, révocation effective.
7. Cloisonnement : commande et QR d'une autre boutique inaccessibles.
8. Permission refusée **côté serveur** (`403 PERMISSION_DENIED`), pas seulement masquée.
9. Article libre : commande créée, ligne libre conservée, **produit non ajouté au catalogue**.
10. Plafond de remise appliqué côté serveur (refus avant toute écriture).
11. Un membre ne peut pas modifier son rôle ni ses permissions.
12. Blocage immédiat : session ouverte coupée (401), reconnexion refusée (403), **commandes et statistiques conservées**.
13. Blocage de toute l'équipe : confirmation obligatoire (428 sans `acknowledge`), effet immédiat sur les gérants aussi.
14. Désignation modifiable sans changer l'identifiant unique (`id`, `username` inchangés).
15. L'Administrateur général **ne peut pas** créer de membre ; il pilote les limites et consulte la vue globale.
16. Les membres d'une autre boutique sont invisibles et intouchables (404).
17. Journal d'activité : activation et commande tracées.

Contrôles d'interface (Playwright, exécutés puis scripts supprimés) :
- Marchand desktop : onglet « Mon équipe » → membres listés, compteurs à jour, actions visibles.
- Serveuse mobile 390×844 : activation par code → espace affiché, onglets filtrés par permission
  (« Équipe » absente pour une serveuse), saisie d'un article libre, total correct, commande
  enregistrée (`Commande CMD-… enregistrée.`).
- Administration : vue « Équipes marchands » affichée, limites chargées, tableau des membres.

---

## 4. Règles appliquées (vérifiables dans le code)

- **Rattachement permanent** : `merchant_id` et `store_id` sont posés à la création et ne sont
  modifiables par aucune route. Aucune route n'accepte un `storeId` fourni par le client.
- **Sessions** : cookie `qria_staff` (jeton opaque), session stockée **hachée** en base, TTL 8 h.
  À chaque requête : statut du membre, `token_version`, statut du marchand et blocage d'équipe sont
  revérifiés. Un blocage coupe donc les sessions déjà ouvertes.
- **Conflit de rôles** : la présence simultanée des cookies `qria_merchant`, `qria_admin`,
  `qria_manager`, `qria_supplier`, `qria_staff` provoque un refus (401) et l'effacement du cookie
  d'équipe. Jamais deux identités dans un même navigateur.
- **Codes d'activation** : seuls les **hachés** sont stockés ; le code en clair n'est renvoyé qu'une
  fois. Usage unique (UPDATE atomique), expiration, révocation, régénération (qui révoque l'ancien).
- **Mots de passe** : scrypt + sel, jamais renvoyés, jamais affichés. Réinitialisation par le
  marchand ⇒ sessions coupées + nouveau code.
- **Permissions** : liste blanche serveur, 19 codes. `members.manage`, `owner.settings`,
  `owner.transfer`, `owner.delete`, `owner.team_permissions` ne sont **jamais** accordables à un
  membre. Retirer une permission invalide les sessions en cours.
- **Commandes manuelles** : articles du catalogue **ou** lignes libres. Une ligne libre n'est jamais
  écrite dans `merchant_products` ; elle porte `is_custom = TRUE` sur la commande. La remise est
  refusée **avant** écriture si elle dépasse le plafond du marchand.
- **Tâches** : titre, description, responsable, échéance facultative, priorité, quatre statuts,
  historique immuable (`team_task_events`), notification au membre.
- **Traçabilité** : `team_activity_events` (connexion, scan refusé, commande, remise refusée,
  changement d'état) et `audit_logs` pour les décisions du marchand. Aucune suppression.
- **Points** : 1 par scan non dupliqué, 3 par commande, 1–2 par changement d'état. Valeur de jeu
  interne, sans incidence financière.

---

## 5. Limites connues — à lire avant de promettre quoi que ce soit

1. **Images de démarrage iOS** : elles restent à 512 px de haut (allègement déjà livré). L'écran de
   lancement est légèrement moins net sur grand écran. Les masters HD ne sont plus dans le projet.
2. **Pas de notification push** vers les membres : les tâches sont visibles dans leur espace et
   tracées, mais aucun envoi push/SMS n'est implémenté (aucun fournisseur configuré).
3. **Scan caméra** : l'espace équipe réutilise `jsQR` chargé à la demande. Si le navigateur refuse
   la caméra, la saisie manuelle du code reste disponible. Un navigateur modifié peut toujours
   simuler un scan : la preuve n'existe pas.
4. **Commande 100 % libre** : elle nécessite PostgreSQL ; en mode JSON de développement elle est
   refusée explicitement (`PG_REQUIRED`), sans écriture partielle.
5. **Anciens journaux** : les entrées historiques d'audit conservent le libellé « PDG ».
6. Le module équipe est **fermé** si l'Administrateur général désactive `Module équipe ouvert aux
   marchands` (réponse `503 TEAM_MODULE_CLOSED`).

---

## 6. Dérives corrigées dans `schema.sql` (important)

Le code lisait des colonnes qui n'existaient pas dans `schema.sql` ; une base neuve ne pouvait donc
pas fonctionner correctement. Ajouts **idempotents** (aucune donnée touchée) :

| Table | Colonne(s) ajoutée(s) | Symptôme évité |
|---|---|---|
| `merchant_orders` | `payment_status` | Toute création de commande échouait (`column "payment_status" does not exist`). |
| `merchant_accounts` | `activity_domains`, `activity_domain_label` | Création de compte marchand et amorçage catalogue en erreur. |

Ces corrections sont aussi présentes dans les migrations Mission 5 : les appliquer suffit, même sans
réappliquer `schema.sql` à la main.

---

## 7. Retour arrière

1. Restaurer la sauvegarde applicative (les fichiers remplacés sont dans le zip de la Mission 4).
2. Les tables Mission 5 sont purement additives : les laisser en place ne gêne pas l'ancien code.
   Pour les retirer :
   ```sql
   DROP TABLE IF EXISTS team_task_events, team_tasks, team_activity_events,
     team_member_sessions, team_activation_codes, team_permissions,
     team_members, merchant_team_settings CASCADE;
   ```
   Les colonnes additives (`created_by_member_id`, `is_custom`, `member_id`…) peuvent rester : elles
   ont des valeurs par défaut neutres.
3. Les contraintes étendues (`source`, `created_by_type`) restent valides pour l'ancien code.

---

## 8. Comptes et accès

- Marchand : `/merchant/` → onglet **Mon équipe**.
- Gérant général et serveuse : `/equipe/` (même page, droits différents).
- Administrateur général : `/admin/` → **Équipes marchands** (limites + vue globale, aucune création).
