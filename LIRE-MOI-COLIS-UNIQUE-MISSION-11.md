# OYMIKE — Mission 11 : colis unique (S1 + S2 + S3), allégé

**Date** : 10 octobre 2026
**Contenu** : uniquement les fichiers modifiés par la mission (12 fichiers) + 12 captures d'écran.
**Ce colis ne contient AUCUNE donnée, AUCUN compte, AUCUN QR code, AUCUNE configuration.**

> ⚠️ **Si vous ne voyez encore aucun changement, c'est que ce colis n'a pas été posé.**
> Les fichiers ci-dessous doivent **remplacer** ceux de votre installation (même arborescence),
> puis le serveur doit être **redémarré** et le navigateur **rechargé sans cache**
> (sur téléphone : fermer l'onglet et rouvrir, ou « vider le cache »).
> Preuve : écran 01 (menu en bas avec « Se déconnecter ») et écran 04 (trois thèmes) —
> ces deux écrans n'existaient pas avant.

---

## 1. Ce que vous verrez à l'écran (captures `captures/`)

| Capture | Ce que ça prouve |
|---|---|
| `01-accueil-marchand.png` | Accueil réorganisé : barre **Commandes / Scanner / Vue d'ensemble** toujours visible, menu de rubriques, **« Se déconnecter » en bas du menu avec icône** |
| `02-menu-et-deconnexion-bas.png` | Le menu complet et sa dernière entrée |
| `03-reglages-rubriques.png` | Les pages sont devenues des **rubriques cliquables** (Apparence, Mon compte, Ma boutique, Notifications, Voir les historiques) |
| `04-apparence-trois-themes.png` | **Trois thèmes** visibles d'un coup d'œil (Vert et blanc / Noir et or / Blanc et bleu) avec aperçu, l'écran s'ouvre **directement sur le choix** |
| `05-apparence-apercu-noir-or.png` | Aperçu du thème avant de l'appliquer |
| `06-accueil-noir-or.png` | Thème **Noir et or** réellement appliqué à toute l'interface (fond, menus, cartes, boutons) |
| `07-accueil-blanc-bleu.png` | Thème **Blanc et bleu** réellement appliqué |
| `08-commandes.png` | Commandes, sans perte des fonctions existantes |
| `09-historiques.png` | « Voir les historiques » |
| `10-scanner.png` | Écran Scanner (caméra arrière + saisie manuelle) |
| `11-equipe-deconnexion.png` | Espace serveuse/serveur : « Se déconnecter » **en bas du menu** + **confirmation** |
| `12-equipe-noir-or.png` | Le thème choisi par le marchand s'applique aussi à l'espace équipe |

---

## 2. Les 12 fichiers du changement

```
public/workspace.css          (mis à jour)  présentation des espaces, bouton déconnexion, menu qui s'enroule
public/workspace-ui.js        (mis à jour)  rubriques, hub, apparence (défilement direct vers les 3 thèmes)
public/workspace-shell.js     (mis à jour)  thème, confirmation de déconnexion, bouton Retour, historique
public/interface-themes.css   (mis à jour)  couverture complète des 3 thèmes (cartes, tableaux, formulaires…)
public/merchant.html          (mis à jour)  accueil : menu, 3 tuiles, vue d'ensemble, bouton déconnexion icône+texte
public/merchant.js            (mis à jour)  déconnexion confirmée
public/staff.html             (mis à jour)  bouton déconnexion icône+texte (espace équipe)
public/staff.js               (mis à jour)  déconnexion confirmée
public/staff-workspace.js     (mis à jour)  menu équipe : « Se déconnecter » en dernier + confirmation
public/manager.html           (mis à jour)  espace gérant : icône de déconnexion + feuille de thèmes
public/manager.js             (mis à jour)  déconnexion confirmée côté gérant
test/merchant-ui.test.js      (mis à jour)  le test vérifie désormais la confirmation de déconnexion
```

**Aucun fichier supprimé. Aucune table, aucune colonne, aucune permission modifiée.**

> Les fonctionnalités des sous-prompts 2 (équipes, comptes, quotas, codes à 6 chiffres) et
> 3 (scanner caméra, historiques par rôle, traçabilité, vue d'ensemble) sont **déjà dans les
> fichiers ci-dessus** : `workspace-ui.js`, `staff-workspace.js`, `merchant.js` les affichent.
> Si vous aviez déjà posé les colis S2/S3, ce colis les **remplace à l'identique, en plus récent**.

---

## 3. Pose du colis (3 minutes)

1. **Sauvegarde** : copiez votre dossier actuel (au minimum `public/` et `data/`) quelque part.
2. **Copie** : dézippez ce colis **à la racine** de l'application (là où se trouvent `public/`
   et `test/`), en acceptant le remplacement des fichiers.
   - Vous devez obtenir : `<application>/public/workspace-ui.js`, `<application>/public/merchant.html`, etc.
   - ⚠️ Si le zip a été dézippé dans un sous-dossier (`colis-final/public/...`), déplacez le
     contenu d'un niveau pour que `public/` soit bien à la racine.
3. **Redémarrage** : arrêtez puis relancez le serveur.
4. **Vérification immédiate** (10 secondes) : ouvrez `/merchant`, connectez-vous.
   - Le menu doit afficher **Accueil, Commandes, Scanner, Historiques, Établissement, Équipe,
     Finances, Réglages** puis, **en bas, sur sa propre ligne : « Se déconnecter »**.
   - Cliquez dessus : une fenêtre **« Se déconnecter ? »** doit s'ouvrir avec
     « Rester connecté » / « Se déconnecter ».
   - Allez dans **Réglages → Apparence de mon interface** : l'écran doit s'ouvrir
     **directement sur les trois thèmes**. Touchez « Noir et or » puis **Appliquer** : toute
     l'interface devient noire et or (écran 06). Rechargez : le thème est conservé.

Si l'un de ces quatre points manque, le fichier n'a pas été remplacé : recommencez l'étape 2.

---

## 4. Ce qui a été réellement vérifié (et ce qui ne l'est pas)

**Vérifié sur l'application en marche** (serveur local, PostgreSQL de test, émulation mobile
390 × 844, Chromium) :

