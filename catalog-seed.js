'use strict';

// ============================================================================================
// Catalogue général Oymike Tech QR — domaines d'activité, catégories modèles, produits modèles.
//
// Principes :
//  - le catalogue général est un ensemble de MODÈLES : il ne crée jamais de produit marchand
//    tant que le marchand ne l'a pas explicitement ajouté à sa boutique ;
//  - aucun prix n'est imposé : `price_xof` reste NULL sur les modèles, le marchand saisit le sien ;
//  - rien n'est supprimé : les domaines et produits retirés passent en `is_active = false` ;
//  - une personnalisation marchand (nom, photo, contenance, unité, prix, description) vit dans
//    `merchant_products` et n'est JAMAIS réécrite par une évolution du catalogue général ;
//  - le lien boutique ↔ modèle est porté par `merchant_products.catalog_product_id`, ce qui
//    permet de compter les usages et de distinguer un modèle d'un produit réellement vendu.
// ============================================================================================

const crypto = require('node:crypto');

const uid = (prefix) => `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const nowIso = () => new Date().toISOString();
const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);

// Unités de vente autorisées. `kind` sert au formulaire : liquide, poids, longueur, service.
const UNITS = [
  { code: 'piece', label: 'Pièce', kind: 'unite' },
  { code: 'sachet', label: 'Sachet', kind: 'unite' },
  { code: 'carton', label: 'Carton', kind: 'unite' },
  { code: 'pack', label: 'Pack', kind: 'unite' },
  { code: 'bouteille', label: 'Bouteille', kind: 'unite' },
  { code: 'canette', label: 'Canette', kind: 'unite' },
  { code: 'kg', label: 'Kilogramme', kind: 'poids' },
  { code: 'g', label: 'Gramme', kind: 'poids' },
  { code: 'litre', label: 'Litre', kind: 'volume' },
  { code: 'cl', label: 'Centilitre', kind: 'volume' },
  { code: 'ml', label: 'Millilitre', kind: 'volume' },
  { code: 'metre', label: 'Mètre', kind: 'longueur' },
  { code: 'sac', label: 'Sac', kind: 'unite' },
  { code: 'service', label: 'Service', kind: 'prestation' },
  { code: 'portion', label: 'Portion', kind: 'prestation' },
];

// Contenances normalisées, avec leur valeur canonique en millilitres.
// Aucune conversion cl/ml n'est faite à l'aveugle : `ml` est la vérité stockée.
const VOLUMES = [
  { code: '25cl', label: '25 cl', ml: 250 },
  { code: '30cl', label: '30 cl', ml: 300 },
  { code: '33cl', label: '33 cl', ml: 330 },
  { code: '50cl', label: '50 cl', ml: 500 },
  { code: '60cl', label: '60 cl', ml: 600 },
  { code: '65cl', label: '65 cl', ml: 650 },
  { code: '75cl', label: '75 cl', ml: 750 },
  { code: '1l', label: '1 L', ml: 1000 },
  { code: '1,5l', label: '1,5 L', ml: 1500 },
  { code: '2l', label: '2 L', ml: 2000 },
  { code: '18l', label: '18 L', ml: 18000 },
  // Formats réellement présents sur le marché ivoirien (étiquettes : 1,8 L et 100 cl).
  { code: '1800ml', label: '1,8 L', ml: 1800 },
  { code: '100cl', label: '100 cl', ml: 1000 },
];

// Formats supplémentaires utilisés par les fiches : ajoutés au référentiel, jamais substitués.
function ensureVolumes(extra = []) {
  for (const item of extra) {
    if (!item || !item.ml) continue;
    if (VOLUMES.some((v) => v.ml === item.ml && v.code === item.code)) continue;
    // Une contenance peut avoir plusieurs écritures (1 L et 100 cl) : on n'ajoute que le code manquant.
    if (VOLUMES.some((v) => v.code === item.code)) continue;
    if (VOLUMES.some((v) => v.ml === item.ml && v.code === item.code)) continue;
    VOLUMES.push({ code: item.code, label: item.label, ml: item.ml });
  }
  VOLUMES.sort((a, b) => a.ml - b.ml);
  volumeByCode.clear();
  for (const v of VOLUMES) volumeByCode.set(v.code, v);
  return VOLUMES;
}

const volumeByCode = new Map(VOLUMES.map((v) => [v.code, v]));

function normalizeVolume(value, fallbackMl = null) {
  const raw = clean(value, 20).toLowerCase().replace(/\s+/g, '');
  if (!raw) return { code: '', label: '', ml: fallbackMl };
  const hit = volumeByCode.get(raw) || volumeByCode.get(raw.replace('.', ','));
  // Deux formats peuvent partager la même contenance (1 L et 100 cl) : on respecte la saisie.
  if (hit && hit.code !== '100cl' && raw === '100cl') {
    const cl = volumeByCode.get('100cl'); if (cl) return { ...cl };
  }
  if (hit) return { code: hit.code, label: hit.label, ml: hit.ml };
  // « 330 ml », « 500ml », « 1.5 l » → conversion explicite, jamais implicite.
  const m = raw.match(/^([\d.,]+)(ml|cl|l)$/);
  if (m) {
    const n = Number(m[1].replace(',', '.'));
    if (Number.isFinite(n)) {
      const ml = Math.round(m[2] === 'l' ? n * 1000 : m[2] === 'cl' ? n * 10 : n);
      // Libellé : on garde l'unité saisie par le marchand (« 1,8 L », « 100 cl »), la valeur canonique reste les ml.
      if (ml > 0 && ml <= 100000) {
        const canonical = volumeByCode.get(`${ml}ml`);
        const suffix = m[2] === 'l' ? 'L' : m[2] === 'cl' ? 'cl' : 'ml';
        return canonical ? { ...canonical }
          : { code: `${ml}ml`, label: `${String(m[1]).replace('.', ',')} ${suffix}`, ml };
      }
    }
  }
  return { code: raw.slice(0, 20), label: clean(value, 20), ml: fallbackMl };
}

// --- Domaines d'activité ---------------------------------------------------------------------
// Trois familles, comme demandé. `code` est stable : il sert de clé de rattachement.
const DOMAINS = [
  // Restauration et boissons
  { code: 'maquis', label: 'Maquis', family: 'Restauration et boissons', sector: 'maquis' },
  { code: 'bar', label: 'Bar', family: 'Restauration et boissons', sector: 'maquis' },
  { code: 'restaurant', label: 'Restaurant', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'maquis_restaurant', label: 'Maquis-restaurant', family: 'Restauration et boissons', sector: 'maquis' },
  { code: 'bar_restaurant', label: 'Bar-restaurant', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'bar_maquis', label: 'Bar-maquis', family: 'Restauration et boissons', sector: 'maquis' },
  { code: 'restaurant_bar_maquis', label: 'Restaurant-bar-maquis', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'fast_food', label: 'Fast-food', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'grillade', label: 'Grillade', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'vente_boissons', label: 'Espace de vente de boissons', family: 'Restauration et boissons', sector: 'maquis' },
  { code: 'hotel_restaurant', label: 'Hôtel-restaurant', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'cafe', label: 'Café', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'patisserie', label: 'Pâtisserie', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'boulangerie', label: 'Boulangerie', family: 'Restauration et boissons', sector: 'restaurant' },
  { code: 'glacier', label: 'Glacier', family: 'Restauration et boissons', sector: 'restaurant' },
  // Commerce et distribution
  { code: 'supermarche', label: 'Supermarché', family: 'Commerce et distribution', sector: 'general' },
  { code: 'superette', label: 'Supérette', family: 'Commerce et distribution', sector: 'general' },
  { code: 'boutique_generale', label: 'Boutique générale', family: 'Commerce et distribution', sector: 'general' },
  { code: 'quincaillerie', label: 'Quincaillerie', family: 'Commerce et distribution', sector: 'hardware' },
  { code: 'materiaux', label: 'Magasin de matériaux de construction', family: 'Commerce et distribution', sector: 'hardware' },
  { code: 'vetements', label: 'Boutique de vêtements', family: 'Commerce et distribution', sector: 'clothing' },
  { code: 'chaussures', label: 'Magasin de chaussures', family: 'Commerce et distribution', sector: 'clothing' },
  { code: 'parfumerie', label: 'Parfumerie', family: 'Commerce et distribution', sector: 'general' },
  { code: 'cosmetique', label: 'Cosmétique et beauté', family: 'Commerce et distribution', sector: 'general' },
  { code: 'pharmacie', label: 'Pharmacie et parapharmacie', family: 'Commerce et distribution', sector: 'general' },
  { code: 'electronique', label: "Magasin d'électronique", family: 'Commerce et distribution', sector: 'general' },
  { code: 'telephonie', label: 'Téléphonie', family: 'Commerce et distribution', sector: 'general' },
  { code: 'informatique', label: 'Informatique', family: 'Commerce et distribution', sector: 'general' },
  { code: 'librairie', label: 'Librairie', family: 'Commerce et distribution', sector: 'general' },
  { code: 'meubles', label: 'Magasin de meubles', family: 'Commerce et distribution', sector: 'general' },
  { code: 'alimentaire', label: 'Vente de produits alimentaires', family: 'Commerce et distribution', sector: 'general' },
  // Services et autres
  { code: 'coiffure', label: 'Salon de coiffure', family: 'Services et autres activités', sector: 'general' },
  { code: 'institut_beaute', label: 'Institut de beauté', family: 'Services et autres activités', sector: 'general' },
  { code: 'pressing', label: 'Pressing', family: 'Services et autres activités', sector: 'general' },
  { code: 'hotel', label: 'Hôtel', family: 'Services et autres activités', sector: 'general' },
  { code: 'residence', label: 'Résidence meublée', family: 'Services et autres activités', sector: 'general' },
  { code: 'salle_sport', label: 'Salle de sport', family: 'Services et autres activités', sector: 'general' },
  { code: 'loisirs', label: 'Espace de loisirs', family: 'Services et autres activités', sector: 'general' },
  { code: 'services', label: 'Prestataire de services', family: 'Services et autres activités', sector: 'general' },
  { code: 'autre', label: 'Autre activité', family: 'Services et autres activités', sector: 'general', custom: true },
];

// --- Catégories modèles ----------------------------------------------------------------------
// `domains` : rattachement. Une catégorie partagée (ex. « Bières ») n'est créée qu'une fois
// par boutique grâce à la clé `slug` + index unique (store_id, slug).
const CATEGORIES = [
  { slug: 'bieres', label: 'Bières', domains: ['maquis', 'bar', 'maquis_restaurant', 'bar_restaurant', 'bar_maquis', 'restaurant_bar_maquis', 'vente_boissons', 'hotel_restaurant', 'supermarche', 'superette', 'boutique_generale', 'alimentaire'] },
  { slug: 'boissons-gazeuses', label: 'Boissons gazeuses', domains: ['maquis', 'bar', 'restaurant', 'maquis_restaurant', 'bar_restaurant', 'bar_maquis', 'restaurant_bar_maquis', 'fast_food', 'grillade', 'vente_boissons', 'hotel_restaurant', 'cafe', 'supermarche', 'superette', 'boutique_generale', 'alimentaire'] },
  { slug: 'eaux', label: 'Eaux', domains: ['maquis', 'bar', 'restaurant', 'maquis_restaurant', 'bar_restaurant', 'bar_maquis', 'restaurant_bar_maquis', 'fast_food', 'grillade', 'vente_boissons', 'hotel_restaurant', 'cafe', 'salle_sport', 'supermarche', 'superette', 'boutique_generale', 'alimentaire'] },
  { slug: 'jus', label: 'Jus et boissons fruitées', domains: ['maquis', 'bar', 'restaurant', 'maquis_restaurant', 'bar_restaurant', 'bar_maquis', 'restaurant_bar_maquis', 'fast_food', 'vente_boissons', 'hotel_restaurant', 'cafe', 'supermarche', 'superette', 'alimentaire'] },
  { slug: 'energisantes', label: 'Boissons énergisantes et maltées', domains: ['maquis', 'bar', 'maquis_restaurant', 'bar_maquis', 'vente_boissons', 'supermarche', 'superette', 'boutique_generale', 'salle_sport'] },
  { slug: 'vins-spiritueux', label: 'Vins et spiritueux', domains: ['bar', 'bar_restaurant', 'bar_maquis', 'restaurant_bar_maquis', 'hotel_restaurant', 'vente_boissons', 'supermarche'] },
  { slug: 'plats', label: 'Plats', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'bar_restaurant', 'restaurant_bar_maquis', 'fast_food', 'hotel_restaurant'] },
  { slug: 'grillades', label: 'Grillades', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'grillade', 'restaurant_bar_maquis', 'hotel_restaurant'] },
  { slug: 'entrees', label: 'Entrées', domains: ['restaurant', 'bar_restaurant', 'restaurant_bar_maquis', 'hotel_restaurant'] },
  { slug: 'accompagnements', label: 'Accompagnements', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'fast_food', 'grillade', 'hotel_restaurant'] },
  { slug: 'desserts', label: 'Desserts', domains: ['restaurant', 'fast_food', 'hotel_restaurant', 'patisserie', 'glacier'] },
  { slug: 'menus', label: 'Menus', domains: ['restaurant', 'maquis_restaurant', 'fast_food', 'hotel_restaurant'] },
  { slug: 'pain-viennoiserie', label: 'Pains et viennoiseries', domains: ['boulangerie', 'patisserie', 'supermarche', 'superette'] },
  { slug: 'glaces', label: 'Glaces et desserts glacés', domains: ['glacier', 'patisserie', 'supermarche'] },
  { slug: 'ciment', label: 'Ciment', domains: ['quincaillerie', 'materiaux'] },
  { slug: 'fer', label: 'Fer et aciers', domains: ['quincaillerie', 'materiaux'] },
  { slug: 'peinture', label: 'Peinture', domains: ['quincaillerie', 'materiaux'] },
  { slug: 'plomberie', label: 'Plomberie', domains: ['quincaillerie', 'materiaux'] },
  { slug: 'electricite', label: 'Électricité', domains: ['quincaillerie', 'materiaux', 'electronique'] },
  { slug: 'outillage', label: 'Outillage', domains: ['quincaillerie', 'materiaux'] },
  { slug: 'alimentation', label: 'Alimentation', domains: ['supermarche', 'superette', 'boutique_generale', 'alimentaire'] },
  { slug: 'hygiene', label: 'Hygiène', domains: ['supermarche', 'superette', 'pharmacie', 'boutique_generale'] },
  { slug: 'entretien', label: 'Entretien', domains: ['supermarche', 'superette', 'boutique_generale'] },
  { slug: 'vetements', label: 'Vêtements', domains: ['vetements', 'supermarche'] },
  { slug: 'chaussures', label: 'Chaussures', domains: ['chaussures', 'vetements'] },
  { slug: 'cosmetiques', label: 'Cosmétiques et parfums', domains: ['parfumerie', 'cosmetique', 'institut_beaute', 'supermarche'] },
  { slug: 'prestations', label: 'Prestations', domains: ['coiffure', 'institut_beaute', 'pressing', 'salle_sport', 'loisirs', 'services'] },
  { slug: 'produits-capillaires', label: 'Produits capillaires', domains: ['coiffure', 'institut_beaute', 'cosmetique'] },
  { slug: 'accessoires', label: 'Accessoires', domains: ['coiffure', 'institut_beaute', 'telephonie', 'informatique', 'electronique', 'librairie'] },
  { slug: 'telephonie', label: 'Téléphones et accessoires', domains: ['telephonie', 'electronique'] },
  { slug: 'informatique', label: 'Informatique', domains: ['informatique', 'electronique'] },
  { slug: 'livres', label: 'Livres et fournitures', domains: ['librairie'] },
  { slug: 'meubles', label: 'Meubles', domains: ['meubles'] },
  { slug: 'chambres', label: 'Chambres et nuitées', domains: ['hotel', 'residence', 'hotel_restaurant'] },
  { slug: 'autres', label: 'Autres produits', domains: '*' },
];

// --- Produits modèles du catalogue général ---------------------------------------------------
// `category` = slug de catégorie. `name` = nom affiché par défaut (modifiable par le marchand).
// `volume` = contenance normalisée. `unit` = unité de vente par défaut.
// Aucun prix : le champ n'existe pas ici, il est saisi par chaque marchand.
const BEVERAGES = [
  // Bières
  { key: 'beaufort_lager_33cl', name: 'Beaufort Lager 33 cl', brand: 'Beaufort', category: 'bieres', variant: '', volume: '33cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'beaufort_lager_33cl' },
  { key: 'beaufort_lager_50cl', name: 'Beaufort Lager 50 cl', brand: 'Beaufort', category: 'bieres', variant: '', volume: '50cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'beaufort_lager_50cl' },
  { key: 'beaufort_lager_canette_33cl', name: 'Beaufort Lager canette 33 cl', brand: 'Beaufort', category: 'bieres', variant: 'Canette', volume: '33cl', unit: 'canette', packaging: 'Canette', image: 'beaufort_lager_canette_33cl' },
  { key: 'bock_33cl', name: 'Bock 33 cl', brand: 'Bock', category: 'bieres', variant: '', volume: '33cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'bock_33cl' },
  { key: 'bock_65cl', name: 'Bock 65 cl', brand: 'Bock', category: 'bieres', variant: '', volume: '65cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'bock_65cl' },
  { key: 'bock_canette_33cl', name: 'Bock canette 33 cl', brand: 'Bock', category: 'bieres', variant: 'Canette', volume: '33cl', unit: 'canette', packaging: 'Canette', image: 'bock_canette_33cl' },
  { key: 'castel_beer_65cl', name: 'Castel Beer 65 cl', brand: 'Castel Beer', category: 'bieres', variant: '', volume: '65cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'castel_beer_65cl' },
  { key: 'guinness_fes_33cl', name: 'Guinness Foreign Extra Stout 33 cl', brand: 'Guinness', category: 'bieres', variant: 'Foreign Extra Stout', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'guinness_fes_33cl' },
  { key: 'doppel_munich_33cl', name: 'Doppel Munich 33 cl', brand: 'Doppel', category: 'bieres', variant: 'Munich', volume: '33cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'doppel_munich_33cl' },
  { key: 'doppel_munich_50cl', name: 'Doppel Munich 50 cl', brand: 'Doppel', category: 'bieres', variant: 'Munich', volume: '50cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'doppel_munich_50cl' },
  { key: 'sombreros_50cl', name: 'Sombreros 50 cl', brand: 'Sombreros', category: 'bieres', variant: '', volume: '50cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'sombreros_50cl' },
  { key: 'chill_citron_33cl', name: 'Chill Citron 33 cl', brand: 'Chill', category: 'bieres', variant: 'Citron', volume: '33cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'chill_citron_33cl' },
  { key: 'chill_citron_canette_33cl', name: 'Chill Citron canette 33 cl', brand: 'Chill', category: 'bieres', variant: 'Citron', volume: '33cl', unit: 'canette', packaging: 'Canette', image: 'chill_citron_canette_33cl' },
  { key: 'corona_extra_33cl', name: 'Corona Extra 33 cl', brand: 'Corona', category: 'bieres', variant: 'Extra', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'corona_extra_33cl' },
  { key: 'budweiser_33cl', name: 'Budweiser 33 cl', brand: 'Budweiser', category: 'bieres', variant: '', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'budweiser_33cl' },
  { key: 'ivoire_60cl', name: 'Ivoire 60 cl', brand: 'Ivoire', category: 'bieres', variant: 'Classic', volume: '60cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'ivoire_60cl' },
  { key: 'ivoire_black_60cl', name: 'Ivoire Black 60 cl', brand: 'Ivoire', category: 'bieres', variant: 'Black', volume: '60cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'ivoire_black_60cl' },
  { key: 'heineken_50cl', name: 'Heineken 50 cl', brand: 'Heineken', category: 'bieres', variant: '', volume: '50cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'heineken_50cl' },
  { key: 'desperados_33cl', name: 'Desperados 33 cl', brand: 'Desperados', category: 'bieres', variant: '', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'desperados_33cl' },
  // Énergisantes et maltées
  { key: 'rhino_energy_malt_33cl', name: 'Rhino Energy Malt 33 cl', brand: 'Rhino', category: 'energisantes', variant: 'Energy Malt', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'rhino_energy_malt_33cl' },
  { key: 'malta_guinness_33cl', name: 'Malta Guinness 33 cl', brand: 'Malta Guinness', category: 'energisantes', variant: '', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'malta_guinness_33cl' },
  { key: 'xxl_energy_canette_33cl', name: 'XXL Energy canette 33 cl', brand: 'XXL', category: 'energisantes', variant: 'Energy', volume: '33cl', unit: 'canette', packaging: 'Canette', image: 'xxl_energy_canette_33cl' },
  { key: 'doppel_energy_malt_33cl', name: 'Doppel Energy Malt 33 cl', brand: 'Doppel', category: 'energisantes', variant: 'Energy Malt', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'doppel_energy_malt_33cl' },
  // Gazeuses
  { key: 'world_cola_33cl', name: 'World Cola 33 cl', brand: 'World Cola', category: 'boissons-gazeuses', variant: 'Cola', volume: '33cl', unit: 'bouteille', packaging: 'Verre consigné', image: 'world_cola_33cl' },
  { key: 'youki_50cl', name: 'Youki Orange 50 cl', brand: 'Youki', category: 'boissons-gazeuses', variant: 'Orange', volume: '50cl', unit: 'bouteille', packaging: 'PET', image: 'youki_50cl' },
  { key: 'youzou_50cl', name: 'Youzou 50 cl', brand: 'Youzou', category: 'boissons-gazeuses', variant: 'Citron-citron vert', volume: '50cl', unit: 'bouteille', packaging: 'PET', image: 'youzou_50cl' },
  { key: 'orangina_50cl', name: 'Orangina 50 cl', brand: 'Orangina', category: 'boissons-gazeuses', variant: 'Orange', volume: '50cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'orangina_50cl' },
  // Eaux
  { key: 'eau_awa_50cl', name: 'Awa eau minérale 50 cl', brand: 'Awa', category: 'eaux', variant: 'Naturelle', volume: '50cl', unit: 'bouteille', packaging: 'PET', image: 'eau_awa_50cl' },
  { key: 'eau_awa_15l', name: 'Awa eau minérale 1,5 L', brand: 'Awa', category: 'eaux', variant: 'Naturelle', volume: '1,5l', unit: 'bouteille', packaging: 'PET', image: 'eau_awa_15l' },
  { key: 'eau_celeste_15l', name: 'Céleste eau minérale 1,5 L', brand: 'Céleste', category: 'eaux', variant: 'Naturelle', volume: '1,5l', unit: 'bouteille', packaging: 'PET', image: 'eau_celeste_15l' },
  { key: 'eau_cristaline_15l', name: 'Cristaline eau de source 1,5 L', brand: 'Cristaline', category: 'eaux', variant: 'Source', volume: '1,5l', unit: 'bouteille', packaging: 'PET', image: 'eau_cristaline_15l' },
  // Contenance : 1,8 L d'après l'étiquette du packshot de référence (et non 1,5 L).
  { key: 'eau_olgane_18l', name: 'Olgane eau minérale 1,8 L', brand: 'Olgane', category: 'eaux', variant: 'Naturelle', volume: '1,8l', unit: 'bouteille', packaging: 'PET', image: 'eau_olgane_18l' },
  { key: 'eau_kirene_15l', name: 'Kirène eau minérale 1,5 L', brand: 'Kirène', category: 'eaux', variant: 'Naturelle', volume: '1,5l', unit: 'bouteille', packaging: 'PET', image: 'eau_kirene_15l' },
  // Vins et spiritueux
  { key: 'valpierre_50cl', name: 'Valpierre vin rouge 50 cl', brand: 'Valpierre', category: 'vins-spiritueux', variant: 'Rouge', volume: '50cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'valpierre_50cl' },
  { key: 'racines_33cl', name: 'Racines 33 cl', brand: 'Racines', category: 'vins-spiritueux', variant: 'Alcomix', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'racines_33cl' },
  { key: 'racines_fort_33cl', name: 'Racines Fort 33 cl', brand: 'Racines', category: 'vins-spiritueux', variant: 'Fort', volume: '33cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'racines_fort_33cl' },
  { key: 'vin_cabernet_de_jouvence', name: 'Cabernet de Jouvence', brand: 'Cabernet de Jouvence', category: 'vins-spiritueux', variant: 'Rouge', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_cabernet_de_jouvence' },
  { key: 'vin_cdj_cuvee_carte_dor', name: "CDJ Cuvée Carte d'Or", brand: 'CDJ', category: 'vins-spiritueux', variant: 'Cuvée Carte d\'Or', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_cdj_cuvee_carte_dor' },
  { key: 'vin_cabernet_du_baron', name: 'Cabernet du Baron', brand: 'Cabernet du Baron', category: 'vins-spiritueux', variant: 'Rouge', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_cabernet_du_baron' },
  { key: 'vin_familia_gasmann', name: 'Familia Gasmann', brand: 'Familia Gasmann', category: 'vins-spiritueux', variant: 'Rouge', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_familia_gasmann' },
  { key: 'vin_famille_gasmann_bordeaux', name: 'Famille Gasmann Bordeaux', brand: 'Famille Gasmann', category: 'vins-spiritueux', variant: 'Bordeaux', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_famille_gasmann_bordeaux' },
  { key: 'vin_grande_terre', name: 'Grande Terre', brand: 'Grande Terre', category: 'vins-spiritueux', variant: 'Rouge', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_grande_terre' },
  { key: 'vin_puy_joubert_rouge', name: 'Puy Joubert rouge', brand: 'Puy Joubert', category: 'vins-spiritueux', variant: 'Rouge', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_puy_joubert_rouge' },
  { key: 'vin_puy_joubert_blanc', name: 'Puy Joubert blanc', brand: 'Puy Joubert', category: 'vins-spiritueux', variant: 'Blanc', volume: '75cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'vin_puy_joubert_blanc' },
  { key: 'calao_rhum_1l', name: 'Calao Rhum 1 L', brand: 'Calao', category: 'vins-spiritueux', variant: 'Rhum', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'calao_rhum_1l' },
  { key: 'calao_spirit_1l', name: 'Calao Spirit 1 L', brand: 'Calao', category: 'vins-spiritueux', variant: 'Spirit', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'calao_spirit_1l' },
  { key: 'calao_menthe_1l', name: 'Calao Menthe 1 L', brand: 'Calao', category: 'vins-spiritueux', variant: 'Menthe', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'calao_menthe_1l' },
  { key: 'calao_bitters_1l', name: 'Calao Bitters 1 L', brand: 'Calao', category: 'vins-spiritueux', variant: 'Bitters', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'calao_bitters_1l' },
  { key: 'cafe_force_1l', name: 'Café Force 1 L', brand: 'Café Force', category: 'vins-spiritueux', variant: 'Liqueur café', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'cafe_force_1l' },
  { key: 'cola_force_1l', name: 'Cola Force 1 L', brand: 'Cola Force', category: 'vins-spiritueux', variant: 'Cola', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'cola_force_1l' },
  { key: 'rhum_flamboyant_1l', name: 'Rhum Flamboyant 1 L', brand: 'Flamboyant', category: 'vins-spiritueux', variant: 'Rhum', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'rhum_flamboyant_1l' },
  { key: 'rhum_royal_1l', name: 'Rhum Royal 1 L', brand: 'Royal', category: 'vins-spiritueux', variant: 'Rhum', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'rhum_royal_1l' },
  { key: 'spirit_lord_melson_1l', name: 'Lord Melson 1 L', brand: 'Lord Melson', category: 'vins-spiritueux', variant: 'Spirit', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'spirit_lord_melson_1l' },
  { key: 'gin_london_dry_citron_1l', name: 'London Dry Gin Citron 1 L', brand: 'London Dry', category: 'vins-spiritueux', variant: 'Citron', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'gin_london_dry_citron_1l' },
  { key: 'gin_amiral_1l', name: 'Gin Amiral 1 L', brand: 'Amiral', category: 'vins-spiritueux', variant: 'Gin', volume: '1l', unit: 'bouteille', packaging: 'Verre perdu', image: 'gin_amiral_1l' },
  // Contenance : 100 cl d'après l'étiquette du packshot de référence Mibem (et non 70 cl).
  { key: 'gin_dekkers', name: 'Dekkers Gin 1 L', brand: 'Dekkers', category: 'vins-spiritueux', variant: 'Gin Holland', volume: '100cl', unit: 'bouteille', packaging: 'Verre perdu', image: 'gin_dekkers' },
];

// Produits modèles non boissons, par domaine. Volontairement sobres : ce sont des modèles
// de départ, pas un catalogue exhaustif inventé.
const FOOD_AND_GOODS = [
  { key: 'poulet_braise', name: 'Poulet braisé', category: 'grillades', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'grillade', 'restaurant_bar_maquis', 'hotel_restaurant'] },
  { key: 'poisson_braise', name: 'Poisson braisé', category: 'grillades', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'grillade', 'restaurant_bar_maquis', 'hotel_restaurant'] },
  { key: 'brochettes', name: 'Brochettes', category: 'grillades', unit: 'portion', domains: ['maquis', 'maquis_restaurant', 'grillade', 'restaurant_bar_maquis'] },
  { key: 'attiéké', name: 'Attiéké', category: 'accompagnements', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'fast_food', 'grillade', 'hotel_restaurant'] },
  { key: 'alloco', name: 'Alloco', category: 'accompagnements', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'fast_food', 'grillade', 'restaurant_bar_maquis'] },
  { key: 'frites', name: 'Frites', category: 'accompagnements', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'fast_food', 'restaurant_bar_maquis'] },
  { key: 'riz', name: 'Riz', category: 'accompagnements', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'fast_food', 'hotel_restaurant'] },
  { key: 'sauce_graine', name: 'Sauce graine', category: 'plats', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'hotel_restaurant'] },
  { key: 'kedjenou', name: 'Kedjenou de poulet', category: 'plats', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'hotel_restaurant'] },
  { key: 'soupe_poisson', name: 'Soupe de poisson', category: 'plats', unit: 'portion', domains: ['maquis', 'restaurant', 'maquis_restaurant', 'hotel_restaurant'] },
  { key: 'menu_du_jour', name: 'Menu du jour', category: 'menus', unit: 'service', domains: ['restaurant', 'maquis_restaurant', 'fast_food', 'hotel_restaurant'] },
  { key: 'ciment_50kg', name: 'Ciment 50 kg', category: 'ciment', unit: 'sac', domains: ['quincaillerie', 'materiaux'] },
  { key: 'fer_a_beton', name: 'Fer à béton', category: 'fer', unit: 'metre', domains: ['quincaillerie', 'materiaux'] },
  { key: 'peinture_5l', name: 'Peinture 5 L', category: 'peinture', unit: 'piece', domains: ['quincaillerie', 'materiaux'] },
  { key: 'coude_pvc', name: 'Coude PVC', category: 'plomberie', unit: 'piece', domains: ['quincaillerie', 'materiaux'] },
  { key: 'cable_electrique', name: 'Câble électrique', category: 'electricite', unit: 'metre', domains: ['quincaillerie', 'materiaux', 'electronique'] },
  { key: 'marteau', name: 'Marteau', category: 'outillage', unit: 'piece', domains: ['quincaillerie', 'materiaux'] },
  { key: 'coupe_homme', name: 'Coupe homme', category: 'prestations', unit: 'service', domains: ['coiffure'] },
  { key: 'tresses', name: 'Tresses', category: 'prestations', unit: 'service', domains: ['coiffure', 'institut_beaute'] },
  { key: 'manucure', name: 'Manucure', category: 'prestations', unit: 'service', domains: ['institut_beaute'] },
  { key: 'pressing_chemise', name: 'Pressing chemise', category: 'prestations', unit: 'piece', domains: ['pressing'] },
  { key: 'nuit_chambre', name: 'Nuitée chambre', category: 'chambres', unit: 'service', domains: ['hotel', 'residence', 'hotel_restaurant'] },
  { key: 'pain_baguette', name: 'Baguette de pain', category: 'pain-viennoiserie', unit: 'piece', domains: ['boulangerie', 'patisserie', 'supermarche', 'superette'] },
  { key: 'croissant', name: 'Croissant', category: 'pain-viennoiserie', unit: 'piece', domains: ['boulangerie', 'patisserie'] },
  { key: 'glace_boule', name: 'Glace (la boule)', category: 'glaces', unit: 'portion', domains: ['glacier', 'patisserie', 'supermarche'] },
  { key: 'riz_sac_5kg', name: 'Riz sac de 5 kg', category: 'alimentation', unit: 'sac', domains: ['supermarche', 'superette', 'boutique_generale', 'alimentaire'] },
  { key: 'huile_1l', name: 'Huile 1 L', category: 'alimentation', unit: 'bouteille', domains: ['supermarche', 'superette', 'boutique_generale', 'alimentaire'] },
  { key: 'savon', name: 'Savon', category: 'hygiene', unit: 'piece', domains: ['supermarche', 'superette', 'boutique_generale', 'pharmacie'] },
  { key: 'eau_de_javel', name: 'Eau de javel', category: 'entretien', unit: 'bouteille', domains: ['supermarche', 'superette', 'boutique_generale'] },
  { key: 'tshirt', name: 'T-shirt', category: 'vetements', unit: 'piece', domains: ['vetements', 'supermarche'] },
  { key: 'chaussures_sport', name: 'Chaussures de sport', category: 'chaussures', unit: 'piece', domains: ['chaussures', 'vetements'] },
  { key: 'parfum_50ml', name: 'Parfum 50 ml', category: 'cosmetiques', unit: 'piece', domains: ['parfumerie', 'cosmetique', 'institut_beaute', 'supermarche'] },
  { key: 'chargeur_usb', name: 'Chargeur USB', category: 'telephonie', unit: 'piece', domains: ['telephonie', 'electronique'] },
  { key: 'cahier_200p', name: 'Cahier 200 pages', category: 'livres', unit: 'piece', domains: ['librairie'] },
];

// Libellé affiché : jamais deux fois la même contenance ni deux fois le même mot de marque.
function displayLabel(item) {
  const norm = (v) => String(v || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  const volume = normalizeVolume(item.volume);
  let label = String(item.name || '').trim();
  // Un nom qui annonce déjà une contenance ne la reçoit pas une seconde fois (« … 1 L 100 cl »).
  if (/\d[\s.,]*(cl|ml|l)\b/i.test(label)) return label;
  if (!volume.ml) return label;
  if (norm(label).includes(norm(volume.label)) || norm(label).replace(/\s/g, '').includes(norm(volume.label).replace(/\s/g, ''))) return label;
  return `${label} ${volume.label}`;
}

module.exports = { UNITS, VOLUMES, DOMAINS, CATEGORIES, BEVERAGES, FOOD_AND_GOODS, normalizeVolume, volumeByCode, ensureVolumes, displayLabel };
