'use strict';

// ============================================================================================
// MISSION 15 — SESSION UNIQUE PAR COMPTE MARCHAND
//
// Règle demandée : un compte marchand ne peut avoir qu'UNE seule session active. Une deuxième
// connexion est refusée tant que la première est vivante.
//
// Principes retenus (et pourquoi) :
//  · Le verrou vit en base (table `merchant_active_sessions`), pas en mémoire : il survit à un
//    redémarrage et reste juste si plusieurs instances du serveur tournent.
//  · La session est « vivante » si elle a bougé il y a moins de `IDLE_MS` ET si elle a moins de
//    `MAX_MS` d'âge. Sinon elle est considérée abandonnée : le verrou est libéré TOUT SEUL, sans
//    intervention, pour ne jamais laisser un téléphone en panne bloquer un compte.
//  · L'acquisition se fait par une seule instruction SQL atomique (INSERT ... ON CONFLICT DO
//    UPDATE ... WHERE expiré). Deux connexions simultanées ne peuvent donc pas réussir toutes les
//    deux : PostgreSQL sérialise sur la ligne, la perdante relit et reçoit un refus.
//  · `session_id` est un identifiant aléatoire porté par le cookie signé. Il permet de rattacher
//    chaque requête au verrou et donc de le « rafraîchir » (dernière activité) à chaque appel.
//  · Le PDG peut lister et révoquer les sessions ; chaque révocation est journalisée.
// ============================================================================================

const crypto = require('crypto');

const IDLE_SECONDS = Number(process.env.MERCHANT_SESSION_IDLE_SECONDS || 30 * 60); // 30 min sans activité
const MAX_HOURS = Number(process.env.MERCHANT_SESSION_MAX_HOURS || 12);            // 12 h maximum
const MAX_MS = MAX_HOURS * 3600 * 1000;

/** Identifiant de session opaque, non devinable, rangé dans le cookie signé. */
function newSessionId() {
  return crypto.randomBytes(24).toString('base64url');
}

/** Une session est-elle encore valable ? (aucune requête en base, décision pure) */
function isLive(row, now = Date.now()) {
  if (!row) return false;
  // Accepte la ligne SQL (snake_case) comme l'objet exposé (camelCase) : les deux circulent.
  const revokedAt = row.revokedAt ?? row.revoked_at;
  const startedAt = row.startedAt ?? row.started_at;
  const lastSeenAt = row.lastSeenAt ?? row.last_seen_at;
  if (revokedAt) return false;
  const started = new Date(startedAt).getTime();
  const seen = new Date(lastSeenAt || startedAt).getTime();
  if (!Number.isFinite(started) || !Number.isFinite(seen)) return false;
  if (now - seen > IDLE_SECONDS * 1000) return false;   // abandonnée : appareil fermé, réseau coupé
  if (now - started > MAX_MS) return false;             // durée maximale atteinte
  return true;
}

/** Message exact demandé par le cahier des charges. */
const BUSY_MESSAGE = 'Échec de connexion : ce compte est déjà utilisé sur un autre appareil. Veuillez réessayer lorsque la session actuelle sera terminée.';

