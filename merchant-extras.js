'use strict';

const crypto = require('node:crypto');

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const SECTORS = new Set(['general', 'restaurant', 'maquis', 'hardware', 'clothing']);
const REQUEST_RE = /^[A-Za-z0-9_-]{16,100}$/;
const BENEFIT_BLOCKLIST = /(?:\b(?:argent|esp[eè]ces|cash|money|liquidit[eé]s?|virement|transfert|monnaie|xof|fcfa|cfa|euros?|dollars?|francs?)\b|[€$]|\b(?:gain|prime|bonus)\s*(?:de\s*)?\d)/i;
const AD_FORMATS = new Set(['card','banner','ticker']);
const AD_DIRECTIONS = new Set(['ltr','rtl']);
const AD_STYLES = new Set(['standard','solid','minimal','gradient']);
const AD_PLACEMENTS = new Set(['top','after_intro','before_products','after_products','footer']);
const AD_MEDIA_RE = /^\/media\/merchant\/([0-9a-f-]{36})$/i;

function fold(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr'); }
function text(value, max) { return String(value == null ? '' : value).trim().slice(0, max); }
function uuid() { return crypto.randomUUID(); }
function fail(message, code) { const error = new Error(message); if (code) error.code = code; return error; }
function toDate(value, label, fallback = '') {
  const raw = value == null || value === '' ? fallback : value;
  if (raw === '') return null;
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) throw fail(`${label} n’est pas une date valide.`);
  return parsed;
}
function safeAmount(value, label, min = 1, max = 2_000_000_000) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw fail(`${label} doit être un montant entier en XOF compris entre ${min} et ${max}.`);
  return number;
}

class MerchantCommerceExtras {
  constructor(baseStore, commerce, sessionSecret) {
    this.base = baseStore;
    this.commerce = commerce;
    this.pg = Boolean(baseStore.pool);
    this.secret = String(sessionSecret || process.env.SESSION_SECRET || 'local-preview-secret-change-before-deploy');
    this.encryptionKey = crypto.createHash('sha256').update(`qria-merchant-extras-v1\0${this.secret}`).digest();
  }

