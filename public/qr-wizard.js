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
  const defaultTheme = (template) => {
    const palette = Templates.palettes.find((item) => item.id === 'forest') || Templates.palettes[0];
    return { ...palette, paletteId: palette.id, style: 'modern', layout: template?.kind === 'restaurant' || template?.kind === 'catalog' ? 'catalog' : 'cover', font: 'system', textSize: 'normal', align: 'left' };
  };
  const blankItem = (template) => ({ id: '', group: template?.kind === 'restaurant' ? 'Plats principaux' : 'À découvrir', name: '', description: '', priceXof: '', promotionPriceXof: '', promotionLabel: '', available: true, featured: false, photos: [], variants: [], options: [] });
  const existingType = (type) => ['individual', 'business', 'commerce', 'organization', 'other'].includes(type) ? type : 'other';
  const groupLabelFor = (template) => template?.kind === 'restaurant' ? 'Catégorie du menu' : template?.kind === 'catalog' ? 'Catégorie' : template?.kind === 'hotel' ? 'Type de chambre' : template?.kind === 'education' ? 'Formation / programme' : template?.kind === 'event' ? 'Rubrique' : 'Catégorie';
  const listLabelFor = (template) => template?.kind === 'restaurant' ? 'Plats et boissons' : template?.kind === 'catalog' ? 'Produits du catalogue' : template?.kind === 'hotel' ? 'Chambres et hébergements' : template?.kind === 'education' ? 'Formations et programmes' : template?.kind === 'event' ? 'Temps forts / programme' : 'Prestations et éléments à présenter';
  const supportedItems = (template) => template && !['link', 'contact'].includes(template.kind);
  const defaultGroupFor = (template) => template?.kind === 'restaurant' ? 'Plats principaux' : template?.kind === 'catalog' ? 'À découvrir' : template?.kind === 'hotel' ? 'Chambres' : template?.kind === 'education' ? 'Formations' : template?.kind === 'event' ? 'Programme' : 'Services';

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
      step: 1, codeId: options.codeId || '', groupId: 'food', search: '', template: null, categories: options.categories || [], beneficiaries: [],
      beneficiaryMode: 'existing', beneficiaryId: options.beneficiaryId || '', createdBeneficiaryId: '',
      profileData: null, photos: [], qrName: '', qrTitle: '', qrDescription: '', qrContentText: '',
      destinationType: 'page', targetUrl: '', categoryId: '', saveMode: 'publish',
      qrStyle: { foreground: '#111111', background: '#FFFFFF', correction: 'M', textSize: 'default', dotStyle: 'square' },
      clientRequestId: uuid().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64), qrNameTouched: false,
      itemDraft: null, editingItemId: '', pricingPlans: [], selectedPlanId: '', selectedOptionIds: [], pricingError: '',
      phonePreview: true, saving: false, error: '', code: null,
    };
    function setDefaultTemplate(templateId) {
      const template = Templates.get(templateId) || Templates.get('personnalise');
      if (!template) return;
      const previous = state.profileData || {};
      state.template = template;
      state.groupId = template.groupId || state.groupId;
      state.profileData = {
        ...previous, templateId: template.id, kind: template.kind, templateLabel: template.label,
        entityName: previous.entityName || '', subtitle: previous.subtitle || '', description: previous.description || '',
        logo: previous.logo || '', coverImage: previous.coverImage || '', phone: previous.phone || '', whatsapp: previous.whatsapp || '',
        email: previous.email || '', address: previous.address || '', city: previous.city || '', mapUrl: previous.mapUrl || '', website: previous.website || '',
        hours: previous.hours || '', deliveryInfo: previous.deliveryInfo || '', eventDate: previous.eventDate || '', eventTime: previous.eventTime || '',
        venue: previous.venue || '', organizer: previous.organizer || '', registrationUrl: previous.registrationUrl || '', bookingUrl: previous.bookingUrl || '',
        orderMode: previous.orderMode || 'simple', socials: Array.isArray(previous.socials) ? previous.socials : [], documents: Array.isArray(previous.documents) ? previous.documents : [],
        items: Array.isArray(previous.items) ? previous.items : [], theme: previous.theme || defaultTheme(template),
      };
      state.categoryId = state.categoryId || template.categoryId;
      if (!state.qrNameTouched && !state.code) state.qrName = state.profileData.entityName ? `${state.profileData.entityName} — ${template.label}` : template.label;
      if (template.kind === 'link') state.destinationType = 'redirect';
      else if (!state.code) state.destinationType = 'page';
    }
    function syncFields() {
      if (!rootElement.querySelector('.qr-wizard')) return;
      rootElement.querySelectorAll('[data-profile-field]').forEach((input) => {
        if (input.type === 'file') return;
        const key = input.dataset.profileField;
        if (input.type === 'checkbox') state.profileData[key] = input.checked;
        else state.profileData[key] = input.value;
      });
      rootElement.querySelectorAll('[data-theme-field]').forEach((input) => { state.profileData.theme[input.dataset.themeField] = input.value; });
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
      container.innerHTML = '<div class="experience-preview-modes"><button type="button" data-wizard-action="preview-phone" aria-pressed="true">Téléphone</button><button type="button" data-wizard-action="preview-desktop" aria-pressed="false">Ordinateur</button></div><div id="wizardPreviewFrame" class="experience-preview-frame is-phone"><div id="wizardPreviewMount"></div></div>';
      const frame = $('#wizardPreviewFrame', container);
      const mount = $('#wizardPreviewMount', container);
      if (frame) frame.classList.toggle('is-phone', state.phonePreview);
      if (frame) frame.classList.toggle('is-desktop', !state.phonePreview);
      const modes = container.querySelectorAll('[data-wizard-action^="preview-"]');
      modes.forEach((button) => button.setAttribute('aria-pressed', String((button.dataset.wizardAction === 'preview-phone') === state.phonePreview)));
      if (mount && root.QRIAProfile?.render) root.QRIAProfile.render(mount, previewPayload(), { preview: true, previewLabel: state.codeId ? 'APERÇU — changements non enregistrés' : 'APERÇU — non publié' });
    }
    function itemFormMarkup() {
      const draft = state.itemDraft || blankItem(state.template);
      const photo = draft.photos?.[0]?.src || '';
      const groups = [...new Set([defaultGroupFor(state.template), ...(state.profileData.items || []).map((item) => item.group), draft.group].filter(Boolean))];
      return `<div class="wizard-item-editor"><div class="wizard-item-editor-heading"><strong>${state.editingItemId ? 'Modifier cet élément' : 'Ajouter un élément'}</strong><button type="button" class="wizard-text-button" data-wizard-action="cancel-item">Annuler</button></div>
        <div class="wizard-item-grid"><label>Nom *<input data-item-field="name" maxlength="100" value="${esc(draft.name)}" placeholder="${state.template.kind === 'restaurant' ? 'Ex. Poulet braisé' : 'Ex. Service / produit'}"></label>
        <label>${esc(groupLabelFor(state.template))}<input data-item-field="group" list="wizardItemGroups" maxlength="80" value="${esc(draft.group || defaultGroupFor(state.template))}"><datalist id="wizardItemGroups">${groups.map((group) => `<option value="${esc(group)}"></option>`).join('')}</datalist></label>
        <label>Prix normal en FCFA<input data-item-field="priceXof" type="number" min="0" max="1000000000" step="1" value="${esc(draft.priceXof ?? '')}" placeholder="Laisser vide si non applicable"></label>
        <label>Prix promotionnel en FCFA<input data-item-field="promotionPriceXof" type="number" min="0" max="1000000000" step="1" value="${esc(draft.promotionPriceXof ?? '')}" placeholder="Facultatif; inférieur au prix normal"></label>
        <label>Libellé de la promotion<input data-item-field="promotionLabel" maxlength="80" value="${esc(draft.promotionLabel || '')}" placeholder="Ex. Offre du midi, -10 %"></label>
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
          ${role === 'manager' ? renderPricing() : ''}
          <div class="wizard-form-section"><h4>Catégorie</h4><label class="wizard-field">Classement dans votre espace<select id="wizardCategory">${state.categories.map((category) => `<option value="${esc(category.id)}"${category.id === state.categoryId ? ' selected' : ''}>${esc(category.name)}</option>`).join('')}</select></label></div>
        </div><aside class="wizard-preview-aside"><span class="wizard-step-kicker">APERÇU EN DIRECT</span><h4>Votre page après le scan</h4><div id="wizardInlinePreview"></div></aside></div>`;
    }
    function renderQrDesignPreview() {
      const canvas = $('#wizardQrDesignPreview', rootElement);
      if (!canvas || typeof root.qrcode !== 'function') return;
      try {
        const qr = root.qrcode(0, state.qrStyle.correction || 'M');
        qr.addData(`${baseUrl.replace(/\/$/, '')}/r/apercu`); qr.make();
        const count = qr.getModuleCount(), margin = 4, total = count + margin * 2, size = 240;
        canvas.width = size; canvas.height = size;
        const context = canvas.getContext('2d', { alpha: false }); if (!context) return;
        context.imageSmoothingEnabled = false; context.fillStyle = safeHex(state.qrStyle.background, '#FFFFFF'); context.fillRect(0, 0, size, size);
        context.fillStyle = safeHex(state.qrStyle.foreground, '#111111');
        const dotStyle = ['square', 'rounded', 'dots'].includes(state.qrStyle.dotStyle) ? state.qrStyle.dotStyle : 'square';
        for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) {
          const x0 = Math.round((col + margin) / total * size), x1 = Math.round((col + margin + 1) / total * size);
          const y0 = Math.round((row + margin) / total * size), y1 = Math.round((row + margin + 1) / total * size);
          const width = x1 - x0, height = y1 - y0;
          const finder = (row < 8 && col < 8) || (row < 8 && col >= count - 8) || (row >= count - 8 && col < 8);
          if (!finder && dotStyle === 'dots') { context.beginPath(); context.arc((x0 + x1) / 2, (y0 + y1) / 2, Math.max(1, Math.min(width, height) * 0.34), 0, Math.PI * 2); context.fill(); }
          else if (!finder && dotStyle === 'rounded' && typeof context.roundRect === 'function') { context.beginPath(); context.roundRect(x0, y0, width, height, Math.min(width, height) * 0.22); context.fill(); }
          else context.fillRect(x0, y0, width, height);
        }
      } catch (_) { /* The preview is optional if the QR library is unavailable. */ }
    }
    function renderStepThree() {
      const p = state.profileData; const theme = p.theme;
      return `<div class="wizard-intro"><span class="wizard-step-kicker">ÉTAPE 3 SUR 4 · APPARENCE</span><h3>Choisissez votre style</h3><p>Les couleurs, la disposition et les textes s’appliquent à la page ouverte après le scan. Le dessin du QR se règle séparément.</p></div>
        <div class="wizard-layout"><div class="wizard-form-column"><div class="wizard-form-section"><h4>Palettes harmonieuses</h4><div class="wizard-palette-grid">${Templates.palettes.map((palette) => `<button type="button" class="wizard-palette${theme.paletteId === palette.id ? ' is-selected' : ''}" data-palette-id="${esc(palette.id)}"><span><i aria-hidden="true"></i></span><strong>${esc(palette.label)}</strong></button>`).join('')}</div><p class="wizard-help">Vous pouvez modifier chaque couleur ci-dessous. Un contraste minimum est vérifié avant l’enregistrement.</p></div>
          <div class="wizard-form-section"><h4>Couleurs de la page</h4><div class="wizard-color-grid">${[['primary','Couleur principale'],['secondary','Couleur secondaire'],['button','Boutons'],['background','Fond de page'],['surface','Cartes et encadrés'],['text','Textes']].map(([key,label]) => `<label>${label}<input type="color" data-theme-field="${key}" value="${safeHex(theme[key], '#ffffff')}"></label>`).join('')}</div></div>
          <div class="wizard-form-section"><h4>Présentation</h4><div class="wizard-fields"><label class="wizard-field">Style<select data-theme-field="style">${[['modern','Moderne'],['elegant','Élégant'],['minimal','Minimaliste'],['professional','Professionnel'],['luxury','Luxueux'],['colorful','Coloré'],['classic','Classique']].map(([value,label]) => `<option value="${value}"${theme.style === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="wizard-field">Disposition<select data-theme-field="layout">${[['cover','Grande photo de couverture'],['logo','Logo en haut'],['cards','Sections en cartes'],['catalog','Catalogue en grille'],['tabs','Catégories à onglets']].map(([value,label]) => `<option value="${value}"${theme.layout === value ? ' selected' : ''}>${label}</option>`).join('')}</select></label><label class="wizard-field">Police<select data-theme-field="font"><option value="system"${theme.font === 'system' ? ' selected' : ''}>Simple et lisible</option><option value="serif"${theme.font === 'serif' ? ' selected' : ''}>Élégante (sérif)</option><option value="rounded"${theme.font === 'rounded' ? ' selected' : ''}>Arrondie</option></select></label><label class="wizard-field">Taille du texte<select data-theme-field="textSize"><option value="small"${theme.textSize === 'small' ? ' selected' : ''}>Petite</option><option value="normal"${theme.textSize === 'normal' ? ' selected' : ''}>Normale</option><option value="large"${theme.textSize === 'large' ? ' selected' : ''}>Grande</option></select></label><label class="wizard-field">Alignement<select data-theme-field="align"><option value="left"${theme.align === 'left' ? ' selected' : ''}>À gauche</option><option value="center"${theme.align === 'center' ? ' selected' : ''}>Centré</option></select></label></div></div>
          <div class="wizard-form-section"><h4>Dessin du QR code (distinct de la page)</h4><div class="wizard-fields"><label class="wizard-field">Modules QR<input type="color" data-qr-style="foreground" value="${safeHex(state.qrStyle.foreground, '#111111')}"></label><label class="wizard-field">Fond du QR<input type="color" data-qr-style="background" value="${safeHex(state.qrStyle.background, '#FFFFFF')}"></label><label class="wizard-field">Forme des points<select data-qr-style="dotStyle"><option value="square"${state.qrStyle.dotStyle === 'square' ? ' selected' : ''}>Carrés classiques (recommandé)</option><option value="rounded"${state.qrStyle.dotStyle === 'rounded' ? ' selected' : ''}>Arrondis</option><option value="dots"${state.qrStyle.dotStyle === 'dots' ? ' selected' : ''}>Points</option></select></label><label class="wizard-field">Correction d’erreur<select data-qr-style="correction"><option value="M"${state.qrStyle.correction === 'M' ? ' selected' : ''}>Moyenne (recommandée)</option><option value="Q"${state.qrStyle.correction === 'Q' ? ' selected' : ''}>Élevée</option><option value="H"${state.qrStyle.correction === 'H' ? ' selected' : ''}>Maximale</option></select></label></div><div id="wizardQrContrast" class="wizard-contrast-note"></div><p class="wizard-help">Les formes personnalisées sont limitées aux modules afin de préserver les repères de lecture. Le QR garde une marge claire pour le scan.</p><div class="wizard-qr-sample"><canvas id="wizardQrDesignPreview" width="240" height="240" aria-label="Aperçu visuel du style du QR"></canvas><p><strong>Aperçu du dessin et des couleurs.</strong><br>QR d’exemple temporaire — ne pas imprimer ni distribuer. Le vrai QR aura son adresse unique après validation.</p></div></div>
          <div class="wizard-form-section"><label class="wizard-field">Destination<select data-qr-field="destinationType"><option value="page"${state.destinationType === 'page' ? ' selected' : ''}>Page Oymike QR modifiable (dynamique)</option><option value="redirect"${state.destinationType === 'redirect' ? ' selected' : ''}>Redirection directe vers un site externe</option></select></label><div class="wizard-pricing-note">La page modifiable garde la même adresse QR lorsque vous changez les textes, images, couleurs ou produits.</div></div>
        </div><aside class="wizard-preview-aside"><span class="wizard-step-kicker">APERÇU EN DIRECT</span><h4>La page suit vos réglages</h4><div id="wizardInlinePreview"></div></aside></div>`;
    }
    function renderStepFour() {
      const p = state.profileData; const qrContrast = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);
      const pageContrast = contrastRatio(p.theme.text, p.theme.background); const buttonContrast = contrastRatio('#FFFFFF', p.theme.button);
      const controlledStatus = state.code && ['suspended', 'inactive', 'rejected'].includes(state.code.status);
      const statusReview = controlledStatus ? `Statut ${state.code.status === 'rejected' ? 'refusé' : 'suspendu'} contrôlé par le PDG — conservé` : state.saveMode === 'draft' ? 'Brouillon — non public' : 'Actif après confirmation';
      return `<div class="wizard-intro"><span class="wizard-step-kicker">ÉTAPE 4 SUR 4 · VÉRIFICATION</span><h3>Aperçu avant validation</h3><p>Vérifiez la page sur téléphone et ordinateur. Rien ne sera publié avant votre action finale.</p></div>
        <div class="wizard-preview-actions"><button type="button" data-wizard-action="reset-theme">Recommencer la personnalisation</button><span>Page dynamique · le lien imprimé restera stable</span></div><div id="wizardFullPreview"></div><div class="wizard-qr-sample"><canvas id="wizardQrDesignPreview" width="240" height="240" aria-label="Aperçu visuel du style du QR"></canvas><p><strong>Votre style de QR.</strong><br>Motif d’exemple temporaire. Ne l’imprimez pas : le code final sera créé après votre confirmation.</p></div>
        <div class="wizard-review-grid"><div><strong>Modèle</strong><span>${esc(state.template?.label || '')}</span></div><div><strong>Bénéficiaire</strong><span>${state.beneficiaryMode === 'new' ? 'Nouveau bénéficiaire' : esc(state.beneficiaries.find((item) => item.id === state.beneficiaryId)?.name || 'À choisir')}</span></div><div><strong>Statut après validation</strong><span>${esc(statusReview)}</span></div><div><strong>Contraste QR</strong><span>${qrContrast.toFixed(1)}:1 ${qrContrast >= 4.5 ? '· lisible' : '· insuffisant'}</span></div><div><strong>Contraste de lecture</strong><span>${Math.min(pageContrast, buttonContrast).toFixed(1)}:1 ${pageContrast >= 4.5 && buttonContrast >= 4.5 ? '· conforme' : '· à corriger'}</span></div></div>
        ${state.destinationType === 'redirect' ? '<div class="wizard-pricing-note">Cette destination est une redirection directe; aucune page de profil ne sera affichée. Pour conserver une page modifiable, choisissez « Page Oymike QR ».</div>' : ''}
        <div class="wizard-final-confirm"><label><input type="checkbox" id="wizardConfirmPublish"> J’ai vérifié les informations et je confirme ${state.codeId ? 'la modification' : 'la création'} de ce QR.</label><small>Le bouton choisi enregistre soit un brouillon non public, soit un QR actif. La page restera modifiable sans changer l’adresse imprimée.</small></div>`;
    }
    function renderStep() {
      const content = state.step === 1 ? renderStepOne() : state.step === 2 ? renderStepTwo() : state.step === 3 ? renderStepThree() : renderStepFour();
      const qrContrast = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);
      const pageContrast = contrastRatio(state.profileData?.theme?.text || '#18342B', state.profileData?.theme?.background || '#F6FBF8');
      const buttonContrast = contrastRatio('#FFFFFF', state.profileData?.theme?.button || '#176B52');
      const controlledStatus = state.code && ['suspended', 'inactive', 'rejected'].includes(state.code.status);
      const stepTitles = ['Modèle', 'Informations', 'Apparence', 'Aperçu'];
      rootElement.hidden = false;
      rootElement.innerHTML = `<article class="modal-card wizard-card qr-wizard" role="dialog" aria-modal="true" aria-labelledby="wizardTitle"><header class="modal-header wizard-header"><div><span class="eyebrow">OYMIKE QR · STUDIO</span><h2 id="wizardTitle">${state.codeId ? 'Modifier la présentation' : 'Créer un QR code'}</h2><p>Simple, guidé et modifiable après impression.</p></div><button class="modal-close" type="button" data-wizard-action="close" aria-label="Fermer">×</button></header><nav class="wizard-progress" aria-label="Étapes de création">${stepTitles.map((title, index) => `<span class="wizard-progress-step${state.step === index + 1 ? ' is-active' : ''}${state.step > index + 1 ? ' is-done' : ''}"><i>${state.step > index + 1 ? '✓' : index + 1}</i>${title}</span>`).join('')}</nav><div class="wizard-body">${content}${state.error ? `<div class="wizard-error" role="alert">${esc(state.error)}</div>` : ''}</div><footer class="modal-footer wizard-footer"><span class="modal-footer-note">${state.step === 4 ? 'La validation est une action volontaire.' : `Étape ${state.step} sur 4`}</span><div class="modal-footer-actions">${state.step > 1 ? '<button type="button" class="button button-secondary" data-wizard-action="back">← Précédent</button>' : '<button type="button" class="button button-secondary" data-wizard-action="close">Annuler</button>'}${state.step < 4 ? `<button type="button" class="button button-primary" data-wizard-action="next"${(state.step === 1 && !state.template) ? ' disabled' : ''}>${state.step === 3 ? 'Aperçu avant validation' : 'Continuer'} →</button>` : `${controlledStatus ? '' : `<button type="button" class="button button-secondary" data-wizard-action="save-draft"${state.saving ? ' disabled' : ''}>Enregistrer comme brouillon</button>`}<button type="button" class="button button-primary" data-wizard-action="publish"${state.saving || qrContrast < 4.5 || pageContrast < 4.5 || buttonContrast < 4.5 ? ' disabled' : ''}>${state.codeId ? controlledStatus ? 'Enregistrer les changements · statut conservé' : 'Enregistrer les changements' : 'Valider et créer le QR'}</button>`}</div></footer></article>`;
      if (state.step === 2) renderPreview($('#wizardInlinePreview', rootElement), true);
      if (state.step === 3) { renderPreview($('#wizardInlinePreview', rootElement), true); updateQrContrast(); renderQrDesignPreview(); }
      if (state.step === 4) { renderPreview($('#wizardFullPreview', rootElement), false); renderQrDesignPreview(); }
    }
    function updateQrContrast() {
      const qrNote = $('#wizardQrContrast', rootElement); if (!qrNote) return;
      const qr = contrastRatio(state.qrStyle.foreground, state.qrStyle.background);
      const text = contrastRatio(state.profileData.theme.text, state.profileData.theme.background);
      const button = contrastRatio('#FFFFFF', state.profileData.theme.button);
      qrNote.className = `wizard-contrast-note${qr < 4.5 || text < 4.5 || button < 4.5 ? ' is-warning' : ''}`;
      qrNote.textContent = qr < 4.5 ? `Contraste du QR ${qr.toFixed(1)}:1 : trop faible. Assombrissez les modules ou éclaircissez le fond.`
        : text < 4.5 || button < 4.5 ? 'Le contraste des textes ou boutons de la page est insuffisant; changez la couleur avant d’enregistrer.' : `Contraste QR ${qr.toFixed(1)}:1 — le minimum 4,5:1 est respecté.`;
      const publish = $('[data-wizard-action="publish"]', rootElement);
      if (publish) publish.disabled = state.saving || qr < 4.5 || text < 4.5 || button < 4.5;
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
      const textContrast = contrastRatio(p.theme.text, p.theme.background);
      const buttonContrast = contrastRatio('#FFFFFF', p.theme.button);
      if (qrContrast < 4.5) throw new Error('Le contraste du QR est insuffisant. Le serveur refusera cette combinaison pour protéger la lisibilité.');
      if (textContrast < 4.5 || buttonContrast < 4.5) throw new Error('Le contraste du texte ou des boutons est insuffisant. Choisissez une palette plus lisible.');
      const qrName = String(state.qrName || '').trim() || `${p.entityName} — ${template.label}`;
      return {
        name: qrName.slice(0, 120), beneficiaryId: state.beneficiaryId, categoryId: state.categoryId || template.categoryId,
        purpose: template.purpose || 'other', destinationType: state.destinationType, targetUrl: state.targetUrl,
        title: String(state.qrTitle || p.entityName).trim().slice(0, 140), description: String(state.qrDescription || p.subtitle || '').trim().slice(0, 800),
        contentText: String(state.qrContentText || '').trim().slice(0, 5000), extraLinks: [], selectedFields: ['logo','phone','whatsapp','email','address','locationUrl','website','socials','bio','offers','documents'],
        selectedPhotoIds: [], photos: state.photos.map((photo, index) => ({ ...photo, sortOrder: index, isPrimary: photo.isPrimary === true })),
        profileData: { ...p, templateId: template.id, kind: template.kind, templateLabel: template.label },
        style: { ...state.qrStyle, textSize: 'default' }, saveMode: state.saveMode,
      };
    }
    async function ensureBeneficiary(payload) {
      if (state.beneficiaryMode === 'existing') return state.beneficiaryId;
      if (state.createdBeneficiaryId) return state.createdBeneficiaryId;
      const p = state.profileData; const template = state.template;
      const beneficiary = {
        type: existingType(template.beneficiaryType), name: p.entityName, logo: p.logo || '', photos: [], phone: p.phone || '', whatsapp: p.whatsapp || '',
        email: p.email || '', address: [p.address, p.city].filter(Boolean).join(', '), locationUrl: p.mapUrl || '', website: p.website || '',
        bio: p.description || p.subtitle || '', socials: p.socials || [], offers: (p.items || []).slice(0, 60).map((item) => ({ name: item.name, description: item.description || '', price: item.priceXof == null ? '' : `${item.priceXof} FCFA`, url: '' })), documents: p.documents || [],
      };
      const result = await api(`${apiBase}/beneficiaries`, { method: 'POST', body: JSON.stringify(beneficiary) });
      state.createdBeneficiaryId = result.data.id; state.beneficiaryId = result.data.id;
      const select = $('#wizardBeneficiary', rootElement); if (select) select.value = result.data.id;
      return result.data.id;
    }
    async function save(mode) {
      if (state.saving) return;
      syncFields(); collectItemDraft();
      state.saveMode = mode === 'draft' ? 'draft' : 'publish';
      const confirm = $('#wizardConfirmPublish', rootElement);
      if (!confirm?.checked) { state.error = 'Confirmez la création ou la modification avant de poursuivre.'; renderStep(); return; }
      try {
        let payload = readPayload();
        const submit = $('[data-wizard-action="publish"], [data-wizard-action="save-draft"]', rootElement);
        if (submit) submit.disabled = true;
        state.saving = true; state.error = ''; rootElement.setAttribute('aria-busy', 'true');
        payload.beneficiaryId = await ensureBeneficiary(payload);
        if (role === 'manager' && !state.codeId) {
          const beneficiary = state.beneficiaries.find((item) => item.id === payload.beneficiaryId);
          const customerType = ({ individual: 'individual', business: 'business', commerce: 'business', organization: 'business', other: 'custom' })[beneficiary?.type || state.template.beneficiaryType] || 'custom';
          payload.customerType = customerType;
          payload.pricingPlanId = state.selectedPlanId || '';
          payload.optionIds = state.selectedOptionIds;
          payload.createOrder = Boolean(state.selectedPlanId);
          payload.paymentMethod = 'cash';
          payload.clientRequestId = state.clientRequestId;
          payload.clientName = state.profileData.entityName;
          payload.companyName = customerType === 'business' ? state.profileData.entityName : '';
        }
        const isEdit = Boolean(state.codeId);
        const result = await api(isEdit ? `${apiBase}/codes/${encodeURIComponent(state.codeId)}` : `${apiBase}/codes`, {
          method: isEdit ? 'PUT' : 'POST', body: JSON.stringify(payload),
        });
        rootElement.removeAttribute('aria-busy');
        close();
        await options.onSaved?.(result, isEdit, mode);
      } catch (error) {
        state.saving = false; rootElement.removeAttribute('aria-busy'); state.error = error.message || 'Impossible d’enregistrer ce QR. Vérifiez les informations et réessayez.'; renderStep();
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
          if (palette) state.profileData.theme = { ...state.profileData.theme, ...palette, paletteId: palette.id, style: state.profileData.theme.style, layout: state.profileData.theme.layout, font: state.profileData.theme.font, textSize: state.profileData.theme.textSize, align: state.profileData.theme.align };
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
          case 'preview-phone': syncFields(); state.phonePreview = true; renderStep(); break;
          case 'preview-desktop': syncFields(); state.phonePreview = false; renderStep(); break;
          case 'reset-theme': state.profileData.theme = defaultTheme(state.template); state.qrStyle = { foreground: '#111111', background: '#FFFFFF', correction: 'M', textSize: 'default', dotStyle: 'square' }; renderStep(); break;
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
        if (event.target.matches('[data-profile-field],[data-theme-field],[data-qr-field],[data-qr-style]') || event.target.id === 'wizardSocials' || event.target.id === 'wizardDocuments') {
          syncFields();
          if (event.target.dataset.qrStyle) state.qrStyle[event.target.dataset.qrStyle] = event.target.value;
          if (event.target.matches('[data-theme-field]') && event.target.type === 'color') { state.profileData.theme.paletteId = 'custom'; rootElement.querySelectorAll('[data-palette-id]').forEach((button) => button.classList.remove('is-selected')); }
          if (state.step === 2) renderPreview($('#wizardInlinePreview', rootElement), true);
          if (state.step === 3) { renderPreview($('#wizardInlinePreview', rootElement), true); updateQrContrast(); renderQrDesignPreview(); }
          if (state.step === 4) renderPreview($('#wizardFullPreview', rootElement), false);
          if (event.target.dataset.profileField === 'entityName' && !state.qrNameTouched && !state.code) { state.qrName = `${event.target.value} — ${state.template?.label || ''}`.trim().slice(0, 120); const nameInput = $('[data-qr-field="qrName"]', rootElement); if (nameInput) nameInput.value = state.qrName; }
        }
      },
      change: async (event) => {
        const target = event.target;
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
        if (target.matches('[data-theme-field]')) { syncFields(); if (target.type === 'color') { state.profileData.theme.paletteId = 'custom'; rootElement.querySelectorAll('[data-palette-id]').forEach((button) => button.classList.remove('is-selected')); } renderPreview($('#wizardInlinePreview', rootElement), true); if (state.step === 3) updateQrContrast(); }
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
      if (state.codeId) {
        const result = options.initialCode ? { data: options.initialCode } : await api(`${apiBase}/codes/${encodeURIComponent(state.codeId)}`); state.code = result.data;
        const code = result.data; state.beneficiaryId = code.beneficiaryId; state.categoryId = code.categoryId || '';
        state.qrName = code.name || ''; state.qrTitle = code.title || ''; state.qrDescription = code.description || ''; state.qrContentText = code.contentText || '';
        state.destinationType = code.destinationType || 'page'; state.targetUrl = code.targetUrl || ''; state.photos = Array.isArray(code.photos) ? code.photos.map((photo) => ({ ...photo })) : [];
        state.qrStyle = { ...state.qrStyle, ...(code.style || {}) }; state.saveMode = code.status === 'draft' ? 'draft' : 'publish';
        const existing = code.profileData || {};
        setDefaultTemplate(existing.templateId || 'personnalise');
        state.profileData = { ...state.profileData, ...existing, theme: { ...defaultTheme(state.template), ...(existing.theme || {}) }, items: Array.isArray(existing.items) ? existing.items : [] };
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
