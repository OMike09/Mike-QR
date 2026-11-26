# Mission 11 — Sous-prompt 1 : présentation et navigation des espaces

État : **livré et vérifié** (serveur + client, marchand, équipe, PDG).

## 1. « Se déconnecter » remplace « Quitter »
- Dernière entrée du menu (rebord bas) dans les espaces **Marchand** et **Équipe** (gérant général, serveuse, serveur), icône de sortie.
- Confirmation explicite : « Se déconnecter ? » → *Annuler* / *Se déconnecter*. Ferme uniquement la session : **aucun compte, aucune donnée, aucun historique, aucun QR code supprimé**.
- Message après déconnexion : « Vous avez été déconnecté. Vos données et votre historique sont conservés. » Retour à l'écran de connexion.
- Le bouton d'en-tête de l'espace équipe s'appelle aussi « Se déconnecter ».
- Plus aucune occurrence de « Quitter » dans le code (vérifié par recherche globale).

## 2. Trois thèmes d'interface choisis par le marchand
Écran **Réglages → Apparence de mon interface** :

| Thème | Accent | Fond | Contraste mesuré |
|---|---|---|---|
| Vert et blanc | `#0d725c` | `#f3f7f4` | 5,87:1 |
| Noir et or | `#d4af37` | `#111214` (mode sombre) | 8:1 |
| Blanc et bleu | `#1f5fd0` | `#f4f7fc` | 5,82:1 |

- Aperçu en direct (couleurs réellement appliquées à la page) **avant** d'appuyer sur « Appliquer » ; « Annuler » revient au thème enregistré sans toucher la base.
- « Appliquer » enregistre en base (`merchant_stores.interface_theme`) : le thème est retrouvé après rechargement, sur un autre appareil, et dans l'espace équipe de la même boutique.
- Application immédiate à l'ensemble des écrans : menus, boutons, cartes, commandes, tableaux, fenêtres, formulaires, icônes, barre du navigateur (`theme-color`).

## 3. Longues pages → rubriques et sous-menus
Menu marchand : **Accueil · Commandes · Scanner · Établissement · Équipe · Finances · Réglages · Se déconnecter**.
Chaque entrée ouvre un **hub de rubrique** (cartes courtes, icône, sous-titre) :

- **Commandes** : Commandes reçues, Prendre une commande, Opérations, Messagerie, Notifications, Scans & activation.
- **Établissement** : Produits, Catégories, Tables et salons, QR codes, Personnalisation, Catalogue général.
- **Réglages** : Apparence de mon interface, Mon compte, Ma boutique, Notifications.

Rien n'a été supprimé : chaque ancien panneau reste accessible, simplement rangé sous sa rubrique. Le menu de l'équipe suit la même grammaire : Accueil · Commandes · Mes activités · Établissement · Compte · Se déconnecter.

## 4. Bouton Retour partout
- Barre « ‹ Retour » + fil d'Ariane en haut de chaque sous-écran, sur les quatre espaces.
- Le retour **ne perd aucune saisie** (les formulaires restent en place) et remonte l'ordre exact de navigation : outil → hub → accueil.
- Pile d'historique alignée sur le bouton Retour **du téléphone** (`popstate`) : pas d'écran vide, pas de double-retour, bouton masqué à la racine.

## 5. Contrôle du PDG
Nouvelle carte **Réglages → Apparence des interfaces** (PDG) :
- choix du **thème par défaut** et du mode : *proposé aux marchands* ou *imposé à tous* ;
- consultation des **thèmes réellement utilisés** (nombre d'établissements, nombre de choix marchands, contraste) ;
- tableau des établissements : choix du marchand vs thème appliqué, mention « imposé » le cas échéant.
- Mode imposé : le marchand voit le thème du PDG ; son choix personnel est conservé mais refusé (`409 APPEARANCE_IMPOSED`) tant que l'imposition dure.

## 6. Harmonisation des 4 espaces
Icônes simples, gros boutons, titres courts, mêmes libellés de déconnexion et de retour, mêmes tailles de texte pilotées par les réglages PDG existants. Les comptes, les QR codes, les paramètres techniques et les données restent inchangés.

## Vérifications exécutées
- `node --test` : **141 tests passent**, 0 échec (1 suite ignorée, sans rapport).
- Parcours navigateur (téléphone 412 px) : menu 8 entrées, hub Établissement 6 entrées, ouverture de Catégories, Retour → hub, Retour → accueil, aperçu de thème sans effet, « Appliquer » persisté après rechargement, confirmation de déconnexion (annuler = rester, confirmer = écran de connexion).
- Espace **gérant général** et **serveuse** : thème de la boutique appliqué, barre Retour, « Se déconnecter » confirmé, aucune erreur JS.
- PDG : thème imposé visible côté équipe puis rétabli en mode « proposé » ; carte d'administration alimentée après connexion uniquement (plus de 401 parasite).
- Contraste : minimum 5,82:1 (norme AA pour le texte normal : 4,5:1).

## Captures
`m11-01-accueil-marchand.png` · `m11-02-hub-etablissement.png` · `m11-04-apparence.png` · `m11-05-apercu-noir-or.png` · `m11-pdg-apparence.png` · `m11-equipe-theme-impose.png`
