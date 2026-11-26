# Oymike Tech — Mission 10

## Refonte de l'architecture QR et simplification des espaces marchands

**Date :** 10 octobre 2026 (mesures du 26 novembre 2026 sur l'environnement de développement)
**Périmètre livré dans cette étape :** espaces marchand et équipe (gérant général, serveuse, serveur), réglage des tailles de texte par le PDG, chargement plus rapide, application installable.
**Méthode :** audit de l'existant → réorganisation sans suppression → mesures avant/après.

---

## 1. Ce qui a été audité (avant de coder)

| Élément audité | Constat |
|---|---|
| `public/merchant.html` | 15 onglets à plat, tous au même niveau, aucun mis en avant. Les commandes arrivaient en 8ᵉ position. |
| `public/staff.html` | 12 onglets à plat ; la serveuse devait faire défiler horizontalement pour trouver le scanner. |
| `public/merchant.js` (`loadStore`, `loadAppData`) | **Cascade** : boutique → produits + statistiques + notifications, avant tout affichage. Quatre allers-retours en série. |
| `public/merchant-ops.js` | À l'ouverture de l'onglet Opérations : 100 lignes de traçabilité + tous les points. |
| Poids réel de l'espace marchand | **993 934 octets** et 29 requêtes, dont `jsQR` (257 Ko) et `qrcode` (57 Ko) téléchargés même sans jamais scanner. |
| Logos d'en-tête | `oymike-512.png` (143 Ko) affiché dans un carré de 36 px. |
| Typographie | Le PDG ne réglait que la **boutique publique** (12 familles, 16–30 px). Aucun réglage pour les espaces de travail. |
| PWA | Boutons d'installation présents sur `/` et `/manager`, **absents** de `/merchant` et `/equipe`. |
| Temps réel | Événement serveur reçu, mais les cartes n'existaient pas ; il fallait actualiser pour voir une commande arriver. |

---

## 2. Ce qui a changé, écran par écran

### 2.1 Les trois actions de terrain, en premier plan

À la connexion, le marchand voit trois grandes tuiles : **Vue d'ensemble**, **Commandes** (verte, avec le nombre de commandes à traiter), **Scanner** (noire). Le gérant et la serveuse voient **Commandes**, **Scanner**, **Mes activités**.

### 2.2 Navigation regroupée, rien de supprimé

- **Marchand : 7 rubriques** — Accueil, Commandes, Scanner, Établissement, Équipe, Finances, Paramètres.
- **Équipe : 5 rubriques** — Accueil, Commandes, Mes activités, Établissement, Compte.

Chaque rubrique ouvre un sommaire court ; chaque outil historique est joignable en un clic. Les 15 onglets du marchand et les 12 de l'équipe existent toujours : ils sont rangés, pas retirés. Une étoile ★ **met une rubrique en exergue** (elle remonte en tête du menu) et ce choix est conservé sur l'appareil. Accueil, Commandes et Scanner ne peuvent pas être masqués.

### 2.3 Cartes de commandes

Numéro, client, table/espace, heure, articles avec quantités, montant, statut. Les nouvelles commandes ont un liseré orange et l'étiquette « Nouvelle ». Filtres comptés en direct : **Nouvelles / En préparation / Prêtes / Terminées / Annulées**. Action principale directement sur la carte (« Confirmer », « Préparer », « Prête », « Terminer ») : la confirmation et le motif obligatoire restent ceux du serveur. La liste détaillée, la recherche et les restrictions clients sont repliées sous un seul bloc.

### 2.4 Écran Scanner

Caméra arrière ouverte à la demande explicite (permission demandée à ce moment-là uniquement), message clair en cas de QR invalide ou d'appartenance à une autre boutique, saisie manuelle de secours, et raccourci vers la prise de commande une fois la table reconnue. Même route serveur que le scanner existant : aucune règle de permission n'a été dupliquée.

### 2.5 Tailles de texte réglées par le PDG

Nouveau panneau **Réglages → Espaces de travail** : 8 tailles (titres, sous-titres, textes, menus/libellés, boutons, noms de produits, prix, infos de commande), bornées à **14–30 px**, avec **aperçu en direct** d'une vraie carte de commande, bouton **Enregistrer** et bouton **Réinitialiser**.

- La valeur globale s'applique à **tous** les établissements.
- Une **exception par établissement** est possible, et peut être retirée.
- Les tailles sont conservées en base (`app_settings`, clé `merchantInterface`) : elles survivent à la déconnexion et à l'actualisation.
- Elles sont transmises avec la session (`/api/merchant/auth/me`, `/api/staff/me`), donc appliquées dès la première image.
- **Aucune permission n'est lue ni écrite** par ce réglage : c'est un réglage de présentation, et un test le vérifie.

### 2.6 Installation sur le téléphone

Bouton « Installer l'application » ajouté dans l'espace **marchand** (déjà présent) et dans l'espace **équipe** (nouveau), avec les libellés « Marchand » et « Équipe ». Sur Android la fenêtre native s'ouvre ; sur iPhone les quatre étapes « Partager → Sur l'écran d'accueil » sont affichées. Le bouton disparaît si l'application est déjà installée.

### 2.7 Chargement plus rapide

- L'écran s'affiche **avant** les données : les quatre appels partent ensemble au lieu de s'enchaîner.
- Les décodeurs QR (`jsQR` 257 Ko, `qrcode` 57 Ko) ne sont plus téléchargés à l'ouverture : ils le sont au premier scan ou au premier affichage de QR.
- Le logo d'en-tête est servi en 180 px au lieu de 512 px.
- La traçabilité des commandes charge 40 lignes au lieu de 100.
- Les tuiles d'accueil s'effacent hors de l'accueil : le premier écran utile commence plus haut.
- Le menu tient en deux lignes sur téléphone : aucune rubrique hors écran.

---

## 3. Mesures avant / après

Mesures sur le serveur de développement, en **3G lente simulée** (400 kbit/s, 400 ms de latence, profil « Slow 3G » de Chrome) et à chaud.

### Poids téléchargé à l'ouverture

| Espace | Avant | Après | Écart |
|---|---|---|---|
| `/merchant/` | **993 934 o** · 29 requêtes | **569 729 o** · 28 requêtes | **− 424 205 o (− 42,7 %)** |
| `/equipe/` | 244 010 o · 17 requêtes | 244 010 o · 17 requêtes | inchangé (voir note) |

Note : l'espace équipe ne chargeait déjà `jsQR` qu'à l'ouverture de la caméra ; le gain y porte sur la navigation et l'affichage, pas sur le poids.

### Temps jusqu'à l'affichage du document (3G lente)

| Espace | Avant | Après | Écart |
|---|---|---|---|
| `/merchant/` | 19 953 ms | **11 678 ms** | **− 8,3 s (− 41,5 %)** |
| `/equipe/` | 5 108 ms | 5 169 ms | stable (marge de mesure) |

### Réponses serveur (à chaud, réseau local)

| URL | Avant | Après |
|---|---|---|
| `/merchant/` | 7 ms · 69 258 o | 7 ms · 74 088 o |
| `/equipe/` | 5 ms · 13 443 o | 5 ms · 13 443 o |
| `/api/health` | 2 ms | 2 ms |
| `/r/:code` | 547 ms à froid | inchangé (non modifié dans cette étape) |

Le HTML marchand grossit de ~4,8 Ko (tuiles, menu, écran Scanner) mais le téléchargement total baisse de 42,7 % : le gain vient des 314 Ko de décodeurs qui ne sont plus systématiques.

---

## 4. Vérifications exécutées

| Vérification | Résultat |
|---|---|
| Suite unitaire complète (`node --test`) | **141 réussis, 0 échec, 1 ignoré** (6 nouveaux tests de réglage de polices) |
| `tools/t-ui-m7.js` — consignation équipe/PDG, permissions serveuse | **tout est conforme** (15 contrôles) |
| `tools/ui-test-6.js` — parcours marchand + équipe + PDG | 7 écrans, **0 erreur JavaScript** |
| Parcours Playwright mission 10 (commandes, scan, tailles PDG) | **0 erreur JavaScript**, cartes et compteurs exacts |
| Exception de tailles par établissement | valeur d'établissement appliquée (`source: store`), permissions inchangées |
| Bornes de tailles | 99 px → 30 px, 2 px → 14 px (bornage serveur) |
| PWA (13 tests existants) | **13/13** |

---

## 5. Ce qui reste à faire (étapes suivantes)

1. **Scan client ultra-rapide** (`/r/:code` : 547 ms à froid) — non modifié dans cette étape, mesure de référence conservée.
2. **Deux parcours d'inscription tracés en base** — le code terrain et l'inscription autonome existent déjà ; il reste la traçabilité explicite du gestionnaire associé et de la notification PDG.
3. **Contrôle PDG de l'organisation des rubriques et de la visibilité par rôle** — le socle de réglages existe (`merchantInterface`) ; les tailles sont livrées, l'ordre des rubriques et la mise en avant restent à exposer.
4. **Tests physiques** téléphone / tablette / ordinateur, dont iPhone réel pour la notice d'installation.

Aucune fonctionnalité métier n'a été supprimée ; les permissions réelles n'ont pas été modifiées.
