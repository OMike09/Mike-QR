'use strict';

// ============================================================================================
// Routes du catalogue général.
//
//   Public / marchand (session marchand) :
//     GET  /api/merchant/activity-domains            domaines actifs (liste déroulante)
//     GET  /api/merchant/catalog/categories          catégories du/des domaine(s) du marchand
//     GET  /api/merchant/catalog/products            modèles disponibles, filtrables
//     GET  /api/merchant/catalog/media               bibliothèque d'images
//     POST /api/merchant/catalog/products/:id/add    copie un modèle dans la boutique (prix au choix)
//     POST /api/merchant/catalog/products/bulk-add   copie plusieurs modèles d'un coup
//     GET  /api/merchant/domains                     activités du marchand
//     PUT  /api/merchant/domains                     choisit les activités (une principale obligatoire)
//     POST /api/merchant/domains/:id/apply           (ré)applique les catégories du domaine
//     GET  /api/merchant/categories                  catégories de la boutique
//     POST /api/merchant/categories                  crée une catégorie personnalisée
//     PUT  /api/merchant/categories/:id              renomme / ordonne / masque
//     GET  /api/merchant/meta/units                  unités et contenances autorisées
//
//   Administration générale (session administrateur) :
//     GET/POST/PUT  /api/admin/catalog/domains[...]  gestion des domaines, réordonnancement
//     GET/POST/PUT  /api/admin/catalog/categories[...]
//     GET/POST/PUT  /api/admin/catalog/products[...]
//     GET/POST      /api/admin/catalog/media[...]
//     GET           /api/admin/catalog/overview      compteurs, doublons, produits les plus utilisés
//
// Aucune route n'écrit dans `merchant_products` sans passer par la couche commerce
// (contrôle des prix, du stock et de la propriété de la boutique).
// ============================================================================================

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { normalizeVolume, UNITS, VOLUMES } = require('./catalog');

const MEDIA_DIR = path.join(__dirname, 'public', 'media', 'catalogue');

