# OYMIKE MISSION 13 — Accueil marchand conforme à la maquette

**Date :** 10 octobre 2026
**Objet :** la page d'accueil de l'espace marchand s'affiche désormais **comme la maquette envoyée**
(en-tête + thème, trois grandes actions, « Activité en cours », scanner, tables, équipe,
thèmes, service), avec **des données réelles et tous les boutons fonctionnels**.
**Type de livraison :** colis **delta** (uniquement les fichiers changés). Aucune donnée, aucun
compte, aucun QR, aucune permission n'est supprimé.

---

## 1. Ce qui a été fait, exactement

| Zone de la maquette | Ce qui s'affiche maintenant | D'où viennent les données |
| --- | --- | --- |
| Photo/logo + nom + type d'activité | Photo de la boutique si elle existe, sinon ses initiales ; nom réel ; « Maquis · Bar · Restaurant » selon le secteur déclaré | `/api/merchant/store` |
| Thème : 3 pastilles + roue crantée | Le thème se choisit **depuis l'accueil** : un clic sur une pastille applique et enregistre ; la roue crantée ouvre la page Apparence complète | `PUT /api/merchant/appearance` |
| Commandes / Scanner / Vue d'ensemble | Trois grandes cartes cliquables ; elles ouvrent les écrans **déjà validés** | navigation interne |
| Activité en cours (4 chiffres) | Nouvelles commandes, en cours, terminées, tables occupées — chiffres **du serveur**, rafraîchis à chaque retour sur l'accueil | `/api/overview` |
| 1 · Scanner QR Code | La caméra s'ouvre **dans la page**, aperçu visible, lecture automatique ; aucune photo, aucune vidéo ; saisie manuelle en secours | `QrCamera` + `/api/merchant/assisted-orders/scan` |
| 2 · Gestion des tables et espaces | Bouton « Ajouter une table », liste des **vraies** tables avec leur état (Disponible / Occupée), crayon qui ouvre la modification | `/api/merchant/table-management` |
| 3 · Mon équipe – Mes comptes créés | Compteurs Gérants / Serveuses, liste des comptes réels, statut, crayon (fiche complète), corbeille (suspendre / réactiver) | `/api/merchant/member-accounts` |
| 4 · Thèmes personnalisables | Trois aperçus fidèles, sélection puis « Appliquer », message de confirmation, retour arrière si l'enregistrement échoue | `/api/merchant/appearance` |
| Un service simple et efficace | Rappel des quatre points + signature Oymike Tech QR | statique (texte de la maquette) |
| Se déconnecter | En bas de page, pleine largeur, avec la confirmation habituelle | même route que le menu |

**Aucune donnée de démonstration n'est écrite dans le code.** Les valeurs de la maquette
(5, 12, 28, 8/10, « Chez Gbaziké », « M. Diallo ») ne figurent nulle part dans les fichiers livrés :
un test automatique le vérifie (test n° 2).

## 2. Ce qui a changé dans les fichiers

