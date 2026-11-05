# Bilan de la refonte Oymike QR

**Date : 5 novembre 2026**  
**Projet :** `/home/user/qr-studio`  
**Périmètre de vérification :** dépôt local et stockage JSON temporaire uniquement. Aucun déploiement Render ni test sur PostgreSQL de production n’a été effectué.

## Résumé

Le projet existant a été enrichi sans réinitialiser ses tables ni remplacer son stockage. Un assistant commun au PDG et aux Gestionnaires couvre la création, l’édition, la présentation et la publication volontaire de pages QR dynamiques. Les fonctions financières et le registre d’espèces préexistants ont été conservés.

À la dernière validation : **9 tests automatisés passent, 0 échec**. Le test d’intégration des pages a également redémarré un serveur relié au même fichier JSON temporaire et vérifié la conservation du QR, du prix, du compteur de scans et de photos d’exemple. Cela démontre la persistance du mode JSON testé, pas celle d’un environnement Render/PostgreSQL réel.

## Fonctions livrées ou conservées

- **Assistant partagé** dans l’espace PDG et l’espace Gestionnaire, avec création et modification d’un QR existant. Il garde le rattachement au bénéficiaire et respecte le périmètre autorisé de l’utilisateur connecté.
- **Choix par secteur** dans `public/qr-templates.js` : restauration, commerce, hébergement/tourisme, professionnels, éducation, santé/bien-être, organisations, particuliers et autres usages, dont « Autre activité ». Les modèles réutilisent des champs communs et des sections contextuelles.
- **Restaurant et catalogue** : catégories, plats/produits, prix en FCFA, disponibilités, promotions à prix inférieur, libellé promo, portions/variantes, options et photos. La mise à jour d’un prix conserve l’identifiant public du QR dans le test d’intégration.
- **Pages adaptées** : carte de visite, boutique, école/formation, hébergement, événement, services, galerie, redirection et autres modèles. Les réservations, inscriptions et rendez-vous renvoient vers un service externe fourni par l’utilisateur; Oymike QR ne prétend pas traiter ces opérations.
- **Commande restaurant** : le bouton WhatsApp n’est proposé que si le mode WhatsApp et le numéro correspondant sont fournis. Oymike QR ne stocke ni ne traite la commande. Aucun paiement en ligne n’a été ajouté.
- **Personnalisation de la page** : palettes, couleurs, mise en page, police, taille de texte, alignement, logo/couverture, éléments et galerie avec légendes, photo principale, ordre et retrait. Le serveur vérifie les couleurs/contrastes et contrôle les images reçues.
- **Aperçu** : rendu public réutilisé dans l’assistant, formats téléphone/ordinateur, et distinction entre brouillon/aperçu et page publiée. Les actions externes du rendu d’aperçu sont neutralisées.
- **QR imprimable** : choix distinct des couleurs et du dessin des modules du QR, niveau de correction, PNG/SVG et parcours d’impression déjà reliés aux écrans. L’impression physique et un scan par caméra n’ont pas été essayés dans un vrai navigateur/appareil.
- **Publication volontaire** : le mode brouillon ne rend pas la page publique; la publication se fait via une action explicite. Les statuts de suspension/refus du PDG restent prioritaires côté serveur.
- **Générateur autonome historique** : conservé pour les QR statiques. Son interface avertit maintenant que son contenu ne se modifie pas après impression et qu’il ne suit pas les scans; elle oriente vers le studio pour une page dynamique.
- **Statistiques et contrôle d’accès** : compteur et accès public actif, contrôles de création/attribution du Gestionnaire, suspension de son compte et contrôle de statut par le PDG vérifiés dans le test d’intégration.
- **Finances préexistantes** : tarif déterminé côté serveur, création sans règlement préalable, déclaration espèces séparée d’une réception vérifiée et corrections auditées restent couverts par les tests existants. Aucun montant fictif n’a été ajouté au wizard.
- **Identité** : libellés visibles harmonisés en « Oymike QR »; les chemins et espaces de noms historiques d’icônes/stockage ne sont pas renommés afin de limiter les ruptures de compatibilité.

## Matrice des 15 axes de validation

La matrice ci-dessous regroupe les parcours de réception mémorisés pour cette refonte. **Ce ne sont pas 15 suites autonomes** : plusieurs axes sont couverts dans le même test d’intégration. La mention « partiel » indique une preuve de code/route ou un smoke test, et non un test de rendu/téléchargement en navigateur réel.

