'use strict';

// ============================================================================================
// Mission 11 (sous-prompt 3) — « Voir les historiques ».
//
// Une seule route regroupe ce qui était éparpillé (activité de l'équipe, scans, commandes,
// consignations). Elle est OUVERTE À CHAQUE RÔLE, dans son propre périmètre :
//
//   GET /api/history?period=today|yesterday|week|month|custom|all&from=…&to=…&category=…&q=…
//
//   PDG            : toutes les boutiques (jamais de bouton pour franchir un autre périmètre)
//   Gestionnaire   : uniquement les marchands rattachés à son compte
//   Marchand       : uniquement son établissement (merchantId + storeId de sa session)
//   Gérant général : uniquement sa boutique ; l'ensemble de l'équipe si `activity.view`
//   Serveuse/Serveur : uniquement ses propres actions
//
// Aucune requête n'accepte un identifiant d'établissement fourni par le navigateur : il est
// toujours résolu depuis la session (cookie). Le filtre de texte est appliqué en SQL sur des
// colonnes bornées, jamais par concaténation libre.
//
// Lecture seule : ce module n'écrit rien, ne modifie aucun historique et n'en supprime aucun.
// ============================================================================================

const crypto = require('node:crypto');

const CATEGORIES = ['orders', 'scans', 'connections', 'operations', 'staff', 'consignments'];
const PERIODS = ['today', 'yesterday', 'week', 'month', 'custom', 'all'];

// Traduction des codes d'action internes en libellés lisibles. Un code inconnu reste affiché
// tel quel : aucune action n'est jamais masquée faute de traduction.
const ACTION_LABELS = {
  login_success: 'Connexion réussie', login_failure: 'Échec de connexion', logout: 'Déconnexion',
  member_created: 'Compte d’équipe créé', member_updated: 'Compte d’équipe modifié',
  member_suspended: 'Compte suspendu', member_activated: 'Compte activé', member_blocked: 'Compte bloqué',
  member_revoked: 'Compte révoqué', member_pending: 'Compte remis en attente',
  activation_code_issued: 'Code d’activation émis', password_reset_by_merchant: 'Mot de passe réinitialisé',
  permission_denied: 'Accès refusé', scan_success: 'Scan accepté', scan_refused: 'Scan refusé',
  service_point_created: 'Table ou emplacement créé', service_points_updated: 'Tables et emplacements mis à jour',
  service_point_updated: 'Table ou emplacement modifié', service_point_disabled: 'Table ou emplacement désactivé',
  store_updated: 'Établissement mis à jour', settings_updated: 'Réglages de l’équipe mis à jour',
  order_status: 'Statut de commande modifié', order_cancelled: 'Commande annulée', order_created: 'Commande créée',
  order_assigned: 'Commande affectée', order_reassigned: 'Commande réaffectée', order_unassigned: 'Commande retirée',
  task_assigned: 'Tâche attribuée', task_status: 'Tâche mise à jour',
  message_sent: 'Message envoyé', product_availability: 'Disponibilité produit', product_price: 'Prix produit',
  custom_lines_added: 'Ligne personnalisée ajoutée', point_adjust: 'Points ajustés',
  consignment_created: 'Consignation créée', consignment_movement: 'Mouvement de consignation',
  table_assigned: 'Table affectée', table_unassigned: 'Table libérée',
  scan_customer: 'Scan client (QR boutique ou table)', scan_merchant: 'Scan effectué par la boutique',
};

const RESULT_LABELS = { success: 'Succès', failure: 'Échec', denied: 'Refusé', pending: 'En cours' };

const CATEGORY_LABELS = {
  orders: 'Commandes', scans: 'Scans', connections: 'Connexions', operations: 'Opérations',
  staff: 'Activité du personnel', consignments: 'Consignations',
};

function categoryOfAction(action) {
  const value = String(action || '');
  if (/^scan/.test(value)) return 'scans';
  if (/log(in|out)|session|password|activation|member_/.test(value)) return 'connections';
  if (/order|table_assign|table_unassign|task/.test(value)) return 'orders';
  if (/consign/.test(value)) return 'consignments';
  return 'operations';
}

