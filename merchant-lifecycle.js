'use strict';

// ============================================================================================
// Module « cycle de vie des marchands » : inscriptions autonomes, décisions du PDG / gestionnaire
// agréé, événements de scan (clients vs marchands) et statistiques associées.
//
// Principes :
//  - aucune table existante n'est remplacée : les compteurs historiques (`qr_scan_count`,
//    `qr_scans`) restent intacts et continuent d'alimenter les totaux déjà affichés ;
//  - une demande d'inscription est un dossier (`merchant_registrations`) ; un compte marchand
//    n'est créé qu'à l'approbation, et il est créé « en attente » : la procédure existante
//    d'activation du QR par le PDG n'est jamais contournée ;
//  - chaque décision est écrite une seule fois (journal append-only + index unique), donc une
//    double validation concurrente renvoie 409 au lieu de créer deux comptes ;
//  - les scans marchands sont des événements distincts (`merchant_scan_events`) avec une clé
//    anti-doublon déterministe.
// ============================================================================================

const crypto = require('node:crypto');

const REGISTRATION_STATUSES = ['pending', 'in_review', 'approved', 'rejected', 'suspended'];
const OPEN_STATUSES = ['pending', 'in_review'];
const SECTORS = ['general', 'restaurant', 'maquis', 'hardware', 'clothing', 'outdoor'];
const DECISION_ACTIONS = { approve: 'approved', reject: 'rejected', suspend: 'suspended', review: 'in_review' };

const text = (value, max = 500) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
const multiline = (value, max = 1200) => String(value == null ? '' : value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim().slice(0, max);
const lower = (value, max = 254) => text(value, max).toLowerCase();
const phoneKey = (value) => String(value || '').replace(/[^\d+]/g, '').replace(/^\+?225/, '').replace(/\D/g, '');
const uniqueId = () => crypto.randomUUID();
const hash = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);
const clone = (value) => (value == null ? null : JSON.parse(JSON.stringify(value)));

function fail(message, code, status = 400) {
  const error = new Error(message);
  error.code = code || 'REGISTRATION_INVALID';
  error.status = status;
  return error;
}

function referenceFor(date = new Date()) {
  const day = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `INSC-${day}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

function slugify(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function passwordIsStrong(value) {
  return typeof value === 'string' && value.length >= 12 && value.length <= 128;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(password, salt, 64).toString('base64url')}`;
}

function isEmail(value) { return !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value); }
function isPhone(value) { return /^[0-9+().\s-]{7,32}$/.test(value) && value.replace(/\D/g, '').length >= 7; }

function normalizeRegistrationInput(raw = {}) {
  const contactName = text(raw.contactName, 120);
  const businessName = text(raw.businessName, 140);
  const username = lower(raw.username, 80);
  const phone = text(raw.phone, 32);
  const email = lower(raw.email, 254);
  const city = text(raw.city, 80);
  const location = text(raw.location, 200);
  const address = text(raw.address, 300);
  const activityDomain = text(raw.activityDomain, 80);
  const activityDomainLabel = text(raw.activityDomainLabel, 120);
  const activityDomainOther = text(raw.activityDomainOther, 80);
  // Activités secondaires : codes uniquement, dédoublonnés, sans l'activité principale.
  const secondary = Array.isArray(raw.activityDomains) ? raw.activityDomains : [];
  const activityDomains = [...new Set(secondary.map((code) => text(code, 80)).filter(Boolean))]
    .filter((code) => code !== activityDomain).slice(0, 4);
  const description = multiline(raw.description, 1200);
  const sector = SECTORS.includes(text(raw.sector, 20)) ? text(raw.sector, 20) : 'general';
  const details = raw.sectorDetails && typeof raw.sectorDetails === 'object' && !Array.isArray(raw.sectorDetails) ? raw.sectorDetails : {};
  const sectorDetails = {};
  for (const [key, value] of Object.entries(details).slice(0, 25)) {
    const clean = text(value, 160);
    if (clean) sectorDetails[text(key, 40)] = clean;
  }
  if (contactName.length < 2) throw fail('Indiquez le nom et le prénom du responsable.');
  if (businessName.length < 2) throw fail('Indiquez le nom commercial de la boutique.');
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username)) throw fail('Choisissez un identifiant de 3 à 80 caractères (lettres, chiffres, point, tiret ou soulignement).');
  if (!phone || !isPhone(phone)) throw fail('Indiquez un numéro de téléphone valide.');
  if (!isEmail(email)) throw fail('L’adresse e-mail n’est pas valide.');
  if (!city) throw fail('Indiquez la ville.');
  if (!address) throw fail('Indiquez l’adresse ou l’emplacement de l’établissement.');
  if (!activityDomain) throw fail('Choisissez votre domaine d’activité principal.');
  if (activityDomain === 'autre' && activityDomainOther.length < 3) throw fail('Précisez votre activité (3 caractères minimum).');
  if (description.length < 10) throw fail('Décrivez votre activité en quelques mots (10 caractères minimum).');
  return { contactName, businessName, username, phone, email, city, location, address,
    activityDomain: activityDomain === 'autre' ? 'autre' : activityDomain,
    activityDomainOther: activityDomain === 'autre' ? activityDomainOther : '',
    activityDomains,
    activityDomainLabel: activityDomainLabel || (activityDomain === 'autre' ? activityDomainOther : ''),
    description, sector, sectorDetails };
}

