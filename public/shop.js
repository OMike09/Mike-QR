(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { slug: decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || ''), store: null, products: [], ads: [], rewardCampaigns: [], servicePointCode: new URLSearchParams(location.search).get('servicePoint') || '', servicePoint: null, orderPolicy: { trackingEnabled: true, clientCancellationEnabled: true, clientBrowserNotifications: true }, cart: new Map(), toastTimer: 0, orderDraft: null, orderPending: false, submitting: false, selectedCategory: '', photoIndexes: new Map(), sectorCopy: null, tablePhotoData: '', pendingTablePhoto: '', cameraStream: null };
  const SECTOR_COPY = {
    general: { label:'CATALOGUE OYMIKE TECH', eyebrow:'PRODUITS', title:'Le catalogue', noun:'produit', search:'Rechercher un produit', add:'Ajouter au panier', address:'Ex. Retrait à la boutique ou livraison à Cocody' },
    restaurant: { label:'MENU DU RESTAURANT', eyebrow:'À LA CARTE', title:'Plats et boissons', noun:'article', search:'Rechercher un plat ou une boisson', add:'Ajouter au panier', address:'Ex. Sur place, à emporter ou livraison à Cocody' },
    maquis: { label:'MENU DU MAQUIS', eyebrow:'MENU', title:'Plats, boissons et grillades', noun:'article', search:'Rechercher un plat, une boisson…', add:'Ajouter au panier', address:'Ex. Table, emporter ou livraison à Cocody' },
    hardware: { label:'QUINCAILLERIE · CATALOGUE', eyebrow:'MATÉRIEL', title:'Matériel et fournitures', noun:'article', search:'Rechercher un outil ou matériau', add:'Ajouter au panier', address:'Ex. Retrait au comptoir ou livraison à Cocody' },
    clothing: { label:'COLLECTION · VÊTEMENTS', eyebrow:'COLLECTION', title:'Vêtements et accessoires', noun:'pièce', search:'Rechercher une pièce ou une taille', add:'Ajouter au panier', address:'Ex. Retrait en boutique ou livraison à Cocody' },
  };
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
  function showError(message) { $('#shopLoading').hidden = true; $('#shopContent').hidden = true; $('#shopError').hidden = false; $('#shopErrorText').textContent = message; }
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
      state.tablePhotoData=typeof body.tablePhoto==='string'?body.tablePhoto:'';
      state.cart = new Map(body.items.filter((row) => row && typeof row.productId === 'string').map((row) => [row.productId, Math.min(999, Math.max(1, Number(row.quantity) || 1))]));
      saveCart(); state.orderPending = true; return true;
    } catch (_) { return false; }
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
  function updateCheckoutControls() {
    const locked = state.orderPending || !ordersAccepted(); const photoRequired=state.store?.requireTablePhoto===true;
    $$('#checkoutForm input, #checkoutForm textarea').forEach((node) => { node.disabled = locked; });
    $$('#tablePhotoField button').forEach((node)=>{node.disabled=state.orderPending||state.submitting;});
    $('#clearCart').disabled = locked;
    $$('#productsGrid button[data-add], #cartLines button').forEach((button) => { button.disabled = locked; });
    const button = $('#placeOrder'); button.disabled = state.submitting || !ordersAccepted() || (photoRequired&&!state.tablePhotoData);
    button.textContent = state.submitting ? 'Envoi en cours…' : !ordersAccepted() ? 'Commandes suspendues' : photoRequired&&!state.tablePhotoData ? 'Photo de table requise' : state.orderPending ? 'Réessayer cette commande' : 'Envoyer ma commande';
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
    try {
      const response = await fetch(`/api/public/service-points/${encodeURIComponent(state.servicePointCode)}`, { cache: 'no-store' }); const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data || result.data.storeSlug !== state.slug) throw new Error('QR d’emplacement indisponible.');
      state.servicePoint = result.data;
      const noun = result.data.type === 'table' ? 'Table' : result.data.type === 'counter' ? 'Comptoir' : 'Emplacement';
      const pointName=String(result.data.name||'').trim();const pointLabel=/^(table|comptoir|emplacement)\b/i.test(pointName)?pointName:`${noun} ${pointName}`;
      banner.textContent = `${pointLabel}${result.data.zone ? ` · ${result.data.zone}` : ''}${result.data.instructions ? ` · ${result.data.instructions}` : ''} — la commande sera rattachée à ce QR.`; banner.hidden = false;
      if (!pendingOrder && !$('#deliveryAddress').value.trim()) $('#deliveryAddress').value = pointLabel;
    } catch (_) {
      state.servicePoint = null; state.servicePointCode = ''; banner.textContent = 'Ce QR de table ou d’emplacement n’est plus actif. Vous pouvez toujours consulter le catalogue.'; banner.hidden = false;
    }
  }
  async function loadShop() {
    try {
      const servicePointQuery = state.servicePointCode ? `?servicePoint=${encodeURIComponent(state.servicePointCode)}` : '';
      const response = await fetch(`/api/public/shops/${encodeURIComponent(state.slug)}${servicePointQuery}`, { cache: 'no-store' }); const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data) throw new Error(result.error || 'Cette boutique n’est pas disponible.');
      state.store = result.data.store; state.products = result.data.products || []; state.orderPolicy = result.data.orderPolicy || state.orderPolicy;
      $$('[data-order-recovery]').forEach((link) => { link.href = `/order-recovery/?store=${encodeURIComponent(state.slug)}`; });
      restoreCart(); const pending = restoreOrderDraft();
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
      const contacts = [];
      if (store.phone) contacts.push(`<a href="tel:${esc(store.phone)}">Téléphone : ${esc(store.phone)}</a>`);
      if (store.whatsapp) contacts.push(`<a href="https://wa.me/${esc(store.whatsapp.replace(/\D/g,''))}" target="_blank" rel="noopener">WhatsApp : ${esc(store.whatsapp)}</a>`);
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
      renderProducts(); renderCart(); updateCheckoutControls();
      if (pending) { const error = $('#checkoutError'); error.textContent = 'Une tentative précédente n’a pas reçu de confirmation. Vos informations sont restaurées; réessayez pour vérifier ou reprendre la même commande.'; error.hidden = false; }
    } catch (error) { showError(error.message || 'Impossible de charger cette boutique.'); }
  }
  function renderProducts(filter = '') {
    const grid = $('#productsGrid'); const query = filter.trim().toLocaleLowerCase('fr');
    const products = state.products.filter((product) => {
      const textMatch = [product.name, product.description, product.sku, product.category].join(' ').toLocaleLowerCase('fr').includes(query);
      const categoryMatch = !state.selectedCategory || product.category === state.selectedCategory; return textMatch && categoryMatch;
    });
    const shownCategories = state.selectedCategory ? ` · ${state.selectedCategory}` : ''; const noun=state.sectorCopy?.noun||'produit';
    $('#catalogueCount').textContent = `${products.length} ${noun}${products.length === 1 ? '' : 's'}${shownCategories}`;
    if (!products.length) { grid.innerHTML = '<p class="empty">Aucun produit ne correspond à cette recherche.</p>'; applyTypography(); updateCheckoutControls(); return; }
    grid.innerHTML = products.map((product) => {
      const available = product.available !== false; const quantity = state.cart.get(product.id) || 0; const photos = photoList(product);
      const currentIndex = Math.min(state.photoIndexes.get(product.id) || 0, Math.max(0, photos.length - 1)); state.photoIndexes.set(product.id, currentIndex);
      const compare = Number(product.compareAtPriceXof) > Number(product.priceXof) ? `<del>${money(product.compareAtPriceXof)}</del>` : '';
      const image = photos[currentIndex] || '';
      const photoStrip = photos.length > 1 ? `<div class="product-thumbnails" aria-label="Autres photos de ${esc(product.name)}">${photos.map((url, index) => `<button class="product-thumbnail ${index === currentIndex ? 'active' : ''}" type="button" data-photo-product="${esc(product.id)}" data-photo-index="${index}" aria-label="Afficher la photo ${index + 1} de ${esc(product.name)}" aria-pressed="${index === currentIndex}"><img src="${esc(url)}" alt="" loading="lazy"></button>`).join('')}</div>` : '';
      const variants = (product.variants || []).filter((variant) => variant.name && variant.values?.length).map((variant) => `<span><strong>${esc(variant.name)} :</strong> ${variant.values.map(esc).join(' · ')}</span>`).join('');
      return `<article class="public-product"><div class="public-product-media"><div class="public-product-image">${image ? `<img src="${esc(image)}" alt="${esc(product.name)}" loading="lazy">` : '<span>PHOTO</span>'}</div>${photoStrip}</div><div class="public-product-content"><div><h3>${esc(product.name)}</h3>${product.category ? `<span class="public-category">${esc(product.category)}</span>` : ''}</div><p>${esc(product.description || '')}</p>${variants ? `<div class="product-variants">${variants}</div>` : ''}<div class="public-product-bottom"><div class="public-price">${compare}<strong>${money(product.priceXof)}</strong></div>${available ? `<button class="button primary" type="button" data-add="${esc(product.id)}" ${state.orderPending || !ordersAccepted() ? 'disabled' : ''}>${quantity ? `Ajouter · ${quantity} au panier` : esc(state.sectorCopy?.add || 'Ajouter au panier')}</button>` : '<span class="out-of-stock">Indisponible pour le moment</span>'}</div></div></article>`;
    }).join('');
    applyTypography();
    $$('[data-add]', grid).forEach((button) => button.addEventListener('click', () => changeQuantity(button.dataset.add, (state.cart.get(button.dataset.add) || 0) + 1)));
    $$('[data-photo-product]', grid).forEach((button) => button.addEventListener('click', () => { state.photoIndexes.set(button.dataset.photoProduct, Number(button.dataset.photoIndex) || 0); renderProducts($('#productSearch').value); }));
    updateCheckoutControls();
  }
  function changeQuantity(id, quantity) {
    const product = state.products.find((item) => item.id === id); if (state.orderPending || !ordersAccepted() || !product || product.available === false) return;
    if (quantity <= 0) state.cart.delete(id); else state.cart.set(id, Math.min(999, quantity));
    saveCart(); renderProducts($('#productSearch').value); renderCart();
  }
  function renderCart() {
    const root = $('#cartLines'); const lines = [...state.cart.entries()].map(([id, quantity]) => ({ product: state.products.find((product) => product.id === id), quantity })).filter((row) => row.product);
    const count = lines.reduce((sum, row) => sum + row.quantity, 0); $('#cartCount').textContent = String(count);
    if (!lines.length) { root.innerHTML = '<p class="empty">Votre panier est vide.</p>'; $('#cartTotal').textContent = money(0); updateCheckoutControls(); return; }
    root.innerHTML = lines.map(({ product, quantity }) => `<div class="cart-line"><div><strong>${esc(product.name)}</strong><small>${money(product.priceXof)} · ${money(Number(product.priceXof) * quantity)}</small></div><div class="cart-qty"><button type="button" aria-label="Retirer une unité" data-minus="${esc(product.id)}">−</button><span>${quantity}</span><button type="button" aria-label="Ajouter une unité" data-plus="${esc(product.id)}">+</button></div></div>`).join('');
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
      const intent = { customerName: $('#customerName').value.trim(), customerPhone: $('#customerPhone').value.trim(), customerEmail: $('#customerEmail').value.trim(),
        deliveryAddress: $('#deliveryAddress').value.trim(), note: $('#customerNote').value.trim(), servicePointCode: state.servicePoint?.publicCode || '', tablePhoto:state.tablePhotoData||'', items: [...state.cart].map(([productId, quantity]) => ({ productId, quantity })) };
      const draft = saveOrderDraft(intent); body = { ...draft.body, clientRequestId: draft.requestId };
    }
    state.orderPending = true; state.submitting = true; updateCheckoutControls();
    let response = null;
    try {
      response = await fetch(`/api/public/shops/${encodeURIComponent(state.slug)}/orders`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { const failure = new Error(result.error || `Erreur ${response.status}`); failure.status = response.status; throw failure; }
      if (!result?.data?.order?.reference) throw new Error('La confirmation de commande est incomplète.');
      state.cart.clear(); saveCart(); clearOrderDraft(); state.orderPending = false; stopTableCamera();
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
  $('#clearCart').addEventListener('click', () => { if (state.orderPending || !ordersAccepted()) return; state.cart.clear(); saveCart(); renderProducts($('#productSearch').value); renderCart(); });
  $('#productSearch').addEventListener('input', () => renderProducts($('#productSearch').value));
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
  $('#cartJump').addEventListener('click', () => { if (window.innerWidth <= 720) $('#checkout').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  loadShop();
})();
