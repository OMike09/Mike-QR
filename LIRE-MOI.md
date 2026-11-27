# OYMIKE — MISSION 14 · Espace marchand : nouvelle structure (coquille latérale)

**Date :** 10 octobre 2026
**Objet :** l'espace marchand est réorganisé selon la **structure de référence** : un menu latéral
unique (Accueil · Commandes · Scanner · Vue d'ensemble · Gestion des tables et espaces ·
Mon équipe › · Voir les historiques · Paramètres) et une zone de contenu à droite. **Tout ce qui
existait avant existe encore** : mêmes écrans, mêmes données, mêmes droits, mêmes routes.
**Type :** colis **delta** (fichiers changés + tests + recette). Rien n'est supprimé en base.

---

## 1. Ce qui a été vérifié AVANT de toucher au code

L'audit complet (pages, menus, boutons, formulaires, routes, connexions, API, base, autorisations
par rôle, QR, commandes, produits, tables, équipes, historiques, notifications, temps réel) est
livré à part : `AUDIT-M14.md`. Il recense les **causes réelles** trouvées, dont celles corrigées ici :

| Défaut constaté | Cause réelle | Correctif |
| --- | --- | --- |
| Écran vide après certains clics de menu | des boutons portaient la classe `.tab` **sans** `data-tab` → `tab(undefined)` → tous les panneaux masqués | le gestionnaire ignore tout bouton sans identifiant de vue (`merchant.js`) |
| Écran demandé aussitôt re-masqué | deux règles « vue → panneau » différentes dans `merchant.js` et `workspace-ui.js` | **une seule** règle, `WorkspaceUI.targetPanelFor()`, utilisée par les deux |
| Boutons de rubrique sans effet | `bindSideMenu()` posait l'état « menu déjà lié » **avant** le branchement complet, qui n'avait donc jamais lieu | `boot()` branche une seule fois, en entier |
| Boutons inaccessibles sur les pages autres que l'accueil | les écrans étaient rangés dans la grille à deux colonnes au lieu de la zone de contenu | ils sont désormais rattachés à `#m14Content` (+ filet CSS) |
| Volets de commande inactifs | `window.scrollTo` interrompait la navigation dans un environnement sans défilement | appel isolé (`try/catch`) |
| 401 dans la console avant connexion | `member-accounts.js` appelait son API avant l'ouverture de session | garde `body.dataset.wsApp` + écoute de `workspace:session` |
| Déconnexion sans effet possible | le bouton avait quitté l'accueil pour le menu | trois voies de secours, jamais de bouton muet |
| 3 actions figées en vert | couleurs en dur dans `merchant-home.css` | elles suivent le thème (dont un or en Noir-Or) |
| En-tête téléphone sur deux lignes, « Installer l'applica… » tronqué | pas de règle mobile | en-tête sur une ligne, libellé court « Installer » |

## 2. La nouvelle structure, telle qu'elle est livrée

```
┌───────────────────────────┬──────────────────────────────────────────────┐
│  Oymike Tech QR           │  bandeau : Retour · titre de la page          │
│  ─────────────────────    │                                              │
│  Accueil                  │   écran demandé (panneau existant)           │
│  Commandes                │                                              │
│  Scanner                  │                                              │
│  Vue d'ensemble           │                                              │
│  Gestion des tables…      │                                              │
│  Mon équipe            ›  │                                              │
│     Mon équipe – Mes…     │                                              │
│     Points et classement  │                                              │
│  Voir les historiques     │                                              │
│  Paramètres               │                                              │
│  ─────────────────────    │                                              │
│  Se déconnecter           │                                              │
└───────────────────────────┴──────────────────────────────────────────────┘
```

- **Ordinateur (≥ 980 px)** : menu fixe de 272 px, contenu à droite, sous-menu « Mon équipe »
  toujours visible.
- **Téléphone** : le menu devient un **tiroir** ouvert par le bandeau « ☰ Menu », refermé après le
  choix (ou par le fond). Aucune entrée coupée, défilement interne si besoin.
- **Tablette (834 px)** : même tiroir, contenu sur toute la largeur.
- **Trois thèmes** (Vert-Blanc, Noir-Or, Blanc-Bleu) appliqués **au menu et au contenu**, conservés
  après rechargement.

## 3. Où sont passées les anciennes rubriques (rien n'est perdu)

