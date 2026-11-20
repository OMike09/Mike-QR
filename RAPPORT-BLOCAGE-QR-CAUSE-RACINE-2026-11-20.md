# Blocage QR — cause réelle, preuve et correction

**Date : 20 novembre 2026 (13 h)** · Site : `qr.oymiketech.com` · Page concernée : `/shop/<boutique>`
Statut : **cause identifiée et corrigée dans le code, vérifiée par navigateur réel** — voir la section 3, « non testé ».

---

## 1. Le déblocage des QR codes

Lorsqu'un client scanne un QR code et clique sur le lien, il doit arriver directement sur la page publique correspondante.

Le parcours doit être :

SCAN DU QR CODE → OUVERTURE DU LIEN → PAGE PUBLIQUE DU MARCHAND.

Pour un QR code de table :

SCAN → OUVERTURE DU LIEN → PAGE DU MARCHAND AVEC LA BONNE TABLE IDENTIFIÉE.

Il ne doit plus y avoir :

- De blocage sur « Patientez quelques instants ».
- De chargement infini.
- De page intermédiaire inutile.
- De redirection en boucle.
- D'obligation de se connecter.
- De délai artificiel avant l'affichage de la page.

**Ne masque pas le message d'attente pour donner l'impression que le problème est réglé. Supprime la cause du blocage.**

---

## 2. Reproduction et cause technique exacte

### Ce que montre la capture

La capture du 20/11 à 12 h 02 montre `qr.oymiketech.com` sur « Chargement du catalogue… » avec ma phrase d'aide
« Si rien ne s'affiche après quinze secondes, relancez le chargement. » : c'est donc **le `shop.html`/`shop.js` corrigé
la veille qui s'exécute en production** (fichiers identiques au bit près à ceux du colis : `shop.js` 62 369 octets,
`shop.html` 8 962 octets, vérifié par `diff`). Le blocage n'était donc **pas** un problème de redirection, de route,
de session ou de base : la redirection s'est faite, la page s'est affichée, puis **rien n'a été demandé au serveur**.

### Reproduction en navigateur réel (Chromium, viewport téléphone, réseau réel)

Test sur `https://qr.oymiketech.com/shop/chez-gbazike` (boutique publiée, 7 produits, API à 0,6 s) :

| Observation | Valeur mesurée |
|---|---|
| Requêtes émises par la page | `/shop/chez-gbazike` (200), `/shop.js` (200) — **et rien d'autre** |
| `/api/public/shops/chez-gbazike` | **jamais appelée** |
| Erreur JavaScript | `Cannot read properties of null (reading 'addEventListener')` |
| `shop.js` ligne | **458**, dans l'exécution de premier niveau (pile : `shop.js:458` ← `shop.js:577`) |
| État du DOM final | `#shopLoading` visible, `#shopContent` masqué, 0 produit |

Instrumentation de `fetch`/`XMLHttpRequest` avant le chargement de l'application : **`CALLS: []`** → aucune requête
réseau n'a été tentée. `#startTableCamera`, `#checkoutForm`… **existent bien** dans le HTML.

### Cause exacte

`public/shop.html` chargeait le script **en bloquant dans `<head>`** :

```html
<script src="/shop.js"></script>
```

`shop.js` est une IIFE exécutée immédiatement, et son **code de premier niveau** faisait 14 liaisons du type
`$('#startTableCamera').addEventListener(...)`, `$('#checkoutForm').addEventListener(...)`.
Comme le script bloquant s'exécute **avant que le `<body>` soit parsé**, ces `getElementById` renvoient `null` :
la première liaison lève `TypeError`, **le reste du script est abandonné**, donc `loadShop()` — appelé en toute fin de
fichier — **n'est jamais atteint**. Résultat : aucune requête catalogue, carte de chargement figée à l'infini.
C'est un bug déterministe, à 100 %, sur **tous** les QR (table, boutique, second marchand) ; seuls les QR
génériques `/r/…` et les pages d'erreur n'étaient pas touchés.

**Fichiers responsables :** `public/shop.html` (script bloquant) et `public/shop.js` (liaisons non protégées
exécutées avant le DOM). Ce n'est ni un délai serveur, ni une session, ni une boucle de redirection.

### Les deux QR de la capture restent, eux, réellement inactifs

```
GET /t/T-2NFPN3ER8RGBCSX → 404 en 0,65 s
GET /t/T-9AESWH9XZR9-BCH → 404 en 0,22 s
GET /api/public/service-points/<code> → « Cette table ou cet emplacement n'est plus actif. »
```
Ils ne sont pas « bloqués » : ils sont suspendus en base et affichent la page « QR indisponible ».
Après déploiement du correctif, ils resteront en 404 tant qu'ils ne sont pas réactivés depuis l'espace marchand/PDG.
Aucun code ne peut contourner cette règle — et je ne l'ai pas fait.

---

## 3. Correction appliquée

| Fichier | Correction |
|---|---|
| `public/shop.html` | `<script defer src="/shop.js">` : le script s'exécute **après** le parse du DOM (le HTML s'affiche immédiatement, sans attendre le JS). |
| `public/shop.js` | Les 14 liaisons de premier niveau passent par un helper protégé `onNode(selector, event, handler)` ; `#shopRewards`, `#checkoutForm`/`#placeOrder`, `#clearCart` sont traités comme facultatifs. Un nœud absent ne peut plus interrompre le script. |
| `public/shop.js` | Garde de démarrage : `loadShop()` est appelé sur `DOMContentLoaded` si le document parse encore, sinon immédiatement (compatible avec un script bloquant comme avec `defer`). |
| `public/shop.js` | **Chien de garde de 22 s** : si ni le catalogue ni l'erreur ne s'affichent, la carte de chargement est remplacée par un message actionnable (« La réponse du serveur ne vient pas… »). Filet de sécurité, pas la correction. |
| `public/shop.js` | Déjà en place et conservé : `fetchWithTimeout` (15 s catalogue / 8 s table), table scannée lue dans le **même** payload (`store.servicePoint`, un seul appel), `servicePointCode` jamais effacé en cas d'échec, commande bornée à 20 s et idempotente. |
| `public/shop.css` | Styles du lien « relancez le chargement ». |

