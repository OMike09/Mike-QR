# Rapport d’étape — audit QR Oymike Tech

**Date : 10 octobre 2026**  
**Statut : corrections locales testées; audit global et déploiement non terminés.**

## Résumé exécutif

Deux risques concrets ont été corrigés localement, sans migration ni modification des données métier :

1. Le wizard QR gardait le formulaire, l’étape, les médias et la clé d’idempotence uniquement en mémoire. Une actualisation ou une coupure avant confirmation pouvait donc empêcher la reprise. Le wizard possède maintenant un brouillon local progressif, restaurable et verrouillé lors d’une tentative dont le résultat serveur reste incertain.
2. `JsonStore.init()` traitait une erreur de syntaxe JSON comme un fichier absent, puis pouvait sauvegarder un état vide par-dessus le fichier existant. Une erreur de JSON invalide arrête maintenant l’initialisation sans modifier le fichier.

**Vérification locale : `npm test` — 32 tests réussis, 0 échec.** Un test a aussi exécuté le vrai serveur Express avec un magasin JSON temporaire et vérifié le parcours bénéficiaire → QR → URL publique après des réponses volontairement abandonnées par le client. Ce n’est pas une vérification de la base PostgreSQL de production ni une coupure réseau physique.

**Production : aucun déploiement n’a été effectué.** Le code de reprise ajouté localement n’est pas présent dans les fichiers JavaScript servis actuellement par `qr.oymiketech.com`. Les routes publiques PDG, gestionnaire et marchand répondent actuellement avec leurs pages distinctes, mais les connexions authentifiées et les données de production n’ont pas été testées.

## Causes et niveau de certitude

### Création QR

- **Limitation confirmée à la lecture du code :** `clientRequestId`, formulaire, étape et photos vivaient dans l’état mémoire de `public/qr-wizard.js`. Ils disparaissaient avec le document.
- **Piste d’interruption de session :** les wrappers d’API PDG et gestionnaire masquent l’espace de travail lors d’un `401`. Cela pouvait interrompre visuellement le parcours, mais **aucun incident réel de session expirée en production n’a été reproduit**; cette piste ne doit pas être présentée comme cause racine prouvée.
- Les clés d’idempotence déjà utilisées par les routes et les index uniques existants permettent de rejouer une création. Le problème était que le navigateur ne conservait pas assez d’état pour réutiliser sûrement la même demande après rechargement.

### Stockage JSON local

- **Risque confirmé dans le code, perte réelle non observée :** `ENOENT` et `SyntaxError` empruntaient la même branche d’initialisation vide et de sauvegarde.
- Aucun fichier de production corrompu n’a été lu ou réparé. Le test utilise des fichiers temporaires.

## Corrections locales

### Brouillons et reprise QR

`public/qr-wizard.js` enregistre désormais progressivement un brouillon versionné, par rôle et identité de compte, avec :

- étape, modèle et saisie du profil;
- médias optimisés, photos, thème et données d’éléments;
- bénéficiaire créé, clé `clientRequestId`, mode de soumission et empreinte de l’intention;
- reprise après rechargement et fermeture de session, lorsque le navigateur conserve son stockage local.

Les petites sauvegardes utilisent `localStorage`; les brouillons dépassant le seuil local utilisent IndexedDB, avec repli et erreur explicite si aucune sauvegarde durable n’est possible. Les champs sont verrouillés lorsqu’une demande a pu atteindre le serveur sans réponse confirmée : seule la même action et le même contenu peuvent être rejoués. Le brouillon est supprimé après confirmation du QR. Un brouillon ordinaire peut être supprimé explicitement; une demande indéterminée ne peut pas être abandonnée par cette action, afin d’éviter un second QR.

Ces brouillons restent sur le navigateur et ne sont ni synchronisés ni chiffrés par l’application. Le périmètre par rôle/compte évite les collisions ordinaires, mais il ne protège pas les données d’un appareil ou d’un profil navigateur partagé; utiliser un appareil de confiance et se déconnecter reste nécessaire.

Les wrappers PDG/gestionnaire transmettent maintenant l’identité de brouillon et conservent le statut HTTP sur les erreurs. `public/qr-wizard.css` met en forme l’état de récupération et de sauvegarde locale.

### Protection du magasin JSON

`store.js` distingue maintenant fichier absent et JSON invalide. Un fichier absent est initialisé comme auparavant. Un JSON invalide déclenche `JSON_STORE_INVALID`, conserve le fichier original et empêche le serveur de poursuivre avec un magasin vide. Aucun fichier de récupération automatique ni copie de sauvegarde n’est créé : la récupération du contenu endommagé reste une intervention séparée.

## Fichiers modifiés

- `store.js` — séparation `ENOENT`/JSON invalide; arrêt non destructif sur corruption.
- `public/qr-wizard.js` — brouillons durables par navigateur, récupération de l’étape et des médias, clé d’idempotence stable, verrouillage/rejeu d’une tentative incertaine.
- `public/admin.js` — périmètre de brouillon PDG et statut HTTP sur les erreurs d’API.
- `public/manager.js` — périmètre de brouillon par gestionnaire et statut HTTP sur les erreurs d’API.
- `public/qr-wizard.css` — présentation du statut et du panneau de reprise.
- `test/json-store-recovery.test.js` — tests du fichier corrompu préservé et du magasin absent initialisé.
- `test/qr-wizard-recovery.test.js` — deux rechargements simulés, photos et chemin IndexedDB avec un adaptateur de test.
- `test/qr-wizard-real-api-recovery.test.js` — serveur Express réel local, magasin JSON temporaire, réponses volontairement abandonnées après commit, idempotence et URL publique.
- `test/qr-theme-editor.test.js` — assertion adaptée au verrouillage sûr pendant une demande QR dont le résultat est incertain.

