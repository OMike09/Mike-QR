(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { merchant: null, store: null, products: [], orders: [], stats: {}, activeTab: 'home', toastTimer: 0, searchTimer: 0, eventSource: null, pollTimer: 0, deepLinkOrderId: '', productImages: [], uploadedMedia: new Set(), pendingUploads: 0, notifications: [], unreadCount: 0, seenOrderEvents: new Set(), serviceWorkerRegistration: null, pushConfig: null, pushConfigLoaded: false, ads: [], servicePoints: [], rewardCampaigns: [], rewardClaims: [], giftCards: [], customerBlocks: [], blockSearchTimer: 0, blockSubmitInProgress: false, advancedLoaded: false, advancedRequest: null, assistedProducts: [], assistedPoints: [], assistedStore: null, assistedCart: new Map(), assistedContextLoaded: false, assistedRequestInProgress: false, assistedReceiptData: null, scanState: { code: '', via: '', eventId: '', label: '' }, activation: null, scanStats: null, scanPeriod: '30',
    catalog: { models: [], categories: [], domains: [], selected: new Set(), units: [], volumes: [], activitiesLoaded: false } };
  const loginView = $('#loginView'); const passwordView = $('#passwordView'); const appView = $('#appView');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const dateTime = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const statusLabels = { pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', out_for_delivery: 'En livraison', completed: 'Terminée / livrée', cancelled: 'Annulée', rejected: 'Refusée par la boutique' };
  const SERVICE_POINT_TYPE_LABELS = Object.freeze({ table:'Table', counter:'Comptoir', location:'Emplacement', salon:'Salon' });
  const servicePointTypeLabel = (type) => SERVICE_POINT_TYPE_LABELS[type] || 'Emplacement';
  const transitions = { pending: [['confirmed', 'Confirmer'], ['rejected', 'Refuser'], ['cancelled', 'Annuler']], confirmed: [['preparing', 'Préparer'], ['rejected', 'Refuser'], ['cancelled', 'Annuler']], preparing: [['ready', 'Marquer prête'], ['rejected', 'Refuser'], ['cancelled', 'Annuler']], ready: [['out_for_delivery', 'En livraison'], ['completed', 'Terminer'], ['cancelled', 'Annuler']], out_for_delivery: [['completed', 'Livrée / terminée'], ['cancelled', 'Annuler']], completed: [], cancelled: [], rejected: [] };

  async function api(url, options = {}) {
    let response;
    try { response = await fetch(url, { credentials: 'same-origin', ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } }); }
    catch (error) { if (!navigator.onLine) { const message = 'Vous êtes hors ligne. Les informations sont conservées sur le serveur; reconnectez-vous pour synchroniser.'; if (!appView.hidden) setNotice(message); throw new Error(message); } throw error; }
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) { if (data.code === 'TEMP_PASSWORD_EXPIRED') showLogin(data.error); else showLogin(data.error || 'Votre session a expiré. Reconnectez-vous.'); throw new Error(data.error || 'Session expirée.'); }
    if (response.status === 403 && data.code === 'PASSWORD_CHANGE_REQUIRED') { showPasswordGate(); throw new Error(data.error); }
    if (!response.ok) { const failure = new Error(data.error || `Erreur ${response.status}`); failure.status = response.status; failure.code = data.code || ''; failure.data = data; throw failure; }
    return data;
  }
  function toast(message) { const node = $('#toast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3200); }
  function showLogin(message = '') { closeEvents(); loginView.hidden = false; passwordView.hidden = true; appView.hidden = true; $('#loginPassword').value = ''; const error = $('#loginError'); error.textContent = message; error.hidden = !message; }
  function showPasswordGate() { loginView.hidden = true; passwordView.hidden = false; appView.hidden = true; $('#newPassword').value = ''; $('#confirmPassword').value = ''; $('#passwordError').hidden = true; }
  function showApp(merchant) {
    state.merchant = merchant; loginView.hidden = true; passwordView.hidden = true; appView.hidden = false;
    restoreAdvancedDrafts(); renderAdPreview(); const draftAdImage=$('#adImageUrl').value;if(draftAdImage){$('#adImagePreview').src=privateMediaUrl(draftAdImage);$('#adImagePreview').hidden=false;$('#removeAdImage').hidden=false;} $('#merchantName').textContent = merchant.displayName || 'Marchand'; $('#merchantUsername').textContent = `@${merchant.username || ''}`;
    window.WorkspaceUI?.setGreeting(merchant.displayName || '');
    // §4.6 : compteur « Commandes – N nouvelles » dès l'ouverture de la session, sur toutes les pages.
    window.WorkspaceUI?.refreshOrderCounter?.();
    // Tailles décidées par le PDG, reçues avec la session : appliquées dès la première image.
    if (merchant.interfaceSizes) window.WorkspaceUI?.applyTypography(merchant.interfaceSizes);
    else api('/api/merchant/interface').then((result) => window.WorkspaceUI?.applyTypography(result.data?.sizes)).catch(() => {});
    // Mission 11 : thème d'apparence (marchand ou imposé par le PDG), posé dès l'ouverture.
    if (merchant.interfaceTheme) window.WorkspaceShell?.applyTheme(merchant.interfaceTheme);
    // Mission 15 : personnalisation globale du PDG (couleurs, polices, tailles).
    if (merchant.interfaceCustom) window.WorkspaceShell?.syncCustom?.(merchant.interfaceCustom);
    else window.WorkspaceShell?.syncCustom?.(null);
    // Si la session a été obtenue par /auth/me (pas par la connexion), la personnalisation arrive
    // parfois après l'affichage : on la récupère explicitement pour éviter un premier écran
    // aux couleurs par défaut, puis un saut visuel dès qu'on change de page.
    if (merchant.interfaceCustom === undefined) {
      api('/api/merchant/interface-appearance').then((result) => {
        if (result?.data?.custom) window.WorkspaceShell?.syncCustom?.(result.data.custom);
      }).catch(() => {});
    }
    document.body.dataset.wsApp = 'true';
    // Les modules chargés en parallèle (messagerie, opérations) attendent ce signal.
    document.dispatchEvent(new CustomEvent('workspace:session', { detail: { merchant } }));
  }
  function setNotice(message, visible = true) { const node = $('#notice'); node.textContent = message; node.hidden = !visible; }
  function tab(name) {
    state.activeTab = name;
    // Changer d'onglet repart du haut : aucun contenu ne reste masqué sous la barre d'onglets.
    try { window.scrollTo({ top: 0, behavior: 'auto' }); } catch (_) { window.scrollTo(0, 0); }
    // Mission 10 : le menu est regroupé en rubriques ; WorkspaceUI range les panneaux.
    if (window.WorkspaceUI) window.WorkspaceUI.openTab(name, false);
    $$('.tab').forEach((node) => node.classList.toggle('active', node.dataset.tab === name));
    // « overview » (bouton « Vue d'ensemble ») affiche le panneau d'accueil historique : c'est lui
    // qui porte les chiffres détaillés. Sans cette correspondance, aucune cible ne correspondait et
    // tous les panneaux restaient masqués (écran vide après le clic).
    // Mission 14 : une seule règle de correspondance pour toute l'application (workspace-ui.js).
    const panelId = window.WorkspaceUI?.targetPanelFor?.(name)
      || (name === 'overview' ? 'panel-home'
        : (name === 'home' && document.getElementById('merchantHomeShell')) ? 'aucun-panneau'
        : `panel-${name}`);
    // Sélecteur élargi : les écrans peuvent être des .panel OU des .ws-hub, jamais les deux.
    $$('.tab-panel, .ws-hub').forEach((node) => { node.hidden = node.id !== panelId; });
    if (name === 'products') return loadProducts().catch((e) => toast(e.message));
    if (name === 'catalog') return loadCatalogTab().catch((e) => { const node = $('#catalogModelList'); if (node) node.innerHTML = `<p class="message error">${esc(e.message)}</p>`; });
    if (name === 'orders') return Promise.all([loadOrders(), loadCustomerBlocks()]).catch((e) => toast(e.message));
    if (name === 'assisted') return loadAssistedContext().catch((e) => showAssistedNotice(e.message, true));
    if (name === 'scans') return loadScansPanel().catch((e) => { const node = $('#scanKpis'); if (node) node.innerHTML = `<p class="message error">${esc(e.message)}</p>`; });
    if (name === 'notifications') { loadPushConfig(); return loadNotifications().catch((e) => toast(e.message)); }
    if (name === 'advanced' && !state.advancedLoaded) return loadAdvancedData().catch((e) => advancedMessage(e.message, true));
    if (name === 'account') return renderAccount().catch((e) => toast(e.message));
    // Mission 6 : vues opérationnelles rendues par merchant-ops.js depuis le serveur.
    if (name === 'ops') { window.MerchantOps?.openView('overview'); return Promise.resolve(); }
    if (name === 'ops-messages') { window.MerchantOps?.openView('messages'); return Promise.resolve(); }
    // Mission 7 : consignation de bouteilles et de monnaie (onglet dédié du menu principal).
    if (name === 'consignment') { window.MerchantConsign?.render(document.getElementById('consignRoot')); return Promise.resolve(); }
    // Mission 12 : la page « Gestion des tables et espaces » charge son contenu à l'ouverture.
    if (name === 'tables') { return Promise.resolve(window.MerchantTables?.open?.()); }
    // Mission 12 : « Mes comptes créés » se recharge à chaque ouverture de Mon équipe (la session
    // peut avoir été renouvelée après la première connexion).
    if (name === 'team') { return Promise.resolve(window.MemberAccounts?.load?.()); }
    return Promise.resolve();
  }
  // ---------------------------------------------------------------- mission 10 : espace de travail
  // Passerelle : le menu des rubriques demande l'ouverture d'un outil ; c'est la fonction tab()
  // existante qui garde la main (mêmes chargements, mêmes permissions).
  window.__wsOnTab = (name) => { tab(name).catch?.((error) => toast(error.message)); };
  window.__wsStatusLabels = statusLabels;
  // Scan depuis l'écran Scanner : même appel serveur que le scanner de la commande assistée.
  window.__wsScanRead = async (value, via = 'scanner') => {
    if (!window.WorkspaceUI) return;
    window.WorkspaceUI.scanMessage('Vérification du QR auprès du serveur…');
    try {
      window.QRMerchantScanner?.stop();
      const result = await api('/api/merchant/assisted-orders/scan', { method: 'POST', body: JSON.stringify({ code: value, eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) });
      const data = result.data || {};
      window.WorkspaceUI.scanMessage(data.message || 'QR reconnu.', false);
      window.WorkspaceUI.renderScanResult(data);
      state.scanState = { code: data.servicePoint?.publicCode || value, via, eventId: data.scanEventId || '', label: data.servicePoint?.name || 'QR de boutique' };
      if (data.servicePoint) { if (!state.assistedPoints.some((row) => row.id === data.servicePoint.id)) state.assistedPoints.push({ ...data.servicePoint, status: 'active' }); }
      state.assistedContextLoaded = false;
      // Traçabilité : la table reconnue reste sélectionnée dans le formulaire de commande, pour
      // que la commande enregistrée porte bien la table et le QR réellement scannés.
      window.__wsScannedPoint = data.servicePoint?.id || '';
      if (data.servicePoint) {
        window.__wsPendingScanPoint = data.servicePoint.id;
        const select = $('#assistedServicePoint');
        if (select) {
          if (![...select.options].some((option) => option.value === data.servicePoint.id)) {
            select.insertAdjacentHTML('beforeend', `<option value="${data.servicePoint.id}">${data.servicePoint.name}</option>`);
          }
          select.value = data.servicePoint.id;
        }
        const modes = $('#assistedOrderType');
        if (modes && !modes.value) modes.value = 'dine_in';
      }
      const manual = $('#wsScanManualInput'); if (manual) manual.value = '';
      // Mission 13 : l'accueil marchand a besoin de savoir si la lecture a réussi AVANT d'ouvrir la
      // commande assistée. On publie le résultat (aucune donnée nouvelle, la même que ci-dessus).
      window.__wsLastScan = { ok: true, at: Date.now(), message: data.message || 'QR reconnu.', point: data.servicePoint || null };
    } catch (error) {
      const messages = { QR_OTHER_STORE: 'Ce QR appartient à une autre boutique.', QR_INVALID: 'Ce QR est invalide, désactivé ou n’existe plus. Vérifiez le code ou choisissez la table manuellement.' };
      window.WorkspaceUI.scanMessage(messages[error.code] || error.message, true);
      window.__wsScannedPoint = '';
      window.__wsLastScan = { ok: false, at: Date.now(), message: messages[error.code] || error.message, point: null };
    }
  };

  function mediaId(url) { return /^\/media\/merchant\/([0-9a-f-]{36})$/i.exec(String(url || ''))?.[1] || ''; }
  function privateMediaUrl(url) { const id = mediaId(url); return id ? `/api/merchant/media/${id}` : String(url || ''); }
  function updateMediaStatus(id, message, kind = '') { const node = $(`#${id}`); if (!node) return; node.textContent = message; node.classList.toggle('is-error', kind === 'error'); node.classList.toggle('is-pending', kind === 'pending'); }
  function attachStoreLogo(source, preview = '') {
    const image = $('#storeLogoPreview'); const fallback = $('#storeLogoFallback');
    $('#storeLogoData').value = source || '';
    if (source) { image.src = preview || privateMediaUrl(source); image.hidden = false; fallback.hidden = true; }
    else { image.removeAttribute('src'); image.hidden = true; fallback.hidden = false; }
  }
  function attachStoreCover(source, preview = '') {
    const image = $('#storeCoverPreview'); const fallback = $('#storeCoverFallback');
    $('#storeCoverData').value = source || '';
    if (source) { image.src = preview || privateMediaUrl(source); image.hidden = false; fallback.hidden = true; }
    else { image.removeAttribute('src'); image.hidden = true; fallback.hidden = false; }
  }
  function renderProductImages() {
    const root = $('#productImageGallery'); if (!root) return;
    $('#productImageUrls').value = JSON.stringify(state.productImages.map((item) => item.url));
    $('#productImageData').value = state.productImages[0]?.url || '';
    // The first photo of the list is the product's main image on the public page; the merchant can reorder it here.
    root.innerHTML = state.productImages.map((item, index) => `<figure class="product-image-item${index === 0 ? ' is-main' : ''}"><img src="${esc(item.preview || privateMediaUrl(item.url))}" alt="Photo ${index + 1} du produit"><button type="button" class="product-image-remove" data-remove-product-image="${index}" aria-label="Supprimer la photo ${index + 1}">×</button>${index === 0 ? '<span class="product-image-main-tag">Image principale</span>' : `<button type="button" class="product-image-main" data-set-main-image="${index}" aria-label="Utiliser la photo ${index + 1} comme image principale">Définir comme principale</button>`}<div class="product-image-order"><button type="button" data-move-image="${index}" data-move-delta="-1" ${index === 0 ? 'disabled' : ''} aria-label="Déplacer la photo ${index + 1} vers la gauche">←</button><button type="button" data-move-image="${index}" data-move-delta="1" ${index === state.productImages.length - 1 ? 'disabled' : ''} aria-label="Déplacer la photo ${index + 1} vers la droite">→</button></div><figcaption>Photo ${index + 1}${index === 0 ? ' · principale' : ''}</figcaption></figure>`).join('') || '<div class="product-image-empty">Aucun aperçu sélectionné</div>';
    $$('[data-remove-product-image]', root).forEach((button) => button.addEventListener('click', () => {
      const [removed] = state.productImages.splice(Number(button.dataset.removeProductImage), 1); renderProductImages();
      if (removed && state.uploadedMedia.has(removed.url)) discardUnusedMedia(removed.url);
      updateMediaStatus('productImageStatus', 'Photo retirée de la sélection. Enregistrez le produit pour confirmer la suppression.');
    }));
    $$('[data-set-main-image]', root).forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.setMainImage); if (index < 1 || index >= state.productImages.length) return;
      const [chosen] = state.productImages.splice(index, 1); state.productImages.unshift(chosen); renderProductImages();
      updateMediaStatus('productImageStatus', 'Image principale modifiée. Enregistrez le produit pour l’appliquer au catalogue public.');
    }));
    $$('[data-move-image]', root).forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.moveImage); const target = index + Number(button.dataset.moveDelta);
      if (target < 0 || target >= state.productImages.length) return;
      const [moved] = state.productImages.splice(index, 1); state.productImages.splice(target, 0, moved); renderProductImages();
      updateMediaStatus('productImageStatus', 'Ordre des photos mis à jour. Enregistrez le produit pour confirmer.');
    }));
  }
  function updateUploadButtons() {
    for (const id of ['storeForm', 'productForm', 'adForm']) { const button = $(`button[type="submit"]`, $(`#${id}`)); if (button) button.disabled = state.pendingUploads > 0; }
  }
  function validateSelectedFile(file) {
    const type = String(file?.type || '').toLowerCase(); const ext = String(file?.name || '').split('.').pop().toLowerCase();
    const allowed = ['image/jpeg','image/png','image/webp']; const allowedExt = ['jpg','jpeg','png','webp'];
    if ((!allowed.includes(type) && !(!type && allowedExt.includes(ext))) || (type && !allowed.includes(type))) throw new Error('Format non accepté. Choisissez JPG, JPEG, PNG ou WEBP.');
    if (file.size > 15 * 1024 * 1024) throw new Error('Fichier trop volumineux. Choisissez une photo de moins de 15 Mo.');
  }
  async function compressImage(file) {
    validateSelectedFile(file);
    const image = typeof createImageBitmap === 'function' ? await createImageBitmap(file) : await new Promise((resolve, reject) => {
      const element = new Image(); const url = URL.createObjectURL(file); element.onload = () => { URL.revokeObjectURL(url); resolve(element); }; element.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Impossible de lire cette image. Vérifiez le fichier.')); }; element.src = url;
    });
    try {
      let width = image.width; let height = image.height; const maxEdge = 1800;
      if (!width || !height) throw new Error('Image vide ou illisible.');
      if (Math.max(width, height) > maxEdge) { const scale = maxEdge / Math.max(width, height); width = Math.round(width * scale); height = Math.round(height * scale); }
      const canvas = document.createElement('canvas'); const context = canvas.getContext('2d'); if (!context) throw new Error('Le navigateur ne peut pas traiter cette image.');
      for (let attempt = 0; attempt < 10; attempt += 1) {
        canvas.width = width; canvas.height = height; context.clearRect(0, 0, width, height); context.drawImage(image, 0, 0, width, height);
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', Math.max(.38, .86 - attempt * .055)));
        if (!blob) throw new Error('Impossible de compresser cette image. Essayez un autre fichier.');
        if (blob.size <= 340 * 1024) return await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error('Impossible de lire le fichier compressé.')); reader.readAsDataURL(blob); });
        width = Math.max(240, Math.round(width * .78)); height = Math.max(240, Math.round(height * .78));
      }
      throw new Error('L’image dépasse la limite de stockage après compression. Choisissez une photo plus légère.');
    } finally { if (typeof image.close === 'function') image.close(); }
  }
  async function uploadImage(file, purpose, statusId) {
    state.pendingUploads += 1; updateUploadButtons(); updateMediaStatus(statusId, 'Compression et envoi sécurisés…', 'pending');
    try {
      const dataUrl = await compressImage(file);
      const response = await api('/api/merchant/media', { method: 'POST', body: JSON.stringify({ dataUrl, purpose }) });
      const media = response.data; if (!media?.url || !mediaId(media.url)) throw new Error('Le serveur n’a pas confirmé l’enregistrement de l’image. Réessayez.');
      state.uploadedMedia.add(media.url); updateMediaStatus(statusId, 'Image ajoutée et enregistrée. Enregistrez le formulaire pour la publier.', 'success');
      return { url: media.url, preview: dataUrl };
    } catch (error) { updateMediaStatus(statusId, error.message || 'Échec de l’envoi de l’image.', 'error'); throw error; }
    finally { state.pendingUploads = Math.max(0, state.pendingUploads - 1); updateUploadButtons(); }
  }
  async function discardUnusedMedia(url) {
    const id = mediaId(url); if (!id) return;
    try { const response = await fetch(`/api/merchant/media/${id}`, { method: 'DELETE', credentials: 'same-origin' }); if (response.ok) state.uploadedMedia.delete(url); } catch (_) {}
  }
  async function cleanupReplacedMedia(previous, next) {
    const keep = new Set(next || []);
    await Promise.all((previous || []).filter((url) => url && !keep.has(url)).map(async (url) => {
      const id = mediaId(url); if (!id) return;
      try { const response = await fetch(`/api/merchant/media/${id}`, { method: 'DELETE', credentials: 'same-origin' }); if (response.ok) state.uploadedMedia.delete(url); } catch (_) {}
    }));
  }
  async function chooseSingleImage(file, field) {
    if (!file) return;
    const status = field === 'logo' ? 'storeLogoStatus' : 'storeCoverStatus';
    try {
      const previous = field === 'logo' ? $('#storeLogoData').value : $('#storeCoverData').value;
      const image = await uploadImage(file, field, status);
      if (previous && previous !== image.url && state.uploadedMedia.has(previous)) await discardUnusedMedia(previous);
      if (field === 'logo') attachStoreLogo(image.url, image.preview); else attachStoreCover(image.url, image.preview);
      applyThemePreview();
    } catch (_) { /* status contains the actionable error */ }
  }
  async function chooseProductImages(files) {
    const selected = [...(files || [])]; if (!selected.length) return;
    const remaining = Math.max(0, 8 - state.productImages.length);
    if (selected.length > remaining) { updateMediaStatus('productImageStatus', `Maximum 8 photos par produit; ${remaining} emplacement(s) disponible(s).`, 'error'); selected.splice(remaining); }
    for (const file of selected) {
      try { const image = await uploadImage(file, 'product', 'productImageStatus'); state.productImages.push(image); renderProductImages(); }
      catch (_) { /* each failure is surfaced next to the field */ }
    }
  }
  function photoList(store) { return (store?.imageUrls?.length ? store.imageUrls : (store?.imageData ? [store.imageData] : [])); }

  const FONT_FAMILIES = ['Poppins','Montserrat','Roboto','Open Sans','Lato','Inter','Nunito','Raleway','Ubuntu','Oswald','Playfair Display','Merriweather','Source Sans 3','DM Sans','Manrope','Rubik','Work Sans','Lora','Libre Baskerville','Archivo'];
  const TYPOGRAPHY_TYPES = [['shopName','Nom de la boutique',30],['title','Titres',24],['subtitle','Sous-titres',18],['product','Produits',16],['price','Prix',17],['description','Descriptions',16],['category','Catégories',16],['button','Boutons',16],['advertisement','Publicités',16],['delivery','Livraison',16],['promotion','Promotions',16],['other','Autres textes importants',16]];
  const defaultTypography = Object.fromEntries(TYPOGRAPHY_TYPES.map(([key,size]) => [key,{size,weight:['shopName','title','price'].includes(key)?700:400,italic:false,decoration:'none',lineHeight:1.4,letterSpacing:0,align:'left',transform:'none',color:'#162622',opacity:1}]));
  const defaultTheme = { template: 'modern', colors: { primary: '#0d725c', secondary: '#d4af37', background: '#f3f7f4', text: '#162622', button: '#0d725c', card: '#ffffff' }, font: 'Inter', textSize: 'normal', typography: defaultTypography, buttonShape: 'rounded', cardShape: 'rounded', menuStyle: 'pills', productLayout: 'grid', sections: { description: true, categories: true, contact: true, hours: true, contacts: true }, sectionOrder: ['cover','intro','categories','products','contact'] };
  const themeColors = ['primary','secondary','background','text','button','card'];
  function currentTypography() {
    return Object.fromEntries(TYPOGRAPHY_TYPES.map(([key,, fallbackSize]) => {
      const get = (part) => $(`#typo-${key}-${part}`);
      return [key, { size:Number(get('size')?.value)||fallbackSize, weight:Number(get('weight')?.value)||400, italic:get('italic')?.checked===true,
        decoration:get('decoration')?.value||'none', lineHeight:Number(get('lineHeight')?.value)||1.4, letterSpacing:Number(get('letterSpacing')?.value)||0,
        align:get('align')?.value||'left', transform:get('transform')?.value||'none', color:get('color')?.value||'#162622', opacity:Number(get('opacity')?.value)||1 }];
    }));
  }
  function currentTheme() {
    const base = state.store?.theme || defaultTheme; const colors = {};
    for (const key of themeColors) colors[key] = $(`#theme${key[0].toUpperCase()}${key.slice(1)}`)?.value || base.colors?.[key] || defaultTheme.colors[key];
    return { template: $('#themeTemplate')?.value || base.template || 'modern', colors, font: $('#themeFont')?.value || 'Inter', typography: currentTypography(), textSize: $('#themeTextSize')?.value || 'normal',
      buttonShape: $('#themeButtonShape')?.value || 'rounded', cardShape: $('#themeCardShape')?.value || 'rounded', menuStyle: $('#themeMenuStyle')?.value || 'pills', productLayout: $('#themeProductLayout')?.value || 'grid',
      sections: { description: $('#sectionDescription')?.checked !== false, categories: $('#sectionCategories')?.checked !== false, contact: $('#sectionContact')?.checked !== false, hours: $('#sectionHours')?.checked !== false, contacts: $('#sectionContacts')?.checked !== false },
      sectionOrder: $$('#sectionOrderList [data-section]').map((node) => node.dataset.section) };
  }
  function fontFamilyCss(font) { return `\"${String(font||'Inter').replace(/[\"\\]/g,'')}\", sans-serif`; }
  function updateFontPreview() {
    const font=$('#themeFont')?.value||'Inter'; const sample=$('#themeFontSample'); if(sample){sample.style.fontFamily=fontFamilyCss(font);sample.textContent=`Aperçu : ${font} · Oymike Tech · Abidjan 0123456789`;}
    $$('#themeFontGallery [data-font]').forEach((button)=>button.classList.toggle('active',button.dataset.font===font));
  }
  function buildTypographyControls(input={}) {
    const root=$('#typographyControls'); if(!root)return;
    const source={...defaultTypography,...(input||{})};
    const selects=(id,label,options,value)=>`<label>${label}<select id="${id}">${options.map(([v,l])=>`<option value="${v}" ${value===v?'selected':''}>${l}</option>`).join('')}</select></label>`;
    root.innerHTML=TYPOGRAPHY_TYPES.map(([key,label,size])=>{const t={...defaultTypography[key],...(source[key]||{})};
      return `<details class="typography-item"><summary><span>${label}</span><output id="typo-${key}-size-value">${Number(t.size)||size} px</output></summary><div class="typography-controls">
        <label class="range-control">Taille <span><input id="typo-${key}-size" type="range" min="16" max="30" step="1" value="${Number(t.size)||size}"><output data-range-output="typo-${key}-size">${Number(t.size)||size} px</output></span></label>
        ${selects(`typo-${key}-weight`,'Graisse',[[300,'Léger · 300'],[400,'Normal · 400'],[500,'Moyen · 500'],[600,'Demi-gras · 600'],[700,'Gras · 700'],[800,'Très gras · 800'],[900,'Noir · 900']],Number(t.weight)||400)}
        <label><input id="typo-${key}-italic" type="checkbox" ${t.italic?'checked':''}> Italique</label>
        ${selects(`typo-${key}-decoration`,'Soulignement', [['none','Aucun'],['underline','Souligné']],t.decoration||'none')}
        <label>Interligne <input id="typo-${key}-lineHeight" type="number" min="0.9" max="2.2" step="0.05" value="${Number(t.lineHeight)||1.4}"></label>
        <label>Espacement (em) <input id="typo-${key}-letterSpacing" type="number" min="-0.05" max="0.3" step="0.01" value="${Number(t.letterSpacing)||0}"></label>
        ${selects(`typo-${key}-align`,'Alignement', [['left','Gauche'],['center','Centré'],['right','Droite']],t.align||'left')}
        ${selects(`typo-${key}-transform`,'Casse', [['none','Normale'],['uppercase','MAJUSCULES'],['lowercase','minuscules'],['capitalize','Première lettre']],t.transform||'none')}
        <label>Couleur <input id="typo-${key}-color" type="color" value="${/^#[0-9a-f]{6}$/i.test(t.color||'')?t.color:'#162622'}"></label>
        <label class="range-control">Opacité <span><input id="typo-${key}-opacity" type="range" min="0.35" max="1" step="0.05" value="${Math.max(.35,Math.min(1,Number(t.opacity)||1))}"><output data-range-output="typo-${key}-opacity">${Math.round((Number(t.opacity)||1)*100)} %</output></span></label>
      </div></details>`;
    }).join('');
    $$('[data-range-output]',root).forEach((output)=>{const input=$(`#${output.dataset.rangeOutput}`,root);if(!input)return;input.addEventListener('input',()=>{output.value=input.id.endsWith('-opacity')?`${Math.round(Number(input.value)*100)} %`:`${input.value} px`;const sizeValue=$(`#${input.id.replace('-size','-size-value')}`,root);if(sizeValue&&input.id.endsWith('-size'))sizeValue.value=`${input.value} px`;applyThemePreview();});});
    $$('select,input',root).forEach((node)=>node.addEventListener('input',applyThemePreview));$$('select,input',root).forEach((node)=>node.addEventListener('change',applyThemePreview));
  }
  function setThemeControls(theme = defaultTheme) {
    const t = { ...defaultTheme, ...theme, colors: { ...defaultTheme.colors, ...(theme.colors || {}) }, sections: { ...defaultTheme.sections, ...(theme.sections || {}) } };
    $('#themeTemplate').value = t.template || 'modern'; for (const key of themeColors) $(`#theme${key[0].toUpperCase()}${key.slice(1)}`).value = t.colors[key];
    const fontSelect=$('#themeFont');
    if(fontSelect){fontSelect.innerHTML=FONT_FAMILIES.map((font)=>`<option value="${esc(font)}">${esc(font)}</option>`).join('');fontSelect.value=FONT_FAMILIES.includes(t.font)?t.font:'Inter';}
    updateFontPreview();
    const gallery=$('#themeFontGallery'); if(gallery){gallery.innerHTML=FONT_FAMILIES.map((font)=>`<button type="button" data-font="${esc(font)}" style="font-family:${fontFamilyCss(font)}"><strong>${esc(font)}</strong><span>Aa Bb · Abidjan 0123456789</span></button>`).join('');$$('[data-font]',gallery).forEach((button)=>button.addEventListener('click',()=>{$('#themeFont').value=button.dataset.font;updateFontPreview();applyThemePreview();}));}
    buildTypographyControls(t.typography||defaultTypography);
    $('#themeTextSize').value = t.textSize || 'normal'; $('#themeButtonShape').value = t.buttonShape || 'rounded';
    $('#themeCardShape').value = t.cardShape || 'rounded'; $('#themeMenuStyle').value = t.menuStyle || 'pills'; $('#themeProductLayout').value = t.productLayout || 'grid';
    $('#sectionDescription').checked = t.sections.description !== false; $('#sectionCategories').checked = t.sections.categories !== false;
    $('#sectionContact').checked = t.sections.contact !== false; $('#sectionHours').checked = t.sections.hours !== false; $('#sectionContacts').checked = t.sections.contacts !== false;
    const allowed = ['cover','intro','categories','products','contact']; const order = [...new Set([...(t.sectionOrder || []), ...allowed].filter((item) => allowed.includes(item)))];
    $('#sectionOrderList').innerHTML = order.map((key) => `<li draggable="true" data-section="${key}"><span>${({cover:'Couverture',intro:'Présentation',categories:'Catégories',products:'Produits',contact:'Contacts'})[key]}</span><div><button type="button" data-move-section="-1" aria-label="Monter">↑</button><button type="button" data-move-section="1" aria-label="Descendre">↓</button></div></li>`).join('');
    wireSectionOrder(); applyThemePreview();
  }
  function applyTypographyStyle(node,style) {
    node.style.fontSize=`${Math.max(16,Math.min(30,Number(style.size)||16))}px`;node.style.fontWeight=String(Math.max(300,Math.min(900,Number(style.weight)||400)));
    node.style.fontStyle=style.italic?'italic':'normal';node.style.textDecoration=style.decoration==='underline'?'underline':'none';node.style.lineHeight=String(Math.max(.9,Math.min(2.2,Number(style.lineHeight)||1.4)));
    node.style.letterSpacing=`${Math.max(-.05,Math.min(.3,Number(style.letterSpacing)||0))}em`;node.style.textAlign=['left','center','right'].includes(style.align)?style.align:'left';
    node.style.textTransform=['none','uppercase','lowercase','capitalize'].includes(style.transform)?style.transform:'none';node.style.color=/^#[0-9a-f]{6}$/i.test(style.color||'')?style.color:'#162622';node.style.opacity=String(Math.max(.35,Math.min(1,Number(style.opacity)||1)));
  }
  function applyThemePreview() {
    const t = currentTheme(); const preview = $('#storeThemePreview'); if (!preview) return;
    preview.style.setProperty('--shop-primary', t.colors.primary); preview.style.setProperty('--shop-secondary', t.colors.secondary); preview.style.setProperty('--shop-background', t.colors.background);
    preview.style.setProperty('--shop-text', t.colors.text); preview.style.setProperty('--shop-button', t.colors.button); preview.style.setProperty('--shop-card', t.colors.card);
    preview.dataset.template = t.template; preview.dataset.buttonShape = t.buttonShape; preview.dataset.cardShape = t.cardShape; preview.dataset.menuStyle = t.menuStyle; preview.dataset.layout = t.productLayout;
    preview.style.background = t.colors.background; preview.style.color = t.colors.text; preview.style.fontFamily = fontFamilyCss(t.font);
    preview.style.fontSize = t.textSize === 'large' ? '1.08rem' : t.textSize === 'small' ? '.9rem' : '1rem';
    for(const [key] of TYPOGRAPHY_TYPES){const style=t.typography?.[key];if(!style)continue;const node=$(`[data-preview-type="${key}"]`,preview);if(node)applyTypographyStyle(node,style);}
    $('#themePreviewName').textContent = $('#storeName').value.trim() || 'Votre boutique';
    const logo = $('#storeLogoData').value; const logoEl = $('#themePreviewLogo'); logoEl.innerHTML = logo ? `<img src="${esc(privateMediaUrl(logo))}" alt="">` : 'O';
    const cover = $('#storeCoverData').value; const coverEl = $('#themePreviewCover'); if (cover) { coverEl.style.backgroundImage = `url("${esc(privateMediaUrl(cover))}")`; coverEl.textContent = ''; } else { coverEl.style.backgroundImage = ''; coverEl.textContent = 'Couverture'; }
    const sections = t.sections;
    $('[data-preview-section=\"categories\"]', preview).hidden = !sections.categories;
    $('[data-preview-section=\"contact\"]', preview).hidden = !sections.contact;
    $('.theme-preview-contact-actions', preview).hidden = !sections.contacts;
    $('.theme-preview-intro p', preview).hidden = !sections.description;
    for (const key of t.sectionOrder) { const section = $(`[data-preview-section=\"${key}\"]`, preview); if (section) preview.append(section); }
    preview.classList.toggle('preview-mobile', preview.dataset.viewport === 'mobile');
  }
  function wireSectionOrder() {
    const list = $('#sectionOrderList'); if (!list) return; let dragged = null;
    $$('[data-section]', list).forEach((item) => {
      item.addEventListener('dragstart', () => { dragged = item; item.classList.add('dragging'); });
      item.addEventListener('dragend', () => { item.classList.remove('dragging'); applyThemePreview(); });
      item.addEventListener('dragover', (event) => { event.preventDefault(); if (dragged && dragged !== item) list.insertBefore(dragged, item); });
      $$('[data-move-section]', item).forEach((button) => button.addEventListener('click', () => { const direction = Number(button.dataset.moveSection); const sibling = direction < 0 ? item.previousElementSibling : item.nextElementSibling; if (sibling) direction < 0 ? list.insertBefore(item, sibling) : list.insertBefore(sibling, item); applyThemePreview(); }));
    });
  }
  function syncTablePhotoRequirement(sector = $('#storeSector').value) {
    const supported = ['restaurant', 'maquis'].includes(sector);
    const field = $('#tablePhotoRequirementField'); const input = $('#requireTablePhoto');
    field.hidden = !supported; input.disabled = !supported;
    if (!supported) input.checked = false;
  }
  function fillStore(store) {
    state.store = store || null;
    $('#storeName').value = store?.name || ''; $('#storeSector').value = store?.sector || 'general'; $('#storeDescription').value = store?.description || '';
    $('#storePhone').value = store?.phone || ''; $('#storeWhatsApp').value = store?.whatsapp || ''; $('#storeEmail').value = store?.email || '';
    $('#storeAddress').value = store?.address || ''; $('#deliveryNote').value = store?.deliveryNote || ''; $('#storeOpeningHours').value = store?.openingHours || '';
    $('#deliveryFee').value = store?.deliveryFeeXof ?? 0; $('#deliveryEnabled').checked = store?.deliveryEnabled !== false; $('#pickupEnabled').checked = store?.pickupEnabled !== false;
    $('#acceptsOrders').checked = store?.acceptsOrders !== false; $('#storeSlug').value = store?.slug || ''; $('#storeSlug').disabled = Boolean(store);
    $('#storePublished').checked = Boolean(store?.isPublished); $('#requireTablePhoto').checked = store?.requireTablePhoto === true; syncTablePhotoRequirement(store?.sector || 'general'); attachStoreLogo(store?.logo || ''); attachStoreCover(store?.coverImageUrl || '');
    const statePill = $('#publishState'); statePill.textContent = store ? (store.isPublished ? (store.acceptsOrders === false ? 'Publié · commandes suspendues' : 'Catalogue publié') : 'Brouillon privé') : 'Boutique à créer';
    statePill.classList.toggle('published', Boolean(store?.isPublished));
    if (store) { $('#storeSlug').placeholder = store.slug; const link = `/shop/${encodeURIComponent(store.slug)}`; const publicLink = $('#publicShopLink'); publicLink.href = link; publicLink.hidden = false; }
    else $('#publicShopLink').hidden = true;
    $('#panel-store').classList.toggle('store-exists', Boolean(store)); $('#newProductButton').disabled = !store; setThemeControls(store?.theme || defaultTheme); updateQrLink().catch(() => {});
  }
  async function loadStore() {
    const result = await api('/api/merchant/store'); fillStore(result.data || null);
    $('#productForm').hidden = true;
    // Les trois appels partent ensemble : aucun n'a besoin du résultat des autres.
    await Promise.all([result.data ? loadProducts() : Promise.resolve(renderProducts([])), loadStats(), loadNotifications()]);
  }
  function storePayload() {
    return { name: $('#storeName').value.trim(), slug: $('#storeSlug').value.trim(), sector: $('#storeSector').value, description: $('#storeDescription').value.trim(),
      phone: $('#storePhone').value.trim(), whatsapp: $('#storeWhatsApp').value.trim(), email: $('#storeEmail').value.trim(), address: $('#storeAddress').value.trim(),
      deliveryNote: $('#deliveryNote').value.trim(), openingHours: $('#storeOpeningHours').value.trim(), deliveryFeeXof: Number($('#deliveryFee').value || 0),
      deliveryEnabled: $('#deliveryEnabled').checked, pickupEnabled: $('#pickupEnabled').checked, acceptsOrders: $('#acceptsOrders').checked, requireTablePhoto: $('#requireTablePhoto').checked,
      logo: $('#storeLogoData').value, coverImageUrl: $('#storeCoverData').value, theme: currentTheme(), isPublished: $('#storePublished').checked };
  }
  async function saveStoreData(button) {
    if (state.pendingUploads) { toast('Attendez la fin de l’envoi des images.'); return; }
    if (!$('#storeForm').reportValidity()) return;
    button.disabled = true; $('#storeSaveState').textContent = 'Enregistrement…'; $('#themeSaveState').textContent = 'Enregistrement…';
    const before = state.store; const previousImages = [before?.logo, before?.coverImageUrl].filter(Boolean);
    try {
      const result = await api('/api/merchant/store', { method: 'PUT', body: JSON.stringify(storePayload()) });
      fillStore(result.data); $('#storeSaveState').textContent = 'Enregistré'; $('#themeSaveState').textContent = 'Enregistré'; toast('Boutique enregistrée sur le serveur.');
      await cleanupReplacedMedia(previousImages, [result.data.logo, result.data.coverImageUrl].filter(Boolean)); state.uploadedMedia.clear(); await loadStats();
    } catch (error) { $('#storeSaveState').textContent = 'Échec de l’enregistrement'; $('#themeSaveState').textContent = 'Échec de l’enregistrement'; toast(error.message); }
    finally { button.disabled = false; }
  }
  $('#storeForm').addEventListener('submit', async (event) => { event.preventDefault(); await saveStoreData($('button[type="submit"]', event.currentTarget)); });
  $('#themeForm').addEventListener('submit', async (event) => { event.preventDefault(); await saveStoreData($('button[type="submit"]', event.currentTarget)); });

  async function loadQr() {
    const result = await api('/api/merchant/qr'); const data = result.data; const message = $('#qrMessage');
    if (!data?.path) { message.textContent = 'Le QR de boutique n’a pas encore été créé par l’Administrateur général ou un gestionnaire autorisé.'; $('#qrPublicLink').hidden = true;
    $('#qrPublicLink').removeAttribute('href'); $('#qrImageWrap').hidden = true; state.qrUrl = ''; return; }
    const url = data.url?.startsWith('http') ? data.url : `${window.location.origin}${data.path}`;
    state.qrUrl = url; state.qrPath = data.path;
    $('#downloadStoreQrPng').disabled = false; $('#downloadStoreQrSvg').disabled = false;
    message.textContent = 'Ce lien mène au catalogue de la boutique. Le contenu commercial est chargé depuis vos informations et produits actuels.';
    const link = $('#qrPublicLink'); link.href = url; link.textContent = url; link.hidden = false;
    try { await window.ensureQrEncoder(); const qr = qrcode(0, 'M'); qr.addData(url); qr.make(); const size = 320; const moduleCount = qr.getModuleCount(); const ctx = $('#storeQrCanvas').getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0,0,size,size); ctx.fillStyle = '#14251f'; const margin = 4; const cell = size/(moduleCount+margin*2); for(let r=0;r<moduleCount;r++) for(let c=0;c<moduleCount;c++) if(qr.isDark(r,c)) ctx.fillRect((c+margin)*cell,(r+margin)*cell,Math.ceil(cell),Math.ceil(cell)); $('#qrImageWrap').hidden = false; }
    catch (_) { $('#qrImageWrap').hidden = true; }
  }
  async function updateQrLink() { await loadQr(); }
  $('#downloadStoreQrPng').addEventListener('click', () => downloadQrArtwork(state.qrUrl, qrFileName('QR-boutique', state.store?.slug || state.slug || 'oymike'), 'png'));
  $('#downloadStoreQrSvg').addEventListener('click', () => downloadQrArtwork(state.qrUrl, qrFileName('QR-boutique', state.store?.slug || state.slug || 'oymike'), 'svg'));

  const ADVANCED_DRAFT_FORMS=['adForm','servicePointForm','rewardForm','giftCardForm'];
  function advancedDraftKey(){return `oymike-merchant-advanced-draft:${state.merchant?.id||'unknown'}`;}
  function saveAdvancedDrafts(){
    if(!state.merchant?.id)return; const draft={};
    for(const formId of ADVANCED_DRAFT_FORMS){const form=$(`#${formId}`);if(!form)continue;draft[formId]={};
      for(const node of $$('input,select,textarea',form)){if(!node.id||node.type==='file'||node.type==='password')continue;draft[formId][node.id]=node.type==='checkbox'?node.checked:node.value;}}
    try{sessionStorage.setItem(advancedDraftKey(),JSON.stringify(draft));}catch(_){}
  }
  function restoreAdvancedDrafts(){
    if(!state.merchant?.id)return;let draft=null;try{draft=JSON.parse(sessionStorage.getItem(advancedDraftKey())||'null');}catch(_){}
    if(!draft||typeof draft!=='object')return;
    for(const formId of ADVANCED_DRAFT_FORMS){const form=$(`#${formId}`);for(const node of $$('input,select,textarea',form||document)){if(!node.id||node.type==='file'||node.type==='password'||!Object.hasOwn(draft[formId]||{},node.id))continue;
      if(node.type==='checkbox')node.checked=draft[formId][node.id]===true;else{const value=String(draft[formId][node.id]??'');if(node.tagName==='SELECT'&&value&&!Array.from(node.options).some((option)=>option.value===value)){const option=document.createElement('option');option.value=value;option.textContent='QR du brouillon — chargement des emplacements…';node.append(option);}node.value=value;}}}
  }
  function advancedMessage(message, isError = false) {
    const node = $('#advancedNotice'); if (!node) return;
    node.textContent = message || ''; node.hidden = !message; node.classList.toggle('is-error', isError);
  }
  function advancedDate(value) {
    if (!value) return '';
    const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium',timeStyle:'short'}).format(date);
  }
  async function loadAdvancedData() {
    if (!state.store?.id) { advancedMessage('Créez et enregistrez d’abord votre boutique pour activer ces outils.', true); return; }
    if (state.advancedRequest) return state.advancedRequest;
    const request = (async () => {
      const paths = ['/api/merchant/ads','/api/merchant/service-points','/api/merchant/reward-campaigns','/api/merchant/reward-claims','/api/merchant/gift-cards'];
      const results = await Promise.allSettled(paths.map((path) => api(path)));
      const names = ['ads','servicePoints','rewardCampaigns','rewardClaims','giftCards']; const errors = [];
      results.forEach((result,index) => { if (result.status === 'fulfilled') state[names[index]] = result.value.data || []; else errors.push(names[index]); });
      state.advancedLoaded = true; renderAdvancedData();
      if (errors.length) advancedMessage(`Certaines données n’ont pas chargé (${errors.join(', ')}). Utilisez Actualiser dans la section concernée.`, true);
      else advancedMessage('Données chargées depuis le serveur.');
    })();
    state.advancedRequest = request;
    try { return await request; } finally { if (state.advancedRequest === request) state.advancedRequest = null; }
  }
  function qrFileName(prefix, suffix = '') {
    return `${prefix}${suffix ? `-${suffix}` : ''}`.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'QR-Oymike';
  }
  /** Real QR exports: 1600 px PNG and true SVG, generated from the same public URL and quiet zone. */
  async function downloadQrArtwork(url, baseName, format) {
    if (!url) { toast('Le lien public du QR n’est pas disponible.'); return; }
    if (!window.QRIAQRArtwork) { toast('Le module de téléchargement QR n’a pas été chargé. Actualisez la page.'); return; }
    const style = { foreground: '#14251f', background: '#FFFFFF', correction: 'M' };
    try {
      await window.QRIAQRArtwork.download(url, style, baseName, format);
      toast(format === 'svg' ? 'QR SVG téléchargé : agrandissement sans perte, prêt pour l’impression.' : 'QR PNG haute résolution téléchargé (1600 px).');
    } catch (error) { toast(error.message || 'Le téléchargement du QR a échoué sur cet appareil.'); }
  }
  async function drawServicePointQr(canvas, url) {
    if (!canvas) return;
    // Le dessin du QR n'est chargé qu'ici : il ne retarde plus l'ouverture de l'espace.
    try { await window.ensureQrEncoder?.(); if (typeof qrcode !== 'function') return; const qr = qrcode(0,'M'); qr.addData(url); qr.make(); const size=180; const n=qr.getModuleCount(); const margin=4; const cell=size/(n+margin*2); const ctx=canvas.getContext('2d');
      ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#14251f';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))ctx.fillRect((c+margin)*cell,(r+margin)*cell,Math.ceil(cell),Math.ceil(cell));
    } catch (_) { canvas.hidden = true; }
  }
  function resetServicePointForm() {
    const form = $('#servicePointForm'); if (!form) return;
    form.reset(); $('#servicePointId').value = '';
    $('#servicePointSubmit').textContent = 'Créer le QR'; $('#cancelServicePointEdit').hidden = true;
    saveAdvancedDrafts();
  }
  function editServicePoint(id) {
    const point = state.servicePoints.find((row) => row.id === id);
    if (!point) return advancedMessage('Ce point de service n’est plus disponible. Actualisez la liste.', true);
    $('#servicePointId').value = point.id; $('#servicePointType').value = point.type;
    $('#servicePointName').value = point.name || ''; $('#servicePointZone').value = point.zone || '';
    $('#servicePointInstructions').value = point.instructions || '';
    $('#servicePointSubmit').textContent = 'Enregistrer les modifications'; $('#cancelServicePointEdit').hidden = false;
    saveAdvancedDrafts(); $('#servicePointName').focus();
  }
  function renderAdvancedData() {
    const adRoot = $('#adList');
    const adStatusLabels={draft:'brouillon',active:'publiée selon le calendrier',paused:'en pause',archived:'archivée'};
    adRoot.innerHTML = state.ads.length ? state.ads.map((row) => { const archived=row.status==='archived'||row.archivedAt;const actionStatus=row.status==='active'?'paused':'active';
      return `<article class="advanced-row"><div><strong>${esc(row.title)}</strong><small>${esc(row.message || 'Campagne publicitaire')} · ${esc(advancedDate(row.startsAt))} → ${esc(advancedDate(row.endsAt))}</small><small>Format : ${esc(row.displayFormat||'card')} · emplacement : ${esc(row.placement||'after_intro')} · ${Number(row.impressionCount)||0} affichage(s) servi(s) · ${Number(row.clickCount)||0} clic(s) suivis</small><small>État : ${esc(adStatusLabels[row.status]||row.status)}${archived&&row.archivedAt?` · archivée le ${esc(advancedDate(row.archivedAt))}`:''}</small></div><div class="advanced-row-actions"><button type="button" data-ad-edit="${esc(row.id)}" ${archived?'disabled':''}>Modifier</button>${!archived?`<button type="button" data-ad-status="${esc(row.id)}" data-status="${actionStatus}">${row.status==='active'?'Mettre en pause':'Publier / réactiver'}</button><button class="danger" type="button" data-ad-archive="${esc(row.id)}">Archiver</button>`:''}</div></article>`; }).join('') : '<p class="empty">Aucune campagne enregistrée.</p>';
    $$('[data-ad-status]', adRoot).forEach((button) => button.addEventListener('click', () => setAdCampaignStatus(button.dataset.adStatus, button.dataset.status)));
    $$('[data-ad-edit]', adRoot).forEach((button) => button.addEventListener('click', () => editAdCampaign(button.dataset.adEdit)));
    $$('[data-ad-archive]', adRoot).forEach((button) => button.addEventListener('click', () => archiveAdCampaign(button.dataset.adArchive)));
    const pointRoot = $('#servicePointList');
    pointRoot.innerHTML = state.servicePoints.length ? state.servicePoints.map((row) => `<article class="advanced-row"><div><strong>${esc(servicePointTypeLabel(row.type))} · ${esc(row.name)}</strong><small>${esc(row.zone || 'Zone non précisée')} · ${Number(row.qrScanCount)||0} scan(s) · ${row.status === 'active' ? 'actif' : 'inactif'}</small><a href="/t/${encodeURIComponent(row.publicCode)}" target="_blank" rel="noopener">${esc(`${location.origin}/t/${row.publicCode}`)}</a><canvas width="180" height="180" data-point-qr="${esc(row.id)}" aria-label="QR de ${esc(row.name)}"></canvas></div><div class="advanced-row-actions"><button type="button" data-point-edit="${esc(row.id)}">Modifier</button><button type="button" data-download-point="${esc(row.id)}">PNG du QR</button><button type="button" data-download-point-svg="${esc(row.id)}">SVG du QR</button><button type="button" data-point-status="${esc(row.id)}" data-status="${row.status === 'active' ? 'inactive' : 'active'}">${row.status === 'active' ? 'Désactiver' : 'Réactiver'}</button></div></article>`).join('') : '<p class="empty">Aucune table ou emplacement enregistré.</p>';
    for (const canvas of $$('[data-point-qr]', pointRoot)) { const row = state.servicePoints.find((item) => item.id === canvas.dataset.pointQr); if (row) drawServicePointQr(canvas, `${location.origin}/t/${row.publicCode}`); }
    $$('[data-point-status]', pointRoot).forEach((button) => button.addEventListener('click', () => setServicePointStatus(button.dataset.pointStatus, button.dataset.status)));
    $$('[data-point-edit]', pointRoot).forEach((button) => button.addEventListener('click', () => editServicePoint(button.dataset.pointEdit)));
    const pointUrl = (point) => (window.location.origin + '/t/' + encodeURIComponent(point.publicCode));
    $$('[data-download-point]', pointRoot).forEach((button) => button.addEventListener('click', async () => {
      const point = state.servicePoints.find((row) => row.id === button.dataset.downloadPoint); if (!point) return;
      const name = qrFileName('QR', `${state.store?.slug || 'boutique'}-${point.name}`);
      await downloadQrArtwork(pointUrl(point), name, 'png');
      advancedMessage(`QR PNG haute résolution téléchargé : ${name}.png`);
    }));
    $$('[data-download-point-svg]', pointRoot).forEach((button) => button.addEventListener('click', async () => {
      const point = state.servicePoints.find((row) => row.id === button.dataset.downloadPointSvg); if (!point) return;
      const name = qrFileName('QR', `${state.store?.slug || 'boutique'}-${point.name}`);
      await downloadQrArtwork(pointUrl(point), name, 'svg');
      advancedMessage(`QR SVG vectoriel téléchargé : ${name}.svg`);
    }));
    const rewardPointSelect=$('#rewardServicePoint'); const selectedPointId=rewardPointSelect.value;
    const activePoints=state.servicePoints.filter((row)=>row.status==='active');
    rewardPointSelect.innerHTML='<option value="">Offre générale à toute la boutique</option>'+activePoints.map((row)=>`<option value="${esc(row.id)}">${esc(servicePointTypeLabel(row.type))} · ${esc(row.name)}${row.zone?` — ${esc(row.zone)}`:''}</option>`).join('');
    if(selectedPointId&&!activePoints.some((row)=>row.id===selectedPointId)){
      const option=document.createElement('option');option.value=selectedPointId;option.textContent=state.servicePoints.some((row)=>row.id===selectedPointId)?'Emplacement enregistré désormais inactif — choisissez à nouveau':'Emplacement du brouillon introuvable — choisissez un QR actif';rewardPointSelect.append(option);
    }
    rewardPointSelect.value=selectedPointId||'';
    const rewardRoot = $('#rewardList');
    const authorizationLabels={pending:'en attente de l’Administrateur général',approved:'autorisée par examen de l’Administrateur général',rejected:'refusée',revoked:'révoquée',not_submitted:'aucune référence soumise'};
    rewardRoot.innerHTML = state.rewardCampaigns.length ? state.rewardCampaigns.map((row) => { const authorizationStatus=row.authorizationStatus||'not_submitted';
      const action=row.status==='active'?`<button type="button" data-reward-status="${esc(row.id)}" data-status="paused">Mettre en pause</button>`:authorizationStatus==='approved'?`<button type="button" data-reward-status="${esc(row.id)}" data-status="active">Publier</button>`:authorizationStatus==='pending'?'<button type="button" disabled title="L’Administrateur général doit examiner la preuve d’autorisation avant publication.">En attente de l’Administrateur général</button>':`<button type="button" data-reward-auth="${esc(row.id)}">${authorizationStatus==='rejected'||authorizationStatus==='revoked'?'Resoumettre une référence':'Soumettre une référence'}</button>`;
      const linkedPoint=state.servicePoints.find((point)=>point.id===row.servicePointId);
      const pointLabel=row.servicePointId?(row.servicePointName||linkedPoint?.name||'emplacement introuvable'):'toute la boutique';
      return `<article class="advanced-row"><div><strong>${esc(row.title)}</strong><small>Gratuit · ${Number(row.remainingParticipants)||0}/${Number(row.maxParticipants)||0} participation(s) restantes · fin ${esc(advancedDate(row.endsAt))}</small><small>QR : ${esc(pointLabel)} · ${Number(row.participantCount)||0} participation(s) enregistrée(s) · ${Number(row.redeemedCount)||0} code(s) validé(s)</small><small>${(row.prizes||[]).map((prize) => `${esc(prize.label)} (${Number(prize.quantityRemaining ?? prize.quantity_remaining) || 0})`).join(' · ')}</small><small>Statut : ${row.status === 'active' ? 'publiée' : 'en pause'} · Autorisation : ${esc(authorizationLabels[authorizationStatus]||authorizationStatus)}${row.authorizationReference?` · ${esc(row.authorizationReference)}`:''}</small>${row.authorizationReviewNote?`<small>Note de l’Administrateur général : ${esc(row.authorizationReviewNote)}</small>`:''}</div><div class="advanced-row-actions">${action}</div></article>`; }).join('') : '<p class="empty">Aucune offre gratuite enregistrée.</p>';
    $$('[data-reward-status]', rewardRoot).forEach((button) => button.addEventListener('click', () => setRewardCampaignStatus(button.dataset.rewardStatus, button.dataset.status)));
    $$('[data-reward-auth]', rewardRoot).forEach((button) => button.addEventListener('click', () => submitRewardAuthorization(button.dataset.rewardAuth)));
    const claimRoot = $('#rewardClaimList');
    claimRoot.innerHTML = state.rewardClaims.length ? `<p class="muted">Derniers codes (seuls les quatre derniers caractères sont affichés)</p>${state.rewardClaims.slice(0,12).map((row) => `<article class="advanced-row"><div><strong>${esc(row.prizeLabel)} · ••••${esc(row.codeLast4)}</strong><small>${row.status === 'issued' ? 'à utiliser' : row.status === 'redeemed' ? 'utilisé' : 'expiré'} · ${esc(advancedDate(row.issuedAt))}</small></div></article>`).join('')}` : '<p class="empty">Aucune participation encore enregistrée.</p>';
    const giftRoot = $('#giftCardList');
    giftRoot.innerHTML = state.giftCards.length ? state.giftCards.map((row) => `<article class="advanced-row"><div><strong>Bon ••••${esc(row.codeLast4)} · ${money(row.balanceXof)} / ${money(row.faceValueXof)}</strong><small>Statut : ${row.status === 'pending' ? 'en attente d’activation' : row.status === 'active' ? 'actif' : row.status === 'redeemed' ? 'solde épuisé' : 'annulé'} · ${esc(advancedDate(row.createdAt))}</small></div>${row.status === 'pending' ? `<div class="advanced-row-actions"><button type="button" data-activate-gift="${esc(row.id)}">Confirmer hors ligne et activer</button></div>` : ''}</article>`).join('') : '<p class="empty">Aucun bon cadeau enregistré.</p>';
    $$('[data-activate-gift]', giftRoot).forEach((button) => button.addEventListener('click', () => activateGiftCard(button.dataset.activateGift)));
  }
  async function refreshAdvancedData() { state.advancedLoaded = false; await loadAdvancedData(); }
  async function setAdCampaignStatus(id, status) {
    try { const result = await api(`/api/merchant/ads/${encodeURIComponent(id)}/status`, { method:'POST', body:JSON.stringify({status}) });
      state.ads = state.ads.map((row) => row.id === id ? result.data : row); renderAdvancedData(); advancedMessage('Statut de la publicité enregistré côté serveur.'); }
    catch(error){ advancedMessage(error.message,true); }
  }
  async function archiveAdCampaign(id) {
    if(!window.confirm('Archiver cette publicité ? Son contenu ne sera plus publié; son historique et ses statistiques resteront conservés.'))return;
    try{const result=await api(`/api/merchant/ads/${encodeURIComponent(id)}`,{method:'DELETE',body:'{}'});state.ads=state.ads.map((row)=>row.id===id?result.data:row);if($('#adId').value===id)resetAdForm();renderAdvancedData();advancedMessage('Publicité archivée; les statistiques historiques sont conservées.');}
    catch(error){advancedMessage(error.message,true);}
  }
  function dateTimeLocal(value){const date=new Date(value);if(Number.isNaN(date.getTime()))return '';date.setMinutes(date.getMinutes()-date.getTimezoneOffset());return date.toISOString().slice(0,16);}
  function editAdCampaign(id){
    const row=state.ads.find((item)=>item.id===id);if(!row||row.status==='archived'||row.archivedAt)return;
    $('#adId').value=row.id;$('#adTitle').value=row.title||'';$('#adMessage').value=row.message||'';$('#adDestination').value=row.destination||'';$('#adCtaLabel').value=row.ctaLabel||'Découvrir';
    $('#adStatus').value=['draft','paused','active'].includes(row.status)?row.status:'draft';$('#adDisplayFormat').value=row.displayFormat||'card';$('#adPlacement').value=row.placement||'after_intro';
    $('#adDirection').value=row.direction||'ltr';$('#adSpeed').value=String(row.speed||30);$('#adStyle').value=row.style||'standard';
    $('#adStartsAt').value=dateTimeLocal(row.startsAt);$('#adEndsAt').value=dateTimeLocal(row.endsAt);$('#adImageUrl').value=row.imageUrl||'';$('#adImageFile').value='';
    const image=$('#adImagePreview');if(row.imageUrl){image.src=privateMediaUrl(row.imageUrl);image.hidden=false;$('#removeAdImage').hidden=false;}else{image.removeAttribute('src');image.hidden=true;$('#removeAdImage').hidden=true;}
    $('#saveAdButton').textContent='Enregistrer les modifications';$('#cancelAdEdit').hidden=false;renderAdPreview();advancedMessage(`Modification de « ${row.title} ». La campagne reste dans son état actuel tant que vous ne changez pas le statut.`);
    $('#adForm').scrollIntoView?.({behavior:'smooth',block:'nearest'});
  }
  function resetAdForm(){
    const unsavedImage=$('#adImageUrl').value;if(unsavedImage&&state.uploadedMedia.has(unsavedImage))discardUnusedMedia(unsavedImage);
    $('#adForm').reset();$('#adId').value='';$('#adImageUrl').value='';$('#adImageFile').value='';const image=$('#adImagePreview');image.removeAttribute('src');image.hidden=true;$('#removeAdImage').hidden=true;
    $('#saveAdButton').textContent='Enregistrer le brouillon';$('#cancelAdEdit').hidden=true;renderAdPreview();saveAdvancedDrafts();
  }
  function renderAdPreview(){
    const root=$('#adPreview');if(!root)return;const format=$('#adDisplayFormat').value||'card';const style=$('#adStyle').value||'standard';const url=$('#adImageUrl').value;
    root.innerHTML=`<article class="shop-ad shop-ad-${esc(format)} shop-ad-style-${esc(style)}" data-format="${esc(format)}"><div class="shop-ad-copy">${url?`<img class="shop-ad-image" src="${esc(privateMediaUrl(url))}" alt="">`:''}<span class="eyebrow">${esc($('#adTitle').value||'Titre de la publicité')}</span><p>${esc($('#adMessage').value||'Votre message apparaîtra ici.')}</p></div><a class="button outline" href="#">${esc($('#adCtaLabel').value||'Découvrir')} ↗</a></article>`;
  }
  async function setServicePointStatus(id, status) {
    const row = state.servicePoints.find((item) => item.id === id); if (!row) return;
    try { const result = status === 'inactive'
        ? await api(`/api/merchant/service-points/${encodeURIComponent(id)}`, { method:'DELETE', body:'{}' })
        : await api(`/api/merchant/service-points/${encodeURIComponent(id)}`, { method:'PUT', body:JSON.stringify({type:row.type,name:row.name,zone:row.zone,instructions:row.instructions,status}) });
      state.servicePoints = state.servicePoints.map((item) => item.id === id ? result.data : item); renderAdvancedData(); advancedMessage('État du QR enregistré; son lien imprimé reste stable.'); }
    catch(error){ advancedMessage(error.message,true); }
  }
  async function setRewardCampaignStatus(id, status) {
    const payload={status};
    if(status==='active'){
      const reference=window.prompt('Saisissez la référence exacte examinée et approuvée par l’Administrateur général.'); if(reference===null)return;
      if(reference.trim().length<4)return advancedMessage('Saisissez la référence officielle complète.',true);
      if(!window.confirm('Confirmez-vous que cette autorisation préalable a réellement été délivrée, reste en vigueur et couvre cette opération?'))return;
      payload.authorizationReference=reference.trim();payload.authorizationConfirmed=true;
    }
    try { const result = await api(`/api/merchant/reward-campaigns/${encodeURIComponent(id)}/status`, { method:'POST', body:JSON.stringify(payload) });
      state.rewardCampaigns = state.rewardCampaigns.map((row) => row.id === id ? result.data : row); renderAdvancedData(); advancedMessage(status==='active'?'Offre publiée après contrôle du serveur.':'Offre mise en pause.'); }
    catch(error){ advancedMessage(`${error.message} L’offre reste en pause jusqu’à validation.`,true); }
  }
  async function submitRewardAuthorization(id) {
    const reference=window.prompt('Saisissez la référence officielle réellement délivrée pour cette offre.');if(reference===null)return;
    if(reference.trim().length<4)return advancedMessage('Saisissez la référence officielle complète.',true);
    if(!window.confirm('Confirmez-vous que l’autorisation préalable est réellement délivrée, en vigueur et applicable à cette opération?'))return;
    try{const result=await api(`/api/merchant/reward-campaigns/${encodeURIComponent(id)}/authorization`,{method:'POST',body:JSON.stringify({authorizationReference:reference.trim(),authorizationConfirmed:true})});
      state.rewardCampaigns=state.rewardCampaigns.map((row)=>row.id===id?result.data:row);renderAdvancedData();advancedMessage('Référence soumise. L’offre reste en pause jusqu’à la décision de l’Administrateur général.');}
    catch(error){advancedMessage(error.message,true);}
  }
  async function activateGiftCard(id) {
    if (!window.confirm('Le commerçant confirme-t-il avoir reçu le montant hors plateforme, ou émettre volontairement ce bon gratuit ? Oymike Tech ne vérifie pas cette transaction.')) return;
    try { const result = await api(`/api/merchant/gift-cards/${encodeURIComponent(id)}/activate`, { method:'POST', body:JSON.stringify({confirmOfflinePayment:true}) });
      state.giftCards = state.giftCards.map((row) => row.id === id ? result.data : row); renderAdvancedData(); advancedMessage('Bon activé par le commerçant. Aucun paiement n’a été traité par Oymike Tech.'); }
    catch(error){ advancedMessage(error.message,true); }
  }
  async function localRequestId(key, fingerprint) {
    try { const current = JSON.parse(sessionStorage.getItem(key) || 'null'); if (current?.fingerprint === fingerprint && current.id) return current.id; } catch (_) {}
    const id = crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    try { sessionStorage.setItem(key, JSON.stringify({ id, fingerprint })); } catch (_) {}
    return id;
  }
  async function privateFingerprint(value) {
    try { const bytes = new TextEncoder().encode(String(value)); const digest = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(digest)].map((item) => item.toString(16).padStart(2,'0')).join(''); }
    catch (_) { return `${String(value).length}:${String(value).slice(-4)}`; }
  }
  function parseRewardPrizes(raw) {
    return String(raw || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line, index) => {
      const parts = line.split('|').map((part) => part.trim());
      if (parts.length !== 4) throw new Error(`Ligne ${index + 1} : utilisez « libellé | quantité | poids | benefit/no_prize ».`);
      return { label:parts[0], quantity:Number(parts[1]), weight:Number(parts[2]), kind:parts[3] };
    });
  }

  function formDateIso(id) {
    const raw = $(`#${id}`).value; if (!raw) return '';
    const date = new Date(raw); if (Number.isNaN(date.getTime())) throw new Error('Une date saisie est invalide.'); return date.toISOString();
  }
  const advancedPaths = { ads:'/api/merchant/ads', servicePoints:'/api/merchant/service-points', rewardCampaigns:'/api/merchant/reward-campaigns', rewardClaims:'/api/merchant/reward-claims', giftCards:'/api/merchant/gift-cards' };
  async function refreshAdvancedResource(name) {
    const path = advancedPaths[name]; if (!path) return;
    try { const result = await api(path); state[name] = result.data || []; state.advancedLoaded = true; renderAdvancedData(); advancedMessage('Données actualisées depuis le serveur.'); }
    catch (error) { advancedMessage(`${error.message} Vos saisies sont conservées; réessayez lorsque la connexion sera rétablie.`, true); }
  }
  async function submitAdvancedForm(event, { key, payload, path, onSuccess }) {
    event.preventDefault(); const form = event.currentTarget; const button = $('button[type="submit"]', form);
    if(state.pendingUploads)return advancedMessage('Attendez la fin de l’envoi de l’image avant d’enregistrer.',true);
    if (!state.store?.id) return advancedMessage('Enregistrez d’abord votre boutique.', true);
    if (!form.reportValidity()) return;
    button.disabled = true; const beforeText = button.textContent; button.textContent = 'Enregistrement…'; advancedMessage('Enregistrement sur le serveur…');
    try {
      const fingerprint = await privateFingerprint(JSON.stringify(payload)); const requestId = await localRequestId(key, fingerprint);
      const result = await api(path, { method:'POST', body:JSON.stringify({ ...payload, requestId }) });
      try { sessionStorage.removeItem(key); } catch (_) {}
      await onSuccess(result);
    } catch (error) {
      advancedMessage(`${error.message} Les champs restent remplis. Réessayez; une demande ambiguë reprend le même identifiant.`, true);
    } finally { button.disabled = false; button.textContent = beforeText; }
  }
  $('#adForm').addEventListener('submit', async (event) => {
    event.preventDefault();const form=event.currentTarget;const id=$('#adId').value;const button=$('#saveAdButton');if(state.pendingUploads)return advancedMessage('Attendez la fin de l’envoi de l’image avant d’enregistrer.',true);
    if(!form.reportValidity())return;let payload;
    try{payload={title:$('#adTitle').value.trim(),message:$('#adMessage').value.trim(),imageUrl:$('#adImageUrl').value.trim(),destination:$('#adDestination').value.trim(),ctaLabel:$('#adCtaLabel').value.trim(),
      displayFormat:$('#adDisplayFormat').value,direction:$('#adDirection').value,speed:Number($('#adSpeed').value),style:$('#adStyle').value,placement:$('#adPlacement').value,
      startsAt:formDateIso('adStartsAt'),endsAt:formDateIso('adEndsAt'),status:$('#adStatus').value};}
    catch(error){return advancedMessage(error.message,true);}
    if(id){const before=state.ads.find((row)=>row.id===id);button.disabled=true;button.textContent='Enregistrement…';advancedMessage('Enregistrement des modifications…');
      try{const result=await api(`/api/merchant/ads/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(payload)});state.ads=state.ads.map((row)=>row.id===id?result.data:row);
        await cleanupReplacedMedia([before?.imageUrl||''],[result.data.imageUrl||'']);if(result.data.imageUrl)state.uploadedMedia.delete(result.data.imageUrl);resetAdForm();renderAdvancedData();advancedMessage('Modifications enregistrées; la campagne reste soumise au calendrier et à son état.');}
      catch(error){advancedMessage(`${error.message} Les modifications restent dans le formulaire; réessayez.`,true);}
      finally{button.disabled=false;button.textContent=$('#adId').value?'Enregistrer les modifications':'Enregistrer le brouillon';}return;}
    submitAdvancedForm(event,{key:'oymike-ad-create-request',payload,path:'/api/merchant/ads',onSuccess:async(result)=>{
      state.ads=[result.data,...state.ads.filter((row)=>row.id!==result.data.id)];if(result.data.imageUrl)state.uploadedMedia.delete(result.data.imageUrl);state.advancedLoaded=true;resetAdForm();renderAdvancedData();
      advancedMessage(result.data.status==='active'?'Publicité enregistrée. Elle ne s’affichera que dans son calendrier.':'Brouillon ou campagne en pause enregistré côté serveur.');
    }});
  });
  $('#adImageFile').addEventListener('change',async(event)=>{
    const file=event.currentTarget.files?.[0];if(!file)return;const previous=$('#adImageUrl').value;
    try{const image=await uploadImage(file,'advertisement','adImageStatus');if(previous&&previous!==image.url)await discardUnusedMedia(previous);$('#adImageUrl').value=image.url;$('#adImagePreview').src=image.preview;$('#adImagePreview').hidden=false;$('#removeAdImage').hidden=false;renderAdPreview();saveAdvancedDrafts();}
    catch(_){/* the status beside the field contains the actionable error */}finally{event.currentTarget.value='';}
  });
  $('#removeAdImage').addEventListener('click',async()=>{const previous=$('#adImageUrl').value;$('#adImageUrl').value='';$('#adImagePreview').removeAttribute('src');$('#adImagePreview').hidden=true;$('#removeAdImage').hidden=true;if(previous)await discardUnusedMedia(previous);renderAdPreview();saveAdvancedDrafts();});
  $('#cancelAdEdit').addEventListener('click',()=>resetAdForm());
  for(const node of $$('input,textarea,select',$('#adForm')))node.addEventListener('input',renderAdPreview);
  for(const node of $$('input,textarea,select',$('#adForm')))node.addEventListener('change',renderAdPreview);
  $('#servicePointForm').addEventListener('submit', async (event) => {
    const form = event.currentTarget; const pointId = $('#servicePointId').value;
    const payload = { type:$('#servicePointType').value, name:$('#servicePointName').value.trim(), zone:$('#servicePointZone').value.trim(), instructions:$('#servicePointInstructions').value.trim() };
    if (pointId) {
      event.preventDefault(); if (!form.reportValidity()) return;
      const existing = state.servicePoints.find((row) => row.id === pointId); const button = $('#servicePointSubmit');
      payload.status = existing?.status || 'active'; button.disabled = true; button.textContent = 'Enregistrement…'; advancedMessage('Modification du point de service…');
      try {
        const result = await api(`/api/merchant/service-points/${encodeURIComponent(pointId)}`, { method:'PUT', body:JSON.stringify(payload) });
        state.servicePoints = state.servicePoints.map((row) => row.id === pointId ? result.data : row); state.advancedLoaded = true;
        resetServicePointForm(); renderAdvancedData(); advancedMessage(`Modifications du QR « ${result.data.name} » enregistrées.`);
      } catch (error) { advancedMessage(`${error.message} Les champs restent remplis; réessayez.`, true); }
      finally { button.disabled = false; button.textContent = $('#servicePointId').value ? 'Enregistrer les modifications' : 'Créer le QR'; }
      return;
    }
    submitAdvancedForm(event, { key:'oymike-service-point-create-request', payload, path:'/api/merchant/service-points', onSuccess:async (result) => {
      state.servicePoints = [result.data, ...state.servicePoints.filter((row) => row.id !== result.data.id)]; state.advancedLoaded = true;
      resetServicePointForm(); renderAdvancedData(); advancedMessage(`QR de ${result.data.name} créé. Son URL stable est ${result.data.url || `${location.origin}${result.data.path}`}.`);
    } });
  });
  $('#cancelServicePointEdit').addEventListener('click', resetServicePointForm);
  $('#rewardForm').addEventListener('submit', (event) => {
    let prizes;
    try { prizes = parseRewardPrizes($('#rewardPrizes').value); }
    catch (error) { event.preventDefault(); return advancedMessage(error.message, true); }
    const payload = { title:$('#rewardTitle').value.trim(), description:$('#rewardDescription').value.trim(), maxParticipants:Number($('#rewardCapacity').value),
      startsAt:formDateIso('rewardStartsAt'), endsAt:formDateIso('rewardEndsAt'), prizes, servicePointId:$('#rewardServicePoint').value||'', status:'paused', entryFeeXof:0,
      authorizationReference:$('#rewardAuthorizationReference').value.trim(), authorizationConfirmed:$('#rewardAuthorizationConfirmed').checked,
      complianceAccepted:$('#rewardCompliance').checked };
    submitAdvancedForm(event, { key:'oymike-reward-campaign-create-request', payload, path:'/api/merchant/reward-campaigns', onSuccess:async (result) => {
      state.rewardCampaigns = [result.data, ...state.rewardCampaigns.filter((row) => row.id !== result.data.id)]; state.advancedLoaded = true; renderAdvancedData();
      advancedMessage(result.data.authorizationStatus==='pending'?'Offre créée en pause. L’Administrateur général doit examiner la preuve d’autorisation avant publication.':'Brouillon gratuit créé en pause. Ajoutez une référence officielle et soumettez la preuve à l’Administrateur général pour examen.');
    } });
  });
  $('#rewardRedeemForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form=event.currentTarget; const button=$('button[type="submit"]',form); if(!form.reportValidity())return;
    const code=$('#rewardRedeemCode').value.trim(); button.disabled=true; advancedMessage('Vérification et consommation du code…');
    try { const result=await api('/api/merchant/reward-claims/redeem',{method:'POST',body:JSON.stringify({code})});
      state.rewardClaims=[result.data,...state.rewardClaims.filter((row)=>row.id!==result.data.id)]; renderAdvancedData(); advancedMessage(`Code ••••${result.data.codeLast4} consommé une seule fois pour « ${result.data.prizeLabel} ».`);
    } catch(error) { advancedMessage(error.message,true); }
    finally { button.disabled=false; }
  });
  $('#giftCardForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form=event.currentTarget; const button=$('button[type="submit"]',form); if(!form.reportValidity())return;
    const amountXof=Number($('#giftCardAmount').value); const payload={amountXof}; button.disabled=true; button.textContent='Création…'; advancedMessage('Création du bon en attente…');
    try { const fingerprint=await privateFingerprint(JSON.stringify(payload)); const requestId=await localRequestId('oymike-gift-card-create-request',fingerprint);
      const result=await api('/api/merchant/gift-cards',{method:'POST',body:JSON.stringify({...payload,requestId})});
      try{sessionStorage.removeItem('oymike-gift-card-create-request');}catch(_){}
      $('#giftCardReveal').innerHTML=`<strong>Code privé du bon cadeau</strong><code>${esc(result.code)}</code><span>Valeur : ${money(result.data.faceValueXof)} · état : en attente d’activation.</span><p>Copiez et remettez ce code au bénéficiaire en privé. Il n’est pas affiché dans la liste. Le commerçant doit confirmer l’émission ou la réception hors plateforme.</p>`;
      $('#giftCardReveal').hidden=false; state.giftCards=[result.data,...state.giftCards.filter((row)=>row.id!==result.data.id)]; state.advancedLoaded=true; renderAdvancedData(); advancedMessage('Bon créé et persisté. Le code n’est pas actif avant confirmation du commerçant.');
    } catch(error) { advancedMessage(`${error.message} La demande et sa valeur sont conservées; actualisez ou réessayez avec le même montant.`,true); }
    finally { button.disabled=false; button.textContent='Créer le bon en attente d’activation'; }
  });
  $('#giftCardRedeemForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form=event.currentTarget; const button=$('button[type="submit"]',form); if(!form.reportValidity())return;
    const code=$('#giftRedeemCode').value.trim().toUpperCase(); const amountXof=Number($('#giftRedeemAmount').value);
    button.disabled=true; advancedMessage('Débit du bon et vérification du solde…');
    try { const fingerprint=await privateFingerprint(`${code}\\0${amountXof}`); const requestId=await localRequestId('oymike-gift-card-redeem-request',fingerprint);
      const result=await api('/api/merchant/gift-cards/redeem',{method:'POST',body:JSON.stringify({code,amountXof,requestId})});
      try{sessionStorage.removeItem('oymike-gift-card-redeem-request');}catch(_){}
      state.giftCards=state.giftCards.map((row)=>row.id===result.data.card?.id?result.data.card:row); renderAdvancedData();
      advancedMessage(`Débit confirmé : ${money(result.data.redemption.amountXof)} · solde restant ${money(result.data.card?.balanceXof||0)}.`);
    } catch(error) { advancedMessage(`${error.message} Le serveur n’a pas confirmé le débit; réessayez avec le même code et montant.`,true); }
    finally { button.disabled=false; }
  });
  $('#refreshAds').addEventListener('click', () => refreshAdvancedResource('ads'));
  $('#refreshServicePoints').addEventListener('click', () => refreshAdvancedResource('servicePoints'));
  $('#refreshRewards').addEventListener('click', () => Promise.all([refreshAdvancedResource('rewardCampaigns'),refreshAdvancedResource('rewardClaims') ]));
  $('#refreshGiftCards').addEventListener('click', () => refreshAdvancedResource('giftCards'));
  $('#rewardPrizes').addEventListener('input', () => { if ($('#rewardCompliance').checked) advancedMessage('Votre brouillon a été modifié; validez la conformité avant publication.'); });
  ADVANCED_DRAFT_FORMS.forEach((formId)=>{const form=$(`#${formId}`);form?.addEventListener('input',saveAdvancedDrafts);form?.addEventListener('change',saveAdvancedDrafts);});
  function parseVariants(text) {
    return String(text || '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
      const [name, values = ''] = line.split('|'); return { name: name.trim(), values: values.split(',').map((value) => value.trim()).filter(Boolean) };
    }).filter((row) => row.name && row.values.length);
  }
  function productPayload() {
    const imageUrls = state.productImages.map((item) => item.url);
    return { name: $('#productName').value.trim(), sku: $('#productSku').value.trim(), priceXof: Number($('#productPrice').value), compareAtPriceXof: $('#productComparePrice').value ? Number($('#productComparePrice').value) : null,
      category: $('#productCategory').value.trim(), sortOrder: Number($('#productSortOrder').value || 0), stockQuantity: Number($('#productStock').value || 0),
      description: $('#productDescription').value.trim(), variants: parseVariants($('#productVariants').value), imageUrls, imageData: imageUrls[0] || '',
      trackStock: $('#productTrackStock').checked, status: $('#productActive').checked ? 'active' : 'unavailable',
      unit: $('#productUnit')?.value || 'piece', volumeLabel: $('#productVolume')?.value.trim() || '',
      visibility: $('#productVisibility')?.value || 'visible' };
  }
  // Mission 11 : « Nouveau produit » n'affiche que le formulaire, sans laisser la liste
  // complète au-dessus. Le formulaire reprend sa place quand on annule.
  function openProductEditor(open = true) {
    const form = $('#productForm'); if (!form) return;
    form.hidden = !open;
    const list = $('#productList');
    if (list) list.hidden = open;
    const categories = $('#productCategoriesBlock');
    if (categories) categories.hidden = open;
    if (open) {
      form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      const first = form.querySelector('input:not([type="hidden"])');
      setTimeout(() => first?.focus({ preventScroll: true }), 120);
    }
  }

  // Catégories : liste courte et cliquable, construite à partir des produits réels.
  function renderProductCategories() {
    const host = $('#productCategoryChips'); if (!host) return;
    const counts = new Map();
    for (const product of state.products || []) {
      const label = String(product.category || '').trim() || 'Sans catégorie';
      counts.set(label, (counts.get(label) || 0) + 1);
    }
    if (!counts.size) { host.innerHTML = '<p class="empty">Aucun produit enregistré : les catégories apparaîtront ici.</p>'; return; }
    const current = $('#productCategoryFilter')?.value || '';
    host.innerHTML = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'))
      .map(([label, count]) => `<button type="button" data-product-category="${esc(label)}" aria-pressed="${label === current}">${esc(label)} <span class="muted">${count}</span></button>`).join('');
  }

  async function loadProducts() {
    if (!state.store) return renderProducts([]);
    const result = await api('/api/merchant/products'); state.products = result.data || []; renderProducts(state.products);
    $('#metricProducts').textContent = String(state.products.filter((p) => p.status !== 'archived').length);
    const categories = [...new Set(state.products.map((p) => p.category).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'fr'));
    $('#merchantCategoryOptions').innerHTML = categories.map((category) => `<option value="${esc(category)}"></option>`).join('');
    renderProductCategories();
    renderHomeProducts();
  }
  function renderProducts(products) {
    const list = $('#productList');
    if (!products.length) { list.innerHTML = '<p class="empty">Aucun produit. Ajoutez un article pour démarrer votre catalogue.</p>'; renderProductCategories(); return; }
    list.innerHTML = products.map((p) => {
      const image = p.imageUrls?.[0] || p.imageData || ''; const price = p.compareAtPriceXof && p.compareAtPriceXof > p.priceXof ? `<del>${money(p.compareAtPriceXof)}</del> ` : '';
      const availability = p.status === 'unavailable' ? 'Désactivé' : p.trackStock && Number(p.stockQuantity) === 0 ? 'Rupture de stock' : p.trackStock ? `${Number(p.stockQuantity)} en stock` : 'Stock non suivi';
      return `<article class="product-card" data-product="${esc(p.id)}"><div class="product-thumb">${image ? `<img src="${esc(privateMediaUrl(image))}" alt="">` : 'PHOTO'}</div><div class="product-info"><strong>${esc(p.name)}</strong><p>${esc(p.description || 'Aucune description.')}</p><div class="product-meta"><span class="tag">${price}${money(p.priceXof)}</span>${p.category ? `<span class="tag">${esc(p.category)}</span>` : ''}${p.sku ? `<span class="tag">Réf. ${esc(p.sku)}</span>` : ''}<span class="tag ${p.available ? 'good' : 'low'}">${esc(availability)}</span>${p.imageUrls?.length > 1 ? `<span class="tag">${p.imageUrls.length} photos</span>` : ''}</div></div><div class="product-actions"><button type="button" data-edit-product="${esc(p.id)}">Modifier</button><button class="danger" type="button" data-archive-product="${esc(p.id)}">Supprimer / archiver</button></div></article>`;
    }).join('');
    $$('[data-edit-product]', list).forEach((button) => button.addEventListener('click', () => editProduct(button.dataset.editProduct)));
    $$('[data-archive-product]', list).forEach((button) => button.addEventListener('click', () => archiveProduct(button.dataset.archiveProduct)));
    renderProductCategories();
  }
  function clearProductForm() {
    const oldImages = state.productImages.map((item) => item.url); state.productImages = [];
    $('#productForm').reset(); $('#productForm').hidden = true; $('#productId').value = ''; $('#productStock').value = '0'; $('#productSortOrder').value = String(state.products.length);
    $('#productFormTitle').textContent = 'Ajouter un produit'; $('#productActive').checked = true; $('#productTrackStock').checked = true; $('#productImageFile').value = '';
    if ($('#productUnit')) $('#productUnit').value = 'piece';
    if ($('#productVolume')) $('#productVolume').value = '';
    if ($('#productVisibility')) $('#productVisibility').value = 'visible';
    renderProductImages(); oldImages.filter((url) => state.uploadedMedia.has(url)).forEach((url) => discardUnusedMedia(url));
    updateMediaStatus('productImageStatus', 'JPG, JPEG, PNG et WEBP · jusqu’à 8 photos.');
  }
  function editProduct(id) {
    const product = state.products.find((p) => p.id === id); if (!product) return;
    if (typeof openProductEditor === 'function') openProductEditor(true);
    $('#productForm').hidden = false; $('#productId').value = product.id; $('#productName').value = product.name; $('#productSku').value = product.sku || '';
    $('#productPrice').value = product.priceXof; $('#productComparePrice').value = product.compareAtPriceXof || ''; $('#productCategory').value = product.category || '';
    $('#productSortOrder').value = Number(product.sortOrder) || 0; $('#productStock').value = product.stockQuantity; $('#productDescription').value = product.description || '';
    $('#productVariants').value = (product.variants || []).map((row) => `${row.name} | ${(row.values || []).join(', ')}`).join('\n');
    $('#productTrackStock').checked = product.trackStock !== false; $('#productActive').checked = product.status === 'active';
    if ($('#productUnit')) $('#productUnit').value = product.unit || 'piece';
    if ($('#productVolume')) $('#productVolume').value = product.volumeLabel || '';
    if ($('#productVisibility')) $('#productVisibility').value = product.visibility || 'visible';
    $('#productFormTitle').textContent = `Modifier « ${product.name} »`;
    state.productImages = photoList(product).map((url) => ({ url, preview: '' })); renderProductImages();
    tab('products'); $('#productName').focus({ preventScroll: true });
  }
  $('#productForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const form = event.currentTarget; const id = $('#productId').value; const button = $('button[type="submit"]', form);
    if (state.pendingUploads) return toast('Attendez la fin de l’envoi des images.'); button.disabled = true;
    const before = state.products.find((item) => item.id === id); const previousImages = before ? photoList(before) : [];
    try {
      const payload = productPayload(); await api(id ? `/api/merchant/products/${encodeURIComponent(id)}` : '/api/merchant/products', { method: id ? 'PUT' : 'POST', body: JSON.stringify(payload) });
      await cleanupReplacedMedia(previousImages, payload.imageUrls); state.uploadedMedia.clear(); clearProductForm(); await Promise.all([loadProducts(), loadStats()]); toast(id ? 'Produit mis à jour.' : 'Produit ajouté au catalogue.');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  async function archiveProduct(id) {
    const product = state.products.find((p) => p.id === id); if (!product || !window.confirm(`Archiver « ${product.name} » ? Il ne sera plus commandable, mais restera dans l’historique.`)) return;
    try { await api(`/api/merchant/products/${encodeURIComponent(id)}`, { method: 'DELETE' }); await Promise.all([loadProducts(), loadStats()]); toast('Produit archivé.'); }
    catch (error) { toast(error.message); }
  }

  function renderNotificationCount() {
    const count = Math.max(0, Number(state.unreadCount) || 0); const label = count > 9 ? '9+' : String(count);
    for (const id of ['headerNotificationBadge','notificationTabBadge']) { const node = $(`#${id}`); if (!node) continue; node.textContent = label; node.hidden = count === 0; node.setAttribute('aria-label', `${count} notification${count === 1 ? '' : 's'} non lue${count === 1 ? '' : 's'}`); }
    const orderBadge = $('#orderBadge'); if (orderBadge) { orderBadge.textContent = label; orderBadge.hidden = count === 0; }
    // Mission 10 : la tuile « Commandes » reprend le compteur non lu.
    const tileBadge = $('#tileOrdersCount'); if (tileBadge && !(Number(tileBadge.textContent) > 0)) { tileBadge.textContent = label; tileBadge.hidden = count === 0; }
    try { if (count && navigator.setAppBadge) navigator.setAppBadge(count); else if (!count && navigator.clearAppBadge) navigator.clearAppBadge(); } catch (_) {}
  }
  async function loadNotifications(render = true) {
    const result = await api('/api/merchant/notifications?limit=60'); state.notifications = result.data || []; state.unreadCount = Number(result.unreadCount) || 0; renderNotificationCount();
    if (render) renderNotifications(); return result;
  }
  function renderNotifications() {
    const root = $('#notificationList'); if (!root) return;
    if (!state.notifications.length) { root.innerHTML = '<p class="empty">Aucune notification pour le moment.</p>'; return; }
    root.innerHTML = state.notifications.map((item) => `<article class="notification-item ${item.readAt ? '' : 'unread'}"><div class="notification-dot" aria-hidden="true"></div><div class="notification-copy"><strong>${esc(item.title)}</strong><p>${esc(item.message || '')}</p><time>${esc(dateTime(item.createdAt))}</time></div><div class="notification-actions">${item.orderId ? `<button class="button primary" type="button" data-open-notification="${esc(item.id)}" data-open-order="${esc(item.orderId)}">Ouvrir la commande</button>` : ''}${!item.readAt ? `<button class="link-button" type="button" data-read-notification="${esc(item.id)}">Marquer comme lue</button>` : '<span class="read-label">Lue</span>'}</div></article>`).join('');
    $$('[data-read-notification]', root).forEach((button) => button.addEventListener('click', () => markNotificationRead(button.dataset.readNotification)));
    $$('[data-open-notification]', root).forEach((button) => button.addEventListener('click', () => openNotification(button.dataset.openNotification, button.dataset.openOrder)));
  }
  async function markNotificationRead(id) {
    try { const result = await api(`/api/merchant/notifications/${encodeURIComponent(id)}/read`, { method: 'POST', body: '{}' }); state.notifications = result.data || []; state.unreadCount = Number(result.unreadCount) || 0; renderNotificationCount(); renderNotifications(); }
    catch (error) { toast(error.message); }
  }
  async function openNotification(notificationId, orderId) {
    if (notificationId) await markNotificationRead(notificationId);
    if (!orderId) return; $('#orderStatusFilter').value = ''; $('#orderSearch').value = ''; state.deepLinkOrderId = orderId; tab('orders');
  }
  function focusOrder(orderId) { const card = document.getElementById(`order-${orderId}`); if (!card) return; card.classList.add('order-highlight'); card.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); }
  async function loadOrders() {
    const params = new URLSearchParams({ page: '1', limit: '50', search: $('#orderSearch').value.trim(), status: $('#orderStatusFilter').value });
    const result = await api(`/api/merchant/orders?${params}`); state.orders = result.data || []; renderOrders(state.orders);
    // Mission 10 : cartes de commandes (filtres Nouvelles / En préparation / Prêtes / Terminées / Annulées).
    window.WorkspaceUI?.setOrders(state.orders);
    const pending = Number(state.orders.filter((o) => o.status === 'pending').length); $('#metricPending').textContent = `${pending} en attente`;
    const ids = state.orders.map((o) => o.id).filter(Boolean);
    if (ids.length) { try { const read = await api('/api/merchant/notifications/read-orders', { method: 'POST', body: JSON.stringify({ orderIds: ids }) }); state.notifications = read.data || []; state.unreadCount = Number(read.unreadCount) || 0; renderNotificationCount(); if (state.activeTab === 'notifications') renderNotifications(); } catch (_) {} }
    if (state.deepLinkOrderId) { const target = state.deepLinkOrderId; state.deepLinkOrderId = ''; focusOrder(target); }
    renderHomeOrders();
  }
  function showAssistedNotice(message, isError = false) {
    const node = $('#assistedNotice'); if (!node) return;
    node.textContent = message || ''; node.hidden = !message; node.classList.toggle('is-error', isError);
  }
  function assistedPaymentLabel(method) {
    return ({ not_recorded: 'Non précisé', cash: 'Espèces', mobile_money: 'Mobile money', bank_transfer: 'Virement', card: 'Carte', other: 'Autre' })[method] || 'Non précisé';
  }
  async function loadAssistedContext(force = false) {
    if (state.assistedContextRequest) return state.assistedContextRequest;
    if (state.assistedContextLoaded && !force) { renderAssistedContext(); return; }
    const request = (async () => {
      const result = await api('/api/merchant/assisted-orders/context');
      state.assistedStore = result.data.store || null; state.assistedProducts = result.data.products || []; state.assistedPoints = result.data.servicePoints || [];
      state.assistedContextLoaded = true; renderAssistedContext(); showAssistedNotice('Catalogue, prix, stock et occupations chargés depuis le serveur.');
      await refreshScannerAvailability();
    })();
    state.assistedContextRequest = request;
    try { return await request; } finally { if (state.assistedContextRequest === request) state.assistedContextRequest = null; }
  }
  function renderAssistedContext() {
    const categories = [...new Set(state.assistedProducts.map((item) => String(item.category || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b,'fr'));
    const select = $('#assistedCategoryFilter'); const previous = select.value;
    select.innerHTML = `<option value="">Toutes les catégories</option>${categories.map((value) => `<option value="${esc(value)}">${esc(value)}</option>`).join('')}`;
    if (categories.includes(previous)) select.value = previous;
    const modes = $('#assistedOrderType');
    if (modes) { const delivery = modes.querySelector('option[value="delivery"]'); const pickup = modes.querySelector('option[value="pickup"]');
      if (delivery) delivery.disabled = state.assistedStore?.deliveryEnabled === false;
      if (pickup) pickup.disabled = state.assistedStore?.pickupEnabled === false;
      if (modes.selectedOptions[0]?.disabled) modes.value = state.assistedStore?.pickupEnabled !== false ? 'pickup' : state.assistedStore?.deliveryEnabled !== false ? 'delivery' : 'other'; }
    const pointSelect = $('#assistedServicePoint'); const selectedPoint = pointSelect.value;
    const activePoints = state.assistedPoints.filter((row) => row.status === 'active');
    pointSelect.innerHTML = `<option value="">${activePoints.length ? 'Choisir une table ou un emplacement' : 'Aucun emplacement configuré'}</option>${activePoints.map((row) => {
      const used = Number(row.activeOrderCount) || 0; const label = `${servicePointTypeLabel(row.type)} · ${row.name}${row.zone ? ` · ${row.zone}` : ''}${used ? ` · Occupé (${used} commande${used === 1 ? '' : 's'} active${used === 1 ? '' : 's'})` : ' · Disponible'}`;
      return `<option value="${esc(row.id)}" data-point-type="${esc(row.type)}" data-active-orders="${used}">${esc(label)}</option>`;
    }).join('')}`;
    if (activePoints.some((row) => row.id === selectedPoint)) pointSelect.value = selectedPoint;
    // Une table scannée juste avant reste sélectionnée même si le contexte vient d'être rechargé.
    const pending = window.__wsPendingScanPoint;
    if (pending && activePoints.some((row) => row.id === pending)) {
      pointSelect.value = pending;
      window.__wsPendingScanPoint = '';
    }
    renderAssistedProducts(); renderAssistedCart(); syncAssistedOrderMode();
  }
  function renderAssistedProducts() {
    const root = $('#assistedProductList'); if (!root) return;
    const query = $('#assistedProductSearch').value.trim().toLocaleLowerCase('fr'); const category = $('#assistedCategoryFilter').value;
    const products = state.assistedProducts.filter((row) => (!category || row.category === category) &&
      [row.name,row.category,row.sku,row.description].some((value) => String(value || '').toLocaleLowerCase('fr').includes(query)));
    if (!products.length) { root.innerHTML = '<p class="empty">Aucun produit disponible pour cette recherche.</p>'; return; }
    root.innerHTML = products.map((product) => {
      const stockTracked = product.trackStock !== false; const out = stockTracked && Number(product.stockQuantity) <= 0;
      const image = product.imageUrls?.[0] || product.imageData || '';
      return `<article class="assisted-product-row">${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : '<span class="assisted-product-image-placeholder">PRODUIT</span>'}<div><strong>${esc(product.name)}</strong><small>${esc(product.category || 'Sans catégorie')} · ${money(product.priceXof)}${stockTracked ? ` · Stock : ${Number(product.stockQuantity)||0}` : ' · stock non suivi'}</small></div><button class="button outline" type="button" data-add-assisted="${esc(product.id)}" ${out ? 'disabled' : ''}>${out ? 'Épuisé' : 'Ajouter'}</button></article>`;
    }).join('');
    $$('[data-add-assisted]',root).forEach((button)=>button.addEventListener('click',()=>changeAssistedQuantity(button.dataset.addAssisted,1)));
  }
  function changeAssistedQuantity(productId, delta) {
    const product = state.assistedProducts.find((row) => row.id === productId); if (!product) return;
    const current = Number(state.assistedCart.get(productId)) || 0; const next = current + delta;
    if (next <= 0) state.assistedCart.delete(productId);
    else {
      if (product.trackStock !== false && next > Number(product.stockQuantity)) { showAssistedNotice(`Stock serveur disponible pour « ${product.name} » : ${Number(product.stockQuantity)||0}.`, true); return; }
      state.assistedCart.set(productId,Math.min(999,next));
    }
    renderAssistedProducts(); renderAssistedCart();
  }
  function renderAssistedCart() {
    const root = $('#assistedCartLines'); if (!root) return;
    const rows = [...state.assistedCart.entries()].map(([id,quantity])=>({product:state.assistedProducts.find((row)=>row.id===id),quantity})).filter((row)=>row.product);
    const subtotal = rows.reduce((sum,row)=>sum+Number(row.product.priceXof)*row.quantity,0); const mode=$('#assistedOrderType')?.value||'pickup';
    const delivery = mode==='delivery' ? Number(state.assistedStore?.deliveryFeeXof)||0 : 0;
    const discount = Math.max(0,Number($('#assistedDiscount')?.value)||0);
    $('#assistedSubtotal').textContent=money(subtotal); $('#assistedDeliveryFee').textContent=money(delivery);
    $('#assistedGrandTotal').textContent=money(Math.max(0,subtotal-discount+delivery));
    if (!rows.length) root.innerHTML='<p class="empty">Ajoutez des produits depuis le catalogue.</p>';
    else root.innerHTML=rows.map(({product,quantity})=>`<article class="assisted-cart-row"><div><strong>${esc(product.name)}</strong><small>${quantity} × ${money(product.priceXof)} = ${money(quantity*Number(product.priceXof))}</small></div><div class="assisted-qty"><button type="button" data-assisted-minus="${esc(product.id)}" aria-label="Retirer une unité">−</button><span>${quantity}</span><button type="button" data-assisted-plus="${esc(product.id)}" aria-label="Ajouter une unité">+</button></div></article>`).join('');
    $$('[data-assisted-minus]',root).forEach((button)=>button.addEventListener('click',()=>changeAssistedQuantity(button.dataset.assistedMinus,-1)));
    $$('[data-assisted-plus]',root).forEach((button)=>button.addEventListener('click',()=>changeAssistedQuantity(button.dataset.assistedPlus,1)));
    const submit=$('#assistedSubmitButton'); if(submit)submit.disabled=state.assistedRequestInProgress||!rows.length;
  }
  function syncAssistedOrderMode() {
    const mode=$('#assistedOrderType').value; const isDineIn=mode==='dine_in'; const isDelivery=mode==='delivery';
    $('#assistedServicePointField').hidden=!isDineIn;
    $('#assistedDeliveryAddressField').hidden=!isDelivery&&mode!=='other'; $('#assistedDeliveryAddress').required=isDelivery||mode==='other';
    const pointId=$('#assistedServicePoint').value; const point=state.assistedPoints.find((row)=>row.id===pointId&&row.status==='active');
    const count=Number(point?.activeOrderCount)||0; const occupied=Boolean(point?.type==='table'&&count>0);
    $('#assistedOccupancy').hidden=!occupied; $('#assistedOccupancy').textContent=occupied?`Cette table est occupée selon ${count} commande(s) non terminée(s). Il n’existe pas de registre de réservation de table dans l’application; vérifiez avec le client avant de confirmer.`:'';
    $('#assistedConfirmOccupiedWrap').hidden=!occupied;
    if(!occupied)$('#assistedConfirmOccupied').checked=false;
    renderAssistedCart();
  }
  function showAssistedReceipt(result) {
    const {order,trackingUrl}=result; const rows=(order.items||[]).map((item)=>`<li>${esc(item.name)} × ${Number(item.quantity)||0} — ${money(Number(item.unitPriceXof)*Number(item.quantity))}</li>`).join('');
    $('#assistedReceiptDetails').innerHTML=`<h3>Commande ${esc(order.reference)} enregistrée</h3><p><strong>Client :</strong> ${esc(order.customerName)} · ${order.customerContactStatus === 'not_available' || !order.customerPhone ? 'coordonnées non disponibles' : esc(order.customerPhone)}</p><p><strong>Emplacement :</strong> ${esc(order.servicePointName || '—')} · ${order.scannedVia === 'scanner' ? 'QR scanné par le marchand' : 'sélection manuelle'}</p><p><strong>Origine :</strong> Commande saisie par le marchand · ${esc(dateTime(order.createdAt||new Date().toISOString()))}</p><ul>${rows}</ul><p><strong>Sous-total :</strong> ${money(order.totalAmountXof)}</p><p><strong>Remise :</strong> ${money(order.discountAmountXof)}</p><p><strong>Livraison :</strong> ${money(order.deliveryFeeXof)}</p><p><strong>Total estimé :</strong> ${money(order.grandTotalXof??(Number(order.totalAmountXof)-Number(order.discountAmountXof)+Number(order.deliveryFeeXof)))}</p><p><strong>Type :</strong> ${esc(({dine_in:'Sur place',pickup:'À emporter',delivery:'Livraison',other:'Autre'})[order.orderType]||'Commande')}</p><p><strong>Mode déclaré :</strong> ${esc(assistedPaymentLabel(order.paymentMethod))} · paiement non vérifié</p><p><strong>Statut :</strong> À confirmer</p><p>Suivi privé à remettre au client (pas de SMS envoyé) : <a href="${esc(trackingUrl)}" target="_blank" rel="noopener">Ouvrir le lien de suivi</a></p><p class="muted">${esc(result.notice||'Paiement non vérifié.')}</p>`;
    $('#assistedReceipt').hidden=false; state.assistedReceiptData=result;
  }
  // ---------------------------------------------------------------------------------------
  // Scanner marchand : le contenu lu part au serveur qui décide (boutique, activation, doublon).
  // ---------------------------------------------------------------------------------------
  async function refreshScannerAvailability() {
    const block = $('#assistedScannerBlock'); if (!block) return;
    try {
      const flags = await api('/api/merchant/merchant-lifecycle/features').catch(() => null);
      const enabled = flags?.data?.merchantScanner !== false;
      block.hidden = !enabled;
      if (!enabled) showScannerMessage('Le scanner est désactivé par l’Administrateur général. La sélection manuelle de la table reste disponible.');
    } catch (_) { block.hidden = false; }
  }
  function showScannerMessage(message, isError = false) {
    const node = $('#scannerMessage'); if (!node) return;
    node.textContent = message; node.classList.toggle('is-error', Boolean(isError));
  }
  async function sendScan(code) {
    showScannerMessage('Vérification du QR auprès du serveur…');
    try {
      const result = await api('/api/merchant/assisted-orders/scan', { method: 'POST', body: JSON.stringify({ code, eventId: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}` }) });
      const data = result.data;
      state.scanState = { code: data.servicePoint?.publicCode || code, via: 'scanner', eventId: data.scanEventId || '', label: data.servicePoint ? data.servicePoint.name : 'QR de boutique' };
      if (data.servicePoint) {
        const select = $('#assistedServicePoint');
        if (!state.assistedPoints.some((row) => row.id === data.servicePoint.id)) state.assistedPoints.push({ ...data.servicePoint, status: 'active' });
        select.value = data.servicePoint.id;
        const modes = $('#assistedOrderType'); if (modes && ['dine_in', 'pickup', 'delivery', 'other'].includes(modes.value) === false) modes.value = 'dine_in';
        if (modes && data.servicePoint.type === 'table') modes.value = 'dine_in';
        syncAssistedOrderMode();
      }
      showScannerMessage(data.message || 'QR reconnu.');
      showAssistedNotice(data.message || 'QR reconnu par le serveur.', false);
    } catch (error) {
      const messages = {
        QR_OTHER_STORE: 'Ce QR appartient à une autre boutique. La commande ne peut pas continuer avec ce code.',
        QR_INVALID: 'Ce QR est invalide, désactivé ou n’existe plus. Vérifiez le code ou choisissez la table manuellement.',
      };
      const text = messages[error.code] || error.message;
      state.scanState = { code: '', via: '', eventId: '', label: '' };
      showScannerMessage(text, true); showAssistedNotice(text, true);
      // Réouverture possible immédiatement : aucun verrou après un échec.
      $('#scanRetryButton')?.removeAttribute('hidden');
    }
  }
  $('#openScannerButton')?.addEventListener('click', () => {
    if (!window.QRMerchantScanner) { showScannerMessage('Le scanner n’a pas pu être chargé. Choisissez la table manuellement.', true); return; }
    window.QRMerchantScanner.start({
      onRead: (value) => sendScan(value),
      onError: (message) => showScannerMessage(message, true),
    }).catch((error) => showScannerMessage(error.message, true));
  });
  $('#closeScannerButton')?.addEventListener('click', () => { window.QRMerchantScanner?.stop(); $('#scanOverlay').hidden = true; });
  $('#scanRetryButton')?.addEventListener('click', () => { $('#openScannerButton')?.click(); });
  $('#scanManualButton')?.addEventListener('click', () => {
    window.QRMerchantScanner?.stop(); $('#scanOverlay').hidden = true;
    state.scanState = { code: '', via: 'manual', eventId: '', label: '' };
    const modes = $('#assistedOrderType'); if (modes) modes.value = 'dine_in'; syncAssistedOrderMode();
    $('#assistedServicePoint')?.focus({ preventScroll: false });
    showScannerMessage('Sélection manuelle : choisissez la table ou l’emplacement dans le formulaire.');
  });
  $('#assistedServicePoint')?.addEventListener('change', () => {
    // Un choix manuel après un scan devient la provenance réelle de la commande.
    const point = state.assistedPoints.find((row) => row.id === $('#assistedServicePoint').value);
    if (point && point.publicCode !== state.scanState.code) state.scanState = { code: point.publicCode || '', via: 'manual', eventId: '', label: point.name };
  });

  // ---------------------------------------------------------------------------------------
  // Panneau « Scans & activation »
  // ---------------------------------------------------------------------------------------
  function scanBars(rows, key) {
    const max = Math.max(1, ...rows.map((row) => Number(row[key]) || 0));
    return rows.slice(-30).map((row) => `<div class="scan-bar"><span>${esc(row.day)}</span><div class="scan-bar-track"><i style="width:${Math.round(((Number(row[key]) || 0) / max) * 100)}%"></i></div><strong>${Number(row[key]) || 0}</strong></div>`).join('')
      || '<p class="muted">Aucun scan sur la période.</p>';
  }
  async function loadScansPanel() {
    const [activation, flags] = await Promise.all([api('/api/merchant/activation-status'), api('/api/merchant/merchant-lifecycle/features').catch(() => null)]);
    state.activation = activation.data;
    const steps = $('#activationSteps');
    if (steps) steps.innerHTML = (activation.data.steps || []).map((step) => `<div class="${step.done ? 'is-done' : step.key === activation.data.nextStep ? 'is-next' : ''}"><em>${step.done ? '✓' : step.key === activation.data.nextStep ? '→' : '·'}</em><span>${esc(step.label)}</span></div>`).join('');
    const flagsRoot = $('#activationCard');
    if (flagsRoot && flags?.data) {
      const off = Object.entries(flags.data).filter(([, value]) => value === false).map(([key]) => key);
      flagsRoot.dataset.disabled = off.join(',');
    }
    await loadScanStats();
    // Le scanner n'apparaît que si l’Administrateur général ne l'a pas coupé.
    $('#assistedScannerBlock') && ($('#assistedScannerBlock').hidden = flags?.data?.merchantScanner === false);
  }
  async function loadScanStats() {
    const result = await api(`/api/merchant/scan-stats?period=${encodeURIComponent(state.scanPeriod)}`);
    state.scanStats = result.data;
    const c = result.data.counts || {};
    const kpis = $('#scanKpis');
    if (kpis) kpis.innerHTML = `
      <div><span>Scans clients</span><strong>${Number(c.customer) || 0}</strong></div>
      <div><span>Scans marchands</span><strong>${Number(c.merchant) || 0}</strong></div>
      <div class="is-total"><span>Total</span><strong>${Number(c.total) || 0}</strong></div>
      <div><span>Historique antérieur</span><strong>${Number(c.legacy) || 0}</strong></div>`;
    const charts = $('#scanCharts');
    if (charts) charts.innerHTML = `
      <section><h3>Scans clients</h3>${scanBars(result.data.timeline || [], 'customer')}<h3 style="margin-top:12px">Semaines</h3>${(result.data.weekly || []).map((row) => `<div class="scan-bar"><span>${esc(row.week)}</span><div class="scan-bar-track"><i style="width:${Math.round((row.total / Math.max(1, ...(result.data.weekly || []).map((w) => w.total))) * 100)}%"></i></div><strong>${row.total}</strong></div>`).join('') || '<p class="muted">—</p>'}</section>
      <section><h3>Scans marchands</h3>${scanBars(result.data.timeline || [], 'merchant')}<h3 style="margin-top:12px">Mois</h3>${(result.data.monthly || []).map((row) => `<div class="scan-bar"><span>${esc(row.month)}</span><div class="scan-bar-track"><i style="width:${Math.round((row.total / Math.max(1, ...(result.data.monthly || []).map((w) => w.total))) * 100)}%"></i></div><strong>${row.total}</strong></div>`).join('') || '<p class="muted">—</p>'}</section>`;
    const tables = $('#scanTables');
    if (tables) tables.innerHTML = `
      <section><h3>QR les plus utilisés</h3><div class="scan-table-wrap"><table class="data-table"><thead><tr><th>QR</th><th>TYPE</th><th>CATÉGORIE</th><th>SCANS</th></tr></thead><tbody>
        ${(result.data.top || []).slice(0, 10).map((row) => `<tr><td>${esc(row.qrCode || '—')}</td><td>${row.qrKind === 'store' ? 'Boutique' : 'Table'}</td><td>${row.category === 'merchant' ? 'Marchand' : row.category === 'customer' ? 'Client' : 'Antérieur'}</td><td>${Number(row.count) || 0}</td></tr>`).join('') || '<tr><td colspan="4">Aucun scan enregistré.</td></tr>'}
      </tbody></table></div></section>
      <section><h3>Historique récent</h3><div class="scan-table-wrap"><table class="data-table"><thead><tr><th>DATE</th><th>CATÉGORIE</th><th>QR</th><th>CANAL</th></tr></thead><tbody>
        ${(result.data.history || []).slice(0, 15).map((row) => `<tr><td class="is-nowrap">${esc(dateTime(row.scannedAt))}</td><td>${row.category === 'merchant' ? 'Marchand' : row.category === 'customer' ? 'Client' : 'Antérieur'}</td><td>${esc(row.qrCode || '—')}</td><td>${esc(row.channel || '—')}</td></tr>`).join('') || '<tr><td colspan="4">Aucun événement.</td></tr>'}
      </tbody></table></div></section>`;
  }
  $('#refreshScanStats')?.addEventListener('click', () => loadScansPanel().catch((error) => toast(error.message)));
  $('#scanStatsPeriod')?.addEventListener('change', (event) => { state.scanPeriod = event.target.value; loadScanStats().catch((error) => toast(error.message)); });

  $('#assistedOrderForm').addEventListener('submit',async(event)=>{
    event.preventDefault(); if(state.assistedRequestInProgress)return;
    const form = event.currentTarget; const errorNode=$('#assistedOrderError');errorNode.hidden=true;
    if(!form.reportValidity())return;
    const items=[...state.assistedCart.entries()].map(([productId,quantity])=>({productId,quantity})); if(!items.length){errorNode.textContent='Ajoutez au moins un produit.';errorNode.hidden=false;return;}
    const payload={customerName:$('#assistedCustomerName').value.trim(),customerPhone:$('#assistedCustomerPhone').value.trim(),customerEmail:$('#assistedCustomerEmail').value.trim(),
      orderType:$('#assistedOrderType').value,servicePointId:$('#assistedServicePoint').value,confirmOccupiedPoint:$('#assistedConfirmOccupied').checked,
      deliveryAddress:$('#assistedDeliveryAddress').value.trim(),note:$('#assistedNote').value.trim(),paymentMethod:$('#assistedPaymentMethod').value,
      discountAmountXof:Number($('#assistedDiscount').value||0),items,
      scannedQrCode:state.scanState.code,scannedVia:state.scanState.via||'manual',scanEventId:state.scanState.eventId};
    const fingerprint=await privateFingerprint(JSON.stringify(payload));const requestKey=`oymike-assisted-order:${state.merchant?.id||'merchant'}:${state.assistedStore?.id||'store'}`;
    const requestId=await localRequestId(requestKey,fingerprint);state.assistedRequestInProgress=true;renderAssistedCart();showAssistedNotice('Enregistrement dans le circuit normal des commandes…');
    try{
      const result=await api('/api/merchant/assisted-orders',{method:'POST',body:JSON.stringify({...payload,requestId})});
      try{sessionStorage.removeItem(requestKey);}catch(_){}
      const order=result.data.order;const trackingUrl=result.data.trackingUrl;state.assistedCart.clear();form.reset();$('#assistedDiscount').value='0';state.scanState={code:'',via:'',eventId:'',label:''};
      $('#assistedReceipt').hidden=true;renderAssistedContext();renderAssistedCart();showAssistedReceipt({order,trackingUrl,notice:result.data.notice});
      showAssistedNotice(result.data.idempotent?'La commande existante a été retrouvée; aucun doublon n’a été créé.':'Commande enregistrée dans la liste normale avec son origine. Aucun paiement n’a été vérifié.');
      await Promise.all([loadOrders(),loadStats(),loadNotifications(false)]);
    }catch(error){
      if(error.code==='OCCUPIED_SERVICE_POINT'){
        const pointId=$('#assistedServicePoint').value;const activeOrderCount=Math.max(1,Number(error.data?.activeOrderCount)||0);
        state.assistedPoints=state.assistedPoints.map((point)=>point.id===pointId?{...point,activeOrderCount}:point);renderAssistedContext();
        $('#assistedOccupancy').hidden=false;$('#assistedOccupancy').textContent=`Cette table a ${activeOrderCount} commande(s) active(s) selon le serveur. Il n’existe pas de registre de réservation; vérifiez avec le client avant de confirmer.`;
        $('#assistedConfirmOccupiedWrap').hidden=false;$('#assistedConfirmOccupied').checked=false;$('#assistedConfirmOccupied').focus({preventScroll:true});
      }
      errorNode.textContent=`${error.message}${error.status>=500?' La réponse est incertaine; les champs et l’identifiant de reprise sont conservés. Réessayez sans modifier le panier.':''}`;errorNode.hidden=false;showAssistedNotice(error.message,true);
    }finally{state.assistedRequestInProgress=false;renderAssistedCart();}
  });
  $('#assistedOrderType').addEventListener('change',syncAssistedOrderMode);
  $('#assistedServicePoint').addEventListener('change',syncAssistedOrderMode);
  $('#assistedConfirmOccupied').addEventListener('change',()=>showAssistedNotice($('#assistedConfirmOccupied').checked?'Confirmation d’occupation enregistrée pour cette tentative.':'Confirmez l’occupation si vous souhaitez continuer.',false));
  $('#assistedDiscount').addEventListener('input',renderAssistedCart);
  $('#assistedProductSearch').addEventListener('input',renderAssistedProducts);
  $('#assistedCategoryFilter').addEventListener('change',renderAssistedProducts);
  $('#refreshAssistedContext').addEventListener('click',()=>loadAssistedContext(true).catch((error)=>showAssistedNotice(error.message,true)));
  $('#assistedPrintReceipt').addEventListener('click',()=>window.print());
  $('#assistedShareReceipt').addEventListener('click',async()=>{
    const receipt=state.assistedReceiptData;if(!receipt?.trackingUrl)return;
    const url=new URL(receipt.trackingUrl,location.origin).href;const text=`Commande ${receipt.order.reference} · suivi privé : ${url}`;
    try{if(navigator.share)await navigator.share({title:`Commande ${receipt.order.reference}`,text,url});else if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);showAssistedNotice('Lien de suivi copié. Remettez-le au client par un canal disponible.');}else showAssistedNotice(text);}
    catch(error){if(error.name!=='AbortError')showAssistedNotice('Le partage système n’est pas disponible. Copiez le lien affiché sur le reçu.',true);}
  });
  $('#assistedNewOrder').addEventListener('click',()=>{state.assistedReceiptData=null;$('#assistedReceipt').hidden=true;$('#assistedOrderForm').reset();$('#assistedDiscount').value='0';$('#assistedOrderError').hidden=true;showAssistedNotice('Prêt pour une nouvelle commande.');syncAssistedOrderMode();});
  async function loadCustomerBlocks() {
    const root = $('#customerBlockList'); if (!root) return;
    const params = new URLSearchParams({ page: '1', limit: '50', status: $('#customerBlockStatus')?.value || 'active', search: $('#customerBlockSearch')?.value.trim() || '' });
    root.innerHTML = '<p class="empty">Chargement des restrictions…</p>';
    try { const result = await api(`/api/merchant/customer-blocks?${params}`); state.customerBlocks = Array.isArray(result.data) ? result.data : []; renderCustomerBlocks(); }
    catch (error) { root.innerHTML = `<p class="resource-error" role="alert">${esc(error.message)} <button class="button outline" type="button" data-retry-customer-blocks>Réessayer</button></p>`;
      root.querySelector('[data-retry-customer-blocks]')?.addEventListener('click', () => loadCustomerBlocks().catch((e) => toast(e.message))); }
  }
  function renderCustomerBlocks() {
    const root = $('#customerBlockList'); if (!root) return;
    if (!state.customerBlocks.length) { root.innerHTML = '<p class="empty">Aucune restriction dans ce filtre.</p>'; return; }
    root.innerHTML = state.customerBlocks.map((block) => {
      const events = (block.history || []).map((event) => `<li><strong>${event.eventType === 'blocked' ? 'Blocage' : 'Déblocage'}</strong> · ${esc(dateTime(event.createdAt))}${event.reason ? ` · ${esc(event.reason)}` : ''}</li>`);
      const attempts = (block.recentAttempts || []).map((attempt) => `<li>Tentative enregistrée · ${esc(dateTime(attempt.attemptedAt))}</li>`);
      const history = `<details><summary>Historique · ${Number(block.attemptCount) || 0} tentative(s)</summary><ol>${[...events, ...attempts].join('') || '<li>Aucun événement supplémentaire.</li>'}</ol></details>`;
      return `<article class="customer-block-card"><div><strong>${esc(block.phoneMasked || `•••• ${block.phoneLast4 || ''}`)}</strong><span class="customer-block-status ${block.status === 'unblocked' ? 'unblocked' : ''}">${block.status === 'active' ? 'Actif' : 'Débloqué'}</span><p><strong>Motif :</strong> ${esc(block.reason || '—')}</p><small>Enregistré le ${esc(dateTime(block.createdAt))}${block.lastAttemptAt ? ` · Dernière tentative : ${esc(dateTime(block.lastAttemptAt))}` : ''}${block.unblockReason ? `<br>Motif de déblocage : ${esc(block.unblockReason)}` : ''}</small>${history}</div>${block.status === 'active' ? `<button class="button outline" type="button" data-unblock-customer="${esc(block.id)}">Débloquer</button>` : ''}</article>`;
    }).join('');
    $$('[data-unblock-customer]', root).forEach((button) => button.addEventListener('click', () => unblockCustomerBlock(button.dataset.unblockCustomer, button)));
  }
  async function createCustomerBlock(event) {
    event.preventDefault(); if (state.blockSubmitInProgress) return;
    const form = event.currentTarget; const phone = $('#customerBlockPhone').value.trim(); const reason = $('#customerBlockReason').value.trim();
    if (!window.confirm(`Bloquer ce numéro uniquement pour votre boutique ? Une annulation légitime ne doit pas entraîner de blocage. Le client recevra un message neutre et l’historique restera consultable.`)) return;
    state.blockSubmitInProgress = true; const button = $('button[type="submit"]', form); button.disabled = true;
    try {
      const result = await api('/api/merchant/customer-blocks', { method: 'POST', body: JSON.stringify({ phone, reason }) });
      form.reset(); await loadCustomerBlocks(); toast(result.idempotent ? 'Ce numéro est déjà bloqué pour cette boutique.' : 'Restriction enregistrée et auditée.');
    } catch (error) { toast(error.message); }
    finally { state.blockSubmitInProgress = false; button.disabled = false; }
  }
  async function unblockCustomerBlock(blockId, button) {
    const block = state.customerBlocks.find((item) => item.id === blockId); if (!block || block.status !== 'active') return;
    if (!window.confirm(`Débloquer le numéro se terminant par ${block.phoneLast4} pour cette boutique ? L’historique restera conservé.`)) return;
    const reason = window.prompt('Motif facultatif de déblocage (sera conservé dans l’historique) :', ''); if (reason === null) return;
    button.disabled = true;
    try { await api(`/api/merchant/customer-blocks/${encodeURIComponent(blockId)}/unblock`, { method: 'POST', body: JSON.stringify({ reason }) });
      await loadCustomerBlocks(); toast('Numéro débloqué; son historique est conservé.'); }
    catch (error) { button.disabled = false; toast(error.message); }
  }
  function renderOrders(orders) {
    const list = $('#orderList');
    if (!orders.length) { list.innerHTML = '<p class="empty">Aucune commande dans ce filtre.</p>'; return; }
    list.innerHTML = orders.map((order) => {
      const waMessage = encodeURIComponent(`Bonjour ${order.customerName}, nous vous contactons au sujet de votre commande ${order.reference}.`);
      const eventHistory = (order.events || []).map((event) => `<li><strong>${esc(statusLabels[event.status] || event.status)}</strong><span>${esc(event.note || '')}</span><time>${esc(dateTime(event.createdAt))}</time></li>`).join('');
      const cancellationRequests = order.cancellationRequests || [];
      const cancellationHistory = cancellationRequests.length ? `<details class="order-history order-cancellations" ${cancellationRequests.some((item) => item.status === 'pending') ? 'open' : ''}><summary>Demandes d’annulation (${cancellationRequests.length})</summary><ol>${cancellationRequests.slice().reverse().map((request) => `<li><strong>${esc(request.status === 'pending' ? 'À traiter' : request.status === 'accepted' ? 'Acceptée' : 'Refusée')}</strong><span>${request.reason ? `Motif client : ${esc(request.reason)}` : 'Aucun motif indiqué.'}${request.decisionNote ? `<br>${esc(request.decisionNote)}` : ''}</span><time>${esc(dateTime(request.requestedAt))}</time>${request.status === 'pending' ? `<div class="cancellation-actions"><button class="button primary" type="button" data-cancellation-id="${esc(request.id)}" data-cancellation-order="${esc(order.id)}" data-cancellation-decision="accepted">Accepter</button><button class="button quiet" type="button" data-cancellation-id="${esc(request.id)}" data-cancellation-order="${esc(order.id)}" data-cancellation-decision="rejected">Refuser</button></div>` : ''}</li>`).join('')}</ol></details>` : '';
      const isAssistedOrder = order.source === 'merchant_assisted';
      const orderTypeLabels = { dine_in: 'Sur place', pickup: 'À emporter / retrait', delivery: 'Livraison', other: 'Autre remise' };
      const orderTypeLabel = orderTypeLabels[order.orderType] || 'Commande';
      const deliveryFee = Number(order.deliveryFeeXof) || 0; const discount = Number(order.discountAmountXof) || 0;
      const grandTotal = Number.isFinite(Number(order.grandTotalXof)) ? Number(order.grandTotalXof) : Math.max(0, Number(order.totalAmountXof || 0) - discount + deliveryFee);
      const orderFinancialDetails = `<div class="order-meta-breakdown">${isAssistedOrder ? `<div><span>Origine</span><strong>Commande saisie par le marchand</strong></div><div><span>Type de remise</span><strong>${esc(orderTypeLabel)}</strong></div><div><span>Mode de paiement déclaré · non vérifié</span><strong>${esc(assistedPaymentLabel(order.paymentMethod))}</strong></div>` : ''}${deliveryFee ? `<div><span>Frais de livraison</span><strong>${money(deliveryFee)}</strong></div>` : ''}${discount ? `<div><span>Remise</span><strong>− ${money(discount)}</strong></div>` : ''}<div><span>Total calculé · non encaissé</span><strong>${money(grandTotal)}</strong></div></div>`;
      return `<article id="order-${esc(order.id)}" class="order-card" data-order-card="${esc(order.id)}"><header class="order-head"><div><strong>${esc(order.reference)}</strong><small>Reçue le ${esc(dateTime(order.createdAt))}</small><span class="order-source-badge ${isAssistedOrder ? '' : 'qr'}">${isAssistedOrder ? 'Saisie par le marchand' : 'Commande client / QR'}</span></div><span class="order-status ${esc(order.status)}">${esc(statusLabels[order.status] || order.status)}</span></header><div class="order-body"><div class="order-customer"><span><strong>Client :</strong> ${esc(order.customerName)}</span><span><strong>Téléphone :</strong> <a href="tel:${esc(order.customerPhone)}">${esc(order.customerPhone)}</a></span><a href="https://wa.me/${esc(String(order.customerPhone || '').replace(/\D/g,''))}?text=${waMessage}" target="_blank" rel="noopener">Contacter sur WhatsApp</a>${order.customerEmail ? `<span><strong>E-mail :</strong> ${esc(order.customerEmail)}</span>` : ''}<span><strong>Remise :</strong> ${esc(order.deliveryAddress)}</span>${order.note ? `<span><strong>Note :</strong> ${esc(order.note)}</span>` : ''}</div><ul class="order-items">${order.items.map((item) => `<li><span>${esc(item.name)} × ${item.quantity}</span><strong>${money(Number(item.unitPriceXof) * Number(item.quantity))}</strong></li>`).join('')}</ul><div class="order-total"><span>Sous-total produits · ${order.currency}</span><span>${money(order.totalAmountXof)}</span></div>${orderFinancialDetails}${order.hasTablePhoto ? `<div class="order-photo-controls"><a class="button outline" href="/api/merchant/orders/${encodeURIComponent(order.id)}/table-photo" download>Télécharger la photo de table</a><small>Privée · supprimée automatiquement le ${esc(dateTime(order.tablePhotoExpiresAt))}</small><button class="link-button" type="button" data-delete-order-photo="${esc(order.id)}">Supprimer maintenant</button></div>` : ''}${cancellationHistory}${eventHistory ? `<details class="order-history"><summary>Historique de la commande</summary><ol>${eventHistory}</ol></details>` : ''}</div><footer class="order-foot"><small class="muted">Commande enregistrée · aucun paiement confirmé</small><div class="order-actions">${(transitions[order.status] || []).map(([next, label]) => `<button class="button ${next === 'cancelled' ? 'quiet' : 'primary'}" type="button" data-order-id="${esc(order.id)}" data-next-status="${next}">${label}</button>`).join('')}<button class="button quiet" type="button" data-block-customer="${esc(order.customerPhone)}">Bloquer ce numéro</button></div></footer></article>`;
    }).join('');
    $$('[data-next-status]', list).forEach((button) => button.addEventListener('click', () => setOrderStatus(button.dataset.orderId, button.dataset.nextStatus)));
    $$('[data-delete-order-photo]',list).forEach((button)=>button.addEventListener('click',()=>deleteOrderTablePhoto(button.dataset.deleteOrderPhoto)));
    $$('[data-block-customer]',list).forEach((button)=>button.addEventListener('click',()=>{const phone=button.dataset.blockCustomer||'';if(!phone)return;$('#customerBlockPhone').value=phone;$('#customerBlockReason').focus({preventScroll:true});$('#customerBlockForm').scrollIntoView?.({behavior:'smooth',block:'center'});}));
    $$('[data-cancellation-decision]',list).forEach((button)=>button.addEventListener('click',()=>decideCancellationRequest(button.dataset.cancellationOrder,button.dataset.cancellationId,button.dataset.cancellationDecision,button)));
  }
  async function decideCancellationRequest(orderId, requestId, decision, button) {
    const order = state.orders.find((item) => item.id === orderId); if (!order) return;
    const label = decision === 'accepted' ? 'accepter l’annulation' : 'refuser l’annulation';
    if (!window.confirm(`Confirmer : ${label} de la commande ${order.reference} ?`)) return;
    const note = window.prompt('Note facultative à conserver dans l’historique :', ''); if (note === null) return;
    button.disabled = true;
    try {
      await api(`/api/merchant/orders/${encodeURIComponent(orderId)}/cancellations/${encodeURIComponent(requestId)}`, { method: 'POST', body: JSON.stringify({ decision, note }) });
      await Promise.all([loadOrders(), loadStats(), loadNotifications()]);
      toast(decision === 'accepted' ? 'Demande acceptée; la commande est annulée et son historique est conservé.' : 'Demande refusée; la commande reste active et l’historique est conservé.');
    } catch (error) { button.disabled = false; toast(error.message); }
  }
  async function deleteOrderTablePhoto(id){
    const order=state.orders.find((row)=>row.id===id);if(!order||!window.confirm(`Supprimer maintenant la photo privée de ${order.reference} ? Cette action est définitive.`))return;
    try{await api(`/api/merchant/orders/${encodeURIComponent(id)}/table-photo`,{method:'DELETE'});await loadOrders();toast('Photo de table supprimée; l’historique de la commande est conservé.');}
    catch(error){toast(error.message);}
  }
  async function setOrderStatus(id, status) {
    const order = state.orders.find((item) => item.id === id); if (!order) return;
    const action = statusLabels[status] || status; if (!window.confirm(`${action} la commande ${order.reference} ?`)) return;
    let reason = '';
    if (status === 'cancelled' || status === 'rejected') { reason = window.prompt('Indiquez le motif du refus ou de l’annulation :', ''); if (!reason?.trim()) return toast('Le motif est obligatoire pour refuser ou annuler une commande.'); }
    try { await api(`/api/merchant/orders/${encodeURIComponent(id)}/status`, { method: 'POST', body: JSON.stringify({ status, reason }) }); await Promise.all([loadOrders(), loadStats(), loadNotifications()]); toast(`Commande ${order.reference} mise à jour : ${statusLabels[status]}.`); }
    catch (error) { toast(error.message); }
  }
  function renderHomeOrders() {
    const root = $('#homeRecentOrders'); if (!root) return; const rows = (state.orders || []).slice(0,5);
    root.innerHTML = rows.length ? rows.map((order) => `<button type="button" class="recent-order-row" data-home-order="${esc(order.id)}"><span><strong>${esc(order.reference)}</strong><small>${esc(order.customerName)} · ${esc(dateTime(order.createdAt))}</small></span><span class="order-status ${esc(order.status)}">${esc(statusLabels[order.status] || order.status)}</span></button>`).join('') : '<p class="empty">Aucune commande récente.</p>';
    $$('[data-home-order]', root).forEach((button) => button.addEventListener('click', () => openNotification('', button.dataset.homeOrder)));
  }
  function renderHomeProducts(stats = state.stats || {}) {
    const root = $('#homeTopProducts'); if (!root) return; const rows = stats.topProducts || [];
    root.innerHTML = rows.length ? rows.map((row) => `<div class="top-product-row"><strong>${esc(row.name)}</strong><span>${Number(row.quantity) || 0} commandé${Number(row.quantity) === 1 ? '' : 's'}</span></div>`).join('') : '<p class="empty">Les produits les plus commandés apparaîtront ici.</p>';
    const trend = $('#ordersTrend'); if (trend) { const values = stats.ordersByDay || []; const max = Math.max(1, ...values.map((row) => Number(row.orders) || 0)); trend.innerHTML = values.map((row) => { const period = row.period || row.start || ''; return `<div class="trend-day" title="${esc(period)} · ${Number(row.orders)||0} commande(s)"><div><span style="height:${Math.max(3, Math.round((Number(row.orders)||0)/max*100))}%"></span></div><small>${esc(String(period).slice(5))}</small><b>${Number(row.orders)||0}</b></div>`; }).join(''); }
  }
  async function loadStats() {
    const result = await api('/api/merchant/stats'); const stats = result.data || {}; state.stats = stats;
    $('#metricProducts').textContent = new Intl.NumberFormat('fr-FR').format(stats.products || 0); $('#metricOrders').textContent = new Intl.NumberFormat('fr-FR').format(stats.orders || 0);
    $('#metricPending').textContent = `${new Intl.NumberFormat('fr-FR').format(stats.pendingOrders || 0)} en attente`;
    $('#metricOrderValue').textContent = money(stats.orderValueXof || 0); $('#metricScans').textContent = new Intl.NumberFormat('fr-FR').format(stats.qrScans || 0);
    $('#metricAvailable').textContent = new Intl.NumberFormat('fr-FR').format(stats.availableProducts || 0); $('#metricOutOfStock').textContent = new Intl.NumberFormat('fr-FR').format(stats.outOfStock || 0);
    $('#metricCompleted').textContent = new Intl.NumberFormat('fr-FR').format(stats.completedOrders || 0); $('#metricCancelled').textContent = new Intl.NumberFormat('fr-FR').format(stats.cancelledOrders || 0);
    $('#metricCompletedValue').textContent = money(stats.completedOrderValueXof || 0); renderHomeProducts(stats); state.orders = stats.recentOrders || state.orders; renderHomeOrders();
  }
  function playNotificationSound() {
    try { if (localStorage.getItem('oymike-merchant-sound') !== 'true') return; const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
      const context = new Ctx(); const oscillator = context.createOscillator(); const gain = context.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = 880;
      gain.gain.setValueAtTime(.0001, context.currentTime); gain.gain.exponentialRampToValueAtTime(.12, context.currentTime + .02); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + .22);
      oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + .24); oscillator.onended = () => context.close(); } catch (_) {}
  }
  function handleLiveEvent(data) {
    if (data.type === 'new_order') {
      const id = String(data.orderId || ''); if (!id || !state.seenOrderEvents.has(id)) { if (id) { state.seenOrderEvents.add(id); if (state.seenOrderEvents.size > 200) state.seenOrderEvents.delete(state.seenOrderEvents.values().next().value); }
        toast(`Nouvelle commande reçue${data.reference ? ` : ${data.reference}` : ''}.`); playNotificationSound(); }
      if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
        try { const notification = new Notification('Nouvelle commande reçue', { body: data.reference || 'Ouvrez votre espace marchand.', icon: '/icons/oymike-brand/oymike-192.png', tag: `merchant-order-${id}`, data: { url: `/merchant/?order=${encodeURIComponent(id)}` } }); notification.onclick = () => { window.focus(); location.assign(`/merchant/?order=${encodeURIComponent(id)}`); }; } catch (_) {}
      }
    }
    // Temps réel : le tableau de commandes se met à jour même si l'onglet Commandes est fermé,
    // pour que le compteur de nouvelles commandes soit juste au retour sur la rubrique.
    Promise.all([loadStats(), loadNotifications(), loadOrders(), state.activeTab === 'orders' ? loadCustomerBlocks() : Promise.resolve()]).catch(() => {});
  }
  function closeEvents() { if (state.eventSource) { state.eventSource.close(); state.eventSource = null; } }
  function connectEvents() {
    closeEvents(); if (!('EventSource' in window)) { $('#liveStatus').textContent = 'Le direct n’est pas pris en charge; actualisation périodique active.'; return; }
    state.eventSource = new EventSource('/api/merchant/events');
    state.eventSource.addEventListener('open', () => { $('#liveStatus').textContent = navigator.onLine ? 'Connexion en direct active; les notifications se synchronisent automatiquement.' : 'Hors ligne; les commandes restent enregistrées sur le serveur.'; loadNotifications().catch(() => {}); });
    state.eventSource.addEventListener('commerce', (event) => { let data = {}; try { data = JSON.parse(event.data); } catch (_) {} handleLiveEvent(data); });
    state.eventSource.onerror = () => { $('#liveStatus').textContent = navigator.onLine ? 'Reconnexion aux notifications…' : 'Hors ligne; reconnexion automatique au retour du réseau.'; };
  }
  async function registerMerchantPwa() {
    if (!('serviceWorker' in navigator)) return;
    try { state.serviceWorkerRegistration = await navigator.serviceWorker.register('/merchant/sw.js', { scope: '/merchant/' }); await navigator.serviceWorker.ready; }
    catch (_) { /* the app remains fully usable without PWA support */ }
  }
  async function loadPushConfig() {
    if (state.pushConfigLoaded) return state.pushConfig;
    try {
      state.pushConfig = await api('/api/merchant/push/config');
      if (!state.pushConfig.enabled || !state.pushConfig.publicKey) $('#pushStatus').textContent = 'Le serveur n’a pas encore configuré le push hors application. Les notifications dans la page restent actives; aucune autorisation navigateur ne sera demandée.';
      else $('#pushStatus').textContent = 'Le serveur prend en charge les alertes hors application. Cliquez sur « Activer les notifications » pour que le navigateur vous demande explicitement votre accord.';
    } catch (error) {
      state.pushConfig = { enabled: false, publicKey: '' }; state.pushConfigLoaded = false; $('#pushStatus').textContent = `Vérification push impossible : ${error.message}. Les notifications en direct restent disponibles.`;
      return state.pushConfig;
    }
    state.pushConfigLoaded = true; return state.pushConfig;
  }
  async function configurePush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) { toast('Les notifications hors de l’application ne sont pas prises en charge par ce navigateur; le direct reste actif ici.'); return; }
    if (!state.pushConfigLoaded) {
      $('#pushStatus').textContent = 'Vérification de la configuration du serveur…'; await loadPushConfig();
      if (state.pushConfigLoaded) { toast('Configuration vérifiée. Appuyez de nouveau sur « Activer les notifications » pour confirmer votre choix.'); return; }
      toast('La configuration ne peut pas être vérifiée actuellement. Aucune autorisation n’a été demandée.'); return;
    }
    const config = state.pushConfig;
    if (!config?.enabled || !config.publicKey) { $('#pushStatus').textContent = 'Les notifications push hors application ne sont pas configurées sur le serveur. Les alertes en direct et le compteur restent actifs.'; toast('Push serveur non configuré; aucune autorisation navigateur n’a été demandée.'); return; }
    try {
      // No network await occurs before requestPermission, so the explicit click keeps its user activation.
      const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
      if (permission !== 'granted') { $('#pushStatus').textContent = 'Autorisation refusée. Vous pouvez l’activer dans les réglages du navigateur.'; return; }
      const registration = state.serviceWorkerRegistration || await navigator.serviceWorker.ready;
      const keyText = config.publicKey.replace(/-/g,'+').replace(/_/g,'/'); const key = Uint8Array.from(atob(keyText), (char) => char.charCodeAt(0));
      let subscription = await registration.pushManager.getSubscription(); if (!subscription) subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      await api('/api/merchant/push/subscriptions', { method: 'POST', body: JSON.stringify(subscription.toJSON()) });
      $('#pushStatus').textContent = 'Notifications push activées sur cet appareil. Vous pouvez les désactiver dans les réglages du navigateur.'; toast('Notifications activées.');
    } catch (error) { $('#pushStatus').textContent = `Activation impossible : ${error.message}`; toast(error.message); }
  }
  async function loadAppData(merchant) {
    // Mission 10 : l'écran s'affiche d'abord, les données arrivent ensuite en parallèle.
    // Avant, quatre requêtes en cascade (boutique → produits+stats+notifications) retenaient
    // tout l'écran. Le contenu est le même, seul l'ordre d'affichage change.
    showApp(merchant);
    const dataReady = Promise.all([loadStore(), loadPushConfig()]).catch((error) => toast(error.message));
    registerMerchantPwa().catch(() => {}); connectEvents();
    await dataReady;
    const target = new URLSearchParams(location.search).get('order');
    if (target) { state.deepLinkOrderId = target; await tab('orders'); history.replaceState(null, '', '/merchant/'); }
    if (!state.pollTimer) state.pollTimer = setInterval(() => {
      if (!document.hidden) { loadStats().catch(() => {}); loadNotifications().catch(() => {}); if (state.activeTab === 'orders') Promise.all([loadOrders(), loadCustomerBlocks()]).catch(() => {}); }
    }, 30_000);
  }
  async function boot() {
    registerMerchantPwa();
    try { const result = await api('/api/merchant/auth/me'); const merchant = result.data; if (merchant.mustChangePassword) showPasswordGate(); else await loadAppData(merchant); }
    catch (error) { showLogin(!navigator.onLine ? 'Vous êtes hors ligne. Reconnectez-vous pour charger votre compte et synchroniser les commandes.' : (error.message || 'Impossible de charger votre session.')); }
  }

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    const error = $('#loginError'); error.hidden = true;
    try { const response = await api('/api/merchant/auth/login', { method: 'POST', body: JSON.stringify({ username: $('#loginUsername').value.trim(), password: $('#loginPassword').value }) });
      if (response.data?.mustChangePassword) showPasswordGate(); else await loadAppData(response.data); }
    catch (e) { error.textContent = e.message; error.hidden = false; }
    finally { button.disabled = false; }
  });
  // Mission 7 : le code marchand fait exactement 6 chiffres. Le contrôle est refait côté serveur,
  // celui-ci ne sert qu'à éviter un aller-retour inutile.
  const PIN6 = /^[0-9]{6}$/;
  const WEAK_PINS = new Set(['000000','111111','222222','333333','444444','555555','666666','777777','888888','999999','123456','654321','121212','112233','123123']);
  function pinProblem(pin) {
    if (!PIN6.test(pin)) return 'Le code doit comporter exactement 6 chiffres (0 à 9), sans espace ni lettre.';
    if (WEAK_PINS.has(pin)) return 'Ce code est trop facile à deviner. Choisissez-en un autre.';
    return '';
  }
  $('#passwordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const password = $('#newPassword').value; const confirmPassword = $('#confirmPassword').value; const message = $('#passwordError');
    if (password !== confirmPassword) { message.textContent = 'Les deux codes ne correspondent pas.'; message.hidden = false; return; }
    const problem = pinProblem(password);
    if (problem) { message.textContent = problem; message.hidden = false; return; }
    const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    try { const result = await api('/api/merchant/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: $('#gateCurrentPassword').value, password, confirmPassword }) }); $('#gateCurrentPassword').value = ''; await loadAppData(result.data); }
    catch (error) { message.textContent = error.message; message.hidden = false; }
    finally { button.disabled = false; }
  });
  // Mon compte → Sécurité : affichage du compte, changement de mot de passe autonome et demande de réinitialisation.
  function accountMessage(text, ok = false) { const node = $('#accountPasswordMessage'); node.textContent = text; node.className = `message${ok ? ' success' : ' error'}`; node.hidden = !text; }
  async function renderAccount() {
    const me = state.merchant || {}; const store = state.store || {};
    $('#accountDisplayName').textContent = me.displayName || '—';
    $('#accountUsername').textContent = me.username ? `@${me.username}` : '—';
    $('#accountStore').textContent = store.name || '—';
    $('#accountStatus').textContent = me.status === 'suspended' ? 'Suspendu' : 'Actif';
    return true;
  }
  $$('[data-toggle-password]').forEach((button) => button.addEventListener('click', () => {
    const input = $(`#${button.dataset.togglePassword}`); if (!input) return;
    const show = input.type === 'password'; input.type = show ? 'text' : 'password';
    button.textContent = show ? 'Masquer' : 'Afficher'; button.setAttribute('aria-pressed', String(show));
  }));
  $('#accountPasswordForm').addEventListener('submit', async (event) => {
    event.preventDefault(); accountMessage('');
    const currentPassword = $('#currentPassword').value; const password = $('#accountNewPassword').value; const confirmPassword = $('#accountConfirmPassword').value;
    if (!currentPassword) return accountMessage('Saisissez votre code actuel.');
    const problem = pinProblem(password);
    if (problem) return accountMessage(problem);
    if (password !== confirmPassword) return accountMessage('Les deux codes ne correspondent pas.');
    if (password === currentPassword) return accountMessage('Choisissez un code différent du code actuel.');
    const button = $('button[type="submit"]', event.currentTarget); button.disabled = true; button.textContent = 'Enregistrement…';
    try {
      const result = await api('/api/merchant/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword, password, confirmPassword }) });
      $('#accountPasswordForm').reset(); accountMessage('Code modifié. Les autres sessions de ce compte ont été fermées ; celle-ci reste active.', true);
      toast('Code mis à jour.');
      if (result?.data) { state.merchant = { ...state.merchant, ...result.data }; renderAccount().catch(() => {}); }
    } catch (error) { accountMessage(error.message || 'Le mot de passe n’a pas pu être modifié.'); }
    finally { button.disabled = false; button.textContent = 'Enregistrer le nouveau code'; }
  });
  $('#accountRequestReset').addEventListener('click', async () => {
    const node = $('#accountResetNotice'); node.hidden = false; node.className = 'message';
    const button = $('#accountRequestReset'); button.disabled = true;
    try {
      const result = await api('/api/merchant/auth/password-reset-request', { method: 'POST', body: '{}' });
      node.className = 'message success';
      node.textContent = result.message || 'Votre demande est enregistrée. Un gestionnaire autorisé doit vérifier votre identité avant d’émettre un mot de passe temporaire.';
    } catch (error) {
      node.className = 'message error';
      node.textContent = `${error.message} Vous pouvez aussi contacter directement votre gestionnaire ou l’Administrateur général.`;
    } finally { button.disabled = false; }
  });
  // Mission 11 : « Se déconnecter » demande confirmation, ferme la session côté serveur,
  // revient à l'écran de connexion et ne touche ni au compte, ni aux données, ni à l'historique.
  async function logout() {
    try { await api('/api/merchant/auth/logout', { method: 'POST', body: '{}' }); } catch (_) {}
    closeEvents();
    document.body.dataset.wsApp = 'false';
    try { window.history.replaceState({}, '', '/merchant/'); } catch (_) {}
    setNotice('');
    showLogin('Vous avez été déconnecté. Vos données et votre historique sont conservés.');
    window.scrollTo?.({ top: 0, behavior: 'auto' });
  }
  const askLogout = () => (window.WorkspaceShell ? window.WorkspaceShell.confirmLogout(logout) : logout());
  window.__wsLogout = askLogout;
  // installLogout pose l'icône + le libellé ET branche le clic sur la confirmation : aucun second
  // gestionnaire ici (sinon un seul clic ouvrirait deux dialogues / déconnecterait trop vite).
  if (window.WorkspaceShell?.installLogout) window.WorkspaceShell.installLogout($('#logoutButton'), logout);
  else $('#logoutButton').addEventListener('click', logout);
  $('#passwordLogout').addEventListener('click', askLogout);
  // Mission 14 : certains boutons portent la classe .tab SANS data-tab (les onglets internes
  // d'Opérations utilisent data-ops-tab). Ils appelaient tab(undefined), ce qui masquait TOUS les
  // panneaux : écran vide inexplicable. On ne branche que les vrais onglets.
  $$('.tab').forEach((button) => {
    if (!button.dataset.tab) return;
    button.addEventListener('click', () => tab(button.dataset.tab));
  });
  $('#newProductButton').addEventListener('click', () => { clearProductForm(); loadCatalogUnits().catch(() => {}); openProductEditor(true); });
  document.addEventListener('click', (event) => {
    const chip = event.target.closest?.('[data-product-category]');
    if (!chip) return;
    const filter = $('#productCategoryFilter'); if (!filter) return;
    const value = chip.dataset.productCategory === 'Sans catégorie' ? '' : chip.dataset.productCategory;
    filter.value = filter.value === value ? '' : value;
    filter.dispatchEvent(new Event('change', { bubbles: true }));
    renderProductCategories();
  });
  $('#cancelProductEdit').addEventListener('click', () => { clearProductForm(); openProductEditor(false); });
  // §8 : « Actualiser » recharge la liste des commandes ET le compteur, avec retour visuel.
  $('#refreshOrders').addEventListener('click', async (event) => {
    const button = event.currentTarget;
    if (button.disabled) return;
    button.disabled = true; const label = button.textContent; button.textContent = 'Actualisation…';
    try {
      await Promise.all([loadOrders(), loadStats()]);
      window.WorkspaceUI?.refreshOrderCounter?.();
      toast('Commandes actualisées.');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; button.textContent = label; }
  });
  $('#customerBlockForm').addEventListener('submit', createCustomerBlock);
  $('#refreshCustomerBlocks').addEventListener('click', () => loadCustomerBlocks().catch((e) => toast(e.message)));
  $('#customerBlockStatus').addEventListener('change', () => loadCustomerBlocks().catch((e) => toast(e.message)));
  $('#customerBlockSearch').addEventListener('input', () => { clearTimeout(state.blockSearchTimer); state.blockSearchTimer = setTimeout(() => loadCustomerBlocks().catch((e) => toast(e.message)), 250); });
  $('#orderStatusFilter').addEventListener('change', () => loadOrders().catch((e) => toast(e.message)));
  $('#orderSearch').addEventListener('input', () => { clearTimeout(state.searchTimer); state.searchTimer = setTimeout(() => loadOrders().catch((e) => toast(e.message)), 250); });
  $('#storeLogoFile').addEventListener('change', (event) => { const file = event.target.files?.[0]; event.target.value = ''; chooseSingleImage(file, 'logo'); });
  $('#storeCoverFile').addEventListener('change', (event) => { const file = event.target.files?.[0]; event.target.value = ''; chooseSingleImage(file, 'cover'); });
  $('#productImageFile').addEventListener('change', (event) => { const files = [...(event.target.files || [])]; event.target.value = ''; chooseProductImages(files); });
  $('#removeStoreLogo').addEventListener('click', async () => { const old = $('#storeLogoData').value; attachStoreLogo(''); if (state.uploadedMedia.has(old)) await discardUnusedMedia(old); updateMediaStatus('storeLogoStatus', 'Logo retiré de la sélection. Enregistrez pour confirmer la suppression.'); applyThemePreview(); });
  $('#removeStoreCover').addEventListener('click', async () => { const old = $('#storeCoverData').value; attachStoreCover(''); if (state.uploadedMedia.has(old)) await discardUnusedMedia(old); updateMediaStatus('storeCoverStatus', 'Couverture retirée de la sélection. Enregistrez pour confirmer la suppression.'); applyThemePreview(); });
  $('#themeFont').addEventListener('input',updateFontPreview); $('#themeFont').addEventListener('change',updateFontPreview);
  $$('#themeForm input, #themeForm select').forEach((node) => node.addEventListener('input', applyThemePreview));
  $$('#themeForm input, #themeForm select').forEach((node) => node.addEventListener('change', applyThemePreview));
  $('#storeName').addEventListener('input', applyThemePreview);
  $('#storeSector').addEventListener('change',()=>syncTablePhotoRequirement());
  $('#storeLogoData').addEventListener('change', applyThemePreview); $('#storeCoverData').addEventListener('change', applyThemePreview);
  $('#previewMobile').addEventListener('click', () => { $('#storeThemePreview').dataset.viewport = 'mobile'; $('#previewMobile').classList.add('active'); $('#previewDesktop').classList.remove('active'); applyThemePreview(); });
  $('#previewDesktop').addEventListener('click', () => { $('#storeThemePreview').dataset.viewport = 'desktop'; $('#previewDesktop').classList.add('active'); $('#previewMobile').classList.remove('active'); applyThemePreview(); });
  $('#resetThemeButton').addEventListener('click', async () => {
    if (!window.confirm('Réinitialiser uniquement le thème et les réglages typographiques de cette boutique ? Les informations, produits et commandes ne seront pas effacés.')) return;
    setThemeControls(defaultTheme); applyThemePreview();
    if (!state.store) { $('#themeSaveState').textContent = 'Modèle initial prêt; enregistrez d’abord la boutique.'; return; }
    const button = $('#resetThemeButton'); button.disabled = true; $('#themeSaveState').textContent = 'Réinitialisation…';
    try {
      const result = await api('/api/merchant/store', { method: 'PUT', body: JSON.stringify({ theme: defaultTheme }) });
      state.store = result.data; $('#themeSaveState').textContent = 'Thème initial réinitialisé et enregistré.'; toast('Seuls les réglages du thème ont été réinitialisés; les données commerciales sont conservées.');
    } catch (error) {
      setThemeControls(state.store.theme || defaultTheme); applyThemePreview(); $('#themeSaveState').textContent = 'Échec de la réinitialisation'; toast(error.message);
    } finally { button.disabled = false; }
  });
  // Mission 10 : le compteur de notifications de la tuile « Commandes » reprend le même calcul.
  window.__wsNotificationCount = (count) => { const badge = $('#tileOrdersCount'); if (!badge || Number($('#tileOrdersCount')?.dataset.pending || 0) > 0) return; badge.textContent = String(count); badge.hidden = !count; };
  $('#refreshNotifications').addEventListener('click', () => loadNotifications().catch((e) => toast(e.message)));
  $('#enablePushButton').addEventListener('click', configurePush);
  const soundToggle = $('#notificationSound'); try { soundToggle.checked = localStorage.getItem('oymike-merchant-sound') === 'true'; } catch (_) { soundToggle.checked = false; }
  soundToggle.addEventListener('change', () => { try { localStorage.setItem('oymike-merchant-sound', String(soundToggle.checked)); } catch (_) {} toast(soundToggle.checked ? 'Son facultatif activé sur cet appareil.' : 'Son désactivé.'); });
  // Le menu par rubriques gère lui-même ses propres boutons ; ce sélecteur ne vise que les
  // anciens liens « aller à l'onglet » restés dans les panneaux.
  $$('[data-go-tab]:not([data-ws-bound])').forEach((button) => { button.dataset.wsBound = '1'; button.addEventListener('click', () => tab(button.dataset.goTab)); });
  // Cartes de commandes : actions rapides et ouverture du détail par la fiche complète existante.
  document.addEventListener('click', (event) => {
    const next = event.target.closest?.('[data-order-next]');
    if (next) {
      // §4.3 : sur une commande non réglée, l'unique action est « Valider et confirmer le
      // paiement ». Elle ouvre une confirmation qui exige le moyen de paiement réellement reçu :
      // aucun paiement n'est déclaré sans que l'employé l'ait constaté.
      if (next.dataset.orderStatus === 'settle') { settleOrder(next.dataset.orderNext); return; }
      setOrderStatus(next.dataset.orderNext, next.dataset.orderStatus);
      return;
    }
    const detail = event.target.closest?.('[data-order-detail]');
    if (detail) {
      const card = document.querySelector(`#order-${CSS.escape(detail.dataset.orderDetail)}`);
      const more = $('#wsOrderBoardMore');
      if (card) { if (more) more.open = true; card.scrollIntoView?.({ behavior: 'smooth', block: 'center' }); card.classList.add('is-focused'); setTimeout(() => card.classList.remove('is-focused'), 2200); }
    }
  });
  // ======================================================================================
  // §4.3 — « Valider et confirmer le paiement » : une action, deux traces (validation + paiement).
  // Le dialogue demande le moyen de paiement RÉELLEMENT utilisé et le montant RÉELLEMENT reçu.
  // Un paiement électronique n'est jamais marqué payé sans confirmation du prestataire : le
  // serveur refuse alors explicitement, et le message est affiché tel quel.
  // ======================================================================================
  async function settleOrder(orderId) {
    const existing = document.getElementById('orderSettleDialog');
    existing?.remove();
    const dialog = document.createElement('div');
    dialog.id = 'orderSettleDialog';
    dialog.className = 'ws-dialog-backdrop';
    dialog.innerHTML = `
      <div class="ws-dialog order-settle" role="dialog" aria-modal="true" aria-labelledby="settleTitle">
        <h2 id="settleTitle">Valider et confirmer le paiement</h2>
        <p class="muted">La commande sera validée et son paiement enregistré en une seule opération. Le montant est celui réellement reçu, pas celui affiché sur le ticket.</p>
        <form id="orderSettleForm">
          <label for="settleMethod">Moyen de paiement reçu</label>
          <select id="settleMethod" required>
            <option value="">Choisir…</option>
            <option value="cash">Espèces (comptoir)</option>
            <option value="mobile_money">Mobile Money</option>
            <option value="card">Carte bancaire</option>
            <option value="transfer">Virement</option>
            <option value="other">Autre moyen confirmé</option>
          </select>
          <label for="settleAmount">Montant reçu (XOF)</label>
          <input id="settleAmount" type="number" min="0" step="1" inputmode="numeric" placeholder="Montant exact de la commande">
          <label for="settleReason">Motif (si le montant reçu diffère du total)</label>
          <input id="settleReason" maxlength="300" placeholder="Ex. geste commercial, arrondi">
          <p class="order-settle-error" id="settleError" role="alert" hidden></p>
          <div class="ws-dialog-actions">
            <button type="button" class="button outline" data-settle-cancel>Annuler</button>
            <button type="submit" class="button primary">Valider et confirmer le paiement</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(dialog);
    const close = () => dialog.remove();
    dialog.querySelector('[data-settle-cancel]').addEventListener('click', close);
    dialog.addEventListener('click', (event) => { if (event.target === dialog) close(); });
    const error = dialog.querySelector('#settleError');
    dialog.querySelector('#orderSettleForm').addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = dialog.querySelector('button[type="submit"]');
      if (submit.disabled) return;                       // double clic impossible
      const body = { method: dialog.querySelector('#settleMethod').value,
        receivedXof: dialog.querySelector('#settleAmount').value === '' ? undefined : Number(dialog.querySelector('#settleAmount').value),
        reason: dialog.querySelector('#settleReason').value.trim() };
      if (!body.method) { error.textContent = 'Choisissez le moyen de paiement réellement utilisé.'; error.hidden = false; return; }
      submit.disabled = true; submit.textContent = 'Enregistrement…';
      error.hidden = true;
      try {
        const result = await api(`/api/merchant/orders/${encodeURIComponent(orderId)}/settle`, { method: 'POST', body: JSON.stringify(body) });
        close();
        toast(result.data?.warning ? `Commande validée. ${result.data.warning}` : 'Commande validée et paiement confirmé.', 'success');
        await Promise.all([loadOrders(), loadStats()]).catch(() => {});
        document.dispatchEvent(new CustomEvent('qria:orders-changed'));
      } catch (failure) {
        error.textContent = failure.message || 'Impossible de valider cette commande.';
        error.hidden = false;
        submit.disabled = false; submit.textContent = 'Valider et confirmer le paiement';
      }
    });
    dialog.querySelector('#settleMethod').focus();
  }

  window.addEventListener('online', () => { setNotice('Connexion rétablie. Synchronisation des données…', true); state.pushConfigLoaded = false; if (!appView.hidden) Promise.all([loadStats(), loadNotifications(), loadPushConfig(), state.activeTab === 'orders' ? Promise.all([loadOrders(), loadCustomerBlocks()]) : Promise.resolve()]).finally(() => { if (navigator.onLine) setTimeout(() => setNotice('', false), 1800); }); });
  window.addEventListener('offline', () => { setNotice('Vous êtes hors ligne. L’espace peut s’ouvrir, mais les commandes et changements seront synchronisés au retour du réseau.', true); $('#liveStatus').textContent = 'Hors ligne; les données se resynchronisent après reconnexion.'; });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !appView.hidden) { loadStats().catch(() => {}); loadNotifications().catch(() => {}); if (state.activeTab === 'orders') Promise.all([loadOrders(), loadCustomerBlocks()]).catch(() => {}); } });

  // ======================================================================================
  // Catalogue général : activités du compte, modèles proposés, ajout avec prix marchand.
  // Aucun prix n'est repris du catalogue ni d'un autre marchand.
  // ======================================================================================
  async function loadCatalogTab() {
    await Promise.all([loadCatalogActivities(), loadCatalogUnits()]);
    await refreshCatalogModels();
    renderCatalogActivities();
  }

  async function loadCatalogUnits() {
    if (state.catalog.units.length) return;
    const result = await api('/api/merchant/meta/units');
    state.catalog.units = result.data.units || [];
    state.catalog.volumes = result.data.volumes || [];
    const unitSelect = $('#productUnit');
    if (unitSelect && !unitSelect.options.length) {
      unitSelect.innerHTML = state.catalog.units.map((unit) => `<option value="${esc(unit.code)}">${esc(unit.label)}</option>`).join('');
    }
    const list = $('#volumeOptions');
    if (list && !list.children.length) {
      list.innerHTML = state.catalog.volumes.map((v) => `<option value="${esc(v.label)}"></option>`).join('');
    }
  }

  async function loadCatalogActivities() {
    const [mine, all] = await Promise.all([api('/api/merchant/domains'), api('/api/merchant/activity-domains')]);
    state.catalog.domains = all.data || [];
    state.catalog.mine = mine.data || { domains: [], domainIds: [], primaryId: '' };
    state.catalog.activitiesLoaded = true;
  }

  function renderCatalogActivities() {
    const node = $('#catalogActivities');
    if (!node) return;
    const mine = state.catalog.mine || { domains: [] };
    if (!mine.domains.length) {
      node.innerHTML = '<p class="empty">Aucune activité enregistrée. Choisissez votre activité principale.</p>';
      $('#catalogActivitiesForm').hidden = false;
      return;
    }
    node.innerHTML = mine.domains.map((domain, index) => `<span class="chip${index === 0 ? ' chip-primary' : ''}">${index === 0 ? '★ ' : ''}${esc(domain.label || domain.code)}${index === 0 ? ' <small>(principale)</small>' : ''}</span>`).join('');
    $('#catalogActivitiesHint').textContent = 'Le catalogue réunit les produits de toutes vos activités, sans doublon.';
  }

  function familyOptions(selected = '') {
    const families = ['Restauration et boissons', 'Commerce et distribution', 'Services et autres'];
    const extra = [...new Set(state.catalog.domains.map((d) => d.family).filter((f) => f && !families.includes(f)))];
    return [...families, ...extra].map((family) => {
      const items = state.catalog.domains.filter((d) => d.family === family && d.isActive !== false);
      if (!items.length) return '';
      return `<optgroup label="${esc(family)}">${items.map((d) => `<option value="${esc(d.id)}"${d.id === selected ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</optgroup>`;
    }).join('');
  }

  function openActivitiesEditor() {
    if (!state.catalog.activitiesLoaded) return loadCatalogTab();
    const mine = state.catalog.mine || { domains: [] };
    const primary = mine.domains[0]?.domainId || '';
    const secondaries = new Set(mine.domains.slice(1).map((d) => d.domainId));
    $('#catalogPrimaryDomain').innerHTML = `<option value="">Choisissez…</option>${familyOptions(primary)}`;
    $('#catalogSecondaryDomains').innerHTML = familyOptions('');
    [...$('#catalogSecondaryDomains').options].forEach((option) => {
      option.selected = secondaries.has(option.value);
      if (option.value === primary) option.disabled = true;
    });
    $('#catalogActivitiesForm').hidden = false;
    $('#editActivitiesButton').hidden = true;
  }

  function closeActivitiesEditor() {
    $('#catalogActivitiesForm').hidden = true;
    $('#editActivitiesButton').hidden = false;
  }

  async function refreshCatalogModels() {
    const search = $('#catalogSearch')?.value.trim() || '';
    const category = $('#catalogCategoryFilter')?.value || '';
    const query = new URLSearchParams(); if (search) query.set('search', search); if (category) query.set('category', category);
    const result = await api(`/api/merchant/catalog/products${query.toString() ? `?${query}` : ''}`);
    state.catalog.models = result.data || [];
    state.catalog.selected.clear();
    const categories = await api('/api/merchant/catalog/categories').catch(() => ({ data: [] }));
    state.catalog.categories = categories.data || [];
    const filter = $('#catalogCategoryFilter');
    if (filter && filter.options.length <= 1) {
      filter.innerHTML = '<option value="">Toutes les catégories</option>' + state.catalog.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.label)}</option>`).join('');
    }
    renderCatalogModels();
  }

  function renderCatalogModels() {
    const node = $('#catalogModelList'); if (!node) return;
    const models = state.catalog.models;
    if (!models.length) { node.innerHTML = '<p class="empty">Aucun modèle pour cette recherche.</p>'; updateCatalogSelection(); return; }
    node.innerHTML = models.map((model) => `
      <article class="catalog-model" data-model="${esc(model.id)}">
        <label class="catalog-check"><input type="checkbox" data-model-check="${esc(model.id)}" aria-label="Sélectionner ${esc(model.name)}"></label>
        <img class="catalog-thumb" src="${esc(model.imageUrl || '/media/catalogue/placeholder.svg')}" alt="${esc(model.name)}" loading="lazy" width="64" height="64">
        <div class="catalog-model-body">
          <strong>${esc(model.name)}</strong>
          <span class="muted">${esc([model.brand, model.variant, model.volumeLabel].filter(Boolean).join(' · '))}</span>
          <span class="muted">${esc(model.categoryLabel || '')}${model.unit ? ` · ${esc(model.unit)}` : ''}</span>
        </div>
        <div class="catalog-model-price"><label for="price-${esc(model.id)}">Votre prix (XOF)</label><input id="price-${esc(model.id)}" type="number" min="0" step="1" inputmode="numeric" data-model-price="${esc(model.id)}" placeholder="0"></div>
      </article>`).join('');
    $$('[data-model-check]').forEach((box) => box.addEventListener('change', () => {
      if (box.checked) state.catalog.selected.add(box.dataset.modelCheck); else state.catalog.selected.delete(box.dataset.modelCheck);
      updateCatalogSelection();
    }));
    updateCatalogSelection();
  }

  function updateCatalogSelection() {
    const count = state.catalog.selected.size;
    const label = $('#catalogSelectionCount'); const button = $('#catalogBulkAdd');
    if (label) label.textContent = count ? `${count} modèle${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}` : 'Aucun modèle sélectionné';
    if (button) button.disabled = count === 0;
  }

  async function addSelectedModels() {
    const button = $('#catalogBulkAdd'); button.disabled = true;
    try {
      const items = []; const missing = [];
      state.catalog.selected.forEach((id) => {
        const input = $(`[data-model-price="${CSS.escape(id)}"]`);
        const price = Number(input?.value);
        if (!Number.isFinite(price) || price <= 0) { missing.push(id); return; }
        items.push({ id, priceXof: Math.round(price) });
      });
      if (missing.length) throw new Error(`Indiquez un prix pour ${missing.length} modèle(s) sélectionné(s).`);
      const result = await api('/api/merchant/catalog/products/bulk-add', { method: 'POST', body: JSON.stringify({ items }) });
      if (result.data.errors?.length) toast(`${result.data.created} ajouté(s), ${result.data.errors.length} refusé(s).`);
      else toast(`${result.data.created} produit(s) ajouté(s) à votre boutique.`);
      await Promise.all([refreshCatalogModels(), loadProducts().catch(() => {})]);
    } finally { button.disabled = state.catalog.selected.size === 0; }
  }

  $('#editActivitiesButton')?.addEventListener('click', openActivitiesEditor);
  $('#cancelActivitiesEdit')?.addEventListener('click', closeActivitiesEditor);
  $('#refreshCatalogModels')?.addEventListener('click', () => refreshCatalogModels().catch((e) => toast(e.message)));
  $('#catalogBulkAdd')?.addEventListener('click', () => addSelectedModels().catch((e) => toast(e.message)));
  let catalogSearchTimer = 0;
  $('#catalogSearch')?.addEventListener('input', () => { clearTimeout(catalogSearchTimer); catalogSearchTimer = setTimeout(() => refreshCatalogModels().catch(() => {}), 350); });
  $('#catalogCategoryFilter')?.addEventListener('change', () => refreshCatalogModels().catch((e) => toast(e.message)));
  $('#catalogPrimaryDomain')?.addEventListener('change', () => {
    const primary = $('#catalogPrimaryDomain').value;
    [...$('#catalogSecondaryDomains').options].forEach((option) => { if (option.value === primary) { option.disabled = true; option.selected = false; } else option.disabled = false; });
  });
  $('#catalogActivitiesForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const primary = $('#catalogPrimaryDomain').value;
    if (!primary) return toast('Choisissez votre activité principale.');
    const domainIds = [primary, ...[...$('#catalogSecondaryDomains').selectedOptions].map((o) => o.value).filter((v) => v && v !== primary)];
    try {
      const result = await api('/api/merchant/domains', { method: 'PUT', body: JSON.stringify({ domainIds }) });
      toast(`Activités enregistrées. ${result.data.categoriesCreated} catégorie(s) préparée(s).`);
      closeActivitiesEditor();
      await Promise.all([loadCatalogActivities().then(renderCatalogActivities), refreshCatalogModels()]);
    } catch (error) { toast(error.message); }
  });
  boot();
})();
