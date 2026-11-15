# COLIS N°05 — Connexions PDG, gestionnaire et marchand sur qr.oymiketech.com

## Résultat voulu

Un seul hôte pour les trois espaces, avec des pages et authentifications distinctes :

- Marchand : `https://qr.oymiketech.com/merchant/`
- PDG : `https://qr.oymiketech.com/admin/`
- Gestionnaire : `https://qr.oymiketech.com/manager/`
- Connexion PDG/gestionnaire avec choix de rôle : `https://qr.oymiketech.com/merchant-control/`

La racine `https://qr.oymiketech.com/` continue d’ouvrir la connexion marchand. Les routes PDG/gestionnaire ne sont pas présentées dans le formulaire marchand. Les comptes, sessions et contrôles d’accès existants sont conservés.

## Changements

- `server.js` ne redirige plus `/admin`, `/manager` et `/merchant-control` vers `/merchant/` sur l’hôte canonique.
- Les fichiers HTML d’accès direct sont redirigés vers leurs routes par rôle sur le même domaine.
- `PUBLIC_BASE_URL` n’est pas modifiée et aucune entrée DNS n’est nécessaire pour séparer les chemins.
- `test/merchant-commerce.test.js` vérifie les trois accès sur l’hôte `qr.oymiketech.com`, tout en confirmant que la connexion marchand n’affiche pas le sélecteur PDG/gestionnaire.

## Tests et limite de déploiement

- `npm test` : 28/28 réussis localement.
- `node --check server.js` et `node --check test/merchant-commerce.test.js` : réussis.
- Le contrôle public effectué avant déploiement de ce colis indique que `/admin/`, `/manager/` et `/merchant-control/` sur `qr.oymiketech.com` redirigent encore vers `/merchant/`.
- Le code de ce colis est local : il faut l’intégrer/déployer sur le service Render auquel `qr.oymiketech.com` est rattaché (`mike-qr1.onrender.com` selon la résolution DNS observée). Après déploiement, vérifier les quatre liens ci-dessus.
