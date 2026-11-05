# Données locales exclues du colis source

`store.json` est un magasin de données local et peut contenir des comptes, QR et historiques. Il est volontairement exclu des archives de code source.

Avant d’exécuter l’application avec un ancien magasin JSON local, faites une copie de sauvegarde et restaurez ce fichier séparément dans le dossier `data/`. Pour une mise à jour de production, ne remplacez pas la base existante : connectez le service déjà déployé à sa base existante et vérifiez les migrations additives. Ne commitez jamais les données, `.env` ou les secrets.
