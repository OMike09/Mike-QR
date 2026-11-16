(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const params = new URLSearchParams(location.search); const token = params.get('token') || ''; const reference = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
  const steps = [['pending', 'Reçue par la boutique'], ['confirmed', 'Confirmée par le marchand'], ['preparing', 'En préparation'], ['ready', 'Prête pour la remise'], ['completed', 'Terminée']];
  const labels = Object.fromEntries(steps); labels.cancelled = 'Annulée';
  const money = (value) => `${new Intl.NumberFormat('fr-FR').format(Number(value) || 0)} XOF`;
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let timer = 0; let lastStatus = ''; let lastCancellationStatus = ''; let currentOrder = null;
  function showError(message) {
    clearInterval(timer); $('#trackingLoading').hidden = true; $('#trackingContent').hidden = true; $('#trackingError').hidden = false;
    if (lastCancellationStatus === 'pending' && /introuvable|invalide/i.test(message)) message = 'Le suivi actif n’est plus disponible. Une demande d’annulation était en cours; cette page n’a pas reçu la décision. Contactez directement la boutique avec la référence.';
    $('#trackingErrorText').textContent = message;
  }
  function showCancellationOutcome(data) {
    clearInterval(timer); $('#trackingLoading').hidden = true; $('#trackingContent').hidden = true; $('#trackingError').hidden = false;
    const heading = $('#trackingError').querySelector('h1'); const status = data?.request?.status;
    heading.textContent = status === 'accepted' ? 'Annulation prise en compte' : status === 'rejected' ? 'Demande refusée par la boutique' : 'Demande en cours';
    const note = data?.request?.decisionNote ? ` Motif de décision : ${data.request.decisionNote}` : '';
    $('#trackingErrorText').textContent = status === 'accepted'
      ? 'La commande n’est plus accessible dans le suivi public.'
      : status === 'rejected' ? `La commande n’est plus dans le suivi actif.${note} Contactez la boutique pour toute précision.`
        : 'La commande n’est plus dans le suivi actif; la boutique n’a pas encore enregistré de décision. Contactez-la directement.';
  }
  function formatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }).format(date); }
  function renderCancellation(order) {
    const panel = $('#trackingCancellation'); const form = $('#trackingCancellationForm'); const state = $('#trackingCancellationState');
    const requests = Array.isArray(order.cancellationRequests) ? order.cancellationRequests : [];
    const latest = requests[requests.length - 1];
    const active = !['completed', 'cancelled'].includes(order.status);
    panel.hidden = false; form.hidden = true; $('#trackingCancellationError').hidden = true;
    lastCancellationStatus = latest?.status || '';
    if (latest?.status === 'pending') {
      state.textContent = 'Votre demande a été transmise à la boutique. Elle doit être acceptée ou refusée par le marchand. Oymike Tech n’envoie pas de SMS.';
      return;
    }
    if (latest?.status === 'accepted') {
      state.textContent = order.status === 'cancelled' ? 'Annulation prise en compte. Cette commande n’est plus active dans le suivi public.' : 'La demande d’annulation a été acceptée.';
      return;
    }
    if (latest?.status === 'rejected') {
      state.textContent = `La boutique a refusé la demande${latest.decisionNote ? ` : ${latest.decisionNote}` : '.'}`;
    } else {
      state.textContent = order.status === 'pending' ? 'Avant confirmation par la boutique, votre demande est prise en compte automatiquement.' : 'Vous pouvez envoyer une demande; après confirmation, le marchand devra la traiter.';
    }
    if (active) { form.hidden = false; $('#trackingCancellationButton').textContent = latest?.status === 'rejected' ? 'Envoyer une nouvelle demande' : 'Demander l’annulation'; }
  }
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
    const servicePoint=$('#trackingServicePoint');servicePoint.hidden=!order.servicePointName;servicePoint.textContent=order.servicePointName?`Emplacement : ${order.servicePointName}`:'';
    $('#trackingItems').innerHTML = (order.items || []).map((item) => `<li><span>${esc(item.name)} × ${Number(item.quantity)}</span><strong>${money(Number(item.unitPriceXof) * Number(item.quantity))}</strong></li>`).join('');
    const subtotal=Number(order.totalAmountXof)||0;const delivery=Number(order.deliveryFeeXof)||0;const discount=Number(order.discountAmountXof)||0;
    $('#trackingSubtotal').textContent=money(subtotal);$('#trackingDeliveryFee').textContent=delivery?money(delivery):'À confirmer';
    $('#trackingDiscount').textContent=discount?`− ${money(discount)}`:'Aucune remise enregistrée';$('#trackingTotal').textContent=money(Math.max(0,subtotal+delivery-discount));
    $('#trackingUpdated').textContent = `Dernière mise à jour : ${formatDate(order.updatedAt)}`;
    if (lastStatus && lastStatus !== order.status) { $('#trackingStatus').textContent = `Mise à jour : ${label}`; }
    currentOrder = order; renderCancellation(order); lastStatus = order.status;
  }
  async function refresh() {
    if (!token) return showError('Le lien de suivi sécurisé est incomplet. Ouvrez le lien reçu après la commande.');
    try {
      const response = await fetch(`/api/public/shops/orders/${encodeURIComponent(reference)}?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data) {
        if (lastCancellationStatus === 'pending') {
          try {
            const statusResponse = await fetch(`/api/public/shops/orders/${encodeURIComponent(reference)}/cancellation?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
            const statusResult = await statusResponse.json().catch(() => ({}));
            if (statusResponse.ok && statusResult.data?.request) return showCancellationOutcome(statusResult.data);
          } catch (_) { /* do not replace the original neutral tracking error with a network detail */ }
        }
        return showError(result.error || 'Commande introuvable ou lien de suivi invalide.');
      }
      render(result.data);
      if (['completed', 'cancelled'].includes(result.data.status)) clearInterval(timer);
    } catch (_) { if (!$('#trackingContent').hidden) $('#trackingStatus').textContent = 'Connexion interrompue; nouvelle tentative automatique…'; }
  }
  function cancellationStorageKey() { return `oy-order-cancel:${reference}`; }
  function cancellationRequestId() {
    const storageKey = cancellationStorageKey();
    try { const existing = sessionStorage.getItem(storageKey); if (existing && /^[A-Za-z0-9_-]{16,100}$/.test(existing)) return existing; } catch (_) {}
    const random = globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
    const value = `cancel_${random}`;
    try { sessionStorage.setItem(storageKey, value); } catch (_) {}
    return value;
  }
  $('#trackingCancellationForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = $('#trackingCancellationButton');
    if (button.disabled || !currentOrder || !['pending', 'confirmed', 'preparing', 'ready'].includes(currentOrder.status)) return;
    if (!window.confirm(`Confirmer votre demande d’annulation pour ${currentOrder.reference} ?`)) return;
    const errorNode = $('#trackingCancellationError');
    button.disabled = true; button.textContent = 'Envoi…'; errorNode.hidden = true;
    try {
      const response = await fetch(`/api/public/shops/orders/${encodeURIComponent(reference)}/cancel?token=${encodeURIComponent(token)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId: cancellationRequestId(), reason: $('#trackingCancellationReason').value.trim() }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.data?.order) throw new Error(result.error || `La demande n’a pas été confirmée (${response.status}).`);
      try { sessionStorage.removeItem(cancellationStorageKey()); } catch (_) {}
      render(result.data.order);
      if (result.data.autoAccepted) clearInterval(timer);
    } catch (error) {
      errorNode.textContent = `${error.message} Si la connexion a été interrompue, réessayez : la même demande sera reconnue sans doublon.`;
      errorNode.hidden = false;
    } finally {
      button.disabled = false;
      const latest = currentOrder?.cancellationRequests?.at(-1);
      button.textContent = latest?.status === 'rejected' ? 'Envoyer une nouvelle demande' : 'Demander l’annulation';
    }
  });
  refresh(); timer = setInterval(refresh, 10_000); document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
