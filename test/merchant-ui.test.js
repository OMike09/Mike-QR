'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
const clone = (value) => JSON.parse(JSON.stringify(value));

class FakeEventSource {
  static instances = [];
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; FakeEventSource.instances.push(this); }
  addEventListener(name, callback) { this.listeners.set(name, callback); }
  close() { this.closed = true; }
  emit(name, data) { this.listeners.get(name)?.({ data: JSON.stringify(data) }); }
}

function jsonResponse(data, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return clone(data); } }; }

test('interface marchande simulée : connexion, thème persisté, produit et badge lu/non-lu', async (t) => {
  FakeEventSource.instances = [];
  const html = await fs.readFile(path.join(root, 'public/merchant.html'), 'utf8');
  const script = await fs.readFile(path.join(root, 'public/merchant.js'), 'utf8');
  const storeSlugPattern = html.match(/id="storeSlug"[^>]*pattern="([^"]+)"/)?.[1]; assert.ok(storeSlugPattern); assert.doesNotThrow(() => new RegExp(storeSlugPattern, 'v'), 'the public shop slug validation pattern must compile in modern browsers');
  const dom = new JSDOM(html, { url: 'https://merchant.example.test/merchant/', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  const theme = { template: 'modern', colors: { primary: '#0d725c', secondary: '#d4af37', background: '#f3f7f4', text: '#162622', button: '#0d725c', card: '#ffffff' }, font: 'Inter', textSize: 'normal', buttonShape: 'rounded', cardShape: 'rounded', menuStyle: 'pills', productLayout: 'grid', sections: { description: true, categories: true, contact: true, hours: true }, sectionOrder: ['cover','intro','categories','products','contact'] };
  let store = { id: 'shop-1', slug: 'demo-shop', name: 'Démo Marchande', sector:'restaurant', requireTablePhoto:true, description: 'Description', theme: clone(theme), isPublished: true, acceptsOrders: true, deliveryEnabled: true, pickupEnabled: true };
  let products = []; let customerBlocks = []; let notifications = [{ id: 'notification-1', title: 'Nouvelle commande reçue', message: 'Commande OY-DEMO', orderId: 'order-1', createdAt: new Date().toISOString(), readAt: null }];
  const calls = []; let mediaSequence = 0;
  w.fetch = async (url, options = {}) => {
    const path = String(url); const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, method, body });
    if (path.endsWith('/auth/me')) return jsonResponse({ data: { username: 'demo-shop', displayName: 'Démo Marchande', mustChangePassword: false } });
    if (path === '/api/merchant/media' && method === 'POST') { mediaSequence += 1; const id = `00000000-0000-4000-8000-${String(mediaSequence).padStart(12, '0')}`; return jsonResponse({ data: { id, url: `/media/merchant/${id}` } }, 201); }
    if (path.startsWith('/api/merchant/media/') && method === 'DELETE') return jsonResponse({ ok: true });
    if (path === '/api/merchant/store' && method === 'GET') return jsonResponse({ data: clone(store) });
    if (path === '/api/merchant/store' && method === 'PUT') { store = { ...store, ...clone(body) }; return jsonResponse({ data: clone(store) }); }
    if (path.startsWith('/api/merchant/orders?') && method === 'GET') return jsonResponse({ data: [], total: 0, page: 1, limit: 50 });
    if (path.startsWith('/api/merchant/customer-blocks?') && method === 'GET') {
      const status = new URL(path, 'https://merchant.example.test').searchParams.get('status') || '';
      return jsonResponse({ data: clone(customerBlocks.filter((row) => !status || row.status === status)), total: customerBlocks.length, page: 1, limit: 50 });
    }
    if (path === '/api/merchant/customer-blocks' && method === 'POST') {
      const digits = body.phone.replace(/\D/g, ''); const row = { id: 'block-1', phoneLast4: digits.slice(-4), phoneMasked: `•••• ${digits.slice(-4)}`, reason: body.reason, status: 'active', createdAt: new Date().toISOString(), attemptCount: 0, lastAttemptAt: null, history: [{ eventType: 'blocked', reason: body.reason, createdAt: new Date().toISOString() }], recentAttempts: [] };
      customerBlocks.unshift(row); return jsonResponse({ data: clone(row), idempotent: false }, 201);
    }
    const unblockId = path.startsWith('/api/merchant/customer-blocks/') && path.endsWith('/unblock') ? decodeURIComponent(path.split('/')[4]) : '';
    if (unblockId && method === 'POST') { const row = customerBlocks.find((item) => item.id === unblockId); if (row) { row.status = 'unblocked'; row.unblockReason = body.reason; row.unblockedAt = new Date().toISOString(); row.history.push({ eventType: 'unblocked', reason: body.reason, createdAt: row.unblockedAt }); } return jsonResponse({ data: clone(row), idempotent: false }); }
    if (path === '/api/merchant/qr') return jsonResponse({ data: null });
    if (path === '/api/merchant/products' && method === 'GET') return jsonResponse({ data: clone(products) });
    if (path === '/api/merchant/products' && method === 'POST') { const product = { ...clone(body), id: 'product-1', available: true, createdAt: new Date().toISOString() }; products = [product]; return jsonResponse({ data: product }, 201); }
    if (path === '/api/merchant/stats') return jsonResponse({ data: { products: products.length, orders: 0, pendingOrders: 0, orderValueXof: 0, qrScans: 0, availableProducts: products.length, outOfStock: 0, completedOrders: 0, cancelledOrders: 0, completedOrderValueXof: 0, topProducts: [], ordersByDay: [], recentOrders: [] } });
    if (path.startsWith('/api/merchant/notifications/') && path.endsWith('/read')) { const id = path.split('/').at(-2); const item = notifications.find((row) => row.id === id); if (item) item.readAt = new Date().toISOString(); return jsonResponse({ data: clone(notifications), unreadCount: notifications.filter((row) => !row.readAt).length }); }
    if (path.startsWith('/api/merchant/notifications/read-orders')) { return jsonResponse({ data: clone(notifications), unreadCount: notifications.filter((row) => !row.readAt).length }); }
    if (path.startsWith('/api/merchant/notifications')) return jsonResponse({ data: clone(notifications), unreadCount: notifications.filter((row) => !row.readAt).length });
    if (path.endsWith('/auth/logout')) return jsonResponse({ ok: true });
    return jsonResponse({ data: {} });
  };
  w.EventSource = FakeEventSource; w.setInterval = () => 1; w.confirm=()=>true; Object.defineProperty(w.navigator, 'onLine', { value: true, configurable: true });
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, set fillStyle(_value) {} });
  w.eval(script); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(w.document.querySelector('#appView').hidden, false, `a valid existing merchant session opens the dashboard: ${w.document.querySelector('#loginError').textContent}`);
  assert.equal(w.document.querySelector('#merchantName').textContent, 'Démo Marchande');
  assert.equal(w.document.querySelector('#notificationTabBadge').textContent, '1');
  assert.equal(w.document.querySelector('#tablePhotoRequirementField').hidden,false,'the saved photo requirement is visible for restaurant and maquis sectors');
  assert.equal(w.document.querySelector('#requireTablePhoto').checked,true,'the persisted table-photo preference is restored');
  const storeSector=w.document.querySelector('#storeSector');storeSector.value='hardware';storeSector.dispatchEvent(new w.Event('change',{bubbles:true}));
  assert.equal(w.document.querySelector('#tablePhotoRequirementField').hidden,true,'non-restaurant sectors cannot expose the table-photo requirement');
  assert.equal(w.document.querySelector('#requireTablePhoto').checked,false,'leaving the supported sector clears the ineligible requirement');
  storeSector.value='restaurant';storeSector.dispatchEvent(new w.Event('change',{bubbles:true}));w.document.querySelector('#requireTablePhoto').checked=true;
  const fontFamilies=['Poppins','Montserrat','Roboto','Open Sans','Lato','Inter','Nunito','Raleway','Ubuntu','Oswald','Playfair Display','Merriweather','Source Sans 3','DM Sans','Manrope','Rubik','Work Sans','Lora','Libre Baskerville','Archivo'];
  const fontOptions=[...w.document.querySelector('#themeFont').options].map((option)=>option.value);
  assert.deepEqual(fontOptions,fontFamilies,'the merchant font select contains all 20 requested, server-supported families');
  assert.deepEqual([...w.document.querySelectorAll('#themeFontGallery [data-font]')].map((button)=>button.dataset.font),fontFamilies,'every family has its own selectable preview');
  assert.equal(w.document.querySelectorAll('#typographyControls .typography-item').length,11,'all public text categories have independent controls');
  for(const input of w.document.querySelectorAll('#typographyControls input[type="range"][id$="-size"]')){assert.equal(input.min,'16');assert.equal(input.max,'30');}
  const sourceSans=w.document.querySelector('#themeFontGallery [data-font="Source Sans 3"]');sourceSans.click();
  assert.equal(w.document.querySelector('#themeFont').value,'Source Sans 3','selecting the 13th requested family works instead of silently falling back');
  const shopNameSize=w.document.querySelector('#typo-shopName-size');shopNameSize.value='30';shopNameSize.dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.equal(w.document.querySelector('#themePreviewName').style.fontSize,'30px','the 30 px slider updates the live preview');
  w.document.querySelector('#previewMobile').click();
  assert.equal(w.document.querySelector('#storeThemePreview').classList.contains('preview-mobile'),true,'the preview responds to the mobile viewport toggle');
  const fontsCss=await fs.readFile(path.join(root,'public/fonts.css'),'utf8');
  for(const font of fontFamilies)assert.ok(fontsCss.includes(`font-family:'${font}'`),`a local font-face is declared for ${font}`);
  assert.match(html,/<link rel="stylesheet" href="\/fonts\.css">/,'the merchant preview loads locally hosted fonts');
  const dashboardCss=await fs.readFile(path.join(root,'public/merchant.css'),'utf8');
  assert.doesNotMatch(dashboardCss,/\.metric-grid\s*\{[^}]*position\s*:\s*(?:sticky|fixed)/s,'dashboard statistics remain in normal document flow');
  assert.doesNotMatch(dashboardCss,/\.panel\s*\{[^}]*position\s*:\s*(?:sticky|fixed)/s,'the overview card itself is not sticky or fixed');

  const primary = w.document.querySelector('#themePrimary'); primary.value = '#123456'; primary.dispatchEvent(new w.Event('input', { bubbles: true }));
  assert.equal(w.document.querySelector('#storeThemePreview').style.getPropertyValue('--shop-primary'), '#123456', 'the visual theme preview updates immediately');
  w.document.querySelector('#themeForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await tick(); await tick();
  assert.equal(store.theme.colors.primary, '#123456', 'theme edits are sent to the persistent store API');
  assert.equal(store.theme.font,'Source Sans 3','the selected requested font family is persisted with the store theme');
  assert.equal(store.requireTablePhoto,true,'the restaurant photo rule is persisted through the merchant store form');
  assert.ok(calls.some((call) => call.path === '/api/merchant/store' && call.method === 'PUT'));
  w.document.querySelector('#resetThemeButton').click();await tick();await tick();
  assert.equal(store.theme.font,'Inter','reset persists the initial font instead of only changing the preview');
  assert.equal(store.theme.colors.primary,'#0d725c');assert.equal(store.name,'Démo Marchande','reset only updates the theme and preserves the saved commercial profile');
  assert.equal(store.requireTablePhoto,true,'theme reset leaves the restaurant order-photo configuration unchanged');

  w.document.querySelector('[data-tab="products"]').click(); await tick();
  w.document.querySelector('#newProductButton').click();
  w.document.querySelector('#productName').value = 'Article de test'; w.document.querySelector('#productPrice').value = '2500';
  w.document.querySelector('#productForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(products.length, 1); assert.equal(products[0].name, 'Article de test');
  assert.match(w.document.querySelector('#productList').textContent, /Article de test/);

  w.prompt = () => 'Vérification terminée';
  w.document.querySelector('[data-tab="orders"]').click(); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.ok(w.document.querySelector('#customerBlockForm'), 'the merchant can manage store-specific customer restrictions from the order panel');
  w.document.querySelector('#customerBlockPhone').value = '+225 0100000000'; w.document.querySelector('#customerBlockReason').value = 'Commandes frauduleuses documentées';
  w.document.querySelector('#customerBlockForm').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true })); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(calls.some((call) => call.path === '/api/merchant/customer-blocks' && call.method === 'POST'), 'blocking is persisted via the merchant API');
  assert.equal(w.document.querySelector('#customerBlockPhone').value, '', 'the form resets through the captured form element after the asynchronous API call');
  assert.equal(w.document.querySelector('#customerBlockReason').value, '');
  assert.match(w.document.querySelector('#customerBlockList').textContent, /0000/); assert.match(w.document.querySelector('#customerBlockList').textContent, /frauduleuses/);
  assert.doesNotMatch(w.document.querySelector('#customerBlockList').textContent, /225 0100000000/, 'the visible restriction only shows the masked suffix');
  w.document.querySelector('[data-unblock-customer="block-1"]').click(); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(calls.some((call) => call.path === '/api/merchant/customer-blocks/block-1/unblock' && call.method === 'POST'), 'unblocking uses the scoped API and keeps the history');
  const restrictionFilter = w.document.querySelector('#customerBlockStatus'); restrictionFilter.value = 'unblocked'; restrictionFilter.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.match(w.document.querySelector('#customerBlockList').textContent, /Débloqué/); assert.match(w.document.querySelector('#customerBlockList').textContent, /Vérification terminée/);

  let scrollCalls = 0; Object.defineProperty(w, 'scrollY', { configurable: true, get: () => 455 }); w.scrollTo = () => { scrollCalls += 1; };
  w.createImageBitmap = async () => ({ width: 16, height: 16, close() {} });
  w.HTMLCanvasElement.prototype.toBlob = function(callback) { callback(new w.Blob(['compressed-image'], { type: 'image/webp' })); };
  w.HTMLCanvasElement.prototype.getContext = () => ({ fillRect() {}, clearRect() {}, drawImage() {}, set fillStyle(_value) {} });
  const logoInput = w.document.querySelector('#storeLogoFile'); Object.defineProperty(logoInput, 'files', { configurable: true, value: [new w.File(['photo'], 'logo.png', { type: 'image/png' })] });
  logoInput.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(w.document.querySelector('#storeLogoData').value, '/media/merchant/00000000-0000-4000-8000-000000000001');
  assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'choosing and uploading the logo does not adjust the page scroll');
  w.document.querySelector('#removeStoreLogo').click(); await tick();
  assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'removing an image does not jump or compensate the scroll position');
  const coverInput = w.document.querySelector('#storeCoverFile'); Object.defineProperty(coverInput, 'files', { configurable: true, value: [new w.File(['cover'], 'cover.jpg', { type: 'image/jpeg' })] });
  coverInput.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.match(w.document.querySelector('#storeCoverData').value, /media\/merchant/); assert.equal(w.scrollY, 455);
  w.document.querySelector('#removeStoreCover').click(); await tick(); assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'cover selection and removal keep the viewport position');
  const productImagesInput = w.document.querySelector('#productImageFile'); Object.defineProperty(productImagesInput, 'files', { configurable: true, value: [new w.File(['one'], 'one.png', { type: 'image/png' }), new w.File(['two'], 'two.png', { type: 'image/png' })] });
  productImagesInput.dispatchEvent(new w.Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(w.document.querySelectorAll('#productImageGallery .product-image-item').length, 2);
  w.document.querySelector('[data-remove-product-image="0"]').click(); await tick();
  assert.equal(w.document.querySelectorAll('#productImageGallery .product-image-item').length, 1);
  assert.equal(w.scrollY, 455); assert.equal(scrollCalls, 0, 'photo selection and deletion leave the existing scroll position untouched');

  w.document.querySelector('[data-read-notification="notification-1"]').click(); await tick();
  assert.equal(w.document.querySelector('#notificationTabBadge').hidden, true, 'marking the event read removes the persistent unread badge');
  notifications.push({ id: 'notification-2', title: 'Nouvelle commande reçue', message: 'Commande OY-LIVE', orderId: 'order-2', createdAt: new Date().toISOString(), readAt: null });
  FakeEventSource.instances[0].emit('commerce', { type: 'new_order', orderId: 'order-2', reference: 'OY-LIVE' }); await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(w.document.querySelector('#notificationTabBadge').textContent, '1', 'live order refreshes the same server-backed unread counter');
  assert.match(w.document.querySelector('#toast').textContent, /Nouvelle commande reçue/);
  w.document.querySelector('#logoutButton').click(); await tick(); await tick();
  assert.equal(w.document.querySelector('#loginView').hidden, false, 'logout returns to the merchant login view');
  assert.equal(w.document.querySelector('#appView').hidden, true); assert.equal(w.location.pathname, '/merchant/', 'logout stays within the dedicated merchant entry');
  assert.equal(FakeEventSource.instances[0].closed, true, 'logout closes the merchant live-notification stream');
});

