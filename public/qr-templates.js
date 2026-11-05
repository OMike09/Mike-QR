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
  const defaultGroupsFor = (id, kind) => {
    const byId = {
      restaurant:['Entrées','Plats','Grillades','Poissons','Poulets','Accompagnements','Desserts','Boissons','Promotions'],
      hotel:['Chambres','Équipements','Services'], boutique:['Nouveautés','Produits','Promotions'], supermarche:['Nouveautés','Épicerie','Boissons','Promotions'],
      coiffure:['Prestations','Réalisations'], beaute:['Soins','Prestations','Réalisations'], entreprise:['Services','Domaines d’intervention','Références et réalisations'],
      ecole:['Formations','Programmes','Conditions d’admission'], clinique:['Services','Spécialités','Informations pratiques'], association:['Mission','Activités','Projets'],
      evenement:['Programme','Intervenants','Informations pratiques'], immobilier:['Biens','À louer','À vendre'], 'carte-visite':['Coordonnées','Réseaux sociaux'],
    };
    return byId[id] || (kind === 'restaurant' ? byId.restaurant : kind === 'catalog' ? ['Nouveautés','Produits','Promotions'] : kind === 'hotel' ? byId.hotel : kind === 'education' ? byId.ecole : kind === 'event' ? byId.evenement : kind === 'professional' ? ['Services','Réalisations'] : ['Services']);
  };
  const templates = groups.flatMap((group) => group.templates.map(([id, label, kind, category, description]) => ({
    id, label, kind, category, groupId: group.id, group: group.label, icon: group.icon, description,
    defaultGroups:defaultGroupsFor(id,kind),
    beneficiaryType: ['restaurant', 'catalog'].includes(kind) ? 'commerce'
      : ['organization', 'education', 'event'].includes(kind) ? 'organization'
        : kind === 'contact' ? 'individual' : ['link', 'other'].includes(kind) ? 'other' : 'business',
    categoryId: ['restaurant', 'catalog'].includes(kind) ? 'cat-shops'
      : ['organization', 'education', 'event'].includes(kind) ? 'cat-organizations'
        : kind === 'contact' ? 'cat-individuals' : ['link', 'other'].includes(kind) ? 'cat-other' : 'cat-businesses',
    purpose: kind === 'restaurant' ? 'menu' : kind === 'catalog' ? 'catalog' : kind === 'link' ? 'website' : kind === 'contact' ? 'contact' : kind === 'services' ? 'services' : 'other',
  })));
  const makePalette = (id, label, colors) => ({
    id, label, colors,
    primary: colors.price, secondary: colors.menuBg, background: colors.mainBg,
    surface: colors.card, text: colors.description, button: colors.button,
  });
  const palettes = [
    makePalette('forest', 'Vert et blanc', {
      pageBg:'#F2F8F4', mainBg:'#F6FBF8', card:'#FFFFFF', panel:'#E9F5EE',
      title:'#153D2F', subtitle:'#315B4C', description:'#253D33', price:'#176B52', button:'#176B52', buttonText:'#FFFFFF',
      icon:'#176B52', border:'#C9DDD1', separator:'#DCE9E0', menuBg:'#DDF3E8', menuText:'#14543D', link:'#116B4B', badgeBg:'#DDF3E8', badgeText:'#14543D',
    }),
    makePalette('dark-green-gold', 'Vert foncé et doré', {
      pageBg:'#101812', mainBg:'#16231A', card:'#1D2C22', panel:'#293A2E',
      title:'#FFF9E7', subtitle:'#E8D69C', description:'#F0F1E9', price:'#E7C65D', button:'#705711', buttonText:'#FFF8DF',
      icon:'#E1C25D', border:'#50624C', separator:'#405343', menuBg:'#2A382B', menuText:'#F3E6B9', link:'#F0D777', badgeBg:'#55461E', badgeText:'#FFF0B1',
    }),
    makePalette('mono', 'Noir et or', {
      pageBg:'#101010', mainBg:'#171717', card:'#202020', panel:'#2B2A25',
      title:'#FFF9E8', subtitle:'#E7D49B', description:'#F1F0EA', price:'#E6C45C', button:'#79600F', buttonText:'#FFF8E1',
      icon:'#E1C15A', border:'#51482B', separator:'#3C3930', menuBg:'#29251A', menuText:'#F5E3A3', link:'#F3D36D', badgeBg:'#514014', badgeText:'#FFF0B5',
    }),
    makePalette('navy', 'Bleu marine et blanc', {
      pageBg:'#F2F6FB', mainBg:'#F6F9FD', card:'#FFFFFF', panel:'#E7EEF7',
      title:'#162A45', subtitle:'#3D5574', description:'#24364D', price:'#164C84', button:'#153F6B', buttonText:'#FFFFFF',
      icon:'#1D4D7C', border:'#C9D5E3', separator:'#D9E2EC', menuBg:'#E6EEF7', menuText:'#173B63', link:'#154F88', badgeBg:'#DDE8F4', badgeText:'#173D67',
    }),
    makePalette('blue-gray', 'Bleu et gris clair', {
      pageBg:'#F1F5F8', mainBg:'#F7F9FB', card:'#FFFFFF', panel:'#E7EDF2',
      title:'#193349', subtitle:'#426179', description:'#2A3F50', price:'#17628A', button:'#155C83', buttonText:'#FFFFFF',
      icon:'#1D688F', border:'#C8D5DE', separator:'#D9E1E7', menuBg:'#E4EDF2', menuText:'#1E506D', link:'#075F8A', badgeBg:'#D7EAF2', badgeText:'#15556F',
    }),
    makePalette('wine', 'Bordeaux et crème', {
      pageBg:'#FBF5F1', mainBg:'#FFF9F5', card:'#FFFFFF', panel:'#F3E6DF',
      title:'#4A202D', subtitle:'#784754', description:'#422F34', price:'#812D46', button:'#762D44', buttonText:'#FFFFFF',
      icon:'#87354C', border:'#E3CBC5', separator:'#EEDDD7', menuBg:'#F2E2DC', menuText:'#6B2B3C', link:'#7F2C47', badgeBg:'#EBD6D3', badgeText:'#6A263B',
    }),
    makePalette('sunset', 'Orange et blanc', {
      pageBg:'#FFF5EF', mainBg:'#FFFAF7', card:'#FFFFFF', panel:'#FBE7D8',
      title:'#512A1B', subtitle:'#75472F', description:'#3E3028', price:'#AE4D21', button:'#A94722', buttonText:'#FFFFFF',
      icon:'#A94722', border:'#E8CFC0', separator:'#F0DDD1', menuBg:'#FCE6D8', menuText:'#823A1D', link:'#A6441E', badgeBg:'#F7DDCA', badgeText:'#7D361D',
    }),
    makePalette('violet', 'Violet et blanc', {
      pageBg:'#F7F4FB', mainBg:'#FBF9FD', card:'#FFFFFF', panel:'#EEE7F6',
      title:'#352547', subtitle:'#5C4A73', description:'#342E3C', price:'#69438F', button:'#62428A', buttonText:'#FFFFFF',
      icon:'#704D96', border:'#D7CBE4', separator:'#E7DFF0', menuBg:'#EEE7F7', menuText:'#50366F', link:'#604087', badgeBg:'#E9DFF2', badgeText:'#50376D',
    }),
    makePalette('beige', 'Beige et marron', {
      pageBg:'#F5EFE5', mainBg:'#FBF7F0', card:'#FFFCF7', panel:'#EFE2CE',
      title:'#3E2D1F', subtitle:'#68513A', description:'#3B332B', price:'#795323', button:'#694522', buttonText:'#FFFFFF',
      icon:'#805B2C', border:'#DDCBB1', separator:'#E8DCCB', menuBg:'#EFE3D2', menuText:'#604225', link:'#744D21', badgeBg:'#E9DBC5', badgeText:'#5F4328',
    }),
    makePalette('blush', 'Rose poudré et blanc', {
      pageBg:'#FBF3F5', mainBg:'#FFF9FA', card:'#FFFFFF', panel:'#F5E6EB',
      title:'#482A35', subtitle:'#765260', description:'#3F3036', price:'#9A4F69', button:'#93465F', buttonText:'#FFFFFF',
      icon:'#93465F', border:'#E7CCD5', separator:'#F0DDE3', menuBg:'#F6E7EC', menuText:'#754257', link:'#92435F', badgeBg:'#F1DDE4', badgeText:'#743F55',
    }),
    makePalette('turquoise', 'Turquoise et blanc', {
      pageBg:'#EFF8F7', mainBg:'#F7FCFB', card:'#FFFFFF', panel:'#DDF1EF',
      title:'#153E3D', subtitle:'#326563', description:'#243C3B', price:'#08716D', button:'#08716D', buttonText:'#FFFFFF',
      icon:'#08716D', border:'#C2DFDC', separator:'#D6EAE8', menuBg:'#DDF1EF', menuText:'#155C59', link:'#087673', badgeBg:'#D3EBE8', badgeText:'#135B57',
    }),
    makePalette('luxury', 'Luxe — ardoise et champagne', {
      pageBg:'#111318', mainBg:'#191B21', card:'#22252C', panel:'#30323A',
      title:'#FFF9EF', subtitle:'#E6D6B6', description:'#EEECE7', price:'#E5C995', button:'#76603D', buttonText:'#FFF9EF',
      icon:'#DFC38B', border:'#514B40', separator:'#3B3A3B', menuBg:'#2A2B30', menuText:'#F2E3C6', link:'#E7CF9D', badgeBg:'#514636', badgeText:'#FFF1D4',
    }),
    makePalette('minimal', 'Minimaliste — noir et blanc', {
      pageBg:'#F4F4F4', mainBg:'#FFFFFF', card:'#FFFFFF', panel:'#F5F5F5',
      title:'#161616', subtitle:'#4B4B4B', description:'#292929', price:'#111111', button:'#171717', buttonText:'#FFFFFF',
      icon:'#222222', border:'#D8D8D8', separator:'#E5E5E5', menuBg:'#EEEEEE', menuText:'#222222', link:'#111111', badgeBg:'#E7E7E7', badgeText:'#242424',
    }),
  ];
  let customTemplates = [];
  let availableTemplates = templates;
  let availableGroups = groups;
  const registry = { palettes:Object.freeze(palettes), get(id) { return availableTemplates.find((item) => item.id === id) || null; }, setCustomTemplates(list) {
    const seen=new Set(templates.map((item)=>item.id));
    customTemplates=(Array.isArray(list)?list:[]).filter((item)=>item&&typeof item.id==='string'&&!seen.has(item.id)&&item.enabled!==false).map((item)=>({...item,custom:true,groupId:/^pdg-[a-z0-9-]+$/.test(item.groupId||'')?item.groupId:'pdg-custom',group:String(item.group||'Modèles du PDG').slice(0,40),category:item.category||'business',defaultGroups:Array.isArray(item.defaultGroups)?item.defaultGroups:defaultGroupsFor(item.id,item.kind)}));
    availableTemplates=[...templates,...customTemplates];const customGroups=[...new Map(customTemplates.map((item)=>[item.groupId,{id:item.groupId,label:item.group,icon:'🧩'}])).values()];availableGroups=[...groups,...customGroups];
    return customTemplates.slice();
  }, get customTemplates(){return customTemplates.slice();} };
  Object.defineProperty(registry,'groups',{enumerable:true,get(){return availableGroups;}});
  Object.defineProperty(registry,'templates',{enumerable:true,get(){return availableTemplates;}});
  return Object.freeze(registry);
});