module.exports = function registerCatalogRoutes(deps) {
  const { app, store, commerce, catalog, requireAdmin, requireMerchant, apiError, logger } = deps;
  const log = logger || console;

  const send = (res, promise, fallback = 'Erreur du catalogue.') => promise.catch((error) => {
    if (error && error.status && error.code) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error && error.code === 'DUPLICATE') return res.status(409).json({ error: error.message, code: 'DUPLICATE' });
    if (error && error.message && !error.status) return res.status(400).json({ error: error.message });
    return apiError(res, error, fallback);
  });

  // Une catégorie peut être désignée par son identifiant ou par son code : jamais de valeur devinée.
  async function resolveCategory(value) {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const categories = await catalog.listCategories({ includeInactive: true });
    const found = categories.find((c) => c.id === raw) || categories.find((c) => c.slug === raw.toLowerCase());
    if (!found) {
      const error = new Error(`Catégorie inconnue : ${raw}.`);
      error.status = 400; error.code = 'CATEGORY_UNKNOWN';
      throw error;
    }
    return found.id;
  }

  async function merchantContext(req) {
    const storeRow = await commerce.getStoreByMerchantId(req.merchant.id);
    if (!storeRow) {
      const error = new Error('Aucune boutique associée à ce compte.');
      error.status = 409; error.code = 'STORE_REQUIRED';
      throw error;
    }
    return storeRow;
  }

  async function merchantDomainIds(merchantId) {
    if (catalog.pg) {
      const { rows } = await catalog.base.pool.query('SELECT domain_id AS "domainId" FROM merchant_domains WHERE merchant_id=$1', [merchantId]);
      return rows.map((r) => r.domainId);
    }
    const state = catalog.base.state;
    state.merchantDomains ||= [];
    return state.merchantDomains.filter((r) => r.merchantId === merchantId).map((r) => r.domainId);
  }

  async function setMerchantDomains(merchantId, domainIds) {
    const ids = [...new Set((Array.isArray(domainIds) ? domainIds : []).filter((id) => typeof id === 'string' && id))];
    if (!ids.length) {
      const error = new Error('Choisissez au moins une activité principale.');
      error.status = 400; error.code = 'DOMAIN_REQUIRED';
      throw error;
    }
    const domains = await catalog.listDomains({ activeOnly: true });
    const valid = new Set(domains.map((d) => d.id));
    const rejected = ids.filter((id) => !valid.has(id));
    if (rejected.length) {
      const error = new Error('Une des activités choisies n’est plus disponible.');
      error.status = 400; error.code = 'DOMAIN_UNKNOWN';
      throw error;
    }
    if (catalog.pg) {
      const client = await catalog.base.pool.connect();
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
    const state = catalog.base.state;
    state.merchantDomains ||= [];
    state.merchantDomains = state.merchantDomains.filter((r) => r.merchantId !== merchantId);
    ids.forEach((id, i) => state.merchantDomains.push({ merchantId, domainId: id, isPrimary: i === 0, createdAt: new Date().toISOString() }));
    await catalog.base.save();
    return ids;
  }

  // ------------------------------------------------------------------ métadonnées
  app.get('/api/merchant/meta/units', requireMerchant, (_req, res) => {
    res.json({ data: { units: UNITS, volumes: VOLUMES } });
  });

  app.get('/api/merchant/activity-domains', requireMerchant, (req, res) => send(res,
    catalog.listDomains({ activeOnly: true }).then((data) => res.json({ data }))));

  // Liste publique : le formulaire « Devenir marchand » n'a évidemment aucune session marchand.
  // Seuls les domaines actifs sont exposés (code, libellé, famille), aucune donnée interne.
  app.get('/api/public/activity-domains', async (_req, res) => {
    try {
      const domains = await catalog.listDomains({ activeOnly: true });
      res.setHeader('Cache-Control', 'public, max-age=300');
      // `sector` reste l'ancien champ à 6 valeurs : conservé pour la compatibilité du stockage boutique.
      res.json({ data: domains.map((d) => ({ code: d.code, label: d.label, family: d.family, sector: d.sector })) });
    } catch (error) { apiError(res, error, 'Impossible de charger la liste des activités.'); }
  });

  // ------------------------------------------------------------------ activités du marchand
  app.get('/api/merchant/domains', requireMerchant, async (req, res) => {
    try {
      const ids = await merchantDomainIds(req.merchant.id);
      const all = await catalog.listDomains();
      const domains = ids.map((id) => all.find((d) => d.id === id)).filter(Boolean);
      res.json({ data: { domains, domainIds: ids, primaryId: ids[0] || '' } });
    } catch (error) { apiError(res, error, 'Impossible de charger les activités.'); }
  });

  app.put('/api/merchant/domains', requireMerchant, async (req, res) => {
    try {
      const ids = await setMerchantDomains(req.merchant.id, req.body?.domainIds);
      const storeRow = await merchantContext(req);
      const applied = await catalog.applyToStore(storeRow.id, ids);
      res.json({ data: { domainIds: ids, ...applied } });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible d’enregistrer les activités.');
    }
  });

  app.post('/api/merchant/domains/:domainId/apply', requireMerchant, async (req, res) => {
    try {
      const storeRow = await merchantContext(req);
      const ids = await merchantDomainIds(req.merchant.id);
      const target = req.params.domainId;
      if (!ids.includes(target)) {
        const error = new Error('Cette activité n’est pas rattachée à votre compte.');
        error.status = 403; error.code = 'DOMAIN_NOT_ASSIGNED';
        throw error;
      }
      const applied = await catalog.applyToStore(storeRow.id, [target]);
      res.json({ data: applied });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible d’appliquer cette activité.');
    }
  });

  // ------------------------------------------------------------------ catégories boutique
  app.get('/api/merchant/categories', requireMerchant, async (req, res) => {
    try {
      const storeRow = await merchantContext(req);
      res.json({ data: await catalog.listStoreCategories(storeRow.id) });
    } catch (error) { apiError(res, error, 'Impossible de charger les catégories.'); }
  });

  app.post('/api/merchant/categories', requireMerchant, async (req, res) => {
    try {
      const storeRow = await merchantContext(req);
      const label = String(req.body?.label || '').trim();
      if (!label) return res.status(400).json({ error: 'Indiquez le nom de la catégorie.' });
      const row = await catalog.addStoreCategory(storeRow.id, { label, isCustom: true, sortOrder: Number(req.body?.sortOrder) || 0 });
      if (!row) return res.status(409).json({ error: 'Cette catégorie existe déjà dans votre boutique.', code: 'DUPLICATE' });
      res.status(201).json({ data: row });
    } catch (error) { apiError(res, error, 'Impossible de créer la catégorie.'); }
  });

  app.put('/api/merchant/categories/:id', requireMerchant, async (req, res) => {
    try {
      const storeRow = await merchantContext(req);
      const row = await catalog.renameStoreCategory(storeRow.id, req.params.id, req.body || {});
      if (!row) return res.status(404).json({ error: 'Catégorie introuvable.' });
      res.json({ data: row });
    } catch (error) { apiError(res, error, 'Impossible de modifier la catégorie.'); }
  });

  // ------------------------------------------------------------------ catalogue modèles
  app.get('/api/merchant/catalog/categories', requireMerchant, async (req, res) => {
    try {
      const ids = await merchantDomainIds(req.merchant.id);
      const plan = await catalog.planForDomains(ids);
      res.json({ data: plan.categories, domainIds: ids });
    } catch (error) { apiError(res, error, 'Impossible de charger le catalogue.'); }
  });

  app.get('/api/merchant/catalog/products', requireMerchant, async (req, res) => {
    try {
      const ids = await merchantDomainIds(req.merchant.id);
      const plan = await catalog.planForDomains(ids);
      const search = String(req.query.search || '').trim().toLowerCase();
      const categorySlug = String(req.query.category || '').trim();
      const items = plan.products
        .filter((p) => (!categorySlug || p.categorySlug === categorySlug)
          && (!search || `${p.name} ${p.brand} ${p.variant}`.toLowerCase().includes(search)));
      res.json({ data: items, domainIds: ids });
    } catch (error) { apiError(res, error, 'Impossible de charger les produits du catalogue.'); }
  });

  app.get('/api/merchant/catalog/media', requireMerchant, async (req, res) => {
    try {
      res.json({ data: await catalog.listMedia({ search: String(req.query.search || '') }) });
    } catch (error) { apiError(res, error, 'Impossible de charger la bibliothèque d’images.'); }
  });

  app.post('/api/merchant/catalog/products/:id/add', requireMerchant, async (req, res) => {
    try {
      const storeRow = await merchantContext(req);
      const price = Number(req.body?.priceXof);
      if (!Number.isFinite(price) || price < 0) return res.status(400).json({ error: 'Indiquez un prix de vente (XOF). Aucun prix n’est imposé par le catalogue.' });
      const product = await catalog.addToStore(storeRow.id, req.params.id, {
        priceXof: Math.round(price),
        unit: String(req.body?.unit || ''),
        volumeLabel: String(req.body?.volumeLabel || ''),
        name: String(req.body?.name || '').slice(0, 160),
      });
      res.status(201).json({ data: product });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      if (error.code === 'DUPLICATE') return res.status(409).json({ error: error.message, code: 'DUPLICATE' });
      apiError(res, error, 'Impossible d’ajouter ce produit.');
    }
  });

  app.post('/api/merchant/catalog/products/bulk-add', requireMerchant, async (req, res) => {
    try {
      const storeRow = await merchantContext(req);
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 200) : [];
      if (!items.length) return res.status(400).json({ error: 'Sélectionnez au moins un produit.' });
      const created = []; const errors = [];
      for (const item of items) {
        const price = Number(item?.priceXof);
        if (!Number.isFinite(price) || price < 0) { errors.push({ id: item?.id, error: 'Prix manquant.' }); continue; }
        try {
          created.push(await catalog.addToStore(storeRow.id, String(item.id), { priceXof: Math.round(price), unit: String(item.unit || '') }));
        } catch (error) { errors.push({ id: item?.id, error: error.message }); }
      }
      res.status(created.length ? 201 : 400).json({ data: { created: created.length, errors } });
    } catch (error) { apiError(res, error, 'Impossible d’ajouter la sélection.'); }
  });

  // ------------------------------------------------------------------ administration
  app.get('/api/admin/catalog/overview', requireAdmin, (req, res) => send(res,
    catalog.overview().then((data) => res.json({ data }))));

  app.get('/api/admin/catalog/meta', requireAdmin, (_req, res) => {
    res.json({ data: { units: UNITS, volumes: VOLUMES } });
  });

  app.get('/api/admin/catalog/domains', requireAdmin, (req, res) => send(res,
    catalog.listDomains().then((data) => res.json({ data }))));

  app.post('/api/admin/catalog/domains', requireAdmin, async (req, res) => {
    try {
      const row = await catalog.upsertDomain(req.body || {});
      res.status(201).json({ data: row });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible d’enregistrer le domaine.');
    }
  });

  app.put('/api/admin/catalog/domains/:id', requireAdmin, async (req, res) => {
    try { res.json({ data: await catalog.updateDomain(req.params.id, req.body || {}) }); }
    catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible de modifier le domaine.');
    }
  });

  app.post('/api/admin/catalog/domains/reorder', requireAdmin, async (req, res) => {
    try { res.json({ data: await catalog.reorderDomains(req.body?.ids) }); }
    catch (error) { apiError(res, error, 'Impossible de réordonner les domaines.'); }
  });

  app.get('/api/admin/catalog/categories', requireAdmin, (req, res) => send(res,
    catalog.listCategories({ domainId: String(req.query.domainId || '') }).then((data) => res.json({ data }))));

  app.post('/api/admin/catalog/categories', requireAdmin, async (req, res) => {
    try {
      const row = await catalog.upsertCategory(req.body || {});
      if (Array.isArray(req.body?.domainIds)) await catalog.setCategoryDomains(row.id, req.body.domainIds);
      res.status(201).json({ data: row });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible d’enregistrer la catégorie.');
    }
  });

  app.put('/api/admin/catalog/categories/:id', requireAdmin, async (req, res) => {
    try {
      const row = await catalog.updateCategory(req.params.id, req.body || {});
      if (Array.isArray(req.body?.domainIds)) await catalog.setCategoryDomains(row.id, req.body.domainIds);
      res.json({ data: row });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible de modifier la catégorie.');
    }
  });

  app.get('/api/admin/catalog/products', requireAdmin, async (req, res) => {
    try {
      const data = await catalog.listProducts({
        domainId: String(req.query.domainId || ''), categoryId: String(req.query.categoryId || ''),
        search: String(req.query.search || ''), kind: String(req.query.kind || ''),
        includeInactive: req.query.all === '1', limit: Number(req.query.limit) || 500,
      });
      // « Produits utilisés » : fiches réelles des marchands, avec leur prix (jamais celui du modèle).
      if (catalog.pg) {
        const usage = await catalog.usedByFor(data.map((p) => p.id));
        for (const product of data) product.usedBy = usage.get(product.id) || [];
      }
      res.json({ data });
    } catch (error) { apiError(res, error, 'Impossible de charger les produits du catalogue.'); }
  });

  app.post('/api/admin/catalog/products', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const vol = body.volumeLabel ? normalizeVolume(body.volumeLabel) : { code: '', label: '', ml: null };
      if (body.volumeLabel && !vol.ml) return res.status(400).json({ error: 'Contenance illisible : utilisez cl, ml ou litre (ex. 33 cl, 500 ml, 1,5 L).' });
      if (body.volumeLabel && Number(body.volumeMl) && Number(body.volumeMl) !== vol.ml) {
        return res.status(400).json({ error: `Contenance incohérente : « ${body.volumeLabel} » (${vol.ml} ml) ne correspond pas à ${body.volumeMl} ml.` });
      }
      const categoryId = body.categoryId || await resolveCategory(body.categorySlug);
      const row = await catalog.upsertProduct({
        catalogKey: body.catalogKey || (body.name ? body.name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').slice(0, 60) : ''),
        name: body.name, brand: body.brand, variant: body.variant, kind: body.kind || 'autre', unit: body.unit,
        packaging: body.packaging, imageKey: body.imageKey, categoryId,
        volumeCode: vol.code, volumeLabel: vol.label, volumeMl: vol.ml, isActive: body.isActive, sortOrder: body.sortOrder,
      });
      if (Array.isArray(body.domainIds)) for (const id of body.domainIds) await catalog.linkProductDomain(row.id, id);
      res.status(201).json({ data: row });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible d’enregistrer le produit.');
    }
  });

  app.put('/api/admin/catalog/products/:id', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const patch = { ...body };
      if (body.categorySlug) patch.categoryId = await resolveCategory(body.categorySlug);
      if (body.volumeLabel) {
        const vol = normalizeVolume(body.volumeLabel);
        if (!vol.ml) return res.status(400).json({ error: 'Contenance illisible : utilisez cl, ml ou litre (ex. 33 cl, 500 ml, 1,5 L).' });
        if (body.volumeMl !== undefined && Number(body.volumeMl) && Number(body.volumeMl) !== vol.ml) {
          return res.status(400).json({ error: `Contenance incohérente : « ${body.volumeLabel} » (${vol.ml} ml) ne correspond pas à ${body.volumeMl} ml.` });
        }
        patch.volumeCode = vol.code; patch.volumeLabel = vol.label; patch.volumeMl = vol.ml;
      }
      const row = await catalog.updateProduct(req.params.id, patch);
      if (Array.isArray(body.domainIds)) {
        if (catalog.pg) await catalog.base.pool.query('DELETE FROM catalog_product_domains WHERE product_id=$1', [row.id]);
        for (const id of body.domainIds) await catalog.linkProductDomain(row.id, id);
      }
      res.json({ data: row });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ error: error.message, code: error.code });
      apiError(res, error, 'Impossible de modifier le produit.');
    }
  });

  app.get('/api/admin/catalog/media', requireAdmin, (req, res) => send(res,
    catalog.listMedia({ search: String(req.query.search || '') }).then((data) => res.json({ data }))));

  // Import d'une image de la bibliothèque : le fichier est déposé par le script d'amorçage,
  // la route ne fait qu'enregistrer la correspondance clé → URL publique.
  app.post('/api/admin/catalog/media', requireAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const key = String(body.key || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_');
      const url = String(body.url || '').trim();
      if (!key || !url) return res.status(400).json({ error: 'Clé et URL de l’image obligatoires.' });
      if (!/^\/media\/catalogue\/[a-z0-9_.-]+\.(png|webp|jpg|jpeg)$/i.test(url) && !/^data:image\//.test(url) && !/^https:\/\//.test(url)) {
        return res.status(400).json({ error: 'URL d’image non autorisée : utilisez /media/catalogue/….png.' });
      }
      const file = url.startsWith('/media/catalogue/') ? path.join(MEDIA_DIR, path.basename(url)) : '';
      const meta = file && fs.existsSync(file) ? { bytes: fs.statSync(file).size } : {};
      if (catalog.pg) {
        const { rows } = await catalog.base.pool.query(
          `INSERT INTO catalog_media (id, key, name, category, url, bytes, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,0)) ON CONFLICT (key) DO UPDATE SET url=EXCLUDED.url, name=EXCLUDED.name,
             category=EXCLUDED.category, bytes=EXCLUDED.bytes, is_active=TRUE
           RETURNING id, key, name, category, url, bytes`,
          [`media_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`, key, String(body.name || key).slice(0, 120),
            String(body.category || '').slice(0, 40), url, meta.bytes || Number(body.bytes) || null, Number(body.sortOrder) || null]);
        return res.status(201).json({ data: rows[0] });
      }
      const state = catalog.base.state; state.catalogMedia ||= [];
      let row = state.catalogMedia.find((m) => m.key === key);
      if (!row) { row = { id: `media_${key}`, key }; state.catalogMedia.push(row); }
      Object.assign(row, { name: String(body.name || key).slice(0, 120), category: String(body.category || ''), url, bytes: meta.bytes || null, isActive: true });
      await catalog.base.save();
      res.status(201).json({ data: row });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer l’image.'); }
  });

  log.info?.('[catalogue] routes montées');
};
