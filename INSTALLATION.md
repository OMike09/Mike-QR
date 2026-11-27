# INSTALLATION — Mission 13 (colis delta)

Ce colis ne contient **que les fichiers changés**. Aucune base de données n'est modifiée :
il n'y a **aucune migration à exécuter**. Les tables, comptes, QR et commandes existants
continuent de fonctionner tels quels.

## 1. Copier les fichiers

Depuis le dossier `OYMIKE-MISSION13/public/`, copier en respectant l'arborescence :

| Fichier du colis | Destination dans l'application |
| --- | --- |
| `merchant.html` | `public/merchant.html` |
| `merchant-home.js` | `public/merchant-home.js` *(nouveau)* |
| `merchant-home.css` | `public/merchant-home.css` *(nouveau)* |
| `merchant.js` | `public/merchant.js` |
| `workspace-ui.js` | `public/workspace-ui.js` |
| `workspace.css` | `public/workspace.css` |
| `merchant/sw.js` | `public/merchant/sw.js` |
| `icons/oymike-brand/salon-illustration.svg` | `public/icons/oymike-brand/salon-illustration.svg` *(nouveau)* |

Puis, si vous gardez les tests dans le projet :

| Fichier du colis | Destination |
| --- | --- |
| `tests/mission13-accueil-marchand.test.js` | `test/mission13-accueil-marchand.test.js` *(nouveau)* |
| `tests/mission12-tables-comptes.test.js` | `test/mission12-tables-comptes.test.js` (remplace) |

Commandes, si vous êtes dans le dossier de l'application :

```bash
cp -r OYMIKE-MISSION13/public/. public/
cp OYMIKE-MISSION13/tests/*.js test/
```

## 2. Redémarrer et forcer la mise à jour côté navigateur

1. Redémarrer le service Render (ou laisser le déploiement se faire).
2. Sur le téléphone, **fermer complètement l'application** puis la rouvrir : la version de cache
   passe en `v7`, les nouveaux fichiers sont donc rechargés depuis le réseau.
   Si besoin : ouvrir l'application dans le navigateur et faire « actualiser ».
3. Se connecter en marchand : la nouvelle page d'accueil s'affiche immédiatement.

> Le service worker est en **réseau d'abord** pour le code (JS/CSS) : une mise à jour est prise
> en compte au premier rechargement, sans vider le cache à la main.

## 3. Vérifier en 60 secondes

1. La page affiche : photo/initiales + nom + type d'activité, les trois grandes cartes,
   « Activité en cours » avec **vos** chiffres.
2. Cliquer sur **Commandes** → la liste s'ouvre ; revenir par **Accueil** → la page d'accueil revient.
3. Cliquer sur **Scanner** → la caméra s'ouvre et lit un QR de table ; la commande assistée
   s'ouvre sur la bonne table.
4. Cliquer sur **＋ Ajouter une table** → le formulaire de la page « Tables et espaces » s'ouvre.
5. Cliquer sur **＋ Créer un compte** → le formulaire de « Mon équipe » s'ouvre.
6. Choisir **Noir - Or** puis **Appliquer** → message de confirmation, et le thème est toujours là
   après reconnexion.
7. Descendre tout en bas → **Se déconnecter** demande confirmation.

## 4. Retour arrière (si nécessaire)

Le retour arrière ne touche ni la base ni les données. Remettre les anciennes versions de `merchant.html`, `merchant.js`, `workspace-ui.js`,
`workspace.css` et `public/merchant/sw.js`, puis supprimer `public/merchant-home.js`,
`public/merchant-home.css` et `public/icons/oymike-brand/salon-illustration.svg`.
La page d'accueil précédente réapparaît telle qu'elle était.

**Ne jamais supprimer de colonne en base** pour « faire propre » : les anciennes versions du code
les ignorent, et les données des tables, comptes et QR en dépendent.

## 5. Ce qui n'est pas dans ce colis (et pourquoi)

- **Aucun fichier serveur** : cette mission ne change que l'affichage. Les routes
  (`/api/overview`, `/api/merchant/table-management`, `/api/merchant/member-accounts`,
  `/api/merchant/appearance`) sont celles des missions 11 et 12, déjà en production.
- **Aucune migration SQL** : les tables `merchant_service_points` et les comptes existants
  sont utilisés tels quels.
- **Aucun compte de démonstration** n'est livré. Le compte `demo.m13` utilisé pour les captures
  n'existe que sur la base de test locale, il n'est pas dans le colis.