Aucune route publique, aucune URL imprimée, aucun identifiant n'a changé : `/t/<code>`, `/s/<code>`, `/r/<code>` sont
intactes. Aucun contrôle d'accès des espaces privés n'a été touché.

## 4. Résultats vérifiés (navigateur réel, anonyme, aucune session)

### 4.1 Local, 4 types de QR + 1 cas invalide — corrigé

| Cas | URL | Résultat | Table |
|---|---|---|---|
| QR de table, marchand A | `/t/T-G8ZYFVA1…` | 302 → page 200 en **113 ms**, 2 produits, 0 erreur JS | « Table 3 · Terrasse — la commande sera rattachée à ce QR. » |
| QR boutique, marchand A | `/s/Bh5fPKex…` | 302 → page 200 en **110 ms**, 2 produits | — (QR lecture seule) |
| QR de table, **autre** marchand | `/t/T--E1VNCGZL…` | 302 → page 200 en **109 ms**, boutique « Maquis du Port » | « Table 9 · Terrasse » |
| Ancien QR général | `/r/WYsszyydMQ` | 200 en **82 ms**, page profil rendue | — |
| QR inconnu | `/t/T-INCONNU000000` | **404** en 49 ms, page « QR indisponible », pas de spinner | — |

Réseau observé pour le QR de table : `302 /t/<code>` → `200 /shop/<slug>?servicePoint=<code>` → `200 /shop.js`
→ `200 /api/public/shops/<slug>?servicePoint=<code>` → **un seul appel API**, table incluse. Aucune boucle.
Autres pages publiques contrôlées sans erreur JS après correction : `/discover/`, `/order-recovery/`, `/r/<code>`,
`/t/<code inconnu>`.

### 4.2 Production, preuve avant/après sur le même serveur et la même boutique

| Configuration | Résultat |
|---|---|
| Production actuelle (`shop.js` déployé) | 9,3 s : carte de chargement toujours visible, 0 produit, `TypeError … addEventListener` |
| Production **+** `shop.html`/`shop.js` corrigés injectés dans le navigateur | **4,1 s** : « CHEZ GBAZIKE », **7 produits**, 0 erreur JS |

Capture : `preuve-catalogue-prod-avec-correctif.png` (catalogue réel de production affiché avec le correctif).

### 4.3 Tests automatisés — `npm test`

```
# tests 82   # pass 81   # fail 0   # cancelled 0   # skipped 1
```
Nouveau fichier `test/public-qr-journey.test.js` (4 tests) :
1. **Régression structurelle** : `shop.js` non bloquant, **aucune** liaison `$('#id').addEventListener` non protégée,
   helper `onNode` présent, chien de garde présent, garde `DOMContentLoaded` présente.
2. **Un nœud optionnel absent** (`#shopRewards` retiré du DOM) : le catalogue s'affiche quand même, la table est
   affichée, **un seul** appel `/api/public/shops/…?servicePoint=…`, **zéro** appel `/api/public/service-points/…`.
3. **Parcours HTTP réel anonyme** : QR table marchand A et B (302 + `Location` exact + `no-store` + aucune
   exigence d'authentification + bonne table + bon marchand dans le payload), QR boutique, ancien QR `/r/`,
   code inconnu 404, QR **suspendu** 404, chaîne de redirection limitée à **302 → 200** (pas de boucle),
   puis échec réseau → panneau d'erreur affiché et carte de chargement retirée.
4. **Commande depuis un QR de table** : le `servicePointCode` scanné est bien envoyé dans le `POST /orders`,
   une seule fois, avec le bon produit.

---

## 5. Ce que je n'ai pas pu faire — à ne pas considérer comme validé

- **Aucun déploiement effectué** : je n'ai pas d'accès Render/GitHub dans cette session. Le correctif est dans le colis ;
  **la production est encore cassée jusqu'au déploiement** (preuve 4.2, première ligne).
- **Aucun scan caméra sur téléphone physique** : les tests navigateur sont faits dans Chromium avec un viewport
  mobile et l'agent iOS, **pas** sur un iPhone réel avec l'appareil photo. Le QR scanné n'est qu'une URL : la partie
  caméra n'intervient pas dans le blocage, mais je ne le présente pas comme testé.
- **Aucun test contre la base PostgreSQL de production** : les parcours ci-dessus utilisent le stockage JSON local
  (mêmes routes, même code `shop.js`) et les API réelles de production pour la preuve 4.2.
- Les deux QR de la capture restent inactifs : à réactiver côté marchand/PDG (voir `LISEZ-MOI`).

## 6. Validation à faire après déploiement (5 minutes)

1. Ouvrir `https://qr.oymiketech.com/shop/chez-gbazike` en navigation privée sur un téléphone : le catalogue doit
   apparaître en ~1 s ; dans la console (ou en ajoutant `?debug`) **aucune** `TypeError`.
2. Scanner un QR de table **actif** : on doit voir « Table X · Zone — la commande sera rattachée à ce QR ».
3. Scanner un QR d'un autre marchand : la bonne boutique et la bonne table.
4. Scanner un QR suspendu : page « QR indisponible » immédiate, jamais « Patientez quelques instants ».
5. Passer une commande depuis un QR de table et vérifier dans l'espace marchand que la table est conservée.
