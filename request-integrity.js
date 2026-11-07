'use strict';

const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,64}$/;
const QR_CREATE_FIELDS = [
  'name', 'beneficiaryId', 'categoryId', 'purpose', 'destinationType', 'targetUrl',
  'title', 'description', 'contentText', 'selectedFields', 'selectedPhotoIds',
  'photos', 'profileData', 'extraLinks', 'style', 'status',
];
const ORDER_INTENT_FIELDS = [
  'beneficiaryId', 'customerType', 'qrPurpose', 'destinationType', 'pricingPlanId',
  'clientName', 'companyName', 'selectedOptions',
];

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function differingFields(actual, requested, fields) {
  return fields.filter((field) => JSON.stringify(canonical(actual?.[field] ?? null)) !== JSON.stringify(canonical(requested?.[field] ?? null)));
}

function sameFields(actual, requested, fields) {
  return differingFields(actual, requested, fields).length === 0;
}

function withoutGeneratedIds(rows) {
  return Array.isArray(rows) ? rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    const { id: _generatedId, ...rest } = row;
    return rest;
  }) : rows;
}

function normalizeQrField(field, value) {
  if (field === 'photos') return withoutGeneratedIds(value);
  if (field !== 'profileData' || !value || typeof value !== 'object' || Array.isArray(value)) return value;
  return {
    ...value,
    items: Array.isArray(value.items) ? value.items.map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const { id: _itemId, photos, ...rest } = item;
      return { ...rest, photos: withoutGeneratedIds(photos) };
    }) : value.items,
  };
}

function qrCreationDifferences(existing, requested) {
  return QR_CREATE_FIELDS.filter((field) => JSON.stringify(canonical(normalizeQrField(field, existing?.[field] ?? null))) !==
    JSON.stringify(canonical(normalizeQrField(field, requested?.[field] ?? null))));
}

function sameQrCreationIntent(existing, requested) {
  return qrCreationDifferences(existing, requested).length === 0;
}

function sameManagerOrderIntent(existing, requested) {
  if (Boolean(existing) !== Boolean(requested)) return false;
  return !existing || sameFields(existing, requested, ORDER_INTENT_FIELDS);
}

module.exports = {
  CLIENT_REQUEST_ID_RE,
  sameQrCreationIntent,
  qrCreationDifferences,
  sameManagerOrderIntent,
};
