(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  // Older engines/JSDOM builds do not expose CSS.escape; fall back to a safe attribute escape.
  const cssEscape = (value) => (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') ? CSS.escape(String(value)) : String(value).replace(/["\\]/g, '\\$&');
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { slug: decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || ''), store: null, products: [], ads: [], rewardCampaigns: [], servicePointCode: new URLSearchParams(location.search).get('servicePoint') || '', servicePoint: null, orderPolicy: { trackingEnabled: true, clientCancellationEnabled: true, clientBrowserNotifications: true }, cart: new Map(), pendingQuantities: new Map(), productNodes: new Map(), renderedProductIds: '', toastTimer: 0, orderDraft: null, orderPending: false, submitting: false, selectedCategory: '', photoIndexes: new Map(), sectorCopy: null, orderMode: '', tableNo: '', tableExtra: '', tablePhotoData: '', pendingTablePhoto: '', cameraStream: null };
  const MODE_LABELS = Object.freeze({ dine_in: 'Sur place', pickup: 'À emporter / retrait', delivery: 'Livraison', other: 'Autre remise' });
  const SECTOR_COPY = {
    general: { label:'CATALOGUE OYMIKE TECH', eyebrow:'PRODUITS', title:'Le catalogue', noun:'produit', search:'Rechercher un produit', add:'Ajouter au panier', address:'Ex. Retrait à la boutique ou livraison à Cocody' },
    restaurant: { label:'MENU DU RESTAURANT', eyebrow:'À LA CARTE', title:'Plats et boissons', noun:'article', search:'Rechercher un plat ou une boisson', add:'Ajouter au panier', address:'Ex. Sur place, à emporter ou livraison à Cocody' },
    maquis: { label:'MENU DU MAQUIS', eyebrow:'MENU', title:'Plats, boissons et grillades', noun:'article', search:'Rechercher un plat, une boisson…', add:'Ajouter au panier', address:'Ex. Table, emporter ou livraison à Cocody' },
    hardware: { label:'QUINCAILLERIE · CATALOGUE', eyebrow:'MATÉRIEL', title:'Matériel et fournitures', noun:'article', search:'Rechercher un outil ou matériau', add:'Ajouter au panier', address:'Ex. Retrait au comptoir ou livraison à Cocody' },
    clothing: { label:'COLLECTION · VÊTEMENTS', eyebrow:'COLLECTION', title:'Vêtements et accessoires', noun:'pièce', search:'Rechercher une pièce ou une taille', add:'Ajouter au panier', address:'Ex. Retrait en boutique ou livraison à Cocody' },
    outdoor: { label:'ESPACE PLEIN AIR · CATALOGUE', eyebrow:'PLEIN AIR', title:'Équipements et activités de plein air', noun:'article', search:'Rechercher un article de plein air', add:'Ajouter au panier', address:'Ex. Retrait en boutique ou livraison à Cocody' },
  };
  const SERVICE_POINT_TYPE_LABELS = Object.freeze({ table:'Table', counter:'Comptoir', location:'Emplacement', salon:'Salon' });
  const servicePointTypeLabel = (type) => SERVICE_POINT_TYPE_LABELS[type] || 'Emplacement';
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const FONT_FAMILIES = new Set(['Poppins','Montserrat','Roboto','Open Sans','Lato','Inter','Nunito','Raleway','Ubuntu','Oswald','Playfair Display','Merriweather','Source Sans 3','DM Sans','Manrope','Rubik','Work Sans','Lora','Libre Baskerville','Archivo']);
  const TYPOGRAPHY_TARGETS = {
    shopName:['#shopName'], title:['.catalogue-head h2','.checkout-title h2','.section-title h2'], subtitle:['.catalogue-head p'], product:['.public-product-content h3'],
    price:['.public-price strong','.cart-total strong','.tracking-total strong'], description:['#shopDescription','.public-product-content p'], category:['.category-chip','.public-category'],
    button:['.button'], advertisement:['.shop-ad .eyebrow','.shop-ad p','.shop-ad .button'], delivery:['.shop-contact','.shop-hours','.shop-delivery-fee','.shop-service-point','.checkout-note'],
    promotion:['.reward-card h3','.reward-card p','.reward-card small','.reward-claim-form label','.reward-result'], other:['.shop-footer','.shop-order-notice','.catalogue-head p'],
  };
  function applyTypography() {
    const root=$('#shopContent');if(!root)return;const theme=state.store?.theme||{};const font=FONT_FAMILIES.has(theme.font)?theme.font:'Inter';root.style.fontFamily='"'+font+'", sans-serif';
    const typography=theme.typography||{};
    for(const [key,selectors] of Object.entries(TYPOGRAPHY_TARGETS)){
      const value=typography[key];if(!value)continue;
      for(const selector of selectors)for(const node of root.querySelectorAll(selector)){
        node.style.fontSize=`${Math.max(16,Math.min(30,Number(value.size)||16))}px`;node.style.fontWeight=String(Math.max(300,Math.min(900,Number(value.weight)||400)));
        node.style.fontStyle=value.italic===true?'italic':'normal';node.style.textDecoration=value.decoration==='underline'?'underline':'none';node.style.lineHeight=String(Math.max(.9,Math.min(2.2,Number(value.lineHeight)||1.4)));
        node.style.letterSpacing=`${Math.max(-.05,Math.min(.3,Number(value.letterSpacing)||0))}em`;node.style.textAlign=['left','center','right'].includes(value.align)?value.align:'left';
        node.style.textTransform=['none','uppercase','lowercase','capitalize'].includes(value.transform)?value.transform:'none';node.style.color=/^#[0-9a-f]{6}$/i.test(value.color||'')?value.color:'#162622';node.style.opacity=String(Math.max(.35,Math.min(1,Number(value.opacity)||1)));
      }
    }
  }
  function fetchWithTimeout(url, timeoutMs = 15000) {
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => controller?.abort(), timeoutMs);
    return fetch(url, { cache: 'no-store', ...(controller ? { signal: controller.signal } : {}) })
      .catch((error) => {
        if (error?.name === 'AbortError') throw new Error('La boutique met trop de temps à répondre. Vérifiez votre connexion puis réessayez.');
        throw error;
      })
      .finally(() => clearTimeout(timer));
  }
  function showError(message) { $('#shopLoading').hidden = true; $('#shopContent').hidden = true; $('#shopError').hidden = false; $('#shopErrorText').textContent = message;
    const retry = $('#shopRetry'); if (retry) retry.hidden = false;
    const hint = $('#shopErrorHint'); if (hint) hint.textContent = /hors ligne|connexion|répond/i.test(message) ? 'Votre QR est valide. Le problème vient de la connexion, pas du code.' : 'Le QR reste valide : réessayez, ou demandez le lien direct au marchand.'; }
  function toast(message) { const node = $('#shopToast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3000); }
  function storageKey() { return `oymike-shop-cart:${state.slug}`; }
  function restoreCart() {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey()) || '[]'); if (Array.isArray(saved)) state.cart = new Map(saved.filter((row) => row && typeof row.id === 'string').map((row) => [row.id, Math.min(999, Math.max(1, Number(row.quantity) || 1))])); } catch (_) {}
  }
  function saveCart() { try { sessionStorage.setItem(storageKey(), JSON.stringify([...state.cart].map(([id, quantity]) => ({ id, quantity })))); } catch (_) {} }
  function orderDraftKey() { return `oymike-shop-order:${state.slug}`; }
  function restoreOrderDraft() {
    try {
      const draft = JSON.parse(sessionStorage.getItem(orderDraftKey()) || 'null');
      if (!draft || typeof draft.requestId !== 'string' || typeof draft.fingerprint !== 'string') return false;
      state.orderDraft = draft;
      if (!draft.body || JSON.stringify(draft.body) !== draft.fingerprint || !Array.isArray(draft.body.items)) return false;
      const body = draft.body;
      $('#customerName').value = body.customerName || ''; $('#customerPhone').value = body.customerPhone || '';
      $('#customerEmail').value = body.customerEmail || ''; $('#deliveryAddress').value = body.deliveryAddress || ''; $('#customerNote').value = body.note || '';
      state.orderMode = ['dine_in','pickup','delivery','other'].includes(body.orderMode) ? body.orderMode : '';
      const table = body.tableNumber || parseLegacyTableNumber(body.deliveryAddress || '');
      state.tableNo = table.number; state.tableExtra = table.note;
      state.tablePhotoData=typeof body.tablePhoto==='string'?body.tablePhoto:'';
      state.cart = new Map(body.items.filter((row) => row && typeof row.productId === 'string').map((row) => [row.productId, Math.min(999, Math.max(1, Number(row.quantity) || 1))]));
      saveCart(); state.orderPending = true; return true;
    } catch (_) { return false; }
  }
  // Older drafts stored the table inside the delivery address field; keep them usable.
  function parseLegacyTableNumber(value) {
    const text = String(value || '').trim();
    if (!text) return { number: '', note: '' };
    const match = /^(?:table|comptoir|emplacement|salon)\s+(.+)$/i.exec(text);
    if (match) return { number: match[1].split(' · ')[0].trim(), note: match[1].split(' · ').slice(1).join(' · ').trim() };
    return { number: text.slice(0, 40), note: '' };
  }
  function saveOrderDraft(body) {
    const fingerprint = JSON.stringify(body); let previous = state.orderDraft;
    try { previous = JSON.parse(sessionStorage.getItem(orderDraftKey()) || 'null') || previous; } catch (_) {}
    const requestId = previous?.fingerprint === fingerprint && previous.requestId ? previous.requestId
      : (crypto.randomUUID ? crypto.randomUUID() : `order_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`);
    state.orderDraft = { fingerprint, requestId, body: JSON.parse(fingerprint) };
    try { sessionStorage.setItem(orderDraftKey(), JSON.stringify(state.orderDraft)); } catch (_) {}
    return state.orderDraft;
  }
  function clearOrderDraft() { state.orderDraft = null; try { sessionStorage.removeItem(orderDraftKey()); } catch (_) {} }
  function ordersAccepted() { return state.store?.acceptsOrders !== false; }
  /** Maximum quantity a client may order for one product (stock respected when tracked). */
  function maxQuantity(product) {
    if (!product) return 1;
    if (product.trackStock === false) return 999;
    const stock = Number(product.stockQuantity);
    if (!Number.isFinite(stock)) return 999;
    return Math.max(0, Math.min(999, Math.floor(stock)));
  }
  /** Delivery modes actually enabled by the merchant, in the order they should be offered. */
  function availableOrderModes() {
    const store = state.store || {}; const modes = [];
    // The public API also derives the modes from the store settings (delivery/pickup flags + active tables).
    const serverModes = store.orderModes && typeof store.orderModes === 'object' ? store.orderModes : null;
    if (serverModes ? serverModes.delivery === true : store.deliveryEnabled !== false) modes.push('delivery');
    if (serverModes ? serverModes.pickup === true : store.pickupEnabled !== false) modes.push('pickup');
    // A scanned table QR (or a restored table draft) keeps "Sur place" available even if the point check failed.
    if (state.servicePoint || state.tableNo || state.orderMode === 'dine_in' || (serverModes && serverModes.dineIn === true)) modes.push('dine_in');
    if (!modes.length) modes.push('pickup');
    return modes;
  }
  function activeOrderMode() { const modes = availableOrderModes(); return modes.includes(state.orderMode) ? state.orderMode : modes[0]; }
  function deliveredTableText() {
    if (activeOrderMode() !== 'dine_in') return '';
    const number = String(state.tableNo || '').trim(); const note = String(state.tableExtra || '').trim();
    if (!number && state.servicePoint) return [state.servicePoint.name, state.servicePoint.zone, note].filter(Boolean).join(' · ');
    return [number ? `Table ${number}` : '', note].filter(Boolean).join(' · ');
  }
  function updateCheckoutControls() {
    const locked = state.orderPending || !ordersAccepted(); const photoRequired=state.store?.requireTablePhoto===true;
    $$('#checkoutForm input, #checkoutForm textarea, #checkoutForm select').forEach((node) => { node.disabled = locked; });
    $$('#tablePhotoField button').forEach((node)=>{node.disabled=state.orderPending||state.submitting;});
    $('#clearCart').disabled = locked;
    const cartTotalCount = [...state.cart.values()].reduce((sum, quantity) => sum + quantity, 0);
    const button = $('#placeOrder');
    button.disabled = state.submitting || !ordersAccepted() || (photoRequired&&!state.tablePhotoData) || cartTotalCount === 0;
    button.textContent = state.submitting ? 'Envoi en cours…' : !ordersAccepted() ? 'Commandes suspendues' : photoRequired&&!state.tablePhotoData ? 'Photo de table requise'
      : cartTotalCount === 0 ? 'Ajoutez un produit au panier' : state.orderPending ? 'Réessayer cette commande' : 'Confirmer ma commande';
  }
  /** Rebuilds the delivery-mode selector and shows only the fields allowed by the shop settings. */
  function renderOrderMode() {
    const modes = availableOrderModes(); const mode = activeOrderMode(); state.orderMode = mode;
    const root = $('#orderModeOptions'); $('#orderModeField').hidden = modes.length < 2;
    root.innerHTML = modes.map((value) => `<label class="order-mode-option"><input type="radio" name="orderMode" value="${value}" ${value === mode ? 'checked' : ''}><span>${esc(MODE_LABELS[value])}</span></label>`).join('');
    for (const radio of $$('#orderModeOptions input', root)) radio.addEventListener('change', () => { state.orderMode = radio.value; renderOrderMode(); });
    const tableMode = mode === 'dine_in';
    $('#tableFields').hidden = !tableMode;
    $('#tableNumber').required = tableMode;
    if (tableMode && !state.tableNo && state.servicePoint) state.tableNo = String(state.servicePoint.name || '').replace(/^table\s+/i, '').slice(0, 40);
    $('#tableNumber').value = tableMode ? state.tableNo : '';
    $('#tableNote').value = tableMode ? state.tableExtra : '';
    const addressField = $('#addressField'); addressField.hidden = tableMode;
    const address = $('#deliveryAddress');
    address.required = mode === 'delivery' || mode === 'other';
    if (!tableMode) {
      const placeholder = mode === 'delivery' ? (state.sectorCopy?.address || 'Ex. Cocody, quartier, repère') : mode === 'pickup' ? 'Retrait à la boutique' : 'Précisez le mode ou le lieu de remise';
      address.placeholder = placeholder;
      if (mode === 'pickup') address.value = 'Retrait à la boutique';
      else if (String(address.value || '').trim() === 'Retrait à la boutique') address.value = '';
    } else address.value = '';
    renderOrderSummary();
  }
  /** Récapitulatif lisible avant validation : produits, quantités, prix, total, client, table et message. */
  function renderOrderSummary() {
    const body = $('#orderSummaryBody'); if (!body) return;
    const rows = [...state.cart.entries()].map(([id, quantity]) => ({ product: state.products.find((product) => product.id === id), quantity })).filter((row) => row.product);
    if (!rows.length) { body.innerHTML = '<p class="empty">Ajoutez des produits pour voir le récapitulatif.</p>'; return; }
    const total = rows.reduce((sum, row) => sum + Number(row.product.priceXof) * row.quantity, 0);
    const mode = activeOrderMode(); const table = deliveredTableText();
    const note = ($('#customerNote')?.value || '').trim();
    const customer = [($('#customerName')?.value || '').trim(), ($('#customerPhone')?.value || '').trim()].filter(Boolean);
    const lines = rows.map((row) => `<li><span>${esc(row.product.name)} <small>× ${row.quantity} · ${money(row.product.priceXof)} l’unité</small></span><strong>${money(Number(row.product.priceXof) * row.quantity)}</strong></li>`).join('');
    body.innerHTML = `<ul class="summary-lines">${lines}</ul>
      <div class="summary-meta"><div><span>Mode de remise</span><strong>${esc(MODE_LABELS[mode] || 'Commande')}</strong></div>
      ${customer.length ? `<div><span>Client</span><strong>${esc(customer.join(' · '))}</strong></div>` : ''}
      ${mode === 'dine_in' && table ? `<div><span>Table</span><strong>${esc(table)}</strong></div>` : ''}
      ${note ? `<div><span>Mot au marchand</span><strong>${esc(note)}</strong></div>` : ''}</div>
      <div class="summary-total"><span>Total produits estimé · hors livraison</span><strong>${money(total)}</strong></div>`;
  }
  function stopTableCamera() {
    if(state.cameraStream){for(const track of state.cameraStream.getTracks())track.stop();state.cameraStream=null;}
    const video=$('#tablePhotoVideo');if(video)video.srcObject=null;
  }
  function renderTablePhotoState() {
    const field=$('#tablePhotoField');if(!field)return;const required=state.store?.requireTablePhoto===true;field.hidden=!required;
    if(!required){state.tablePhotoData='';state.pendingTablePhoto='';stopTableCamera();updateCheckoutControls();return;}
    const image=$('#tablePhotoPreview');const video=$('#tablePhotoVideo');
    if(state.tablePhotoData){image.src=state.tablePhotoData;image.hidden=false;video.hidden=true;$('#startTableCamera').hidden=true;$('#captureTablePhoto').hidden=true;$('#confirmTablePhoto').hidden=true;$('#retakeTablePhoto').hidden=false;$('#tablePhotoStatus').textContent='Photo confirmée. Elle sera envoyée au marchand de façon privée et supprimée sous 30 jours.';}
    else {image.hidden=true;image.removeAttribute('src');$('#startTableCamera').hidden=false;$('#captureTablePhoto').hidden=true;$('#confirmTablePhoto').hidden=true;$('#retakeTablePhoto').hidden=true;$('#tablePhotoStatus').textContent='Autorisez la caméra pour continuer. Aucun fichier de galerie ne peut être joint.';}
    updateCheckoutControls();
  }
  async function openTableCamera() {
    if(state.orderPending)return;state.tablePhotoData='';state.pendingTablePhoto='';const status=$('#tablePhotoStatus');
    const getUserMedia=navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
    if(!getUserMedia){status.textContent='La caméra directe n’est pas disponible dans ce navigateur ou cette connexion. Aucune galerie n’est acceptée; autorisez la caméra sur un appareil compatible.';updateCheckoutControls();return;}
    try{
      stopTableCamera();const stream=await getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1600},height:{ideal:1200}}});state.cameraStream=stream;
      const video=$('#tablePhotoVideo');video.srcObject=stream;video.hidden=false;$('#tablePhotoPreview').hidden=true;await video.play().catch(()=>{});
      $('#startTableCamera').hidden=true;$('#captureTablePhoto').hidden=false;$('#confirmTablePhoto').hidden=true;$('#retakeTablePhoto').hidden=true;status.textContent='Cadrez la table, puis touchez « Prendre la photo ». La caméra reste sur cet appareil.';
    }catch(error){stopTableCamera();$('#tablePhotoVideo').hidden=true;$('#startTableCamera').hidden=false;$('#captureTablePhoto').hidden=true;status.textContent=error?.name==='NotAllowedError'?'Accès caméra refusé. Autorisez la caméra dans les réglages du navigateur pour commander; la galerie n’est pas acceptée.':'Caméra inaccessible. Vérifiez les autorisations, la connexion HTTPS et réessayez; aucun fichier galerie ne peut remplacer la photo.';}
    updateCheckoutControls();
  }
  async function captureTablePhoto() {
    const video=$('#tablePhotoVideo');const status=$('#tablePhotoStatus');if(!video.videoWidth||!video.videoHeight){status.textContent='La caméra n’est pas encore prête. Patientez puis réessayez.';return;}
    try{
      const canvas=document.createElement('canvas');const scale=Math.min(1,1200/Math.max(video.videoWidth,video.videoHeight));canvas.width=Math.round(video.videoWidth*scale);canvas.height=Math.round(video.videoHeight*scale);
      const context=canvas.getContext('2d');if(!context)throw new Error('Le navigateur ne peut pas traiter cette image.');
      const webpTest=canvas.toDataURL('image/webp').startsWith('data:image/webp');let mime=webpTest?'image/webp':'image/jpeg';let blob=null;
      for(let attempt=0;attempt<9;attempt++){
        context.drawImage(video,0,0,canvas.width,canvas.height);
        blob=await new Promise((resolve)=>canvas.toBlob(resolve,mime,Math.max(.4,.84-attempt*.055)));
        if(blob&&blob.size<=300*1024)break;
        canvas.width=Math.max(320,Math.round(canvas.width*.82));canvas.height=Math.max(240,Math.round(canvas.height*.82));
      }
      if(!blob||blob.size>300*1024)throw new Error('La photo compressée dépasse 300 Ko. Reprenez une photo plus rapprochée ou mieux éclairée.');
      state.pendingTablePhoto=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Impossible de lire la photo compressée.'));reader.readAsDataURL(blob);});
      stopTableCamera();$('#tablePhotoPreview').src=state.pendingTablePhoto;$('#tablePhotoPreview').hidden=false;video.hidden=true;$('#captureTablePhoto').hidden=true;$('#confirmTablePhoto').hidden=false;$('#retakeTablePhoto').hidden=false;status.textContent='Aperçu compressé prêt. Confirmez-le avant l’envoi de la commande.';
    }catch(error){status.textContent=error.message||'Impossible de traiter la photo. Reprenez-la avec la caméra.';}
  }
  function applyTheme(store) {
    const root = $('#shopContent'); const theme = store.theme || {}; const colors = theme.colors || {};
    const safeColor = (value, fallback) => /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toLowerCase() : fallback;
    root.style.setProperty('--shop-primary', safeColor(colors.primary, '#0d725c')); root.style.setProperty('--shop-secondary', safeColor(colors.secondary, '#d4af37'));
    const background = safeColor(colors.background, '#f3f7f4'); root.style.setProperty('--shop-background', background); document.documentElement.style.setProperty('--shop-background', background);
    root.style.setProperty('--shop-text', safeColor(colors.text, '#162622')); root.style.setProperty('--shop-button', safeColor(colors.button, '#0d725c')); root.style.setProperty('--shop-card', safeColor(colors.card, '#ffffff'));
    const font = FONT_FAMILIES.has(theme.font) ? theme.font : 'Inter'; root.style.fontFamily = '"'+font+'", sans-serif';
    root.dataset.template = ['modern','minimal','elegant','professional','boutique','restaurant'].includes(theme.template) ? theme.template : 'modern';
    root.dataset.buttonShape = ['square','rounded','pill'].includes(theme.buttonShape) ? theme.buttonShape : 'rounded';
    root.dataset.cardShape = ['square','rounded','soft'].includes(theme.cardShape) ? theme.cardShape : 'rounded';
    root.dataset.menuStyle = ['plain','pills','underline'].includes(theme.menuStyle) ? theme.menuStyle : 'pills';
    root.dataset.layout = theme.productLayout === 'list' ? 'list' : 'grid';
    root.style.fontSize = theme.textSize === 'large' ? '1.08rem' : theme.textSize === 'small' ? '.9rem' : '1rem';
    const sections = theme.sections || {};
    $('#shopDescription').hidden = sections.description === false || !store.description;
    $('#shopSectionCategories').hidden = sections.categories === false;
    $('#shopSectionContact').hidden = sections.contact === false;
    const contactActions = $('#shopContactActions'); if (contactActions) contactActions.hidden = sections.contacts === false || sections.contact === false;
    $('#shopHours').hidden = sections.hours === false || !store.openingHours;
    const ids = { cover: '#shopSectionCover', intro: '#shopSectionIntro', ads: '#shopSectionAds', categories: '#shopSectionCategories', products: '#shopSectionProducts', rewards: '#shopSectionRewards', contact: '#shopSectionContact' };
    const defaults = Object.keys(ids); const allowed = Object.keys(ids); const requested = Array.isArray(theme.sectionOrder) ? theme.sectionOrder.filter((key) => allowed.includes(key)) : defaults;
    const order = [...new Set([...requested, ...allowed])]; const container = $('#shopSections');
    for (const key of order) container.append($(ids[key]));
  }
  function renderCategoryFilters() {
    const root = $('#categoryFilters'); const categories = [...new Set(state.products.map((product) => String(product.category || '').trim()).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'fr'));
    $('#shopSectionCategories').hidden = state.store?.theme?.sections?.categories === false || categories.length === 0;
    const options = ['', ...categories]; if (state.selectedCategory && !categories.includes(state.selectedCategory)) state.selectedCategory = '';
    root.innerHTML = options.map((category) => `<button type="button" class="category-chip ${state.selectedCategory === category ? 'active' : ''}" data-category="${esc(category)}" aria-pressed="${state.selectedCategory === category}">${category ? esc(category) : 'Toutes'}</button>`).join('');
    applyTypography();
    $$('[data-category]', root).forEach((button) => button.addEventListener('click', () => { state.selectedCategory = button.dataset.category; renderCategoryFilters(); renderProducts($('#productSearch').value); }));
  }
  function photoList(product) { return Array.isArray(product.imageUrls) && product.imageUrls.length ? product.imageUrls : (product.imageData ? [product.imageData] : []); }
  function renderAds() {
    const root=$('#shopAds');const section=$('#shopSectionAds');const container=$('#shopSections');
    section.hidden=true;root.innerHTML='';$$('.shop-ad-slot',container).forEach((node)=>node.remove());
    const targets={top:()=>container.firstElementChild,after_intro:()=>$('#shopSectionIntro').nextSibling,before_products:()=>$('#shopSectionProducts'),after_products:()=>$('#shopSectionProducts').nextSibling,footer:()=>$('#shopSectionContact').nextSibling};
    const slots=new Map();
    for(const ad of state.ads){
      const placement=['top','after_intro','before_products','after_products','footer'].includes(ad.placement)?ad.placement:'after_intro';let slot=slots.get(placement);
      if(!slot){slot=document.createElement('div');slot.className=`shop-ad-slot shop-ad-slot-${placement}`;slot.dataset.adPlacement=placement;slot.setAttribute('aria-label','Publicités de la boutique');
        const before=targets[placement]();if(before)container.insertBefore(slot,before);else container.append(slot);slots.set(placement,slot);}
      const format=['card','banner','ticker'].includes(ad.displayFormat)?ad.displayFormat:'card';const style=['standard','solid','minimal','gradient'].includes(ad.style)?ad.style:'standard';
      const article=document.createElement('article');article.className=`shop-ad shop-ad-${format} shop-ad-style-${style}`;article.dataset.adCampaign=ad.id;article.dataset.format=format;article.dataset.direction=ad.direction==='rtl'?'rtl':'ltr';article.dir=ad.direction==='rtl'?'rtl':'ltr';
      article.style.setProperty('--ad-speed',`${Math.max(5,Math.min(60,Number(ad.speed)||30))}s`);
      const media=ad.imageUrl?`<img class="shop-ad-image" src="${esc(ad.imageUrl)}" alt="${esc(ad.title)}" loading="lazy">`:'';
      const clickUrl=ad.clickUrl||`/ad/${encodeURIComponent(ad.id)}`;const cta=esc(ad.ctaLabel||'Découvrir');
      if(format==='ticker')article.innerHTML=`<div class="shop-ad-ticker-content">${media}<div><span class="eyebrow">${esc(ad.title)}</span><p>${esc(ad.message||'')}</p></div><a class="button outline" href="${esc(clickUrl)}" target="_blank" rel="noopener">${cta} ↗</a></div>`;
      else article.innerHTML=`${media}<div class="shop-ad-copy"><span class="eyebrow">${esc(ad.title)}</span><p>${esc(ad.message||'')}</p></div><a class="button outline" href="${esc(clickUrl)}" target="_blank" rel="noopener">${cta} ↗</a>`;
      slot.append(article);trackAdImpression(ad,article);
    }
    applyTypography();
  }
  function trackAdImpression(ad, element) {
    let sent=false;const send=()=>{if(sent)return;sent=true;const eventId=crypto.randomUUID?crypto.randomUUID():`ad_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
      fetch(`/api/public/shops/${encodeURIComponent(state.slug)}/ads/${encodeURIComponent(ad.id)}/impression`,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({eventId}),keepalive:true}).catch(()=>{});};
    if('IntersectionObserver'in window){const observer=new IntersectionObserver((entries)=>{if(entries.some((entry)=>entry.isIntersecting)){send();observer.disconnect();}},{threshold:.15});observer.observe(element);}
    else send();
  }
  function renderRewards() {
    const root = $('#shopRewards'); const section = $('#shopSectionRewards');
    section.hidden = !state.rewardCampaigns.length;
    root.innerHTML = state.rewardCampaigns.map((campaign) => `<article class="reward-card"><div><h3>${esc(campaign.title)}</h3><p>${esc(campaign.description || '')}</p><small>${Number(campaign.remainingParticipants) || 0} participation(s) disponible(s) · fin ${esc(new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(campaign.endsAt)))}</small><small>Référence d’autorisation ARJH : ${esc(campaign.authorizationReference || 'non communiquée')}</small><small>${esc(campaign.rules || 'Participation gratuite, sans achat ni paiement. Une seule participation par numéro et dans la limite des stocks.')}</small></div><form class="reward-claim-form" data-claim-campaign="${esc(campaign.id)}"><label for="reward-phone-${esc(campaign.id)}">Téléphone pour limiter les participations</label><div><input id="reward-phone-${esc(campaign.id)}" type="tel" maxlength="32" required placeholder="+225 07 00 00 00 00"><button class="button primary" type="submit">Participer gratuitement</button></div><p class="reward-result" data-reward-result="${esc(campaign.id)}" role="status" aria-live="polite"></p></form></article>`).join('');
    applyTypography();
  }
  async function loadServicePoint(pendingOrder) {
    const banner = $('#shopServicePoint'); banner.hidden = true;
    if (!state.servicePointCode) return;
    // The shop payload already resolves the scanned table: use it first, so the table is known even if
    // the dedicated endpoint is slow or briefly unavailable. No second round trip on the critical path.
    const fromShop = state.store?.servicePoint && state.store.servicePoint.storeSlug === state.slug ? state.store.servicePoint : null;
    const applyPoint = (point) => {
      state.servicePoint = point;
      const noun = servicePointTypeLabel(point.type);
      const pointName = String(point.name || '').trim(); const pointLabel = /^(table|comptoir|emplacement|salon)\b/i.test(pointName) ? pointName : `${noun} ${pointName}`;
      banner.textContent = `${pointLabel}${point.zone ? ` · ${point.zone}` : ''}${point.instructions ? ` · ${point.instructions}` : ''} — la commande sera rattachée à ce QR.`; banner.hidden = false;
      if (!pendingOrder && !state.tableNo) state.tableNo = String(point.name || '').replace(/^table\s+/i, '').slice(0, 40);
      if (!pendingOrder && !state.orderMode) state.orderMode = 'dine_in';
    };
    if (fromShop) { applyPoint(fromShop); return; }
    try {
      const response = await fetchWithTimeout(`/api/public/service-points/${encodeURIComponent(state.servicePointCode)}`, 8000);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data || result.data.storeSlug !== state.slug) throw new Error('QR d’emplacement indisponible.');
      applyPoint(result.data);
    } catch (_) {
      // Keep the table code: the order carries it and the server validates it. Only the banner is degraded.
      state.servicePoint = null;
      banner.textContent = 'Table non vérifiée pour l’instant : la commande sera rattachée au QR scanné et vérifiée par la boutique. Vous pouvez continuer à commander.';
      banner.hidden = false;
    }
  }
  async function loadShop() {
    try {
      const servicePointQuery = state.servicePointCode ? `?servicePoint=${encodeURIComponent(state.servicePointCode)}` : '';
      // A very slow or unavailable API must show an actionable message, never an endless loading screen.
      const response = await fetchWithTimeout(`/api/public/shops/${encodeURIComponent(state.slug)}${servicePointQuery}`, 15000);
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data) throw new Error(result.error || 'Cette boutique n’est pas disponible.');
      state.store = result.data.store; state.products = result.data.products || []; state.orderPolicy = result.data.orderPolicy || state.orderPolicy;
      $$('[data-order-recovery]').forEach((link) => { link.href = `/order-recovery/?store=${encodeURIComponent(state.slug)}`; });
      restoreCart(); const pending = restoreOrderDraft();
      // The table QR is verified in parallel and never blocks the catalogue: if that check fails, the
      // table code from the URL is still sent with the order and validated by the server.
      await loadServicePoint(pending);
      const store = state.store; renderTablePhotoState(); $('#shopName').textContent = store.name; $('#shopDescription').textContent = store.description || '';
      state.sectorCopy = SECTOR_COPY[store.sector] || SECTOR_COPY.general;
      $('#shopSectorLabel').textContent = state.sectorCopy.label; $('#shopContent').dataset.sector = SECTOR_COPY[store.sector] ? store.sector : 'general';
      $('#catalogueEyebrow').textContent = state.sectorCopy.eyebrow; $('#catalogueTitle').textContent = state.sectorCopy.title;
      $('#productSearch').placeholder = state.sectorCopy.search; $('#productSearch').setAttribute('aria-label',state.sectorCopy.search);
      $('#deliveryAddress').placeholder = state.sectorCopy.address;
      state.ads = Array.isArray(result.data.ads) ? result.data.ads : []; state.rewardCampaigns = Array.isArray(result.data.rewardCampaigns) ? result.data.rewardCampaigns : [];
      renderRewards();
      const logo = $('#shopLogo'); const fallback = $('#shopLogoFallback');
      if (store.logo) { logo.src = store.logo; logo.hidden = false; fallback.hidden = true; } else { logo.hidden = true; fallback.hidden = false; }
      const cover = $('#shopCover'); if (store.coverImageUrl) { cover.src = store.coverImageUrl; $('#shopSectionCover').hidden = false; } else { cover.removeAttribute('src'); $('#shopSectionCover').hidden = true; }
      const contacts = []; const contactActions = [];
      const contactActionsEnabled = store.theme?.sections?.contacts !== false && store.theme?.sections?.contact !== false;
      if (contactActionsEnabled && store.phoneContactUrl) contactActions.push(`<a class="button outline" href="${esc(store.phoneContactUrl)}">Appeler</a>`);
      if (contactActionsEnabled && store.whatsappContactUrl) contactActions.push(`<a class="button outline" href="${esc(store.whatsappContactUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`);
      if (contactActions.length) contacts.push(`<div id="shopContactActions" class="shop-contact-actions" aria-label="Coordonnées et contacts">${contactActions.join('')}</div>`);
      if (store.email) contacts.push(`<a href="mailto:${esc(store.email)}">E-mail : ${esc(store.email)}</a>`);
      if (store.address) contacts.push(`<span>${esc(store.address)}</span>`);
      if (store.deliveryNote) contacts.push(`<span>${esc(store.deliveryNote)}</span>`);
      const modes = [store.deliveryEnabled !== false ? 'Livraison proposée' : '', store.pickupEnabled !== false ? 'Retrait proposé' : ''].filter(Boolean);
      if (modes.length) contacts.push(`<span>${esc(modes.join(' · '))}</span>`);
      $('#shopContact').innerHTML = contacts.join('') || '<span>Contactez directement la boutique pour connaître les modalités.</span>';
      $('#shopOpeningHours').textContent = store.openingHours || '';
      const fee = $('#shopDeliveryFee'); if (store.deliveryEnabled !== false && Number(store.deliveryFeeXof) > 0) { fee.textContent = `Frais de livraison annoncés : ${money(store.deliveryFeeXof)} · montant indicatif, à confirmer avec le marchand.`; fee.hidden = false; } else fee.hidden = true;
      document.title = `${store.name} — Oymike Tech`; applyTheme(store); renderAds(); renderCategoryFilters();
      if (store.acceptsOrders === false) { $('#shopOrderNotice').textContent = 'Cette boutique a temporairement suspendu les nouvelles commandes. Vous pouvez toujours consulter son catalogue.'; $('#shopOrderNotice').hidden = false; }
      else $('#shopOrderNotice').hidden = true;
      $('#shopLoading').hidden = true; $('#shopError').hidden = true; $('#shopContent').hidden = false;
      renderOrderMode(); renderProducts(); renderCart(); renderOrderSummary(); updateCheckoutControls();
      if (pending) { const error = $('#checkoutError'); error.textContent = 'Une tentative précédente n’a pas reçu de confirmation. Vos informations sont restaurées; réessayez pour vérifier ou reprendre la même commande.'; error.hidden = false; }
    } catch (error) {
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      showError(offline ? 'Vous êtes hors ligne. Reconnectez-vous puis réessayez : le catalogue se recharge automatiquement.' : (error.message || 'Impossible de charger cette boutique.'));
    }
  }
  /**
   * Product cards are only rebuilt when the *visible list* changes (search, category, photo).
   * Cart interactions never replace the grid: the <img> nodes keep their identity, so the
   * browser never reloads or blanks a photo after "Ajouter au panier" or a quantity change.
   */
  function productCardMarkup(product) {
    const photos = photoList(product); const currentIndex = Math.min(state.photoIndexes.get(product.id) || 0, Math.max(0, photos.length - 1));
    const compare = Number(product.compareAtPriceXof) > Number(product.priceXof) ? `<del>${money(product.compareAtPriceXof)}</del>` : '';
    const image = photos[currentIndex] || '';
    const photoStrip = photos.length > 1 ? `<div class="product-thumbnails" aria-label="Autres photos de ${esc(product.name)}">${photos.map((url, index) => `<button class="product-thumbnail ${index === currentIndex ? 'active' : ''}" type="button" data-photo-product="${esc(product.id)}" data-photo-index="${index}" aria-label="Afficher la photo ${index + 1} de ${esc(product.name)}" aria-pressed="${index === currentIndex}"><img src="${esc(url)}" alt="" loading="lazy" decoding="async"></button>`).join('')}</div>` : '';
    const variants = (product.variants || []).filter((variant) => variant.name && variant.values?.length).map((variant) => `<span><strong>${esc(variant.name)} :</strong> ${variant.values.map(esc).join(' · ')}</span>`).join('');
    return `<article class="public-product" data-product-card="${esc(product.id)}"><div class="public-product-media"><div class="public-product-image">${image ? `<img src="${esc(image)}" alt="${esc(product.name)}" loading="lazy" decoding="async">` : '<span class="photo-placeholder">PHOTO</span>'}</div>${photoStrip}</div><div class="public-product-content"><div class="product-heading"><h3>${esc(product.name)}</h3>${product.category ? `<span class="public-category">${esc(product.category)}</span>` : ''}</div><p class="product-description">${esc(product.description || '')}</p>${variants ? `<div class="product-variants">${variants}</div>` : ''}<div class="public-product-bottom"><div class="public-price">${compare}<strong>${money(product.priceXof)}</strong><small class="product-stock" data-stock-for="${esc(product.id)}"></small></div><div class="product-purchase"><div class="qty-stepper" role="group" aria-label="Quantité pour ${esc(product.name)}"><button type="button" class="qty-button" data-qty-minus="${esc(product.id)}" aria-label="Diminuer la quantité de ${esc(product.name)}">−</button><span class="qty-value" data-qty-value="${esc(product.id)}" aria-live="polite">1</span><button type="button" class="qty-button" data-qty-plus="${esc(product.id)}" aria-label="Augmenter la quantité de ${esc(product.name)}">+</button></div><button class="button primary" type="button" data-add="${esc(product.id)}">${esc(state.sectorCopy?.add || 'Ajouter au panier')}</button></div></div></div></article>`;
  }
  function bindProductCard(grid) {
    $$('[data-add]', grid).forEach((button) => button.addEventListener('click', () => { addPendingToCart(button.dataset.add); }));
    $$('[data-qty-plus]', grid).forEach((button) => button.addEventListener('click', () => stepPendingQuantity(button.dataset.qtyPlus, 1)));
    $$('[data-qty-minus]', grid).forEach((button) => button.addEventListener('click', () => stepPendingQuantity(button.dataset.qtyMinus, -1)));
    $$('[data-photo-product]', grid).forEach((button) => button.addEventListener('click', () => {
      state.photoIndexes.set(button.dataset.photoProduct, Number(button.dataset.photoIndex) || 0);
      const card = $(`[data-product-card="${cssEscape(button.dataset.photoProduct)}"]`, grid); const product = state.products.find((item) => item.id === button.dataset.photoProduct);
      if (!card || !product) return renderProducts($('#productSearch').value);
      // Swap only the media block so the rest of the card (and the cart state) is untouched.
      const media = $('.public-product-media', card); const fresh = document.createElement('div'); fresh.innerHTML = productCardMarkup(product);
      media.replaceWith($('.public-product-media', fresh));
      bindProductCard(grid); applyTypography();
    }));
  }
  function syncProductCardStates() {
    for (const [id, card] of state.productNodes) {
      const product = state.products.find((item) => item.id === id); if (!product) continue;
      const max = maxQuantity(product); const pending = Math.max(1, Math.min(max || 1, state.pendingQuantities.get(id) || 1)); state.pendingQuantities.set(id, pending);
      const minus = $(`[data-qty-minus="${cssEscape(id)}"]`, card); const plus = $(`[data-qty-plus="${cssEscape(id)}"]`, card);
      const value = $(`[data-qty-value="${cssEscape(id)}"]`, card); const add = $(`[data-add="${cssEscape(id)}"]`, card); const stock = $(`[data-stock-for="${cssEscape(id)}"]`, card);
      if (value) value.textContent = String(pending);
      if (minus) minus.disabled = pending <= 1 || state.orderPending || !ordersAccepted();
      if (plus) plus.disabled = state.orderPending || !ordersAccepted() || max === 0 || pending >= max;
      if (add) { add.disabled = state.orderPending || !ordersAccepted() || max === 0; const inCart = state.cart.get(id) || 0; add.textContent = inCart ? `Ajouter · ${inCart} au panier` : esc(state.sectorCopy?.add || 'Ajouter au panier'); }
      if (stock) { const tracked = product.trackStock !== false && Number.isFinite(Number(product.stockQuantity)); stock.textContent = !tracked ? '' : max > 0 ? `${max} en stock` : 'Épuisé'; stock.dataset.out = max > 0 ? 'false' : 'true'; }
      if (max === 0) { if (add) add.textContent = 'Indisponible'; if (plus) plus.disabled = true; }
    }
  }
  function renderProducts(filter = '') {
    const grid = $('#productsGrid'); const query = filter.trim().toLocaleLowerCase('fr');
    const products = state.products.filter((product) => {
      const textMatch = [product.name, product.description, product.sku, product.category].join(' ').toLocaleLowerCase('fr').includes(query);
      const categoryMatch = !state.selectedCategory || product.category === state.selectedCategory; return textMatch && categoryMatch;
    });
    const shownCategories = state.selectedCategory ? ` · ${state.selectedCategory}` : ''; const noun=state.sectorCopy?.noun||'produit';
    $('#catalogueCount').textContent = `${products.length} ${noun}${products.length === 1 ? '' : 's'}${shownCategories}`;
    const signature = products.map((product) => `${product.id}:${photoList(product)[state.photoIndexes.get(product.id) || 0] || ''}`).join('|');
    if (!products.length) { grid.innerHTML = '<p class="empty">Aucun produit ne correspond à cette recherche.</p>'; state.productNodes.clear(); state.renderedProductIds = ''; applyTypography(); updateCheckoutControls(); return; }
    if (signature !== state.renderedProductIds) {
      grid.innerHTML = products.map(productCardMarkup).join('');
      state.productNodes = new Map(products.map((product) => [product.id, $(`[data-product-card="${cssEscape(product.id)}"]`, grid)]).filter(([, node]) => node));
      state.renderedProductIds = signature;
      bindProductCard(grid); applyTypography();
    }
    syncProductCardStates(); updateCheckoutControls();
  }
  /** Local −/+ quantity selector: only the numbers change, never the product photos. */
  function stepPendingQuantity(id, delta) {
    const product = state.products.find((item) => item.id === id); if (!product) return;
    const max = maxQuantity(product); if (max === 0) { toast('Ce produit est épuisé.'); return; }
    const current = state.pendingQuantities.get(id) || 1;
    const next = Math.max(1, Math.min(max, Math.min(999, current + delta)));
    if (delta > 0 && current >= max) { toast(`Maximum disponible : ${max}.`); }
    state.pendingQuantities.set(id, next); syncProductCardStates();
  }
  function addPendingToCart(id) {
    const product = state.products.find((item) => item.id === id);
    if (state.orderPending || !ordersAccepted() || !product || product.available === false) { if (product?.available === false) toast('Ce produit n’est plus disponible.'); return; }
    const max = maxQuantity(product); const requested = state.pendingQuantities.get(id) || 1;
    const already = state.cart.get(id) || 0; const allowed = Math.max(0, max - already);
    if (allowed <= 0) { toast(`Vous avez déjà le maximum disponible (${max}).`); return; }
    const quantity = Math.min(requested, allowed);
    state.cart.set(id, already + quantity); state.pendingQuantities.set(id, 1); saveCart(); applyCartChanges();
    toast(`${product.name} × ${quantity} ajouté au panier${quantity < requested ? ` (limite de stock : ${max})` : ''}.`);
  }
  function changeQuantity(id, quantity) {
    const product = state.products.find((item) => item.id === id); if (state.orderPending || !ordersAccepted() || !product) return;
    const max = maxQuantity(product);
    if (quantity <= 0) state.cart.delete(id);
    else state.cart.set(id, Math.max(1, Math.min(max || 1, Math.min(999, quantity))));
    saveCart(); applyCartChanges();
    if (quantity > (max || 1)) toast(`Limite de stock atteinte pour ${product.name} (${max}).`);
  }
  /** Single entry point after any cart edit: updates the cart, quantities and summary, never the photos. */
  function applyCartChanges() {
    renderCart(); syncProductCardStates(); renderOrderSummary(); updateCheckoutControls();
  }
  function renderCart() {
    const root = $('#cartLines'); const lines = [...state.cart.entries()].map(([id, quantity]) => ({ product: state.products.find((product) => product.id === id), quantity })).filter((row) => row.product);
    const count = lines.reduce((sum, row) => sum + row.quantity, 0); $('#cartCount').textContent = String(count);
    if (!lines.length) { root.innerHTML = '<p class="empty">Votre panier est vide.</p>'; $('#cartTotal').textContent = money(0); updateCheckoutControls(); return; }
    const previousScroll = root.scrollTop;
    root.innerHTML = lines.map(({ product, quantity }) => { const max = maxQuantity(product);
      return `<div class="cart-line" data-cart-line="${esc(product.id)}"><div><strong>${esc(product.name)}</strong><small>${money(product.priceXof)} l’unité · ${money(Number(product.priceXof) * quantity)}</small></div><div class="cart-qty" role="group" aria-label="Quantité de ${esc(product.name)}"><button type="button" aria-label="Retirer une unité" data-minus="${esc(product.id)}" ${quantity <= 1 ? 'disabled' : ''}>−</button><span>${quantity}</span><button type="button" aria-label="Ajouter une unité" data-plus="${esc(product.id)}" ${max === 0 || quantity >= max ? 'disabled' : ''}>+</button></div></div>`; }).join('');
    root.scrollTop = previousScroll;
    $$('[data-minus]', root).forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.minus, (state.cart.get(button.dataset.minus) || 0) - 1)));
    $$('[data-plus]', root).forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.plus, (state.cart.get(button.dataset.plus) || 0) + 1)));
    const total = lines.reduce((sum, row) => sum + Number(row.product.priceXof) * row.quantity, 0); $('#cartTotal').textContent = money(total);
    updateCheckoutControls();
  }
  $('#startTableCamera').addEventListener('click',openTableCamera);
  $('#retakeTablePhoto').addEventListener('click',openTableCamera);
  $('#captureTablePhoto').addEventListener('click',captureTablePhoto);
  $('#confirmTablePhoto').addEventListener('click',()=>{if(!state.pendingTablePhoto)return;state.tablePhotoData=state.pendingTablePhoto;state.pendingTablePhoto='';renderTablePhotoState();});
  window.addEventListener('pagehide',stopTableCamera);
  $('#checkoutForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#checkoutError'); error.hidden = true;
    if (!ordersAccepted()) { error.textContent = 'Cette boutique a suspendu les nouvelles commandes.'; error.hidden = false; return; }
    let body;
    if (state.orderPending && state.orderDraft?.body) {
      body = { ...state.orderDraft.body, items: state.orderDraft.body.items.map((item) => ({ ...item })) };
      body.clientRequestId = state.orderDraft.requestId;
    } else {
      if (!state.cart.size) { error.textContent = 'Ajoutez au moins un produit au panier.'; error.hidden = false; return; }
      if(state.store?.requireTablePhoto===true&&!state.tablePhotoData){error.textContent='Cette boutique exige une photo prise directement avec la caméra. Ouvrez la caméra, prenez puis confirmez la photo; la galerie n’est pas acceptée.';error.hidden=false;updateCheckoutControls();return;}
      const mode = activeOrderMode();
      state.tableNo = $('#tableNumber').value.trim(); state.tableExtra = $('#tableNote').value.trim();
      const tableText = deliveredTableText();
      const address = mode === 'dine_in' ? (tableText || 'Sur place') : mode === 'pickup' ? 'Retrait à la boutique' : $('#deliveryAddress').value.trim();
      if (mode === 'dine_in' && !state.tableNo.trim() && !state.servicePoint) { error.textContent = 'Indiquez votre numéro de table pour cette commande sur place.'; error.hidden = false; return; }
      if (['delivery','other'].includes(mode) && address.length < 3) { error.textContent = mode === 'delivery' ? 'Indiquez une adresse de livraison.' : 'Précisez le mode ou le lieu de remise.'; error.hidden = false; return; }
      if (!state.cart.size) { error.textContent = 'Ajoutez au moins un produit au panier.'; error.hidden = false; return; }
      const intent = { customerName: $('#customerName').value.trim(), customerPhone: $('#customerPhone').value.trim(), customerEmail: $('#customerEmail').value.trim(),
        deliveryAddress: address, note: $('#customerNote').value.trim(), servicePointCode: state.servicePoint?.publicCode || '', tablePhoto:state.tablePhotoData||'',
        orderMode: mode, tableNumber: state.tableNo, tableNote: state.tableExtra, items: [...state.cart].map(([productId, quantity]) => ({ productId, quantity })) };
      const draft = saveOrderDraft(intent); body = { ...draft.body, clientRequestId: draft.requestId };
    }
    state.orderPending = true; state.submitting = true; updateCheckoutControls();
    let response = null;
    try {
      // The order POST is bounded too: a stalled request must never leave the customer without an answer.
      // The idempotent clientRequestId makes a retry safe (it returns the same order, never a duplicate).
      const orderController = typeof AbortController === 'function' ? new AbortController() : null;
      const orderTimer = setTimeout(() => orderController?.abort(), 20000);
      try {
        response = await fetch(`/api/public/shops/${encodeURIComponent(state.slug)}/orders`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...(orderController ? { signal: orderController.signal } : {}) });
      } finally { clearTimeout(orderTimer); }
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { const failure = new Error(result.error || `Erreur ${response.status}`); failure.status = response.status; throw failure; }
      if (!result?.data?.order?.reference) throw new Error('La confirmation de commande est incomplète.');
      state.cart.clear(); saveCart(); clearOrderDraft(); state.orderPending = false; stopTableCamera();
      renderCart(); syncProductCardStates(); renderOrderSummary();
      const order = result.data.order;
      if (result.data.trackingEnabled === false) {
        location.assign(`/order-confirmation/?store=${encodeURIComponent(state.slug)}&reference=${encodeURIComponent(order.reference)}`);
        return;
      }
      if (!result?.data?.trackingToken) throw new Error('Le lien de suivi sécurisé est incomplet.');
      const target = `/order/${encodeURIComponent(order.reference)}?token=${encodeURIComponent(result.data.trackingToken)}`;
      location.assign(target);
    } catch (err) {
      const ambiguous = !response || response.status >= 500 || response.status === 409 || !err.status;
      if (ambiguous) {
        state.orderPending = true;
        error.textContent = `${err.message} Une commande a peut-être déjà été reçue. Vos informations sont conservées; réessayez avec le même contenu pour retrouver la même commande.`;
      } else {
        clearOrderDraft(); state.orderPending = false;
        error.textContent = `${err.message} Le serveur a refusé cette tentative; votre panier est conservé. Vous pouvez corriger puis réessayer.`;
      }
      error.hidden = false;
    } finally { state.submitting = false; updateCheckoutControls(); }
  });
  $('#clearCart').addEventListener('click', () => { if (state.orderPending || !ordersAccepted()) return; state.cart.clear(); saveCart(); applyCartChanges(); });
  $('#productSearch').addEventListener('input', () => renderProducts($('#productSearch').value));
  $('#tableNumber').addEventListener('input', () => { state.tableNo = $('#tableNumber').value; renderOrderSummary(); });
  $('#tableNote').addEventListener('input', () => { state.tableExtra = $('#tableNote').value; renderOrderSummary(); });
  $('#customerName').addEventListener('input', renderOrderSummary);
  $('#customerPhone').addEventListener('input', renderOrderSummary);
  $('#customerNote').addEventListener('input', renderOrderSummary);
  async function rewardPhoneFingerprint(phone) {
    const normalized=String(phone||'').replace(/\D/g,'');
    try { const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(normalized)); return [...new Uint8Array(digest)].map((value)=>value.toString(16).padStart(2,'0')).join(''); }
    catch (_) { let a=0x811c9dc5,b=0x9e3779b9; for(const char of normalized){a=Math.imul(a^char.charCodeAt(0),0x01000193);b=Math.imul(b^char.charCodeAt(0),0x85ebca6b);} return `${normalized.length}-${(a>>>0).toString(16)}-${(b>>>0).toString(16)}`; }
  }
  function installRewardScratch(resultNode,data,expiry,idempotent=false){
    const statusText=idempotent?'Votre participation déjà enregistrée a été récupérée.':'Résultat tiré et enregistré par le serveur.';
    resultNode.dataset.claiming='false';resultNode.setAttribute('aria-live','off');
    resultNode.innerHTML=`<div class="reward-scratch-card"><p>${esc(statusText)} Grattez la carte ou utilisez le bouton pour révéler le code.</p><div class="reward-scratch"><div class="reward-reveal" aria-hidden="true"><span>${idempotent?'Votre résultat':'Votre gain'}</span><strong>${esc(data.prizeLabel)}</strong><span>Code à présenter au commerçant</span><code>${esc(data.code)}</code><small>Valable jusqu’au ${esc(expiry)}</small></div><span class="reward-scratch-hint" aria-hidden="true">GRATTEZ POUR RÉVÉLER</span><canvas aria-label="Zone à gratter. Utilisez aussi le bouton Afficher le résultat." role="img"></canvas></div><button class="reward-reveal-button" type="button">Afficher le résultat</button></div>`;
    const card=$('.reward-scratch',resultNode);const canvas=$('canvas',card);const reveal=$('.reward-reveal',card);const hint=$('.reward-scratch-hint',card);const revealButton=$('.reward-reveal-button',resultNode);
    const show=()=>{card.classList.add('is-revealed');reveal.setAttribute('aria-hidden','false');canvas.setAttribute('aria-hidden','true');hint.textContent='RÉSULTAT RÉVÉLÉ';revealButton.hidden=true;resultNode.setAttribute('aria-live','polite');reveal.focus?.();};
    revealButton.addEventListener('click',show);reveal.tabIndex=-1;
    let ctx;try{ctx=canvas.getContext('2d');}catch(_){ctx=null;}
    if(!ctx||typeof ctx.getImageData!=='function'){show();return;}
    const rect=canvas.getBoundingClientRect();const width=Math.max(280,Math.round(rect.width||320));const height=Math.max(116,Math.round(rect.height||130));const dpr=Math.min(2,window.devicePixelRatio||1);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);canvas.style.width='100%';canvas.style.height='100%';
    ctx.setTransform(dpr,0,0,dpr,0,0);ctx.globalCompositeOperation='source-over';ctx.fillStyle='#aebcb4';ctx.fillRect(0,0,width,height);
    ctx.strokeStyle='#dce4df';ctx.lineWidth=2;for(let x=-height;x<width+height;x+=22){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+height,height);ctx.stroke();}
    ctx.fillStyle='#899b90';ctx.font='700 11px system-ui,sans-serif';ctx.textAlign='center';ctx.fillText('OYMIKE TECH · OFFRE GRATUITE',width/2,height/2-4);ctx.fillStyle='#fff';ctx.font='800 12px system-ui,sans-serif';ctx.fillText('GRATTEZ ICI',width/2,height/2+18);
    ctx.globalCompositeOperation='destination-out';ctx.lineWidth=30;ctx.lineCap='round';ctx.lineJoin='round';canvas.style.touchAction='none';let drawing=false;let last=null;
    const point=(event)=>{const box=canvas.getBoundingClientRect();return{x:(event.clientX-box.left)/(box.width||width)*width,y:(event.clientY-box.top)/(box.height||height)*height};};
    const scratch=(event)=>{if(!drawing)return;const next=point(event);ctx.beginPath();if(last){ctx.moveTo(last.x,last.y);ctx.lineTo(next.x,next.y);}else{ctx.moveTo(next.x,next.y);ctx.lineTo(next.x+.1,next.y+.1);}ctx.stroke();last=next;};
    const enough=()=>{try{const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let transparent=0,total=0;for(let i=3;i<pixels.length;i+=64){total++;if(pixels[i]<24)transparent++;}return total>0&&transparent/total>.38;}catch(_){return false;}};
    canvas.addEventListener('pointerdown',(event)=>{drawing=true;last=null;canvas.setPointerCapture?.(event.pointerId);scratch(event);});
    canvas.addEventListener('pointermove',(event)=>{if(!drawing)return;scratch(event);if(enough()){drawing=false;show();}});
    const stop=()=>{drawing=false;last=null;};canvas.addEventListener('pointerup',stop);canvas.addEventListener('pointercancel',stop);canvas.addEventListener('pointerleave',stop);
  }
  $('#shopRewards').addEventListener('submit', async (event) => {
    const form=event.target.closest('[data-claim-campaign]'); if(!form)return; event.preventDefault();
    const campaignId=form.dataset.claimCampaign; const resultNode=$(`[data-reward-result="${campaignId}"]`,form); const button=$('button[type="submit"]',form);
    const phone=$('input[type="tel"]',form).value.trim(); const key=`oymike-reward-request:${state.slug}:${campaignId}`;
    button.disabled=true; resultNode.textContent='Enregistrement de la participation gratuite…';
    try {
      const fingerprint=await rewardPhoneFingerprint(phone); let saved=null; try{saved=JSON.parse(sessionStorage.getItem(key)||'null');}catch(_){}
      const requestId=saved?.fingerprint===fingerprint&&saved.id?saved.id:(crypto.randomUUID?crypto.randomUUID():`reward_${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`);
      if(!saved||saved.fingerprint!==fingerprint||!saved.id){try{sessionStorage.setItem(key,JSON.stringify({fingerprint,id:requestId}));}catch(_){}}
      const response=await fetch(`/api/public/shops/${encodeURIComponent(state.slug)}/rewards/${encodeURIComponent(campaignId)}/claim`,{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({phone,requestId,servicePointCode:state.servicePoint?.publicCode||''}),
      });
      const result=await response.json().catch(()=>({})); if(!response.ok)throw new Error(result.error||`Erreur ${response.status}`);
      const expiry=new Intl.DateTimeFormat('fr-FR',{dateStyle:'medium'}).format(new Date(result.data.claim.expiresAt));
      installRewardScratch(resultNode,result.data,expiry,result.data.idempotent===true);
    } catch(error) { resultNode.textContent=`${error.message||'La demande a échoué.'} En cas de coupure réseau, réessayez avec le même numéro. Votre demande n’est pas facturée.`; }
    finally { button.disabled=false; }
  });
  const retryButton = $('#shopRetry'); if (retryButton) retryButton.addEventListener('click', () => { retryButton.hidden = true; $('#shopError').hidden = true; $('#shopLoading').hidden = false; loadShop(); });
  // The loading card itself offers a manual reload: no visitor is left in front of a frozen message.
  const loadingRetry = $('#shopLoadingRetry'); if (loadingRetry) loadingRetry.addEventListener('click', () => { if (!$('#shopContent').hidden) return; $('#shopLoadingHint').textContent = 'Nouvelle tentative en cours…'; loadShop(); });
  window.addEventListener('online', () => { if (!$('#shopContent').hidden) return; if ($('#shopError').hidden) return; $('#shopLoading').hidden = false; loadShop(); });
  $('#cartJump').addEventListener('click', () => { if (window.innerWidth <= 720) $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  loadShop();
})();
