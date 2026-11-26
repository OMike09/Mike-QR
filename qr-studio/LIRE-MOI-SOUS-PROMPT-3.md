# OYMIKE — Mission 11 · Sous-prompt 3
## Scanner, accueil stable et « Voir les historiques »

Date : 10 octobre 2026 · Version livrée : `OYMIKE-MISSION11-HISTORIQUES-2026-10-10.zip`

Tout est **additif** : aucune donnée, aucun compte, aucun QR code, aucune permission et aucun
historique n'a été supprimé. Le serveur de test tourne sur le port **3600**.

---

## 1. Ce qui est corrigé, point par point

### 1. La caméra
| Demande | Ce qui a été fait |
|---|---|
| Clic « Scanner un QR code » → autorisation | L'aperçu s'ouvre **directement** au clic : la demande d'autorisation part immédiatement (`getUserMedia`). Aucun écran intermédiaire. |
| Caméra **arrière** par défaut | `facingMode: { ideal: 'environment' }` puis replis successifs. Un téléphone qui refuse la contrainte exacte obtient quand même un aperçu (c'était la cause des écrans noirs). |
| Aperçu en direct, détection **automatique** | Détection en continu avec `BarcodeDetector` quand le navigateur l'offre, sinon la bibliothèque de décodage chargée à la demande. Rien à appuyer. |
| Lecture **sans photo ni enregistrement** | Aucun `MediaRecorder`, aucun `getDisplayMedia`, aucun `capture`, aucune image conservée ni envoyée. Le texte « aucune photo, aucune vidéo, aucun enregistrement d'écran » est affiché sous l'aperçu. |
| Redirection immédiate | Le code lu est vérifié par le serveur puis l'utilisateur est envoyé vers la fonction correspondante : prise de commande avec la table déjà choisie, ou liste des tables pour un QR de boutique. |
| Messages clairs | Quatre cas expliqués en français : HTTPS manquant, permission refusée, caméra absente, caméra occupée par une autre application. Bouton **Réessayer**. |
| Saisie manuelle en secours | Toujours visible dans la fenêtre du scanner, sans dépendre de la caméra. |
| Caméra indisponible | L'aperçu noir se retire, le message d'erreur et la saisie manuelle prennent la place ; plus de grande zone vide. |

### 2. Accueil stable
Commandes, Scanner et Vue d'ensemble **ne disparaissent plus** : après un clic, une consultation
d'historique, un retour, un changement de rubrique, une actualisation ou une reconnexion.
La vue affichée est mémorisée (`oymike:workspace-view:v1`, `oymike:staff-view:v1`,
`oymike:admin-view:v1`) et restaurée au rechargement.

### 3. Trois fonctions permanentes
Une barre fixe (`.ws-rail` / `#wsPermanentRail` en marchand, `#staffPermanentRail` en équipe)
reste collée en haut sur téléphone comme sur ordinateur. Elle ne masque pas le contenu : le
document réserve sa hauteur. Les trois boutons sont toujours visibles, y compris dans les
historiques et dans le scanner.

### 4. « Voir les historiques » cliquable, par rôle
Une rubrique dédiée dans chaque espace. Le serveur décide de ce que chacun peut voir :

| Rôle | Périmètre |
|---|---|
| PDG (Administrateur général) | Toutes les boutiques |
| Gestionnaire | Uniquement ses marchands |
| Marchand | Son établissement seulement |
| Gérant général | Sa boutique ; l'activité de l'équipe seulement avec la permission `activity.view` |
| Serveuse / Serveur | Ses propres actions uniquement (rôle unique « Serveuse / Serveur ») |

Les catégories affichées sont celles renvoyées par le serveur : commandes, scans, connexions,
opérations, activité du personnel, consignations. Une catégorie interdite est **refusée par le
serveur** (403), elle n'est pas simplement masquée.

### 5. Filtres et recherche
Aujourd'hui · Hier · Cette semaine · Ce mois · Période personnalisée · Tout l'historique.
Recherche par nom, n° de commande, table, membre du personnel, type d'opération.
Chaque ligne affiche : **action, date, heure, personne, statut** (+ établissement pour les rôles
qui surveillent plusieurs boutiques).

### 6. Traçabilité des commandes
Chaque commande de l'historique conserve et affiche : établissement, table / salon, **QR concerné**,
membre responsable, auteur de la saisie, total, et **les heures de chaque étape**. Quand une table
ou une commande change de responsable, **les affectations précédentes sont conservées** :
« Affectée · Awa (auparavant Bintou) — 26 nov. 2026 · 11:17 · par Marchand · motif ».

Le QR est désormais transmis avec la commande au moment du scan ; si aucun QR n'a été lu, c'est
celui de la table choisie qui est retenu, et un code incohérent est ignoré par le serveur.

### 7. Vue d'ensemble allégée
Quatre cartes cliquables, sans texte long : **Nouvelles commandes**, **En cours**, **Terminées**,
**Tables occupées / libres**, plus les **scans récents** et l'activité du personnel selon les
permissions. Un clic ouvre la liste correspondante, déjà filtrée.

### 8. Actualisation et stabilité
Les commandes se rafraîchissent seules (30 s). Après chaque action : pas de rechargement de page,
les raccourcis restent en place, une saisie en cours n'est pas perdue, aucune reconnexion forcée,
et aucune commande n'apparaît deux fois (dédoublonnage vérifié côté serveur).

---

## 2. Les 12 contrôles obligatoires — résultats

Exécutés sur un navigateur réel (Chromium), téléphone 390 × 844 et ordinateur 1280 × 900,
avec un marchand et une serveuse créés pour l'occasion.

| # | Contrôle | Résultat |
|---|---|---|
| 1 | La caméra démarre directement au clic | OK — `getUserMedia` appelé 1 fois, aperçu vidéo affiché |
| 2 | Lecture avec la caméra arrière | OK — `facingMode ideal: environment` |
| 3 | Aucun enregistrement vidéo ni d'écran | OK — aucun contrôle de capture, aucune API d'enregistrement |
| 4 | Saisie manuelle si la caméra échoue | OK — message clair + champ utilisable + bouton Réessayer |
| 5 | Persistance Commandes | OK — présent avant et après navigation |
| 6 | Persistance Scanner | OK — présent dans les historiques et après rechargement |
| 7 | Persistance Vue d'ensemble | OK — 4 cartes cliquables |
| 8 | Accès aux historiques par rôle | OK — PDG (300 lignes), marchand, équipe |
| 9 | Respect des permissions | OK — catégorie interdite refusée (403), serveuse limitée à ses lignes |
| 10 | Traçabilité table + personnel | OK — table, QR, membre, auteur, étapes, affectations précédentes |
| 11 | Actualisation sans disparition | OK — barre conservée, vue restaurée, aucun doublon |
| 12 | Android / iPhone / ordinateur | OK — barre et cartes vérifiées sur téléphone et sur ordinateur ; conception adaptée aux deux |

**Synthèse : 12 / 12.**

### Tests automatiques du projet
```
node --test test/
→ 206 tests · 205 réussis · 0 échec · 1 ignoré (test PostgreSQL volontairement optionnel)
```
Deux fichiers de tests ont été ajoutés pour cette étape :
`test/mission11-scanner-historiques.test.js` (10 contrôles, dont la caméra et la permanence des
raccourcis) et `test/mission11-historiques-postgres.test.js` (cloisonnement réel entre deux
marchands, deux serveuses, PDG et gestionnaire).

---

## 3. Captures d'écran
Dans le dossier `captures/` du zip :

1. `01-accueil-marchand-telephone.png` — barre permanente + vue d'ensemble cliquable
2. `02-scanner-camera-directe.png` — aperçu ouvert directement, caméra arrière
3. `03-scanner-sans-camera-saisie-manuelle.png` — message clair et saisie de secours
4. `04-historiques-pdg-telephone.png` — page « Voir les historiques » du PDG
5. `05-historiques-pdg-ordinateur.png` — même page sur ordinateur
6. `06-historiques-equipe.png` — historiques côté serveuse / serveur
7. `07-accueil-marchand-ordinateur.png` — accueil marchand sur ordinateur

---

## 4. Comment vérifier vous-même

1. Démarrez le serveur (`node server.js`, port 3600) puis ouvrez `/merchant` ou `/equipe`.
2. Sur téléphone, appuyez sur **Scanner** dans la barre du haut : la caméra arrière s'ouvre
   immédiatement ; présentez un QR, la commande s'ouvre avec la table déjà choisie.
3. Refusez la permission : le message explique quoi faire et la saisie manuelle reste disponible.
4. Ouvrez **Voir les historiques**, changez de période, cherchez « CMD- » ou un nom.
5. Dépliez une commande : table, QR, membre responsable, auteur et heures de chaque étape.
6. Actualisez la page : vous retrouvez le même écran, avec les trois raccourcis.

---

## 5. Contenu du zip

- l'application complète (`server.js`, `*.js`, `public/`, `test/`, schémas SQL) ;
- les deux nouveaux fichiers de tests ;
- ce LIRE-MOI en français ;
- les 7 captures d'écran.

Empreinte SHA-256 fournie à côté du zip (`…zip.sha256`).