function periodBounds(period, from, to) {
  // Bornes calculées à l'heure locale du serveur, transmises en ISO : aucune dépendance au
  // fuseau du navigateur, et les deux bornes sont toujours cohérentes entre elles.
  const now = new Date();
  const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const day = 24 * 60 * 60 * 1000;
  switch (period) {
    case 'today': return { from: startOfDay(now), to: endOfDay(now) };
    case 'yesterday': return { from: startOfDay(new Date(now.getTime() - day)), to: endOfDay(new Date(now.getTime() - day)) };
    case 'week': {
      // Semaine commençant le lundi : repère habituel en Côte d'Ivoire.
      const offset = (now.getDay() + 6) % 7;
      return { from: startOfDay(new Date(now.getTime() - offset * day)), to: endOfDay(now) };
    }
    case 'month': return { from: new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0), to: endOfDay(now) };
    case 'custom': {
      const fromDate = from ? new Date(`${String(from).slice(0, 10)}T00:00:00`) : null;
      const toDate = to ? new Date(`${String(to).slice(0, 10)}T23:59:59.999`) : null;
      return {
        from: fromDate && !Number.isNaN(fromDate.getTime()) ? fromDate : null,
        to: toDate && !Number.isNaN(toDate.getTime()) ? toDate : null,
      };
    }
    default: return { from: null, to: null };
  }
}

