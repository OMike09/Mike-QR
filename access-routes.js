'use strict';

// ============================================================================================
// MISSION 9 — Routes serveur
//
//   1. Mot de passe oublié (public) ............ /api/public/support/contacts
//   2. Connexion par code provisoire ........... /api/public/access-reset/*   + /api/merchant/auth/access-code
//   3. Réinitialisation par le PDG ............. /api/admin/access-resets/*
//   4. Réinitialisation par le gestionnaire .... /api/manager/access-resets/*
//   5. Demandes de comptes du personnel ........ /api/merchant/team/requests/*
//   6. Réinitialisation par le marchand ........ /api/merchant/team/members/:id/access-code
//   7. Rattachement du marchand créateur ....... /api/manager/my-merchants/*
//
// Toutes les vérifications de droits sont faites ICI, côté serveur. L'interface ne fait
// qu'afficher ce que ces routes autorisent réellement.
// ============================================================================================

const crypto = require('node:crypto');

const PIN_MESSAGE = 'Le nouveau mot de passe doit être exactement 6 chiffres.';

module.exports = function accessRoutes(deps) {
  const { app, store, access, team, commerce, lifecycle, requireManager, requireAdmin,
    requireMerchant, checkSameOrigin, apiError, audit, notifyAdmin, notifyManager } = deps;

  const clean = (v, max = 200) => String(v == null ? '' : v).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().replace(/\s+/g, ' ').slice(0, max);
  const fail = (res, error, fallback) => {
    if (error && error.status && error.status < 500) return res.status(error.status).json({ error: error.message, code: error.code });
    if (error && error.message && !error.code) return res.status(400).json({ error: error.message });
    if (typeof apiError === 'function') return apiError(res, error, fallback);
    return res.status(500).json({ error: fallback });
  };
  const guard = (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || typeof checkSameOrigin !== 'function') return next();
    return checkSameOrigin(req, res, next);
  };
  const actorOf = (req, type) => type === 'admin'
    ? { type: 'admin', id: String(process.env.ADMIN_USERNAME || 'admin'), label: 'Administrateur général' }
    : { type: 'manager', id: req.manager?.id || '', label: req.manager?.displayName || 'Gestionnaire' };
  const record = async (entry) => { if (typeof audit === 'function') await audit(entry).catch(() => {}); };
  const noStore = (res) => res.setHeader('Cache-Control', 'no-store');

  // Throttle simple en mémoire : la vérification d'un code provisoire ne doit pas être brute-forcée.
  const attempts = new Map();
  function allowAttempt(key, max = 10, windowMs = 10 * 60_000) {
    const now = Date.now(); const current = attempts.get(key);
    if (!current || now - current.start >= windowMs) { attempts.set(key, { start: now, count: 1 }); return true; }
    if (current.count >= max) return false;
    current.count += 1; return true;
  }

  async function accountContext(accountType, accountId) {
    if (accountType === 'merchant') {
      const merchant = await commerce.getMerchant(accountId, { includeDeleted: true }).catch(() => null);
      if (!merchant) return null;
      const shop = await commerce.getStoreByMerchantId(accountId).catch(() => null);
      return { accountType, accountId, label: (shop && shop.name) || merchant.displayName || merchant.username, merchant, store: shop, deleted: Boolean(merchant.deletedAt) };
    }
    if (accountType === 'staff') {
      const member = await team.getMember(accountId).catch(() => null)
        || (team?.pg ? (await team.base.pool.query('SELECT id, merchant_id AS "merchantId", full_name AS "fullName", username FROM team_members WHERE id=$1', [accountId]).catch(() => ({ rows: [] }))).rows[0] : null);
      if (!member) return null;
      return { accountType, accountId, label: member.fullName || member.designation || 'Membre d’équipe', member };
    }
    const manager = await store.getManager(accountId, { includeDeleted: true }).catch(() => null);
    if (!manager) return null;
    return { accountType, accountId, label: manager.displayName || manager.username, manager, deleted: Boolean(manager.deletedAt) };
  }

  // ==========================================================================================
  // 1. MOT DE PASSE OUBLIÉ — coordonnées réelles uniquement
  // ==========================================================================================
  app.get('/api/public/support/contacts', async (_req, res) => {
    const contacts = await access.supportContacts().catch(() => []);
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.json({ data: { contacts,
      message: 'Vous avez oublié votre mot de passe ? Pour réinitialiser votre accès, contactez le gestionnaire qui a créé votre compte ou l’Administrateur général.',
      // Aucun numéro n'est inventé : la liste peut être vide, l'interface l'indique alors clairement.
      notice: contacts.length ? '' : 'Les coordonnées de contact n’ont pas encore été renseignées par l’Administrateur général.' } });
  });

  // ==========================================================================================
  // 1 bis. UN SEUL TYPE DE CODE DANS TOUTE L'APPLICATION
  //
  // La console marchands et l'ancien écran PDG pouvaient émettre un mot de passe temporaire à
  // 6 chiffres : deux « réinitialisations » coexistaient, avec deux formats incompatibles, et un
  // code remis par un écran était refusé par l'autre. Toute réinitialisation passe désormais par
  // le MÊME code provisoire INITIALES-XXXXXX, émis par le même module.
  // ==========================================================================================
  const pinPolicyForReset = require('./pin-policy');
  function temporaryPinFromRequest(body) {
    // Code imposé par l'appelant (facultatif) : il doit respecter exactement la règle 6 chiffres.
    // `temporaryPassword` est accepté en plus de `password` : c'est le nom déjà utilisé par les
    // écrans existants, mieux vaut ne pas imposer un vocabulaire différent selon l'écran.
    const provided = body?.password ?? body?.temporaryPassword;
    if (provided === undefined || provided === null || provided === '') return { pin: pinPolicyForReset.generatePin6() };
    const pin = String(provided);
    try { pinPolicyForReset.assertPin6(pin, 'code'); }
    catch (error) { return { error: { error: 'Le mot de passe doit être exactement 6 chiffres.', code: 'INVALID_PIN6', rule: 'exactly_6_digits' } }; }
    if (pinPolicyForReset.isWeakPin(pin)) return { error: { error: 'Ce code est trop facile à deviner (suite de chiffres ou répétition).', code: 'WEAK_PIN6' } };
    return { pin };
  }

  function resetPathsFor(accountType) {
    // Chaque code sert à DEUX choses : se connecter directement, ou servir de preuve dans
    // « Mot de passe oublié ? » pour choisir soi-même le mot de passe à 6 chiffres.
    if (accountType === 'merchant') return { helpPath: '/merchant/', directPath: '/merchant/', helpLabel: 'Page de connexion marchand' };
    if (accountType === 'staff') return { helpPath: '/equipe/', directPath: '/equipe/', helpLabel: 'Page de connexion de l’équipe' };
    return { helpPath: '/manager', directPath: '/manager', helpLabel: 'Page de connexion gestionnaire' };
  }

  // Applique le NOUVEAU mot de passe à 6 chiffres : ancien mot de passe invalidé, sessions
  // révoquées, changement imposé à la première connexion. Partagé par le PDG, le gestionnaire,
  // le marchand et le code provisoire — un seul comportement, donc aucun format divergent.
  async function applyNewPassword({ accountType, accountId, pin, keyPrefix }) {
    const hash = deps.hashPassword(pin);
    const expiresAt = new Date(Date.now() + 30 * 60_000).toISOString();
    if (accountType === 'merchant') {
      const merchant = await commerce.getMerchant(accountId).catch(() => null);
      if (!merchant) throw Object.assign(new Error('Compte marchand introuvable.'), { status: 404, code: 'ACCOUNT_NOT_FOUND' });
      await commerce.setMerchantTemporaryPassword(merchant.id, hash, expiresAt);
      await commerce.recordMerchantPasswordEvent({ merchantId: merchant.id, action: 'reset_by_code', actorType: 'system',
        actorId: keyPrefix || 'access-code', actorLabel: 'Code provisoire', metadata: { policy: 'pin6', key: keyPrefix || '' } }).catch(() => {});
      return merchant;
    }
    const manager = await store.getManager(accountId, { includeDeleted: true }).catch(() => null);
    if (!manager) throw Object.assign(new Error('Compte gestionnaire introuvable.'), { status: 404, code: 'ACCOUNT_NOT_FOUND' });
    // Même mécanisme que la réinitialisation PDG existante : mot de passe remplacé, changement
    // obligatoire, toutes les sessions révoquées.
    const updated = await store.setManagerTemporaryPassword(manager.id, hash, expiresAt);
    return updated || manager;
  }

  // ==========================================================================================
  // 2. CONNEXION AVEC UN CODE PROVISOIRE
  // ==========================================================================================
  app.post('/api/public/access-reset/inspect', guard, async (req, res) => {
    if (!allowAttempt(`inspect:${req.ip || 'x'}`, 12, 10 * 60_000)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans dix minutes.' });
    try {
      const row = await access.findResetCode(req.body?.code);
      const context = await accountContext(row.accountType, row.accountId);
      return res.json({ data: { valid: true, accountType: row.accountType, accountLabel: context?.label || row.accountLabel,
        expiresAt: row.expiresAt, hint: row.hint } });
    } catch (error) { return fail(res, error, 'Vérification impossible.'); }
  });

  // Étape A : le porteur saisit le code, on lui rend son identifiant de connexion (jamais le code
  // lui-même) puis il choisit son nouveau mot de passe. Le code est consommé à cette étape.
  app.post('/api/public/access-reset/redeem', guard, async (req, res) => {
    if (!allowAttempt(`redeem:${req.ip || 'x'}`, 8, 10 * 60_000)) return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans dix minutes.' });
    let consumed = null;
    try {
      // Le FORMAT du code est contrôlé en premier : une saisie invalide ne doit jamais produire un
      // « les deux codes ne correspondent pas » trompeur.
      await access.findResetCode(req.body?.code);
      const password = String(req.body?.password || '');
      const confirm = String(req.body?.confirmPassword ?? password);
      const pinPolicy = require('./pin-policy');
      try { pinPolicy.assertPin6(password, 'code'); } catch (error) { return res.status(400).json({ error: PIN_MESSAGE, code: 'INVALID_PIN6', rule: 'exactly_6_digits' }); }
      if (pinPolicy.isWeakPin(password)) return res.status(400).json({ error: 'Ce code est trop facile à deviner (suite de chiffres ou répétition). Choisissez-en un autre.', code: 'WEAK_PIN6' });
      if (password !== confirm) return res.status(400).json({ error: 'Les deux codes ne correspondent pas.' });
      // Le format et la validité sont vérifiés AVANT toute consommation : un mot de passe refusé
      // ne doit pas brûler le code provisoire.
      const found = await access.findResetCode(req.body?.code);
      consumed = await access.consumeResetCode(req.body?.code);
      if (consumed.accountType === 'merchant') {
        const merchant = await commerce.getMerchant(consumed.accountId).catch(() => null);
        if (!merchant) throw Object.assign(new Error('Compte marchand introuvable.'), { status: 404, code: 'ACCOUNT_NOT_FOUND' });
        // setMerchantTemporaryPassword remet must_change_password à TRUE : la première connexion
        // imposera donc un nouveau code personnel distinct de celui qui vient d'être choisi.
        await commerce.setMerchantTemporaryPassword(merchant.id, deps.hashPassword(password), new Date(Date.now() + 30 * 60_000).toISOString());
        // Le code provisoire impose un mot de passe personnel : on garde l'obligation de changement.
        await record({ actor: 'Code provisoire', actorType: 'anonymous', actorId: merchant.id, managerId: merchant.managerId || null,
          action: 'password_reset', entityType: 'merchant', entityId: merchant.id,
          summary: `Code provisoire utilisé pour « ${merchant.displayName} » : sessions révoquées, nouveau mot de passe personnel obligatoire.`,
          metadata: { merchantId: merchant.id, method: 'access_code' } });
        return res.json({ ok: true, accountType: 'merchant', username: merchant.username,
          loginPath: '/merchant/', mustChangePassword: true,
          message: 'Code accepté. Connectez-vous avec votre mot de passe : le système vous demandera d’en choisir un nouveau, personnel.' });
      }
      if (consumed.accountType === 'staff') {
        // Compte d'un membre d'équipe : le code provisoire permet de choisir son mot de passe,
        // sans jamais passer par le marchand ni exposer le code d'activation.
        const member = await team.getMember(consumed.accountId).catch(() => null)
          || (team?.pg ? (await team.base.pool.query('SELECT id, merchant_id AS "merchantId" FROM team_members WHERE id=$1', [consumed.accountId]).catch(() => ({ rows: [] }))).rows[0] : null);
        if (!member) throw Object.assign(new Error('Membre d’équipe introuvable.'), { status: 404, code: 'ACCOUNT_NOT_FOUND' });
        await team.resetPassword(member.id, member.merchantId || member.merchant_id, password);
        await record({ actor: 'Code provisoire', actorType: 'anonymous', actorId: member.id, action: 'team_member_access_reset',
          entityType: 'team_member', entityId: member.id,
          summary: `Code provisoire utilisé par un membre d’équipe : sessions coupées, nouveau mot de passe personnel obligatoire.`,
          metadata: { memberId: member.id, method: 'access_code' } });
        return res.json({ ok: true, accountType: 'staff', username: member.username || '',
          loginPath: '/equipe/', mustChangePassword: true,
          message: 'Code accepté. Connectez-vous avec votre nouveau mot de passe à 6 chiffres : le système vous demandera d’en choisir un autre, personnel.' });
      }
      const manager = await store.getManager(consumed.accountId).catch(() => null);
      if (!manager) throw Object.assign(new Error('Compte gestionnaire introuvable.'), { status: 404, code: 'ACCOUNT_NOT_FOUND' });
      await store.setManagerTemporaryPassword(manager.id, deps.hashPassword(password), new Date(Date.now() + 30 * 60_000).toISOString());
      await record({ actor: 'Code provisoire', actorType: 'anonymous', actorId: manager.id, managerId: manager.id,
        action: 'password_reset', entityType: 'manager', entityId: manager.id,
        summary: `Code provisoire utilisé pour « ${manager.displayName} » : sessions révoquées, nouveau mot de passe personnel obligatoire.`,
        metadata: { method: 'access_code' } });
      if (typeof notifyManager === 'function') await notifyManager(manager.id, { type: 'security_alert', title: 'Accès réinitialisé',
        body: 'Un code provisoire a été utilisé pour votre compte. Changez immédiatement votre mot de passe.', entityType: 'manager', entityId: manager.id }).catch(() => {});
      return res.json({ ok: true, accountType: 'manager', username: manager.username,
        loginPath: '/manager', mustChangePassword: true,
        message: 'Code accepté. Connectez-vous avec votre mot de passe : le système vous demandera d’en choisir un nouveau, personnel.' });
    } catch (error) { return fail(res, error, 'Impossible de finaliser la réinitialisation.'); }
  });

  // ==========================================================================================
  // 3. PDG : réinitialiser n'importe quel marchand ou gestionnaire
  // ==========================================================================================
  app.post('/api/admin/access-resets', requireAdmin, guard, async (req, res) => {
    try {
      const accountType = clean(req.body?.accountType, 20);
      const accountId = clean(req.body?.accountId, 100);
      if (!['merchant', 'manager', 'staff'].includes(accountType)) return res.status(400).json({ error: 'Choisissez un compte marchand, gestionnaire ou membre d’équipe.', code: 'INVALID_ACCOUNT_TYPE' });
      const context = await accountContext(accountType, accountId);
      if (!context) return res.status(404).json({ error: 'Compte introuvable.', code: 'ACCOUNT_NOT_FOUND' });
      const actor = actorOf(req, 'admin');
      // Le PDG peut joindre au code un mot de passe à 6 chiffres qu'il communique de vive voix
      // (le code seul impose à la personne de choisir elle-même son mot de passe).
      const pin = temporaryPinFromRequest(req.body);
      if (pin.error) return res.status(400).json(pin.error);
      const issued = await access.createResetCode({ accountType, accountId, accountLabel: context.label,
        reason: clean(req.body?.reason, 240) || 'Demande du PDG', actor, ttlHours: req.body?.ttlHours });
      await record({ actor: actor.label, actorType: 'admin', actorId: actor.id, action: 'access_reset_code_issued',
        entityType: accountType, entityId: accountId,
        summary: `Code provisoire émis pour « ${context.label} » (valable ${issued.ttlHours} h, usage unique). Le code n’est jamais journalisé.`,
        metadata: { accountType, method: 'access_code', ttlHours: issued.ttlHours } });
      if (typeof notifyAdmin === 'function') await notifyAdmin({ type: 'access_reset_issued', severity: 'warning',
        title: 'Code provisoire émis', body: `${context.label} — code ${issued.prefix}-•••••• valable ${issued.ttlHours} h.`,
        linkView: 'admin-control', linkId: accountId, dedupeKey: `access-reset:${issued.id}`,
        metadata: { accountType, accountId } }).catch(() => {});
      const paths = resetPathsFor(accountType);
      noStore(res);
      return res.status(201).json({ data: { id: issued.id, code: issued.code, accountType, accountLabel: context.label,
        username: context.merchant?.username || context.manager?.username || '', expiresAt: issued.expiresAt, ttlHours: issued.ttlHours,
        temporaryPassword: pin.pin, directLogin: true, ...paths },
        notice: pin.pin
          ? 'Notez les deux valeurs maintenant : elles ne seront plus affichées. Le code ouvre « Mot de passe oublié ? » ; le mot de passe à 6 chiffres sert à se connecter directement.'
          : 'Ce code n’est affiché qu’une fois. Transmettez-le à la personne concernée : il ne sert qu’une seule fois.' });
    } catch (error) { return fail(res, error, 'Impossible d’émettre le code provisoire.'); }
  });

  app.get('/api/admin/access-resets', requireAdmin, async (req, res) => {
    try { return res.json({ data: await access.listResetCodes({ accountType: clean(req.query.accountType, 20), limit: req.query.limit }) }); }
    catch (error) { return fail(res, error, 'Impossible de charger l’historique des réinitialisations.'); }
  });

  app.post('/api/admin/access-resets/:id/revoke', requireAdmin, guard, async (req, res) => {
    try {
      await access.revokeResetCode(String(req.params.id), actorOf(req, 'admin'), clean(req.body?.reason, 240));
      await record({ actor: 'Administrateur général', actorType: 'admin', actorId: 'admin', action: 'access_reset_code_revoked',
        entityType: 'access_reset_code', entityId: String(req.params.id), summary: 'Code provisoire révoqué avant utilisation.', result: 'success' });
      return res.json({ ok: true });
    } catch (error) { return fail(res, error, 'Impossible de révoquer ce code.'); }
  });

  // ==========================================================================================
  // 4. GESTIONNAIRE : uniquement les comptes qu'il a lui-même créés
  // ==========================================================================================
  async function managerMayReset(req, accountType, accountId) {
    if (accountType === 'manager') return false; // un gestionnaire ne réinitialise jamais un gestionnaire
    return access.managerOwnsMerchant(req.manager.id, accountId);
  }

  app.get('/api/manager/access-resets/candidates', requireManager, async (req, res) => {
    try {
      const mine = await access.listManagerMerchantsForReset(req.manager.id);
      const data = mine.map((merchant) => ({ id: merchant.id, username: merchant.username, displayName: merchant.displayName,
        storeName: merchant.storeName || '', status: merchant.status, createdAt: merchant.createdAt }));
      return res.json({ data, canResetManagers: false });
    } catch (error) { return fail(res, error, 'Impossible de charger vos marchands.'); }
  });

  app.post('/api/manager/access-resets', requireManager, guard, async (req, res) => {
    try {
      const accountType = clean(req.body?.accountType, 20) || 'merchant';
      const accountId = clean(req.body?.accountId, 100);
      if (!await managerMayReset(req, accountType, accountId)) {
        await record({ actor: req.manager.displayName || 'Gestionnaire', actorType: 'manager', actorId: req.manager.id, managerId: req.manager.id,
          action: 'access_reset_denied', entityType: accountType, entityId: accountId, result: 'denied',
          summary: 'Réinitialisation refusée : ce compte n’a pas été créé par ce gestionnaire.' }).catch(() => {});
        return res.status(403).json({ error: 'Vous ne pouvez réinitialiser que les comptes marchands que vous avez vous-même créés.', code: 'RESET_FORBIDDEN' });
      }
      const context = await accountContext('merchant', accountId);
      const actor = actorOf(req, 'manager');
      const pin = temporaryPinFromRequest(req.body);
      if (pin.error) return res.status(400).json(pin.error);
      const issued = await access.createResetCode({ accountType: 'merchant', accountId, accountLabel: context.label,
        reason: clean(req.body?.reason, 240) || 'Demande du gestionnaire créateur', actor, ttlHours: req.body?.ttlHours });
      await record({ actor: actor.label, actorType: 'manager', actorId: actor.id, managerId: actor.id, action: 'access_reset_code_issued',
        entityType: 'merchant', entityId: accountId,
        summary: `Code provisoire émis par le gestionnaire pour « ${context.label} » (usage unique, ${issued.ttlHours} h).`,
        metadata: { accountType: 'merchant', method: 'access_code' } });
      if (typeof notifyAdmin === 'function') await notifyAdmin({ type: 'access_reset_issued', severity: 'info',
        title: 'Code provisoire émis par un gestionnaire', body: `${actor.label} a émis un code provisoire pour ${context.label}.`,
        linkView: 'admin-control', linkId: accountId, dedupeKey: `access-reset:${issued.id}`,
        metadata: { accountType: 'merchant', accountId, managerId: actor.id } }).catch(() => {});
      noStore(res);
      return res.status(201).json({ data: { id: issued.id, code: issued.code, accountLabel: context.label,
        username: context.merchant?.username || '', expiresAt: issued.expiresAt, ttlHours: issued.ttlHours,
        temporaryPassword: pin.pin, directLogin: true, ...resetPathsFor('merchant') },
        notice: 'Notez les deux valeurs maintenant. Le code sert dans « Mot de passe oublié ? » ; le mot de passe à 6 chiffres sert à se connecter directement.' });
    } catch (error) { return fail(res, error, 'Impossible d’émettre le code provisoire.'); }
  });

  app.get('/api/manager/access-resets', requireManager, async (req, res) => {
    try {
      const mine = await access.listManagerMerchantsForReset(req.manager.id);
      const ids = new Set(mine.map((merchant) => merchant.id));
      const rows = await access.listResetCodes({ accountType: 'merchant', limit: 200 });
      return res.json({ data: rows.filter((row) => ids.has(row.accountId) || row.requestedById === req.manager.id) });
    } catch (error) { return fail(res, error, 'Impossible de charger votre historique.'); }
  });

  // ==========================================================================================
  // 5. MARCHAND : demandes de comptes, validation, réinitialisation de son personnel
  // ==========================================================================================
  async function quotasFor(merchantId) {
    const { resolveTeamQuotas } = require('./admin-control');
    return resolveTeamQuotas({ team: { pg: Boolean(team.pg), base: team.base }, store }, merchantId)
      .catch(() => ({ effectiveMaxGeneralManagers: 1, effectiveMaxWaitresses: 2, source: 'platform' }));
  }
  async function seatsTaken(merchantId, role) {
    let rows = [];
    if (team.pg) {
      const { rows: data } = await team.base.pool.query(
        "SELECT role, status FROM team_members WHERE merchant_id=$1 AND status <> 'archived'", [merchantId]).catch(() => ({ rows: [] }));
      rows = data;
    } else {
      rows = (store.state?.teamMembers || []).filter((member) => member.merchantId === merchantId && member.status !== 'archived');
    }
    const ofRole = rows.filter((row) => row.role === role && !['blocked', 'suspended'].includes(row.status));
    return ofRole.length;
  }

  app.get('/api/merchant/team/requests', requireMerchant, async (req, res) => {
    try {
      const data = await access.listJoinRequests(req.merchant.id, { status: clean(req.query.status, 20), limit: req.query.limit });
      const quotas = await quotasFor(req.merchant.id);
      const [gms, waitresses] = await Promise.all([seatsTaken(req.merchant.id, 'general_manager'), seatsTaken(req.merchant.id, 'waitress')]);
      return res.json({ data, seats: {
        general_manager: { used: gms, max: quotas.effectiveMaxGeneralManagers ?? quotas.maxGeneralManagers },
        waitress: { used: waitresses, max: quotas.effectiveMaxWaitresses ?? quotas.maxWaitresses },
        source: quotas.source || 'platform' } });
    } catch (error) { return fail(res, error, 'Impossible de charger les demandes.'); }
  });

  app.post('/api/merchant/team/requests', requireMerchant, guard, async (req, res) => {
    try {
      const platform = await platformLimits();
      if (platform && platform.teamModuleEnabled === false) return res.status(503).json({ error: 'La création de comptes d’équipe est momentanément fermée par l’Administrateur général.', code: 'TEAM_MODULE_CLOSED' });
      const shop = await commerce.getStoreByMerchantId(req.merchant.id).catch(() => null);
      if (!shop) return res.status(409).json({ error: 'Publiez d’abord votre boutique avant de créer un compte d’équipe.', code: 'STORE_REQUIRED' });
      const request = await access.createJoinRequest(req.merchant.id, { ...(req.body || {}), storeId: shop.id },
        { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' });
      await record({ actor: req.merchant.displayName || 'Marchand', actorType: 'merchant', actorId: req.merchant.id, managerId: req.merchant.managerId || null,
        action: 'team_join_request_created', entityType: 'team_join_request', entityId: request.id,
        summary: `Demande de compte (${request.role === 'general_manager' ? 'gérant général' : 'serveuse'}) pour ${request.fullName}.`,
        metadata: { merchantId: req.merchant.id, requestId: request.id } });
      return res.status(201).json({ data: request, notice: 'Demande enregistrée. Validez-la depuis la liste pour que le compte soit actif.' });
    } catch (error) { return fail(res, error, 'Impossible d’enregistrer cette demande.'); }
  });

  // Le marchand peut « valider » sa propre demande : la validation crée le membre et son code
  // d'activation, en vérifiant le quota côté serveur au moment exact de la validation.
  app.post('/api/merchant/team/requests/:requestId/decision', requireMerchant, guard, async (req, res) => {
    try {
      const action = clean(req.body?.action, 20);
      const reason = clean(req.body?.reason, 300);
      if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Choisissez de valider ou de refuser cette demande.' });
      const request = await access.getJoinRequest(String(req.params.requestId), req.merchant.id);
      if (!request) return res.status(404).json({ error: 'Demande introuvable dans votre établissement.', code: 'NOT_FOUND' });
      if (request.status !== 'pending') return res.status(409).json({ error: 'Cette demande a déjà été traitée.', code: 'ALREADY_DECIDED' });
      if (action === 'reject') {
        const decided = await access.decideJoinRequest(request.id, req.merchant.id, 'reject', { reason: reason || 'Refusée par le marchand', actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' } });
        await record({ actor: req.merchant.displayName || 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: 'team_join_request_rejected',
          entityType: 'team_join_request', entityId: request.id, summary: `Demande de ${request.fullName} refusée.`, metadata: { reason } });
        return res.json({ data: decided, notice: 'Demande refusée. Aucun compte n’a été créé.' });
      }
      // Validation : quota vérifié côté serveur, jamais dans l'interface seulement.
      const quotas = await quotasFor(req.merchant.id);
      const max = request.role === 'general_manager' ? (quotas.effectiveMaxGeneralManagers ?? quotas.maxGeneralManagers)
        : (quotas.effectiveMaxWaitresses ?? quotas.maxWaitresses);
      const used = await seatsTaken(req.merchant.id, request.role);
      if (Number.isFinite(Number(max)) && used >= Number(max)) {
        await record({ actor: req.merchant.displayName || 'Marchand', actorType: 'merchant', actorId: req.merchant.id,
          action: 'team_quota_blocked', entityType: 'merchant', entityId: req.merchant.id, result: 'denied',
          summary: `Validation refusée : quota ${request.role === 'general_manager' ? 'gérant' : 'serveuse'} atteint (${used}/${max}).` });
        return res.status(409).json({ error: 'Vous avez atteint le nombre maximum de comptes autorisés pour votre établissement. Veuillez contacter l’Administrateur général.',
          code: 'TEAM_LIMIT', quota: { role: request.role, max: Number(max), used } });
      }
      const shop = await commerce.getStoreByMerchantId(req.merchant.id).catch(() => null);
      if (!shop) return res.status(409).json({ error: 'Configurez d’abord votre boutique.', code: 'STORE_REQUIRED' });
      const created = await team.createMember(req.merchant.id, shop.id, { role: request.role, fullName: request.fullName,
        phone: request.phone, designation: request.designation, permissions: request.permissions || undefined },
      { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' });
      const decided = await access.decideJoinRequest(request.id, req.merchant.id, 'approve', { actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' }, memberId: created.member.id });
      await record({ actor: req.merchant.displayName || 'Marchand', actorType: 'merchant', actorId: req.merchant.id, managerId: req.merchant.managerId || null,
        action: 'team_join_request_approved', entityType: 'team_join_request', entityId: request.id,
        summary: `Demande de ${request.fullName} validée : compte ${created.member.designation} créé, code d’activation émis.`,
        metadata: { memberId: created.member.id, role: request.role } });
      if (typeof notifyAdmin === 'function') await notifyAdmin({ type: 'team_request_approved', severity: 'info',
        title: 'Compte d’équipe validé par le marchand', body: `${req.merchant.displayName} a validé ${created.member.fullName} (${created.member.role === 'general_manager' ? 'gérant général' : 'serveuse'}).`,
        linkView: 'admin-control', linkId: req.merchant.id, dedupeKey: `team-approved:${request.id}`, metadata: { merchantId: req.merchant.id } }).catch(() => {});
      noStore(res);
      return res.json({ data: decided, member: created.member,
        activation: { code: created.code, expiresAt: created.expiresAt },
        notice: 'Compte validé. Transmettez le code d’activation au membre : il ne sera plus affiché.' });
    } catch (error) { return fail(res, error, 'Impossible de valider cette demande.'); }
  });

  // Réinitialisation d'accès d'un membre de son équipe : mot de passe temporaire à 6 chiffres + code
  // d'activation. Les sessions ouvertes sont coupées.
  app.post('/api/merchant/team/members/:memberId/access-code', requireMerchant, guard, async (req, res) => {
    try {
      const member = await team.getMember(String(req.params.memberId), req.merchant.id);
      if (!member) return res.status(404).json({ error: 'Membre introuvable dans votre équipe.', code: 'NOT_FOUND' });
      const pinPolicy = require('./pin-policy');
      let temporary = clean(req.body?.password, 12);
      if (temporary) {
        try { pinPolicy.assertPin6(temporary, 'code'); } catch (_) { return res.status(400).json({ error: PIN_MESSAGE, code: 'INVALID_PIN6' }); }
        if (pinPolicy.isWeakPin(temporary)) return res.status(400).json({ error: 'Ce code est trop facile à deviner.', code: 'WEAK_PIN6' });
      } else temporary = pinPolicy.generatePin6();
      await team.resetPassword(member.id, req.merchant.id, temporary);
      const issued = await team.issueActivationCode(member.id, { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' });
      await record({ actor: req.merchant.displayName || 'Marchand', actorType: 'merchant', actorId: req.merchant.id, action: 'team_member_access_reset',
        entityType: 'team_member', entityId: member.id,
        summary: `Accès de ${member.fullName} réinitialisé : sessions coupées, mot de passe temporaire et code d’activation émis.`,
        metadata: { memberId: member.id, method: 'temporary_pin6' } });
      // Même logique que pour les marchands : un code provisoire INITIALES-XXXXXX accompagne le
      // mot de passe à 6 chiffres, pour que le membre puisse aussi passer par « Mot de passe oublié ? ».
      const label = member.fullName || member.designation || 'Membre';
      const accessCode = await access.createResetCode({ accountType: 'staff', accountId: member.id, accountLabel: label,
        reason: 'Réinitialisation par le marchand', ttlHours: 48,
        actor: { type: 'merchant', id: req.merchant.id, label: req.merchant.displayName || 'Marchand' } }).catch(() => null);
      noStore(res);
      return res.json({ data: { temporaryPassword: temporary, activation: { code: issued.code, expiresAt: issued.expiresAt },
        accessCode: accessCode?.code || '', accessCodeExpiresAt: accessCode?.expiresAt || '' },
        notice: 'Sessions coupées. Communiquez au membre son mot de passe temporaire à 6 chiffres, le code d’activation et, si besoin, le code provisoire.' });
    } catch (error) { return fail(res, error, 'Impossible de réinitialiser cet accès.'); }
  });

  // ==========================================================================================
  // 6. GESTIONNAIRE : « Mes marchands » — consultation et accompagnement à distance
  // ==========================================================================================
  async function myMerchants(req) {
    return access.listManagerMerchantsForReset(req.manager.id);
  }

  app.get('/api/manager/my-merchants', requireManager, async (req, res) => {
    try {
      const rows = await myMerchants(req);
      const data = [];
      for (const merchant of rows) {
        const assignment = await commerce.getAssignment(req.manager.id, merchant.id).catch(() => null);
        const store = await commerce.getStoreByMerchantId(merchant.id).catch(() => null);
        data.push({ id: merchant.id, username: merchant.username, displayName: merchant.displayName, phone: merchant.phone || '',
          email: merchant.email || '', status: merchant.status, createdAt: merchant.createdAt,
          store: store ? { id: store.id, name: store.name, slug: store.slug, isPublished: Boolean(store.published),
            qrPublicCode: store.qrPublicCode || '', qrEnabled: store.qrEnabled !== false, productCount: null } : null,
          permissions: assignment || null,
          canResetAccess: true,
          // Le marchand reste seul propriétaire : ces libellés sont affichés tels quels à l'écran.
          ownership: 'Le compte appartient au marchand. Vous intervenez en accompagnement tracé.' });
      }
      return res.json({ data });
    } catch (error) { return fail(res, error, 'Impossible de charger vos marchands.'); }
  });

  app.get('/api/manager/my-merchants/:merchantId', requireManager, async (req, res) => {
    try {
      if (!await access.managerOwnsMerchant(req.manager.id, req.params.merchantId)) {
        return res.status(403).json({ error: 'Ce marchand n’a pas été créé avec votre code.', code: 'FORBIDDEN' });
      }
      const merchant = await commerce.getMerchant(req.params.merchantId);
      const store = await commerce.getStoreByMerchantId(merchant.id).catch(() => null);
      const assignment = await commerce.getAssignment(req.manager.id, merchant.id).catch(() => null);
      const members = await team.listMembers(merchant.id).catch(() => []);
      return res.json({ data: { id: merchant.id, username: merchant.username, displayName: merchant.displayName,
        phone: merchant.phone || '', email: merchant.email || '', status: merchant.status, createdAt: merchant.createdAt,
        store: store ? { id: store.id, name: store.name, slug: store.slug, isPublished: Boolean(store.published), qrPublicCode: store.qrPublicCode || '',
          qrEnabled: store.qrEnabled !== false, description: store.description || '' } : null,
        permissions: assignment || null,
        team: members.map((member) => ({ id: member.id, fullName: member.fullName, role: member.role, designation: member.designation, status: member.status })) } });
    } catch (error) { return fail(res, error, 'Impossible de charger ce marchand.'); }
  });

  // Historique des interventions du gestionnaire sur ce marchand : le marchand peut les identifier.
  app.get('/api/manager/my-merchants/:merchantId/activity', requireManager, async (req, res) => {
    try {
      if (!await access.managerOwnsMerchant(req.manager.id, req.params.merchantId)) return res.status(403).json({ error: 'Marchand non attribué.', code: 'FORBIDDEN' });
      const rows = await store.listManagerActivities?.({ managerId: req.manager.id, limit: 50 }).catch?.(() => null);
      if (Array.isArray(rows)) return res.json({ data: rows });
      const auditList = await store.listAudit?.({ page: 1, limit: 100 }).catch?.(() => null);
      const data = (auditList?.data || []).filter((row) => row.actorType === 'manager' && row.actorId === req.manager.id
        && (row.entityId === req.params.merchantId || row.metadata?.merchantId === req.params.merchantId)).slice(0, 50);
      return res.json({ data });
    } catch (error) { return fail(res, error, 'Impossible de charger l’historique.'); }
  });

  // ==========================================================================================
  // CODE D'AUTORISATION D'INSCRIPTION — généré DANS la fenêtre du gestionnaire
  // ==========================================================================================
  // Un seul code, à usage unique, associé automatiquement au gestionnaire qui le génère.
  app.post('/api/manager/signup-code', requireManager, guard, async (req, res) => {
    try {
      if (req.manager.canCreateFieldCodes !== true) {
        await record({ actor: req.manager.displayName || 'Gestionnaire', actorType: 'manager', actorId: req.manager.id, managerId: req.manager.id,
          action: 'authorization_denied', entityType: 'field_enrollment_code', entityId: 'signup-code', result: 'denied',
          summary: 'Génération de code d’inscription refusée : permission non accordée par le PDG.' });
        return res.status(403).json({ error: 'Le PDG ne vous a pas autorisé à générer des codes d’inscription.', code: 'FIELD_CODE_FORBIDDEN' });
      }
      const adminControl = deps.adminControl;
      const ttlHours = Math.max(1, Math.min(168, Math.round(Number(req.body?.ttlHours) || 24)));
      const [code] = await adminControl.createFieldCodes({
        count: 1, ttlHours, maxUses: 1, singleUse: true,
        note: `Code d’inscription généré par ${req.manager.displayName || req.manager.username}`,
        teamQuotas: req.body?.teamQuotas || null,
        actor: { type: 'manager', id: req.manager.id, label: req.manager.displayName || req.manager.username },
        managerId: String(req.manager.id),
      });
      await adminControl.journal({ actor: { type: 'manager', id: req.manager.id, label: req.manager.displayName || 'Gestionnaire' },
        action: 'signup_code_created', entityType: 'field_enrollment_code', entityId: String(code.id), managerId: String(req.manager.id),
        summary: `Code unique d’inscription généré (usage unique, ${ttlHours} h).`, req });
      if (typeof notifyAdmin === 'function') await notifyAdmin({ type: 'field_codes_created', severity: 'info',
        title: 'Code d’inscription généré', body: `${req.manager.displayName} a généré un code unique d’inscription (${ttlHours} h).`,
        linkView: 'admin-field-codes', linkId: String(req.manager.id), dedupeKey: `signupcode:${code.id}`,
        metadata: { managerId: req.manager.id } }).catch(() => {});
      noStore(res);
      const signupUrl = `${deps.publicBaseUrl || ''}/devenir-marchand?code=${encodeURIComponent(code.code)}`;
      return res.status(201).json({ data: { code: code.code, codeId: code.id, expiresAt: code.expiresAt, ttlHours, singleUse: true,
        signupPath: `/devenir-marchand?code=${encodeURIComponent(code.code)}`, signupUrl },
        notice: 'Ce code n’est affiché qu’une seule fois. Il ne sert qu’une seule fois : transmettez-le maintenant au futur marchand.' });
    } catch (error) { return fail(res, error, 'Impossible de générer le code d’inscription.'); }
  });

  app.get('/api/manager/signup-codes', requireManager, async (req, res) => {
    try {
      const adminControl = deps.adminControl;
      const result = await adminControl.listFieldCodes({ actor: { type: 'manager', id: req.manager.id, label: req.manager.displayName || 'Gestionnaire' }, status: 'all' });
      const history = await adminControl.fieldCodeHistory({ managerId: String(req.manager.id), limit: 100 });
      const usedByCode = new Map();
      for (const row of history) if (row.codeId) usedByCode.set(row.codeId, row);
      const data = (result.data || []).filter((row) => row.createdById === String(req.manager.id) || row.managerId === String(req.manager.id))
        .map((row) => {
          const used = usedByCode.get(row.id) || null;
          const expired = !used && row.expiresAt && new Date(row.expiresAt).getTime() <= Date.now();
          return { id: row.id, hint: row.hint, createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt || null,
            maxUses: row.maxUses, uses: row.uses,
            status: row.revokedAt ? 'revoked' : used ? 'used' : expired ? 'expired' : 'available',
            usedAt: used?.usedAt || null, usedByName: used?.businessName || used?.registrationLabel || '',
            usedByReference: used?.reference || '', usedByRegistrationId: used?.registrationId || '' };
        });
      noStore(res);
      return res.json({ data, canCreate: req.manager.canCreateFieldCodes === true });
    } catch (error) { return fail(res, error, 'Impossible de charger vos codes d’inscription.'); }
  });

  async function platformLimits() {
    const fallback = { teamModuleEnabled: true };
    try {
      if (!team.pg) return fallback;
      const { rows } = await team.base.pool.query("SELECT setting_value FROM app_settings WHERE setting_key='teamLimits'");
      return { ...fallback, ...(rows[0]?.setting_value || {}) };
    } catch (_) { return fallback; }
  }

  return { attempts };
};