| Fichier | Nature du changement |
| --- | --- |
| `public/merchant.html` | Nouveau bloc d'accueil (`#merchantHomeShell`) avec les quatre zones ; barre permanente et menu remontés en haut de la zone de travail ; bouton « Se déconnecter » en bas de page |
| `public/merchant-home.css` | **Nouveau** — mise en page de la maquette (deux colonnes sur ordinateur, empilée sur téléphone), compatible avec les trois thèmes |
| `public/merchant-home.js` | **Nouveau** — chargement des données réelles, branchement de tous les boutons, scanner intégré, choix du thème, suspendre/réactiver un compte |
| `public/workspace-ui.js` | L'accueil n'est plus affiché par-dessus les autres pages (une seule vue à l'écran) ; la barre permanente et le menu restent visibles ; « Vue d'ensemble » ouvre l'écran détaillé |
| `public/workspace.css` | La zone « Bonjour … » n'apparaît plus sur l'accueil (la maquette la remplace) |
| `public/merchant.js` | « Vue d'ensemble » et le panneau détaillé correspondent désormais à un vrai panneau ; l'accueil marchand n'est pas réouvert sous la maquette ; la lecture d'un QR publie son résultat |
| `public/merchant/sw.js` | Version de cache **v7** + mise en cache de `merchant-home.js` et `merchant-home.css` |
| `public/icons/oymike-brand/salon-illustration.svg` | **Nouveau** — vignette « salle de restaurant » identique sur tous les appareils, sans réseau |
| `tests/mission13-accueil-marchand.test.js` | **Nouveau** — 10 garde-fous (voir § 5) |
| `tests/mission12-tables-comptes.test.js` | Le contrôle de version du cache accepte désormais la v7 (il exigeait v6) |

## 3. Les boutons — ce qu'ils font réellement

| Bouton | Effet vérifié |
| --- | --- |
| **Commandes** | Ouvre la liste des commandes (cartes + filtres) |
| **Scanner** | Ouvre l'écran Scanner (caméra arrière immédiate) |
| **Vue d'ensemble** | Ouvre l'écran détaillé : chiffres, dernières commandes, produits populaires, courbe 7 jours |
| Cellule « Nouvelles commandes » | Ouvre les commandes **déjà filtrées** sur « Nouvelles » |
| Cellule « En cours » / « Terminées » | Ouvre les commandes filtrées sur l'étape correspondante |
| Cellule « Tables occupées » | Ouvre la gestion des tables |
| « Voir plus → » | Ouvre les commandes |
| « Ouvrir la caméra » | Ouvre la caméra dans la carte (aperçu réel) |
| « Arrêter la caméra » | Coupe la caméra et libère l'objectif |
| « Choisir la table dans la liste » | Ouvre la commande assistée avec le choix de table |
| « Saisir le code à la main » | Affiche le champ de secours (code écrit sous le QR) |
| « ＋ Ajouter une table » | Ouvre la gestion des tables **et** son formulaire d'ajout |
| Crayon d'une table | Ouvre la modification du numéro / nom / salon de cette table |
| « Voir toutes mes tables et leurs QR » | Ouvre la page complète (QR, libres/occupées, salons) |
| « ＋ Créer un compte » | Ouvre « Mon équipe » **et** le formulaire de création |
| Crayon d'un membre | Ouvre sa fiche : téléphone, tables, permissions, mot de passe, historique |
| Corbeille d'un membre | Suspend ou réactive l'accès, après confirmation (sessions coupées) |
| Pastilles de thème | Appliquent et enregistrent le thème immédiatement |
| Roue crantée | Ouvre la page « Apparence de mon interface » |
| « Appliquer » (thèmes) | Enregistre le thème choisi et affiche un message de confirmation |
| « Se déconnecter » | Demande confirmation puis ferme la session |

## 4. Ce qui a été vérifié, et comment

### 4.1 Tests automatiques (serveur de test, PostgreSQL local)

- `npm test` → **170 réussis, 0 échec, 2 ignorés** (160 avant cette mission + 10 nouveaux garde-fous).
- `tests/mission13-accueil-marchand.test.js` → **10/10**.

### 4.2 Parcours réel dans un navigateur (émulation, pas un appareil physique)

Parcours automatisé : **46 vérifications, 46 réussies**, sur un profil téléphone (Pixel 7, 412 × 915)
avec caméra simulée, plus captures sur ordinateur 1360 px.

- connexion → accueil affiché, ancien panneau masqué, **aucune erreur JavaScript** ;
- **9 rubriques** du menu présentes ; barre permanente masquée sur l'accueil (les trois grandes
  cartes font le même travail) et **réaffichée** sur toutes les autres pages ;
- Commandes / Scanner / Vue d'ensemble : chaque clic ouvre bien l'écran attendu, et le retour
  « Accueil » ramène la maquette ;
- cellule « Nouvelles commandes » → liste filtrée ; « ＋ Ajouter une table » → formulaire ouvert ;
  crayon d'une table → édition ouverte ; « ＋ Créer un compte » → formulaire ouvert ;
  crayon d'un membre → fiche ouverte ;
- thème Noir-Or : aperçu immédiat, puis « Appliquer » → message « Thème … appliqué et enregistré » ;
  retour au thème vert enregistré ; pastille de l'en-tête → thème bleu appliqué ;
- caméra : aperçu réel affiché dans la carte, bouton « Arrêter » présent, caméra bien coupée ensuite ;
- code invalide saisi à la main → **message d'erreur explicite**, aucun changement d'écran ;
- déconnexion → confirmation → annulation → l'espace reste ouvert ;
- les huit autres rubriques (Commandes, Scanner, Historiques, Tables, Établissement, Équipe,
  Finances, Réglages) ouvrent chacune un écran non vide.

### 4.3 Parcours scanner de bout en bout (caméra simulée)

Avec une vidéo de test contenant **le QR réel d'une table** de la boutique de démonstration :
la caméra s'ouvre, le QR est lu **automatiquement en moins d'une seconde**, et l'application
ouvre la **commande assistée** avec la table reconnue (voir captures `02` et `03`).

