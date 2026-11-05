# Oymike QR — Administration centralisée des QR codes

> **État au 5 novembre 2026 :** ajout du Studio PDG (modèles personnalisés versionnés, champs dynamiques, catégories, migration contrôlée et galerie persistée), intégration au wizard partagé, rendu public de ces champs et du pied de page, plus personnalisation/aperçu des QR imprimables. `npm test` passe **16/16**; `node --check` réussit pour les 32 fichiers JavaScript et `npm audit` signale **0 vulnérabilité**. Les tests d’intégration utilisent un stockage JSON temporaire avec arrêt/redémarrage; ils ne valident pas une base PostgreSQL ou Render réelle. Aucun déploiement ni scan physique n’a été effectué. Voir [`BILAN-REFONTE-QR-2026-11-05.md`](BILAN-REFONTE-QR-2026-11-05.md) pour le périmètre et les limites de ce colis, et [`BILAN-PERSONNALISATION-QR-2026-11-05.md`](BILAN-PERSONNALISATION-QR-2026-11-05.md) pour le travail visuel précédent.

Oymike QR est une application web en français où le PDG conserve le contrôle complet et peut déléguer un périmètre limité à plusieurs gestionnaires. Les comptes, permissions et activités sont contrôlés côté serveur; il n’existe aucune inscription publique.

## Fonctionnalités

