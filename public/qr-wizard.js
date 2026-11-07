/* Progressive, data-driven QR creation experience shared by the PDG and managers. */
(function (root) {
  'use strict';
  const Templates = root.QRIA_TEMPLATES;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const uuid = () => root.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const number = (value) => new Intl.NumberFormat('fr-CI').format(Number(value || 0));
  const parseRows = (text, two = false) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [first = '', second = ''] = line.split('|').map((part) => part.trim());
    return two ? { label: first, url: second } : { name: first, url: second };
  }).filter((row) => row.label && row.url);
  const parsePriceRows = (text) => String(text || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name = '', amount = ''] = line.split('|').map((part) => part.trim());
    return { name, priceXof: amount ? Number(amount.replace(/[^\d]/g, '')) : null };
  }).filter((row) => row.name && (row.priceXof == null || Number.isSafeInteger(row.priceXof)));
  const safeHex = (color, fallback) => /^#[0-9a-f]{6}$/i.test(String(color || '')) ? color : fallback;
  const MODEL_DESIGN = {
    restaurant: { palette:'forest', style:'modern', layout:'catalog' }, maquis:{ palette:'dark-green-gold', style:'colorful', layout:'tabs' },
    bar:{ palette:'dark-green-gold', style:'premium', layout:'catalog' }, cafe:{ palette:'beige', style:'natural', layout:'cards' },
    hotel:{ palette:'luxury', style:'luxury', layout:'cover' }, boutique:{ palette:'navy', style:'professional', layout:'grid' },
    ecole:{ palette:'blue-gray', style:'classic', layout:'list' }, entreprise:{ palette:'navy', style:'professional', layout:'cards' },
    coiffure:{ palette:'wine', style:'elegant', layout:'gallery' }, beaute:{ palette:'blush', style:'premium', layout:'gallery' },
    cabinet:{ palette:'minimal', style:'minimal', layout:'list' }, association:{ palette:'forest', style:'natural', layout:'cards' },
    evenement:{ palette:'violet', style:'creative', layout:'cover' }, 'carte-visite':{ palette:'minimal', style:'minimal', layout:'logo' },
  };
  const THEME_COLOR_KEYS = ['pageBg','mainBg','card','panel','title','subtitle','description','price','button','buttonText','icon','border','separator','menuBg','menuText','link','badgeBg','badgeText'];
  const TYPE_GROUPS = [
    ['title','Titres'],['subtitle','Sous-titres'],['description','Descriptions'],['price','Prix'],['button','Boutons'],
  ];
  const FONT_OPTIONS = ['Inter','Poppins','Montserrat','Roboto','Open Sans','Lato','Playfair Display','Merriweather','Nunito','Raleway'];
  const TYPE_DEFAULTS = {
    title:{family:'Inter',size:34,weight:750,italic:false,align:'left',lineHeight:1.12,letterSpacing:-0.035,transform:'none'},
    subtitle:{family:'Inter',size:17,weight:550,italic:false,align:'left',lineHeight:1.45,letterSpacing:0,transform:'none'},
    description:{family:'Inter',size:16,weight:400,italic:false,align:'left',lineHeight:1.65,letterSpacing:0,transform:'none'},
    price:{family:'Montserrat',size:18,weight:750,italic:false,align:'left',lineHeight:1.2,letterSpacing:0,transform:'none'},
    button:{family:'Inter',size:14,weight:700,italic:false,align:'center',lineHeight:1.2,letterSpacing:.01,transform:'none'},
  };
  const defaultTheme = (template) => {
    const model = MODEL_DESIGN[template?.id] || { palette:template?.defaultTheme?.paletteId, style:template?.defaultTheme?.style, layout:template?.defaultTheme?.layout };
    const palette = Templates.palettes.find((item) => item.id === model.palette) || Templates.palettes.find((item) => item.id === 'forest') || Templates.palettes[0];
    return {
      ...palette, paletteId:palette.id, colors:clone(palette.colors),
      style:model.style || 'modern', layout:model.layout || (template?.kind === 'restaurant' || template?.kind === 'catalog' ? 'catalog' : 'cover'),
      font:'system', textSize:'normal', align:'left',
      typography:clone(TYPE_DEFAULTS),
      backgroundStyle:{ type:'solid', color1:palette.colors.pageBg, color2:palette.colors.mainBg, color3:palette.colors.panel, angle:135, image:'', imagePositionX:50, imagePositionY:50, imageOpacity:72, panelOpacity:92, pattern:'dots', patternOpacity:12 },
      components:{ cardStyle:'rounded', radius:16, borderWidth:1, shadow:'soft', spacing:24, buttonShape:'rounded', coverHeight:280, coverPositionX:50, coverPositionY:50, gridColumns:2, showLogo:true, showCover:true, showCategoryNav:false, collapsibleSections:false, galleryZoom:true, showBackToTop:false, sharePage:false, enableAnimation:false, bannerText:'', bannerLabel:'À la une', footerText:'', footerLink:'' },
    };
  };
  function completeTheme(value, template) {
    const base = defaultTheme(template); const existing = value && typeof value === 'object' ? value : {};
    const legacyColors = {
      pageBg:existing.background, mainBg:existing.background, card:existing.surface, panel:existing.surface,
      title:existing.text, subtitle:existing.text, description:existing.text, price:existing.primary, button:existing.button,
      icon:existing.primary, menuBg:existing.secondary, menuText:existing.primary, link:existing.primary, badgeBg:existing.secondary, badgeText:existing.primary,
    };
    const colors = { ...base.colors, ...legacyColors, ...(existing.colors || {}) };
    for (const key of THEME_COLOR_KEYS) if (!/^#[0-9a-f]{6}$/i.test(String(colors[key] || ''))) colors[key] = base.colors[key];
    const theme = {
      ...base, ...existing, colors,
      typography:Object.fromEntries(Object.entries(base.typography).map(([key,fallback]) => [key,{ ...fallback, ...(existing.typography?.[key] || {}) }])), 
      backgroundStyle:{ ...base.backgroundStyle, ...(existing.backgroundStyle || {}) },
      components:{ ...base.components, ...(existing.components || {}) },
    };
    theme.primary = colors.price; theme.secondary = colors.menuBg; theme.background = colors.mainBg;
    theme.surface = colors.card; theme.text = colors.description; theme.button = colors.button;
    return theme;
  }
  const THEME_PRESET_KEY = 'oymike-qr-theme-presets-v1';
  function readThemePresets() {
    try { const value = JSON.parse(window.localStorage.getItem(THEME_PRESET_KEY) || '[]'); return Array.isArray(value) ? value.filter((item) => item && typeof item.name === 'string' && item.theme).slice(0, 20) : []; }
    catch (_) { return []; }
  }
  const blankItem = (template) => ({ id: '', group: template?.defaultGroups?.[0] || (template?.kind === 'restaurant' ? 'Plats principaux' : 'À découvrir'), name: '', description: '', priceXof: '', promotionPriceXof: '', promotionLabel: '', available: true, featured: false, badge: '', badgeLabel: '', photos: [], variants: [], options: [] });
  const existingType = (type) => ['individual', 'business', 'commerce', 'organization', 'other'].includes(type) ? type : 'other';
  const groupLabelFor = (template) => template?.custom ? 'Groupe / catégorie' : template?.kind === 'restaurant' ? 'Catégorie du menu' : template?.kind === 'catalog' ? 'Catégorie' : template?.kind === 'hotel' ? 'Type de chambre' : template?.kind === 'education' ? 'Formation / programme' : template?.kind === 'event' ? 'Rubrique' : 'Catégorie';
  const listLabelFor = (template) => template?.custom ? 'Éléments de la page' : template?.kind === 'restaurant' ? 'Plats et boissons' : template?.kind === 'catalog' ? 'Produits du catalogue' : template?.kind === 'hotel' ? 'Chambres et hébergements' : template?.kind === 'education' ? 'Formations et programmes' : template?.kind === 'event' ? 'Temps forts / programme' : 'Prestations et éléments à présenter';
  const supportedItems = (template) => template && !['link', 'contact'].includes(template.kind);
  const defaultGroupFor = (template) => template?.defaultGroups?.[0] || (template?.kind === 'restaurant' ? 'Plats principaux' : template?.kind === 'catalog' ? 'À découvrir' : template?.kind === 'hotel' ? 'Chambres' : template?.kind === 'education' ? 'Formations' : template?.kind === 'event' ? 'Programme' : 'Services');

  async function readImage(file, maxBytes = 130 * 1024, maxDimension = 1280) {
    if (!file || !/^image\/(jpeg|png|webp)$/i.test(file.type || '')) throw new Error('Choisissez une image JPG, PNG ou WebP.');
    if (typeof createImageBitmap === 'function') {
      const bitmap = await createImageBitmap(file);
      try { return await encodeImage(bitmap, bitmap.width, bitmap.height, maxBytes, maxDimension); }
      finally { bitmap.close?.(); }
    }
    const url = URL.createObjectURL(file);
    try {
      const image = await new Promise((resolve, reject) => { const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error('Le navigateur ne peut pas ouvrir cette image.')); img.src = url; });
      return await encodeImage(image, image.naturalWidth || image.width, image.naturalHeight || image.height, maxBytes, maxDimension);
    } finally { URL.revokeObjectURL(url); }
  }
  async function encodeImage(source, width, height, maxBytes, maxDimension) {
    if (!width || !height) throw new Error('Cette image est illisible.');
    let scale = Math.min(1, maxDimension / Math.max(width, height)); let quality = 0.84; let result = '';
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d'); if (!context) throw new Error('L’optimisation des images n’est pas disponible dans ce navigateur.');
      context.drawImage(source, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= maxBytes) {
        result = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Lecture de l’image impossible.')); reader.readAsDataURL(blob); });
        break;
      }
      if (quality > 0.52) quality -= 0.08; else scale *= 0.82;
    }
    if (!result) throw new Error('Cette image ne peut pas être réduite suffisamment. Choisissez une image plus petite.');
    return result;
  }
  async function readPdf(file,maxBytes=350*1024){
    if(!file||file.type&&file.type!=='application/pdf')throw new Error('Choisissez un document PDF.');
    if(file.size<8||file.size>maxBytes)throw new Error(`Le PDF doit faire moins de ${Math.round(maxBytes/1024)} Kio.`);
    const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.subarray(0,5))!=='%PDF-')throw new Error('Le fichier sélectionné n’est pas un PDF valide.');
    return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Lecture du PDF impossible.'));reader.readAsDataURL(file);});
  }
  function contrastRatio(first, second) {
    const lum = (hex) => {
      const values = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
    };
    const pair = [lum(first), lum(second)].sort((a, b) => b - a); return (pair[0] + 0.05) / (pair[1] + 0.05);
  }

  function open(options = {}) {
    if (!Templates) throw new Error('Le catalogue de modèles n’a pas été chargé.');
    const role = options.role === 'manager' ? 'manager' : 'admin';
    const rootElement = options.modalRoot || document.getElementById(role === 'manager' ? 'managerModal' : 'modalRoot');
    if (!rootElement) throw new Error('La fenêtre de création est introuvable.');
    const api = options.api || defaultApi;
    const baseUrl = options.publicBaseUrl || window.location.origin;
    const apiBase = role === 'manager' ? '/api/manager' : '/api/admin';
    let handler = null;
    let escapeHandler = null;
    let state = {
      step: 1, codeId: options.codeId || '', groupId: 'food', search: '', template: null, categories: options.categories || [], beneficiaries: [], designGallery:[],
      beneficiaryMode: 'existing', beneficiaryId: options.beneficiaryId || '', createdBeneficiaryId: '',
      profileData: null, photos: [], qrName: '', qrTitle: '', qrDescription: '', qrContentText: '',
      destinationType: 'page', targetUrl: '', categoryId: '', saveMode: 'publish',
      qrStyle: { foreground:'#111111', background:'#FFFFFF', correction:'M', textSize:'default', dotStyle:'square', eyeStyle:'square', frameStyle:'none', frameColor:'#FFFFFF', frameTextColor:'#111111', labelTop:'', labelBottom:'', logo:'', logoScale:10 },
      clientRequestId: uuid().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), qrNameTouched: false,
      itemDraft: null, editingItemId: '', pricingPlans: [], selectedPlanId: '', selectedOptionIds: [], pricingError: '',
      phonePreview: true, previewDevice: 'phone', designTab: 'model', themeTouched: false, designUndo: [], designRedo: [], notice: '', itemGroupsTouched:false,
      saving: false, error: '', code: null,
    };
    function setDefaultTemplate(templateId) {
      const previous = state.profileData || {};
      const registryTemplate = Templates.get(templateId) || Templates.get('personnalise');
      const template = previous.templateId===templateId&&previous.templateSnapshot?.id===templateId
        ? {...(registryTemplate||{}),...previous.templateSnapshot,custom:Boolean(registryTemplate?.custom||String(templateId).startsWith('custom-'))}
        : registryTemplate;
      if (!template) return;
      const previousTemplate = state.template;
      const sameTemplate = previous.templateId === template.id || previousTemplate?.id === template.id;
      let theme = previous.theme ? completeTheme(previous.theme, template) : defaultTheme(template);
      if (previousTemplate && previousTemplate.id !== template.id && !state.themeTouched) theme = defaultTheme(template);
      const existingGroups = Array.isArray(previous.itemGroups) ? previous.itemGroups : null;
      const itemGroups = sameTemplate && existingGroups ? existingGroups : (previous.items?.length || state.itemGroupsTouched) ? (existingGroups || template.defaultGroups || []) : (template.defaultGroups || []);
      state.template = template;
      state.groupId = template.groupId || state.groupId;
      state.profileData = {
        ...previous, templateId: template.id, kind: template.kind, templateLabel: template.label,
        templateSnapshot:sameTemplate&&previous.templateSnapshot?previous.templateSnapshot:clone(template), modelVersion:sameTemplate?(Number(previous.modelVersion)||Number(template.version)||1):(Number(template.version)||1),
        customFields:sameTemplate&&previous.customFields&&typeof previous.customFields==='object'?previous.customFields:{}, itemGroups,
        orphanedCustomFields:previous.orphanedCustomFields&&typeof previous.orphanedCustomFields==='object'?previous.orphanedCustomFields:{},

        entityName: previous.entityName || '', subtitle: previous.subtitle || '', description: previous.description || '',
        logo: previous.logo || '', coverImage: previous.coverImage || '', phone: previous.phone || '', whatsapp: previous.whatsapp || '',
        email: previous.email || '', address: previous.address || '', city: previous.city || '', mapUrl: previous.mapUrl || '', website: previous.website || '',
        hours: previous.hours || '', deliveryInfo: previous.deliveryInfo || '', eventDate: previous.eventDate || '', eventTime: previous.eventTime || '',
        venue: previous.venue || '', organizer: previous.organizer || '', registrationUrl: previous.registrationUrl || '', bookingUrl: previous.bookingUrl || '',
        orderMode: previous.orderMode || 'simple', socials: Array.isArray(previous.socials) ? previous.socials : [], documents: Array.isArray(previous.documents) ? previous.documents : [],
        items: Array.isArray(previous.items) ? previous.items : [], theme, themeHistory: Array.isArray(previous.themeHistory) ? previous.themeHistory : [], themeVersion: Number(previous.themeVersion) || 0,
      };
      if (!previousTemplate || (previousTemplate.id !== template.id && !state.themeTouched)) { state.designUndo = [JSON.stringify(state.profileData.theme)]; state.designRedo = []; }
      state.categoryId = state.categoryId || template.categoryId;
      if (!state.qrNameTouched && !state.code) state.qrName = state.profileData.entityName ? `${state.profileData.entityName} — ${template.label}` : template.label;
      if (template.kind === 'link') state.destinationType = 'redirect';
      else if (!state.code) state.destinationType = 'page';
    }
    function setDeep(object, path, value) {
      const keys = String(path || '').split('.').filter(Boolean); let target = object;
      for (const key of keys.slice(0, -1)) { if (!target[key] || typeof target[key] !== 'object') target[key] = {}; target = target[key]; }
      if (keys.length) target[keys[keys.length - 1]] = value;
    }
    function inputValue(input) {
      if (input.type === 'checkbox') return input.checked;
      if (input.type === 'number' || input.type === 'range') return input.value === '' ? '' : Number(input.value);
      if (input.type === 'color') return input.value.toUpperCase();
      return input.value;
    }
    function syncLegacyTheme() {
      const theme = state.profileData?.theme; if (!theme?.colors) return;
      theme.primary = theme.colors.price; theme.secondary = theme.colors.menuBg; theme.background = theme.colors.mainBg;
      theme.surface = theme.colors.card; theme.text = theme.colors.description; theme.button = theme.colors.button;
    }
    function recordThemeChange() {
      const snapshot = JSON.stringify(state.profileData?.theme || {});
      if (!state.designUndo.length) state.designUndo.push(snapshot);
      else if (state.designUndo[state.designUndo.length - 1] !== snapshot) {
        state.designUndo.push(snapshot); if (state.designUndo.length > 60) state.designUndo.shift(); state.designRedo = [];
      }
      const undoButton = rootElement.querySelector('[data-wizard-action="undo-theme"]');
      const redoButton = rootElement.querySelector('[data-wizard-action="redo-theme"]');
      if (undoButton) undoButton.disabled = state.designUndo.length < 2;
      if (redoButton) redoButton.disabled = !state.designRedo.length;
    }
    function qrFrameContrast(){return contrastRatio(state.qrStyle.frameTextColor||state.qrStyle.foreground,state.qrStyle.frameColor||state.qrStyle.background);}
    function themeContrastIssues() {
      const colors = state.profileData?.theme?.colors || {};
      const pairs = [
        ['title','mainBg','titres sur l’en-tête'],['title','panel','titres sur les encadrés'],['subtitle','panel','sous-titres sur les panneaux'],['subtitle','mainBg','sous-titres sur l’en-tête'],
        ['description','card','descriptions sur les cartes'],['description','panel','descriptions dans les encadrés'],['price','card','prix sur les cartes'],['price','panel','prix dans les encadrés'],
        ['buttonText','button','texte des boutons'],['menuText','menuBg','menus'],['link','card','liens sur les cartes'],['link','panel','liens dans les encadrés'],
        ['icon','panel','icônes'],['badgeText','badgeBg','badges'],
      ];
      return pairs.filter(([foreground,background]) => colors[foreground] && colors[background] && contrastRatio(colors[foreground],colors[background]) < 4.5).map((pair) => pair[2]);
    }
    function applyThemeSnapshot(snapshot) {
      try { state.profileData.theme = completeTheme(JSON.parse(snapshot), state.template); syncLegacyTheme(); state.themeTouched = true; }
      catch (_) { state.error = 'Cette version du thème ne peut pas être restaurée.'; }
    }
    function saveLocalThemePreset() {
      syncFields();
      const name = window.prompt('Nom de ce modèle de présentation ?'); if (!name || !name.trim()) return;
      const presets = readThemePresets().filter((item) => item.name !== name.trim()).slice(0, 19);
      presets.unshift({ id:uuid(), name:name.trim().slice(0,60), theme:clone(state.profileData.theme), savedAt:new Date().toISOString() });
      try { window.localStorage.setItem(THEME_PRESET_KEY, JSON.stringify(presets)); state.notice = `Modèle « ${name.trim().slice(0,60)} » enregistré sur cet appareil.`; }
      catch (_) { state.error = 'Le navigateur ne peut pas enregistrer ce modèle localement. Enregistrez le QR pour sauvegarder son thème en base.'; }
      renderStep();
    }
    function loadLocalThemePreset(id) {
      const preset = readThemePresets().find((item) => item.id === id);
      if (!preset) return;
      state.profileData.theme = completeTheme(preset.theme, state.template); state.themeTouched = true; state.notice = `Modèle « ${preset.name} » chargé. Pensez à enregistrer ou publier le QR pour sauvegarder ce thème en base.`; recordThemeChange(); renderStep();
    }
    function colorControl(key,label,fallback='#FFFFFF') {
      const path = key.includes('.') ? key : `colors.${key}`;
      const value = safeHex(path.split('.').reduce((node,part) => node?.[part],state.profileData.theme), fallback);
      return `<label class="wizard-theme-color"><span>${esc(label)}</span><div><input type="color" data-theme-field="${esc(path)}" value="${value}" aria-label="${esc(label)}"><input type="text" data-theme-hex="${esc(path)}" value="${value}" maxlength="7" pattern="^#[0-9A-Fa-f]{6}$" aria-label="Code HEX ${esc(label)}" spellcheck="false"></div></label>`;
    }
    function themeColorPickerOptions() { return Templates.palettes.map((palette) => `<option value="${esc(palette.id)}"${palette.id === state.profileData.theme.paletteId ? ' selected' : ''}>${esc(palette.label)}</option>`).join(''); }
    function syncFields() {
      if (!rootElement.querySelector('.qr-wizard')) return;
      rootElement.querySelectorAll('[data-profile-field]').forEach((input) => {
        if (input.type === 'file') return;
        const key = input.dataset.profileField;
        if (input.type === 'checkbox') state.profileData[key] = input.checked;
        else state.profileData[key] = input.value;
      });
      state.profileData.customFields=state.profileData.customFields&&typeof state.profileData.customFields==='object'?state.profileData.customFields:{};
      rootElement.querySelectorAll('[data-custom-field]').forEach((input)=>{if(input.type==='file')return;state.profileData.customFields[input.dataset.customField]=input.type==='checkbox'?input.checked:input.type==='number'&&input.value!==''?Number(input.value):input.value;});
      rootElement.querySelectorAll('[data-theme-field]').forEach((input) => { setDeep(state.profileData.theme, input.dataset.themeField, inputValue(input)); });
      syncLegacyTheme();
      rootElement.querySelectorAll('[data-qr-field]').forEach((input) => {
        const key = input.dataset.qrField;
        if (input.type === 'radio') { if (input.checked) state[key] = input.value; }
        else state[key] = input.value;
        if (key === 'qrName') state.qrNameTouched = true;
      });
      const beneficiarySelect = $('#wizardBeneficiary', rootElement);
      if (beneficiarySelect && state.beneficiaryMode === 'existing') state.beneficiaryId = beneficiarySelect.value;
      const catSelect = $('#wizardCategory', rootElement); if (catSelect) state.categoryId = catSelect.value;
      const socialsText = $('#wizardSocials', rootElement); if (socialsText) state.profileData.socials = parseRows(socialsText.value, true);
      const docsText = $('#wizardDocuments', rootElement); if (docsText) state.profileData.documents = parseRows(docsText.value, false);
      const itemGroupInput=$('#wizardItemGroups',rootElement);if(itemGroupInput){state.profileData.itemGroups=itemGroupInput.value.split(/\r?\n/).map((value)=>value.trim()).filter(Boolean);state.itemGroupsTouched=true;}
    }
    function previewPayload() {
      const template = state.template || Templates.get(state.profileData?.templateId) || Templates.get('personnalise');
      const data = state.profileData || {};
      const bene = state.beneficiaries.find((item) => item.id === state.beneficiaryId);
      const name = data.entityName || bene?.name || 'Votre activité';
      const fallbackBene = {
        name, type: bene?.type || template?.beneficiaryType || 'other', logo: data.logo || '', phone: data.phone || '', whatsapp: data.whatsapp || '',
        email: data.email || '', address: data.address || '', locationUrl: data.mapUrl || '', website: data.website || '', socials: data.socials || [],
        bio: data.description || '', offers: [], documents: [], photos: state.photos,
      };
      const items = Array.isArray(data.items) ? [...data.items] : [];
      if (state.itemDraft?.name?.trim()) {
        const previewItem = { ...state.itemDraft, priceXof: state.itemDraft.priceXof === '' ? null : Number(state.itemDraft.priceXof), promotionPriceXof: state.itemDraft.promotionPriceXof === '' ? null : Number(state.itemDraft.promotionPriceXof) };
        const index = items.findIndex((item) => item.id === state.editingItemId);
        if (index >= 0) items[index] = previewItem; else items.push(previewItem);
      }
      return {
        qr: { id: state.code?.id || 'preview', publicCode: state.code?.publicCode || '', name: state.qrName || name, title: state.qrTitle || name,
          description: state.qrDescription || data.subtitle || '', contentText: state.qrContentText || '', destinationType: state.destinationType, targetUrl: state.targetUrl,
          style: state.qrStyle, extraLinks: [] },
        beneficiary: fallbackBene, profileData: { ...data, items, entityName: name, templateId: template?.id || '', templateLabel: template?.label || 'Présentation' },
      };
    }
    function renderPreview(container, showStamp = true) {
      if (!container) return;
      if (state.destinationType === 'redirect') {
        container.innerHTML = `<div class="wizard-redirect-preview"><span aria-hidden="true">↗</span><strong>Redirection directe</strong><p>Après le scan, le visiteur sera envoyé vers :</p><code>${esc(state.targetUrl || 'Ajoutez une adresse Internet valide')}</code><small>Ce QR ne publiera pas une page Oymike QR pour cette destination.</small></div>`;
        return;
      }
      container.innerHTML = '<div class="experience-preview-modes"><button type="button" data-wizard-action="preview-phone" aria-pressed="true">Téléphone</button><button type="button" data-wizard-action="preview-tablet" aria-pressed="false">Tablette</button><button type="button" data-wizard-action="preview-desktop" aria-pressed="false">Ordinateur</button></div><div id="wizardPreviewFrame" class="experience-preview-frame is-phone"><div id="wizardPreviewMount"></div></div>';
      const frame = $('#wizardPreviewFrame', container);
      const mount = $('#wizardPreviewMount', container);
      if (frame) { frame.classList.toggle('is-phone', state.previewDevice === 'phone'); frame.classList.toggle('is-tablet', state.previewDevice === 'tablet'); frame.classList.toggle('is-desktop', state.previewDevice === 'desktop'); }
      const modes = container.querySelectorAll('[data-wizard-action^="preview-"]');
      modes.forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.wizardAction === `preview-${state.previewDevice}`)));
      if (mount && root.QRIAProfile?.render) root.QRIAProfile.render(mount, previewPayload(), { preview: true, previewLabel: state.codeId ? 'APERÇU — changements non enregistrés' : 'APERÇU — non publié' });
    }
    function itemFormMarkup() {
      const draft = state.itemDraft || blankItem(state.template);
      const photo = draft.photos?.[0]?.src || '';
      const groups = [...new Set([...(state.profileData.itemGroups||state.template.defaultGroups||[]), defaultGroupFor(state.template), ...(state.profileData.items || []).map((item) => item.group), draft.group].filter(Boolean))];
      return `<div class="wizard-item-editor"><div class="wizard-item-editor-heading"><strong>${state.editingItemId ? 'Modifier cet élément' : 'Ajouter un élément'}</strong><button type="button" class="wizard-text-button" data-wizard-action="cancel-item">Annuler</button></div>
        <div class="wizard-item-grid"><label>Nom *<input data-item-field="name" maxlength="100" value="${esc(draft.name)}" placeholder="${state.template.kind === 'restaurant' ? 'Ex. Poulet braisé' : 'Ex. Service / produit'}"></label>
        <label>${esc(groupLabelFor(state.template))}<input data-item-field="group" list="wizardItemGroups" maxlength="80" value="${esc(draft.group || defaultGroupFor(state.template))}"><datalist id="wizardItemGroups">${groups.map((group) => `<option value="${esc(group)}"></option>`).join('')}</datalist></label>
        <label>Prix normal en FCFA<input data-item-field="priceXof" type="number" min="0" max="1000000000" step="1" value="${esc(draft.priceXof ?? '')}" placeholder="Laisser vide si non applicable"></label>
        <label>Prix promotionnel en FCFA<input data-item-field="promotionPriceXof" type="number" min="0" max="1000000000" step="1" value="${esc(draft.promotionPriceXof ?? '')}" placeholder="Facultatif; inférieur au prix normal"></label>
        <label>Libellé de la promotion<input data-item-field="promotionLabel" maxlength="80" value="${esc(draft.promotionLabel || '')}" placeholder="Ex. Offre du midi, -10 %"></label>
        <label>Badge d’affichage<select data-item-field="badge"><option value=""${!draft.badge ? ' selected' : ''}>Aucun</option><option value="new"${draft.badge === 'new' ? ' selected' : ''}>Nouveau</option><option value="popular"${draft.badge === 'popular' ? ' selected' : ''}>Populaire</option></select></label>
        <label class="wizard-file-label">Photo de l’article<input data-item-photo type="file" accept="image/jpeg,image/png,image/webp"><span>Optimisée automatiquement, max. 120 Kio.</span></label>
        <label class="wizard-item-wide">Description<textarea data-item-field="description" maxlength="500" rows="2" placeholder="Courte description, ingrédients ou détails…">${esc(draft.description || '')}</textarea></label>
        <label class="wizard-item-wide">${state.template.kind === 'restaurant' ? 'Portions / variantes' : 'Variantes'} (une ligne : nom | prix FCFA)<textarea data-item-field="variantsText" rows="2" placeholder="${state.template.kind === 'restaurant' ? 'Demi | 3500&#10;Entier | 6000' : 'Option 1 | 3500&#10;Option 2 | 5000'}">${esc((draft.variants || []).map((v) => `${v.name} | ${v.priceXof ?? ''}`).join('\n'))}</textarea></label>
        <label class="wizard-item-wide">Options supplémentaires payantes<textarea data-item-field="optionsText" rows="2" placeholder="Extra fromage | 500&#10;Sauce piquante | 200">${esc((draft.options || []).map((v) => `${v.name} | ${v.priceXof ?? ''}`).join('\n'))}</textarea></label>
        ${photo ? `<div class="wizard-item-photo"><img src="${esc(photo)}" alt="Aperçu de l’article"><button type="button" class="wizard-text-button" data-wizard-action="remove-item-photo">Retirer la photo</button></div>` : ''}
        <label class="wizard-check"><input data-item-field="available" type="checkbox"${draft.available !== false ? ' checked' : ''}> Disponible</label><label class="wizard-check"><input data-item-field="featured" type="checkbox"${draft.featured ? ' checked' : ''}> Mettre en avant</label>
        <button type="button" class="button button-primary wizard-add-item" data-wizard-action="save-item">${state.editingItemId ? 'Enregistrer l’élément' : 'Ajouter à la page'}</button></div></div>`;
    }
    function renderItems() {
      const items = state.profileData?.items || [];
      if (!items.length) return '<div class="wizard-items-empty"><strong>La page est prête à recevoir votre contenu.</strong><span>Ajoutez vos premiers éléments ici ou plus tard.</span></div>';
      return `<div class="wizard-item-list">${items.map((item) => `<article class="wizard-item-row"><div class="wizard-item-row-image">${item.photos?.[0]?.src ? `<img src="${esc(item.photos[0].src)}" alt="">` : '<span>◇</span>'}</div><div class="wizard-item-row-copy"><strong>${esc(item.name)}</strong><small>${esc(item.group || 'À découvrir')}${item.promotionPriceXof == null ? item.priceXof == null ? '' : ` · ${number(item.priceXof)} FCFA` : ` · ${number(item.promotionPriceXof)} FCFA promo`}${item.promotionLabel ? ` · ${esc(item.promotionLabel)}` : ''}${item.available === false ? ' · Indisponible' : ''}</small></div><button type="button" class="wizard-icon-button" data-wizard-action="edit-item" data-item-id="${esc(item.id)}" aria-label="Modifier ${esc(item.name)}">✎</button><button type="button" class="wizard-icon-button is-danger" data-wizard-action="delete-item" data-item-id="${esc(item.id)}" aria-label="Retirer ${esc(item.name)}">×</button></article>`).join('')}</div>`;
    }
    function renderQrGallery() {
      if (!state.photos.length) return '<div class="wizard-gallery-empty">Aucune photo supplémentaire. Vous pouvez en ajouter jusqu’à 8.</div>';
      return `<div class="wizard-gallery-list">${state.photos.map((photo, index) => `<article class="wizard-gallery-card"><img src="${esc(photo.src)}" alt=""><div class="wizard-gallery-copy"><input type="text" maxlength="140" data-photo-caption="${esc(photo.id)}" aria-label="Légende de la photo ${index + 1}" value="${esc(photo.caption || '')}" placeholder="Légende (facultative)"><div class="wizard-gallery-tools"><button type="button" data-wizard-action="set-primary-photo" data-photo-id="${esc(photo.id)}">${photo.isPrimary ? '★ Photo principale' : 'Choisir comme principale'}</button><button type="button" data-wizard-action="move-photo-up" data-photo-id="${esc(photo.id)}"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" data-wizard-action="move-photo-down" data-photo-id="${esc(photo.id)}"${index === state.photos.length - 1 ? ' disabled' : ''}>↓</button><button type="button" class="is-danger" data-wizard-action="delete-photo" data-photo-id="${esc(photo.id)}">Retirer</button></div></div></article>`).join('')}</div>`;
    }
    function renderCustomFields() {
      const template=state.template;const fields=template?.fields||[];if(!fields.length)return '';
      const values=state.profileData.customFields||{};const sectionList=template.sections?.length?template.sections:[{id:'general',title:'Informations complémentaires'}];
      const inputFor=(field)=>{
        const value=values[field.key];const required=field.required?' required':'';const label=`<span>${esc(field.label)}${field.required?' *':''}</span>`;
        if(field.type==='image')return `<label class="wizard-field wizard-field-wide custom-model-field">${label}<input type="file" accept="image/jpeg,image/png,image/webp" data-custom-upload="${esc(field.key)}" data-custom-type="image"><small>${esc(field.description||'Image JPEG, PNG ou WebP, optimisée avant enregistrement.')}</small>${value?`<div class="custom-field-preview"><img src="${esc(value)}" alt="${esc(field.label)}"><button type="button" data-wizard-action="remove-custom-value" data-custom-key="${esc(field.key)}">Retirer</button></div>`:''}</label>`;
        if(field.type==='document')return `<label class="wizard-field wizard-field-wide custom-model-field">${label}<input type="url" data-custom-field="${esc(field.key)}" value="${esc(value||'')}" placeholder="https://…"${required}><span>URL HTTPS du document, ou importez un PDF (max. 350 Kio).</span><input type="file" accept="application/pdf,.pdf" data-custom-upload="${esc(field.key)}" data-custom-type="document">${value&&String(value).startsWith('data:application/pdf')?`<button type="button" data-wizard-action="remove-custom-value" data-custom-key="${esc(field.key)}">Retirer le PDF importé</button>`:''}</label>`;
        if(field.type==='textarea')return `<label class="wizard-field wizard-field-wide custom-model-field">${label}<textarea data-custom-field="${esc(field.key)}" maxlength="${field.maxLength||1000}" rows="3" placeholder="${esc(field.placeholder||'')}"${required}>${esc(value||'')}</textarea>${field.description?`<small>${esc(field.description)}</small>`:''}</label>`;
        if(field.type==='select')return `<label class="wizard-field custom-model-field">${label}<select data-custom-field="${esc(field.key)}"${required}><option value="">Choisir…</option>${(field.options||[]).map(option=>`<option value="${esc(option)}"${option===value?' selected':''}>${esc(option)}</option>`).join('')}</select>${field.description?`<small>${esc(field.description)}</small>`:''}</label>`;
        if(field.type==='checkbox')return `<label class="wizard-check custom-model-field"><input type="checkbox" data-custom-field="${esc(field.key)}"${value?' checked':''}> ${esc(field.label)}${field.required?' *':''}${field.description?`<small>${esc(field.description)}</small>`:''}</label>`;
        const type=field.type==='number'||field.type==='price'?'number':field.type==='phone'?'tel':field.type==='email'?'email':field.type==='date'?'date':field.type==='url'?'url':'text';
        const extra=type==='number'?` min="${field.min??''}" max="${field.max??''}" step="${field.type==='price'?'1':'any'}"`:type==='text'||type==='tel'||type==='email'||type==='url'?` maxlength="${field.maxLength||240}"`:'';
        return `<label class="wizard-field custom-model-field">${label}<input type="${type}" data-custom-field="${esc(field.key)}" value="${esc(value??'')}" placeholder="${esc(field.placeholder||'')}"${extra}${required}>${field.description?`<small>${esc(field.description)}</small>`:''}</label>`;
      };
      return `<div class="wizard-form-section custom-model-fields"><h4>Champs du modèle « ${esc(template.label)} »</h4><p>Ces informations apparaîtront sur la page publique après validation.</p>${sectionList.map(section=>{const rows=fields.filter(field=>field.sectionId===section.id);return rows.length?`<div class="wizard-custom-section"><h5>${esc(section.title)}</h5>${section.description?`<p>${esc(section.description)}</p>`:''}<div class="wizard-fields">${rows.map(inputFor).join('')}</div></div>`:''}).join('')}</div>`;
    }
    function renderItemGroups() {
      if(!supportedItems(state.template))return '';
      const groups=state.profileData.itemGroups||state.template?.defaultGroups||[];
      return `<div class="wizard-form-section wizard-item-groups"><h4>Catégories de la page</h4><label class="wizard-field">Une catégorie par ligne<textarea id="wizardItemGroups" rows="4" maxlength="2400" placeholder="Entrées&#10;Plats&#10;Boissons">${esc(groups.join('\n'))}</textarea><small>Les éléments de menu ou du catalogue peuvent être affectés à l’une de ces rubriques. Réordonnez les lignes pour changer l’ordre d’affichage.</small></label></div>`;
    }
    function renderStepOne() {
      const visible = Templates.templates.filter((template) => (state.groupId === 'all' || template.groupId === state.groupId) && (!state.search || `${template.label} ${template.description} ${template.group}`.toLocaleLowerCase('fr').includes(state.search.toLocaleLowerCase('fr'))));
      return `<div class="wizard-intro"><span class="wizard-step-kicker">ÉTAPE 1 SUR 4 · MODÈLE</span><h3>Que souhaitez-vous présenter ?</h3><p>Choisissez une activité. Les champs et la page s’adaptent à votre choix; vous pourrez tout modifier ensuite.</p></div>
        <div class="wizard-template-toolbar"><input type="search" id="wizardTemplateSearch" value="${esc(state.search)}" placeholder="Rechercher une activité…" aria-label="Rechercher un modèle"><button type="button" class="wizard-clear-search" data-wizard-action="clear-template-search"${state.search ? '' : ' hidden'}>Effacer</button></div>
        <div class="wizard-template-groups"><button type="button" data-template-group="all" class="${state.groupId === 'all' ? 'is-active' : ''}">Tous</button>${Templates.groups.map((group) => `<button type="button" data-template-group="${esc(group.id)}" class="${state.groupId === group.id ? 'is-active' : ''}"><span>${group.icon}</span>${esc(group.label)}</button>`).join('')}</div>
        <div class="wizard-template-grid">${visible.map((template) => `<button type="button" class="wizard-template-card${state.template?.id === template.id ? ' is-selected' : ''}" data-template-id="${esc(template.id)}"><span class="wizard-template-icon">${template.icon}</span><span><strong>${esc(template.label)}</strong><small>${esc(template.description)}</small></span><span class="wizard-template-check">${state.template?.id === template.id ? '✓' : '→'}</span></button>`).join('') || '<div class="wizard-items-empty">Aucune activité trouvée. Choisissez « Autre activité » ou modifiez la recherche.</div>'}</div>
        <div class="wizard-custom-note"><strong>Votre activité n’est pas dans la liste ?</strong><span>Le modèle « Autre activité » est personnalisable et ne bloque pas vos choix.</span><button type="button" data-template-id="personnalise">Choisir Autre activité →</button></div>`;
    }
    function renderBeneficiaryChoice() {
      const choices = state.beneficiaries;
      return `<section class="wizard-beneficiary-box"><div class="wizard-subheading"><div><span class="wizard-step-kicker">RATTACHEMENT</span><h4>À qui appartient ce QR ?</h4><p>Le bénéficiaire garde les droits et l’historique existants.</p></div><div class="wizard-choice-toggle"><button type="button" data-wizard-action="beneficiary-existing" class="${state.beneficiaryMode === 'existing' ? 'is-active' : ''}">Existant</button><button type="button" data-wizard-action="beneficiary-new" class="${state.beneficiaryMode === 'new' ? 'is-active' : ''}">Nouveau</button></div></div>
        ${state.beneficiaryMode === 'existing' ? `<label class="wizard-field">Bénéficiaire<select id="wizardBeneficiary" required><option value="">${choices.length ? 'Choisir un bénéficiaire…' : 'Aucun bénéficiaire disponible'}</option>${choices.map((item) => `<option value="${esc(item.id)}"${state.beneficiaryId === item.id ? ' selected' : ''}>${esc(item.name)} — ${esc(beneficiaryTypeLabel(item.type))}</option>`).join('')}</select></label>${!choices.length ? '<p class="wizard-help">Aucun bénéficiaire trouvé. Choisissez « Nouveau » pour en créer un avec cette page.</p>' : ''}` : `<p class="wizard-new-bene-note">Un bénéficiaire « ${esc(state.template?.beneficiaryType || 'autre')} » sera créé avec le nom, le téléphone et les coordonnées de cette page. Il restera modifiable dans votre répertoire.</p>`}</section>`;
    }
    function beneficiaryTypeLabel(type) { return ({ individual: 'Particulier', business: 'Entreprise', commerce: 'Commerce', organization: 'Organisation', other: 'Autre activité' })[type] || 'Bénéficiaire'; }
    function renderPricing() {
      if (role !== 'manager' || state.code) return '';
      if (state.pricingError) return `<div class="wizard-pricing-note is-warning">Le catalogue de tarifs n’est pas disponible. La création reste possible; le serveur vérifiera les règles actives au moment de l’enregistrement. ${esc(state.pricingError)}</div>`;
      if (!state.pricingPlans.length) return '<div class="wizard-pricing-note">Aucun tarif actif ne s’applique à cette sélection. Le QR peut être créé sans commande ni impayé artificiel.</div>';
      const chosen = state.pricingPlans.find((plan) => plan.id === state.selectedPlanId);
      const selected = (chosen?.options || []).filter((option) => state.selectedOptionIds.includes(option.id));
      const total = Number(chosen?.amountXof || 0) + selected.reduce((sum, option) => sum + Number(option.amountXof || 0), 0);
      return `<section class="wizard-pricing-box"><div><span class="wizard-step-kicker">SUIVI FINANCIER</span><h4>Tarif applicable (aucun paiement préalable)</h4></div><label class="wizard-field">Formule<select id="wizardPlan"><option value="">Choisir une formule…</option>${state.pricingPlans.map((plan) => `<option value="${esc(plan.id)}"${plan.id === state.selectedPlanId ? ' selected' : ''}>${esc(plan.name)} — ${number(plan.amountXof)} FCFA</option>`).join('')}</select></label>${chosen ? `<div class="wizard-plan-options">${(chosen.options || []).filter((option) => option.active !== false).map((option) => `<label><input type="checkbox" data-plan-option="${esc(option.id)}"${state.selectedOptionIds.includes(option.id) ? ' checked' : ''}> ${esc(option.name)} <b>${number(option.amountXof)} FCFA</b></label>`).join('')}</div><p class="wizard-price-total">Montant suivi : <strong>${number(total)} FCFA</strong><small>La création et l’activation ne sont jamais conditionnées au règlement.</small></p>` : '<p class="wizard-help">Sélectionnez le tarif actif applicable; le règlement n’est pas demandé à cette étape.</p>'}</section>`;
    }
    function renderStepTwo() {
      const p = state.profileData; const t = state.template;
      const urlOnly = t.kind === 'link';
      return `<div class="wizard-intro"><span class="wizard-step-kicker">ÉTAPE 2 SUR 4 · INFORMATIONS</span><h3>Présentez votre activité</h3><p>Ne remplissez que ce qui vous concerne. Les visiteurs ne verront que les informations enregistrées dans cette page.</p></div>
        <div class="wizard-layout"><div class="wizard-form-column">${renderBeneficiaryChoice()}
          <div class="wizard-form-section"><h4>Identité</h4><div class="wizard-fields"><label class="wizard-field">Nom de la structure / personne *<input data-profile-field="entityName" required maxlength="140" value="${esc(p.entityName)}" placeholder="Ex. Le Jardin d’Awa"></label><label class="wizard-field">Nom de ce QR dans votre espace<input data-qr-field="qrName" required maxlength="120" value="${esc(state.qrName)}" placeholder="Ex. Menu terrasse"></label><label class="wizard-field wizard-field-wide">Titre affiché après le scan<input data-qr-field="qrTitle" maxlength="140" value="${esc(state.qrTitle)}" placeholder="Par défaut : nom de l’activité"></label><label class="wizard-field wizard-field-wide">Phrase d’accueil<textarea data-profile-field="subtitle" maxlength="180" rows="2" placeholder="Ex. Cuisine ivoirienne, grillades et boissons fraîches">${esc(p.subtitle)}</textarea></label><label class="wizard-field wizard-field-wide">Présentation<textarea data-profile-field="description" maxlength="2400" rows="3" placeholder="Présentez simplement votre activité…">${esc(p.description)}</textarea></label></div></div>
          ${urlOnly ? `<div class="wizard-form-section"><h4>Destination</h4><label class="wizard-field">Adresse Internet à ouvrir après le scan *<input data-qr-field="targetUrl" type="url" value="${esc(state.targetUrl)}" placeholder="https://exemple.ci" required></label><p class="wizard-pricing-note">Le QR conserve une adresse Oymike QR stable et redirige vers ce site. Si vous changez la destination plus tard, vous n’aurez pas à réimprimer ce QR.</p></div>` : ''}
          <div class="wizard-form-section"><h4>Coordonnées et accès</h4><div class="wizard-fields"><label class="wizard-field">Téléphone<input data-profile-field="phone" type="tel" maxlength="50" value="${esc(p.phone)}" placeholder="+225 …"></label><label class="wizard-field">WhatsApp<input data-profile-field="whatsapp" type="tel" maxlength="50" value="${esc(p.whatsapp)}" placeholder="+225 …"></label><label class="wizard-field">E-mail<input data-profile-field="email" type="email" maxlength="254" value="${esc(p.email)}" placeholder="contact@exemple.ci"></label><label class="wizard-field">Site Internet<input data-profile-field="website" type="url" maxlength="2048" value="${esc(p.website)}" placeholder="https://…"></label><label class="wizard-field wizard-field-wide">Adresse<input data-profile-field="address" maxlength="300" value="${esc(p.address)}" placeholder="Quartier, rue, repère…"></label><label class="wizard-field">Ville<input data-profile-field="city" maxlength="100" value="${esc(p.city)}" placeholder="Abidjan"></label><label class="wizard-field">Lien Google Maps<input data-profile-field="mapUrl" type="url" maxlength="2048" value="${esc(p.mapUrl)}" placeholder="https://maps.google.com/…"></label></div></div>
          ${t.kind === 'event' ? `<div class="wizard-form-section"><h4>Événement</h4><div class="wizard-fields"><label class="wizard-field">Date<input data-profile-field="eventDate" type="date" value="${esc(p.eventDate)}"></label><label class="wizard-field">Heure<input data-profile-field="eventTime" type="time" value="${esc(p.eventTime)}"></label><label class="wizard-field">Lieu<input data-profile-field="venue" maxlength="200" value="${esc(p.venue)}"></label><label class="wizard-field">Organisateur<input data-profile-field="organizer" maxlength="140" value="${esc(p.organizer)}"></label><label class="wizard-field wizard-field-wide">Lien externe d’inscription<input data-profile-field="registrationUrl" type="url" value="${esc(p.registrationUrl)}" placeholder="https://…"></label></div><p class="wizard-help">Ouvre votre formulaire externe; aucune inscription n’est collectée par Oymike QR.</p></div>` : ''}
          ${['hotel'].includes(t.kind) ? `<div class="wizard-form-section"><h4>Réservation</h4><label class="wizard-field">Lien externe de réservation (facultatif)<input data-profile-field="bookingUrl" type="url" value="${esc(p.bookingUrl)}" placeholder="https://…"></label><p class="wizard-help">Ce lien ouvre votre site ou service de réservation existant; Oymike QR ne prend pas les réservations.</p></div>` : ''}
          ${['professional','health'].includes(t.kind) ? `<div class="wizard-form-section"><h4>Rendez-vous</h4><label class="wizard-field">Lien externe de prise de rendez-vous (facultatif)<input data-profile-field="bookingUrl" type="url" value="${esc(p.bookingUrl)}" placeholder="https://…"></label><p class="wizard-help">Aucun agenda n’est intégré. Le bouton n’apparaîtra que si vous fournissez un lien externe.</p></div>` : ''}
          ${t.kind === 'education' ? `<div class="wizard-form-section"><h4>Inscriptions</h4><label class="wizard-field">Lien externe d’inscription (facultatif)<input data-profile-field="registrationUrl" type="url" value="${esc(p.registrationUrl)}" placeholder="https://…"></label><p class="wizard-help">Le lien ouvre un formulaire ou site que vous gérez; Oymike QR ne recueille pas de candidatures.</p></div>` : ''}
          ${!urlOnly ? `<div class="wizard-form-section"><h4>Horaires et présentation</h4><div class="wizard-fields"><label class="wizard-field wizard-field-wide">Horaires<textarea data-profile-field="hours" maxlength="2000" rows="4" placeholder="Lundi – vendredi | 08:00 – 18:00&#10;Samedi | 09:00 – 13:00&#10;Dimanche | Fermé">${esc(p.hours)}</textarea><small>Une ligne par jour. Ex. « Lundi – vendredi | 08:00 – 18:00 ».</small></label><label class="wizard-field wizard-field-wide">Réseaux sociaux<textarea id="wizardSocials" rows="3" placeholder="Instagram | https://instagram.com/…&#10;Facebook | https://facebook.com/…">${esc((p.socials || []).map((row) => `${row.label} | ${row.url}`).join('\n'))}</textarea><small>Une ligne par réseau : Nom | URL.</small></label><label class="wizard-field wizard-field-wide">Documents utiles<textarea id="wizardDocuments" rows="2" placeholder="Brochure | https://…">${esc((p.documents || []).map((row) => `${row.name} | ${row.url}`).join('\n'))}</textarea><small>Une ligne par document : Nom | URL.</small></label></div></div>` : ''}
          ${t.kind === 'restaurant' ? `<div class="wizard-form-section"><h4>Service restaurant</h4><div class="wizard-fields"><label class="wizard-field">Mode du menu<select data-profile-field="orderMode"><option value="simple"${p.orderMode !== 'whatsapp' ? ' selected' : ''}>Présentation simple du menu</option><option value="whatsapp"${p.orderMode === 'whatsapp' ? ' selected' : ''}>Menu avec commande WhatsApp</option></select><small>Le bouton ouvre WhatsApp avec le menu sélectionné; Oymike QR n’enregistre ni ne traite la commande. Il s’affiche uniquement si un numéro WhatsApp est fourni.</small></label><label class="wizard-field">Livraison<textarea data-profile-field="deliveryInfo" maxlength="500" rows="2" placeholder="Zones, horaires, frais…">${esc(p.deliveryInfo)}</textarea></label></div></div>` : ''}
          <div class="wizard-form-section"><h4>Logo et couverture</h4><div class="wizard-fields"><label class="wizard-file-label">Logo / photo de profil<input type="file" data-upload-field="logo" accept="image/jpeg,image/png,image/webp"><span>Image carrée conseillée · optimisée automatiquement.</span></label><label class="wizard-file-label">Photo de couverture<input type="file" data-upload-field="coverImage" accept="image/jpeg,image/png,image/webp"><span>Format paysage conseillé · optimisée automatiquement.</span></label></div>${p.logo || p.coverImage ? `<div class="wizard-image-previews">${p.logo ? `<div><img src="${esc(p.logo)}" alt="Logo"><button type="button" data-wizard-action="remove-logo">Retirer le logo</button></div>` : ''}${p.coverImage ? `<div><img src="${esc(p.coverImage)}" alt="Couverture"><button type="button" data-wizard-action="remove-cover">Retirer la couverture</button></div>` : ''}</div>` : ''}</div>
          ${supportedItems(t) ? `<div class="wizard-form-section"><div class="wizard-section-head"><div><h4>${esc(listLabelFor(t))}</h4><p>Les éléments, prix et disponibilités peuvent être modifiés ensuite sans changer le QR.</p></div><button class="button button-secondary" type="button" data-wizard-action="new-item">＋ Ajouter</button></div>${state.itemDraft ? itemFormMarkup() : ''}${renderItems()}</div>` : ''}
          ${t.kind === 'restaurant' || t.kind === 'gallery' || t.kind === 'professional' ? `<div class="wizard-form-section"><div class="wizard-section-head"><div><h4>Photos et publicité</h4><p>Ajoutez jusqu’à 8 images. Choisissez la photo principale, l’ordre et les légendes.</p></div><label class="button button-secondary wizard-upload-label">＋ Ajouter des photos<input type="file" data-upload-qr-gallery accept="image/jpeg,image/png,image/webp" multiple></label></div>${renderQrGallery()}</div>` : ''}
          ${renderCustomFields()}
          ${renderItemGroups()}
          ${role === 'manager' ? renderPricing() : ''}
          <div class="wizard-form-section"><h4>Catégorie</h4><label class="wizard-field">Classement dans votre espace<select id="wizardCategory">${state.categories.map((category) => `<option value="${esc(category.id)}"${category.id === state.categoryId ? ' selected' : ''}>${esc(category.name)}</option>`).join('')}</select></label></div>
        </div><aside class="wizard-preview-aside"><span class="wizard-step-kicker">APERÇU EN DIRECT</span><h4>Votre page après le scan</h4><div id="wizardInlinePreview"></div></aside></div>`;
    }
    function renderQrDesignPreview() {
      const canvas = $('#wizardQrDesignPreview', rootElement);
      if (!canvas) return;
      const status = $('#wizardQrRenderStatus', rootElement);
      if (!root.QRIAQRArtwork?.renderCanvas) {
        if (status) status.textContent = 'Le moteur de rendu QR est indisponible. Votre saisie reste conservée; actualisez puis réessayez.';
        return;
      }
      const version=(state.qrPreviewVersion||0)+1;state.qrPreviewVersion=version;
      const target=state.code?.publicCode?`${baseUrl.replace(/\/$/,'')}/r/${encodeURIComponent(state.code.publicCode)}`:`${baseUrl.replace(/\/$/,'')}/r/apercu`;
      const temporary=document.createElement('canvas');
      if (status) { status.textContent = 'Génération de l’aperçu…'; status.className = 'wizard-qr-render-status'; }
      root.QRIAQRArtwork.renderCanvas(temporary,target,state.qrStyle,300).then(()=>{
        if(version!==state.qrPreviewVersion||!canvas.isConnected)return;
        canvas.width=temporary.width;canvas.height=temporary.height;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas indisponible.');context.drawImage(temporary,0,0);
        if (status) status.textContent = state.code?.publicCode ? 'Aperçu du QR enregistré.' : 'Aperçu temporaire uniquement — le QR final sera créé après confirmation.';
      }).catch((error)=>{
        if(version!==state.qrPreviewVersion||!canvas.isConnected)return;
        if (status) { status.textContent = `${error.message || 'Impossible de générer l’aperçu QR.'} La saisie est conservée; vous pourrez réessayer.`; status.className = 'wizard-qr-render-status is-error'; }
      });
    }
    function renderStepThree() {
      const theme = state.profileData.theme;
      const tabList = [
        ['model','Modèle'],['colors','Couleurs'],['type','Écriture'],['background','Arrière-plan'],
        ['header','En-tête'],['blocks','Cartes et blocs'],['controls','Boutons et icônes'],['decorations','Décorations'],['qr-print','QR imprimable'],['preview','Aperçu final'],
      ];
      const styleList = [
        ['modern','Moderne'],['elegant','Élégant'],['minimal','Minimaliste'],['luxury','Luxe'],['professional','Professionnel'],
        ['creative','Créatif'],['classic','Classique'],['natural','Naturel'],['colorful','Coloré'],['premium','Premium'],
      ];
      const stylePanel = () => `<div class="wizard-style-grid">${styleList.map(([id,label]) => `<button type="button" class="wizard-style-card${theme.style === id ? ' is-selected' : ''}" data-wizard-action="select-style" data-style="${id}" aria-pressed="${theme.style === id}"><strong>${label}</strong><small>Applique un traitement visuel sans modifier vos textes, photos ou couleurs.</small></button>`).join('')}</div>
        <div class="wizard-fields"><label class="wizard-field">Disposition<select data-theme-field="layout">${[['cover','Couverture et en-tête'],['logo','Logo en haut'],['cards','Cartes de services'],['catalog','Catalogue en grille'],['tabs','Catégories avec navigation'],['grid','Grille visuelle'],['list','Liste compacte']].map(([value,label]) => `<option value="${value}"${theme.layout === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="wizard-field">Colonnes sur grand écran<select data-theme-field="components.gridColumns"><option value="1"${Number(theme.components.gridColumns) === 1 ? ' selected' : ''}>Une colonne</option><option value="2"${Number(theme.components.gridColumns) === 2 ? ' selected' : ''}>Deux colonnes</option><option value="3"${Number(theme.components.gridColumns) === 3 ? ' selected' : ''}>Trois colonnes</option></select></label></div>`;
      const colorPanel = () => `<div class="wizard-palette-grid">${Templates.palettes.map((palette) => `<button type="button" class="wizard-palette${theme.paletteId === palette.id ? ' is-selected' : ''}" data-palette-id="${esc(palette.id)}" aria-pressed="${theme.paletteId === palette.id}"><span style="--swatch-primary:${esc(palette.colors.button)};--swatch-secondary:${esc(palette.colors.panel)};--swatch-accent:${esc(palette.colors.price)}" aria-hidden="true"></span><strong>${esc(palette.label)}</strong></button>`).join('')}</div>
        <p class="wizard-help">Choisissez une combinaison complète puis remplacez individuellement chaque couleur. Les champs HEX et sélecteurs sont synchronisés.</p>
        <div class="wizard-color-grid wizard-color-grid-expanded">${[
          ['pageBg','Fond général'],['mainBg','Zone principale / en-tête'],['card','Cartes'],['panel','Encadrés et panneaux'],
          ['title','Titres'],['subtitle','Sous-titres'],['description','Descriptions'],['price','Prix'],
          ['button','Fond des boutons'],['buttonText','Texte des boutons'],['icon','Icônes'],['border','Bordures'],
          ['separator','Séparateurs'],['menuBg','Fond des menus / onglets'],['menuText','Texte des menus / onglets'],
          ['link','Liens'],['badgeBg','Fond des badges'],['badgeText','Texte des badges'],
        ].map(([key,label]) => colorControl(key,label,theme.colors[key])).join('')}</div>
        <div class="wizard-theme-toolbar"><button type="button" class="button button-secondary" data-wizard-action="reset-colors">Réinitialiser les couleurs</button><span>Le contraste des éléments textuels est contrôlé avant publication.</span></div><div id="wizardQrContrast" class="wizard-contrast-note"></div>`;
      const typographyPanel = () => `<div class="wizard-typography-groups">${TYPE_GROUPS.map(([key,label]) => { const type = theme.typography[key]; const sizeMax = key === 'title' ? 60 : 44; return `<fieldset class="wizard-type-group"><legend>${label}</legend>
          <div class="wizard-fields"><label class="wizard-field">Famille de police<select data-theme-field="typography.${key}.family">${FONT_OPTIONS.map((font) => `<option value="${esc(font)}"${type.family === font ? ' selected' : ''}>${esc(font)}</option>`).join('')}</select><span class="wizard-font-preview" style="font-family:'${esc(type.family)}',sans-serif">Aa 0123 — aperçu de la police</span></label>
          <label class="wizard-field">Taille (px)<input type="number" data-theme-field="typography.${key}.size" min="${key === 'title' ? 18 : 12}" max="${sizeMax}" step="1" value="${esc(type.size)}"></label>
          <label class="wizard-field">Épaisseur<select data-theme-field="typography.${key}.weight">${[300,400,500,600,700,800,900].map((w) => `<option value="${w}"${Number(type.weight) === w ? ' selected' : ''}>${w}</option>`).join('')}</select></label>
          <label class="wizard-field">Alignement<select data-theme-field="typography.${key}.align">${[['left','Gauche'],['center','Centré'],['right','Droite']].map(([v,l]) => `<option value="${v}"${type.align === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wizard-field">Hauteur de ligne<input type="number" data-theme-field="typography.${key}.lineHeight" min="1" max="2.2" step="0.05" value="${esc(type.lineHeight)}"></label>
          <label class="wizard-field">Espacement des lettres (em)<input type="number" data-theme-field="typography.${key}.letterSpacing" min="-0.08" max="0.2" step="0.005" value="${esc(type.letterSpacing)}"></label>
          <label class="wizard-field">Casse<select data-theme-field="typography.${key}.transform">${[['none','Normale'],['uppercase','Majuscules'],['capitalize','Première lettre en capitale'],['lowercase','Minuscules']].map(([v,l]) => `<option value="${v}"${type.transform === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wizard-check"><input type="checkbox" data-theme-field="typography.${key}.italic"${type.italic ? ' checked' : ''}> Italique</label></div></fieldset>`; }).join('')}</div>
        <p class="wizard-help">Les polices intégrées dans Oymike QR et les piles de secours gardent une mise en page lisible si une police n’est pas disponible sur l’appareil.</p>`;
      const backgroundPanel = () => `<div class="wizard-fields"><label class="wizard-field">Type de fond<select data-theme-field="backgroundStyle.type">${[['solid','Couleur unie'],['gradient','Dégradé'],['image','Image de fond'],['pattern','Motif discret'],['transparent','Transparent']].map(([v,l]) => `<option value="${v}"${theme.backgroundStyle.type === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wizard-field">Motif<select data-theme-field="backgroundStyle.pattern">${[['dots','Points'],['grid','Grille fine'],['diagonal','Diagonales']].map(([v,l]) => `<option value="${v}"${theme.backgroundStyle.pattern === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          ${colorControl('backgroundStyle.color1','Couleur du fond 1',theme.backgroundStyle.color1)}${colorControl('backgroundStyle.color2','Couleur du fond 2',theme.backgroundStyle.color2)}${colorControl('backgroundStyle.color3','Couleur du fond 3',theme.backgroundStyle.color3)}
          <label class="wizard-field">Angle du dégradé<input type="number" data-theme-field="backgroundStyle.angle" min="0" max="360" step="1" value="${esc(theme.backgroundStyle.angle)}"></label>
          <label class="wizard-file-label">Image de fond (optionnelle)<input type="file" data-theme-background-image accept="image/jpeg,image/png,image/webp"><span>Optimisée avant enregistrement. Maximum 180 Kio.</span></label>
          ${state.designGallery.length?`<div class="wizard-gallery-backgrounds"><strong>Images de la galerie Oymike QR</strong><div>${state.designGallery.map(asset=>`<button type="button" data-wizard-action="select-gallery-background" data-gallery-id="${esc(asset.id)}" title="${esc(asset.title)}"><img src="${esc(asset.image)}" alt=""><span>${esc(asset.title)}</span></button>`).join('')}</div></div>`:''}
          <label class="wizard-field">Visibilité de l’image<input type="range" data-theme-field="backgroundStyle.imageOpacity" min="20" max="100" value="${esc(theme.backgroundStyle.imageOpacity)}"><output>${esc(theme.backgroundStyle.imageOpacity)} %</output></label>
          <label class="wizard-field">Opacité des panneaux de texte<input type="range" data-theme-field="backgroundStyle.panelOpacity" min="80" max="100" value="${esc(theme.backgroundStyle.panelOpacity)}"><output>${esc(theme.backgroundStyle.panelOpacity)} %</output></label>
          <label class="wizard-field">Cadrage horizontal de l’image<input type="range" data-theme-field="backgroundStyle.imagePositionX" min="0" max="100" value="${esc(theme.backgroundStyle.imagePositionX)}"><output>${esc(theme.backgroundStyle.imagePositionX)} %</output></label>
          <label class="wizard-field">Cadrage vertical de l’image<input type="range" data-theme-field="backgroundStyle.imagePositionY" min="0" max="100" value="${esc(theme.backgroundStyle.imagePositionY)}"><output>${esc(theme.backgroundStyle.imagePositionY)} %</output></label>
          ${theme.backgroundStyle.image ? `<div class="wizard-image-previews"><div><img src="${esc(theme.backgroundStyle.image)}" alt="Aperçu du fond"><button type="button" data-wizard-action="remove-background-image">Retirer l’image de fond</button></div></div>` : ''}</div>
        <p class="wizard-help">Les textes restent sur des panneaux réglables pour conserver leur lisibilité, y compris sur un fond photo.</p>`;
      const headerPanel = () => `<div class="wizard-fields"><label class="wizard-check"><input type="checkbox" data-theme-field="components.showLogo"${theme.components.showLogo ? ' checked' : ''}> Afficher le logo</label><label class="wizard-check"><input type="checkbox" data-theme-field="components.showCover"${theme.components.showCover ? ' checked' : ''}> Afficher la couverture</label>
          <label class="wizard-field">Hauteur de couverture (px)<input type="number" data-theme-field="components.coverHeight" min="120" max="520" step="10" value="${esc(theme.components.coverHeight)}"></label>
          <label class="wizard-field">Position horizontale<input type="range" data-theme-field="components.coverPositionX" min="0" max="100" value="${esc(theme.components.coverPositionX)}"><output>${esc(theme.components.coverPositionX)} %</output></label>
          <label class="wizard-field">Position verticale<input type="range" data-theme-field="components.coverPositionY" min="0" max="100" value="${esc(theme.components.coverPositionY)}"><output>${esc(theme.components.coverPositionY)} %</output></label>
          <label class="wizard-field wizard-field-wide">Bannière promotionnelle / annonce (facultative)<input type="text" data-theme-field="components.bannerText" maxlength="180" value="${esc(theme.components.bannerText)}" placeholder="Ex. Menu spécial du vendredi"></label>
          <label class="wizard-field">Libellé de la bannière<input type="text" data-theme-field="components.bannerLabel" maxlength="40" value="${esc(theme.components.bannerLabel)}"></label>
          <label class="wizard-field wizard-field-wide">Texte du pied de page<input type="text" data-theme-field="components.footerText" maxlength="160" value="${esc(theme.components.footerText||'')}" placeholder="Ex. Contactez-nous pour plus d’informations"></label>
          <label class="wizard-field wizard-field-wide">Lien du pied de page (facultatif)<input type="url" data-theme-field="components.footerLink" maxlength="2048" value="${esc(theme.components.footerLink||'')}" placeholder="https://…"></label></div>
        <p class="wizard-help">Le slogan et la description restent dans « Informations ». Les images de couverture et logos sont optimisés avant l’envoi.</p>`;
      const blocksPanel = () => `<div class="wizard-fields"><label class="wizard-field">Style des cartes<select data-theme-field="components.cardStyle">${[['rounded','Coins arrondis'],['square','Carrées'],['flat','Sans ombre ni bordure'],['borderless','Sans bordure']].map(([v,l]) => `<option value="${v}"${theme.components.cardStyle === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wizard-field">Rayon des coins (px)<input type="number" data-theme-field="components.radius" min="0" max="32" value="${esc(theme.components.radius)}"></label>
          <label class="wizard-field">Épaisseur de bordure (px)<input type="number" data-theme-field="components.borderWidth" min="0" max="5" step="1" value="${esc(theme.components.borderWidth)}"></label>
          <label class="wizard-field">Ombres<select data-theme-field="components.shadow">${[['none','Aucune'],['soft','Légère'],['medium','Moyenne'],['strong','Marquée']].map(([v,l]) => `<option value="${v}"${theme.components.shadow === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wizard-field">Espacement des blocs (px)<input type="number" data-theme-field="components.spacing" min="8" max="56" step="2" value="${esc(theme.components.spacing)}"></label>
          <label class="wizard-field">Disposition des produits<select data-theme-field="layout">${[['catalog','Grille catalogue'],['grid','Grille visuelle'],['list','Liste'],['cards','Cartes'],['tabs','Navigation par catégories'],['cover','Présentation avec couverture'],['logo','Logo en tête']].map(([v,l]) => `<option value="${v}"${theme.layout === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="wizard-check"><input type="checkbox" data-theme-field="components.showCategoryNav"${theme.components.showCategoryNav ? ' checked' : ''}> Barre de navigation par catégories</label>
          <label class="wizard-check"><input type="checkbox" data-theme-field="components.collapsibleSections"${theme.components.collapsibleSections ? ' checked' : ''}> Sections repliables</label></div>`;
      const controlsPanel = () => `<div class="wizard-fields"><label class="wizard-field">Forme des boutons<select data-theme-field="components.buttonShape">${[['rounded','Arrondis'],['pill','Pilules'],['square','Carrés']].map(([v,l]) => `<option value="${v}"${theme.components.buttonShape === v ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
          ${colorControl('button','Couleur des boutons',theme.colors.button)}${colorControl('buttonText','Texte des boutons',theme.colors.buttonText)}${colorControl('icon','Couleur des icônes',theme.colors.icon)}${colorControl('link','Couleur des liens',theme.colors.link)}
          <p class="wizard-help">Les actions téléphone, WhatsApp, localisation et site restent conditionnelles aux coordonnées réellement renseignées.</p></div>`;
      const decorationsPanel = () => `<div class="wizard-fields"><label class="wizard-check"><input type="checkbox" data-theme-field="components.galleryZoom"${theme.components.galleryZoom ? ' checked' : ''}> Agrandissement des photos de galerie</label>
          <label class="wizard-check"><input type="checkbox" data-theme-field="components.showBackToTop"${theme.components.showBackToTop ? ' checked' : ''}> Bouton « Retour en haut »</label>
          <label class="wizard-check"><input type="checkbox" data-theme-field="components.sharePage"${theme.components.sharePage ? ' checked' : ''}> Bouton de partage de la page</label>
          <label class="wizard-check"><input type="checkbox" data-theme-field="components.enableAnimation"${theme.components.enableAnimation ? ' checked' : ''}> Animation légère à l’ouverture</label></div>
        <p class="wizard-help">Les préférences système « réduire les animations » désactivent automatiquement les transitions animées. Ces options restent facultatives.</p>`;
      const qrPrintPanel=()=>`<div class="wizard-fields wizard-qr-artwork-controls"><label class="wizard-field">Couleur des modules QR<input type="color" data-qr-style="foreground" value="${safeHex(state.qrStyle.foreground,'#111111')}"></label><label class="wizard-field">Couleur du fond QR<input type="color" data-qr-style="background" value="${safeHex(state.qrStyle.background,'#FFFFFF')}"></label><label class="wizard-field">Correction d’erreur<select data-qr-style="correction">${[['L','L — faible'],['M','M — moyenne'],['Q','Q — haute'],['H','H — très haute']].map(([v,l])=>`<option value="${v}"${state.qrStyle.correction===v?' selected':''}>${l}</option>`).join('')}</select><small>Le logo central impose H automatiquement.</small></label><label class="wizard-field">Style des modules<select data-qr-style="dotStyle">${[['square','Carré'],['rounded','Arrondi'],['dots','Points']].map(([v,l])=>`<option value="${v}"${state.qrStyle.dotStyle===v?' selected':''}>${l}</option>`).join('')}</select></label><label class="wizard-field">Coins de repérage<select data-qr-style="eyeStyle">${[['square','Carrés'],['rounded','Arrondis']].map(([v,l])=>`<option value="${v}"${state.qrStyle.eyeStyle===v?' selected':''}>${l}</option>`).join('')}</select></label><label class="wizard-field">Cadre imprimable<select data-qr-style="frameStyle">${[['none','Sans cadre'],['simple','Cadre simple'],['rounded','Cadre arrondi'],['poster','Affiche']].map(([v,l])=>`<option value="${v}"${state.qrStyle.frameStyle===v?' selected':''}>${l}</option>`).join('')}</select></label><label class="wizard-field">Couleur du cadre<input type="color" data-qr-style="frameColor" value="${safeHex(state.qrStyle.frameColor,'#FFFFFF')}"></label><label class="wizard-field">Texte du cadre<input type="color" data-qr-style="frameTextColor" value="${safeHex(state.qrStyle.frameTextColor,'#111111')}"></label><label class="wizard-field wizard-field-wide">Texte au-dessus du QR<input type="text" data-qr-style="labelTop" maxlength="80" value="${esc(state.qrStyle.labelTop||'')}" placeholder="Ex. Scannez pour voir notre menu"></label><label class="wizard-field wizard-field-wide">Texte sous le QR<input type="text" data-qr-style="labelBottom" maxlength="80" value="${esc(state.qrStyle.labelBottom||'')}" placeholder="Ex. Oymike QR"></label><label class="wizard-file-label">Logo au centre (optionnel)<input type="file" data-qr-logo accept="image/jpeg,image/png,image/webp"><span>Petite image optimisée, max. 70 Kio. Le niveau de correction H sera appliqué.</span></label><label class="wizard-field">Taille du logo (%)<input type="number" min="8" max="14" step="1" data-qr-style="logoScale" value="${esc(state.qrStyle.logoScale||10)}"></label></div><div class="wizard-qr-logo-tools"><button type="button" class="button button-secondary" data-wizard-action="use-page-logo"${state.profileData.logo?'':' disabled'}>Utiliser le logo de la page</button>${state.qrStyle.logo?'<button type="button" class="button button-secondary" data-wizard-action="remove-qr-logo">Retirer le logo central</button>':''}${state.qrStyle.logo?`<img src="${esc(state.qrStyle.logo)}" alt="Aperçu du logo central">`:''}</div><div class="wizard-pricing-note">Un QR personnalisé peut être plus difficile à lire selon l’impression, le matériau ou la caméra. Conservez le contraste requis, testez un exemplaire imprimé avant le tirage et évitez d’agrandir le logo au-delà de la limite.</div><div id="wizardQrContrast" class="wizard-contrast-note"></div>`;
      const previewPanel = () => `<div class="wizard-pricing-note"><strong>Aperçu identique au rendu public :</strong> le même moteur et les mêmes variables de thème sont utilisés dans cette prévisualisation et après le scan. Changez le format avec les boutons situés au-dessus de l’aperçu.</div>`;
      const panelBuilders = { model:stylePanel, colors:colorPanel, type:typographyPanel, background:backgroundPanel, header:headerPanel, blocks:blocksPanel, controls:controlsPanel, decorations:decorationsPanel, 'qr-print':qrPrintPanel, preview:previewPanel };
      const panelTitle = tabList.find(([id]) => id === state.designTab)?.[1] || 'Modèle';
      const savedPresets = readThemePresets();
      const previousVersions = state.code?.profileData?.themeHistory || state.profileData.themeHistory || [];
      const panel = (panelBuilders[state.designTab] || stylePanel)();
      return `<div class="wizard-intro"><span class="wizard-step-kicker">ÉTAPE 3 SUR 4 · APPARENCE</span><h3>Personnalisez votre page</h3><p>Chaque choix est visible immédiatement dans l’aperçu. Le style du QR imprimable reste indépendant des couleurs de la page.</p></div>
        <div class="wizard-design-toolbar"><div><button type="button" class="button button-secondary" data-wizard-action="undo-theme"${state.designUndo.length < 2 ? ' disabled' : ''}>Annuler</button><button type="button" class="button button-secondary" data-wizard-action="redo-theme"${!state.designRedo.length ? ' disabled' : ''}>Rétablir</button><button type="button" class="button button-secondary" data-wizard-action="reset-theme">Réinitialiser</button></div>
          <div><select id="wizardSavedTheme" aria-label="Mes modèles enregistrés"><option value="">Mes modèles (sur cet appareil)…</option>${savedPresets.map((preset) => `<option value="${esc(preset.id)}">${esc(preset.name)}</option>`).join('')}</select><button type="button" class="button button-secondary" data-wizard-action="save-theme-preset">Enregistrer le modèle</button>${previousVersions.length ? '<button type="button" class="button button-secondary" data-wizard-action="restore-saved-theme">Restaurer la version précédente</button>' : ''}</div></div>
        ${state.notice ? `<div class="wizard-success" role="status">${esc(state.notice)}</div>` : ''}
        <nav class="wizard-design-tabs" aria-label="Rubriques de personnalisation">${tabList.map(([id,label]) => `<button type="button" data-wizard-action="design-tab" data-design-tab="${id}" class="${state.designTab === id ? 'is-active' : ''}" aria-current="${state.designTab === id ? 'page' : 'false'}">${label}</button>`).join('')}</nav>
        <div class="wizard-layout"><div class="wizard-form-column"><div class="wizard-form-section wizard-design-panel"><div class="wizard-design-panel-heading"><h4>${esc(panelTitle)}</h4><span>Configuration enregistrée avec ce QR</span></div>${panel}</div></div>
        <aside class="wizard-preview-aside"><span class="wizard-step-kicker">APERÇU EN DIRECT</span><h4>Après le scan · ${state.previewDevice === 'phone' ? 'téléphone' : state.previewDevice === 'tablet' ? 'tablette' : 'ordinateur'}</h4><div id="wizardInlinePreview"></div></aside></div>`;
    }
    function renderStepFour() {
      const p = state.profileData; const qrContrast = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);const frameContrast=qrFrameContrast();
      const pageIssues = themeContrastIssues();
      const controlledStatus = state.code && ['suspended', 'inactive', 'rejected'].includes(state.code.status);
      const statusReview = controlledStatus ? `Statut ${state.code.status === 'rejected' ? 'refusé' : 'suspendu'} contrôlé par le PDG — conservé` : state.saveMode === 'draft' ? 'Brouillon — non public' : 'Actif après confirmation';
      return `<div class="wizard-intro"><span class="wizard-step-kicker">ÉTAPE 4 SUR 4 · VÉRIFICATION</span><h3>Aperçu avant validation</h3><p>Vérifiez la page sur téléphone et ordinateur. Rien ne sera publié avant votre action finale.</p></div>
        <div class="wizard-preview-actions"><button type="button" data-wizard-action="reset-theme">Recommencer la personnalisation</button><span>Page dynamique · le lien imprimé restera stable</span></div><div id="wizardFullPreview"></div><div class="wizard-qr-sample"><canvas id="wizardQrDesignPreview" width="240" height="240" aria-label="Aperçu visuel du style du QR"></canvas><div><p><strong>Votre style de QR.</strong><br>Motif d’exemple temporaire. Ne l’imprimez pas : le code final sera créé après votre confirmation.</p><p id="wizardQrRenderStatus" class="wizard-qr-render-status" role="status" aria-live="polite"></p></div></div>
        <div class="wizard-review-grid"><div><strong>Modèle</strong><span>${esc(state.template?.label || '')}</span></div><div><strong>Bénéficiaire</strong><span>${state.beneficiaryMode === 'new' ? 'Nouveau bénéficiaire' : esc(state.beneficiaries.find((item) => item.id === state.beneficiaryId)?.name || 'À choisir')}</span></div><div><strong>Statut après validation</strong><span>${esc(statusReview)}</span></div><div><strong>Contraste QR</strong><span>${qrContrast.toFixed(1)}:1 ${qrContrast >= 4.5 ? '· lisible' : '· insuffisant'}</span></div><div><strong>Contraste du cadre</strong><span>${frameContrast.toFixed(1)}:1 ${frameContrast>=4.5?'· lisible':'· insuffisant'}</span></div><div><strong>Contraste de lecture</strong><span>${pageIssues.length ? `À corriger : ${esc(pageIssues.join(', '))}` : 'Tous les éléments vérifiés sont conformes · ≥ 4,5:1'}</span></div></div>
        ${state.destinationType === 'redirect' ? '<div class="wizard-pricing-note">Cette destination est une redirection directe; aucune page de profil ne sera affichée. Pour conserver une page modifiable, choisissez « Page Oymike QR ».</div>' : ''}
        <div class="wizard-final-confirm"><label><input type="checkbox" id="wizardConfirmPublish"> J’ai vérifié les informations et je confirme ${state.codeId ? 'la modification' : 'la création'} de ce QR.</label><small>Le bouton choisi enregistre soit un brouillon non public, soit un QR actif. La page restera modifiable sans changer l’adresse imprimée.</small></div>`;
    }
    function renderStep() {
      const content = state.step === 1 ? renderStepOne() : state.step === 2 ? renderStepTwo() : state.step === 3 ? renderStepThree() : renderStepFour();
      const qrContrast = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);const frameContrast=qrFrameContrast();
      const pageIssues = themeContrastIssues();
      const controlledStatus = state.code && ['suspended', 'inactive', 'rejected'].includes(state.code.status);
      const stepTitles = ['Modèle', 'Informations', 'Apparence', 'Aperçu'];
      rootElement.hidden = false;
      rootElement.innerHTML = `<article class="modal-card wizard-card qr-wizard" role="dialog" aria-modal="true" aria-labelledby="wizardTitle"><header class="modal-header wizard-header"><div><span class="eyebrow">OYMIKE QR · STUDIO</span><h2 id="wizardTitle">${state.codeId ? 'Modifier la présentation' : 'Créer un QR code'}</h2><p>Simple, guidé et modifiable après impression.</p></div><button class="modal-close" type="button" data-wizard-action="close" aria-label="Fermer">×</button></header><nav class="wizard-progress" aria-label="Étapes de création">${stepTitles.map((title, index) => `<span class="wizard-progress-step${state.step === index + 1 ? ' is-active' : ''}${state.step > index + 1 ? ' is-done' : ''}"><i>${state.step > index + 1 ? '✓' : index + 1}</i>${title}</span>`).join('')}</nav><div class="wizard-body">${content}${state.error ? `<div class="wizard-error" role="alert">${esc(state.error)}</div>` : ''}</div><footer class="modal-footer wizard-footer"><span class="modal-footer-note">${state.step === 4 ? 'La validation est une action volontaire.' : `Étape ${state.step} sur 4`}</span><div class="modal-footer-actions">${state.step > 1 ? '<button type="button" class="button button-secondary" data-wizard-action="back">← Précédent</button>' : '<button type="button" class="button button-secondary" data-wizard-action="close">Annuler</button>'}${state.step < 4 ? `<button type="button" class="button button-primary" data-wizard-action="next"${(state.step === 1 && !state.template) ? ' disabled' : ''}>${state.step === 3 ? 'Aperçu avant validation' : 'Continuer'} →</button>` : `${controlledStatus ? '' : `<button type="button" class="button button-secondary" data-wizard-action="save-draft"${state.saving ? ' disabled' : ''}>Enregistrer comme brouillon</button>`}<button type="button" class="button button-primary" data-wizard-action="publish"${state.saving || qrContrast < 4.5 || frameContrast < 4.5 || pageIssues.length > 0 ? ' disabled' : ''}>${state.codeId ? controlledStatus ? 'Enregistrer les changements · statut conservé' : 'Enregistrer les changements' : 'Valider et créer le QR'}</button>`}</div></footer></article>`;
      if (state.step === 2) renderPreview($('#wizardInlinePreview', rootElement), true);
      if (state.step === 3) { renderPreview($('#wizardInlinePreview', rootElement), true); updateQrContrast(); renderQrDesignPreview(); }
      if (state.step === 4) { renderPreview($('#wizardFullPreview', rootElement), false); renderQrDesignPreview(); }
    }
    function updateQrContrast() {
      const qrNote = $('#wizardQrContrast', rootElement); if (!qrNote) return;
      const qr = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);const frame=qrFrameContrast();
      const pageIssues = themeContrastIssues();
      qrNote.className = `wizard-contrast-note${qr < 4.5 || frame < 4.5 || pageIssues.length ? ' is-warning' : ''}`;
      qrNote.textContent = qr < 4.5 ? `Contraste du QR ${qr.toFixed(1)}:1 : trop faible. Assombrissez les modules ou éclaircissez le fond.`
        : frame < 4.5 ? `Contraste du cadre ${frame.toFixed(1)}:1 : choisissez une couleur de texte ou de cadre plus contrastée.`
          : pageIssues.length ? `Contraste de page inférieur à 4,5:1 pour : ${pageIssues.join(', ')}. Corrigez ces couleurs.` : `Contraste QR ${qr.toFixed(1)}:1; cadre lisible; couleurs de page vérifiées.`;
      const publish = $('[data-wizard-action="publish"]', rootElement);
      if (publish) publish.disabled = state.saving || qr < 4.5 || frame < 4.5 || pageIssues.length > 0;
    }
    function close() {
      if (handler) { rootElement.removeEventListener('click', handler.click); rootElement.removeEventListener('input', handler.input); rootElement.removeEventListener('change', handler.change); }
      if (escapeHandler) document.removeEventListener('keydown', escapeHandler);
      rootElement.innerHTML = ''; rootElement.hidden = true; rootElement.removeAttribute('aria-busy');
      options.onClose?.();
    }
    async function refreshPricing() {
      if (role !== 'manager' || state.codeId || !state.template) return;
      const customerType = state.beneficiaryMode === 'existing'
        ? ({ commerce: 'business', business: 'business', organization: 'business', individual: 'individual' })[state.beneficiaries.find((item) => item.id === state.beneficiaryId)?.type || state.template.beneficiaryType] || 'custom'
        : ({ commerce: 'business', business: 'business', organization: 'business', individual: 'individual' })[state.template.beneficiaryType] || 'custom';
      const params = new URLSearchParams({ customerType, qrPurpose: state.template.purpose || 'other', destinationType: state.destinationType });
      state.pricingError = '';
      try {
        const result = await api(`${apiBase}/finance/pricing?${params}`);
        state.pricingPlans = result.data || [];
        if (!state.pricingPlans.some((plan) => plan.id === state.selectedPlanId)) state.selectedPlanId = state.pricingPlans.length === 1 ? state.pricingPlans[0].id : '';
      } catch (error) { state.pricingPlans = []; state.selectedPlanId = ''; state.pricingError = error.message || 'Erreur de chargement.'; }
      if (state.step === 2) { const old = rootElement.querySelector('.wizard-pricing-box,.wizard-pricing-note'); if (old) { const wrapper = document.createElement('div'); wrapper.innerHTML = renderPricing(); old.replaceWith(wrapper.firstElementChild); } }
    }
    function collectItemDraft() {
      if (!rootElement.querySelector('[data-item-field="name"]')) return;
      const draft = state.itemDraft || blankItem(state.template);
      rootElement.querySelectorAll('[data-item-field]').forEach((input) => {
        const key = input.dataset.itemField;
        draft[key] = input.type === 'checkbox' ? input.checked : input.value;
      });
      draft.variants = parsePriceRows($('[data-item-field="variantsText"]', rootElement)?.value || '');
      draft.options = parsePriceRows($('[data-item-field="optionsText"]', rootElement)?.value || '');
      state.itemDraft = draft;
    }
    function readPayload() {
      const template = state.template;
      if (!template) throw new Error('Choisissez un modèle.');
      const p = state.profileData;
      if (!String(p.entityName || '').trim()) throw new Error('Saisissez le nom de la personne ou de la structure.');
      if (state.beneficiaryMode === 'existing' && !state.beneficiaryId) throw new Error('Choisissez un bénéficiaire existant ou sélectionnez « Nouveau ».');
      if (state.destinationType === 'redirect' && !String(state.targetUrl || '').trim()) throw new Error('Saisissez une adresse Internet pour la redirection.');
      const qrContrast = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);
      const pageIssues = themeContrastIssues();
      if (qrContrast < 4.5) throw new Error('Le contraste du QR est insuffisant. Le serveur refusera cette combinaison pour protéger la lisibilité.');
      if (pageIssues.length) throw new Error(`Contraste insuffisant pour : ${pageIssues.join(', ')}. Corrigez ces couleurs avant d’enregistrer.`);
      const qrName = String(state.qrName || '').trim() || `${p.entityName} — ${template.label}`;
      const payload = {
        name: qrName.slice(0, 120), beneficiaryId: state.beneficiaryId, categoryId: state.categoryId || template.categoryId,
        purpose: template.purpose || 'other', destinationType: state.destinationType, targetUrl: state.targetUrl,
        title: String(state.qrTitle || p.entityName).trim().slice(0, 140), description: String(state.qrDescription || p.subtitle || '').trim().slice(0, 800),
        contentText: String(state.qrContentText || '').trim().slice(0, 5000), extraLinks: [], selectedFields: ['logo','phone','whatsapp','email','address','locationUrl','website','socials','bio','offers','documents'],
        selectedPhotoIds: [], photos: state.photos.map((photo, index) => ({ ...photo, sortOrder: index, isPrimary: photo.isPrimary === true })),
        profileData: { ...p, templateId: template.id, kind: template.kind, templateLabel: template.label },
        style: { ...state.qrStyle, textSize: 'default' }, saveMode: state.saveMode,
      };
      if (payload.destinationType === 'page') {
        const newBeneficiary = state.beneficiaryMode === 'new' ? {
          logo:p.logo,phone:p.phone,whatsapp:p.whatsapp,email:p.email,address:[p.address,p.city].filter(Boolean).join(', '),
          locationUrl:p.mapUrl,website:p.website,socials:p.socials,bio:p.description||p.subtitle,
          offers:(p.items||[]).map((item)=>({name:item.name,description:item.description||''})),documents:p.documents,
        } : state.beneficiaries.find((item)=>item.id===state.beneficiaryId);
        const hasSelectedData = newBeneficiary && payload.selectedFields.some((field)=>{
          const value=newBeneficiary[field];return Array.isArray(value)?value.length>0:Boolean(value);
        });
        if (!hasSelectedData && !payload.selectedPhotoIds.length && !payload.photos.length && !payload.description && !payload.contentText && !payload.extraLinks.length) {
          throw new Error('Ajoutez au moins une information à afficher (téléphone, lien, présentation, élément ou photo) avant de créer le QR. Aucun bénéficiaire ne sera créé tant que cette vérification échoue.');
        }
      }
      return payload;
    }
    async function ensureBeneficiary(payload) {
      if (state.beneficiaryMode === 'existing') return state.beneficiaryId;
      const p = state.profileData; const template = state.template;
      const beneficiary = {
        type: existingType(template.beneficiaryType), name: p.entityName, logo: p.logo || '', photos: [], phone: p.phone || '', whatsapp: p.whatsapp || '',
        email: p.email || '', address: [p.address, p.city].filter(Boolean).join(', '), locationUrl: p.mapUrl || '', website: p.website || '',
        bio: p.description || p.subtitle || '', socials: p.socials || [], offers: (p.items || []).slice(0, 60).map((item) => ({ name: item.name, description: item.description || '', price: item.priceXof == null ? '' : `${item.priceXof} FCFA`, url: '' })), documents: p.documents || [],
      };
      let beneficiaryId = state.createdBeneficiaryId;
      if (beneficiaryId) {
        await api(`${apiBase}/beneficiaries/${encodeURIComponent(beneficiaryId)}`, { method: 'PUT', body: JSON.stringify(beneficiary) });
      } else {
        const result = await api(`${apiBase}/beneficiaries`, { method: 'POST', body: JSON.stringify({ ...beneficiary, clientRequestId: state.clientRequestId }) });
        beneficiaryId = result.data?.id;
        if (!beneficiaryId) throw new Error('Le serveur n’a pas confirmé l’identifiant du bénéficiaire. Réessayez; la même demande sera reprise.');
        if (result.idempotent) await api(`${apiBase}/beneficiaries/${encodeURIComponent(beneficiaryId)}`, { method: 'PUT', body: JSON.stringify(beneficiary) });
        state.createdBeneficiaryId = beneficiaryId; state.beneficiaryId = beneficiaryId;
      }
      const select = $('#wizardBeneficiary', rootElement); if (select) select.value = beneficiaryId;
      return beneficiaryId;
    }
    async function save(mode) {
      if (state.saving) return;
      syncFields(); collectItemDraft();
      state.saveMode = mode === 'draft' ? 'draft' : 'publish';
      const confirm = $('#wizardConfirmPublish', rootElement);
      if (!confirm?.checked) { state.error = 'Confirmez la création ou la modification avant de poursuivre.'; renderStep(); return; }
      try {
        const payload = readPayload();
        state.saving = true; state.error = ''; rootElement.setAttribute('aria-busy', 'true');
        [...rootElement.querySelectorAll('[data-wizard-action="publish"], [data-wizard-action="save-draft"]')].forEach((button) => { button.disabled = true; });
        const footerNote = $('.wizard-footer .modal-footer-note', rootElement);
        if (footerNote) footerNote.textContent = 'Enregistrement du bénéficiaire puis du QR…';
        payload.beneficiaryId = await ensureBeneficiary(payload);
        if (!state.codeId) payload.clientRequestId = state.clientRequestId;
        if (role === 'manager' && !state.codeId) {
          const beneficiary = state.beneficiaries.find((item) => item.id === payload.beneficiaryId);
          const customerType = ({ individual: 'individual', business: 'business', commerce: 'business', organization: 'business', other: 'custom' })[beneficiary?.type || state.template.beneficiaryType] || 'custom';
          payload.customerType = customerType;
          payload.pricingPlanId = state.selectedPlanId || '';
          payload.optionIds = state.selectedOptionIds;
          payload.createOrder = Boolean(state.selectedPlanId);
          payload.paymentMethod = 'cash';
          payload.clientName = state.profileData.entityName;
          payload.companyName = customerType === 'business' ? state.profileData.entityName : '';
        }
        const isEdit = Boolean(state.codeId);
        const result = await api(isEdit ? `${apiBase}/codes/${encodeURIComponent(state.codeId)}` : `${apiBase}/codes`, {
          method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload),
        });
        if (!result?.data?.id || !result.data.publicCode || result.data.beneficiaryId !== payload.beneficiaryId) {
          throw new Error('Le serveur n’a pas confirmé l’identifiant public et le bénéficiaire associé. Vérifiez la liste avant toute nouvelle création.');
        }
        rootElement.removeAttribute('aria-busy');
        state.saving = false;
        close();
        try { await options.onSaved?.(result, isEdit, mode); }
        catch (error) {
          console.error('QR enregistré; actualisation de l’interface après sauvegarde échouée:', error);
          options.onPostSaveError?.(error, result);
        }
      } catch (error) {
        state.saving = false; rootElement.removeAttribute('aria-busy');
        const rawMessage = String(error?.message || '');
        const networkFailure = error?.name === 'TypeError' || /failed to fetch|networkerror|load failed|network request failed/i.test(rawMessage);
        state.error = networkFailure
          ? 'Connexion interrompue pendant l’enregistrement. Votre saisie est conservée; réessayez sans fermer cette fenêtre. La même demande sera reprise sans créer de doublon.'
          : rawMessage || 'Impossible d’enregistrer ce QR. Vérifiez les informations et réessayez.';
        renderStep();
      }
    }
    async function loadBeneficiaries() {
      const result = await api(`${apiBase}/beneficiaries?limit=100&status=active`);
      state.beneficiaries = result.data || [];
      if (state.beneficiaryId && !state.beneficiaries.some((item) => item.id === state.beneficiaryId)) {
        try { const one = await api(`${apiBase}/beneficiaries/${encodeURIComponent(state.beneficiaryId)}`); state.beneficiaries.unshift(one.data); } catch (_) { state.beneficiaryId = ''; }
      }
    }
    handler = {
      click: async (event) => {
        if (event.target === rootElement) { event.preventDefault(); close(); return; }
        const templateCard = event.target.closest('[data-template-id]');
        const groupButton = event.target.closest('[data-template-group]');
        const action = event.target.closest('[data-wizard-action]');
        const paletteButton = event.target.closest('[data-palette-id]');
        if (templateCard) { setDefaultTemplate(templateCard.dataset.templateId); state.error = ''; renderStep(); return; }
        if (groupButton) { state.groupId = groupButton.dataset.templateGroup; renderStep(); return; }
        if (paletteButton) {
          syncFields(); const palette = Templates.palettes.find((item) => item.id === paletteButton.dataset.paletteId);
          if (palette) {
            const current = state.profileData.theme;
            state.profileData.theme = { ...current, ...palette, paletteId:palette.id, colors:clone(palette.colors),
              typography:current.typography, components:current.components,
              backgroundStyle:{ ...current.backgroundStyle, type:'solid', color1:palette.colors.pageBg, color2:palette.colors.mainBg, color3:palette.colors.panel } };
            state.themeTouched = true; syncLegacyTheme(); recordThemeChange();
          }
          renderStep(); return;
        }
        if (!action) return;
        event.preventDefault();
        switch (action.dataset.wizardAction) {
          case 'close': close(); break;
          case 'back': syncFields(); collectItemDraft(); state.error = ''; state.step = Math.max(1, state.step - 1); renderStep(); break;
          case 'next':
            syncFields(); collectItemDraft(); state.error = '';
            if (state.step === 1 && !state.template) { state.error = 'Choisissez un modèle de présentation.'; renderStep(); break; }
            if (state.step === 2) {
              if (state.itemDraft) { state.error = 'Enregistrez ou annulez l’élément en cours avant de continuer.'; renderStep(); break; }
              try { const values = readPayload(); if (!values.beneficiaryId && state.beneficiaryMode === 'existing') throw new Error('Choisissez un bénéficiaire ou sélectionnez « Nouveau ».'); }
              catch (error) { state.error = error.message; renderStep(); break; }
            }
            state.step = Math.min(4, state.step + 1); renderStep(); if (state.step === 2) refreshPricing(); break;
          case 'beneficiary-existing': state.beneficiaryMode = 'existing'; state.beneficiaryId = options.beneficiaryId || state.code?.beneficiaryId || ''; state.createdBeneficiaryId = ''; renderStep(); refreshPricing(); break;
          case 'beneficiary-new': state.beneficiaryMode = 'new'; state.beneficiaryId = ''; state.createdBeneficiaryId = ''; renderStep(); refreshPricing(); break;
          case 'preview-phone': case 'preview-tablet': case 'preview-desktop': syncFields(); state.previewDevice = action.dataset.wizardAction.replace('preview-',''); state.phonePreview = state.previewDevice === 'phone'; renderStep(); break;
          case 'design-tab': syncFields(); state.designTab = action.dataset.designTab || 'colors'; renderStep(); break;
          case 'select-style': syncFields(); state.profileData.theme.style = action.dataset.style || 'modern'; state.themeTouched = true; recordThemeChange(); renderStep(); break;
          case 'undo-theme':
            syncFields(); recordThemeChange();
            if (state.designUndo.length > 1) { state.designRedo.push(state.designUndo.pop()); applyThemeSnapshot(state.designUndo[state.designUndo.length - 1]); renderStep(); }
            break;
          case 'redo-theme':
            if (state.designRedo.length) { const snapshot = state.designRedo.pop(); applyThemeSnapshot(snapshot); state.designUndo.push(JSON.stringify(state.profileData.theme)); renderStep(); }
            break;
          case 'reset-colors': {
            syncFields(); const defaults = defaultTheme(state.template); state.profileData.theme.colors = clone(defaults.colors); state.profileData.theme.paletteId = defaults.paletteId;
            state.profileData.theme.backgroundStyle = { ...state.profileData.theme.backgroundStyle, color1:defaults.colors.pageBg, color2:defaults.colors.mainBg, color3:defaults.colors.panel };
            syncLegacyTheme(); state.themeTouched = true; state.notice = 'Les couleurs du modèle d’activité ont été rétablies.'; recordThemeChange(); renderStep(); break;
          }
          case 'reset-theme': {
            syncFields(); const history = state.profileData.themeHistory || []; const version = state.profileData.themeVersion || 0;
            state.profileData.theme = defaultTheme(state.template); state.profileData.themeHistory = history; state.profileData.themeVersion = version;
            state.themeTouched = true; state.notice = 'Le thème visuel a été réinitialisé. Les contenus et photos sont conservés.'; recordThemeChange(); renderStep(); break;
          }
          case 'save-theme-preset': saveLocalThemePreset(); break;
          case 'restore-saved-theme': {
            syncFields(); const versions = state.code?.profileData?.themeHistory || state.profileData.themeHistory || []; const previous = versions[versions.length - 1];
            if (previous?.theme) { state.profileData.theme = completeTheme(previous.theme,state.template); state.themeTouched = true; state.notice = `Version ${previous.version || ''} chargée. Enregistrez le QR pour la restaurer.`; recordThemeChange(); renderStep(); }
            break;
          }
          case 'remove-background-image': state.profileData.theme.backgroundStyle.image = ''; state.themeTouched = true; recordThemeChange(); renderStep(); break;
          case 'select-gallery-background': {const asset=state.designGallery.find(item=>item.id===action.dataset.galleryId);if(asset){state.profileData.theme.backgroundStyle.image=asset.image;state.profileData.theme.backgroundStyle.type='image';state.themeTouched=true;state.notice=`Image « ${asset.title} » chargée depuis la galerie Oymike QR.`;recordThemeChange();renderStep();}break;}
          case 'use-page-logo': if(state.profileData.logo){state.qrStyle.logo=state.profileData.logo;state.qrStyle.correction='H';state.error='';}else state.error='Ajoutez d’abord un logo à la page.';renderStep();break;
          case 'remove-qr-logo': state.qrStyle.logo='';state.qrStyle.correction='M';renderStep();break;
          case 'new-item': syncFields(); state.itemDraft = blankItem(state.template); state.itemDraft.group = defaultGroupFor(state.template); state.editingItemId = ''; renderStep(); break;
          case 'cancel-item': syncFields(); state.itemDraft = null; state.editingItemId = ''; renderStep(); break;
          case 'edit-item': syncFields(); { const item = state.profileData.items.find((row) => row.id === action.dataset.itemId); state.itemDraft = item ? clone(item) : blankItem(state.template); state.editingItemId = item?.id || ''; renderStep(); } break;
          case 'delete-item': state.profileData.items = state.profileData.items.filter((row) => row.id !== action.dataset.itemId); renderStep(); break;
          case 'remove-item-photo': if (state.itemDraft) state.itemDraft.photos = []; renderStep(); break;
          case 'save-item':
            collectItemDraft();
            if (!String(state.itemDraft?.name || '').trim()) { state.error = 'Ajoutez un nom à cet élément.'; renderStep(); break; }
            state.itemDraft.id = state.itemDraft.id || uuid();
            state.itemDraft.priceXof = state.itemDraft.priceXof === '' ? null : Number(state.itemDraft.priceXof);
            state.itemDraft.promotionPriceXof = state.itemDraft.promotionPriceXof === '' || state.itemDraft.promotionPriceXof == null ? null : Number(state.itemDraft.promotionPriceXof);
            if (state.itemDraft.promotionPriceXof != null && (state.itemDraft.priceXof == null || state.itemDraft.promotionPriceXof >= state.itemDraft.priceXof)) { state.error = 'Le prix promotionnel doit être inférieur au prix normal. Vérifiez les deux montants.'; renderStep(); break; }
            state.itemDraft.available = state.itemDraft.available !== false;
            if (state.editingItemId) state.profileData.items = state.profileData.items.map((row) => row.id === state.editingItemId ? clone(state.itemDraft) : row);
            else if (state.profileData.items.length >= 30) { state.error = 'La page accepte jusqu’à 30 éléments. Vous pourrez en ajouter en retirant des éléments existants.'; renderStep(); break; }
            else state.profileData.items.push(clone(state.itemDraft));
            state.itemDraft = null; state.editingItemId = ''; state.error = ''; renderStep(); break;
          case 'remove-logo': state.profileData.logo = ''; renderStep(); break;
          case 'remove-cover': state.profileData.coverImage = ''; renderStep(); break;
          case 'remove-custom-value': if(state.profileData.customFields)delete state.profileData.customFields[action.dataset.customKey];renderStep();break;
          case 'set-primary-photo': state.photos = state.photos.map((photo) => ({ ...photo, isPrimary: photo.id === action.dataset.photoId })); renderStep(); break;
          case 'move-photo-up': movePhoto(action.dataset.photoId, -1); renderStep(); break;
          case 'move-photo-down': movePhoto(action.dataset.photoId, 1); renderStep(); break;
          case 'delete-photo': state.photos = state.photos.filter((photo) => photo.id !== action.dataset.photoId); if (state.photos.length && !state.photos.some((photo) => photo.isPrimary)) state.photos[0].isPrimary = true; renderStep(); break;
          case 'save-draft': await save('draft'); break;
          case 'publish': await save('publish'); break;
          case 'clear-template-search': state.search = ''; renderStep(); break;
        }
      },
      input: (event) => {
        if (event.target.id === 'wizardTemplateSearch') { state.search = event.target.value; const caret = event.target.selectionStart; renderStep(); const input = $('#wizardTemplateSearch', rootElement); input?.focus(); input?.setSelectionRange(caret, caret); return; }
        if (event.target.matches('[data-item-field]')) { collectItemDraft(); if (state.step === 2) renderPreview($('#wizardInlinePreview', rootElement), true); return; }
        if (event.target.matches('[data-photo-caption]')) { state.photos = state.photos.map((photo) => photo.id === event.target.dataset.photoCaption ? { ...photo, caption: event.target.value, alt: event.target.value } : photo); if (state.step === 2) renderPreview($('#wizardInlinePreview', rootElement), true); return; }
        if (event.target.matches('[data-theme-hex]')) {
          const input = event.target; const value = input.value.trim();
          if (/^#[0-9a-f]{6}$/i.test(value)) {
            const path = input.dataset.themeHex; const color = [...rootElement.querySelectorAll('[data-theme-field]')].find((item) => item.dataset.themeField === path);
            if (color) color.value = value.toUpperCase();
            setDeep(state.profileData.theme,path,value.toUpperCase());
            if (path.startsWith('colors.')) { state.profileData.theme.paletteId = 'custom'; rootElement.querySelectorAll('[data-palette-id]').forEach((button) => button.classList.remove('is-selected')); }
            state.themeTouched = true; syncLegacyTheme(); recordThemeChange(); input.setAttribute('aria-invalid','false'); input.setCustomValidity(''); input.title = 'Code HEX valide';
            renderPreview($('#wizardInlinePreview', rootElement), true); updateQrContrast();
          } else { input.setAttribute('aria-invalid','true'); input.setCustomValidity('Saisissez un code HEX complet au format #RRGGBB.'); input.title = 'Format requis : #RRGGBB'; }
          return;
        }
        if (event.target.matches('[data-profile-field],[data-custom-field],[data-item-groups],[data-theme-field],[data-qr-field],[data-qr-style]') || event.target.id === 'wizardSocials' || event.target.id === 'wizardDocuments') {
          syncFields();
          if (event.target.dataset.qrStyle) state.qrStyle[event.target.dataset.qrStyle] = event.target.value;
          if (event.target.matches('[data-theme-field]')) {
            if (event.target.type === 'color') {
              const pairedHex = [...rootElement.querySelectorAll('[data-theme-hex]')].find((input) => input.dataset.themeHex === event.target.dataset.themeField);
              if (pairedHex) pairedHex.value = event.target.value.toUpperCase();
            }
            if (event.target.dataset.themeField.startsWith('colors.')) { state.profileData.theme.paletteId = 'custom'; rootElement.querySelectorAll('[data-palette-id]').forEach((button) => button.classList.remove('is-selected')); }
            state.themeTouched = true; recordThemeChange();
          }
          const output = event.target.closest('label')?.querySelector('output'); if (output && event.target.type === 'range') output.textContent = `${event.target.value} %`;
          if (state.step === 2) renderPreview($('#wizardInlinePreview', rootElement), true);
          if (state.step === 3) { renderPreview($('#wizardInlinePreview', rootElement), true); updateQrContrast(); renderQrDesignPreview(); }
          if (state.step === 4) renderPreview($('#wizardFullPreview', rootElement), false);
          if (event.target.dataset.profileField === 'entityName' && !state.qrNameTouched && !state.code) { state.qrName = `${event.target.value} — ${state.template?.label || ''}`.trim().slice(0, 120); const nameInput = $('[data-qr-field="qrName"]', rootElement); if (nameInput) nameInput.value = state.qrName; }
        }
      },
      change: async (event) => {
        const target = event.target;
        if (target.id === 'wizardSavedTheme') { if (target.value) loadLocalThemePreset(target.value); return; }
        if (target.matches('[data-theme-background-image]')) {
          const file = target.files?.[0]; if (!file) return;
          target.disabled = true; state.error = '';
          try { state.profileData.theme.backgroundStyle.image = await readImage(file,180*1024,1600); state.profileData.theme.backgroundStyle.type = 'image'; state.themeTouched = true; recordThemeChange(); state.notice = 'Image de fond optimisée; elle sera enregistrée avec le QR.'; renderStep(); }
          catch (error) { state.error = error.message; renderStep(); }
          return;
        }
        if(target.matches('[data-qr-logo]')){const file=target.files?.[0];if(!file)return;target.disabled=true;try{state.qrStyle.logo=await readImage(file,65*1024,600);state.qrStyle.correction='H';state.error='';renderStep();}catch(error){state.error=error.message;renderStep();}return;}
        if(target.matches('[data-custom-upload]')){
          const file=target.files?.[0];if(!file)return;target.disabled=true;state.error='';
          try{state.profileData.customFields=state.profileData.customFields||{};state.profileData.customFields[target.dataset.customUpload]=target.dataset.customType==='image'?await readImage(file,170*1024,1280):await readPdf(file,350*1024);renderStep();}
          catch(error){state.error=error.message;renderStep();}return;
        }
        if (target.matches('[data-upload-field]')) {
          const file = target.files?.[0]; if (!file) return;
          target.disabled = true; state.error = '';
          try { state.profileData[target.dataset.uploadField] = await readImage(file, target.dataset.uploadField === 'coverImage' ? 320 * 1024 : 230 * 1024, target.dataset.uploadField === 'coverImage' ? 1500 : 900); renderStep(); }
          catch (error) { state.error = error.message; renderStep(); }
          return;
        }
        if (target.matches('[data-upload-qr-gallery]')) {
          const files = [...(target.files || [])]; if (state.photos.length + files.length > 8) { state.error = 'Ajoutez au maximum 8 photos à ce QR.'; renderStep(); return; }
          target.disabled = true; state.error = '';
          try { for (const file of files) state.photos.push({ id: uuid(), src: await readImage(file, 300 * 1024, 1280), caption: file.name.replace(/\.[^.]+$/, '').slice(0, 140), alt: '', isPrimary: state.photos.length === 0, sortOrder: state.photos.length }); renderStep(); }
          catch (error) { state.error = error.message; renderStep(); }
          return;
        }
        if (target.matches('[data-item-photo]')) {
          const file = target.files?.[0]; if (!file) return;
          collectItemDraft();
          try { const photo = await readImage(file, 120 * 1024, 1000); state.itemDraft.photos = [{ id: uuid(), src: photo, caption: state.itemDraft.name || file.name.replace(/\.[^.]+$/, '') }]; renderStep(); }
          catch (error) { state.error = error.message; renderStep(); }
          return;
        }
        if (target.id === 'wizardBeneficiary') { state.beneficiaryId = target.value; state.error = ''; await refreshPricing(); renderPreview($('#wizardInlinePreview', rootElement), true); return; }
        if (target.id === 'wizardCategory') { state.categoryId = target.value; return; }
        if (target.matches('[data-qr-field]')) { syncFields(); if (target.dataset.qrField === 'destinationType') await refreshPricing(); renderPreview($('#wizardInlinePreview', rootElement), true); return; }
        if (target.id === 'wizardPlan') { state.selectedPlanId = target.value; state.selectedOptionIds = []; renderStep(); breakPricingScroll(); return; }
        if (target.matches('[data-plan-option]')) { state.selectedOptionIds = target.checked ? [...new Set([...state.selectedOptionIds, target.dataset.planOption])] : state.selectedOptionIds.filter((id) => id !== target.dataset.planOption); renderStep(); }
        if (target.matches('[data-qr-style]')) { state.qrStyle[target.dataset.qrStyle] = target.value; if (state.step === 3) { updateQrContrast(); renderQrDesignPreview(); } }
        if (target.matches('[data-theme-field]')) {
          syncFields(); state.themeTouched = true; recordThemeChange();
          if (target.dataset.themeField.startsWith('colors.')) { state.profileData.theme.paletteId = 'custom'; rootElement.querySelectorAll('[data-palette-id]').forEach((button) => button.classList.remove('is-selected')); }
          const output = target.closest('label')?.querySelector('output'); if (output && target.type === 'range') output.textContent = `${target.value} %`;
          renderPreview($('#wizardInlinePreview', rootElement), true); if (state.step === 3) updateQrContrast();
        }
      },
    };
    function movePhoto(id, direction) {
      const index = state.photos.findIndex((photo) => photo.id === id); const target = index + direction;
      if (index < 0 || target < 0 || target >= state.photos.length) return;
      const copy = [...state.photos]; [copy[index], copy[target]] = [copy[target], copy[index]]; state.photos = copy.map((photo, i) => ({ ...photo, sortOrder: i }));
    }
    function breakPricingScroll() { const pricing = $('.wizard-pricing-box', rootElement); pricing?.scrollIntoView?.({ block: 'nearest' }); }
    async function defaultApi(url, init = {}) {
      const response = await fetch(url, { credentials: 'same-origin', ...init, headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(init.headers || {}) } });
      const payload = await response.json().catch(() => ({})); if (!response.ok) throw new Error(payload.error || 'Une erreur est survenue.'); return payload;
    }
    async function boot() {
      try { const modelResult=await api('/api/public/qr-templates'); Templates.setCustomTemplates(modelResult.data||[]); }
      catch(error) { state.notice=`Les modèles PDG n’ont pas pu être chargés (${error.message}). Les modèles intégrés restent disponibles.`; }
      try { const galleryResult=await api('/api/public/design-gallery');state.designGallery=galleryResult.data||[]; } catch (_) { state.designGallery=[]; }
      if (state.codeId) {
        const result = options.initialCode ? { data: options.initialCode } : await api(`${apiBase}/codes/${encodeURIComponent(state.codeId)}`); state.code = result.data;
        const code = result.data; state.beneficiaryId = code.beneficiaryId; state.categoryId = code.categoryId || '';
        state.qrName = code.name || ''; state.qrTitle = code.title || ''; state.qrDescription = code.description || ''; state.qrContentText = code.contentText || '';
        state.destinationType = code.destinationType || 'page'; state.targetUrl = code.targetUrl || ''; state.photos = Array.isArray(code.photos) ? code.photos.map((photo) => ({ ...photo })) : [];
        state.qrStyle = { ...state.qrStyle, ...(code.style || {}) }; state.saveMode = code.status === 'draft' ? 'draft' : 'publish';
        const existing = code.profileData || {};
        setDefaultTemplate(existing.templateId || 'personnalise');
        state.profileData = { ...state.profileData, ...existing, theme: completeTheme(existing.theme || state.profileData.theme, state.template), items: Array.isArray(existing.items) ? existing.items : [], themeHistory: Array.isArray(existing.themeHistory) ? existing.themeHistory : [], themeVersion: Number(existing.themeVersion) || 0 };
        state.designUndo = [JSON.stringify(state.profileData.theme)]; state.designRedo = [];
      }
      if (options.beneficiaryId) state.beneficiaryId = options.beneficiaryId;
      await loadBeneficiaries();
      if (!state.categories.length) state.categories = (await api(`${apiBase}/categories`)).data || [];
      if (state.codeId) state.beneficiaryMode = 'existing';
      if (state.beneficiaryId) state.beneficiaryMode = 'existing'; else if (!state.beneficiaries.length) state.beneficiaryMode = 'new';
      renderStep();
      if (state.step === 2) refreshPricing();
    }
    rootElement.addEventListener('click', handler.click);
    rootElement.addEventListener('input', handler.input);
    rootElement.addEventListener('change', handler.change);
    escapeHandler = (event) => { if (event.key === 'Escape' && !rootElement.hidden) close(); };
    document.addEventListener('keydown', escapeHandler);
    handler = { ...handler, close };
    rootElement.innerHTML = '<article class="modal-card wizard-card"><div class="wizard-body"><p>Chargement du studio…</p></div></article>';
    rootElement.hidden = false;
    boot().catch((error) => { state.error = error.message; state.step = 1; renderStep(); });
    return { close };
  }
  root.QRIAQRWizard = { open };
})(typeof window !== 'undefined' ? window : globalThis);
