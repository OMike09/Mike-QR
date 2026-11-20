# RAPPORT — CORRECTIONS ET AMÉLIORATIONS DU SYSTÈME QR (Oymike Tech)
Date : 2026-10-10 · Projet : `/home/user/qr-studio` · Nature : audit technique + corrections ciblées

Ce rapport décrit **uniquement** des changements réellement appliqués et des tests réellement exécutés.
Aucun test navigateur réel (Chrome/Safari sur téléphone ou ordinateur) n'a été exécuté dans cet environnement :
les validations d'interface ont été faites avec JSDOM (DOM réel + `shop.js`/`merchant.js` réels) et par tests
d'API sur un serveur Node réellement démarré. Les points non couverts sont listés en fin de rapport.

---

## 1. Architecture inspectée (avant modification)

| Couche | Fichier | Rôle |
|---|---|---|
| Page publique QR | `public/shop.html`, `shop.js`, `shop.css` | catalogue, panier, formulaire, envoi de commande |
| Interface marchand | `public/merchant.html`, `merchant.js`, `merchant.css` | produits/photos, commandes, notifications, QR |
| API | `merchant-routes.js` | routes publiques (`/api/public/shops/:slug/...`), routes marchand, admin, SSE, push |
| Métier / stockage | `merchant-commerce.js` | JSON + PostgreSQL, stock, commandes, notifications, médias |
| Base | `schema.sql` | schéma et migrations additives |
| QR | `public/qr-artwork.js`, `public/vendor/qrcode.js` | matrice QR, SVG vectoriel, rendu PNG |

Constats d'audit ayant guidé les corrections :

1. **Images blanches au clic** : `changeQuantity()` appelait `renderProducts()` qui réécrivait
   `#productsGrid.innerHTML` entier. Chaque ajout au panier détruisait tous les `<img>` et le navigateur
   rechargeait les photos (flash blanc).
2. **Photos trop petites / rognées** : `.public-product-image{aspect-ratio:4/3}` + `object-fit:cover`, et sous
   480 px la carte devenait une ligne avec une vignette de 104 px, `object-fit:cover` (recadrage).
3. **Quantités** : seul le panier permettait +/− ; aucun sélecteur sur la carte, aucune limite de stock côté client.
4. **Formulaire** : adresse de remise **obligatoire** même pour une consommation sur place ; numéro de table
   inexistant (le QR de table remplissait le champ « adresse ») ; aucun récapitulatif avant validation.
5. **Image principale** : `imageUrls[0]` était bien l'image principale, mais le marchand ne pouvait ni promouvoir
   une photo ni réordonner la galerie.
6. **Mot de passe marchand** : `/api/merchant/auth/change-password` ne vérifiait **pas** le mot de passe actuel et
   était limité au premier changement (`mustChangePassword=TRUE`), d'où la dépendance au gestionnaire/PDG.
7. **QR** : le marchand ne téléchargeait qu'un PNG 220 px via `canvas.toDataURL` (capture d'écran, pas de SVG),
   alors que `qr-artwork.js` savait déjà produire un SVG vectoriel et un PNG 1600 px.
8. **Commande** : le parcours d'enregistrement (transaction, idempotence, stock, notification persistée, SSE,
   push, `trackingToken`) était déjà opérationnel ; il a été complété (modes de remise, table, message) sans le
   remplacer.

---

## 2. Corrections appliquées

### 2.1 Photos agrandies, non rognées (priorité 1)
- Grille : `repeat(auto-fill,minmax(300px,1fr))` (ordinateur), 2 colonnes puis **1 grande carte** sur téléphone.
- Zone image : `aspect-ratio:1/1`, largeur pleine carte, `object-fit:contain` → **aucun recadrage**, ratios
  conservés, fond neutre `#eef2ef`.
- Texte compact : titre sur 2 lignes max, description `-webkit-line-clamp:2` (1 ligne sur petit mobile),
  catégorie en petit libellé ; prix + sélecteur + bouton sur une seule rangée.
- Galerie de vignettes (52 px) sous l'image principale lorsque le produit a plusieurs photos.

### 2.2 Images stables (priorité 2 — cause réelle corrigée)
- `renderProducts()` ne reconstruit plus le DOM : il calcule une **signature** (`id + photo affichée`). Le HTML
  n'est régénéré que si la liste visible change réellement (recherche, catégorie, changement de photo).
- Ajout au panier, `−`/`+` panier, vidage du panier, ouverture/fermeture du panier → `applyCartChanges()` qui met à
  jour : panier, compteurs, états des boutons, récapitulatif. **Les nœuds `<img>` sont conservés** (même référence
  DOM, même `src`).
