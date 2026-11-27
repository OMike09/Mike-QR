# Appliquer les corrections à une copie du colis Mission 15

Ce dossier contient **uniquement ce qui a changé** entre le colis M15 livré et l'état actuel.

```
colis-m15-corrections/
├── CORRECTIONS.diff      ← le patch complet (45 fichiers), à appliquer avec `patch -p1`
├── fichiers-modifies/    ← les mêmes fichiers, déjà corrigés (alternative au patch)
├── avant/                ← copie des fichiers d'origine, pour comparaison
├── APPLIQUER.md          ← ce fichier
├── RAPPORT-M15-REFONTE.md ← ce qui est corrigé, testé, et ce qui reste ouvert
├── captures/             ← captures d'écran des écrans corrigés
└── src/                  ← le code source actuel de ces 45 fichiers, à la même arborescence
```

## Méthode 1 — le patch (recommandé)

Depuis la **racine** d'une copie du colis M15 (le dossier qui contient `server.js`) :

```bash
patch -p1 --dry-run < CORRECTIONS.diff   # vérification, n'écrit rien
patch -p1 < CORRECTIONS.diff             # application
```

Le patch fait exactement trois choses :

- **ajoute 7 fichiers** : `order-settlement.js`, `table-occupancy.js`, `table-qr-artwork.js`,
  `schema-mission15-occupation.sql`, `tools-m15/audit-contraste.js`,
  `tools-m15/recette-comptes.json`, `tools-m15/recette-m15.sh` ;
- **modifie 37 fichiers** existants (aucun n'est remplacé intégralement, sauf mention contraire) ;
- **supprime 1 fichier** : `public/signup-gate.js` (§5.1 : le code d'autorisation d'inscription
  n'existe plus). `patch` le supprime lui-même ; aucun autre fichier ne le référence
  (vérifié : `grep -rn "signup-gate"` ne renvoie rien après application).

Le rapport `RAPPORT-M15-REFONTE.md` est fourni à côté du patch, il n'est pas inclus dedans.

## Méthode 2 — copie directe

```bash
cp -a colis-m15-corrections/fichiers-modifies/. /chemin/vers/le/colis/
rm /chemin/vers/le/colis/public/signup-gate.js   # supprimé par le patch, à faire à la main ici
```

## Après l'application — obligatoire

```bash
npm install                     # si ce n'est pas déjà fait
psql "$DATABASE_URL" -f schema-mission15-occupation.sql   # si la base ne se met pas à jour seule
npm test                        # attendu : 189 réussis · 0 échec · 2 ignorés
node server.js
```

Le schéma `schema-mission15-occupation.sql` est **additif et rejouable** (aucune donnée touchée).
Il est aussi appliqué automatiquement au démarrage par `store.js` : la commande `psql` n'est
nécessaire que si vous voulez le passer à la main tout de suite.

## Vérifications faites sur ce dossier

| Contrôle | Résultat |
|---|---|
| `patch -p1` appliqué sur une copie **neuve et complète** du colis M15 | code de sortie 0, aucun rejet, `public/signup-gate.js` supprimé |
| `node --check` sur tous les `.js` du résultat | aucune erreur de syntaxe |
| Comparaison des 45 fichiers patchés avec le code source expédié | **45/45 identiques à l'octet** |
| `sha256sum -c` de la copie patchée contre `SHA256.txt` du colis | écart attendu **sur ces 45 fichiers uniquement** |
| `npm test` après application (copie patchée, `npm install` neuf) | **189 réussis · 0 échec · 2 ignorés** |
| Recette par rôle (5 espaces) | **70/70** |
| Base **neuve** créée de zéro : `table_occupations`, `payment_confirmed_*`, `occupation_status` | présents sans intervention manuelle |
