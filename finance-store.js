'use strict';

const crypto = require('node:crypto');

const CUSTOMER_TYPES = new Set(['individual', 'business', 'custom']);
const QR_PURPOSES = new Set(['contact', 'catalog', 'prices', 'menu', 'website', 'social', 'services', 'order', 'other']);
const DESTINATIONS = new Set(['page', 'redirect']);
const METHODS = new Set(['cash', 'mobile_money', 'bank_transfer', 'card', 'other']);
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const money = (value) => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
const makeId = () => crypto.randomUUID();
const makeReference = (prefix) => `${prefix}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;
const publicCode = () => crypto.randomBytes(7).toString('base64url');

function planQuote(plans, { customerType, qrPurpose, destinationType, planId, optionIds = [] }) {
  if (!CUSTOMER_TYPES.has(customerType)) throw Object.assign(new Error('Type de client invalide.'), { code: 'INVALID_QUOTE' });
  if (!QR_PURPOSES.has(qrPurpose) || !DESTINATIONS.has(destinationType)) throw Object.assign(new Error('Type de QR invalide.'), { code: 'INVALID_QUOTE' });
  const plan = (Array.isArray(plans) ? plans : []).find((item) => item.id === planId && item.active
    && (item.customerType === 'any' || item.customerType === customerType)
    && (item.qrPurpose === 'any' || item.qrPurpose === qrPurpose)
    && (item.destinationType === 'any' || item.destinationType === destinationType));
  if (!plan) throw Object.assign(new Error('Aucun tarif actif ne correspond à ce client et à ce type de QR. Demandez au PDG de configurer un tarif.'), { code: 'PRICE_NOT_CONFIGURED' });
  const selectedIds = [...new Set((Array.isArray(optionIds) ? optionIds : []).map(String))];
  const optionsById = new Map((Array.isArray(plan.options) ? plan.options : []).filter((item) => item.active !== false).map((item) => [item.id, item]));
  if (selectedIds.some((id) => !optionsById.has(id))) throw Object.assign(new Error('Une option sélectionnée n’appartient pas au tarif actif.'), { code: 'INVALID_QUOTE' });
  const options = selectedIds.map((id) => {
    const item = optionsById.get(id);
    return { id: item.id, name: item.name, amountXof: money(item.amountXof) };
  });
  const unitAmountXof = money(plan.amountXof);
  const totalAmountXof = unitAmountXof + options.reduce((sum, item) => sum + item.amountXof, 0);
  if (!Number.isSafeInteger(totalAmountXof)) throw Object.assign(new Error('Le total du tarif dépasse la capacité autorisée.'), { code: 'INVALID_QUOTE' });
  return {
    planId: plan.id, planName: plan.name, customerType, qrPurpose, destinationType,
    unitAmountXof, options, totalAmountXof, currency: 'XOF',
  };
}

function normalizePlanInput(input, prior = null) {
  const id = String(input?.id || prior?.id || makeId()).slice(0, 80);
  const name = String(input?.name || '').trim().slice(0, 100);
  const customerType = String(input?.customerType || 'any');
  const qrPurpose = String(input?.qrPurpose || 'any');
  const destinationType = String(input?.destinationType || 'any');
  const amountXof = Number(input?.amountXof);
  if (!name) throw Object.assign(new Error('Le nom du tarif est obligatoire.'), { code: 'INVALID_PRICING' });
  if (!['any', ...CUSTOMER_TYPES].includes(customerType)) throw Object.assign(new Error('Type de client invalide pour ce tarif.'), { code: 'INVALID_PRICING' });
  if (!['any', ...QR_PURPOSES].includes(qrPurpose)) throw Object.assign(new Error('Usage QR invalide pour ce tarif.'), { code: 'INVALID_PRICING' });
  if (!['any', ...DESTINATIONS].includes(destinationType)) throw Object.assign(new Error('Destination invalide pour ce tarif.'), { code: 'INVALID_PRICING' });
  if (!Number.isSafeInteger(amountXof) || amountXof < 0) throw Object.assign(new Error('Le prix doit être un montant XOF entier positif ou nul.'), { code: 'INVALID_PRICING' });
  const existingOptions = new Map((prior?.options || []).map((item) => [item.id, item]));
  const optionIds = new Set();
  const options = (Array.isArray(input?.options) ? input.options : []).map((raw) => {
    const optionId = String(raw?.id || makeId()).slice(0, 80);
    const optionName = String(raw?.name || '').trim().slice(0, 100);
    const optionAmount = Number(raw?.amountXof);
    if (!optionName || !Number.isSafeInteger(optionAmount) || optionAmount < 0) throw Object.assign(new Error('Chaque option doit avoir un nom et un prix XOF entier valide.'), { code: 'INVALID_PRICING' });
    if (optionIds.has(optionId)) throw Object.assign(new Error('Identifiant d’option en double.'), { code: 'INVALID_PRICING' });
    optionIds.add(optionId);
    const previous = existingOptions.get(optionId);
    return { id: optionId, name: optionName, amountXof: optionAmount, active: raw?.active !== false, createdAt: previous?.createdAt || new Date().toISOString() };
  }).slice(0, 20);
  const total = amountXof + options.reduce((sum, item) => sum + item.amountXof, 0);
  if (!Number.isSafeInteger(total)) throw Object.assign(new Error('Le total du tarif dépasse la capacité autorisée.'), { code: 'INVALID_PRICING' });
  return {
    id, name, customerType, qrPurpose, destinationType, amountXof,
    options, active: input?.active !== false,
    createdAt: prior?.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString(),
  };
}

function getTotals(order, payments = []) {
  const receipts = payments.filter((row) => row.entryType === 'receipt');
  const refunds = payments.filter((row) => row.entryType === 'refund');
  const confirmedReceipts = receipts.filter((row) => row.status === 'confirmed').reduce((sum, row) => sum + Number(row.amountXof || 0), 0);
  const confirmedRefunds = refunds.filter((row) => row.status === 'confirmed').reduce((sum, row) => sum + Number(row.amountXof || 0), 0);
  const pending = receipts.filter((row) => row.status === 'pending').reduce((sum, row) => sum + Number(row.amountXof || 0), 0);
  const rejected = receipts.filter((row) => row.status === 'rejected').reduce((sum, row) => sum + Number(row.amountXof || 0), 0);
  const cash = receipts.filter((row) => row.status === 'confirmed' && row.method === 'cash').reduce((sum, row) => sum + Number(row.amountXof || 0), 0)
    - refunds.filter((row) => row.status === 'confirmed' && row.method === 'cash').reduce((sum, row) => sum + Number(row.amountXof || 0), 0);
  const electronic = receipts.filter((row) => row.status === 'confirmed' && row.method !== 'cash').reduce((sum, row) => sum + Number(row.amountXof || 0), 0)
    - refunds.filter((row) => row.status === 'confirmed' && row.method !== 'cash').reduce((sum, row) => sum + Number(row.amountXof || 0), 0);
  const totalAmountXof = Number(order.totalAmountXof || 0);
  const netReceivedXof = Math.max(0, confirmedReceipts - confirmedRefunds);
  let paymentStatus = 'unpaid';
  if (order.orderState === 'cancelled') paymentStatus = 'cancelled';
  else if (confirmedReceipts > 0 && confirmedRefunds >= confirmedReceipts) paymentStatus = 'refunded';
  else if (netReceivedXof >= totalAmountXof) paymentStatus = 'paid';
  else if (netReceivedXof > 0) paymentStatus = 'partial';
  else if (pending > 0) paymentStatus = 'pending';
  const outstandingXof = ['cancelled', 'refunded'].includes(paymentStatus) ? 0 : Math.max(0, totalAmountXof - netReceivedXof);
  return {
    grossReceivedXof: confirmedReceipts,
    refundedXof: confirmedRefunds,
    netReceivedXof,
    pendingAmountXof: pending,
    rejectedAmountXof: rejected,
    outstandingXof,
    cashReceivedXof: cash,
    electronicReceivedXof: electronic,
    paymentStatus,
  };
}

function eventRow(orderId, paymentId, actor, action, summary, beforeData, afterData, reason = '') {
  return {
    id: makeId(), orderId, paymentId: paymentId || null, actorType: actor?.type || 'system', actorId: actor?.id || null,
    actorLabel: actor?.label || actor?.type || 'Système', action, summary,
    beforeData: beforeData || null, afterData: afterData || null, reason, createdAt: new Date().toISOString(),
  };
}

function publicOrder(order, payments = [], events = []) {
  const safeOrder = clone(order);
  delete safeOrder.providerSecret;
  return { ...safeOrder, ...getTotals(order, payments), payments: clone(payments), history: clone(events) };
}

class FinanceStore {
  constructor(store) {
    this.store = store;
    this.isPg = Boolean(store.pool);
  }

  ensureJson() {
    const state = this.store.state;
    state.orders ||= [];
    state.payments ||= [];
    state.financeEvents ||= [];
    state.settings ||= {};
    state.settings.financePricing ||= [];
    return state;
  }

  quote(plans, input) { return planQuote(plans, input); }
  makeReference(prefix) { return makeReference(prefix); }

  async getPricing() {
    if (!this.isPg) return clone(this.ensureJson().settings.financePricing || []);
    const { rows } = await this.store.pool.query('SELECT setting_value FROM app_settings WHERE setting_key=$1', ['financePricing']);
    return Array.isArray(rows[0]?.setting_value) ? rows[0].setting_value : [];
  }

  async savePricing(plans) {
    if (!this.isPg) {
      const state = this.ensureJson();
      state.settings.financePricing = clone(plans);
      await this.store.save();
      return clone(state.settings.financePricing);
    }
    await this.store.pool.query(
      `INSERT INTO app_settings (setting_key, setting_value, updated_at) VALUES ('financePricing', $1::jsonb, NOW())
       ON CONFLICT (setting_key) DO UPDATE SET setting_value=EXCLUDED.setting_value, updated_at=NOW()`, [JSON.stringify(plans)]);
    return this.getPricing();
  }

  async createCodeAndOrder(codeData, managerId, orderInput) {
    if (!this.isPg) {
      const state = this.ensureJson();
      if (managerId) {
        const manager = state.managers.find((row) => row.id === managerId && !row.deletedAt);
        if (!manager || manager.status !== 'active') throw Object.assign(new Error('Le compte gestionnaire n’est plus actif.'), { code: 'MANAGER_NOT_ACTIVE' });
        if (manager.canCreateCodes === false) throw Object.assign(new Error('La création de QR est désactivée pour votre compte. Contactez le PDG.'), { code: 'MANAGER_CREATE_FORBIDDEN' });
        if (codeData.status === 'active' && manager.canSelfActivateCodes !== true) throw Object.assign(new Error('Vous devez soumettre ce QR à validation.'), { code: 'MANAGER_ACTIVATION_FORBIDDEN' });
        const qrCount = state.qrCodes.filter((row) => row.managerId === managerId && !row.deletedAt).length;
        if (Number(manager.qrLimit) > 0 && qrCount >= Number(manager.qrLimit)) throw Object.assign(new Error('La limite de QR autorisée pour votre compte est atteinte.'), { code: 'MANAGER_QR_LIMIT' });
      }
      const stamp = new Date().toISOString();
      let code = publicCode();
      while (state.qrCodes.some((row) => row.publicCode === code)) code = publicCode();
      const qr = {
        id: makeId(), publicCode: code, ...clone(codeData), managerId: managerId || null,
        status: codeData.status || 'active', statusReason: codeData.statusReason || '', createdAt: stamp, updatedAt: stamp, deletedAt: null,
      };
      const order = {
        id: makeId(), ...clone(orderInput), qrCodeId: qr.id, qrName: qr.name, publicCode: qr.publicCode,
        orderState: 'open', originalTotalAmountXof: Number(orderInput.totalAmountXof), createdAt: stamp, updatedAt: stamp,
      };
      state.qrCodes.push(qr); state.orders.push(order);
      state.financeEvents.push(eventRow(order.id, null, { type: orderInput.createdByType, id: orderInput.createdById, label: orderInput.managerName }, 'order_created',
        `Commande ${order.reference} créée pour ${order.totalAmountXof} XOF.`, null, { reference: order.reference, totalAmountXof: order.totalAmountXof, currency: 'XOF' }));
      await this.store.save();
      return { code: await this.store.getCode(qr.id), order: await this.getOrder(order.id) };
    }

    const pool = this.store.pool;
    const id = makeId();
    const stamp = new Date().toISOString();
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const code = publicCode();
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        if (managerId) {
          const { rows: policyRows } = await client.query(
            `SELECT status, deleted_at AS "deletedAt", can_create_codes AS "canCreateCodes",
              can_self_activate_codes AS "canSelfActivateCodes", qr_limit AS "qrLimit"
             FROM managers WHERE id=$1 FOR UPDATE`, [managerId]);
          const policy = policyRows[0];
          if (!policy || policy.deletedAt || policy.status !== 'active') throw Object.assign(new Error('Le compte gestionnaire n’est plus actif.'), { code: 'MANAGER_NOT_ACTIVE' });
          if (!policy.canCreateCodes) throw Object.assign(new Error('La création de QR est désactivée pour votre compte. Contactez le PDG.'), { code: 'MANAGER_CREATE_FORBIDDEN' });
          if (codeData.status === 'active' && !policy.canSelfActivateCodes) throw Object.assign(new Error('Vous devez soumettre ce QR à validation.'), { code: 'MANAGER_ACTIVATION_FORBIDDEN' });
          if (Number(policy.qrLimit) > 0) {
            const { rows: countRows } = await client.query('SELECT COUNT(*)::int AS total FROM qr_codes WHERE manager_id=$1 AND deleted_at IS NULL', [managerId]);
            if (countRows[0].total >= Number(policy.qrLimit)) throw Object.assign(new Error('La limite de QR autorisée pour votre compte est atteinte.'), { code: 'MANAGER_QR_LIMIT' });
          }
        }
        await client.query(
          `INSERT INTO qr_codes (id, public_code, name, beneficiary_id, category_id, purpose, destination_type, target_url,
             title, description, content_text, selected_fields, selected_photo_ids, extra_links, style, status, status_reason, manager_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18)`,
          [id, code, codeData.name, codeData.beneficiaryId, codeData.categoryId || null, codeData.purpose, codeData.destinationType,
            codeData.targetUrl, codeData.title, codeData.description, codeData.contentText,
            JSON.stringify(codeData.selectedFields || []), JSON.stringify(codeData.selectedPhotoIds || []),
            JSON.stringify(codeData.extraLinks || []), JSON.stringify(codeData.style || {}), codeData.status || 'active', codeData.statusReason || '', managerId || null]);
        const orderId = makeId();
        await client.query(
          `INSERT INTO qr_orders (id, reference, qr_code_id, manager_id, manager_name, beneficiary_id, beneficiary_name,
             client_name, company_name, customer_type, qr_purpose, destination_type, pricing_plan_id, pricing_plan_name,
             unit_amount_xof, selected_options, total_amount_xof, original_total_amount_xof, currency, payment_method,
             order_state, created_by_type, created_by_id, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$17,$18,'cash','open',$19,$20,$21,$21)`,
          [orderId, orderInput.reference, id, managerId || null, orderInput.managerName || 'PDG', orderInput.beneficiaryId,
            orderInput.beneficiaryName, orderInput.clientName, orderInput.companyName || '', orderInput.customerType,
            orderInput.qrPurpose, orderInput.destinationType, orderInput.pricingPlanId, orderInput.pricingPlanName,
            orderInput.unitAmountXof, JSON.stringify(orderInput.selectedOptions || []), orderInput.totalAmountXof,
            'XOF', orderInput.createdByType, orderInput.createdById || null, stamp]);
        await client.query(
          `INSERT INTO qr_finance_events (order_id, actor_type, actor_id, action, summary, after_data)
           VALUES ($1,$2,$3,'order_created',$4,$5::jsonb)`,
          [orderId, orderInput.createdByType, orderInput.createdById || null,
            `Commande ${orderInput.reference} créée pour ${orderInput.totalAmountXof} XOF.`,
            JSON.stringify({ reference: orderInput.reference, totalAmountXof: orderInput.totalAmountXof, currency: 'XOF' })]);
        await client.query('COMMIT');
        const [savedCode, savedOrder] = await Promise.all([this.store.getCode(id), this.getOrder(orderId)]);
        return { code: savedCode, order: savedOrder };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505' && String(error.constraint || '').includes('public_code')) continue;
        throw error;
      } finally { client.release(); }
    }
    throw new Error('Impossible de générer un identifiant QR unique.');
  }

  async rawOrder(id) {
    if (!this.isPg) return clone(this.ensureJson().orders.find((row) => row.id === id) || null);
    const { rows } = await this.store.pool.query(`${this.baseOrderSql()} WHERE o.id=$1`, [id]);
    return rows[0] ? this.normalizeOrder(rows[0]) : null;
  }

  baseOrderSql() {
    return `SELECT o.id, o.reference, o.qr_code_id AS "qrCodeId", o.manager_id AS "managerId", o.manager_name AS "managerName",
      o.beneficiary_id AS "beneficiaryId", o.beneficiary_name AS "beneficiaryName", o.client_name AS "clientName", o.company_name AS "companyName",
      o.customer_type AS "customerType", o.qr_purpose AS "qrPurpose", o.destination_type AS "destinationType", o.pricing_plan_id AS "pricingPlanId",
      o.pricing_plan_name AS "pricingPlanName", o.unit_amount_xof AS "unitAmountXof", o.selected_options AS "selectedOptions",
      o.total_amount_xof AS "totalAmountXof", o.original_total_amount_xof AS "originalTotalAmountXof", o.currency, o.payment_method AS "paymentMethod",
      o.order_state AS "orderState", o.created_by_type AS "createdByType", o.created_by_id AS "createdById", o.correction_reason AS "correctionReason",
      o.created_at AS "createdAt", o.updated_at AS "updatedAt", q.public_code AS "publicCode", COALESCE(q.name,o.beneficiary_name) AS "qrName",
      COALESCE(t.gross_received,0)::bigint AS "grossReceivedXof", COALESCE(t.refunded,0)::bigint AS "refundedXof",
      COALESCE(t.pending_amount,0)::bigint AS "pendingAmountXof", COALESCE(t.rejected_amount,0)::bigint AS "rejectedAmountXof",
      COALESCE(t.cash_gross,0)::bigint AS "cashGrossXof", COALESCE(t.electronic_gross,0)::bigint AS "electronicGrossXof",
      COALESCE(t.cash_refunds,0)::bigint AS "cashRefundsXof", COALESCE(t.electronic_refunds,0)::bigint AS "electronicRefundsXof",
      CASE WHEN o.order_state='cancelled' THEN 'cancelled'
        WHEN COALESCE(t.gross_received,0)>0 AND COALESCE(t.refunded,0)>=COALESCE(t.gross_received,0) THEN 'refunded'
        WHEN COALESCE(t.gross_received,0)-COALESCE(t.refunded,0)>=o.total_amount_xof THEN 'paid'
        WHEN COALESCE(t.gross_received,0)-COALESCE(t.refunded,0)>0 THEN 'partial'
        WHEN COALESCE(t.pending_amount,0)>0 THEN 'pending' ELSE 'unpaid' END AS "paymentStatus"
      FROM qr_orders o
      LEFT JOIN qr_codes q ON q.id=o.qr_code_id
      LEFT JOIN LATERAL (
        SELECT SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed') AS gross_received,
          SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed') AS refunded,
          SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='pending') AS pending_amount,
          SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='rejected') AS rejected_amount,
          SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed' AND method='cash') AS cash_gross,
          SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed' AND method<>'cash') AS electronic_gross,
          SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed' AND method='cash') AS cash_refunds,
          SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed' AND method<>'cash') AS electronic_refunds
        FROM qr_payment_entries p WHERE p.order_id=o.id
      ) t ON TRUE`;
  }

  normalizeOrder(row) {
    if (!row) return null;
    const order = { ...row };
    for (const key of ['unitAmountXof', 'totalAmountXof', 'originalTotalAmountXof', 'grossReceivedXof', 'refundedXof', 'pendingAmountXof', 'rejectedAmountXof', 'cashGrossXof', 'electronicGrossXof', 'cashRefundsXof', 'electronicRefundsXof']) {
      if (order[key] != null) order[key] = Number(order[key]);
    }
    const net = Math.max(0, Number(order.grossReceivedXof || 0) - Number(order.refundedXof || 0));
    order.netReceivedXof = net;
    order.outstandingXof = ['cancelled', 'refunded'].includes(order.paymentStatus) ? 0 : Math.max(0, Number(order.totalAmountXof || 0) - net);
    order.cashReceivedXof = Number(order.cashGrossXof || 0) - Number(order.cashRefundsXof || 0);
    order.electronicReceivedXof = Number(order.electronicGrossXof || 0) - Number(order.electronicRefundsXof || 0);
    delete order.cashGrossXof;
    delete order.electronicGrossXof;
    delete order.cashRefundsXof;
    delete order.electronicRefundsXof;
    return order;
  }

  async listOrders(filters = {}, managerScope = '') {
    const page = Math.max(1, Number(filters.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(filters.limit) || 25));
    const normalized = {
      managerId: managerScope || String(filters.managerId || ''),
      search: String(filters.search || '').trim().slice(0, 160).toLocaleLowerCase('fr'),
      client: String(filters.client || '').trim().slice(0, 120).toLocaleLowerCase('fr'),
      company: String(filters.company || '').trim().slice(0, 120).toLocaleLowerCase('fr'),
      qr: String(filters.qr || '').trim().slice(0, 120).toLocaleLowerCase('fr'),
      qrCodeId: String(filters.qrCodeId || ''),
      customerType: CUSTOMER_TYPES.has(filters.customerType) ? filters.customerType : '',
      method: ['cash', 'mobile_money', 'bank_transfer', 'card', 'other', 'electronic'].includes(filters.method) ? filters.method : '',
      status: ['unpaid', 'pending', 'partial', 'paid', 'cancelled', 'refunded'].includes(filters.status) ? filters.status : '',
      from: String(filters.from || ''), to: String(filters.to || ''),
    };
    if (!this.isPg) {
      const state = this.ensureJson();
      let rows = state.orders.map((order) => {
        const qr = state.qrCodes.find((item) => item.id === order.qrCodeId);
        const payments = state.payments.filter((row) => row.orderId === order.id);
        return { ...order, qrName: qr?.name || order.qrName, ...getTotals(order, payments) };
      });
      if (normalized.managerId) rows = rows.filter((row) => row.managerId === normalized.managerId);
      if (normalized.qrCodeId) rows = rows.filter((row) => row.qrCodeId === normalized.qrCodeId);
      if (normalized.customerType) rows = rows.filter((row) => row.customerType === normalized.customerType);
      if (normalized.method) rows = rows.filter((row) => row.paymentMethod === normalized.method || (normalized.method === 'electronic' && row.paymentMethod !== 'cash') || state.payments.some((p) => p.orderId === row.id && (p.method === normalized.method || (normalized.method === 'electronic' && p.method !== 'cash'))));
      if (normalized.status) rows = rows.filter((row) => row.paymentStatus === normalized.status);
      if (normalized.from) rows = rows.filter((row) => row.createdAt >= normalized.from);
      if (normalized.to) rows = rows.filter((row) => row.createdAt <= `${normalized.to}T23:59:59.999Z`);
      if (normalized.client) rows = rows.filter((row) => String(row.clientName || '').toLocaleLowerCase('fr').includes(normalized.client));
      if (normalized.company) rows = rows.filter((row) => String(row.companyName || '').toLocaleLowerCase('fr').includes(normalized.company));
      if (normalized.qr) rows = rows.filter((row) => `${row.qrName || ''} ${row.publicCode || ''} ${row.qrCodeId || ''}`.toLocaleLowerCase('fr').includes(normalized.qr));
      if (normalized.search) rows = rows.filter((row) => `${row.reference} ${row.clientName} ${row.companyName} ${row.beneficiaryName} ${row.qrName} ${row.managerName}`.toLocaleLowerCase('fr').includes(normalized.search));
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
    }

    const params = [];
    const clauses = [];
    const add = (value) => { params.push(value); return `$${params.length}`; };
    if (normalized.managerId) clauses.push(`o."managerId"=${add(normalized.managerId)}`);
    if (normalized.qrCodeId) clauses.push(`o."qrCodeId"=${add(normalized.qrCodeId)}`);
    if (normalized.customerType) clauses.push(`o."customerType"=${add(normalized.customerType)}`);
    if (normalized.status) clauses.push(`o."paymentStatus"=${add(normalized.status)}`);
    if (normalized.from) clauses.push(`o."createdAt" >= ${add(normalized.from)}::timestamptz`);
    if (normalized.to) clauses.push(`o."createdAt" <= ${add(`${normalized.to}T23:59:59.999Z`)}::timestamptz`);
    if (normalized.client) clauses.push(`o."clientName" ILIKE ${add(`%${normalized.client}%`)}`);
    if (normalized.company) clauses.push(`o."companyName" ILIKE ${add(`%${normalized.company}%`)}`);
    if (normalized.qr) clauses.push(`(o."qrName" ILIKE ${add(`%${normalized.qr}%`)} OR COALESCE(o."publicCode",'') ILIKE ${add(`%${normalized.qr}%`)} OR o."qrCodeId" ILIKE ${add(`%${normalized.qr}%`)})`);
    if (normalized.search) {
      const p = add(`%${normalized.search}%`);
      clauses.push(`(o.reference ILIKE ${p} OR o."clientName" ILIKE ${p} OR o."companyName" ILIKE ${p} OR o."beneficiaryName" ILIKE ${p} OR o."qrName" ILIKE ${p} OR o."managerName" ILIKE ${p})`);
    }
    if (normalized.method) {
      const p = add(normalized.method);
      clauses.push(`(o."paymentMethod"=${p} OR EXISTS (SELECT 1 FROM qr_payment_entries fp WHERE fp.order_id=o.id AND (${normalized.method === 'electronic' ? "fp.method<>'cash'" : `fp.method=${p}`})))`);
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    const base = this.baseOrderSql();
    const countParams = [...params];
    const count = await this.store.pool.query(`SELECT COUNT(*)::int AS total FROM (${base}) o${where}`, countParams);
    const limitParam = add(limit);
    const offsetParam = add((page - 1) * limit);
    const { rows } = await this.store.pool.query(`SELECT * FROM (${base}) o${where} ORDER BY o."createdAt" DESC LIMIT ${limitParam} OFFSET ${offsetParam}`, params);
    return { data: rows.map((row) => this.normalizeOrder(row)), total: count.rows[0].total, page, limit };
  }

  async getOrder(id, managerScope = '') {
    let order;
    if (!this.isPg) order = this.ensureJson().orders.find((row) => row.id === id && (!managerScope || row.managerId === managerScope));
    else {
      const params = [id];
      const scope = managerScope ? ' AND o.manager_id=$2' : '';
      if (managerScope) params.push(managerScope);
      const { rows } = await this.store.pool.query(`${this.baseOrderSql()} WHERE o.id=$1${scope}`, params);
      order = rows[0] ? this.normalizeOrder(rows[0]) : null;
    }
    if (!order) return null;
    if (!this.isPg) {
      const state = this.ensureJson();
      const payments = state.payments.filter((row) => row.orderId === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const events = state.financeEvents.filter((row) => row.orderId === id).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      const qr = state.qrCodes.find((row) => row.id === order.qrCodeId);
      return publicOrder({ ...order, qrName: qr?.name || order.qrName }, payments, events);
    }
    const [paymentResult, eventResult] = await Promise.all([
      this.store.pool.query(`SELECT id, reference, order_id AS "orderId", entry_type AS "entryType", method, amount_xof AS "amountXof", currency,
        status, client_name AS "clientName", received_at AS "receivedAt", declared_by_type AS "declaredByType", declared_by_id AS "declaredById",
        provider_name AS "providerName", provider_reference AS "providerReference", reviewed_by_type AS "reviewedByType", reviewed_by_id AS "reviewedById",
        reviewed_at AS "reviewedAt", rejection_reason AS "rejectionReason", created_at AS "createdAt", updated_at AS "updatedAt"
        FROM qr_payment_entries WHERE order_id=$1 ORDER BY created_at DESC`, [id]),
      this.store.pool.query(`SELECT id, order_id AS "orderId", payment_id AS "paymentId", actor_type AS "actorType", actor_id AS "actorId", action,
        summary, before_data AS "beforeData", after_data AS "afterData", reason, created_at AS "createdAt"
        FROM qr_finance_events WHERE order_id=$1 ORDER BY created_at DESC`, [id]),
    ]);
    const payments = paymentResult.rows.map((row) => ({ ...row, amountXof: Number(row.amountXof) }));
    return publicOrder(order, payments, eventResult.rows);
  }

  async createCashDeclaration(orderId, { amountXof, receivedAt, clientName, actor }, managerId) {
    if (!Number.isSafeInteger(Number(amountXof)) || Number(amountXof) <= 0) throw Object.assign(new Error('Le montant reçu doit être un montant XOF entier supérieur à zéro.'), { code: 'INVALID_PAYMENT' });
    const amount = Number(amountXof);
    if (!this.isPg) {
      const state = this.ensureJson();
      const order = state.orders.find((row) => row.id === orderId && (!managerId || row.managerId === managerId));
      if (!order) return null;
      if (order.orderState === 'cancelled') throw Object.assign(new Error('Cette commande est annulée.'), { code: 'ORDER_CLOSED' });
      const payments = state.payments.filter((row) => row.orderId === orderId);
      const totals = getTotals(order, payments);
      const reserved = Math.max(0, totals.netReceivedXof + totals.pendingAmountXof);
      if (amount > Math.max(0, Number(order.totalAmountXof) - reserved)) throw Object.assign(new Error('Le montant dépasse le solde disponible; vérifiez les déclarations déjà en attente.'), { code: 'PAYMENT_EXCEEDS_BALANCE' });
      const stamp = new Date().toISOString();
      const entry = { id: makeId(), reference: makeReference('PAY'), orderId, entryType: 'receipt', method: 'cash', amountXof: amount, currency: 'XOF', status: 'pending', clientName: String(clientName || order.clientName), receivedAt, declaredByType: actor.type, declaredById: actor.id || null, providerName: '', providerReference: '', reviewedByType: '', reviewedById: null, reviewedAt: null, rejectionReason: '', createdAt: stamp, updatedAt: stamp };
      state.payments.push(entry);
      state.financeEvents.push(eventRow(orderId, entry.id, actor, 'cash_declared', `Déclaration d’espèces ${entry.reference} : ${amount} XOF, en attente de validation PDG.`, null, { reference: entry.reference, amountXof: amount, receivedAt, clientName: entry.clientName }));
      order.updatedAt = stamp;
      await this.store.save();
      return this.getOrder(orderId, managerId);
    }
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const scopeClause = managerId ? ' AND manager_id=$2' : '';
      const values = managerId ? [orderId, managerId] : [orderId];
      const { rows: orderRows } = await client.query(`SELECT id, total_amount_xof AS "totalAmountXof", order_state AS "orderState", client_name AS "clientName" FROM qr_orders WHERE id=$1${scopeClause} FOR UPDATE`, values);
      if (!orderRows[0]) { await client.query('ROLLBACK'); return null; }
      if (orderRows[0].orderState === 'cancelled') throw Object.assign(new Error('Cette commande est annulée.'), { code: 'ORDER_CLOSED' });
      const { rows: aggregates } = await client.query(
        `SELECT COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed'),0) AS received,
          COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed'),0) AS refunded,
          COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='pending'),0) AS pending
         FROM qr_payment_entries WHERE order_id=$1`, [orderId]);
      const reserved = Math.max(0, Number(aggregates[0].received) - Number(aggregates[0].refunded) + Number(aggregates[0].pending));
      if (amount > Math.max(0, Number(orderRows[0].totalAmountXof) - reserved)) throw Object.assign(new Error('Le montant dépasse le solde disponible; vérifiez les déclarations déjà en attente.'), { code: 'PAYMENT_EXCEEDS_BALANCE' });
      const id = makeId(); const reference = makeReference('PAY');
      const { rows: paymentRows } = await client.query(
        `INSERT INTO qr_payment_entries (id, reference, order_id, entry_type, method, amount_xof, status, client_name, received_at, declared_by_type, declared_by_id)
         VALUES ($1,$2,$3,'receipt','cash',$4,'pending',$5,$6::timestamptz,$7,$8)
         RETURNING id, reference, order_id AS "orderId", entry_type AS "entryType", method, amount_xof AS "amountXof", currency, status,
           client_name AS "clientName", received_at AS "receivedAt", declared_by_type AS "declaredByType", declared_by_id AS "declaredById", created_at AS "createdAt", updated_at AS "updatedAt"`,
        [id, reference, orderId, amount, String(clientName || orderRows[0].clientName), receivedAt, actor.type, actor.id || null]);
      await client.query(`UPDATE qr_orders SET updated_at=NOW() WHERE id=$1`, [orderId]);
      await client.query(`INSERT INTO qr_finance_events (order_id,payment_id,actor_type,actor_id,action,summary,after_data)
        VALUES ($1,$2,$3,$4,'cash_declared',$5,$6::jsonb)`, [orderId, id, actor.type, actor.id || null,
        `Déclaration d’espèces ${reference} : ${amount} XOF, en attente de validation PDG.`, JSON.stringify({ reference, amountXof: amount, receivedAt, clientName: String(clientName || orderRows[0].clientName) })]);
      await client.query('COMMIT');
      return this.getOrder(orderId, managerId);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async reviewPayment(paymentId, decision, reason, actor) {
    if (!['approve', 'reject'].includes(decision)) throw Object.assign(new Error('Décision de paiement invalide.'), { code: 'INVALID_DECISION' });
    if (decision === 'reject' && !String(reason || '').trim()) throw Object.assign(new Error('Un motif est obligatoire pour rejeter une déclaration.'), { code: 'INVALID_REASON' });
    const status = decision === 'approve' ? 'confirmed' : 'rejected';
    if (!this.isPg) {
      const state = this.ensureJson();
      const payment = state.payments.find((row) => row.id === paymentId);
      if (!payment) return null;
      if (payment.entryType !== 'receipt' || payment.status !== 'pending') throw Object.assign(new Error('Cette déclaration a déjà été traitée ou ne peut pas être validée.'), { code: 'PAYMENT_ALREADY_REVIEWED' });
      const before = clone(payment); const stamp = new Date().toISOString();
      payment.status = status; payment.reviewedByType = actor.type; payment.reviewedById = actor.id || null; payment.reviewedAt = stamp; payment.rejectionReason = status === 'rejected' ? String(reason).trim().slice(0, 500) : ''; payment.updatedAt = stamp;
      state.financeEvents.push(eventRow(payment.orderId, payment.id, actor, status === 'confirmed' ? 'payment_approved' : 'payment_rejected',
        `${status === 'confirmed' ? 'Paiement validé' : 'Paiement rejeté'} : ${payment.reference} (${payment.amountXof} XOF).`, before, payment, payment.rejectionReason));
      await this.store.save(); return this.getOrder(payment.orderId);
    }
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `SELECT p.*, o.total_amount_xof AS order_total FROM qr_payment_entries p JOIN qr_orders o ON o.id=p.order_id WHERE p.id=$1 FOR UPDATE OF p,o`, [paymentId]);
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      const row = rows[0];
      if (row.entry_type !== 'receipt' || row.status !== 'pending') throw Object.assign(new Error('Cette déclaration a déjà été traitée ou ne peut pas être validée.'), { code: 'PAYMENT_ALREADY_REVIEWED' });
      if (status === 'confirmed') {
        const { rows: sums } = await client.query(`SELECT
          COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed'),0) AS received,
          COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed'),0) AS refunded
          FROM qr_payment_entries WHERE order_id=$1`, [row.order_id]);
        const net = Number(sums[0].received) - Number(sums[0].refunded);
        if (net + Number(row.amount_xof) > Number(row.order_total)) throw Object.assign(new Error('La validation dépasserait le montant restant de la commande.'), { code: 'PAYMENT_EXCEEDS_BALANCE' });
      }
      const before = { id: row.id, reference: row.reference, amountXof: Number(row.amount_xof), status: row.status, rejectionReason: row.rejection_reason };
      const { rows: updated } = await client.query(
        `UPDATE qr_payment_entries SET status=$2, reviewed_by_type=$3, reviewed_by_id=$4, reviewed_at=NOW(), rejection_reason=$5, updated_at=NOW()
         WHERE id=$1 AND status='pending' RETURNING id, order_id AS "orderId", reference, amount_xof AS "amountXof", status, rejection_reason AS "rejectionReason", reviewed_at AS "reviewedAt"`,
        [paymentId, status, actor.type, actor.id || null, status === 'rejected' ? String(reason).trim().slice(0, 500) : '']);
      if (!updated[0]) throw Object.assign(new Error('Cette déclaration a déjà été traitée.'), { code: 'PAYMENT_ALREADY_REVIEWED' });
      await client.query('UPDATE qr_orders SET updated_at=NOW() WHERE id=$1', [row.order_id]);
      await client.query(`INSERT INTO qr_finance_events (order_id,payment_id,actor_type,actor_id,action,summary,before_data,after_data,reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)`, [row.order_id, paymentId, actor.type, actor.id || null,
        status === 'confirmed' ? 'payment_approved' : 'payment_rejected', `${status === 'confirmed' ? 'Paiement validé' : 'Paiement rejeté'} : ${row.reference} (${row.amount_xof} XOF).`,
        JSON.stringify(before), JSON.stringify(updated[0]), status === 'rejected' ? String(reason).trim().slice(0, 500) : '']);
      await client.query('COMMIT'); return this.getOrder(row.order_id);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async correctOrder(orderId, changes, reason, actor) {
    if (!String(reason || '').trim()) throw Object.assign(new Error('Un motif est obligatoire pour corriger une transaction.'), { code: 'INVALID_REASON' });
    if (!this.isPg) {
      const state = this.ensureJson(); const order = state.orders.find((row) => row.id === orderId);
      if (!order) return null;
      if (order.orderState === 'cancelled') throw Object.assign(new Error('Une commande annulée ne peut pas être modifiée.'), { code: 'ORDER_CLOSED' });
      const before = clone(order); const payments = state.payments.filter((row) => row.orderId === orderId); const totals = getTotals(order, payments);
      const total = changes.totalAmountXof == null ? order.totalAmountXof : Number(changes.totalAmountXof);
      if (!Number.isSafeInteger(total) || total < totals.netReceivedXof + totals.pendingAmountXof) throw Object.assign(new Error('Le nouveau total ne peut pas être inférieur aux paiements confirmés ou en attente.'), { code: 'INVALID_AMOUNT' });
      Object.assign(order, { clientName: String(changes.clientName ?? order.clientName).trim().slice(0, 140), companyName: String(changes.companyName ?? order.companyName).trim().slice(0, 140), customerType: changes.customerType ?? order.customerType, totalAmountXof: total, correctionReason: String(reason).trim().slice(0, 500), updatedAt: new Date().toISOString() });
      if (!order.clientName || !CUSTOMER_TYPES.has(order.customerType)) throw Object.assign(new Error('Les informations client sont invalides.'), { code: 'INVALID_ORDER' });
      state.financeEvents.push(eventRow(orderId, null, actor, 'order_corrected', `Commande ${order.reference} corrigée par le PDG.`, before, order, String(reason).trim().slice(0, 500)));
      await this.store.save(); return this.getOrder(orderId);
    }
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM qr_orders WHERE id=$1 FOR UPDATE`, [orderId]);
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      const row = rows[0];
      if (row.order_state === 'cancelled') throw Object.assign(new Error('Une commande annulée ne peut pas être modifiée.'), { code: 'ORDER_CLOSED' });
      const { rows: sums } = await client.query(`SELECT
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed'),0) AS received,
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed'),0) AS refunded,
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='pending'),0) AS pending
        FROM qr_payment_entries WHERE order_id=$1`, [orderId]);
      const floor = Math.max(0, Number(sums[0].received) - Number(sums[0].refunded) + Number(sums[0].pending));
      const total = changes.totalAmountXof == null ? Number(row.total_amount_xof) : Number(changes.totalAmountXof);
      const clientName = String(changes.clientName ?? row.client_name).trim().slice(0, 140);
      const companyName = String(changes.companyName ?? row.company_name).trim().slice(0, 140);
      const customerType = changes.customerType ?? row.customer_type;
      if (!clientName || !CUSTOMER_TYPES.has(customerType) || !Number.isSafeInteger(total) || total < floor) throw Object.assign(new Error('Informations invalides : le total doit couvrir les paiements déjà confirmés/en attente.'), { code: 'INVALID_ORDER' });
      const before = { clientName: row.client_name, companyName: row.company_name, customerType: row.customer_type, totalAmountXof: Number(row.total_amount_xof), correctionReason: row.correction_reason };
      const { rows: updated } = await client.query(`UPDATE qr_orders SET client_name=$2, company_name=$3, customer_type=$4,total_amount_xof=$5,correction_reason=$6,updated_at=NOW()
        WHERE id=$1 RETURNING id`, [orderId, clientName, companyName, customerType, total, String(reason).trim().slice(0, 500)]);
      await client.query(`INSERT INTO qr_finance_events (order_id,actor_type,actor_id,action,summary,before_data,after_data,reason)
        VALUES ($1,$2,$3,'order_corrected',$4,$5::jsonb,$6::jsonb,$7)`, [orderId, actor.type, actor.id || null,
        `Commande ${row.reference} corrigée par le PDG.`, JSON.stringify(before), JSON.stringify({ clientName, companyName, customerType, totalAmountXof: total }), String(reason).trim().slice(0, 500)]);
      await client.query('COMMIT'); return this.getOrder(orderId);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async cancelOrder(orderId, reason, actor) {
    if (!String(reason || '').trim()) throw Object.assign(new Error('Un motif est obligatoire pour annuler une commande.'), { code: 'INVALID_REASON' });
    if (!this.isPg) {
      const state = this.ensureJson(); const order = state.orders.find((row) => row.id === orderId);
      if (!order) return null;
      if (order.orderState === 'cancelled') throw Object.assign(new Error('Cette commande est déjà annulée.'), { code: 'ORDER_CLOSED' });
      const totals = getTotals(order, state.payments.filter((row) => row.orderId === orderId));
      if (totals.netReceivedXof > 0) throw Object.assign(new Error('Remboursez d’abord les paiements confirmés avant d’annuler la commande.'), { code: 'REFUND_REQUIRED' });
      const before = { orderState: order.orderState, paymentStatus: totals.paymentStatus };
      order.orderState = 'cancelled'; order.updatedAt = new Date().toISOString();
      for (const payment of state.payments.filter((row) => row.orderId === orderId && row.status === 'pending')) { payment.status = 'rejected'; payment.reviewedByType = actor.type; payment.reviewedById = actor.id || null; payment.reviewedAt = order.updatedAt; payment.rejectionReason = 'Commande annulée'; payment.updatedAt = order.updatedAt; }
      state.financeEvents.push(eventRow(orderId, null, actor, 'order_cancelled', `Commande ${order.reference} annulée.`, before, { orderState: 'cancelled' }, String(reason).trim().slice(0, 500)));
      await this.store.save(); return this.getOrder(orderId);
    }
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT * FROM qr_orders WHERE id=$1 FOR UPDATE`, [orderId]);
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      const row = rows[0];
      const { rows: sums } = await client.query(`SELECT
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed'),0) AS received,
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed'),0) AS refunded
        FROM qr_payment_entries WHERE order_id=$1`, [orderId]);
      if (row.order_state === 'cancelled') throw Object.assign(new Error('Cette commande est déjà annulée.'), { code: 'ORDER_CLOSED' });
      if (Number(sums[0].received) - Number(sums[0].refunded) > 0) throw Object.assign(new Error('Remboursez d’abord les paiements confirmés avant d’annuler la commande.'), { code: 'REFUND_REQUIRED' });
      const before = { orderState: row.order_state };
      await client.query(`UPDATE qr_orders SET order_state='cancelled',updated_at=NOW() WHERE id=$1`, [orderId]);
      await client.query(`UPDATE qr_payment_entries SET status='rejected', reviewed_by_type=$2, reviewed_by_id=$3, reviewed_at=NOW(),rejection_reason='Commande annulée',updated_at=NOW()
        WHERE order_id=$1 AND status='pending'`, [orderId, actor.type, actor.id || null]);
      await client.query(`INSERT INTO qr_finance_events (order_id,actor_type,actor_id,action,summary,before_data,after_data,reason)
        VALUES ($1,$2,$3,'order_cancelled',$4,$5::jsonb,$6::jsonb,$7)`, [orderId,actor.type,actor.id || null,`Commande ${row.reference} annulée.`,JSON.stringify(before),JSON.stringify({orderState:'cancelled'}),String(reason).trim().slice(0,500)]);
      await client.query('COMMIT'); return this.getOrder(orderId);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async addRefund(orderId, { amountXof, method = 'cash', clientName, reason }, actor) {
    const amount = Number(amountXof);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !METHODS.has(method)) throw Object.assign(new Error('Montant ou mode de remboursement invalide.'), { code: 'INVALID_REFUND' });
    if (!String(reason || '').trim()) throw Object.assign(new Error('Un motif est obligatoire pour enregistrer un remboursement.'), { code: 'INVALID_REASON' });
    if (!this.isPg) {
      const state = this.ensureJson(); const order = state.orders.find((row) => row.id === orderId);
      if (!order) return null;
      const payments = state.payments.filter((row) => row.orderId === orderId);
      const totals = getTotals(order, payments);
      if (amount > totals.netReceivedXof) throw Object.assign(new Error('Le remboursement dépasse le montant net encaissé.'), { code: 'REFUND_EXCEEDS_RECEIVED' });
      const stamp = new Date().toISOString();
      const entry = { id: makeId(), reference: makeReference('REF'), orderId, entryType: 'refund', method, amountXof: amount, currency: 'XOF', status: 'confirmed', clientName: String(clientName || order.clientName), receivedAt: stamp, declaredByType: actor.type, declaredById: actor.id || null, providerName: '', providerReference: '', reviewedByType: actor.type, reviewedById: actor.id || null, reviewedAt: stamp, rejectionReason: '', createdAt: stamp, updatedAt: stamp };
      state.payments.push(entry);
      state.financeEvents.push(eventRow(orderId, entry.id, actor, 'refund_recorded', `Remboursement enregistré : ${entry.reference} (${amount} XOF).`, null, { reference: entry.reference, amountXof: amount, method }, String(reason).trim().slice(0,500)));
      order.updatedAt = stamp; await this.store.save(); return this.getOrder(orderId);
    }
    const client = await this.store.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT id,reference,client_name AS "clientName" FROM qr_orders WHERE id=$1 FOR UPDATE`, [orderId]);
      if (!rows[0]) { await client.query('ROLLBACK'); return null; }
      const { rows: sums } = await client.query(`SELECT
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='receipt' AND status='confirmed'),0) AS received,
        COALESCE(SUM(amount_xof) FILTER (WHERE entry_type='refund' AND status='confirmed'),0) AS refunded
        FROM qr_payment_entries WHERE order_id=$1`, [orderId]);
      const available = Number(sums[0].received) - Number(sums[0].refunded);
      if (amount > available) throw Object.assign(new Error('Le remboursement dépasse le montant net encaissé.'), { code: 'REFUND_EXCEEDS_RECEIVED' });
      const id = makeId(); const reference = makeReference('REF'); const stamp = new Date().toISOString();
      await client.query(`INSERT INTO qr_payment_entries (id,reference,order_id,entry_type,method,amount_xof,status,client_name,received_at,declared_by_type,declared_by_id,reviewed_by_type,reviewed_by_id,reviewed_at)
        VALUES ($1,$2,$3,'refund',$4,$5,'confirmed',$6,$7::timestamptz,$8,$9,$8,$9,$7::timestamptz)`, [id,reference,orderId,method,amount,String(clientName || rows[0].clientName),stamp,actor.type,actor.id || null]);
      await client.query('UPDATE qr_orders SET updated_at=NOW() WHERE id=$1',[orderId]);
      await client.query(`INSERT INTO qr_finance_events (order_id,payment_id,actor_type,actor_id,action,summary,after_data,reason)
        VALUES ($1,$2,$3,$4,'refund_recorded',$5,$6::jsonb,$7)`, [orderId,id,actor.type,actor.id || null,`Remboursement enregistré : ${reference} (${amount} XOF).`,JSON.stringify({reference,amountXof:amount,method}),String(reason).trim().slice(0,500)]);
      await client.query('COMMIT'); return this.getOrder(orderId);
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
    finally { client.release(); }
  }

  async dashboard(filters = {}, managerScope = '') {
    const rows = [];
    let page = 1; let total = 0;
    do {
      const result = await this.listOrders({ ...filters, page, limit: 100 }, managerScope);
      total = result.total; rows.push(...result.data); page += 1;
    } while (rows.length < total && rows.length < 100000);

    const summary = {
      ordersValueXof: 0, grossReceivedXof: 0, refundedXof: 0, netReceivedXof: 0,
      pendingDeclaredXof: 0, outstandingXof: 0, cashReceivedXof: 0, electronicReceivedXof: 0,
      qrSold: 0, pendingCount: 0, unpaidCount: 0, partialCount: 0, paidCount: 0, cancelledCount: 0, refundedCount: 0,
    };
    const managers = new Map();
    for (const order of rows) {
      if (order.orderState !== 'cancelled') { summary.ordersValueXof += order.totalAmountXof; summary.qrSold += 1; }
      summary.grossReceivedXof += order.grossReceivedXof || 0;
      summary.refundedXof += order.refundedXof || 0;
      summary.netReceivedXof += order.netReceivedXof || 0;
      summary.pendingDeclaredXof += order.pendingAmountXof || 0;
      summary.outstandingXof += order.outstandingXof || 0;
      summary.cashReceivedXof += order.cashReceivedXof || 0;
      summary.electronicReceivedXof += order.electronicReceivedXof || 0;
      const key = order.managerId || 'admin';
      const item = managers.get(key) || { managerId: order.managerId || null, managerName: order.managerName || 'PDG', ordersValueXof: 0, netReceivedXof: 0, pendingDeclaredXof: 0, outstandingXof: 0, qrSold: 0 };
      if (order.orderState !== 'cancelled') { item.ordersValueXof += order.totalAmountXof; item.qrSold += 1; }
      item.netReceivedXof += order.netReceivedXof || 0; item.pendingDeclaredXof += order.pendingAmountXof || 0; item.outstandingXof += order.outstandingXof || 0;
      managers.set(key, item);
      if (order.paymentStatus === 'pending') summary.pendingCount += 1;
      if (order.paymentStatus === 'unpaid') summary.unpaidCount += 1;
      if (order.paymentStatus === 'partial') summary.partialCount += 1;
      if (order.paymentStatus === 'paid') summary.paidCount += 1;
      if (order.paymentStatus === 'cancelled') summary.cancelledCount += 1;
      if (order.paymentStatus === 'refunded') summary.refundedCount += 1;
    }
    return { summary, byManager: [...managers.values()].sort((a, b) => b.ordersValueXof - a.ordersValueXof), totalOrders: total };
  }
}

function createFinanceStore(store) { return new FinanceStore(store); }
module.exports = { createFinanceStore, planQuote, normalizePlanInput, CUSTOMER_TYPES, QR_PURPOSES, DESTINATIONS, getTotals };