| Avant (barre d'onglets) | Maintenant |
| --- | --- |
| Accueil | Accueil |
| Commandes / Opérations | **Commandes** (hub : vue d'ensemble, commande assistée, commandes) |
| Scanner | **Scanner** |
| Tables | **Gestion des tables et espaces** |
| Équipe / comptes | **Mon équipe ›** (Mes comptes créés · Points et classement) |
| Historiques | **Voir les historiques** |
| Produits, Consignation, Catalogue, Personnalisation, Compte, Apparence, Réglages avancés | **Paramètres ›** (mêmes panneaux, mêmes routes) |
| Vue d'ensemble (chiffres détaillés) | **Vue d'ensemble** |
| Déconnexion (bas de page) | pied du menu (bouton de secours conservé sur l'accueil) |

La barre d'onglets historique est **retirée à l'exécution** (plus deux navigations concurrentes),
mais ses panneaux restent dans le document : aucune fonctionnalité n'a été supprimée.

## 4. Ce qui a été testé, et comment (résultats du 10/10/2026)

| Vérification | Commande | Résultat |
| --- | --- | --- |
| Suite unitaire + intégration complète | `npm test` | **180 réussis, 0 échec, 2 ignorés** (182 tests) |
| Recette de navigation navigateur (desktop 1440 + téléphone 390) | `node tools-m14/recette-navigation.js` | **26 / 26** |
| Recette fonctionnelle par compartiment (création, modification, relecture serveur) | `node tools-m14/recette-compartiments.js` | **16 / 16** |

Détail de la recette par compartiment (aucune vérification « à l'œil » : chaque action est relue
depuis l'API après coup) :

- **Tables** : création depuis le formulaire de l'écran (n° généré), relecture serveur, modification
  (salle + capacité), désactivation, présence dans la liste affichée.
- **Produits** : création, **rechargement complet de la page**, présence dans la liste ; refus d'un
  produit sans nom avec message clair.
- **Mon équipe** : ouverture de la page, présence des deux entrées du sous-menu, lecture des comptes
  depuis le serveur.
- **Autorisations serveur** : un marchand qui tente de créer un QR de table reçoit **403** (la règle
  est appliquée côté API, pas seulement dans l'interface).
- **Commandes** : liste lue depuis le serveur ; écran de commande assistée présent.
- **Historiques / Vue d'ensemble** : données reçues du serveur.
- **Robustesse** : **aucun appel refusé avant connexion**, **aucune erreur JavaScript** pendant tout
  le parcours.

## 5. Les garde-fous ajoutés (tests automatiques)

`test/mission14-structure-menus.test.js` — 10 tests qui empêchent le retour des défauts ci-dessus :

1. coquille « menu + contenu » présente, déconnexion dans le pied du menu ;
2. ordre exact des 8 rubriques et sous-menu permanent ;
3. **aucune perte** : produits, consignation, réglages avancés, catalogue, personnalisation, compte,
   apparence restent dans Paramètres, et leurs panneaux restent dans la page ;
4. une seule règle « vue → panneau », le panneau demandé affiché en premier ;
5. aucun écran orphelin, aucun bouton sans destination, `.tab` sans `data-tab` ignoré ;
6. aucun appel API avant l'ouverture de session ;
7. tiroir mobile : fermé par défaut, refermé après le choix ;
8. les trois thèmes pilotent aussi le menu ;
9. la déconnexion a trois voies de secours ;
10. la feuille de style de la coquille est chargée en dernier.

## 6. Fichiers du colis

| Fichier | Nature |
| --- | --- |
| `public/merchant.html` | coquille (menu latéral, bandeau mobile, pied), sans suppression de panneau |
| `public/merchant-shell-m14.css` | **nouveau** — menu, tiroir, responsive, thèmes |
| `public/workspace-ui.js` | menu unique, `targetPanelFor()`, `boot()` corrigé, rangement des écrans |
| `public/merchant.js` | délégation de la règle « vue → panneau », boutons `.tab` sans `data-tab` ignorés |
| `public/merchant-ops.js` | **nouveau** — hub Commandes (vue d'ensemble, assistée, commandes) |
| `public/table-manager.js` | **nouveau** — tables et salons (déjà chargé par la page depuis M12) |
| `public/member-accounts.js` | **nouveau** — comptes de l'équipe (garde de session ajoutée) |
| `public/merchant-home.css` / `.js` | accueil : actions accordées au thème, déconnexion à trois voies |
| `test/mission14-structure-menus.test.js` | **nouveau** — les 10 garde-fous |
| `test/merchant-ui.test.js`, `test/mission12-*.js`, `test/mission13-*.js` | mis à jour pour la nouvelle structure |
| `tools-m14/recette-navigation.js` | **nouveau** — recette navigateur 26 points |
| `tools-m14/recette-compartiments.js` | **nouveau** — recette fonctionnelle 16 points |
| `tools-m14/captures.js`, `tools-m14/recette.json` | **nouveaux** — captures 1440/834/390, compte de recette |
| `captures/` | 13 captures (ordinateur, tablette, téléphone, 3 thèmes) |

## 7. Points d'honnêteté

- **Non testé ici** : l'installation réelle sur un téléphone physique (prompt PWA), l'envoi de
  notifications push vers un vrai appareil, et la lecture caméra réelle (le navigateur de recette
  n'a pas de caméra). Ces trois points dépendent de l'appareil, pas du code livré ; ils étaient déjà
  hors périmètre des missions précédentes.
- **Une seule base a servi de recette** (PostgreSQL locale, compte `baobab377639`). Les comptes
  d'autres marchands n'ont pas été modifiés.
- Les captures montrent la base de recette : les tables affichées sont celles créées par les tests
  (elles portent des numéros générés). Sur votre base de production, vos vraies tables apparaîtront.
- Le libellé du bouton d'installation sur téléphone est raccourci en « Installer » pour tenir sur une
  ligne ; le texte complet reste dans l'attribut d'accessibilité.

## 8. Retour arrière

Voir `INSTALLATION.md`, section 4 : remettre les 6 fichiers de `sauvegarde-avant-m14/`, vider le
cache du service worker, recharger. **Aucune migration de base n'est nécessaire** : cette mission ne
change ni table, ni colonne, ni donnée.
