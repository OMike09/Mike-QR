/* Shared QR page templates. The registry is data-only so the same choices are used by the editor and public page. */
(function (root, factory) {
  const value = factory();
  if (typeof module === 'object' && module.exports) module.exports = value;
  if (root) root.QRIA_TEMPLATES = value;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const groups = [
    { id: 'food', label: 'Restaurants et restauration', icon: '🍽️', templates: [
      ['restaurant', 'Restaurant', 'restaurant', 'restaurant', 'Plats, prix, horaires et commandes WhatsApp.'],
      ['maquis', 'Maquis', 'restaurant', 'restaurant', 'Menu du jour et spécialités locales.'],
      ['bar', 'Bar', 'restaurant', 'restaurant', 'Carte des boissons et horaires.'],
      ['cafe', 'Café', 'restaurant', 'restaurant', 'Menu simple pour café et salon de thé.'],
      ['fast-food', 'Fast-food', 'restaurant', 'restaurant', 'Carte rapide, formules et suppléments.'],
      ['patisserie', 'Pâtisserie', 'restaurant', 'catalog', 'Pâtisseries, commandes et promotions.'],
      ['boulangerie', 'Boulangerie', 'restaurant', 'catalog', 'Produits, horaires et contact.'],
      ['traiteur', 'Service traiteur', 'restaurant', 'services', 'Prestations, menus et demande de devis.'],
      ['livraison-repas', 'Livraison de repas', 'restaurant', 'restaurant', 'Menu et commande par WhatsApp.'],
    ]},
    { id: 'commerce', label: 'Commerce et vente', icon: '🛍️', templates: [
      ['boutique', 'Boutique', 'commerce', 'catalog', 'Vitrine, produits, prix et disponibilité.'],
      ['supermarche', 'Supermarché', 'commerce', 'catalog', 'Catalogue de produits et promotions.'],
      ['pharmacie', 'Pharmacie', 'commerce', 'catalog', 'Informations et catalogue non médical.'],
      ['vetements', 'Magasin de vêtements', 'commerce', 'catalog', 'Collections, tailles et disponibilités.'],
      ['electronique', 'Magasin d’électronique', 'commerce', 'catalog', 'Produits et caractéristiques.'],
      ['vente-produits', 'Vente de produits', 'commerce', 'catalog', 'Une vitrine pour vos articles.'],
      ['catalogue', 'Catalogue commercial', 'commerce', 'catalog', 'Présentez vos références par catégorie.'],
    ]},
    { id: 'hospitality', label: 'Hébergement et tourisme', icon: '🛏️', templates: [
      ['hotel', 'Hôtel', 'hotel', 'lodging', 'Chambres, services, horaires et localisation.'],
      ['residence', 'Résidence meublée', 'hotel', 'lodging', 'Logements, équipements et tarifs.'],
      ['maison-hotes', 'Maison d’hôtes', 'hotel', 'lodging', 'Chambres, services et contact.'],
      ['voyage', 'Agence de voyage', 'professional', 'catalog', 'Séjours, circuits et contacts.'],
      ['tourisme', 'Site touristique', 'professional', 'gallery', 'Photos, accès et informations pratiques.'],
      ['location-auto', 'Location de véhicules', 'commerce', 'catalog', 'Véhicules, tarifs et disponibilité.'],
    ]},
    { id: 'professional', label: 'Entreprises et professionnels', icon: '💼', templates: [
      ['entreprise', 'Entreprise', 'professional', 'services', 'Présentation, services et coordonnées.'],
      ['cabinet', 'Cabinet professionnel', 'professional', 'services', 'Services, équipe et prise de contact.'],
      ['coiffure', 'Salon de coiffure', 'professional', 'services', 'Prestations, tarifs et réalisations.'],
      ['beaute', 'Institut de beauté', 'professional', 'services', 'Soins, tarifs et contact.'],
      ['atelier', 'Atelier', 'professional', 'services', 'Savoir-faire, galerie et prestations.'],
      ['garage', 'Garage automobile', 'professional', 'services', 'Services, horaires et localisation.'],
      ['immobilier', 'Agence immobilière', 'professional', 'catalog', 'Biens, services et coordonnées.'],
      ['consultant', 'Consultant', 'professional', 'services', 'Expertise, références et contact.'],
      ['artisan', 'Artisan', 'professional', 'gallery', 'Portfolio, prestations et contact.'],
    ]},
    { id: 'education', label: 'Éducation et formation', icon: '🎓', templates: [
      ['ecole', 'École', 'education', 'education', 'Établissement, formations et inscriptions.'],
      ['universite', 'Université', 'education', 'education', 'Programmes, contacts et documents utiles.'],
      ['formation', 'Centre de formation', 'education', 'education', 'Formations, conditions et contact.'],
      ['bibliotheque', 'Bibliothèque', 'education', 'catalog', 'Services, horaires et ressources.'],
      ['formateur', 'Formateur indépendant', 'professional', 'education', 'Formations et accompagnement.'],
      ['etablissement-scolaire', 'Établissement scolaire', 'education', 'education', 'Informations pour les familles.'],
    ]},
    { id: 'health', label: 'Santé et bien-être', icon: '✚', templates: [
      ['clinique', 'Clinique', 'health', 'services', 'Contacts et informations pratiques.'],
      ['centre-medical', 'Centre médical', 'health', 'services', 'Services, horaires et accès.'],
      ['laboratoire', 'Laboratoire', 'health', 'services', 'Coordonnées et informations de service.'],
      ['cabinet-medical', 'Cabinet médical', 'health', 'services', 'Informations et contact du cabinet.'],
      ['bien-etre', 'Centre de bien-être', 'professional', 'services', 'Prestations, horaires et contact.'],
    ]},
    { id: 'organization', label: 'Organisations et institutions', icon: '🏛️', templates: [
      ['association', 'Association', 'organization', 'organization', 'Mission, activités et adhésion.'],
      ['ong', 'ONG', 'organization', 'organization', 'Actions, projets et contacts.'],
      ['administration', 'Administration', 'organization', 'organization', 'Services et démarches utiles.'],
      ['eglise', 'Église', 'organization', 'organization', 'Communauté, activités et horaires.'],
      ['organisation-pro', 'Organisation professionnelle', 'organization', 'organization', 'Membres, missions et ressources.'],
      ['evenement', 'Événement', 'event', 'event', 'Date, lieu, programme et inscription.'],
      ['conference', 'Conférence', 'event', 'event', 'Programme, intervenants et accès.'],
    ]},
    { id: 'personal', label: 'Particuliers', icon: '👤', templates: [
      ['carte-visite', 'Carte de visite numérique', 'contact', 'contact', 'Coordonnées et bouton enregistrer le contact.'],
      ['profil-personnel', 'Profil personnel', 'contact', 'contact', 'Une page de présentation personnelle.'],
      ['contact-pro', 'Contact professionnel', 'contact', 'contact', 'Coordonnées professionnelles et réseaux.'],
      ['portfolio', 'Portfolio', 'professional', 'gallery', 'Travaux, références et contact.'],
    ]},
    { id: 'other', label: 'Autres utilisations', icon: '✳️', templates: [
      ['site-web', 'Lien vers un site Internet', 'link', 'link', 'Redirection directe vers votre site.'],
      ['reseaux-sociaux', 'Réseaux sociaux', 'link', 'link', 'Rassemblez vos pages sociales.'],
      ['document-pdf', 'Document PDF', 'link', 'link', 'Partagez un document existant.'],
      ['formulaire', 'Formulaire', 'link', 'link', 'Redirection vers un formulaire externe.'],
      ['galerie', 'Galerie de photos', 'gallery', 'gallery', 'Une page visuelle avec une galerie.'],
      ['localisation', 'Localisation GPS', 'link', 'link', 'Ouvrez une adresse sur une carte.'],
      ['contact', 'Informations de contact', 'contact', 'contact', 'Coordonnées et liens utiles.'],
      ['personnalise', 'Autre activité', 'other', 'general', 'Définissez librement le contenu de votre page.'],
    ]},
  ];
  const templates = groups.flatMap((group) => group.templates.map(([id, label, kind, category, description]) => ({
    id, label, kind, category, groupId: group.id, group: group.label, icon: group.icon, description,
    beneficiaryType: ['restaurant', 'catalog'].includes(kind) ? 'commerce'
      : ['organization', 'education', 'event'].includes(kind) ? 'organization'
        : kind === 'contact' ? 'individual' : ['link', 'other'].includes(kind) ? 'other' : 'business',
    categoryId: ['restaurant', 'catalog'].includes(kind) ? 'cat-shops'
      : ['organization', 'education', 'event'].includes(kind) ? 'cat-organizations'
        : kind === 'contact' ? 'cat-individuals' : ['link', 'other'].includes(kind) ? 'cat-other' : 'cat-businesses',
    purpose: kind === 'restaurant' ? 'menu' : kind === 'catalog' ? 'catalog' : kind === 'link' ? 'website' : kind === 'contact' ? 'contact' : kind === 'services' ? 'services' : 'other',
  })));
  const palettes = [
    { id: 'forest', label: 'Vert naturel', primary: '#176B52', secondary: '#DDF3E8', background: '#F6FBF8', surface: '#FFFFFF', text: '#18342B', button: '#176B52' },
    { id: 'ocean', label: 'Bleu professionnel', primary: '#145A8D', secondary: '#DCEEFF', background: '#F5F9FD', surface: '#FFFFFF', text: '#19364A', button: '#145A8D' },
    { id: 'mono', label: 'Noir et or', primary: '#171717', secondary: '#F1D479', background: '#F8F7F2', surface: '#FFFFFF', text: '#24231F', button: '#171717' },
    { id: 'sunset', label: 'Orange chaleureux', primary: '#A94722', secondary: '#FDE6D5', background: '#FFF9F4', surface: '#FFFFFF', text: '#3B251D', button: '#A94722' },
    { id: 'wine', label: 'Bordeaux et crème', primary: '#762E3F', secondary: '#F2E3DB', background: '#FCF8F5', surface: '#FFFFFF', text: '#3A252B', button: '#762E3F' },
    { id: 'violet', label: 'Violet doux', primary: '#62428A', secondary: '#EEE7F7', background: '#FAF8FC', surface: '#FFFFFF', text: '#30253C', button: '#62428A' },
  ];
  return Object.freeze({ groups: Object.freeze(groups), templates: Object.freeze(templates), palettes: Object.freeze(palettes), get(id) { return templates.find((item) => item.id === id) || null; } });
});
