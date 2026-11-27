'use strict';

// ============================================================================================
// MISSION 12 — « Mes comptes créés » (espace marchand).
//
// Objectif : une seule page, lisible, qui répond à « qui ai-je créé, dans quel état, sur quelles
// tables, et que puis-je changer ? ».
//
// Le mécanisme de gestion existe déjà (team.js, team-routes.js, access-routes.js) et n'est pas
// dupliqué : ce module LIT les mêmes tables et APPELLE les mêmes fonctions de service. Il ajoute
// seulement :
//   · une liste enrichie (rôle, téléphone, tables/salons, statut, dernière connexion) ;
//   · une fiche unique par membre avec ses permissions autorisées et son historique ;
//   · une réinitialisation de mot de passe sécurisée, sans jamais exposer l'ancien mot de passe.
//
// SÉCURITÉ : chaque route vérifie que le membre appartient BIEN au marchand connecté
// (`team.getMember(id, req.merchant.id)`). Un identifiant d'une autre boutique répond 404.
// ============================================================================================

const crypto = require('node:crypto');

const ROLE_LABELS = { general_manager: 'Gérant général', waitress: 'Serveuse / Serveur' };
const STATUS_LABELS = { active: 'Actif', pending: 'En attente de validation', suspended: 'Suspendu', blocked: 'Bloqué', archived: 'Archivé' };

function fail(message, code = 'BAD_REQUEST', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}
function respondError(res, error, fallback) {
  const status = Number(error?.status) || 400;
  if (status >= 500 || !error?.message) {
    console.error('[comptes-créés]', error?.stack || error?.message || error);
    return res.status(500).json({ error: fallback });
  }
  return res.status(status).json({ error: error.message, code: error.code || '' });
}