- Le PDG et les Gestionnaires utilisent le même lien principal (`/`) pour se connecter; le rôle est résolu côté serveur. Après authentification, le Gestionnaire ouvre son espace isolé à `/manager` sur le même domaine. Les valeurs de domaines personnalisés déjà enregistrées sont conservées mais ne pilotent pas l’authentification ni le routage.
- Le PDG crée/modifie les comptes gestionnaires (nom, téléphone, e-mail et photo), peut les suspendre, bloquer, réactiver ou supprimer logiquement; les QR et les données commerciales/financières restent conservés. Les changements de statut et suppressions révoquent les sessions immédiatement côté serveur.
- Les actions sensibles (réinitialisation, révocation de sessions, changement de statut et suppression logique) demandent de retaper l’identifiant du compte ciblé et de vérifier à nouveau le mot de passe PDG. Le PDG peut émettre un mot de passe temporaire de 24 h (changement forcé avant tout accès) ou un lien à usage unique de 30 min. Comme aucun e-mail/SMS n’est configuré, le secret est affiché une seule fois au PDG pour transmission sécurisée.
- Les événements de sécurité (dernière connexion, réinitialisations, changements de mot de passe, suspensions, blocages, réactivations et révocations) sont consultables dans les activités des gestionnaires. Les journaux ne contiennent aucun mot de passe ni jeton de réinitialisation.
- Oymike QR propose « Installer l’application » dans les espaces du PDG et des Gestionnaires. Le manifeste principal utilise les icônes du nouveau logo Oymike QR en PNG 180/192/512 et maskable; les manifestes Gestionnaire gardent un lien et une identité d’installation personnels mais utilisent le même logo de marque. Les photos personnelles des Gestionnaires restent stockées et affichées séparément dans leur profil et leur compte; elles ne sont pas utilisées comme logo global ni exposées par l’icône d’installation. Les workers racine et Gestionnaire sont réseau uniquement et ne mettent en cache aucune session, aucun QR ni aucune donnée métier. L’état d’installation est local à l’origine/identité de l’application et à l’appareil/navigateur (événements d’installation, mode autonome, API des applications associées quand disponible et marqueur local); aucune préférence n’est enregistrée au compte ou en base. Sur iPhone, Safari reçoit les instructions Partager → « Sur l’écran d’accueil » → « Ajouter »; iOS ne permet pas de vérifier depuis un onglet Safari qu’une icône a déjà été ajoutée, les instructions peuvent donc rester visibles dans Safari normal. Une icône installée peut nécessiter une réinstallation pour refléter les changements de logo.
- Nouvelle identité visuelle professionnelle : logo fourni noir et or recadré/redimensionné proportionnellement, variables de thème dans `public/brand-theme.css`, palette `#111111`, `#1C1C1C`, `#D4AF37`, `#F2D675`, `#FFFFFF` et `#F3F3F3`. Le thème est partagé entre connexion, espaces PDG/Gestionnaires, générateur, pages publiques, impression, favicons et écrans d’installation; les QR historiques et photos personnelles restent préservés.
- Les gestionnaires ont leurs propres identifiants; ils ne peuvent pas créer de compte, voir les réglages ni appeler les fonctions PDG. Chaque API gestionnaire vérifie le statut et le périmètre à chaque requête.
- Les QR sont attribués individuellement par le PDG; il peut les réattribuer sans ouvrir le compte du gestionnaire. Le PDG garde toujours accès à tous les bénéficiaires et QR.
- Statuts QR : **Brouillon**, **Actif**, **Suspendu** et **Refusé**. Un gestionnaire autorisé peut créer et activer immédiatement un nouveau QR, sans paiement préalable ni accord préalable du PDG; les anciens statuts « En attente de validation » restent lisibles pendant la transition. Le PDG conserve la suspension, le refus et la réactivation contrôlés côté serveur. Chaque changement est journalisé avec l’acteur, l’heure, l’état et, si applicable, le motif.
- Le PDG contrôle les droits de création/modification et la limite de QR (0 = illimitée). Le droit de création désactivé bloque côté serveur toute nouvelle création; un gestionnaire autorisé n’est pas soumis à une validation PDG préalable pour activer un nouveau QR. Les suspensions et réactivations du PDG restent prioritaires. Les limites ne suppriment aucun QR historique.
- L’espace Gestionnaire réunit les QR par statut, scans, activité récente, notifications et messages privés du PDG. Il permet de créer, personnaliser, prévisualiser, rechercher, modifier selon les droits, télécharger et partager les QR. Une notification de décision inclut le motif lorsque le PDG en indique un.
- « Mon profil et paramètres » comprend les coordonnées, la photo personnelle, les préférences, l’affichage compact local, le changement sécurisé du mot de passe, l’invalidation des sessions, l’aide et les documents de référence. Un changement d’e-mail exige le mot de passe actuel; aucun mot de passe en clair n’est stocké ou exposé.
- Un gestionnaire ne voit que ses bénéficiaires/QR. Pour modifier ou désactiver le profil global d’un bénéficiaire partagé, tous ses QR non supprimés doivent lui être attribués; cela évite qu’un compte délégué affecte des QR hors périmètre.
- Journal serveur des connexions/déconnexions, changements de comptes et de statut, modifications des bénéficiaires/QR, statistiques, téléchargements, partages, impressions, décisions QR, messages du PDG et refus d’accès. Les instantanés d’audit omettent mots de passe, empreintes, tokens, URLs complètes et contenu libre potentiellement sensible.
- Tableau PDG « Activités des gestionnaires » : recherche, filtres par compte/action/résultat/entité/période, accès direct aux QR et bénéficiaires, diffs non secrets, alertes dans l’application configurables et export CSV.
- Tableau PDG « Finances et paiements » et registre dédié « Suivi des paiements en espèces » : totaux déclarés, vérifiés, en attente et rejetés; bénéficiaires payés/partiels/non payés, soldes et ventilation par gestionnaire. Le registre propose des filtres gestionnaire/bénéficiaire/statut/période, l’historique détaillé et un export CSV.
- Le PDG configure les tarifs et options; le serveur calcule et fige les montants dans les commandes, sans tarif fictif. Si un tarif actif s’applique, le gestionnaire le sélectionne pour créer le suivi financier, mais aucun paiement ne bloque la création ou l’activation. Sans tarif applicable, le QR peut être créé sans commande ni impayé artificiel; une commande à 0 XOF est « Gratuit / non applicable ».
- Les déclarations espèces exigent une confirmation serveur de réception réelle; elles enregistrent montant, date, payeur, gestionnaire, référence de reçu et observation. Une déclaration reste distincte d’un encaissement jusqu’à vérification PDG. Les paiements partiels, soldes, rejets et corrections sont conservés avec un audit avant/après et motif.
- Aucun prestataire de paiement électronique n’est connecté. Les flux électroniques restent indisponibles et ne sont jamais affichés comme payés; les références prestataire sont dédupliquées par contrainte unique en base et aucun PIN/secret n’est conservé.
- Le journal PostgreSQL est append-only pour l’application. Exportez les rapports et incluez la table `audit_logs` aux sauvegardes PostgreSQL; aucun effacement automatique n’est configuré. L’archivage historique doit être réalisé par un administrateur de base de données après export et sauvegarde vérifiés.
- Connexion réservée au PDG et aux gestionnaires créés par le PDG — aucun compte bénéficiaire ni inscription publique.
- Création, recherche et modification des bénéficiaires et QR codes; filtres de statut dans le tableau de bord.
- Bénéficiaires : blocage/déblocage réversible; un blocage rend immédiatement indisponibles tous leurs QR sans modifier le statut individuel de chaque code. La suppression logique désactive leurs QR et conserve scans et audit.
- QR codes : blocage/déblocage indépendant par code et suppression logique, avec conservation de l’historique.
- Plusieurs codes par bénéficiaire, catégories personnalisables, identifiant public unique et journal de modifications.
- Pages Oymike QR mobiles modifiables après impression, ou redirection modifiable vers un site externe.
- **Personnalisation visuelle indépendante par QR, de l’éditeur à la page publique :** 13 palettes, sélecteur de couleur et HEX libre, réinitialisation; couleurs séparées pour arrière-plan, titre, texte, prix, boutons, menus, liens, icônes, bordures, badges et cartes; typographie distincte par titre, sous-titre, description, prix et bouton (famille, taille, graisse, italique, alignement, interligne et espacement). Dix familles de polices sont auto-hébergées avec licences OFL, variantes latin/latin-ext et fallback système.
- L’apparence permet fond uni, dégradé, image optimisée ou transparence, réglage de position/opacité et motifs; elle comprend aussi le style/layout, colonnes, couverture, cartes, boutons, bordures, ombres, espacement, badges, menus, galerie, sections repliables, partage et animations. L’aperçu téléphone/tablette/ordinateur et la page publique utilisent le même renderer. Les modèles changent la présentation sans effacer les contenus déjà saisis. Les changements ont annuler/rétablir, brouillon, réinitialisation, publication explicite et restauration du thème enregistré.
- Les thèmes et leurs versions sont enregistrés **dans les données du QR concerné** (JSONB `profile_data`, ou stockage local de développement); la version courante et jusqu’à 9 précédentes sont conservées par QR. Les réponses publiques omettent l’historique et la version interne. Aucun changement de schéma ni réinitialisation de base n’a été nécessaire. Le contraste est contrôlé côté éditeur et serveur; les styles s’adaptent au mobile et respectent `prefers-reduced-motion`.
- **Studio PDG** accessible depuis « Modèles QR » : créer, modifier, dupliquer, activer/désactiver, classer en collections et réordonner les modèles; composer rubriques/champs typés et catégories initiales de menu/produits; chaque modification de définition incrémente sa version, et les QR existants gardent leur instantané jusqu’à une migration explicite. La suppression est bloquée si des QR non supprimés y font référence.
- Le wizard PDG/Gestionnaire récupère les modèles actifs depuis l’API; il affiche les champs définis par modèle, contrôle les valeurs côté serveur et réutilise les catégories de produits par défaut. Les champs et groupes sont sauvegardés sur le bon QR; leurs prix sont de simples données de catalogue, pas des paiements fictifs.
- Le PDG gère une galerie persistée d’images classées (perroquets, paons, colibris, fleurs, forêts, cascades, rivières, montagnes et paysages). Les fichiers sont compressés côté client puis validés côté serveur; les images actives deviennent des choix de fond. Masquer/supprimer une image ne casse pas les QR déjà enregistrés, qui conservent leur copie.
- Le pied de page peut être personnalisé par QR (texte et URL HTTPS facultative) et apparaît à l’identique dans l’aperçu et le renderer public. Le rendu public expose uniquement les champs du snapshot courant; les historiques internes et valeurs de champs orphelins restent cachés.
- Le QR imprimable peut personnaliser couleur, correction, modules, yeux, cadre, légendes et petit logo central. Le logo impose la correction H et le serveur contrôle contraste QR/cadre; l’impression via navigateur et les exports PNG/SVG conservent une zone silencieuse de quatre modules. Un scan physique reste à faire avant tirage en série.
- Choix des champs visibles par QR : photo/logo, téléphone, WhatsApp, e-mail, adresse, localisation, site, réseaux, présentation, offres, tarifs, documents et liens utiles.
- La galerie de bénéficiaire existante permet jusqu’à 8 photos et la sélection de photos sur les QR. Le wizard ajoute, pour les modèles concernés, des photos au niveau du QR avec légende, photo principale, ordre et retrait. Le serveur valide le format PNG/JPEG/WebP et limite la taille des images; les médias sont enregistrés avec les données de la page/QR, pas uniquement en mémoire navigateur. La persistance a été vérifiée au redémarrage du stockage JSON de test; elle n’a pas été vérifiée sur PostgreSQL/Render.
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
5. Enregistrez et déployez. La base doit être accessible au service Render; Oymike QR crée les tables et index au premier démarrage sans effacer les données existantes.

