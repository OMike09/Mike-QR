const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

const SYSTEM_CATEGORIES = [
  { id: 'cat-individuals', name: 'Particuliers', slug: 'particuliers', isSystem: true },
  { id: 'cat-businesses', name: 'Entreprises', slug: 'entreprises', isSystem: true },
  { id: 'cat-shops', name: 'Commerces', slug: 'commerces', isSystem: true },
  { id: 'cat-organizations', name: 'Organisations', slug: 'organisations', isSystem: true },
  { id: 'cat-other', name: 'Autres', slug: 'autres', isSystem: true },
];

const BENE_FIELDS = `id, type, name, logo, phone, whatsapp, email, address,
  location_url AS "locationUrl", website, socials, bio, offers, documents,
  created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"`;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
function fold(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('fr');
}
function publicCode() {
  return randomBytes(7).toString('base64url');
}
function safeList(value) {
  return Array.isArray(value) ? value : [];
}

class JsonStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      this.state = JSON.parse(await fs.promises.readFile(this.filePath, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.state = { beneficiaries: [], qrCodes: [], scans: [], audit: [], categories: clone(SYSTEM_CATEGORIES) };
      await this.save();
    }
    this.state.beneficiaries ||= [];
    this.state.qrCodes ||= [];
    this.state.scans ||= [];
    this.state.audit ||= [];
    this.state.categories ||= clone(SYSTEM_CATEGORIES);
    for (const category of SYSTEM_CATEGORIES) {
      if (!this.state.categories.some((item) => item.id === category.id)) this.state.categories.push(clone(category));
    }
    await this.save();
  }

  async save() {
    const snapshot = JSON.stringify(this.state, null, 2);
    this.writeQueue = this.writeQueue.then(async () => {
      const temporary = `${this.filePath}.tmp`;
      await fs.promises.writeFile(temporary, snapshot, 'utf8');
      await fs.promises.rename(temporary, this.filePath);
    });
    return this.writeQueue;
  }

  async listCategories() {
    return clone(this.state.categories.slice().sort((a, b) => a.name.localeCompare(b.name, 'fr')));
  }

  async createCategory(data) {
    const row = { id: randomUUID(), name: data.name, slug: data.slug, isSystem: false, createdAt: new Date().toISOString() };
    if (this.state.categories.some((item) => fold(item.name) === fold(row.name) || item.slug === row.slug)) {
      const error = new Error('Cette catégorie existe déjà.'); error.code = 'DUPLICATE'; throw error;
    }
    this.state.categories.push(row); await this.save(); return clone(row);
  }

  async listBeneficiaries({ search = '', type = '', page = 1, limit = 25 } = {}) {
    const query = fold(search);
    let rows = this.state.beneficiaries.filter((row) => !row.deletedAt);
    if (type) rows = rows.filter((row) => row.type === type);
    if (query) rows = rows.filter((row) => fold([row.name, row.email, row.phone, row.id].join(' ')).includes(query));
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const total = rows.length;
    const start = (page - 1) * limit;
    const data = rows.slice(start, start + limit).map((row) => ({ ...clone(row), qrCount: this.state.qrCodes.filter((qr) => qr.beneficiaryId === row.id && !qr.deletedAt).length }));
    return { data, total, page, limit };
  }

  async getBeneficiary(id) {
    const row = this.state.beneficiaries.find((item) => item.id === id && !item.deletedAt);
    return row ? clone(row) : null;
  }

  async createBeneficiary(data) {
    const stamp = new Date().toISOString();
    const row = { id: randomUUID(), ...clone(data), createdAt: stamp, updatedAt: stamp, deletedAt: null };
    this.state.beneficiaries.push(row); await this.save(); return clone(row);
  }

  async updateBeneficiary(id, data) {
    const index = this.state.beneficiaries.findIndex((item) => item.id === id && !item.deletedAt);
    if (index < 0) return null;
    this.state.beneficiaries[index] = { ...this.state.beneficiaries[index], ...clone(data), updatedAt: new Date().toISOString() };
    await this.save(); return clone(this.state.beneficiaries[index]);
  }

  async archiveBeneficiary(id) {
    const row = this.state.beneficiaries.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    const stamp = new Date().toISOString();
    row.deletedAt = stamp; row.updatedAt = stamp;
    for (const qr of this.state.qrCodes) {
      if (qr.beneficiaryId === id && !qr.deletedAt) { qr.status = 'inactive'; qr.updatedAt = stamp; }
    }
    await this.save(); return clone(row);
  }

  async listCodes({ search = '', categoryId = '', beneficiaryId = '', status = '', page = 1, limit = 25 } = {}) {
    const query = fold(search);
    let rows = this.state.qrCodes.filter((qr) => !qr.deletedAt);
    if (categoryId) rows = rows.filter((qr) => qr.categoryId === categoryId);
    if (beneficiaryId) rows = rows.filter((qr) => qr.beneficiaryId === beneficiaryId);
    if (status) rows = rows.filter((qr) => qr.status === status);
    if (query) rows = rows.filter((qr) => {
      const bene = this.state.beneficiaries.find((item) => item.id === qr.beneficiaryId);
      const category = this.state.categories.find((item) => item.id === qr.categoryId);
      return fold([qr.name, qr.publicCode, qr.id, bene?.name, category?.name].join(' ')).includes(query);
    });
    rows.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const total = rows.length;
    const start = (page - 1) * limit;
    const data = rows.slice(start, start + limit).map((qr) => {
      const bene = this.state.beneficiaries.find((item) => item.id === qr.beneficiaryId);
      const category = this.state.categories.find((item) => item.id === qr.categoryId);
      const scanCount = this.state.scans.filter((scan) => scan.qrCodeId === qr.id).length;
      return { ...clone(qr), beneficiaryName: bene?.name || 'Bénéficiaire archivé', beneficiaryType: bene?.type || 'other', categoryName: category?.name || 'Sans catégorie', scanCount };
    });
    return { data, total, page, limit };
  }

  async getCode(id) {
    const qr = this.state.qrCodes.find((item) => item.id === id);
    if (!qr) return null;
    const bene = this.state.beneficiaries.find((item) => item.id === qr.beneficiaryId);
    const category = this.state.categories.find((item) => item.id === qr.categoryId);
    const scanCount = this.state.scans.filter((scan) => scan.qrCodeId === qr.id).length;
    return { ...clone(qr), beneficiaryName: bene?.name || 'Bénéficiaire archivé', beneficiaryType: bene?.type || 'other', categoryName: category?.name || 'Sans catégorie', scanCount };
  }

  async createCode(data) {
    const stamp = new Date().toISOString();
    let code = publicCode();
    while (this.state.qrCodes.some((row) => row.publicCode === code)) code = publicCode();
    const row = { id: randomUUID(), publicCode: code, ...clone(data), status: 'active', createdAt: stamp, updatedAt: stamp, deletedAt: null };
    this.state.qrCodes.push(row); await this.save(); return this.getCode(row.id);
  }

  async updateCode(id, data) {
    const index = this.state.qrCodes.findIndex((item) => item.id === id && !item.deletedAt);
    if (index < 0) return null;
    this.state.qrCodes[index] = { ...this.state.qrCodes[index], ...clone(data), updatedAt: new Date().toISOString() };
    await this.save(); return this.getCode(id);
  }

  async setCodeStatus(id, status) {
    const row = this.state.qrCodes.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.status = status; row.updatedAt = new Date().toISOString(); await this.save(); return this.getCode(id);
  }

  async deleteCode(id) {
    const row = this.state.qrCodes.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.status = 'deleted'; row.deletedAt = new Date().toISOString(); row.updatedAt = row.deletedAt;
    await this.save(); return clone(row);
  }

  async getPublicCode(code) {
    const qr = this.state.qrCodes.find((item) => item.publicCode === code && item.status === 'active' && !item.deletedAt);
    if (!qr) return null;
    const beneficiary = this.state.beneficiaries.find((item) => item.id === qr.beneficiaryId && !item.deletedAt);
    if (!beneficiary) return null;
    const category = this.state.categories.find((item) => item.id === qr.categoryId);
    return { qr: clone({ ...qr, categoryName: category?.name || '' }), beneficiary: clone(beneficiary) };
  }

  async recordScan(qrCodeId) {
    this.state.scans.push({ id: randomUUID(), qrCodeId, scannedAt: new Date().toISOString() }); await this.save();
  }

  async stats() {
    const beneficiaries = this.state.beneficiaries.filter((row) => !row.deletedAt).length;
    const activeCodes = this.state.qrCodes.filter((row) => !row.deletedAt && row.status === 'active').length;
    const totalCodes = this.state.qrCodes.filter((row) => !row.deletedAt).length;
    const since = Date.now() - 7 * 86400000;
    return {
      beneficiaries, activeCodes, totalCodes,
      scans: this.state.scans.length,
      scansLast7: this.state.scans.filter((row) => Date.parse(row.scannedAt) >= since).length,
    };
  }

  async addAudit(entry) {
    this.state.audit.unshift({ id: randomUUID(), actor: 'admin', ...clone(entry), createdAt: new Date().toISOString() });
    if (this.state.audit.length > 10000) this.state.audit.length = 10000;
    await this.save();
  }

  async listAudit({ page = 1, limit = 30, entityType = '', entityId = '' } = {}) {
    let rows = this.state.audit;
    if (entityType) rows = rows.filter((row) => row.entityType === entityType);
    if (entityId) rows = rows.filter((row) => row.entityId === entityId);
    const total = rows.length;
    return { data: clone(rows.slice((page - 1) * limit, page * limit)), total, page, limit };
  }
}

