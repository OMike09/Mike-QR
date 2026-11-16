(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { role: '', admin: null, manager: null, merchants: [], managers: [], includeArchived: false, selectedId: '', selectionVersion: 0, sessionVersion: 0, merchantListRequest: null, detail: null, detailCache: new Map(), detailRequests: new Map(), resourceRequests: new Map(), detailDrafts: new Map(), dirtyForms: new Set(), renderedDetailId: '', pendingDetailRefresh: false, eventSource: null, uploading: false, toastTimer: 0, pollTimer: 0 };
  const DETAIL_CACHE_TTL_MS = 60_000;
  const DETAIL_CACHE_MAX = 8;
  const API_REQUEST_TIMEOUT_MS = 15_000;
  const loginScreen = $('#loginScreen'); const passwordNotice = $('#passwordNotice'); const app = $('#controlApp'); const detailRoot = $('#detailRoot');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const fmtDate = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const statuses = { pending: 'À confirmer', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête', completed: 'Terminée', cancelled: 'Annulée' };
  const nextStatus = { pending: ['confirmed', 'cancelled'], confirmed: ['preparing', 'cancelled'], preparing: ['ready', 'cancelled'], ready: ['completed', 'cancelled'], completed: [], cancelled: [] };
  const permissionFields = [['canManageStore', 'Gérer les informations de boutique'], ['canManageProducts', 'Gérer produits et stocks'], ['canManageOrders', 'Consulter et suivre les commandes'], ['canCreateStoreQr', 'Créer le QR de boutique'], ['canViewAudit', 'Consulter le journal commercial']];

  async function api(url, options = {}) {
    const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
    const timeoutMs = Number.isFinite(Number(options.timeoutMs)) && Number(options.timeoutMs) > 0
      ? Number(options.timeoutMs) : API_REQUEST_TIMEOUT_MS;
    const fetchOptions = { ...options }; delete fetchOptions.timeoutMs; delete fetchOptions.signal;
    const controller = new AbortController(); const callerSignal = options.signal;
    const forwardAbort = () => controller.abort();
    if (callerSignal?.aborted) controller.abort();
    else callerSignal?.addEventListener('abort', forwardAbort, { once: true });
    let timedOut = false; let timer = 0;
    const networkRequest = (async () => {
      const response = await fetch(url, { credentials: 'same-origin', ...fetchOptions, headers, signal: controller.signal });
      const result = await response.json().catch(() => ({}));
      if (response.status === 401) throw new Error(result.error || 'Session expirée.');
      if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
      return result;
    })();
    const timeoutRequest = new Promise((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true; controller.abort();
        reject(new Error('Le serveur ne répond pas dans le délai prévu. Vérifiez votre connexion puis réessayez.'));
      }, timeoutMs);
    });
    try { return await Promise.race([networkRequest, timeoutRequest]); }
    catch (error) {
      if (timedOut) throw new Error('Le serveur ne répond pas dans le délai prévu. Vérifiez votre connexion puis réessayez.');
      if (error?.name === 'AbortError') throw new Error('La requête a été interrompue. Vérifiez votre connexion puis réessayez.');
      throw error;
    } finally {
      clearTimeout(timer); callerSignal?.removeEventListener('abort', forwardAbort);
    }
  }
  function toast(message) { const node = $('#controlToast'); node.textContent = message; node.classList.add('visible'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => node.classList.remove('visible'), 3400); }
  function notice(message, show = true) { const node = $('#controlNotice'); node.textContent = message; node.hidden = !show; }
  function actorLabel() { return state.role === 'admin' ? 'PDG · contrôle total' : `Gestionnaire · @${state.manager?.username || ''}`; }
  function setAuthView() { loginScreen.hidden = false; passwordNotice.hidden = true; app.hidden = true; $('#controlPassword').value = ''; $('#controlLoginError').hidden = true; }
  function hideAuthAndShowApp() {
    loginScreen.hidden = true; passwordNotice.hidden = true; app.hidden = false; $('#actorLabel').textContent = actorLabel();
    $('#ceoLink').hidden = state.role !== 'admin'; $('#managerLink').hidden = state.role !== 'manager';
    $('#archivedFilterLabel').hidden = state.role !== 'admin'; $('#showArchivedMerchants').checked = state.includeArchived;
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
  function selectedRow(merchantId = state.selectedId) { return state.merchants.find((m) => m.id === merchantId) || null; }
  function cacheDetail(merchantId, detail) {
    if (!merchantId || !detail) return;
    state.detailCache.delete(merchantId); state.detailCache.set(merchantId, { detail, loadedAt: Date.now() });
    while (state.detailCache.size > DETAIL_CACHE_MAX) state.detailCache.delete(state.detailCache.keys().next().value);
  }
  function detailDraftKey(merchantId, formId) { return `${merchantId}:${formId}`; }
  function hasDetailDraft(merchantId) { return [...state.dirtyForms].some((key) => key.startsWith(`${merchantId}:`)); }
  function markDetailFormDirty(form) {
    if (form?.id && state.selectedId) state.dirtyForms.add(detailDraftKey(state.selectedId, form.id));
  }
  function clearDetailFormDraft(merchantId, formId) {
    state.dirtyForms.delete(detailDraftKey(merchantId, formId));
    const draft = state.detailDrafts.get(merchantId);
    if (draft) { delete draft[formId]; if (!Object.keys(draft).length) state.detailDrafts.delete(merchantId); }
  }
  function captureDetailDrafts(merchantId) {
    if (!merchantId || state.renderedDetailId !== merchantId) return;
    const draft = state.detailDrafts.get(merchantId) || {};
    for (const form of $$('form', detailRoot)) {
      if (!form.id || (!state.dirtyForms.has(detailDraftKey(merchantId, form.id)) && !form.contains(document.activeElement))) continue;
      const fields = {};
      for (const node of $$('[id]', form)) {
        if (node.matches('input[type="file"]')) continue;
        if (node.tagName === 'IMG') fields[node.id] = { type: 'image', src: node.getAttribute('src'), hidden: node.hidden };
        else if (node.type === 'checkbox' || node.type === 'radio') fields[node.id] = { type: 'checked', value: node.checked };
        else fields[node.id] = { type: 'value', value: node.value };
      }
      draft[form.id] = { visible: !form.hidden, fields };
    }
    if (Object.keys(draft).length) state.detailDrafts.set(merchantId, draft);
  }
  function restoreDetailDrafts(merchantId) {
    const draft = state.detailDrafts.get(merchantId); if (!draft) return;
    for (const [formId, saved] of Object.entries(draft)) {
      const form = $(`#${formId}`, detailRoot); if (!form) continue;
      if (saved.visible) form.hidden = false;
      for (const [fieldId, value] of Object.entries(saved.fields || {})) {
        const node = $(`#${fieldId}`, form); if (!node) continue;
        if (value.type === 'image') { if (value.src == null) node.removeAttribute('src'); else node.setAttribute('src', value.src); node.hidden = value.hidden; }
        else if (value.type === 'checked') node.checked = value.value;
        else if (!node.matches('input[type="file"]')) node.value = value.value;
      }
    }
  }
  $('#showArchivedMerchants').addEventListener('change', (event) => {
    state.includeArchived = event.target.checked;
    loadMerchants({ keepSelection: true }).catch((error) => toast(error.message || 'Impossible de charger les comptes.'));
  });
  function canRefreshListInBackground() {
    return !state.uploading && $('#modalRoot').hidden && !detailRoot.contains(document.activeElement);
  }
  function canRefreshDetailInBackground(merchantId = state.selectedId) {
    const active = document.activeElement;
    return canRefreshListInBackground() && !hasDetailDraft(merchantId)
      && !(detailRoot.contains(active) && active?.matches?.('input,textarea,select,[contenteditable="true"]'));
  }
  detailRoot.addEventListener('input', (event) => markDetailFormDirty(event.target?.closest?.('form')));
  detailRoot.addEventListener('change', (event) => markDetailFormDirty(event.target?.closest?.('form')));
  detailRoot.addEventListener('click', (event) => {
    const retryDetail = event.target?.closest?.('[data-retry-detail]');
    if (retryDetail) { selectMerchant(state.selectedId, { force: true }).catch(() => {}); return; }
    const retryResource = event.target?.closest?.('[data-retry-resource]');
    if (retryResource) retryDetailResource(retryResource.dataset.retryResource).catch(() => {});
  });
  function renderMerchantList() {
    const root = $('#merchantCards');
    if (!state.merchants.length) { root.innerHTML = '<p class="empty">Aucun marchand dans votre périmètre.</p>'; return; }
    root.innerHTML = state.merchants.map((m) => `<button class="merchant-card ${m.id === state.selectedId ? 'selected' : ''}" type="button" data-select-merchant="${esc(m.id)}"><span class="mini-status ${m.deletedAt ? 'archived' : esc(m.status)}">${m.deletedAt ? 'Archivé' : m.status === 'active' ? 'Actif' : m.status === 'suspended' ? 'Suspendu' : 'Bloqué'}</span><strong>${esc(m.displayName)}</strong><small>@${esc(m.username)} · ${esc(m.storeName || 'Boutique non configurée')}</small><small>${Number(m.productCount) || 0} produits · ${Number(m.orderCount) || 0} commandes</small></button>`).join('');
    $$('[data-select-merchant]', root).forEach((button) => button.addEventListener('click', () => selectMerchant(button.dataset.selectMerchant)));
  }
  function mergeMerchantListRow(detail, row) {
    if (!detail || !row || detail.account?.id !== row.id) return;
    detail.listRow = row;
    for (const key of ['displayName', 'username', 'status', 'statusReason', 'deletedAt', 'managerId', 'email', 'phone', 'mustChangePassword', 'createdAt', 'updatedAt']) {
      if (row[key] !== undefined) detail.account[key] = row[key];
    }
    if (row.assignment !== undefined) detail.account.assignment = row.assignment;
    if (!detail.store && row.storeId) detail.store = { id: row.storeId, merchantId: row.id, slug: row.storeSlug, name: row.storeName,
      status: row.storeStatus, isPublished: row.storePublished, qrPublicCode: row.qrPublicCode, qrScanCount: row.qrScanCount };
    else if (detail.store) {
      if (row.qrPublicCode !== undefined) detail.store.qrPublicCode = row.qrPublicCode;
      if (row.qrScanCount !== undefined) detail.store.qrScanCount = row.qrScanCount;
    }
  }
  async function loadMerchants({ keepSelection = true, refreshSelectedDetail = false, loadSelectedDetail = true } = {}) {
    if (refreshSelectedDetail) state.pendingDetailRefresh = true;
    if (state.merchantListRequest) return state.merchantListRequest;
    const versionAtStart = state.selectionVersion; const sessionVersion = state.sessionVersion; const preferred = keepSelection ? state.selectedId : '';
    const request = (async () => {
      let merchantRows = []; let managerRows = null;
      if (state.role === 'admin') {
        const merchantPath = `/api/admin/merchants${state.includeArchived ? '?includeDeleted=1' : ''}`;
        const [merchants, managers] = await Promise.all([api(merchantPath), api('/api/admin/managers')]); merchantRows = merchants.data || []; managerRows = managers.data || [];
      } else { const result = await api('/api/manager/merchants'); merchantRows = result.data || []; }
      if (sessionVersion !== state.sessionVersion) return;
      state.merchants = merchantRows; if (managerRows) state.managers = managerRows;
      const wanted = state.selectionVersion === versionAtStart ? preferred : state.selectedId;
      const nextId = wanted && state.merchants.some((m) => m.id === wanted) ? wanted : (state.merchants[0]?.id || '');
      if (nextId !== state.selectedId) { state.selectedId = nextId; state.selectionVersion++; }
      renderMerchantList();
      if (!state.selectedId) {
        state.detail = null; state.renderedDetailId = ''; detailRoot.hidden = true; detailRoot.replaceChildren(); $('#emptyDetail').hidden = false; state.pendingDetailRefresh = false; return;
      }
      const row = selectedRow();
      if (state.detail?.account?.id === state.selectedId) mergeMerchantListRow(state.detail, row);
      if (state.detail?.account?.id !== state.selectedId) {
        if (loadSelectedDetail && $('#modalRoot').hidden) await selectMerchant(state.selectedId);
        else { detailRoot.hidden = true; $('#emptyDetail').hidden = false; }
        return;
      }
      if (state.pendingDetailRefresh) {
        if (canRefreshDetailInBackground(state.selectedId)) { state.pendingDetailRefresh = false; await selectMerchant(state.selectedId, { force: true }); }
      }
    })();
    state.merchantListRequest = request;
    try { return await request; }
    finally { if (state.merchantListRequest === request) state.merchantListRequest = null; }
  }
  function requestDetailResource(merchantId, key, url) {
    const requestKey = `${merchantId}:${key}`; const pending = state.resourceRequests.get(requestKey); if (pending) return pending;
    const request = api(url).finally(() => { if (state.resourceRequests.get(requestKey) === request) state.resourceRequests.delete(requestKey); });
    state.resourceRequests.set(requestKey, request); return request;
  }
  async function loadDetailData(merchantId, onAccount) {
    const sessionVersion = state.sessionVersion; const base = merchantApi(`/merchants/${encodeURIComponent(merchantId)}`); const result = await api(base);
    if (sessionVersion !== state.sessionVersion) throw new Error('Session terminée. Reconnectez-vous.');
    if (!result.data) throw new Error('Les détails du marchand sont absents de la réponse du serveur.');
    const account = result.data; const listRow = selectedRow(merchantId);
    let storeData = account.store || null;
    if (!storeData && listRow?.storeId) storeData = { id: listRow.storeId, merchantId, slug: listRow.storeSlug, name: listRow.storeName,
      status: listRow.storeStatus, isPublished: listRow.storePublished, qrPublicCode: listRow.qrPublicCode, qrScanCount: listRow.qrScanCount };
    const scopedAccount = { ...account, assignment: listRow?.assignment || account.assignment || null };
    const detail = { account: scopedAccount, listRow, store: storeData ? { ...storeData, merchantId } : null,
      qr: null, products: [], orders: [], audit: [], assignments: [], resourceStates: {}, resourceErrors: {}, resourceEndpoints: {} };
    detail.account.managerId = account.managerId ?? listRow?.managerId ?? '';
    const tasks = [];
    const addResource = (key, path, emptyValue) => {
      detail.resourceStates[key] = 'loading'; detail.resourceEndpoints[key] = path;
      const task = requestDetailResource(merchantId, key, path).then((r) => {
        detail[key] = r.data ?? emptyValue; detail.resourceStates[key] = 'loaded'; delete detail.resourceErrors[key];
      }).catch((error) => {
        detail.resourceStates[key] = 'error'; detail.resourceErrors[key] = error.message || `Impossible de charger ${key}.`;
      }).finally(() => {
        if (sessionVersion !== state.sessionVersion) return;
        cacheDetail(merchantId, detail);
        if (state.selectedId === merchantId && state.detail?.account?.id === merchantId) updateResourceBlock(key);
      });
      tasks.push(task);
    };
    const mayCreateStoreQr = state.role === 'admin' || (state.manager?.canCreateCodes !== false && can('canCreateStoreQr', scopedAccount));
    if (mayCreateStoreQr && detail.store?.id) addResource('qr', `${base}/qr`, null); else detail.resourceStates.qr = 'unavailable';
    if (can('canManageProducts', scopedAccount)) addResource('products', `${base}/products`, []); else detail.resourceStates.products = 'unavailable';
    if (can('canManageOrders', scopedAccount)) addResource('orders', `${base}/orders?page=1&limit=30`, []); else detail.resourceStates.orders = 'unavailable';
    if (state.role === 'admin') addResource('assignments', `${base}/assignments`, []); else detail.resourceStates.assignments = 'unavailable';
    if (state.role === 'admin' || can('canViewAudit', scopedAccount)) addResource('audit', `${base}/audit?page=1`, []); else detail.resourceStates.audit = 'unavailable';
    if (typeof onAccount === 'function' && sessionVersion === state.sessionVersion) onAccount(detail);
    await Promise.all(tasks);
    return detail;
  }
  function showDetailError(merchantId, error) {
    const message = error?.message || 'Impossible de charger les détails du marchand.';
    if (state.detail?.account?.id === merchantId && state.renderedDetailId === merchantId) {
      $('.detail-load-error', detailRoot)?.remove();
      detailRoot.insertAdjacentHTML('afterbegin', `<div class="detail-load-error" role="alert"><span>${esc(message)}</span> <button class="button outline" type="button" data-retry-detail>Réessayer les détails</button></div>`);
      return;
    }
    state.detail = null; state.renderedDetailId = '';
    detailRoot.innerHTML = `<div class="detail-load-error" role="alert"><p>${esc(message)}</p><button class="button primary" type="button" data-retry-detail>Réessayer</button></div>`;
  }
  async function selectMerchant(merchantId, { force = false } = {}) {
    if (!merchantId) return;
    if (state.uploading && (state.selectedId !== merchantId || force)) { if (state.selectedId === merchantId) state.pendingDetailRefresh = true; toast('Attendez la fin du traitement de la photo avant de changer ou d’actualiser le marchand.'); return state.detail; }
    const previousId = state.selectedId;
    if (previousId && previousId !== merchantId) captureDetailDrafts(previousId);
    if (merchantId !== state.selectedId) { state.selectedId = merchantId; state.selectionVersion++; state.pendingDetailRefresh = false; }
    renderMerchantList(); $('#emptyDetail').hidden = true; detailRoot.hidden = false;
    if (!force && previousId === merchantId && state.detail?.account?.id === merchantId) { mergeMerchantListRow(state.detail, selectedRow(merchantId)); return state.detail; }
    let cached = state.detailCache.get(merchantId);
    if (!force && cached?.detail) {
      state.detail = cached.detail; mergeMerchantListRow(state.detail, selectedRow(merchantId)); renderDetail();
      if (Date.now() - cached.loadedAt < DETAIL_CACHE_TTL_MS || hasDetailDraft(merchantId)) return state.detail;
    }
    const pending = state.detailRequests.get(merchantId);
    if (pending) {
      try {
        const detail = await pending;
        if (state.selectedId === merchantId) { state.detail = detail; cacheDetail(merchantId, detail); if (state.renderedDetailId !== merchantId) renderDetail(); }
        return detail;
      } catch (error) { if (state.selectedId === merchantId) showDetailError(merchantId, error); return null; }
    }
    if (state.detail?.account?.id !== merchantId) {
      state.detail = null; state.renderedDetailId = ''; detailRoot.innerHTML = '<p class="empty">Chargement des détails du marchand…</p>';
    }
    const sessionVersion = state.sessionVersion;
    const request = loadDetailData(merchantId, (detail) => {
      if (sessionVersion !== state.sessionVersion) return;
      cacheDetail(merchantId, detail);
      if (state.selectedId === merchantId) { state.detail = detail; renderDetail(); }
    });
    state.detailRequests.set(merchantId, request);
    try {
      const detail = await request;
      if (sessionVersion === state.sessionVersion) cacheDetail(merchantId, detail);
      if (sessionVersion === state.sessionVersion && state.selectedId === merchantId) {
        state.detail = detail; state.pendingDetailRefresh = false;
        if (state.renderedDetailId !== merchantId) renderDetail();
      }
      return detail;
    } catch (error) {
      if (state.selectedId === merchantId) showDetailError(merchantId, error);
      return null;
    } finally { if (state.detailRequests.get(merchantId) === request) state.detailRequests.delete(merchantId); }
  }
  function resourceStatusMarkup(detail, key, label) {
    const status = detail.resourceStates?.[key];
    if (status === 'loading') return `<p class="empty" role="status">Chargement ${esc(label)}…</p>`;
    if (status === 'error') return `<p class="resource-error" role="alert">${esc(detail.resourceErrors?.[key] || `Impossible de charger ${label}.`)} <button class="button outline" type="button" data-retry-resource="${esc(key)}">Réessayer</button></p>`;
    return '';
  }
  function renderProductsContent(detail) {
    const status = resourceStatusMarkup(detail, 'products', 'des produits'); if (status) return status;
    return detail.products.length ? detail.products.map((p) => `<article class="control-product"><div class="control-product-thumb">${p.imageData ? `<img src="${esc(p.imageData)}" alt="">` : 'PHOTO'}</div><div><strong>${esc(p.name)} · ${money(p.priceXof)}</strong><small>${p.trackStock ? `${Number(p.stockQuantity)} en stock` : 'Stock non suivi'} · ${p.status === 'active' ? 'Disponible' : 'Indisponible'}</small></div><button type="button" data-edit-product="${esc(p.id)}">Modifier</button><button type="button" data-archive-product="${esc(p.id)}">Archiver</button></article>`).join('') : '<p class="empty">Aucun produit enregistré.</p>';
  }
  function renderOrdersContent(detail) {
    const status = resourceStatusMarkup(detail, 'orders', 'des commandes'); if (status) return status;
    return detail.orders.length ? detail.orders.map((o) => `<article class="control-order"><div class="control-order-head"><div><strong>${esc(o.reference)}</strong><small>${esc(o.customerName)} · ${esc(o.customerPhone)} · ${esc(fmtDate(o.createdAt))}</small></div><span class="order-status ${esc(o.status)}">${esc(statuses[o.status] || o.status)}</span></div><div class="control-order-body">${esc(o.deliveryAddress)}<div class="control-order-items">${o.items.map((item) => `<span>${esc(item.name)} × ${item.quantity} — ${money(item.unitPriceXof)}</span>`).join('')}</div><strong>Total : ${money(o.totalAmountXof)}</strong></div><div class="control-order-foot"><small class="muted">Pas de preuve de paiement enregistrée</small>${(nextStatus[o.status] || []).length ? `<select data-order-status="${esc(o.id)}"><option value="">Modifier le statut…</option>${nextStatus[o.status].map((s) => `<option value="${s}">${statuses[s]}</option>`).join('')}</select>` : ''}</div></article>`).join('') : '<p class="empty">Aucune commande reçue.</p>';
  }
  function renderQrContent(detail) {
    const resourceState = detail.resourceStates?.qr; const code = detail.store?.qrPublicCode || '';
    const mayCreate = state.role === 'admin' || (state.manager?.canCreateCodes !== false && can('canCreateStoreQr', detail.account));
    let message = code ? 'QR déjà créé par un rôle autorisé.' : mayCreate ? 'Un QR n’a pas encore été créé.' : 'Seul le PDG ou un gestionnaire explicitement autorisé peut créer ce QR.';
    if (resourceState === 'loading') message = 'Vérification du lien QR stable…';
    if (resourceState === 'error') message = detail.resourceErrors?.qr || 'Impossible de vérifier le QR.';
    return `<div><p>${esc(message)}</p>${resourceState === 'error' ? `<button class="button outline" type="button" data-retry-resource="qr">Réessayer</button>` : ''}<a id="controlQrLink" href="${code ? `/s/${esc(code)}` : '#'}" ${code ? '' : 'hidden'} target="_blank" rel="noopener">${code ? `${esc(window.location.origin)}/s/${esc(code)}` : ''}</a></div><canvas id="controlQrCanvas" width="180" height="180" ${code ? '' : 'hidden'}></canvas>`;
  }
  function renderAssignmentsContent(detail) {
    const status = resourceStatusMarkup(detail, 'assignments', 'des permissions'); if (status) return status;
    return detail.assignments.length ? detail.assignments.map((a) => { const manager = state.managers.find((m) => m.id === a.managerId); const enabled = permissionFields.filter(([key]) => a[key]).map(([,label]) => label).join(', ') || 'Aucun droit actif'; return `<div class="assignment-row"><div><strong>${esc(manager?.displayName || a.managerId)}</strong><small>${esc(enabled)}</small></div><button type="button" data-remove-assignment="${esc(a.managerId)}">Retirer</button></div>`; }).join('') : '<p class="empty">Aucune attribution explicite.</p>';
  }
  function renderAuditContent(detail) {
    if (state.role !== 'admin' && !can('canViewAudit', detail.account)) return '<p class="empty">Le journal n’est pas inclus dans vos permissions.</p>';
    const status = resourceStatusMarkup(detail, 'audit', 'du journal commercial'); if (status) return status;
    return detail.audit.length ? `<div class="control-audit">${detail.audit.map((row) => `<div class="control-audit-row"><strong>${esc(row.summary)}</strong><small>${esc(row.actor)} · ${esc(row.action)} · ${esc(fmtDate(row.createdAt))}</small></div>`).join('')}</div>` : '<p class="empty">Aucune action enregistrée.</p>';
  }
  function updateResourceBlock(key) {
    if (!state.detail || state.detail.account?.id !== state.selectedId) return;
    const block = $(`[data-resource-block="${key}"]`, detailRoot); if (!block) return;
    const content = { products: renderProductsContent, orders: renderOrdersContent, qr: renderQrContent, assignments: renderAssignmentsContent, audit: renderAuditContent }[key];
    if (!content) return;
    block.innerHTML = content(state.detail);
    if (key === 'qr') renderQrIfPresent();
    wireResourceEvents(key);
  }
  async function retryDetailResource(key) {
    const merchantId = state.selectedId; const detail = state.detail; const endpoint = detail?.resourceEndpoints?.[key]; const sessionVersion = state.sessionVersion;
    if (!merchantId || detail?.account?.id !== merchantId || !endpoint) return;
    detail.resourceStates[key] = 'loading'; delete detail.resourceErrors[key]; updateResourceBlock(key);
    try {
      const result = await requestDetailResource(merchantId, key, endpoint);
      detail[key] = result.data ?? (key === 'qr' ? null : []); detail.resourceStates[key] = 'loaded'; delete detail.resourceErrors[key];
    } catch (error) { detail.resourceStates[key] = 'error'; detail.resourceErrors[key] = error.message || 'Impossible de charger cette ressource.'; }
    if (sessionVersion !== state.sessionVersion) return;
    cacheDetail(merchantId, detail);
    if (state.detail === detail && state.selectedId === merchantId) updateResourceBlock(key);
  }
  function wireResourceEvents(key = '') {
    if (!key || key === 'products') {
      $$('[data-edit-product]', detailRoot).forEach((button) => button.addEventListener('click', () => editProduct(button.dataset.editProduct)));
      $$('[data-archive-product]', detailRoot).forEach((button) => button.addEventListener('click', () => archiveProduct(button.dataset.archiveProduct)));
    }
    if (!key || key === 'orders') $$('[data-order-status]', detailRoot).forEach((select) => select.addEventListener('change', () => orderStatus(select.dataset.orderStatus, select.value)));
    if (!key || key === 'assignments') $$('[data-remove-assignment]', detailRoot).forEach((button) => button.addEventListener('click', () => removeAssignment(button.dataset.removeAssignment)));
  }
  function renderDetail() {
    const d = state.detail; if (!d) return;
    const merchantId = d.account.id;
    const active = detailRoot.contains(document.activeElement) ? document.activeElement : null;
    const activeId = active?.id || ''; let selection = null;
    if (active && typeof active.selectionStart === 'number') selection = [active.selectionStart, active.selectionEnd];
    const scrollLeft = window.scrollX || 0; const scrollTop = window.scrollY || 0;
    if (state.renderedDetailId === merchantId) captureDetailDrafts(merchantId);
    const account = d.account; const storeData = d.store; const isArchived = Boolean(account.deletedAt);
    const canAccount = !isArchived && (state.role === 'admin' || can('canManageStore', account));
    const canStore = !isArchived && can('canManageStore', account); const canProducts = !isArchived && can('canManageProducts', account); const canOrders = !isArchived && can('canManageOrders', account);
    const canQr = !isArchived && (state.role === 'admin' || (state.manager?.canCreateCodes !== false && can('canCreateStoreQr', account)));
    const managerName = state.managers.find((m) => m.id === account.managerId)?.displayName || (account.managerId ? 'Gestionnaire attribué' : 'PDG');
    detailRoot.innerHTML = `<div class="detail-banner"><div><span class="eyebrow">${isArchived ? 'COMPTE ARCHIVÉ · DONNÉES CONSERVÉES' : 'COMPTE MARCHAND'}</span><h2>${esc(account.displayName)}</h2><p>@${esc(account.username)} · Responsable : ${esc(managerName)} · Créé le ${esc(fmtDate(account.createdAt))}${isArchived ? ` · Archivé le ${esc(fmtDate(account.deletedAt))}` : ''}</p></div><div class="detail-actions"><button class="button outline" type="button" data-control-action="refresh-detail">Actualiser les détails</button>${state.role === 'admin' && isArchived ? '<button class="button primary" type="button" data-control-action="restore-account">Restaurer le compte</button>' : ''}${state.role === 'admin' && !isArchived ? `<button class="button outline" type="button" data-control-action="reset-password">Réinitialiser l’accès</button><button class="button ${account.status === 'active' ? 'quiet' : 'primary'}" type="button" data-control-action="toggle-status">${account.status === 'active' ? 'Suspendre' : 'Réactiver'}</button><button class="button danger" type="button" data-control-action="archive-account">Archiver</button>` : ''}${canQr && storeData ? `<button class="button primary" type="button" data-control-action="create-qr">${storeData.qrPublicCode ? 'Afficher le QR' : 'Créer le QR boutique'}</button>` : ''}</div></div>
      ${isArchived ? '<section class="control-section archived-notice"><h3>Compte archivé</h3><p class="section-intro">Les connexions et commandes publiques sont désactivées. Le compte, la boutique et l’historique sont conservés. Les modifications sont bloquées jusqu’à sa restauration.</p></section>' : ''}
      <section class="control-section"><h3>Compte et rattachement</h3><p class="section-intro">La suspension ou la réinitialisation révoque les sessions en cours. Le mot de passe n’est jamais affiché ici.</p>${canAccount ? `<form id="accountForm" class="form-grid"><div class="field"><label for="accountName">Nom affiché *</label><input id="accountName" value="${esc(account.displayName)}" maxlength="120" required></div><div class="field"><label>Identifiant</label><input value="${esc(account.username)}" disabled></div><div class="field"><label for="accountEmail">E-mail</label><input id="accountEmail" type="email" value="${esc(account.email || '')}" maxlength="254"></div><div class="field"><label for="accountPhone">Téléphone</label><input id="accountPhone" type="tel" value="${esc(account.phone || '')}" maxlength="32"></div>${state.role === 'admin' ? `<div class="field span-two"><label for="accountManager">Responsable principal</label><select id="accountManager">${managersForSelect(account.managerId || '')}</select></div>` : ''}<div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer le compte</button><span class="control-scope">Statut : ${esc(account.status)}${account.mustChangePassword ? ' · changement de mot de passe requis' : ''}</span></div></form>` : `<p class="control-scope">${isArchived ? `Compte en lecture seule · statut : ${esc(account.status)}${account.mustChangePassword ? ' · changement de mot de passe requis' : ''}` : 'Consultation des informations de compte limitée par vos permissions.'}</p>`}</section>
      <section class="control-section"><div class="section-head"><h3>Boutique</h3><span class="state-pill ${storeData?.isPublished ? 'published' : ''}">${storeData ? (storeData.isPublished ? 'Publiée' : 'Brouillon') : 'À créer'}</span></div><p class="section-intro">Le catalogue public utilise les informations et produits actuels; l’adresse publique est stable.</p>${canStore ? `<form id="controlStoreForm" class="form-grid"><div class="field"><label for="controlStoreName">Nom commercial *</label><input id="controlStoreName" value="${esc(storeData?.name || '')}" maxlength="120" required></div><div class="field"><label for="controlStoreSector">Secteur</label><select id="controlStoreSector"><option value="general" ${storeData?.sector === 'general' || !storeData?.sector ? 'selected' : ''}>Général / autre commerce</option><option value="restaurant" ${storeData?.sector === 'restaurant' ? 'selected' : ''}>Restaurant</option><option value="maquis" ${storeData?.sector === 'maquis' ? 'selected' : ''}>Maquis</option><option value="hardware" ${storeData?.sector === 'hardware' ? 'selected' : ''}>Quincaillerie</option><option value="clothing" ${storeData?.sector === 'clothing' ? 'selected' : ''}>Vêtements / mode</option></select></div><div class="field"><label for="controlStoreSlug">Adresse publique</label><input id="controlStoreSlug" value="${esc(storeData?.slug || '')}" ${storeData?.id ? 'disabled' : ''} placeholder="boutique-exemple" maxlength="70"></div><div class="field span-two"><label for="controlStoreDescription">Présentation</label><textarea id="controlStoreDescription" rows="3" maxlength="3000">${esc(storeData?.description || '')}</textarea></div><div class="field"><label for="controlStorePhone">Téléphone</label><input id="controlStorePhone" value="${esc(storeData?.phone || '')}" maxlength="32"></div><div class="field"><label for="controlStoreWhatsApp">WhatsApp</label><input id="controlStoreWhatsApp" value="${esc(storeData?.whatsapp || '')}" maxlength="32"></div><div class="field"><label for="controlStoreEmail">E-mail</label><input id="controlStoreEmail" type="email" value="${esc(storeData?.email || '')}" maxlength="254"></div><div class="field"><label for="controlStoreAddress">Adresse / zone</label><input id="controlStoreAddress" value="${esc(storeData?.address || '')}" maxlength="500"></div><div class="field span-two"><label for="controlDeliveryNote">Modalités de remise</label><textarea id="controlDeliveryNote" rows="2" maxlength="1000">${esc(storeData?.deliveryNote || '')}</textarea></div><div class="field span-two media-field"><div class="media-preview"><img id="controlStoreLogoPreview" alt="" ${storeData?.logo ? `src="${esc(storeData.logo)}"` : 'hidden'}><span id="controlStoreLogoFallback" ${storeData?.logo ? 'hidden' : ''}>LOGO</span></div><div><label class="button outline file-label" for="controlStoreLogoFile">Choisir un logo</label><input id="controlStoreLogoFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><input id="controlStoreLogoData" type="hidden" value="${esc(storeData?.logo || '')}"><button class="link-button" type="button" data-clear-image="store">Retirer</button><small>Compressé localement, max. 350 Ko. L’import conserve la page et le défilement.</small></div></div><div class="field span-two publish-row"><label><input id="controlStorePublished" type="checkbox" ${storeData?.isPublished ? 'checked' : ''}> Publier le catalogue et accepter des commandes</label></div>${state.role !== 'admin' ? '' : `<div class="field"><label for="controlStoreStatus">Statut</label><select id="controlStoreStatus"><option value="active" ${storeData?.status !== 'suspended' ? 'selected' : ''}>Actif</option><option value="suspended" ${storeData?.status === 'suspended' ? 'selected' : ''}>Suspendu</option></select></div>`}<div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer la boutique</button>${storeData?.slug ? `<a class="button outline" href="/shop/${encodeURIComponent(storeData.slug)}" target="_blank" rel="noopener">Voir le catalogue ↗</a>` : ''}</div></form>` : `<p class="control-scope">Boutique ${storeData ? `« ${esc(storeData.name || storeData.storeName || '')} » · /shop/${esc(storeData.slug || storeData.storeSlug || '')}` : 'non configurée'}. Vos droits ne permettent pas de la modifier.</p>`}</section>
      ${canProducts ? `<section class="control-section"><div class="section-head"><div><h3>Produits et stocks</h3><p class="section-intro">Prix en XOF, stock contrôlé côté serveur avant confirmation de la commande.</p></div><button class="button outline" type="button" data-control-action="new-product" ${storeData?.id ? '' : 'disabled'}>＋ Produit</button></div>${!storeData?.id ? '<p class="empty">Créez la boutique avant d’ajouter des produits.</p>' : ''}<div id="controlProductList" class="control-products" data-resource-block="products">${renderProductsContent(d)}</div><form id="controlProductForm" class="control-product-form form-grid" hidden><input id="controlProductId" type="hidden"><div class="field"><label for="controlProductName">Nom *</label><input id="controlProductName" required maxlength="120"></div><div class="field"><label for="controlProductSku">Référence</label><input id="controlProductSku" maxlength="80"></div><div class="field"><label for="controlProductPrice">Prix (XOF)</label><input id="controlProductPrice" type="number" min="0" max="2000000000" step="1" required></div><div class="field"><label for="controlProductStock">Stock</label><input id="controlProductStock" type="number" min="0" max="1000000" step="1" value="0"></div><div class="field"><label for="controlProductComparePrice">Prix avant promotion (XOF)</label><input id="controlProductComparePrice" type="number" min="0" max="2000000000" step="1"></div><div class="field"><label for="controlProductCategory">Catégorie</label><input id="controlProductCategory" maxlength="80"></div><div class="field span-two"><label for="controlProductDescription">Description</label><textarea id="controlProductDescription" rows="2" maxlength="2000"></textarea></div><div class="field span-two"><label for="controlProductVariants">Variantes (une ligne par option, format : Taille | S, M, L)</label><textarea id="controlProductVariants" rows="2" maxlength="1500" placeholder="Taille | S, M, L"></textarea></div><div class="field span-two media-field"><div class="media-preview"><img id="controlProductPreview" alt="" hidden><span id="controlProductFallback">PHOTO</span></div><div><label class="button outline file-label" for="controlProductFile">Choisir une image</label><input id="controlProductFile" type="file" accept="image/png,image/jpeg,image/webp" hidden><input id="controlProductImage" type="hidden"><input id="controlProductImageUrls" type="hidden" value="[]"><button class="link-button" type="button" data-clear-image="product">Retirer toutes les photos</button><small>Import direct sans remontage ni déplacement de page.</small></div></div><div class="field span-two permission-grid"><label><input id="controlProductTrack" type="checkbox" checked> Suivre le stock</label><label><input id="controlProductActive" type="checkbox" checked> Disponible à la vente</label></div><div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer le produit</button><button class="button quiet" type="button" data-control-action="cancel-product">Annuler</button></div></form></section>` : `<section class="control-section"><h3>Produits et stocks</h3><p class="section-intro">Votre attribution ne permet pas de gérer les produits.</p></section>`}
      ${canOrders ? `<section class="control-section"><div class="section-head"><div><h3>Commandes clients</h3><p class="section-intro">Les mises à jour sont diffusées sans recharger la page. Aucun paiement en ligne fictif.</p></div><button class="button outline" type="button" data-control-action="refresh-detail">Actualiser</button></div><div class="control-orders" data-resource-block="orders">${renderOrdersContent(d)}</div></section>` : `<section class="control-section"><h3>Commandes clients</h3><p class="section-intro">Votre attribution ne permet pas de consulter ou de modifier les commandes.</p></section>`}
      <section class="control-section"><div class="section-head"><div><h3>QR de boutique</h3><p class="section-intro">Le QR ouvre une adresse stable dont le contenu commercial reste à jour.</p></div>${canQr && storeData ? `<button class="button primary" type="button" data-control-action="create-qr">${storeData.qrPublicCode ? 'Afficher le QR' : 'Créer le QR'}</button>` : ''}</div><div id="controlQrBlock" class="control-qr" data-resource-block="qr">${renderQrContent(d)}</div></section>
      ${state.role === 'admin' ? `<section class="control-section"><div class="section-head"><div><h3>Gestionnaires attribués</h3><p class="section-intro">Définissez les droits par marchand; un gestionnaire ne voit que ses attributions.</p></div></div><form id="assignmentForm" class="form-grid"><div class="field span-two"><label for="assignmentManager">Gestionnaire</label><select id="assignmentManager" required>${state.managers.filter((m) => m.status === 'active' && !m.deletedAt).map((m) => `<option value="${esc(m.id)}">${esc(m.displayName)} (@${esc(m.username)})</option>`).join('')}</select></div><div class="field span-two permission-grid">${permissionFields.map(([key,label]) => `<label><input type="checkbox" name="${key}" id="perm-${key}"> ${label}</label>`).join('')}</div><div class="field span-two section-actions"><button class="button primary" type="submit">Enregistrer cette attribution</button></div></form><div class="control-assignments" data-resource-block="assignments">${renderAssignmentsContent(d)}</div></section>` : ''}
      <section class="control-section"><div class="section-head"><div><h3>Journal commercial</h3><p class="section-intro">Actions de compte, boutique, produits, commandes, permissions et QR.</p></div></div><div data-resource-block="audit">${renderAuditContent(d)}</div></section>`;
    state.renderedDetailId = merchantId; restoreDetailDrafts(merchantId);
    if (activeId) { const target = $(`#${activeId}`, detailRoot); target?.focus?.({ preventScroll: true }); if (selection && typeof target?.setSelectionRange === 'function') { try { target.setSelectionRange(selection[0], selection[1]); } catch (_) {} } }
    if (scrollTop && (window.scrollY !== scrollTop || window.scrollX !== scrollLeft)) { try { window.scrollTo(scrollLeft, scrollTop); } catch (_) {} }
    wireDetailEvents(); renderQrIfPresent();
  }

  async function reloadSelected() {
    if (!state.selectedId) return;
    const merchantId = state.selectedId;
    await loadMerchants({ keepSelection: true, loadSelectedDetail: false });
    if (state.selectedId === merchantId) await selectMerchant(merchantId, { force: true });
    else if (state.selectedId) await selectMerchant(state.selectedId);
  }
  async function loadProductsAgain() { if (!state.selectedId) return; const r = await api(merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/products`)); state.detail.products = r.data || []; }
  async function saveAccount(event) {
    event.preventDefault(); const account = state.detail.account; const payload = { displayName: $('#accountName').value.trim(), email: $('#accountEmail').value.trim(), phone: $('#accountPhone').value.trim() };
    if (state.role === 'admin') payload.managerId = $('#accountManager').value;
    try { await api(merchantApi(`/merchants/${encodeURIComponent(account.id)}`), { method: 'PUT', body: JSON.stringify(payload) }); clearDetailFormDraft(account.id, 'accountForm'); toast('Profil marchand enregistré; anciennes sessions révoquées.'); await reloadSelected(); }
    catch (error) { toast(error.message); }
  }
  function accountCreationDialog() {
    const root = $('#modalRoot'); root.hidden = false;
    root.innerHTML = `<article class="control-modal-card"><span class="eyebrow">NOUVEAU COMPTE</span><h2>Créer un marchand</h2><p>Un mot de passe temporaire, affiché une seule fois, obligera le marchand à en choisir un nouveau.</p><form id="createMerchantForm" class="form-grid"><div class="field span-two"><label for="newMerchantName">Nom affiché *</label><input id="newMerchantName" maxlength="120" required></div><div class="field"><label for="newMerchantUsername">Identifiant *</label><input id="newMerchantUsername" minlength="3" maxlength="80" pattern="[A-Za-z0-9][A-Za-z0-9._-]{2,79}" required></div><div class="field"><label for="newMerchantPhone">Téléphone</label><input id="newMerchantPhone" type="tel" maxlength="32"></div><div class="field span-two"><label for="newMerchantPasswordLength">Mot de passe temporaire</label><select id="newMerchantPasswordLength"><option value="18" selected>18 caractères (recommandé)</option><option value="6">6 caractères (à transmettre par un canal sûr)</option></select><small>Expire sous 24 h et devra être remplacé à la première connexion.</small></div><div class="field span-two"><label for="newMerchantEmail">E-mail</label><input id="newMerchantEmail" type="email" maxlength="254"></div>${state.role === 'admin' ? `<div class="field span-two"><label for="newMerchantManager">Responsable principal</label><select id="newMerchantManager">${managersForSelect('')}</select></div>` : ''}<div class="field span-two section-actions"><button class="button primary" type="submit">Créer le compte</button><button class="button quiet" type="button" data-close-control-modal>Annuler</button></div></form></article>`;
    $('#createMerchantForm').addEventListener('submit', createMerchant);
    $('[data-close-control-modal]', root).addEventListener('click', () => { root.hidden = true; });
  }
  async function createMerchant(event) {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    const body = { displayName: $('#newMerchantName').value.trim(), username: $('#newMerchantUsername').value.trim(), phone: $('#newMerchantPhone').value.trim(), email: $('#newMerchantEmail').value.trim(), temporaryPasswordLength: Number($('#newMerchantPasswordLength').value) };
    if (state.role === 'admin') body.managerId = $('#newMerchantManager').value;
    try { const response = await api(state.role === 'admin' ? '/api/admin/merchants' : '/api/manager/merchants', { method: 'POST', body: JSON.stringify(body) });
      const root = $('#modalRoot'); root.hidden = false; root.innerHTML = `<article class="control-modal-card"><span class="eyebrow">À TRANSMETTRE UNE SEULE FOIS</span><h2>Compte créé</h2><p>Ce mot de passe temporaire expire le ${esc(fmtDate(response.expiresAt))}; communiquez-le par un canal sûr. Il ne peut pas être réaffiché.</p><div class="secret-box"><code id="secretValue">${esc(response.temporaryPassword)}</code><button class="button outline" type="button" id="copySecret">Copier</button></div><button class="button primary" type="button" id="finishSecret">Terminé</button></article>`;
      $('#copySecret').addEventListener('click', async () => { try { await navigator.clipboard.writeText(response.temporaryPassword); toast('Mot de passe copié.'); } catch (_) { $('#secretValue').select?.(); } });
      $('#finishSecret').addEventListener('click', async () => { root.hidden = true; if (state.selectedId !== response.data.id) { state.selectedId = response.data.id; state.selectionVersion++; } state.pendingDetailRefresh = false; await reloadSelected(); });
      await loadMerchants({ keepSelection: true, loadSelectedDetail: false });
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
  async function archiveAccount() {
    const account = state.detail?.account; if (!account || account.deletedAt || state.role !== 'admin') return;
    const typed = window.prompt(`Pour archiver « ${account.displayName} », saisissez exactement l’identifiant @${account.username}. Le compte sera bloqué, ses sessions révoquées; les données et l’historique seront conservés.`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== account.username.toLowerCase()) return toast('Identifiant de confirmation incorrect; rien n’a été modifié.');
    const reason = window.prompt('Motif d’archivage (facultatif, maximum 500 caractères).', 'Compte archivé par le PDG.');
    if (reason === null) return;
    const previousFilter = state.includeArchived; state.includeArchived = true; $('#showArchivedMerchants').checked = true;
    try {
      const result = await api(`/api/admin/merchants/${encodeURIComponent(account.id)}/archive`, { method: 'POST', body: JSON.stringify({ confirmUsername: typed.trim(), reason }) });
      if (state.detail?.account?.id === account.id) state.detail.account = { ...state.detail.account, ...result.data };
      toast('Compte archivé. Les données sont conservées et les sessions révoquées.');
      await loadMerchants({ keepSelection: true, loadSelectedDetail: false });
      if (state.detail?.account?.id === account.id) renderDetail();
    } catch (error) {
      state.includeArchived = previousFilter; $('#showArchivedMerchants').checked = previousFilter;
      toast(error.message || 'Impossible d’archiver ce compte.');
    }
  }
  async function restoreAccount() {
    const account = state.detail?.account; if (!account?.deletedAt || state.role !== 'admin') return;
    const typed = window.prompt(`Pour restaurer « ${account.displayName} », saisissez exactement l’identifiant @${account.username}.`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== account.username.toLowerCase()) return toast('Identifiant de confirmation incorrect; rien n’a été modifié.');
    try {
      const result = await api(`/api/admin/merchants/${encodeURIComponent(account.id)}/restore`, { method: 'POST', body: JSON.stringify({ confirmUsername: typed.trim() }) });
      if (state.detail?.account?.id === account.id) state.detail.account = { ...state.detail.account, ...result.data };
      state.includeArchived = false; $('#showArchivedMerchants').checked = false;
      toast('Compte restauré. Les données et liens historiques sont conservés.');
      await loadMerchants({ keepSelection: true, loadSelectedDetail: false });
      if (state.detail?.account?.id === account.id) renderDetail();
    } catch (error) { toast(error.message || 'Impossible de restaurer ce compte.'); }
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
    return { name: $('#controlStoreName').value.trim(), slug: $('#controlStoreSlug').value.trim(), sector: $('#controlStoreSector').value, description: $('#controlStoreDescription').value.trim(),
      phone: $('#controlStorePhone').value.trim(), whatsapp: $('#controlStoreWhatsApp').value.trim(), email: $('#controlStoreEmail').value.trim(), address: $('#controlStoreAddress').value.trim(),
      deliveryNote: $('#controlDeliveryNote').value.trim(), logo: $('#controlStoreLogoData').value, isPublished: $('#controlStorePublished').checked,
      status: state.role === 'admin' ? $('#controlStoreStatus').value : (current.status || 'active') };
  }
  async function saveStore(event) {
    event.preventDefault(); const merchantId = state.selectedId; const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    try { await api(merchantApi(`/merchants/${encodeURIComponent(merchantId)}/store`), { method: 'PUT', body: JSON.stringify(storePayload()) }); clearDetailFormDraft(merchantId, 'controlStoreForm'); toast('Boutique enregistrée.'); await reloadSelected(); }
    catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  }
  function clearImage(type) {
    if (type === 'store') { $('#controlStoreLogoData').value = ''; $('#controlStoreLogoPreview').hidden = true; $('#controlStoreLogoPreview').removeAttribute('src'); $('#controlStoreLogoFallback').hidden = false; markDetailFormDirty($('#controlStoreLogoData')?.form); }
    else { $('#controlProductImage').value = ''; $('#controlProductImageUrls').value = '[]'; $('#controlProductPreview').hidden = true; $('#controlProductPreview').removeAttribute('src'); $('#controlProductFallback').hidden = false; markDetailFormDirty($('#controlProductImage')?.form); }
  }
  function parseControlVariants(raw) {
    return String(raw || '').split(/\r?\n/).map((line) => {
      const divider = line.indexOf('|'); if (divider < 0) return null;
      const name = line.slice(0, divider).trim(); const values = line.slice(divider + 1).split(',').map((value) => value.trim()).filter(Boolean);
      return name && values.length ? { name, values } : null;
    }).filter(Boolean);
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
      else { $('#controlProductImage').value=data; $('#controlProductImageUrls').value=JSON.stringify([data]); $('#controlProductPreview').src=data; $('#controlProductPreview').hidden=false; $('#controlProductFallback').hidden=true; }
      if(typeof image.close==='function')image.close();
    }).catch((error)=>toast(error.message||'Erreur d’image.')).finally(()=>{state.uploading=false;});
  }
  async function submitProduct(event) {
    event.preventDefault(); const id = $('#controlProductId').value; let imageUrls = [];
    try { const parsed = JSON.parse($('#controlProductImageUrls').value || '[]'); if (Array.isArray(parsed)) imageUrls = parsed; } catch (_) {}
    const selectedImage = String($('#controlProductImage').value || '');
    if (selectedImage && imageUrls[0] !== selectedImage) imageUrls = [selectedImage, ...imageUrls.filter((url) => url !== selectedImage)].slice(0, 8);
    const compareAt = $('#controlProductComparePrice').value;
    const payload = { name: $('#controlProductName').value.trim(), sku: $('#controlProductSku').value.trim(), priceXof: Number($('#controlProductPrice').value),
      compareAtPriceXof: compareAt === '' ? null : Number(compareAt), category: $('#controlProductCategory').value.trim(),
      stockQuantity: Number($('#controlProductStock').value || 0), description: $('#controlProductDescription').value.trim(),
      variants: parseControlVariants($('#controlProductVariants').value), imageUrls, imageData: imageUrls[0] || '',
      trackStock: $('#controlProductTrack').checked, status: $('#controlProductActive').checked ? 'active' : 'unavailable' };
    const path=merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/products${id?`/${encodeURIComponent(id)}`:''}`);
    try{await api(path,{method:id?'PUT':'POST',body:JSON.stringify(payload)});clearDetailFormDraft(state.selectedId,'controlProductForm');toast(id?'Produit modifié.':'Produit ajouté.');await reloadSelected();}catch(error){toast(error.message);}
  }
  async function archiveProduct(id) {
    const product = state.detail?.products.find((row) => row.id === id);
    if (!product || !window.confirm(`Archiver « ${product.name} » ? Il ne sera plus commandable et restera visible dans l’historique.`)) return;
    try { await api(merchantApi(`/merchants/${encodeURIComponent(state.selectedId)}/products/${encodeURIComponent(id)}`), { method: 'DELETE' }); toast('Produit archivé.'); await reloadSelected(); }
    catch (error) { toast(error.message); }
  }
  function editProduct(id) {
    const product = state.detail.products.find((row) => row.id === id); if (!product) return;
    const imageUrls = Array.isArray(product.imageUrls) && product.imageUrls.length ? product.imageUrls : (product.imageData ? [product.imageData] : []);
    $('#controlProductForm').hidden = false; $('#controlProductId').value = product.id; $('#controlProductName').value = product.name;
    $('#controlProductSku').value = product.sku || ''; $('#controlProductPrice').value = product.priceXof; $('#controlProductComparePrice').value = product.compareAtPriceXof ?? '';
    $('#controlProductCategory').value = product.category || ''; $('#controlProductStock').value = product.stockQuantity; $('#controlProductDescription').value = product.description || '';
    $('#controlProductVariants').value = (product.variants || []).map((row) => `${row.name} | ${(row.values || []).join(', ')}`).join('\n');
    $('#controlProductTrack').checked = product.trackStock !== false; $('#controlProductActive').checked = product.status === 'active';
    $('#controlProductImageUrls').value = JSON.stringify(imageUrls); $('#controlProductImage').value = imageUrls[0] || '';
    if (imageUrls[0]) { $('#controlProductPreview').src = imageUrls[0]; $('#controlProductPreview').hidden = false; $('#controlProductFallback').hidden = true; }
    else clearImage('product');
    markDetailFormDirty($('#controlProductForm')); $('#controlProductFormTitle')?.focus?.({ preventScroll: true }); $('#controlProductName').focus({ preventScroll: true });
  }
  function wireDetailEvents() {
    $('#accountForm')?.addEventListener('submit',saveAccount);$('#controlStoreForm')?.addEventListener('submit',saveStore);$('#controlProductForm')?.addEventListener('submit',submitProduct);
    $('#controlStoreLogoFile')?.addEventListener('change',(e)=>compressImage(e.target.files?.[0],'store'));
    $('#controlProductFile')?.addEventListener('change',(e)=>compressImage(e.target.files?.[0],'product'));
    $$('[data-clear-image]').forEach((b)=>b.addEventListener('click',()=>clearImage(b.dataset.clearImage)));
    $$('[data-control-action]').forEach((button)=>button.addEventListener('click',()=>{
      const action=button.dataset.controlAction;
      if(action==='toggle-status')setAccountStatus();if(action==='reset-password')resetPassword();if(action==='archive-account')archiveAccount();if(action==='restore-account')restoreAccount();if(action==='create-qr')createQr();if(action==='refresh-detail')selectMerchant(state.selectedId,{force:true});
      if(action==='new-product'){if(!state.detail.store?.id)return toast('Créez d’abord la boutique.');$('#controlProductForm').hidden=false;$('#controlProductForm').reset();$('#controlProductId').value='';$('#controlProductStock').value='0';$('#controlProductTrack').checked=true;$('#controlProductActive').checked=true;clearImage('product');markDetailFormDirty($('#controlProductForm'));$('#controlProductName').focus({preventScroll:true});}
      if(action==='cancel-product'){ const id=state.selectedId; $('#controlProductForm').reset();$('#controlProductForm').hidden=true;$('#controlProductId').value='';clearImage('product');clearDetailFormDraft(id,'controlProductForm'); }
    }));
    $('#assignmentForm')?.addEventListener('submit',saveAssignment);
    wireResourceEvents();
  }
  async function saveAssignment(event) {
    event.preventDefault();const managerId=$('#assignmentManager').value;if(!managerId)return toast('Sélectionnez un gestionnaire.');const body={managerId};for(const key of permissionFields.map(([k])=>k))body[key]=$(`#perm-${key}`).checked;
    const merchantId=state.selectedId;
    try{await api(`/api/admin/merchants/${encodeURIComponent(merchantId)}/assignments`,{method:'POST',body:JSON.stringify(body)});clearDetailFormDraft(merchantId,'assignmentForm');toast('Attribution et permissions enregistrées.');if(state.selectedId===merchantId)await reloadSelected();}catch(error){toast(error.message);}
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
  function clearControlSession(){
    closeEvents();if(state.pollTimer){clearInterval(state.pollTimer);state.pollTimer=0;}state.sessionVersion++;state.selectionVersion++;
    state.role='';state.admin=null;state.manager=null;state.managers=[];state.merchants=[];state.selectedId='';state.detail=null;state.pendingDetailRefresh=false;
    state.merchantListRequest=null;state.detailCache.clear();state.detailRequests.clear();state.resourceRequests.clear();state.detailDrafts.clear();state.dirtyForms.clear();state.renderedDetailId='';
    $('#modalRoot').hidden=true;$('#modalRoot').replaceChildren();detailRoot.hidden=true;detailRoot.replaceChildren();$('#emptyDetail').hidden=false;renderMerchantList();setAuthView();
  }
  function connectEvents(){closeEvents();const url=state.role==='admin'?'/api/admin/merchants/events':'/api/manager/merchants/events';state.eventSource=new EventSource(url);state.eventSource.addEventListener('commerce',(event)=>{let data={};try{data=JSON.parse(event.data);}catch(_){};if(data.type==='new_order')toast(`Nouvelle commande reçue${data.reference?` : ${data.reference}`:''}.`);const selectedEvent=Boolean(data.merchantId&&data.merchantId===state.selectedId);loadMerchants({keepSelection:true,refreshSelectedDetail:selectedEvent}).catch(()=>{});});state.eventSource.onerror=()=>{};}
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
    if(!state.pollTimer)state.pollTimer=setInterval(()=>{if(!document.hidden&&canRefreshListInBackground())loadMerchants({keepSelection:true}).catch(()=>{});},30000);
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
  $('#controlLogout').addEventListener('click',async()=>{try{if(state.role==='admin')await api('/api/auth/logout',{method:'POST',body:'{}'});else await api('/api/manager/auth/logout',{method:'POST',body:'{}'});}catch(_){}clearControlSession();});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&state.role&&canRefreshListInBackground())loadMerchants({keepSelection:true}).catch(()=>{});});
  boot();
})();
