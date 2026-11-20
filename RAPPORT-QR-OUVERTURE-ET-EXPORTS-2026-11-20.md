# QR Oymike — ouverture des liens scannés et exports PNG/SVG

**Date : 20 novembre 2026** · Projet : `qr.oymiketech.com` (Render + Cloudflare, PostgreSQL)
**Objet :** 1) supprimer le blocage « Chargement du catalogue… / Patientez quelques instants… » à l’ouverture d’un QR scanné ; 2) livrer de vrais exports **PNG haute résolution** et **SVG vectoriel**.
**Périmètre respecté :** aucun QR reconstruit, **aucune URL déjà imprimée modifiée** (`/t/<code>`, `/s/<code>`, `/r/<code>` conservées à l’identique).

---

## 1. Ce que j’ai réellement constaté (diagnostic, pas hypothèse)

Sondes HTTP réelles sur le site en production, **sans session marchand** :

| Lien testé | Résultat observé |
|---|---|
| `GET /api/health` | `{"ok":true,"database":"postgres","demoMode":false,"publicBaseUrl":"https://qr.oymiketech.com"}` |
| `GET /t/T-2NFPN3ER8RGBCSX` (QR de la capture) | **404**, page « Code indisponible » (1 057 octets) |
| `GET /t/T-9AESWH9XZR9-BCH` (QR de la capture) | **404**, idem |
| `GET /api/public/service-points/<code>` | `{"error":"Cette table ou cet emplacement n’est plus actif."}` (0,2 s à 2,6 s) |
| `GET /shop/chez-gbazike` + `GET /api/public/shops/chez-gbazike` | **200**, 7 produits, `dineIn:true` |
| `GET /shop/inconnu-test` | 200 HTML puis API « Cette boutique n’est pas disponible. » |
| `GET /merchant/sw.js` | service worker cache-first, **scope `/merchant/`** → ne concerne pas `/shop/` |

**Conclusion honnête :** les deux QR de la capture **ne sont pas bloqués par un bug de chargement, ils sont réellement inactifs en base** (`status` ≠ `active`, ou boutique non publiée / compte non actif). Le 404 arrive en moins d’une seconde : ce n’est ni un timeout, ni une boucle JS, ni une dépendance à une session. Je ne les ai donc **pas** « réparés » en modifiant du code : ils doivent être réactivés côté marchand/PDG, puis réimprimés seulement si nécessaire (le code, lui, reste valable).

En revanche, le **chemin de code** qui produit le symptôme « Patientez quelques instants » existait bel et bien, sur les cas où la base est lente/indisponible :

1. **Côté serveur, la résolution du QR dépendait d’un accès base sans garde-fou** : pool `max: 8`, `connectionTimeoutMillis: 10 s`, aucun `statement_timeout`, aucun `pool.on('error')`. Un pool saturé ou un client inactif en erreur pouvait faire attendre la requête très longtemps (ou faire tomber le process), donc la redirection n’arrivait jamais et le navigateur restait sur la page intermédiaire.
2. **L’enregistrement du scan était attendu (`await`) avant la redirection** : une écriture lente (`UPDATE … qr_scan_count`) retardait l’ouverture du catalogue, alors qu’elle n’a aucune valeur pour le client.
3. **Côté client, `loadShop()` n’avait aucun timeout** et `loadServicePoint()` **effaçait** `servicePointCode`/`tableNo` quand la vérification de table échouait : la table scannée était perdue, et l’écran pouvait rester sur « Chargement du catalogue… ».
4. **L’identification de la table exigeait un second appel réseau** (`/api/public/service-points/:code`) sur le chemin critique.
5. **Les erreurs n’étaient pas distinguées** : un QR suspendu (404) et une base indisponible (503) aboutissaient au même écran générique, parfois après une longue attente.
6. **`/r/:code` (QR génériques / anciens codes) n’avait aucune protection** : ni timeout, ni page d’erreur dédiée, et `recordScan` était attendu.

---

## 2. Corrections appliquées (fichiers du colis)

### `store.js` — pool PostgreSQL durci
- `max: 10`, `idleTimeoutMillis: 30000`, `connectionTimeoutMillis: 8000`
- `statement_timeout: 12000`, `query_timeout: 14000`, `application_name: 'oymike-qria'`
- ajout `pool.on('error', …)` : une erreur sur un client inactif n’arrête plus le serveur (cause classique de « page qui ne répond plus »).

