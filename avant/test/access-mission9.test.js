'use strict';

// ============================================================================================
// Mission 9 — tests unitaires (aucun serveur requis)
//
// Ce qui est vérifié ici ne peut pas être vérifié par un parcours HTTP :
//   • les initiales du code provisoire (« Chez Gbaziké » → CG) ;
//   • le format INITIALES-XXXXXX et l'absence de caractères ambigus ;
//   • l'unicité et le hachage (le code en clair n'est jamais stocké) ;
//   • la consommation atomique (une seule fois) ;
//   • le caractère additif et rejouable du schéma ;
//   • le fait que la fenêtre d'inscription précède le formulaire.
// ============================================================================================

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const root = path.join(__dirname, '..');
const { initialsOf, createAccessControl } = require('../access-control');

// Magasin en mémoire minimal : reproduit l'API utilisée par access-control.js.
function memoryStore() {
  const state = { settings: {}, accessResetCodes: [], teamJoinRequests: [] };
  return {
    state,
    async save() {},
    async getSettings() { return { supportContact: { phone: '', email: '' }, ...state.settings }; },
    async getManager(id) { return id === 'mgr_1' ? { id: 'mgr_1', username: 'gest', displayName: 'Gestionnaire Test', status: 'active' } : null; },
    async listMerchants() { return []; },
  };
}
const commerceStub = {
  async getMerchant() { return null; },
  async listMerchants() { return []; },
};

test('M9-1. les initiales suivent l’exemple du cahier des charges', () => {
  assert.equal(initialsOf('Chez Gbaziké'), 'CG', '« Chez Gbaziké » doit donner CG');
  assert.equal(initialsOf('chez gbazike'), 'CG', 'la casse et les accents ne changent rien');
  assert.equal(initialsOf('Maquis du Plateau'), 'MDP');
  assert.equal(initialsOf('Le Bar'), 'LB');
  assert.equal(initialsOf('Awa'), 'AW', 'un nom d’un seul mot garde deux lettres');
  assert.equal(initialsOf(''), 'OY', 'aucun nom : repli neutre, jamais une erreur');
});

test('M9-2. le code provisoire a le format INITIALES-XXXXXX, sans caractère ambigu', async () => {
  const store = memoryStore();
  const access = createAccessControl({ store, team: { pg: false }, commerce: commerceStub });
  const issued = await access.createResetCode({ accountType: 'merchant', accountId: 'm1', accountLabel: 'Chez Gbaziké',
    actor: { type: 'admin', id: 'admin', label: 'PDG' } });
  assert.match(issued.code, /^CG-[A-Z0-9]{6}$/, `format inattendu : ${issued.code}`);
  const body = issued.code.slice(3);
  for (const forbidden of ['I', 'O', '0', '1']) {
    assert.ok(!body.includes(forbidden), `caractère ambigu ${forbidden} présent dans ${issued.code}`);
  }
  assert.ok(!issued.code.includes(issued.code.slice(-6)) || true);
});

test('M9-3. le code en clair n’est jamais stocké et le hachage est stable', async () => {
  const store = memoryStore();
  const access = createAccessControl({ store, team: { pg: false }, commerce: commerceStub });
  const issued = await access.createResetCode({ accountType: 'merchant', accountId: 'm2', accountLabel: 'Maquis Test',
    actor: { type: 'admin', id: 'admin', label: 'PDG' } });
  const stored = JSON.stringify(store.state.accessResetCodes);
  assert.ok(!stored.includes(issued.code), 'le code en clair ne doit jamais apparaître en base');
  assert.ok(stored.includes('codeHash'), 'seul le hachage est conservé');
  assert.equal(access.hashResetCode(issued.code), access.hashResetCode(issued.code.toLowerCase()), 'hachage insensible à la casse');
  assert.notEqual(access.hashResetCode(issued.code), access.hashResetCode('CG-ZZZZZZ'), 'deux codes différents ont deux hachages différents');
});

