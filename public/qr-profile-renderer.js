/* Shared renderer used by both the live preview and the final public page. */
(function (root) {
  'use strict';
  const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const safeUrl = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try { const url = new URL(raw, window.location.origin); return ['http:', 'https:', 'tel:', 'mailto:'].includes(url.protocol) ? url.href : ''; }
    catch (_) { return ''; }
  };
  const external = (url) => /^https?:/i.test(url) ? ' target="_blank" rel="noopener noreferrer"' : '';
  const phoneHref = (value) => `tel:${String(value || '').replace(/[^+\d]/g, '')}`;
  const whatsappHref = (value, text = '') => {
    const number = String(value || '').replace(/\D/g, '');
    return number ? `https://wa.me/${number}${text ? `?text=${encodeURIComponent(text)}` : ''}` : '';
  };
  const xof = (amount) => amount == null || amount === '' ? '' : `${new Intl.NumberFormat('fr-CI').format(Number(amount))} FCFA`;
  const groupSlug = (value) => String(value || 'autres').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'autres';
  function linkButton(label, href, kind = 'secondary') {
    const safe = safeUrl(href);
    return safe ? `<a class="experience-action ${kind}" href="${esc(safe)}"${external(safe)}>${esc(label)} <span aria-hidden="true">↗</span></a>` : '';
  }
  function render(rootElement, payload, options = {}) {
    const qr = payload?.qr || {};
    const b = payload?.beneficiary || {};
    const p = payload?.profileData || {};
    const theme = p.theme || {};
    const rootNode = rootElement;
    if (!rootNode) return;
    const vars = {
      '--experience-primary': theme.primary || '#176B52', '--experience-secondary': theme.secondary || '#DDF3E8',
      '--experience-background': theme.background || '#F6FBF8', '--experience-surface': theme.surface || '#FFFFFF',
      '--experience-text': theme.text || '#18342B', '--experience-button': theme.button || theme.primary || '#176B52',
    };
    Object.entries(vars).forEach(([key, value]) => rootNode.style.setProperty(key, value));
    rootNode.dataset.experienceStyle = theme.style || 'modern';
    rootNode.dataset.experienceLayout = theme.layout || 'cover';
    rootNode.dataset.experienceFont = theme.font || 'system';
    rootNode.dataset.experienceTextSize = theme.textSize || 'normal';
    rootNode.dataset.experienceAlign = theme.align || 'left';
    const name = p.entityName || b.name || qr.title || 'Votre activité';
    const title = qr.title || name;
    const logo = p.logo || b.logo || '';
    const logoMarkup = logo ? `<img src="${esc(logo)}" alt="Logo de ${esc(name)}">` : `<span>${esc(name.slice(0, 1).toLocaleUpperCase('fr'))}</span>`;
    const cover = p.coverImage ? `<div class="experience-cover"><img src="${esc(p.coverImage)}" alt="Photo de couverture de ${esc(name)}" fetchpriority="high"></div>` : '';
    const subtitle = p.subtitle || p.description || qr.description || '';
    const phone = p.phone || b.phone || '';
    const whatsapp = p.whatsapp || b.whatsapp || '';
    const email = p.email || b.email || '';
    const address = [p.address || b.address || '', p.city || ''].filter(Boolean).join(', ');
    const mapUrl = p.mapUrl || b.locationUrl || (address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : '');
    const website = p.website || b.website || '';
    const contactCard = encodeURIComponent(JSON.stringify({ qr, profileData: { entityName: name, subtitle: p.subtitle || '', phone, email, whatsapp }, beneficiary: { name, phone, email, whatsapp } }));
    const saveContact = p.kind === 'contact' ? `<button class="experience-action" type="button" data-save-contact="${esc(contactCard)}">Enregistrer le contact</button>` : '';
    const actions = [
      saveContact,
      phone ? linkButton('Appeler', phoneHref(phone), 'primary') : '',
      whatsapp ? linkButton(p.orderMode === 'whatsapp' && p.kind === 'restaurant' ? 'Commander sur WhatsApp' : 'WhatsApp', whatsappHref(whatsapp, p.kind === 'restaurant' ? `Bonjour ${name}, je consulte votre menu via Oymike QR.` : ''), 'whatsapp') : '',
      email ? linkButton('Envoyer un e-mail', `mailto:${email}`) : '',
      website ? linkButton('Site Internet', website) : '',
      mapUrl ? linkButton('Voir l’itinéraire', mapUrl) : '',
      p.bookingUrl ? linkButton('Réserver', p.bookingUrl, 'primary') : '',
      p.registrationUrl ? linkButton('S’inscrire', p.registrationUrl, 'primary') : '',
    ].filter(Boolean).join('');
    const contactRows = [
      phone ? `<div class="experience-contact-row"><span>Téléphone</span><a href="${esc(phoneHref(phone))}">${esc(phone)}</a></div>` : '',
      email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `<div class="experience-contact-row"><span>E-mail</span><a href="mailto:${esc(email)}">${esc(email)}</a></div>` : '',
      address ? `<div class="experience-contact-row"><span>Adresse</span><a href="${esc(safeUrl(mapUrl))}"${external(safeUrl(mapUrl))}>${esc(address)}</a></div>` : '',
      website ? `<div class="experience-contact-row"><span>Site Internet</span><a href="${esc(safeUrl(website))}"${external(safeUrl(website))}>${esc(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div>` : '',
    ].filter(Boolean).join('');
    const hours = String(p.hours || '').trim().split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    const hoursMarkup = hours.length ? `<section class="experience-section"><div class="experience-section-heading"><span class="experience-section-icon">◷</span><h2>Horaires</h2></div><div class="experience-hours">${hours.map((line) => `<div>${esc(line)}</div>`).join('')}</div></section>` : '';
    const socialMarkup = (Array.isArray(p.socials) ? p.socials : []).map((item) => {
      const url = safeUrl(item.url); return url ? `<a class="experience-text-link" href="${esc(url)}"${external(url)}>${esc(item.label || 'Réseau social')} <span>↗</span></a>` : '';
    }).filter(Boolean).join('');
    const documentsMarkup = (Array.isArray(p.documents) ? p.documents : []).map((item) => {
      const url = safeUrl(item.url); return url ? `<a class="experience-document" href="${esc(url)}"${external(url)}><span>▤</span>${esc(item.name || 'Document')}<b>↓</b></a>` : '';
    }).filter(Boolean).join('');
    const photoRows = Array.isArray(b.photos) ? b.photos.slice().sort((a, c) => Number(Boolean(c.isPrimary)) - Number(Boolean(a.isPrimary)) || (Number(a.sortOrder) || 0) - (Number(c.sortOrder) || 0)) : [];
    const galleryMarkup = photoRows.length ? `<section class="experience-section"><div class="experience-section-heading"><span class="experience-section-icon">▧</span><h2>Galerie photos</h2></div><div class="experience-gallery">${photoRows.map((item) => `<figure><img loading="lazy" src="${esc(item.src)}" alt="${esc(item.caption || item.alt || name)}">${item.caption || item.alt ? `<figcaption>${esc(item.caption || item.alt)}</figcaption>` : ''}</figure>`).join('')}</div></section>` : '';
    const textBlock = p.description && p.description !== subtitle ? `<p class="experience-long-description">${esc(p.description).replace(/\n/g, '<br>')}</p>` : '';
    const contentText = qr.contentText ? `<div class="experience-note">${esc(qr.contentText).replace(/\n/g, '<br>')}</div>` : '';
    const eventDetails = p.kind === 'event' ? `<section class="experience-event"><span class="experience-event-kicker">${esc(p.organizer || 'Événement')}</span><h2>${esc(title)}</h2><div>${[p.eventDate, p.eventTime, p.venue || address].filter(Boolean).map(esc).join(' · ')}</div></section>` : '';
    const groups = new Map();
    (Array.isArray(p.items) ? p.items : []).forEach((item) => {
      const key = item.group || 'À découvrir';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });
    const itemGroups = [...groups.entries()];
    const itemMarkup = itemGroups.map(([group, items]) => {
      const id = `experience-group-${groupSlug(group)}`;
      return `<section class="experience-section experience-items-group" id="${esc(id)}"><div class="experience-section-heading"><span class="experience-section-icon">${p.kind === 'restaurant' ? '✦' : '◇'}</span><h2>${esc(group)}</h2></div><div class="experience-items">${items.map((item) => {
        const firstPhoto = item.photos?.[0];
        const hasPromotion = item.priceXof != null && item.promotionPriceXof != null && Number(item.promotionPriceXof) < Number(item.priceXof);
        const finalPrice = hasPromotion ? item.promotionPriceXof : item.priceXof;
        const price = hasPromotion ? `<div class="experience-price experience-price-promotion"><span class="experience-promo-label">${esc(item.promotionLabel || 'Promotion')}</span><del>${esc(xof(item.priceXof))}</del><strong>${esc(xof(item.promotionPriceXof))}</strong></div>` : item.priceXof == null ? '' : `<span class="experience-price">${esc(xof(item.priceXof))}</span>`;
        const variants = (item.variants || []).map((variant) => `<li><span>${esc(variant.name)}</span><strong>${esc(xof(variant.priceXof))}</strong></li>`).join('');
        const options = (item.options || []).map((option) => `<span class="experience-extra-option">+ ${esc(option.name)}${option.priceXof == null ? '' : ` · ${esc(xof(option.priceXof))}`}</span>`).join('');
        const order = p.kind === 'restaurant' && p.orderMode === 'whatsapp' && whatsapp ? `<a class="experience-item-order" href="${esc(whatsappHref(whatsapp, `Bonjour ${name}, je souhaite commander : ${item.name}${finalPrice == null ? '' : ` (${xof(finalPrice)})`}.`))}" target="_blank" rel="noopener noreferrer">Commander sur WhatsApp</a>` : '';
        return `<article class="experience-item${item.featured ? ' is-featured' : ''}${item.available === false ? ' is-unavailable' : ''}">${firstPhoto ? `<img class="experience-item-image" src="${esc(firstPhoto.src)}" alt="${esc(firstPhoto.caption || item.name)}" loading="lazy">` : ''}<div class="experience-item-body"><div class="experience-item-title-row"><h3>${esc(item.name)}</h3>${item.featured ? '<span class="experience-featured">Spécialité</span>' : ''}</div>${item.available === false ? '<span class="experience-unavailable">Indisponible actuellement</span>' : ''}${item.description ? `<p>${esc(item.description)}</p>` : ''}${price}${variants ? `<ul class="experience-variants">${variants}</ul>` : ''}${options ? `<div class="experience-options">${options}</div>` : ''}${order}</div></article>`;
      }).join('')}</div></section>`;
    }).join('');
    const groupNav = theme.layout === 'tabs' && itemGroups.length > 1 ? `<nav class="experience-group-nav" aria-label="Catégories">${itemGroups.map(([group]) => `<a href="#experience-group-${groupSlug(group)}">${esc(group)}</a>`).join('')}</nav>` : '';
    const delivery = p.deliveryInfo ? `<div class="experience-delivery"><strong>Livraison</strong><span>${esc(p.deliveryInfo)}</span></div>` : '';
    const contacts = contactRows ? `<section class="experience-section"><div class="experience-section-heading"><span class="experience-section-icon">⌖</span><h2>Informations pratiques</h2></div><div class="experience-contact-grid">${contactRows}</div>${delivery}</section>` : '';
    const socialSection = socialMarkup ? `<section class="experience-section"><div class="experience-section-heading"><span class="experience-section-icon">↗</span><h2>Suivez-nous</h2></div><div class="experience-socials">${socialMarkup}</div></section>` : '';
    const docsSection = documentsMarkup ? `<section class="experience-section"><div class="experience-section-heading"><span class="experience-section-icon">▤</span><h2>Documents utiles</h2></div><div class="experience-documents">${documentsMarkup}</div></section>` : '';
    const signature = options.preview ? `<div class="experience-preview-stamp">${esc(options.previewLabel || 'APERÇU — non publié')}</div>` : '';
    rootNode.innerHTML = `<article class="qr-experience"><header class="experience-header">${cover}<div class="experience-identity">${logoMarkup}<div><span class="experience-eyebrow">${esc(p.templateLabel || b.type || 'Présentation')}</span><h1>${esc(title)}</h1><p>${esc(name)}${p.subtitle && p.subtitle !== subtitle ? ` · ${esc(p.subtitle)}` : ''}</p></div></div></header><div class="experience-content">${eventDetails}${subtitle ? `<p class="experience-intro">${esc(subtitle)}</p>` : ''}${actions ? `<div class="experience-actions">${actions}</div>` : ''}${textBlock}${contentText}${groupNav}${itemMarkup}${hoursMarkup}${contacts}${galleryMarkup}${socialSection}${docsSection}<footer class="experience-footer">${esc(name)} <span>·</span> Un scan suffit.</footer></div></article>${signature}`;
    if (options.preview) rootNode.dataset.preview = 'true'; else delete rootNode.dataset.preview;
  }
  function downloadContact(payload) {
    const p = payload?.profileData || {}; const b = payload?.beneficiary || {};
    const name = p.entityName || b.name || payload?.qr?.title || 'Contact Oymike QR';
    const phone = p.phone || b.phone || ''; const email = p.email || b.email || '';
    const whatsapp = p.whatsapp || b.whatsapp || ''; const title = payload?.qr?.title || p.subtitle || '';
    const vcard = ['BEGIN:VCARD', 'VERSION:3.0', `FN:${name.replace(/[\r\n;]/g, ' ')}`, `ORG:${name.replace(/[\r\n;]/g, ' ')}`,
      phone ? `TEL;TYPE=WORK,VOICE:${phone.replace(/[\r\n;]/g, '')}` : '', email ? `EMAIL:${email.replace(/[\r\n;]/g, '')}` : '',
      whatsapp ? `NOTE:WhatsApp ${whatsapp.replace(/[\r\n;]/g, '')}` : '', title ? `TITLE:${title.replace(/[\r\n;]/g, ' ')}` : '', 'END:VCARD'].filter(Boolean).join('\r\n');
    const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([vcard], { type: 'text/vcard;charset=utf-8' }));
    link.download = `${groupSlug(name)}.vcf`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1200);
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-save-contact]');
    if (button) {
      try { downloadContact(JSON.parse(decodeURIComponent(button.dataset.saveContact))); } catch (_) { /* An invalid preview payload is ignored. */ }
    }
  });
  root.QRIAProfile = { render, safeUrl, formatXof: xof };
})(typeof window !== 'undefined' ? window : globalThis);
