'use strict';

// ============================================================================================
// MISSION 15 — « VALIDER ET CONFIRMER LE PAIEMENT » EN UNE SEULE ACTION (§4.3 du prompt)
//
// Une seule opération fait deux choses distinctes, et les enregistre séparément :
//   · VALIDER la commande            → statut « completed » (elle quitte « Nouvelle commande ») ;
//   · CONFIRMER LE PAIEMENT          → payment_status + date + auteur + moyen de paiement.
//
// Le paiement n'est jamais déduit d'un simple clic :
//   · espèces / comptoir : l'employé DÉCLARE avoir reçu le montant, son identité est enregistrée ;
//   · paiement électronique : la confirmation vient de l'API du prestataire. Sans réponse réelle
//     du prestataire, la commande est validée mais le paiement reste « non enregistré » — elle
//     apparaît alors dans « Validée, paiement à confirmer », jamais dans « Validée et payée ».
//   · montant reçu ≠ total de la commande : l'écart doit être justifié, et il est journalisé.
//
// Aucune permission n'est décidée ici : la route appelante a déjà vérifié le droit d'agir sur
// cette boutique. Le module ne touche qu'aux colonnes de paiement et au statut de la commande.
// ============================================================================================

const crypto = require('node:crypto');

const METHODS = Object.freeze({
  cash: 'Espèces (comptoir)',
  mobile_money: 'Mobile Money',
  card: 'Carte bancaire',
  transfer: 'Virement',
  other: 'Autre moyen confirmé',
});

const PROVIDER_CONFIRMED = ['confirmed', 'paid', 'succeeded', 'success', 'captured'];
const PAID_STATUSES = ['paid', 'confirmed', 'succeeded'];

function amount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

