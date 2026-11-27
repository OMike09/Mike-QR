# INSTALLATION — Mission 14 (colis delta)

Ce colis ne contient **que les fichiers changés et ajoutés**. **Aucune migration de base** : ni
table, ni colonne, ni donnée ne change. Vos comptes, QR, produits, commandes, tables, équipes et
autorisations restent intacts.

---

## 1. Faire une sauvegarde avant de copier (2 minutes)

Dans le dossier de l'application :

```bash
mkdir -p sauvegarde-avant-m14
cp public/merchant.html public/workspace-ui.js public/merchant.js \
   public/merchant-home.css public/merchant-home.js public/merchant/sw.js \
   sauvegarde-avant-m14/
```

> Les six fichiers ci-dessus sont les seuls fichiers **modifiés**. Les fichiers **ajoutés** peuvent
> simplement être supprimés pour revenir en arrière (section 4).

## 2. Copier les fichiers

```bash
# 1) tout le public sauf le service worker
mkdir -p public/merchant
for f in OYMIKE-MISSION14/public/*; do
  case "$f" in *"/sw.js") ;; *) cp "$f" public/ ;; esac
done
# 2) le service worker va dans public/merchant/
cp OYMIKE-MISSION14/public/sw.js public/merchant/sw.js
# 3) les tests et les outils de recette
cp OYMIKE-MISSION14/tests/*.js test/
mkdir -p tools-m14 && cp OYMIKE-MISSION14/tools-m14/* tools-m14/
```

| Fichier du colis | Destination | État |
| --- | --- | --- |
| `public/merchant.html` | `public/merchant.html` | remplacé |
| `public/workspace-ui.js` | `public/workspace-ui.js` | remplacé |
| `public/merchant.js` | `public/merchant.js` | remplacé |
| `public/merchant-home.css` | `public/merchant-home.css` | remplacé |
| `public/merchant-home.js` | `public/merchant-home.js` | remplacé |
| `public/sw.js` | **`public/merchant/sw.js`** | remplacé (cache **v8**) |
| `public/merchant-shell-m14.css` | `public/merchant-shell-m14.css` | **nouveau** |
| `public/merchant-ops.js` | `public/merchant-ops.js` | **nouveau** |
| `public/table-manager.js` | `public/table-manager.js` | **nouveau** |
| `public/member-accounts.js` | `public/member-accounts.js` | **nouveau** |
| `tests/mission14-structure-menus.test.js` | `test/` | **nouveau** |
| `tests/merchant-ui.test.js`, `tests/mission12-*.js`, `tests/mission13-*.js` | `test/` | remplacés |

## 3. Redémarrer, puis vérifier en 60 secondes

1. Redémarrer le service (Render redémarre seul au déploiement).
2. **Fermer complètement l'application** sur le téléphone puis la rouvrir : le cache passe en `v8`,
   les nouveaux fichiers sont rechargés (le service worker est en « réseau d'abord » pour JS/CSS).
3. Se connecter en marchand, puis vérifier :

| # | Action | Attendu |
| --- | --- | --- |
| 1 | Regarder la page | menu **à gauche** (8 entrées + « Se déconnecter » en bas), contenu à droite |
| 2 | Cliquer chaque rubrique | l'écran correspondant s'ouvre, **rien ne reste vide** |
| 3 | Sur téléphone, toucher **☰ Menu** | le tiroir s'ouvre ; après un choix il se referme |
| 4 | **Gestion des tables et espaces** → *Ajouter une table* | le formulaire s'ouvre, la table créée apparaît et reste après rechargement |
| 5 | **Paramètres** → *Produits* | la liste des produits s'affiche (mêmes produits qu'avant) |
| 6 | **Paramètres** → *Apparence* | les trois thèmes changent **le menu et le contenu** ; le choix survit au rechargement |
| 7 | **Mon équipe** | les deux entrées du sous-menu fonctionnent ; les comptes existants sont là |
| 8 | Ouvrir la console (F12) puis se déconnecter/reconnecter | **aucune erreur rouge**, **aucun 401** avant connexion |

## 4. Retour arrière

```bash
cp sauvegarde-avant-m14/merchant.html sauvegarde-avant-m14/workspace-ui.js \
   sauvegarde-avant-m14/merchant.js sauvegarde-avant-m14/merchant-home.css \
   sauvegarde-avant-m14/merchant-home.js public/
cp sauvegarde-avant-m14/sw.js public/merchant/sw.js
rm -f public/merchant-shell-m14.css public/merchant-ops.js \
      public/table-manager.js public/member-accounts.js
```

Puis recharger la page deux fois (le service worker revient à sa version précédente).
**Aucune donnée n'est à restaurer** : la base n'a pas été touchée par cette mission.

## 5. Ce qui n'est pas dans ce colis

- **Aucun fichier serveur**, **aucune route nouvelle**, **aucune variable d'environnement** : la
  mission ne change que l'affichage et la navigation de l'espace marchand.
- **Aucun compte de démonstration** : le compte `baobab377639` utilisé pour les captures et les
  recettes n'existe que sur la base PostgreSQL locale de test.
- **Aucune URL marchande modifiée** : les liens déjà distribués continuent de fonctionner.
- Les captures de `captures/` proviennent de la base de recette locale (d'où les numéros de tables
  générés par les tests) ; elles servent de preuve visuelle, pas de données à importer.