- Changement de photo de galerie : seul le bloc `.public-product-media` est remplacé.
- Aucun fond blanc, aucune animation de remplacement : la cause (reconstruction) a été supprimée.

### 2.3 Quantités (priorité 3)
- Sélecteur compact `− n +` sur chaque carte (`state.pendingQuantities`), minimum 1, maximum = stock réel
  (`trackStock`), borné à 999.
- Limites respectées dans les trois endroits : carte, panier (`+` désactivé au stock), et **serveur**
  (validation existante `quantity < 1 || > 999` + contrôle de stock transactionnel inchangé).
- « Ajouter au panier » ajoute la quantité choisie, plafonnée au stock restant (message explicite).
- Total recalculé à chaque changement (carte et panier) ; `0` produit supprime la ligne.

### 2.4 Formulaire et récapitulatif adaptatifs (priorité 4)
- Champs obligatoires : **nom** et **téléphone**. Facultatifs : e-mail, « Laisser un mot au marchand ».
- Nouveau sélecteur **Mode de remise**, alimenté par `store.orderModes` calculé côté serveur
  (`deliveryEnabled`, `pickupEnabled`, et existence de tables/emplacements actifs).
- « Sur place » : affiche **Numéro de table** (prérempli par le QR de table scanné) + informations
  complémentaires ; **l'adresse de livraison est masquée et jamais exigée**.
- « Retrait » : adresse masquée et remplacée par « Retrait à la boutique ».
- « Livraison » : adresse obligatoire (seul cas).
- **Récapitulatif** avant validation : produits, quantités, prix unitaires, total, client, mode, table et message.
- Bouton renommé « **Confirmer ma commande** ».
- Serveur (`POST /api/public/shops/:slug/orders`) : accepte `orderMode`, `tableNumber`, `tableNote` ; construit
  `deliveryAddress = "Table 4 · près de la fenêtre"` pour un ordre sur place ; refuse une commande sur place sans
  table ni QR ; ne demande plus d'adresse pour un retrait ; `orderType` transmis à `createOrder`.

### 2.5 Image principale (priorité 5)
- Le serveur expose désormais `mainImageUrl` (= première photo) et `stockQuantity`/`trackStock` sur chaque produit
  public.
- Tableau de bord → produits : chaque photo peut être **« Définir comme principale »** (elle passe en 1ʳᵉ position),
  déplacée avec `←`/`→`, et la vignette principale est marquée « Image principale ». `imageData` reste la première
  photo (compatibilité ascendante), la galerie complète reste disponible.
- Affichage public `object-fit:contain`, aucun recadrage.

### 2.6 Commande et notifications (priorité 6)
Parcours vérifié de bout en bout : Page QR → `/api/public/shops/:slug` → panier → formulaire → `POST .../orders`
→ `commerce.createOrder` (transaction PostgreSQL / verrou + `save()` JSON) → `merchant_orders` +
`merchant_order_items` + notification persistée → événement SSE `new_order` → push (si VAPID configuré).
- La réponse HTTP n'est renvoyée **qu'après** la validation et l'insertion ; le client n'affiche la confirmation
  (redirection `/order/:reference?token=...`) qu'après `result.data.order.reference`.
- Idempotence conservée (`clientRequestId` + `intentHash`, `ON CONFLICT`/verrou, `IDEMPOTENCY_CONFLICT`),
  donc un double clic ou une connexion lente ne crée pas de doublon.
- Instantané des noms/quantités/prix d'articles, client, table, message, date, statut « À confirmer » conservés.
- Notification unique (`dedupeKey: order:<id>:new`), compteur non lu, « Mes commandes », hors-ligne (SSE à la
  reconnexion), push serveur : déjà présents, complétés par les nouveaux champs (table/message visibles dans la
  fiche commande).

### 2.7 Mot de passe marchand (priorité 7)
- Nouvel onglet **Mon compte → Sécurité → Modifier mon mot de passe** :
  mot de passe actuel + nouveau + confirmation, boutons « Afficher/Masquer », messages clairs.
- Serveur : `currentPassword` **obligatoire et vérifié** (`scrypt` + `timingSafeEqual`), politique 12–128
  caractères, refus si identique à l'ancien, hachage `scrypt` conservé, `tokenVersion+1` (sessions révoquées),
  audit (`password_change`).
- Le changement fonctionne désormais **hors première connexion** (l'ancienne contrainte `mustChangePassword=TRUE`
  a été retirée ; la porte de première connexion reste active et exige aussi le mot de passe temporaire actuel).