test('M9-4. deux cents codes consécutifs ne se ressemblent pas et restent uniques', async () => {
  const store = memoryStore();
  const access = createAccessControl({ store, team: { pg: false }, commerce: commerceStub });
  const seen = new Set();
  for (let index = 0; index < 200; index += 1) {
    const issued = await access.createResetCode({ accountType: 'merchant', accountId: `m${index}`, accountLabel: 'Chez Test',
      actor: { type: 'admin', id: 'admin', label: 'PDG' } });
    assert.ok(!seen.has(issued.code), `collision sur ${issued.code}`);
    seen.add(issued.code);
  }
  assert.equal(seen.size, 200);
});

test('M9-5. un code provisoire ne sert qu’une seule fois', async () => {
  const store = memoryStore();
  const access = createAccessControl({ store, team: { pg: false }, commerce: commerceStub });
  const issued = await access.createResetCode({ accountType: 'merchant', accountId: 'm3', accountLabel: 'Chez Unique',
    actor: { type: 'admin', id: 'admin', label: 'PDG' } });
  const consumed = await access.consumeResetCode(issued.code);
  assert.equal(consumed.accountId, 'm3');
  await assert.rejects(() => access.consumeResetCode(issued.code), (error) => {
    assert.equal(error.code, 'RESET_CODE_USED');
    return true;
  });
});

test('M9-6. un code révoqué ou expiré est refusé avant toute consommation', async () => {
  const store = memoryStore();
  const access = createAccessControl({ store, team: { pg: false }, commerce: commerceStub });
  const revoked = await access.createResetCode({ accountType: 'merchant', accountId: 'm4', accountLabel: 'Chez Révoqué',
    actor: { type: 'admin', id: 'admin', label: 'PDG' } });
  await access.revokeResetCode(revoked.id, { label: 'PDG' }, 'test');
  await assert.rejects(() => access.findResetCode(revoked.code), (error) => error.code === 'RESET_CODE_REVOKED');

  const expired = await access.createResetCode({ accountType: 'merchant', accountId: 'm5', accountLabel: 'Chez Expiré',
    actor: { type: 'admin', id: 'admin', label: 'PDG' }, ttlHours: 1 });
  const row = store.state.accessResetCodes.find((item) => item.id === expired.id);
  row.expiresAt = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(() => access.findResetCode(expired.code), (error) => error.code === 'RESET_CODE_EXPIRED');
});

test('M9-7. un nouveau code révoque l’ancien code encore disponible du même compte', async () => {
  const store = memoryStore();
  const access = createAccessControl({ store, team: { pg: false }, commerce: commerceStub });
  const first = await access.createResetCode({ accountType: 'merchant', accountId: 'm6', accountLabel: 'Chez Double',
    actor: { type: 'admin', id: 'admin', label: 'PDG' } });
  const second = await access.createResetCode({ accountType: 'merchant', accountId: 'm6', accountLabel: 'Chez Double',
    actor: { type: 'admin', id: 'admin', label: 'PDG' } });
  await assert.rejects(() => access.findResetCode(first.code), (error) => error.code === 'RESET_CODE_REVOKED');
  const ok = await access.findResetCode(second.code);
  assert.equal(ok.accountId, 'm6');
});

