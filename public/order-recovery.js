(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(location.search);
  const labels = { pending: 'À confirmer par la boutique', confirmed: 'Confirmée', preparing: 'En préparation', ready: 'Prête pour la remise', out_for_delivery: 'En livraison', completed: 'Terminée / livrée', cancelled: 'Annulée', rejected: 'Refusée par la boutique' };
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const date = (value) => { const d = new Date(value); return Number.isNaN(d.getTime()) ? 'Date non disponible' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(d); };
  const normalizeSlug = (value) => String(value || '').trim().replace(/^https?:\/\/[^/]+/i, '').replace(/^\/?shop\//i, '').replace(/^\/+|\/+$/g, '').split(/[?#]/)[0].slice(0, 70);
  const storeField = $('#recoveryStore');
  storeField.value = normalizeSlug(params.get('store') || params.get('slug') || '');
  function showError(text) { const node = $('#recoveryError'); node.textContent = text; node.hidden = false; }
  function renderOrders(orders) {
    const root = $('#recoveryResults');
    root.innerHTML = `<h2>Commandes actives de cette boutique (${orders.length})</h2>${orders.map((order) => {
      const store = order.store || {}; const status = labels[order.status] || `Statut enregistré : ${order.status}`;
      const subtotal = Number(order.totalAmountXof) || 0; const delivery = Number(order.deliveryFeeXof) || 0; const discount = Number(order.discountAmountXof) || 0;
      const total = Math.max(0, subtotal + delivery - discount);
      const contacts = [store.phoneContactUrl ? `<a class="button outline" href="${esc(store.phoneContactUrl)}">Appeler</a>` : '',
        store.whatsappContactUrl ? `<a class="button outline" href="${esc(store.whatsappContactUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>` : ''].filter(Boolean).join('');
      const items = (order.items || []).map((item) => `<li><span>${esc(item.name)} × ${Number(item.quantity) || 0}</span><strong>${money((Number(item.unitPriceXof)||0)*(Number(item.quantity)||0))}</strong></li>`).join('');
      const events = (order.events || []).map((event) => `<li><span>${esc(labels[event.status] || event.status)}${event.note ? ` · ${esc(event.note)}` : ''}</span><time>${esc(date(event.createdAt))}</time></li>`).join('');
      return `<article class="tracking-card recovery-order"><header class="recovery-order-head"><div><span class="eyebrow">${esc(store.name || 'Boutique')}</span><h3>${esc(order.reference)}</h3><p class="muted">Commandée le ${esc(date(order.createdAt))}</p></div><strong class="tracking-current">${esc(status)}</strong></header>
        <p><strong>Remise ou emplacement :</strong> ${esc(order.servicePointName || order.deliveryAddress || 'Non renseigné')}</p>
        <p><strong>Adresse / consigne :</strong> ${esc(order.deliveryAddress || 'Non renseignée')}</p>
        <ul class="tracking-items">${items || '<li>Articles non disponibles.</li>'}</ul>
        <div class="tracking-totals"><div><span>Sous-total articles</span><strong>${money(subtotal)}</strong></div><div><span>Livraison enregistrée</span><strong>${delivery ? money(delivery) : 'À confirmer / non enregistrée'}</strong></div><div><span>Remise enregistrée</span><strong>${discount ? `− ${money(discount)}` : 'Aucune remise enregistrée'}</strong></div><div class="tracking-total"><span>Total estimé · XOF</span><strong>${money(total)}</strong></div></div>
        ${events ? `<details class="recovery-events"><summary>Événements de statut enregistrés</summary><ol>${events}</ol></details>` : ''}
        ${contacts ? `<div class="recovery-contact"><strong>Coordonnées enregistrées de la boutique</strong><div>${contacts}</div></div>` : '<p class="muted">Aucune coordonnée téléphonique/WhatsApp n’est enregistrée pour cette boutique.</p>'}
        <a class="button primary" href="/order/${encodeURIComponent(order.reference)}?token=${encodeURIComponent(order.trackingCode)}">Ouvrir le suivi sécurisé</a>
      </article>`;
    }).join('')}`;
    root.hidden = false;
  }
  $('#recoveryForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#recoveryError'); error.hidden = true; $('#recoveryResults').hidden = true;
    const store = normalizeSlug(storeField.value); const reference = $('#recoveryReference').value.trim().toUpperCase();
    const token = $('#recoveryToken').value.trim(); const phone = $('#recoveryPhone').value.trim(); const button = $('#recoverButton');
    if (!store || !reference || token.length < 32 || phone.replace(/\D/g,'').length < 7) return showError('Saisissez la boutique, la référence, le lien/code secret et le téléphone utilisés.');
    storeField.value = store; button.disabled = true; button.textContent = 'Vérification sécurisée…';
    try {
      const response = await fetch(`/api/public/shops/${encodeURIComponent(store)}/orders/recover`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reference, token, phone }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !Array.isArray(result.data)) throw new Error(result.error || 'Impossible de retrouver les commandes.');
      if (!result.data.length) throw new Error('Aucune commande active trouvée avec ces informations.');
      renderOrders(result.data);
    } catch (failure) { showError(failure.message || 'Impossible de retrouver les commandes.'); }
    finally { button.disabled = false; button.textContent = 'Vérifier et retrouver mes commandes actives'; }
  });
})();