### `merchant-routes.js` — routes publiques QR
- `QR_RESOLVE_TIMEOUT_MS = 7000` + `resolveWithTimeout()` : la résolution ne peut plus dépasser 7 s.
- `sendQrPage(req,res,status,…)` : page statique `public/qr-unavailable.html`, en-têtes `X-QR-Status`, `X-QR-Reason`, `X-QR-Retry`, **404 explicite** (QR inactif) vs **503** (base momentanément indisponible) ; repli HTML inline si le fichier n’est pas servi.
- `/t/:code` (+ `/t/:code/`) et `/s/:code` (+ `/s/:code/`) : `Cache-Control: no-store`, scan enregistré en **fire-and-forget** (`.catch(() => {})`), **redirection 302 inchangée** vers `/shop/<slug>?servicePoint=<code>` et `/shop/<slug>`.
- **La table scannée est renvoyée dans le même payload** que le catalogue : `/api/public/shops/:slug?servicePoint=<code>` renvoie `store.servicePoint` (aucun aller-retour supplémentaire, donc aucun écran d’attente intermédiaire).

### `server.js` — route des QR génériques `/r/:code`
- timeout 7 s, `Cache-Control: no-store`, page `qr-unavailable.html` en 404/503, `recordScan` en fire-and-forget, **et pas de faux scan sur `HEAD`** (un simple contrôle de lien ne compte plus comme un scan).
- URL et destinations inchangées (`/r/<code>` → page de profil ou redirection configurée).

### `public/qr-unavailable.html` / `public/qr-unavailable.js` (nouveaux)
- Page **autonome** (styles inline, aucun appel API critique) : « QR indisponible » ou « Service momentanément indisponible » selon le statut, bouton **Réessayer** qui relance le lien d’origine.

### `public/shop.js` / `public/shop.html` / `public/shop.css` — page publique boutique
- `fetchWithTimeout()` (15 s) sur le catalogue, (8 s) sur la vérification de table : plus d’attente infinie.
- `loadServicePoint()` utilise **d’abord** la table déjà présente dans le payload, sinon un appel borné ; en cas d’échec **le code de table n’est plus effacé** (la commande reste rattachée au bon QR, validé côté serveur).
- `showError()` : message actionnable, bouton **Réessayer**, indice qui distingue « problème de connexion » de « QR/lien invalide ».
- La carte de chargement propose désormais un lien **« relancez le chargement »** (plus jamais de message figé sans issue).
- La commande (`POST /orders`) est bornée à 20 s ; grâce au `clientRequestId` idempotent, un renvoi ne crée **pas** de doublon.

### `public/merchant-control.js` + `public/merchant-control.html` — « Télécharger le QR »
- Avant : un seul bouton qui faisait `canvas.toDataURL('image/png')` → **image de 320 px**, sans SVG.
- Après : **« Télécharger en PNG »** (vraie image **1600 px**) et **« Télécharger en SVG »** (vectoriel réel, pas un PNG encapsulé), via le module partagé `public/qr-artwork.js` (déjà livré) — **même URL publique, même matrice, marge de silence de 4 modules, logo central conservé** si le style en contient un.
- Les boutons existants (Consulter, Imprimer, Copier le lien, Tester, Vérifier la boutique) sont **conservés**.

### `public/supplier.js` + `public/supplier.html` — QR fournisseur
- Même traitement : **PNG haute résolution** + **SVG vectoriel** (l’ancien bouton ne produisait qu’un canvas).

---

## 3. Types de QR couverts et contrôles effectués

| Type de QR | URL (inchangée) | Vérifié |
|---|---|---|
| Table / emplacement individuel | `/t/<code>` → 302 `/shop/<slug>?servicePoint=<code>` | oui (test automatisé + smoke serveur) |
| Boutique (lecture seule) | `/s/<code>` → 302 `/shop/<slug>` | oui (scan **et** suspension testés) |
| QR général marchand / anciens codes | `/r/<code>` (page publique ou redirection) | oui (201 → scan 200 → scanCount = 1) |
| QR inconnu / ancien code expiré | `/t/…`, `/s/…`, `/r/…` | 404 immédiat + page dédiée, jamais de spinner |

