(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { role: '', admin: null, manager: null, managers: [], merchants: [], selectedId: '', detail: null, eventSource: null, uploading: false, toastTimer: 0, pollTimer: 0 };
  const loginScreen = $('#loginScreen'); const passwordNotice = $('#passwordNotice'); const app = $('#controlApp'); const detailRoot = $('#detailRoot');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const fmtDate = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const statuses = { pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', completed: 'Terminée', cancelled: 'Annulée' };
  const nextStatus = { pending: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], completed: [], cancelled: [] };
  const permissionFields = [['canManageStore', 'Gérer les informations de boutique'], ['canManageProducts', 'Gérer produits et stocks'], ['canManageOrders', 'Consulter et suivre les commandes'], ['canCreateStoreQr', 'Créer le QR de boutique'], ['canViewAudit', 'Consulter le journal commercial']];

  async function api(url, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers }); const result = await response.json().catch(() => ({}));
    if (response.status === 401) throw new Error(result.error || 'Session expirée.');
    if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
    return result;
  }
  function toast(message) { const node = $('#controlToast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3400); }
  function notice(message, show = true) { const node = $('#controlNotice'); node.textContent = message; node.hidden = !show; }
  function actorLabel() { return state.role === 'admin' ? 'PDG · contrôle total' : `Gestionnaire · @${state.manager?.username || ''}`; }
  function setAuthView() { loginScreen.hidden = false; passwordNotice.hidden = true; app.hidden = true; $('#controlPassword').value = ''; $('#controlLoginError').hidden = true; }
  function hideAuthAndShowApp() {
    loginScreen.hidden = true; passwordNotice.hidden = true; app.hidden = false; $('#actorLabel').textContent = actorLabel();
    $('#ceoLink').hidden = state.role !== 'admin'; $('#managerLink').hidden = state.role !== 'manager';
    const mayCreate = state.role === 'admin' || state.manager?.canManageMerchants === true;
    $('#createMerchantButton').hidden = !mayCreate;
    $('#scopeMessage').textContent = state.role === 'admin' ? 'Contrôle des comptes, boutiques, QR, produits, commandes, permissions et journaux.' : 'Vous ne voyez que les marchands qui vous appartiennent ou qui vous ont été attribués, selon vos droits.';
  }
  function managersForSelect(selected = '') {
    return '<option value="">Espace PDG / aucun responsable</option>' + state.managers.filter((m) => m.status === 'active' && !m.deletedAt).map((m) => `<option value="${esc(m.id)}"${m.id === selected ? ' selected' : ''}>${esc(m.displayName)} (@${esc(m.username)})</option>`).join('');
  }
  function merchantApi(path) { return state.role === 'admin' ? `/api/admin${path}` : `/api/manager${path}`; }
  function mayManageOwnMerchants(merchant = state.detail?.account || state.detail?.listRow) { return Boolean(state.role === 'manager' && state.manager?.canManageMerchants === true && merchant?.managerId === state.manager.id); }
  function can(permission, merchant = state.detail?.account || state.detail?.listRow) {
    if (state.role === 'admin') return true;
    if (!merchant) return false;
    if (mayManageOwnMerchants(merchant)) return true;
    return merchant.assignment?.[permission] === true;
  }
  function selectedRow() { return state.merchants.find((m) => m.id === state.selectedId) || null; }
  function renderMerchantList() {
    const root = $('#merchantCards');
    if (!state.merchants.length) { root.innerHTML = '<p class="empty">Aucun marchand dans votre périmètre.</p>'; return; }
    root.innerHTML = state.merchants.map((m) => `<button class="merchant-card ${m.id === state.selectedId ? 'selected' : ''}" type="button" data-select-merchant="${esc(m.id)}"><span class="mini-status ${esc(m.status)}">${m.status === 'active' ? 'Actif' : m.status === 'suspended' ? 'Suspendu' : 'Bloqué'}</span><strong>${esc(m.displayName)}</strong><small>@${esc(m.username)} · ${esc(m.storeName || 'Boutique non configurée')}</small><small>${Number(m.productCount) || 0} produits · ${Number(m.orderCount) || 0} commandes</small></button>`).join('');
    $$('[data-select-merchant]', root).forEach((button) => button.addEventListener('click', () => selectMerchant(button.dataset.selectMerchant)));
  }
  async function loadMerchants({ keepSelection = true } = {}) {
    const current = keepSelection ? state.selectedId : '';
    if (state.role === 'admin') {
      const [merchants, managers] = await Promise.all([api('/api/admin/merchants'), api('/api/admin/managers')]); state.merchants = merchants.data || []; state.managers = managers.data || [];
    } else { const result = await api('/api/manager/merchants'); state.merchants = result.data || []; }
    state.selectedId = current && state.merchants.some((m) => m.id === current) ? current : (state.merchants[0]?.id || '');
    renderMerchantList(); if (state.selectedId) await selectMerchant(state.selectedId); else { detailRoot.hidden = true; $('#emptyDetail').hidden = false; }
  }
  async function loadDetailData(merchantId) {
    const base = merchantApi(`/merchants/${encodeURIComponent(merchantId)}`); const result = await api(base);
    const account = result.data; const listRow = selectedRow();
    let storeData = account.store || null;
    if (!storeData && listRow?.storeId) storeData = { id: listRow.storeId, merchantId, slug: listRow.storeSlug, name: listRow.storeName,
      status: listRow.storeStatus, isPublished: listRow.storePublished, qrPublicCode: listRow.qrPublicCode, qrScanCount: listRow.qrScanCount };
    const detail = { account, listRow, store: storeData, qr: null, products: [], orders: [], audit: [], assignments: [] };
    const tasks = [];
    const mayCreateStoreQr = state.role === 'admin' || (state.manager?.canCreateCodes !== false && can('canCreateStoreQr', { ...account, assignment: listRow?.assignment }));
    if (mayCreateStoreQr && storeData?.id) tasks.push(api(`${base}/qr`).then((r) => { detail.qr = r.data || null; }).catch(() => {}));
    if (can('canManageProducts', { ...account, assignment: listRow?.assignment })) tasks.push(api(`${base}/products`).then((r) => { detail.products = r.data || []; }).catch(() => {}));
    if (can('canManageOrders', { ...account, assignment: listRow?.assignment })) tasks.push(api(`${base}/orders?page=1&limit=30`).then((r) => { detail.orders = r.data || []; }).catch(() => {}));
    if (state.role === 'admin') tasks.push(api(`${base}/assignments`).then((r) => { detail.assignments = r.data || []; }).catch(() => {}));
    if (state.role === 'admin' || can('canViewAudit', { ...account, assignment: listRow?.assignment })) tasks.push(api(`${base}/audit?page=1`).then((r) => { detail.audit = r.data || []; }).catch(() => {}));
    await Promise.all(tasks);
    detail.account.assignment = listRow?.assignment || null;
    detail.account.managerId = account.managerId || listRow?.managerId || '';
    detail.store = detail.store ? { ...detail.store, merchantId } : null;
    return detail;
  }
  async function selectMerchant(merchantId) {
    state.selectedId = merchantId; renderMerchantList(); $('#emptyDetail').hidden = true; detailRoot.hidden = false; detailRoot.innerHTML = '<p class="empty">Chargement des détails…</p>';
    try { state.detail = await loadDetailData(merchantId); renderDetail(); }
    catch (error) { detailRoot.innerHTML = `<p class="empty">${esc(error.message)}</p>`; }
  }
  function renderDetail() {
    const d = state.detail; if (!d) return;
    const account = d.account; const storeData = d.store; const canAccount = state.role === 'admin' || can('canManageStore', account);
    const canStore = can('canManageStore', account); const canProducts = can('canManageProducts', account); const canOrders = can('canManageOrders', account);
    const canQr = state.role === 'admin' || (state.manager?.canCreateCodes !== false && can('canCreateStoreQr', account));
    const managerName = state.managers.find((m) => m.id === account.managerId)?.displayName || (account.managerId ? 'Gestionnaire attribué' : 'PDG');
    detailRoot.innerHTML = `<div class="detail-banner"><div><span class="eyebrow">COMPTE MARCHAND</span><h2>${esc(account.displayName)}</h2><p>@${esc(account.username)} · Responsable : ${esc(managerName)} · Créé le ${esc(fmtDate(account.createdAt))}</p></div><div class="detail-actions">${state.role === 'admin' && !account.deletedAt ? `<button class="button outline" type="button" data-control-action="reset-password">Réinitialiser l’accès</button><button class="button ${account.status === 'active' ? 'quiet' : 'primary'}" type="button" data-control-action="toggle-status">${account.status === 'active' ? 'Suspendre' : 'Réactiver'}</button>` : ''}${canQr && storeData ? `<button class="button primary" type="button" data-control-action="create-qr">${storeData.qrPublicCode ? 'Afficher le QR' : 'Créer le QR boutique'}</button>` : ''}</div></div>
      <section class="control-section"><h3>Compte et rattachement</h3><p class="section-intro">La suspension ou la réinitialisation révoque les sessions en cours. Le mot de passe n’est jamais affiché ici.</p>${canAccount ? `<form id="accountForm" class="form-grid"><div class="field"><label for="accountName">Nom affiché *</label><input id="accountName" value="${esc(account.displayName)}" maxlength="120" required></div><div class="field"><label>Identifiant</label><input value="${esc(account.username)}" disabled></div><div class="field"><label for="accountEmail">E-mail</label><input id="accountEmail" type="email" value="${esc(account.email || '')}" maxlength="254"></div><div class="field"><label for="accountPhone">Téléphone</label><input id="accountPhone" type="tel" value="${esc(account.phone || '')}" maxlength="32"></div>${state.role === 'admin' ? `<div class="field span-two"><label for="accountManager">Responsable principal</label><select id="accountManager">${managersForSelect(account.managerId || '')}</select></div>` : ''}<div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer le compte</button><span class="control-scope">Statut : ${esc(account.status)}${account.mustChangePassword ? ' · changement de mot de passe requis' : ''}</span></div></form>` : `<p class="control-scope">Consultation des informations de compte limitée par vos permissions.</p>`}</section>
      <section class="control-section"><div class="section-head"><h3>Boutique</h3><span class="state-pill ${storeData?.isPublished ? 'published' : ''}">${storeData ? (storeData.isPublished ? 'Publiée' : 'Brouillon') : 'À créer'}</span></div><p class="section-intro">Le catalogue public utilise les informations et produits actuels; l’adresse publique est stable.</p>${canStore ? `<form id="controlStoreForm" class="form-grid"><div class="field"><label for="controlStoreName">Nom commercial *</label><input id="controlStoreName" value="${esc(storeData?.name || '')}" maxlength="120" required></div><div class="field"><label for="controlStoreSlug">Adresse publique</label><input id="controlStoreSlug" value="${esc(storeData?.slug || '')}" ${storeData?.id ? 'disabled' : ''} placeholder="boutique-exemple" maxlength="70"></div><div class="field span-two"><label for="controlStoreDescription">Présentation</label><textarea id="controlStoreDescription" rows="3" maxlength="3000">${esc(storeData?.description || '')}</textarea></div><div class="field"><label for="controlStorePhone">Téléphone</label><input id="controlStorePhone" value="${esc(storeData?.phone || '')}" maxlength="32"></div><div class="field"><label for="controlStoreWhatsApp">WhatsApp</label><input id="controlStoreWhatsApp" value="${esc(storeData?.whatsapp || '')}" maxlength="32"></div><div class="field"><label for="controlStoreEmail">E-mail</label><input id="controlStoreEmail" type="email" value="${esc(storeData?.email || '')}" maxlength="254"></div><div class="field"><label for="controlStoreAddress">Adresse / zone</label><input id="controlStoreAddress" value="${esc(storeData?.address || '')}" maxlength="500"></div><div class="field span-two"><label for="controlDeliveryNote">Modalités de remise</label><textarea id="controlDeliveryNote" rows="2" maxlength="1000">${esc(storeData?.deliveryNote || '')}</textarea></div><div class="field span-two media-field"><div class="media-preview"><img id="controlStoreLogoPreview" alt="" ${storeData?.logo ? `src="${esc(storeData.logo)}"` : 'hidden'}><span id="controlStoreLogoFallback" ${storeData?.logo ? 'hidden' : ''}>LOGO</span></div><div><label class="button outline file-label" for="controlStoreLogoFile">Choisir un logo</label><input id="controlStoreLogoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><input id="controlStoreLogoData" type="hidden" value="${esc(storeData?.logo || '')}"><button class="link-button" type="button" data-clear-image="store">Retirer</button><small>Compressé localement, max. 350 Ko. L’import conserve la page et le défilement.</small></div></div><div class="field span-two publish-row"><label><input id="controlStorePublished" type="checkbox" ${storeData?.isPublished ? 'checked' : ''}> Publier le catalogue et accepter des commandes</label></div>${state.role !== 'admin' ? '' : `<div class="field"><label for="controlStoreStatus">Statut</label><select id="controlStoreStatus"><option value="active" ${storeData?.status !== 'suspended' ? 'selected' : ''}>Actif</option><option value="suspended" ${storeData?.status === 'suspended' ? 'selected' : ''}>Suspendu</option></select></div>`}<div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer la boutique</button>${storeData?.slug ? `<a class="button outline" href="/shop/${encodeURIComponent(storeData.slug)}" target="_blank" rel="noopener">Voir le catalogue ↗</a>` : ''}</div></form>` : `<p class="control-scope">Boutique ${storeData ? `« ${esc(storeData.name || storeData.storeName || '')} » · /shop/${esc(storeData.slug || storeData.storeSlug || '')}` : 'non configurée'}. Vos droits ne permettent pas de la modifier.</p>`}</section>
      ${canProducts ? `<section class="control-section"><div class="section-head"><div><h3>Produits et stocks</h3><p class="section-intro">Prix en XOF, stock contrôlé côté serveur avant confirmation de la commande.</p></div><button class="button outline" type="button" data-control-action="new-product" ${storeData?.id ? '' : 'disabled'}>＋ Produit</button></div>${!storeData?.id ? '<p class="empty">Créez la boutique avant d’ajouter des produits.</p>' : ''}<div id="controlProductList" class="control-products">${d.products.length ? d.products.map((p) => `<article class="control-product"><div class="control-product-thumb">${p.imageData ? `<img src="${esc(p.imageData)}" alt="">` : 'PHOTO'}</div><div><strong>${esc(p.name)} · ${money(p.priceXof)}</strong><small>${p.trackStock ? `${Number(p.stockQuantity)} en stock` : 'Stock non suivi'} · ${p.status === 'active' ? 'Disponible' : 'Indisponible'}</small></div><button type="button" data-edit-product="${esc(p.id)}">Modifier</button><button type="button" data-archive-product="${esc(p.id)}">Archiver</button></article>`).join('') : '<p class="empty">Aucun produit enregistré.</p>'}</div><form id="controlProductForm" class="control-product-form form-grid" hidden><input id="controlProductId" type="hidden"><div class="field"><label for="controlProductName">Nom *</label><input id="controlProductName" required maxlength="120"></div><div class="field"><label for="controlProductSku">Référence</label><input id="controlProductSku" maxlength="80"></div><div class="field"><label for="controlProductPrice">Prix (XOF)</label><input id="controlProductPrice" type="number" min="0" max="2000000000" step="1" required></div><div class="field"><label for="controlProductStock">Stock</label><input id="controlProductStock" type="number" min="0" max="1000000" step="1" value="0"></div><div class="field span-two"><label for="controlProductDescription">Description</label><textarea id="controlProductDescription" rows="2" maxlength="2000"></textarea></div><div class="field span-two media-field"><div class="media-preview"><img id="controlProductPreview" alt="" hidden><span id="controlProductFallback">PHOTO</span></div><div><label class="button outline file-label" for="controlProductFile">Choisir une image</label><input id="controlProductFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><input id="controlProductImage" type="hidden"><button class="link-button" type="button" data-clear-image="product">Retirer</button><small>Import direct sans remontage ni déplacement de page.</small></div></div><div class="field span-two permission-grid"><label><input id="controlProductTrack" type="checkbox" checked> Suivre le stock</label><label><input id="controlProductActive" type="checkbox" checked> Disponible à la vente</label></div><div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer le produit</button><button class="button quiet" type="button" data-control-action="cancel-product">Annuler</button></div></form></section>` : `<section class="control-section"><h3>Produits et stocks</h3><p class="section-intro">Votre attribution ne permet pas de gérer les produits.</p></section>`}
      ${canOrders ? `<section class="control-section"><div class="section-head"><div><h3>Commandes clients</h3><p class="section-intro">Les mises à jour sont diffusées sans recharger la page. Aucun paiement en ligne fictif.</p></div><button class="button outline" type="button" data-control-action="refresh-detail">Actualiser</button></div><div class="control-orders">${d.orders.length ? d.orders.map((o) => `<article class="control-order"><div class="control-order-head"><div><strong>${esc(o.reference)}</strong><small>${esc(o.customerName)} · ${esc(o.customerPhone)} · ${esc(fmtDate(o.createdAt))}</small></div><span class="order-status ${esc(o.status)}">${esc(statuses[o.status] || o.status)}</span></div><div class="control-order-body">${esc(o.deliveryAddress)}<div class="control-order-items">${o.items.map((item) => `<span>${esc(item.name)} × ${item.quantity} — ${money(item.unitPriceXof)}</span>`).join('')}</div><strong>Total : ${money(o.totalAmountXof)}</strong></div><div class="control-order-foot"><small class="muted">Pas de preuve de paiement enregistrée</small>${(nextStatus[o.status] || []).length ? `<select data-order-status="${esc(o.id)}"><option value="">Modifier le statut…</option>${nextStatus[o.status].map((s) => `<option value="${s}">${statuses[s]}</option>`).join('')}</select>` : ''}</div></article>`).join('') : '<p class="empty">Aucune commande reçue.</p>'}</div></section>` : `<section class="control-section"><h3>Commandes clients</h3><p class="section-intro">Votre attribution ne permet pas de consulter ou de modifier les commandes.</p></section>`}
      <section class="control-section"><div class="section-head"><div><h3>QR de boutique</h3><p class="section-intro">Le QR ouvre une adresse stable dont le contenu commercial reste à jour.</p></div>${canQr && storeData ? `<button class="button primary" type="button" data-control-action="create-qr">${storeData.qrPublicCode ? 'Afficher le QR' : 'Créer le QR'}</button>` : ''}</div><div id="controlQrBlock" class="control-qr"><div><p>${storeData?.qrPublicCode ? 'QR déjà créé par un rôle autorisé.' : canQr ? 'Un QR n’a pas encore été créé.' : 'Seul le PDG ou un gestionnaire explicitement autorisé peut créer ce QR.'}</p><a id="controlQrLink" href="${storeData?.qrPublicCode ? `/s/${esc(storeData.qrPublicCode)}` : '#'}" ${storeData?.qrPublicCode ? '' : 'hidden'} target="_blank" rel="noopener">${storeData?.qrPublicCode ? `${esc(window.location.origin)}/s/${esc(storeData.qrPublicCode)}` : ''}</a></div><canvas id="controlQrCanvas" width="180" height="180" ${storeData?.qrPublicCode ? '' : 'hidden'}></canvas></div></section>
      ${state.role === 'admin' ? `<section class="control-section"><div class="section-head"><div><h3>Gestionnaires attribués</h3><p class="section-intro">Définissez les droits par marchand; un gestionnaire ne voit que ses attributions.</p></div></div><form id="assignmentForm" class="form-grid"><div class="field span-two"><label for="assignmentManager">Gestionnaire</label><select id="assignmentManager" required>${state.managers.filter((m) => m.status === 'active' && !m.deletedAt).map((m) => `<option value="${esc(m.id)}">${esc(m.displayName)} (@${esc(m.username)})</option>`).join('')}</select></div><div class="field span-two permission-grid">${permissionFields.map(([key,label]) => `<label><input type="checkbox" name="${key}" id="perm-${key}"> ${label}</label>`).join('')}</div><div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer cette attribution</button></div></form><div class="control-assignments">${d.assignments.length ? d.assignments.map((a) => { const manager = state.managers.find((m) => m.id === a.managerId); const enabled = permissionFields.filter(([key]) => a[key]).map(([,label]) => label).join(', ') || 'Aucun droit actif'; return `<div class="assignment-row"><div><strong>${esc(manager?.displayName || a.managerId)}</strong><small>${esc(enabled)}</small></div><button type="button" data-remove-assignment="${esc(a.managerId)}">Retirer</button></div>`; }).join('') : '<p class="empty">Aucune attribution explicite.</p>'}</div></section>` : ''}
      <section class="control-section"><div class="section-head"><div><h3>Journal commercial</h3><p class="section-intro">Actions de compte, boutique, produits, commandes, permissions et QR.</p></div></div>${d.audit.length ? `<div class="control-audit">${d.audit.map((row) => `<div class="control-audit-row"><strong>${esc(row.summary)}</strong><small>${esc(row.actor)} · ${esc(row.action)} · ${esc(fmtDate(row.createdAt))}</small></div>`).join('')}</div>` : `<p class="empty">${state.role === 'admin' || can('canViewAudit', account) ? 'Aucune action enregistrée.' : 'Le journal n’est pas inclus dans vos permissions.'}</p>`}</section>`;
    wireDetailEvents(); renderQrIfPresent();
  }

  async function reloadSelected() { if (!state.selectedId) return; await loadMerchants({ keepSelection: true }); }
  async function loadProductsAgain() { if (!state.selectedId) return; const r = await api(merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/products`)); state.detail.products = r.data || []; }
  async function saveAccount(event) {
    event.preventDefault(); const account = state.detail.account; const payload = { displayName: $('#accountName').value.trim(), email: $('#accountEmail').value.trim(), phone: $('#accountPhone').value.trim() };
    if (state.role === 'admin') payload.managerId = $('#accountManager').value;
    try { await api(merchantApi(`/merchants/${encodeURIComponent(account.id)}`), { method: 'PUT', body: JSON.stringify(payload) }); toast('Profil marchand enregistré; anciennes sessions révoquées.'); await reloadSelected(); }
    catch (error) { toast(error.message); }
  }
  function accountCreationDialog() {
    const root = $('#modalRoot'); root.hidden = false;
    root.innerHTML = `<article class="control-modal-card"><span class="eyebrow">NOUVEAU COMPTE</span><h2>Créer un marchand</h2><p>Un mot de passe temporaire, affiché une seule fois, obligera le marchand à en choisir un nouveau.</p><form id="createMerchantForm" class="form-grid"><div class="field span-two"><label for="newMerchantName">Nom affiché *</label><input id="newMerchantName" maxlength="120" required></div><div class="field"><label for="newMerchantUsername">Identifiant *</label><input id="newMerchantUsername" minlength="3" maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" required></div><div class="field"><label for="newMerchantPhone">Téléphone</label><input id="newMerchantPhone" type="tel" maxlength="32"></div><div class="field span-two"><label for="newMerchantEmail">E-mail</label><input id="newMerchantEmail" type="email" maxlength="254"></div>${state.role === 'admin' ? `<div class="field span-two"><label for="newMerchantManager">Responsable principal</label><select id="newMerchantManager">${managersForSelect('')}</select></div>` : ''}<div class="field span-two section-actions"><button class="button primary" type="submit">Créer le compte</button><button class="button quiet" type="button" data-close-control-modal>Annuler</button></div></form></article>`;
    $('#createMerchantForm').addEventListener('submit', createMerchant);
    $('[data-close-control-modal]', root).addEventListener('click', () => { root.hidden = true; });
  }
  async function createMerchant(event) {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    const body = { displayName: $('#newMerchantName').value.trim(), username: $('#newMerchantUsername').value.trim(), phone: $('#newMerchantPhone').value.trim(), email: $('#newMerchantEmail').value.trim() };
    if (state.role === 'admin') body.managerId = $('#newMerchantManager').value;
    try { const response = await api(state.role === 'admin' ? '/api/admin/merchants' : '/api/manager/merchants', { method: 'POST', body: JSON.stringify(body) });
      const root = $('#modalRoot'); root.hidden = false; root.innerHTML = `<article class="control-modal-card"><span class="eyebrow">À TRANSMETTRE UNE SEULE FOIS</span><h2>Compte créé</h2><p>Ce mot de passe temporaire expire le ${esc(fmtDate(response.expiresAt))}; communiquez-le par un canal sûr. Il ne peut pas être réaffiché.</p><div class="secret-box"><code id="secretValue">${esc(response.temporaryPassword)}</code><button class="button outline" type="button" id="copySecret">Copier</button></div><button class="button primary" type="button" id="finishSecret">Terminé</button></article>`;
      $('#copySecret').addEventListener('click', async () => { try { await navigator.clipboard.writeText(response.temporaryPassword); toast('Mot de passe copié.'); } catch (_) { $('#secretValue').select?.(); } });
      $('#finishSecret').addEventListener('click', async () => { root.hidden = true; state.selectedId = response.data.id; await reloadSelected(); });
      await loadMerchants({ keepSelection: false }); state.selectedId = response.data.id; renderMerchantList();
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }
  function setAccountStatus() {
    const account = state.detail.account; const status = account.status === 'active' ? 'suspended' : 'active';
    const message = status === 'suspended' ? 'Suspendre ce compte marchand et révoquer toutes ses sessions ?' : 'Réactiver le compte marchand ?';
    if (!window.confirm(message)) return;
    api(`/api/admin/merchants/${encodeURIComponent(account.id)}/status`, { method: 'POST', body: JSON.stringify({ status, reason: status === 'suspended' ? 'Suspendu par le PDG.' : '' }) })
      .then(() => { toast(status === 'active' ? 'Compte réactivé.' : 'Compte suspendu; sessions révoquées.'); return reloadSelected(); }).catch((error) => toast(error.message));
  }
  async function resetPassword() {
    const account = state.detail.account; if (!window.confirm(`Générer un nouveau mot de passe temporaire pour ${account.displayName} ? Toutes les sessions seront révoquées.`)) return;
    try { const result = await api(`/api/admin/merchants/${encodeURIComponent(account.id)}/reset-password`, { method: 'POST', body: '{}' });
      const root = $('#modalRoot'); root.hidden = false; root.innerHTML = `<article class="control-modal-card"><span class="eyebrow">À TRANSMETTRE UNE SEULE FOIS</span><h2>Mot de passe réinitialisé</h2><p>Expiration : ${esc(fmtDate(result.expiresAt))}. Le marchand devra choisir un nouveau mot de passe.</p><div class="secret-box"><code id="secretValue">${esc(result.temporaryPassword)}</code><button class="button outline" type="button" id="copySecret">Copier</button></div><button class="button primary" type="button" id="finishSecret">Terminé</button></article>`;
      $('#copySecret').addEventListener('click', async () => { try { await navigator.clipboard.writeText(result.temporaryPassword); toast('Mot de passe copié.'); } catch (_) {} }); $('#finishSecret').addEventListener('click', () => { root.hidden = true; });
      await reloadSelected();
    } catch (error) { toast(error.message); }
  }
  function orderStatus(orderId, status) {
    if (!status) return; const path = state.role === 'admin' ? `/api/admin/merchant-orders/${encodeURIComponent(orderId)}/status` : `/api/manager/merchants/${encodeURIComponent(state.selectedId)}/orders/${encodeURIComponent(orderId)}/status`;
    api(path, { method: 'POST', body: JSON.stringify({ status }) }).then(async () => { toast(`Commande mise à jour : ${statuses[status]}.`); await reloadSelected(); }).catch((error) => toast(error.message));
  }
  function createQr() {
    const base = merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/qr`);
    api(base, { method: 'POST', body: '{}' }).then(async (result) => { toast(result.data.created ? 'QR de boutique créé.' : 'QR déjà créé; affichage du même lien.'); await reloadSelected(); }).catch((error) => toast(error.message));
  }
  function storePayload() {
    const current = state.detail.store || {};
    return { name: $('#controlStoreName').value.trim(), slug: $('#controlStoreSlug').value.trim(), description: $('#controlStoreDescription').value.trim(),
      phone: $('#controlStorePhone').value.trim(), whatsapp: $('#controlStoreWhatsApp').value.trim(), email: $('#controlStoreEmail').value.trim(), address: $('#controlStoreAddress').value.trim(),
      deliveryNote: $('#controlDeliveryNote').value.trim(), logo: $('#controlStoreLogoData').value, isPublished: $('#controlStorePublished').checked,
      status: state.role === 'admin' ? $('#controlStoreStatus').value : (current.status || 'active') };
  }
  async function saveStore(event) {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    try { await api(merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/store`), { method: 'PUT', body: JSON.stringify(storePayload()) }); toast('Boutique enregistrée.'); await reloadSelected(); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }
  function clearImage(type) {
    if (type === 'store') { $('#controlStoreLogoData').value = ''; $('#controlStoreLogoPreview').hidden = true; $('#controlStoreLogoPreview').removeAttribute('src'); $('#controlStoreLogoFallback').hidden = false; }
    else { $('#controlProductImage').value = ''; $('#controlProductPreview').hidden = true; $('#controlProductPreview').removeAttribute('src'); $('#controlProductFallback').hidden = false; }
  }
  function compressImage(file, type) {
    if (!file) return;
    state.uploading = true;
    const openImage = typeof createImageBitmap === 'function' ? createImageBitmap(file) : new Promise((resolve, reject) => { const img = new Image(); const url = URL.createObjectURL(file); img.onload = () => { URL.revokeObjectURL(url); resolve(img); }; img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Image illisible.')); }; img.src = url; });
    openImage.then(async (image) => {
      let w = image.width; let h = image.height; const max = 1400; if (Math.max(w,h)>max) { const s=max/Math.max(w,h); w=Math.round(w*s); h=Math.round(h*s); }
      const canvas=document.createElement('canvas'), ctx=canvas.getContext('2d'); let data='';
      for(let i=0;i<8;i++){canvas.width=w;canvas.height=h;ctx.clearRect(0,0,w,h);ctx.drawImage(image,0,0,w,h);const blob=await new Promise((resolve)=>canvas.toBlob(resolve,'image/webp',Math.max(.42,.86-i*.07)));if(!blob)throw new Error('Impossible de compresser l’image.');if(blob.size<=345*1024){data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=reject;r.readAsDataURL(blob);});break;}w=Math.max(220,Math.round(w*.82));h=Math.max(220,Math.round(h*.82));}
      if(!data)throw new Error('Image trop volumineuse même après compression.');
      if(type==='store'){ $('#controlStoreLogoData').value=data; $('#controlStoreLogoPreview').src=data; $('#controlStoreLogoPreview').hidden=false; $('#controlStoreLogoFallback').hidden=true; }
      else { $('#controlProductImage').value=data; $('#controlProductPreview').src=data; $('#controlProductPreview').hidden=false; $('#controlProductFallback').hidden=true; }
      if(typeof image.close==='function')image.close();
    }).catch((error)=>toast(error.message||'Erreur d’image.')).finally(()=>{state.uploading=false;});
  }
  async function submitProduct(event) {
    event.preventDefault(); const id=$('#controlProductId').value; const payload={name:$('#controlProductName').value.trim(),sku:$('#controlProductSku').value.trim(),priceXof:Number($('#controlProductPrice').value),stockQuantity:Number($('#controlProductStock').value||0),description:$('#controlProductDescription').value.trim(),imageData:$('#controlProductImage').value,trackStock:$('#controlProductTrack').checked,status:$('#controlProductActive').checked?'active':'unavailable'};
    const path=merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/products${id?`/${encodeURIComponent(id)}`:''}`);
    try{await api(path,{method:id?'PUT':'POST',body:JSON.stringify(payload)});toast(id?'Produit modifié.':'Produit ajouté.');await reloadSelected();}catch(error){toast(error.message);}
  }
  async function archiveProduct(id) {
    const product = state.detail?.products.find((row) => row.id === id);
    if (!product || !window.confirm(`Archiver « ${product.name} » ? Il ne sera plus commandable et restera visible dans l’historique.`)) return;
    try { await api(merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/products/${encodeURIComponent(id)}`), { method: 'DELETE' }); toast('Produit archivé.'); await reloadSelected(); }
    catch (error) { toast(error.message); }
  }
  function editProduct(id) {
    const product=state.detail.products.find((p)=>p.id===id);if(!product)return;
    $('#controlProductForm').hidden=false;$('#controlProductId').value=product.id;$('#controlProductName').value=product.name;$('#controlProductSku').value=product.sku||'';$('#controlProductPrice').value=product.priceXof;$('#controlProductStock').value=product.stockQuantity;$('#controlProductDescription').value=product.description||'';$('#controlProductTrack').checked=product.trackStock!==false;$('#controlProductActive').checked=product.status==='active';
    $('#controlProductImage').value=product.imageData||'';if(product.imageData){$('#controlProductPreview').src=product.imageData;$('#controlProductPreview').hidden=false;$('#controlProductFallback').hidden=true;}else clearImage('product');$('#controlProductFormTitle')?.focus?.({preventScroll:true});$('#controlProductName').focus({preventScroll:true});
  }
  function wireDetailEvents() {
    $('#accountForm')?.addEventListener('submit',saveAccount);$('#controlStoreForm')?.addEventListener('submit',saveStore);$('#controlProductForm')?.addEventListener('submit',submitProduct);
    $('#controlStoreLogoFile')?.addEventListener('change',(e)=>compressImage(e.target.files?.[0],'store'));
    $('#controlProductFile')?.addEventListener('change',(e)=>compressImage(e.target.files?.[0],'product'));
    $$('[data-clear-image]').forEach((b)=>b.addEventListener('click',()=>clearImage(b.dataset.clearImage)));
    $$('[data-edit-product]').forEach((b)=>b.addEventListener('click',()=>editProduct(b.dataset.editProduct)));
    $$('[data-archive-product]').forEach((b)=>b.addEventListener('click',()=>archiveProduct(b.dataset.archiveProduct)));
    $$('[data-order-status]').forEach((select)=>select.addEventListener('change',()=>orderStatus(select.dataset.orderStatus,select.value)));
    $$('[data-control-action]').forEach((button)=>button.addEventListener('click',()=>{
      const action=button.dataset.controlAction;
      if(action==='toggle-status')setAccountStatus();if(action==='reset-password')resetPassword();if(action==='create-qr')createQr();if(action==='refresh-detail')selectMerchant(state.selectedId);
      if(action==='new-product'){if(!state.detail.store?.id)return toast('Créez d’abord la boutique.');$('#controlProductForm').hidden=false;$('#controlProductForm').reset();$('#controlProductId').value='';$('#controlProductStock').value='0';$('#controlProductTrack').checked=true;$('#controlProductActive').checked=true;clearImage('product');$('#controlProductName').focus({preventScroll:true});}
      if(action==='cancel-product'){ $('#controlProductForm').reset();$('#controlProductForm').hidden=true;$('#controlProductId').value='';clearImage('product'); }
    }));
    $('#assignmentForm')?.addEventListener('submit',saveAssignment);
    $$('[data-remove-assignment]').forEach((button)=>button.addEventListener('click',()=>removeAssignment(button.dataset.removeAssignment)));
  }
  async function saveAssignment(event) {
    event.preventDefault();const managerId=$('#assignmentManager').value;if(!managerId)return toast('Sélectionnez un gestionnaire.');const body={managerId};for(const key of permissionFields.map(([k])=>k))body[key]=$(`#perm-${key}`).checked;
    try{await api(`/api/admin/merchants/${encodeURIComponent(state.selectedId)}/assignments`,{method:'POST',body:JSON.stringify(body)});toast('Attribution et permissions enregistrées.');await reloadSelected();}catch(error){toast(error.message);}
  }
  async function removeAssignment(managerId) {
    if(!window.confirm('Retirer les droits de ce gestionnaire pour ce marchand ?'))return;
    try{await api(`/api/admin/merchants/${encodeURIComponent(state.selectedId)}/assignments/${encodeURIComponent(managerId)}`,{method:'DELETE'});toast('Attribution retirée.');await reloadSelected();}catch(error){toast(error.message);}
  }
  function renderQrIfPresent(){
    const storeData=state.detail?.store;const canvas=$('#controlQrCanvas');const link=$('#controlQrLink');if(!storeData?.qrPublicCode||!canvas)return;
    const url=state.detail.qr?.url||`${location.origin}/s/${storeData.qrPublicCode}`;link.href=state.detail.qr?.path||`/s/${storeData.qrPublicCode}`;link.textContent=url;link.hidden=false;canvas.hidden=false;
    try{const qr=qrcode(0,'M');qr.addData(url);qr.make();const n=qr.getModuleCount(),size=180,margin=4,cell=size/(n+margin*2),ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.fillStyle='#102a26';for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(qr.isDark(r,c))ctx.fillRect((c+margin)*cell,(r+margin)*cell,Math.ceil(cell),Math.ceil(cell));}catch(_){canvas.hidden=true;}
  }
  function closeEvents(){if(state.eventSource){state.eventSource.close();state.eventSource=null;}}
  function connectEvents(){closeEvents();const url=state.role==='admin'?'/api/admin/merchants/events':'/api/manager/merchants/events';state.eventSource=new EventSource(url);state.eventSource.addEventListener('commerce',(event)=>{let data={};try{data=JSON.parse(event.data);}catch(_){};if(data.type==='new_order')toast(`Nouvelle commande reçue${data.reference?` : ${data.reference}`:''}.`);if(!state.uploading&&!detailRoot.contains(document.activeElement))loadMerchants({keepSelection:true}).catch(()=>{});});state.eventSource.onerror=()=>{};}
  async function startSession(role, payload) {
    if(role==='admin'){await api('/api/auth/login',{method:'POST',body:JSON.stringify(payload)});state.role='admin';state.admin=true;}
    else {const result=await api('/api/manager/auth/login',{method:'POST',body:JSON.stringify(payload)});state.role='manager';state.manager=result.manager;}
    await bootSession();
  }
  async function bootSession() {
    if(state.role!=='admin'){
      const result=await api('/api/manager/auth/me');state.manager=result.manager;
      if(state.manager?.mustChangePassword){loginScreen.hidden=true;app.hidden=true;passwordNotice.hidden=false;return;}
    }
    hideAuthAndShowApp();await loadMerchants({keepSelection:false});connectEvents();
    if(!state.pollTimer)state.pollTimer=setInterval(()=>{if(!state.uploading&&!detailRoot.contains(document.activeElement))loadMerchants({keepSelection:true}).catch(()=>{});},30000);
  }
  async function boot() {
    try {const admin=await api('/api/auth/me');if(admin.authenticated&&admin.role==='admin'){state.role='admin';state.admin=true;return bootSession();}}
    catch(_){}
    try {const manager=await api('/api/manager/auth/me');if(manager.authenticated){state.role='manager';state.manager=manager.manager;return bootSession();}}
    catch(_){}
    setAuthView();
  }
  $('#controlLogin').addEventListener('submit',async(event)=>{event.preventDefault();const button=$('button[type="submit"]',event.currentTarget);button.disabled=true;const error=$('#controlLoginError');error.hidden=true;try{await startSession($('#controlRole').value,{username:$('#controlUsername').value.trim(),password:$('#controlPassword').value});}catch(e){error.textContent=e.message;error.hidden=false;}finally{button.disabled=false;}});
  $('#createMerchantButton').addEventListener('click',accountCreationDialog);
  $('#refreshMerchants').addEventListener('click',()=>loadMerchants({keepSelection:true}).catch((e)=>toast(e.message)));
  $('#controlLogout').addEventListener('click',async()=>{try{if(state.role==='admin')await api('/api/auth/logout',{method:'POST',body:'{}'});else await api('/api/manager/auth/logout',{method:'POST',body:'{}'});}catch(_){}closeEvents();setAuthView();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.role)loadMerchants({keepSelection:true}).catch(()=>{});});
  boot();
})();
