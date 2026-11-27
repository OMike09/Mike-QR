# OYMIKE TECH QR — COLIS MISSION 15

Colis **complet et autonome** : ce dossier contient toute l'application dans son état du
10 octobre 2026, après la mission 15. Il n'y a pas de patch à appliquer : copiez, installez les
dépendances, redémarrez.

> **À lire avant tout** : `RAPPORT-FINAL-M15.md` dit précisément ce qui est testé et ce qui ne
> l'est pas. Rien n'est déclaré opérationnel sans avoir été exécuté.

---

## Ce que cette étape apporte

### 1. Un écran PDG pour l'apparence de tous les espaces

Administrateur général → menu latéral → **« Apparence des espaces »**.

- **9 couleurs** (fond, cartes, menu, texte du menu, texte principal, texte secondaire, boutons,
  texte des boutons, bordures), à la pipette ou au code hexadécimal ;
- **6 polices**, taille de base **14-20 px**, graisse, interligne, arrondi des cartes ;
- **aperçu direct** d'un écran marchand, aux mêmes variables CSS que les vrais écrans ;
- **contrôle de lisibilité** : les 5 paires de texte doivent rester au-dessus de **4,5:1**
  (WCAG AA). Sinon l'enregistrement est bloqué dans le navigateur **et** refusé par le serveur
  (`400 CONTRAST_TOO_LOW`) ;
- diffusion **imposée** (tous les comptes) ou **proposée** (le compte garde son thème s'il en a
  choisi un) ;
- **« Revenir aux valeurs d'origine »** : remise à zéro réelle, journalisée.

### 2. Plus aucun 404, plus aucun lien mort

- `/staff/` → redirection permanente vers `/staff.html` (cette adresse répondait 404) ;
- liens de l'accueil marchand et du QR public ancrés sur leur vraie destination, ou retirés tant
  qu'aucune destination réelle n'existe ;
- lien « Profil QR » du fournisseur masqué au lieu de pointer vers une page inexistante.

**Mesure** : 10 pages auditées — `404/500 : aucun`, `liens morts : aucun`, `erreurs JS : aucune`.

### 3. L'espace fournisseur aligné sur la maquette

En-tête fixe, **menu latéral sombre à gauche**, contenu à droite, comme les cinq autres espaces.
Mêmes fonctions, même ordre. Vérifié sur ordinateur (1440×900) et téléphone (390×844).

### 4. Une recette par rôle

`tools-m15/recette-roles.js` ouvre réellement les **5 espaces** (PDG, marchand, gestionnaire,
serveuse, fournisseur), clique dans chaque menu et vérifie **70 contrôles** : connexion, panneaux
ouverts, cloisonnement côté serveur (`401`/`403`/`404`), boutons tous câblés, zéro erreur
JavaScript.

---

## Résultats de test au moment de la livraison

| Contrôle | Résultat |
|---|---|
| `npm test` sur le colis, copie propre | **191 tests · 189 réussis · 0 échec · 2 ignorés** |
| Démarrage du colis, copie propre | **200** sur `/`, `/supplier/`, `/admin-appearance-custom.js` ; `/staff/` → **301** |
| Recette navigation marchand (M14) | **26/26** |
| Recette compartiments marchand (M14) | **16/16** |
| Recette par rôle (M15) | **70/70** |
| Navigateur fournisseur (6 vues) | **6/6** |
| Audit 404 / liens morts / erreurs JS | **aucun** |

Aucune régression de la mission 14.

---

## Ce qui reste ouvert

Le rapport détaille six points **non terminés** : refonte des cinq autres espaces (§2/§3), écran
de hiérarchie (§16), sauvegarde automatique et procédure de retour arrière complète (§18),
vérification exhaustive base table par table (§15), et deux défauts d'API relevés pendant les
tests (`PUT /api/admin/managers/:id`, `PATCH /api/admin/managers/:id` → 404).

Ne les annoncez pas comme opérationnels.

---

## Mise en place

Voir `INSTALLATION.md`. En résumé : `npm install`, exécuter les deux schémas SQL de la mission 15
s'ils ne le sont pas, `npm start`, puis lancer les recettes.

**Aucune variable d'environnement n'a été changée. Aucune nouvelle URL marchande n'a été créée.**
Aucune donnée existante n'a été supprimée.
