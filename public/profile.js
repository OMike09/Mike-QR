(() => {
  'use strict';
  const root = document.getElementById('publicRoot');
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const typeLabel = { individual: 'Particulier', business: 'Entreprise', commerce: 'Commerce', organization: 'Organisation', other: 'Profil' };
  const icon = (name) => {
    const paths = {
      phone: '<path d="M6.1 2.7h2.1l1.1 3-1.6 1.5a12.3 12.3 0 0 0 5.1 5.1l1.5-1.6 3 1.1v2.1a2 2 0 0 1-2.2 2.1A13.4 13.4 0 0 1 4 4.9a2 2 0 0 1 2.1-2.2Z"/>',
      mail: '<rect x="2.5" y="4" width="15" height="12" rx="2"/><path d="m3 5 7 5.5L17 5"/>',
      link: '<path d="M8 12 12 8m-6 6-1.2 1.2a3.2 3.2 0 0 1-4.5-4.5l3.1-3.1a3.2 3.2 0 0 1 4.5 0m2.2-2.2 1.2-1.2a3.2 3.2 0 0 1 4.5 4.5l-3.1 3.1a3.2 3.2 0 0 1-4.5 0"/>',
      pin: '<path d="M16 7.3c0 4.2-6 9.7-6 9.7S4 11.5 4 7.3a6 6 0 1 1 12 0Z"/><circle cx="10" cy="7.2" r="2"/>',
      file: '<path d="M5 2.5h6l4 4v11H5z"/><path d="M11 2.8v4h4m-7 4h4m-4 3h4"/>',
      bag: '<path d="M4 6.5h12l1 10H3z"/><path d="M7 7V5a3 3 0 0 1 6 0v2"/>',
      arrow: '<path d="M4 10h11m-4-4 4 4-4 4"/>',
    };
    return `<svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.link}</svg>`;
  };
  function href(raw) {
    try {
      const url = new URL(String(raw || ''));
      return ['http:', 'https:', 'tel:', 'mailto:'].includes(url.protocol) ? url.href : '';
    } catch (_) { return ''; }
  }
  function publicLink(label, url, iconName = 'arrow') {
    const safe = href(url);
    if (!safe) return '';
    const target = safe.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="public-list-link" href="${esc(safe)}"${target}><span>${esc(label)}</span><span>${icon(iconName)}</span></a>`;
  }
  function action(label, url, iconName, primary = false) {
    const safe = href(url);
    if (!safe) return '';
    const target = safe.startsWith('http') ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a class="public-action${primary ? ' primary' : ''}" href="${esc(safe)}"${target}>${icon(iconName)}<span>${esc(label)}</span></a>`;
  }
  function section(title, symbol, body) {
    if (!body) return '';
    return `<section class="public-section"><h2><span class="section-mark">${icon(symbol)}</span>${esc(title)}</h2><div class="public-section-body">${body}</div></section>`;
  }
  function showEmpty(title, message) {
    root.innerHTML = `<div class="public-empty"><span class="public-empty-mark"><svg viewBox="0 0 40 40" fill="none"><rect x="4" y="4" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2.4"/><rect x="24" y="4" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2.4"/><rect x="4" y="24" width="12" height="12" rx="2" stroke="currentColor" stroke-width="2.4"/><path d="M24 24h4v4h-4zm8 0h4v4h-4zm-8 8h4v4h-4zm8-1h4v5h-4z" fill="currentColor"/></svg></span><h1>${esc(title)}</h1><p>${esc(message)}</p></div>`;
  }
  function render(data) {
    const { qr, beneficiary: b } = data;
    const pageTitle = qr.title || qr.name || b.name;
    const logo = b.logo ? `<img src="${esc(b.logo)}" alt="Logo de ${esc(b.name)}">` : esc((b.name || '?').slice(0, 1).toUpperCase());
    const hero = `<div class="public-hero"><div class="public-logo">${logo}</div><div class="public-hero-text"><p class="public-eyebrow">${esc(qr.categoryName || typeLabel[b.type] || 'QRia')}</p><h1>${esc(pageTitle)}</h1><p class="public-beneficiary">${esc(b.name)} · ${esc(typeLabel[b.type] || 'Profil')}</p></div></div>`;

    const actions = [];
    if (b.phone) actions.push(action('Appeler', `tel:${String(b.phone).replace(/[^0-9+]/g, '')}`, 'phone', true));
    if (b.whatsapp) {
      const digits = String(b.whatsapp).replace(/\D/g, '');
      if (digits) actions.push(action('WhatsApp', `https://wa.me/${digits}`, 'phone'));
    }
    if (b.email) actions.push(action('E-mail', `mailto:${b.email}`, 'mail'));
    if (b.website) actions.push(action('Site Internet', b.website, 'link'));

    const contactRows = [];
    if (b.phone) contactRows.push(`<div class="detail-item"><small>Téléphone</small><a href="tel:${esc(String(b.phone).replace(/[^0-9+]/g, ''))}">${esc(b.phone)}</a></div>`);
    if (b.whatsapp) contactRows.push(`<div class="detail-item"><small>WhatsApp</small><a href="https://wa.me/${esc(String(b.whatsapp).replace(/\D/g, ''))}" target="_blank" rel="noopener noreferrer">${esc(b.whatsapp)}</a></div>`);
    if (b.email) contactRows.push(`<div class="detail-item"><small>E-mail</small><a href="mailto:${esc(b.email)}">${esc(b.email)}</a></div>`);
    if (b.website) contactRows.push(`<div class="detail-item"><small>Site Internet</small><a href="${esc(href(b.website))}" target="_blank" rel="noopener noreferrer">${esc(b.website)}</a></div>`);
    if (b.address) {
      const mapUrl = b.locationUrl ? href(b.locationUrl) : `https://maps.google.com/?q=${encodeURIComponent(b.address)}`;
      contactRows.push(`<div class="detail-item"><small>Adresse</small><span>${esc(b.address)}${mapUrl ? ` <a class="public-location" href="${esc(mapUrl)}" target="_blank" rel="noopener noreferrer">Voir la localisation ↗</a>` : ''}</span></div>`);
    }
    if (b.locationUrl && !b.address) contactRows.push(`<div class="detail-item"><small>Localisation</small><a href="${esc(href(b.locationUrl))}" target="_blank" rel="noopener noreferrer">Ouvrir la carte ↗</a></div>`);
    const contact = contactRows.length ? `<div class="public-grid">${contactRows.join('')}</div>` : '';

    const socials = Array.isArray(b.socials) ? b.socials.map((item) => publicLink(item.label || 'Réseau social', item.url, 'arrow')).join('') : '';
    const offers = Array.isArray(b.offers) ? b.offers.map((item) => {
      const price = item.price ? `<span class="offer-price">${esc(item.price)}</span>` : '';
      const link = item.url ? `<a href="${esc(href(item.url))}" target="_blank" rel="noopener noreferrer">En savoir plus ↗</a>` : '';
      return `<article class="offer-card"><h3>${esc(item.name || 'Offre')}</h3>${item.description ? `<p>${esc(item.description)}</p>` : ''}${price}${link}</article>`;
    }).join('') : '';
    const documents = Array.isArray(b.documents) ? b.documents.map((item) => publicLink(item.name || 'Document', item.url, 'file')).join('') : '';
    const extraLinks = Array.isArray(qr.extraLinks) ? qr.extraLinks.map((item) => publicLink(item.label || 'Lien utile', item.url, 'arrow')).join('') : '';

    const contentText = qr.contentText ? `<div class="public-content-text">${esc(qr.contentText)}</div>` : '';
    const bio = b.bio ? section('À propos', 'link', `<p>${esc(b.bio).replace(/\n/g, '<br>')}</p>`) : '';
    const details = section('Coordonnées', 'pin', contact);
    const socialSection = socials ? section('Réseaux sociaux', 'link', `<div class="social-list">${socials}</div>`) : '';
    const offersSection = offers ? section('Produits et services', 'bag', `<div class="offer-grid">${offers}</div>`) : '';
    const documentSection = documents ? section('Documents et ressources', 'file', `<div class="document-list">${documents}</div>`) : '';
    const linksSection = extraLinks ? section('Liens utiles', 'link', `<div class="link-list">${extraLinks}</div>`) : '';

    root.innerHTML = `<article class="public-card">${hero}<div class="public-content">${qr.description ? `<p class="public-description">${esc(qr.description)}</p>` : ''}${actions.length ? `<div class="public-actions">${actions.join('')}</div>` : ''}${contentText}${bio}${details}${socialSection}${offersSection}${documentSection}${linksSection}</div></article>`;
  }

  async function load() {
    const code = window.location.pathname.split('/').filter(Boolean).pop();
    if (!code) return showEmpty('Code QR introuvable', 'Ce lien ne semble pas complet.');
    try {
      const response = await fetch(`/api/public/qr/${encodeURIComponent(code)}`, { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok) return showEmpty('Page indisponible', payload.error || 'Ce code QR a peut-être été désactivé.');
      document.title = `${payload.qr.title || payload.beneficiary.name} — QRia`;
      render(payload);
    } catch (_) {
      showEmpty('Connexion impossible', 'Vérifiez votre connexion Internet puis réessayez.');
    }
  }
  load();
})();
