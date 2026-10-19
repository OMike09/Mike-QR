# QRia — bilan du colis d’étape QR / paiements en espèces

**État :** paquet de code source à vérifier avant mise en production. Il ne constitue pas une preuve de déploiement Render ni de fonctionnement sur la base PostgreSQL de production.

## Travaux intégrés

- Un gestionnaire autorisé peut créer un QR et l’activer sans accord préalable du PDG ni paiement préalable. La permission de création, le périmètre et les règles de suspension restent contrôlés côté serveur; le PDG peut toujours suspendre ou réactiver un QR selon les règles existantes.
- Un tarif applicable peut alimenter une commande et un solde, mais le paiement n’est pas un verrou de création. Sans tarif applicable, le QR peut être créé sans commande ni impayé artificiel. Un tarif à zéro est classé « Gratuit / non applicable » et reste filtrable.
- Les créations répétées portant le même identifiant de requête sont idempotentes, ce qui évite de créer des QR doublons après une relance de requête.
- L’espace Gestionnaire contient le registre « Bénéficiaires et paiements » : recherche, résumé, historique, déclarations partielles, soldes, statuts et filtre de période. La déclaration espèces exige une confirmation de réception réelle et enregistre le montant, la date, l’identité du déclarant, la référence/reçu facultatif et l’observation. Une attestation imprimable est disponible.
- L’espace PDG contient « Suivi des paiements en espèces » avec filtres, ventilation par gestionnaire, état des déclarations, soldes, historique et export CSV. Une déclaration du gestionnaire ne devient pas une réception vérifiée sans décision PDG.
- Les gestionnaires sont limités à leur propre périmètre; aucune route de suppression discrète des déclarations n’est ajoutée. Les corrections réservées au PDG demandent un motif et sont journalisées avec les valeurs avant/après.
- Les modifications au schéma sont additives (`ADD COLUMN IF NOT EXISTS`); aucune réinitialisation ou commande de suppression de données n’est incluse.

## Vérifications exécutées

- `npm test` : **8 tests réussis, 0 échec** (exécuté le 19 octobre 2026). Le test HTTP couvre notamment l’idempotence, l’absence de blocage par paiement, les tarifs gratuits/non applicables, le cloisonnement gestionnaire, les paiements partiels, le rapport et l’export CSV, ainsi que les corrections auditées.
- `node --check` réussi pour les fichiers JavaScript serveur, routes, stockage, interfaces et tests concernés.
- Smoke test DOM de l’éditeur Gestionnaire : avec un bénéficiaire et aucun tarif actif, le sélecteur de tarif n’est pas obligatoire, le formulaire reste disponible et le message annonce qu’aucun impayé n’est créé.
- Smoke test DOM du tableau PDG : contrôles de registre et de filtres présents, aucun contrôle d’approbation préalable de QR, aucune erreur JavaScript au chargement non authentifié.
- Les tests utilisent un magasin JSON temporaire et ne modifient pas `data/store.json`.

## Limites connues — à ne pas confondre avec du travail terminé

- L’éditeur publicitaire complet au niveau du QR (import multiple, aperçu, légende, photo principale, ordre, modification et retrait) reste à terminer. La validation serveur des fichiers fournis ne prouve pas que le parcours graphique est achevé.
- La persistance des photos après redémarrage/redéploiement n’a pas été vérifiée sur PostgreSQL/Render. Ne pas déclarer la partie photo prête à la production sur la seule base de ce colis.
- PostgreSQL réel, base Neon, déploiement Render, comptes de production, sauvegarde/restauration et appareils réels n’ont pas été testés dans cette session.
- L’archive exclut volontairement `data/store.json`, `.env`, `node_modules/` et toute donnée locale. Elle ne doit pas remplacer la base existante. Pour une mise à jour de production, conserver le service, la base et ses variables, effectuer une sauvegarde, appliquer le code à l’existant et vérifier les migrations additives avant déploiement.

## Contenu de l’archive

Code source et tests de `/home/user/qr-studio`, documentation, `package.json` / `package-lock.json`, `schema.sql` et fichiers publics. Les dépendances doivent être réinstallées avec `npm ci` ou `npm install`; aucun `node_modules/` n’est distribué.
