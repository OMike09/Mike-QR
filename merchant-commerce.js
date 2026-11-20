'use strict';

const crypto = require('node:crypto');

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const ORDER_STATUSES = new Set(['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'completed', 'cancelled', 'rejected']);
const NEXT_ORDER_STATUSES = {
  pending: new Set(['confirmed', 'cancelled', 'rejected']),
  confirmed: new Set(['preparing', 'cancelled', 'rejected']),
  preparing: new Set(['ready', 'cancelled', 'rejected']),
  ready: new Set(['out_for_delivery', 'completed', 'cancelled']),
  out_for_delivery: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
  rejected: new Set(),
};
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,100}$/;

function uniqueId() { return crypto.randomUUID(); }
function publicReference() { return `OY-${crypto.randomBytes(6).toString('base64url').toUpperCase()}`; }
function safeStatusNote(status, note) { const text = String(note || '').trim().slice(0, 300); return status === 'cancelled' ? (text || 'Commande annulée par le marchand.') : status === 'rejected' ? (text || 'Commande refusée par le marchand.') : (text || `Statut mis à jour : ${status}.`); }
function withoutSecrets(row) {
  if (!row) return null;
  const { passwordHash, passwordResetTokenHash, trackingTokenHash, intentHash, ...safe } = row;
  return clone(safe);
}
function orderIntent(data) {
  const intent = {
    customerName: data.customerName, customerPhone: data.customerPhone, customerEmail: data.customerEmail,
    deliveryAddress: data.deliveryAddress, note: data.note, servicePointId: data.servicePointId || '',
    items: [...data.items].map((item) => ({ productId: item.productId, quantity: item.quantity })).sort((a, b) => a.productId.localeCompare(b.productId)),
    tablePhotoHash: data.tablePhoto?.bytes ? crypto.createHash('sha256').update(Buffer.from(data.tablePhoto.bytes)).digest('hex') : '',
  };
  // Preserve the historical idempotency hash for QR-originated drafts after this additive extension.
  if (data.source === 'merchant_assisted') Object.assign(intent, { source: data.source, orderType: data.orderType, paymentMethod: data.paymentMethod,
    discountAmountXof: data.discountAmountXof, occupiedPointConfirmed: data.occupiedPointConfirmed === true });
  return JSON.stringify(intent);
}
function safeOrder(row) {
  if (!row) return null;
  const safe = withoutSecrets(row);
  safe.source = row.source || 'customer_qr'; safe.createdByType = row.createdByType || (safe.source === 'merchant_assisted' ? 'merchant' : 'customer');
  safe.createdById = row.createdById || ''; safe.orderType = row.orderType || 'delivery'; safe.paymentMethod = row.paymentMethod || 'not_recorded';
  safe.paymentStatus = row.paymentStatus || 'not_recorded';
  safe.grandTotalXof = Math.max(0, (Number(row.totalAmountXof) || 0) - (Number(row.discountAmountXof) || 0) + (Number(row.deliveryFeeXof) || 0));
  safe.items = Array.isArray(row.items) ? clone(row.items) : [];
  safe.events = Array.isArray(row.events) ? clone(row.events) : [];
  safe.cancellationRequests = Array.isArray(row.cancellationRequests) ? clone(row.cancellationRequests) : [];
  return safe;
}

class MerchantCommerceStore {
  constructor(baseStore) {
    this.base = baseStore;
    this.pg = Boolean(baseStore.pool);
    this.serial = Promise.resolve();
  }

  async init() {
    if (this.pg) return;
    const state = this.base.state;
    let changed = false;
    for (const [key, value] of Object.entries({ merchants: [], merchantStores: [], merchantProducts: [], merchantOrders: [], merchantAssignments: [], merchantQrScans: [], merchantMedia: [], merchantNotifications: [], merchantPushSubscriptions: [], merchantServicePoints: [], merchantAdCampaigns: [], merchantAdEvents: [], merchantRewardCampaigns: [], merchantRewardPrizes: [], merchantRewardClaims: [], merchantGiftCards: [], merchantGiftCardRedemptions: [], merchantOrderPhotos: [], merchantOrderCancellationRequests: [], merchantCustomerBlocks: [], merchantCustomerBlockEvents: [], merchantCustomerBlockAttempts: [] })) {
      if (!Array.isArray(state[key])) { state[key] = value; changed = true; }
    }
    for (const row of state.merchantStores) {
      if (!row.sector) { row.sector = 'general'; changed = true; }
      // Existing QR links predate the activation flag and remain enabled unless explicitly disabled.
      if (typeof row.qrEnabled !== 'boolean') { row.qrEnabled = true; changed = true; }
    }
    if (changed) await this.base.save();
  }

  async withJsonLock(work) {
    const run = this.serial.then(work, work);
    this.serial = run.catch(() => {});
    return run;
  }

  async saveMedia(merchantId, { mimeType, bytes }) {
    const id = uniqueId(); const buffer = Buffer.from(bytes); const now = new Date().toISOString();
    if (this.pg) {
      await this.base.pool.query('INSERT INTO merchant_media (id, merchant_id, mime_type, byte_size, content) VALUES ($1,$2,$3,$4,$5)',
        [id, merchantId, mimeType, buffer.length, buffer]);
      return { id, merchantId, mimeType, byteSize: buffer.length, url: `/media/merchant/${id}`, createdAt: now };
    }
    const row = { id, merchantId, mimeType, byteSize: buffer.length, contentBase64: buffer.toString('base64'), createdAt: now };
    this.base.state.merchantMedia.push(row); await this.base.save();
    const { contentBase64, ...safe } = row; return { ...safe, url: `/media/merchant/${id}` };
  }

  async getMedia(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id, merchant_id AS "merchantId", mime_type AS "mimeType", byte_size AS "byteSize", content, created_at AS "createdAt" FROM merchant_media WHERE id=$1', [id]);
      if (!rows[0]) return null;
      return { ...rows[0], bytes: Buffer.from(rows[0].content) };
    }
    const row = this.base.state.merchantMedia.find((item) => item.id === id);
    if (!row) return null;
    return { id: row.id, merchantId: row.merchantId, mimeType: row.mimeType, byteSize: row.byteSize, bytes: Buffer.from(row.contentBase64, 'base64'), createdAt: row.createdAt };
  }

  async mediaIsPublic(id) {
    const url = `/media/merchant/${id}`;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT EXISTS (SELECT 1 FROM merchant_media mm JOIN merchant_stores s ON s.merchant_id=mm.merchant_id
          JOIN merchant_accounts a ON a.id=s.merchant_id WHERE mm.id=$1 AND s.status='active' AND s.is_published=TRUE
          AND a.status='active' AND a.deleted_at IS NULL AND (s.logo=$2 OR s.cover_image_url=$2 OR EXISTS (
            SELECT 1 FROM merchant_products p WHERE p.store_id=s.id AND p.status='active' AND (p.image_data=$2 OR p.image_urls ? $2)) OR EXISTS (
            SELECT 1 FROM merchant_ad_campaigns c WHERE c.store_id=s.id AND c.status='active' AND c.archived_at IS NULL AND c.image_url=$2 AND c.starts_at<=NOW() AND c.ends_at>NOW()))) AS public`, [id, url]);
      return rows[0]?.public === true;
    }
    const media = this.base.state.merchantMedia.find((item) => item.id === id);
    if (!media) return false;
    const store = this.base.state.merchantStores.find((item) => item.merchantId === media.merchantId && item.status === 'active' && item.isPublished);
    const merchant = this.base.state.merchants.find((item) => item.id === media.merchantId && item.status === 'active' && !item.deletedAt);
    if (!store || !merchant) return false;
    if (store.logo === url || store.coverImageUrl === url) return true;
    return this.base.state.merchantProducts.some((item) => item.storeId === store.id && item.status === 'active' &&
      (item.imageData === url || (item.imageUrls || []).includes(url))) || this.base.state.merchantAdCampaigns.some((item) => item.storeId === store.id && item.status === 'active' && !item.archivedAt && item.imageUrl === url && Date.parse(item.startsAt) <= Date.now() && Date.parse(item.endsAt) > Date.now());
  }

  async deleteUnusedMedia(id, merchantId) {
    const media = await this.getMedia(id);
    if (!media || media.merchantId !== merchantId) return { deleted: false, found: false };
    const url = `/media/merchant/${id}`;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT EXISTS (SELECT 1 FROM merchant_stores WHERE merchant_id=$1 AND (logo=$2 OR cover_image_url=$2)) OR
          EXISTS (SELECT 1 FROM merchant_products p JOIN merchant_stores s ON s.id=p.store_id WHERE s.merchant_id=$1 AND
            (p.image_data=$2 OR p.image_urls ? $2)) OR
          EXISTS (SELECT 1 FROM merchant_order_items i JOIN merchant_orders o ON o.id=i.order_id WHERE o.merchant_id=$1 AND i.image_data=$2) OR
          EXISTS (SELECT 1 FROM merchant_ad_campaigns c JOIN merchant_stores s ON s.id=c.store_id WHERE s.merchant_id=$1 AND c.image_url=$2) AS used`, [merchantId, url]);
      if (rows[0]?.used) return { deleted: false, found: true, inUse: true };
      await this.base.pool.query('DELETE FROM merchant_media WHERE id=$1 AND merchant_id=$2', [id, merchantId]);
      return { deleted: true, found: true, inUse: false };
    }
    const store = this.base.state.merchantStores.find((row) => row.merchantId === merchantId);
    const used = (store && (store.logo === url || store.coverImageUrl === url || this.base.state.merchantProducts.some((product) => product.storeId === store.id && (product.imageData === url || (product.imageUrls || []).includes(url))))) ||
      this.base.state.merchantOrders.some((order) => order.merchantId === merchantId && (order.items || []).some((item) => item.imageData === url || (item.imageUrls || []).includes(url))) ||
      this.base.state.merchantAdCampaigns.some((campaign) => campaign.merchantId === merchantId && campaign.imageUrl === url);
    if (used) return { deleted: false, found: true, inUse: true };
    this.base.state.merchantMedia = this.base.state.merchantMedia.filter((row) => row.id !== id); await this.base.save();
    return { deleted: true, found: true, inUse: false };
  }

  async listNotifications(merchantId, { limit = 50 } = {}) {
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));
    if (this.pg) {
      const [rows, count] = await Promise.all([
        this.base.pool.query('SELECT id, merchant_id AS "merchantId", order_id AS "orderId", notification_type AS type, title, message, data, created_at AS "createdAt", read_at AS "readAt" FROM merchant_notifications WHERE merchant_id=$1 ORDER BY created_at DESC LIMIT $2', [merchantId, safeLimit]),
        this.base.pool.query('SELECT COUNT(*)::int AS count FROM merchant_notifications WHERE merchant_id=$1 AND read_at IS NULL', [merchantId]),
      ]);
      return { data: rows.rows, unreadCount: Number(count.rows[0]?.count) || 0 };
    }
    const rows = this.base.state.merchantNotifications.filter((row) => row.merchantId === merchantId).sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return { data: clone(rows.slice(0, safeLimit)), unreadCount: rows.filter((row) => !row.readAt).length };
  }

  async addNotification({ merchantId, orderId = null, type = 'info', dedupeKey, title, message = '', data = {} }) {
    const id = uniqueId();
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO merchant_notifications (id, merchant_id, order_id, notification_type, dedupe_key, title, message, data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (merchant_id,dedupe_key) DO NOTHING RETURNING id`,
        [id, merchantId, orderId, type, dedupeKey, title, message, JSON.stringify(data)]);
      return Boolean(rows[0]);
    }
    if (this.base.state.merchantNotifications.some((row) => row.merchantId === merchantId && row.dedupeKey === dedupeKey)) return false;
    this.base.state.merchantNotifications.push({ id, merchantId, orderId, type, dedupeKey, title, message, data: clone(data), createdAt: new Date().toISOString(), readAt: null });
    await this.base.save(); return true;
  }

  async markNotificationRead(merchantId, id) {
    const now = new Date().toISOString();
    if (this.pg) {
      const { rows } = await this.base.pool.query('UPDATE merchant_notifications SET read_at=COALESCE(read_at,NOW()) WHERE id=$1 AND merchant_id=$2 RETURNING id', [id, merchantId]);
      return Boolean(rows[0]);
    }
    const row = this.base.state.merchantNotifications.find((item) => item.id === id && item.merchantId === merchantId);
    if (!row) return false; row.readAt ||= now; await this.base.save(); return true;
  }

  async markOrderNotificationsRead(merchantId, orderIds) {
    const ids = [...new Set((Array.isArray(orderIds) ? orderIds : []).map(String).filter(Boolean))].slice(0, 100);
    if (!ids.length) return 0;
    const now = new Date().toISOString();
    if (this.pg) {
      const { rowCount } = await this.base.pool.query('UPDATE merchant_notifications SET read_at=NOW() WHERE merchant_id=$1 AND order_id=ANY($2::text[]) AND read_at IS NULL', [merchantId, ids]);
      return rowCount || 0;
    }
    let count = 0;
    for (const row of this.base.state.merchantNotifications) if (row.merchantId === merchantId && ids.includes(row.orderId) && !row.readAt) { row.readAt = now; count += 1; }
    if (count) await this.base.save(); return count;
  }

  _safeCustomerBlock(row) {
    if (!row) return null;
    const asArray = (value) => Array.isArray(value) ? value : typeof value === 'string' ? (() => { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch (_) { return []; } })() : [];
    const last4 = String(row.phoneLast4 ?? row.phone_last4 ?? '').replace(/\D/g, '').slice(-4);
    return {
      id: row.id,
      storeId: row.storeId ?? row.store_id,
      merchantId: row.merchantId ?? row.merchant_id,
      storeName: row.storeName ?? row.store_name ?? '',
      merchantDisplayName: row.merchantDisplayName ?? row.merchant_display_name ?? '',
      merchantUsername: row.merchantUsername ?? row.merchant_username ?? '',
      phoneLast4: last4,
      phoneMasked: last4 ? `•••• ${last4}` : '••••',
      reason: row.reason || '',
      status: row.status,
      createdByType: row.createdByType ?? row.created_by_type ?? '',
      createdAt: row.createdAt ?? row.created_at,
      updatedAt: row.updatedAt ?? row.updated_at,
      unblockedAt: row.unblockedAt ?? row.unblocked_at ?? null,
      unblockedByType: row.unblockedByType ?? row.unblocked_by_type ?? '',
      unblockReason: row.unblockReason ?? row.unblock_reason ?? '',
      attemptCount: Number(row.attemptCount ?? row.attempt_count) || 0,
      lastAttemptAt: row.lastAttemptAt ?? row.last_attempt_at ?? null,
      history: asArray(row.history).map((event) => ({ eventType: event.eventType ?? event.event_type ?? '',
        reason: event.reason || '', actorType: event.actorType ?? event.actor_type ?? '', createdAt: event.createdAt ?? event.created_at ?? null })),
      recentAttempts: asArray(row.recentAttempts ?? row.recent_attempts).map((attempt) => ({ attemptedAt: attempt.attemptedAt ?? attempt.attempted_at ?? null })),
    };
  }

  async listCustomerBlocks({ merchantId = '', storeId = '', status = '', search = '', blockId = '', page = 1, limit = 50 } = {}) {
    const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
    const safeLimit = Math.min(100, Math.max(1, Number.parseInt(limit, 10) || 50));
    const term = String(search || '').trim().toLocaleLowerCase('fr');
    if (this.pg) {
      const pattern = `%${String(search || '').trim()}%`;
      const params = [merchantId, storeId, status, blockId, String(search || '').trim(), pattern];
      const where = `($1='' OR b.merchant_id=$1) AND ($2='' OR b.store_id=$2) AND ($3='' OR b.status=$3) AND ($4='' OR b.id=$4)
        AND ($5='' OR b.phone_last4 LIKE $6 OR b.reason ILIKE $6 OR s.name ILIKE $6 OR m.display_name ILIKE $6 OR m.username ILIKE $6)`;
      const count = await this.base.pool.query(`SELECT COUNT(*)::int AS total FROM merchant_customer_blocks b
        JOIN merchant_stores s ON s.id=b.store_id JOIN merchant_accounts m ON m.id=b.merchant_id WHERE ${where}`, params);
      const result = await this.base.pool.query(
        `SELECT b.id,b.store_id AS "storeId",b.merchant_id AS "merchantId",s.name AS "storeName",
          m.display_name AS "merchantDisplayName",m.username AS "merchantUsername",b.phone_last4 AS "phoneLast4",b.reason,b.status,
          b.created_by_type AS "createdByType",b.created_at AS "createdAt",b.updated_at AS "updatedAt",b.unblocked_at AS "unblockedAt",
          b.unblocked_by_type AS "unblockedByType",b.unblock_reason AS "unblockReason",
          (SELECT COUNT(*)::int FROM merchant_customer_block_attempts a WHERE a.block_id=b.id) AS "attemptCount",
          (SELECT MAX(a.attempted_at) FROM merchant_customer_block_attempts a WHERE a.block_id=b.id) AS "lastAttemptAt",
          COALESCE((SELECT json_agg(json_build_object('eventType',e.event_type,'reason',e.reason,'actorType',e.actor_type,'createdAt',e.created_at) ORDER BY e.created_at)
            FROM merchant_customer_block_events e WHERE e.block_id=b.id),'[]'::json) AS history,
          COALESCE((SELECT json_agg(json_build_object('attemptedAt',recent.attempted_at) ORDER BY recent.attempted_at DESC)
            FROM (SELECT a.attempted_at FROM merchant_customer_block_attempts a WHERE a.block_id=b.id ORDER BY a.attempted_at DESC LIMIT 10) recent),'[]'::json) AS "recentAttempts"
         FROM merchant_customer_blocks b JOIN merchant_stores s ON s.id=b.store_id JOIN merchant_accounts m ON m.id=b.merchant_id
         WHERE ${where} ORDER BY b.created_at DESC LIMIT $7 OFFSET $8`, [...params, safeLimit, (safePage - 1) * safeLimit]);
      return { data: result.rows.map((row) => this._safeCustomerBlock(row)), total: Number(count.rows[0]?.total) || 0, page: safePage, limit: safeLimit };
    }
    let rows = this.base.state.merchantCustomerBlocks.slice();
    if (merchantId) rows = rows.filter((row) => row.merchantId === merchantId);
    if (storeId) rows = rows.filter((row) => row.storeId === storeId);
    if (status) rows = rows.filter((row) => row.status === status);
    if (blockId) rows = rows.filter((row) => row.id === blockId);
    if (term) rows = rows.filter((row) => {
      const store = this.base.state.merchantStores.find((item) => item.id === row.storeId);
      const merchant = this.base.state.merchants.find((item) => item.id === row.merchantId);
      return [row.phoneLast4, row.reason, store?.name, merchant?.displayName, merchant?.username].some((value) => String(value || '').toLocaleLowerCase('fr').includes(term));
    });
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = rows.length;
    const data = rows.slice((safePage - 1) * safeLimit, safePage * safeLimit).map((row) => {
      const attempts = this.base.state.merchantCustomerBlockAttempts.filter((item) => item.blockId === row.id).sort((a, b) => String(b.attemptedAt).localeCompare(String(a.attemptedAt)));
      const events = this.base.state.merchantCustomerBlockEvents.filter((item) => item.blockId === row.id).sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
      const store = this.base.state.merchantStores.find((item) => item.id === row.storeId);
      const merchant = this.base.state.merchants.find((item) => item.id === row.merchantId);
      return this._safeCustomerBlock({ ...row, storeName: store?.name || '', merchantDisplayName: merchant?.displayName || '', merchantUsername: merchant?.username || '',
        attemptCount: attempts.length, lastAttemptAt: attempts[0]?.attemptedAt || null, history: events, recentAttempts: attempts.slice(0, 10) });
    });
    return { data, total, page: safePage, limit: safeLimit };
  }

  async createCustomerBlock({ storeId, merchantId, phoneHash, phoneLast4, reason, actorType = 'merchant', actorId = '' }) {
    const hash = String(phoneHash || '');
    const last4 = String(phoneLast4 || '').replace(/\D/g, '').slice(-4);
    const note = String(reason || '').trim().replace(/[\t\n\r ]+/gu, ' ').slice(0, 300);
    if (!/^[a-f0-9]{64}$/i.test(hash) || last4.length !== 4 || note.length < 4) throw new Error('Téléphone ou motif de blocage invalide.');
    const id = uniqueId(); const now = new Date().toISOString();
    if (this.pg) {
      let outcome;
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const store = await client.query('SELECT id FROM merchant_stores WHERE id=$1 AND merchant_id=$2 FOR UPDATE', [storeId, merchantId]);
        if (!store.rows[0]) { const error = new Error('Boutique introuvable.'); error.code = 'NOT_FOUND'; throw error; }
        const existing = await client.query(`SELECT id FROM merchant_customer_blocks WHERE store_id=$1 AND phone_hash=$2 AND status='active' FOR UPDATE`, [storeId, hash]);
        if (existing.rows[0]) outcome = { id: existing.rows[0].id, idempotent: true };
        else {
          await client.query(`INSERT INTO merchant_customer_blocks (id,store_id,merchant_id,phone_hash,phone_last4,reason,status,created_by_type,created_by)
            VALUES ($1,$2,$3,$4,$5,$6,'active',$7,$8)`, [id, storeId, merchantId, hash, last4, note, actorType, actorId]);
          await client.query(`INSERT INTO merchant_customer_block_events (id,block_id,event_type,reason,actor_type,actor_id) VALUES ($1,$2,'blocked',$3,$4,$5)`, [uniqueId(), id, note, actorType, actorId]);
          outcome = { id, idempotent: false };
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505' && String(error.constraint || '').includes('merchant_customer_blocks_active_phone_idx')) {
          const existing = await this.base.pool.query(`SELECT id FROM merchant_customer_blocks WHERE store_id=$1 AND phone_hash=$2 AND status='active'`, [storeId, hash]);
          if (existing.rows[0]) outcome = { id: existing.rows[0].id, idempotent: true }; else throw error;
        } else throw error;
      } finally { client.release(); }
      const result = await this.listCustomerBlocks({ blockId: outcome.id, limit: 1 });
      return { block: result.data[0] || null, idempotent: outcome.idempotent };
    }
    return this.withJsonLock(async () => {
      const store = this.base.state.merchantStores.find((row) => row.id === storeId && row.merchantId === merchantId);
      if (!store) { const error = new Error('Boutique introuvable.'); error.code = 'NOT_FOUND'; throw error; }
      const existing = this.base.state.merchantCustomerBlocks.find((row) => row.storeId === storeId && row.phoneHash === hash && row.status === 'active');
      if (existing) {
        const result = await this.listCustomerBlocks({ blockId: existing.id, limit: 1 });
        return { block: result.data[0] || null, idempotent: true };
      }
      const row = { id, storeId, merchantId, phoneHash: hash, phoneLast4: last4, reason: note, status: 'active', createdByType: actorType,
        createdBy: actorId, createdAt: now, updatedAt: now, unblockedAt: null, unblockedByType: '', unblockedBy: '', unblockReason: '' };
      this.base.state.merchantCustomerBlocks.push(row);
      this.base.state.merchantCustomerBlockEvents.push({ id: uniqueId(), blockId: id, eventType: 'blocked', reason: note, actorType, actorId, createdAt: now });
      await this.base.save();
      const result = await this.listCustomerBlocks({ blockId: id, limit: 1 });
      return { block: result.data[0] || null, idempotent: false };
    });
  }

  async unblockCustomerBlock(blockId, { storeId = '', actorType = 'merchant', actorId = '', reason = '' } = {}) {
    const note = String(reason || '').trim().replace(/[\t\n\r ]+/gu, ' ').slice(0, 300);
    if (note && note.length < 4) throw new Error('Le motif de déblocage doit contenir au moins 4 caractères ou rester vide.');
    if (this.pg) {
      let outcome;
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query(`SELECT b.id,b.store_id AS "storeId",b.merchant_id AS "merchantId",b.status FROM merchant_customer_blocks b
          JOIN merchant_stores s ON s.id=b.store_id WHERE b.id=$1 AND ($2='' OR b.store_id=$2) FOR UPDATE OF s,b`, [blockId, storeId]);
        const row = found.rows[0];
        if (!row) { await client.query('COMMIT'); return null; }
        if (row.status === 'unblocked') outcome = { id: row.id, merchantId: row.merchantId, idempotent: true };
        else {
          await client.query(`UPDATE merchant_customer_blocks SET status='unblocked',updated_at=NOW(),unblocked_at=NOW(),unblocked_by_type=$2,unblocked_by=$3,unblock_reason=$4 WHERE id=$1`, [blockId, actorType, actorId, note]);
          await client.query(`INSERT INTO merchant_customer_block_events (id,block_id,event_type,reason,actor_type,actor_id) VALUES ($1,$2,'unblocked',$3,$4,$5)`, [uniqueId(), blockId, note, actorType, actorId]);
          outcome = { id: row.id, merchantId: row.merchantId, idempotent: false };
        }
        await client.query('COMMIT');
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
      const result = await this.listCustomerBlocks({ blockId: outcome.id, limit: 1 });
      return { block: result.data[0] || null, merchantId: outcome.merchantId, idempotent: outcome.idempotent };
    }
    return this.withJsonLock(async () => {
      const row = this.base.state.merchantCustomerBlocks.find((item) => item.id === blockId && (!storeId || item.storeId === storeId));
      if (!row) return null;
      if (row.status === 'unblocked') {
        const result = await this.listCustomerBlocks({ blockId: row.id, limit: 1 });
        return { block: result.data[0] || null, merchantId: row.merchantId, idempotent: true };
      }
      const now = new Date().toISOString(); row.status = 'unblocked'; row.updatedAt = now; row.unblockedAt = now;
      row.unblockedByType = actorType; row.unblockedBy = actorId; row.unblockReason = note;
      this.base.state.merchantCustomerBlockEvents.push({ id: uniqueId(), blockId: row.id, eventType: 'unblocked', reason: note, actorType, actorId, createdAt: now });
      await this.base.save();
      const result = await this.listCustomerBlocks({ blockId: row.id, limit: 1 });
      return { block: result.data[0] || null, merchantId: row.merchantId, idempotent: false };
    });
  }

  async savePushSubscription(merchantId, subscription) {
    const endpoint = String(subscription?.endpoint || '');
    if (!endpoint || endpoint.length > 2000 || !/^https:\/\//i.test(endpoint)) throw new Error('Abonnement push invalide.');
    if (this.pg) {
      await this.base.pool.query(
        `INSERT INTO merchant_push_subscriptions (id,merchant_id,endpoint,subscription) VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (endpoint) DO UPDATE SET merchant_id=EXCLUDED.merchant_id, subscription=EXCLUDED.subscription, updated_at=NOW()`,
        [uniqueId(), merchantId, endpoint, JSON.stringify(subscription)]); return;
    }
    const row = this.base.state.merchantPushSubscriptions.find((item) => item.endpoint === endpoint);
    if (row) { row.merchantId = merchantId; row.subscription = clone(subscription); row.updatedAt = new Date().toISOString(); }
    else this.base.state.merchantPushSubscriptions.push({ id: uniqueId(), merchantId, endpoint, subscription: clone(subscription), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await this.base.save();
  }

  async removePushSubscription(merchantId, endpoint = '') {
    if (this.pg) {
      if (endpoint) await this.base.pool.query('DELETE FROM merchant_push_subscriptions WHERE merchant_id=$1 AND endpoint=$2', [merchantId, endpoint]);
      else await this.base.pool.query('DELETE FROM merchant_push_subscriptions WHERE merchant_id=$1', [merchantId]); return;
    }
    this.base.state.merchantPushSubscriptions = this.base.state.merchantPushSubscriptions.filter((item) => item.merchantId !== merchantId || (endpoint && item.endpoint !== endpoint));
    await this.base.save();
  }

  async listPushSubscriptions(merchantId) {
    if (this.pg) { const { rows } = await this.base.pool.query('SELECT id, endpoint, subscription FROM merchant_push_subscriptions WHERE merchant_id=$1', [merchantId]); return rows; }
    return clone(this.base.state.merchantPushSubscriptions.filter((item) => item.merchantId === merchantId));
  }

  async createMerchant(data) {
    if (this.pg) {
      try {
        const { rows } = await this.base.pool.query(
          `INSERT INTO merchant_accounts (id, username, display_name, email, phone, password_hash, manager_id,
             must_change_password, password_reset_expires_at)
           VALUES ($1, LOWER($2), $3, $4, $5, $6, $7, TRUE, $8::timestamptz) RETURNING id`,
          [uniqueId(), data.username, data.displayName, data.email || '', data.phone || '', data.passwordHash, data.managerId || null, data.passwordExpiresAt],
        );
        return this.getMerchant(rows[0].id);
      } catch (error) {
        if (error.code === '23505') { const duplicate = new Error('Cet identifiant marchand est déjà utilisé.'); duplicate.code = 'DUPLICATE'; throw duplicate; }
        throw error;
      }
    }
    const username = String(data.username || '').trim().toLowerCase();
    if (this.base.state.merchants.some((row) => !row.deletedAt && row.username.toLowerCase() === username)) {
      const error = new Error('Cet identifiant marchand est déjà utilisé.'); error.code = 'DUPLICATE'; throw error;
    }
    const now = new Date().toISOString();
    const row = { id: uniqueId(), username, displayName: data.displayName, email: data.email || '', phone: data.phone || '', passwordHash: data.passwordHash,
      status: 'active', statusReason: '', managerId: data.managerId || null, mustChangePassword: true, passwordResetTokenHash: '',
      passwordResetExpiresAt: data.passwordExpiresAt, tokenVersion: 1, createdAt: now, updatedAt: now, lastLoginAt: null, deletedAt: null };
    this.base.state.merchants.push(row); await this.base.save(); return withoutSecrets(row);
  }

  async getMerchant(id, { includeDeleted = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, username, display_name AS "displayName", email, phone, status, status_reason AS "statusReason", manager_id AS "managerId",
          must_change_password AS "mustChangePassword", password_reset_expires_at AS "passwordResetExpiresAt", token_version AS "tokenVersion",
          created_at AS "createdAt", updated_at AS "updatedAt", last_login_at AS "lastLoginAt", deleted_at AS "deletedAt"
         FROM merchant_accounts WHERE id=$1 AND ($2::boolean OR deleted_at IS NULL)`, [id, includeDeleted]);
      return rows[0] || null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && (includeDeleted || !item.deletedAt));
    return withoutSecrets(row);
  }

  async getMerchantForAuth(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, username, display_name AS "displayName", email, phone, status, status_reason AS "statusReason", manager_id AS "managerId",
          password_hash AS "passwordHash", must_change_password AS "mustChangePassword", password_reset_expires_at AS "passwordResetExpiresAt",
          token_version AS "tokenVersion", created_at AS "createdAt", updated_at AS "updatedAt", deleted_at AS "deletedAt"
         FROM merchant_accounts WHERE id=$1`, [id]);
      return rows[0] || null;
    }
    return clone(this.base.state.merchants.find((row) => row.id === id) || null);
  }

  async getMerchantByUsername(username) {
    const key = String(username || '').trim().toLowerCase();
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id FROM merchant_accounts WHERE LOWER(username)=LOWER($1) AND deleted_at IS NULL', [key]);
      return rows[0] ? this.getMerchantForAuth(rows[0].id) : null;
    }
    const row = this.base.state.merchants.find((item) => !item.deletedAt && item.username.toLowerCase() === key);
    return clone(row || null);
  }

  async listMerchants({ managerId = '', includeDeleted = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT m.id, m.username, m.display_name AS "displayName", m.email, m.phone, m.status, m.status_reason AS "statusReason",
          m.manager_id AS "managerId", m.must_change_password AS "mustChangePassword", m.password_reset_expires_at AS "passwordResetExpiresAt",
          m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.last_login_at AS "lastLoginAt", m.deleted_at AS "deletedAt",
          s.id AS "storeId", s.slug AS "storeSlug", s.name AS "storeName", s.status AS "storeStatus", s.is_published AS "storePublished",
          s.qr_public_code AS "qrPublicCode", (s.qr_public_code IS NOT NULL AND s.qr_enabled) AS "qrEnabled", s.qr_scan_count AS "qrScanCount",
          (SELECT COUNT(*)::int FROM merchant_products p WHERE p.store_id=s.id AND p.status<>'archived') AS "productCount",
          (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.store_id=s.id) AS "orderCount"
         FROM merchant_accounts m LEFT JOIN merchant_stores s ON s.merchant_id=m.id
         WHERE ($2::boolean OR m.deleted_at IS NULL) AND ($1='' OR (m.deleted_at IS NULL AND (m.manager_id=$1 OR EXISTS (
           SELECT 1 FROM merchant_manager_assignments a WHERE a.merchant_id=m.id AND a.manager_id=$1 AND
             (a.can_manage_store OR a.can_manage_products OR a.can_manage_orders OR a.can_create_store_qr OR a.can_view_audit)))))
         ORDER BY m.created_at DESC`, [managerId, includeDeleted]);
      return rows;
    }
    let rows = this.base.state.merchants.filter((item) => includeDeleted || !item.deletedAt);
    if (managerId) {
      const assigned = new Set(this.base.state.merchantAssignments.filter((a) => a.managerId === managerId &&
        (a.canManageStore || a.canManageProducts || a.canManageOrders || a.canCreateStoreQr || a.canViewAudit)).map((a) => a.merchantId));
      rows = rows.filter((row) => row.managerId === managerId || assigned.has(row.id));
    }
    return rows.map((row) => {
      const store = this.base.state.merchantStores.find((s) => s.merchantId === row.id);
      const products = this.base.state.merchantProducts.filter((p) => p.storeId === store?.id && p.status !== 'archived');
      const orders = this.base.state.merchantOrders.filter((o) => o.storeId === store?.id);
      return { ...withoutSecrets(row), storeId: store?.id || '', storeSlug: store?.slug || '', storeName: store?.name || '', storeStatus: store?.status || '',
        storePublished: Boolean(store?.isPublished), qrPublicCode: store?.qrPublicCode || '',
        qrEnabled: Boolean(store?.qrPublicCode && store.qrEnabled !== false), qrScanCount: Number(store?.qrScanCount) || 0,
        productCount: products.length, orderCount: orders.length };
    }).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  async updateMerchant(id, data) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET display_name=$2, email=$3, phone=$4, manager_id=$5, status=$6,
          status_reason=$7, token_version=token_version+1, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING id`,
        [id, data.displayName, data.email || '', data.phone || '', data.managerId || null, data.status || 'active', data.statusReason || '']);
      return rows[0] ? this.getMerchant(id) : null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    Object.assign(row, { displayName: data.displayName, email: data.email || '', phone: data.phone || '', managerId: data.managerId || null,
      status: data.status || 'active', statusReason: data.statusReason || '', tokenVersion: (Number(row.tokenVersion) || 0) + 1, updatedAt: new Date().toISOString() });
    await this.base.save(); return withoutSecrets(row);
  }

  async archiveMerchant(id, reason = 'Compte archivé par le PDG.') {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET deleted_at=COALESCE(deleted_at,NOW()), status='blocked', status_reason=$2,
          token_version=token_version+1, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, String(reason || '').slice(0, 500)]);
      return rows[0] ? this.getMerchant(id, { includeDeleted: true }) : this.getMerchant(id, { includeDeleted: true });
    }
    return this.withJsonLock(async () => {
      const row = this.base.state.merchants.find((item) => item.id === id);
      if (!row) return null;
      if (!row.deletedAt) Object.assign(row, { deletedAt: new Date().toISOString(), status: 'blocked', statusReason: String(reason || '').slice(0, 500),
        tokenVersion: (Number(row.tokenVersion) || 0) + 1, updatedAt: new Date().toISOString() });
      await this.base.save(); return withoutSecrets(row);
    });
  }

  async restoreMerchant(id) {
    if (this.pg) {
      try {
        const { rows } = await this.base.pool.query(
          `UPDATE merchant_accounts SET deleted_at=NULL, status='active', status_reason='', token_version=token_version+1, updated_at=NOW()
           WHERE id=$1 AND deleted_at IS NOT NULL RETURNING id`, [id]);
        return rows[0] ? this.getMerchant(id) : this.getMerchant(id, { includeDeleted: true });
      } catch (error) {
        if (error.code === '23505') { const duplicate = new Error('Impossible de restaurer ce compte : cet identifiant est utilisé par un autre compte actif.'); duplicate.code = 'DUPLICATE'; throw duplicate; }
        throw error;
      }
    }
    return this.withJsonLock(async () => {
      const row = this.base.state.merchants.find((item) => item.id === id);
      if (!row) return null;
      if (!row.deletedAt) return withoutSecrets(row);
      if (this.base.state.merchants.some((item) => item.id !== id && !item.deletedAt && item.username.toLowerCase() === row.username.toLowerCase())) {
        const error = new Error('Impossible de restaurer ce compte : cet identifiant est utilisé par un autre compte actif.'); error.code = 'DUPLICATE'; throw error;
      }
      Object.assign(row, { deletedAt: null, status: 'active', statusReason: '', tokenVersion: (Number(row.tokenVersion) || 0) + 1, updatedAt: new Date().toISOString() });
      await this.base.save(); return withoutSecrets(row);
    });
  }

  async setMerchantTemporaryPassword(id, passwordHash, expiresAt) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET password_hash=$2, must_change_password=TRUE, password_reset_token_hash='',
          password_reset_expires_at=$3::timestamptz, token_version=token_version+1, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, passwordHash, expiresAt]);
      return rows[0] ? this.getMerchant(id) : null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.passwordHash = passwordHash; row.mustChangePassword = true; row.passwordResetTokenHash = ''; row.passwordResetExpiresAt = expiresAt;
    row.tokenVersion = (Number(row.tokenVersion) || 0) + 1; row.updatedAt = new Date().toISOString(); await this.base.save(); return withoutSecrets(row);
  }

  async changeMerchantPassword(id, passwordHash) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET password_hash=$2, must_change_password=FALSE, password_reset_expires_at=NULL,
          password_reset_token_hash='', password_reset_requested_at=NULL, token_version=token_version+1, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, passwordHash]);
      return rows[0] ? this.getMerchantForAuth(id) : null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.passwordHash = passwordHash; row.mustChangePassword = false; row.passwordResetExpiresAt = null;
    row.passwordResetTokenHash = ''; row.passwordResetRequestedAt = null;
    row.tokenVersion = (Number(row.tokenVersion) || 0) + 1; row.updatedAt = new Date().toISOString(); await this.base.save(); return clone(row);
  }

  /** Self-service reset: the merchant asks for a link, the PDG/manager authorises it and receives a one-time token. */
  async requestMerchantPasswordReset(id, { ipHash = '', requestedAt = new Date().toISOString() } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET password_reset_requested_at=$2::timestamptz, password_reset_request_ip_hash=$3, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING id, password_reset_requested_at AS "passwordResetRequestedAt"`, [id, requestedAt, ipHash]);
      return rows[0] || null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.passwordResetRequestedAt = requestedAt; row.passwordResetRequestIpHash = ipHash; row.updatedAt = new Date().toISOString();
    await this.base.save(); return { id: row.id, passwordResetRequestedAt: requestedAt };
  }

  async listMerchantPasswordResetRequests() {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, username, display_name AS "displayName", manager_id AS "managerId", password_reset_requested_at AS "passwordResetRequestedAt"
         FROM merchant_accounts WHERE deleted_at IS NULL AND password_reset_requested_at IS NOT NULL ORDER BY password_reset_requested_at DESC LIMIT 200`);
      return rows;
    }
    return this.base.state.merchants.filter((row) => !row.deletedAt && row.passwordResetRequestedAt)
      .map((row) => ({ id: row.id, username: row.username, displayName: row.displayName, managerId: row.managerId || null, passwordResetRequestedAt: row.passwordResetRequestedAt }))
      .sort((a, b) => String(b.passwordResetRequestedAt).localeCompare(String(a.passwordResetRequestedAt)));
  }

  async setMerchantPasswordResetLink(id, passwordHash, tokenHash, expiresAt) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET password_hash=$2, must_change_password=TRUE, password_reset_token_hash=$3, password_reset_expires_at=$4::timestamptz,
          password_reset_requested_at=NULL, token_version=token_version+1, updated_at=NOW()
         WHERE id=$1 AND deleted_at IS NULL RETURNING id`, [id, passwordHash, tokenHash, expiresAt]);
      return rows[0] ? this.getMerchant(id) : null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.passwordHash = passwordHash; row.mustChangePassword = true; row.passwordResetTokenHash = tokenHash; row.passwordResetExpiresAt = expiresAt;
    row.passwordResetRequestedAt = null; row.tokenVersion = (Number(row.tokenVersion) || 0) + 1; row.updatedAt = new Date().toISOString();
    await this.base.save(); return withoutSecrets(row);
  }

  async getMerchantByResetTokenHash(tokenHash) {
    if (!tokenHash) return null;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, username, display_name AS "displayName", status, manager_id AS "managerId", password_reset_expires_at AS "passwordResetExpiresAt"
         FROM merchant_accounts WHERE password_reset_token_hash=$1 AND deleted_at IS NULL`, [tokenHash]);
      return rows[0] || null;
    }
    const row = this.base.state.merchants.find((item) => item.passwordResetTokenHash && item.passwordResetTokenHash === tokenHash && !item.deletedAt);
    return row ? { id: row.id, username: row.username, displayName: row.displayName, status: row.status, managerId: row.managerId || null, passwordResetExpiresAt: row.passwordResetExpiresAt } : null;
  }

  async completeMerchantPasswordResetByToken(tokenHash, passwordHash) {
    if (!tokenHash) return null;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_accounts SET password_hash=$2, must_change_password=FALSE, password_reset_token_hash='', password_reset_expires_at=NULL,
          token_version=token_version+1, updated_at=NOW()
         WHERE password_reset_token_hash=$1 AND password_reset_expires_at > NOW() AND deleted_at IS NULL RETURNING id`, [tokenHash, passwordHash]);
      return rows[0] ? this.getMerchantForAuth(rows[0].id) : null;
    }
    const row = this.base.state.merchants.find((item) => item.passwordResetTokenHash && item.passwordResetTokenHash === tokenHash && !item.deletedAt);
    if (!row) return null;
    const expires = row.passwordResetExpiresAt ? new Date(row.passwordResetExpiresAt).getTime() : 0;
    if (!Number.isFinite(expires) || expires <= Date.now()) return null;
    row.passwordHash = passwordHash; row.mustChangePassword = false; row.passwordResetTokenHash = ''; row.passwordResetExpiresAt = null;
    row.tokenVersion = (Number(row.tokenVersion) || 0) + 1; row.updatedAt = new Date().toISOString(); await this.base.save(); return clone(row);
  }

  async markMerchantLogin(id) {
    if (this.pg) {
      await this.base.pool.query('UPDATE merchant_accounts SET last_login_at=NOW(), updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL', [id]);
      return this.getMerchant(id);
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt);
    if (!row) return null;
    row.lastLoginAt = row.updatedAt = new Date().toISOString(); await this.base.save(); return withoutSecrets(row);
  }

  async listAssignments(merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT merchant_id AS "merchantId", manager_id AS "managerId", can_manage_store AS "canManageStore",
          can_manage_products AS "canManageProducts", can_manage_orders AS "canManageOrders", can_create_store_qr AS "canCreateStoreQr",
          can_view_audit AS "canViewAudit" FROM merchant_manager_assignments WHERE merchant_id=$1 ORDER BY manager_id`, [merchantId]);
      return rows;
    }
    return clone(this.base.state.merchantAssignments.filter((a) => a.merchantId === merchantId));
  }

  async getAssignment(managerId, merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT merchant_id AS "merchantId", manager_id AS "managerId", can_manage_store AS "canManageStore",
          can_manage_products AS "canManageProducts", can_manage_orders AS "canManageOrders", can_create_store_qr AS "canCreateStoreQr",
          can_view_audit AS "canViewAudit" FROM merchant_manager_assignments WHERE manager_id=$1 AND merchant_id=$2`, [managerId, merchantId]);
      return rows[0] || null;
    }
    return clone(this.base.state.merchantAssignments.find((a) => a.managerId === managerId && a.merchantId === merchantId) || null);
  }

  async setAssignment(managerId, merchantId, permissions) {
    const values = ['canManageStore', 'canManageProducts', 'canManageOrders', 'canCreateStoreQr', 'canViewAudit'];
    const row = { managerId, merchantId, ...Object.fromEntries(values.map((field) => [field, permissions[field] === true])) };
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `INSERT INTO merchant_manager_assignments (manager_id, merchant_id, can_manage_store, can_manage_products, can_manage_orders, can_create_store_qr, can_view_audit)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (manager_id, merchant_id) DO UPDATE SET
          can_manage_store=EXCLUDED.can_manage_store, can_manage_products=EXCLUDED.can_manage_products,
          can_manage_orders=EXCLUDED.can_manage_orders, can_create_store_qr=EXCLUDED.can_create_store_qr, can_view_audit=EXCLUDED.can_view_audit
         RETURNING merchant_id AS "merchantId", manager_id AS "managerId", can_manage_store AS "canManageStore",
          can_manage_products AS "canManageProducts", can_manage_orders AS "canManageOrders", can_create_store_qr AS "canCreateStoreQr", can_view_audit AS "canViewAudit"`,
        [managerId, merchantId, ...values.map((field) => row[field])]);
      return rows[0];
    }
    const index = this.base.state.merchantAssignments.findIndex((a) => a.managerId === managerId && a.merchantId === merchantId);
    if (index >= 0) this.base.state.merchantAssignments[index] = row; else this.base.state.merchantAssignments.push(row);
    await this.base.save(); return clone(row);
  }

  async removeAssignment(managerId, merchantId) {
    if (this.pg) { await this.base.pool.query('DELETE FROM merchant_manager_assignments WHERE manager_id=$1 AND merchant_id=$2', [managerId, merchantId]); return; }
    this.base.state.merchantAssignments = this.base.state.merchantAssignments.filter((a) => !(a.managerId === managerId && a.merchantId === merchantId)); await this.base.save();
  }

  async createStore(merchantId, data) {
    if (this.pg) {
      try {
        const { rows } = await this.base.pool.query(
          `INSERT INTO merchant_stores (id, merchant_id, slug, name, description, logo, phone, whatsapp, email, address, delivery_note, is_published,
             cover_image_url, theme, opening_hours, delivery_enabled, pickup_enabled, delivery_fee_xof, accepts_orders, sector, require_table_photo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21) RETURNING id`,
          [uniqueId(), merchantId, data.slug, data.name, data.description || '', data.logo || '', data.phone || '', data.whatsapp || '', data.email || '', data.address || '', data.deliveryNote || '', data.isPublished === true,
            data.coverImageUrl || '', JSON.stringify(data.theme || {}), JSON.stringify(data.openingHours || {}), data.deliveryEnabled !== false, data.pickupEnabled !== false, data.deliveryFeeXof || 0, data.acceptsOrders !== false, data.sector || 'general', data.requireTablePhoto === true]);
        return this.getStoreById(rows[0].id);
      } catch (error) {
        if (error.code === '23505') { const duplicate = new Error('Cette adresse de boutique est déjà utilisée ou un magasin existe déjà pour ce compte.'); duplicate.code = 'DUPLICATE'; throw duplicate; }
        throw error;
      }
    }
    if (this.base.state.merchantStores.some((s) => s.merchantId === merchantId || s.slug === data.slug)) {
      const error = new Error('Cette adresse de boutique est déjà utilisée ou un magasin existe déjà pour ce compte.'); error.code = 'DUPLICATE'; throw error;
    }
    const now = new Date().toISOString();
    const row = { id: uniqueId(), merchantId, slug: data.slug, name: data.name, description: data.description || '', logo: data.logo || '', coverImageUrl: data.coverImageUrl || '',
      theme: clone(data.theme || {}), openingHours: clone(data.openingHours || {}), deliveryEnabled: data.deliveryEnabled !== false, pickupEnabled: data.pickupEnabled !== false,
      deliveryFeeXof: Number(data.deliveryFeeXof) || 0, acceptsOrders: data.acceptsOrders !== false, requireTablePhoto: data.requireTablePhoto === true, sector: data.sector || 'general',
      phone: data.phone || '', whatsapp: data.whatsapp || '', email: data.email || '', address: data.address || '', deliveryNote: data.deliveryNote || '',
      status: 'active', isPublished: data.isPublished === true, qrPublicCode: '', qrEnabled: true, qrScanCount: 0, createdAt: now, updatedAt: now };
    this.base.state.merchantStores.push(row); await this.base.save(); return clone(row);
  }

  async getStoreById(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, merchant_id AS "merchantId", slug, name, description, logo, cover_image_url AS "coverImageUrl", theme,
          opening_hours AS "openingHours", delivery_enabled AS "deliveryEnabled", pickup_enabled AS "pickupEnabled", delivery_fee_xof AS "deliveryFeeXof",
          accepts_orders AS "acceptsOrders", require_table_photo AS "requireTablePhoto", phone, whatsapp, email, address, delivery_note AS "deliveryNote", status, is_published AS "isPublished", sector,
          qr_public_code AS "qrPublicCode", qr_enabled AS "qrEnabled", qr_scan_count AS "qrScanCount", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM merchant_stores WHERE id=$1`, [id]);
      return rows[0] || null;
    }
    return clone(this.base.state.merchantStores.find((s) => s.id === id) || null);
  }

  async getStoreByMerchantId(merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id FROM merchant_stores WHERE merchant_id=$1', [merchantId]);
      return rows[0] ? this.getStoreById(rows[0].id) : null;
    }
    return clone(this.base.state.merchantStores.find((s) => s.merchantId === merchantId) || null);
  }

  async updateStore(id, data) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `UPDATE merchant_stores SET name=$2, description=$3, logo=$4, phone=$5, whatsapp=$6, email=$7, address=$8,
          delivery_note=$9, status=$10, is_published=$11, cover_image_url=$12, theme=$13::jsonb, opening_hours=$14::jsonb,
          delivery_enabled=$15, pickup_enabled=$16, delivery_fee_xof=$17, accepts_orders=$18, sector=$19, require_table_photo=$20, updated_at=NOW() WHERE id=$1 RETURNING id`,
        [id, data.name, data.description || '', data.logo || '', data.phone || '', data.whatsapp || '', data.email || '', data.address || '', data.deliveryNote || '', data.status || 'active', data.isPublished === true,
          data.coverImageUrl || '', JSON.stringify(data.theme || {}), JSON.stringify(data.openingHours || {}), data.deliveryEnabled !== false, data.pickupEnabled !== false, data.deliveryFeeXof || 0, data.acceptsOrders !== false, data.sector || 'general', data.requireTablePhoto === true]);
      return rows[0] ? this.getStoreById(id) : null;
    }
    const row = this.base.state.merchantStores.find((s) => s.id === id);
    if (!row) return null;
    Object.assign(row, { name: data.name, description: data.description || '', logo: data.logo || '', coverImageUrl: data.coverImageUrl || '',
      theme: clone(data.theme || {}), openingHours: clone(data.openingHours || {}), deliveryEnabled: data.deliveryEnabled !== false, pickupEnabled: data.pickupEnabled !== false,
      deliveryFeeXof: Number(data.deliveryFeeXof) || 0, acceptsOrders: data.acceptsOrders !== false, requireTablePhoto: data.requireTablePhoto === true, sector: data.sector || 'general',
      phone: data.phone || '', whatsapp: data.whatsapp || '', email: data.email || '', address: data.address || '', deliveryNote: data.deliveryNote || '',
      status: data.status || 'active', isPublished: data.isPublished === true, updatedAt: new Date().toISOString() });
    await this.base.save(); return clone(row);
  }

  async getPublicShopBySlug(slug) {
    const store = this.pg
      ? await this._publicStoreQuery('s.slug=$1', [slug])
      : this.base.state.merchantStores.find((s) => s.slug === slug && s.status === 'active' && s.isPublished);
    if (!store || store.status !== 'active' || !store.isPublished) return null;
    const products = await this.listProducts(store.id, { activeOnly: true });
    const merchant = this.pg ? null : this.base.state.merchants.find((m) => m.id === store.merchantId);
    if (merchant && (merchant.status !== 'active' || merchant.deletedAt)) return null;
    // Order modes are derived from the store settings so the public checkout only offers what exists.
    let activePointCount = 0;
    try {
      if (this.pg) { const { rows } = await this.base.pool.query("SELECT COUNT(*)::int AS count FROM merchant_service_points WHERE store_id=$1 AND status='active'", [store.id]); activePointCount = Number(rows[0]?.count) || 0; }
      else activePointCount = this.base.state.merchantServicePoints.filter((row) => row.storeId === store.id && row.status === 'active').length;
    } catch (_) { activePointCount = 0; }
    const orderModes = { delivery: store.deliveryEnabled !== false, pickup: store.pickupEnabled !== false, dineIn: activePointCount > 0 };
    return { store: { ...this.publicStore(store), orderModes, deliveryFeeXof: Number(store.deliveryFeeXof) || 0 }, products, merchantActive: true };
  }

  async getPublicShopByQr(code) {
    const store = this.pg
      ? await this._publicStoreQuery('s.qr_public_code=$1 AND s.qr_enabled=TRUE', [code])
      : this.base.state.merchantStores.find((s) => s.qrPublicCode === code && s.qrEnabled !== false && s.status === 'active' && s.isPublished);
    if (!store || store.status !== 'active' || !store.isPublished) return null;
    const merchant = this.pg ? null : this.base.state.merchants.find((m) => m.id === store.merchantId);
    if (merchant && (merchant.status !== 'active' || merchant.deletedAt)) return null;
    return { ...this.publicStore(store), merchantId: store.merchantId };
  }

  async _publicStoreQuery(where, params) {
    const { rows } = await this.base.pool.query(
      `SELECT s.id, s.merchant_id AS "merchantId", s.slug, s.name, s.description, s.logo, s.cover_image_url AS "coverImageUrl", s.theme,
        s.opening_hours AS "openingHours", s.delivery_enabled AS "deliveryEnabled", s.pickup_enabled AS "pickupEnabled", s.delivery_fee_xof AS "deliveryFeeXof",
        s.accepts_orders AS "acceptsOrders", s.require_table_photo AS "requireTablePhoto", s.phone, s.whatsapp, s.email, s.address, s.delivery_note AS "deliveryNote", s.status, s.sector,
        s.is_published AS "isPublished", s.qr_public_code AS "qrPublicCode", s.qr_scan_count AS "qrScanCount"
       FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id
       WHERE ${where} AND s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL`, params);
    return rows[0] || null;
  }

  publicStore(store) {
    if (!store) return null;
    const { merchantId, qrPublicCode, qrEnabled, qrScanCount, ...data } = store;
    const hours = typeof data.openingHours === 'string' || typeof data.openingHours === 'number' ? String(data.openingHours)
      : Array.isArray(data.openingHours) ? data.openingHours.filter((row) => typeof row === 'string').join(' · ')
        : data.openingHours && typeof data.openingHours === 'object' ? Object.entries(data.openingHours).filter(([, value]) => typeof value === 'string' || typeof value === 'number').map(([day, value]) => `${day}: ${value}`).join(' · ') : '';
    return clone({ ...data, openingHours: hours });
  }

  async listProducts(storeId, { activeOnly = false } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, store_id AS "storeId", name, description, sku, price_xof AS "priceXof", compare_at_price_xof AS "compareAtPriceXof",
          stock_quantity AS "stockQuantity", track_stock AS "trackStock", image_data AS "imageData", image_urls AS "imageUrls", category,
          variants, status, sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM merchant_products WHERE store_id=$1 AND ($2::boolean=FALSE OR status='active') AND status<>'archived' ORDER BY sort_order, name`, [storeId, activeOnly]);
      return rows.map((row) => this.publicProduct(row));
    }
    return this.base.state.merchantProducts.filter((p) => p.storeId === storeId && p.status !== 'archived' && (!activeOnly || p.status === 'active'))
      .sort((a, b) => Number(a.sortOrder) - Number(b.sortOrder) || a.name.localeCompare(b.name, 'fr')).map((p) => this.publicProduct(p));
  }

  publicProduct(product) {
    const row = clone(product);
    if (!row) return null;
    row.imageUrls = Array.isArray(row.imageUrls) ? row.imageUrls : (row.imageData ? [row.imageData] : []);
    row.imageData = row.imageUrls[0] || row.imageData || '';
    // The first photo of the ordered list is the merchant-selected main image: expose it explicitly.
    row.mainImageUrl = row.imageData;
    row.stockQuantity = Number(row.stockQuantity) || 0;
    row.trackStock = row.trackStock !== false;
    row.variants = Array.isArray(row.variants) ? row.variants : [];
    row.category = row.category || '';
    row.available = row.status === 'active' && (!row.trackStock || Number(row.stockQuantity) > 0);
    return row;
  }

  async getProduct(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, store_id AS "storeId", name, description, sku, price_xof AS "priceXof", compare_at_price_xof AS "compareAtPriceXof",
          stock_quantity AS "stockQuantity", track_stock AS "trackStock", image_data AS "imageData", image_urls AS "imageUrls", category,
          variants, status, sort_order AS "sortOrder", created_at AS "createdAt", updated_at AS "updatedAt" FROM merchant_products WHERE id=$1`, [id]);
      return this.publicProduct(rows[0] || null);
    }
    return this.publicProduct(this.base.state.merchantProducts.find((p) => p.id === id) || null);
  }

  async saveProduct(storeId, data, productId = '') {
    if (this.pg) {
      try {
        if (productId) {
          const { rows } = await this.base.pool.query(
            `UPDATE merchant_products SET name=$3, description=$4, sku=$5, price_xof=$6, stock_quantity=$7, track_stock=$8,
              image_data=$9, image_urls=$10::jsonb, category=$11, compare_at_price_xof=$12, variants=$13::jsonb, status=$14, sort_order=$15, updated_at=NOW()
             WHERE id=$1 AND store_id=$2 RETURNING id`,
            [productId, storeId, data.name, data.description || '', data.sku || '', data.priceXof, data.stockQuantity, data.trackStock === true,
              data.imageData || '', JSON.stringify(data.imageUrls || []), data.category || '', data.compareAtPriceXof || null, JSON.stringify(data.variants || []), data.status || 'active', data.sortOrder || 0]);
          return rows[0] ? this.getProduct(productId) : null;
        }
        const { rows } = await this.base.pool.query(
          `INSERT INTO merchant_products (id, store_id, name, description, sku, price_xof, stock_quantity, track_stock, image_data, image_urls, category, compare_at_price_xof, variants, status, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13::jsonb,$14,$15) RETURNING id`,
          [uniqueId(), storeId, data.name, data.description || '', data.sku || '', data.priceXof, data.stockQuantity, data.trackStock === true,
            data.imageData || '', JSON.stringify(data.imageUrls || []), data.category || '', data.compareAtPriceXof || null, JSON.stringify(data.variants || []), data.status || 'active', data.sortOrder || 0]);
        return this.getProduct(rows[0].id);
      } catch (error) {
        if (error.code === '23505') { const duplicate = new Error('Cette référence produit est déjà utilisée dans la boutique.'); duplicate.code = 'DUPLICATE'; throw duplicate; }
        throw error;
      }
    }
    const rows = this.base.state.merchantProducts;
    if (productId) {
      const row = rows.find((p) => p.id === productId && p.storeId === storeId && p.status !== 'archived');
      if (!row) return null;
      if (data.sku && rows.some((p) => p.storeId === storeId && p.id !== productId && p.status !== 'archived' && p.sku.toLowerCase() === data.sku.toLowerCase())) {
        const error = new Error('Cette référence produit est déjà utilisée dans la boutique.'); error.code = 'DUPLICATE'; throw error;
      }
      Object.assign(row, clone(data), { updatedAt: new Date().toISOString() }); await this.base.save(); return this.publicProduct(row);
    }
    if (data.sku && rows.some((p) => p.storeId === storeId && p.status !== 'archived' && p.sku.toLowerCase() === data.sku.toLowerCase())) {
      const error = new Error('Cette référence produit est déjà utilisée dans la boutique.'); error.code = 'DUPLICATE'; throw error;
    }
    const now = new Date().toISOString();
    const row = { id: uniqueId(), storeId, ...clone(data), createdAt: now, updatedAt: now };
    rows.push(row); await this.base.save(); return this.publicProduct(row);
  }

  async archiveProduct(storeId, productId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query("UPDATE merchant_products SET status='archived', updated_at=NOW() WHERE id=$1 AND store_id=$2 AND status<>'archived' RETURNING id", [productId, storeId]);
      return rows[0] ? this.getProduct(productId) : null;
    }
    const row = this.base.state.merchantProducts.find((p) => p.id === productId && p.storeId === storeId && p.status !== 'archived');
    if (!row) return null;
    row.status = 'archived'; row.updatedAt = new Date().toISOString(); await this.base.save(); return this.publicProduct(row);
  }

  async createStoreQr(storeId) {
    // Kept for existing callers: creating a QR is an activation and remains idempotent.
    return this.setStoreQrEnabled(storeId, true);
  }

  async _ensureStoreQrCode(storeId) {
    if (this.pg) {
      let current = await this.getStoreById(storeId);
      if (!current) return null;
      if (current.qrPublicCode) return { store: current, created: false };
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = crypto.randomBytes(10).toString('base64url');
        try {
          const { rows } = await this.base.pool.query(
            'UPDATE merchant_stores SET qr_public_code=$2, qr_enabled=FALSE, updated_at=NOW() WHERE id=$1 AND qr_public_code IS NULL RETURNING id', [storeId, code]);
          if (rows[0]) return { store: await this.getStoreById(storeId), created: true };
          current = await this.getStoreById(storeId);
          return current ? { store: current, created: false } : null;
        } catch (error) { if (error.code !== '23505') throw error; }
      }
      throw new Error('Impossible de générer un lien QR unique.');
    }
    const store = this.base.state.merchantStores.find((row) => row.id === storeId);
    if (!store) return null;
    if (store.qrPublicCode) return { store: clone(store), created: false };
    let code = crypto.randomBytes(10).toString('base64url');
    while (this.base.state.merchantStores.some((row) => row.qrPublicCode === code)) code = crypto.randomBytes(10).toString('base64url');
    store.qrPublicCode = code; store.updatedAt = new Date().toISOString(); await this.base.save();
    return { store: clone(store), created: true };
  }

  async setStoreQrEnabled(storeId, enabled) {
    const desired = enabled === true;
    if (this.pg) {
      let current = await this.getStoreById(storeId);
      if (!current) return null;
      const wasEnabled = Boolean(current.qrPublicCode && current.qrEnabled !== false);
      let created = false;
      if (desired && !current.qrPublicCode) {
        const provisioned = await this._ensureStoreQrCode(storeId);
        if (!provisioned) return null;
        current = provisioned.store; created = provisioned.created;
      }
      const { rows } = await this.base.pool.query(
        'UPDATE merchant_stores SET qr_enabled=$2, updated_at=NOW() WHERE id=$1 RETURNING id', [storeId, desired]);
      if (!rows[0]) return null;
      const saved = await this.getStoreById(storeId);
      return saved ? { store: saved, created, changed: wasEnabled !== desired } : null;
    }
    return this.withJsonLock(async () => {
      const row = this.base.state.merchantStores.find((item) => item.id === storeId);
      if (!row) return null;
      const wasEnabled = Boolean(row.qrPublicCode && row.qrEnabled !== false);
      const previous = { qrPublicCode: row.qrPublicCode, qrEnabled: row.qrEnabled, updatedAt: row.updatedAt };
      const created = desired && !row.qrPublicCode;
      if (created) {
        let code = crypto.randomBytes(10).toString('base64url');
        while (this.base.state.merchantStores.some((item) => item.qrPublicCode === code)) code = crypto.randomBytes(10).toString('base64url');
        row.qrPublicCode = code;
      }
      row.qrEnabled = desired; row.updatedAt = new Date().toISOString();
      try { await this.base.save(); }
      catch (error) {
        Object.assign(row, previous);
        throw error;
      }
      return { store: clone(row), created, changed: wasEnabled !== (Boolean(row.qrPublicCode) && desired) };
    });
  }

  async recordStoreQrScan(storeId) {
    if (this.pg) {
      await this.base.pool.query('UPDATE merchant_stores SET qr_scan_count=qr_scan_count+1, last_qr_scan_at=NOW() WHERE id=$1', [storeId]); return;
    }
    const row = this.base.state.merchantStores.find((s) => s.id === storeId);
    if (!row) return;
    row.qrScanCount = (Number(row.qrScanCount) || 0) + 1; row.lastQrScanAt = new Date().toISOString();
    this.base.state.merchantQrScans.push({ storeId, scannedAt: row.lastQrScanAt }); await this.base.save();
  }

  async createOrder(data) {
    if (!REQUEST_ID_RE.test(String(data.clientRequestId || ''))) throw new Error('Identifiant de commande invalide. Réessayez depuis le panier.');
    const source = data.source === 'merchant_assisted' ? 'merchant_assisted' : 'customer_qr';
    const orderType = ['dine_in','pickup','delivery','other'].includes(data.orderType) ? data.orderType : 'delivery';
    const paymentMethod = ['not_recorded','cash','mobile_money','bank_transfer','card','other'].includes(data.paymentMethod) ? data.paymentMethod : 'not_recorded';
    const discountAmountXof = Number(data.discountAmountXof) || 0;
    if (!Number.isSafeInteger(discountAmountXof) || discountAmountXof < 0 || discountAmountXof > 2_000_000_000) throw new Error('La remise doit être un montant entier positif en XOF.');
    const normalizedData = { ...data, source, orderType, paymentMethod, discountAmountXof };
    data = normalizedData;
    const expectedIntent = data.intentHash || crypto.createHash('sha256').update(orderIntent(normalizedData)).digest('hex');
    if (this.pg) return this._createPgOrder({ ...normalizedData, intentHash: expectedIntent });
    return this.withJsonLock(async () => {
      const existing = this.base.state.merchantOrders.find((o) => o.storeId === data.storeId && o.clientRequestId === data.clientRequestId);
      if (existing) {
        if (existing.intentHash !== expectedIntent) { const error = new Error('Cette tentative de commande a déjà été utilisée avec un panier différent.'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
        return { order: safeOrder(existing), idempotent: true };
      }
      const store = this.base.state.merchantStores.find((s) => s.id === data.storeId && s.status === 'active' &&
        (data.source === 'merchant_assisted' || (s.isPublished && s.acceptsOrders !== false)));
      if (!store) throw new Error('Cette boutique n’accepte pas de commandes actuellement.');
      if (data.source !== 'merchant_assisted' && store.requireTablePhoto === true && !data.tablePhoto?.bytes) throw new Error('Cette boutique exige une photo prise directement avec la caméra avant de recevoir la commande.');
      const merchant = this.base.state.merchants.find((m) => m.id === store.merchantId && m.status === 'active' && !m.deletedAt);
      if (!merchant) throw new Error('Cette boutique n’accepte pas de commandes actuellement.');
      const phoneHash = String(data.customerBlockPhoneHash || '');
      if (/^[a-f0-9]{64}$/i.test(phoneHash)) {
        const block = this.base.state.merchantCustomerBlocks.find((row) => row.storeId === store.id && row.phoneHash === phoneHash && row.status === 'active');
        if (block) {
          const requestHash = String(data.customerBlockRequestHash || crypto.createHash('sha256').update(data.clientRequestId).digest('hex'));
          let attemptRecorded = false;
          if (!this.base.state.merchantCustomerBlockAttempts.some((row) => row.storeId === store.id && row.requestHash === requestHash)) {
            this.base.state.merchantCustomerBlockAttempts.push({ id: uniqueId(), blockId: block.id, storeId: store.id, merchantId: store.merchantId,
              phoneHash, requestHash, ipHash: String(data.clientIpHash || crypto.createHash('sha256').update('unknown').digest('hex')),
              attemptedAt: new Date().toISOString() });
            await this.base.save(); attemptRecorded = true;
          }
          const error = new Error('Une difficulté empêche l’enregistrement de cette commande. Contactez la boutique si vous avez besoin d’aide.');
          error.code = 'CUSTOMER_BLOCKED'; error.blockId = block.id; error.storeId = store.id; error.merchantId = store.merchantId;
          error.phoneLast4 = block.phoneLast4; error.attemptRecorded = attemptRecorded; throw error;
        }
      }
      const servicePoint = data.servicePointId ? this.base.state.merchantServicePoints.find((row) => row.id === data.servicePointId && row.storeId === store.id && row.status === 'active') : null;
      if (data.servicePointId && !servicePoint) throw new Error('Le QR de table ou emplacement n’est plus actif.');
      if (source === 'merchant_assisted' && servicePoint?.type === 'table' && data.occupiedPointConfirmed !== true) {
        const activeOrderCount = this.base.state.merchantOrders.filter((order) => order.storeId === store.id && order.servicePointId === servicePoint.id && !['completed','cancelled','rejected'].includes(order.status)).length;
        if (activeOrderCount > 0) { const error = new Error(`Cette table a déjà ${activeOrderCount} commande(s) active(s). Confirmez explicitement son attribution avant de continuer.`); error.code = 'OCCUPIED_SERVICE_POINT'; error.activeOrderCount = activeOrderCount; throw error; }
      }
      const items = this._validateJsonItems(store.id, data.items);
      const totalAmountXof = items.reduce((sum, item) => sum + item.quantity * item.unitPriceXof, 0);
      if (!Number.isSafeInteger(totalAmountXof) || totalAmountXof < 0 || totalAmountXof > 2_000_000_000) throw new Error('Le total de la commande dépasse le montant autorisé.');
      if (data.discountAmountXof > totalAmountXof) throw new Error('La remise ne peut pas dépasser le sous-total des produits.');
      for (const item of items) {
        const product = this.base.state.merchantProducts.find((p) => p.id === item.productId && p.storeId === store.id);
        if (product.trackStock) product.stockQuantity -= item.quantity;
      }
      const now = new Date().toISOString(); const assisted = data.source === 'merchant_assisted';
      const order = { id: uniqueId(), storeId: store.id, merchantId: store.merchantId, reference: publicReference(), clientRequestId: data.clientRequestId,
        intentHash: expectedIntent, trackingTokenHash: data.trackingTokenHash, customerName: data.customerName, customerPhone: data.customerPhone, customerEmail: data.customerEmail || '',
        deliveryAddress: data.deliveryAddress, note: data.note || '', servicePointId: servicePoint?.id || '', servicePointName: servicePoint?.name || '', items, totalAmountXof, currency: 'XOF', status: 'pending',
        source: assisted ? 'merchant_assisted' : 'customer_qr', createdByType: assisted ? 'merchant' : 'customer', createdById: assisted ? String(data.createdById || '') : '',
        orderType: data.orderType || 'delivery', paymentMethod: data.paymentMethod || 'not_recorded', paymentStatus: 'not_recorded',
        stockReserved: true, hasTablePhoto: Boolean(data.tablePhoto?.bytes), tablePhotoExpiresAt: data.tablePhoto?.bytes ? new Date(Date.now()+30*86400000).toISOString() : null,
        deliveryFeeXof: orderType === 'delivery' ? (Number(store.deliveryFeeXof)||0) : 0, discountAmountXof: data.discountAmountXof,
        events: [{ status: 'pending', note: assisted ? 'Commande saisie par le marchand.' : 'Commande reçue.', actorType: assisted ? 'merchant' : 'client', actorId: assisted ? String(data.createdById || '') : '', actor: assisted ? 'merchant' : 'client', createdAt: now }], createdAt: now, updatedAt: now };
      this.base.state.merchantOrders.push(order);
      if (data.tablePhoto?.bytes) this.base.state.merchantOrderPhotos.push({ orderId: order.id, storeId: store.id, merchantId: store.merchantId,
        mimeType: data.tablePhoto.mimeType, byteSize: Buffer.byteLength(data.tablePhoto.bytes), contentBase64: Buffer.from(data.tablePhoto.bytes).toString('base64'),
        expiresAt: order.tablePhotoExpiresAt, createdAt: now, deletedAt: null, deletedByType: '', deletedBy: '' });
      this.base.state.merchantNotifications.push({ id: uniqueId(), merchantId: order.merchantId, orderId: order.id, type: 'new_order', dedupeKey: `order:${order.id}:new`,
        title: 'Nouvelle commande reçue', message: `Commande ${order.reference}`, data: { orderId: order.id, reference: order.reference }, createdAt: now, readAt: null });
      await this.base.save(); return { order: safeOrder(order), idempotent: false };
    });
  }

  _validateJsonItems(storeId, requested) {
    if (!Array.isArray(requested) || requested.length < 1 || requested.length > 20) throw new Error('Choisissez entre 1 et 20 produits différents.');
    const seen = new Set(); const result = [];
    for (const item of requested) {
      const productId = String(item.productId || ''); const quantity = Number(item.quantity);
      if (!productId || seen.has(productId) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 999) throw new Error('Un article ou une quantité de la commande n’est pas valide.');
      seen.add(productId);
      const product = this.base.state.merchantProducts.find((p) => p.id === productId && p.storeId === storeId && p.status === 'active');
      if (!product || (product.trackStock && Number(product.stockQuantity) < quantity)) throw new Error(`Le produit « ${product?.name || 'sélectionné'} » n’est plus disponible dans cette quantité.`);
      result.push({ productId, name: product.name, quantity, unitPriceXof: Number(product.priceXof), imageData: product.imageUrls?.[0] || product.imageData || '', imageUrls: clone(product.imageUrls || []) });
    }
    return result;
  }

  async _createPgOrder(data) {
    const client = await this.base.pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query('SELECT id, intent_hash FROM merchant_orders WHERE store_id=$1 AND client_request_id=$2', [data.storeId, data.clientRequestId]);
      if (found.rows[0]) {
        if (found.rows[0].intent_hash !== data.intentHash) { const error = new Error('Cette tentative de commande a déjà été utilisée avec un panier différent.'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
        await client.query('COMMIT');
        return { order: await this.getOrder(found.rows[0].id), idempotent: true };
      }
      const assisted = data.source === 'merchant_assisted';
      const live = await client.query(
        `SELECT s.id, s.merchant_id, s.accepts_orders, s.require_table_photo, s.delivery_fee_xof FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id
         WHERE s.id=$1 AND s.status='active' AND ($2::boolean OR (s.is_published=TRUE AND s.accepts_orders=TRUE))
           AND m.status='active' AND m.deleted_at IS NULL FOR UPDATE OF s`, [data.storeId, assisted]);
      if (!live.rows[0]) throw new Error('Cette boutique n’accepte pas de commandes actuellement.');
      const phoneHash = String(data.customerBlockPhoneHash || '');
      if (/^[a-f0-9]{64}$/i.test(phoneHash)) {
        const blockResult = await client.query(`SELECT id,phone_last4 AS "phoneLast4" FROM merchant_customer_blocks WHERE store_id=$1 AND phone_hash=$2 AND status='active' FOR UPDATE`, [data.storeId, phoneHash]);
        if (blockResult.rows[0]) {
          const block = blockResult.rows[0];
          const requestHash = String(data.customerBlockRequestHash || crypto.createHash('sha256').update(data.clientRequestId).digest('hex'));
          const ipHash = String(data.clientIpHash || crypto.createHash('sha256').update('unknown').digest('hex'));
          const attempt = await client.query(`INSERT INTO merchant_customer_block_attempts (id,block_id,store_id,merchant_id,phone_hash,request_hash,ip_hash)
            VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (store_id,request_hash) DO NOTHING RETURNING id`,
            [uniqueId(), block.id, data.storeId, live.rows[0].merchant_id, phoneHash, requestHash, ipHash]);
          await client.query('COMMIT');
          const error = new Error('Une difficulté empêche l’enregistrement de cette commande. Contactez la boutique si vous avez besoin d’aide.');
          error.code = 'CUSTOMER_BLOCKED'; error.blockId = block.id; error.storeId = data.storeId; error.merchantId = live.rows[0].merchant_id;
          error.phoneLast4 = block.phoneLast4; error.attemptRecorded = Boolean(attempt.rows[0]); throw error;
        }
      }
      if (!assisted && live.rows[0].require_table_photo === true && !data.tablePhoto?.bytes) throw new Error('Cette boutique exige une photo prise directement avec la caméra avant de recevoir la commande.');
      let servicePoint = null;
      if (data.servicePointId) {
        const point = await client.query("SELECT id,name,point_type AS type FROM merchant_service_points WHERE id=$1 AND store_id=$2 AND status='active' FOR UPDATE", [data.servicePointId, data.storeId]);
        if (!point.rows[0]) throw new Error('Le QR de table ou emplacement n’est plus actif.');
        servicePoint = point.rows[0];
        if (assisted && servicePoint.type === 'table' && data.occupiedPointConfirmed !== true) {
          const usage = await client.query("SELECT COUNT(*)::int AS count FROM merchant_orders WHERE store_id=$1 AND service_point_id=$2 AND status NOT IN ('completed','cancelled','rejected')", [data.storeId, servicePoint.id]);
          const activeOrderCount = Number(usage.rows[0]?.count) || 0;
          if (activeOrderCount > 0) { const error = new Error(`Cette table a déjà ${activeOrderCount} commande(s) active(s). Confirmez explicitement son attribution avant de continuer.`); error.code = 'OCCUPIED_SERVICE_POINT'; error.activeOrderCount = activeOrderCount; throw error; }
        }
      }
      if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 20) throw new Error('Choisissez entre 1 et 20 produits différents.');
      const normalized = data.items.map((item) => ({ productId: String(item.productId || ''), quantity: Number(item.quantity) }));
      if (normalized.some((item, index) => !item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 999 || normalized.findIndex((v) => v.productId === item.productId) !== index)) throw new Error('Un article ou une quantité de la commande n’est pas valide.');
      const ids = normalized.map((item) => item.productId).sort();
      const foundProducts = await client.query(
        `SELECT id, name, price_xof AS "priceXof", stock_quantity AS "stockQuantity", track_stock AS "trackStock", image_data AS "imageData"
         FROM merchant_products WHERE store_id=$1 AND id=ANY($2::text[]) AND status='active' ORDER BY id FOR UPDATE`, [data.storeId, ids]);
      if (foundProducts.rows.length !== normalized.length) throw new Error('Un produit a été retiré ou n’est plus disponible. Actualisez le catalogue.');
      const products = new Map(foundProducts.rows.map((p) => [p.id, p]));
      const items = normalized.map((request) => {
        const p = products.get(request.productId);
        if (p.trackStock && Number(p.stockQuantity) < request.quantity) throw new Error(`Le produit « ${p.name} » n’est plus disponible dans cette quantité.`);
        return { productId: p.id, name: p.name, quantity: request.quantity, unitPriceXof: Number(p.priceXof), imageData: p.imageUrls?.[0] || p.imageData || '' };
      });
      const totalAmountXof = items.reduce((sum, item) => sum + item.quantity * item.unitPriceXof, 0);
      if (!Number.isSafeInteger(totalAmountXof) || totalAmountXof < 0 || totalAmountXof > 2_000_000_000) throw new Error('Le total de la commande dépasse le montant autorisé.');
      if (Number(data.discountAmountXof) > totalAmountXof) throw new Error('La remise ne peut pas dépasser le sous-total des produits.');
      for (const item of items) if (products.get(item.productId).trackStock) {
        await client.query('UPDATE merchant_products SET stock_quantity=stock_quantity-$2, updated_at=NOW() WHERE id=$1', [item.productId, item.quantity]);
      }
      const id = uniqueId(); const reference = publicReference(); const orderType = data.orderType || 'delivery';
      const deliveryFeeXof = orderType === 'delivery' ? (Number(live.rows[0].delivery_fee_xof) || 0) : 0;
      const source = assisted ? 'merchant_assisted' : 'customer_qr'; const createdByType = assisted ? 'merchant' : 'customer';
      await client.query(
        `INSERT INTO merchant_orders (id, store_id, merchant_id, public_reference, client_request_id, intent_hash, customer_name, customer_phone,
          customer_email, delivery_address, note, total_amount_xof, status, stock_reserved, tracking_token_hash, service_point_id, service_point_name,
          delivery_fee_xof, discount_amount_xof, source, created_by_type, created_by_id, order_type, payment_method, payment_status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',TRUE,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,'not_recorded')`,
        [id, data.storeId, live.rows[0].merchant_id, reference, data.clientRequestId, data.intentHash, data.customerName, data.customerPhone,
          data.customerEmail || '', data.deliveryAddress, data.note || '', totalAmountXof, data.trackingTokenHash, servicePoint?.id || null, servicePoint?.name || '',
          deliveryFeeXof, Number(data.discountAmountXof) || 0, source, createdByType, assisted ? String(data.createdById || '') : '', orderType, data.paymentMethod || 'not_recorded']);
      for (const item of items) await client.query(
        'INSERT INTO merchant_order_items (id, order_id, product_id, product_name, quantity, unit_price_xof, image_data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [uniqueId(), id, item.productId, item.name, item.quantity, item.unitPriceXof, item.imageData]);
      if (data.tablePhoto?.bytes) await client.query(
        `INSERT INTO merchant_order_photos (order_id,store_id,merchant_id,mime_type,byte_size,content,expires_at) VALUES ($1,$2,$3,$4,$5,$6,NOW()+INTERVAL '30 days')`,
        [id,data.storeId,live.rows[0].merchant_id,data.tablePhoto.mimeType,Buffer.byteLength(data.tablePhoto.bytes),Buffer.from(data.tablePhoto.bytes)]);
      await client.query('INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [uniqueId(), id, 'pending', assisted ? 'Commande saisie par le marchand.' : 'Commande reçue.', createdByType, assisted ? String(data.createdById || '') : null]);
      await client.query(`INSERT INTO merchant_notifications (id,merchant_id,order_id,notification_type,dedupe_key,title,message,data)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (merchant_id,dedupe_key) DO NOTHING`,
        [uniqueId(), live.rows[0].merchant_id, id, assisted ? 'assisted_order' : 'new_order', `order:${id}:new`, assisted ? 'Commande saisie par le marchand' : 'Nouvelle commande reçue', `Commande ${reference}`,
          JSON.stringify({ orderId: id, reference, source })]);
      await client.query('COMMIT'); return { order: await this.getOrder(id), idempotent: false };
    } catch (error) {
      if (error.code !== 'CUSTOMER_BLOCKED') await client.query('ROLLBACK').catch(() => {});
      if (error.code === 'CUSTOMER_BLOCKED') throw error;
      if (error.code === '23505' && error.constraint === 'merchant_orders_store_request_idx') {
        const existing = await this.base.pool.query('SELECT id, intent_hash FROM merchant_orders WHERE store_id=$1 AND client_request_id=$2', [data.storeId, data.clientRequestId]);
        if (existing.rows[0] && existing.rows[0].intent_hash === data.intentHash) return { order: await this.getOrder(existing.rows[0].id), idempotent: true };
        if (existing.rows[0]) { const conflict = new Error('Cette tentative de commande a déjà été utilisée avec un panier différent.'); conflict.code = 'IDEMPOTENCY_CONFLICT'; throw conflict; }
      }
      throw error;
    } finally { client.release(); }
  }

  async getOrder(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, store_id AS "storeId", merchant_id AS "merchantId", public_reference AS reference, customer_name AS "customerName",
          customer_phone AS "customerPhone", customer_email AS "customerEmail", delivery_address AS "deliveryAddress", note,
          service_point_id AS "servicePointId", service_point_name AS "servicePointName",
          total_amount_xof AS "totalAmountXof", delivery_fee_xof AS "deliveryFeeXof", discount_amount_xof AS "discountAmountXof", currency, status,
          source, created_by_type AS "createdByType", created_by_id AS "createdById", order_type AS "orderType", payment_method AS "paymentMethod", payment_status AS "paymentStatus", stock_reserved AS "stockReserved",
          EXISTS (SELECT 1 FROM merchant_order_photos ph WHERE ph.order_id=merchant_orders.id AND ph.deleted_at IS NULL AND ph.expires_at>NOW() AND ph.content IS NOT NULL) AS "hasTablePhoto",
          (SELECT ph.expires_at FROM merchant_order_photos ph WHERE ph.order_id=merchant_orders.id) AS "tablePhotoExpiresAt",
          created_at AS "createdAt", updated_at AS "updatedAt"
         FROM merchant_orders WHERE id=$1`, [id]);
      if (!rows[0]) return null;
      return this._pgOrderDetails(rows[0]);
    }
    const order=this.base.state.merchantOrders.find((o) => o.id === id);if(!order)return null;
    const photo=this.base.state.merchantOrderPhotos.find((row)=>row.orderId===id&&!row.deletedAt&&Date.parse(row.expiresAt)>Date.now()&&row.contentBase64);
    const cancellationRequests=await this._cancellationRequestsForOrder(id);
    return safeOrder({...order,hasTablePhoto:Boolean(photo),tablePhotoExpiresAt:photo?.expiresAt||order.tablePhotoExpiresAt||null,cancellationRequests});
  }

  async getOrderPhoto(orderId, merchantId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(`SELECT order_id AS "orderId",merchant_id AS "merchantId",mime_type AS "mimeType",byte_size AS "byteSize",content,expires_at AS "expiresAt"
        FROM merchant_order_photos WHERE order_id=$1 AND merchant_id=$2 AND deleted_at IS NULL AND expires_at>NOW() AND content IS NOT NULL`,[orderId,merchantId]);
      return rows[0] ? { ...rows[0], bytes:Buffer.from(rows[0].content) } : null;
    }
    const row=this.base.state.merchantOrderPhotos.find((photo)=>photo.orderId===orderId&&photo.merchantId===merchantId&&!photo.deletedAt&&Date.parse(photo.expiresAt)>Date.now()&&photo.contentBase64);
    return row?{orderId:row.orderId,merchantId:row.merchantId,mimeType:row.mimeType,byteSize:row.byteSize,expiresAt:row.expiresAt,bytes:Buffer.from(row.contentBase64,'base64')}:null;
  }

  async deleteOrderPhoto(orderId, merchantId, { actorType='merchant',actorId='' }={}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(`UPDATE merchant_order_photos SET content=NULL,deleted_at=NOW(),deleted_by_type=$3,deleted_by=$4
        WHERE order_id=$1 AND merchant_id=$2 AND deleted_at IS NULL RETURNING order_id AS "orderId",byte_size AS "byteSize",deleted_at AS "deletedAt"`,[orderId,merchantId,actorType,actorId]);
      return rows[0]||null;
    }
    return this.withJsonLock(async()=>{const row=this.base.state.merchantOrderPhotos.find((photo)=>photo.orderId===orderId&&photo.merchantId===merchantId&&!photo.deletedAt);if(!row)return null;
      row.contentBase64='';row.deletedAt=new Date().toISOString();row.deletedByType=actorType;row.deletedBy=actorId;await this.base.save();return{orderId,byteSize:row.byteSize,deletedAt:row.deletedAt};});
  }

  async purgeExpiredOrderPhotos() {
    if (this.pg) { const result=await this.base.pool.query(`UPDATE merchant_order_photos SET content=NULL,deleted_at=NOW(),deleted_by_type='system',deleted_by='retention-policy' WHERE deleted_at IS NULL AND expires_at<=NOW() AND content IS NOT NULL`); return result.rowCount||0; }
    return this.withJsonLock(async()=>{let count=0;for(const row of this.base.state.merchantOrderPhotos){if(!row.deletedAt&&Date.parse(row.expiresAt)<=Date.now()&&row.contentBase64){row.contentBase64='';row.deletedAt=new Date().toISOString();row.deletedByType='system';row.deletedBy='retention-policy';count++;}}if(count)await this.base.save();return count;});
  }

  _safeCancellationRequest(row) {
    if (!row) return null;
    return {
      id: row.id,
      orderId: row.orderId ?? row.order_id,
      reason: row.reason || '',
      status: row.status,
      decisionNote: row.decisionNote ?? row.decision_note ?? '',
      requestedAt: row.requestedAt ?? row.requested_at,
      decidedAt: row.decidedAt ?? row.decided_at ?? null,
    };
  }

  async _cancellationRequestsForOrder(orderId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id,order_id AS "orderId",reason,status,decision_note AS "decisionNote",requested_at AS "requestedAt",decided_at AS "decidedAt"
         FROM merchant_order_cancellation_requests WHERE order_id=$1 ORDER BY requested_at`, [orderId]);
      return rows.map((row) => this._safeCancellationRequest(row));
    }
    return this.base.state.merchantOrderCancellationRequests
      .filter((row) => row.orderId === orderId)
      .sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt)))
      .map((row) => this._safeCancellationRequest(row));
  }

  async requestOrderCancellation(reference, tokenHash, requestId, reason = '', policy = {}) {
    const key = String(requestId || '');
    if (!REQUEST_ID_RE.test(key)) throw new Error('Identifiant de demande invalide. Actualisez puis réessayez.');
    const requestHash = crypto.createHash('sha256').update(key).digest('hex');
    const note = String(reason || '').trim().slice(0, 300);
    const cancellable = new Set(['pending', 'confirmed', 'preparing', 'ready']);
    const requestedLimit = Number(policy.cancellationRequestsPer24h);
    const cancellationLimit = Number.isFinite(requestedLimit) ? Math.max(1, Math.min(10, Math.round(requestedLimit))) : 3;
    const autoAcceptPendingCancellation = policy.autoAcceptPendingCancellation !== false;

    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const found = await client.query(
          `SELECT id,store_id AS "storeId",merchant_id AS "merchantId",public_reference AS reference,status,stock_reserved AS "stockReserved"
           FROM merchant_orders WHERE public_reference=$1 AND tracking_token_hash=$2 FOR UPDATE`, [reference, tokenHash]);
        const order = found.rows[0];
        if (!order) { const error = new Error('Commande introuvable ou lien de suivi invalide.'); error.code = 'NOT_FOUND'; throw error; }

        const duplicate = await client.query(
          `SELECT id,order_id AS "orderId",reason,status,decision_note AS "decisionNote",requested_at AS "requestedAt",decided_at AS "decidedAt"
           FROM merchant_order_cancellation_requests WHERE order_id=$1 AND request_hash=$2`, [order.id, requestHash]);
        if (duplicate.rows[0]) {
          await client.query('COMMIT');
          return { request: this._safeCancellationRequest(duplicate.rows[0]), orderId: order.id, storeId: order.storeId,
            merchantId: order.merchantId, reference: order.reference, idempotent: true, autoAccepted: duplicate.rows[0].status === 'accepted' && order.status === 'cancelled' };
        }
        if (!cancellable.has(order.status)) { const error = new Error('Cette commande ne peut plus recevoir de demande d’annulation.'); error.code = 'CANCELLATION_NOT_ALLOWED'; throw error; }
        const recent = await client.query(
          `SELECT COUNT(*)::int AS count FROM merchant_order_cancellation_requests WHERE order_id=$1 AND requested_at>NOW()-INTERVAL '24 hours'`, [order.id]);
        if (Number(recent.rows[0]?.count) >= cancellationLimit) { const error = new Error('La demande ne peut pas être répétée pour cette commande. Contactez la boutique directement si nécessaire.'); error.code = 'CANCELLATION_LIMIT'; throw error; }
        const pending = await client.query(`SELECT id FROM merchant_order_cancellation_requests WHERE order_id=$1 AND status='pending'`, [order.id]);
        if (pending.rows[0]) { const error = new Error('Une demande d’annulation est déjà en cours pour cette commande.'); error.code = 'CANCELLATION_PENDING'; throw error; }

        const autoAccepted = autoAcceptPendingCancellation && order.status === 'pending';
        const id = uniqueId();
        const inserted = await client.query(
          `INSERT INTO merchant_order_cancellation_requests (id,order_id,store_id,merchant_id,request_hash,reason,status,decision_note,decided_at,decided_by_type,decided_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CASE WHEN $7='accepted' THEN NOW() ELSE NULL END,CASE WHEN $7='accepted' THEN 'client' ELSE '' END,'')
           RETURNING id,order_id AS "orderId",reason,status,decision_note AS "decisionNote",requested_at AS "requestedAt",decided_at AS "decidedAt"`,
          [id, order.id, order.storeId, order.merchantId, requestHash, note, autoAccepted ? 'accepted' : 'pending',
            autoAccepted ? 'Annulation demandée avant confirmation; prise en compte automatiquement.' : '']);
        if (autoAccepted) {
          if (order.stockReserved) {
            const items = await client.query(
              `SELECT p.id,i.quantity FROM merchant_order_items i JOIN merchant_products p ON p.id=i.product_id WHERE i.order_id=$1 AND p.track_stock=TRUE`, [order.id]);
            for (const item of items.rows) await client.query('UPDATE merchant_products SET stock_quantity=stock_quantity+$2,updated_at=NOW() WHERE id=$1', [item.id, item.quantity]);
          }
          await client.query(`UPDATE merchant_orders SET status='cancelled',stock_reserved=FALSE,updated_at=NOW() WHERE id=$1`, [order.id]);
          await client.query(
            `INSERT INTO merchant_order_events (id,order_id,status,note,actor_type,actor_id) VALUES ($1,$2,'cancelled',$3,'client',NULL)`,
            [uniqueId(), order.id, 'Commande annulée par le client avant confirmation.']);
        }
        const notificationType = autoAccepted ? 'order_cancelled' : 'order_cancellation_request';
        const title = autoAccepted ? 'Commande annulée par le client' : 'Demande d’annulation client';
        const message = note || (autoAccepted ? 'Annulation reçue avant confirmation.' : 'Le client demande l’annulation de la commande.');
        await client.query(
          `INSERT INTO merchant_notifications (id,merchant_id,order_id,notification_type,dedupe_key,title,message,data)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT (merchant_id,dedupe_key) DO NOTHING`,
          [uniqueId(), order.merchantId, order.id, notificationType, `order:${order.id}:cancellation:${requestHash}`, title, message,
            JSON.stringify({ orderId: order.id, reference: order.reference, cancellationRequestId: id, status: inserted.rows[0].status })]);
        await client.query('COMMIT');
        return { request: this._safeCancellationRequest(inserted.rows[0]), orderId: order.id, storeId: order.storeId,
          merchantId: order.merchantId, reference: order.reference, idempotent: false, autoAccepted };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        if (error.code === '23505' && error.constraint === 'merchant_order_cancellation_one_pending_idx') {
          const conflict = new Error('Une demande d’annulation est déjà en cours pour cette commande.'); conflict.code = 'CANCELLATION_PENDING'; throw conflict;
        }
        throw error;
      } finally { client.release(); }
    }

    return this.withJsonLock(async () => {
      const order = this.base.state.merchantOrders.find((row) => row.reference === reference && row.trackingTokenHash === tokenHash);
      if (!order) { const error = new Error('Commande introuvable ou lien de suivi invalide.'); error.code = 'NOT_FOUND'; throw error; }
      const requests = this.base.state.merchantOrderCancellationRequests;
      const duplicate = requests.find((row) => row.orderId === order.id && row.requestHash === requestHash);
      if (duplicate) return { request: this._safeCancellationRequest(duplicate), orderId: order.id, storeId: order.storeId,
        merchantId: order.merchantId, reference: order.reference, idempotent: true, autoAccepted: duplicate.status === 'accepted' && order.status === 'cancelled' };
      if (!cancellable.has(order.status)) { const error = new Error('Cette commande ne peut plus recevoir de demande d’annulation.'); error.code = 'CANCELLATION_NOT_ALLOWED'; throw error; }
      const recent = requests.filter((row) => row.orderId === order.id && Date.parse(row.requestedAt) > Date.now() - 86_400_000).length;
      if (recent >= cancellationLimit) { const error = new Error('La demande ne peut pas être répétée pour cette commande. Contactez la boutique directement si nécessaire.'); error.code = 'CANCELLATION_LIMIT'; throw error; }
      if (requests.some((row) => row.orderId === order.id && row.status === 'pending')) { const error = new Error('Une demande d’annulation est déjà en cours pour cette commande.'); error.code = 'CANCELLATION_PENDING'; throw error; }

      const autoAccepted = autoAcceptPendingCancellation && order.status === 'pending';
      const now = new Date().toISOString();
      const row = { id: uniqueId(), orderId: order.id, storeId: order.storeId, merchantId: order.merchantId, requestHash, reason: note,
        status: autoAccepted ? 'accepted' : 'pending', decisionNote: autoAccepted ? 'Annulation demandée avant confirmation; prise en compte automatiquement.' : '',
        requestedAt: now, decidedAt: autoAccepted ? now : null, decidedByType: autoAccepted ? 'client' : '', decidedBy: '' };
      requests.push(row);
      if (autoAccepted) {
        if (order.stockReserved) {
          for (const item of order.items || []) { const product = this.base.state.merchantProducts.find((row) => row.id === item.productId); if (product?.trackStock) product.stockQuantity += item.quantity; }
          order.stockReserved = false;
        }
        order.status = 'cancelled'; order.updatedAt = now;
        order.events.push({ status: 'cancelled', note: 'Commande annulée par le client avant confirmation.', actor: 'client', actorId: '', createdAt: now });
      }
      const dedupeKey = `order:${order.id}:cancellation:${requestHash}`;
      if (!this.base.state.merchantNotifications.some((item) => item.merchantId === order.merchantId && item.dedupeKey === dedupeKey)) {
        this.base.state.merchantNotifications.push({ id: uniqueId(), merchantId: order.merchantId, orderId: order.id,
          type: autoAccepted ? 'order_cancelled' : 'order_cancellation_request', dedupeKey,
          title: autoAccepted ? 'Commande annulée par le client' : 'Demande d’annulation client',
          message: note || (autoAccepted ? 'Annulation reçue avant confirmation.' : 'Le client demande l’annulation de la commande.'),
          data: { orderId: order.id, reference: order.reference, cancellationRequestId: row.id, status: row.status }, createdAt: now, readAt: null });
      }
      await this.base.save();
      return { request: this._safeCancellationRequest(row), orderId: order.id, storeId: order.storeId,
        merchantId: order.merchantId, reference: order.reference, idempotent: false, autoAccepted };
    });
  }

  async decideOrderCancellationRequest(orderId, requestId, decision, { actorType = 'merchant', actorId = '', note = '' } = {}) {
    if (!['accepted', 'rejected'].includes(decision)) throw new Error('Décision d’annulation invalide.');
    const decisionNote = String(note || '').trim().slice(0, 300);
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const orderResult = await client.query(
          `SELECT id,store_id AS "storeId",merchant_id AS "merchantId",public_reference AS reference,status,stock_reserved AS "stockReserved"
           FROM merchant_orders WHERE id=$1 FOR UPDATE`, [orderId]);
        const order = orderResult.rows[0];
        if (!order) { await client.query('COMMIT'); return null; }
        const found = await client.query(
          `SELECT id,order_id AS "orderId",reason,status,decision_note AS "decisionNote",requested_at AS "requestedAt",decided_at AS "decidedAt"
           FROM merchant_order_cancellation_requests WHERE id=$1 AND order_id=$2 FOR UPDATE`, [requestId, orderId]);
        const request = found.rows[0];
        if (!request) { await client.query('COMMIT'); return null; }
        if (request.status !== 'pending') { await client.query('COMMIT'); return { request: this._safeCancellationRequest(request), idempotent: true, order: { ...order } }; }
        if (decision === 'accepted') {
          if (!['pending', 'confirmed', 'preparing', 'ready'].includes(order.status)) { const error = new Error('Cette commande ne peut plus être annulée.'); error.code = 'CANCELLATION_NOT_ALLOWED'; throw error; }
          if (order.stockReserved) {
            const items = await client.query(`SELECT p.id,i.quantity FROM merchant_order_items i JOIN merchant_products p ON p.id=i.product_id WHERE i.order_id=$1 AND p.track_stock=TRUE`, [orderId]);
            for (const item of items.rows) await client.query('UPDATE merchant_products SET stock_quantity=stock_quantity+$2,updated_at=NOW() WHERE id=$1', [item.id, item.quantity]);
          }
          await client.query(`UPDATE merchant_orders SET status='cancelled',stock_reserved=FALSE,updated_at=NOW() WHERE id=$1`, [orderId]);
          await client.query(
            `INSERT INTO merchant_order_events (id,order_id,status,note,actor_type,actor_id) VALUES ($1,$2,'cancelled',$3,$4,$5)`,
            [uniqueId(), orderId, decisionNote || 'Demande d’annulation du client acceptée.', actorType, actorId || null]);
        }
        const updated = await client.query(
          `UPDATE merchant_order_cancellation_requests SET status=$3,decision_note=$4,decided_at=NOW(),decided_by_type=$5,decided_by=$6
           WHERE id=$1 AND order_id=$2 RETURNING id,order_id AS "orderId",reason,status,decision_note AS "decisionNote",requested_at AS "requestedAt",decided_at AS "decidedAt"`,
          [requestId, orderId, decision, decisionNote, actorType, actorId]);
        await client.query('COMMIT');
        return { request: this._safeCancellationRequest(updated.rows[0]), idempotent: false,
          order: { ...order, status: decision === 'accepted' ? 'cancelled' : order.status } };
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    }

    return this.withJsonLock(async () => {
      const order = this.base.state.merchantOrders.find((row) => row.id === orderId);
      const request = this.base.state.merchantOrderCancellationRequests.find((row) => row.id === requestId && row.orderId === orderId);
      if (!order || !request) return null;
      if (request.status !== 'pending') return { request: this._safeCancellationRequest(request), idempotent: true, order: safeOrder(order) };
      if (decision === 'accepted') {
        if (!['pending', 'confirmed', 'preparing', 'ready'].includes(order.status)) { const error = new Error('Cette commande ne peut plus être annulée.'); error.code = 'CANCELLATION_NOT_ALLOWED'; throw error; }
        if (order.stockReserved) {
          for (const item of order.items || []) { const product = this.base.state.merchantProducts.find((row) => row.id === item.productId); if (product?.trackStock) product.stockQuantity += item.quantity; }
          order.stockReserved = false;
        }
        order.status = 'cancelled'; order.updatedAt = new Date().toISOString();
        order.events.push({ status: 'cancelled', note: decisionNote || 'Demande d’annulation du client acceptée.', actor: actorType, actorId, createdAt: order.updatedAt });
      }
      request.status = decision; request.decisionNote = decisionNote; request.decidedAt = new Date().toISOString(); request.decidedByType = actorType; request.decidedBy = actorId;
      await this.base.save();
      return { request: this._safeCancellationRequest(request), idempotent: false, order: safeOrder(order) };
    });
  }

  async _pgOrderDetails(row) {
    const [items, events, cancellationRequests] = await Promise.all([
      this.base.pool.query('SELECT product_id AS "productId", product_name AS name, quantity, unit_price_xof AS "unitPriceXof", image_data AS "imageData" FROM merchant_order_items WHERE order_id=$1 ORDER BY id', [row.id]),
      this.base.pool.query('SELECT status, note, actor_type AS "actorType", created_at AS "createdAt" FROM merchant_order_events WHERE order_id=$1 ORDER BY created_at', [row.id]),
      this._cancellationRequestsForOrder(row.id),
    ]);
    return safeOrder({ ...row, items: items.rows, events: events.rows, cancellationRequests });
  }

  async getServicePointUsage(storeId) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT service_point_id AS "servicePointId",COUNT(*)::int AS "activeOrderCount"
         FROM merchant_orders WHERE store_id=$1 AND service_point_id IS NOT NULL AND status NOT IN ('completed','cancelled','rejected')
         GROUP BY service_point_id`, [storeId]);
      return Object.fromEntries(rows.map((row) => [row.servicePointId, Number(row.activeOrderCount) || 0]));
    }
    const counts = {};
    for (const order of this.base.state.merchantOrders) if (order.storeId === storeId && order.servicePointId && !['completed','cancelled','rejected'].includes(order.status)) {
      counts[order.servicePointId] = (counts[order.servicePointId] || 0) + 1;
    }
    return counts;
  }

  async listOrders({ merchantId = '', storeId = '', status = '', search = '', page = 1, limit = 25 } = {}) {
    if (this.pg) {
      const term = `%${search}%`;
      const params = [merchantId, storeId, status, search, term];
      const where = `($1='' OR o.merchant_id=$1) AND ($2='' OR o.store_id=$2) AND ($3='' OR o.status=$3)
        AND ($4='' OR o.public_reference ILIKE $5 OR o.customer_name ILIKE $5 OR o.customer_phone ILIKE $5)`;
      const count = await this.base.pool.query(`SELECT COUNT(*)::int AS total FROM merchant_orders o WHERE ${where}`, params);
      const result = await this.base.pool.query(
        `SELECT o.id FROM merchant_orders o WHERE ${where} ORDER BY o.created_at DESC LIMIT $6 OFFSET $7`, [...params, limit, (page - 1) * limit]);
      const data = await Promise.all(result.rows.map((row) => this.getOrder(row.id)));
      return { data, total: count.rows[0].total, page, limit };
    }
    let rows = this.base.state.merchantOrders.slice();
    if (merchantId) rows = rows.filter((o) => o.merchantId === merchantId);
    if (storeId) rows = rows.filter((o) => o.storeId === storeId);
    if (status) rows = rows.filter((o) => o.status === status);
    if (search) { const term = search.toLocaleLowerCase('fr'); rows = rows.filter((o) => [o.reference, o.customerName, o.customerPhone].some((v) => String(v || '').toLocaleLowerCase('fr').includes(term))); }
    rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const total = rows.length; const offset = (page - 1) * limit;
    return { data: rows.slice(offset, offset + limit).map((order) => safeOrder({ ...order, cancellationRequests: this.base.state.merchantOrderCancellationRequests.filter((row) => row.orderId === order.id).sort((a, b) => String(a.requestedAt).localeCompare(String(b.requestedAt))).map((row) => this._safeCancellationRequest(row)) })), total, page, limit };
  }

  async getOrderByReference(reference) {
    if (this.pg) {
      const { rows } = await this.base.pool.query('SELECT id FROM merchant_orders WHERE public_reference=$1', [reference]);
      return rows[0] ? this.getOrder(rows[0].id) : null;
    }
    return safeOrder(this.base.state.merchantOrders.find((o) => o.reference === reference) || null);
  }

  async getOrderTracking(reference, tokenHash) {
    if (this.pg) {
      const { rows } = await this.base.pool.query("SELECT id FROM merchant_orders WHERE public_reference=$1 AND tracking_token_hash=$2 AND status NOT IN ('completed','cancelled','rejected')", [reference, tokenHash]);
      return rows[0] ? this.getOrder(rows[0].id) : null;
    }
    const order = this.base.state.merchantOrders.find((o) => o.reference === reference && o.trackingTokenHash === tokenHash && !['completed','cancelled','rejected'].includes(o.status));
    return order ? safeOrder({ ...order, cancellationRequests: await this._cancellationRequestsForOrder(order.id) }) : null;
  }

  async recoverPublicOrders({ storeId = '', reference = '', tokenHash = '', phone = '' } = {}) {
    const normalizedPhone = String(phone || '').replace(/\D/g, '');
    if (!storeId || !reference || normalizedPhone.length < 7 || !/^[0-9a-f]{64}$/i.test(String(tokenHash || ''))) return null;
    const anchor = await this.getOrderTracking(String(reference), tokenHash);
    if (!anchor || anchor.storeId !== storeId || normalizedPhone !== String(anchor.customerPhone || '').replace(/\D/g, '')) return null;
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id FROM merchant_orders WHERE store_id=$1 AND regexp_replace(customer_phone,'[^0-9]','','g')=$2
         AND status NOT IN ('completed','cancelled','rejected') ORDER BY created_at DESC`, [storeId, normalizedPhone]);
      return Promise.all(rows.map((row) => this.getOrder(row.id)));
    }
    const rows = this.base.state.merchantOrders.filter((order) => order.storeId === storeId
      && String(order.customerPhone || '').replace(/\D/g, '') === normalizedPhone
      && !['completed','cancelled','rejected'].includes(order.status)).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return Promise.all(rows.map(async (order) => safeOrder({ ...order, cancellationRequests: await this._cancellationRequestsForOrder(order.id) })));
  }

  async getPublicCancellationStatus(reference, tokenHash) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT o.status AS "orderStatus",c.id,c.order_id AS "orderId",c.reason,c.status,c.decision_note AS "decisionNote",
                c.requested_at AS "requestedAt",c.decided_at AS "decidedAt"
         FROM merchant_orders o JOIN merchant_order_cancellation_requests c ON c.order_id=o.id
         WHERE o.public_reference=$1 AND o.tracking_token_hash=$2 AND o.status<>'completed'
         ORDER BY c.requested_at DESC LIMIT 1`, [reference, tokenHash]);
      return rows[0] ? { orderStatus: rows[0].orderStatus, request: this._safeCancellationRequest(rows[0]) } : null;
    }
    const order = this.base.state.merchantOrders.find((row) => row.reference === reference && row.trackingTokenHash === tokenHash && row.status !== 'completed');
    if (!order) return null;
    const latest = this.base.state.merchantOrderCancellationRequests.filter((row) => row.orderId === order.id).sort((a, b) => String(b.requestedAt).localeCompare(String(a.requestedAt)))[0];
    return latest ? { orderStatus: order.status, request: this._safeCancellationRequest(latest) } : null;
  }

  async setOrderStatus(id, status, { actorType = 'merchant', actorId = '', note = '' } = {}) {
    if (!ORDER_STATUSES.has(status)) throw new Error('Statut de commande invalide.');
    if (this.pg) {
      const client = await this.base.pool.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query('SELECT id, store_id, status, stock_reserved FROM merchant_orders WHERE id=$1 FOR UPDATE', [id]);
        if (!rows[0]) { await client.query('ROLLBACK'); return null; }
        const before = rows[0];
        if (!NEXT_ORDER_STATUSES[before.status]?.has(status)) throw new Error(`La transition ${before.status} → ${status} n’est pas autorisée.`);
        if (['cancelled', 'rejected'].includes(status) && before.stock_reserved) {
          const items = await client.query('SELECT product_id AS id, quantity FROM merchant_order_items WHERE order_id=$1', [id]);
          for (const item of items.rows) if (item.id) await client.query('UPDATE merchant_products SET stock_quantity=stock_quantity+$2, updated_at=NOW() WHERE id=$1', [item.id, item.quantity]);
        }
        await client.query(`UPDATE merchant_orders SET status=$2, stock_reserved=CASE WHEN $2 IN ('cancelled','rejected') THEN FALSE ELSE stock_reserved END, updated_at=NOW() WHERE id=$1`, [id, status]);
        await client.query('INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id) VALUES ($1,$2,$3,$4,$5,$6)', [uniqueId(), id, status, safeStatusNote(status, note), actorType, actorId || null]);
        if (['cancelled', 'rejected'].includes(status)) await client.query(`UPDATE merchant_order_cancellation_requests SET status='rejected',decision_note=$2,decided_at=NOW(),decided_by_type=$3,decided_by=$4 WHERE order_id=$1 AND status='pending'`, [id, safeStatusNote(status, note), actorType, actorId]);
        if (actorType !== 'merchant') await client.query(`INSERT INTO merchant_notifications (id,merchant_id,order_id,notification_type,dedupe_key,title,message,data)
          SELECT $1,merchant_id,$2,'order_status',$3,$4,$5,$6::jsonb FROM merchant_orders WHERE id=$2
          ON CONFLICT (merchant_id,dedupe_key) DO NOTHING`, [uniqueId(), id, `order:${id}:status:${status}`, `Commande ${status === 'cancelled' ? 'annulée' : 'mise à jour'}`, safeStatusNote(status, note), JSON.stringify({ orderId: id, status })]);
        await client.query('COMMIT'); return this.getOrder(id);
      } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
      finally { client.release(); }
    }
    return this.withJsonLock(async () => {
      const order = this.base.state.merchantOrders.find((o) => o.id === id);
      if (!order) return null;
      if (!NEXT_ORDER_STATUSES[order.status]?.has(status)) throw new Error(`La transition ${order.status} → ${status} n’est pas autorisée.`);
      if (['cancelled', 'rejected'].includes(status) && order.stockReserved) {
        for (const item of order.items) {
          const product = this.base.state.merchantProducts.find((p) => p.id === item.productId);
          if (product?.trackStock) product.stockQuantity += item.quantity;
        }
        order.stockReserved = false;
      }
      order.status = status; order.updatedAt = new Date().toISOString();
      order.events.push({ status, note: safeStatusNote(status, note), actor: actorType, actorId, createdAt: order.updatedAt });
      if (['cancelled', 'rejected'].includes(status)) for (const request of this.base.state.merchantOrderCancellationRequests.filter((row) => row.orderId === id && row.status === 'pending')) {
        request.status = 'rejected'; request.decisionNote = safeStatusNote(status, note); request.decidedAt = order.updatedAt; request.decidedByType = actorType; request.decidedBy = actorId;
      }
      if (actorType !== 'merchant') { const dedupeKey = `order:${id}:status:${status}`; if (!this.base.state.merchantNotifications.some((row) => row.merchantId === order.merchantId && row.dedupeKey === dedupeKey)) this.base.state.merchantNotifications.push({ id: uniqueId(), merchantId: order.merchantId, orderId: id, type: 'order_status', dedupeKey, title: `Commande ${status === 'cancelled' ? 'annulée' : 'mise à jour'}`, message: safeStatusNote(status, note), data: { orderId: id, status }, createdAt: order.updatedAt, readAt: null }); }
      await this.base.save(); return safeOrder(order);
    });
  }

  async stats(merchantId = '') {
    if (this.pg) {
      const [counts, top, daily, weekly, monthly, recent] = await Promise.all([
        this.base.pool.query(
          `SELECT
            (SELECT COUNT(*)::int FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id WHERE ($1='' OR m.id=$1) AND m.deleted_at IS NULL) AS stores,
            (SELECT COUNT(*)::int FROM merchant_products p JOIN merchant_stores s ON s.id=p.store_id JOIN merchant_accounts m ON m.id=s.merchant_id WHERE p.status<>'archived' AND ($1='' OR m.id=$1) AND m.deleted_at IS NULL) AS products,
            (SELECT COUNT(*)::int FROM merchant_products p JOIN merchant_stores s ON s.id=p.store_id JOIN merchant_accounts m ON m.id=s.merchant_id WHERE p.status='active' AND (p.track_stock=FALSE OR p.stock_quantity>0) AND ($1='' OR m.id=$1) AND m.deleted_at IS NULL) AS available_products,
            (SELECT COUNT(*)::int FROM merchant_products p JOIN merchant_stores s ON s.id=p.store_id JOIN merchant_accounts m ON m.id=s.merchant_id WHERE p.status='active' AND p.track_stock=TRUE AND p.stock_quantity=0 AND ($1='' OR m.id=$1) AND m.deleted_at IS NULL) AS out_of_stock,
            (SELECT COUNT(*)::int FROM merchant_orders o WHERE ($1='' OR o.merchant_id=$1)) AS orders,
            (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.status='pending' AND ($1='' OR o.merchant_id=$1)) AS pending_orders,
            (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.status='completed' AND ($1='' OR o.merchant_id=$1)) AS completed_orders,
            (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.status='cancelled' AND ($1='' OR o.merchant_id=$1)) AS cancelled_orders,
            (SELECT COALESCE(SUM(o.total_amount_xof),0)::bigint FROM merchant_orders o WHERE o.status NOT IN ('cancelled','rejected') AND ($1='' OR o.merchant_id=$1)) AS order_value_xof,
            (SELECT COALESCE(SUM(o.total_amount_xof),0)::bigint FROM merchant_orders o WHERE o.status='completed' AND ($1='' OR o.merchant_id=$1)) AS completed_order_value_xof,
            (SELECT COALESCE(SUM(s.qr_scan_count),0)::bigint FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id WHERE ($1='' OR m.id=$1) AND m.deleted_at IS NULL) AS qr_scans`, [merchantId]),
        this.base.pool.query(
          `SELECT i.product_id AS "productId", i.product_name AS name, SUM(i.quantity)::int AS quantity, SUM(i.quantity*i.unit_price_xof)::bigint AS "orderValueXof"
           FROM merchant_order_items i JOIN merchant_orders o ON o.id=i.order_id WHERE o.status NOT IN ('cancelled','rejected') AND ($1='' OR o.merchant_id=$1)
           GROUP BY i.product_id,i.product_name ORDER BY quantity DESC LIMIT 5`, [merchantId]),
        this.base.pool.query(`SELECT DATE_TRUNC('day',created_at)::date::text AS period, COUNT(*)::int AS orders FROM merchant_orders
          WHERE created_at>=NOW()-INTERVAL '7 days' AND ($1='' OR merchant_id=$1) GROUP BY 1 ORDER BY 1`, [merchantId]),
        this.base.pool.query(`SELECT DATE_TRUNC('week',created_at)::date::text AS period, COUNT(*)::int AS orders FROM merchant_orders
          WHERE created_at>=NOW()-INTERVAL '8 weeks' AND ($1='' OR merchant_id=$1) GROUP BY 1 ORDER BY 1`, [merchantId]),
        this.base.pool.query(`SELECT DATE_TRUNC('month',created_at)::date::text AS period, COUNT(*)::int AS orders FROM merchant_orders
          WHERE created_at>=NOW()-INTERVAL '6 months' AND ($1='' OR merchant_id=$1) GROUP BY 1 ORDER BY 1`, [merchantId]),
        this.listOrders({ merchantId, page: 1, limit: 5 }),
      ]);
      const row = counts.rows[0] || {};
      return { stores: Number(row.stores) || 0, products: Number(row.products) || 0, availableProducts: Number(row.available_products) || 0,
        outOfStock: Number(row.out_of_stock) || 0, orders: Number(row.orders) || 0, pendingOrders: Number(row.pending_orders) || 0,
        completedOrders: Number(row.completed_orders) || 0, cancelledOrders: Number(row.cancelled_orders) || 0,
        orderValueXof: Number(row.order_value_xof) || 0, completedOrderValueXof: Number(row.completed_order_value_xof) || 0,
        paymentConfirmedXof: 0, qrScans: Number(row.qr_scans) || 0, topProducts: top.rows.map((item) => ({ ...item, quantity: Number(item.quantity), orderValueXof: Number(item.orderValueXof) })),
        ordersByDay: daily.rows.map((item) => ({ period: item.period, orders: Number(item.orders) })),
        ordersByWeek: weekly.rows.map((item) => ({ period: item.period, orders: Number(item.orders) })),
        ordersByMonth: monthly.rows.map((item) => ({ period: item.period, orders: Number(item.orders) })), recentOrders: recent.data || [] };
    }
    const merchants = this.base.state.merchants.filter((m) => !m.deletedAt && (!merchantId || m.id === merchantId));
    const ids = new Set(merchants.map((m) => m.id)); const stores = this.base.state.merchantStores.filter((s) => ids.has(s.merchantId));
    const storeIds = new Set(stores.map((s) => s.id));
    const products = this.base.state.merchantProducts.filter((p) => storeIds.has(p.storeId) && p.status !== 'archived');
    const orders = this.base.state.merchantOrders.filter((o) => storeIds.has(o.storeId));
    const now = Date.now(); const makePeriod = (start, end) => ({ start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10), orders: orders.filter((o) => { const time = new Date(o.createdAt).getTime(); return time >= start.getTime() && time < end.getTime(); }).length });
    const ordersByDay = Array.from({ length: 7 }, (_, index) => { const start = new Date(now); start.setHours(0,0,0,0); start.setDate(start.getDate() - (6 - index)); const end = new Date(start); end.setDate(end.getDate() + 1); return makePeriod(start, end); });
    const weekStart = (date) => { const d = new Date(date); d.setHours(0,0,0,0); const day=(d.getDay()+6)%7; d.setDate(d.getDate()-day); return d; };
    const currentWeek = weekStart(new Date(now)); const ordersByWeek = Array.from({ length: 8 }, (_, index) => { const start = new Date(currentWeek); start.setDate(start.getDate() - (7 * (7 - index))); const end = new Date(start); end.setDate(end.getDate()+7); return makePeriod(start,end); });
    const ordersByMonth = Array.from({ length: 6 }, (_, index) => { const start = new Date(); start.setDate(1); start.setHours(0,0,0,0); start.setMonth(start.getMonth()-(5-index)); const end=new Date(start); end.setMonth(end.getMonth()+1); return makePeriod(start,end); });
    const productTotals = new Map();
    for (const order of orders.filter((item) => !['cancelled','rejected'].includes(item.status))) for (const item of order.items || []) {
      const row = productTotals.get(item.productId) || { productId: item.productId, name: item.name, quantity: 0, orderValueXof: 0 };
      row.quantity += Number(item.quantity) || 0; row.orderValueXof += Number(item.quantity) * Number(item.unitPriceXof); productTotals.set(item.productId, row);
    }
    const recentOrders = orders.slice().sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5).map(safeOrder);
    return { stores: stores.length, products: products.length, availableProducts: products.filter((p) => p.status === 'active' && (!p.trackStock || Number(p.stockQuantity)>0)).length,
      outOfStock: products.filter((p) => p.status === 'active' && p.trackStock && Number(p.stockQuantity)===0).length, orders: orders.length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length, completedOrders: orders.filter((o) => o.status === 'completed').length,
      cancelledOrders: orders.filter((o) => o.status === 'cancelled').length, orderValueXof: orders.filter((o) => !['cancelled','rejected'].includes(o.status)).reduce((sum,o)=>sum+o.totalAmountXof,0),
      completedOrderValueXof: orders.filter((o)=>o.status==='completed').reduce((sum,o)=>sum+o.totalAmountXof,0), paymentConfirmedXof: 0,
      qrScans: stores.reduce((sum,s)=>sum+(Number(s.qrScanCount)||0),0), topProducts: [...productTotals.values()].sort((a,b)=>b.quantity-a.quantity).slice(0,5),
      ordersByDay, ordersByWeek, ordersByMonth, recentOrders };
  }

  async listAudit({ merchantId, page = 1, limit = 50 }) {
    if (this.pg) {
      const count = await this.base.pool.query("SELECT COUNT(*)::int AS total FROM audit_logs WHERE entity_type='merchant' AND metadata->>'merchantId'=$1", [merchantId]);
      const { rows } = await this.base.pool.query(
        `SELECT id, actor, actor_type AS "actorType", actor_id AS "actorId", manager_id AS "managerId", action, entity_type AS "entityType",
          entity_id AS "entityId", summary, before_data AS "beforeData", after_data AS "afterData", result, metadata, created_at AS "createdAt"
         FROM audit_logs WHERE entity_type='merchant' AND metadata->>'merchantId'=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
        [merchantId, limit, (page - 1) * limit]);
      return { data: rows, total: count.rows[0].total, page, limit };
    }
    const all = this.base.state.audit.filter((row) => row.entityType === 'merchant' && row.metadata?.merchantId === merchantId);
    return { data: clone(all.slice((page - 1) * limit, page * limit)), total: all.length, page, limit };
  }
}

module.exports = { MerchantCommerceStore, ORDER_STATUSES, NEXT_ORDER_STATUSES, REQUEST_ID_RE };