- les 8 rubriques s'ouvrent une par une, **un seul panneau affiché** à chaque fois, fil d'Ariane correct, **0 erreur JavaScript** ;
- les cartes des rubriques naviguent réellement (`data-hub-tab` présent, clic → bon panneau) ;
- **« Se déconnecter » est la dernière entrée du menu** (marchand et équipe) et déclenche une **confirmation** ; « Rester connecté » conserve la session ;
- **le thème est enregistré côté serveur** : après rechargement dans un nouveau navigateur, l'interface revient en Noir et or (`data-interface-theme="black-gold"`, fond `rgb(17,18,20)`) ;
- **aucune zone blanche résiduelle** en thème sombre sur l'accueil, les commandes, les historiques et les réglages (contrôle automatique : 0 élément blanc de plus de 24 px) ;
- **la grille des trois thèmes est visible dès l'ouverture** de l'écran Apparence (elle était auparavant ~600 px sous le pli, ce qui donnait l'impression que rien ne changeait) ;
- **tests automatisés : 151 réussis, 0 échec, 2 ignorés** (dont le test de l'interface marchande mis à jour pour la confirmation).

**Non vérifié, et je le dis clairement :**

- **émulation mobile, pas un iPhone/Android physique** : les tailles, le clavier et le rendu
  exacts peuvent différer légèrement ;
- **la caméra réelle n'a pas été testée dans ce colis** : le scanner a été contrôlé par la
  saisie manuelle et par le code de `public/qr-camera.js` (déjà livré au sous-prompt 3) ;
  l'autorisation caméra dépend du navigateur et du réglage HTTPS du serveur ;
- **aucun QR imprimé n'a été scanné** physiquement.

---

## 5. Remise en état (si besoin)

Tous les changements sont **additifs** : recopier vos fichiers sauvegardés de l'étape 3.1 remet
l'application exactement dans son état précédent. Aucune migration de base n'est à défaire.

---

## 6. Empreinte SHA-256

Voir le fichier `.sha256` livré à côté du zip. Contrôle sous Windows :
`certutil -hashfile OYMIKE-MISSION11-COLIS-UNIQUE-2026-10-10.zip SHA256`
(sous macOS/Linux : `shasum -a 256 …`).
