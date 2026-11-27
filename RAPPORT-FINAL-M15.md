# RAPPORT FINAL — MISSION 15

**Projet** : Oymike Tech QR
**Date** : 10 octobre 2026
**Portée** : mission 15 du prompt général de refonte (20 sections, ordre imposé)
**Statut global** : **partiel, en progrès contrôlé**. Douze sections sur dix-huit livrables sont
terminées et testées ; six restent ouvertes. Le détail ci-dessous ne déclare opérationnel que ce
qui a été **exécuté et mesuré**.

---

## 1. Ce qui a été livré et testé dans cette étape

### §9 — Apparence globale décidée par le PDG : **terminé, testé**

Nouvel écran **« Apparence des espaces »** dans l'espace Administrateur général
(menu latéral, après « Contrôle des comptes »).

| Élément | Réalité |
|---|---|
| Palette | **9 couleurs** : fond, cartes, menu latéral, texte du menu, texte principal, texte secondaire, boutons/accents, texte des boutons, bordures |
| Polices | **6** : système, Inter, Georgia, Trebuchet MS, Verdana, chasse fixe |
| Taille de base | **14 à 20 px** (curseur) |
| Graisse | 300 à 700 |
| Interligne | 1,3 à 1,9 |
| Arrondi | 8 à 24 px |
| Aperçu | **direct**, aux mêmes variables CSS que les espaces réels (menu, cartes, boutons, prix, pastilles) |
| Lisibilité | les **5 paires de texte** sont contrôlées en direct ; sous **4,5:1** (WCAG AA) l'enregistrement est **refusé** côté navigateur **et** côté serveur (`400 CONTRAST_TOO_LOW`) |
| Diffusion | case « Appliquer à tous les espaces » + choix **imposé** / **proposé** |
| Retour aux valeurs d'origine | bouton **« Revenir aux valeurs d'origine »** → `POST /api/admin/control/interface-custom/reset` |
| Traçabilité | chaque enregistrement et chaque remise à zéro sont journalisés (`interface_appearance_updated`, `interface_appearance_reset`) |

**Propagation vérifiée de bout en bout** : après enregistrement, l'espace marchand reçoit
`data-interface-custom="imposed"`, le menu passe à la couleur choisie, la police et la taille
s'appliquent (`--ui-base-size`), et le retour aux valeurs d'origine rend immédiatement le thème
standard.

**Défaut corrigé au passage** : le texte du menu lisait une variable jamais transmise
(`--ws-sidebar-text`) ; il suit désormais la couleur « Texte du menu »
(`--ui-sidebar-text`). Sans cette correction, un menu sombre choisi par le PDG pouvait afficher
un texte illisible malgré le contrôle de contraste.

### §14 — Zéro 404, zéro bouton mort : **terminé, testé**

Audit automatisé de 10 pages (PDG, marchand, équipe, gestionnaire, fournisseur, contrôle
marchands, sourcing, découverte, suivi de commande, page introuvable) : chaque lien interne est
appelé réellement, chaque page est chargée dans un navigateur.

| Constat initial | Correction |
|---|---|
| `/staff/` renvoyait **404** alors que la page existe | redirection **301** vers `/staff.html` (aucune nouvelle URL, aucun paramètre modifié) |
| Accueil marchand : lien « Voir toutes mes tables… » en `href="#"` | ancré sur son panneau réel (`#panel-tables`) |
| Marchand : « Ouvrir le lien public » en `href="#"` quand aucun QR n'existe | plus aucune destination tant que l'URL réelle n'est pas connue |
| Fournisseur : lien « Profil QR » pointant vers `/v/` (**404**) | lien masqué tant qu'aucune adresse publique réelle n'existe |

**Résultat final** : `404/500 : aucun` · `liens morts : aucun` · `erreurs JS : aucune`.

### §17 — Tests obligatoires par rôle : **terminé, testé**

Nouvelle recette `tools-m15/recette-roles.js` : **70/70 vérifications** sur **5 rôles**, avec
connexion réelle dans un navigateur.

| Rôle | Connexion | Espace | Menu | Cloisonnement | Erreurs |
|---|---|---|---|---|---|
| Administrateur général | 200 | ouvert | 7 entrées, 7 panneaux | données PDG accessibles à lui seul | aucune |
| Marchand | 200 (ou 409 = verrou §10) | ouvert | 8 entrées, 8 panneaux | aucune entrée PDG | aucune |
| Gestionnaire | 200 | ouvert | navigation réelle | `/api/admin/*` → **403** | aucune |
| Serveuse | 200 | ouvert | navigation réelle | `/api/merchant/team/members`, `/api/manager/points` → **404** ; `/api/admin/*` → **401** | aucune |
| Fournisseur | 200 | ouvert | **6/6 vues** | les 4 API des autres rôles → **401/404** | aucune |

Le cloisonnement est vérifié **côté serveur** (codes HTTP), pas seulement à l'écran : masquer un
bouton ne suffit pas.

### §8 / maquette — Refonte de l'espace fournisseur : **terminé, testé**