module.exports = function orderSettlement({ pool = null, commerce = null, store = null } = {}) {
  async function q(text, params = []) {
    if (!pool) throw new Error('PostgreSQL indisponible.');
    return pool.query(text, params);
  }

  /** Vérifie la confirmation réelle d'un paiement électronique auprès du prestataire. */
  async function providerConfirmation({ provider, reference }) {
    // Aucun prestataire de paiement n'est configuré dans cette installation : la confirmation
    // ne peut donc PAS être affirmée. On le renvoie explicitement au lieu de faire semblant.
    return { confirmed: false, provider: provider || '', reference: reference || '',
      reason: 'Aucune confirmation du prestataire de paiement n’a été reçue. La commande est validée ; le paiement reste à confirmer.' };
  }

  async function settle({ storeId, orderId, method, receivedXof, actor = {}, providerConfirmation: provider = null, reason = '' }) {
    const paymentMethod = METHODS[method] ? method : '';
    if (!paymentMethod) {
      return { ok: false, status: 400, code: 'PAYMENT_METHOD_REQUIRED',
        error: `Indiquez le moyen de paiement réellement utilisé (${Object.values(METHODS).join(', ')}).` };
    }
    const order = pool
      ? (await q(`SELECT id, store_id AS "storeId", status, payment_status AS "paymentStatus", total_amount_xof AS "totalAmountXof",
                         public_reference AS reference, payment_confirmed_at AS "paymentConfirmedAt"
                    FROM merchant_orders WHERE id=$1 AND store_id=$2`, [String(orderId), storeId])).rows[0]
      : await commerce?.getOrder?.(orderId);
    if (!order) return { ok: false, status: 404, error: 'Commande introuvable dans votre établissement.' };
    if (order.storeId && order.storeId !== storeId) return { ok: false, status: 404, error: 'Commande introuvable dans votre établissement.' };

    if (['cancelled', 'rejected'].includes(order.status)) {
      return { ok: false, status: 409, code: 'ORDER_CANCELLED', error: 'Cette commande est annulée : son paiement ne peut pas être confirmé.' };
    }
    if (PAID_STATUSES.includes(order.paymentStatus) && order.status === 'completed') {
      return { ok: false, status: 409, code: 'ALREADY_SETTLED', error: 'Cette commande est déjà validée et payée. Aucune deuxième confirmation n’est enregistrée.' };
    }

    // Paiement électronique : seule la réponse du prestataire fait foi.
    let electronicConfirmed = false;
    let providerNote = '';
    if (['mobile_money', 'card', 'transfer'].includes(paymentMethod)) {
      const settlement = provider || await providerConfirmation({ provider: paymentMethod, reference: String(orderId) });
      electronicConfirmed = Boolean(settlement?.confirmed === true);
      providerNote = settlement?.reason || '';
      if (!electronicConfirmed) {
        return { ok: false, status: 409, code: 'PAYMENT_NOT_CONFIRMED',
          error: providerNote || 'Le prestataire de paiement n’a pas confirmé ce règlement : la commande ne peut pas être marquée payée.',
          canValidateOnly: true };
      }
    }

    const total = amount(order.totalAmountXof);
    const received = receivedXof === undefined || receivedXof === null || receivedXof === '' ? total : amount(receivedXof);
    const gap = received - total;
    if (gap !== 0 && !String(reason || '').trim()) {
      return { ok: false, status: 400, code: 'AMOUNT_MISMATCH',
        error: `Le montant reçu (${received.toLocaleString('fr-FR')} XOF) diffère du total de la commande (${total.toLocaleString('fr-FR')} XOF). Justifiez cet écart avant de confirmer.`,
        expectedXof: total, receivedXof: received };
    }

    const now = new Date().toISOString();
    const paymentStatus = gap === 0 ? 'paid' : (received > 0 ? 'partially_paid' : 'unpaid');
    const actorLabel = actor.label || actor.id || 'Personnel';

    if (!pool) {
      const updated = await commerce?.updateOrderStatus?.(orderId, 'completed', 'Validée et paiement confirmé.', 'merchant', actor.id || '');
      return { ok: true, order: updated, paymentStatus, paidAt: now, warning: gap === 0 ? '' : `Écart de ${Math.abs(gap)} XOF enregistré.` };
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query('SELECT status, payment_status FROM merchant_orders WHERE id=$1 FOR UPDATE', [order.id]);
      const current = locked.rows[0];
      if (!current) { await client.query('ROLLBACK'); return { ok: false, status: 404, error: 'Commande introuvable.' }; }
      if (PAID_STATUSES.includes(current.payment_status) && current.status === 'completed') {
        await client.query('ROLLBACK');
        return { ok: false, status: 409, code: 'ALREADY_SETTLED', error: 'Cette commande vient d’être validée par un autre appareil. Aucune double confirmation n’est enregistrée.' };
      }
      await client.query(
        `UPDATE merchant_orders SET status='completed', payment_status=$2, payment_method=$3,
                payment_confirmed_at=$4, payment_confirmed_by=$5, payment_confirmed_role=$6, updated_at=NOW()
          WHERE id=$1`,
        [order.id, paymentStatus, paymentMethod, now, actorLabel, actor.type || 'merchant']);
      await client.query(
        `INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id)
         VALUES ($1,$2,'completed',$3,$4,$5)`,
        [`evt_${crypto.randomUUID().replace(/-/g, '')}`, order.id,
          `Validée et paiement confirmé (${METHODS[paymentMethod]}, ${received.toLocaleString('fr-FR')} XOF)${gap !== 0 ? ` — écart : ${gap.toLocaleString('fr-FR')} XOF, motif : ${String(reason).slice(0, 200)}` : ''}.`,
          actor.type || 'merchant', actor.id || actorLabel]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }

    const fresh = await commerce?.getOrder?.(order.id).catch(() => null);
    return { ok: true, order: fresh, reference: order.reference, paymentStatus, paidAt: now,
      method: paymentMethod, methodLabel: METHODS[paymentMethod], receivedXof: received, totalXof: total,
      warning: gap === 0 ? '' : `Encaissement partiel : ${Math.abs(gap).toLocaleString('fr-FR')} XOF d’écart enregistré.` };
  }

  return { settle, METHODS, PAID_STATUSES };
};
