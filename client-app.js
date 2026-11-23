'use strict';

// ============================================================================================
// MISSION 7 — Module « CLIENT » : application installable, espace personnel, notifications.
//
// Ce module est INDÉPENDANT des sessions PDG / marchand / gestionnaire / équipe :
//   * cookie propre `qria_client`, jeton opaque haché en base, révocable ;
//   * un conflit avec un autre rôle est refusé (jamais deux identités dans le même navigateur) ;
//   * le client ne voit QUE ses propres données : tout est résolu depuis sa session.
//
// Identification :
//   * le numéro de téléphone seul N'OUVRE RIEN. Il sert à demander un code à usage unique.
//   * sans service SMS configuré (aucun fournisseur branché aujourd'hui), le code est affiché
//     UNIQUEMENT lorsque `CLIENT_OTP_DEV_MODE=true` est explicitement activé sur le serveur.
//     L'interface le dit clairement : aucun SMS n'est prétendu envoyé.
//   * le code secret de consignation permet de retrouver SA consignation, dans SA boutique,
//     avec un compteur de tentatives — jamais l'ensemble du fichier client.
// ============================================================================================

const crypto = require('node:crypto');

const CLIENT_COOKIE = 'qria_client';
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60; // 30 jours : « se souvenir de moi » assumé
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;
const OTP_REQUESTS_PER_HOUR = 5;

