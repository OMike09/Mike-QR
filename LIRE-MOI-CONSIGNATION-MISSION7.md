# OYMIKE TECH QR — MISSION 7

**Consignation, code secret client, application client installable.**
Version livrée : 2026-11-23 · base PostgreSQL réelle · aucun compte, historique, QR ou lien existant supprimé.

---

## 1. Ce que vous devez faire, dans l'ordre

### 1.1 Sauvegarder (5 minutes)

```bash
pg_dump -Fc "$DATABASE_URL" > sauvegarde-avant-mission7.dump
```

### 1.2 Copier les fichiers

Décompressez l'archive **à la racine du projet** (là où se trouvent `server.js` et `store.js`).
Les chemins de l'archive sont relatifs : `server.js`, `public/app/index.html`, `tools/…`.
Aucun dossier imbriqué, aucun fichier existant n'est écrasé par un dossier vide.

### 1.3 Mettre à jour la base

La nouvelle migration est `schema-consign-mission7.sql`. Elle est **additive** :
elle crée des tables et ajoute des colonnes, elle ne supprime rien.

Au démarrage, `store.js` applique automatiquement les schémas, dans cet ordre :
`schema.sql` → `schema-catalog-mission4.sql` → `schema-team-mission5.sql` →
`schema-team-mission5-platform.sql` → `schema-ops-mission6.sql` → **`schema-consign-mission7.sql`**.

Pour l'appliquer à la main si vous préférez :

```bash
psql "$DATABASE_URL" -f schema-consign-mission7.sql
```

### 1.4 Redémarrer

```bash
npm install     # uniquement si de nouvelles dépendances sont apparues (aucune ici)
npm start
```

Vérification en 10 secondes : `GET /api/health` doit répondre `200`.

---

## 2. Où se trouve quoi

| Espace | Adresse | Ce qui change |
|---|---|---|
| Administrateur général (PDG) | `/admin/` | nouvelle entrée de menu **Consignations** (supervision) |
| Gestionnaire | `/manager/` | inchangé (les comptes marchands restent gérés ici) |
| Marchand | `/merchant/` | nouvel onglet **Consignation** + mot de passe à **6 chiffres** |
| Gérant général / serveuse | `/equipe/` | nouvel onglet **Consignation** (selon permissions) |
| Application client | `/app/` | nouvelle PWA installable : commandes, consignations, scan, boutiques |

Les QR publics et les liens de boutique existants **continuent de fonctionner à l'identique**.

---

## 3. Les règles appliquées par le serveur (pas seulement à l'écran)

1. **Mot de passe marchand = exactement 6 chiffres.** Jamais converti en nombre : `000123` reste `000123`.
   Les comptes PDG, gestionnaires, gérants généraux et serveuses ne sont **pas** concernés.
2. **Tentatives de connexion** : 5 échecs → verrou de 60 s, puis 5 min, 30 min, 1 h, 6 h. HTTP `423`.
3. **Code secret client** : 6 caractères `A-Z0-9`, tiré au hasard, unique par boutique, stocké **haché**.
   Il n'est affiché **qu'une seule fois**, sur la fiche qui suit le dépôt, avec un bouton « Afficher ».
   Les listes n'affichent qu'un indice masqué (`BE••3`).
4. **Un dépôt n'est jamais un paiement.** Les consignations n'entrent ni dans le chiffre d'affaires ni dans les encaissements.
5. **Impossible de rendre ou rembourser plus que le solde** : le serveur refuse en `409`.
6. **Double remboursement impossible** : chaque opération porte une clé d'idempotence ; un rejeu identique
   renvoie la même réponse sans toucher au solde.
7. **Cloisonnement** : un client ne voit que ses commandes et ses consignations ; une serveuse ne voit que sa boutique ;
   une serveuse ne peut pas rembourser si le marchand ne l'a pas autorisé (HTTP `403` côté serveur, bouton masqué côté écran).
8. **Annulation client** : `pending` → annulation immédiate ; commande acceptée → politique du marchand ;
   en préparation → accord du gérant ; terminée → refus. La commande n'est **jamais supprimée**.

---

## 4. Tests exécutés avant livraison