function createSessionRegistry({ pool, logger = console }) {
  let tableReady = false;
  // Le stockage JSON local (développement, tests) n'a pas de pool SQL : le verrou de session
  // unique est alors simplement inactif, plutôt que de faire échouer les connexions marchandes.
  // C'est explicite et sans effet sur une installation PostgreSQL (production).
  if (!pool) {
    const noop = async () => ({ ok: true, sessionId: null, disabled: true });
    return { acquire: noop, verify: async () => ({ ok: true }), touch: async () => {}, release: async () => 0,
      revoke: async () => null, list: async () => [], purgeStale: async () => {},
      isLive, BUSY_MESSAGE, IDLE_SECONDS, MAX_HOURS, enabled: false };
  }

  async function ensureTable() {
    if (tableReady) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merchant_active_sessions (
        merchant_id  TEXT PRIMARY KEY REFERENCES merchant_accounts(id) ON DELETE CASCADE,
        session_id   TEXT NOT NULL,
        device       TEXT,
        ip_hash      TEXT,
        started_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revoked_at   TIMESTAMPTZ,
        revoked_by   TEXT
      );
      CREATE INDEX IF NOT EXISTS merchant_active_sessions_seen_idx ON merchant_active_sessions (last_seen_at);
    `);
    tableReady = true;
  }

  function rowToState(row) {
    if (!row) return null;
    return {
      sessionId: row.session_id,
      device: row.device,
      startedAt: row.started_at,
      lastSeenAt: row.last_seen_at,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      live: isLive(row),
    };
  }

  /**
   * Tente de prendre le verrou du compte.
   * @returns {{ok:true, sessionId:string} | {ok:false, reason:'busy', current:object}}
   */
  async function acquire(merchantId, { device = '', ipHash = '' } = {}) {
    await ensureTable();
    const sessionId = newSessionId();
    const idle = IDLE_SECONDS;

    // UNE seule instruction : si la ligne existe et que sa session est vivante, le UPDATE ne
    // s'applique pas (WHERE faux) et aucune ligne n'est renvoyée → perdu.
    const inserted = await pool.query(
      `INSERT INTO merchant_active_sessions AS t (merchant_id, session_id, device, ip_hash, started_at, last_seen_at, revoked_at, revoked_by)
       VALUES ($1, $2, $3, $4, NOW(), NOW(), NULL, NULL)
       ON CONFLICT (merchant_id) DO UPDATE
         SET session_id = EXCLUDED.session_id,
             device = EXCLUDED.device,
             ip_hash = EXCLUDED.ip_hash,
             started_at = NOW(),
             last_seen_at = NOW(),
             revoked_at = NULL,
             revoked_by = NULL
       WHERE t.revoked_at IS NOT NULL
          OR t.last_seen_at < NOW() - ($5 || ' seconds')::interval
          OR t.started_at  < NOW() - ($6 || ' seconds')::interval
       RETURNING merchant_id`,
      [merchantId, sessionId, String(device).slice(0, 200), ipHash || null, String(idle), String(MAX_HOURS * 3600)],
    );

    if (inserted.rowCount === 1) return { ok: true, sessionId };

    const current = await pool.query('SELECT * FROM merchant_active_sessions WHERE merchant_id = $1', [merchantId]);
    return { ok: false, reason: 'busy', current: rowToState(current.rows[0]) };
  }

  /** Valide un cookie : le session_id doit correspondre au verrou et le verrou doit être vivant. */
  async function verify(merchantId, sessionId) {
    if (!merchantId || !sessionId) return { ok: false, reason: 'no_session' };
    await ensureTable();
    const result = await pool.query('SELECT * FROM merchant_active_sessions WHERE merchant_id = $1', [merchantId]);
    const state = rowToState(result.rows[0]);
    if (!state) return { ok: false, reason: 'no_lock' };
    if (state.sessionId !== sessionId) return { ok: false, reason: 'replaced' };
    if (!state.live) return { ok: false, reason: state.revokedAt ? 'revoked' : 'expired' };
    return { ok: true, state };
  }

  /**
   * Marque la session comme active. On écrit au maximum toutes les 60 s : inutile de faire un
   * UPDATE par requête (les compteurs et listes pollent souvent), et cela suffit largement pour
   * une fenêtre d'inactivité de 30 minutes.
   */
  async function touch(merchantId, sessionId) {
    await ensureTable().catch(() => {});
    await pool.query(
      `UPDATE merchant_active_sessions SET last_seen_at = NOW()
       WHERE merchant_id = $1 AND session_id = $2 AND last_seen_at < NOW() - interval '60 seconds'`,
      [merchantId, sessionId],
    ).catch((error) => logger.error?.('touch session marchand :', error.message));
  }

  /** Déconnexion volontaire : le verrou est libéré immédiatement. */
  async function release(merchantId, sessionId = null) {
    await ensureTable().catch(() => {});
    const sql = sessionId
      ? 'DELETE FROM merchant_active_sessions WHERE merchant_id = $1 AND session_id = $2'
      : 'DELETE FROM merchant_active_sessions WHERE merchant_id = $1';
    const result = await pool.query(sql, sessionId ? [merchantId, sessionId] : [merchantId]);
    return result.rowCount;
  }

  /** PDG : révoquer la session d'un compte (le verrou reste, marqué révoqué → reconnexion possible). */
  async function revoke(merchantId, actorLabel = 'PDG') {
    await ensureTable();
    const result = await pool.query(
      `UPDATE merchant_active_sessions SET revoked_at = NOW(), revoked_by = $2
       WHERE merchant_id = $1 AND revoked_at IS NULL RETURNING *`,
      [merchantId, String(actorLabel).slice(0, 120)],
    );
    return rowToState(result.rows[0]);
  }

  /** PDG : état de toutes les sessions connues (vivantes ou non), pour l'écran d'administration. */
  async function list({ onlyLive = false } = {}) {
    await ensureTable();
    const result = await pool.query(`
      SELECT s.*, m.display_name, m.username
      FROM merchant_active_sessions s
      JOIN merchant_accounts m ON m.id = s.merchant_id
      ORDER BY s.last_seen_at DESC
      LIMIT 500`);
    const rows = result.rows.map((row) => ({
      merchantId: row.merchant_id,
      merchantName: row.display_name || row.username,
      username: row.username,
      ...rowToState(row),
    }));
    return onlyLive ? rows.filter((row) => row.live) : rows;
  }

  /** Purge d'entretien : supprime les verrous morts depuis plus d'une journée. */
  async function purgeStale() {
    await ensureTable().catch(() => {});
    await pool.query(`DELETE FROM merchant_active_sessions
      WHERE revoked_at IS NOT NULL OR last_seen_at < NOW() - interval '1 day'`).catch(() => {});
  }

  return { acquire, verify, touch, release, revoke, list, purgeStale, isLive, BUSY_MESSAGE, IDLE_SECONDS, MAX_HOURS };
}

module.exports = { createSessionRegistry, isLive, newSessionId, BUSY_MESSAGE, IDLE_SECONDS, MAX_HOURS };
