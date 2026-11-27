# INSTALLATION — MISSION 12 (delta)

## 1. Avant de toucher à la production

```bash
# 1. sauvegarde de la base
pg_dump "$DATABASE_URL" > sauvegarde-avant-mission12.sql
# 2. sauvegarde des fichiers publics
tar czf sauvegarde-public-avant-mission12.tgz public/
```

## 2. Copie des fichiers

Depuis la racine du projet, en adaptant le chemin du colis :

```bash
COLIS=/chemin/vers/OYMIKE-MISSION12

cp "$COLIS"/serveur/table-management-routes.js   ./
cp "$COLIS"/serveur/member-accounts-routes.js    ./
cp "$COLIS"/serveur/schema-mission12-tables.sql  ./

cp "$COLIS"/public/qr-camera.js        public/
cp "$COLIS"/public/table-manager.js    public/
cp "$COLIS"/public/member-accounts.js  public/
cp "$COLIS"/public/workspace-ui.js     public/
cp "$COLIS"/public/workspace.css       public/
cp "$COLIS"/public/merchant.html       public/
cp "$COLIS"/public/merchant.js         public/
cp "$COLIS"/public/staff.html          public/
cp "$COLIS"/public/staff.js            public/
cp "$COLIS"/public/merchant/sw.js      public/merchant/

mkdir -p test && cp "$COLIS"/tests/mission12-tables-comptes.test.js test/
```

## 3. Branchements (deux endroits seulement)

### a) `store.js` — le schéma des tables est appliqué au démarrage

Chercher la boucle de schéma de la mission 11 et ajouter le nouveau fichier :

```js
for (const file of ['schema-mission11-equipes.sql', 'schema-mission12-tables.sql']) {
```

Le fichier `schema-mission12-tables.sql` est **additif** : il ajoute une colonne, reprend les
anciens libellés « Table N » vers `N`, puis crée un index d'unicité partiel. Il ne supprime rien.

### b) `server.js` — montage des deux modules, juste après `merchantOps`

```js
require('./table-management-routes')({ app, team, extras: merchantExtras, ops: teamOps, assignments: teamAssignments,
  resolveStore: merchantOps.resolveStore, requireMerchant: merchantRoutes.requireMerchant, checkSameOrigin,
  apiError, audit: (role, req, entry) => store.addAudit({ actor: `${req.merchant?.displayName || 'Marchand'} (@${req.merchant?.username || ''})`,
    actorType: 'merchant', actorId: req.merchant?.id || '', action: entry.action, entityType: 'merchant_service_point',
    entityId: entry.entityId || '', summary: entry.summary || '', result: 'success', metadata: entry.metadata || null }), store });
require('./member-accounts-routes')({ app, team, extras: merchantExtras, assignments: teamAssignments,
  resolveStore: merchantOps.resolveStore, requireMerchant: merchantRoutes.requireMerchant, checkSameOrigin, apiError, store });
```

**Ordre important :** ce montage doit rester **après** `merchantOps` (il utilise
`merchantOps.resolveStore` et les affectations d'équipe déjà construites).

> La règle de la mission 5 — « la création et la gestion des QR sont réservées au PDG » — est
> conservée : le marchand ne dispose d'**aucune** route de création de QR. Le QR d'une table est
> celui qui a été créé avec la table et il reste valable à vie.

## 4. Redémarrage

```bash
npm restart        # ou : systemctl restart oymike   /   pm2 restart oymike
```

Au démarrage, le serveur doit afficher la ligne habituelle d'écoute. Vérification rapide :

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/table-management.js   # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/member-accounts.js    # 200
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/merchant/sw.js        # 200
```

## 5. Après le déploiement (une seule fois par appareil)

- Espace marchand et espace équipe : **recharger la page**. Le nouveau service worker
  (`oymike-merchant-shell-v6`) supprime l'ancien cache et sert désormais les scripts depuis le
  réseau : un correctif futur s'appliquera au premier rechargement.
- Si un iPhone garde une ancienne version : Safari → Réglages du site → *Effacer les données du
  site*, puis rouvrir.

## 6. Tests automatiques

```bash
npm test                                                     # suite complète
node --test test/mission12-tables-comptes.test.js            # 9 garde-fous mission 12
```

## 7. Retour arrière (si nécessaire)

1. Remettre `public/` depuis `sauvegarde-public-avant-mission12.tgz`.
2. Retirer les deux lignes de branchement de `server.js` et le fichier ajouté dans la boucle de
   `store.js`.
3. Supprimer les trois fichiers serveur ajoutés.
4. Restaurer la base **seulement si nécessaire** : `psql "$DATABASE_URL" < sauvegarde-avant-mission12.sql`.
   Les colonnes ajoutées par la mission 12 ne gênent pas une version antérieure : la restauration
   n'est utile qu'en cas d'incident grave.