test('boutique publique simulée : personnalisation, ordre des sections, catégories et galerie photo', async (t) => {
  const html = await fs.readFile(path.join(root, 'public/shop.html'), 'utf8'); const script = await fs.readFile(path.join(root, 'public/shop.js'), 'utf8');
  const dom = new JSDOM(html, { url: 'https://merchant.example.test/shop/demo-shop', runScripts: 'outside-only', pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  const store = { slug: 'demo-shop', name: 'Awa Boutique', sector:'restaurant', description: 'Créations à Abidjan', logo: '/media/merchant/logo.png', coverImageUrl: '/media/merchant/cover.png', phone: '+225 0700000000', whatsapp: '+225 0700000000', email: 'awa@example.test', address: 'Cocody', deliveryNote: 'Retrait possible', deliveryEnabled: true, pickupEnabled: true, deliveryFeeXof: 1500, openingHours: '09:00–18:00', acceptsOrders: true,
    theme: { template: 'elegant', colors: { primary: '#205a49', secondary: '#d4af37', background: '#faf7f0', text: '#162622', button: '#205a49', card: '#ffffff' }, font: 'Source Sans 3', textSize: 'normal', typography:{shopName:{size:30,weight:800,italic:true,decoration:'underline',lineHeight:1.2,letterSpacing:0.02,align:'center',transform:'uppercase',color:'#123456',opacity:0.9},title:{size:24,weight:700}}, buttonShape: 'pill', cardShape: 'soft', menuStyle: 'underline', productLayout: 'list', sections: { description: true, categories: true, contact: true, hours: true }, sectionOrder: ['products','cover','intro','categories','contact'] } };
  const products = [{ id: 'product-one', name: 'Sac tissé', category: 'Accessoires', description: 'Un sac artisanal', sku: 'SAC-1', priceXof: 2500, compareAtPriceXof: 3000, imageData: '/media/merchant/photo-a.png', imageUrls: ['/media/merchant/photo-a.png','/media/merchant/photo-b.png'], variants: [{ name: 'Couleur', values: ['Noir','Naturel'] }], available: true, status: 'active' }, { id: 'product-two', name: 'Pochette', category: 'Maison', description: '', sku: '', priceXof: 1000, imageUrls: [], available: true, status: 'active' }];
  const ads=[{id:'ad-public-1',title:'Collection du jour',message:'Nouveautés disponibles.',destination:'/shop/demo-shop'}];
  const rewardCampaigns=[{id:'reward-public-1',title:'Bienvenue',description:'Participation gratuite.',endsAt:'2030-01-01T00:00:00.000Z',remainingParticipants:5,authorizationReference:'ARJH-PUBLIC-001',rules:'Référence présentée au PDG pour examen hors plateforme.'}];const claimRequests=[];
  w.fetch = async(url,options={}) => {if(String(url).includes('/rewards/')&&options.method==='POST'){claimRequests.push(JSON.parse(options.body));return jsonResponse({data:{prizeLabel:'Remise de 10 %',code:'R-CLIENT-TEST',claim:{expiresAt:'2030-02-01T00:00:00.000Z'},idempotent:false}},201);}return jsonResponse({data:{store,products,ads,rewardCampaigns}});}; w.eval(script); await tick(); await tick();
  const content = w.document.querySelector('#shopContent'); assert.equal(content.hidden, false);
  assert.equal(content.dataset.template, 'elegant'); assert.equal(content.dataset.layout, 'list'); assert.equal(content.dataset.sector,'restaurant'); assert.equal(content.style.getPropertyValue('--shop-primary'), '#205a49');
  assert.equal(content.style.fontFamily,'"Source Sans 3", sans-serif','the public catalogue applies the selected, self-hosted family');
  assert.equal(w.document.querySelector('#shopName').style.fontSize,'30px');assert.equal(w.document.querySelector('#shopName').style.fontWeight,'800');
  assert.equal(w.document.querySelector('#shopName').style.fontStyle,'italic');assert.equal(w.document.querySelector('#shopName').style.textDecoration,'underline');
  assert.equal(w.document.querySelector('#shopName').style.textAlign,'center');assert.equal(w.document.querySelector('#shopName').style.textTransform,'uppercase');
  assert.equal(w.document.querySelector('#shopSectorLabel').textContent,'MENU DU RESTAURANT');assert.equal(w.document.querySelector('#catalogueTitle').textContent,'Plats et boissons');
  assert.match(w.document.querySelector('#shopAds').textContent,/Collection du jour/);assert.match(w.document.querySelector('#shopRewards').textContent,/Bienvenue/);assert.match(w.document.querySelector('#shopRewards').textContent,/ARJH-PUBLIC-001/);assert.match(w.document.querySelector('#shopRewards').textContent,/examen hors plateforme/);
  assert.equal(w.document.querySelector('#shopSections').firstElementChild.id, 'shopSectionProducts', 'saved section order is applied to the public page');
  assert.equal(w.document.querySelector('#shopCover').getAttribute('src'), '/media/merchant/cover.png');
  assert.equal(w.document.querySelectorAll('#categoryFilters [data-category]').length, 3);
  assert.equal(w.document.querySelectorAll('.product-thumbnail').length, 2);
  const image = w.document.querySelector('.public-product-image img'); assert.match(image.getAttribute('src'), /photo-a\.png$/);
  w.document.querySelector('[data-photo-index="1"]').click();
  assert.match(w.document.querySelector('.public-product-image img').getAttribute('src'), /photo-b\.png$/);
  w.document.querySelector('[data-category="Accessoires"]').click(); assert.equal(w.document.querySelectorAll('.public-product').length, 1);
  assert.match(w.document.querySelector('#shopContact').textContent, /WhatsApp/);
  assert.match(w.document.querySelector('#shopDeliveryFee').textContent, /1\s?500/);
  const claimForm=w.document.querySelector('[data-claim-campaign="reward-public-1"]');claimForm.querySelector('input[type="tel"]').value='+225 07 00 00 00 00';
  claimForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.equal(claimRequests.length,1);assert.equal(claimRequests[0].phone,'+225 07 00 00 00 00');assert.ok(claimRequests[0].requestId.length>=16);
  assert.match(claimForm.querySelector('.reward-result').textContent,/R-CLIENT-TEST/,'the public page displays a code returned by the server');
});

test('catalogue public : libellés sectoriels cohérents pour restaurant, maquis, quincaillerie et vêtements', async () => {
  const html=await fs.readFile(path.join(root,'public/shop.html'),'utf8');const script=await fs.readFile(path.join(root,'public/shop.js'),'utf8');
  const sectors=[['restaurant','MENU DU RESTAURANT','Plats et boissons'],['maquis','MENU DU MAQUIS','Plats, boissons et grillades'],['hardware','QUINCAILLERIE · CATALOGUE','Matériel et fournitures'],['clothing','COLLECTION · VÊTEMENTS','Vêtements et accessoires']];
  for(const [sector,label,title] of sectors){
    const dom=new JSDOM(html,{url:`https://sector.example.test/shop/${sector}`,runScripts:'outside-only',pretendToBeVisual:true});const w=dom.window;
    const store={slug:sector,name:`Boutique ${sector}`,sector,description:'Catalogue sectoriel',theme:{}};
    w.fetch=async()=>jsonResponse({data:{store,products:[],ads:[],rewardCampaigns:[]}});w.eval(script);await tick();await tick();
    assert.equal(w.document.querySelector('#shopContent').dataset.sector,sector);assert.equal(w.document.querySelector('#shopSectorLabel').textContent,label);assert.equal(w.document.querySelector('#catalogueTitle').textContent,title);
    assert.ok(w.document.querySelector('#productSearch').placeholder.length>0);dom.window.close();
  }
});

test('outils marchand : brouillons conservés, QR téléchargeable, campagnes et bons reliés aux API', async (t) => {
  const html=await fs.readFile(path.join(root,'public/merchant.html'),'utf8');const script=await fs.readFile(path.join(root,'public/merchant.js'),'utf8');const qrLibrary=await fs.readFile(path.join(root,'public/vendor/qrcode.js'),'utf8');
  const dom=new JSDOM(html,{url:'https://merchant.example.test/merchant/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());const w=dom.window;
  const calls=[];let adAttempts=0;let sequence=0;let ads=[];let points=[];let rewards=[];let claims=[];let cards=[];let giftBalance=1200;
  w.fetch=async(url,options={})=>{
    const path=String(url);const method=options.method||'GET';const body=options.body?JSON.parse(options.body):{};calls.push({path,method,body});
    if(path==='/api/merchant/auth/me')return jsonResponse({data:{id:'merchant-ui',username:'ui.merchant',displayName:'UI Marchand',mustChangePassword:false}});
    if(path==='/api/merchant/store'&&method==='GET')return jsonResponse({data:{id:'store-ui',merchantId:'merchant-ui',name:'Boutique UI',slug:'boutique-ui',sector:'general',theme:{},isPublished:true}});
    if(path==='/api/merchant/store'&&method==='PUT')return jsonResponse({data:{id:'store-ui',merchantId:'merchant-ui',name:body.name||'Boutique UI',slug:'boutique-ui',sector:body.sector||'general',theme:body.theme||{},isPublished:true}});
    if(path==='/api/merchant/qr')return jsonResponse({data:null});
    if(path==='/api/merchant/products')return jsonResponse({data:[]});
    if(path==='/api/merchant/stats')return jsonResponse({data:{products:0,orders:0,pendingOrders:0,orderValueXof:0,qrScans:0,availableProducts:0,outOfStock:0,completedOrders:0,cancelledOrders:0,completedOrderValueXof:0,recentOrders:[],topProducts:[],ordersByDay:[]}});
    if(path==='/api/merchant/notifications?limit=60')return jsonResponse({data:[],unreadCount:0});
    if(path==='/api/merchant/push/config')return jsonResponse({enabled:false,publicKey:''});
    if(path==='/api/merchant/ads'&&method==='GET')return jsonResponse({data:clone(ads)});
    if(path==='/api/merchant/ads'&&method==='POST'){
      adAttempts++;if(adAttempts===1)return jsonResponse({error:'Connexion interrompue'},503);
      const row={id:'ad-ui-1',...clone(body),destination:'/shop/boutique-ui',createdAt:new Date().toISOString()};ads=[row,...ads];return jsonResponse({data:row},201);
    }
    if(path==='/api/merchant/service-points'&&method==='GET')return jsonResponse({data:clone(points)});
    if(path==='/api/merchant/service-points'&&method==='POST'){
      const row={id:'point-ui-1',storeId:'store-ui',publicCode:'T-QRUI123',status:'active',qrScanCount:0,...clone(body)};points=[row,...points];return jsonResponse({data:{...row,path:`/t/${row.publicCode}`,url:`https://merchant.example.test/t/${row.publicCode}`}},201);
    }
    if(path==='/api/merchant/reward-campaigns'&&method==='GET')return jsonResponse({data:clone(rewards)});
    if(path==='/api/merchant/reward-campaigns'&&method==='POST'){
      const row={id:'reward-ui-1',storeId:'store-ui',remainingParticipants:2,maxParticipants:2,status:'paused',authorizationStatus:body.authorizationReference?'pending':'not_submitted',prizes:[],...clone(body)};rewards=[row,...rewards];return jsonResponse({data:row},201);
    }
    if(path==='/api/merchant/reward-claims'&&method==='GET')return jsonResponse({data:clone(claims)});
    if(path==='/api/merchant/reward-claims/redeem'&&method==='POST'){
      const row={id:'claim-ui-1',codeLast4:'1234',prizeLabel:'Réduction',status:'redeemed',issuedAt:new Date().toISOString()};claims=[row,...claims];return jsonResponse({data:row});
    }
    if(path==='/api/merchant/gift-cards'&&method==='GET')return jsonResponse({data:clone(cards)});
    if(path==='/api/merchant/gift-cards'&&method==='POST'){
      const row={id:'card-ui-1',storeId:'store-ui',codeLast4:'ABCD',faceValueXof:body.amountXof,balanceXof:body.amountXof,status:'pending',createdAt:new Date().toISOString()};cards=[row,...cards];return jsonResponse({data:row,code:'GC-PRIVATE-UI-CODE'},201);
    }
    if(path==='/api/merchant/gift-cards/card-ui-1/activate'&&method==='POST'){
      cards=cards.map((row)=>({...row,status:'active'}));return jsonResponse({data:cards[0]});
    }
    if(path==='/api/merchant/gift-cards/redeem'&&method==='POST'){
      giftBalance-=body.amountXof;const card={...cards[0],balanceXof:giftBalance,status:giftBalance?'active':'redeemed'};cards=[card];return jsonResponse({data:{redemption:{id:'redemption-ui-1',amountXof:body.amountXof},card,idempotent:false}});
    }
    return jsonResponse({data:[]});
  };
  w.EventSource=FakeEventSource;w.setInterval=()=>1;Object.defineProperty(w.navigator,'onLine',{value:true,configurable:true});w.confirm=()=>true;
  const qrDraws=[];w.HTMLCanvasElement.prototype.getContext=()=>({fillRect(...args){qrDraws.push(args)},set fillStyle(_value){}});w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,QR';
  w.eval(qrLibrary);w.eval(script);await new Promise((resolve)=>setTimeout(resolve,25));
  assert.equal(w.document.querySelector('#appView').hidden,false,`merchant UI did not initialize: ${w.document.querySelector('#loginError').textContent}`);
  w.document.querySelector('[data-tab="advanced"]').click();await new Promise((resolve)=>setTimeout(resolve,15));

  const adForm=w.document.querySelector('#adForm');w.document.querySelector('#adTitle').value='Annonce locale';w.document.querySelector('#adMessage').value='Ouvert aujourd’hui';
  w.document.querySelector('#adTitle').dispatchEvent(new w.Event('input',{bubbles:true}));
  assert.ok(w.sessionStorage.getItem('oymike-merchant-advanced-draft:merchant-ui'),'advertising draft is stored locally without a server refresh');
  adForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,20));
  assert.match(w.document.querySelector('#advancedNotice').textContent,/Connexion interrompue/);assert.equal(w.document.querySelector('#adTitle').value,'Annonce locale');
  const firstAdRequest=calls.filter((row)=>row.path==='/api/merchant/ads'&&row.method==='POST').at(-1).body.requestId;
  adForm.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,20));
  const adRequests=calls.filter((row)=>row.path==='/api/merchant/ads'&&row.method==='POST');assert.equal(adRequests.length,2);assert.equal(adRequests[1].body.requestId,firstAdRequest,'retry after a dropped response keeps the same idempotency key');
  assert.match(w.document.querySelector('#adList').textContent,/Annonce locale/);

  w.document.querySelector('#servicePointName').value='Table UI 4';w.document.querySelector('#servicePointZone').value='Terrasse';
  w.document.querySelector('#servicePointForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,20));
  assert.match(w.document.querySelector('#servicePointList').textContent,/\/t\/T-QRUI123/);assert.ok(w.document.querySelector('[data-download-point="point-ui-1"]'),'the generated QR is offered as a PNG download');
  assert.ok(qrDraws.length>100,'the bundled QR encoder draws a real matrix of modules into the canvas');
  assert.ok(calls.some((row)=>row.path==='/api/merchant/service-points'&&row.method==='POST'&&row.body.requestId));

  w.document.querySelector('#rewardTitle').value='Offre de bienvenue';w.document.querySelector('#rewardCapacity').value='2';
  w.document.querySelector('#rewardPrizes').value='Réduction de 10 % | 1 | 2 | benefit\nPas de lot — merci de votre visite | 1 | 1 | no_prize';
  w.document.querySelector('#rewardAuthorizationReference').value='ARJH-UI-2026-001';w.document.querySelector('#rewardAuthorizationConfirmed').checked=true;w.document.querySelector('#rewardCompliance').checked=true;
  w.document.querySelector('#rewardForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,25));
  const rewardRequest=calls.find((row)=>row.path==='/api/merchant/reward-campaigns'&&row.method==='POST');assert.ok(rewardRequest);assert.equal(rewardRequest.body.entryFeeXof,0);assert.equal(rewardRequest.body.complianceAccepted,true);assert.equal(rewardRequest.body.prizes.length,2);assert.equal(rewardRequest.body.status,'paused');assert.equal(rewardRequest.body.authorizationReference,'ARJH-UI-2026-001');assert.equal(rewardRequest.body.authorizationConfirmed,true);
  assert.match(w.document.querySelector('#rewardList').textContent,/Offre de bienvenue/);assert.match(w.document.querySelector('#rewardList').textContent,/en attente du PDG/);

  w.document.querySelector('#giftCardAmount').value='1200';w.document.querySelector('#giftCardForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,25));
  assert.match(w.document.querySelector('#giftCardReveal').textContent,/GC-PRIVATE-UI-CODE/);assert.match(w.document.querySelector('#giftCardList').textContent,/en attente d’activation/);
  w.document.querySelector('[data-activate-gift="card-ui-1"]').click();await new Promise((resolve)=>setTimeout(resolve,10));assert.match(w.document.querySelector('#giftCardList').textContent,/actif/);
  w.document.querySelector('#giftRedeemCode').value='GC-PRIVATE-UI-CODE';w.document.querySelector('#giftRedeemAmount').value='500';
  w.document.querySelector('#giftCardRedeemForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,25));
  assert.match(w.document.querySelector('#advancedNotice').textContent,/solde restant 700 XOF/);
  assert.ok(calls.some((row)=>row.path==='/api/merchant/gift-cards/redeem'&&row.body.requestId));
  w.document.querySelector('#rewardRedeemCode').value='R-PRIVATE-UI-CODE';w.document.querySelector('#rewardRedeemForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await new Promise((resolve)=>setTimeout(resolve,10));
  assert.match(w.document.querySelector('#rewardClaimList').textContent,/Réduction/);
  assert.ok(calls.filter((row)=>row.method==='GET'&&row.path.startsWith('/api/merchant/')).length>=10,'the management screen loads each resource from its backend API');
});

test('console PDG : demandes ARJH chargées, examinées et auditées depuis la vue dédiée',async(t)=>{
  const html=await fs.readFile(path.join(root,'public/index.html'),'utf8');const script=await fs.readFile(path.join(root,'public/admin.js'),'utf8');
  const dom=new JSDOM(html,{url:'https://admin.example.test/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());const w=dom.window;const calls=[];
  let requests=[{id:'campaign-review-1',storeId:'store-1',merchantId:'merchant-1',storeName:'Maquis du Plateau',storeSlug:'maquis-plateau',merchantDisplayName:'Awa Traoré',title:'Offre de lancement',authorizationReference:'ARJH-2026-001',authorizationStatus:'pending',status:'paused',remainingParticipants:20,createdAt:'2026-01-01T00:00:00.000Z',prizes:[{label:'Repas offert',quantityTotal:10},{label:'Pas de lot',quantityTotal:10}]}];
  let blocks=[{id:'block-supervision-1',storeId:'store-1',merchantId:'merchant-1',storeName:'Maquis du Plateau',merchantDisplayName:'Awa Traoré',merchantUsername:'awa',phoneMasked:'•••• 6789',phoneLast4:'6789',reason:'Commandes frauduleuses documentées',status:'active',attemptCount:2,lastAttemptAt:'2026-10-10T10:00:00.000Z',createdAt:'2026-10-09T10:00:00.000Z',history:[{eventType:'blocked',reason:'Commandes frauduleuses documentées',actorType:'merchant',createdAt:'2026-10-09T10:00:00.000Z'}],recentAttempts:[{attemptedAt:'2026-10-10T09:00:00.000Z'},{attemptedAt:'2026-10-10T10:00:00.000Z'}]}];
  w.fetch=async(url,options={})=>{
    const path=String(url);const method=options.method||'GET';const body=options.body?JSON.parse(options.body):{};calls.push({path,method,body});
    if(path==='/api/health')return jsonResponse({demoMode:false,publicBaseUrl:'https://admin.example.test'});
    if(path==='/api/auth/me')return jsonResponse({authenticated:true,role:'admin'});
    if(path==='/api/admin/categories')return jsonResponse({data:[]});
    if(path==='/api/admin/dashboard')return jsonResponse({stats:{beneficiaries:0,activeCodes:0,totalCodes:0,pendingCodes:0,scans:0,scansLast7:0},recentCodes:[]});
    if(path==='/api/admin/codes?page=1&limit=25')return jsonResponse({data:[],total:0});
    if(path==='/api/admin/beneficiaries?page=1&limit=12')return jsonResponse({data:[],total:0});
    if(path==='/api/admin/scan-stats?period=all')return jsonResponse({total:0,byBeneficiary:[],byCode:[]});
    if(path==='/api/admin/settings')return jsonResponse({data:{defaultPublicTextSize:'normal'}});
    if(path==='/api/admin/reward-authorizations')return jsonResponse({data:clone(requests)});
    if(path==='/api/admin/reward-authorizations/campaign-review-1/decision'&&method==='POST'){
      requests=requests.map((row)=>({...row,authorizationStatus:body.decision,authorizationReviewedBy:'admin',authorizationReviewNote:body.reviewNote,authorizationReviewedAt:new Date().toISOString()}));
      return jsonResponse({data:requests[0]});
    }
    if(path.startsWith('/api/admin/merchant-customer-blocks?'))return jsonResponse({data:clone(blocks),total:blocks.length,page:1,limit:100});
    if(path==='/api/admin/merchant-customer-blocks/block-supervision-1/unblock'&&method==='POST'){
      blocks=blocks.map((row)=>({...row,status:'unblocked',unblockedAt:new Date().toISOString(),unblockReason:body.reason,history:[...row.history,{eventType:'unblocked',reason:body.reason,actorType:'admin',createdAt:new Date().toISOString()}]}));
      return jsonResponse({data:blocks[0],idempotent:false});
    }
    return jsonResponse({data:[],total:0});
  };
  w.setInterval=()=>1;w.clearInterval=()=>{};w.confirm=()=>true;w.prompt=()=> 'Document officiel consulté le 10 octobre 2026.';
  w.eval(script);await new Promise((resolve)=>setTimeout(resolve,40));
  w.document.querySelector('[data-view="reward-authorizations"]').click();await new Promise((resolve)=>setTimeout(resolve,20));
  assert.ok(calls.some((row)=>row.path==='/api/admin/reward-authorizations'&&row.method==='GET'));
  assert.match(w.document.querySelector('#rewardAuthorizationRows').textContent,/Maquis du Plateau/);assert.match(w.document.querySelector('#rewardAuthorizationRows').textContent,/ARJH-2026-001/);
  w.document.querySelector('[data-reward-auth-action="approved"]').click();await new Promise((resolve)=>setTimeout(resolve,25));
  const decision=calls.find((row)=>row.path.endsWith('/campaign-review-1/decision'));assert.ok(decision);assert.equal(decision.method,'POST');assert.equal(decision.body.decision,'approved');assert.match(decision.body.reviewNote,/Document officiel consulté/);
  assert.match(w.document.querySelector('#rewardAuthorizationRows').textContent,/Approuvée par le PDG/);
  w.document.querySelector('[data-view="customer-blocks"]').click();await new Promise((resolve)=>setTimeout(resolve,20));
  assert.ok(calls.some((row)=>row.path.startsWith('/api/admin/merchant-customer-blocks?')&&row.method==='GET'),'the PDG has a global store-restriction supervision view');
  assert.match(w.document.querySelector('#adminCustomerBlockRows').textContent,/Maquis du Plateau/);assert.match(w.document.querySelector('#adminCustomerBlockRows').textContent,/6789/);
  assert.doesNotMatch(w.document.querySelector('#adminCustomerBlockRows').textContent,/225010000000/,'the PDG view also masks full customer numbers');
  w.document.querySelector('[data-admin-unblock-customer="block-supervision-1"]').click();await new Promise((resolve)=>setTimeout(resolve,25));
  assert.ok(calls.some((row)=>row.path==='/api/admin/merchant-customer-blocks/block-supervision-1/unblock'&&row.method==='POST'),'the PDG can lift a restriction through the global route');
  assert.match(w.document.querySelector('#adminCustomerBlockRows').textContent,/Débloqué/);
});