## Résultats de tests locaux

- `npm test` : **32/32 réussis**, 0 échec, 0 test ignoré; durée environ 59 secondes.
- JSON corrompu : test confirme que le contenu original reste identique, qu’aucun état vide ni fichier temporaire n’est écrit, et que le magasin ne s’initialise pas en mémoire.
- Flux de reprise en navigateur simulé : photos, formulaire, étape et clé survivent à deux rechargements simulés; le faux serveur de test ne crée qu’un bénéficiaire et un QR.
- Flux avec serveur réel local : les routes Express et le stockage JSON temporaire enregistrent réellement un bénéficiaire puis un QR. Le client de test abandonne volontairement la réponse après le commit serveur; la reprise reçoit la même ressource via idempotence. Le test vérifie le lien `publicCode`, le contrôle public et la route `/r/:code`.
- La perte de réponse du test local est **injectée dans l’adaptateur client après réception de la réponse HTTP réussie**; elle ne reproduit pas une coupure physique de réseau ni l’expiration d’une session réelle.
- Aucun `DATABASE_URL`/accès PostgreSQL, aucune migration réelle, aucun compte de production et aucun secret n’ont été utilisés ou lus par cette vérification.

## Vérifications HTTP de production, sans écriture

Contrôles GET publics effectués sur le domaine déjà configuré :

- `/merchant/` : 200, titre de l’espace marchand.
- `/admin/` : 200, titre PDG.
- `/manager/` : 200, titre gestionnaire.
- `/merchant-control/` : 200, titre de gestion des marchands.
- `/api/health` : 200, `ok=true`, `demoMode=false`; l’endpoint déclare PostgreSQL comme mode de stockage. Cela **ne prouve pas** une lecture/écriture réussie dans la base.
- Manifeste marchand : 200, `start_url=/merchant/`, `scope=/merchant/`, `display=standalone`, quatre icônes référencées.
- `/merchant/sw.js` et les icônes QRia 180, 192, 512 et maskable : 200.
- Les scripts publics de production `qr-wizard.js`, `admin.js` et `manager.js` ne contiennent pas le marqueur de cette correction locale. **La reprise locale n’est donc pas déployée sur la production.**

Ces vérifications ne comprennent pas de connexion avec de vrais identifiants, de commande réelle, d’installation sur téléphone, de push navigateur/OS, ni de contrôle d’accès en base PostgreSQL. La valeur du lien marchand enregistré dans l’environnement n’a pas été lue, publiée ou modifiée.

## Données, migrations, logo et déploiement

- Aucun changement à `schema.sql`; aucune migration.
- Aucun compte, marchand, QR, commande ou configuration de production modifié; aucun jeu de démonstration ajouté à l’application.
- Les tests serveur utilisent des magasins temporaires supprimés après exécution; le magasin local de développement n’a pas été remplacé.
- Aucun changement des manifestes, service workers ou icônes n’a été fait dans cette étape. Les ressources PWA actuellement servies répondent et gardent le périmètre marchand.
- Les icônes QRia existantes restent en place; l’aperçu recadré du logo fourni n’a pas été intégré ni utilisé pour remplacer les assets.
- Aucun DNS, Render ou service de production n’a été modifié. L’accès Render n’est pas disponible dans cette session et le dossier de travail n’est pas un dépôt Git exploitable pour un déploiement.

## Limites et prochaines étapes

1. Déployer la correction par la procédure autorisée, puis confirmer que les scripts en production contiennent le nouveau code; ce déploiement n’a pas été fait.
2. Reproduire avec un compte autorisé le scénario réel d’expiration/révocation de session, actualisation et reprise sur navigateur; confirmer côté serveur que le contenu et les photos restent exacts.
3. Exécuter le parcours gestionnaire complet contre le backend de production, y compris portée de compte, bénéficiaire → QR, soumission idempotente et URL publique, sans créer de données de test en production.
4. Vérifier par un accès autorisé la lecture/écriture PostgreSQL et la version/migration du schéma; aucun accès de base n’est disponible ici.
5. Continuer l’audit complet des suspensions immédiates, journaux protégés, commandes, notifications, statistiques et parcours PWA sur navigateur/appareil. Les tests locaux existants passent, mais ils ne remplacent pas la vérification de bout en bout en production.
6. Tester installation/hors ligne/push sur les appareils et navigateurs visés; le test HTTP du manifeste/service worker ne confirme pas les permissions navigateur ni la livraison par l’OS.

**Conclusion d’étape :** la perte de reprise due à l’état mémoire seul et l’écrasement potentiel d’un JSON corrompu ont des corrections locales testées. Le workflow est validé contre le serveur local en stockage JSON temporaire, pas contre la base ou les comptes réels. L’audit global ne peut pas être déclaré terminé avant déploiement contrôlé et vérifications de production ci-dessus.
