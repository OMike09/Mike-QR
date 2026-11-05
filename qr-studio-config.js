'use strict';

const crypto = require('node:crypto');
const STATIC = require('./public/qr-templates');

const FIELD_TYPES = new Set(['text','textarea','number','price','phone','email','date','url','image','document','checkbox','select']);
const KINDS = new Set(['restaurant','catalog','hotel','professional','health','education','organization','event','contact','link','gallery','other']);
const PURPOSES = new Set(['contact','catalog','prices','menu','website','social','services','order','other']);
const BENEFICIARY_TYPES = new Set(['individual','business','commerce','organization','other']);
const STYLES = new Set(['modern','elegant','minimal','professional','luxury','creative','classic','natural','colorful','premium']);
const LAYOUTS = new Set(['cover','logo','cards','catalog','tabs','grid','list','gallery']);
const GALLERY_CATEGORIES = [
  { id:'perroquets', label:'Perroquets' }, { id:'paons', label:'Paons' }, { id:'colibris', label:'Colibris' },
  { id:'fleurs', label:'Fleurs' }, { id:'forets', label:'Forêts' }, { id:'cascades', label:'Cascades' },
  { id:'rivieres', label:'Rivières' }, { id:'montagnes', label:'Montagnes' }, { id:'tropical', label:'Paysages tropicaux' },
  { id:'africain', label:'Paysages africains' }, { id:'couchers-soleil', label:'Couchers de soleil' }, { id:'nature', label:'Nature et jardins' },
];
const MODEL_DEFAULT_GROUPS = {
  restaurant:['Entrées','Plats','Grillades','Poissons','Poulets','Accompagnements','Desserts','Boissons','Promotions'],
  hotel:['Chambres','Équipements','Services'], catalog:['Nouveautés','Produits','Promotions'],
  coiffure:['Prestations','Réalisations'], beaute:['Soins','Prestations','Réalisations'],
  entreprise:['Services','Domaines d’intervention','Références et réalisations'],
  ecole:['Formations','Programmes','Conditions d’admission'], clinique:['Services','Spécialités','Informations pratiques'],
  association:['Mission','Activités','Projets'], evenement:['Programme','Intervenants','Informations pratiques'],
  immobilier:['Biens','À louer','À vendre'], 'carte-visite':['Coordonnées','Réseaux sociaux'],
};
function text(value, max = 160) { return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max); }
function slug(value, max = 48) { return text(value, 100).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, max); }
function uniqueStrings(values, maxItems = 30, maxLength = 80) {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).slice(0, maxItems).map((item) => text(item, maxLength)).filter((item) => {
    const key = item.toLocaleLowerCase('fr'); if (!item || seen.has(key)) return false; seen.add(key); return true;
  });
}
function stripTemplateHistory(template) {
  const { history, ...clean } = template || {};
  return clean;
}
function normalizeSections(input, previous = []) {
  const source = Array.isArray(input) ? input.slice(0, 20) : previous;
  const seen = new Set();
  const sections = source.map((section, index) => {
    const title = text(section?.title || section?.label, 100);
    let id = slug(section?.id || title || `section-${index + 1}`, 40);
    if (!id) id = `section-${index + 1}`;
    if (seen.has(id)) throw new Error(`L’identifiant de rubrique « ${id} » est utilisé deux fois.`);
    seen.add(id);
    if (!title) throw new Error('Chaque rubrique du modèle doit avoir un titre.');
    return { id, title, description:text(section?.description, 300), order:index };
  });
  if (!sections.length) return [{ id:'general', title:'Informations complémentaires', description:'', order:0 }];
  return sections;
}
function normalizeFields(input, sections, previous = []) {
  const source = Array.isArray(input) ? input.slice(0, 60) : previous;
  const keys = new Set();
  return source.map((field, index) => {
    const key = text(field?.key || field?.id, 60).replace(/[^A-Za-z0-9_]/g, '');
    const label = text(field?.label, 100);
    const type = FIELD_TYPES.has(field?.type) ? field.type : 'text';
    const sectionId = sections.some((section) => section.id === field?.sectionId) ? field.sectionId : sections[0].id;
    if (!/^[A-Za-z][A-Za-z0-9_]{1,39}$/.test(key)) throw new Error('Chaque champ doit avoir une clé unique (2 à 40 caractères, lettres, chiffres ou _).');
    if (keys.has(key)) throw new Error(`La clé de champ « ${key} » est utilisée deux fois.`);
    if (!label) throw new Error(`Le libellé du champ « ${key} » est obligatoire.`);
    keys.add(key);
    const rawMax = Number(field?.maxLength);
    const options = uniqueStrings(field?.options, 20, 80);
    if (type === 'select' && options.length < 2) throw new Error(`Le champ « ${label} » de type liste doit avoir au moins deux choix.`);
    return {
      key, label, type, sectionId, required:field?.required === true,
      placeholder:text(field?.placeholder, 120), description:text(field?.description, 240),
      maxLength:Number.isFinite(rawMax) ? Math.min(2000, Math.max(1, Math.round(rawMax))) : (type === 'textarea' ? 1000 : 240),
      min:Number.isFinite(Number(field?.min)) ? Math.max(-1_000_000_000, Number(field.min)) : null,
      max:Number.isFinite(Number(field?.max)) ? Math.min(1_000_000_000, Number(field.max)) : null,
      options,
      order:index,
    };
  });
}
function normalizeTemplate(input, { id = '', previous = null, categories = [] } = {}) {
  const label = text(input?.label ?? input?.name, 100);
  const description = text(input?.description, 300);
  const group = text(input?.collectionLabel ?? input?.group ?? previous?.group, 40) || 'Modèles du PDG';
  const groupId = `pdg-${slug(group, 32) || 'custom'}`;
  const kind = KINDS.has(input?.kind) ? input.kind : 'other';
  if (!label) throw new Error('Le nom du modèle est obligatoire.');
  if (!description) throw new Error('Ajoutez une courte description du modèle.');
  const sections = normalizeSections(input?.sections, previous?.sections);
  const fields = normalizeFields(input?.fields, sections, previous?.fields);
  const purpose = PURPOSES.has(input?.purpose) ? input.purpose : (kind === 'restaurant' ? 'menu' : kind === 'catalog' ? 'catalog' : kind === 'contact' ? 'contact' : 'other');
  const beneficiaryType = BENEFICIARY_TYPES.has(input?.beneficiaryType) ? input.beneficiaryType : (['restaurant','catalog'].includes(kind) ? 'commerce' : ['organization','education','event'].includes(kind) ? 'organization' : kind === 'contact' ? 'individual' : 'business');
  const existingCategoryIds = new Set((Array.isArray(categories) ? categories : []).map((item) => item.id));
  const categoryId = text(input?.categoryId ?? previous?.categoryId, 100) || (kind === 'restaurant' || kind === 'catalog' ? 'cat-shops' : kind === 'contact' ? 'cat-individuals' : kind === 'organization' || kind === 'education' || kind === 'event' ? 'cat-organizations' : 'cat-businesses');
  if (existingCategoryIds.size && !existingCategoryIds.has(categoryId)) throw new Error('Choisissez une catégorie Oymike QR existante.');
  const paletteId = STATIC.palettes.some((palette) => palette.id === input?.defaultTheme?.paletteId) ? input.defaultTheme.paletteId : (previous?.defaultTheme?.paletteId || 'forest');
  const style = STYLES.has(input?.defaultTheme?.style) ? input.defaultTheme.style : (previous?.defaultTheme?.style || 'professional');
  const layout = LAYOUTS.has(input?.defaultTheme?.layout) ? input.defaultTheme.layout : (previous?.defaultTheme?.layout || (kind === 'restaurant' || kind === 'catalog' ? 'catalog' : 'cover'));
  const defaultGroups = uniqueStrings(input?.defaultGroups ?? previous?.defaultGroups ?? MODEL_DEFAULT_GROUPS[label.toLocaleLowerCase('fr')] ?? (kind === 'restaurant' ? MODEL_DEFAULT_GROUPS.restaurant : kind === 'hotel' ? MODEL_DEFAULT_GROUPS.hotel : kind === 'catalog' ? MODEL_DEFAULT_GROUPS.catalog : ['Services']), 30, 80);
  const old = previous ? stripTemplateHistory(previous) : null;
  const candidate = {
    id:id || previous?.id || `custom-${crypto.randomUUID()}`,
    label, description, kind, purpose, beneficiaryType, categoryId,
    groupId, group, icon:text(input?.icon ?? previous?.icon, 12) || '✳',
    sections, fields, defaultGroups,
    defaultTheme:{ paletteId, style, layout },
    recommended:input?.recommended === true,
    enabled:input?.enabled === undefined ? (previous?.enabled !== false) : input.enabled === true,
    order:Number.isFinite(Number(input?.order)) ? Math.max(0, Math.min(1000, Math.round(Number(input.order)))) : (Number(previous?.order) || 0),
    version:previous ? (Number(previous.version) || 1) : 1,
    createdAt:previous?.createdAt || new Date().toISOString(),
    updatedAt:new Date().toISOString(),
    history:Array.isArray(previous?.history) ? previous.history.slice(-10) : [],
  };
  if (typeof candidate.enabled !== 'boolean') throw new Error('Le statut du modèle est invalide.');
  const comparison = (value) => JSON.stringify({ ...stripTemplateHistory(value), updatedAt:undefined, version:undefined });
  if (old && comparison(old) !== comparison(candidate)) {
    candidate.history = [...candidate.history, { version:old.version || 1, savedAt:new Date().toISOString(), definition:old }].slice(-10);
    candidate.version = (Number(old.version) || 1) + 1;
  }
  return candidate;
}
function templateSnapshot(template) {
  return {
    id:template.id, label:template.label, description:template.description || '', kind:template.kind || 'other',
    purpose:template.purpose || 'other', beneficiaryType:template.beneficiaryType || 'other', categoryId:template.categoryId || '',
    groupId:template.groupId || '', group:template.group || '', icon:template.icon || '✳',
    version:Number(template.version) || 1, sections:Array.isArray(template.sections) ? template.sections.map((item) => ({ ...item })) : [],
    fields:Array.isArray(template.fields) ? template.fields.map((item) => ({ ...item })) : [],
    defaultGroups:uniqueStrings(template.defaultGroups, 30, 80), defaultTheme:{ ...(template.defaultTheme || {}) },
  };
}
function normalizeGalleryAsset(input, { id = '', previous = null, maxBytes = 100 * 1024 } = {}) {
  const title = text(input?.title ?? input?.name, 100);
  const category = GALLERY_CATEGORIES.find((item) => item.id === input?.categoryId);
  const image = String(input?.image || previous?.image || '').trim();
  if (!title) throw new Error('Donnez un nom à cette image.');
  if (!category) throw new Error('Choisissez une catégorie de la galerie.');
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(image)) throw new Error('La galerie accepte uniquement des images JPG, PNG ou WebP importées.');
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(image);
  const bytes = Buffer.from(match[2], 'base64');
  const mime = match[1].toLowerCase();
  const valid = mime === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8
    : mime === 'png' ? bytes.length > 8 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : bytes.length > 12 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP';
  if (!valid) throw new Error('Le contenu du fichier ne correspond pas à son format image.');
  if (bytes.length > maxBytes) throw new Error(`Chaque image de galerie doit faire au maximum ${Math.round(maxBytes / 1024)} Kio après optimisation.`);
  return {
    id:id || previous?.id || `asset-${crypto.randomUUID()}`, title, categoryId:category.id, categoryLabel:category.label,
    description:text(input?.description ?? previous?.description, 240), alt:text(input?.alt ?? previous?.alt ?? title, 160), image,
    active:input?.active === undefined ? (previous?.active !== false) : input.active === true,
    order:Number.isFinite(Number(input?.order)) ? Math.max(0, Math.min(1000, Math.round(Number(input.order)))) : (Number(previous?.order) || 0),
    createdAt:previous?.createdAt || new Date().toISOString(), updatedAt:new Date().toISOString(),
  };
}
function validateCustomFields(template, values, { cleanText = text, httpUrl, validateImage, validateDocument } = {}) {
  const fields = Array.isArray(template?.fields) ? template.fields : [];
  const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {};
  const output = {};
  for (const field of fields) {
    const raw = source[field.key];
    const empty = raw == null || raw === '';
    const uncheckedRequired=field.type==='checkbox'&&field.required&&!(raw===true||raw==='true'||raw==='on');
    if (field.required && (empty||uncheckedRequired)) throw new Error(`Le champ « ${field.label} » est obligatoire.`);
    if (empty) continue;
    switch (field.type) {
      case 'number': case 'price': {
        const number = Number(raw);
        if (!Number.isFinite(number) || (field.type === 'price' && (!Number.isSafeInteger(number) || number < 0)) || (field.min != null && number < field.min) || (field.max != null && number > field.max)) throw new Error(`La valeur du champ « ${field.label} » est invalide.`);
        output[field.key] = field.type === 'price' ? number : Math.round(number * 100) / 100; break;
      }
      case 'checkbox': output[field.key] = raw === true || raw === 'true' || raw === 'on'; break;
      case 'url': {
        const url = httpUrl(raw, field.label, false); output[field.key] = url; break;
      }
      case 'image': output[field.key] = validateImage(raw, `Image « ${field.label} »`, 180 * 1024); break;
      case 'document': output[field.key] = validateDocument(raw, `Document « ${field.label} »`); break;
      case 'email': {
        const value = cleanText(raw, Math.min(254, field.maxLength || 254));
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw new Error(`L’adresse e-mail du champ « ${field.label} » n’est pas valide.`);
        output[field.key] = value; break;
      }
      case 'select': {
        const value = cleanText(raw, 120); if (!field.options.includes(value)) throw new Error(`Choisissez une valeur valide pour « ${field.label} ».`);
        output[field.key] = value; break;
      }
      case 'phone': output[field.key] = cleanText(raw, Math.min(50, field.maxLength || 50)); break;
      case 'date': {
        const value = cleanText(raw, 10); if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new Error(`La date du champ « ${field.label} » n’est pas valide.`);
        output[field.key] = value; break;
      }
      default: output[field.key] = cleanText(raw, field.maxLength || 240);
    }
  }
  return output;
}
module.exports = { FIELD_TYPES, KINDS, PURPOSES, GALLERY_CATEGORIES, MODEL_DEFAULT_GROUPS, normalizeTemplate, templateSnapshot, normalizeGalleryAsset, validateCustomFields, stripTemplateHistory, text, slug };