- **Récupération sécurisée** (oubli) : `POST /api/merchant/auth/password-reset-request` (marque la demande,
  visible par le PDG/gestionnaire) → `POST /api/admin/merchants/:id/password-reset-link` (identifiant du compte à
  confirmer) émet un jeton **à usage unique** (30 min, stocké haché) → page `/merchant/reset-password#token=…`
  (jeton uniquement en fragment, jamais dans les journaux) → nouveau mot de passe + sessions révoquées.
  Aucun e-mail automatique n'est simulé : le serveur n'a pas de service d'envoi authentifié (limite explicite).
- Droits PDG/gestionnaires sur les comptes inchangés (réinitialisation temporaire existante conservée).

### 2.8 QR PNG haute résolution + SVG (priorité 8)
- Boutons explicites **« Télécharger en PNG »** et **« Télécharger en SVG »** sur le QR de boutique,
  et `PNG du QR` / `SVG du QR` pour chaque table/emplacement.
- Réutilisation du module existant `qr-artwork.js` : PNG **1600 px** et **SVG vectoriel** avec marge de sécurité
  de **4 modules**, mêmes couleurs, même URL publique (`state.qrUrl`, `/t/:code`). Aucune capture d'écran, aucun
  blob interdit par la CSP (rendu via `data:image/svg+xml`).
