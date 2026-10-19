# QRia — Administration centralisée des QR codes

QRia est une application web en français où le PDG conserve le contrôle complet et peut déléguer un périmètre limité à plusieurs gestionnaires. Les comptes, permissions et activités sont contrôlés côté serveur; il n’existe aucune inscription publique.

## Fonctionnalités

- Le PDG et les Gestionnaires utilisent le même lien principal (`/`) pour se connecter; le rôle est résolu côté serveur. Après authentification, le Gestionnaire ouvre son espace isolé à `/manager` sur le même domaine. Les valeurs de domaines personnalisés déjà enregistrées sont conservées mais ne pilotent pas l’authentification ni le routage.
- Le PDG crée/modifie les comptes gestionnaires (nom, téléphone, e-mail et photo), peut les suspendre, bloquer, réactiver ou supprimer logiquement; les QR et les données commerciales/financières restent conservés. Les changements de statut et suppressions révoquent les sessions immédiatement côté serveur.
- Les actions sensibles (réinitialisation, révocation de sessions, changement de statut et suppression logique) demandent de retaper l’identifiant du compte ciblé et de vérifier à nouveau le mot de passe PDG. Le PDG peut émettre un mot de passe temporaire de 24 h (changement forcé avant tout accès) ou un lien à usage unique de 30 min. Comme aucun e-mail/SMS n’est configuré, le secret est affiché une seule fois au PDG pour transmission sécurisée.
- Les événements de sécurité (dernière connexion, réinitialisations, changements de mot de passe, suspensions, blocages, réactivations et révocations) sont consultables dans les activités des gestionnaires. Les journaux ne contiennent aucun mot de passe ni jeton de réinitialisation.
- QRia propose « Installer l’application » dans les espaces du PDG et des Gestionnaires. Le manifeste principal utilise les icônes du nouveau logo QRia en PNG 180/192/512 et maskable; les manifestes Gestionnaire gardent un lien et une identité d’installation personnels mais utilisent le même logo de marque. Les photos personnelles des Gestionnaires restent stockées et affichées séparément dans leur profil et leur compte; elles ne sont pas utilisées comme logo global ni exposées par l’icône d’installation. Les workers racine et Gestionnaire sont réseau uniquement et ne mettent en cache aucune session, aucun QR ni aucune donnée métier. L’état d’installation est local à l’origine/identité de l’application et à l’appareil/navigateur (événements d’installation, mode autonome, API des applications associées quand disponible et marqueur local); aucune préférence n’est enregistrée au compte ou en base. Sur iPhone, Safari reçoit les instructions Partager → « Sur l’écran d’accueil » → « Ajouter »; iOS ne permet pas de vérifier depuis un onglet Safari qu’une icône a déjà été ajoutée, les instructions peuvent donc rester visibles dans Safari normal. Une icône installée peut nécessiter une réinstallation pour refléter les changements de logo.
- Nouvelle identité visuelle professionnelle : logo fourni noir et or recadré/redimensionné proportionnellement, variables de thème dans `public/brand-theme.css`, palette `#111111`, `#1C1C1C`, `#D4AF37`, `#F2D675`, `#FFFFFF` et `#F3F3F3`. Le thème est partagé entre connexion, espaces PDG/Gestionnaires, générateur, pages publiques, impression, favicons et écrans d’installation; les QR historiques et photos personnelles restent préservés.
- Les gestionnaires ont leurs propres identifiants; ils ne peuvent pas créer de compte, voir les réglages ni appeler les fonctions PDG. Chaque API gestionnaire vérifie le statut et le périmètre à chaque requête.
- Les QR sont attribués individuellement par le PDG; il peut les réattribuer sans ouvrir le compte du gestionnaire. Le PDG garde toujours accès à tous les bénéficiaires et QR.
- Circuit QR réel, contrôlé côté serveur : **Brouillon**, **En attente de validation**, **Actif**, **Suspendu** et **Refusé**. Le PDG choisit par gestionnaire si la publication peut s’activer directement ou doit être validée; la règle est vérifiée par l’API et dans la transaction de création. Suspension et refus PDG exigent un motif; chaque soumission, validation, activation, suspension et refus est journalisé avec l’acteur, l’heure, l’état et le motif.
- Le PDG peut définir pour chaque compte les droits de création et de modification, l’activation autonome et une limite de QR (0 = illimitée). Le contrôle de limite est transactionnel en PostgreSQL et vérifié dans le stockage JSON local; il ne supprime aucun QR existant si la limite est réduite. Les comptes antérieurs conservent leur capacité de publication historique lors de la migration; les nouveaux comptes sont soumis à validation par défaut jusqu’au choix du PDG.
- L’espace Gestionnaire réunit les QR par statut, scans, activité récente, notifications et messages privés du PDG. Il permet de créer, personnaliser, prévisualiser, rechercher, modifier selon les droits, télécharger et partager les QR. Une notification de décision inclut le motif lorsque le PDG en indique un.
- « Mon profil et paramètres » comprend les coordonnées, la photo personnelle, les préférences, l’affichage compact local, le changement sécurisé du mot de passe, l’invalidation des sessions, l’aide et les documents de référence. Un changement d’e-mail exige le mot de passe actuel; aucun mot de passe en clair n’est stocké ou exposé.
- Un gestionnaire ne voit que ses bénéficiaires/QR. Pour modifier ou désactiver le profil global d’un bénéficiaire partagé, tous ses QR non supprimés doivent lui être attribués; cela évite qu’un compte délégué affecte des QR hors périmètre.
- Journal serveur des connexions/déconnexions, changements de comptes et de statut, modifications des bénéficiaires/QR, statistiques, téléchargements, partages, impressions, décisions QR, messages du PDG et refus d’accès. Les instantanés d’audit omettent mots de passe, empreintes, tokens, URLs complètes et contenu libre potentiellement sensible.
- Tableau PDG « Activités des gestionnaires » : recherche, filtres par compte/action/résultat/entité/période, accès direct aux QR et bénéficiaires, diffs non secrets, alertes dans l’application configurables et export CSV.
- Tableau PDG « Finances et paiements » : chiffres commandés, encaissés bruts/nets, sommes déclarées en attente, soldes, impayés, modes et ventes par gestionnaire; filtres par période, gestionnaire, client, entreprise, QR, type de client et mode; export CSV.
- Le PDG configure le catalogue de tarifs et d’options dans le tableau, sans tarif prédéfini. À chaque nouvelle création QR, le serveur valide le tarif, calcule le total et fige les montants/options dans une commande à référence unique; changer un tarif ne recalcule jamais une vente passée.
- Les commandes espèces démarrent « non payé ». Le gestionnaire déclare le montant réellement reçu, la date et le nom du payeur; seule une validation PDG transforme cette déclaration en encaissement, avec prise en charge du partiel, du solde, du rejet et de l’historique des corrections.
- Aucun prestataire de paiement électronique n’est connecté. Les flux électroniques restent indisponibles et ne sont jamais affichés comme payés; les références prestataire sont dédupliquées par contrainte unique en base et aucun PIN/secret n’est conservé.
- Le journal PostgreSQL est append-only pour l’application. Exportez les rapports et incluez la table `audit_logs` aux sauvegardes PostgreSQL; aucun effacement automatique n’est configuré. L’archivage historique doit être réalisé par un administrateur de base de données après export et sauvegarde vérifiés.
- Connexion réservée au PDG et aux gestionnaires créés par le PDG — aucun compte bénéficiaire ni inscription publique.
- Création, recherche et modification des bénéficiaires et QR codes; filtres de statut dans le tableau de bord.
- Bénéficiaires : blocage/déblocage réversible; un blocage rend immédiatement indisponibles tous leurs QR sans modifier le statut individuel de chaque code. La suppression logique désactive leurs QR et conserve scans et audit.
- QR codes : blocage/déblocage indépendant par code et suppression logique, avec conservation de l’historique.
- Plusieurs codes par bénéficiaire, catégories personnalisables, identifiant public unique et journal de modifications.
- Pages QRia mobiles modifiables après impression, ou redirection modifiable vers un site externe.
- Choix des champs visibles par QR : photo/logo, téléphone, WhatsApp, e-mail, adresse, localisation, site, réseaux, présentation, offres, tarifs, documents et liens utiles.
- Photos de profil/logo et galerie de jusqu’à 8 photos par bénéficiaire; sélection des images à afficher sur chaque QR. Aucune limite de taille de fichier source n’est imposée par le formulaire : les images que le navigateur sait lire sont automatiquement redimensionnées et compressées avant enregistrement.
- Taille générale des textes publics, avec choix différent par QR et adaptation responsive sur mobile.
- Compteur persistant de chaque ouverture valide, totaux par QR et bénéficiaire, filtres sur 7, 30, 90 jours ou depuis le début; actualisation automatique du tableau de bord.
- Téléchargement PNG/SVG, copie du lien, impression et comptage des ouvertures/scans.
- Tableau paginé et recherche côté serveur, adapté aux grands répertoires.
- La page publique n’affiche que les champs et photos sélectionnés. Les statistiques ne stockent ni adresse IP ni agent utilisateur.
- Le générateur local historique (lien/texte/Wi-Fi, PNG/SVG) est conservé sous `/generator.html`.

