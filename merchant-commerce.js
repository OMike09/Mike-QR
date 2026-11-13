'use strict';

const crypto = require('node:crypto');

const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const ORDER_STATUSES = new Set(['pending', 'confirmed', 'preparing', 'ready', 'completed', 'cancelled']);
const NEXT_ORDER_STATUSES = {
  pending: new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['preparing', 'cancelled']),
  preparing: new Set(['ready', 'cancelled']),
  ready: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};
const REQUEST_ID_RE = /^[A-Za-z0-9_-]{16,100}$/;

function uniqueId() { return crypto.randomUUID(); }
function publicReference() { return `OY-${crypto.randomBytes(6).toString('base64url').toUpperCase()}`; }
function safeStatusNote(status, note) { const text = String(note || '').trim().slice(0, 300); return status === 'cancelled' ? (text || 'Commande annulée par le marchand.') : (text || `Statut mis à jour : ${status}.`); }
function withoutSecrets(row) {
  if (!row) return null;
  const { passwordHash, passwordResetTokenHash, trackingTokenHash, intentHash, ...safe } = row;
  return clone(safe);
}
function orderIntent(data) {
  return JSON.stringify({
    customerName: data.customerName, customerPhone: data.customerPhone, customerEmail: data.customerEmail,
    deliveryAddress: data.deliveryAddress, note: data.note,
    items: [...data.items].map((item) => ({ productId: item.productId, quantity: item.quantity })).sort((a, b) => a.productId.localeCompare(b.productId)),
  });
}
function safeOrder(row) {
  if (!row) return null;
  const safe = withoutSecrets(row);
  safe.items = Array.isArray(row.items) ? clone(row.items) : [];
  safe.events = Array.isArray(row.events) ? clone(row.events) : [];
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
    for (const [key, value] of Object.entries({ merchants: [], merchantStores: [], merchantProducts: [], merchantOrders: [], merchantAssignments: [], merchantQrScans: [], merchantMedia: [], merchantNotifications: [], merchantPushSubscriptions: [] })) {
      if (!Array.isArray(state[key])) { state[key] = value; changed = true; }
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
            SELECT 1 FROM merchant_products p WHERE p.store_id=s.id AND p.status='active' AND (p.image_data=$2 OR p.image_urls ? $2)))) AS public`, [id, url]);
      return rows[0]?.public === true;
    }
    const media = this.base.state.merchantMedia.find((item) => item.id === id);
    if (!media) return false;
    const store = this.base.state.merchantStores.find((item) => item.merchantId === media.merchantId && item.status === 'active' && item.isPublished);
    const merchant = this.base.state.merchants.find((item) => item.id === media.merchantId && item.status === 'active' && !item.deletedAt);
    if (!store || !merchant) return false;
    if (store.logo === url || store.coverImageUrl === url) return true;
    return this.base.state.merchantProducts.some((item) => item.storeId === store.id && item.status === 'active' &&
      (item.imageData === url || (item.imageUrls || []).includes(url)));
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
          EXISTS (SELECT 1 FROM merchant_order_items i JOIN merchant_orders o ON o.id=i.order_id WHERE o.merchant_id=$1 AND i.image_data=$2) AS used`, [merchantId, url]);
      if (rows[0]?.used) return { deleted: false, found: true, inUse: true };
      await this.base.pool.query('DELETE FROM merchant_media WHERE id=$1 AND merchant_id=$2', [id, merchantId]);
      return { deleted: true, found: true, inUse: false };
    }
    const store = this.base.state.merchantStores.find((row) => row.merchantId === merchantId);
    const used = (store && (store.logo === url || store.coverImageUrl === url || this.base.state.merchantProducts.some((product) => product.storeId === store.id && (product.imageData === url || (product.imageUrls || []).includes(url))))) ||
      this.base.state.merchantOrders.some((order) => order.merchantId === merchantId && (order.items || []).some((item) => item.imageData === url || (item.imageUrls || []).includes(url)));
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

  async listMerchants({ managerId = '' } = {}) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT m.id, m.username, m.display_name AS "displayName", m.email, m.phone, m.status, m.status_reason AS "statusReason",
          m.manager_id AS "managerId", m.must_change_password AS "mustChangePassword", m.password_reset_expires_at AS "passwordResetExpiresAt",
          m.created_at AS "createdAt", m.updated_at AS "updatedAt", m.last_login_at AS "lastLoginAt", m.deleted_at AS "deletedAt",
          s.id AS "storeId", s.slug AS "storeSlug", s.name AS "storeName", s.status AS "storeStatus", s.is_published AS "storePublished",
          s.qr_public_code AS "qrPublicCode", s.qr_scan_count AS "qrScanCount",
          (SELECT COUNT(*)::int FROM merchant_products p WHERE p.store_id=s.id AND p.status<>'archived') AS "productCount",
          (SELECT COUNT(*)::int FROM merchant_orders o WHERE o.store_id=s.id) AS "orderCount"
         FROM merchant_accounts m LEFT JOIN merchant_stores s ON s.merchant_id=m.id
         WHERE m.deleted_at IS NULL AND ($1='' OR m.manager_id=$1 OR EXISTS (
           SELECT 1 FROM merchant_manager_assignments a WHERE a.merchant_id=m.id AND a.manager_id=$1 AND
             (a.can_manage_store OR a.can_manage_products OR a.can_manage_orders OR a.can_create_store_qr OR a.can_view_audit)))
         ORDER BY m.created_at DESC`, [managerId]);
      return rows;
    }
    let rows = this.base.state.merchants.filter((item) => !item.deletedAt);
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
        storePublished: Boolean(store?.isPublished), qrPublicCode: store?.qrPublicCode || '', qrScanCount: Number(store?.qrScanCount) || 0,
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
          token_version=token_version+1, updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL AND must_change_password=TRUE RETURNING id`, [id, passwordHash]);
      return rows[0] ? this.getMerchantForAuth(id) : null;
    }
    const row = this.base.state.merchants.find((item) => item.id === id && !item.deletedAt && item.mustChangePassword);
    if (!row) return null;
    row.passwordHash = passwordHash; row.mustChangePassword = false; row.passwordResetExpiresAt = null;
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
             cover_image_url, theme, opening_hours, delivery_enabled, pickup_enabled, delivery_fee_xof, accepts_orders)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19) RETURNING id`,
          [uniqueId(), merchantId, data.slug, data.name, data.description || '', data.logo || '', data.phone || '', data.whatsapp || '', data.email || '', data.address || '', data.deliveryNote || '', data.isPublished === true,
            data.coverImageUrl || '', JSON.stringify(data.theme || {}), JSON.stringify(data.openingHours || {}), data.deliveryEnabled !== false, data.pickupEnabled !== false, data.deliveryFeeXof || 0, data.acceptsOrders !== false]);
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
      deliveryFeeXof: Number(data.deliveryFeeXof) || 0, acceptsOrders: data.acceptsOrders !== false,
      phone: data.phone || '', whatsapp: data.whatsapp || '', email: data.email || '', address: data.address || '', deliveryNote: data.deliveryNote || '',
      status: 'active', isPublished: data.isPublished === true, qrPublicCode: '', qrScanCount: 0, createdAt: now, updatedAt: now };
    this.base.state.merchantStores.push(row); await this.base.save(); return clone(row);
  }

  async getStoreById(id) {
    if (this.pg) {
      const { rows } = await this.base.pool.query(
        `SELECT id, merchant_id AS "merchantId", slug, name, description, logo, cover_image_url AS "coverImageUrl", theme,
          opening_hours AS "openingHours", delivery_enabled AS "deliveryEnabled", pickup_enabled AS "pickupEnabled", delivery_fee_xof AS "deliveryFeeXof",
          accepts_orders AS "acceptsOrders", phone, whatsapp, email, address, delivery_note AS "deliveryNote", status, is_published AS "isPublished",
          qr_public_code AS "qrPublicCode", qr_scan_count AS "qrScanCount", created_at AS "createdAt", updated_at AS "updatedAt"
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
          delivery_enabled=$15, pickup_enabled=$16, delivery_fee_xof=$17, accepts_orders=$18, updated_at=NOW() WHERE id=$1 RETURNING id`,
        [id, data.name, data.description || '', data.logo || '', data.phone || '', data.whatsapp || '', data.email || '', data.address || '', data.deliveryNote || '', data.status || 'active', data.isPublished === true,
          data.coverImageUrl || '', JSON.stringify(data.theme || {}), JSON.stringify(data.openingHours || {}), data.deliveryEnabled !== false, data.pickupEnabled !== false, data.deliveryFeeXof || 0, data.acceptsOrders !== false]);
      return rows[0] ? this.getStoreById(id) : null;
    }
    const row = this.base.state.merchantStores.find((s) => s.id === id);
    if (!row) return null;
    Object.assign(row, { name: data.name, description: data.description || '', logo: data.logo || '', coverImageUrl: data.coverImageUrl || '',
      theme: clone(data.theme || {}), openingHours: clone(data.openingHours || {}), deliveryEnabled: data.deliveryEnabled !== false, pickupEnabled: data.pickupEnabled !== false,
      deliveryFeeXof: Number(data.deliveryFeeXof) || 0, acceptsOrders: data.acceptsOrders !== false,
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
    if (merchant && merchant.status !== 'active') return null;
    return { store: this.publicStore(store), products, merchantActive: true };
  }

  async getPublicShopByQr(code) {
    const store = this.pg
      ? await this._publicStoreQuery('s.qr_public_code=$1', [code])
      : this.base.state.merchantStores.find((s) => s.qrPublicCode === code && s.status === 'active' && s.isPublished);
    if (!store || store.status !== 'active' || !store.isPublished) return null;
    const merchant = this.pg ? null : this.base.state.merchants.find((m) => m.id === store.merchantId);
    if (merchant && merchant.status !== 'active') return null;
    return { ...this.publicStore(store), merchantId: store.merchantId };
  }

  async _publicStoreQuery(where, params) {
    const { rows } = await this.base.pool.query(
      `SELECT s.id, s.merchant_id AS "merchantId", s.slug, s.name, s.description, s.logo, s.cover_image_url AS "coverImageUrl", s.theme,
        s.opening_hours AS "openingHours", s.delivery_enabled AS "deliveryEnabled", s.pickup_enabled AS "pickupEnabled", s.delivery_fee_xof AS "deliveryFeeXof",
        s.accepts_orders AS "acceptsOrders", s.phone, s.whatsapp, s.email, s.address, s.delivery_note AS "deliveryNote", s.status,
        s.is_published AS "isPublished", s.qr_public_code AS "qrPublicCode", s.qr_scan_count AS "qrScanCount"
       FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id
       WHERE ${where} AND s.status='active' AND s.is_published=TRUE AND m.status='active' AND m.deleted_at IS NULL`, params);
    return rows[0] || null;
  }

  publicStore(store) {
    if (!store) return null;
    const { merchantId, qrPublicCode, qrScanCount, ...data } = store;
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
    if (this.pg) {
      const current = await this.getStoreById(storeId);
      if (!current) return null;
      if (current.qrPublicCode) return { store: current, created: false };
      let code;
      for (let attempt = 0; attempt < 5; attempt++) {
        code = crypto.randomBytes(10).toString('base64url');
        try {
          const { rows } = await this.base.pool.query('UPDATE merchant_stores SET qr_public_code=$2, updated_at=NOW() WHERE id=$1 AND qr_public_code IS NULL RETURNING id', [storeId, code]);
          if (rows[0]) return { store: await this.getStoreById(storeId), created: true };
          const raced = await this.getStoreById(storeId);
          return { store: raced, created: false };
        } catch (error) { if (error.code !== '23505') throw error; }
      }
      throw new Error('Impossible de générer un lien QR unique.');
    }
    const store = this.base.state.merchantStores.find((s) => s.id === storeId);
    if (!store) return null;
    if (store.qrPublicCode) return { store: clone(store), created: false };
    let code = crypto.randomBytes(10).toString('base64url');
    while (this.base.state.merchantStores.some((s) => s.qrPublicCode === code)) code = crypto.randomBytes(10).toString('base64url');
    store.qrPublicCode = code; store.updatedAt = new Date().toISOString(); await this.base.save(); return { store: clone(store), created: true };
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
    const expectedIntent = data.intentHash || crypto.createHash('sha256').update(orderIntent(data)).digest('hex');
    if (this.pg) return this._createPgOrder({ ...data, intentHash: expectedIntent });
    return this.withJsonLock(async () => {
      const existing = this.base.state.merchantOrders.find((o) => o.storeId === data.storeId && o.clientRequestId === data.clientRequestId);
      if (existing) {
        if (existing.intentHash !== expectedIntent) { const error = new Error('Cette tentative de commande a déjà été utilisée avec un panier différent.'); error.code = 'IDEMPOTENCY_CONFLICT'; throw error; }
        return { order: safeOrder(existing), idempotent: true };
      }
      const store = this.base.state.merchantStores.find((s) => s.id === data.storeId && s.status === 'active' && s.isPublished && s.acceptsOrders !== false);
      if (!store) throw new Error('Cette boutique n’accepte pas de commandes actuellement.');
      const merchant = this.base.state.merchants.find((m) => m.id === store.merchantId && m.status === 'active' && !m.deletedAt);
      if (!merchant) throw new Error('Cette boutique n’accepte pas de commandes actuellement.');
      const items = this._validateJsonItems(store.id, data.items);
      const totalAmountXof = items.reduce((sum, item) => sum + item.quantity * item.unitPriceXof, 0);
      if (!Number.isSafeInteger(totalAmountXof) || totalAmountXof < 0 || totalAmountXof > 2_000_000_000) throw new Error('Le total de la commande dépasse le montant autorisé.');
      for (const item of items) {
        const product = this.base.state.merchantProducts.find((p) => p.id === item.productId && p.storeId === store.id);
        if (product.trackStock) product.stockQuantity -= item.quantity;
      }
      const now = new Date().toISOString();
      const order = { id: uniqueId(), storeId: store.id, merchantId: store.merchantId, reference: publicReference(), clientRequestId: data.clientRequestId,
        intentHash: expectedIntent, trackingTokenHash: data.trackingTokenHash, customerName: data.customerName, customerPhone: data.customerPhone, customerEmail: data.customerEmail || '',
        deliveryAddress: data.deliveryAddress, note: data.note || '', items, totalAmountXof, currency: 'XOF', status: 'pending',
        stockReserved: true, events: [{ status: 'pending', note: 'Commande reçue.', actor: 'client', createdAt: now }], createdAt: now, updatedAt: now };
      this.base.state.merchantOrders.push(order);
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
      const live = await client.query(
        `SELECT s.id, s.merchant_id, s.accepts_orders FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id
         WHERE s.id=$1 AND s.status='active' AND s.is_published=TRUE AND s.accepts_orders=TRUE AND m.status='active' AND m.deleted_at IS NULL FOR UPDATE OF s`, [data.storeId]);
      if (!live.rows[0]) throw new Error('Cette boutique n’accepte pas de commandes actuellement.');
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
      for (const item of items) if (products.get(item.productId).trackStock) {
        await client.query('UPDATE merchant_products SET stock_quantity=stock_quantity-$2, updated_at=NOW() WHERE id=$1', [item.productId, item.quantity]);
      }
      const id = uniqueId(); const reference = publicReference();
      await client.query(
        `INSERT INTO merchant_orders (id, store_id, merchant_id, public_reference, client_request_id, intent_hash, customer_name, customer_phone,
          customer_email, delivery_address, note, total_amount_xof, status, stock_reserved, tracking_token_hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',TRUE,$13)`,
        [id, data.storeId, live.rows[0].merchant_id, reference, data.clientRequestId, data.intentHash, data.customerName, data.customerPhone,
          data.customerEmail || '', data.deliveryAddress, data.note || '', totalAmountXof, data.trackingTokenHash]);
      for (const item of items) await client.query(
        'INSERT INTO merchant_order_items (id, order_id, product_id, product_name, quantity, unit_price_xof, image_data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [uniqueId(), id, item.productId, item.name, item.quantity, item.unitPriceXof, item.imageData]);
      await client.query('INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id) VALUES ($1,$2,$3,$4,$5,$6)',
        [uniqueId(), id, 'pending', 'Commande reçue.', 'client', null]);
      await client.query(`INSERT INTO merchant_notifications (id,merchant_id,order_id,notification_type,dedupe_key,title,message,data)
        VALUES ($1,$2,$3,'new_order',$4,$5,$6,$7::jsonb) ON CONFLICT (merchant_id,dedupe_key) DO NOTHING`,
        [uniqueId(), live.rows[0].merchant_id, id, `order:${id}:new`, 'Nouvelle commande reçue', `Commande ${reference}`, JSON.stringify({ orderId: id, reference })]);
      await client.query('COMMIT'); return { order: await this.getOrder(id), idempotent: false };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
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
          total_amount_xof AS "totalAmountXof", currency, status, stock_reserved AS "stockReserved", created_at AS "createdAt", updated_at AS "updatedAt"
         FROM merchant_orders WHERE id=$1`, [id]);
      if (!rows[0]) return null;
      return this._pgOrderDetails(rows[0]);
    }
    return safeOrder(this.base.state.merchantOrders.find((o) => o.id === id) || null);
  }

  async _pgOrderDetails(row) {
    const [items, events] = await Promise.all([
      this.base.pool.query('SELECT product_id AS "productId", product_name AS name, quantity, unit_price_xof AS "unitPriceXof", image_data AS "imageData" FROM merchant_order_items WHERE order_id=$1 ORDER BY id', [row.id]),
      this.base.pool.query('SELECT status, note, actor_type AS "actorType", created_at AS "createdAt" FROM merchant_order_events WHERE order_id=$1 ORDER BY created_at', [row.id]),
    ]);
    return safeOrder({ ...row, items: items.rows, events: events.rows });
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
    return { data: rows.slice(offset, offset + limit).map(safeOrder), total, page, limit };
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
      const { rows } = await this.base.pool.query('SELECT id FROM merchant_orders WHERE public_reference=$1 AND tracking_token_hash=$2', [reference, tokenHash]);
      return rows[0] ? this.getOrder(rows[0].id) : null;
    }
    const order = this.base.state.merchantOrders.find((o) => o.reference === reference && o.trackingTokenHash === tokenHash);
    return safeOrder(order || null);
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
        if (status === 'cancelled' && before.stock_reserved) {
          const items = await client.query('SELECT product_id AS id, quantity FROM merchant_order_items WHERE order_id=$1', [id]);
          for (const item of items.rows) if (item.id) await client.query('UPDATE merchant_products SET stock_quantity=stock_quantity+$2, updated_at=NOW() WHERE id=$1', [item.id, item.quantity]);
        }
        await client.query('UPDATE merchant_orders SET status=$2, stock_reserved=CASE WHEN $2=\'cancelled\' THEN FALSE ELSE stock_reserved END, updated_at=NOW() WHERE id=$1', [id, status]);
        await client.query('INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id) VALUES ($1,$2,$3,$4,$5,$6)', [uniqueId(), id, status, safeStatusNote(status, note), actorType, actorId || null]);
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
      if (status === 'cancelled' && order.stockReserved) {
        for (const item of order.items) {
          const product = this.base.state.merchantProducts.find((p) => p.id === item.productId);
          if (product?.trackStock) product.stockQuantity += item.quantity;
        }
        order.stockReserved = false;
      }
      order.status = status; order.updatedAt = new Date().toISOString();
      order.events.push({ status, note: safeStatusNote(status, note), actor: actorType, actorId, createdAt: order.updatedAt });
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
            (SELECT COALESCE(SUM(o.total_amount_xof),0)::bigint FROM merchant_orders o WHERE o.status<>'cancelled' AND ($1='' OR o.merchant_id=$1)) AS order_value_xof,
            (SELECT COALESCE(SUM(o.total_amount_xof),0)::bigint FROM merchant_orders o WHERE o.status='completed' AND ($1='' OR o.merchant_id=$1)) AS completed_order_value_xof,
            (SELECT COALESCE(SUM(s.qr_scan_count),0)::bigint FROM merchant_stores s JOIN merchant_accounts m ON m.id=s.merchant_id WHERE ($1='' OR m.id=$1) AND m.deleted_at IS NULL) AS qr_scans`, [merchantId]),
        this.base.pool.query(
          `SELECT i.product_id AS "productId", i.product_name AS name, SUM(i.quantity)::int AS quantity, SUM(i.quantity*i.unit_price_xof)::bigint AS "orderValueXof"
           FROM merchant_order_items i JOIN merchant_orders o ON o.id=i.order_id WHERE o.status<>'cancelled' AND ($1='' OR o.merchant_id=$1)
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
    for (const order of orders.filter((item) => item.status !== 'cancelled')) for (const item of order.items || []) {
      const row = productTotals.get(item.productId) || { productId: item.productId, name: item.name, quantity: 0, orderValueXof: 0 };
      row.quantity += Number(item.quantity) || 0; row.orderValueXof += Number(item.quantity) * Number(item.unitPriceXof); productTotals.set(item.productId, row);
    }
    const recentOrders = orders.slice().sort((a,b) => String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,5).map(safeOrder);
    return { stores: stores.length, products: products.length, availableProducts: products.filter((p) => p.status === 'active' && (!p.trackStock || Number(p.stockQuantity)>0)).length,
      outOfStock: products.filter((p) => p.status === 'active' && p.trackStock && Number(p.stockQuantity)===0).length, orders: orders.length,
      pendingOrders: orders.filter((o) => o.status === 'pending').length, completedOrders: orders.filter((o) => o.status === 'completed').length,
      cancelledOrders: orders.filter((o) => o.status === 'cancelled').length, orderValueXof: orders.filter((o) => o.status !== 'cancelled').reduce((sum,o)=>sum+o.totalAmountXof,0),
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