### Domaine personnalisé (facultatif)

Render ne permet pas de remplacer son adresse par une adresse choisie sans posséder et configurer un domaine. Achetez ou utilisez un domaine qui vous appartient, ajoutez-le dans les réglages du Web Service Render (**Custom Domains**), puis configurez exactement les enregistrements DNS indiqués par Render et attendez le certificat HTTPS. Ensuite, ajoutez `PUBLIC_BASE_URL=https://votre-domaine-réel` dans **Environment** et redéployez. Oymike QR utilisera ce domaine pour les nouveaux QR et redirigera les anciens liens Render vers lui. Pour que l’aperçu du scanner n’affiche jamais l’URL Render, les anciens QR déjà imprimés doivent être réimprimés après activation du domaine, car leur image contient déjà l’ancienne adresse.

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

Les tests démarrent des serveurs avec un stockage JSON temporaire (`QRIA_STORE_FILE`) et n’écrivent ni dans `data/store.json` ni dans PostgreSQL. Au dernier lancement, **16/16 tests passent**. Ils couvrent les rôles et permissions, les workflows historiques, finances et PWA; le Studio PDG (création, organisation, activation, galerie), la validation de champs personnalisés, la version 1→2, la migration confirmée, la conservation des menus/prix et la persistance JSON après redémarrage; le parcours manager et son interdiction d’accéder aux routes PDG; l’éditeur DOM; les exports QR vectoriels (cadre, logo, correction H); le renderer de page, ses champs dynamiques et le pied de page personnalisé. `node --check` a réussi pour les **32 fichiers JavaScript** et `npm audit` signale **0 vulnérabilité**. Ces tests JSON ne remplacent pas une base PostgreSQL réelle, les vérifications Render, des essais navigateur/appareil ou un scan physique.