class MerchantLifecycle {
  constructor({ store, commerce, catalog }) {
    this.store = store;
    this.commerce = commerce;
    // Optionnel : catalogue général. Absent, l'approbation fonctionne comme avant.
    this.catalog = catalog || null;
    this.pg = Boolean(store.pool);
    this.pool = store.pool || null;
    this.serial = Promise.resolve();
  }

  get state() { return this.store.state; }

  async init() {
    if (this.pg) return;
    const state = this.state;
    let changed = false;
    for (const key of ['merchantRegistrations', 'merchantRegistrationEvents', 'merchantScanEvents']) {
      if (!Array.isArray(state[key])) { state[key] = []; changed = true; }
    }
    for (const merchant of state.merchants || []) {
      if (!merchant.registrationStatus) { merchant.registrationStatus = 'active'; changed = true; }
      if (!merchant.registrationSource) { merchant.registrationSource = 'admin'; changed = true; }
    }
    for (const manager of state.managers || []) {
      if (typeof manager.canValidateMerchantRegistrations !== 'boolean') { manager.canValidateMerchantRegistrations = false; changed = true; }
    }
    for (const order of state.merchantOrders || []) {
      if (order.customerContactStatus === undefined) { order.customerContactStatus = order.customerPhone ? 'provided' : 'not_available'; changed = true; }
    }
    if (changed) await this.store.save();
  }

  withLock(work) {
    if (this.pg) return work();
    const run = this.serial.then(work, work);
    this.serial = run.catch(() => {});
    return run;
  }

  // ---------------------------------------------------------------------------------------
  // Inscriptions
  // ---------------------------------------------------------------------------------------
  async findOpenDuplicate({ phone = '', email = '', username = '' } = {}) {
    const cleanPhone = phoneKey(phone); const cleanEmail = lower(email); const cleanUsername = lower(username);
    if (this.pg) {
      const { rows } = await this.pool.query(
        `SELECT id, reference, status, business_name AS "businessName", phone, email, username, created_at AS "createdAt"
           FROM merchant_registrations
          WHERE status = ANY($1::text[])
            AND (regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $2 AND $2 <> '' OR (email <> '' AND LOWER(email) = $3) OR LOWER(username) = $4)
          LIMIT 1`, [OPEN_STATUSES, cleanPhone, cleanEmail, cleanUsername]);
      return rows[0] || null;
    }
    return this.state.merchantRegistrations.find((row) => OPEN_STATUSES.includes(row.status) &&
      ((cleanPhone && phoneKey(row.phone) === cleanPhone) || (cleanEmail && lower(row.email) === cleanEmail) || (cleanUsername && lower(row.username) === cleanUsername))) || null;
  }

  async findExistingAccount({ phone = '', email = '', username = '' } = {}) {
    const cleanEmail = lower(email); const cleanUsername = lower(username); const cleanPhone = phoneKey(phone);
    const merchants = await this.commerce.listMerchants({ includeDeleted: true });
    return merchants.find((row) => lower(row.username) === cleanUsername ||
      (cleanEmail && lower(row.email) === cleanEmail) ||
      (cleanPhone && phoneKey(row.phone) === cleanPhone)) || null;
  }

  async createRegistration(rawInput) {
    const input = normalizeRegistrationInput(rawInput);
    if (!passwordIsStrong(rawInput.password)) throw fail('Choisissez un mot de passe de 12 à 128 caractères.', 'WEAK_PASSWORD');
    const openDuplicate = await this.findOpenDuplicate(input);
    if (openDuplicate) throw fail(`Une demande est déjà en cours pour ce contact (dossier ${openDuplicate.reference}). Suivez-la ou connectez-vous si elle a été approuvée.`, 'DUPLICATE_OPEN_REGISTRATION', 409);
    const existing = await this.findExistingAccount(input);
    if (existing) {
      const error = fail('Un compte existe déjà avec ces coordonnées. Connectez-vous ou demandez un lien de réinitialisation au PDG au lieu de créer un second compte.', 'ACCOUNT_EXISTS', 409);
      error.duplicate = { username: existing.username, status: existing.status };
      throw error;
    }
    const requestId = text(rawInput.requestId, 100);
    const intentHash = hash(JSON.stringify({ ...input, password: hash(rawInput.password), requestId }));
    const now = new Date().toISOString();
    const logo = await this.normalizeImage(rawInput.logo, 'logo');
    const cover = await this.normalizeImage(rawInput.coverImageUrl, 'couverture');
    const row = {
      id: uniqueId(), reference: referenceFor(), merchantId: null, storeId: null, status: 'pending',
      ...input, logo, coverImageUrl: cover, passwordHash: hashPassword(rawInput.password), intentHash,
      duplicateOfMerchantId: null, decision: '', decisionReason: '', decisionNote: '',
      decidedByType: '', decidedById: '', decidedByLabel: '', decidedAt: null, reviewVersion: 0,
      createdAt: now, updatedAt: now, requestId,
    };
    if (this.pg) {
      try {
        await this.pool.query(
          `INSERT INTO merchant_registrations (id, reference, status, contact_name, business_name, username, phone, email, city, location,
             activity_domain, sector, description, address, sector_details, logo, cover_image_url, password_hash, intent_hash,
             activity_domains, activity_domain_label, created_at, updated_at)
           VALUES ($1,$2,'pending',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15,$16,$17,$18,$19::jsonb,$20,NOW(),NOW())`,
          [row.id, row.reference, row.contactName, row.businessName, row.username, row.phone, row.email, row.city, row.location,
            row.activityDomain, row.sector, row.description, row.address, JSON.stringify(row.sectorDetails), row.logo, row.coverImageUrl, row.passwordHash, row.intentHash,
            JSON.stringify(row.activityDomains || []), row.activityDomainLabel || '']);
      } catch (error) {
        if (error.code === '23505') throw fail('Une demande est déjà en cours pour ce contact.', 'DUPLICATE_OPEN_REGISTRATION', 409);
        throw error;
      }
      await this._recordEvent({ registrationId: row.id, merchantId: null, action: 'submitted', fromStatus: '', toStatus: 'pending',
        actorType: 'merchant', actorId: row.id, actorLabel: row.contactName || row.businessName, metadata: { reference: row.reference } });
      return this.getRegistration(row.id, { includeSecrets: false });
    }
    return this.withLock(async () => {
      this.state.merchantRegistrations.push(row);
      if (!Array.isArray(this.state.merchantRegistrationEvents)) this.state.merchantRegistrationEvents = [];
      this.state.merchantRegistrationEvents.push({ id: uniqueId(), registrationId: row.id, merchantId: null, action: 'submitted',
        fromStatus: '', toStatus: 'pending', reason: '', note: '', actorType: 'merchant', actorId: row.id,
        actorLabel: row.contactName || row.businessName, metadata: { reference: row.reference }, createdAt: now });
      await this.store.save();
      return this._publicRegistration(row);
    });
  }