class PgStore {
  constructor(connectionString) {
    const { Pool } = require('pg');
    const needsSsl = /neon\.tech|sslmode=require/i.test(connectionString);
    this.pool = new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
      max: 8,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
  }

  async init() {
    const schema = await fs.promises.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
    await this.pool.query(schema);
    for (const category of SYSTEM_CATEGORIES) {
      await this.pool.query(
        `INSERT INTO qr_categories (id, name, slug, is_system) VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [category.id, category.name, category.slug],
      );
    }
    await this.pool.query('SELECT 1');
  }

  async listCategories() {
    const { rows } = await this.pool.query('SELECT id, name, slug, is_system AS "isSystem", created_at AS "createdAt" FROM qr_categories ORDER BY is_system DESC, name ASC');
    return rows;
  }

  async createCategory(data) {
    const id = randomUUID();
    try {
      const { rows } = await this.pool.query(
        'INSERT INTO qr_categories (id, name, slug, is_system) VALUES ($1, $2, $3, FALSE) RETURNING id, name, slug, is_system AS "isSystem", created_at AS "createdAt"',
        [id, data.name, data.slug],
      );
      return rows[0];
    } catch (error) {
      if (error.code === '23505') { const duplicate = new Error('Cette catégorie existe déjà.'); duplicate.code = 'DUPLICATE'; throw duplicate; }
      throw error;
    }
  }

  async listBeneficiaries({ search = '', type = '', page = 1, limit = 25 } = {}) {
    const term = `%${search}%`;
    const where = `b.deleted_at IS NULL AND ($1 = '' OR b.name ILIKE $2 OR b.email ILIKE $2 OR b.phone ILIKE $2 OR b.id ILIKE $2) AND ($3 = '' OR b.type = $3)`;
    const count = await this.pool.query(`SELECT COUNT(*)::int AS total FROM beneficiaries b WHERE ${where}`, [search, term, type]);
    const { rows } = await this.pool.query(
      `SELECT ${BENE_FIELDS},
        (SELECT COUNT(*)::int FROM qr_codes q WHERE q.beneficiary_id = b.id AND q.deleted_at IS NULL) AS "qrCount"
       FROM beneficiaries b WHERE ${where} ORDER BY b.updated_at DESC LIMIT $4 OFFSET $5`,
      [search, term, type, limit, (page - 1) * limit],
    );
    return { data: rows, total: count.rows[0].total, page, limit };
  }

  async getBeneficiary(id) {
    const { rows } = await this.pool.query(`SELECT ${BENE_FIELDS} FROM beneficiaries WHERE id = $1 AND deleted_at IS NULL`, [id]);
    return rows[0] || null;
  }

  async createBeneficiary(data) {
    const id = randomUUID();
    const { rows } = await this.pool.query(
      `INSERT INTO beneficiaries (id, type, name, logo, phone, whatsapp, email, address, location_url, website, socials, bio, offers, documents)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13::jsonb,$14::jsonb)
       RETURNING ${BENE_FIELDS}`,
      [id, data.type, data.name, data.logo, data.phone, data.whatsapp, data.email, data.address, data.locationUrl, data.website, JSON.stringify(data.socials), data.bio, JSON.stringify(data.offers), JSON.stringify(data.documents)],
    );
    return rows[0];
  }

  async updateBeneficiary(id, data) {
    const { rows } = await this.pool.query(
      `UPDATE beneficiaries SET type=$2, name=$3, logo=$4, phone=$5, whatsapp=$6, email=$7, address=$8,
       location_url=$9, website=$10, socials=$11::jsonb, bio=$12, offers=$13::jsonb, documents=$14::jsonb, updated_at=NOW()
       WHERE id=$1 AND deleted_at IS NULL RETURNING ${BENE_FIELDS}`,
      [id, data.type, data.name, data.logo, data.phone, data.whatsapp, data.email, data.address, data.locationUrl, data.website, JSON.stringify(data.socials), data.bio, JSON.stringify(data.offers), JSON.stringify(data.documents)],
    );
    return rows[0] || null;
  }

  async archiveBeneficiary(id) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`UPDATE beneficiaries SET deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING ${BENE_FIELDS}`, [id]);
      if (rows[0]) await client.query("UPDATE qr_codes SET status='inactive', updated_at=NOW() WHERE beneficiary_id=$1 AND deleted_at IS NULL", [id]);
      await client.query('COMMIT');
      return rows[0] || null;
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }

  async listCodes({ search = '', categoryId = '', beneficiaryId = '', status = '', page = 1, limit = 25 } = {}) {
    const term = `%${search}%`;
    const where = `q.deleted_at IS NULL
      AND ($1 = '' OR q.name ILIKE $2 OR q.public_code ILIKE $2 OR q.id ILIKE $2 OR b.name ILIKE $2 OR COALESCE(c.name,'') ILIKE $2)
      AND ($3 = '' OR q.category_id = $3)
      AND ($4 = '' OR q.beneficiary_id = $4)
      AND ($5 = '' OR q.status = $5)`;
    const params = [search, term, categoryId, beneficiaryId, status];
    const count = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM qr_codes q JOIN beneficiaries b ON b.id=q.beneficiary_id LEFT JOIN qr_categories c ON c.id=q.category_id WHERE ${where}`,
      params,
    );
    const { rows } = await this.pool.query(
      `SELECT q.id, q.public_code AS "publicCode", q.name, q.beneficiary_id AS "beneficiaryId", q.category_id AS "categoryId",
        q.purpose, q.destination_type AS "destinationType", q.target_url AS "targetUrl", q.title, q.description, q.content_text AS "contentText",
        q.selected_fields AS "selectedFields", q.extra_links AS "extraLinks", q.style, q.status,
        q.created_at AS "createdAt", q.updated_at AS "updatedAt", b.name AS "beneficiaryName", b.type AS "beneficiaryType",
        COALESCE(c.name, 'Sans catégorie') AS "categoryName", COALESCE(s.scan_count, 0)::int AS "scanCount"
       FROM qr_codes q JOIN beneficiaries b ON b.id=q.beneficiary_id LEFT JOIN qr_categories c ON c.id=q.category_id
       LEFT JOIN (SELECT qr_code_id, COUNT(*) AS scan_count FROM qr_scans GROUP BY qr_code_id) s ON s.qr_code_id=q.id
       WHERE ${where} ORDER BY q.updated_at DESC LIMIT $6 OFFSET $7`,
      [...params, limit, (page - 1) * limit],
    );
    return { data: rows, total: count.rows[0].total, page, limit };
  }