## Lancer en local

Node.js 20 ou plus récent est requis.

```bash
npm install
npm start
```

Ouvrir `http://localhost:3000`. Sans `DATABASE_URL`, l’aperçu local enregistre ses données dans `data/store.json` et utilise le compte de démonstration `admin` / `admin1234`. Ce mode JSON et ce compte ne doivent pas être utilisés pour un déploiement public.

Pour utiliser une base PostgreSQL en local, créez un fichier `.env` à partir de `.env.example`, renseignez `DATABASE_URL`, `ADMIN_USERNAME`, `ADMIN_PASSWORD` et `SESSION_SECRET`, puis lancez `npm start`. Le schéma et les index sont créés automatiquement au démarrage.

## Déploiement Render + Neon

Cette version possède une API et une authentification : déployez-la comme **Web Service Node**, pas comme Static Site.

1. Pour mettre à jour un service existant, publiez dans son dépôt Git l’ensemble du code source de ce dossier (notamment `package.json`, `package-lock.json`, `server.js`, `manager-routes.js`, `finance-routes.js`, `finance-store.js`, `store.js`, `schema.sql`, `test/` et `public/`). N’incluez ni `.env`, ni `node_modules/`, ni les données locales de `data/`.
2. Sur Render, déployez le service Web existant relié à ce dépôt; ne créez pas un second service ou une nouvelle base pour cette mise à jour.
3. Réglages si les fichiers sont à la racine du dépôt :
   - **Root Directory** : vide
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
4. Dans **Environment**, ajoutez les variables suivantes :
   - `NODE_ENV` = `production`
   - `DATABASE_URL` = chaîne de connexion PostgreSQL Neon (à copier depuis **Connect** dans Neon)
   - `ADMIN_USERNAME` = l’identifiant de l’administrateur (au moins 3 caractères)
   - `ADMIN_PASSWORD` = son mot de passe fort, d’au moins 12 caractères
   - `SESSION_SECRET` = une chaîne aléatoire secrète d’au moins 32 caractères
   - `PUBLIC_BASE_URL` = facultatif; ne l’ajoutez qu’après avoir relié et vérifié votre domaine personnel sur Render. Valeur : `https://votre-domaine-réel` (sans chemin); laissez vide tant que vous n’avez pas de domaine.