| # | Axe | Résultat observé |
|---:|---|---|
| 1 | Modèle restaurant, menu, prix, portions, options et promotion | **Réussi** — création et données relues via API HTTP. |
| 2 | Modification d’un prix sans changement du QR imprimable | **Réussi** — `publicCode` identique après édition, nouveau prix public. |
| 3 | Modèle boutique/catalogue | **Réussi** — création et modèle relus via API. |
| 4 | Modèle école/formation | **Réussi** — création et modèle relus via API. |
| 5 | Carte de visite numérique | **Réussi** — création et modèle relus via API. |
| 6 | Brouillon invisible avant décision volontaire | **Réussi** — tentative de lecture publique rejetée. |
| 7 | Publication volontaire d’une page dynamique | **Réussi** — page publique disponible après publication. |
| 8 | Scan/ouverture et compteur/statistiques | **Réussi** côté API — ouverture publique puis compteur vérifié. Pas de lecture caméra réelle. |
| 9 | Images, validation serveur et conservation | **Réussi dans le test JSON** — signature PNG, image article et galerie; image servie et retrouvée après redémarrage. Pas de test PostgreSQL/Render. |
| 10 | Téléchargement PNG | **Partiel** — parcours et code de rendu présents; téléchargement de fichier non automatisé dans un vrai navigateur. |
| 11 | Téléchargement SVG | **Partiel** — fonction et chemin du renderer présents; fichier produit non validé par lecteur SVG/scanner externe. |
| 12 | Impression | **Partiel** — page et script d’impression HTTP 200; boîte de dialogue et imprimante non testées. |
| 13 | Permissions et isolement Gestionnaire | **Réussi** côté API — espace protégé, création permise sans validation PDG préalable ni paiement; restrictions testées. |
| 14 | Suspension Gestionnaire et contrôles PDG | **Réussi** côté API — session gestionnaire refusée après suspension; suspension/réactivation du QR contrôlée par le PDG. |
| 15 | Ancien QR sans `profileData` | **Réussi** — ancien format reste lisible; données/historique conservés. |

Les autres validations à mener pour clore formellement la demande sont des essais distincts sur les 15 parcours, ainsi que les rendus/téléchargements/impressions avec navigateur et caméra réels. Le test HTTP ne remplace pas ces essais.

## Base de données, migrations et conservation

- `schema.sql` ajoute `profile_data` en `JSONB` avec `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, ainsi que des champs QR complémentaires de façon additive. Aucune instruction de réinitialisation/suppression de table n’a été ajoutée. La migration de statut remplace une contrainte (`DROP CONSTRAINT IF EXISTS`) sans supprimer les lignes métier.
- L’ancien QR sans profil dynamique garde son rendu historique; le modèle de profil est une extension conditionnelle.
- Le test d’intégration utilise un **fichier JSON temporaire hors du dépôt**, et non `data/store.json` ni PostgreSQL. Il vérifie la conservation après arrêt/redémarrage du processus.
- Les images sont validées côté serveur puis conservées dans les données JSON de page/QR. La persistance durable après redéploiement dépend du backend configuré; elle n’a pas été prouvée sur Render ou PostgreSQL dans cette session.
- Ne pas appliquer de remise à zéro de base. Pour une mise en production, sauvegarder d’abord la base actuelle puis vérifier les migrations additives sur une copie de données avant déploiement.

## Tests exécutés

- `npm test` : **9 réussites, 0 échec** à la dernière exécution complète enregistrée.
- `node --check` : validé pour le serveur, les routes gestionnaire, le stockage, les scripts frontaux modifiés et le test d’intégration. Les derniers changements de wizard/test sont également contrôlés par `node --check` du test ciblé et par son exécution.
- `node --test test/qr-profile-workflow.test.js` : **1 réussite** après ajout des scénarios image/persistance.
- Serveur de démonstration lancé sur `0.0.0.0:3000`, avec `QRIA_STORE_FILE=/tmp/oymike-qr-agent-preview-store.json`; routes principales testées HTTP 200. Ce serveur n’est pas le déploiement du produit et n’utilise pas la base de production.
- Pas de pilotage de navigateur réel, pas d’essai matériel d’impression/scanner, pas de connexion PostgreSQL de production, pas de test de persistance Render après redéploiement.

## Limites et suites recommandées

1. Réaliser les 15 essais de réception dédiés dans un navigateur réel; contrôler téléphone/ordinateur, téléchargement PNG/SVG, ouverture caméra et impression.
2. Répéter les tests de migration et conservation sur une **copie sauvegardée** de PostgreSQL; tester ensuite les droits et la persistance d’images sur l’instance réellement visée.
3. Vérifier le stockage durable des photos en production. Le JSON local et le système de fichiers éphémère d’un hébergeur ne sont pas des preuves de durabilité après redéploiement.
4. Vérifier le déploiement et les variables Render manuellement. **Aucun déploiement Render ni changement de base/domaine n’a été effectué ici.**
5. Revoir la CSP : `style-src 'unsafe-inline'` reste autorisé; son durcissement nécessite de valider les composants historiques qui injectent des styles.
6. Des options complémentaires (expiration/PIN, archivage/duplication, langues FR/EN et plusieurs URLs d’installation multi-tenant) ne sont pas revendiquées comme nouvellement livrées par cette étape.

## Fichiers principaux

- `public/qr-wizard.js`, `public/qr-wizard.css` — assistant partagé, champs, validation, aperçu, styles et photos.
- `public/qr-templates.js` — registre extensible des secteurs/modèles et palettes.
- `public/qr-profile-renderer.js`, `public/qr-profile.css` — rendu public également réutilisé par l’aperçu.
- `server.js`, `manager-routes.js`, `store.js`, `schema.sql` — validation, accès, conservation et migration additive.
- `test/qr-profile-workflow.test.js` — scénarios HTTP d’intégration des profils, accès et conservation.
- `README.md` — lancement, architecture et précautions de déploiement.
