# Recettes par rôle — Mission 15

Les comptes ci-dessous servent **uniquement** à la recette locale (`oymike_m15`, port 3720).
Ils ne sont jamais créés automatiquement par le serveur : le script `recette-roles.js` suppose
qu'ils existent déjà.

| Rôle | Adresse | Identifiant | Mot de passe |
|---|---|---|---|
| Administrateur général (PDG) | `/` | `admin` | `admin1234` |
| Marchand | `/merchant/` | `baobab884105` | `482913` |
| Gestionnaire | `/manager/` | `gestion.recette` | `RecetteGestion2026!` |
| Serveuse | `/equipe/` | `awa.recette213` | `246813` (six chiffres) |
| Fournisseur | `/supplier/` | `fournisseur.recette` | `RecetteFournisseur2026!` |

## Ce que vérifie la recette

Pour chaque rôle, le script ouvre réellement l'espace dans un navigateur, clique dans le menu,
et contrôle :

1. la connexion est acceptée (HTTP 200) ;
2. l'espace s'ouvre (coquille réellement visible) ;
3. chaque entrée de **son** menu ouvre **son** panneau, non vide ;
4. aucune entrée appartenant à un autre rôle n'apparaît chez lui ;
5. les données des autres rôles sont refusées par le serveur (`401`, `403` ou `404`), et non
   seulement masquées à l'écran ;
6. aucun bouton visible n'est sans action (ni identifiant, ni action `data-*`, ni formulaire) ;
7. aucune erreur JavaScript et aucun 404 de ressource pendant tout le parcours.

## Prérequis

- PostgreSQL 17 démarré, base `oymike_m15` ;
- serveur applicatif sur `http://127.0.0.1:3720` ;
- Playwright disponible (`PLAYWRIGHT_PATH` peut pointer vers son `node_modules`) ;
- **verrou de session marchand libéré** avant de lancer :

```sql
DELETE FROM merchant_active_sessions;
```

C'est le comportement attendu du §10 : un seul marchand actif à la fois. Si le compte marchand
est déjà connecté ailleurs, la recette reçoit `409` et le signale comme une réussite du verrou
(« session unique active ») au lieu d'un échec.

## Comptes créés pour la recette

- gestionnaire `gestion.recette` : créé par le PDG via `POST /api/admin/managers` ;
- fournisseur `fournisseur.recette` : `POST /api/supplier/register` puis décision d'approbation
  `POST /api/admin/suppliers/:id/decision` (`approved`) ;
- serveuse : créée par le marchand via `POST /api/merchant/team/members`
  (`role: waitress`, `approveNow: true`, mot de passe à six chiffres).

Aucun de ces comptes n'appartient au jeu de données de production : ils vivent dans la base de
recette locale.
