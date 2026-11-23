'use strict';

// ============================================================================================
// MISSION 7 — Domaine « CONSIGNATION » (bouteilles & monnaie) + codes secrets clients.
//
// Principes non négociables, appliqués dans ce fichier :
//
//  1. Une consignation n'est JAMAIS un paiement. Aucune écriture ici ne touche une commande,
//     un chiffre d'affaires ou un encaissement. Le module est totalement séparé de `finance`.
//  2. Le solde n'est jamais « édité » : il est recalculé à partir de la somme des mouvements
//     (append-only). `consignments.balance_*` n'est qu'un cache de lecture, recalculé dans la
//     même transaction que le mouvement qui l'a fait changer.
//  3. Un mouvement porte une clé d'idempotence unique par fiche : un double clic ne crée jamais
//     deux mouvements, donc jamais de double remboursement ni de double déduction.
//  4. Les débits sont refusés avant écriture si le solde ne suffit pas — et la contrainte SQL
//     `consignments_balances` le garantit aussi au niveau de la base.
//  5. Le code secret n'est stocké qu'en empreinte HMAC (secret serveur) : une fuite de la base
//     ne permet pas de retrouver les codes. Il est associé à UNE boutique.
//  6. Toute opération est tracée dans `consignment_events`, y compris les refus.
// ============================================================================================

const crypto = require('node:crypto');

const KINDS = new Set(['bottle', 'money']);
const MOVEMENT_TYPES = new Set(['deposit', 'return', 'use', 'refund', 'code_rotation', 'cancel', 'adjustment']);

// Alphabet du code client : A-Z et 0-9, sans les caractères qui se confondent à l'oral ou à
// l'écrit (I/1, O/0). Le format demandé (6 caractères, majuscules + chiffres) est respecté.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