  async normalizeImage(value, field) {
    const raw = String(value || '');
    if (!raw) return '';
    const match = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(raw);
    if (!match) throw fail(`L’image « ${field} » doit être un fichier PNG, JPEG ou WEBP.`);
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length) throw fail(`L’image « ${field} » est vide.`);
    if (bytes.length > 350 * 1024) throw fail(`L’image « ${field} » dépasse 350 Ko. Compressez-la puis réessayez.`);
    return `data:image/${match[1].toLowerCase()};base64,${match[2]}`;
  }

  async _hydrate(row) {
    if (!row) return row;
    if (row.passwordHash !== undefined) return row;
    const stored = await this.getRegistration(row.id, { includeSecrets: true });
    return stored ? { ...stored, ...row } : row;
  }

  _publicRegistration(row, { includeSecrets = false } = {}) {
    if (!row) return null;
    const safe = clone(row);
    delete safe.intentHash; delete safe.requestId; delete safe.sectorDetailsRaw;
    // Le hash de mot de passe n'est rendu qu'aux décisions internes (approbation), jamais à l'API.
    if (!includeSecrets) delete safe.passwordHash;
    return safe;
  }

  async getRegistration(id, { includeSecrets = false } = {}) {
    if (this.pg) {
      const { rows } = await this.pool.query(
        `SELECT id, reference, merchant_id AS "merchantId", store_id AS "storeId", status, contact_name AS "contactName",
                business_name AS "businessName", username, phone, email, city, location, activity_domain AS "activityDomain",
                activity_domains AS "activityDomains", activity_domain_label AS "activityDomainLabel",
                description, address, sector, sector_details AS "sectorDetails", logo, cover_image_url AS "coverImageUrl",
                password_hash AS "passwordHash", duplicate_of_merchant_id AS "duplicateOfMerchantId",
                decision, decision_reason AS "decisionReason", decision_note AS "decisionNote",
                decided_by_type AS "decidedByType", decided_by_id AS "decidedById", decided_by_label AS "decidedByLabel",
                decided_at AS "decidedAt", review_version AS "reviewVersion", created_at AS "createdAt", updated_at AS "updatedAt"
           FROM merchant_registrations WHERE id=$1 OR reference=$1`, [String(id)]);
      return this._publicRegistration(rows[0] || null, { includeSecrets });
    }
    const row = this.state.merchantRegistrations.find((item) => item.id === id || item.reference === id);
    return this._publicRegistration(row, { includeSecrets });
  }

  async listRegistrations({ status = '', search = '', limit = 50, page = 1 } = {}) {
    const term = lower(search);
    const filtered = (rows) => rows.filter((row) => {
      if (status && status !== 'all') {
        if (status === 'open' ? !OPEN_STATUSES.includes(row.status) : row.status !== status) return false;
      }
      if (!term) return true;
      return [row.businessName, row.contactName, row.username, row.phone, row.email, row.city, row.reference]
        .some((value) => String(value || '').toLowerCase().includes(term));
    });
    let rows;
    if (this.pg) {
      const { rows: data } = await this.pool.query(
        `SELECT id, reference, merchant_id AS "merchantId", store_id AS "storeId", status, contact_name AS "contactName",
                business_name AS "businessName", username, phone, email, city, location, activity_domain AS "activityDomain",
                activity_domains AS "activityDomains", activity_domain_label AS "activityDomainLabel",
                description, address, sector, sector_details AS "sectorDetails", logo, cover_image_url AS "coverImageUrl",
                duplicate_of_merchant_id AS "duplicateOfMerchantId", decision, decision_reason AS "decisionReason",
                decision_note AS "decisionNote", decided_by_type AS "decidedByType", decided_by_id AS "decidedById",
                decided_by_label AS "decidedByLabel", decided_at AS "decidedAt", review_version AS "reviewVersion",
                created_at AS "createdAt", updated_at AS "updatedAt"
           FROM merchant_registrations ORDER BY created_at DESC`);
      rows = data;
    } else rows = clone(this.state.merchantRegistrations).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const all = filtered(rows);
    const start = Math.max(0, (Number(page) - 1) * Number(limit));
    return { data: all.slice(start, start + Number(limit)).map((row) => this._publicRegistration(row)), total: all.length, page: Number(page), limit: Number(limit) };
  }

  async listEvents(registrationId, { limit = 100 } = {}) {
    if (this.pg) {
      const { rows } = await this.pool.query(
        `SELECT id, registration_id AS "registrationId", merchant_id AS "merchantId", action, from_status AS "fromStatus",
                to_status AS "toStatus", reason, note, actor_type AS "actorType", actor_id AS "actorId",
                actor_label AS "actorLabel", metadata, created_at AS "createdAt"
           FROM merchant_registration_events WHERE registration_id=$1 ORDER BY created_at DESC LIMIT $2`, [registrationId, Number(limit)]);
      return rows;
    }
    return clone((this.state.merchantRegistrationEvents || []).filter((row) => row.registrationId === registrationId)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0, Number(limit)));
  }

  async _recordEvent({ registrationId, merchantId, action, fromStatus, toStatus, reason = '', note = '', actorType, actorId = '', actorLabel = '', metadata = {} }) {
    const row = { id: uniqueId(), registrationId, merchantId: merchantId || null, action, fromStatus: fromStatus || '', toStatus: toStatus || '',
      reason: text(reason, 400), note: text(note, 800), actorType, actorId, actorLabel, metadata, createdAt: new Date().toISOString() };
    if (this.pg) {
      await this.pool.query(
        `INSERT INTO merchant_registration_events (id, registration_id, merchant_id, action, from_status, to_status, reason, note, actor_type, actor_id, actor_label, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
        [row.id, row.registrationId, row.merchantId, row.action, row.fromStatus, row.toStatus, row.reason, row.note, row.actorType, row.actorId, row.actorLabel, JSON.stringify(row.metadata)]);
      return row;
    }
    if (!Array.isArray(this.state.merchantRegistrationEvents)) this.state.merchantRegistrationEvents = [];
    this.state.merchantRegistrationEvents.push(row);
    await this.store.save();
    return row;
  }

  // ---------------------------------------------------------------------------------------
  // Décisions : approuver / refuser / suspendre / demander une correction
  // ---------------------------------------------------------------------------------------
  async decide(registrationId, action, { reason = '', note = '', actor } = {}) {
    const target = DECISION_ACTIONS[action];
    if (!target) throw fail('Action inconnue.', 'UNKNOWN_DECISION');
    if (!actor || !['admin', 'manager'].includes(actor.type)) throw fail('Décision non autorisée.', 'FORBIDDEN', 403);
    if (['reject', 'suspend', 'review'].includes(action) && !text(reason, 400)) throw fail('Indiquez le motif de cette décision.');
    if (action === 'approve') return this._approve(registrationId, actor, { reason, note });
    return this.withLock(async () => {
      const registration = await this.getRegistration(registrationId, { includeSecrets: true });
      if (!registration) throw fail('Demande d’inscription introuvable.', 'NOT_FOUND', 404);
      if (action === 'review') {
        if (!OPEN_STATUSES.includes(registration.status)) throw fail('Seule une demande en attente peut passer en cours d’examen.', 'INVALID_TRANSITION', 409);
        const updated = await this._updateRegistration(registration.id, { status: 'in_review', reviewVersion: Number(registration.reviewVersion) + 1 }, [OPEN_STATUSES]);
        if (!updated) throw fail('Cette demande vient d’être traitée par une autre personne. Actualisez la liste.', 'CONCURRENT_DECISION', 409);
        await this._recordEvent({ registrationId: registration.id, merchantId: registration.merchantId, action: 'review_started',
          fromStatus: registration.status, toStatus: 'in_review', reason, note, actorType: actor.type, actorId: actor.id, actorLabel: actor.label });
        await this._audit(actor, registration, 'registration_review', `Demande ${registration.reference} en cours d’examen.`, { reason });
        return this.getRegistration(registration.id);
      }
      if (action === 'reject') {
        if (!OPEN_STATUSES.includes(registration.status)) throw fail('Cette demande a déjà été traitée.', 'ALREADY_DECIDED', 409);
        const updated = await this._updateRegistration(registration.id, {
          status: 'rejected', decision: 'rejected', decisionReason: text(reason, 400), decisionNote: text(note, 800),
          decidedByType: actor.type, decidedById: actor.id, decidedByLabel: actor.label, decidedAt: new Date().toISOString(),
          reviewVersion: Number(registration.reviewVersion) + 1 }, [OPEN_STATUSES]);
        if (!updated) throw fail('Cette demande vient d’être traitée par une autre personne.', 'CONCURRENT_DECISION', 409);
        await this._recordEvent({ registrationId: registration.id, merchantId: registration.merchantId, action: 'rejected',
          fromStatus: registration.status, toStatus: 'rejected', reason, note, actorType: actor.type, actorId: actor.id, actorLabel: actor.label });
        await this._audit(actor, registration, 'registration_rejected', `Demande ${registration.reference} refusée : ${text(reason, 200)}`, { reason });
        return this.getRegistration(registration.id);
      }
      // suspend : uniquement sur un dossier approuvé (le compte marchand peut être actif).
      if (registration.status !== 'approved') throw fail('Seul un dossier approuvé peut être suspendu.', 'INVALID_TRANSITION', 409);
      const updated = await this._updateRegistration(registration.id, {
        status: 'suspended', decision: 'suspended', decisionReason: text(reason, 400), decisionNote: text(note, 800),
        decidedByType: actor.type, decidedById: actor.id, decidedByLabel: actor.label, decidedAt: new Date().toISOString(),
        reviewVersion: Number(registration.reviewVersion) + 1 }, ['approved']);
      if (!updated) throw fail('Ce dossier vient d’être modifié.', 'CONCURRENT_DECISION', 409);
      if (registration.merchantId) {
        const merchant = await this.commerce.getMerchant(registration.merchantId);
        if (merchant) await this.commerce.updateMerchant(merchant.id, { ...merchant, status: 'suspended', statusReason: text(reason, 300) });
      }
      await this._recordEvent({ registrationId: registration.id, merchantId: registration.merchantId, action: 'suspended',
        fromStatus: 'approved', toStatus: 'suspended', reason, note, actorType: actor.type, actorId: actor.id, actorLabel: actor.label });
      await this._audit(actor, registration, 'registration_suspended', `Compte du dossier ${registration.reference} suspendu : ${text(reason, 200)}`, { reason });
      return this.getRegistration(registration.id);
    });
  }

  async _updateRegistration(id, patch, allowedFrom) {
    const entries = Object.entries(patch);
    if (this.pg) {
      const columns = entries.map(([key], index) => `${SNAKE[key] || key}=$${index + 2}`).join(', ');
      const values = entries.map(([, value]) => (value && typeof value === 'object' ? JSON.stringify(value) : value));
      const { rowCount } = await this.pool.query(
        `UPDATE merchant_registrations SET ${columns}, updated_at=NOW() WHERE id=$1 AND status = ANY($${entries.length + 2}::text[])`,
        [id, ...values, allowedFrom]);
      return rowCount > 0;
    }
    const row = this.state.merchantRegistrations.find((item) => item.id === id);
    if (!row || !allowedFrom.includes(row.status)) return false;
    Object.assign(row, patch, { updatedAt: new Date().toISOString() });
    await this.store.save();
    return true;
  }

  async _approve(registrationId, actor, { reason = '', note = '' } = {}) {
    return this.withLock(async () => {
      const registration = await this.getRegistration(registrationId, { includeSecrets: true });
      if (!registration) throw fail('Demande d’inscription introuvable.', 'NOT_FOUND', 404);
      if (registration.status === 'approved') throw fail('Cette demande a déjà été approuvée.', 'ALREADY_DECIDED', 409);
      if (!OPEN_STATUSES.includes(registration.status)) throw fail('Seule une demande en attente peut être approuvée.', 'INVALID_TRANSITION', 409);

      // Verrous et doublons : on revérifie au moment de la décision, pas seulement à la soumission.
      const existing = await this.commerce.getMerchantByUsername(registration.username);
      if (existing && existing.id !== registration.merchantId) {
        throw fail('L’identifiant choisi vient d’être utilisé par un autre compte. Refusez la demande ou demandez un nouvel identifiant au demandeur.', 'DUPLICATE_USERNAME', 409);
      }

      const claimed = await this._updateRegistration(registration.id, { status: 'approved', reviewVersion: Number(registration.reviewVersion) + 1 }, OPEN_STATUSES);
      if (!claimed) throw fail('Cette demande vient d’être traitée par une autre personne.', 'CONCURRENT_DECISION', 409);

      // 1) Compte marchand en attente d'activation du QR (la procédure PDG existante s'applique).
      // Le mot de passe n'est jamais relu par les listes : on relit le dossier complet ici.
      const secret = await this._hydrate(registration);
      let merchant = registration.merchantId ? await this.commerce.getMerchant(registration.merchantId) : null;
      if (!merchant) {
        merchant = await this.commerce.createMerchant({
          username: registration.username, displayName: registration.contactName || registration.businessName,
          email: secret.email, phone: secret.phone,
          // Le mot de passe choisi par le marchand est conservé tel quel (aucun mot de passe temporaire imposé).
          passwordHash: secret.passwordHash || hashPassword(crypto.randomBytes(24).toString('base64url')),
          // Un gestionnaire agréé valide pour le compte du PDG : l'attribution reste traçable.
          managerId: '',
          passwordExpiresAt: null,
          registration: {
            status: 'approved', source: 'self_service', registeredAt: registration.createdAt,
            contactName: registration.contactName, city: registration.city, location: registration.location,
            activityDomain: registration.activityDomain, activityDescription: registration.description,
            activityDomainLabel: registration.activityDomainLabel, activityDomains: registration.activityDomains || [],
            sectorDetails: registration.sectorDetails,
          },
        });
        // Le mot de passe choisi par le marchand est conservé : il n'a pas de changement forcé.
        await this.commerce.updateMerchantRegistrationFields(merchant.id, { mustChangePassword: false, status: 'active' });
      }

      // 2) Boutique en attente de publication + QR NON activé (activation contrôlée par le PDG).
      let store = await this.commerce.getStoreByMerchantId(merchant.id);
      if (!store) {
        store = await this.commerce.createStore(merchant.id, {
          name: registration.businessName, slug: await this._uniqueSlug(registration.businessName, registration.username),
          description: registration.description, logo: registration.logo, coverImageUrl: registration.coverImageUrl,
          phone: registration.phone, email: registration.email, address: registration.address, sector: registration.sector,
          isPublished: false, acceptsOrders: true,
        });
      }

      // 3) Catalogue : les activités déclarées à l'inscription deviennent les activités du compte,
      //    et les catégories correspondantes sont préparées dans la boutique (aucun produit imposé).
      if (this.catalog) {
        try {
          const codes = [registration.activityDomain, ...(registration.activityDomains || [])].filter(Boolean);
          const all = await this.catalog.listDomains({ activeOnly: true });
          const ids = codes.map((code) => (all.find((d) => d.code === code) || {}).id).filter(Boolean);
          if (ids.length) {
            await this.catalog.setMerchantDomains(merchant.id, [...new Set(ids)]);
            await this.catalog.applyToStore(store.id, [...new Set(ids)]);
          }
        } catch (error) {
          // Une erreur de catalogue ne doit jamais bloquer une approbation déjà actée.
          await this._recordEvent({ registrationId: registration.id, merchantId: merchant.id, action: 'catalog_assignment_failed',
            fromStatus: 'approved', toStatus: 'approved', reason: '', note: error.message,
            actorType: 'system', actorId: 'catalog', actorLabel: 'Catalogue', metadata: {} }).catch(() => {});
        }
      }

      await this._attachMerchant(registration.id, merchant.id, store.id, { status: 'approved', decision: 'approved',
        decisionReason: text(reason, 400), decisionNote: text(note, 800), decidedByType: actor.type, decidedById: actor.id,
        decidedByLabel: actor.label, decidedAt: new Date().toISOString() });

      await this._recordEvent({ registrationId: registration.id, merchantId: merchant.id, action: 'approved',
        fromStatus: registration.status, toStatus: 'approved', reason, note, actorType: actor.type, actorId: actor.id, actorLabel: actor.label,
        metadata: { storeId: store.id, qrActivation: 'pending_pdg', delegatedByPdg: actor.type === 'manager' } });
      await this._audit(actor, registration, 'registration_approved', `Demande ${registration.reference} approuvée : compte marchand « ${merchant.displayName} » créé, boutique en attente d’activation du QR.`, { merchantId: merchant.id, storeId: store.id });
      await this.commerce.addNotification({
        merchantId: merchant.id, type: 'account_approved', dedupeKey: `registration:${registration.id}:approved`,
        title: 'Votre espace marchand est activé', message: 'Votre inscription a été approuvée. Publiez votre boutique, puis demandez l’activation de votre QR au PDG.',
        data: { registrationReference: registration.reference, storeSlug: store.slug },
      }).catch(() => {});
      return { registration: await this.getRegistration(registration.id), merchant: await this.commerce.getMerchant(merchant.id), store: await this.commerce.getStoreById(store.id) };
    });
  }

  async _uniqueSlug(businessName, username) {
    const base = slugify(businessName) || slugify(username) || 'boutique';
    let candidate = base; let attempt = 1;
    // A slug is never reused, even for a refused or suspended store.
    while (await this.commerce.getStoreBySlug(candidate)) { attempt += 1; candidate = `${base}-${attempt}`.slice(0, 60); if (attempt > 50) { candidate = `${base}-${crypto.randomBytes(3).toString('hex')}`; break; } }
    return candidate;
  }

  async _attachMerchant(registrationId, merchantId, storeId, patch) {
    if (this.pg) {
      await this.pool.query(
        `UPDATE merchant_registrations SET merchant_id=$2, store_id=$3, status=$4, decision=$5, decision_reason=$6, decision_note=$7,
           decided_by_type=$8, decided_by_id=$9, decided_by_label=$10, decided_at=$11::timestamptz, updated_at=NOW() WHERE id=$1`,
        [registrationId, merchantId, storeId, patch.status, patch.decision, patch.decisionReason, patch.decisionNote,
          patch.decidedByType, patch.decidedById, patch.decidedByLabel, patch.decidedAt]);
      return;
    }
    const row = this.state.merchantRegistrations.find((item) => item.id === registrationId);
    if (row) { Object.assign(row, { merchantId, storeId, ...patch, updatedAt: new Date().toISOString() }); await this.store.save(); }
  }

  async _audit(actor, registration, action, summary, metadata = {}) {
    await this.store.addAudit({
      actor: actor.label, actorType: actor.type, actorId: actor.id, managerId: actor.type === 'manager' ? actor.id : null,
      action, entityType: 'merchant_registration', entityId: registration.id,
      summary, metadata: { reference: registration.reference, businessName: registration.businessName, ...metadata },
    }).catch(() => {});
  }

  // ---------------------------------------------------------------------------------------
  // Événements de scan
  // ---------------------------------------------------------------------------------------
  async recordScanEvent({ storeId, merchantId, qrKind, servicePointId = '', qrCode = '', category = 'customer', actorId = '', channel = '', eventKey = '', userAgentClass = '', orderId = null }) {
    if (!storeId || !merchantId) return null;
    const key = text(eventKey, 120) || `${qrKind}:${servicePointId || qrCode || storeId}:${Date.now()}:${crypto.randomBytes(4).toString('hex')}`;
    const row = { id: uniqueId(), eventKey: key, storeId, merchantId, qrKind, servicePointId: servicePointId || null, qrCode: text(qrCode, 120),
      // Trois natures de scan : client, marchand (propriétaire) et personnel (serveuse, gérant général).
      category: ['customer', 'merchant', 'staff', 'unknown'].includes(category) ? category : 'customer',
      actorType: category === 'merchant' ? 'merchant' : (category === 'staff' ? 'staff' : 'customer'),
      actorId: ['merchant', 'staff'].includes(category) ? String(actorId || '') : '', channel: text(channel, 40), orderId: orderId || null,
      userAgentClass: text(userAgentClass, 40), scannedAt: new Date().toISOString() };
    if (this.pg) {
      const { rows } = await this.pool.query(
        `INSERT INTO merchant_scan_events (id, event_key, store_id, merchant_id, qr_kind, service_point_id, qr_code, category, actor_type, actor_id, channel, order_id, user_agent_class)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) ON CONFLICT (event_key) DO NOTHING
         RETURNING id, scanned_at AS "scannedAt"`,
        [row.id, row.eventKey, row.storeId, row.merchantId, row.qrKind, row.servicePointId, row.qrCode, row.category, row.actorType, row.actorId, row.channel, row.orderId, row.userAgentClass]);
      return rows[0] ? { ...row, scannedAt: iso(rows[0].scannedAt), duplicate: false } : { duplicate: true, eventKey: key };
    }
    if (!Array.isArray(this.state.merchantScanEvents)) this.state.merchantScanEvents = [];
    if (this.state.merchantScanEvents.some((item) => item.eventKey === key)) return { duplicate: true, eventKey: key };
    this.state.merchantScanEvents.push(row);
    await this.store.save();
    return { ...row, duplicate: false };
  }

  // Comptage des demandes par statut, sans tri ni pagination : sert aux badges du PDG.
  async registrationCounts() {
    const rows = this.pg
      ? (await this.pool.query('SELECT status, COUNT(*)::int AS count FROM merchant_registrations GROUP BY status')).rows
      : (this.state.merchantRegistrations || []).reduce((acc, row) => {
        const found = acc.find((item) => item.status === row.status); if (found) found.count += 1; else acc.push({ status: row.status, count: 1 }); return acc;
      }, []);
    const counts = { pending: 0, in_review: 0, approved: 0, rejected: 0, suspended: 0 };
    for (const row of rows) if (row.status in counts) counts[row.status] = Number(row.count) || 0;
    return { ...counts, open: counts.pending + counts.in_review, total: Object.values(counts).reduce((sum, value) => sum + value, 0) };
  }

  async linkScanEventToOrder(scanEventId, orderId, merchantId) {
    if (!scanEventId || !orderId) return false;
    if (this.pg) {
      const { rowCount } = await this.pool.query('UPDATE merchant_scan_events SET order_id=$2 WHERE id=$1 AND merchant_id=$3', [scanEventId, orderId, merchantId]);
      return rowCount > 0;
    }
    const row = (this.state.merchantScanEvents || []).find((item) => item.id === scanEventId && item.merchantId === merchantId);
    if (!row) return false;
    row.orderId = orderId; await this.store.save(); return true;
  }

  // ---------------------------------------------------------------------------------------
  // Statistiques (scans clients / marchands / historique + évolution + tops)
  // ---------------------------------------------------------------------------------------
  async scanStats({ storeId = '', merchantId = '', days = 0 } = {}) {
    const since = days ? new Date(Date.now() - Number(days) * 86400000) : null;
    if (this.pg) {
      const params = [storeId || null, merchantId || null, since];
      const { rows } = await this.pool.query(
        `SELECT category, COUNT(*)::int AS count FROM merchant_scan_events
          WHERE ($1::text IS NULL OR store_id=$1) AND ($2::text IS NULL OR merchant_id=$2)
            AND ($3::timestamptz IS NULL OR scanned_at >= $3)
          GROUP BY category`, params);
      const counts = { customer: 0, merchant: 0, unknown: 0 };
      for (const row of rows) counts[row.category] = Number(row.count) || 0;
      const timeline = await this.pool.query(
        `SELECT to_char(scanned_at::date, 'YYYY-MM-DD') AS day, category, COUNT(*)::int AS count
           FROM merchant_scan_events WHERE ($1::text IS NULL OR store_id=$1) AND ($2::text IS NULL OR merchant_id=$2)
             AND ($3::timestamptz IS NULL OR scanned_at >= $3)
          GROUP BY 1, 2 ORDER BY 1`, params);
      const top = await this.pool.query(
        `SELECT qr_code AS "qrCode", qr_kind AS "qrKind", service_point_id AS "servicePointId", category, COUNT(*)::int AS count
           FROM merchant_scan_events WHERE ($1::text IS NULL OR store_id=$1) AND ($2::text IS NULL OR merchant_id=$2)
             AND ($3::timestamptz IS NULL OR scanned_at >= $3)
          GROUP BY 1, 2, 3, 4 ORDER BY count DESC LIMIT 20`, params);
      const history = await this.pool.query(
        `SELECT id, qr_kind AS "qrKind", qr_code AS "qrCode", service_point_id AS "servicePointId", category, actor_type AS "actorType",
                store_id AS "storeId", merchant_id AS "merchantId", channel, scanned_at AS "scannedAt"
           FROM merchant_scan_events WHERE ($1::text IS NULL OR store_id=$1) AND ($2::text IS NULL OR merchant_id=$2)
             AND ($3::timestamptz IS NULL OR scanned_at >= $3)
          ORDER BY scanned_at DESC LIMIT 100`, params);
      const legacy = await this.pool.query(
        `SELECT
           (SELECT COALESCE(SUM(qr_scan_count),0)::int FROM merchant_stores WHERE ($1::text IS NULL OR merchant_id=$2)) AS "storeLegacy",
           (SELECT COALESCE(SUM(p.qr_scan_count),0)::int FROM merchant_service_points p JOIN merchant_stores s ON s.id=p.store_id
             WHERE ($1::text IS NULL OR s.id=$1) AND ($2::text IS NULL OR s.merchant_id=$2)) AS "pointLegacy"`, [storeId || null, merchantId || null]);
      const legacyTotal = Number(legacy.rows[0]?.storeLegacy || 0) + Number(legacy.rows[0]?.pointLegacy || 0);
      return this._composeStats({ counts, timeline: timeline.rows, top: top.rows, history: history.rows, legacyTotal, days });
    }
    const events = (this.state.merchantScanEvents || []).filter((row) =>
      (!storeId || row.storeId === storeId) && (!merchantId || row.merchantId === merchantId) && (!since || Date.parse(row.scannedAt) >= since.getTime()));
    const counts = { customer: 0, merchant: 0, unknown: 0 };
    for (const row of events) counts[row.category] = (counts[row.category] || 0) + 1;
    const byDay = new Map(); const byTop = new Map();
    for (const row of events) {
      const day = String(row.scannedAt).slice(0, 10);
      const bucket = byDay.get(day) || { customer: 0, merchant: 0, unknown: 0 };
      bucket[row.category] += 1; byDay.set(day, bucket);
      const key = `${row.qrKind}|${row.qrCode}|${row.servicePointId || ''}|${row.category}`;
      const existing = byTop.get(key) || { qrCode: row.qrCode, qrKind: row.qrKind, servicePointId: row.servicePointId || '', category: row.category, count: 0 };
      existing.count += 1; byTop.set(key, existing);
    }
    const timeline = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, bucket]) => ({ day, ...bucket, total: bucket.customer + bucket.merchant + bucket.unknown }));
    const storeRow = this.state.merchantStores.find((row) => (!storeId || row.id === storeId) && (!merchantId || row.merchantId === merchantId));
    const points = this.state.merchantServicePoints.filter((row) => (!storeId || row.storeId === storeId) && (!merchantId || this.state.merchantStores.find((s) => s.id === row.storeId)?.merchantId === merchantId));
    const stores = this.state.merchantStores.filter((row) => (!storeId || row.id === storeId) && (!merchantId || row.merchantId === merchantId));
    const legacyTotal = stores.reduce((sum, row) => sum + (Number(row.qrScanCount) || 0), 0) + points.reduce((sum, row) => sum + (Number(row.qrScanCount) || 0), 0);
    return this._composeStats({ counts, timeline, top: [...byTop.values()].sort((a, b) => b.count - a.count).slice(0, 20),
      history: clone(events.sort((a, b) => String(b.scannedAt).localeCompare(String(a.scannedAt))).slice(0, 100)), legacyTotal, days });
  }

  _composeStats({ counts, timeline, top, history, legacyTotal, days }) {
    const customer = counts.customer || 0; const merchant = counts.merchant || 0; const unknown = counts.unknown || 0;
    const normalisedTimeline = timeline.map((row) => ({ day: row.day, customer: Number(row.customer) || 0, merchant: Number(row.merchant) || 0,
      unknown: Number(row.unknown) || 0, total: (Number(row.customer) || 0) + (Number(row.merchant) || 0) + (Number(row.unknown) || 0) }));
    const weekly = new Map(); const monthly = new Map();
    for (const row of normalisedTimeline) {
      const date = new Date(`${row.day}T00:00:00Z`);
      const monday = new Date(date); const day = (date.getUTCDay() + 6) % 7; monday.setUTCDate(date.getUTCDate() - day);
      const weekKey = monday.toISOString().slice(0, 10); const monthKey = row.day.slice(0, 7);
      const week = weekly.get(weekKey) || { week: weekKey, customer: 0, merchant: 0, unknown: 0, total: 0 };
      const month = monthly.get(monthKey) || { month: monthKey, customer: 0, merchant: 0, unknown: 0, total: 0 };
      for (const bucket of [week, month]) { bucket.customer += row.customer; bucket.merchant += row.merchant; bucket.unknown += row.unknown; bucket.total += row.total; }
      weekly.set(weekKey, week); monthly.set(monthKey, month);
    }
    return {
      days: days || null,
      counts: { customer, merchant, unknown, total: customer + merchant + unknown, legacy: Number(legacyTotal) || 0,
        platformTotal: customer + merchant + unknown + (Number(legacyTotal) || 0) },
      timeline: normalisedTimeline, weekly: [...weekly.values()], monthly: [...monthly.values()],
      top: top.map((row) => ({ ...row, count: Number(row.count) || 0 })), history,
      // Catégories explicites : clients, marchands, puis l'historique antérieur non classable.
      categories: { customer: customer, merchant: merchant, unknown: unknown, legacy: Number(legacyTotal) || 0 },
      // Un scan marchand n'est jamais une visite publique : la visite publique reste la catégorie client.
      visits: { public: customer },
      orders: { merchantAssisted: Number(this.lastOrderCounts?.merchantAssisted) || 0, customer: Number(this.lastOrderCounts?.customer) || 0 },
    };
  }
}

const SNAKE = {
  status: 'status', decision: 'decision', decisionReason: 'decision_reason', decisionNote: 'decision_note',
  decidedByType: 'decided_by_type', decidedById: 'decided_by_id', decidedByLabel: 'decided_by_label',
  decidedAt: 'decided_at', reviewVersion: 'review_version', merchantId: 'merchant_id', storeId: 'store_id',
};

module.exports = { MerchantLifecycle, normalizeRegistrationInput, referenceFor, REGISTRATION_STATUSES, OPEN_STATUSES, slugify, hashPassword };
