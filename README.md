# QRia — Administration centralisée des QR codes

QRia est une application web en français où le PDG conserve le contrôle complet et peut déléguer un périmètre limité à plusieurs gestionnaires. Les comptes, permissions et activités sont contrôlés côté serveur; il n’existe aucune inscription publique.

## Fonctionnalités

- Espace PDG à `/admin` et espace gestionnaire indépendant à `/manager` (également servi à la racine de `manager.oymiketech.com` une fois ce sous-domaine ajouté à l’hébergement).
- Le PDG crée/modifie les comptes gestionnaires, réinitialise leur mot de passe, les suspend, bloque, réactive ou supprime logiquement; suspendre/bloquer/réinitialiser/supprimer révoque les sessions en cours.
- Les gestionnaires ont leurs propres identifiants; ils ne peuvent pas créer de compte, voir les réglages ni appeler les fonctions PDG. Chaque API gestionnaire vérifie le statut et le périmètre à chaque requête.
- Les QR sont attribués individuellement par le PDG; il peut les réattribuer sans ouvrir le compte du gestionnaire. Le PDG garde toujours accès à tous les bénéficiaires et QR.
- Un gestionnaire ne voit que ses bénéficiaires/QR. Pour modifier ou désactiver le profil global d’un bénéficiaire partagé, tous ses QR non supprimés doivent lui être attribués; cela évite qu’un compte délégué affecte des QR hors périmètre.
- Journal serveur des connexions/déconnexions, changements de comptes et de statut, modifications des bénéficiaires/QR, statistiques, téléchargements, partages, impressions et refus d’accès. Les instantanés d’audit omettent mots de passe, empreintes, tokens, URLs complètes et contenu libre potentiellement sensible.
- Tableau PDG « Activités des gestionnaires » : recherche, filtres par compte/action/résultat/entité/période, accès direct aux QR et bénéficiaires, diffs non secrets, alertes dans l’application configurables et export CSV.
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

1. Envoyez à GitHub le contenu de ce dossier : `package.json`, `package-lock.json`, `server.js`, `manager-routes.js`, `store.js`, `schema.sql` et tout le dossier `public/` (y compris `manager.html`, `manager.css` et `manager.js`).
2. Sur Render, créez un **New Web Service** relié à ce dépôt.
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

### Espace gestionnaire et sous-domaine facultatif

`/manager` est servi par le même Web Service et fonctionne sans DNS supplémentaire. Pour utiliser `https://manager.oymiketech.com`, ajoutez exactement ce sous-domaine dans **Custom Domains** du service Render, puis configurez l’enregistrement DNS (généralement un CNAME vers le nom `onrender.com` indiqué par Render). Attendez la validation DNS et le certificat TLS Render avant de communiquer le lien. Aucun DNS ni domaine Render n’est modifié par cette application; `PUBLIC_BASE_URL` reste le domaine public utilisé dans les QR existants et ne doit pas être remplacé par le sous-domaine gestionnaire.

Après déploiement, connectez-vous comme PDG, ouvrez **Gestionnaires**, créez un compte avec un mot de passe initial d’au moins 12 caractères, puis attribuez les QR voulus depuis la table **Codes QR**. Communiquez les identifiants directement et de manière sûre. Les événements d’alerte sont affichés dans le tableau de bord; aucun fournisseur d’e-mail/SMS n’est configuré.

## Tests

```bash
npm test
```

Les tests d’intégration démarrent un serveur local avec un fichier JSON temporaire (`QRIA_STORE_FILE`) et ne touchent pas à `data/store.json` ni à une base Neon. Ils couvrent deux comptes séparés, le refus des fonctions PDG, l’isolement des QR, l’attribution, la suspension/blocage/réactivation, la révocation des sessions, la réinitialisation du mot de passe et la conservation des QR/journaux après suppression logique.

## Architecture

- `server.js` : serveur Express, sessions séparées PDG/gestionnaire, contrôles d’accès à chaque requête et liens publics `/r/:code`.
- `manager-routes.js` : gestion PDG des comptes/attributions, espace gestionnaire à périmètre limité, journal, alertes et export CSV.
- `store.js` : stockage PostgreSQL via `pg` en déploiement; stockage JSON local uniquement pour l’aperçu et les tests.
- `schema.sql` : bénéficiaires, catégories, QR codes, scans, comptes gestionnaires, attributions et journal d’audit append-only.
- `public/index.html` : tableau de bord PDG; `public/manager.html` : espace gestionnaire distinct.
- `public/profile.html` : page mobile publique d’un QR hébergé.
- `public/generator.html` : ancien générateur autonome conservé.
- Les QR hébergés encodent une URL stable `/r/<identifiant>`. Modifier la page ou la destination n’oblige donc pas à réimprimer le QR.