  async getCode(id) {
    const { rows } = await this.pool.query(
      `SELECT q.id, q.public_code AS "publicCode", q.name, q.beneficiary_id AS "beneficiaryId", q.category_id AS "categoryId",
        q.purpose, q.destination_type AS "destinationType", q.target_url AS "targetUrl", q.title, q.description, q.content_text AS "contentText",
        q.selected_fields AS "selectedFields", q.extra_links AS "extraLinks", q.style, q.status,
        q.created_at AS "createdAt", q.updated_at AS "updatedAt", q.deleted_at AS "deletedAt", b.name AS "beneficiaryName", b.type AS "beneficiaryType",
        COALESCE(c.name, 'Sans catégorie') AS "categoryName", (SELECT COUNT(*)::int FROM qr_scans s WHERE s.qr_code_id=q.id) AS "scanCount"
       FROM qr_codes q LEFT JOIN beneficiaries b ON b.id=q.beneficiary_id LEFT JOIN qr_categories c ON c.id=q.category_id WHERE q.id=$1`,
      [id],
    );
    return rows[0] || null;
  }

  async createCode(data) {
    const id = randomUUID();
    let code = publicCode();
    let attempts = 0;
    while (attempts++ < 3) {
      try {
        const { rows } = await this.pool.query(
          `INSERT INTO qr_codes (id, public_code, name, beneficiary_id, category_id, purpose, destination_type, target_url, title, description, content_text, selected_fields, extra_links, style, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,'active') RETURNING id`,
          [id, code, data.name, data.beneficiaryId, data.categoryId || null, data.purpose, data.destinationType, data.targetUrl, data.title, data.description, data.contentText, JSON.stringify(data.selectedFields), JSON.stringify(data.extraLinks), JSON.stringify(data.style)],
        );
        return this.getCode(rows[0].id);
      } catch (error) {
        if (error.code === '23505' && error.constraint === 'qr_codes_public_code_key') { code = publicCode(); continue; }
        throw error;
      }
    }
    throw new Error('Impossible de générer un identifiant QR unique.');
  }