Points vérifiés explicitement :
- **aucune session marchand/gestionnaire** n’est requise par les pages publiques (tous les appels de test sont anonymes) ;
- **la table est identifiée automatiquement** et transmise au panier/à la commande (`store.servicePoint` puis `servicePointCode` dans le POST), sans saisie du client ;
- **aucun mélange entre marchands/tables** : le code de table n’est accepté que si `storeId` **et** `storeSlug` correspondent à la boutique ouverte ;
- **QR suspendu** ⇒ 404 + message clair (« Ce QR … n’est plus actif. Demandez de l’aide au personnel. »), pas de spinner ;
- **base indisponible** ⇒ 503 + « Réessayez dans quelques secondes », pas de spinner.

---

## 4. Tests

### Tests automatisés (`npm test`)
```
# tests 78
# pass 77
# fail 0
# cancelled 0
# skipped 1
```
(La suite précédente était à 76 pass / 0 fail / 1 skipped : **+2 tests**, aucun test cassé.)

Nouveaux contrôles ajoutés dans `test/merchant-security-qr-downloads.test.js` :
1. **« QR public : la table scannée arrive avec le catalogue, un QR suspendu ou inconnu ne boucle pas »** :
   `/t/<code>` → 302 + `Location` exact + `Cache-Control: no-store` ; le payload catalogue contient `store.servicePoint` (nom de table) ; suspension de la table → **404** avec page dédiée et **sans** « Patientez quelques instants » ; code inconnu → 404 immédiat.
2. Extension du test d’exports : présence de `qr-artwork.js` et des boutons **PNG 1600 px / SVG** dans `merchant-control`, disparition de l’ancien `canvas.toDataURL` 320 px, boutons PNG/SVG du fournisseur.

### Vérification serveur réelle (serveur lancé localement, sans session)
```
/t/<code>              → 302  /shop/chez-smoke?servicePoint=T-…
page /shop/chez-smoke  → 200  (shop.js servi)
/api/public/shops/chez-smoke?servicePoint=<code> → 200, table = "Table 3", 1 produit
/r/<code>              → 200 page publique, scanCount 1 après un GET
/s/<code>              → 302 /shop/chez-smoke
/s/<code> après suspension → 404 + page « QR indisponible »
/t/code inconnu        → 404 + page « QR indisponible »
```

### Ce que je **n’ai pas** testé — à ne pas considérer comme validé
- **Aucun test sur téléphone physique**, ni en navigation privée réelle : je n’ai pas d’appareil. Les liens ont été testés par requêtes HTTP réelles (sans cookie) et par JSDOM/serveur local, **pas par un scan caméra**.
- **Aucun redéploiement Render effectué** : le code corrigé est dans le colis, il doit être déployé pour agir en production. Les liens `T-2NFPN3ER8RGBCSX` / `T-9AESWH9XZR9-BCH` resteront en 404 après déploiement **tant que la table/l’emplacement n’est pas réactivé** (ce n’est pas un bug de code).
- Imports de `store.js`/`merchant-routes.js` testés **en JSON local** ; le comportement PostgreSQL (timeouts `statement_timeout`, `pool.on('error')`) est configuré et relu, mais **non rejoué contre une vraie base Postgres saturée**. La suite `merchant-assisted-postgres` reste conditionnelle.
- Le rendu visuel des nouveaux boutons n’a pas été contrôlé dans un navigateur graphique (seulement structure DOM/HTML).

---

## 5. Limites restantes (sincères)

1. **Les deux QR de la capture sont inactifs en base** : ils doivent être réactivés depuis l’espace marchand/PDG. Aucune correction de code ne peut (et ne doit) contourner cette règle.
2. Si le pool PostgreSQL est réellement épuisé (charge extrême), la page 503 s’affichera **plus tôt** — c’est le comportement voulu : message clair au lieu d’une attente infinie. Un dimensionnement Render/Neon (connexions max) peut rester nécessaire.
3. Service worker : celui du marchand est limité à `/merchant/`. Si un ancien visiteur a une version en cache d’une page publique, un `reload` forcé peut être nécessaire une fois ; les pages publiques sont servies `no-store` côté HTML/API.
4. Le compteur de scans est désormais **best-effort** : en cas d’erreur base, un scan peut ne pas être compté. C’est un choix assumé (ne jamais bloquer le client), à connaître pour les statistiques.

---

## 6. Application du colis

Voir `LISEZ-MOI-COLIS-QR-OUVERTURE-EXPORTS-2026-11-20.txt`. Résumé : copier les 13 fichiers en respectant l’arborescence (`public/…`), redémarrer le service, puis vérifier `/t/<un code actif>` depuis un téléphone en navigation privée.