  _hash(purpose, value) {
    return crypto.createHmac('sha256', this.secret).update(`${purpose}\0${String(value)}`).digest('hex');
  }
  _encrypt(value) {
    const iv = crypto.randomBytes(12); const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
    return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`;
  }
  _decrypt(value) {
    const [version, ivText, tagText, encryptedText] = String(value || '').split('.');
    if (version !== 'v1' || !ivText || !tagText || !encryptedText) throw fail('Le secret enregistré ne peut pas être déchiffré avec la configuration actuelle.', 'SECRET_UNAVAILABLE');
    const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(ivText, 'base64url'));
    decipher.setAuthTag(Buffer.from(tagText, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(encryptedText, 'base64url')), decipher.final()]).toString('utf8');
  }
  _code(prefix) { return `${prefix}-${crypto.randomBytes(18).toString('base64url').toUpperCase()}`; }
  _lock(work) { return this.commerce?.withJsonLock ? this.commerce.withJsonLock(work) : Promise.resolve().then(work); }
  _requireSector(value) { const sector = text(value || 'general', 30).toLowerCase(); if (!SECTORS.has(sector)) throw fail('Choisissez un secteur reconnu.'); return sector; }
  _validWindow(startsAt, endsAt, { defaultDurationDays = 30 } = {}) {
    const now = new Date(); const start = toDate(startsAt, 'La date de début', now.toISOString());
    const end = toDate(endsAt, 'La date de fin', new Date(now.getTime() + defaultDurationDays * 86400000).toISOString());
    if (!start || !end || end <= start) throw fail('La date de fin doit être postérieure au début.');
    if (end.getTime() - start.getTime() > 366 * 86400000) throw fail('La durée ne peut pas dépasser 366 jours.');
    return { startsAt: start.toISOString(), endsAt: end.toISOString() };
  }
  _safeAd(row) {
    if (!row) return null;
    const safe = { id: row.id, storeId: row.storeId ?? row.store_id, merchantId: row.merchantId ?? row.merchant_id,
      title: row.title, message: row.message || '', imageUrl: row.imageUrl ?? row.image_url ?? '',
      startsAt: row.startsAt ?? row.starts_at, endsAt: row.endsAt ?? row.ends_at, destination: row.destination || '',
      ctaLabel: row.ctaLabel ?? row.cta_label ?? 'Découvrir', displayFormat: row.displayFormat ?? row.display_format ?? 'card',
      direction: row.direction || 'ltr', speed: Math.max(5, Math.min(60, Number(row.speed) || 30)), style: row.style || 'standard',
      placement: row.placement || 'after_intro', status: row.status, archivedAt: row.archivedAt ?? row.archived_at ?? null,
      createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at };
    if (row.clickUrl) safe.clickUrl = row.clickUrl;
    if (row.storeSlug) safe.storeSlug = row.storeSlug;
    const impressions = row.impressionCount ?? row.impression_count;
    const clicks = row.clickCount ?? row.click_count;
    if (impressions != null) safe.impressionCount = Number(impressions) || 0;
    if (clicks != null) safe.clickCount = Number(clicks) || 0;
    return safe;
  }
  _safeServicePoint(row) {
    if (!row) return null;
    return { id: row.id, storeId: row.storeId ?? row.store_id, type: row.type ?? row.pointType ?? row.point_type,
      name: row.name, zone: row.zone || '', instructions: row.instructions || '', publicCode: row.publicCode ?? row.public_code,
      status: row.status, qrScanCount: Number(row.qrScanCount ?? row.qr_scan_count) || 0,
      createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at };
  }
  _safeCampaign(row) {
    if (!row) return null;
    return { id: row.id, storeId: row.storeId ?? row.store_id, merchantId: row.merchantId ?? row.merchant_id,
      title: row.title, description: row.description || '', startsAt: row.startsAt ?? row.starts_at, endsAt: row.endsAt ?? row.ends_at,
      entryFeeXof: 0, maxParticipants: Number(row.maxParticipants ?? row.max_participants) || 0,
      remainingParticipants: Number(row.remainingParticipants ?? row.remaining_participants) || 0, status: row.status,
      authorizationReference: row.authorizationReference ?? row.regulatory_authorization_reference ?? '',
      authorizationStatus: row.authorizationStatus ?? row.regulatory_authorization_status ?? ((row.authorizationReference ?? row.regulatory_authorization_reference) ? 'pending' : 'not_submitted'),
      authorizationReviewedAt: row.authorizationReviewedAt ?? row.regulatory_authorization_reviewed_at ?? null,
      authorizationReviewedBy: row.authorizationReviewedBy ?? row.regulatory_authorization_reviewed_by ?? '',
      authorizationReviewNote: row.authorizationReviewNote ?? row.regulatory_authorization_review_note ?? '',
      servicePointId: row.servicePointId ?? row.service_point_id ?? null, servicePointName: row.servicePointName ?? row.service_point_name ?? '',
      participantCount: Number(row.participantCount ?? row.participant_count) || 0, redeemedCount: Number(row.redeemedCount ?? row.redeemed_count) || 0,
      createdAt: row.createdAt ?? row.created_at, prizes: clone(row.prizes || []) };
  }
  _safeClaim(row) {
    if (!row) return null;
    return { id: row.id, campaignId: row.campaignId ?? row.campaign_id, storeId: row.storeId ?? row.store_id,
      codeLast4: row.codeLast4 ?? row.code_last4, prizeLabel: row.prizeLabel ?? row.prize_label,
      status: row.status, issuedAt: row.issuedAt ?? row.issued_at, expiresAt: row.expiresAt ?? row.expires_at,
      redeemedAt: row.redeemedAt ?? row.redeemed_at };
  }
  _safeGiftCard(row) {
    if (!row) return null;
    return { id: row.id, storeId: row.storeId ?? row.store_id, merchantId: row.merchantId ?? row.merchant_id,
      codeLast4: row.codeLast4 ?? row.code_last4, faceValueXof: Number(row.faceValueXof ?? row.face_value_xof) || 0,
      balanceXof: Number(row.balanceXof ?? row.balance_xof) || 0, status: row.status,
      activatedAt: row.activatedAt ?? row.activated_at ?? null, createdAt: row.createdAt ?? row.created_at };
  }

  async searchPublicCatalog(query, { limit = 20 } = {}) {
    const q = text(query, 80); const needle = fold(q); const safeLimit = Math.max(1, Math.min(30, Number(limit) || 20));
    if (needle.length < 2) return { q, stores: [], products: [], totalStores: 0, totalProducts: 0 };
    if (this.pg) {
      const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
      const storeRows = await this.base.pool.query(
        `SELECT s.id, s.slug, s.name, s.description, s.logo, s.cover_image_url AS "coverImageUrl", s.sector, s.address,
          s.phone, s.whatsapp, s.theme,
          (SELECT COUNT(*)::int FROM merchant_products p WHERE p.store_id=s.id AND p.status='active' AND (p.track_stock=FALSE OR p.stock_quantity>0)) AS "productCount"
         FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id
         WHERE s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL AND
          (s.name ILIKE $1 ESCAPE '\\' OR s.description ILIKE $1 ESCAPE '\\' OR s.address ILIKE $1 ESCAPE '\\' OR EXISTS (
            SELECT 1 FROM merchant_products p WHERE p.store_id=s.id AND p.status='active' AND
              (p.name ILIKE $1 ESCAPE '\\' OR p.description ILIKE $1 ESCAPE '\\' OR p.category ILIKE $1 ESCAPE '\\')))
         ORDER BY s.name LIMIT $2`, [like, safeLimit]);
      const productRows = await this.base.pool.query(
        `SELECT p.id, p.name, p.description, p.price_xof AS "priceXof", p.category, p.image_data AS "imageData", p.image_urls AS "imageUrls",
          s.slug AS "storeSlug", s.name AS "storeName", s.sector
         FROM merchant_products p JOIN merchant_stores s ON s.id=p.store_id JOIN merchant_accounts m ON m.id=s.merchant_id
         WHERE s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL AND p.status='active' AND
          (p.track_stock=FALSE OR p.stock_quantity>0) AND (p.name ILIKE $1 ESCAPE '\\' OR p.description ILIKE $1 ESCAPE '\\' OR p.category ILIKE $1 ESCAPE '\\')
         ORDER BY p.name LIMIT $2`, [like, safeLimit]);
      return { q, stores: storeRows.rows, products: productRows.rows.map((row) => ({ ...row, imageUrls: Array.isArray(row.imageUrls) ? row.imageUrls : [] })),
        totalStores: storeRows.rowCount, totalProducts: productRows.rowCount };
    }
    const activeStores = this.base.state.merchantStores.filter((store) => store.status === 'active' && store.isPublished &&
      this.base.state.merchants.some((merchant) => merchant.id === store.merchantId && merchant.status === 'active' && !merchant.deletedAt));
    const products = this.base.state.merchantProducts.filter((product) => product.status === 'active' && (!product.trackStock || Number(product.stockQuantity) > 0));
    const matches = (value) => fold(value).includes(needle);
    const stores = activeStores.filter((store) => matches([store.name, store.description, store.address].join(' ')) ||
      products.some((product) => product.storeId === store.id && matches([product.name, product.description, product.category].join(' '))))
      .slice(0, safeLimit).map((store) => ({ id: store.id, slug: store.slug, name: store.name, description: store.description || '', logo: store.logo || '',
        coverImageUrl: store.coverImageUrl || '', sector: store.sector || 'general', address: store.address || '', phone: store.phone || '', whatsapp: store.whatsapp || '',
        theme: clone(store.theme || {}), productCount: products.filter((product) => product.storeId === store.id).length }));
    const foundProducts = products.filter((product) => activeStores.some((store) => store.id === product.storeId) && matches([product.name, product.description, product.category].join(' ')))
      .slice(0, safeLimit).map((product) => {
        const store = activeStores.find((item) => item.id === product.storeId);
        return { id: product.id, name: product.name, description: product.description || '', priceXof: Number(product.priceXof) || 0,
          category: product.category || '', imageData: product.imageData || '', imageUrls: clone(product.imageUrls || []), storeSlug: store.slug, storeName: store.name, sector: store.sector || 'general' };
      });
    return { q, stores, products: foundProducts, totalStores: stores.length, totalProducts: foundProducts.length };
  }

  _adFields(alias = '') {
    const c = alias ? `${alias}.` : '';
    return `${c}id,${c}store_id AS "storeId",${c}merchant_id AS "merchantId",${c}title,${c}message,${c}image_url AS "imageUrl",${c}destination,${c}cta_label AS "ctaLabel",${c}display_format AS "displayFormat",${c}direction,${c}speed,${c}style,${c}placement,${c}starts_at AS "startsAt",${c}ends_at AS "endsAt",${c}status,${c}archived_at AS "archivedAt",${c}created_at AS "createdAt",${c}updated_at AS "updatedAt"`;
  }
  async listAdCampaigns(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT ${this._adFields('c')},
        (SELECT COUNT(*)::int FROM merchant_ad_events e WHERE e.campaign_id=c.id AND e.event_type='impression') AS "impressionCount",
        (SELECT COUNT(*)::int FROM merchant_ad_events e WHERE e.campaign_id=c.id AND e.event_type='click') AS "clickCount"
        FROM merchant_ad_campaigns c WHERE c.store_id=$1 ORDER BY c.created_at DESC LIMIT 200`, [storeId]);
      return rows.map((row) => this._safeAd(row));
    }
    return this.base.state.merchantAdCampaigns.filter((row) => row.storeId === storeId).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,200)
      .map((row) => { const events=this.base.state.merchantAdEvents.filter((event)=>event.campaignId===row.id); return this._safeAd({ ...row,
        impressionCount:events.filter((event)=>event.eventType==='impression').length, clickCount:events.filter((event)=>event.eventType==='click').length }); });
  }
  async listAdminAdCampaigns() {
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT ${this._adFields('c')},s.name AS "storeName",s.slug AS "storeSlug",m.username AS "merchantUsername",m.display_name AS "merchantDisplayName",
        (SELECT COUNT(*)::int FROM merchant_ad_events e WHERE e.campaign_id=c.id AND e.event_type='impression') AS "impressionCount",
        (SELECT COUNT(*)::int FROM merchant_ad_events e WHERE e.campaign_id=c.id AND e.event_type='click') AS "clickCount"
        FROM merchant_ad_campaigns c JOIN merchant_stores s ON s.id=c.store_id JOIN merchant_accounts m ON m.id=c.merchant_id
        ORDER BY c.created_at DESC LIMIT 1000`);
      return rows.map((row)=>({ ...this._safeAd(row), storeName:row.storeName,storeSlug:row.storeSlug,merchantUsername:row.merchantUsername,merchantDisplayName:row.merchantDisplayName }));
    }
    return this.base.state.merchantAdCampaigns.slice().sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,1000).map((row)=>{
      const store=this.base.state.merchantStores.find((item)=>item.id===row.storeId)||{};const merchant=this.base.state.merchants.find((item)=>item.id===row.merchantId)||{};
      const events=this.base.state.merchantAdEvents.filter((event)=>event.campaignId===row.id);
      return { ...this._safeAd({...row,impressionCount:events.filter((event)=>event.eventType==='impression').length,clickCount:events.filter((event)=>event.eventType==='click').length}),
        storeName:store.name||'',storeSlug:store.slug||'',merchantUsername:merchant.username||'',merchantDisplayName:merchant.displayName||'' };
    });
  }
  async listPublicAds(storeId, { limit = 5 } = {}) {
    const now = Date.now(); const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT ${this._adFields('c')},s.slug AS "storeSlug"
         FROM merchant_ad_campaigns c JOIN merchant_stores s ON s.id=c.store_id JOIN merchant_accounts m ON m.id=c.merchant_id
         WHERE c.store_id=$1 AND c.status='active' AND c.archived_at IS NULL AND c.starts_at<=NOW() AND c.ends_at>NOW()
           AND s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL
         ORDER BY c.starts_at DESC LIMIT $2`, [storeId, safeLimit]);
      return rows.map((row) => this._safeAd({ ...row, destination:row.destination||`/shop/${encodeURIComponent(row.storeSlug)}`, clickUrl:`/ad/${encodeURIComponent(row.id)}` }));
    }
    const store = this.base.state.merchantStores.find((row) => row.id === storeId && row.status === 'active' && row.isPublished);
    const merchant = store && this.base.state.merchants.find((row)=>row.id===store.merchantId&&row.status==='active'&&!row.deletedAt);
    if (!store || !merchant) return [];
    return this.base.state.merchantAdCampaigns.filter((row) => row.storeId === storeId && row.status === 'active' && !row.archivedAt && Date.parse(row.startsAt) <= now && Date.parse(row.endsAt) > now)
      .sort((a,b) => String(b.startsAt).localeCompare(String(a.startsAt))).slice(0, safeLimit)
      .map((row) => this._safeAd({ ...row, destination:row.destination||`/shop/${encodeURIComponent(store.slug)}`, clickUrl:`/ad/${encodeURIComponent(row.id)}` }));
  }
  async getPublicAdForClick(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT ${this._adFields('c')},s.slug AS "storeSlug"
        FROM merchant_ad_campaigns c JOIN merchant_stores s ON s.id=c.store_id JOIN merchant_accounts m ON m.id=c.merchant_id
        WHERE c.id=$1 AND c.status='active' AND c.archived_at IS NULL AND c.starts_at<=NOW() AND c.ends_at>NOW()
          AND s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL`, [id]);
      const row=rows[0];return row?this._safeAd({...row,destination:row.destination||`/shop/${encodeURIComponent(row.storeSlug)}`}):null;
    }
    const row=this.base.state.merchantAdCampaigns.find((item)=>item.id===id&&item.status==='active'&&!item.archivedAt&&Date.parse(item.startsAt)<=Date.now()&&Date.parse(item.endsAt)>Date.now());
    if(!row)return null;const store=this.base.state.merchantStores.find((item)=>item.id===row.storeId&&item.status==='active'&&item.isPublished);
    const merchant=store&&this.base.state.merchants.find((item)=>item.id===store.merchantId&&item.status==='active'&&!item.deletedAt);
    return store&&merchant?this._safeAd({...row,destination:row.destination||`/shop/${encodeURIComponent(store.slug)}`,storeSlug:store.slug}):null;
  }
  async recordAdEvent({ campaignId, eventType, eventId, storeSlug = '' } = {}) {
    if(!['impression','click'].includes(eventType)||!REQUEST_RE.test(String(eventId||'')))throw fail('Événement publicitaire invalide.');
    const ad=await this.getPublicAdForClick(campaignId);if(!ad|| (storeSlug&&ad.storeSlug!==storeSlug))return null;
    const eventHash=this._hash(`ad-event-${eventType}`,eventId);const id=uuid();const createdAt=new Date().toISOString();
    if(this.pg){
      const {rows}=await this.base.pool.query(`INSERT INTO merchant_ad_events (id,campaign_id,store_id,event_type,event_hash) VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (campaign_id,event_type,event_hash) DO NOTHING RETURNING id`,[id,campaignId,ad.storeId,eventType,eventHash]);
      return {campaignId,eventType,recorded:Boolean(rows[0])};
    }
    return this._lock(async()=>{
      if(this.base.state.merchantAdEvents.some((row)=>row.campaignId===campaignId&&row.eventType===eventType&&row.eventHash===eventHash))return {campaignId,eventType,recorded:false};
      this.base.state.merchantAdEvents.push({id,campaignId,storeId:ad.storeId,eventType,eventHash,createdAt});await this.base.save();return {campaignId,eventType,recorded:true};
    });
  }
  _normalizeAdInput(input, storeSlug) {
    const title=text(input?.title,100);if(title.length<3)throw fail('Le titre de la publicité doit contenir au moins 3 caractères.');
    const message=text(input?.message,300);const {startsAt,endsAt}=this._validWindow(input?.startsAt,input?.endsAt);
    const rawDestination=text(input?.destination,500);let destination=rawDestination;
    if(!destination)destination=`/shop/${encodeURIComponent(storeSlug||'')}`;
    if(destination.startsWith('/')){if(destination.startsWith('//')||/[\\\r\n]/.test(destination))throw fail('La destination interne de la publicité est invalide.');}
    else {let parsed;try{parsed=new URL(destination);}catch(_){throw fail('Saisissez une destination HTTPS valide.');}
      if(parsed.protocol!=='https:'||parsed.username||parsed.password)throw fail('La destination externe doit être une URL HTTPS publique sans identifiants.');destination=parsed.toString();}
    const ctaLabel=text(input?.ctaLabel||'Découvrir',50);if(!ctaLabel)throw fail('Le libellé du bouton est obligatoire.');
    const displayFormat=text(input?.displayFormat||'card',20);if(!AD_FORMATS.has(displayFormat))throw fail('Choisissez un format publicitaire valide.');
    const direction=text(input?.direction||'ltr',8);if(!AD_DIRECTIONS.has(direction))throw fail('Choisissez un sens de défilement valide.');
    const speed=Number(input?.speed??30);if(!Number.isSafeInteger(speed)||speed<5||speed>60)throw fail('La vitesse du bandeau doit être comprise entre 5 et 60.');
    const style=text(input?.style||'standard',20);if(!AD_STYLES.has(style))throw fail('Choisissez un style publicitaire valide.');
    const placement=text(input?.placement||'after_intro',30);if(!AD_PLACEMENTS.has(placement))throw fail('Choisissez un emplacement publicitaire valide.');
    const status=text(input?.status||'draft',20);if(!['draft','active','paused'].includes(status))throw fail('Statut de publicité invalide.');
    return {title,message,startsAt,endsAt,destination,ctaLabel,displayFormat,direction,speed,style,placement,status};
  }
  async saveAdCampaign(storeId, merchantId, input, id = '') {
    const store=await this.commerce.getStoreById(storeId);if(!store||store.merchantId!==merchantId)throw fail('Boutique introuvable pour cette publicité.');
    const normalized=this._normalizeAdInput(input,store.slug);
    let imageUrl=text(input?.imageUrl,120);
    if(imageUrl){const match=AD_MEDIA_RE.exec(imageUrl);if(!match)throw fail('L’image doit provenir de la médiathèque de cette boutique.');
      const media=await this.commerce.getMedia(match[1]);if(!media||media.merchantId!==merchantId||!/^image\/(?:png|jpe?g|webp)$/i.test(media.mimeType))throw fail('Cette image n’appartient pas à cette boutique ou son format est interdit.');imageUrl=`/media/merchant/${match[1]}`;}
    const {title,message,startsAt,endsAt,destination,ctaLabel,displayFormat,direction,speed,style,placement,status}=normalized;
    const now=new Date().toISOString();let requestHash='';let intentHash='';
    if(!id&&input?.requestId){const requestId=text(input.requestId,100);if(!REQUEST_RE.test(requestId))throw fail('Identifiant de création invalide; actualisez puis réessayez.');
      requestHash=this._hash('ad-create-request',requestId);intentHash=crypto.createHash('sha256').update(JSON.stringify({storeId,title,message,imageUrl,destination,ctaLabel,displayFormat,direction,speed,style,placement,startsAt:text(input?.startsAt,100),endsAt:text(input?.endsAt,100),status})).digest('hex');}
    if(this.pg){
      const client=this.base.pool;const fields='id,store_id AS "storeId",merchant_id AS "merchantId",title,message,image_url AS "imageUrl",destination,cta_label AS "ctaLabel",display_format AS "displayFormat",direction,speed,style,placement,starts_at AS "startsAt",ends_at AS "endsAt",status,archived_at AS "archivedAt",created_at AS "createdAt",updated_at AS "updatedAt"';
      if(id){const {rows}=await client.query(`UPDATE merchant_ad_campaigns SET title=$3,message=$4,image_url=$5,destination=$6,cta_label=$7,display_format=$8,direction=$9,speed=$10,style=$11,placement=$12,starts_at=$13::timestamptz,ends_at=$14::timestamptz,status=$15,updated_at=NOW()
          WHERE id=$1 AND store_id=$2 AND archived_at IS NULL AND status<>'archived' RETURNING ${fields}`,
          [id,storeId,title,message,imageUrl,destination,ctaLabel,displayFormat,direction,speed,style,placement,startsAt,endsAt,status]);return this._safeAd(rows[0]||null);}
      if(requestHash){const existing=await client.query(`SELECT ${fields},create_intent_hash AS "createIntentHash" FROM merchant_ad_campaigns WHERE store_id=$1 AND create_request_hash=$2`,[storeId,requestHash]);
        if(existing.rows[0]){if(existing.rows[0].createIntentHash!==intentHash)throw fail('Cet identifiant a déjà servi à une autre publicité.','IDEMPOTENCY_CONFLICT');return {...this._safeAd(existing.rows[0]),idempotent:true};}}
      try{const {rows}=await client.query(`INSERT INTO merchant_ad_campaigns (id,store_id,merchant_id,title,message,image_url,destination,cta_label,display_format,direction,speed,style,placement,starts_at,ends_at,status,create_request_hash,create_intent_hash)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::timestamptz,$15::timestamptz,$16,$17,$18) RETURNING ${fields}`,
        [uuid(),storeId,merchantId,title,message,imageUrl,destination,ctaLabel,displayFormat,direction,speed,style,placement,startsAt,endsAt,status,requestHash||null,intentHash||null]);return {...this._safeAd(rows[0]),idempotent:false};}
      catch(error){if(error.code!=='23505'||!requestHash)throw error;
        const existing=await client.query(`SELECT ${fields},create_intent_hash AS "createIntentHash" FROM merchant_ad_campaigns WHERE store_id=$1 AND create_request_hash=$2`,[storeId,requestHash]);
        if(!existing.rows[0])throw error;if(existing.rows[0].createIntentHash!==intentHash)throw fail('Cet identifiant a déjà servi à une autre publicité.','IDEMPOTENCY_CONFLICT');return {...this._safeAd(existing.rows[0]),idempotent:true};}
    }
    return this._lock(async()=>{
      const collection=this.base.state.merchantAdCampaigns;let row=id?collection.find((item)=>item.id===id&&item.storeId===storeId&&!item.archivedAt&&item.status!=='archived'):null;
      if(id&&!row)return null;
      if(!id&&requestHash){row=collection.find((item)=>item.storeId===storeId&&item.createRequestHash===requestHash);
        if(row){if(row.createIntentHash!==intentHash)throw fail('Cet identifiant a déjà servi à une autre publicité.','IDEMPOTENCY_CONFLICT');return {...this._safeAd(row),idempotent:true};}}
      if(row)Object.assign(row,{title,message,imageUrl,destination,ctaLabel,displayFormat,direction,speed,style,placement,startsAt,endsAt,status,updatedAt:now});
      else{row={id:uuid(),storeId,merchantId,title,message,imageUrl,destination,ctaLabel,displayFormat,direction,speed,style,placement,startsAt,endsAt,status,archivedAt:null,createRequestHash:requestHash,createIntentHash:intentHash,createdAt:now,updatedAt:now};collection.push(row);}
      await this.base.save();return {...this._safeAd(row),idempotent:false};
    });
  }
  async setAdStatus(storeId,id,status) {
    if(!['active','paused','draft'].includes(status))throw fail('Statut de publicité invalide.');
    if(this.pg){const {rows}=await this.base.pool.query(`UPDATE merchant_ad_campaigns SET status=$3,updated_at=NOW() WHERE id=$1 AND store_id=$2 AND archived_at IS NULL AND status<>'archived' RETURNING ${this._adFields()}`,[id,storeId,status]);return this._safeAd(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.merchantAdCampaigns.find((item)=>item.id===id&&item.storeId===storeId&&!item.archivedAt&&item.status!=='archived');if(!row)return null;row.status=status;row.updatedAt=new Date().toISOString();await this.base.save();return this._safeAd(row);});
  }
  async setAdminAdStatus(id,status) {
    if(!['active','paused','draft'].includes(status))throw fail('Statut de publicité invalide.');
    if(this.pg){const {rows}=await this.base.pool.query(`UPDATE merchant_ad_campaigns SET status=$2,updated_at=NOW() WHERE id=$1 AND archived_at IS NULL AND status<>'archived' RETURNING ${this._adFields()}`,[id,status]);return this._safeAd(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.merchantAdCampaigns.find((item)=>item.id===id&&!item.archivedAt&&item.status!=='archived');if(!row)return null;row.status=status;row.updatedAt=new Date().toISOString();await this.base.save();return this._safeAd(row);});
  }
  async archiveAdCampaign(storeId,id) {
    const now=new Date().toISOString();
    if(this.pg){const {rows}=await this.base.pool.query(`UPDATE merchant_ad_campaigns SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND store_id=$2 AND archived_at IS NULL RETURNING ${this._adFields()}`,[id,storeId]);return this._safeAd(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.merchantAdCampaigns.find((item)=>item.id===id&&item.storeId===storeId&&!item.archivedAt);if(!row)return null;row.status='archived';row.archivedAt=now;row.updatedAt=now;await this.base.save();return this._safeAd(row);});
  }
  async archiveAdminAdCampaign(id) {
    const now=new Date().toISOString();
    if(this.pg){const {rows}=await this.base.pool.query(`UPDATE merchant_ad_campaigns SET status='archived',archived_at=NOW(),updated_at=NOW() WHERE id=$1 AND archived_at IS NULL RETURNING ${this._adFields()}`,[id]);return this._safeAd(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.merchantAdCampaigns.find((item)=>item.id===id&&!item.archivedAt);if(!row)return null;row.status='archived';row.archivedAt=now;row.updatedAt=now;await this.base.save();return this._safeAd(row);});
  }

  async listServicePoints(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id,store_id AS "storeId",point_type AS type,name,zone,instructions,public_code AS "publicCode",status,qr_scan_count AS "qrScanCount",created_at AS "createdAt",updated_at AS "updatedAt" FROM merchant_service_points WHERE store_id=$1 ORDER BY created_at DESC', [storeId]);
      return rows.map((row) => this._safeServicePoint(row));
    }
    return this.base.state.merchantServicePoints.filter((row) => row.storeId === storeId).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).map((row) => this._safeServicePoint(row));
  }
  async createServicePoint(storeId, input) {
    const type = text(input?.type || 'table', 20); if (!['table','counter','location'].includes(type)) throw fail('Choisissez un type d’emplacement valide.');
    const name = text(input?.name, 80); if (name.length < 1) throw fail('Le nom de la table ou de l’emplacement est obligatoire.');
    const zone = text(input?.zone, 120); const instructions = text(input?.instructions, 200); let requestHash = ''; let intentHash = '';
    if (input?.requestId) {
      const requestId = text(input.requestId, 100); if (!REQUEST_RE.test(requestId)) throw fail('Identifiant de création invalide; actualisez puis réessayez.');
      requestHash = this._hash('service-point-create-request', requestId);
      intentHash = crypto.createHash('sha256').update(JSON.stringify({ storeId, type, name, zone, instructions })).digest('hex');
    }
    if (this.pg) {
      if (requestHash) {
        const existing = await this.base.pool.query('SELECT id,store_id AS "storeId",point_type AS type,name,zone,instructions,public_code AS "publicCode",status,qr_scan_count AS "qrScanCount",created_at AS "createdAt",updated_at AS "updatedAt",create_intent_hash AS "createIntentHash" FROM merchant_service_points WHERE store_id=$1 AND create_request_hash=$2', [storeId, requestHash]);
        if (existing.rows[0]) { if (existing.rows[0].createIntentHash !== intentHash) throw fail('Cet identifiant a déjà servi à un autre QR d’emplacement.', 'IDEMPOTENCY_CONFLICT'); return { ...this._safeServicePoint(existing.rows[0]), idempotent:true }; }
      }
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const code = this._code('T');
        try {
          const { rows } = await this.base.pool.query('INSERT INTO merchant_service_points (id,store_id,point_type,name,zone,instructions,public_code,status,create_request_hash,create_intent_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,\'active\',$8,$9) RETURNING id,store_id AS "storeId",point_type AS type,name,zone,instructions,public_code AS "publicCode",status,qr_scan_count AS "qrScanCount",created_at AS "createdAt",updated_at AS "updatedAt"', [uuid(), storeId, type, name, zone, instructions, code, requestHash || null, intentHash || null]);
          return { ...this._safeServicePoint(rows[0]), idempotent:false };
        } catch (error) {
          if (error.code === '23505' && requestHash) {
            const existing = await this.base.pool.query('SELECT id,store_id AS "storeId",point_type AS type,name,zone,instructions,public_code AS "publicCode",status,qr_scan_count AS "qrScanCount",created_at AS "createdAt",updated_at AS "updatedAt",create_intent_hash AS "createIntentHash" FROM merchant_service_points WHERE store_id=$1 AND create_request_hash=$2', [storeId, requestHash]);
            if (existing.rows[0]) { if (existing.rows[0].createIntentHash !== intentHash) throw fail('Cet identifiant a déjà servi à un autre QR d’emplacement.', 'IDEMPOTENCY_CONFLICT'); return { ...this._safeServicePoint(existing.rows[0]), idempotent:true }; }
          }
          if (error.code !== '23505' || attempt === 3) throw error;
        }
      }
    }
    return this._lock(async () => {
      if (requestHash) {
        const existing = this.base.state.merchantServicePoints.find((row) => row.storeId === storeId && row.createRequestHash === requestHash);
        if (existing) { if (existing.createIntentHash !== intentHash) throw fail('Cet identifiant a déjà servi à un autre QR d’emplacement.', 'IDEMPOTENCY_CONFLICT'); return { ...this._safeServicePoint(existing), idempotent:true }; }
      }
      let code = this._code('T'); while (this.base.state.merchantServicePoints.some((row) => row.publicCode === code)) code = this._code('T');
      const now = new Date().toISOString(); const row = { id: uuid(), storeId, type, name, zone, instructions, publicCode: code, status: 'active', qrScanCount: 0, createRequestHash:requestHash, createIntentHash:intentHash, createdAt: now, updatedAt: now };
      this.base.state.merchantServicePoints.push(row); await this.base.save(); return { ...this._safeServicePoint(row), idempotent:false };
    });
  }
  async updateServicePoint(storeId, id, input) {
    const type = text(input?.type || 'table', 20); if (!['table','counter','location'].includes(type)) throw fail('Choisissez un type d’emplacement valide.');
    const name = text(input?.name, 80); if (!name) throw fail('Le nom de la table ou de l’emplacement est obligatoire.');
    const zone = text(input?.zone, 120); const instructions = text(input?.instructions, 200); const status = ['active','inactive'].includes(input?.status) ? input.status : 'active';
    if (this.pg) {
      const { rows } = await this.base.pool.query('UPDATE merchant_service_points SET point_type=$3,name=$4,zone=$5,instructions=$6,status=$7,updated_at=NOW() WHERE id=$1 AND store_id=$2 RETURNING id,store_id AS "storeId",point_type AS type,name,zone,instructions,public_code AS "publicCode",status,qr_scan_count AS "qrScanCount",created_at AS "createdAt",updated_at AS "updatedAt"', [id, storeId, type, name, zone, instructions, status]);
      return this._safeServicePoint(rows[0] || null);
    }
    return this._lock(async () => { const row = this.base.state.merchantServicePoints.find((item) => item.id === id && item.storeId === storeId); if (!row) return null;
      Object.assign(row, { type, name, zone, instructions, status, updatedAt: new Date().toISOString() }); await this.base.save(); return this._safeServicePoint(row); });
  }
  async getPublicServicePointByCode(code) {
    if (!code || String(code).length > 100) return null;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT p.id,p.store_id AS "storeId",p.point_type AS type,p.name,p.zone,p.instructions,p.public_code AS "publicCode",p.status,p.qr_scan_count AS "qrScanCount",
          p.created_at AS "createdAt",p.updated_at AS "updatedAt",s.slug AS "storeSlug",s.name AS "storeName",s.sector
         FROM merchant_service_points p JOIN merchant_stores s ON s.id=p.store_id JOIN merchant_accounts m ON m.id=s.merchant_id
         WHERE p.public_code=$1 AND p.status='active' AND s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL`, [code]);
      return rows[0] ? this._safeServicePoint(rows[0]) && { ...this._safeServicePoint(rows[0]), storeSlug: rows[0].storeSlug, storeName: rows[0].storeName, sector: rows[0].sector } : null;
    }
    const point = this.base.state.merchantServicePoints.find((row) => row.publicCode === code && row.status === 'active');
    if (!point) return null;
    const store = this.base.state.merchantStores.find((row) => row.id === point.storeId && row.status === 'active' && row.isPublished);
    const merchant = store && this.base.state.merchants.find((row) => row.id === store.merchantId && row.status === 'active' && !row.deletedAt);
    return store && merchant ? { ...this._safeServicePoint(point), storeSlug: store.slug, storeName: store.name, sector: store.sector || 'general' } : null;
  }
  async getServicePointForOrder(storeId, code) {
    if (!code) return null;
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id,store_id AS "storeId",point_type AS type,name,zone,instructions,public_code AS "publicCode",status FROM merchant_service_points WHERE store_id=$1 AND public_code=$2', [storeId, code]);
      return rows[0] || null;
    }
    const row = this.base.state.merchantServicePoints.find((item) => item.storeId === storeId && item.publicCode === code);
    return clone(row || null);
  }
  async recordServicePointQrScan(id) {
    if (this.pg) { await this.base.pool.query('UPDATE merchant_service_points SET qr_scan_count=qr_scan_count+1,updated_at=NOW() WHERE id=$1', [id]); return; }
    await this._lock(async () => { const row = this.base.state.merchantServicePoints.find((item) => item.id === id); if (!row) return; row.qrScanCount = (Number(row.qrScanCount) || 0) + 1; row.updatedAt = new Date().toISOString(); await this.base.save(); });
  }

  async listRewardCampaigns(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT c.id,c.store_id AS "storeId",c.merchant_id AS "merchantId",c.title,c.description,
        c.starts_at AS "startsAt",c.ends_at AS "endsAt",c.entry_fee_xof AS "entryFeeXof",c.max_participants AS "maxParticipants",
        c.remaining_participants AS "remainingParticipants",c.status,c.regulatory_authorization_reference AS "authorizationReference",
        c.regulatory_authorization_status AS "authorizationStatus",c.regulatory_authorization_reviewed_at AS "authorizationReviewedAt",
        c.regulatory_authorization_reviewed_by AS "authorizationReviewedBy",c.regulatory_authorization_review_note AS "authorizationReviewNote",
        c.service_point_id AS "servicePointId",COALESCE(sp.name,'') AS "servicePointName",
        (SELECT COUNT(*)::int FROM merchant_reward_claims rc WHERE rc.campaign_id=c.id) AS "participantCount",
        (SELECT COUNT(*)::int FROM merchant_reward_claims rc WHERE rc.campaign_id=c.id AND rc.status='redeemed') AS "redeemedCount",
        c.created_at AS "createdAt" FROM merchant_reward_campaigns c LEFT JOIN merchant_service_points sp ON sp.id=c.service_point_id AND sp.store_id=c.store_id
        WHERE c.store_id=$1 ORDER BY c.created_at DESC`, [storeId]);
      for (const row of rows) { const prizes = await this.base.pool.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id', [row.id]); row.prizes = prizes.rows; }
      return rows.map((row) => this._safeCampaign(row));
    }
    return this.base.state.merchantRewardCampaigns.filter((row) => row.storeId === storeId).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map((row) => { const claims=this.base.state.merchantRewardClaims.filter((item)=>item.campaignId===row.id); const point=this.base.state.merchantServicePoints.find((item)=>item.id===row.servicePointId&&item.storeId===storeId);
        return this._safeCampaign({ ...row, servicePointName:point?.name||'', participantCount:claims.length, redeemedCount:claims.filter((item)=>item.status==='redeemed').length,
          prizes: this.base.state.merchantRewardPrizes.filter((item) => item.campaignId === row.id) }); });
  }
  async listRewardAuthorizationRequests() {
    const order = (rows) => rows.sort((a, b) => {
      const priority = { pending:0, approved:1, rejected:2, revoked:3, not_submitted:4 };
      return (priority[a.authorizationStatus] ?? 5) - (priority[b.authorizationStatus] ?? 5) || String(b.createdAt).localeCompare(String(a.createdAt));
    });
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT c.id,c.store_id AS "storeId",c.merchant_id AS "merchantId",c.title,c.description,
        c.starts_at AS "startsAt",c.ends_at AS "endsAt",c.entry_fee_xof AS "entryFeeXof",c.max_participants AS "maxParticipants",
        c.remaining_participants AS "remainingParticipants",c.status,c.regulatory_authorization_reference AS "authorizationReference",
        c.regulatory_authorization_status AS "authorizationStatus",c.regulatory_authorization_reviewed_at AS "authorizationReviewedAt",
        c.regulatory_authorization_reviewed_by AS "authorizationReviewedBy",c.regulatory_authorization_review_note AS "authorizationReviewNote",
        c.service_point_id AS "servicePointId",COALESCE(p.name,'') AS "servicePointName",
        (SELECT COUNT(*)::int FROM merchant_reward_claims rc WHERE rc.campaign_id=c.id) AS "participantCount",
        (SELECT COUNT(*)::int FROM merchant_reward_claims rc WHERE rc.campaign_id=c.id AND rc.status='redeemed') AS "redeemedCount",
        c.created_at AS "createdAt",s.name AS "storeName",s.slug AS "storeSlug",m.username AS "merchantUsername",m.display_name AS "merchantDisplayName"
        FROM merchant_reward_campaigns c JOIN merchant_stores s ON s.id=c.store_id JOIN merchant_accounts m ON m.id=c.merchant_id
        LEFT JOIN merchant_service_points p ON p.id=c.service_point_id AND p.store_id=c.store_id
        WHERE c.regulatory_authorization_reference<>'' ORDER BY c.created_at DESC LIMIT 500`);
      for (const row of rows) {
        const prizes = await this.base.pool.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id', [row.id]);
        row.prizes = prizes.rows;
      }
      return order(rows.map((row) => ({ ...this._safeCampaign(row), storeName:row.storeName, storeSlug:row.storeSlug,
        merchantUsername:row.merchantUsername, merchantDisplayName:row.merchantDisplayName })));
    }
    const rows = this.base.state.merchantRewardCampaigns.filter((row) => String(row.authorizationReference || '').trim());
    return order(rows.map((row) => {
      const store = this.base.state.merchantStores.find((item) => item.id === row.storeId) || {};
      const merchant = this.base.state.merchants.find((item) => item.id === row.merchantId) || {};
      const claims=this.base.state.merchantRewardClaims.filter((item)=>item.campaignId===row.id);const point=this.base.state.merchantServicePoints.find((item)=>item.id===row.servicePointId&&item.storeId===row.storeId);
      return { ...this._safeCampaign({ ...row, servicePointName:point?.name||'', participantCount:claims.length, redeemedCount:claims.filter((item)=>item.status==='redeemed').length,
        prizes:this.base.state.merchantRewardPrizes.filter((item) => item.campaignId === row.id) }),
        storeName:store.name || '', storeSlug:store.slug || '', merchantUsername:merchant.username || '', merchantDisplayName:merchant.displayName || '' };
    }));
  }
  async reviewRewardAuthorization(id, { decision, reviewNote, reviewedBy } = {}) {
    if (!['approved','rejected','revoked'].includes(decision)) throw fail('Décision d’examen d’autorisation invalide.');
    const note = text(reviewNote, 500); if (note.length < 4) throw fail('Ajoutez une note d’examen d’au moins 4 caractères pour l’audit.');
    const reviewer = text(reviewedBy, 120); if (!reviewer) throw fail('L’identité du PDG examinateur est manquante.');
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query('SELECT id,store_id AS "storeId",merchant_id AS "merchantId",regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus" FROM merchant_reward_campaigns WHERE id=$1 FOR UPDATE', [id]);
        const current = found.rows[0]; if (!current) { await client.query('COMMIT'); return null; }
        if (!current.authorizationReference) throw fail('Aucune référence d’autorisation n’a été soumise pour cette offre.');
        if (['approved','rejected'].includes(decision) && current.authorizationStatus !== 'pending') throw fail('Seules les demandes en attente peuvent être approuvées ou refusées.');
        if (decision === 'revoked' && current.authorizationStatus !== 'approved') throw fail('Seule une autorisation déjà approuvée peut être révoquée.');
        const { rows } = await client.query(`UPDATE merchant_reward_campaigns SET regulatory_authorization_status=$2,
          regulatory_authorization_reviewed_at=NOW(),regulatory_authorization_reviewed_by=$3,regulatory_authorization_review_note=$4,
          status='paused',updated_at=NOW()
          WHERE id=$1 RETURNING id,store_id AS "storeId",merchant_id AS "merchantId",title,description,starts_at AS "startsAt",ends_at AS "endsAt",
          entry_fee_xof AS "entryFeeXof",max_participants AS "maxParticipants",remaining_participants AS "remainingParticipants",status,
          regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus",
          regulatory_authorization_reviewed_at AS "authorizationReviewedAt",regulatory_authorization_reviewed_by AS "authorizationReviewedBy",
          regulatory_authorization_review_note AS "authorizationReviewNote",service_point_id AS "servicePointId",created_at AS "createdAt"`, [id,decision,reviewer,note]);
        const prizes = await client.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id', [id]);
        await client.query('COMMIT'); return this._safeCampaign({ ...rows[0], prizes:prizes.rows });
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    }
    return this._lock(async () => {
      const row = this.base.state.merchantRewardCampaigns.find((item) => item.id === id); if (!row) return null;
      if (!String(row.authorizationReference || '').trim()) throw fail('Aucune référence d’autorisation n’a été soumise pour cette offre.');
      if (['approved','rejected'].includes(decision) && row.authorizationStatus !== 'pending') throw fail('Seules les demandes en attente peuvent être approuvées ou refusées.');
      if (decision === 'revoked' && row.authorizationStatus !== 'approved') throw fail('Seule une autorisation déjà approuvée peut être révoquée.');
      row.authorizationStatus = decision; row.authorizationReviewedAt = new Date().toISOString(); row.authorizationReviewedBy = reviewer; row.authorizationReviewNote = note;
      row.status = 'paused';
      await this.base.save(); return this._safeCampaign({ ...row, prizes:this.base.state.merchantRewardPrizes.filter((item) => item.campaignId === row.id) });
    });
  }
  async submitRewardAuthorizationReference(storeId, id, input) {
    const authorizationReference=text(input?.authorizationReference,120);
    if(authorizationReference.length<4)throw fail('Saisissez une référence officielle complète d’au moins 4 caractères.');
    if(input?.authorizationConfirmed!==true)throw fail('Confirmez que la référence correspond à une autorisation réellement délivrée, en vigueur et applicable à cette opération.','AUTHORIZATION_ATTESTATION_REQUIRED');
    if(this.pg){
      const client=await this.base.pool.connect();
      try{
        await client.query('BEGIN');
        const found=await client.query('SELECT id,status,regulatory_authorization_status AS "authorizationStatus" FROM merchant_reward_campaigns WHERE id=$1 AND store_id=$2 FOR UPDATE',[id,storeId]);
        const current=found.rows[0];if(!current){await client.query('COMMIT');return null;}
        if(current.status==='active')throw fail('Mettez d’abord l’offre en pause avant de soumettre une référence.');
        if(current.authorizationStatus==='approved')throw fail('Cette référence est déjà approuvée. Contactez le PDG avant de la remplacer.','AUTHORIZATION_ALREADY_APPROVED');
        const {rows}=await client.query(`UPDATE merchant_reward_campaigns SET regulatory_authorization_reference=$3,regulatory_authorization_status='pending',
          regulatory_authorization_reviewed_at=NULL,regulatory_authorization_reviewed_by='',regulatory_authorization_review_note='',updated_at=NOW()
          WHERE id=$1 AND store_id=$2 RETURNING id,store_id AS "storeId",merchant_id AS "merchantId",title,description,starts_at AS "startsAt",ends_at AS "endsAt",
          entry_fee_xof AS "entryFeeXof",max_participants AS "maxParticipants",remaining_participants AS "remainingParticipants",status,
          regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus",
          regulatory_authorization_reviewed_at AS "authorizationReviewedAt",regulatory_authorization_reviewed_by AS "authorizationReviewedBy",
          regulatory_authorization_review_note AS "authorizationReviewNote",service_point_id AS "servicePointId",created_at AS "createdAt"`,[id,storeId,authorizationReference]);
        const prizes=await client.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id',[id]);
        await client.query('COMMIT');return this._safeCampaign({...rows[0],prizes:prizes.rows});
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
      finally{client.release();}
    }
    return this._lock(async()=>{
      const row=this.base.state.merchantRewardCampaigns.find((item)=>item.id===id&&item.storeId===storeId);if(!row)return null;
      if(row.status==='active')throw fail('Mettez d’abord l’offre en pause avant de soumettre une référence.');
      if(row.authorizationStatus==='approved')throw fail('Cette référence est déjà approuvée. Contactez le PDG avant de la remplacer.','AUTHORIZATION_ALREADY_APPROVED');
      row.authorizationReference=authorizationReference;row.authorizationStatus='pending';row.authorizationReviewedAt=null;row.authorizationReviewedBy='';row.authorizationReviewNote='';row.updatedAt=new Date().toISOString();
      await this.base.save();return this._safeCampaign({...row,prizes:this.base.state.merchantRewardPrizes.filter((item)=>item.campaignId===id)});
    });
  }
  async listPublicRewardCampaigns(storeId, { servicePointId = '' } = {}) {
    const now = Date.now(); const pointId = text(servicePointId, 100);
    const toPublic = (row) => ({ id: row.id, title: row.title, description: row.description || '', startsAt: row.startsAt, endsAt: row.endsAt,
      remainingParticipants: Number(row.remainingParticipants) || 0, participationFeeXof: 0, authorizationReference: row.authorizationReference || '',
      servicePointId: row.servicePointId || null, servicePointName: row.servicePointName || '',
      rules: `Participation gratuite, sans achat ni paiement. Une participation par numéro et dans la limite des stocks. ${row.servicePointId ? `Offre proposée uniquement à ${row.servicePointName || 'l’emplacement associé'}; scannez son QR actif.` : 'Offre générale de la boutique.'} Référence déclarée et présentée au PDG pour examen hors plateforme : ${row.authorizationReference || 'non communiquée'}. Oymike QR ne vérifie pas directement l’autorisation auprès de l’ARJH.` });
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT c.id,c.title,c.description,c.starts_at AS "startsAt",c.ends_at AS "endsAt",
        c.remaining_participants AS "remainingParticipants",c.regulatory_authorization_reference AS "authorizationReference",
        c.service_point_id AS "servicePointId",COALESCE(p.name,'') AS "servicePointName"
        FROM merchant_reward_campaigns c LEFT JOIN merchant_service_points p ON p.id=c.service_point_id AND p.store_id=c.store_id
        WHERE c.store_id=$1 AND (c.service_point_id IS NULL OR (c.service_point_id=NULLIF($2,'') AND p.store_id=c.store_id AND p.status='active'))
          AND c.status='active' AND c.regulatory_authorization_status='approved' AND c.regulatory_authorization_reference<>''
          AND c.entry_fee_xof=0 AND c.remaining_participants>0 AND c.starts_at<=NOW() AND c.ends_at>NOW()
        ORDER BY c.starts_at LIMIT 5`, [storeId, pointId]);
      return rows.map(toPublic);
    }
    return this.base.state.merchantRewardCampaigns.filter((row) => row.storeId === storeId &&
      (!row.servicePointId || row.servicePointId === pointId) && row.status === 'active' && row.authorizationStatus === 'approved' &&
      String(row.authorizationReference || '').trim() && row.entryFeeXof === 0 && Number(row.remainingParticipants) > 0 &&
      Date.parse(row.startsAt) <= now && Date.parse(row.endsAt) > now &&
      (!row.servicePointId || this.base.state.merchantServicePoints.some((point) => point.id === row.servicePointId && point.storeId === storeId && point.status === 'active')))
      .slice(0, 5).map((row) => { const point = this.base.state.merchantServicePoints.find((item) => item.id === row.servicePointId && item.storeId === storeId); return toPublic({ ...row, servicePointName: point?.name || '' }); });
  }
  async createRewardCampaign(storeId, merchantId, input) {
    if (input?.complianceAccepted !== true) throw fail('Confirmez la gratuité totale de la participation et l’absence de lots en espèces.');
    if (input?.entryFeeXof != null && Number(input.entryFeeXof) !== 0) throw fail('La participation doit rester gratuite (0 XOF).');
    const title = text(input?.title, 100); if (title.length < 3) throw fail('Le titre de l’offre doit contenir au moins 3 caractères.');
    const description = text(input?.description, 500); const maxParticipants = Number(input?.maxParticipants);
    if (!Number.isSafeInteger(maxParticipants) || maxParticipants < 1 || maxParticipants > 10000) throw fail('La capacité doit être un entier compris entre 1 et 10 000.');
    const { startsAt, endsAt } = this._validWindow(input?.startsAt, input?.endsAt, { defaultDurationDays: 14 });
    const authorizationReference=text(input?.authorizationReference,120);
    if(authorizationReference&&authorizationReference.length<4)throw fail('La référence d’autorisation ARJH est trop courte.');
    if(authorizationReference&&input?.authorizationConfirmed!==true)throw fail('Confirmez que cette référence correspond à une autorisation préalable réellement délivrée pour cette opération.','AUTHORIZATION_ATTESTATION_REQUIRED');
    if(input?.status==='active')throw fail('Une offre marchande est toujours créée en pause. Le PDG doit d’abord examiner la preuve d’autorisation, puis le marchand pourra l’activer.','AUTHORIZATION_REQUIRED');
    const status = 'paused';
    const authorizationStatus = authorizationReference ? 'pending' : 'not_submitted';
    const servicePointId = text(input?.servicePointId, 100);
    if (!Array.isArray(input?.prizes) || input.prizes.length < 1 || input.prizes.length > 10) throw fail('Définissez de 1 à 10 résultats (bénéfices ou « pas de lot »).');
    const prizes = input.prizes.map((row, index) => {
      const label = text(row?.label, 120); const kind = text(row?.kind || 'benefit', 20); const quantity = Number(row?.quantity); const weight = Number(row?.weight || 1);
      if (label.length < 2 || BENEFIT_BLOCKLIST.test(label)) throw fail(`Le résultat ${index + 1} est vide ou contient une valeur en espèces interdite.`);
      if (!['benefit','no_prize'].includes(kind)) throw fail(`Type de résultat invalide pour la ligne ${index + 1}.`);
      if (kind === 'no_prize' && !/(pas de lot|merci|non gagnant|aucun lot)/i.test(label)) throw fail(`Le résultat ${index + 1} de type « pas de lot » doit être clairement annoncé.`);
      if (!Number.isSafeInteger(quantity) || quantity < 0 || quantity > 100000) throw fail(`Le stock du résultat ${index + 1} est invalide.`);
      if (!Number.isSafeInteger(weight) || weight < 1 || weight > 1000000) throw fail(`Le poids du résultat ${index + 1} est invalide.`);
      return { id: uuid(), label, kind, quantity, weight, quantityRemaining: quantity };
    });
    const totalStock = prizes.reduce((sum, row) => sum + row.quantity, 0);
    if (totalStock < maxParticipants) throw fail('Le stock des résultats doit couvrir au moins la capacité totale de participation.');
    let requestHash = ''; let intentHash = '';
    if (input?.requestId) {
      const requestId = text(input.requestId, 100); if (!REQUEST_RE.test(requestId)) throw fail('Identifiant de création invalide; actualisez puis réessayez.');
      requestHash = this._hash('reward-campaign-create-request', requestId);
      intentHash = crypto.createHash('sha256').update(JSON.stringify({ storeId, title, description, requestedStartsAt:text(input?.startsAt,100), requestedEndsAt:text(input?.endsAt,100), maxParticipants, status, authorizationReference, servicePointId,
        prizes:prizes.map(({label,kind,quantity,weight})=>({label,kind,quantity,weight})) })).digest('hex');
    }
    const campaign = { id: uuid(), storeId, merchantId, title, description, startsAt, endsAt, entryFeeXof: 0, authorizationReference, authorizationStatus,
      authorizationReviewedAt:null, authorizationReviewedBy:'', authorizationReviewNote:'', servicePointId:servicePointId||null, maxParticipants, remainingParticipants: maxParticipants,
      participantCount:0,redeemedCount:0,status, createRequestHash:requestHash, createIntentHash:intentHash, createdAt: new Date().toISOString(), prizes };
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        if (requestHash) {
          const existing = await client.query('SELECT id,store_id AS "storeId",merchant_id AS "merchantId",title,description,starts_at AS "startsAt",ends_at AS "endsAt",entry_fee_xof AS "entryFeeXof",max_participants AS "maxParticipants",remaining_participants AS "remainingParticipants",status,regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus",regulatory_authorization_reviewed_at AS "authorizationReviewedAt",regulatory_authorization_reviewed_by AS "authorizationReviewedBy",regulatory_authorization_review_note AS "authorizationReviewNote",service_point_id AS "servicePointId",created_at AS "createdAt",create_intent_hash AS "createIntentHash" FROM merchant_reward_campaigns WHERE store_id=$1 AND create_request_hash=$2 FOR UPDATE', [storeId,requestHash]);
          if (existing.rows[0]) {
            if (existing.rows[0].createIntentHash !== intentHash) throw fail('Cet identifiant a déjà servi à une autre offre.', 'IDEMPOTENCY_CONFLICT');
            const savedPrizes = await client.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id', [existing.rows[0].id]);
            await client.query('COMMIT'); return { ...this._safeCampaign({ ...existing.rows[0], prizes:savedPrizes.rows }), idempotent:true };
          }
        }
        if (servicePointId) {
          const point = await client.query("SELECT id FROM merchant_service_points WHERE id=$1 AND store_id=$2 AND status='active' FOR SHARE", [servicePointId,storeId]);
          if (!point.rows[0]) throw fail('Choisissez une table ou un emplacement actif de cette boutique.');
        }
        await client.query('INSERT INTO merchant_reward_campaigns (id,store_id,merchant_id,title,description,starts_at,ends_at,entry_fee_xof,max_participants,remaining_participants,status,create_request_hash,create_intent_hash,regulatory_authorization_reference,regulatory_authorization_status,service_point_id) VALUES ($1,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,0,$8,$8,$9,$10,$11,$12,$13,$14)', [campaign.id, storeId, merchantId, title, description, startsAt, endsAt, maxParticipants, status, requestHash || null, intentHash || null,authorizationReference,authorizationStatus,servicePointId||null]);
        for (const prize of prizes) await client.query('INSERT INTO merchant_reward_prizes (id,campaign_id,label,prize_kind,weight,quantity_total,quantity_remaining) VALUES ($1,$2,$3,$4,$5,$6,$6)', [prize.id, campaign.id, prize.label, prize.kind, prize.weight, prize.quantity]);
        await client.query('COMMIT'); return { ...this._safeCampaign(campaign), idempotent:false };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505' && requestHash) {
          const existing = await this.base.pool.query('SELECT id,store_id AS "storeId",merchant_id AS "merchantId",title,description,starts_at AS "startsAt",ends_at AS "endsAt",entry_fee_xof AS "entryFeeXof",max_participants AS "maxParticipants",remaining_participants AS "remainingParticipants",status,regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus",regulatory_authorization_reviewed_at AS "authorizationReviewedAt",regulatory_authorization_reviewed_by AS "authorizationReviewedBy",regulatory_authorization_review_note AS "authorizationReviewNote",service_point_id AS "servicePointId",created_at AS "createdAt",create_intent_hash AS "createIntentHash" FROM merchant_reward_campaigns WHERE store_id=$1 AND create_request_hash=$2', [storeId,requestHash]);
          if (existing.rows[0]) {
            if (existing.rows[0].createIntentHash !== intentHash) throw fail('Cet identifiant a déjà servi à une autre offre.', 'IDEMPOTENCY_CONFLICT');
            const savedPrizes = await this.base.pool.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id', [existing.rows[0].id]);
            return { ...this._safeCampaign({ ...existing.rows[0], prizes:savedPrizes.rows }), idempotent:true };
          }
        }
        throw error;
      } finally { client.release(); }
    }
    return this._lock(async () => {
      if (requestHash) {
        const existing=this.base.state.merchantRewardCampaigns.find((row)=>row.storeId===storeId&&row.createRequestHash===requestHash);
        if(existing){if(existing.createIntentHash!==intentHash)throw fail('Cet identifiant a déjà servi à une autre offre.','IDEMPOTENCY_CONFLICT');
          return {...this._safeCampaign({...existing,prizes:this.base.state.merchantRewardPrizes.filter((row)=>row.campaignId===existing.id)}),idempotent:true};}
      }
      if (servicePointId && !this.base.state.merchantServicePoints.some((row)=>row.id===servicePointId&&row.storeId===storeId&&row.status==='active')) {
        throw fail('Choisissez une table ou un emplacement actif de cette boutique.');
      }
      this.base.state.merchantRewardCampaigns.push(campaign); this.base.state.merchantRewardPrizes.push(...prizes.map((row) => ({ ...row, campaignId: campaign.id })));
      await this.base.save(); return { ...this._safeCampaign(campaign), idempotent:false };
    });
  }
  async setRewardCampaignStatus(storeId, id, input) {
    const status = text(typeof input === 'string' ? input : input?.status, 20);
    if (!['active','paused'].includes(status)) throw fail('Statut de campagne invalide.');
    const authorizationReference = text(input?.authorizationReference, 120);
    if (status === 'active' && (!authorizationReference || authorizationReference.length < 4 || input?.authorizationConfirmed !== true)) {
      throw fail('Pour publier, saisissez la référence exacte examinée par le PDG et confirmez que l’autorisation préalable est réellement délivrée et en vigueur.','AUTHORIZATION_REQUIRED');
    }
    const ensureApproved = (row) => {
      if (row.authorizationStatus !== 'approved') throw fail('Le PDG doit d’abord examiner et approuver la preuve de l’autorisation ARJH.','AUTHORIZATION_REVIEW_REQUIRED');
      if (String(row.authorizationReference || '') !== authorizationReference) throw fail('La référence saisie ne correspond pas à celle examinée par le PDG.','AUTHORIZATION_MISMATCH');
    };
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query('SELECT regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus" FROM merchant_reward_campaigns WHERE id=$1 AND store_id=$2 FOR UPDATE', [id,storeId]);
        const current = found.rows[0]; if (!current) { await client.query('COMMIT'); return null; }
        if (status === 'active') ensureApproved(current);
        const { rows } = await client.query(`UPDATE merchant_reward_campaigns SET status=$3,updated_at=NOW()
          WHERE id=$1 AND store_id=$2 RETURNING id,store_id AS "storeId",merchant_id AS "merchantId",title,description,starts_at AS "startsAt",ends_at AS "endsAt",
          entry_fee_xof AS "entryFeeXof",max_participants AS "maxParticipants",remaining_participants AS "remainingParticipants",status,
          regulatory_authorization_reference AS "authorizationReference",regulatory_authorization_status AS "authorizationStatus",
          regulatory_authorization_reviewed_at AS "authorizationReviewedAt",regulatory_authorization_reviewed_by AS "authorizationReviewedBy",
          regulatory_authorization_review_note AS "authorizationReviewNote",service_point_id AS "servicePointId",created_at AS "createdAt"`, [id,storeId,status]);
        const prizes = await client.query('SELECT id,label,prize_kind AS kind,weight,quantity_total AS "quantityTotal",quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 ORDER BY id', [id]);
        await client.query('COMMIT'); return this._safeCampaign({ ...rows[0], prizes:prizes.rows });
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    }
    return this._lock(async () => {
      const row = this.base.state.merchantRewardCampaigns.find((item) => item.id === id && item.storeId === storeId); if (!row) return null;
      if (status === 'active') ensureApproved(row);
      row.status = status; row.updatedAt = new Date().toISOString();
      await this.base.save(); return this._safeCampaign({ ...row, prizes:this.base.state.merchantRewardPrizes.filter((item) => item.campaignId === id) });
    });
  }
  async claimReward({ storeId, campaignId, phone, requestId, servicePointCode = '' }) {
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    const normalizedServicePointCode = text(servicePointCode, 100);
    if (normalizedPhone.length < 7 || normalizedPhone.length > 15) throw fail('Saisissez un numéro de téléphone valide pour limiter les participations répétées.');
    if (!REQUEST_RE.test(String(requestId || ''))) throw fail('Identifiant de demande invalide. Actualisez puis réessayez.');
    const participantHash = this._hash('reward-participant', normalizedPhone); const requestHash = this._hash('reward-request', requestId);
    const issue = (row) => ({ claim: this._safeClaim(row), code: this._decrypt(row.codeEncrypted ?? row.code_encrypted), prizeLabel: row.prizeLabel ?? row.prize_label, idempotent: true });
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const campaignResult = await client.query('SELECT id,store_id,starts_at,ends_at,status,remaining_participants,service_point_id,entry_fee_xof,regulatory_authorization_status,regulatory_authorization_reference FROM merchant_reward_campaigns WHERE id=$1 AND store_id=$2 FOR UPDATE', [campaignId, storeId]);
        const campaign = campaignResult.rows[0]; if (!campaign) throw fail('Offre introuvable.', 'NOT_FOUND');
        if (campaign.service_point_id) {
          if (!normalizedServicePointCode) throw fail('Cette offre ne peut être réclamée que depuis le QR associé.', 'SERVICE_POINT_REQUIRED');
          const point = await client.query("SELECT id FROM merchant_service_points WHERE id=$1 AND store_id=$2 AND public_code=$3 AND status='active' FOR SHARE", [campaign.service_point_id,storeId,normalizedServicePointCode]);
          if (!point.rows[0]) throw fail('Le QR actif ne correspond pas à l’emplacement de cette offre.', 'SERVICE_POINT_MISMATCH');
        }
        const existing = await client.query('SELECT id,campaign_id AS "campaignId",store_id AS "storeId",code_last4 AS "codeLast4",prize_label AS "prizeLabel",status,issued_at AS "issuedAt",expires_at AS "expiresAt",redeemed_at AS "redeemedAt",claim_request_hash AS "claimRequestHash",code_encrypted AS "codeEncrypted" FROM merchant_reward_claims WHERE campaign_id=$1 AND participant_hash=$2', [campaignId, participantHash]);
        if (existing.rows[0]) {
          if (existing.rows[0].claimRequestHash !== requestHash) throw fail('Une participation a déjà été enregistrée pour ce numéro. Contactez le commerçant si vous avez perdu le code.', 'ALREADY_PARTICIPATED');
          await client.query('COMMIT'); return issue(existing.rows[0]);
        }
        if (Number(campaign.entry_fee_xof) !== 0 || campaign.regulatory_authorization_status !== 'approved' || !String(campaign.regulatory_authorization_reference || '').trim()) {
          throw fail('Cette offre gratuite n’est pas publiable ou autorisée dans le système.', 'CAMPAIGN_CLOSED');
        }
        const now = Date.now(); if (campaign.status !== 'active' || new Date(campaign.starts_at).getTime() > now || new Date(campaign.ends_at).getTime() <= now || Number(campaign.remaining_participants) <= 0) throw fail('Cette offre est fermée ou a atteint sa capacité.', 'CAMPAIGN_CLOSED');
        const prizeResult = await client.query('SELECT id,label,prize_kind AS kind,weight,quantity_remaining AS "quantityRemaining" FROM merchant_reward_prizes WHERE campaign_id=$1 AND quantity_remaining>0 ORDER BY id FOR UPDATE', [campaignId]);
        const selected = this._choosePrize(prizeResult.rows); if (!selected) throw fail('Tous les résultats de cette offre ont été distribués.', 'CAMPAIGN_CLOSED');
        await client.query('UPDATE merchant_reward_prizes SET quantity_remaining=quantity_remaining-1 WHERE id=$1 AND quantity_remaining>0', [selected.id]);
        await client.query('UPDATE merchant_reward_campaigns SET remaining_participants=remaining_participants-1,updated_at=NOW() WHERE id=$1 AND remaining_participants>0', [campaignId]);
        const code = this._code('R'); const id = uuid(); const nowDate = new Date(); const expiry = new Date(Math.max(new Date(campaign.ends_at).getTime(), nowDate.getTime()) + 30 * 86400000);
        const encrypted = this._encrypt(code); const codeHash = this._hash('reward-code', code.toUpperCase());
        const { rows } = await client.query('INSERT INTO merchant_reward_claims (id,campaign_id,store_id,participant_hash,claim_request_hash,code_hash,code_encrypted,code_last4,prize_label,status,issued_at,expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,\'issued\',NOW(),$10::timestamptz) RETURNING id,campaign_id AS "campaignId",store_id AS "storeId",code_last4 AS "codeLast4",prize_label AS "prizeLabel",status,issued_at AS "issuedAt",expires_at AS "expiresAt",redeemed_at AS "redeemedAt",code_encrypted AS "codeEncrypted"', [id,campaignId,storeId,participantHash,requestHash,codeHash,encrypted,code.slice(-4),selected.label,expiry.toISOString()]);
        await client.query('COMMIT'); return { claim: this._safeClaim(rows[0]), code, prizeLabel: selected.label, idempotent: false };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); if (error.code === '23505') throw fail('Une participation a déjà été enregistrée ou le code est en conflit. Contactez le commerçant.', 'ALREADY_PARTICIPATED'); throw error; }
      finally { client.release(); }
    }
    return this._lock(async () => {
      const campaign = this.base.state.merchantRewardCampaigns.find((row) => row.id === campaignId && row.storeId === storeId);
      if (!campaign) throw fail('Offre introuvable.', 'NOT_FOUND');
      if (campaign.servicePointId) {
        if (!normalizedServicePointCode) throw fail('Cette offre ne peut être réclamée que depuis le QR associé.', 'SERVICE_POINT_REQUIRED');
        const point=this.base.state.merchantServicePoints.find((row)=>row.id===campaign.servicePointId&&row.storeId===storeId&&row.publicCode===normalizedServicePointCode&&row.status==='active');
        if(!point)throw fail('Le QR actif ne correspond pas à l’emplacement de cette offre.', 'SERVICE_POINT_MISMATCH');
      }
      const existing = this.base.state.merchantRewardClaims.find((row) => row.campaignId === campaignId && row.participantHash === participantHash);
      if (existing) {
        if (existing.claimRequestHash !== requestHash) throw fail('Une participation a déjà été enregistrée pour ce numéro. Contactez le commerçant si vous avez perdu le code.', 'ALREADY_PARTICIPATED');
        return issue(existing);
      }
      if (Number(campaign.entryFeeXof) !== 0 || campaign.authorizationStatus !== 'approved' || !String(campaign.authorizationReference || '').trim()) {
        throw fail('Cette offre gratuite n’est pas publiable ou autorisée dans le système.', 'CAMPAIGN_CLOSED');
      }
      const now = Date.now(); if (campaign.status !== 'active' || Date.parse(campaign.startsAt) > now || Date.parse(campaign.endsAt) <= now || Number(campaign.remainingParticipants) <= 0) throw fail('Cette offre est fermée ou a atteint sa capacité.', 'CAMPAIGN_CLOSED');
      const prizes = this.base.state.merchantRewardPrizes.filter((row) => row.campaignId === campaignId && row.quantityRemaining > 0);
      const selected = this._choosePrize(prizes); if (!selected) throw fail('Tous les résultats de cette offre ont été distribués.', 'CAMPAIGN_CLOSED');
      selected.quantityRemaining -= 1; campaign.remainingParticipants -= 1;
      const code = this._code('R'); const nowDate = new Date(); const expiry = new Date(Math.max(Date.parse(campaign.endsAt), nowDate.getTime()) + 30 * 86400000);
      const row = { id: uuid(), campaignId, storeId, participantHash, claimRequestHash: requestHash, codeHash: this._hash('reward-code', code.toUpperCase()),
        codeEncrypted: this._encrypt(code), codeLast4: code.slice(-4), prizeLabel: selected.label, status: 'issued', issuedAt: nowDate.toISOString(), expiresAt: expiry.toISOString(), redeemedAt: null };
      this.base.state.merchantRewardClaims.push(row); await this.base.save(); return { claim: this._safeClaim(row), code, prizeLabel: selected.label, idempotent: false };
    });
  }
  _choosePrize(rows) {
    const active = rows.filter((row) => Number(row.quantityRemaining ?? row.quantity_remaining) > 0 && Number(row.weight) > 0);
    const total = active.reduce((sum, row) => sum + Number(row.weight), 0); if (!total || !Number.isSafeInteger(total)) return null;
    let draw = crypto.randomInt(total);
    for (const row of active) { draw -= Number(row.weight); if (draw < 0) return row; }
    return active.at(-1) || null;
  }
  async listRewardClaims(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id,campaign_id AS "campaignId",store_id AS "storeId",code_last4 AS "codeLast4",prize_label AS "prizeLabel",status,issued_at AS "issuedAt",expires_at AS "expiresAt",redeemed_at AS "redeemedAt" FROM merchant_reward_claims WHERE store_id=$1 ORDER BY issued_at DESC LIMIT 200', [storeId]);
      return rows.map((row) => this._safeClaim(row));
    }
    return this.base.state.merchantRewardClaims.filter((row) => row.storeId === storeId).sort((a,b) => String(b.issuedAt).localeCompare(String(a.issuedAt))).slice(0,200).map((row) => this._safeClaim(row));
  }
  async redeemRewardCode(storeId, code) {
    const normalized = text(code, 120).toUpperCase(); if (!normalized) return null; const hash = this._hash('reward-code', normalized);
    if (this.pg) {
      const { rows } = await this.base.pool.query('UPDATE merchant_reward_claims SET status=\'redeemed\',redeemed_at=NOW() WHERE store_id=$1 AND code_hash=$2 AND status=\'issued\' AND expires_at>NOW() RETURNING id,campaign_id AS "campaignId",store_id AS "storeId",code_last4 AS "codeLast4",prize_label AS "prizeLabel",status,issued_at AS "issuedAt",expires_at AS "expiresAt",redeemed_at AS "redeemedAt"', [storeId, hash]);
      return this._safeClaim(rows[0] || null);
    }
    return this._lock(async () => { const row = this.base.state.merchantRewardClaims.find((item) => item.storeId === storeId && item.codeHash === hash && item.status === 'issued' && Date.parse(item.expiresAt) > Date.now());
      if (!row) return null; row.status = 'redeemed'; row.redeemedAt = new Date().toISOString(); await this.base.save(); return this._safeClaim(row); });
  }

  async listGiftCards(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id,store_id AS "storeId",merchant_id AS "merchantId",code_last4 AS "codeLast4",face_value_xof AS "faceValueXof",balance_xof AS "balanceXof",status,activated_at AS "activatedAt",created_at AS "createdAt" FROM merchant_gift_cards WHERE store_id=$1 ORDER BY created_at DESC LIMIT 200', [storeId]);
      return rows.map((row) => this._safeGiftCard(row));
    }
    return this.base.state.merchantGiftCards.filter((row) => row.storeId === storeId).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,200).map((row) => this._safeGiftCard(row));
  }
  async createGiftCard(storeId, merchantId, input) {
    const faceValueXof = safeAmount(input?.amountXof, 'La valeur du bon cadeau', 500, 2_000_000_000);
    if (!REQUEST_RE.test(String(input?.requestId || ''))) throw fail('Identifiant de création invalide. Actualisez puis réessayez.');
    const requestHash = this._hash('gift-issue-request', input.requestId); const intentHash = crypto.createHash('sha256').update(`${storeId}\0${faceValueXof}`).digest('hex');
    const issue = (row) => ({ card: this._safeGiftCard(row), code: this._decrypt(row.codeEncrypted ?? row.code_encrypted), idempotent: true });
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT id,store_id AS "storeId",merchant_id AS "merchantId",code_last4 AS "codeLast4",face_value_xof AS "faceValueXof",balance_xof AS "balanceXof",status,activated_at AS "activatedAt",created_at AS "createdAt",issue_intent_hash AS "issueIntentHash",code_encrypted AS "codeEncrypted" FROM merchant_gift_cards WHERE store_id=$1 AND issue_request_hash=$2 FOR UPDATE', [storeId, requestHash]);
        if (existing.rows[0]) {
          if (existing.rows[0].issueIntentHash !== intentHash) throw fail('Cet identifiant de création a déjà servi avec une autre valeur.', 'IDEMPOTENCY_CONFLICT');
          await client.query('COMMIT'); return issue(existing.rows[0]);
        }
        const code = this._code('GC'); const id = uuid(); const encrypted = this._encrypt(code); const codeHash = this._hash('gift-card-code', code.toUpperCase());
        const { rows } = await client.query('INSERT INTO merchant_gift_cards (id,store_id,merchant_id,issue_request_hash,issue_intent_hash,code_hash,code_encrypted,code_last4,face_value_xof,balance_xof,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9,\'pending\') RETURNING id,store_id AS "storeId",merchant_id AS "merchantId",code_last4 AS "codeLast4",face_value_xof AS "faceValueXof",balance_xof AS "balanceXof",status,activated_at AS "activatedAt",created_at AS "createdAt",code_encrypted AS "codeEncrypted"', [id,storeId,merchantId,requestHash,intentHash,codeHash,encrypted,code.slice(-4),faceValueXof]);
        await client.query('COMMIT'); return { card: this._safeGiftCard(rows[0]), code, idempotent: false };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); if (error.code === '23505') throw fail('Cette création a déjà été traitée. Actualisez la liste avant de réessayer.', 'IDEMPOTENCY_CONFLICT'); throw error; }
      finally { client.release(); }
    }
    return this._lock(async () => {
      const existing = this.base.state.merchantGiftCards.find((row) => row.storeId === storeId && row.issueRequestHash === requestHash);
      if (existing) { if (existing.issueIntentHash !== intentHash) throw fail('Cet identifiant de création a déjà servi avec une autre valeur.', 'IDEMPOTENCY_CONFLICT'); return issue(existing); }
      const code = this._code('GC'); const now = new Date().toISOString();
      const row = { id: uuid(), storeId, merchantId, issueRequestHash: requestHash, issueIntentHash: intentHash,
        codeHash: this._hash('gift-card-code', code.toUpperCase()), codeEncrypted: this._encrypt(code), codeLast4: code.slice(-4),
        faceValueXof, balanceXof: faceValueXof, status: 'pending', activatedAt: null, createdAt: now };
      this.base.state.merchantGiftCards.push(row); await this.base.save(); return { card: this._safeGiftCard(row), code, idempotent: false };
    });
  }
  async activateGiftCard(storeId, id, confirmOfflinePayment) {
    if (confirmOfflinePayment !== true) throw fail('Confirmez la réception du paiement ou l’émission volontaire du bon avant activation.');
    if (this.pg) {
      const { rows } = await this.base.pool.query("UPDATE merchant_gift_cards SET status='active',activated_at=COALESCE(activated_at,NOW()) WHERE id=$1 AND store_id=$2 AND status='pending' RETURNING id,store_id AS \"storeId\",merchant_id AS \"merchantId\",code_last4 AS \"codeLast4\",face_value_xof AS \"faceValueXof\",balance_xof AS \"balanceXof\",status,activated_at AS \"activatedAt\",created_at AS \"createdAt\"", [id,storeId]);
      if (rows[0]) return this._safeGiftCard(rows[0]);
      const current = await this.base.pool.query('SELECT id,store_id AS "storeId",merchant_id AS "merchantId",code_last4 AS "codeLast4",face_value_xof AS "faceValueXof",balance_xof AS "balanceXof",status,activated_at AS "activatedAt",created_at AS "createdAt" FROM merchant_gift_cards WHERE id=$1 AND store_id=$2', [id,storeId]);
      return this._safeGiftCard(current.rows[0] || null);
    }
    return this._lock(async () => { const row = this.base.state.merchantGiftCards.find((item) => item.id === id && item.storeId === storeId); if (!row) return null;
      if (row.status === 'pending') { row.status = 'active'; row.activatedAt = new Date().toISOString(); await this.base.save(); } return this._safeGiftCard(row); });
  }
  async checkGiftCard(storeId, code) {
    const normalized = text(code, 120).toUpperCase(); if (!normalized) return null; const hash = this._hash('gift-card-code', normalized);
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id,store_id AS "storeId",code_last4 AS "codeLast4",face_value_xof AS "faceValueXof",balance_xof AS "balanceXof",status FROM merchant_gift_cards WHERE store_id=$1 AND code_hash=$2', [storeId,hash]);
      if (!rows[0]) return null; return { valid: rows[0].status === 'active' && Number(rows[0].balanceXof) > 0, ...this._safeGiftCard(rows[0]) };
    }
    const row = this.base.state.merchantGiftCards.find((item) => item.storeId === storeId && item.codeHash === hash); if (!row) return null;
    return { valid: row.status === 'active' && Number(row.balanceXof) > 0, ...this._safeGiftCard(row) };
  }
  async redeemGiftCard({ storeId, code, amountXof, requestId, reference = '', actorId = '' }) {
    const amount = safeAmount(amountXof, 'Le montant à débiter');
    if (!REQUEST_RE.test(String(requestId || ''))) throw fail('Identifiant de dépense invalide. Actualisez puis réessayez.');
    const normalized = text(code,120).toUpperCase(); if (!normalized) throw fail('Saisissez le code du bon cadeau.');
    const codeHash = this._hash('gift-card-code', normalized); const requestHash = this._hash('gift-redemption-request', requestId);
    const intentHash = crypto.createHash('sha256').update(`${storeId}\0${codeHash}\0${amount}\0${text(reference,100)}`).digest('hex');
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const existing = await client.query('SELECT id,gift_card_id AS "giftCardId",store_id AS "storeId",amount_xof AS "amountXof",reference,created_at AS "createdAt",intent_hash AS "intentHash" FROM merchant_gift_card_redemptions WHERE store_id=$1 AND request_hash=$2 FOR UPDATE', [storeId,requestHash]);
        if (existing.rows[0]) { if (existing.rows[0].intentHash !== intentHash) throw fail('Cet identifiant de demande a déjà servi pour un autre débit.', 'IDEMPOTENCY_CONFLICT'); await client.query('COMMIT'); return { redemption: existing.rows[0], idempotent: true, card: await this.checkGiftCard(storeId, normalized) }; }
        const found = await client.query('SELECT id,merchant_id AS "merchantId",balance_xof AS "balanceXof",status FROM merchant_gift_cards WHERE store_id=$1 AND code_hash=$2 FOR UPDATE', [storeId,codeHash]);
        if (!found.rows[0] || found.rows[0].status !== 'active') throw fail('Bon cadeau inconnu, non activé ou déjà utilisé.', 'GIFT_CARD_UNAVAILABLE');
        if (Number(found.rows[0].balanceXof) < amount) throw fail('Le solde du bon cadeau est insuffisant.', 'INSUFFICIENT_BALANCE');
        const card = found.rows[0]; const remaining = Number(card.balanceXof) - amount; const status = remaining === 0 ? 'redeemed' : 'active';
        await client.query('UPDATE merchant_gift_cards SET balance_xof=$2,status=$3 WHERE id=$1', [card.id,remaining,status]);
        const { rows } = await client.query('INSERT INTO merchant_gift_card_redemptions (id,gift_card_id,store_id,merchant_id,request_hash,intent_hash,amount_xof,reference,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,gift_card_id AS "giftCardId",store_id AS "storeId",amount_xof AS "amountXof",reference,created_at AS "createdAt",intent_hash AS "intentHash"', [uuid(),card.id,storeId,card.merchantId,requestHash,intentHash,amount,text(reference,100),text(actorId,100)]);
        await client.query('COMMIT'); return { redemption: rows[0], idempotent: false, card: await this.checkGiftCard(storeId, normalized) };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    }
    return this._lock(async () => {
      const existing = this.base.state.merchantGiftCardRedemptions.find((row) => row.storeId === storeId && row.requestHash === requestHash);
      if (existing) { if (existing.intentHash !== intentHash) throw fail('Cet identifiant de demande a déjà servi pour un autre débit.', 'IDEMPOTENCY_CONFLICT'); return { redemption: clone(existing), idempotent: true, card: await this.checkGiftCard(storeId, normalized) }; }
      const card = this.base.state.merchantGiftCards.find((row) => row.storeId === storeId && row.codeHash === codeHash);
      if (!card || card.status !== 'active') throw fail('Bon cadeau inconnu, non activé ou déjà utilisé.', 'GIFT_CARD_UNAVAILABLE');
      if (Number(card.balanceXof) < amount) throw fail('Le solde du bon cadeau est insuffisant.', 'INSUFFICIENT_BALANCE');
      card.balanceXof -= amount; if (card.balanceXof === 0) card.status = 'redeemed';
      const redemption = { id: uuid(), giftCardId: card.id, storeId, merchantId: card.merchantId, requestHash, intentHash, amountXof: amount, reference: text(reference,100), createdBy: text(actorId,100), createdAt: new Date().toISOString() };
      this.base.state.merchantGiftCardRedemptions.push(redemption); await this.base.save(); return { redemption: clone(redemption), idempotent: false, card: { valid: card.status === 'active' && card.balanceXof > 0, ...this._safeGiftCard(card) } };
    });
  }
}

module.exports = { MerchantCommerceExtras, SECTORS };