function createHistoryRoutes({ app, store, team, staffSessions, adminGuard, managerGuard, merchantGuard }) {
  const clean = (value, max = 200) => String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const pool = () => (team?.pg ? team.base.pool : null);

  // Résolution du rôle sans jamais lire un identifiant fourni par le client : chaque rôle est
  // reconnu par SON cookie de session, vérifié par le garde déjà en place dans son propre module.
  // Un seul rôle à la fois : deux cookies de rôles différents sont refusés (comme partout ailleurs).
  async function resolveActor(req) {
    // Un cookie VIDÉ (valeur absente, ex. « qria_admin= » laissé par une déconnexion) ne doit
    // jamais compter comme un rôle actif : sinon le marchand est vu comme « deux identités » et
    // ses historiques répondent 401 alors que sa session est valide.
    const cookies = ['qria_admin', 'qria_manager', 'qria_merchant', 'qria_staff']
      .filter((name) => new RegExp(`(^|;)\\s*${name}=([^;\\s]+)`).test(String(req.headers.cookie || '')));
    if (cookies.length === 0) return null;
    if (cookies.length > 1) return null;
    const only = cookies[0];

    if (only === 'qria_staff') {
      const member = await staffSessions.resolveSession(req);
      if (!member) return null;
      return { role: member.role === 'general_manager' ? 'general_manager' : 'waitress', id: member.id,
        merchantId: member.merchantId, storeId: member.storeId,
        label: member.designation || member.fullName, permissions: member.permissions || [] };
    }

    // Les autres rôles passent par leur garde réel : le même que celui de leurs routes.
    const guard = { 'qria_admin': adminGuard, 'qria_manager': managerGuard, 'qria_merchant': merchantGuard }[only];
    if (!guard) return null;
    const allowed = await new Promise((resolve) => {
      let settled = false;
      // Un garde refusé écrit une réponse d'erreur AVANT de s'arrêter : ce faux « res » absorbe
      // tous ces appels. Sans `locals` ni `append`, le garde marchand levait une TypeError silencieuse
      // et renvoyait 401 même pour une session parfaitement valide.
      const res = {
        status() { return this; },
        json() { if (!settled) { settled = true; resolve(false); } return this; },
        send() { if (!settled) { settled = true; resolve(false); } return this; },
        end() { if (!settled) { settled = true; resolve(false); } return this; },
        setHeader() { return this; },
        getHeader() { return undefined; },
        append() { return this; },
        set() { return this; },
        cookie() { return this; },
        clearCookie() { return this; },
        locals: {},
      };
      try {
        guard(req, res, () => { if (!settled) { settled = true; resolve(true); } });
      } catch (_) { if (!settled) { settled = true; resolve(false); } }
      setTimeout(() => { if (!settled) { settled = true; resolve(false); } }, 4000);
    });
    if (!allowed) return null;

    if (only === 'qria_admin') return { role: 'admin', label: 'Administrateur général' };
    if (only === 'qria_manager') {
      const row = req.manager;
      if (!row) return null;
      return { role: 'manager', id: row.id, label: row.displayName || row.username };
    }
    const row = req.merchant;
    if (!row) return null;
    const storeRow = await team.base.pool.query('SELECT id, name FROM merchant_stores WHERE merchant_id=$1 LIMIT 1', [row.id])
      .then((result) => result.rows[0]).catch(() => null);
    return { role: 'merchant', id: row.id, storeId: storeRow?.id || '', label: row.displayName || row.username };
  }

  // Périmètre SQL : `merchantIds` vide = toutes les boutiques (PDG uniquement).
  async function scopeFor(actor) {
    if (actor.role === 'admin') return { all: true, merchantIds: [], storeIds: [] };
    if (actor.role === 'manager') {
      const { rows } = await team.base.pool.query('SELECT id FROM merchant_accounts WHERE manager_id=$1 AND deleted_at IS NULL', [actor.id]);
      return { all: false, merchantIds: rows.map((row) => row.id), storeIds: [] };
    }
    if (actor.role === 'merchant') return { all: false, merchantIds: [actor.id], storeIds: actor.storeId ? [actor.storeId] : [] };
    return { all: false, merchantIds: [actor.merchantId], storeIds: actor.storeId ? [actor.storeId] : [] };
  }

  // Catégories réellement autorisées pour le rôle : une serveuse ne voit pas les connexions de
  // ses collègues, un gérant sans `activity.view` ne voit pas l'activité des autres.
  function allowedCategories(actor) {
    if (['admin', 'manager', 'merchant'].includes(actor.role)) return [...CATEGORIES];
    const perms = actor.permissions || [];
    // Une serveuse / un serveur voit toutes les catégories, mais uniquement SES propres lignes
    // (voir `selfOnly`) : aucune action d'un collègue n'est jamais renvoyée.
    const list = ['orders', 'scans', 'connections', 'operations', 'staff'];
    if (actor.role === 'general_manager' || perms.includes('consignment.view')) list.push('consignments');
    return [...new Set(list)];
  }

  function selfOnly(actor) {
    // Serveuse / serveur : ses propres actions, jamais celles d'un collègue.
    return actor.role === 'waitress';
  }

  function teamScope(actor) {
    // Gérant général : toute la boutique si `activity.view`, sinon seulement lui.
    return actor.role === 'general_manager' && (actor.permissions || []).includes('activity.view');
  }

  function addMulti(where, params, column, values) {
    params.push(values);
    where.push(`${column} = ANY($${params.length})`);
  }

  // Un libellé lisible pour chaque action : libellé connu, sinon le code interne écrit en clair
  // (« service_points_updated » → « Service points updated »). Jamais de code brut à l'écran.
  function humanAction(action) {
    const key = String(action || '');
    if (ACTION_LABELS[key]) return ACTION_LABELS[key];
    if (!key) return 'Action';
    return key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
  }

  async function gather(actor, { category, period, from, to, q, limit }) {
    const p = pool();
    if (!p) return { rows: [], note: 'Historique consolidé indisponible sans la base PostgreSQL.' };
    const bounds = periodBounds(period, from, to);
    const scope = await scopeFor(actor);
    const categories = allowedCategories(actor).filter((id) => !category || id === category);
    const search = clean(q, 80).toLowerCase();
    const rows = [];

    const timeFilter = (column) => {
      const parts = [];
      const params = [];
      if (bounds.from) { params.push(bounds.from.toISOString()); parts.push(`${column} >= $${params.length}::timestamptz`); }
      if (bounds.to) { params.push(bounds.to.toISOString()); parts.push(`${column} <= $${params.length}::timestamptz`); }
      return { sql: parts.join(' AND '), params };
    };

    const pushScope = (where, params, merchantColumn, storeColumn) => {
      if (!scope.all) {
        if (!scope.merchantIds.length) return false;
        addMulti(where, params, merchantColumn, scope.merchantIds);
        if (storeColumn && scope.storeIds.length) addMulti(where, params, storeColumn, scope.storeIds);
      }
      return true;
    };

    // 1. Activité du personnel (team_activity_events) : actions, scans, connexions, tâches…
    if (categories.some((id) => ['staff', 'connections', 'scans', 'operations'].includes(id)) && p) {
      const where = []; const params = [];
      if (!pushScope(where, params, 'a.merchant_id', 'a.store_id')) { /* périmètre vide */ }
      else {
        if (selfOnly(actor) || (actor.role === 'general_manager' && !teamScope(actor))) { params.push(actor.id); where.push(`a.member_id = $${params.length}`); }
        const tf = timeFilter('a.created_at');
        if (tf.sql) { tf.params.forEach((value) => params.push(value)); where.push(tf.sql.replace(/\$(\d+)/g, (_, n) => `$${params.length - tf.params.length + Number(n)}`)); }
        if (search) {
          params.push(`%${search}%`);
          where.push(`(LOWER(a.summary) LIKE $${params.length} OR LOWER(COALESCE(a.action,'')) LIKE $${params.length} OR LOWER(COALESCE(m.designation,'')) LIKE $${params.length})`);
        }
        params.push(Math.min(Number(limit) || 300, 800));
        const { rows: activity } = await p.query(
          `SELECT a.id, a.created_at AS "at", a.action, a.summary, a.result, a.metadata,
                  COALESCE(m.designation, 'Équipe') AS "person", COALESCE(a.member_id,'') AS "personId",
                  (SELECT s.name FROM merchant_stores s WHERE s.id = a.store_id LIMIT 1) AS "establishment"
             FROM team_activity_events a LEFT JOIN team_members m ON m.id = a.member_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY a.created_at DESC LIMIT $${params.length}`, params).catch(() => ({ rows: [] }));
        for (const row of activity) {
          const cat = categoryOfAction(row.action);
          if (!categories.includes(cat)) continue;
          rows.push({
            id: `act:${row.id}`, category: cat, action: row.action,
            actionLabel: humanAction(row.action),
            detail: row.summary, at: row.at, person: row.person, personId: row.personId,
            establishment: row.establishment || '', status: row.result,
            statusLabel: RESULT_LABELS[row.result] || row.result,
            metadata: row.metadata || {},
          });
        }
      }
    }

    // 2. Scans QR enregistrés (merchant_scan_events) : table ou boutique, jamais un scan d'un
    //    autre établissement. Les serveuses ne voient que les leurs.
    if (categories.includes('scans')) {
      const where = []; const params = [];
      if (pushScope(where, params, 'e.merchant_id', 'e.store_id')) {
        if (selfOnly(actor)) { params.push(actor.id); where.push(`e.member_id = $${params.length}`); }
        const tf = timeFilter('e.scanned_at');
        if (tf.sql) { tf.params.forEach((value) => params.push(value)); where.push(tf.sql.replace(/\$(\d+)/g, (_, n) => `$${params.length - tf.params.length + Number(n)}`)); }
        if (search) {
          params.push(`%${search}%`);
          where.push(`(LOWER(COALESCE(sp.name,'')) LIKE $${params.length} OR LOWER(COALESCE(e.qr_code,'')) LIKE $${params.length} OR LOWER(COALESCE(m.designation,'')) LIKE $${params.length})`);
        }
        params.push(Math.min(Number(limit) || 300, 800));
        const { rows: scans } = await p.query(
          `SELECT e.id, e.scanned_at AS "at", e.category, e.qr_kind AS "qrKind", e.qr_code AS "qrCode",
                  COALESCE(sp.name,'Boutique') AS "place", COALESCE(m.designation, CASE WHEN e.actor_type='customer' THEN 'Client' ELSE 'Équipe' END) AS "person",
                  (SELECT s.name FROM merchant_stores s WHERE s.id = e.store_id LIMIT 1) AS "establishment"
             FROM merchant_scan_events e
             LEFT JOIN merchant_service_points sp ON sp.id = e.service_point_id
             LEFT JOIN team_members m ON m.id = e.member_id
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY e.scanned_at DESC LIMIT $${params.length}`, params).catch(() => ({ rows: [] }));
        for (const row of scans) {
          rows.push({
            id: `scan:${row.id}`, category: 'scans',
            action: row.category === 'customer' ? 'scan_customer' : 'scan_merchant',
            actionLabel: row.category === 'customer' ? 'Scan client' : 'Scan de la boutique',
            detail: `${row.qrKind === 'store' ? 'QR de boutique' : 'QR de table'} · ${row.place}`,
            at: row.at, person: row.person, establishment: row.establishment || '',
            status: 'success', statusLabel: 'Lu',
            metadata: { qrCode: row.qrCode, place: row.place },
          });
        }
      }
    }

    // 3. Commandes : création, étapes, auteur, table, QR. Le statut et les heures de chaque
    //    étape viennent des événements réellement enregistrés.
    if (categories.includes('orders')) {
      const where = []; const params = [];
      if (pushScope(where, params, 'o.merchant_id', 'o.store_id')) {
        if (selfOnly(actor)) { params.push(actor.id); where.push(`(o.created_by_member_id = $${params.length} OR o.assigned_member_id = $${params.length})`); }
        else if (actor.role === 'general_manager' && !teamScope(actor)) { params.push(actor.id); where.push(`o.created_by_member_id = $${params.length}`); }
        const tf = timeFilter('o.created_at');
        if (tf.sql) { tf.params.forEach((value) => params.push(value)); where.push(tf.sql.replace(/\$(\d+)/g, (_, n) => `$${params.length - tf.params.length + Number(n)}`)); }
        if (search) {
          params.push(`%${search}%`);
          where.push(`(LOWER(COALESCE(o.public_reference,'')) LIKE $${params.length} OR LOWER(COALESCE(o.service_point_name,'')) LIKE $${params.length} OR LOWER(COALESCE(o.created_by_designation,'')) LIKE $${params.length} OR LOWER(COALESCE(o.assigned_designation,'')) LIKE $${params.length} OR LOWER(COALESCE(o.customer_name,'')) LIKE $${params.length})`);
        }
        params.push(Math.min(Number(limit) || 300, 800));
        const { rows: orders } = await p.query(
          `SELECT o.id, o.public_reference AS "reference", o.status, o.created_at AS "at", o.service_point_name AS "tableName",
                  o.scanned_qr_code AS "qrCode", o.created_by_designation AS "author", o.assigned_designation AS "assignee",
                  (SELECT json_agg(json_build_object('action', a.action, 'memberLabel', a.member_label, 'fromMemberLabel', a.from_member_label,
                      'actorLabel', a.actor_label, 'reason', a.reason, 'at', a.created_at) ORDER BY a.created_at)
                     FROM team_order_assignments a WHERE a.order_id = o.id) AS "assignments",
                  o.total_amount_xof AS "total", o.customer_name AS "customer",
                  (SELECT s.name FROM merchant_stores s WHERE s.id = o.store_id LIMIT 1) AS "establishment",
                  (SELECT json_agg(json_build_object('status', ev.status, 'at', ev.created_at, 'actorType', ev.actor_type)
                     ORDER BY ev.created_at) FROM merchant_order_events ev WHERE ev.order_id = o.id) AS "events"
             FROM merchant_orders o
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY o.created_at DESC LIMIT $${params.length}`, params).catch(() => ({ rows: [] }));
        for (const row of orders) {
          // Traçabilité : le QR réellement concerné, sinon celui de la table choisie. On ne fabrique
          // jamais de code : la colonne `scanned_qr_code` fait foi, la table sert de repli explicite.
          if (!row.qrCode && row.tableName) {
            const { rows: fallback } = await p.query(
              `SELECT p.public_code FROM merchant_service_points p JOIN merchant_orders o ON o.service_point_id = p.id
                WHERE o.id = $1 LIMIT 1`, [row.id]).catch(() => ({ rows: [] }));
            row.qrCode = fallback[0]?.public_code || '';
          }
          rows.push({
            id: `order:${row.id}`, category: 'orders', action: 'order_created',
            actionLabel: 'Commande', detail: `${row.reference || 'Commande'} · ${row.tableName || 'sans table'}${row.author ? ` · saisie par ${row.author}` : ''}`,
            at: row.at, person: row.author || row.customer || 'Client', establishment: row.establishment || '',
            status: row.status, statusLabel: String(row.status || ''), reference: row.reference,
            metadata: { reference: row.reference, tableName: row.tableName, qrCode: row.qrCode,
              assignee: row.assignee, total: Number(row.total) || 0, events: row.events || [],
              // Les affectations précédentes sont conservées : on ne perd jamais qui a eu la table.
              assignments: row.assignments || [] },
          });
        }
      }
    }

    // 4. Consignations : uniquement si le rôle y a accès (permission consignation).
    if (categories.includes('consignments')) {
      const where = []; const params = [];
      if (pushScope(where, params, 'c.merchant_id', 'c.store_id')) {
        const tf = timeFilter('c.created_at');
        if (tf.sql) { tf.params.forEach((value) => params.push(value)); where.push(tf.sql.replace(/\$(\d+)/g, (_, n) => `$${params.length - tf.params.length + Number(n)}`)); }
        if (search) {
          params.push(`%${search}%`);
          where.push(`(LOWER(COALESCE(c.reference,'')) LIKE $${params.length} OR LOWER(COALESCE(c.customer_name,'')) LIKE $${params.length} OR LOWER(COALESCE(c.service_point_name,'')) LIKE $${params.length} OR LOWER(COALESCE(c.created_by_label,'')) LIKE $${params.length})`);
        }
        params.push(Math.min(Number(limit) || 300, 800));
        const { rows: consignments } = await p.query(
          `SELECT c.id, c.reference, c.kind, c.status, c.created_at AS "at", c.customer_name AS "customer",
                  c.service_point_name AS "tableName", c.created_by_label AS "author",
                  (SELECT s.name FROM merchant_stores s WHERE s.id = c.store_id LIMIT 1) AS "establishment"
             FROM consignments c
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY c.created_at DESC LIMIT $${params.length}`, params).catch(() => ({ rows: [] }));
        for (const row of consignments) {
          rows.push({
            id: `consign:${row.id}`, category: 'consignments', action: 'consignment_created',
            actionLabel: row.kind === 'money' ? 'Consignation d’argent' : 'Consignation de bouteilles',
            detail: `${row.reference} · ${row.customer || 'client'}${row.tableName ? ` · ${row.tableName}` : ''}`,
            at: row.at, person: row.author || 'Équipe', establishment: row.establishment || '',
            status: row.status, statusLabel: row.status === 'open' ? 'En cours' : row.status === 'settled' ? 'Réglée' : 'Annulée',
            reference: row.reference, metadata: { kind: row.kind },
          });
        }
      }
    }

    rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    return { rows: rows.slice(0, Math.min(Number(limit) || 300, 800)) };
  }

  app.get('/api/history', async (req, res) => {
    try {
      const actor = await resolveActor(req, process.env.SESSION_SECRET || '');
      if (!actor) return res.status(401).json({ error: 'Session requise. Reconnectez-vous.' });
      if (!team?.pg) return res.status(409).json({ error: 'Les historiques nécessitent la base PostgreSQL.', code: 'PG_REQUIRED' });
      const period = PERIODS.includes(String(req.query.period)) ? String(req.query.period) : 'month';
      const category = CATEGORIES.includes(String(req.query.category)) ? String(req.query.category) : '';
      const categories = allowedCategories(actor);
      if (category && !categories.includes(category)) {
        // Refus explicite côté serveur : masquer un bouton ne suffit jamais.
        return res.status(403).json({ error: 'Cette catégorie d’historique n’est pas autorisée pour votre rôle.', code: 'CATEGORY_DENIED' });
      }
      const { rows } = await gather(actor, {
        category, period, from: req.query.from, to: req.query.to, q: req.query.q,
        limit: Math.min(Math.max(Number(req.query.limit) || 200, 1), 800),
      });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { rows, categories: categories.map((id) => ({ id, label: CATEGORY_LABELS[id] })),
        period, scope: { role: actor.role, label: actor.label }, generatedAt: new Date().toISOString() } });
    } catch (error) {
      console.error('[history]', error.message);
      return res.status(500).json({ error: 'Impossible de charger les historiques.' });
    }
  });

  return { app };
}

module.exports = { createHistoryRoutes, CATEGORIES, PERIODS, CATEGORY_LABELS, ACTION_LABELS, categoryOfAction, periodBounds };
