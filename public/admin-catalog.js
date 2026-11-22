'use strict';

// ============================================================================================
// Écran « Catalogue général » de l'Administrateur général.
//
// - Domaines : création, changement de famille, réorganisation (↑ ↓), désactivation.
// - Catégories : rattachement multi-domaines (source de l'absence de doublon).
// - Produits modèles : aucun prix, image de la bibliothèque, contenance et unité distinctes.
// - Images : bibliothèque réutilisable, image neutre de remplacement si absente.
// - Utilisation marchande : modèle ≠ produit utilisé ; prix saisis par les marchands.
// ============================================================================================
(() => {
  const state = {
    overview: null, domains: [], categories: [], products: [], media: [],
    units: [], volumes: [], editingProduct: '', editingDomain: '', editingCategory: '', tab: 'domains', loaded: false,
  };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  let notify = (message) => { try { console.warn(message); } catch (_) {} };

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Erreur inattendue.');
    return payload;
  }

  // ------------------------------------------------------------------ chargement
  async function loadAll() {
    const [overview, domains, categories, media] = await Promise.all([
      api('/api/admin/catalog/overview'), api('/api/admin/catalog/domains'),
      api('/api/admin/catalog/categories'), api('/api/admin/catalog/media'),
    ]);
    state.overview = overview.data; state.domains = domains.data || []; state.categories = categories.data || []; state.media = media.data || [];
    if (!state.units.length) {
      // Les unités autorisées viennent du catalogue lui-même : une seule source de vérité.
      const merchantMeta = await fetch('/api/admin/catalog/meta', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      state.units = merchantMeta?.data?.units || [];
      state.volumes = merchantMeta?.data?.volumes || [];
    }
    await loadProducts();
    state.loaded = true;
    renderOverview(); renderDomains(); renderCategories(); renderMedia(); renderUsage(); fillSelectors();
  }

  async function loadProducts() {
    const search = $('#catalogProductSearch')?.value.trim() || '';
    const kind = $('#catalogProductKind')?.value || '';
    const query = new URLSearchParams(); if (search) query.set('search', search); if (kind) query.set('kind', kind); query.set('limit', '500');
    const result = await api(`/api/admin/catalog/products?${query}`);
    state.products = result.data || [];
    renderProducts();
  }

  function renderOverview() {
    const node = $('#catalogOverview'); if (!node || !state.overview) return;
    const counts = state.overview.counts || {};
    const cards = [
      ['Domaines', counts.domains, 'dont les domaines personnalisés'],
      ['Catégories', counts.categories, 'rattachées aux domaines'],
      ['Produits modèles', counts.products, `${counts.boissons || 0} boissons · ${(counts.products || 0) - (counts.boissons || 0)} autres`],
      ['Images', counts.media, `${state.overview.productsWithoutImage || 0} produit(s) sans image`],
      ['Doublons', (state.overview.duplicates || []).length, 'références identiques détectées'],
    ];
    node.innerHTML = cards.map(([label, value, hint]) => `<article class="stat"><span>${esc(label)}</span><strong>${esc(value ?? '—')}</strong><small>${esc(hint)}</small></article>`).join('');
  }

  function familyOrder() { return ['Restauration et boissons', 'Commerce et distribution', 'Services et autres']; }

  function renderDomains() {
    const node = $('#catalogDomainRows'); if (!node) return;
    if (!state.domains.length) { node.innerHTML = '<tr><td colspan="6">Aucun domaine.</td></tr>'; return; }
    const counts = new Map();
    state.categories.forEach((cat) => (cat.domainIds || []).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
    node.innerHTML = state.domains.map((domain, index) => `
      <tr>
        <td><span class="catalog-order">
          <button class="icon-button" type="button" data-domain-up="${esc(domain.id)}" ${index === 0 ? 'disabled' : ''} aria-label="Monter">↑</button>
          <button class="icon-button" type="button" data-domain-down="${esc(domain.id)}" ${index === state.domains.length - 1 ? 'disabled' : ''} aria-label="Descendre">↓</button>
          ${index + 1}
        </span></td>
        <td><strong>${esc(domain.label)}</strong><br><code>${esc(domain.code)}</code></td>
        <td>${esc(domain.family)}</td>
        <td>${counts.get(domain.id) || 0}</td>
        <td><span class="pill ${domain.isActive ? 'pill-ok' : 'pill-off'}">${domain.isActive ? 'Actif' : 'Désactivé'}</span></td>
        <td class="catalog-actions">
          <button class="button button-secondary button-small" type="button" data-domain-edit="${esc(domain.id)}">Modifier</button>
          <button class="button button-quiet button-small" type="button" data-domain-toggle="${esc(domain.id)}">${domain.isActive ? 'Désactiver' : 'Réactiver'}</button>
        </td>
      </tr>`).join('');
    $$('[data-domain-up]').forEach((button) => button.addEventListener('click', () => moveDomain(button.dataset.domainUp, -1)));
    $$('[data-domain-down]').forEach((button) => button.addEventListener('click', () => moveDomain(button.dataset.domainDown, 1)));
    $$('[data-domain-edit]').forEach((button) => button.addEventListener('click', () => editDomain(button.dataset.domainEdit)));
    $$('[data-domain-toggle]').forEach((button) => button.addEventListener('click', () => toggleDomain(button.dataset.domainToggle)));
  }

  async function moveDomain(id, delta) {
    const index = state.domains.findIndex((d) => d.id === id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= state.domains.length) return;
    const ids = state.domains.map((d) => d.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    try {
      const result = await api('/api/admin/catalog/domains/reorder', { method: 'POST', body: JSON.stringify({ ids }) });
      state.domains = result.data; renderDomains(); notify('Ordre des domaines enregistré.');
    } catch (error) { notify(error.message); }
  }

  function editDomain(id) {
    const domain = state.domains.find((d) => d.id === id); if (!domain) return;
    state.editingDomain = id;
    $('#domainCode').value = domain.code; $('#domainCode').disabled = true;
    $('#domainLabel').value = domain.label; $('#domainFamily').value = domain.family;
    $('#catalogDomainForm').hidden = false; $('#domainLabel').focus();
  }

  async function saveDomain() {
    const label = $('#domainLabel').value.trim(); const family = $('#domainFamily').value;
    if (label.length < 2) return notify('Indiquez un libellé de domaine.');
    try {
      if (state.editingDomain) {
        await api(`/api/admin/catalog/domains/${encodeURIComponent(state.editingDomain)}`, { method: 'PUT', body: JSON.stringify({ label, family }) });
        notify('Domaine modifié.');
      } else {
        const code = $('#domainCode').value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
        if (!code) return notify('Indiquez un code de domaine.');
        await api('/api/admin/catalog/domains', { method: 'POST', body: JSON.stringify({ code, label, family, custom: true }) });
        notify('Domaine ajouté.');
      }
      closeDomainForm(); await loadAll();
    } catch (error) { notify(error.message); }
  }

  function closeDomainForm() { state.editingDomain = ''; $('#catalogDomainForm').hidden = true; $('#domainCode').disabled = false; $('#domainCode').value = ''; $('#domainLabel').value = ''; }

  async function toggleDomain(id) {
    const domain = state.domains.find((d) => d.id === id); if (!domain) return;
    const next = !domain.isActive;
    if (!next && !window.confirm(`Désactiver « ${domain.label} » ? Il disparaîtra de la liste d’inscription. Les catégories, produits et fiches marchands existants sont conservés.`)) return;
    try {
      await api(`/api/admin/catalog/domains/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ isActive: next }) });
      await loadAll(); notify(next ? 'Domaine réactivé.' : 'Domaine désactivé, rien n’a été supprimé.');
    } catch (error) { notify(error.message); }
  }

  // ------------------------------------------------------------------ catégories
  function renderCategories() {
    const node = $('#catalogCategoryRows'); if (!node) return;
    const domainName = (id) => state.domains.find((d) => d.id === id)?.label || '—';
    const productCount = new Map();
    state.products.forEach((product) => productCount.set(product.categorySlug, (productCount.get(product.categorySlug) || 0) + 1));
    node.innerHTML = state.categories.map((category) => `
      <tr>
        <td><strong>${esc(category.label)}</strong></td>
        <td><code>${esc(category.slug)}</code></td>
        <td>${esc((category.domainIds || []).map(domainName).join(', ') || '—')}</td>
        <td>${productCount.get(category.slug) || 0}</td>
        <td><span class="pill ${category.isActive ? 'pill-ok' : 'pill-off'}">${category.isActive ? 'Active' : 'Désactivée'}</span></td>
        <td class="catalog-actions">
          <button class="button button-secondary button-small" type="button" data-category-edit="${esc(category.id)}">Modifier</button>
          <button class="button button-quiet button-small" type="button" data-category-toggle="${esc(category.id)}">${category.isActive ? 'Désactiver' : 'Réactiver'}</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6">Aucune catégorie.</td></tr>';
    $$('[data-category-edit]').forEach((button) => button.addEventListener('click', () => editCategory(button.dataset.categoryEdit)));
    $$('[data-category-toggle]').forEach((button) => button.addEventListener('click', () => toggleCategory(button.dataset.categoryToggle)));
  }

  function editCategory(id) {
    const category = state.categories.find((c) => c.id === id); if (!category) return;
    state.editingCategory = id;
    $('#categorySlug').value = category.slug; $('#categorySlug').disabled = true;
    $('#categoryLabel').value = category.label;
    fillDomainChecklist('#categoryDomains', category.domainIds || []);
    $('#catalogCategoryForm').hidden = false; $('#categoryLabel').focus();
  }

  function fillDomainChecklist(selector, selectedIds) {
    const node = $(selector); if (!node) return;
    node.innerHTML = familyOrder().map((family) => {
      const items = state.domains.filter((d) => d.family === family);
      if (!items.length) return '';
      return `<optgroup label="${esc(family)}">${items.map((d) => `<option value="${esc(d.id)}"${selectedIds.includes(d.id) ? ' selected' : ''}>${esc(d.label)}</option>`).join('')}</optgroup>`;
    }).join('');
  }

  async function saveCategory() {
    const label = $('#categoryLabel').value.trim();
    const domainIds = [...$('#categoryDomains').selectedOptions].map((o) => o.value);
    if (label.length < 2) return notify('Indiquez un libellé de catégorie.');
    try {
      if (state.editingCategory) {
        await api(`/api/admin/catalog/categories/${encodeURIComponent(state.editingCategory)}`, { method: 'PUT', body: JSON.stringify({ label, domainIds }) });
        notify('Catégorie modifiée.');
      } else {
        const slug = $('#categorySlug').value.trim().toLowerCase();
        if (!slug) return notify('Indiquez un code de catégorie.');
        await api('/api/admin/catalog/categories', { method: 'POST', body: JSON.stringify({ slug, label, domainIds }) });
        notify('Catégorie ajoutée.');
      }
      closeCategoryForm(); await loadAll();
    } catch (error) { notify(error.message); }
  }

  function closeCategoryForm() { state.editingCategory = ''; $('#catalogCategoryForm').hidden = true; $('#categorySlug').disabled = false; $('#categorySlug').value = ''; $('#categoryLabel').value = ''; }

  async function toggleCategory(id) {
    const category = state.categories.find((c) => c.id === id); if (!category) return;
    try {
      await api(`/api/admin/catalog/categories/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ isActive: !category.isActive }) });
      await loadAll(); notify(category.isActive ? 'Catégorie désactivée (aucune suppression).' : 'Catégorie réactivée.');
    } catch (error) { notify(error.message); }
  }

  // ------------------------------------------------------------------ produits modèles
  function renderProducts() {
    const node = $('#catalogProductRows'); if (!node) return;
    const categoryLabel = (slug) => state.categories.find((c) => c.slug === slug)?.label || slug || '—';
    const rows = state.products.map((product) => `
      <tr>
        <td><strong>${esc(product.name)}</strong><br><code>${esc(product.catalogKey || '')}</code></td>
        <td>${esc(product.brand || '—')}${product.variant ? ` · ${esc(product.variant)}` : ''}</td>
        <td>${esc(categoryLabel(product.categorySlug))}</td>
        <td>${esc(product.volumeLabel || '—')}</td>
        <td>${esc(product.unit || '—')}</td>
        <td>${product.imageUrl ? `<img class="catalog-admin-thumb" src="${esc(product.imageUrl)}" alt="" loading="lazy" width="36" height="36">` : '<span class="pill pill-off">neutre</span>'}</td>
        <td>${product.usageCount ? `<strong>${product.usageCount}</strong>` : '0'}</td>
        <td><span class="pill ${product.isActive ? 'pill-ok' : 'pill-off'}">${product.isActive ? 'Actif' : 'Retiré'}</span></td>
        <td class="catalog-actions">
          <button class="button button-secondary button-small" type="button" data-product-edit="${esc(product.id)}">Modifier</button>
          <button class="button button-quiet button-small" type="button" data-product-toggle="${esc(product.id)}">${product.isActive ? 'Retirer' : 'Réactiver'}</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="9">Aucun produit.</td></tr>';
    node.innerHTML = rows;
    $('#catalogProductCount').textContent = `${state.products.length} modèle(s) affiché(s). Aucun prix n’est stocké dans le catalogue.`;
    $$('[data-product-edit]').forEach((button) => button.addEventListener('click', () => editProduct(button.dataset.productEdit)));
    $$('[data-product-toggle]').forEach((button) => button.addEventListener('click', () => toggleProduct(button.dataset.productToggle)));
  }

  function fillSelectors() {
    const categorySelect = $('#catalogProductCategory');
    if (categorySelect) {
      categorySelect.innerHTML = state.categories.map((c) => `<option value="${esc(c.slug)}">${esc(c.label)}</option>`).join('');
    }
    const unitSelect = $('#catalogProductUnit');
    if (unitSelect && state.units.length) {
      unitSelect.innerHTML = state.units.map((unit) => `<option value="${esc(unit.code)}">${esc(unit.label)}</option>`).join('');
    }
    const mediaSelect = $('#catalogProductMedia');
    if (mediaSelect) {
      mediaSelect.innerHTML = '<option value="">Image neutre de remplacement</option>' + state.media.map((m) => `<option value="${esc(m.key)}">${esc(m.name || m.key)}</option>`).join('');
    }
    const volumeList = $('#catalogVolumeOptions');
    if (volumeList) volumeList.innerHTML = (state.volumes || []).map((v) => `<option value="${esc(v.label)}"></option>`).join('');
    const mediaUrl = $('#mediaUrl');
    if (mediaUrl) mediaUrl.innerHTML = state.media.map((m) => `<option value="${esc(m.url)}">${esc(m.url)}</option>`).join('') || '<option value="">Déposez d’abord un fichier dans /media/catalogue</option>';
  }

  function editProduct(id) {
    const product = state.products.find((p) => p.id === id); if (!product) return;
    state.editingProduct = id;
    $('#catalogProductName').value = product.name; $('#catalogProductBrand').value = product.brand || '';
    $('#catalogProductVariant').value = product.variant || '';
    fillSelectors();
    $('#catalogProductCategory').value = product.categorySlug || '';
    $('#catalogProductVolume').value = product.volumeLabel || '';
    $('#catalogProductUnit').value = product.unit || 'piece';
    $('#catalogProductMedia').value = product.imageKey || '';
    fillDomainChecklist('#catalogProductDomains', product.domainIds || []);
    $('#catalogProductForm').hidden = false; $('#catalogProductName').focus();
  }

  async function saveProduct() {
    const name = $('#catalogProductName').value.trim();
    if (name.length < 2) return notify('Indiquez le nom du produit.');
    const body = {
      name, brand: $('#catalogProductBrand').value.trim(), variant: $('#catalogProductVariant').value.trim(),
      categorySlug: $('#catalogProductCategory').value, volumeLabel: $('#catalogProductVolume').value.trim(),
      unit: $('#catalogProductUnit').value, imageKey: $('#catalogProductMedia').value,
      domainIds: [...$('#catalogProductDomains').selectedOptions].map((o) => o.value),
    };
    try {
      if (state.editingProduct) await api(`/api/admin/catalog/products/${encodeURIComponent(state.editingProduct)}`, { method: 'PUT', body: JSON.stringify(body) });
      else await api('/api/admin/catalog/products', { method: 'POST', body: JSON.stringify(body) });
      closeProductForm(); await loadAll(); notify('Modèle enregistré. Les fiches marchands existantes ne sont pas modifiées.');
    } catch (error) { notify(error.message); }
  }

  function closeProductForm() { state.editingProduct = ''; $('#catalogProductForm').hidden = true; }

  async function toggleProduct(id) {
    const product = state.products.find((p) => p.id === id); if (!product) return;
    if (product.isActive && !window.confirm(`Retirer « ${product.name} » du catalogue ? Il ne sera plus proposé aux marchands ; les fiches déjà créées restent intactes.`)) return;
    try {
      await api(`/api/admin/catalog/products/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ isActive: !product.isActive }) });
      await loadAll(); notify(product.isActive ? 'Modèle retiré du catalogue.' : 'Modèle réactivé.');
    } catch (error) { notify(error.message); }
  }

  // ------------------------------------------------------------------ images
  function renderMedia() {
    const node = $('#catalogMediaGrid'); if (!node) return;
    if (!state.media.length) { node.innerHTML = '<p class="manager-empty">Aucune image référencée.</p>'; return; }
    node.innerHTML = state.media.map((media) => `
      <figure class="catalog-media-item">
        <img src="${esc(media.url)}" alt="${esc(media.name || media.key)}" loading="lazy" width="120" height="120">
        <figcaption><strong>${esc(media.name || media.key)}</strong><span>${esc(media.category || '')}</span><code>${esc(media.key)}</code></figcaption>
      </figure>`).join('');
  }

  async function saveMedia() {
    const key = $('#mediaKey').value.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    const url = $('#mediaUrl').value;
    if (!key) return notify('Indiquez la clé de l’image.');
    try {
      await api('/api/admin/catalog/media', { method: 'POST', body: JSON.stringify({ key, url, name: $('#mediaName').value.trim() || key, category: $('#mediaCategory').value.trim() }) });
      $('#catalogMediaForm').hidden = true; await loadAll(); notify('Image référencée.');
    } catch (error) { notify(error.message); }
  }

  // ------------------------------------------------------------------ utilisation
  function renderUsage() {
    const node = $('#catalogUsageRows'); if (!node) return;
    const used = state.products.filter((p) => p.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount);
    node.innerHTML = used.map((product) => `
      <tr><td><strong>${esc(product.name)}</strong><br><code>${esc(product.catalogKey || '')}</code></td>
      <td>${(product.usedBy || []).map((row) => esc(row.storeName || row.merchantName || '—')).join('<br>') || '—'}</td>
      <td>${(product.usedBy || []).map((row) => esc(row.name || '—')).join('<br>') || '—'}</td>
      <td>${(product.usedBy || []).map((row) => money(row.priceXof)).join('<br>') || '—'}</td>
      <td>${(product.usedBy || []).map((row) => esc([row.unit, row.volumeLabel].filter(Boolean).join(' / ') || '—')).join('<br>') || '—'}</td>
      <td>${(product.usedBy || []).map((row) => esc(row.status || '—')).join('<br>') || '—'}</td></tr>`).join('')
      || '<tr><td colspan="6">Aucune fiche marchand ne reprend encore un modèle.</td></tr>';
    const top = $('#catalogTopModels');
    if (top) top.innerHTML = used.slice(0, 8).map((p) => `<span class="chip">${esc(p.name)} · ${p.usageCount}</span>`).join('') || '<p class="muted">Aucune utilisation enregistrée.</p>';
  }

  // ------------------------------------------------------------------ onglets & câblage
  function setTab(name) {
    state.tab = name;
    $$('[data-catalog-tab]').forEach((button) => button.classList.toggle('is-active', button.dataset.catalogTab === name));
    $$('[data-catalog-panel]').forEach((panel) => { panel.hidden = panel.dataset.catalogPanel !== name; });
  }

  function wire() {
    $('#catalogRefresh')?.addEventListener('click', () => loadAll().catch((e) => notify(e.message)));
    $$('[data-catalog-tab]').forEach((button) => button.addEventListener('click', () => setTab(button.dataset.catalogTab)));
    $('#catalogAddDomain')?.addEventListener('click', () => { state.editingDomain = ''; $('#catalogDomainForm').hidden = false; $('#domainCode').disabled = false; $('#domainCode').value = ''; $('#domainLabel').value = ''; $('#domainLabel').focus(); });
    $('#catalogCancelDomain')?.addEventListener('click', closeDomainForm);
    $('#catalogSaveDomain')?.addEventListener('click', () => saveDomain().catch((e) => notify(e.message)));
    $('#catalogAddCategory')?.addEventListener('click', () => { state.editingCategory = ''; $('#catalogCategoryForm').hidden = false; $('#categorySlug').disabled = false; $('#categorySlug').value = ''; $('#categoryLabel').value = ''; fillDomainChecklist('#categoryDomains', []); $('#categoryLabel').focus(); });
    $('#catalogCancelCategory')?.addEventListener('click', closeCategoryForm);
    $('#catalogSaveCategory')?.addEventListener('click', () => saveCategory().catch((e) => notify(e.message)));
    $('#catalogAddProduct')?.addEventListener('click', () => { state.editingProduct = ''; fillSelectors(); fillDomainChecklist('#catalogProductDomains', []); $('#catalogProductForm').hidden = false; $('#catalogProductName').value = ''; $('#catalogProductBrand').value = ''; $('#catalogProductVariant').value = ''; $('#catalogProductVolume').value = ''; $('#catalogProductName').focus(); });
    $('#catalogCancelProduct')?.addEventListener('click', closeProductForm);
    $('#catalogSaveProduct')?.addEventListener('click', () => saveProduct().catch((e) => notify(e.message)));
    $('#catalogAddMedia')?.addEventListener('click', () => { $('#catalogMediaForm').hidden = false; $('#mediaKey').focus(); });
    $('#catalogCancelMedia')?.addEventListener('click', () => { $('#catalogMediaForm').hidden = true; });
    $('#catalogSaveMedia')?.addEventListener('click', () => saveMedia().catch((e) => notify(e.message)));
    let timer = 0;
    $('#catalogProductSearch')?.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => loadProducts().catch((e) => notify(e.message)), 300); });
    $('#catalogProductKind')?.addEventListener('change', () => loadProducts().catch((e) => notify(e.message)));
  }

  wire();

  window.QRIAAdminCatalog = {
    mount({ notify: notifier } = {}) {
      if (typeof notifier === 'function') notify = notifier;
      if (state.loaded) { renderOverview(); renderDomains(); renderCategories(); renderProducts(); renderMedia(); renderUsage(); return Promise.resolve(); }
      return loadAll();
    },
  };
})();
