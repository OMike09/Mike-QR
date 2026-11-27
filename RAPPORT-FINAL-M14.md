# OYMIKE — MISSION 14 · RAPPORT FINAL (9 points)

**Date :** 10 octobre 2026 · **Périmètre :** espace marchand uniquement · **Livraison :** locale (colis delta)
**Compte de recette :** `baobab377639` / `482913` (PostgreSQL local `oymike_m14_test`) · **Serveur :** `node server.js`, port 3720

---

## 1. Audit intégral mené, causes réelles identifiées

L'audit complet est livré dans `AUDIT-M14.md` (pages, menus, boutons, formulaires, routes et
redirections, connexions, API, base, autorisations par rôle, QR, commandes, produits, tables,
équipes, historiques, notifications/temps réel). Chaque défaut corrigé cette mission a d'abord été
**reproduit** puis expliqué :

| Symptôme observé | Cause réelle (vérifiée, pas supposée) |
| --- | --- |
| Écran qui se vide après un clic de menu | boutons `.tab` **sans** `data-tab` (onglets internes d'Opérations) → `tab(undefined)` → tous les panneaux masqués |
| Écran demandé re-masqué aussitôt | deux règles « vue → panneau » divergentes (`merchant.js` et `workspace-ui.js`) ; l'élagage `visible.slice(1)` masquait la cible |
| Cartes de rubrique sans effet | `bindSideMenu()` posait `state.menu` avant `boot()`, qui croyait le branchement déjà fait et ne branchait jamais la délégation de clics |
| Boutons inaccessibles hors accueil | les écrans étaient rangés dans la grille à 2 colonnes (colonne du menu) au lieu de la zone de contenu |
| 401 dans la console avant connexion | `member-accounts.js` appelait son API dès le chargement, avant l'ouverture de session |
| Volets de commande bloqués | `window.scrollTo` levait une exception et interrompait la navigation |

Méthode : instrumentation en navigateur (interception de `openTab` avec pile d'appels), sonde jsdom
isolée, comparaison fichier servi / fichier exécuté. Aucune erreur n'a été masquée : celles qui ne
sont **pas** corrigées figurent au point 9.

## 2. Ancienne organisation remplacée par la structure de référence

Menu latéral unique, ordre de la maquette : **Accueil · Commandes · Scanner · Vue d'ensemble ·
Gestion des tables et espaces · Mon équipe › (Mes comptes créés / Points et classement) · Voir les
historiques · Paramètres**, pied « Se déconnecter ». La barre d'onglets historique est retirée à
l'exécution ; **aucun panneau n'a été supprimé**, les anciennes rubriques (produits, consignation,
catalogue, catégories, QR codes, marketing, personnalisation, compte, apparence, réglages avancés)
sont devenues les tuiles de **Paramètres**, avec leurs routes d'origine.

## 3. Compartiments réellement fonctionnels (prouvé, pas déclaré)

Recette navigateur `tools-m14/recette-compartiments.js` — **16/16**, chaque action étant relue
depuis l'API après coup :

| Compartiment | Ce qui a été fait réellement |
| --- | --- |
| **Tables et espaces** | création par le formulaire de l'écran → relecture serveur → modification (salle + capacité) → désactivation → présence dans la liste affichée |
| **Produits** | création → **rechargement complet de la page** → produit toujours présent ; refus d'un produit sans nom avec message clair |
| **Mon équipe** | page ouverte, les deux entrées du sous-menu présentes, comptes lus depuis le serveur |
| **Commandes** | liste serveur ; écran de commande assistée opérationnel ; hub Commandes (vue d'ensemble / assistée / commandes) |
| **Historiques · Vue d'ensemble** | données reçues du serveur (lignes, catégories, 4 cartes chiffrées) |
| **Fournisseurs** | hors périmètre marchand (voir point 9) : écran géré côté PDG/gestionnaire, non modifié, non régressé |

## 4. Zéro 404, zéro bouton mort, zéro redirection silencieuse

- Test automatique (garde-fou n° 5) : **chaque entrée de menu possède un panneau réel** — aucune
  entrée orpheline, aucun panneau inaccessible depuis le menu.
- Tout bouton `.tab` sans destination est désormais **ignoré** au lieu de provoquer `tab(undefined)`.
- Les tuiles de hub portent toutes une action réelle (`data-hub-tab` → écran existant) ; l'étoile
  « mettre en exergue » et le doublon « Voir les historiques » ont été retirés parce qu'ils ne
  correspondaient plus à la structure livrée — pas de bouton décoratif.
- Aucune redirection de secours vers l'accueil : une vue inconnue est traitée explicitement
  (`targetPanelFor` renvoie `'aucun-panneau'` pour l'accueil de la maquette, cas légitime).

## 5. Persistance réelle (aucune simulation, aucun faux succès)

- Tables, produits, comptes, apparence : écriture côté serveur puis **relecture** par l'API et par
  l'écran, y compris **après rechargement de la page**.
- Les messages d'erreur affichés proviennent du serveur (`Le nom du produit est obligatoire.`) ;
  aucun `catch` ne transforme un échec en succès.

## 6. Sécurité serveur

- **Permissions côté API** : un marchand qui tente de créer un QR de table reçoit **403**
  (« La création et la gestion des QR sont réservées au PDG et au gestionnaire autorisé »). Vérifié
  en recette, pas seulement dans l'interface.
- **Isolation inter-établissements** : héritée des missions 11/12 (toutes les routes filtrent sur
  l'établissement de la session) — la mission 14 n'ajoute aucune route et n'en élargit aucune.
- **Journaux d'activité** : conservés tels quels (aucune modification du journal).
- **Mots de passe** : jamais en clair (hachage existant inchangé) ; aucun mot de passe ni secret
  n'apparaît dans les fichiers livrés.

## 7. Harmonisation visuelle, responsive, 3 thèmes

- Une seule coquille : menu 272 px à gauche (≥ 980 px), **tiroir** sur téléphone/tablette avec
  bandeau « ☰ Menu », refermé après le choix ou par le fond ; aucune entrée coupée.
- **Trois thèmes** (Vert-Blanc, Noir-Or, Blanc-Bleu) appliqués au menu **et** au contenu, conservés
  au rechargement. Les trois grandes actions de l'accueil suivent désormais le thème (or en Noir-Or).
- Captures de preuve : `captures/` — 1440 px (accueil, tables, commandes, équipe, historiques,
  paramètres, vue d'ensemble), 834 px (tablette), 390 px (accueil, menu, tables), 2 thèmes.
- Corrections visuelles issues des captures : en-tête téléphone sur une ligne (« Installer » non
  tronqué), libellés de tuiles non coupés (« Personnalisation »), cartes de Paramètres sur 3 colonnes.

## 8. Tests obligatoires

| Suite | Portée | Résultat |
| --- | --- | --- |
| `npm test` | 182 tests : routes, formulaires, uploads, QR/scan, notifications, statuts, multi-supports, missions 1→14 | **180 réussis, 0 échec, 2 ignorés** (ignorés = dépendants d'un appareil réel, déjà en place avant la mission) |
| `tools-m14/recette-navigation.js` | navigation desktop 1440 + téléphone 390, menu, tiroir, déconnexion, console | **26 / 26** |
| `tools-m14/recette-compartiments.js` | compartiments + autorisations + robustesse (0 appel refusé avant connexion, 0 erreur JS) | **16 / 16** |
| `test/mission14-structure-menus.test.js` | 10 garde-fous anti-régression sur la structure | **10 / 10** |

## 9. Sauvegarde, retour arrière, ce qui n'est pas fait

- **Sauvegarde** : `sauvegarde-avant-m14/` dans le colis (6 fichiers remplacés) + copies sur le
  poste avant modification. Procédure de retour arrière écrite dans `INSTALLATION.md` §4.
- **Aucune perte de données** : ni migration, ni suppression (comptes, QR, produits, commandes,
  tables, liens compte↔responsable, autorisations : tous conservés). Aucune URL marchande créée ou
  modifiée, aucune variable d'environnement touchée.
- **Non déployé** : livraison locale uniquement, conformément à votre consigne ; je n'ai rien
  téléversé sur Render.
- **Points d'honnêteté** (non testables ici, identiques aux missions précédentes) : lecture caméra
  réelle sur appareil physique, prompt d'installation PWA et notifications push vers un vrai
  téléphone — ces trois points dépendent de l'appareil, pas du code livré. La recette a tourné sur
  une base PostgreSQL locale avec un compte de test ; vos données de production n'ont pas été
  touchées.

---

### Livrable

`OYMIKE-MISSION14-COLIS-DELTA-2026-10-10.zip` — contenu : `public/` (10 fichiers), `tests/` (4),
`tools-m14/` (4), `sauvegarde-avant-m14/` (7), `captures/` (13), `LIRE-MOI.md`, `INSTALLATION.md`,
`AUDIT-M14.md`, `SHA256.txt`.
