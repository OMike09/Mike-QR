# INSTALLATION — COLIS MISSION 15

Ce colis est **complet et autonome** : il contient toute l'application dans son état du
10 octobre 2026 (hors `node_modules` et hors base de données). Deux façons de l'utiliser :

- **remplacement complet** : déposez le dossier à la place de l'installation actuelle, en
  conservant `node_modules` ou en relançant `npm install` ;
- **mise à jour par-dessus** : copiez `public/`, `test/`, `tools-*` et les fichiers de la racine
  dans l'installation existante.

Dans les deux cas, faites la sauvegarde du point 1 avant.

---

## 1. Sauvegarde avant toute modification (§18)

```bash
# Depuis la racine de l'installation en production
tar -czf sauvegarde-avant-m15-$(date +%Y%m%d-%H%M).tar.gz public *.js *.sql package.json
```

Conservez ce fichier : il permet le retour arrière décrit au point 6.

Base de données (optionnel mais recommandé) :

```bash
pg_dump "$DATABASE_URL" > sauvegarde-avant-m15-$(date +%Y%m%d-%H%M).sql
```

---

## 2. Copie des fichiers

Les chemins du colis reproduisent ceux de l'application :

```
OYMIKE-MISSION15/
├── public/            → à copier dans  <app>/public/
├── test/              → tests automatisés (`npm test`)
├── tools-m14/         → recettes navigateur de la mission 14
├── tools-m15/         → recette par rôle de la mission 15
├── captures/          → captures réelles des écrans testés (documentation)
├── data/              → jeu de démonstration local (non copié dans un déploiement)
└── *.js, *.sql, package.json, package-lock.json  → racine de l'application
```

```bash
cd OYMIKE-MISSION15
cp -a public/.            /chemin/vers/app/public/
cp -a test/.              /chemin/vers/app/test/
cp -a tools-m14/.         /chemin/vers/app/tools-m14/
cp -a tools-m15/.         /chemin/vers/app/tools-m15/
cp -a *.js *.sql package.json /chemin/vers/app/
```

> **Important** : `public/sw.js` doit aussi être présent dans `public/merchant/sw.js` (le service
> worker de l'espace marchand). Si votre installation duplique ce fichier, refaites la copie :
>
> ```bash
> cp public/sw.js public/merchant/sw.js
> ```

---

## 3. Schémas SQL (une seule fois)

À exécuter seulement si votre base ne les contient pas déjà. Les deux scripts sont idempotents
(`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`).

```bash
psql "$DATABASE_URL" -f schema-mission15-compteur.sql   # compteur de commandes neuves
psql "$DATABASE_URL" -f schema-mission15-tables.sql     # capacité + affectation des tables
```

Si vous n'utilisez pas PostgreSQL, ignorez cette étape : l'application conserve son mode JSON
local et les modules mission 15 s'y replient sans erreur.

---

## 4. Redémarrage

```bash
npm install          # uniquement si package.json a changé de dépendances (aucune ajoutée ici)
npm start
```

Contrôles rapides :

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3720/            # 200
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3720/merchant/   # 200
```

**Aucune variable d'environnement à ajouter ou modifier.** Les liens publics et les URL marchandes
existants sont conservés tels quels.

---

## 5. Vérifications après installation

### Suite automatisée

```bash
npm test
```
Attendu : `tests 191 · pass 189 · fail 0 · skipped 2`.

### Recettes navigateur (Playwright requis)

```bash
# Espace marchand (mission 14) — libérer d'abord le verrou de session unique :
#   DELETE FROM merchant_active_sessions;   (comportement normal du §10)
node tools-m14/recette-navigation.js      # attendu : 26/26
node tools-m14/recette-compartiments.js   # attendu : 16/16

# Recette par rôle (mission 15) :
node tools-m15/recette-roles.js           # attendu : 70/70
```

La recette par rôle suppose des comptes de recette : voir `tools-m15/README-RECETTE.md`.
**Ne créez jamais ces comptes en production** ; utilisez une base de recette.

### Vérification manuelle de l'écran PDG

1. Se connecter comme Administrateur général.
2. Menu latéral → **Apparence des espaces**.
3. Choisir un menu sombre, une police Georgia, une taille de 18 px : l'**aperçu** change
   immédiatement.
4. Mettre « Texte du menu » de la même couleur que « Menu latéral » : le bloc **Lisibilité**
   signale le texte illisible et l'enregistrement est refusé.
5. Rétablir un contraste correct, cocher « Appliquer à tous les espaces », choisir « imposé »,
   puis **Enregistrer l'apparence**.
6. Ouvrir l'espace marchand dans un autre navigateur : le menu, la police et la taille suivent.
7. Revenir sur l'écran PDG → **Revenir aux valeurs d'origine** : le marchand retrouve son thème
   standard après actualisation.

---

## 6. Retour arrière

Deux niveaux, tous deux sans perte de données :

**a) Annuler l'apparence** (le plus fréquent) : écran PDG → **« Revenir aux valeurs d'origine »**.
Aucune donnée commerciale n'est touchée : seul un objet de style est modifié.

**b) Revenir aux fichiers précédents** :

```bash
tar -xzf sauvegarde-avant-m15-AAAAMMJJ-HHMM.tar.gz -C /chemin/vers/app
npm start
```

Les deux schémas SQL de la mission 15 sont **additifs** (nouvelle table, nouvelle colonne) : les
laisser en place ne gêne pas l'ancienne version du code.

---

## 7. Défauts connus

Voir la section 4 du `RAPPORT-FINAL-M15.md` : `PUT /api/admin/managers/:id` (message d'erreur
trompeur), `PATCH /api/admin/managers/:id` (404), limiteur de connexion fournisseur (8 essais /
10 minutes), adresse affichée sous le QR fournisseur (hérite de l'hôte de la requête).