  async updateCode(id, data) {
    const { rows } = await this.pool.query(
      `UPDATE qr_codes SET name=$2, beneficiary_id=$3, category_id=$4, purpose=$5, destination_type=$6, target_url=$7,
       title=$8, description=$9, content_text=$10, selected_fields=$11::jsonb, extra_links=$12::jsonb, style=$13::jsonb,
       updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
      [id, data.name, data.beneficiaryId, data.categoryId || null, data.purpose, data.destinationType, data.targetUrl, data.title, data.description, data.contentText, JSON.stringify(data.selectedFields), JSON.stringify(data.extraLinks), JSON.stringify(data.style)],
    );
    return rows[0] ? this.getCode(rows[0].id) : null;
  }

  async setCodeStatus(id, status) {
    const { rows } = await this.pool.query("UPDATE qr_codes SET status=$2, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id", [id, status]);
    return rows[0] ? this.getCode(rows[0].id) : null;
  }

  async deleteCode(id) {
    const { rows } = await this.pool.query("UPDATE qr_codes SET status='deleted', deleted_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id", [id]);
    return rows[0] ? this.getCode(rows[0].id) : null;
  }

  async getPublicCode(code) {
    const { rows } = await this.pool.query(
      `SELECT q.id, q.public_code AS "publicCode", q.name, q.beneficiary_id AS "beneficiaryId", q.category_id AS "categoryId",
        q.purpose, q.destination_type AS "destinationType", q.target_url AS "targetUrl", q.title, q.description, q.content_text AS "contentText",
        q.selected_fields AS "selectedFields", q.extra_links AS "extraLinks", q.style, q.status, q.created_at AS "createdAt",
        COALESCE(c.name, '') AS "categoryName", b.type AS "beneficiaryType", b.name AS "beneficiaryName", b.logo AS "beneficiaryLogo",
        b.phone, b.whatsapp, b.email, b.address, b.location_url AS "locationUrl", b.website, b.socials, b.bio, b.offers, b.documents
       FROM qr_codes q JOIN beneficiaries b ON b.id=q.beneficiary_id LEFT JOIN qr_categories c ON c.id=q.category_id
       WHERE q.public_code=$1 AND q.status='active' AND q.deleted_at IS NULL AND b.deleted_at IS NULL`,
      [code],
    );
    if (!rows[0]) return null;
    const { beneficiaryType, beneficiaryName, beneficiaryLogo, phone, whatsapp, email, address, locationUrl, website, socials, bio, offers, documents, ...qr } = rows[0];
    return { qr, beneficiary: { type: beneficiaryType, name: beneficiaryName, logo: beneficiaryLogo, phone, whatsapp, email, address, locationUrl, website, socials, bio, offers, documents } };
  }

  async recordScan(qrCodeId) {
    await this.pool.query('INSERT INTO qr_scans (qr_code_id) VALUES ($1)', [qrCodeId]);
  }

  async stats() {
    const { rows } = await this.pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM beneficiaries WHERE deleted_at IS NULL) AS beneficiaries,
         (SELECT COUNT(*)::int FROM qr_codes WHERE deleted_at IS NULL AND status='active') AS "activeCodes",
         (SELECT COUNT(*)::int FROM qr_codes WHERE deleted_at IS NULL) AS "totalCodes",
         (SELECT COUNT(*)::int FROM qr_scans) AS scans,
         (SELECT COUNT(*)::int FROM qr_scans WHERE scanned_at >= NOW() - INTERVAL '7 days') AS "scansLast7"`,
    );
    return rows[0];
  }