5. Enregistrez et déployez. La base doit être accessible au service Render; QRia crée les tables et index au premier démarrage sans effacer les données existantes.

### Domaine personnalisé (facultatif)

Render ne permet pas de remplacer son adresse par une adresse choisie sans posséder et configurer un domaine. Achetez ou utilisez un domaine qui vous appartient, ajoutez-le dans les réglages du Web Service Render (**Custom Domains**), puis configurez exactement les enregistrements DNS indiqués par Render et attendez le certificat HTTPS. Ensuite, ajoutez `PUBLIC_BASE_URL=https://votre-domaine-réel` dans **Environment** et redéployez. QRia utilisera ce domaine pour les nouveaux QR et redirigera les anciens liens Render vers lui. Pour que l’aperçu du scanner n’affiche jamais l’URL Render, les anciens QR déjà imprimés doivent être réimprimés après activation du domaine, car leur image contient déjà l’ancienne adresse.

Ne mettez jamais `.env`, `DATABASE_URL`, le mot de passe administrateur ni `SESSION_SECRET` dans GitHub. Ils vont uniquement dans les variables d’environnement Render.

### Mise à jour PWA et branding — publication manuelle requise

L’audit de production du 16 octobre 2026 a confirmé que `https://qr.oymiketech.com/` répond en HTTPS et que `/api/health` annonce PostgreSQL actif. La page racine ne référence aucun manifeste; `/manager` pointe seulement vers un manifeste de données vide (`{}`); aucune des deux pages ne contient le bouton d’installation ni ne charge le contrôleur PWA. Les chemins `/manifest.webmanifest`, `/sw.js`, `/pwa-install.js`, `/pwa-install.css` et `/icons/qria-192.png` renvoient HTTP 404. La cause observée est donc une version de l’application non mise à jour dans Render, pas une absence de HTTPS ni un problème de compte. Render/GitHub ne sont pas pilotables depuis cette session; aucun déploiement ou changement DNS n’a été effectué.

