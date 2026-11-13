(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(location.search); const token = params.get('token') || ''; const reference = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const steps = [['pending', 'Reçue par la boutique'], ['confirmed', 'Confirmée par le marchand'], ['preparing', 'En préparation'], ['ready', 'Prête pour la remise'], ['completed', 'Terminée']];
  const labels = Object.fromEntries(steps); labels.cancelled = 'Annulée';
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let timer = 0; let lastStatus = '';
  function showError(message) { clearInterval(timer); $('#trackingLoading').hidden = true; $('#trackingContent').hidden = true; $('#trackingError').hidden = false; $('#trackingErrorText').textContent = message; }
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
  function render(order) {
    $('#trackingLoading').hidden = true; $('#trackingError').hidden = true; $('#trackingContent').hidden = false;
    $('#trackingReference').textContent = order.reference; const label = labels[order.status] || order.status;
    $('#trackingStatus').textContent = `Statut actuel : ${label}`;
    const index = steps.findIndex(([key]) => key === order.status);
    const eventByStatus = new Map((order.events || []).map((event) => [event.status, event]));
    $('#trackingSteps').innerHTML = order.status === 'cancelled'
      ? `<li class="done">${esc(labels.pending)}<time>${esc(formatDate(eventByStatus.get('pending')?.createdAt || order.createdAt))}</time></li><li class="cancelled done">Commande annulée<time>${esc(formatDate(eventByStatus.get('cancelled')?.createdAt || order.updatedAt))}</time></li>`
      : steps.map(([key, text], stepIndex) => { const event = eventByStatus.get(key); const completed = stepIndex <= index; return `<li class="${completed ? 'done' : ''}"><span>${esc(text)}</span><time>${event ? esc(formatDate(event.createdAt)) : ''}</time></li>`; }).join('');
    $('#trackingCustomer').textContent = `Client : ${order.customerName}${order.customerPhone ? ` · ${order.customerPhone}` : ''}`;
    $('#trackingDelivery').textContent = `Remise : ${order.deliveryAddress}`;
    $('#trackingItems').innerHTML = (order.items || []).map((item) => `<li><span>${esc(item.name)} × ${Number(item.quantity)}</span><strong>${money(Number(item.unitPriceXof) * Number(item.quantity))}</strong></li>`).join('');
    $('#trackingTotal').textContent = money(order.totalAmountXof); $('#trackingUpdated').textContent = `Dernière mise à jour : ${formatDate(order.updatedAt)}`;
    if (lastStatus && lastStatus !== order.status) { $('#trackingStatus').textContent = `Mise à jour : ${label}`; }
    lastStatus = order.status;
  }
  async function refresh() {
    if (!token) return showError('Le lien de suivi sécurisé est incomplet. Ouvrez le lien reçu après la commande.');
    try {
      const response = await fetch(`/api/public/shops/orders/${encodeURIComponent(reference)}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data) return showError(result.error || 'Commande introuvable ou lien de suivi invalide.');
      render(result.data);
      if (['completed', 'cancelled'].includes(result.data.status)) clearInterval(timer);
    } catch (_) { if (!$('#trackingContent').hidden) $('#trackingStatus').textContent = 'Connexion interrompue; nouvelle tentative automatique…'; }
  }
  refresh(); timer = setInterval(refresh, 10_000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
