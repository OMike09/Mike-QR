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
  const FONT_STACKS = {
    Inter: '"Inter",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
    Poppins: '"Poppins",ui-sans-serif,system-ui,sans-serif',
    Montserrat: '"Montserrat",ui-sans-serif,system-ui,sans-serif',
    Roboto: '"Roboto",Arial,sans-serif',
    'Open Sans': '"Open Sans",Arial,sans-serif',
    Lato: '"Lato",Arial,sans-serif',
    'Playfair Display': '"Playfair Display",Georgia,"Times New Roman",serif',
    Merriweather: '"Merriweather",Georgia,serif',
    Nunito: '"Nunito",ui-rounded,"Trebuchet MS",sans-serif',
    Raleway: '"Raleway",ui-sans-serif,system-ui,sans-serif',
  };
  const FONT_GROUPS = ['title','subtitle','description','price','button'];
  const DEFAULT_COLORS = {
    primary:'#176B52', secondary:'#DDF3E8', pageBg:'#F2F8F4', mainBg:'#F6FBF8', card:'#FFFFFF', panel:'#E9F5EE',
    title:'#153D2F', subtitle:'#315B4C', description:'#253D33', price:'#176B52', button:'#176B52', buttonText:'#FFFFFF',
    icon:'#176B52', border:'#C9DDD1', separator:'#DCE9E0', menuBg:'#DDF3E8', menuText:'#14543D', link:'#116B4B', badgeBg:'#DDF3E8', badgeText:'#14543D',
  };
  function safeColor(value, fallback) { return /^#[0-9a-f]{6}$/i.test(String(value || '')) ? String(value).toUpperCase() : fallback; }
  function setVar(node, key, value) { if (node && value != null) node.style.setProperty(key, String(value)); }
  function themeVariables(theme) {
    const colors = { ...DEFAULT_COLORS, ...(theme.colors || {}) };
    colors.primary = safeColor(theme.primary, DEFAULT_COLORS.primary);
    colors.secondary = safeColor(theme.secondary, DEFAULT_COLORS.secondary);
    colors.pageBg = safeColor(colors.pageBg, safeColor(theme.background, DEFAULT_COLORS.pageBg));
    colors.mainBg = safeColor(colors.mainBg, safeColor(theme.background, DEFAULT_COLORS.mainBg));
    colors.card = safeColor(colors.card, safeColor(theme.surface, DEFAULT_COLORS.card));
    colors.panel = safeColor(colors.panel, colors.card);
    colors.title = safeColor(colors.title, safeColor(theme.text, DEFAULT_COLORS.title));
    colors.subtitle = safeColor(colors.subtitle, colors.title);
    colors.description = safeColor(colors.description, safeColor(theme.text, DEFAULT_COLORS.description));
    colors.price = safeColor(colors.price, colors.primary);
    colors.button = safeColor(colors.button, safeColor(theme.button, colors.primary));
    colors.buttonText = safeColor(colors.buttonText, '#FFFFFF');
    colors.icon = safeColor(colors.icon, colors.primary);
    colors.border = safeColor(colors.border, '#D8E0DA');
    colors.separator = safeColor(colors.separator, colors.border);
    colors.menuBg = safeColor(colors.menuBg, colors.secondary);
    colors.menuText = safeColor(colors.menuText, colors.primary);
    colors.link = safeColor(colors.link, colors.primary);
    colors.badgeBg = safeColor(colors.badgeBg, colors.secondary);
    colors.badgeText = safeColor(colors.badgeText, colors.primary);
    const type = theme.typography || {};
    const typeDefaults = {
      title:{family:'Inter',size:34,weight:750,italic:false,align:'left',lineHeight:1.12,letterSpacing:-.035,transform:'none'},
      subtitle:{family:'Inter',size:17,weight:550,italic:false,align:'left',lineHeight:1.45,letterSpacing:0,transform:'none'},
      description:{family:'Inter',size:16,weight:400,italic:false,align:'left',lineHeight:1.65,letterSpacing:0,transform:'none'},
      price:{family:'Montserrat',size:18,weight:750,italic:false,align:'left',lineHeight:1.2,letterSpacing:0,transform:'none'},
      button:{family:'Inter',size:14,weight:700,italic:false,align:'center',lineHeight:1.2,letterSpacing:.01,transform:'none'},
    };
    const typography = Object.fromEntries(FONT_GROUPS.map((key) => [key, { ...typeDefaults[key], ...(type[key] || {}) }]));
    return { colors, typography };
  }
  function rgba(hex, alpha) {
    const color = safeColor(hex, '#FFFFFF');
    const values = [1,3,5].map((i) => parseInt(color.slice(i, i + 2), 16));
    return `rgba(${values.join(',')},${Math.max(0, Math.min(1, Number(alpha) || 0))})`;
  }
  function safeImage(value) {
    const raw = String(value || '').trim();
    if (/^data:image\/(?:jpeg|png|webp);base64,[a-z0-9+/=]+$/i.test(raw)) return raw;
    try { const url = new URL(raw); return url.protocol === 'https:' ? url.href : ''; } catch (_) { return ''; }
  }
  function safeDocument(value) {
    const raw=String(value||'').trim();if(/^data:application\/pdf;base64,[a-z0-9+/=]+$/i.test(raw))return raw;
    const url=safeUrl(raw);return /^https?:/i.test(url)?url:'';
  }
  function applyTheme(article, theme) {
    const { colors, typography } = themeVariables(theme);
    const bg = theme.backgroundStyle || {};
    const components = theme.components || {};
    const px = (value, fallback) => `${Number.isFinite(Number(value)) ? Number(value) : fallback}px`;
    const em = (value, fallback) => `${Number.isFinite(Number(value)) ? Number(value) : fallback}em`;
    const families = Object.fromEntries(FONT_GROUPS.map((key) => [key, FONT_STACKS[typography[key].family] || FONT_STACKS.Inter]));
    const vars = {
      '--experience-primary': colors.price, '--experience-secondary': colors.menuBg,
      '--experience-page-bg': colors.pageBg, '--experience-main-background': colors.mainBg,
      '--experience-card': colors.card, '--experience-panel': colors.panel,
      '--experience-title': colors.title, '--experience-subtitle': colors.subtitle,
      '--experience-description': colors.description, '--experience-price': colors.price,
      '--experience-button': colors.button, '--experience-button-text': colors.buttonText,
      '--experience-icon': colors.icon, '--experience-border': colors.border,
      '--experience-separator': colors.separator, '--experience-menu-bg': colors.menuBg,
      '--experience-menu-text': colors.menuText, '--experience-link': colors.link,
      '--experience-badge-bg': colors.badgeBg, '--experience-badge-text': colors.badgeText,
      '--experience-title-family': families.title, '--experience-subtitle-family': families.subtitle,
      '--experience-description-family': families.description, '--experience-price-family': families.price,
      '--experience-button-family': families.button,
      '--experience-title-size': `clamp(18px, ${Math.max(2.4, typography.title.size / 8)}vw, ${px(typography.title.size,34)})`,
      '--experience-subtitle-size': `clamp(14px, ${Math.max(2, typography.subtitle.size / 8.5)}vw, ${px(typography.subtitle.size,17)})`,
      '--experience-description-size': `clamp(14px, ${Math.max(1.9, typography.description.size / 8.5)}vw, ${px(typography.description.size,16)})`,
      '--experience-price-size': `clamp(16px, ${Math.max(2.1, typography.price.size / 8.5)}vw, ${px(typography.price.size,18)})`,
      '--experience-button-size': px(typography.button.size,14),
      '--experience-title-weight': typography.title.weight, '--experience-subtitle-weight': typography.subtitle.weight,
      '--experience-description-weight': typography.description.weight, '--experience-price-weight': typography.price.weight,
      '--experience-button-weight': typography.button.weight,
      '--experience-title-line-height': typography.title.lineHeight, '--experience-subtitle-line-height': typography.subtitle.lineHeight,
      '--experience-description-line-height': typography.description.lineHeight, '--experience-price-line-height': typography.price.lineHeight,
      '--experience-button-line-height': typography.button.lineHeight,
      '--experience-title-letter-spacing': em(typography.title.letterSpacing,-.035), '--experience-subtitle-letter-spacing': em(typography.subtitle.letterSpacing,0),
      '--experience-description-letter-spacing': em(typography.description.letterSpacing,0), '--experience-price-letter-spacing': em(typography.price.letterSpacing,0),
      '--experience-button-letter-spacing': em(typography.button.letterSpacing,.01),
      '--experience-title-style': typography.title.italic ? 'italic' : 'normal', '--experience-subtitle-style': typography.subtitle.italic ? 'italic' : 'normal',
      '--experience-description-style': typography.description.italic ? 'italic' : 'normal', '--experience-price-style': typography.price.italic ? 'italic' : 'normal',
      '--experience-button-style': typography.button.italic ? 'italic' : 'normal',
      '--experience-title-align': typography.title.align, '--experience-subtitle-align': typography.subtitle.align,
      '--experience-description-align': typography.description.align, '--experience-price-align': typography.price.align, '--experience-button-align': typography.button.align,
      '--experience-title-transform': typography.title.transform, '--experience-subtitle-transform': typography.subtitle.transform,
      '--experience-description-transform': typography.description.transform, '--experience-price-transform': typography.price.transform, '--experience-button-transform': typography.button.transform,
      '--experience-radius': px(components.radius,16), '--experience-border-width': px(components.borderWidth,1),
      '--experience-spacing': px(components.spacing,24), '--experience-grid-columns': Math.min(3,Math.max(1,Number(components.gridColumns)||2)),
      '--experience-cover-height': px(components.coverHeight,280),
      '--experience-cover-position': `${Number(components.coverPositionX ?? 50)}% ${Number(components.coverPositionY ?? 50)}%`,
      '--experience-button-radius': components.buttonShape === 'pill' ? '999px' : components.buttonShape === 'square' ? '3px' : '12px',
      '--experience-surface-opacity': `${Number(bg.panelOpacity ?? 92)}%`,
    };
    Object.entries(vars).forEach(([key,value]) => setVar(article,key,value));
    article.dataset.experienceStyle = theme.style || 'modern';
    article.dataset.experienceLayout = theme.layout || 'cover';
    article.dataset.experienceFont = theme.font || 'system';
    article.dataset.experienceTextSize = theme.textSize || 'normal';
    article.dataset.experienceAlign = theme.align || 'left';
    article.dataset.cardStyle = components.cardStyle || 'rounded';
    article.dataset.shadow = components.shadow || 'soft';
    article.dataset.buttonShape = components.buttonShape || 'rounded';
    article.dataset.bgType = bg.type || 'solid';
    article.dataset.animate = components.enableAnimation ? 'true' : 'false';
    const shadow = { none:'none', soft:'0 12px 32px rgba(13,34,25,.10)', medium:'0 14px 38px rgba(14,24,35,.14)', strong:'0 20px 48px rgba(14,24,35,.22)' };
    setVar(article,'--experience-shadow',shadow[components.shadow] || shadow.soft);
    const type = bg.type || 'solid';
    if (type === 'gradient') {
      const stops = [safeColor(bg.color1,colors.pageBg), safeColor(bg.color2,colors.mainBg)];
      if (bg.color3 && bg.color3 !== bg.color2) stops.push(safeColor(bg.color3,colors.panel));
      article.style.backgroundImage = `linear-gradient(${Number(bg.angle)||135}deg, ${stops.join(', ')})`;
      article.style.backgroundSize = 'cover';
    } else if (type === 'image') {
      const image = safeImage(bg.image);
      article.style.backgroundImage = image ? `linear-gradient(${rgba(bg.color1 || colors.pageBg, 1 - Math.max(.2,Math.min(1,Number(bg.imageOpacity ?? 72)/100)))}, ${rgba(bg.color1 || colors.pageBg, 1 - Math.max(.2,Math.min(1,Number(bg.imageOpacity ?? 72)/100)))}), url(${JSON.stringify(image)})` : 'none';
      article.style.backgroundPosition = `${Number(bg.imagePositionX ?? 50)}% ${Number(bg.imagePositionY ?? 50)}%`;
      article.style.backgroundSize = 'cover';
    } else if (type === 'pattern') {
      const alpha = Math.max(.03,Math.min(.35,Number(bg.patternOpacity ?? 12)/100));
      if (bg.pattern === 'grid') article.style.backgroundImage = `linear-gradient(${rgba(colors.icon,alpha)} 1px, transparent 1px), linear-gradient(90deg, ${rgba(colors.icon,alpha)} 1px, transparent 1px)`;
      else if (bg.pattern === 'diagonal') article.style.backgroundImage = `repeating-linear-gradient(135deg, transparent 0 12px, ${rgba(colors.icon,alpha)} 12px 13px)`;
      else article.style.backgroundImage = `radial-gradient(${rgba(colors.icon,alpha)} 1px, transparent 1.5px)`;
      article.style.backgroundSize = bg.pattern === 'grid' ? '20px 20px' : bg.pattern === 'diagonal' ? 'auto' : '18px 18px';
    } else article.style.backgroundImage = 'none';
  }
  function linkButton(label, href, kind = 'secondary') {
    const safe = safeUrl(href);
    return safe ? `<a class="experience-action ${kind}" href="${esc(safe)}"${external(safe)}>${esc(label)} <span aria-hidden="true">↗</span></a>` : '';
  }
  function section(title, icon, body, collapsible, id) {
    if (!body) return '';
    const heading = `<span class="experience-section-icon" aria-hidden="true">${icon}</span><span>${esc(title)}</span>`;
    if (collapsible) return `<details class="experience-collapsible" id="${esc(id || '')}"><summary>${heading}</summary><section class="experience-section">${body}</section></details>`;
    return `<section class="experience-section" id="${esc(id || '')}"><div class="experience-section-heading">${heading}</div>${body}</section>`;
  }
  function render(rootElement, payload, options = {}) {
    const qr = payload?.qr || {};
    const b = payload?.beneficiary || {};
    const p = payload?.profileData || {};
    const theme = p.theme || {};
    const components = theme.components || {};
    if (!rootElement) return;
    const name = p.entityName || b.name || qr.title || 'Votre activité';
    const title = qr.title || name;
    const logo = components.showLogo === false ? '' : (p.logo || b.logo || '');
    const logoMarkup = logo ? `<img src="${esc(logo)}" alt="Logo de ${esc(name)}">` : `<span aria-hidden="true">${esc(name.slice(0, 1).toLocaleUpperCase('fr'))}</span>`;
    const coverVisible = components.showCover !== false && p.coverImage;
    const cover = coverVisible ? `<div class="experience-cover"><img src="${esc(p.coverImage)}" alt="Photo de couverture de ${esc(name)}" fetchpriority="high"></div>` : '';
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
      components.sharePage && !options.preview ? `<button class="experience-action" type="button" data-share-page>Partager cette page</button>` : '',
    ].filter(Boolean).join('');
    const contactRows = [
      phone ? `<div class="experience-contact-row"><span>Téléphone</span><a href="${esc(phoneHref(phone))}">${esc(phone)}</a></div>` : '',
      email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? `<div class="experience-contact-row"><span>E-mail</span><a href="mailto:${esc(email)}">${esc(email)}</a></div>` : '',
      address ? `<div class="experience-contact-row"><span>Adresse</span><a href="${esc(safeUrl(mapUrl))}"${external(safeUrl(mapUrl))}>${esc(address)}</a></div>` : '',
      website ? `<div class="experience-contact-row"><span>Site Internet</span><a href="${esc(safeUrl(website))}"${external(safeUrl(website))}>${esc(website.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a></div>` : '',
    ].filter(Boolean).join('');
    const hours = String(p.hours || '').trim().split(/\r?\n/).map((row) => row.trim()).filter(Boolean);
    const hoursMarkup = hours.length ? `<div class="experience-hours">${hours.map((line) => `<div>${esc(line)}</div>`).join('')}</div>` : '';
    const socialMarkup = (Array.isArray(p.socials) ? p.socials : []).map((item) => {
      const url = safeUrl(item.url); return url ? `<a class="experience-text-link" href="${esc(url)}"${external(url)}>${esc(item.label || 'Réseau social')} <span>↗</span></a>` : '';
    }).filter(Boolean).join('');
    const documentsMarkup = (Array.isArray(p.documents) ? p.documents : []).map((item) => {
      const url = safeUrl(item.url); return url ? `<a class="experience-document" href="${esc(url)}"${external(url)}><span>▤</span>${esc(item.name || 'Document')}<b>↓</b></a>` : '';
    }).filter(Boolean).join('');
    const templateDefinition=p.templateSnapshot||root.QRIA_TEMPLATES?.get(p.templateId)||{};
    const customValues=p.customFields&&typeof p.customFields==='object'?p.customFields:{};
    const customFieldsMarkup=(templateDefinition.sections||[]).map((customSection)=>{
      const fieldRows=(templateDefinition.fields||[]).filter((field)=>field.sectionId===customSection.id).map((field)=>{
        const value=customValues[field.key];if(value==null||value==='')return '';
        let body='';
        if(field.type==='image'){const src=safeImage(value);body=src?`<img class="experience-custom-image" src="${esc(src)}" alt="${esc(field.label)}" loading="lazy">`:'';}
        else if(field.type==='document'){const url=safeDocument(value);body=url?`<a class="experience-document" href="${esc(url)}"${url.startsWith('data:')?' download':external(url)}><span>▤</span>${esc(field.label)}<b>↓</b></a>`:'';}
        else if(field.type==='url'){const url=safeUrl(value);body=url?`<a class="experience-text-link" href="${esc(url)}"${external(url)}>${esc(value)} <span>↗</span></a>`:esc(value);}
        else if(field.type==='email'){const email=String(value);body=`<a href="mailto:${esc(email)}">${esc(email)}</a>`;}
        else if(field.type==='phone'){const phone=String(value);body=`<a href="${esc(phoneHref(phone))}">${esc(phone)}</a>`;}
        else if(field.type==='price'){body=esc(xof(value));}
        else if(field.type==='checkbox'){body=value?'Oui':'Non';}
        else if(field.type==='number'){body=esc(new Intl.NumberFormat('fr-CI').format(Number(value)));}
        else {body=esc(value).replace(/\n/g,'<br>');}
        return body?`<div class="experience-custom-field"><strong>${esc(field.label)}</strong><div>${body}</div></div>`:'';
      }).filter(Boolean).join('');
      return fieldRows?`<section class="experience-section experience-custom-section"><h2>${esc(customSection.title)}</h2>${customSection.description?`<p>${esc(customSection.description)}</p>`:''}<div class="experience-custom-fields-grid">${fieldRows}</div></section>`:'';
    }).join('');
    const photoRows = Array.isArray(b.photos) ? b.photos.slice().sort((a, c) => Number(Boolean(c.isPrimary)) - Number(Boolean(a.isPrimary)) || (Number(a.sortOrder) || 0) - (Number(c.sortOrder) || 0)) : [];
    const galleryMarkup = photoRows.length ? `<div class="experience-gallery">${photoRows.map((item) => `<figure>${components.galleryZoom !== false ? `<button type="button" data-gallery-zoom="${esc(item.src)}" aria-label="Agrandir ${esc(item.caption || item.alt || 'la photo')}">` : ''}<img loading="lazy" src="${esc(item.src)}" alt="${esc(item.caption || item.alt || name)}">${components.galleryZoom !== false ? '</button>' : ''}${item.caption || item.alt ? `<figcaption>${esc(item.caption || item.alt)}</figcaption>` : ''}</figure>`).join('')}</div>` : '';
    const textBlock = p.description && p.description !== subtitle ? `<p class="experience-long-description">${esc(p.description).replace(/\n/g, '<br>')}</p>` : '';
    const contentText = qr.contentText ? `<div class="experience-note">${esc(qr.contentText).replace(/\n/g, '<br>')}</div>` : '';
    const eventDetails = p.kind === 'event' ? `<section class="experience-event"><span class="experience-event-kicker">${esc(p.organizer || 'Événement')}</span><h2>${esc(title)}</h2><div>${[p.eventDate, p.eventTime, p.venue || address].filter(Boolean).map(esc).join(' · ')}</div></section>` : '';
    const groups = new Map();
    (Array.isArray(p.items) ? p.items : []).forEach((item) => { const key = item.group || 'À découvrir'; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    const configuredGroups=Array.isArray(p.itemGroups)?p.itemGroups:Array.isArray(p.templateSnapshot?.defaultGroups)?p.templateSnapshot.defaultGroups:[];
    const groupOrder=new Map(configuredGroups.map((group,index)=>[group,index]));
    const itemGroups=[...groups.entries()].sort((a,b)=>(groupOrder.get(a[0])??Number.MAX_SAFE_INTEGER)-(groupOrder.get(b[0])??Number.MAX_SAFE_INTEGER));
    const itemMarkup = itemGroups.map(([group, items]) => {
      const id = `experience-group-${groupSlug(group)}`;
      const cards = items.map((item) => {
        const firstPhoto = item.photos?.[0];
        const hasPromotion = item.priceXof != null && item.promotionPriceXof != null && Number(item.promotionPriceXof) < Number(item.priceXof);
        const finalPrice = hasPromotion ? item.promotionPriceXof : item.priceXof;
        const price = hasPromotion ? `<div class="experience-price experience-price-promotion"><span class="experience-promo-label">${esc(item.promotionLabel || 'Promotion')}</span><del>${esc(xof(item.priceXof))}</del><strong>${esc(xof(item.promotionPriceXof))}</strong></div>` : item.priceXof == null ? '' : `<span class="experience-price">${esc(xof(item.priceXof))}</span>`;
        const variants = (item.variants || []).map((variant) => `<li><span>${esc(variant.name)}</span><strong>${esc(xof(variant.priceXof))}</strong></li>`).join('');
        const extras = (item.options || []).map((option) => `<span class="experience-extra-option">+ ${esc(option.name)}${option.priceXof == null ? '' : ` · ${esc(xof(option.priceXof))}`}</span>`).join('');
        const order = p.kind === 'restaurant' && p.orderMode === 'whatsapp' && whatsapp ? `<a class="experience-item-order" href="${esc(whatsappHref(whatsapp, `Bonjour ${name}, je souhaite commander : ${item.name}${finalPrice == null ? '' : ` (${xof(finalPrice)})`}.`))}" target="_blank" rel="noopener noreferrer">Commander sur WhatsApp</a>` : '';
        const badge = item.promotionPriceXof != null ? `<span class="experience-promo-label">${esc(item.promotionLabel || 'Promotion')}</span>` : item.badge === 'new' ? '<span class="experience-new-badge">Nouveau</span>' : (item.badge === 'popular' || item.featured) ? `<span class="experience-featured">${esc(item.badgeLabel || (p.kind === 'restaurant' ? 'Populaire' : 'À la une'))}</span>` : '';
        return `<article class="experience-item${item.featured ? ' is-featured' : ''}${item.available === false ? ' is-unavailable' : ''}">${firstPhoto ? `<img class="experience-item-image" src="${esc(firstPhoto.src)}" alt="${esc(firstPhoto.caption || item.name)}" loading="lazy">` : ''}<div class="experience-item-body"><div class="experience-item-title-row"><h3>${esc(item.name)}</h3>${badge}</div>${item.available === false ? '<span class="experience-unavailable">Indisponible actuellement</span>' : ''}${item.description ? `<p>${esc(item.description)}</p>` : ''}${price}${variants ? `<ul class="experience-variants">${variants}</ul>` : ''}${extras ? `<div class="experience-options">${extras}</div>` : ''}${order}</div></article>`;
      }).join('');
      const heading = `<span class="experience-section-icon" aria-hidden="true">${p.kind === 'restaurant' ? '✦' : '◇'}</span><span>${esc(group)}</span>`;
      return components.collapsibleSections
        ? `<details class="experience-collapsible" id="${esc(id)}"><summary>${heading}</summary><div class="experience-items">${cards}</div></details>`
        : `<section class="experience-section experience-items-group" id="${esc(id)}"><div class="experience-section-heading">${heading}</div><div class="experience-items">${cards}</div></section>`;
    }).join('');
    const showGroupNav = (components.showCategoryNav === true || theme.layout === 'tabs') && itemGroups.length > 1;
    const groupNav = showGroupNav ? `<nav class="experience-group-nav" aria-label="Catégories">${itemGroups.map(([group]) => `<a href="#experience-group-${groupSlug(group)}">${esc(group)}</a>`).join('')}</nav>` : '';
    const delivery = p.deliveryInfo ? `<div class="experience-delivery"><strong>Livraison</strong><span>${esc(p.deliveryInfo)}</span></div>` : '';
    const contacts = contactRows ? `<div class="experience-contact-grid">${contactRows}</div>${delivery}` : delivery;
    const socialSection = socialMarkup ? `<div class="experience-socials">${socialMarkup}</div>` : '';
    const docsSection = documentsMarkup ? `<div class="experience-documents">${documentsMarkup}</div>` : '';
    const banner = components.bannerText ? `<aside class="experience-banner"><b>${esc(components.bannerLabel || 'À la une')}</b><span>${esc(components.bannerText)}</span></aside>` : '';
    const collapsible = components.collapsibleSections === true;
    const signature = options.preview ? `<div class="experience-preview-stamp">${esc(options.previewLabel || 'APERÇU — non publié')}</div>` : '';
    rootElement.innerHTML = `<article class="qr-experience"><header class="experience-header">${cover}<div class="experience-identity">${logoMarkup}<div><span class="experience-eyebrow">${esc(p.templateLabel || b.type || 'Présentation')}</span><h1>${esc(title)}</h1><p>${esc(name)}${p.subtitle && p.subtitle !== subtitle ? ` · ${esc(p.subtitle)}` : ''}</p></div></div></header><div class="experience-content">${banner}${eventDetails}${subtitle ? `<p class="experience-intro">${esc(subtitle)}</p>` : ''}${actions ? `<div class="experience-actions">${actions}</div>` : ''}${textBlock}${contentText}${customFieldsMarkup}${groupNav}${itemMarkup}${section('Horaires','◷',hoursMarkup,collapsible,'experience-hours')}${section('Informations pratiques','⌖',contacts,collapsible,'experience-contact')}${section('Galerie photos','▧',galleryMarkup,collapsible,'experience-gallery')}${section('Suivez-nous','↗',socialSection,collapsible,'experience-socials')}${section('Documents utiles','▤',docsSection,collapsible,'experience-documents')}<footer class="experience-footer">${esc(name)} <span>·</span>${safeUrl(components.footerLink)?`<a href="${esc(safeUrl(components.footerLink))}"${external(safeUrl(components.footerLink))}>${esc(components.footerText||'En savoir plus')}</a>`:esc(components.footerText||'Un scan suffit.')}</footer></div>${components.showBackToTop && !options.preview ? '<button type="button" class="experience-back-top" data-back-top>Retour en haut ↑</button>' : ''}<div class="experience-status" role="status" aria-live="polite"></div></article>${signature}`;
    const article = rootElement.querySelector('.qr-experience');
    if (article) applyTheme(article, theme);
    if (options.preview) rootElement.dataset.preview = 'true'; else {
      delete rootElement.dataset.preview;
      if (typeof document !== 'undefined' && document.body) {
        const transparent = theme.backgroundStyle?.type === 'transparent';
        const bodyColor = transparent ? 'transparent' : themeVariables(theme).colors.pageBg;
        document.body.style.backgroundColor = bodyColor;
        if (document.documentElement?.style) document.documentElement.style.backgroundColor = bodyColor;
      }
    }
    bindInteractions(rootElement);
  }
  function bindInteractions(rootNode) {
    if (rootNode.dataset.experienceHandlers === 'true') return;
    rootNode.dataset.experienceHandlers = 'true';
    rootNode.addEventListener('click', async (event) => {
      const back = event.target.closest('[data-back-top]');
      if (back) { window.scrollTo?.({ top:0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); return; }
      const share = event.target.closest('[data-share-page]');
      if (share) {
        const url = window.location.href;
        try {
          if (navigator.share) await navigator.share({ title: document.title, url });
          else if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
          else { const box = document.createElement('textarea'); box.value = url; document.body.appendChild(box); box.select(); document.execCommand('copy'); box.remove(); }
          const status = rootNode.querySelector('.experience-status'); if (status) status.textContent = 'Lien de la page partagé ou copié.';
        } catch (_) { /* User canceled the native share sheet. */ }
        return;
      }
      const imageButton = event.target.closest('[data-gallery-zoom]');
      if (imageButton) {
        const src = safeImage(imageButton.dataset.galleryZoom); if (!src) return;
        const lightbox = document.createElement('div'); lightbox.className = 'experience-lightbox'; lightbox.setAttribute('role','dialog'); lightbox.setAttribute('aria-modal','true'); lightbox.setAttribute('aria-label','Photo agrandie');
        lightbox.innerHTML = `<button type="button" aria-label="Fermer">×</button><img src="${esc(src)}" alt="${esc(imageButton.querySelector('img')?.alt || 'Photo agrandie')}">`;
        const close = () => { lightbox.remove(); document.removeEventListener('keydown', onKey); };
        const onKey = (keyEvent) => { if (keyEvent.key === 'Escape') close(); };
        lightbox.addEventListener('click', (clickEvent) => { if (clickEvent.target === lightbox || clickEvent.target.closest('button')) close(); });
        document.addEventListener('keydown', onKey); document.body.appendChild(lightbox); lightbox.querySelector('button').focus();
      }
    });
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
    if (button) { try { downloadContact(JSON.parse(decodeURIComponent(button.dataset.saveContact))); } catch (_) { /* Invalid preview payload. */ } }
  });
  root.QRIAProfile = { render, safeUrl, formatXof: xof };
})(typeof window !== 'undefined' ? window : globalThis);