Pour publier la version préparée, mettre à jour le code source du dépôt déjà relié au Web Service Render existant (ne pas créer un service/base distincte), puis lancer un déploiement du commit sur la branche déjà utilisée. Conserver sans modification les variables d’environnement, la base PostgreSQL, `PUBLIC_BASE_URL`, les domaines personnalisés, les identifiants, rôles et permissions; aucun changement DNS n’est requis pour corriger ces 404 si le domaine continue déjà de servir ce même Web Service. Après le déploiement, contrôler que les routes ci-dessus répondent HTTP 200 (manifeste en `application/manifest+json`, worker en JavaScript, icônes en PNG), puis réaliser les essais natifs sur ordinateur, Android et iPhone/Safari. Les tests unitaires ne remplacent pas ces essais sur appareils réels.

### Connexion partagée PDG / Gestionnaire

Le PDG et les Gestionnaires commencent sur le même lien principal (`/`) et saisissent leur identifiant et leur mot de passe habituels. Le serveur vérifie le compte et déduit son rôle à partir de celui-ci; le navigateur et le nom d’hôte ne choisissent pas le rôle. Après connexion, un Gestionnaire est dirigé vers son espace personnel (`/manager`) sur le même domaine. Les permissions et données restent limitées à son compte; les comptes suspendus ou bloqués sont refusés côté serveur.

Les domaines personnalisés déjà enregistrés pour des Gestionnaires sont conservés, mais ne servent pas à la connexion ni au routage des espaces. Aucun sous-domaine Gestionnaire ou changement DNS/Render n’est requis pour cette connexion partagée. `PUBLIC_BASE_URL` reste réservé aux liens publics/QR et n’a pas à être modifié pour ce changement.

Après déploiement, connectez-vous comme PDG, ouvrez **Gestionnaires**, créez un compte avec un mot de passe initial d’au moins 12 caractères, puis attribuez les QR voulus depuis la table **Codes QR**. Communiquez les identifiants directement et de manière sûre. Les événements d’alerte sont affichés dans le tableau de bord; aucun fournisseur d’e-mail/SMS n’est configuré.

## Tests

```bash
npm test
```

Les tests d’intégration démarrent un serveur local avec un fichier JSON temporaire (`QRIA_STORE_FILE`) et ne touchent pas à `data/store.json` ni à une base Neon. Ils couvrent les comptes et photos isolés, les liens d’installation, les modifications de profil, la réauthentification PDG, les réinitialisations par mot de passe temporaire et lien à usage unique, les deux expirations, l’obligation de choisir un nouveau mot de passe, la révocation de toutes les sessions, les permissions, l’attribution, les statuts/révocations, la confirmation renforcée avant suspension, blocage et suppression, la création QR avec un tarif de fixture, les espèces intégrales/partielles, le rejet et l’approbation PDG, la correction auditée, l’annulation et le remboursement partiel, les commandes impayées, l’absence de prestataire électronique, l’immuabilité des prix historiques, les totaux et filtres financiers, l’export CSV et la conservation des QR/journaux après suppression logique. Une suite dédiée vérifie aussi les sept scénarios QR/profil (brouillon, attente, activation serveur, décisions motivées, limites, permissions, isolation, notifications, audit et changement de mot de passe) ainsi qu’une migration JSON non destructive de comptes, photos, QR, scans et historique existants.

Les tests PWA vérifient aussi le manifeste racine, ses icônes et le service worker réseau uniquement; les manifestes personnalisés des Gestionnaires; l’état local séparé par origine et identité d’application; l’affichage/masquage par état simulé; les guides Android, ordinateur, iPhone et navigateur non pris en charge; et la limite de détection Safari iOS. Ils ne remplacent pas les essais d’installation sur appareils réels.

## Architecture

- `server.js` : serveur Express, sessions séparées PDG/gestionnaire, contrôles d’accès à chaque requête et liens publics `/r/:code`.
- `manager-routes.js` : gestion PDG des comptes/attributions, avatars et liens PWA, espace gestionnaire à périmètre limité, journal, alertes et export CSV.
- `finance-routes.js` / `finance-store.js` : catalogue tarifaire, devis serveur, commandes, déclarations, revue PDG, corrections, agrégats et export financier.
- `store.js` : stockage PostgreSQL via `pg` en déploiement; stockage JSON local uniquement pour l’aperçu et les tests.
- `schema.sql` : bénéficiaires, catégories, QR codes, scans, comptes gestionnaires, attributions, commandes/paiements, événements financiers append-only et journal d’audit append-only.
- `public/manager/sw.js` : service worker limité à l’espace gestionnaire; aucune donnée de session ou financière n’est mise en cache.
- `public/index.html` : tableau de bord PDG; `public/manager.html` : espace gestionnaire distinct.
- `public/profile.html` : page mobile publique d’un QR hébergé.
- `public/generator.html` : ancien générateur autonome conservé.
- Les QR hébergés encodent une URL stable `/r/<identifiant>`. Modifier la page ou la destination n’oblige donc pas à réimprimer le QR.
