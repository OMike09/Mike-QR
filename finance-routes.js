'use strict';

const { randomUUID } = require('node:crypto');
const { normalizePlanInput, CUSTOMER_TYPES, QR_PURPOSES, DESTINATIONS } = require('./finance-store');

function csvCell(value) {
  let text = value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/^[\s\u0000-\u001f]*[=+@-]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}
function dateFilter(value, end = false) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return '';
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) return '';
  return end ? raw : `${raw}T00:00:00.000Z`;
}
function filtersFrom(query) {
  return {
    page: Math.max(1, Number.parseInt(query.page, 10) || 1),
    limit: Math.min(100, Math.max(1, Number.parseInt(query.limit, 10) || 25)),
    managerId: String(query.managerId || '').slice(0, 100),
    search: String(query.search || '').trim().slice(0, 160),
    client: String(query.client || '').trim().slice(0, 120),
    company: String(query.company || '').trim().slice(0, 120),
    qr: String(query.qr || '').trim().slice(0, 120),
    qrCodeId: String(query.qrCodeId || '').slice(0, 100),
    customerType: CUSTOMER_TYPES.has(String(query.customerType || '')) ? String(query.customerType) : '',
    method: ['cash', 'mobile_money', 'bank_transfer', 'card', 'other', 'electronic'].includes(String(query.method || '')) ? String(query.method) : '',
    status: ['unpaid', 'pending', 'partial', 'paid', 'cancelled', 'refunded'].includes(String(query.status || '')) ? String(query.status) : '',
    from: dateFilter(query.from), to: dateFilter(query.to, true),
  };
}
function routeError(res, error, fallback) {
  if (error.code === 'ORDER_CLOSED') return res.status(409).json({ error: error.message });
  if (error.code === 'PAYMENT_EXCEEDS_BALANCE' || error.code === 'REFUND_EXCEEDS_RECEIVED' || error.code === 'REFUND_REQUIRED' || error.code === 'PAYMENT_ALREADY_REVIEWED') return res.status(409).json({ error: error.message });
  if (error.code === 'INVALID_PAYMENT' || error.code === 'INVALID_DECISION' || error.code === 'INVALID_REASON' || error.code === 'INVALID_REFUND' || error.code === 'INVALID_AMOUNT' || error.code === 'INVALID_ORDER' || error.code === 'INVALID_PRICING') return res.status(400).json({ error: error.message });
  return res.status(500).json({ error: fallback || 'Erreur interne de gestion financière.' });
}
function pricingSnapshot(plans) {
  return plans.map((plan) => ({ id: plan.id, name: plan.name, customerType: plan.customerType, qrPurpose: plan.qrPurpose, destinationType: plan.destinationType, amountXof: plan.amountXof, options: plan.options, active: plan.active }));
}
function csvOrders(rows) {
  const headers = ['reference_commande', 'date_utc', 'gestionnaire', 'client', 'entreprise', 'type_client', 'qr', 'usage_qr', 'destination', 'formule', 'prix_unitaire_xof', 'options', 'total_commande_xof', 'encaissé_brut_xof', 'rembourse_xof', 'encaissé_net_xof', 'déclaré_en_attente_xof', 'solde_xof', 'mode_initial', 'statut_paiement', 'état_commande', 'paiements'];
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push([
    row.reference, row.createdAt, row.managerName, row.clientName, row.companyName, row.customerType, row.qrName,
    row.qrPurpose, row.destinationType, row.pricingPlanName, row.unitAmountXof,
    row.selectedOptions || [], row.totalAmountXof, row.grossReceivedXof, row.refundedXof, row.netReceivedXof,
    row.pendingAmountXof, row.outstandingXof, row.paymentMethod, row.paymentStatus, row.orderState,
    row.payments || [],
  ].map(csvCell).join(','));
  return `\uFEFF${lines.join('\r\n')}`;
}
function adminAudit(action, entityType, entityId, summary, extras = {}) {
  return { actor: 'PDG', actorType: 'admin', actorId: 'admin', managerId: extras.managerId || null, action, entityType, entityId: String(entityId || 'unknown'), summary, result: extras.result || 'success', beforeData: extras.beforeData || null, afterData: extras.afterData || null, metadata: extras.metadata || null };
}
function managerAudit(manager, action, entityType, entityId, summary, extras = {}) {
  return { actor: `${manager.displayName} (@${manager.username})`, actorType: 'manager', actorId: manager.id, managerId: manager.id, action, entityType, entityId: String(entityId || 'unknown'), summary, result: extras.result || 'success', beforeData: extras.beforeData || null, afterData: extras.afterData || null, metadata: extras.metadata || null };
}