module.exports = function memberAccountsRoutes(deps) {
  const { app, team, extras, assignments, requireMerchant, checkSameOrigin, audit, store } = deps;
  const seed = require('./team-seed');
  const q = (sql, params) => team.base.pool.query(sql, params);
  const pg = () => Boolean(team.pg && team.base && team.base.pool);

  async function ownStore(req) {
    if (typeof deps.resolveStore === 'function') {
      const row = await deps.resolveStore(req).catch(() => null);
      if (row) return row;
    }
    const { rows } = await q('SELECT id, name FROM merchant_stores WHERE merchant_id=$1 AND status=\'active\' ORDER BY created_at ASC LIMIT 1', [req.merchant.id]);
    if (!rows[0]) throw fail('Publiez d’abord votre boutique.', 'STORE_REQUIRED', 409);
    return rows[0];
  }

  // Le membre doit appartenir au marchand connecté : c'est le seul contrôle d'accès qui compte.
  async function ownMember(req, memberId) {
    const member = await team.getMember(String(memberId), req.merchant.id);
    if (!member) throw fail('Ce compte n’appartient pas à votre établissement.', 'NOT_FOUND', 404);
    return member;
  }

  async function pointsByMember(merchantId) {
    const map = new Map();
    if (!pg()) return map;
    try {
      // On réunit les deux sources connues (mission 6 et mission 11) sans doublon.
      const { rows } = await q(
        `SELECT x.member_id AS "memberId", p.id, p.name, p.zone, p.table_number AS "number", p.point_type AS type, p.public_code AS "publicCode", p.status
           FROM (
             SELECT member_id, service_point_id FROM team_service_point_assignments WHERE merchant_id=$1
             UNION
             SELECT member_id, service_point_id FROM team_member_service_points WHERE merchant_id=$1
           ) x JOIN merchant_service_points p ON p.id=x.service_point_id
          WHERE p.status='active'
          ORDER BY COALESCE(NULLIF(p.table_number,''), p.name) COLLATE "C"`, [merchantId]);
      for (const row of rows) {
        if (!map.has(row.memberId)) map.set(row.memberId, []);
        map.get(row.memberId).push({ id: row.id, name: row.name, zone: row.zone || '', number: row.number || '', type: row.type, publicCode: row.publicCode || '' });
      }
    } catch (_) { /* une table d'affectations absente ne doit pas casser la liste */ }
    return map;
  }

  function describe(member, points) {
    return {
      id: member.id, fullName: member.fullName, designation: member.designation, username: member.username,
      phone: member.phone || '', role: member.role, roleLabel: ROLE_LABELS[member.role] || member.role,
      status: member.status, statusLabel: STATUS_LABELS[member.status] || member.status,
      permissions: member.permissions || [], points, pointsLabel: points.length
        ? points.map((point) => point.number ? `Table ${point.number}` : point.name).join(', ')
        : 'Aucune table ni aucun salon',
      lastLoginAt: member.lastLoginAt || null, createdAt: member.createdAt || null,
      lockActive: Boolean(member.lockActive), lockedUntil: member.lockedUntil || null,
      mustChangePassword: member.mustChangePassword === true,
    };
  }

  // ------------------------------------------------------------------ 1. la liste
  app.get('/api/merchant/member-accounts', requireMerchant, async (req, res) => {
    try {
      const shop = await ownStore(req);
      const members = await team.listMembers(req.merchant.id, { includeArchived: req.query.archived === '1' });
      const pointsMap = await pointsByMember(req.merchant.id);
      // Les effectifs viennent du MÊME calcul que la rubrique Équipe (plafond fixé par le PDG,
      // éventuellement hérité d'un code de terrain). L'écran les affiche, il ne les modifie pas.
      const settings = await team.getSettings(req.merchant.id).catch(() => ({}));
      let quotas = await (async () => {
        try {
          const { resolveTeamQuotas } = require('./admin-control');
          return await resolveTeamQuotas({ team: { pg: Boolean(team.pg), base: team.base }, store }, req.merchant.id);
        } catch (_) { return {}; }
      })();
      const maxGm = Number(quotas.effectiveMaxGeneralManagers ?? settings.effectiveMaxGeneralManagers ?? settings.maxGeneralManagers) || 0;
      const maxWaitress = Number(quotas.effectiveMaxWaitresses ?? settings.effectiveMaxWaitresses ?? settings.maxWaitresses) || 0;
      const counts = {
        total: members.filter((m) => m.status !== 'archived').length,
        active: members.filter((m) => m.status === 'active').length,
        pending: members.filter((m) => m.status === 'pending').length,
        suspended: members.filter((m) => m.status === 'suspended').length,
        blocked: members.filter((m) => m.status === 'blocked').length,
      };
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        store: { id: shop.id, name: shop.name },
        accounts: members.map((member) => describe(member, pointsMap.get(member.id) || [])),
        counts,
        // Effectifs fixés par le PDG : l'écran les AFFICHE, il ne les modifie pas.
        quotas: {
          generalManagers: { used: members.filter((m) => m.role === 'general_manager' && m.status !== 'archived').length, max: maxGm },
          waitresses: { used: members.filter((m) => m.role === 'waitress' && m.status !== 'archived').length, max: maxWaitress },
        },
        roles: Object.entries(ROLE_LABELS).map(([id, label]) => ({ id, label })),
      } });
    } catch (error) { return respondError(res, error, 'Impossible de charger vos comptes créés.'); }
  });

  // ------------------------------------------------------------------ 2. la fiche d'un compte
  app.get('/api/merchant/member-accounts/:memberId', requireMerchant, async (req, res) => {
    try {
      const member = await ownMember(req, req.params.memberId);
      const shop = await ownStore(req);
      const pointsMap = await pointsByMember(req.merchant.id);
      // Toutes les tables de l'établissement : cochées = attribuées à CE membre.
      const allPoints = await deps.extras.listServicePoints(shop.id).catch(() => []);
      const mine = new Set((pointsMap.get(member.id) || []).map((point) => point.id));
      let history = [];
      try { history = await team.listActivity(req.merchant.id, { memberId: member.id, limit: 40 }); } catch (_) { history = []; }
      const relevant = (seed?.PERMISSIONS || []).filter((permission) => permission.appliesTo === 'both' || permission.appliesTo === member.role);
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        account: describe(member, pointsMap.get(member.id) || []),
        permissions: relevant.map((permission) => ({
          code: permission.code, label: permission.label, description: permission.description,
          granted: (member.permissions || []).includes(permission.code),
          locked: permission.code === 'members.manage',
        })),
        points: allPoints.filter((point) => point.status === 'active').map((point) => ({
          id: point.id, name: point.name, zone: point.zone || '', number: point.number || point.tableNumber || '',
          type: point.type, code: point.publicCode || '', checked: mine.has(point.id),
        })),
        history: history.map((row) => ({ id: row.id, action: row.action, summary: row.summary, result: row.result, createdAt: row.createdAt })),
      } });
    } catch (error) { return respondError(res, error, 'Impossible de charger ce compte.'); }
  });

  // ------------------------------------------------------------------ 3. modifier la fiche
  // Nom, téléphone, désignation, permissions et tables : une seule requête, les mêmes fonctions
  // de service que la rubrique Équipe (historique et cloisonnement conservés).
  app.put('/api/merchant/member-accounts/:memberId', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const member = await ownMember(req, req.params.memberId);
      const shop = await ownStore(req);
      const body = req.body || {};
      const updated = await team.updateMember(member.id, req.merchant.id, {
        fullName: body.fullName, phone: body.phone, designation: body.designation,
        role: body.role, permissions: Array.isArray(body.permissions) ? body.permissions : undefined,
      }, { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' });
      let assignmentResult = null;
      if (Array.isArray(body.servicePointIds) && assignments) {
        const ids = [...new Set(body.servicePointIds.map(String))];
        // On ne peut attribuer QUE des tables de son établissement.
        const owned = await q('SELECT id FROM merchant_service_points WHERE store_id=$1', [shop.id]);
        const ownedIds = new Set(owned.rows.map((row) => row.id));
        const rejected = ids.filter((id) => !ownedIds.has(id));
        if (rejected.length) throw fail('Une table sélectionnée n’appartient pas à votre établissement.', 'POINT_NOT_OWNED', 403);
        assignmentResult = await assignments.replaceForMember({ merchantId: req.merchant.id, storeId: shop.id,
          memberId: member.id, points: ids, actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' } });
      }
      try {
        await store.addAudit({ actor: `${req.merchant.displayName || 'Marchand'} (@${req.merchant.username})`, actorType: 'merchant',
          actorId: req.merchant.id, action: 'team_account_updated', entityType: 'team_member', entityId: member.id,
          summary: `Compte de ${updated.designation || updated.fullName} modifié par le marchand.`, result: 'success',
          metadata: { fields: Object.keys(body).filter((key) => key !== 'servicePointIds') } });
      } catch (_) {}
      const pointsMap = await pointsByMember(req.merchant.id);
      return res.json({ data: { account: describe(updated, pointsMap.get(updated.id) || []), assignments: assignmentResult,
        notice: 'Compte mis à jour. Les permissions prennent effet immédiatement, sans reconnexion.' } });
    } catch (error) { return respondError(res, error, 'Impossible d’enregistrer ce compte.'); }
  });

  // ------------------------------------------------------------------ 4. suspendre / réactiver
  app.post('/api/merchant/member-accounts/:memberId/status', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const member = await ownMember(req, req.params.memberId);
      const status = String(req.body?.status || '');
      if (!['active', 'suspended', 'blocked', 'pending'].includes(status)) throw fail('État de compte non reconnu.');
      const updated = await team.setStatus(member.id, req.merchant.id, status, String(req.body?.reason || 'Décision du marchand').slice(0, 200),
        { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' });
      try {
        await store.addAudit({ actor: `${req.merchant.displayName || 'Marchand'} (@${req.merchant.username})`, actorType: 'merchant',
          actorId: req.merchant.id, action: `team_account_${status}`, entityType: 'team_member', entityId: member.id,
          summary: `${member.designation || member.fullName} → ${STATUS_LABELS[status] || status}.`, result: 'success' });
      } catch (_) {}
      return res.json({ data: { account: { id: updated.id, status: updated.status, statusLabel: STATUS_LABELS[updated.status] || updated.status } },
        notice: status === 'active' ? 'Compte réactivé : le membre peut se reconnecter immédiatement.'
          : status === 'suspended' ? 'Compte suspendu : l’accès est coupé, les données et l’historique sont conservés.'
            : 'Compte suspendu : l’accès est coupé, les données et l’historique sont conservés.' });
    } catch (error) { return respondError(res, error, 'Impossible de changer l’état de ce compte.'); }
  });

  // ------------------------------------------------------------------ 5. réinitialisation sécurisée
  // Le marchand peut choisir le nouveau code à 6 chiffres, ou laisser le serveur en générer un.
  // Le mot de passe n'est JAMAIS renvoyé en clair une fois choisi par le serveur... sauf ici, une
  // seule fois, parce que c'est le marchand qui doit le transmettre : il est affiché une unique
  // fois et n'est plus relisible ensuite (même règle que les codes d'activation).
  app.post('/api/merchant/member-accounts/:memberId/reset-password', requireMerchant, checkSameOrigin, async (req, res) => {
    try {
      const member = await ownMember(req, req.params.memberId);
      const pinPolicy = require('./pin-policy');
      let password = String(req.body?.password || '').trim();
      if (password) {
        try { pinPolicy.assertPin6(password, 'code'); } catch (_) { throw fail('Le nouveau mot de passe doit être exactement 6 chiffres.', 'INVALID_PIN6', 400); }
        if (pinPolicy.isWeakPin(password)) throw fail('Ce code est trop facile à deviner (suite ou répétition). Choisissez-en un autre.', 'WEAK_PIN6', 400);
      } else password = pinPolicy.generatePin6();
      await team.resetPassword(member.id, req.merchant.id, password);
      try {
        await store.addAudit({ actor: `${req.merchant.displayName || 'Marchand'} (@${req.merchant.username})`, actorType: 'merchant',
          actorId: req.merchant.id, action: 'team_account_password_reset', entityType: 'team_member', entityId: member.id,
          summary: `Mot de passe de ${member.designation || member.fullName} réinitialisé : sessions coupées.`, result: 'success',
          metadata: { method: req.body?.password ? 'chosen_by_merchant' : 'generated' } });
      } catch (_) {}
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: {
        temporaryPassword: password,
        chosenByMerchant: Boolean(req.body?.password),
        sessionsRevoked: true,
        notice: 'Toutes les sessions de ce membre sont fermées. Transmettez-lui le nouveau code : il ne sera plus affiché.',
      } });
    } catch (error) { return respondError(res, error, 'Impossible de réinitialiser ce mot de passe.'); }
  });

  // ------------------------------------------------------------------ 6. historique d'activité
  app.get('/api/merchant/member-accounts/:memberId/activity', requireMerchant, async (req, res) => {
    try {
      const member = await ownMember(req, req.params.memberId);
      const rows = await team.listActivity(req.merchant.id, { memberId: member.id, limit: Math.min(Number(req.query.limit) || 60, 200) });
      res.setHeader('Cache-Control', 'no-store');
      return res.json({ data: { account: { id: member.id, fullName: member.fullName, designation: member.designation },
        activity: rows.map((row) => ({ id: row.id, action: row.action, summary: row.summary, result: row.result, createdAt: row.createdAt, metadata: row.metadata || null })) } });
    } catch (error) { return respondError(res, error, 'Impossible de charger l’historique de ce compte.'); }
  });

  return { list: pointsByMember };
};
