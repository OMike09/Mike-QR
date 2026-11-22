'use strict';

// ============================================================================================
// Catalogue général (modèles) + affectation automatique par domaine d'activité.
//
// Modèle de données :
//   activity_domains     domaines d'activité administrables (actif/inactif, ordre, libellé)
//   catalog_categories   catégories modèles
//   catalog_category_domains  rattachement catégorie ↔ domaine
//   catalog_products     produits modèles (aucun prix)
//   catalog_product_domains   rattachement produit ↔ domaine (facultatif, sinon via catégorie)
//   catalog_media        bibliothèque d'images réutilisables
//   merchant_categories  catégories propres à une boutique (copiées depuis les modèles)
//   merchant_products.catalog_product_id  lien vers le modèle d'origine
//
// Règle d'or : un modèle n'est JAMAIS un produit vendu. Le marchand copie explicitement un
// modèle dans sa boutique ; sa copie lui appartient (nom, photo, contenance, unité, prix).
// ============================================================================================

const crypto = require('node:crypto');
const seed = require('./catalog-seed');

const uid = (p) => `${p}_${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`;
const nowIso = () => new Date().toISOString();
const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
const clone = (v) => (v == null ? null : JSON.parse(JSON.stringify(v)));

function fail(message, code = 'CATALOG_INVALID', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

class Catalog {
  constructor({ base, commerce }) {
    this.base = base;
    this.commerce = commerce;
    this.pg = Boolean(base && base.pool);
  }

  state() {
    const s = this.base.state;
    s.activityDomains ||= [];
    s.catalogCategories ||= [];
    s.catalogCategoryDomains ||= [];
    s.catalogProducts ||= [];
    s.catalogMedia ||= [];
    s.merchantCategories ||= [];
    s.merchantProducts ||= [];
    return s;
  }

  async save() {
    if (!this.pg) await this.base.save();
  }

  // ------------------------------------------------------------------ amorçage
  // Aligne les formats des modèles avec le référentiel (1,8 L, 100 cl…).
  // Ne touche QUE des fiches modèles ; aucune fiche marchand n'est lue ni écrite ici.
  async alignModelVolumes() {
    const products = await this.listProducts({ includeInactive: true, limit: 2000 });
    let updated = 0;
    for (const product of products) {
      if (!product.volumeLabel) continue;
      const canonical = seed.normalizeVolume(product.volumeLabel);
      if (!canonical.ml || !canonical.code) continue;
      const fromSaisie = seed.normalizeVolume(product.volumeLabel);
      const expectedLabel = fromSaisie.ml === canonical.ml ? fromSaisie.label
        : ((seed.VOLUMES.find((v) => v.ml === canonical.ml) || {}).label || canonical.label);
      if (product.volumeCode === canonical.code && product.volumeMl === canonical.ml) continue;
      await this.updateProduct(product.id, { volumeCode: canonical.code, volumeLabel: expectedLabel, volumeMl: canonical.ml });
      updated += 1;
    }
    return updated;
  }

  // Libellé des modèles : une seule occurrence de la contenance (« Beaufort Lager 33 cl »).
  // Le catalogue ne réécrit jamais une fiche marchand : seules les fiches modèles sont concernées.
  async alignModelLabels() {
    const wanted = new Map();
    for (const item of [...seed.BEVERAGES, ...seed.FOOD_AND_GOODS]) wanted.set(item.key, seed.displayLabel(item));
    const products = await this.listProducts({ includeInactive: true, limit: 2000 });
    let updated = 0;
    for (const product of products) {
      const label = wanted.get(product.catalogKey);
      if (!label || label === product.name) continue;
      await this.updateProduct(product.id, { name: label });
      updated += 1;
    }
    if (updated) console.log(`Catalogue : ${updated} libellé(s) de modèle normalisé(s).`);
    return updated;
  }

  async ensureSeed() {
    const existing = this.pg
      ? (await this.base.pool.query('SELECT COUNT(*)::int AS n FROM activity_domains')).rows[0].n
      : this.state().activityDomains.length;
    // Les formats de contenance utilisés par les fiches sont toujours enregistrés,
    // même quand le catalogue existe déjà (idempotent, aucun format remplacé).
    seed.ensureVolumes([...seed.BEVERAGES, ...seed.FOOD_AND_GOODS]
      .map((item) => { const v = seed.normalizeVolume(item.volume); return v.ml ? { code: v.code, label: v.label, ml: v.ml } : null; })
      .filter(Boolean));
    if (existing > 0) {
      const aligned = await this.alignModelVolumes();
      const relabelled = await this.alignModelLabels();
      if (aligned) console.log(`Catalogue : ${aligned} contenance(s) de modèle alignée(s) sur le référentiel.`);
      return { seeded: false, aligned, relabelled };
    }

    const domainByCode = new Map();
    let order = 0;
    for (const d of seed.DOMAINS) {
      const row = await this.upsertDomain({ code: d.code, label: d.label, family: d.family, sector: d.sector, custom: d.custom === true, sortOrder: order += 10 });
      domainByCode.set(d.code, row);
    }
    const catBySlug = new Map();
    order = 0;
    for (const c of seed.CATEGORIES) {
      const row = await this.upsertCategory({ slug: c.slug, label: c.label, sortOrder: order += 10 });
      catBySlug.set(c.slug, row);
      const codes = c.domains === '*' ? seed.DOMAINS.map((d) => d.code) : c.domains;
      for (const code of codes) {
        const dom = domainByCode.get(code);
        if (dom) await this.linkCategoryDomain(row.id, dom.id);
      }
    }
    order = 0;
    for (const p of seed.BEVERAGES) {
      const cat = catBySlug.get(p.category);
      const vol = seed.normalizeVolume(p.volume);
      await this.upsertProduct({
        catalogKey: p.key, name: seed.displayLabel(p), brand: p.brand, variant: p.variant || '',
        categoryId: cat ? cat.id : null, unit: p.unit, packaging: p.packaging || '',
        volumeCode: vol.code, volumeLabel: vol.label, volumeMl: vol.ml,
        imageKey: p.image, kind: 'boisson', sortOrder: order += 5,
      });
    }
    for (const p of seed.FOOD_AND_GOODS) {
      const cat = catBySlug.get(p.category);
      if (!cat) continue;
      await this.upsertProduct({ catalogKey: p.key, name: p.name, brand: '', variant: '', categoryId: cat.id, unit: p.unit, kind: 'autre', sortOrder: order += 5 });
      const row = await this.getProductByKey(p.key);
      for (const code of p.domains) {
        const dom = domainByCode.get(code);
        if (dom && row) await this.linkProductDomain(row.id, dom.id);
      }
    }
    return { seeded: true, domains: seed.DOMAINS.length, categories: seed.CATEGORIES.length, products: seed.BEVERAGES.length + seed.FOOD_AND_GOODS.length };
  }

  // ------------------------------------------------------------------ domaines
  async listDomains({ activeOnly = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, code, label, family, sector, is_active AS "isActive", is_custom AS "isCustom", sort_order AS "sortOrder",
                (SELECT COUNT(*)::int FROM catalog_category_domains cd WHERE cd.domain_id = d.id) AS "categoryCount"
           FROM activity_domains d ${activeOnly ? 'WHERE is_active = TRUE' : ''} ORDER BY sort_order, label`);
      return rows;
    }
    return this.state().activityDomains
      .filter((d) => !activeOnly || d.isActive)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'fr'))
      .map((d) => ({ ...clone(d), categoryCount: this.state().catalogCategoryDomains.filter((x) => x.domainId === d.id).length }));
  }

  async upsertDomain(data) {
    const code = clean(data.code, 60).toLowerCase().replace(/[^a-z0-9_]+/g, '_');
    if (!code) throw fail('Code de domaine obligatoire.');
    const label = clean(data.label, 120);
    if (!label) throw fail('Libellé du domaine obligatoire.');
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO activity_domains (id, code, label, family, sector, is_active, is_custom, sort_order)
         VALUES ($1,$2,$3,$4,$5,COALESCE($6,TRUE),COALESCE($7,FALSE),COALESCE($8,0))
         ON CONFLICT (code) DO UPDATE SET label = EXCLUDED.label, family = EXCLUDED.family, sector = EXCLUDED.sector,
           is_active = COALESCE($6, activity_domains.is_active), sort_order = COALESCE($8, activity_domains.sort_order), updated_at = NOW()
         RETURNING id, code, label, family, sector, is_active AS "isActive", is_custom AS "isCustom", sort_order AS "sortOrder"`,
        [uid('dom'), code, label, clean(data.family, 80) || 'Autres', clean(data.sector, 30) || 'general',
          data.isActive === undefined ? null : data.isActive === true, data.custom === true, Number(data.sortOrder) || null]);
      return rows[0];
    }
    const s = this.state();
    let row = s.activityDomains.find((d) => d.code === code);
    if (!row) { row = { id: uid('dom'), code, isActive: true, isCustom: data.custom === true, sortOrder: Number(data.sortOrder) || 0, createdAt: nowIso() }; s.activityDomains.push(row); }
    Object.assign(row, { label, family: clean(data.family, 80) || row.family || 'Autres', sector: clean(data.sector, 30) || row.sector || 'general',
      ...(data.isActive === undefined ? {} : { isActive: data.isActive === true }), updatedAt: nowIso() });
    await this.save();
    return clone(row);
  }

  async updateDomain(id, patch) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE activity_domains SET label = COALESCE($2,label), family = COALESCE($3,family), is_active = COALESCE($4,is_active),
           sort_order = COALESCE($5,sort_order), updated_at = NOW() WHERE id=$1
         RETURNING id, code, label, family, sector, is_active AS "isActive", is_custom AS "isCustom", sort_order AS "sortOrder"`,
        [id, patch.label ? clean(patch.label, 120) : null, patch.family ? clean(patch.family, 80) : null,
          patch.isActive === undefined ? null : patch.isActive === true, patch.sortOrder === undefined ? null : Number(patch.sortOrder)]);
      if (!rows[0]) throw fail('Domaine introuvable.', 'NOT_FOUND', 404);
      return rows[0];
    }
    const row = this.state().activityDomains.find((d) => d.id === id);
    if (!row) throw fail('Domaine introuvable.', 'NOT_FOUND', 404);
    if (patch.label) row.label = clean(patch.label, 120);
    if (patch.family) row.family = clean(patch.family, 80);
    if (patch.isActive !== undefined) row.isActive = patch.isActive === true;
    if (patch.sortOrder !== undefined) row.sortOrder = Number(patch.sortOrder) || 0;
    row.updatedAt = nowIso(); await this.save(); return clone(row);
  }

  async reorderDomains(ids) {
    if (!Array.isArray(ids) || !ids.length) throw fail('Liste d’identifiants attendue.');
    let i = 0;
    for (const id of ids) {
      await this.updateDomain(id, { sortOrder: (i += 10) });
    }
    return this.listDomains();
  }

  // ------------------------------------------------------------------ catégories
  async listCategories({ domainId = '', includeInactive = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT c.id, c.slug, c.label, c.is_active AS "isActive", c.sort_order AS "sortOrder",
                COALESCE(array_agg(cd.domain_id) FILTER (WHERE cd.domain_id IS NOT NULL), '{}') AS "domainIds"
           FROM catalog_categories c LEFT JOIN catalog_category_domains cd ON cd.category_id = c.id
          ${domainId || !includeInactive ? `WHERE ${[domainId ? 'EXISTS (SELECT 1 FROM catalog_category_domains x WHERE x.category_id=c.id AND x.domain_id=$1)' : '', includeInactive ? '' : 'c.is_active = TRUE'].filter(Boolean).join(' AND ')}` : ''}
          GROUP BY c.id ORDER BY c.sort_order, c.label`, domainId ? [domainId] : []);
      return rows;
    }
    const s = this.state();
    return s.catalogCategories
      .filter((c) => (includeInactive || c.isActive !== false) && (!domainId || s.catalogCategoryDomains.some((cd) => cd.categoryId === c.id && cd.domainId === domainId)))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'fr'))
      .map((c) => ({ ...clone(c), domainIds: s.catalogCategoryDomains.filter((cd) => cd.categoryId === c.id).map((cd) => cd.domainId) }));
  }

  async upsertCategory(data) {
    const slug = clean(data.slug, 60).toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    if (!slug) throw fail('Identifiant de catégorie obligatoire.');
    const label = clean(data.label, 120);
    if (!label) throw fail('Libellé de catégorie obligatoire.');
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO catalog_categories (id, slug, label, is_active, sort_order) VALUES ($1,$2,$3,COALESCE($4,TRUE),COALESCE($5,0))
         ON CONFLICT (slug) DO UPDATE SET label=EXCLUDED.label, is_active=COALESCE($4, catalog_categories.is_active),
           sort_order=COALESCE($5, catalog_categories.sort_order), updated_at=NOW()
         RETURNING id, slug, label, is_active AS "isActive", sort_order AS "sortOrder"`,
        [uid('cat'), slug, label, data.isActive === undefined ? null : data.isActive === true, Number(data.sortOrder) || null]);
      return rows[0];
    }
    const s = this.state();
    let row = s.catalogCategories.find((c) => c.slug === slug);
    if (!row) { row = { id: uid('cat'), slug, isActive: true, sortOrder: Number(data.sortOrder) || 0, createdAt: nowIso() }; s.catalogCategories.push(row); }
    Object.assign(row, { label, ...(data.isActive === undefined ? {} : { isActive: data.isActive === true }) });
    if (data.sortOrder !== undefined) row.sortOrder = Number(data.sortOrder) || 0;
    row.updatedAt = nowIso(); await this.save(); return clone(row);
  }

  async updateCategory(id, patch) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE catalog_categories SET label=COALESCE($2,label), is_active=COALESCE($3,is_active), sort_order=COALESCE($4,sort_order), updated_at=NOW()
          WHERE id=$1 RETURNING id, slug, label, is_active AS "isActive", sort_order AS "sortOrder"`,
        [id, patch.label ? clean(patch.label, 120) : null, patch.isActive === undefined ? null : patch.isActive === true,
          patch.sortOrder === undefined ? null : Number(patch.sortOrder)]);
      if (!rows[0]) throw fail('Catégorie introuvable.', 'NOT_FOUND', 404);
      return rows[0];
    }
    const row = this.state().catalogCategories.find((c) => c.id === id);
    if (!row) throw fail('Catégorie introuvable.', 'NOT_FOUND', 404);
    if (patch.label) row.label = clean(patch.label, 120);
    if (patch.isActive !== undefined) row.isActive = patch.isActive === true;
    if (patch.sortOrder !== undefined) row.sortOrder = Number(patch.sortOrder) || 0;
    row.updatedAt = nowIso(); await this.save(); return clone(row);
  }

  async linkCategoryDomain(categoryId, domainId) {
    if (this.pg) {
      await this.base.pool.query(`INSERT INTO catalog_category_domains (category_id, domain_id) VALUES ($1,$2)
        ON CONFLICT (category_id, domain_id) DO NOTHING`, [categoryId, domainId]);
      return;
    }
    const s = this.state();
    if (!s.catalogCategoryDomains.some((r) => r.categoryId === categoryId && r.domainId === domainId)) s.catalogCategoryDomains.push({ categoryId, domainId });
    await this.save();
  }

  async unlinkCategoryDomain(categoryId, domainId) {
    if (this.pg) { await this.base.pool.query('DELETE FROM catalog_category_domains WHERE category_id=$1 AND domain_id=$2', [categoryId, domainId]); return; }
    const s = this.state();
    s.catalogCategoryDomains = s.catalogCategoryDomains.filter((r) => !(r.categoryId === categoryId && r.domainId === domainId));
    await this.save();
  }

  async setCategoryDomains(categoryId, domainIds) {
    if (!Array.isArray(domainIds)) throw fail('Liste de domaines attendue.');
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM catalog_category_domains WHERE category_id=$1', [categoryId]);
        for (const id of domainIds) await client.query('INSERT INTO catalog_category_domains (category_id, domain_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [categoryId, id]);
        await client.query('COMMIT');
      } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
      return;
    }
    const s = this.state();
    s.catalogCategoryDomains = s.catalogCategoryDomains.filter((r) => r.categoryId !== categoryId);
    for (const id of domainIds) s.catalogCategoryDomains.push({ categoryId, domainId: id });
    await this.save();
  }

  // ------------------------------------------------------------------ produits modèles
  async listProducts({ domainId = '', categoryId = '', search = '', kind = '', includeInactive = false, limit = 500 } = {}) {
    if (this.pg) {
      const params = [];
      const where = [];
      if (!includeInactive) where.push('p.is_active = TRUE');
      if (categoryId) { params.push(categoryId); where.push(`p.category_id = $${params.length}`); }
      if (kind) { params.push(kind); where.push(`p.kind = $${params.length}`); }
      if (domainId) { params.push(domainId); where.push(`EXISTS (SELECT 1 FROM catalog_product_domains pd WHERE pd.product_id=p.id AND pd.domain_id=$${params.length})`); }
      if (search) { params.push(`%${clean(search, 80).toLowerCase()}%`); where.push(`(LOWER(p.name) LIKE $${params.length} OR LOWER(p.brand) LIKE $${params.length})`); }
      params.push(Math.min(Number(limit) || 500, 2000));
      const { rows } = await this.base.pool.query(
        `SELECT p.id, p.catalog_key AS "catalogKey", p.name, p.brand, p.variant, p.kind, p.unit, p.packaging,
                p.volume_code AS "volumeCode", p.volume_label AS "volumeLabel", p.volume_ml AS "volumeMl", p.image_key AS "imageKey",
                p.category_id AS "categoryId", c.slug AS "categorySlug", c.label AS "categoryLabel", p.is_active AS "isActive", p.sort_order AS "sortOrder",
                (SELECT COUNT(*)::int FROM merchant_products mp WHERE mp.catalog_product_id = p.id AND mp.status <> 'archived') AS "usageCount",
                ARRAY(SELECT pd.domain_id FROM catalog_product_domains pd WHERE pd.product_id = p.id) AS "domainIds"
           FROM catalog_products p LEFT JOIN catalog_categories c ON c.id = p.category_id
          ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY c.sort_order NULLS LAST, p.sort_order, p.name LIMIT $${params.length}`, params);
      return rows;
    }
    const s = this.state();
    const needle = clean(search, 80).toLowerCase();
    return s.catalogProducts
      .filter((p) => (includeInactive || p.isActive) && (!categoryId || p.categoryId === categoryId) && (!kind || p.kind === kind)
        && (!domainId || s.catalogProductDomains.some((d) => d.productId === p.id && d.domainId === domainId))
        && (!needle || `${p.name} ${p.brand}`.toLowerCase().includes(needle)))
      .slice(0, Math.min(Number(limit) || 500, 2000))
      .map((p) => this.decorateProduct(p, s));
  }

  decorateProduct(p, s) {
    const cat = s.catalogCategories.find((c) => c.id === p.categoryId);
    const used = s.merchantProducts.filter((mp) => mp.catalogProductId === p.id && mp.status !== 'archived');
    return { ...clone(p), categorySlug: cat ? cat.slug : '', categoryLabel: cat ? cat.label : '',
      domainIds: (s.catalogProductDomains || []).filter((r) => r.productId === p.id).map((r) => r.domainId),
      usageCount: used.length,
      // « Produit utilisé » : la fiche réelle du marchand, avec SON prix. Jamais celui du catalogue.
      usedBy: used.slice(0, 20).map((mp) => {
        const merchant = (s.merchants || []).find((m) => m.id === (s.merchantStores.find((st) => st.id === mp.storeId) || {}).merchantId);
        const storeRow = s.merchantStores.find((st) => st.id === mp.storeId) || {};
        return { storeId: mp.storeId, storeName: storeRow.name || '', merchantName: merchant ? (merchant.displayName || merchant.username) : '',
          name: mp.name, priceXof: mp.priceXof, unit: mp.unit || '', volumeLabel: mp.volumeLabel || '', status: mp.status || '' };
      }) };
  }

  // Utilisation marchande côté PostgreSQL : jointure explicite, aucune donnée inventée.
  async usedByFor(productIds) {
    if (!this.pg || !productIds.length) return new Map();
    const { rows } = await this.base.pool.query(
      `SELECT mp.catalog_product_id AS "catalogProductId", mp.id, mp.name, mp.price_xof AS "priceXof", mp.unit,
              mp.volume_label AS "volumeLabel", mp.status, s.name AS "storeName", m.display_name AS "merchantName"
         FROM merchant_products mp JOIN merchant_stores s ON s.id = mp.store_id
         LEFT JOIN merchant_accounts m ON m.id = s.merchant_id
        WHERE mp.catalog_product_id = ANY($1::text[]) AND mp.status <> 'archived'`, [productIds]);
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.catalogProductId)) map.set(row.catalogProductId, []);
      map.get(row.catalogProductId).push(row);
    }
    return map;
  }

  async getProduct(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, catalog_key AS "catalogKey", name, brand, variant, kind, unit, packaging, volume_code AS "volumeCode",
                volume_label AS "volumeLabel", volume_ml AS "volumeMl", image_key AS "imageKey", category_id AS "categoryId",
                is_active AS "isActive", sort_order AS "sortOrder" FROM catalog_products WHERE id=$1`, [id]);
      return rows[0] || null;
    }
    return clone(this.state().catalogProducts.find((p) => p.id === id) || null);
  }

  async getProductByKey(key) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id FROM catalog_products WHERE catalog_key=$1', [key]);
      return rows[0] ? this.getProduct(rows[0].id) : null;
    }
    const row = this.state().catalogProducts.find((p) => p.catalogKey === key);
    return row ? clone(row) : null;
  }

  _assertVolumeConsistency(label, ml) {
    const value = Number(ml);
    if (!label || !value) return;
    const parsed = seed.normalizeVolume(label);
    if (!parsed.ml) throw fail(`Contenance illisible : « ${label} ». Utilisez cl, ml ou litre.`);
    if (parsed.ml !== value) {
      throw fail(`Contenance incohérente : « ${label} » (${parsed.ml} ml) ne correspond pas à ${value} ml.`);
    }
  }

  async upsertProduct(data) {
    const key = clean(data.catalogKey, 80).toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    const name = clean(data.name, 160);
    if (!name) throw fail('Nom du produit obligatoire.');
    // Une contenance incohérente (libellé « 18 cl » et 1 800 ml) corromprait la fiche marchand :
    // la conversion prime et le libellé est reconstruit à partir des millilitres.
    this._assertVolumeConsistency(data.volumeLabel, data.volumeMl);
    const vol = data.volumeLabel !== undefined ? { code: clean(data.volumeCode, 20), label: clean(data.volumeLabel, 20), ml: Number(data.volumeMl) || null } : {};
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO catalog_products (id, catalog_key, name, brand, variant, kind, unit, packaging, volume_code, volume_label, volume_ml,
            image_key, category_id, is_active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,COALESCE($14,TRUE),COALESCE($15,0))
         ON CONFLICT (catalog_key) DO UPDATE SET name=EXCLUDED.name, brand=EXCLUDED.brand, variant=EXCLUDED.variant, kind=EXCLUDED.kind,
           unit=EXCLUDED.unit, packaging=EXCLUDED.packaging, volume_code=EXCLUDED.volume_code, volume_label=EXCLUDED.volume_label,
           volume_ml=EXCLUDED.volume_ml, image_key=EXCLUDED.image_key, category_id=EXCLUDED.category_id,
           is_active=COALESCE($14, catalog_products.is_active), sort_order=COALESCE($15, catalog_products.sort_order), updated_at=NOW()
         RETURNING id`,
        [uid('cp'), key || uid('k'), name, clean(data.brand, 80), clean(data.variant, 80), clean(data.kind, 20) || 'autre',
          clean(data.unit, 20) || 'piece', clean(data.packaging, 40), vol.code || '', vol.label || '', vol.ml || null,
          clean(data.imageKey, 80), data.categoryId || null, data.isActive === undefined ? null : data.isActive === true,
          Number(data.sortOrder) || null]);
      return this.getProduct(rows[0].id);
    }
    const s = this.state();
    let row = s.catalogProducts.find((p) => p.catalogKey === key);
    if (!row) { row = { id: uid('cp'), catalogKey: key, isActive: true, sortOrder: Number(data.sortOrder) || 0, createdAt: nowIso() }; s.catalogProducts.push(row); }
    Object.assign(row, { name, brand: clean(data.brand, 80), variant: clean(data.variant, 80), kind: clean(data.kind, 20) || 'autre',
      unit: clean(data.unit, 20) || 'piece', packaging: clean(data.packaging, 40),
      volumeCode: vol.code || row.volumeCode || '', volumeLabel: vol.label || row.volumeLabel || '', volumeMl: vol.ml || row.volumeMl || null,
      imageKey: clean(data.imageKey, 80) || row.imageKey || '', categoryId: data.categoryId || row.categoryId || null,
      ...(data.isActive === undefined ? {} : { isActive: data.isActive === true }), updatedAt: nowIso() });
    if (data.sortOrder !== undefined) row.sortOrder = Number(data.sortOrder) || 0;
    await this.save(); return clone(row);
  }

  async updateProduct(id, patch) {
    const row = await this.getProduct(id);
    if (!row) throw fail('Produit du catalogue introuvable.', 'NOT_FOUND', 404);
    const merged = { ...row, ...patch };
    const vol = patch.volumeLabel !== undefined ? seed.normalizeVolume(patch.volumeLabel) : { code: row.volumeCode, label: row.volumeLabel, ml: row.volumeMl };
    merged.volumeCode = patch.volumeCode || vol.code; merged.volumeLabel = patch.volumeLabel || vol.label; merged.volumeMl = patch.volumeMl || vol.ml;
    return this.upsertProduct({ ...merged, catalogKey: row.catalogKey });
  }

  async linkProductDomain(productId, domainId) {
    if (this.pg) { await this.base.pool.query('INSERT INTO catalog_product_domains (product_id, domain_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [productId, domainId]); return; }
    const s = this.state();
    s.catalogProductDomains ||= [];
    if (!s.catalogProductDomains.some((r) => r.productId === productId && r.domainId === domainId)) s.catalogProductDomains.push({ productId, domainId });
    await this.save();
  }

  // ------------------------------------------------------------------ médias
  async listMedia({ category = '', search = '' } = {}) {
    if (this.pg) {
      const params = []; const where = [];
      if (category) { params.push(category); where.push(`category=$${params.length}`); }
      if (search) { params.push(`%${clean(search, 60).toLowerCase()}%`); where.push(`(LOWER(name) LIKE $${params.length} OR LOWER(key) LIKE $${params.length})`); }
      const { rows } = await this.base.pool.query(
        `SELECT id, key, name, category, url, width, height, bytes, is_active AS "isActive", sort_order AS "sortOrder"
           FROM catalog_media ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY sort_order, name`, params);
      return rows;
    }
    const s = this.state();
    const needle = clean(search, 60).toLowerCase();
    return s.catalogMedia.filter((m) => (!category || m.category === category) && (!needle || `${m.name} ${m.key}`.toLowerCase().includes(needle))).map(clone);
  }

  async mediaMap() {
    const rows = await this.listMedia();
    return new Map(rows.map((m) => [m.key, m]));
  }

  // ------------------------------------------------------------------ affectation au domaine
  // Construit le plan d'affectation pour un ou plusieurs domaines : catégories + produits,
  // SANS doublon quand plusieurs activités partagent des catégories.
  async planForDomains(domainIds) {
    const ids = (Array.isArray(domainIds) ? domainIds : [domainIds]).filter(Boolean);
    if (!ids.length) return { domains: [], categories: [], products: [] };
    const allCats = await this.listCategories();
    const domainById = new Map((await this.listDomains()).map((d) => [d.id, d]));
    const byId = new Map(allCats.map((c) => [c.id, c]));
    const categories = allCats.filter((c) => c.isActive && (c.domainIds || []).some((d) => ids.includes(d)));
    const products = (await this.listProducts({ limit: 2000 })).filter((p) => p.isActive);
    const media = await this.mediaMap();
    const wanted = products.filter((p) => {
      const cat = byId.get(p.categoryId);
      const direct = (p.domainIds || []).some((d) => ids.includes(d));
      const viaCat = cat ? (cat.domainIds || []).some((d) => ids.includes(d)) : false;
      return direct || viaCat;
    });
    return {
      domains: ids.map((id) => domainById.get(id)).filter(Boolean),
      categories: categories.map((c) => ({ id: c.id, slug: c.slug, label: c.label, sortOrder: c.sortOrder })),
      products: wanted.map((p) => ({ ...p, imageUrl: (media.get(p.imageKey) || {}).url || '' })),
    };
  }

  // Applique le plan à une boutique : crée les catégories manquantes, SANS créer de produits.
  // Les produits restent des modèles : le marchand choisit lesquels il vend.
  async applyToStore(storeId, domainIds) {
    const plan = await this.planForDomains(domainIds);
    let created = 0;
    for (const cat of plan.categories) {
      const already = this.pg
        ? (await this.base.pool.query('SELECT 1 FROM merchant_categories WHERE store_id=$1 AND slug=$2', [storeId, cat.slug])).rows.length
        : this.state().merchantCategories.some((c) => c.storeId === storeId && c.slug === cat.slug);
      if (already) continue;
      await this.addStoreCategory(storeId, { slug: cat.slug, label: cat.label, catalogCategoryId: cat.id, sortOrder: cat.sortOrder });
      created += 1;
    }
    return { categoriesCreated: created, categories: plan.categories.length, availableProducts: plan.products.length };
  }

  // Activités d'un compte : la première est l'activité principale (une seule autorisée en base).
  async getMerchantDomains(merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT md.domain_id AS "domainId", md.is_primary AS "isPrimary", d.code, d.label, d.family
           FROM merchant_domains md JOIN activity_domains d ON d.id = md.domain_id
          WHERE md.merchant_id=$1 ORDER BY md.is_primary DESC, d.sort_order, d.label`, [merchantId]);
      return rows;
    }
    const s = this.state();
    s.merchantDomains ||= [];
    const domains = s.activityDomains || [];
    return s.merchantDomains.filter((r) => r.merchantId === merchantId)
      .map((r) => { const d = domains.find((x) => x.id === r.domainId) || {}; return { domainId: r.domainId, isPrimary: r.isPrimary, code: d.code, label: d.label, family: d.family }; })
      .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary));
  }

  async setMerchantDomains(merchantId, domainIds) {
    const ids = [...new Set((Array.isArray(domainIds) ? domainIds : []).filter((id) => typeof id === 'string' && id))];
    if (!ids.length) throw fail('Choisissez au moins une activité principale.');
    const valid = new Set((await this.listDomains({ activeOnly: true })).map((d) => d.id));
    const unknown = ids.filter((id) => !valid.has(id));
    if (unknown.length) throw fail('Une des activités choisies n’est plus disponible.');
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('DELETE FROM merchant_domains WHERE merchant_id=$1', [merchantId]);
        for (let i = 0; i < ids.length; i += 1) {
          await client.query('INSERT INTO merchant_domains (merchant_id, domain_id, is_primary) VALUES ($1,$2,$3)', [merchantId, ids[i], i === 0]);
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
      return ids;
    }
    const s = this.state();
    s.merchantDomains ||= [];
    s.merchantDomains = s.merchantDomains.filter((r) => r.merchantId !== merchantId);
    ids.forEach((id, i) => s.merchantDomains.push({ merchantId, domainId: id, isPrimary: i === 0, createdAt: nowIso() }));
    await this.save();
    return ids;
  }

  async addStoreCategory(storeId, data) {
    const slug = clean(data.slug || data.label, 60).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9-]+/g, '-');
    const label = clean(data.label, 120);
    if (!slug || !label) throw fail('Libellé de catégorie obligatoire.');
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO merchant_categories (id, store_id, slug, label, catalog_category_id, is_custom, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0)) ON CONFLICT (store_id, slug) DO NOTHING
         RETURNING id, store_id AS "storeId", slug, label, is_custom AS "isCustom", sort_order AS "sortOrder"`,
        [uid('mcat'), storeId, slug, label, data.catalogCategoryId || null, data.isCustom === true, Number(data.sortOrder) || null]);
      return rows[0] || null;
    }
    const s = this.state();
    if (s.merchantCategories.some((c) => c.storeId === storeId && c.slug === slug)) return null;
    const row = { id: uid('mcat'), storeId, slug, label, catalogCategoryId: data.catalogCategoryId || null, isCustom: data.isCustom === true,
      sortOrder: Number(data.sortOrder) || 0, createdAt: nowIso() };
    s.merchantCategories.push(row); await this.save(); return clone(row);
  }

  async listStoreCategories(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, store_id AS "storeId", slug, label, catalog_category_id AS "catalogCategoryId", is_custom AS "isCustom",
                is_active AS "isActive", sort_order AS "sortOrder" FROM merchant_categories WHERE store_id=$1 ORDER BY sort_order, label`, [storeId]);
      return rows;
    }
    return this.state().merchantCategories.filter((c) => c.storeId === storeId)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, 'fr')).map(clone);
  }

  async renameStoreCategory(storeId, id, patch) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_categories SET label=COALESCE($3,label), is_active=COALESCE($4,is_active), sort_order=COALESCE($5,sort_order), updated_at=NOW()
          WHERE id=$1 AND store_id=$2 RETURNING id, slug, label, is_active AS "isActive", sort_order AS "sortOrder"`,
        [id, storeId, patch.label ? clean(patch.label, 120) : null, patch.isActive === undefined ? null : patch.isActive === true,
          patch.sortOrder === undefined ? null : Number(patch.sortOrder)]);
      return rows[0] || null;
    }
    const row = this.state().merchantCategories.find((c) => c.id === id && c.storeId === storeId);
    if (!row) return null;
    if (patch.label) row.label = clean(patch.label, 120);
    if (patch.isActive !== undefined) row.isActive = patch.isActive === true;
    if (patch.sortOrder !== undefined) row.sortOrder = Number(patch.sortOrder) || 0;
    row.updatedAt = nowIso(); await this.save(); return clone(row);
  }

  // ------------------------------------------------------------------ ajout d'un modèle à la boutique
  // Copie profonde : la boutique reçoit SA propre ligne. Aucune écriture n'est faite sur le modèle
  // après coup, donc une évolution du catalogue général ne peut pas écraser le marchand.
  async addToStore(storeId, productId, { priceXof = 0, unit = '', volumeLabel = '', name = '' } = {}) {
    const model = await this.getProduct(productId);
    if (!model) throw fail('Produit du catalogue introuvable.', 'NOT_FOUND', 404);
    if (model.isActive === false) throw fail('Ce produit du catalogue est désactivé.', 'CATALOG_INACTIVE', 409);
    const media = await this.mediaMap();
    const imageUrl = (media.get(model.imageKey) || {}).url || '';
    const cat = model.categoryId ? (await this.listCategories()).find((c) => c.id === model.categoryId) : null;
    const volume = volumeLabel || model.volumeLabel || '';
    const product = await this.commerce.saveProduct(storeId, {
      name: name || model.name, description: '', sku: '', priceXof: Number(priceXof) || 0, stockQuantity: 0, trackStock: false,
      imageData: imageUrl, imageUrls: imageUrl ? [imageUrl] : [], category: cat ? cat.label : '',
      variants: [], status: 'active', sortOrder: 0,
      unit: unit || model.unit || 'piece', volumeLabel: volume, volumeMl: model.volumeMl || null,
      catalogProductId: model.id, imageKey: model.imageKey || '',
    });
    return product;
  }

  // ------------------------------------------------------------------ statistiques catalogue
  async overview() {
    const domains = await this.listDomains();
    const categories = await this.listCategories();
    const products = await this.listProducts({ includeInactive: true, limit: 2000 });
    const media = await this.listMedia();
    const duplicates = this.pg
      ? (await this.base.pool.query(`SELECT LOWER(name) AS name, COUNT(*)::int AS n FROM catalog_products GROUP BY LOWER(name) HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 50`)).rows
      : Object.entries(products.reduce((acc, p) => { const k = p.name.toLowerCase(); acc[k] = (acc[k] || 0) + 1; return acc; }, {}))
        .filter(([, n]) => n > 1).map(([name, n]) => ({ name, n }));
    const used = products.filter((p) => p.usageCount > 0).sort((a, b) => b.usageCount - a.usageCount).slice(0, 20);
    return {
      counts: {
        domains: domains.length, domainsActive: domains.filter((d) => d.isActive).length,
        categories: categories.length, products: products.length, productsActive: products.filter((p) => p.isActive).length,
        boissons: products.filter((p) => p.kind === 'boisson').length, media: media.length,
      },
      duplicates, mostUsed: used,
      productsWithoutImage: products.filter((p) => p.kind === 'boisson' && !(media.find((m) => m.key === p.imageKey) || {}).url).length,
    };
  }
}

module.exports = { Catalog, UNITS: seed.UNITS, VOLUMES: seed.VOLUMES, normalizeVolume: seed.normalizeVolume };
