(() => {
  'use strict';
  const params = new URLSearchParams(location.search); const slug = String(params.get('store') || '').replace(/[^a-z0-9-]/gi, '').slice(0,70); const reference = String(params.get('reference') || '').slice(0,40);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  document.querySelector('#confirmationReference').textContent = reference ? `Référence : ${reference}` : 'Référence indisponible';
  document.querySelector('#confirmationRecovery').href = `/order-recovery/?store=${encodeURIComponent(slug)}`;
  if (!slug) return;
  fetch(`/api/public/shops/${encodeURIComponent(slug)}`, { cache: 'no-store' }).then((response) => response.json()).then((result) => {
    if (!result?.data?.store) throw new Error('Coordonnées de boutique indisponibles.'); const store = result.data.store; const contact = [];
    if (store.phoneContactUrl) contact.push(`<a class="button outline" href="${esc(store.phoneContactUrl)}">Appeler</a>`);
    if (store.whatsappContactUrl) contact.push(`<a class="button outline" href="${esc(store.whatsappContactUrl)}" target="_blank" rel="noopener noreferrer">WhatsApp</a>`);
    if (store.email) contact.push(`<a href="mailto:${esc(store.email)}">E-mail : ${esc(store.email)}</a>`);
    if (store.address) contact.push(`<span>${esc(store.address)}</span>`);
    document.querySelector('#confirmationStore').innerHTML = `<strong>Coordonnées enregistrées de ${esc(store.name)}</strong>${contact.join('') || '<span>Aucune coordonnée de contact n’est publiée.</span>'}`;
  }).catch((error) => { const node = document.querySelector('#confirmationError'); node.textContent = error.message; node.hidden = false; });
})();