Les tests PWA vérifient aussi le manifeste racine, ses icônes et le service worker réseau uniquement; les manifestes personnalisés des Gestionnaires; l’état local séparé par origine et identité d’application; l’affichage/masquage par état simulé; les guides Android, ordinateur, iPhone et navigateur non pris en charge; et la limite de détection Safari iOS. Ils ne remplacent pas les essais d’installation sur appareils réels.

## Architecture

- `server.js` : serveur Express, sessions séparées PDG/gestionnaire, contrôles d’accès à chaque requête et liens publics `/r/:code`.
- `manager-routes.js` : gestion PDG des comptes/attributions, avatars et liens PWA, espace gestionnaire à périmètre limité, journal, alertes et export CSV.
- `finance-routes.js` / `finance-store.js` : catalogue tarifaire, devis serveur, commandes, déclarations, revue PDG, corrections, agrégats et export financier.
- `store.js` : stockage PostgreSQL via `pg` en déploiement; stockage JSON local uniquement pour l’aperçu et les tests.
- `schema.sql` : bénéficiaires, catégories, QR codes, scans, comptes gestionnaires, attributions, commandes/paiements, événements financiers append-only et journal d’audit append-only.
- `public/manager/sw.js` : service worker limité à l’espace gestionnaire; aucune donnée de session ou financière n’est mise en cache.
- `public/index.html` : tableau de bord PDG; `public/manager.html` : espace gestionnaire distinct.
- `qr-studio-config.js` / `qr-studio-routes.js` : normalisation/validation des modèles et galerie, routes PDG/publiques, versionnage et migrations contrôlées; les réglages sont persistés dans `app_settings` JSONB, sans migration destructive.
- `public/qr-admin-studio.js` / `qr-admin-studio.css` : interface PDG pour modèles, rubriques/champs, collections et galerie.
- `public/qr-wizard.js` / `qr-wizard.css` : assistant partagé de choix de modèle, champs dynamiques, groupes d’articles, galerie, aperçu, personnalisation et publication.
- `public/qr-templates.js` : catalogue extensible des secteurs et palettes; `public/qr-profile-renderer.js` / `qr-profile.css` : rendu partagé de l’aperçu et de la page publique, y compris les champs personnalisés et le pied de page.
- `public/qr-artwork.js` : rendu vectoriel partagé entre aperçu, téléchargements et impression des QR; correction H automatique si un logo central est utilisé.
- `test/qr-admin-studio.test.js`, `test/qr-studio-custom.test.js`, `test/qr-artwork.test.js` : couverture du nouveau Studio, de sa persistance JSON et des exports imprimables.
- `public/fonts.css` et `public/fonts/` : dix familles auto-hébergées, fichiers latin/latin-ext et licences OFL.
- `public/profile.html` : page mobile publique d’un QR hébergé.
- `public/generator.html` : ancien générateur autonome conservé.
- Les QR hébergés encodent une URL stable `/r/<identifiant>`. Modifier la page ou la destination n’oblige donc pas à réimprimer le QR.