| Commande | Résultat |
|---|---|
| `node --test` (suite complète, avec PostgreSQL) | **141 réussis, 1 ignoré, 0 échec** |
| `node tools/ops-journey.js` (Mission 6, non-régression) | **53/53** |
| `node tools/ui-test-6.js` (interface Mission 6) | **7/7, zéro erreur JS** |
| `node tools/t-consign.js` (consignation serveur) | dépôts, retours, usage, remboursement, soldes, doublons : conformes |
| `node tools/t-client.js` (compte client) | 8/8 |
| `node tools/t-client-flow.js` (parcours client complet) | notifications, annulation, scan, cloisonnement : conformes |
| `node tools/t-secu-m7.js` (audit sécurité) | **24 contrôles, tous conformes** |
| `node tools/t-ui-consign.js` (interface marchand + PWA) | onglet, dépôt, reçu avec code, manifeste, service worker : conformes |
| `node tools/t-ui-m7.js` (équipe + PDG) | **16 contrôles, tous conformes** |

Les scripts se lancent contre un serveur déjà démarré :

```bash
BASE=http://127.0.0.1:4931 NODE_PATH=/chemin/node_modules node tools/t-secu-m7.js
```

(`NODE_PATH` n'est nécessaire que pour les tests Playwright : `t-ui-consign.js` et `t-ui-m7.js`.)

---

## 5. Ce qui n'est pas simulé, et ce qui reste à configurer chez vous

**Réellement branché** : PostgreSQL, permissions par rôle, soldes, codes hachés, notifications persistées,
service worker et manifeste de l'application, scans client comptés en base.

**À configurer pour aller plus loin** (rien n'est inventé, tout est signalé comme indisponible) :

- **SMS** : sans passerelle configurée, l'écran client affiche « Aucun service SMS n'est configuré ».
  Le code de vérification reste consultable côté serveur (`CLIENT_OTP_DEV_MODE`) en développement uniquement.
- **Notifications push / navigateur** : pas de clé VAPID configurée ⇒ aucun envoi simulé.
  Les notifications sont **persistées** et visibles dans l'application client.
- **Impression / partage** : le reçu s'imprime via l'impression du navigateur ; le partage utilise
  l'API de partage du téléphone quand elle existe, sinon la copie dans le presse-papiers.

---

## 5 bis. Un seul logo pour tous les liens (demande client)

Le client, les marchands, les gérants généraux, les serveuses, les gestionnaires et le PDG partagent
désormais **exactement le même visuel** : le logo officiel Oymike Tech.

| Élément | Fichier servi |
|---|---|
| Icônes d'application (32, 180, 192, 512) | `/icons/oymike-brand/oymike-{taille}.png` |
| Icône maskable (Android, rognage circulaire) | `/icons/oymike-brand/oymike-512-maskable.png` |
| Écrans de lancement iPhone (8 formats) | `/icons/oymike-brand/oymike-startup-{w}x{h}.png` |
| Favicon de toutes les pages | `/icons/oymike-brand/oymike-32.png` |

Ce qui reste distinct — et doit le rester — c'est l'**identité de chaque application** : nom, adresse de
lancement (`/app/`, `/merchant/`, `/equipe/`, `/manager/`, `/admin/`), périmètre et données visibles.
Deux applications portant le même logo s'installent côte à côte sans se confondre : leurs identifiants
de manifeste sont différents (`id`), et chaque rôle voit uniquement ses propres écrans.

Nouveauté au passage : l'espace équipe (`/equipe/`) est maintenant installable comme les autres, avec son
manifeste dédié et deux raccourcis (`/?tab=consignment`, `/?tab=orders`).

Les anciens dossiers d'images (`/icons/client`, `/icons/merchant`, `/icons/manager`) ne sont plus
référencés par aucune page. Ils peuvent rester sur le serveur sans effet ; aucune page ne les appelle.

---

## 6. Installation de l'application client (à montrer au client)

- **Android / Chrome** : ouvrir `/app/`, puis « Installer l'application » (ou menu ⋮ → Installer).
- **iPhone / Safari** : bouton Partager → « Sur l'écran d'accueil ».
- L'installation n'est **jamais obligatoire** : commander ou consulter une boutique fonctionne dans le navigateur.

---

## 7. En cas de problème

| Symptôme | Cause probable | Solution |
|---|---|---|
| `PG_REQUIRED` sur les consignations | serveur démarré sans PostgreSQL | vérifier `DATABASE_URL` |
| Un marchand ne peut plus se connecter | verrou après 5 codes faux | attendre la fin du verrou (60 s puis croissant) ou réinitialiser depuis `/admin/` |
| L'ancien code secret du client ne marche plus | le code a été renouvelé depuis la fiche | utiliser le nouveau code remis au client |
| L'onglet Consignation n'apparaît pas pour une serveuse | permission `consignment.view` non accordée | la cocher dans l'espace marchand → Équipe |

Toute opération sensible (dépôt, retour, usage, remboursement, annulation, connexion, changement de mot de passe)
est journalisée et consultable, sans possibilité de suppression.