- L'URL et l'identifiant du QR ne sont jamais modifiés par le téléchargement (aucun appel d'écriture).

---

## 3. Fichiers modifiés

| Fichier | Nature |
|---|---|
| `public/shop.html` | formulaire adaptatif (modes, table, message), récapitulatif, bouton « Confirmer ma commande » ; chargement synchrone de `shop.js` (évite un état incohérent si le script arrive après le DOM) |
| `public/shop.js` | rendu incrémental et stable des cartes, sélecteur de quantité, limites de stock, modes de remise, table, récapitulatif, validation client |
| `public/shop.css` | grandes images `contain`, grille responsive, textes compacts, styles du sélecteur de quantité, du mode et du récapitulatif |
| `public/merchant.html` | onglet « Mon compte », formulaire de sécurité, bouton de demande de réinitialisation, boutons PNG/SVG, chargement de `qr-artwork.js`, champ mot de passe actuel à la première connexion |
| `public/merchant.js` | image principale (promouvoir/réordonner), onglet compte, changement de mot de passe, demande de réinitialisation, téléchargements PNG/SVG boutique et tables, QR d'aperçu 320 px |
| `public/merchant.css` | styles galerie « image principale », section compte, boutons de téléchargement QR |
| `public/merchant-reset-password.html` | **nouveau** — page de réinitialisation par lien |
| `public/merchant-reset-password.js` | **nouveau** — logique de la page (jeton en fragment) |
| `merchant-routes.js` | vérification du mot de passe actuel, demande de réinitialisation, lien unique (admin), finalisation par jeton, page `/merchant/reset-password`, `orderMode`/table/message sur la commande publique, exposition `orderModes` |
| `merchant-commerce.js` | `changeMerchantPassword` (plus de condition `mustChangePassword`), `requestMerchantPasswordReset`, `listMerchantPasswordResetRequests`, `setMerchantPasswordResetLink`, `getMerchantByResetTokenHash`, `completeMerchantPasswordResetByToken`, `mainImageUrl` + stock sur le produit public, `orderModes` calculés |
| `schema.sql` | 2 colonnes additives + 2 index (voir §4) |
| `test/shop-order-recovery.test.js` | attentes mises à jour (champ table dédié, `orderMode`) |
| `test/merchant-commerce.test.js`, `test/merchant-extras.test.js`, `test/supplier-workflow.test.js` | envoi de `currentPassword` dans les changements de mot de passe |
| `test/shop-checkout-improvements.test.js` | **nouveau** — 7 tests (images stables, quantités, stock, modes, table, récapitulatif, envoi) |
| `test/merchant-security-qr-downloads.test.js` | **nouveau** — 4 tests (mot de passe, lien unique, commande table, QR PNG/SVG, image principale) |

Aucun compte, QR, produit, commande ou réglage existant n'a été supprimé. Aucune fonctionnalité opérationnelle n'a
été remplacée par une simulation.

---

## 4. Modifications de base de données

Migration **additive uniquement** (aucune donnée touchée), en fin de `schema.sql` :

```sql
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS password_reset_requested_at TIMESTAMPTZ;
ALTER TABLE merchant_accounts ADD COLUMN IF NOT EXISTS password_reset_request_ip_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS merchant_accounts_reset_requested_idx ON merchant_accounts (password_reset_requested_at DESC) WHERE password_reset_requested_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS merchant_accounts_reset_token_idx ON merchant_accounts (password_reset_token_hash) WHERE password_reset_token_hash <> '';
```

Aucune nouvelle table, aucune colonne de commande ajoutée (table et message réutilisent `service_point_name`,
`delivery_address` et `note` existants ; `order_type` existait déjà).

---

## 5. Tests exécutés

Commande : `npm test` (Node 20, `node --test`, JSDOM + serveur réel).

```
# tests 76
# pass 76
# fail 0
# skipped 1   (test PostgreSQL facultatif : DATABASE_URL absent)
```

Couverture des 17 points demandés :

| # | Point | Résultat | Preuve |
|---|---|---|---|
| 1 | Images nettement plus grandes | Réussi (CSS vérifiée) | `aspect-ratio:1/1`, grille ≥300 px, 1 carte/ligne mobile — `shop-checkout-improvements` |
| 2 | Texte plus compact | Réussi | `-webkit-line-clamp`, tests CSS |
| 3 | −/+ quantités | Réussi | valeur 1→3, blocage au stock, désactivation à 1 |
| 4 | Plusieurs produits au panier | Réussi | panier 2 lignes, total recalculé |
| 5 | Quantités modifiables dans le panier | Réussi | `data-plus`/`data-minus`, limite stock |
| 6 | Total exact | Réussi | 2×2 500 = 5 000 ; 3×2 500 = 7 500 XOF |
| 7 | Champs du formulaire | Réussi | nom/téléphone requis, e-mail et message facultatifs |
| 8 | Table uniquement si activée | Réussi | table masquée sans `orderModes.dineIn`, affichée avec QR/table active |
| 9 | Message au marchand facultatif | Réussi | `required = false`, transmis et stocké |
| 10 | Clics répétés sans image blanche | Réussi | même nœud `<img>`, même `src`, conteneur inchangé après 6 interactions |
| 11 | Images principales non rognées | Réussi | `object-fit:contain`, test CSS |
| 12 | Réception par le bon marchand | Réussi | commande table visible via `/api/merchant/orders` du compte concerné |
| 13 | Notification + compteur | Réussi | `unreadCount ≥ 1`, notification liée à l'`orderId` |
| 14 | Commande marchand déconnecté | Réussi (API) | commande créée sans session marchand puis lue après connexion (mécanisme hors-ligne SSE déjà en place) |
| 15 | Mot de passe + reconnexion | Réussi | ancien mot de passe refusé, nouveau accepté, actuel erroné → 403 |
| 16 | QR PNG et SVG | Réussi | SVG 1600, matrice identique à l'URL publique, boutons présents |
| 17 | Agrandir et scanner les deux fichiers | **Partiel** | matrice/quiet zone vérifiées par code et SVG ; **aucun scan avec un appareil photo réel n'a été effectué** |

Autres vérifications : doubles clics/idempotence, refus d'une commande sur place sans table, refus d'une
livraison sans adresse, réutilisation impossible du lien de réinitialisation (410), portée des comptes marchands
inchangée.

---

## 6. Tests échoués / non exécutés (limites honnêtes)

- **Aucun test navigateur réel** (téléphone ou ordinateur) : pas de Chrome/Safari instrumenté ici. Les rendus ont
  été validés par JSDOM et par inspection CSS ; un contrôle visuel sur appareil reste à faire.
- **Scan optique réel** des fichiers PNG/SVG (téléphone, imprimante) non effectué ; seul le contenu matriciel et la
  marge de silence ont été vérifiés.
- **Notifications push hors application** : non testables sans clés VAPID serveur (`WEB_PUSH_VAPID_*` absentes) ;
  le code renvoie explicitement « non configuré » plutôt que de simuler un envoi. Le flux SSE et les notifications
  persistées sont, eux, couverts.
- **PostgreSQL** : le test d'intégration PostgreSQL est ignoré faute de `DATABASE_URL` ; les chemins SQL ont été
  relus mais non exécutés. Les requêtes ajoutées (colonnes de réinitialisation) restent additives.
- **Envoi d'e-mail/SMS de récupération** : non implémenté volontairement (aucun fournisseur authentifié
  configuré) ; la récupération passe par un lien à usage unique remis par le PDG/gestionnaire après vérification.

## 7. Points restants à traiter (recommandations)

1. Faire un passage visuel réel sur iPhone/Android et desktop, notamment l'alignement du sélecteur de quantité sur
   les petits écrans (320–360 px).
2. Ajouter, si un fournisseur SMTP/SMS est configuré, l'envoi automatique du lien de réinitialisation (le jeton et
   l'audit sont déjà en place).
3. Exécuter la suite avec `DATABASE_URL` pour valider les chemins PostgreSQL de la réinitialisation.
4. Imprimer et scanner physiquement un QR PNG et un QR SVG après agrandissement (validation d'impression).
5. Facultatif : permettre au marchand de choisir un fond transparent pour le PNG (le module le supporte, l'option
   n'est pas exposée dans l'interface).