  async addAudit(entry) {
    await this.pool.query(
      `INSERT INTO audit_logs (actor, action, entity_type, entity_id, summary, before_data, after_data)
       VALUES ('admin',$1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
      [entry.action, entry.entityType, entry.entityId, entry.summary, entry.beforeData ? JSON.stringify(entry.beforeData) : null, entry.afterData ? JSON.stringify(entry.afterData) : null],
    );
  }

  async listAudit({ page = 1, limit = 30, entityType = '', entityId = '' } = {}) {
    const count = await this.pool.query(
      `SELECT COUNT(*)::int AS total FROM audit_logs WHERE ($1 = '' OR entity_type=$1) AND ($2 = '' OR entity_id=$2)`,
      [entityType, entityId],
    );
    const { rows } = await this.pool.query(
      `SELECT id, actor, action, entity_type AS "entityType", entity_id AS "entityId", summary, before_data AS "beforeData", after_data AS "afterData", created_at AS "createdAt"
       FROM audit_logs WHERE ($1 = '' OR entity_type=$1) AND ($2 = '' OR entity_id=$2) ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [entityType, entityId, limit, (page - 1) * limit],
    );
    return { data: rows, total: count.rows[0].total, page, limit };
  }

  async close() { await this.pool.end(); }
}

function createStore({ connectionString, filePath }) {
  return connectionString ? new PgStore(connectionString) : new JsonStore(filePath);
}

module.exports = { createStore, SYSTEM_CATEGORIES };