class ConsignmentError extends Error {
  constructor(message, code = 'CONSIGNMENT_ERROR', status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function clean(value, max = 200) {
  return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
}
function toInt(value, { min = 0, max = 1_000_000, fallback = 0 } = {}) {
  if (value === '' || value == null) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < min || n > max) return null;
  return n;
}
function hashToken(secret, scope, value) {
  return crypto.createHmac('sha256', String(secret)).update(`${scope}:${value}`).digest('hex');
}

module.exports = function createConsignModule({ store, sessionSecret, commerce, notifyMerchant, notifyClient, audit }) {
  const isPg = () => Boolean(store && store.pool);
  function requirePg() {
    if (!isPg()) {
      const error = new Error('La consignation nécessite la base PostgreSQL : aucun solde ne peut être tenu de façon fiable en stockage local.');
      error.code = 'PG_REQUIRED';
      error.status = 409;
      throw error;
    }
  }
  const q = (sql, params) => store.pool.query(sql, params);
  const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
  const codeOf = (raw) => hashToken(sessionSecret, 'consignment-code', String(raw || '').toUpperCase());
  const phoneHashOf = (raw) => hashToken(sessionSecret, 'customer-phone', String(raw || '').replace(/\D/g, ''));

  // ------------------------------------------------------------------ codes secrets clients
  function generateCode() {
    const bytes = crypto.randomBytes(CODE_LENGTH * 2);
    let out = '';
    for (let i = 0; i < CODE_LENGTH; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    return out;
  }
  async function uniqueCode(storeId) {
    for (let attempt = 0; attempt < 25; attempt += 1) {
      const candidate = generateCode();
      const { rows } = await q('SELECT 1 FROM consignments WHERE store_id=$1 AND code_hash=$2', [storeId, codeOf(candidate)]);
      if (!rows.length) return candidate;
    }
    throw new ConsignmentError('Impossible de générer un code unique. Réessayez.', 'CODE_GENERATION_FAILED', 500);
  }

  // ------------------------------------------------------------------ références lisibles
  async function nextReference(storeId, kind) {
    const prefix = kind === 'bottle' ? 'CB' : 'CM';
    const { rows } = await q(
      `SELECT COUNT(*)::int AS n FROM consignments WHERE store_id=$1 AND kind=$2`, [storeId, kind]);
    const day = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    return `${prefix}-${day}-${String((rows[0]?.n || 0) + 1).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  }

  // ------------------------------------------------------------------ lecture d'une fiche
  function shape(row, { includeCode = false } = {}) {
    if (!row) return null;
    const out = {
      id: row.id,
      reference: row.reference,
      storeId: row.store_id,
      merchantId: row.merchant_id,
      kind: row.kind,
      status: row.status,
      customerName: row.customer_name,
      customerPhone: row.customer_phone,
      bottleTypeId: row.bottle_type_id,
      bottleTypeLabel: row.bottle_type_label,
      bottleReference: row.bottle_reference,
      quantityDeposited: Number(row.quantity_deposited),
      quantityRecovered: Number(row.quantity_recovered),
      unitValueXof: Number(row.unit_value_xof),
      amountDepositedXof: Number(row.amount_deposited_xof),
      amountUsedXof: Number(row.amount_used_xof),
      amountRefundedXof: Number(row.amount_refunded_xof),
      balanceQuantity: Number(row.balance_quantity),
      balanceAmountXof: Number(row.balance_amount_xof),
      currency: row.currency,
      reason: row.reason,
      observation: row.observation,
      servicePointName: row.service_point_name,
      createdByLabel: row.created_by_label,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      settledAt: row.settled_at,
    };
    if (includeCode && row.code_hint) out.codeHint = row.code_hint;
    return out;
  }

  async function getById(storeId, consignmentId) {
    const { rows } = await q('SELECT * FROM consignments WHERE id=$1 AND store_id=$2', [consignmentId, storeId]);
    return rows[0] || null;
  }

  async function movements(consignmentId) {
    const { rows } = await q(
      `SELECT id, movement_type, quantity_delta, amount_delta_xof, balance_quantity_after, balance_amount_after,
              order_id, reason, observation, actor_type, actor_label, created_at
         FROM consignment_movements WHERE consignment_id=$1 ORDER BY created_at ASC, id ASC`, [consignmentId]);
    return rows.map((r) => ({
      id: r.id, type: r.movement_type, quantityDelta: Number(r.quantity_delta), amountDeltaXof: Number(r.amount_delta_xof),
      balanceQuantityAfter: Number(r.balance_quantity_after), balanceAmountAfter: Number(r.balance_amount_after),
      orderId: r.order_id, reason: r.reason, observation: r.observation, actorType: r.actor_type,
      actorLabel: r.actor_label, createdAt: r.created_at,
    }));
  }

  // ------------------------------------------------------------------ création
  async function createConsignment(input) {
    requirePg();
    const {
      merchantId, storeId, kind, actor, customerName, customerPhone, bottleTypeId, quantity, unitValueXof,
      amountXof, reason, observation, servicePointId, servicePointName, idempotencyKey,
    } = input;
    if (!merchantId || !storeId) throw new ConsignmentError('Boutique introuvable.', 'STORE_REQUIRED', 400);
    if (!KINDS.has(kind)) throw new ConsignmentError('Type de consignation inconnu.', 'INVALID_KIND', 400);

    let typeLabel = '', typeRef = '', unit = 0, qty = 0, amount = 0;
    if (kind === 'bottle') {
      qty = toInt(quantity, { min: 1, max: 100_000 });
      if (!qty) throw new ConsignmentError('Indiquez une quantité de bouteilles valide (au moins 1).', 'INVALID_QUANTITY', 400);
      if (!bottleTypeId) throw new ConsignmentError('Choisissez un type de bouteille (ou créez-le dans les réglages).', 'BOTTLE_TYPE_REQUIRED', 400);
      const { rows } = await q('SELECT * FROM consign_bottle_types WHERE id=$1 AND store_id=$2', [bottleTypeId, storeId]);
      const type = rows[0];
      if (!type) throw new ConsignmentError('Ce type de bouteille n’appartient pas à cette boutique.', 'BOTTLE_TYPE_NOT_FOUND', 404);
      if (!type.active) throw new ConsignmentError('Ce type de bouteille est désactivé.', 'BOTTLE_TYPE_INACTIVE', 409);
      typeLabel = type.label; typeRef = type.reference || '';
      // La valeur unitaire peut être précisée ponctuellement, sinon celle du catalogue s'applique.
      unit = unitValueXof === undefined || unitValueXof === null || unitValueXof === ''
        ? Number(type.unit_value_xof)
        : toInt(unitValueXof, { min: 0, max: 10_000_000 });
      if (unit === null) throw new ConsignmentError('Montant unitaire de consigne invalide.', 'INVALID_UNIT_VALUE', 400);
    } else {
      amount = toInt(amountXof, { min: 1, max: 1_000_000_000 });
      if (!amount) throw new ConsignmentError('Indiquez un montant consigné valide (au moins 1 FCFA).', 'INVALID_AMOUNT', 400);
      const settings = await getSettings(storeId);
      if (settings.require_phone_for_money && !clean(customerPhone, 40)) {
        throw new ConsignmentError('Cette boutique exige un numéro de téléphone pour une consignation de monnaie.', 'PHONE_REQUIRED', 400);
      }
    }

    const code = await uniqueCode(storeId);
    const reference = await nextReference(storeId, kind);
    const phone = clean(customerPhone, 40);
    const row = {
      id: id('cns'), reference,
      codeHash: codeOf(code),
      // Suffixe non secret : permet au personnel de reconnaître la fiche sans redonner le code.
      codeHint: `${code.slice(0, 2)}••${code.slice(-1)}`,
      customerName: clean(customerName, 120), customerPhone: phone,
      customerPhoneHash: phone ? phoneHashOf(phone) : '',
      bottleTypeId: kind === 'bottle' ? bottleTypeId : null,
      bottleTypeLabel: typeLabel, bottleReference: typeRef,
      quantityDeposited: qty, unitValueXof: unit, amountDepositedXof: amount,
      reason: clean(reason, 200), observation: clean(observation, 500),
      servicePointId: clean(servicePointId, 80), servicePointName: clean(servicePointName, 120),
      balanceQuantity: qty, balanceAmountXof: amount,
    };

    const client = await store.pool.connect();
    try {
      await client.query('BEGIN');
      // Idempotence de la création : le même identifiant de requête ne crée jamais deux fiches.
      if (idempotencyKey) {
        const existing = await client.query(
          `SELECT c.* FROM consignments c JOIN consignment_events e ON e.consignment_id = c.id
            WHERE c.store_id=$1 AND e.action='created' AND e.metadata->>'idempotencyKey'=$2 LIMIT 1`,
          [storeId, clean(idempotencyKey, 80)]);
        if (existing.rows.length) {
          await client.query('ROLLBACK');
          return { consignment: shape(existing.rows[0]), code: null, idempotent: true };
        }
      }
      await client.query(
        `INSERT INTO consignments (id, reference, merchant_id, store_id, kind, code_hash, code_hint, customer_name, customer_phone,
           customer_phone_hash, bottle_type_id, bottle_type_label, bottle_reference, quantity_deposited, unit_value_xof,
           amount_deposited_xof, currency, reason, observation, balance_quantity, balance_amount_xof, service_point_id,
           service_point_name, created_by_type, created_by_id, created_by_label, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'XOF',$17,$18,$19,$20,$21,$22,$23,$24,$25,'open')`,
        [row.id, row.reference, merchantId, storeId, kind, row.codeHash, row.codeHint, row.customerName, row.customerPhone,
          row.customerPhoneHash, row.bottleTypeId, row.bottleTypeLabel, row.bottleReference, row.quantityDeposited, row.unitValueXof,
          row.amountDepositedXof, row.reason, row.observation, row.balanceQuantity, row.balanceAmountXof, row.servicePointId,
          row.servicePointName, actor.type, actor.id, actor.label]);
      await client.query(
        `INSERT INTO consignment_movements (id, consignment_id, store_id, movement_type, quantity_delta, amount_delta_xof,
           balance_quantity_after, balance_amount_after, idempotency_key, reason, actor_type, actor_id, actor_label)
         VALUES ($1,$2,$3,'deposit',$4,$5,$4,$5,'create',$6,$7,$8,$9)`,
        [id('cmv'), row.id, storeId, qty, amount, row.reason, actor.type, actor.id, actor.label]);
      await client.query(
        `INSERT INTO consignment_events (id, consignment_id, store_id, action, actor_type, actor_id, actor_label, detail, metadata)
         VALUES ($1,$2,$3,'created',$4,$5,$6,$7,$8)`,
        [id('cev'), row.id, storeId, actor.type, actor.id, actor.label,
          `Consignation ${kind === 'bottle' ? 'de bouteilles' : 'de monnaie'} enregistrée.`,
          JSON.stringify({ kind, qty, amount, codeHint: row.codeHint, idempotencyKey: clean(idempotencyKey, 80) })]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }

    const consignment = shape(await getById(storeId, row.id), { includeCode: true });
    // Le code en clair n'est renvoyé QU'UNE FOIS, à la création (ou après rotation explicite).
    consignment.code = code;

    if (typeof audit === 'function') {
      await audit({ action: 'consignment_created', merchantId, storeId, entityId: row.id,
        summary: `Consignation ${reference} enregistrée (${kind === 'bottle' ? `${qty} bouteille(s)` : `${amount} FCFA`}).` }).catch(() => {});
    }
    if (phone && typeof notifyClient === 'function') {
      await notifyClient({ phone, storeId, merchantId, type: 'consignment_created', dedupeKey: `consign-created:${row.id}`,
        title: 'Consignation enregistrée', message: `Votre consignation ${reference} est enregistrée.`,
        data: { consignmentId: row.id, reference } }).catch(() => {});
    }
    return { consignment, code, idempotent: false };
  }

  // ------------------------------------------------------------------ mouvements
  // `applyMovement` est le SEUL point d'écriture de solde. Tout passe par lui (retour, usage,
  // remboursement, annulation, rotation de code).
  async function applyMovement({ storeId, consignmentId, type, quantity, amountXof, idempotencyKey, actor, orderId, reason, observation }) {
    requirePg();
    if (!MOVEMENT_TYPES.has(type)) throw new ConsignmentError('Type de mouvement inconnu.', 'INVALID_MOVEMENT', 400);
    if (!idempotencyKey || String(idempotencyKey).length < 8) {
      throw new ConsignmentError('Identifiant d’opération manquant : impossible de garantir l’absence de doublon.', 'IDEMPOTENCY_REQUIRED', 400);
    }
    const key = clean(idempotencyKey, 80);
    const client = await store.pool.connect();
    try {
      await client.query('BEGIN');
      // Verrou de ligne : deux requêtes simultanées sur la même fiche sont sérialisées.
      const found = await client.query('SELECT * FROM consignments WHERE id=$1 AND store_id=$2 FOR UPDATE', [consignmentId, storeId]);
      const current = found.rows[0];
      if (!current) throw new ConsignmentError('Consignation introuvable dans cette boutique.', 'NOT_FOUND', 404);

      const already = await client.query(
        'SELECT * FROM consignment_movements WHERE consignment_id=$1 AND idempotency_key=$2', [consignmentId, key]);
      if (already.rows.length) {
        await client.query('COMMIT');
        return { movement: mapMovement(already.rows[0]), consignment: shape(current), idempotent: true };
      }
      if (current.status === 'cancelled') throw new ConsignmentError('Cette consignation est annulée : aucune opération possible.', 'CANCELLED', 409);

      const isBottle = current.kind === 'bottle';
      let qDelta = 0, aDelta = 0;
      if (isBottle) {
        if (type === 'return') {
          const n = toInt(quantity, { min: 1, max: 100_000 });
          if (!n) throw new ConsignmentError('Indiquez le nombre de bouteilles rendues.', 'INVALID_QUANTITY', 400);
          if (n > Number(current.balance_quantity)) {
            throw new ConsignmentError(`Impossible : il ne reste que ${current.balance_quantity} bouteille(s) sur cette consignation.`, 'INSUFFICIENT_BALANCE', 409);
          }
          qDelta = -n;
        } else if (type === 'cancel') {
          qDelta = -Number(current.balance_quantity);
        } else {
          throw new ConsignmentError('Seul un retour de bouteilles est possible sur une consignation de bouteilles.', 'INVALID_MOVEMENT_KIND', 400);
        }
      } else {
        if (type === 'use' || type === 'refund') {
          const n = toInt(amountXof, { min: 1, max: 1_000_000_000 });
          if (!n) throw new ConsignmentError('Indiquez un montant valide.', 'INVALID_AMOUNT', 400);
          if (n > Number(current.balance_amount_xof)) {
            throw new ConsignmentError(`Impossible : le solde disponible est de ${current.balance_amount_xof} FCFA.`, 'INSUFFICIENT_BALANCE', 409);
          }
          aDelta = -n;
        } else if (type === 'cancel') {
          aDelta = -Number(current.balance_amount_xof);
        } else {
          throw new ConsignmentError('Seul un usage ou un remboursement est possible sur une consignation de monnaie.', 'INVALID_MOVEMENT_KIND', 400);
        }
      }

      const balanceQ = Number(current.balance_quantity) + qDelta;
      const balanceA = Number(current.balance_amount_xof) + aDelta;
      if (balanceQ < 0 || balanceA < 0) throw new ConsignmentError('Solde insuffisant.', 'INSUFFICIENT_BALANCE', 409);

      const recovered = Number(current.quantity_recovered) + (type === 'return' || (type === 'cancel' && isBottle) ? -qDelta : 0);
      const used = Number(current.amount_used_xof) + (type === 'use' ? -aDelta : 0);
      const refunded = Number(current.amount_refunded_xof) + (type === 'refund' || (type === 'cancel' && !isBottle) ? -aDelta : 0);
      const settled = balanceQ === 0 && balanceA === 0;
      const status = type === 'cancel' ? 'cancelled' : (settled ? 'settled' : 'open');

      const mvId = id('cmv');
      await client.query(
        `INSERT INTO consignment_movements (id, consignment_id, store_id, movement_type, quantity_delta, amount_delta_xof,
           balance_quantity_after, balance_amount_after, idempotency_key, order_id, reason, observation, actor_type, actor_id, actor_label)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [mvId, consignmentId, storeId, type, qDelta, aDelta, balanceQ, balanceA, key, orderId ? clean(orderId, 80) : null,
          clean(reason, 200), clean(observation, 500), actor.type, actor.id, actor.label]);
      await client.query(
        `UPDATE consignments SET balance_quantity=$2, balance_amount_xof=$3, quantity_recovered=$4, amount_used_xof=$5,
            amount_refunded_xof=$6, status=$7, settled_at=CASE WHEN $7='settled' THEN NOW() ELSE settled_at END,
            updated_at=NOW(), version=version+1
          WHERE id=$1`,
        [consignmentId, balanceQ, balanceA, recovered, used, refunded, status]);
      await client.query(
        `INSERT INTO consignment_events (id, consignment_id, store_id, action, actor_type, actor_id, actor_label, detail, metadata)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id('cev'), consignmentId, storeId, type, actor.type, actor.id, actor.label,
          `${labelFor(type, isBottle)} — solde restant : ${isBottle ? `${balanceQ} bouteille(s)` : `${balanceA} FCFA`}.`,
          JSON.stringify({ quantity: qDelta, amount: aDelta, orderId: orderId || null, idempotencyKey: key })]);
      await client.query('COMMIT');

      const updated = await getById(storeId, consignmentId);
      if (typeof audit === 'function') {
        await audit({ action: `consignment_${type}`, merchantId: current.merchant_id, storeId, entityId: consignmentId,
          summary: `${labelFor(type, isBottle)} sur ${current.reference}.` }).catch(() => {});
      }
      if (current.customer_phone && typeof notifyClient === 'function') {
        await notifyClient({ phone: current.customer_phone, storeId, merchantId: current.merchant_id, type: `consignment_${type}`,
          dedupeKey: `consign-${type}:${mvId}`, title: labelFor(type, isBottle),
          message: isBottle ? `Il vous reste ${balanceQ} bouteille(s) sur la consignation ${current.reference}.`
            : `Solde restant : ${balanceA} FCFA sur la consignation ${current.reference}.`,
          data: { consignmentId, reference: current.reference } }).catch(() => {});
      }
      return { movement: { id: mvId, type, quantityDelta: qDelta, amountDeltaXof: aDelta, balanceQuantityAfter: balanceQ, balanceAmountAfter: balanceA },
        consignment: shape(updated), idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }

  function mapMovement(r) {
    return { id: r.id, type: r.movement_type, quantityDelta: Number(r.quantity_delta), amountDeltaXof: Number(r.amount_delta_xof),
      balanceQuantityAfter: Number(r.balance_quantity_after), balanceAmountAfter: Number(r.balance_amount_after),
      createdAt: r.created_at, idempotent: true };
  }
  function labelFor(type, isBottle) {
    const map = {
      return: 'Retour de bouteilles', use: 'Crédit utilisé pour une commande', refund: 'Remboursement',
      cancel: 'Consignation annulée', deposit: 'Dépôt', adjustment: 'Rectification', code_rotation: 'Code renouvelé',
    };
    return map[type] || (isBottle ? 'Opération bouteilles' : 'Opération monnaie');
  }

  // ------------------------------------------------------------------ recherche sécurisée par code
  // Le code ne permet de voir QUE sa propre consignation, dans SA boutique, et seulement après
  // un nombre limité de tentatives par boutique + adresse.
  async function findByCode({ storeId, code, ipHash }) {
    requirePg();
    const raw = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (raw.length !== CODE_LENGTH) throw new ConsignmentError('Le code doit comporter 6 caractères.', 'INVALID_CODE_FORMAT', 400);
    const key = `${storeId}:${ipHash || 'anon'}`;
    const now = Date.now();
    const bucket = codeAttempts.get(key);
    if (bucket && now - bucket.start < 10 * 60_000 && bucket.count >= 20) {
      throw new ConsignmentError('Trop de tentatives de code. Réessayez dans dix minutes.', 'TOO_MANY_CODE_ATTEMPTS', 429);
    }
    if (!bucket || now - bucket.start >= 10 * 60_000) codeAttempts.set(key, { start: now, count: 1 }); else bucket.count += 1;
    const { rows } = await q('SELECT * FROM consignments WHERE store_id=$1 AND code_hash=$2', [storeId, codeOf(raw)]);
    if (!rows.length) throw new ConsignmentError('Aucune consignation ne correspond à ce code dans cette boutique.', 'CODE_NOT_FOUND', 404);
    if (bucket) bucket.count = 1;
    return shape(rows[0]);
  }
  const codeAttempts = new Map();

  async function listByCustomer({ storeId, phone, limit = 50 }) {
    requirePg();
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 7) throw new ConsignmentError('Numéro de téléphone invalide.', 'INVALID_PHONE', 400);
    const { rows } = await q(
      `SELECT * FROM consignments WHERE store_id=$1 AND customer_phone_hash=$2 ORDER BY created_at DESC LIMIT $3`,
      [storeId, phoneHashOf(digits), Math.min(200, Math.max(1, Number(limit) || 50))]);
    return rows.map((r) => shape(r));
  }

  async function getDetail(storeId, consignmentId) {
    const row = await getById(storeId, consignmentId);
    if (!row) return null;
    return { ...shape(row, { includeCode: true }), movements: await movements(consignmentId) };
  }

  // ------------------------------------------------------------------ réglages & types de bouteilles
  const DEFAULT_SETTINGS = {
    currency: 'XOF', waitress_can_create_bottles: true, waitress_can_create_money: true,
    waitress_can_return: false, waitress_can_refund: false, require_phone_for_money: false,
  };
  async function getSettings(storeId) {
    requirePg();
    const { rows } = await q('SELECT * FROM consign_store_settings WHERE store_id=$1', [storeId]);
    return rows[0] || { store_id: storeId, ...DEFAULT_SETTINGS };
  }
  async function saveSettings({ merchantId, storeId, patch }) {
    requirePg();
    const current = await getSettings(storeId);
    const bool = (v, fallback) => (v === undefined ? fallback : Boolean(v));
    const next = {
      currency: clean(patch.currency, 8) || current.currency || 'XOF',
      waitress_can_create_bottles: bool(patch.waitressCanCreateBottles, current.waitress_can_create_bottles),
      waitress_can_create_money: bool(patch.waitressCanCreateMoney, current.waitress_can_create_money),
      waitress_can_return: bool(patch.waitressCanReturn, current.waitress_can_return),
      waitress_can_refund: bool(patch.waitressCanRefund, current.waitress_can_refund),
      require_phone_for_money: bool(patch.requirePhoneForMoney, current.require_phone_for_money),
    };
    await q(
      `INSERT INTO consign_store_settings (store_id, merchant_id, currency, waitress_can_create_bottles, waitress_can_create_money,
         waitress_can_return, waitress_can_refund, require_phone_for_money, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW())
       ON CONFLICT (store_id) DO UPDATE SET currency=EXCLUDED.currency,
         waitress_can_create_bottles=EXCLUDED.waitress_can_create_bottles,
         waitress_can_create_money=EXCLUDED.waitress_can_create_money,
         waitress_can_return=EXCLUDED.waitress_can_return,
         waitress_can_refund=EXCLUDED.waitress_can_refund,
         require_phone_for_money=EXCLUDED.require_phone_for_money, updated_at=NOW()`,
      [storeId, merchantId, next.currency, next.waitress_can_create_bottles, next.waitress_can_create_money,
        next.waitress_can_return, next.waitress_can_refund, next.require_phone_for_money]);
    return getSettings(storeId);
  }

  async function listBottleTypes(storeId, { includeInactive = false } = {}) {
    requirePg();
    const { rows } = await q(
      `SELECT * FROM consign_bottle_types WHERE store_id=$1 ${includeInactive ? '' : 'AND active=TRUE'} ORDER BY sort_order, LOWER(label)`, [storeId]);
    return rows.map(publicBottleType);
  }
  // Forme publique d'un type de bouteille : la même pour la liste et pour la création, afin que
  // l'interface ne reçoive jamais une ligne brute de PostgreSQL (snake_case, bigint en texte).
  function publicBottleType(r) {
    return { id: r.id, label: r.label, reference: r.reference ?? '', unitValueXof: Number(r.unit_value_xof ?? 0),
      active: r.active !== false, sortOrder: Number(r.sort_order) || 0 };
  }

  async function saveBottleType({ merchantId, storeId, typeId, input }) {
    requirePg();
    const label = clean(input.label, 80);
    if (label.length < 2) throw new ConsignmentError('Le nom du type de bouteille est trop court.', 'INVALID_LABEL', 400);
    const unit = toInt(input.unitValueXof, { min: 0, max: 10_000_000 });
    if (unit === null) throw new ConsignmentError('Montant de consigne invalide.', 'INVALID_UNIT_VALUE', 400);
    const reference = clean(input.reference, 80);
    const active = input.active === undefined ? true : Boolean(input.active);
    if (typeId) {
      const { rows } = await q(
        `UPDATE consign_bottle_types SET label=$3, reference=$4, unit_value_xof=$5, active=$6, sort_order=$7, updated_at=NOW()
          WHERE id=$1 AND store_id=$2 RETURNING *`, [typeId, storeId, label, reference, unit, active, toInt(input.sortOrder, { min: 0, max: 10_000, fallback: 0 }) || 0]);
      if (!rows.length) throw new ConsignmentError('Type de bouteille introuvable dans cette boutique.', 'NOT_FOUND', 404);
      return publicBottleType(rows[0]);
    }
    try {
      const rowId = id('cbt');
      const { rows } = await q(
        `INSERT INTO consign_bottle_types (id, merchant_id, store_id, label, reference, unit_value_xof, active, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [rowId, merchantId, storeId, label, reference, unit, active, toInt(input.sortOrder, { min: 0, max: 10_000, fallback: 0 }) || 0]);
      return publicBottleType(rows[0]);
    } catch (error) {
      if (String(error.code) === '23505') throw new ConsignmentError('Ce type de bouteille existe déjà dans cette boutique.', 'DUPLICATE_LABEL', 409);
      throw error;
    }
  }

  // ------------------------------------------------------------------ rotation de code
  async function rotateCode({ storeId, consignmentId, actor }) {
    requirePg();
    const row = await getById(storeId, consignmentId);
    if (!row) throw new ConsignmentError('Consignation introuvable.', 'NOT_FOUND', 404);
    const code = await uniqueCode(storeId);
    const client = await store.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('UPDATE consignments SET code_hash=$2, code_hint=$3, code_rotated_at=NOW(), code_attempt_count=0, updated_at=NOW(), version=version+1 WHERE id=$1',
        [consignmentId, codeOf(code), `${code.slice(0, 2)}••${code.slice(-1)}`]);
      await client.query(
        `INSERT INTO consignment_events (id, consignment_id, store_id, action, actor_type, actor_id, actor_label, detail)
         VALUES ($1,$2,$3,'code_rotation',$4,$5,$6,'Code client renouvelé ; l’ancien code ne fonctionne plus.')`,
        [id('cev'), consignmentId, storeId, actor.type, actor.id, actor.label]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; } finally { client.release(); }
    if (typeof audit === 'function') {
      await audit({ action: 'consignment_code_rotated', merchantId: row.merchant_id, storeId, entityId: consignmentId,
        summary: `Code de la consignation ${row.reference} renouvelé.` }).catch(() => {});
    }
    return { code, consignment: shape(await getById(storeId, consignmentId), { includeCode: true }) };
  }

  // ------------------------------------------------------------------ listes & statistiques
  function periodClause(period, params, startIndex) {
    const p = String(period || 'all');
    if (p === 'today') return { sql: `AND created_at >= date_trunc('day', NOW())`, params };
    if (p === 'week') return { sql: `AND created_at >= NOW() - INTERVAL '7 days'`, params };
    if (p === 'month') return { sql: `AND created_at >= NOW() - INTERVAL '30 days'`, params };
    return { sql: '', params };
  }

  async function listConsignments({ storeId, kind, status, period, search, staffId, limit = 100 }) {
    requirePg();
    const params = [storeId];
    let where = 'WHERE store_id=$1';
    if (kind && KINDS.has(kind)) { params.push(kind); where += ` AND kind=$${params.length}`; }
    if (status && ['open', 'settled', 'cancelled'].includes(status)) { params.push(status); where += ` AND status=$${params.length}`; }
    if (search) {
      params.push(`%${clean(search, 80).toLowerCase()}%`);
      where += ` AND (LOWER(reference) LIKE $${params.length} OR LOWER(customer_name) LIKE $${params.length} OR customer_phone LIKE $${params.length})`;
    }
    if (staffId) { params.push(clean(staffId, 80)); where += ` AND created_by_id=$${params.length}`; }
    const periodFilter = periodClause(period, params);
    if (periodFilter.sql) where += ` ${periodFilter.sql.replace('created_at', 'created_at')}`;
    params.push(Math.min(300, Math.max(1, Number(limit) || 100)));
    const { rows } = await q(`SELECT * FROM consignments ${where} ORDER BY created_at DESC LIMIT $${params.length}`, params);
    return rows.map((r) => shape(r, { includeCode: true }));
  }

  async function stats({ storeId, period }) {
    requirePg();
    const p = periodClause(period, []);
    const where = `WHERE store_id=$1 ${p.sql}`;
    const { rows } = await q(
      `SELECT
         COUNT(*) FILTER (WHERE kind='bottle')::int AS bottles_count,
         COALESCE(SUM(quantity_deposited) FILTER (WHERE kind='bottle'),0)::bigint AS bottles_deposited,
         COALESCE(SUM(quantity_recovered) FILTER (WHERE kind='bottle'),0)::bigint AS bottles_recovered,
         COALESCE(SUM(balance_quantity) FILTER (WHERE kind='bottle' AND status='open'),0)::bigint AS bottles_remaining,
         COUNT(*) FILTER (WHERE kind='money')::int AS money_count,
         COALESCE(SUM(amount_deposited_xof) FILTER (WHERE kind='money'),0)::bigint AS money_deposited,
         COALESCE(SUM(amount_used_xof) FILTER (WHERE kind='money'),0)::bigint AS money_used,
         COALESCE(SUM(amount_refunded_xof) FILTER (WHERE kind='money'),0)::bigint AS money_refunded,
         COALESCE(SUM(balance_amount_xof) FILTER (WHERE kind='money' AND status='open'),0)::bigint AS money_remaining,
         COALESCE(SUM(quantity_deposited * unit_value_xof) FILTER (WHERE kind='bottle'),0)::bigint AS bottle_value_deposited,
         COALESCE(SUM(balance_quantity * unit_value_xof) FILTER (WHERE kind='bottle' AND status='open'),0)::bigint AS bottle_value_remaining,
         COUNT(*) FILTER (WHERE status='open')::int AS open_count,
         COUNT(*) FILTER (WHERE status='settled')::int AS settled_count,
         COUNT(*)::int AS total
       FROM consignments ${where}`, [storeId]);
    const s = rows[0];
    return {
      bottlesCount: s.bottles_count, bottlesDeposited: Number(s.bottles_deposited), bottlesRecovered: Number(s.bottles_recovered),
      bottlesRemaining: Number(s.bottles_remaining), moneyCount: s.money_count, moneyDeposited: Number(s.money_deposited),
      moneyUsed: Number(s.money_used), moneyRefunded: Number(s.money_refunded), moneyRemaining: Number(s.money_remaining),
      bottleValueDeposited: Number(s.bottle_value_deposited), bottleValueRemaining: Number(s.bottle_value_remaining),
      openCount: s.open_count, settledCount: s.settled_count, total: s.total, currency: 'XOF',
    };
  }

  // Vue client : uniquement les fiches rattachées à SON numéro (empreinte), jamais par nom.
  async function listForClient({ clientId, phoneHash }) {
    requirePg();
    const { rows } = await q(
      `SELECT c.*, s.name AS store_name FROM consignments c JOIN merchant_stores s ON s.id=c.store_id
        WHERE c.customer_phone_hash=$1 AND c.customer_phone_hash<>'' ORDER BY c.created_at DESC LIMIT 200`, [phoneHash]);
    return rows.map((r) => ({ ...shape(r, { includeCode: true }), storeName: r.store_name }));
  }

  return {
    ConsignmentError, CODE_ALPHABET, CODE_LENGTH,
    isPg, codeOf, phoneHashOf, generateCode,
    createConsignment, applyMovement, getById, getDetail, movements, findByCode, listByCustomer,
    getSettings, saveSettings, listBottleTypes, saveBottleType, rotateCode, listConsignments, stats, listForClient,
  };
};
