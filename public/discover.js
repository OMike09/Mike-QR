(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const labels = { general: 'Commerce', restaurant: 'Restaurant', maquis: 'Maquis', hardware: 'Quincaillerie', clothing: 'Vêtements', outdoor: 'Espace plein air' };
  let timer = 0; let activeRequest = 0;
  function render(data) {
    const stores = $('#storeResults'); const products = $('#productResults');
    stores.innerHTML = data.stores?.length ? data.stores.map((store) => `<article class="result-card"><div class="result-cover">${store.coverImageUrl ? `<img src="${esc(store.coverImageUrl)}" alt="">` : (store.logo ? `<img src="${esc(store.logo)}" alt="">` : 'OYMIKE TECH')}</div><div class="result-copy"><small>${esc(labels[store.sector] || labels.general)} · ${Number(store.productCount) || 0} produit(s)</small><h2>${esc(store.name)}</h2><p>${esc(store.description || store.address || 'Boutique en ligne publiée')}</p><div class="result-meta">${store.address ? `<span>${esc(store.address)}</span>` : ''}</div><a class="button primary" href="/shop/${encodeURIComponent(store.slug)}">Voir la boutique</a></div></article>`).join('') : '<p class="empty">Aucune boutique trouvée pour cette recherche.</p>';
    products.innerHTML = data.products?.length ? data.products.map((product) => `<article class="result-card product-card"><div class="product-photo">${product.imageData || product.imageUrls?.[0] ? `<img src="${esc(product.imageData || product.imageUrls[0])}" alt="">` : ''}</div><div class="result-copy"><small>${esc(product.storeName)} · ${esc(labels[product.sector] || labels.general)}</small><h3>${esc(product.name)}</h3><p>${esc(product.description || product.category || '')}</p><span class="price">${money(product.priceXof)}</span><a class="button primary" href="/shop/${encodeURIComponent(product.storeSlug)}">Ouvrir le catalogue</a></div></article>`).join('') : '<p class="empty">Aucun produit correspondant dans les boutiques publiées.</p>';
  }
  async function search(value) {
    const query = value.trim(); const status = $('#searchStatus'); const requestId = ++activeRequest;
    if (query.length < 2) { status.textContent = 'Saisissez au moins deux caractères pour commencer.'; $('#storeResults').replaceChildren(); $('#productResults').replaceChildren(); return; }
    status.textContent = 'Recherche dans les catalogues publiés…';
    try {
      const response = await fetch(`/api/public/search?q=${encodeURIComponent(query)}`, { cache: 'no-store' }); const result = await response.json().catch(() => ({}));
      if (requestId !== activeRequest) return;
      if (!response.ok) throw new Error(result.error || `Erreur ${response.status}`);
      render(result.data || {}); status.textContent = `${Number(result.data?.totalStores) || 0} boutique(s) et ${Number(result.data?.totalProducts) || 0} produit(s) trouvé(s) pour « ${query} ».`;
    } catch (error) { if (requestId !== activeRequest) return; status.textContent = `${error.message || 'La recherche a échoué.'} Modifiez la recherche ou réessayez.`; }
  }
  $('#searchForm').addEventListener('submit', (event) => { event.preventDefault(); clearTimeout(timer); search($('#searchQuery').value); });
  $('#searchQuery').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search($('#searchQuery').value), 240); });
  document.querySelectorAll('[data-query]').forEach((button) => button.addEventListener('click', () => { $('#searchQuery').value = button.dataset.query; search(button.dataset.query); }));
  const initial = new URLSearchParams(location.search).get('q'); if (initial) { $('#searchQuery').value = initial; search(initial); }
})();