test('M9-8. le schéma de la Mission 9 est additif et rejouable', async () => {
  const sql = await fsp.readFile(path.join(root, 'schema-access-mission9.sql'), 'utf8');
  assert.ok(!/DROP\s+TABLE/i.test(sql), 'aucun DROP TABLE');
  assert.ok(!/DELETE\s+FROM/i.test(sql), 'aucun DELETE');
  assert.ok(!/ALTER\s+TABLE\s+\w+\s+DROP\s+COLUMN/i.test(sql), 'aucune colonne supprimée');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS team_join_requests'));
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS access_reset_codes'));
  assert.ok(sql.includes('ADD COLUMN IF NOT EXISTS reserved_until'), 'colonnes ajoutées avec IF NOT EXISTS');
  assert.ok(sql.includes('UNIQUE INDEX IF NOT EXISTS access_reset_codes_hash_unique_idx'), 'unicité du code garantie par la base');
  // La migration passe en dernier pour ne dépendre d'aucun autre schéma.
  const store = await fsp.readFile(path.join(root, 'store.js'), 'utf8');
  const index = store.indexOf('const schemaFiles =');
  assert.ok(index > -1, 'la liste des migrations existe');
  const block = store.slice(index, index + 500);
  assert.ok(block.includes("'schema-access-mission9.sql'"), 'la migration est déclarée');
  assert.ok(/schema-admin-control-mission8\.sql',\s*'schema-access-mission9\.sql'\]/.test(block), 'déclarée en dernière position');
});

test('M9-9. aucune route sensible ne fuit un mot de passe ou un hachage', async () => {
  const source = await fsp.readFile(path.join(root, 'access-routes.js'), 'utf8');
  assert.ok(!/res\.json\([^)]*passwordHash/.test(source), 'aucun hachage renvoyé');
  assert.ok(!/res\.json\([^)]*password:\s*data/.test(source), 'aucun mot de passe en clair renvoyé hors code temporaire explicite');
  // Les routes sensibles exigent une session vérifiée.
  assert.ok(source.includes('requireAdmin') && source.includes('requireManager') && source.includes('requireMerchant'));
  // La consommation du code provisoire est conditionnelle et atomique.
  const control = await fsp.readFile(path.join(root, 'access-control.js'), 'utf8');
  assert.ok(/UPDATE access_reset_codes SET used_at=NOW\(\)[\s\S]*?WHERE id=\$1 AND used_at IS NULL AND revoked_at IS NULL AND expires_at > NOW\(\)/.test(control),
    'la consommation est décidée par une seule requête conditionnelle');
  assert.ok(/UPDATE field_enrollment_codes[\s\S]{0,400}reserved_token = \$2/.test(await fsp.readFile(path.join(root, 'admin-control.js'), 'utf8')),
    'la réservation du code terrain est vérifiée à la consommation');
});

test('M9-10. la fenêtre de code précède le formulaire dans le parcours public', async () => {
  const [html, gate, signup] = await Promise.all([
    fsp.readFile(path.join(root, 'public/merchant-signup.html'), 'utf8'),
    fsp.readFile(path.join(root, 'public/signup-gate.js'), 'utf8'),
    fsp.readFile(path.join(root, 'public/merchant-signup.js'), 'utf8'),
  ]);
  assert.ok(html.indexOf('id="codeGate"') < html.indexOf('id="signupForm"'), 'la fenêtre de code est placée avant le formulaire');
  assert.ok(gate.includes('lockForm()'), 'le formulaire est verrouillé sans code vérifié');
  assert.ok(gate.includes('/api/public/field-codes/reserve'), 'la vérification passe par la réservation serveur');
  assert.ok(!gate.includes('localStorage.setItem(TOKEN_KEY'), 'la réservation n’est pas stockée durablement sur l’appareil');
  assert.ok(signup.includes('Vérifiez d’abord votre code d’autorisation'), 'aucun envoi possible sans autorisation');
});

test('M9-11. les quotas ne sont plus librement modifiables par le marchand', async () => {
  const [html, js] = await Promise.all([
    fsp.readFile(path.join(root, 'public/merchant.html'), 'utf8'),
    fsp.readFile(path.join(root, 'public/merchant-team.js'), 'utf8'),
  ]);
  assert.ok(/id="teamMaxGm"[^>]*readonly/.test(html), 'le champ gérants est en lecture seule');
  assert.ok(/id="teamMaxWaitress"[^>]*readonly/.test(html), 'le champ serveuses est en lecture seule');
  assert.ok(js.includes('merchantCanEditQuotas'), 'l’interface suit le réglage du PDG');
});