Le fournisseur était la seule des six espaces sans menu latéral. Il reprend désormais la
structure de la maquette : en-tête fixe (identité + Profil QR + Déconnexion), **menu latéral
sombre à gauche** (6 entrées, entrée active surlignée), **contenu à droite**. Aucune fonction
retirée ; mêmes boutons, même ordre. Vérifié en **1440×900** et **390×844** (menu horizontal
replié, aucun débordement latéral), navigation **6/6**.

---

## 2. Non-régression de la mission 14 : **vérifié**

| Contrôle | Résultat |
|---|---|
| `npm test` (suite complète) | **191 tests · 189 pass · 0 échec · 2 ignorés** |
| Recette de navigation marchand (M14) | **26/26** |
| Recette des compartiments marchand (M14) | **16/16** |
| Audit 404 / liens morts / erreurs JS | **aucun** |

Deux échecs apparus en début d'étape ont été diagnostiqués : « Mon équipe » ouvre désormais
directement son écran de travail, alors que les recettes attendaient encore l'ancienne page de
choix. Les assertions ont été réalignées sur le comportement voulu ; le bouton « Télécharger
l'application » n'était pas en cause.

**Nouveaux tests ajoutés** : `test/mission15-apparence-pdg.test.js` (**9 tests**) — plages de
valeurs, rejet des valeurs inconnues, refus de contraste, publication des variables CSS, câblage
réel de l'écran (menu, panneau, script, montage) et routes serveur.

---

## 3. Ce qui n'est PAS fait (à ne pas considérer comme livré)

| Section | État | Reste à faire |
|---|---|---|
| §16 — hiérarchie PDG > gestionnaires > marchands > gérants > serveuses > fournisseurs | **partiel** | la hiérarchie est respectée dans les accès (§17 le prouve), mais aucun écran dédié ne la présente |
| §18 — sauvegarde avant modification, retour arrière | **partiel** | le colis contient l'état complet des fichiers modifiés ; pas encore de sauvegarde automatique horodatée + procédure de retour arrière documentée pas à pas |
| §2 / §3 — refonte des 5 autres espaces | **en cours** | PDG et fournisseur traités ici ; gestionnaire, équipe et contrôle marchands sont fonctionnels mais gardent leur coquille d'origine |
| §4 / §5 / §6 / §7 | **livré et testé en amont** | voir rapport M14 ; non modifié dans cette étape |
| §10 / §11 / §12 / §13 | **livré et testé en amont** | non modifié dans cette étape |
| §15 — connexions réelles à la base | **vérifié sur les parcours testés** | aucune vérification exhaustive table par table |
| §20 — colis unique | **livré** | ce colis ; aucun second lot prévu |

**Aucune de ces lignes n'est déclarée opérationnelle.**

---

## 4. Défauts connus, observés pendant les tests

1. **Vérification d'un gestionnaire par le PDG** — `PUT /api/admin/managers/:id` exige un
   identifiant même quand on ne modifie qu'un nom : le message renvoyé parle de l'identifiant,
   pas du champ réellement fautif. L'écran fonctionne quand le formulaire est complet ; l'API
   mérite un correctif.
2. **Permissions d'un gestionnaire** — `PATCH /api/admin/managers/:id` répond **404** : l'écran
   enregistre les permissions par un autre chemin, mais la route annoncée n'existe pas. À
   trancher (créer la route ou retirer l'appel).
3. **Limiteur de connexion fournisseur** — 8 tentatives pour 10 minutes par IP et par
   identifiant : les recettes répétées doivent redémarrer le serveur. Comportement voulu, mais à
   connaître avant une campagne de tests.
4. **QR fournisseur** — l'adresse affichée sous le QR reprend l'hôte de la requête
   (`http://127.0.0.1:3720/v/…`). En production elle dépend de la configuration existante de
   liens publics ; **aucune variable d'environnement n'a été modifiée**.

---

## 5. Fichiers de ce colis

Colis **complet**, 538 fichiers contrôlés, SHA-256 de chaque fichier dans `SHA256.txt` :

- `public/` — 122 fichiers (pages et scripts servis) ;
- `test/` — 50 fichiers de tests (`node --test`) ;
- `tools-m14/`, `tools-m15/` — recettes navigateur (navigation, compartiments, rôles) ;
- `captures/` — 9 captures réelles des écrans testés ;
- racine — application serveur complète, schémas SQL, `package.json` / `package-lock.json` ;
- `data/` — jeu de démonstration local (à ne pas copier tel quel en production).

**Vérifications faites sur une copie propre du colis** (archive décompressée, hors environnement
de développement) :

| Contrôle | Résultat |
|---|---|
| `sha256sum -c SHA256.txt` | **538 fichiers conformes** |
| `npm test` | **191 tests · 189 pass · 0 échec · 2 ignorés** |
| Démarrage (`npm start`, autre port) | **200** sur `/`, `/supplier/`, `/admin-appearance-custom.js` ; `/staff/` → **301** |

Voir `INSTALLATION.md` pour la mise en place et `LIRE-MOI.md` pour le résumé lisible.