module.exports = function registerFinanceRoutes({ app, store, finance, requireAdmin, requireManager, apiError }) {
  async function readAllOrders(filters) {
    const all = [];
    let page = 1; let total = 0;
    do {
      const result = await finance.listOrders({ ...filters, page, limit: 100 });
      total = result.total; all.push(...result.data); page += 1;
    } while (all.length < total && all.length < 100000);
    return { data: all, total };
  }
  async function addAdminAudit(event) { await store.addAudit(event); }

  app.get('/api/admin/finance/pricing', requireAdmin, async (_req, res) => {
    try { res.json({ data: await finance.getPricing(), currency: 'XOF' }); }
    catch (error) { apiError(res, error, 'Impossible de charger les tarifs.'); }
  });
  app.put('/api/admin/finance/pricing', requireAdmin, async (req, res) => {
    try {
      if (!Array.isArray(req.body?.plans) || req.body.plans.length > 100) return res.status(400).json({ error: 'La liste doit contenir au plus 100 tarifs.' });
      const before = await finance.getPricing();
      const beforeById = new Map(before.map((plan) => [plan.id, plan]));
      const plans = req.body.plans.map((row) => normalizePlanInput(row, beforeById.get(String(row?.id || ''))));
      if (new Set(plans.map((plan) => plan.id)).size !== plans.length) return res.status(400).json({ error: 'Chaque formule doit avoir un identifiant unique.' });
      await finance.savePricing(plans);
      await addAdminAudit(adminAudit('update', 'settings', 'finance-pricing', 'Tarifs QR et options modifiés par le PDG.', { beforeData: pricingSnapshot(before), afterData: pricingSnapshot(plans) }));
      res.json({ data: plans, currency: 'XOF' });
    } catch (error) {
      if (error.code === 'INVALID_PRICING' || (error.message && !error.code)) return res.status(400).json({ error: error.message });
      apiError(res, error, 'Impossible d’enregistrer les tarifs.');
    }
  });
  app.get('/api/manager/finance/pricing', requireManager, async (req, res) => {
    try {
      const customerType = String(req.query.customerType || '');
      const qrPurpose = String(req.query.qrPurpose || '');
      const destinationType = String(req.query.destinationType || '');
      if (!CUSTOMER_TYPES.has(customerType) || !QR_PURPOSES.has(qrPurpose) || !DESTINATIONS.has(destinationType)) return res.status(400).json({ error: 'Précisez le type de client et le type de QR.' });
      const plans = await finance.getPricing();
      const data = plans.filter((plan) => plan.active && (plan.customerType === 'any' || plan.customerType === customerType)
        && (plan.qrPurpose === 'any' || plan.qrPurpose === qrPurpose)
        && (plan.destinationType === 'any' || plan.destinationType === destinationType));
      res.json({ data, currency: 'XOF', electronicPayments: { configured: false, status: 'pending_configuration' } });
    } catch (error) { apiError(res, error, 'Impossible de charger les tarifs applicables.'); }
  });
  app.get('/api/manager/finance/payment-capabilities', requireManager, (_req, res) => res.json({ cash: true, electronic: { enabled: false, status: 'pending_configuration', message: 'Aucun prestataire électronique n’est configuré. Utilisez les espèces.' } }));

  app.get('/api/admin/finance/dashboard', requireAdmin, async (req, res) => {
    try { res.json(await finance.dashboard(filtersFrom(req.query))); }
    catch (error) { apiError(res, error, 'Impossible de calculer le tableau financier.'); }
  });
  app.get('/api/admin/finance/orders', requireAdmin, async (req, res) => {
    try { res.json(await finance.listOrders(filtersFrom(req.query))); }
    catch (error) { apiError(res, error, 'Impossible de charger les commandes.'); }
  });
  app.get('/api/admin/finance/orders/:id', requireAdmin, async (req, res) => {
    try {
      const order = await finance.getOrder(req.params.id);
      if (!order) return res.status(404).json({ error: 'Commande introuvable.' });
      res.json({ data: order });
    } catch (error) { apiError(res, error, 'Impossible de charger cette commande.'); }
  });
  app.patch('/api/admin/finance/orders/:id', requireAdmin, async (req, res) => {
    try {
      const before = await finance.getOrder(req.params.id);
      if (!before) return res.status(404).json({ error: 'Commande introuvable.' });
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      if (!reason) return res.status(400).json({ error: 'Un motif est obligatoire pour corriger une transaction.' });
      const changes = {};
      if (req.body?.clientName !== undefined) changes.clientName = String(req.body.clientName).trim().slice(0, 140);
      if (req.body?.companyName !== undefined) changes.companyName = String(req.body.companyName).trim().slice(0, 140);
      if (req.body?.customerType !== undefined) changes.customerType = String(req.body.customerType);
      if (req.body?.totalAmountXof !== undefined) changes.totalAmountXof = Number(req.body.totalAmountXof);
      const order = await finance.correctOrder(req.params.id, changes, reason, { type: 'admin', id: 'admin', label: 'PDG' });
      await addAdminAudit(adminAudit('update', 'finance_order', order.id, `Commande ${order.reference} corrigée par le PDG.`, { managerId: order.managerId, beforeData: { clientName: before.clientName, companyName: before.companyName, customerType: before.customerType, totalAmountXof: before.totalAmountXof }, afterData: { clientName: order.clientName, companyName: order.companyName, customerType: order.customerType, totalAmountXof: order.totalAmountXof }, metadata: { reason } }));
      res.json({ data: order });
    } catch (error) { routeError(res, error, 'Impossible de corriger la commande.'); }
  });
  app.post('/api/admin/finance/orders/:id/cancel', requireAdmin, async (req, res) => {
    try {
      const before = await finance.getOrder(req.params.id);
      if (!before) return res.status(404).json({ error: 'Commande introuvable.' });
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      const order = await finance.cancelOrder(req.params.id, reason, { type: 'admin', id: 'admin', label: 'PDG' });
      await addAdminAudit(adminAudit('cancel', 'finance_order', order.id, `Commande ${order.reference} annulée par le PDG.`, { managerId: order.managerId, beforeData: { orderState: before.orderState, paymentStatus: before.paymentStatus }, afterData: { orderState: order.orderState, paymentStatus: order.paymentStatus }, metadata: { reason } }));
      res.json({ data: order });
    } catch (error) { routeError(res, error, 'Impossible d’annuler la commande.'); }
  });
  app.post('/api/admin/finance/orders/:id/refunds', requireAdmin, async (req, res) => {
    try {
      const before = await finance.getOrder(req.params.id);
      if (!before) return res.status(404).json({ error: 'Commande introuvable.' });
      const method = String(req.body?.method || 'cash');
      const order = await finance.addRefund(req.params.id, { amountXof: Number(req.body?.amountXof), method, clientName: before.clientName, reason: req.body?.reason }, { type: 'admin', id: 'admin', label: 'PDG' });
      const payment = order.payments.find((item) => item.entryType === 'refund');
      await addAdminAudit(adminAudit('refund', 'finance_payment', payment?.id, `Remboursement enregistré pour la commande ${order.reference}.`, { managerId: order.managerId, beforeData: { netReceivedXof: before.netReceivedXof }, afterData: { refundAmountXof: payment?.amountXof, netReceivedXof: order.netReceivedXof }, metadata: { orderId: order.id, reason: String(req.body?.reason || '').trim().slice(0, 500) } }));
      res.status(201).json({ data: order });
    } catch (error) { routeError(res, error, 'Impossible d’enregistrer le remboursement.'); }
  });
  app.post('/api/admin/finance/payments/:id/review', requireAdmin, async (req, res) => {
    try {
      const decision = String(req.body?.decision || '');
      const reason = String(req.body?.reason || '').trim().slice(0, 500);
      const orderBefore = await finance.getOrder(String(req.body?.orderId || ''));
      if (orderBefore) { /* An optional caller order id only supplies a diff snapshot; paymentId remains authoritative. */ }
      const order = await finance.reviewPayment(req.params.id, decision, reason, { type: 'admin', id: 'admin', label: 'PDG' });
      if (!order) return res.status(404).json({ error: 'Déclaration introuvable.' });
      const payment = order.payments.find((item) => item.id === req.params.id);
      await addAdminAudit(adminAudit(decision === 'approve' ? 'payment_approved' : 'payment_rejected', 'finance_payment', req.params.id,
        `${decision === 'approve' ? 'Paiement validé' : 'Déclaration de paiement rejetée'} pour la commande ${order.reference}.`, { managerId: order.managerId,
          afterData: { reference: payment?.reference, amountXof: payment?.amountXof, status: payment?.status, rejectionReason: payment?.rejectionReason || '' }, metadata: { orderId: order.id } }));
      res.json({ data: order });
    } catch (error) { routeError(res, error, 'Impossible de traiter la déclaration.'); }
  });
  app.get('/api/admin/finance/export.csv', requireAdmin, async (req, res) => {
    try {
      const filters = filtersFrom(req.query); const result = await readAllOrders(filters);
      const orderIds = result.data.map((row) => row.id);
      const data = [];
      for (const id of orderIds) data.push(await finance.getOrder(id));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="qria-ventes-paiements.csv"');
      res.setHeader('Cache-Control', 'no-store');
      res.send(csvOrders(data));
    } catch (error) { apiError(res, error, 'Impossible d’exporter les ventes et paiements.'); }
  });
  app.get('/api/admin/finance/provider-status', requireAdmin, (_req, res) => res.json({ electronic: { configured: false, provider: null, status: 'pending_configuration', message: 'Aucun prestataire de paiement électronique n’est connecté. Aucun paiement électronique ne peut être confirmé.' } }));

  app.get('/api/manager/finance/orders', requireManager, async (req, res) => {
    try { res.json(await finance.listOrders(filtersFrom(req.query), req.manager.id)); }
    catch (error) { apiError(res, error, 'Impossible de charger vos commandes.'); }
  });
  app.get('/api/manager/finance/orders/:id', requireManager, async (req, res) => {
    try {
      const order = await finance.getOrder(req.params.id, req.manager.id);
      if (!order) return res.status(404).json({ error: 'Commande introuvable dans votre espace.' });
      await store.addAudit(managerAudit(req.manager, 'view', 'finance_order', order.id, `Consultation de la commande ${order.reference}.`));
      res.json({ data: order });
    } catch (error) { apiError(res, error, 'Impossible de charger cette commande.'); }
  });
  app.post('/api/manager/finance/orders/:id/cash-payments', requireManager, async (req, res) => {
    try {
      const order = await finance.getOrder(req.params.id, req.manager.id);
      if (!order) return res.status(404).json({ error: 'Commande introuvable dans votre espace.' });
      const amountXof = Number(req.body?.amountXof);
      const payerName = String(req.body?.payerName || '').trim().slice(0, 140);
      const rawDate = String(req.body?.receivedAt || '').trim();
      const date = new Date(rawDate);
      if (!payerName) return res.status(400).json({ error: 'L’identité réelle du payeur est obligatoire.' });
      if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now() + 5 * 60_000) return res.status(400).json({ error: 'Saisissez une date et heure de réception valides.' });
      const data = await finance.createCashDeclaration(order.id, { amountXof, receivedAt: date.toISOString(), clientName: payerName, actor: { type: 'manager', id: req.manager.id, label: req.manager.displayName } }, req.manager.id);
      if (!data) return res.status(404).json({ error: 'Commande introuvable dans votre espace.' });
      const payment = data.payments.find((item) => item.status === 'pending' && item.method === 'cash');
      await store.addAudit(managerAudit(req.manager, 'cash_declared', 'finance_payment', payment?.id || order.id, `Déclaration d’espèces pour la commande ${order.reference} : ${amountXof} XOF, en attente de validation PDG.`, { afterData: { orderId: order.id, amountXof, payerName, receivedAt: date.toISOString(), status: 'pending' } }));
      res.status(201).json({ data });
    } catch (error) { routeError(res, error, 'Impossible d’enregistrer la déclaration d’espèces.'); }
  });
  app.post('/api/manager/finance/orders/:id/electronic-intent', requireManager, async (req, res) => {
    try {
      const order = await finance.getOrder(req.params.id, req.manager.id);
      if (!order) return res.status(404).json({ error: 'Commande introuvable dans votre espace.' });
      await store.addAudit(managerAudit(req.manager, 'electronic_pending', 'finance_order', order.id, `Paiement électronique indisponible : prestataire non configuré pour ${order.reference}.`, { result: 'failure' }));
      res.status(503).json({ error: 'Paiement électronique en attente de configuration d’un prestataire; aucun paiement n’a été confirmé.' });
    } catch (error) { apiError(res, error, 'Impossible de préparer le paiement électronique.'); }
  });
};