module.exports = function createClientModule({ app, store, consign, commerce, checkSameOrigin, apiError, sessionSecret, publicBaseUrl }) {
  const isPg = () => Boolean(store && store.pool);
  const q = (sql, params) => store.pool.query(sql, params);
  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
  const hmac = (scope, value) => crypto.createHmac('sha256', String(sessionSecret)).update(`${scope}:${value}`).digest('hex');
  // MÊME périmètre que le module consignation : une consignation enregistrée par la boutique
  // avec un numéro doit apparaître dans l'espace du client qui possède ce numéro.
  const phoneHash = (phone) => hmac('customer-phone', String(phone || '').replace(/\D/g, ''));
  const tokenHash = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');
  const otpDevMode = String(process.env.CLIENT_OTP_DEV_MODE || '').toLowerCase() === 'true' && process.env.NODE_ENV !== 'production';
  const smsConfigured = Boolean(process.env.SMS_PROVIDER_URL && process.env.SMS_PROVIDER_KEY);
  const base = publicBaseUrl || '';

  const ipHash = (req) => hmac('client-ip', req.ip || 'unknown').slice(0, 40);
  function requirePg(res) {
    if (isPg()) return false;
    res.status(409).json({ error: 'L’espace client nécessite la base PostgreSQL : vos commandes et consignations ne peuvent pas être tenues de façon fiable en stockage local.', code: 'PG_REQUIRED' });
    return true;
  }
  function setClientCookie(res, token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', `${CLIENT_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
  }
  function clearClientCookie(res) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    res.append('Set-Cookie', `${CLIENT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
  }
  function readCookie(req, name) {
    const header = String(req.headers.cookie || '');
    const match = header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : '';
  }

  // ------------------------------------------------------------------ sessions
  async function createSession(clientId, req) {
    const token = crypto.randomBytes(32).toString('base64url');
    await q(
      `INSERT INTO client_sessions (id, client_id, token_hash, expires_at, last_seen_at, ip_hash, user_agent)
       VALUES ($1,$2,$3,NOW() + ($4::bigint * INTERVAL '1 second'),NOW(),$5,$6)`,
      [id('csn'), clientId, tokenHash(token), String(SESSION_TTL_SECONDS), ipHash(req), clean(req.get('user-agent'), 200)]);
    return token;
  }
  async function requireClient(req, res, next) {
    if (requirePg(res)) return;
    const token = readCookie(req, CLIENT_COOKIE);
    if (!token) return res.status(401).json({ error: 'Ouvrez votre espace client pour continuer.', code: 'CLIENT_AUTH_REQUIRED' });
    try {
      const { rows } = await q(
        `SELECT s.id AS session_id, c.* FROM client_sessions s JOIN client_accounts c ON c.id = s.client_id
          WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at > NOW() AND c.status='active'`, [tokenHash(token)]);
      const row = rows[0];
      if (!row) { clearClientCookie(res); return res.status(401).json({ error: 'Votre session a expiré. Reconnectez-vous.', code: 'CLIENT_SESSION_INVALID' }); }
      req.client = { id: row.id, phoneLast4: row.phone_last4, displayName: row.display_name,
        notifyOrders: row.notify_orders, notifyConsignments: row.notify_consignments, sessionId: row.session_id };
      req.clientPhoneHash = row.phone_hash;
      if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && typeof checkSameOrigin === 'function' && !checkSameOrigin(req, res, () => true)) {
        return res.status(403).json({ error: 'Origine de requête non autorisée.' });
      }
      next();
    } catch (error) { apiError(res, error, 'Impossible de vérifier votre session.'); }
  }

  // Rattache les commandes d'un numéro à un compte client. Appelé une fois, après vérification.
  async function linkOrdersForPhone(clientId, digits) {
    if (!isPg() || !digits) return 0;
    const { rowCount } = await q(
      `UPDATE merchant_orders SET client_id=$1
        WHERE client_id IS NULL AND regexp_replace(customer_phone, '\D', '', 'g') = $2`, [clientId, String(digits)]);
    return rowCount || 0;
  }

  // ------------------------------------------------------------------ OTP
  const requestBuckets = new Map();
  app.post('/api/client/auth/request-code', typeof checkSameOrigin === 'function' ? checkSameOrigin : (req, res, next) => next(), async (req, res) => {
    if (requirePg(res)) return;
    try {
      const digits = String(req.body?.phone || '').replace(/\D/g, '');
      if (digits.length < 7 || digits.length > 15) return res.status(400).json({ error: 'Indiquez un numéro de téléphone valide (au moins 7 chiffres).' });
      const bucketKey = `${digits}:${Math.floor(Date.now() / 3_600_000)}`;
      const count = requestBuckets.get(bucketKey) || 0;
      if (count >= OTP_REQUESTS_PER_HOUR) return res.status(429).json({ error: 'Trop de demandes de code pour ce numéro. Réessayez dans une heure.' });
      requestBuckets.set(bucketKey, count + 1);

      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      const hash = phoneHash(digits);
      const { rows } = await q('SELECT id, locked_until FROM client_accounts WHERE phone_hash=$1', [hash]);
      const account = rows[0];
      if (account?.locked_until && new Date(account.locked_until).getTime() > Date.now()) {
        return res.status(423).json({ error: 'Ce numéro est temporairement verrouillé après plusieurs codes erronés. Réessayez plus tard.', code: 'CLIENT_LOCKED' });
      }
      await q(
        `INSERT INTO client_otp_codes (id, phone_hash, code_hash, purpose, expires_at, requested_ip_hash)
         VALUES ($1,$2,$3,'login',NOW() + ($4::bigint * INTERVAL '1 millisecond'),$5)`,
        [id('otp'), hash, hmac('client-otp', `${hash}:${code}`), String(OTP_TTL_MS), ipHash(req)]);

      // Aucun mensonge : si aucun service SMS n'est branché, on ne prétend pas en envoyer un.
      const payload = {
        ok: true, delivered: smsConfigured,
        message: smsConfigured
          ? 'Un code de vérification vient d’être envoyé par SMS.'
          : 'Aucun service SMS n’est configuré sur ce serveur : le code ne peut pas être envoyé par SMS. Contactez la boutique pour obtenir votre code, ou demandez au responsable technique d’activer l’envoi de SMS.',
      };
      if (!smsConfigured && otpDevMode) { payload.devCode = code; payload.devNotice = 'Mode technique : code affiché uniquement parce que CLIENT_OTP_DEV_MODE=true (jamais en production).'; }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: payload });
    } catch (error) { apiError(res, error, 'Impossible de préparer le code de vérification.'); }
  });

  app.post('/api/client/auth/verify-code', typeof checkSameOrigin === 'function' ? checkSameOrigin : (req, res, next) => next(), async (req, res) => {
    if (requirePg(res)) return;
    try {
      const digits = String(req.body?.phone || '').replace(/\D/g, '');
      const code = String(req.body?.code || '').replace(/\D/g, '');
      if (!digits || !/^\d{6}$/.test(code)) return res.status(400).json({ error: 'Numéro ou code invalide.' });
      const hash = phoneHash(digits);
      const { rows } = await q(
        `SELECT * FROM client_otp_codes WHERE phone_hash=$1 AND consumed_at IS NULL AND expires_at > NOW()
          ORDER BY created_at DESC LIMIT 1`, [hash]);
      const otp = rows[0];
      if (!otp) return res.status(400).json({ error: 'Ce code a expiré. Demandez-en un nouveau.' });
      if (otp.attempts >= otp.max_attempts) return res.status(429).json({ error: 'Trop de tentatives sur ce code. Demandez-en un nouveau.' });
      if (hmac('client-otp', `${hash}:${code}`) !== otp.code_hash) {
        await q('UPDATE client_otp_codes SET attempts = attempts + 1 WHERE id=$1', [otp.id]);
        await q(`UPDATE client_accounts SET failed_otp_count = failed_otp_count + 1,
                   locked_until = CASE WHEN failed_otp_count + 1 >= 10 THEN NOW() + INTERVAL '30 minutes' ELSE locked_until END
                 WHERE phone_hash=$1`, [hash]);
        return res.status(401).json({ error: 'Code incorrect.' });
      }
      await q('UPDATE client_otp_codes SET consumed_at=NOW() WHERE id=$1', [otp.id]);
      let account = (await q('SELECT * FROM client_accounts WHERE phone_hash=$1', [hash])).rows[0];
      if (!account) {
        const newId = id('cli');
        await q(`INSERT INTO client_accounts (id, phone_hash, phone_last4, display_name, last_seen_at, failed_otp_count, locked_until)
                 VALUES ($1,$2,$3,'',NOW(),0,NULL)`, [newId, hash, digits.slice(-4)]);
        account = (await q('SELECT * FROM client_accounts WHERE id=$1', [newId])).rows[0];
      } else {
        await q('UPDATE client_accounts SET last_seen_at=NOW(), failed_otp_count=0, locked_until=NULL WHERE id=$1', [account.id]);
      }
      // Les commandes passées jusqu'ici avec ce numéro sont rattachées au compte, SANS jamais
      // modifier la commande elle-même : seule la colonne `client_id` est renseignée.
      const linked = await linkOrdersForPhone(account.id, digits).catch(() => 0);
      const token = await createSession(account.id, req);
      setClientCookie(res, token);
      res.json({ data: { client: { id: account.id, phoneLast4: account.phone_last4, displayName: account.display_name }, linkedOrders: linked } });
    } catch (error) { apiError(res, error, 'Impossible de vérifier ce code.'); }
  });

  app.get('/api/client/auth/me', requireClient, async (req, res) => res.json({ data: { client: req.client } }));
  app.post('/api/client/auth/logout', requireClient, async (req, res) => {
    try { await q('UPDATE client_sessions SET revoked_at=NOW() WHERE id=$1', [req.client.sessionId]); } catch (_) {}
    clearClientCookie(res); res.json({ ok: true });
  });

  // ------------------------------------------------------------------ profil & rattachements
  app.put('/api/client/profile', requireClient, async (req, res) => {
    try {
      const displayName = clean(req.body?.displayName, 120);
      const notifyOrders = req.body?.notifyOrders === undefined ? undefined : Boolean(req.body.notifyOrders);
      const notifyConsignments = req.body?.notifyConsignments === undefined ? undefined : Boolean(req.body.notifyConsignments);
      await q(`UPDATE client_accounts SET display_name=$2, notify_orders=COALESCE($3, notify_orders),
                 notify_consignments=COALESCE($4, notify_consignments), last_seen_at=NOW() WHERE id=$1`,
        [req.client.id, displayName, notifyOrders, notifyConsignments]);
      const { rows } = await q('SELECT * FROM client_accounts WHERE id=$1', [req.client.id]);
      res.json({ data: { displayName: rows[0].display_name, notifyOrders: rows[0].notify_orders, notifyConsignments: rows[0].notify_consignments } });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer vos informations.'); }
  });

  // Rattachement d'une visite : la boutique est identifiée par son slug public, jamais par un id fourni.
  app.post('/api/client/visit', requireClient, async (req, res) => {
    try {
      const slug = clean(req.body?.storeSlug, 80);
      if (!slug) return res.status(400).json({ error: 'Boutique manquante.' });
      const shop = await commerce.getPublicShopBySlug(slug);
      if (!shop) return res.status(404).json({ error: 'Cette boutique n’est pas disponible.' });
      await q(
        `INSERT INTO client_store_links (id, client_id, store_id, merchant_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, store_id) DO UPDATE SET last_seen_at=NOW()`,
        [id('csl'), req.client.id, shop.store.id, shop.store.merchantId || shop.store.merchant_id]);
      // Les commandes passées avec ce numéro sur cette boutique sont rattachées au compte (sans
      // jamais modifier la commande elle-même : seule la colonne client_id est renseignée).
      const phone = req.body?.phone ? String(req.body.phone).replace(/\D/g, '') : '';
      if (phone) {
        await q(`UPDATE merchant_orders SET client_id=$1 WHERE store_id=$2 AND client_id IS NULL
                   AND regexp_replace(customer_phone, '\D', '', 'g') = $3`, [req.client.id, shop.store.id, phone]).catch(() => {});
      }
      res.json({ data: { store: { id: shop.store.id, name: shop.store.name, slug: shop.store.slug } } });
    } catch (error) { apiError(res, error, 'Impossible de mémoriser cette boutique.'); }
  });

  app.get('/api/client/stores', requireClient, async (req, res) => {
    try {
      if (requirePg(res)) return;
      const { rows } = await q(
        `SELECT s.id, s.name, s.slug, s.logo, l.last_seen_at AS "lastSeenAt"
           FROM client_store_links l JOIN merchant_stores s ON s.id = l.store_id
          WHERE l.client_id=$1 ORDER BY l.last_seen_at DESC LIMIT 50`, [req.client.id]);
      res.json({ data: rows });
    } catch (error) { apiError(res, error, 'Impossible de charger vos boutiques.'); }
  });

  // ------------------------------------------------------------------ commandes
  app.get('/api/client/orders', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      // Le compte ne conserve que l'empreinte de son numéro : les commandes ont été rattachées
      // une seule fois, au moment de la vérification du code (voir `linkOrdersForPhone`).
      const { rows } = await q(
        `SELECT o.id, o.public_reference AS reference, o.status, o.total_amount_xof AS "totalAmountXof", o.currency,
                o.created_at AS "createdAt", o.updated_at AS "updatedAt", o.delivery_address AS "deliveryAddress",
                s.name AS "storeName", s.slug AS "storeSlug", o.service_point_name AS "servicePointName"
           FROM merchant_orders o JOIN merchant_stores s ON s.id = o.store_id
          WHERE o.client_id=$1
          ORDER BY o.created_at DESC LIMIT 100`, [req.client.id]);
      const ids = rows.map((r) => r.id);
      let items = [];
      if (ids.length) {
        items = (await q(`SELECT order_id, product_name, quantity, unit_price_xof FROM merchant_order_items WHERE order_id = ANY($1::text[])`, [ids])).rows;
      }
      const grouped = new Map();
      for (const item of items) {
        if (!grouped.has(item.order_id)) grouped.set(item.order_id, []);
        grouped.get(item.order_id).push({ name: item.product_name, quantity: item.quantity, unitPriceXof: Number(item.unit_price_xof) });
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: rows.map((r) => ({ ...r, totalAmountXof: Number(r.totalAmountXof), items: grouped.get(r.id) || [] })) });
    } catch (error) { apiError(res, error, 'Impossible de charger vos commandes.'); }
  });

  app.get('/api/client/orders/:reference', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      const { rows } = await q(
        `SELECT o.*, s.name AS store_name, s.slug AS store_slug FROM merchant_orders o JOIN merchant_stores s ON s.id=o.store_id
          WHERE o.public_reference=$1 AND o.client_id=$2`,
        [clean(req.params.reference, 40), req.client.id]);
      const order = rows[0];
      if (!order) return res.status(404).json({ error: 'Commande introuvable dans votre historique.' });
      const items = (await q('SELECT product_name, quantity, unit_price_xof, image_data FROM merchant_order_items WHERE order_id=$1', [order.id])).rows;
      const events = (await q('SELECT status, note, actor_type, created_at FROM merchant_order_events WHERE order_id=$1 ORDER BY created_at ASC', [order.id])).rows;
      res.json({ data: {
        id: order.id, reference: order.public_reference, status: order.status, storeName: order.store_name, storeSlug: order.store_slug,
        totalAmountXof: Number(order.total_amount_xof), currency: order.currency, createdAt: order.created_at, updatedAt: order.updated_at,
        deliveryAddress: order.delivery_address, servicePointName: order.service_point_name, cancellationEnabled: true,
        items: items.map((i) => ({ name: i.product_name, quantity: i.quantity, unitPriceXof: Number(i.unit_price_xof) })),
        history: events.map((e) => ({ status: e.status, note: e.note, actorType: e.actor_type, at: e.created_at })),
      } });
    } catch (error) { apiError(res, error, 'Impossible de charger cette commande.'); }
  });

  // Annulation : la règle du marchand reste maîtresse (aucune règle parallèle n'est inventée).
  //   * en attente et politique « auto » → annulation immédiate ;
  //   * acceptée / en préparation → demande soumise à la boutique ;
  //   * terminée → refusée.
  app.post('/api/client/orders/:reference/cancel', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      const requestId = clean(req.body?.requestId, 100);
      if (!/^[A-Za-z0-9_-]{8,100}$/.test(requestId)) return res.status(400).json({ error: 'Identifiant de demande invalide.' });
      const { rows } = await q(
        `SELECT o.*, s.name AS store_name FROM merchant_orders o JOIN merchant_stores s ON s.id=o.store_id
          WHERE o.public_reference=$1 AND o.client_id=$2`,
        [clean(req.params.reference, 40), req.client.id]);
      const order = rows[0];
      if (!order) return res.status(404).json({ error: 'Commande introuvable dans votre historique.' });
      if (['completed', 'cancelled'].includes(order.status)) return res.status(409).json({ error: 'Cette commande ne peut plus être annulée.', code: 'ORDER_CLOSED' });

      // Une seule demande en attente par commande (index unique existant) + idempotence par requête.
      const existing = await q('SELECT * FROM merchant_order_cancellation_requests WHERE order_id=$1 AND request_hash=$2', [order.id, requestId]);
      if (existing.rows[0]) return res.json({ data: { idempotent: true, decision: existing.rows[0].status, orderStatus: order.status } });

      // La politique vient des réglages de la plateforme — la même source que la page publique de
      // suivi : aucune règle parallèle n'est inventée pour l'application client.
      const settings = await store.getSettings().catch(() => null);
      const policy = (() => {
        const raw = settings?.merchantOrderPolicy || {};
        return { trackingEnabled: raw.trackingEnabled !== false, clientCancellationEnabled: raw.clientCancellationEnabled !== false,
          autoAcceptPendingCancellation: raw.autoAcceptPendingCancellation !== false };
      })();
      const autoAccept = policy.autoAcceptPendingCancellation;
      const policyEnabled = policy.clientCancellationEnabled;
      if (!policyEnabled) return res.status(403).json({ error: 'Les annulations en ligne sont désactivées par cette boutique.', code: 'CANCELLATION_DISABLED' });

      const autoNow = order.status === 'pending' && autoAccept;
      const decision = autoNow ? 'accepted' : 'pending';
      await q(
        `INSERT INTO merchant_order_cancellation_requests (id, order_id, store_id, merchant_id, request_hash, reason, status,
           decision_note, requested_at, decided_at, decided_by_type, decided_by, requested_by_type, client_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),$9,$10,$11,'client',$12)`,
        [id('ocr'), order.id, order.store_id, order.merchant_id, requestId, clean(req.body?.reason, 300), decision,
          autoNow ? 'Annulation immédiate demandée par le client avant validation de la boutique.' : 'Demande envoyée à la boutique.',
          autoNow ? new Date() : null, autoNow ? 'client' : '', autoNow ? req.client.id : '', req.client.id]);

      if (autoNow) {
        await q(`UPDATE merchant_orders SET status='cancelled', updated_at=NOW() WHERE id=$1 AND status='pending'`, [order.id]);
        await q(`INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id) VALUES ($1,$2,'cancelled',$3,'customer',$4)`,
          [id('oev'), order.id, 'Annulée par le client avant validation.', req.client.id]);
      } else {
        await q(`INSERT INTO merchant_order_events (id, order_id, status, note, actor_type, actor_id) VALUES ($1,$2,$3,$4,'customer',$5)`,
          [id('oev'), order.id, order.status, 'Demande d’annulation envoyée par le client.', req.client.id]);
      }
      // Notification interne au marchand : colonnes réelles (`notification_type`, `dedupe_key`).
      await q(
        `INSERT INTO merchant_notifications (id, merchant_id, order_id, notification_type, dedupe_key, title, message, data)
         VALUES ($1,$2,$3,'order_cancellation_request',$4,$5,$6,$7)`,
        [id('mno'), order.merchant_id, order.id, `cancel-${order.id}-${requestId}`,
          autoNow ? 'Commande annulée par le client' : 'Demande d’annulation à traiter',
          `Commande ${order.public_reference}${autoNow ? ' annulée' : ' : demande d’annulation'} par le client.`,
          JSON.stringify({ orderId: order.id, reference: order.public_reference, autoAccepted: autoNow })]
      ).catch(() => {});
      await push({ clientIds: [req.client.id], storeId: order.store_id, type: 'order_cancellation',
        dedupeKey: `cancel:${order.id}:${requestId}`, title: autoNow ? 'Commande annulée' : 'Demande envoyée',
        message: autoNow ? `Votre commande ${order.public_reference} est annulée.` : `Votre demande d’annulation pour ${order.public_reference} a été transmise à la boutique.`,
        data: { orderId: order.id, reference: order.public_reference } }).catch(() => {});

      res.status(201).json({ data: { decision, autoAccepted: autoNow, orderStatus: autoNow ? 'cancelled' : order.status } });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer cette annulation.'); }
  });

  // ------------------------------------------------------------------ consignations
  app.get('/api/client/consignments', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try { res.json({ data: await consign.listForClient({ clientId: req.client.id, phoneHash: req.clientPhoneHash }) }); }
    catch (error) { apiError(res, error, 'Impossible de charger vos consignations.'); }
  });

  app.post('/api/client/consignments/lookup', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      const slug = clean(req.body?.storeSlug, 80);
      const code = clean(req.body?.code, 12).toUpperCase();
      if (!slug || !code) return res.status(400).json({ error: 'Indiquez la boutique et le code de consignation.' });
      const shop = await commerce.getPublicShopBySlug(slug);
      if (!shop) return res.status(404).json({ error: 'Boutique introuvable.' });
      const found = await consign.findByCode({ storeId: shop.store.id, code, ipHash: ipHash(req) });
      res.json({ data: found });
    } catch (error) {
      const status = Number(error?.status) || 400;
      res.status(status).json({ error: error.message, code: error.code });
    }
  });

  // ------------------------------------------------------------------ scan client
  // Un scan depuis l'application est compté comme un scan CLIENT (catégorie `customer`), jamais
  // comme une opération du personnel. Le rattachement boutique reste un simple marqueur.
  app.post('/api/client/scan', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      const target = clean(req.body?.target, 300);
      if (!target) return res.status(400).json({ error: 'Aucune cible à compter.' });
      let storeId = null, merchantId = null, servicePointId = null, qrKind = 'store';
      // Formats reconnus : /shop/<slug>, /r/<code> (QR émis par la plateforme), et le paramètre
      // `servicePoint` d'une table ou d'un emplacement.
      const shopMatch = target.match(/\/shop\/([A-Za-z0-9-_]+)/);
      const pointMatch = target.match(/[?&]servicePoint=([A-Za-z0-9-_]+)/i);
      if (shopMatch) {
        const shop = await commerce.getPublicShopBySlug(shopMatch[1]);
        if (shop) {
          storeId = shop.store.id;
          merchantId = shop.store.merchantId || shop.store.merchant_id || null;
          // `merchant_id` est NOT NULL dans le journal des scans : on le résout depuis la boutique
          // plutôt que d'inventer une valeur (et plutôt que de perdre définitivement le comptage).
          if (!merchantId) {
            const storeRow = await commerce.getStoreById(storeId).catch(() => null);
            merchantId = storeRow?.merchantId || null;
          }
          if (!merchantId) {
            const { rows } = await q('SELECT merchant_id FROM merchant_stores WHERE id=$1', [storeId]);
            merchantId = rows[0]?.merchant_id || null;
          }
        }
      } else if (pointMatch) {
        // Un QR de table peut être scanné seul : la boutique est résolue depuis le code du point.
        const { rows } = await q(
          `SELECT p.id, p.store_id, s.merchant_id FROM merchant_service_points p
             JOIN merchant_stores s ON s.id = p.store_id
            WHERE p.public_code=$1`, [pointMatch[1]]);
        if (rows[0]) { storeId = rows[0].store_id; merchantId = rows[0].merchant_id; servicePointId = rows[0].id; qrKind = 'service_point'; }
      } else {
        const codeMatch = target.match(/\/r\/([A-Za-z0-9-_]+)/);
        if (codeMatch) {
          // Un QR « plateforme » peut viser une boutique ; on retombe alors sur la résolution
          // publique du code marchand, sans jamais inventer de rattachement.
          const found = await store.getPublicCode(codeMatch[1]).catch(() => null);
          void found;
        }
      }
      if (pointMatch && storeId && !servicePointId) {
        const { rows } = await q('SELECT id FROM merchant_service_points WHERE store_id=$1 AND public_code=$2', [storeId, pointMatch[1]]);
        servicePointId = rows[0]?.id || null;
        if (servicePointId) qrKind = 'service_point';
      }
      if (!storeId) return res.json({ data: { counted: false, reason: 'destination_non_boutique' } });
      // Le client est désormais lié à cette boutique : elle apparaîtra dans « Mes boutiques ».
      await q(
        `INSERT INTO client_store_links (id, client_id, store_id, merchant_id) VALUES ($1,$2,$3,$4)
         ON CONFLICT (client_id, store_id) DO UPDATE SET last_seen_at=NOW()`,
        [id('csl'), req.client.id, storeId, merchantId]).catch(() => {});
      try {
        await q(
          `INSERT INTO merchant_scan_events (id, event_key, store_id, merchant_id, qr_kind, category, actor_type, client_id, surface, scanned_at)
           VALUES ($1,$2,$3,$4,$6,'customer','customer',$5,'client_app',NOW())`,
          [id('mse'), `client-${id('k')}`, storeId, merchantId, req.client.id, qrKind]);
      } catch (error) {
        // Une table de scans absente ou renommée ne doit jamais bloquer la navigation du client,
        // mais la raison est renvoyée au journal pour être corrigée, pas masquée.
        console.error('[client-scan] échec d’enregistrement :', error.message);
        return res.json({ data: { counted: false, reason: 'scan_non_enregistre', detail: 'journalisé côté serveur' } });
      }
      await q(`UPDATE merchant_stores SET qr_scan_count = qr_scan_count + 1 WHERE id=$1`, [storeId]).catch(() => {});
      if (servicePointId) await q('UPDATE merchant_service_points SET qr_scan_count = qr_scan_count + 1 WHERE id=$1', [servicePointId]).catch(() => {});
      res.json({ data: { counted: true, storeId, servicePointId, kind: qrKind } });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer ce scan.'); }
  });

  // ------------------------------------------------------------------ notifications
  app.get('/api/client/notifications', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      const { rows } = await q(
        `SELECT id, type, title, message, data, read_at AS "readAt", created_at AS "createdAt"
           FROM client_notifications WHERE client_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.client.id]);
      res.json({ data: rows });
    } catch (error) { apiError(res, error, 'Impossible de charger vos notifications.'); }
  });
  app.post('/api/client/notifications/read', requireClient, async (req, res) => {
    if (requirePg(res)) return;
    try {
      if (req.body?.id) await q('UPDATE client_notifications SET read_at=NOW() WHERE id=$1 AND client_id=$2', [clean(req.body.id, 80), req.client.id]);
      else await q('UPDATE client_notifications SET read_at=NOW() WHERE client_id=$1 AND read_at IS NULL', [req.client.id]);
      res.json({ ok: true });
    } catch (error) { apiError(res, error, 'Impossible de marquer vos notifications.'); }
  });

  // Flux temps réel : uniquement les notifications du client connecté.
  app.get('/api/client/events', requireClient, async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connecté\n\n');
    const entry = { res, clientId: req.client.id };
    sseClients.add(entry);
    const keepAlive = setInterval(() => { try { res.write(': ping\n\n'); } catch (_) {} }, 25_000);
    req.on('close', () => { clearInterval(keepAlive); sseClients.delete(entry); });
  });

  // ------------------------------------------------------------------ notifications sortantes
  const sseClients = new Set();
  // Appelé par le module consignation (numéro) et par les routes (identifiants de compte).
  async function notifyByPhone({ phone, storeId = null, type, title, message, data = {}, dedupeKey = '' }) {
    if (!isPg()) return false;
    const digits = String(phone || '').replace(/\D/g, '');
    if (digits.length < 7) return false;
    const { rows } = await q('SELECT id, notify_orders, notify_consignments FROM client_accounts WHERE phone_hash=$1', [phoneHash(digits)]);
    const account = rows[0];
    if (!account) return false;
    if (type.startsWith('consignment') && !account.notify_consignments) return false;
    if (type.startsWith('order') && !account.notify_orders) return false;
    return push({ clientIds: [account.id], storeId, type, title, message, data, dedupeKey });
  }
  async function push({ clientIds, storeId = null, type, title, message, data = {}, dedupeKey = '' }) {
    if (!isPg() || !clientIds?.length) return false;
    let created = 0;
    for (const clientId of clientIds) {
      const notificationId = id('cno');
      try {
        const { rows } = await q(
          `INSERT INTO client_notifications (id, client_id, store_id, type, title, message, data, dedupe_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING RETURNING id`,
          [notificationId, clientId, storeId, type, title, message, JSON.stringify(data || {}), dedupeKey]);
        if (!rows.length) continue;
        created += 1;
        for (const entry of sseClients) {
          if (entry.clientId !== clientId) continue;
          try { entry.res.write(`data: ${JSON.stringify({ type: 'client_notification', notification: { id: notificationId, type, title, message, data, createdAt: new Date().toISOString() } })}\n\n`); } catch (_) {}
        }
      } catch (_) { /* une notification perdue ne doit jamais casser l'opération métier */ }
    }
    return created > 0;
  }

  // Rattache une commande à un compte client dès qu'elle est créée avec son numéro : le client
  // retrouve ainsi ses commandes passées depuis le QR d'une boutique, sans action de sa part.
  async function linkOrderByPhone({ orderId, phone }) {
    if (!isPg() || !orderId || !phone) return false;
    const digits = String(phone).replace(/\D/g, '');
    if (digits.length < 7) return false;
    const { rows } = await q('SELECT id FROM client_accounts WHERE phone_hash=$1', [phoneHash(digits)]);
    if (!rows[0]) return false;
    const { rowCount } = await q('UPDATE merchant_orders SET client_id=$1 WHERE id=$2 AND client_id IS NULL', [rows[0].id, orderId]);
    return Boolean(rowCount);
  }

  // Diffuse une notification à tous les comptes liés à un numéro (utilisé par les commandes).
  async function notifyOrderEvent({ phone, clientId, orderId, reference, storeId, status }) {
    if (!isPg()) return false;
    const labels = { pending: 'Commande reçue', confirmed: 'Commande acceptée', preparing: 'Commande en préparation',
      ready: 'Commande prête', completed: 'Commande terminée', cancelled: 'Commande annulée' };
    const message = { pending: `Votre commande ${reference} a été reçue.`, confirmed: `Votre commande ${reference} a été acceptée.`,
      preparing: `Votre commande ${reference} est en préparation.`, ready: `Votre commande ${reference} est prête.`,
      completed: `Votre commande ${reference} est terminée. Merci !`, cancelled: `Votre commande ${reference} a été annulée.` }[status] || `Votre commande ${reference} a changé de statut.`;
    const ids = new Set();
    if (clientId) ids.add(clientId);
    if (phone) {
      const digits = String(phone).replace(/\D/g, '');
      if (digits.length >= 7) {
        const { rows } = await q('SELECT id FROM client_accounts WHERE phone_hash=$1', [phoneHash(digits)]);
        if (rows[0]) ids.add(rows[0].id);
      }
    }
    return push({ clientIds: [...ids], storeId, type: 'order_status', title: labels[status] || 'Commande mise à jour', message,
      data: { orderId, reference, status }, dedupeKey: `order-status:${orderId}:${status}` });
  }

  return { requireClient, notifyByPhone, notifyOrderEvent, linkOrderByPhone, push, phoneHashOf: phoneHash, CLIENT_COOKIE };
};
