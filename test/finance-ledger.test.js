'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createFinanceStore } = require('../finance-store');

function page(rows, { page = 1, limit = 100 } = {}) {
  return { data: rows.slice((page - 1) * limit, page * limit), total: rows.length, page, limit };
}

test('registre espèces: isolation gestionnaire, soldes partiels, non applicable, filtres et totaux de période', async () => {
  const state = {
    settings: { financePricing: [] },
    managers: [{ id: 'manager-a', displayName: 'Gestionnaire A', username: 'manager.a' }],
    beneficiaries: [
      { id: 'bene-a', name: 'Awa Traoré', phone: '+225 0701020304', status: 'active', managerId: 'manager-a' },
      { id: 'bene-free', name: 'Koffi Gratuit', phone: '+225 0506070809', status: 'active', managerId: 'manager-a' },
      { id: 'bene-other', name: 'Autre espace', phone: '+225 0101010101', status: 'active', managerId: 'manager-b' },
    ],
    qrCodes: [
      { id: 'qr-a', publicCode: 'QR-A-123', name: 'Atelier Awa', beneficiaryId: 'bene-a', managerId: 'manager-a', status: 'active' },
      { id: 'qr-free', publicCode: 'QR-FREE', name: 'Carte gratuite', beneficiaryId: 'bene-free', managerId: 'manager-a', status: 'active' },
      { id: 'qr-other', publicCode: 'QR-OTHER', name: 'QR privé', beneficiaryId: 'bene-other', managerId: 'manager-b', status: 'active' },
    ],
    orders: [
      { id: 'order-a', reference: 'ORD-A-1', qrCodeId: 'qr-a', managerId: 'manager-a', managerName: 'Gestionnaire A', beneficiaryId: 'bene-a', beneficiaryName: 'Awa Traoré', clientName: 'Awa Traoré', totalAmountXof: 10000, originalTotalAmountXof: 10000, unitAmountXof: 10000, orderState: 'open', createdAt: '2026-10-18T10:00:00.000Z', updatedAt: '2026-10-18T10:00:00.000Z' },
      { id: 'order-free', reference: 'ORD-FREE', qrCodeId: 'qr-free', managerId: 'manager-a', managerName: 'Gestionnaire A', beneficiaryId: 'bene-free', beneficiaryName: 'Koffi Gratuit', clientName: 'Koffi Gratuit', totalAmountXof: 0, originalTotalAmountXof: 0, unitAmountXof: 0, orderState: 'open', createdAt: '2026-10-18T11:00:00.000Z', updatedAt: '2026-10-18T11:00:00.000Z' },
      { id: 'order-other', reference: 'ORD-OTHER', qrCodeId: 'qr-other', managerId: 'manager-b', managerName: 'Gestionnaire B', beneficiaryId: 'bene-other', beneficiaryName: 'Autre espace', clientName: 'Autre espace', totalAmountXof: 5000, originalTotalAmountXof: 5000, unitAmountXof: 5000, orderState: 'open', createdAt: '2026-10-18T12:00:00.000Z', updatedAt: '2026-10-18T12:00:00.000Z' },
    ],
    payments: [
      { id: 'payment-ok', reference: 'PAY-OK', orderId: 'order-a', entryType: 'receipt', method: 'cash', amountXof: 3000, status: 'confirmed', clientName: 'Awa Traoré', receiptReference: 'REC-2026-01', observation: 'Acompte reçu', receivedAt: '2026-10-18T12:00:00.000Z', declaredByType: 'manager', declaredById: 'manager-a', reviewedByType: 'admin', reviewedById: 'admin', reviewedAt: '2026-10-18T14:00:00.000Z', createdAt: '2026-10-18T12:00:00.000Z' },
      { id: 'payment-pending', reference: 'PAY-PENDING', orderId: 'order-a', entryType: 'receipt', method: 'cash', amountXof: 2000, status: 'pending', clientName: 'Awa Traoré', receiptReference: '', observation: 'Deuxième versement déclaré', receivedAt: '2026-10-19T09:00:00.000Z', declaredByType: 'manager', declaredById: 'manager-a', reviewedByType: '', reviewedById: null, reviewedAt: null, createdAt: '2026-10-19T09:00:00.000Z' },
      { id: 'payment-other', reference: 'PAY-OTHER', orderId: 'order-other', entryType: 'receipt', method: 'cash', amountXof: 5000, status: 'confirmed', clientName: 'Autre espace', receiptReference: '', observation: '', receivedAt: '2026-10-18T12:00:00.000Z', declaredByType: 'manager', declaredById: 'manager-b', createdAt: '2026-10-18T12:00:00.000Z' },
    ],
    financeEvents: [],
  };
  const store = {
    pool: null,
    state,
    save: async () => {},
    listBeneficiaries: async (filters = {}) => page(state.beneficiaries.filter((row) => !filters.managerId || row.managerId === filters.managerId), filters),
    listCodes: async (filters = {}) => page(state.qrCodes.filter((row) => !filters.managerId || row.managerId === filters.managerId), filters),
    getCode: async (id) => state.qrCodes.find((row) => row.id === id) || null,
  };
  const finance = createFinanceStore(store);

  const ledger = await finance.beneficiaryLedger({}, 'manager-a');
  assert.equal(ledger.total, 2);
  assert.equal(ledger.summary.partialCount, 1);
  assert.equal(ledger.summary.notApplicableCount, 1);
  assert.equal(ledger.summary.totalAmountXof, 10000);
  assert.equal(ledger.summary.receivedXof, 3000);
  assert.equal(ledger.summary.pendingXof, 2000);
  assert.equal(ledger.summary.outstandingXof, 7000);
  assert.equal(ledger.summary.periodSubmittedXof, 5000);
  assert.equal(ledger.summary.periodVerifiedXof, 3000);
  assert.equal(ledger.summary.periodPendingXof, 2000);
  const awa = ledger.data.find((row) => row.id === 'bene-a');
  assert.equal(awa.codes[0].orders[0].payments.length, 2);
  assert.equal(awa.codes[0].orders[0].payments[0].receiptReference, '');
  assert.equal(ledger.data.find((row) => row.id === 'bene-free').paymentStatus, 'not_applicable');

  const byReceipt = await finance.beneficiaryLedger({ search: 'REC-2026-01' }, 'manager-a');
  assert.equal(byReceipt.total, 1);
  assert.equal(byReceipt.data[0].id, 'bene-a');
  const byPhone = await finance.beneficiaryLedger({ search: '0701020304' }, 'manager-a');
  assert.equal(byPhone.total, 1);
  assert.equal(byPhone.data[0].id, 'bene-a');
  const filtered = await finance.beneficiaryLedger({ status: 'not_applicable' }, 'manager-a');
  assert.equal(filtered.total, 1);
  assert.equal(filtered.data[0].id, 'bene-free');

  const report = await finance.cashReport({ from: '2026-10-18T00:00:00.000Z', to: '2026-10-19', page: 1, limit: 10 }, 'manager-a');
  assert.equal(report.summary.submittedXof, 5000);
  assert.equal(report.summary.verifiedXof, 3000);
  assert.equal(report.summary.pendingXof, 2000);
  assert.equal(report.summary.outstandingXof, 7000);
  assert.equal(report.total, 2);
  assert.equal(report.byManager[0].managerId, 'manager-a');
  const managerB = await finance.beneficiaryLedger({}, 'manager-b');
  assert.equal(managerB.total, 1);
  assert.equal(managerB.data[0].id, 'bene-other');
});