### 4.4 Espace serveuse

`test-staff-scan.js` : connexion serveuse, lecture automatique d'un QR de table → commande
ouverte sur « Table 1 », **aucune erreur JavaScript**. L'espace serveuse n'a pas été modifié.

## 5. Les 10 garde-fous ajoutés (tests)

1. Les quatre zones de la maquette et les trois actions existent.
2. Aucun chiffre ni nom de démonstration n'est codé en dur ; les cinq sources réelles sont appelées.
3. L'accueil ne crée **ni table, ni salon, ni membre** lui-même (pas de seconde gestion).
4. L'ancien accueil est conservé dans le document mais ne se superpose plus.
5. Le scanner réutilise le moteur existant, sans `MediaRecorder`, sans photo, sans capture d'écran.
6. Un seul branchement d'écouteurs (pas de caméra ouverte deux fois).
7. Le thème est enregistré sur le serveur, pas seulement dans le navigateur.
8. Aucun bouton de l'accueil sans action identifiée ; chaque destination est traitée.
9. La mise en page passe bien en colonnes empilées sur téléphone.
10. Le cache du service worker est versionné (v7) et contient les nouveaux fichiers.

## 6. Points d'honnêteté

- Les captures ont été prises en **émulation de navigateur** (Chromium), avec une **caméra
  simulée**. Ce n'est pas un test sur un iPhone ou un Android physique.
- La photo d'en-tête vient de la boutique **si elle en a une**. Sur une boutique sans photo,
  l'accueil affiche ses **initiales** dans un rond vert (aucune image inventée).
- Les trois vignettes illustratives de la maquette (téléphone scannant un QR, salle de restaurant)
  sont remplacées par : la **caméra réelle** pour le scanner, et un **dessin de salle** livré avec
  l'application pour les tables. Une photo de la boutique remplace le dessin dès qu'elle existe.
- Le texte « Un service simple et efficace » reprend celui de la maquette ; il ne prétend pas
  mesurer quoi que ce soit.
- Sur une boutique **sans commande**, les quatre chiffres affichent 0 : c'est correct, ils ne sont
  pas maquillés.

## 7. Contenu du colis

```
OYMIKE-MISSION13/
├── LIRE-MOI.md                      ← ce document
├── INSTALLATION.md                  ← où copier chaque fichier, et comment revenir en arrière
├── public/
│   ├── merchant.html                (remplace)
│   ├── merchant-home.js             (nouveau)
│   ├── merchant-home.css            (nouveau)
│   ├── merchant.js                  (remplace)
│   ├── workspace-ui.js              (remplace)
│   ├── workspace.css                (remplace)
│   ├── merchant/sw.js               (remplace)
│   └── icons/oymike-brand/salon-illustration.svg  (nouveau)
├── tests/
│   ├── mission13-accueil-marchand.test.js  (nouveau)
│   └── mission12-tables-comptes.test.js    (remplace)
├── captures/                        ← 15 images (ordinateur + téléphone)
└── SHA256.txt                       ← empreintes de chaque fichier + empreinte du zip
```

**Archive :** `OYMIKE-MISSION13-COLIS-DELTA-2026-10-10.zip` (3,9 Mo, 35 fichiers)
**SHA-256 du zip :** indiqué dans `SHA256.txt` (dernière ligne, à côté du nom de l’archive)

## 8. Captures fournies

| Fichier | Ce qu'on y voit |
| --- | --- |
| `01-accueil-ordinateur.png` | L'accueil complet, ordinateur, avec des données réelles |
| `02-scanner-camera-ouverte.png` | La caméra ouverte **dans la carte**, aperçu et boutons |
| `03-scanner-aboutit-commande.png` | Après lecture automatique : la commande assistée s'ouvre |
| `04-theme-noir-or.png` | Le même accueil en thème Noir-Or |
| `05-theme-blanc-bleu.png` | Le même accueil en thème Blanc-Bleu |
| `06-vue-ensemble.png` | L'écran « Vue d'ensemble » détaillé (bouton bleu) |
| `07-commandes.png` | L'écran Commandes ouvert depuis la grande carte |
| `08-table-edition.png` | Le crayon d'une table a ouvert sa modification |
| `09-equipe-creation.png` | « Créer un compte » a ouvert le formulaire de Mon équipe |
| `10-accueil-telephone-1…5.png` | L'accueil sur téléphone, du haut jusqu'à la déconnexion |
| `11-scanner-telephone.png` | La carte Scanner sur téléphone, caméra ouverte |
