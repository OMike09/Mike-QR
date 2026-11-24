# Ouvrir mon espace Administrateur général (PDG)

Ce dossier est **complet** : il contient l'application, la base de données, les modules de la Mission 7
et les mêmes fichiers que le colis précédent. Il suffit de le lancer.

---

## 1. La façon la plus simple (2 minutes, Windows)

1. **Installer Node.js** (une seule fois dans la vie de l'ordinateur) :
   ouvrez <https://nodejs.org/fr/download>, téléchargez la version **LTS pour Windows**,
   puis installez-la en laissant toutes les options par défaut.
   *(Mac : même page, version LTS macOS. Linux : `sudo apt install nodejs npm`.)*

2. **Décompresser** ce colis où vous voulez (Bureau, Documents…). Évitez un dossier synchronisé
   OneDrive si vous avez des lenteurs.

3. **Double-cliquer sur `DEMARRER-WINDOWS.bat`**
   *(Mac : `DEMARRER-MAC-LINUX.command`)*

4. Une fenêtre noire s'ouvre, installe ce qu'il faut la première fois, puis **votre navigateur
   s'ouvre tout seul sur** :

   ```
   http://localhost:3000/admin/
   ```

   Identifiant : **admin**
   Mot de passe : **admin1234**

C'est tout. Pour arrêter : fermez la fenêtre noire (ou `Ctrl + C`).

> La deuxième fois, le démarrage prend 2 secondes : les dépendances sont déjà installées.

---

## 2. Ce que fait le script tout seul

- Il vérifie que Node.js est présent et assez récent (20 ou plus).
- Il installe les dépendances (`npm install`) si besoin.
- Il **choisit le port libre** : si 3000 est occupé, il prend 3001, 3002… et affiche l'adresse exacte.
- Il **choisit la base de données** :
  - si vous avez défini `DATABASE_URL` et que PostgreSQL répond → tout est actif
    (consignation, équipes, commandes, scans) ;
  - sinon → **stockage local JSON** (`data/store.json`). L'admin s'ouvre immédiatement, mais les
    modules qui exigent PostgreSQL (consignation notamment) resteront indisponibles.
- Il crée un fichier `.env` avec un **secret de session aléatoire** (jamais deux fois le même).
- Il ouvre le navigateur dès que le serveur répond.

---

## 3. Avoir TOUT (avec PostgreSQL)

Le stockage local suffit pour ouvrir l'admin, mais la consignation, les équipes et les commandes
demandent PostgreSQL. Trois options :

### Option A — PostgreSQL déjà installé sur l'ordinateur
```bash
createdb oymike
```
Puis créez un fichier `.env` à côté de `demarrer.js` contenant :
```
DATABASE_URL=postgres://VOTRE_UTILISATEUR@127.0.0.1:5432/oymike
```
et relancez `DEMARRER-WINDOWS.bat`. Les schémas s'appliquent tout seuls au démarrage.

### Option B — Une base PostgreSQL gratuite en ligne (Neon, Supabase)
Créez une base, copiez la chaîne de connexion, mettez-la dans `.env` sous `DATABASE_URL`.
Rien d'autre à faire.

### Option C — Tout en ligne, sur un vrai domaine
Voir la section 5 (Render, Railway, VPS).

---

## 4. Si quelque chose ne s'ouvre pas

| Ce que vous voyez | Cause | Solution |
|---|---|---|
| « Node.js n'est pas installé » | Node.js absent | installer depuis nodejs.org puis relancer |
| La fenêtre se ferme aussitôt | erreur au démarrage | relancer en double-cliquant, lire le message ; ou `node demarrer.js` dans un terminal |
| `EADDRINUSE` | port occupé | le script en choisit un autre tout seul ; sinon fermez l'autre programme |
| Page blanche | navigateur trop ancien | utiliser Chrome, Edge, Firefox ou Safari à jour |
| « Session expirée » en boucle | cookies bloqués | autoriser les cookies pour `localhost` |
| L'admin s'ouvre mais la consignation refuse | pas de PostgreSQL | voir section 3 : `PG_REQUIRED` |

---

## 5. Mettre en ligne (accès depuis n'importe quel appareil)

Trois fichiers sont prêts à la racine :

- **`render.yaml`** — déploiement Render en un clic : poussez le dossier sur GitHub, puis
  « New → Blueprint » dans Render. La base PostgreSQL est créée et reliée automatiquement.
  Il reste à saisir `ADMIN_PASSWORD` dans le tableau de bord (jamais dans le code).
- **`Dockerfile` + `.dockerignore`** — pour Railway, Fly.io ou un VPS :
  `docker build -t oymike .` puis `docker run -p 3000:3000 --env-file .env oymike`.
- **`Procfile`** — pour Heroku / Railway (détection automatique).

Variables à définir en production (obligatoires) :

```
NODE_ENV=production
DATABASE_URL=postgres://…
SESSION_SECRET=<48 caractères aléatoires>
ADMIN_USERNAME=<votre identifiant>
ADMIN_PASSWORD=<mot de passe long, PAS admin1234>
PUBLIC_BASE_URL=https://votre-domaine
```

Une fois en ligne, votre lien devient `https://votre-domaine/admin/` et fonctionne
depuis n'importe quel ordinateur ou téléphone.

---

## 6. Comptes et sécurité

- `admin` / `admin1234` est un **compte de démonstration** : il n'existe que tant que
  `ADMIN_PASSWORD` n'est pas défini. En production, choisissez-en un autre.
- Les mots de passe marchands font **exactement 6 chiffres** (Mission 7) ; cela ne concerne
  ni le PDG, ni les gestionnaires, ni les gérants, ni les serveuses.
- Un seul rôle par navigateur : pour tester plusieurs rôles, utilisez une fenêtre privée.
  (`Ctrl + Maj + N` sur Chrome/Edge, `⌘ + Maj + N` sur Mac.)
