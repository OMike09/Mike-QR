'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child;
let base;
let tempDir;

async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function waitForServer() {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`QRia server exited (${child.exitCode}).`);
    try {
      const response = await fetch(`${base}/api/health`);
      if (response.ok) return;
    } catch (_) { /* Server is still starting. */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('QRia server did not start in time.');
}
async function call(url, { cookie = '', method = 'GET', body, headers = {} } = {}) {
  const requestHeaders = { Origin: base, ...headers };
  if (cookie) requestHeaders.Cookie = cookie;
  if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
  const response = await fetch(`${base}${url}`, { method, headers: requestHeaders, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')].filter(Boolean);
  const values = cookies.map((value) => value.split(';')[0]).filter((value) => /^qria_(?:admin|manager)=/.test(value));
  const active = values.find((value) => value.slice(value.indexOf('=') + 1) !== '');
  return { status: response.status, data, cookies, cookie: active || values[0] || cookie };
}
async function login(url, username, password) {
  const result = await call(url, { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.ok(result.cookie.includes('='));
  return result.cookie;
}
const codePayload = (beneficiaryId, name, saveMode = 'publish') => ({
  name, beneficiaryId, categoryId: 'cat-individuals', purpose: 'contact', destinationType: 'page', targetUrl: '',
  title: '', description: '', contentText: '', extraLinks: [], selectedFields: ['phone'], selectedPhotoIds: [], saveMode,
  customerType: 'individual', pricingPlanId: 'workflow-plan', optionIds: [], clientName: name,
  style: { foreground: '#173B32', background: '#FFFFFF', correction: 'M', textSize: 'default' },
});
const benePayload = (name) => ({
  type: 'individual', name, logo: '', photos: [], phone: '+225 0102030405', whatsapp: '', email: '', address: '',
  locationUrl: '', website: '', socials: [], bio: '', offers: [], documents: [],
});
const managerPayload = (username, displayName, password, rights = {}) => ({
  username, displayName, email: `${username}@example.ci`, phone: '+225 07 00 00 01 01', password,
  canCreateCodes: true, canEditCodes: true, canSelfActivateCodes: false, qrLimit: 0, ...rights,
});

test('migration JSON non destructive pour les comptes et QR historiques', async (t) => {
  const { createStore } = require('../store');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qria-legacy-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'store.json');
  const original = {
    managers: [{ id: 'manager-legacy', username: 'legacy.manager', displayName: 'Gestionnaire historique', email: 'legacy@example.ci', phone: '+225 01 02 03 04',
      passwordHash: 'scrypt$existing-hash', status: 'active', tokenVersion: 7, customDomain: 'legacy.example.ci', avatarData: 'data:image/png;base64,legacy-photo', installToken: 'legacy-install-token', createdAt: '2024-01-02T03:04:05.000Z' }],
    beneficiaries: [{ id: 'bene-legacy', type: 'individual', name: 'Bénéficiaire historique', status: 'active', photos: [{ id: 'photo-legacy', data: 'legacy-photo' }], createdAt: '2024-01-02T03:04:05.000Z' }],
    qrCodes: [{ id: 'qr-legacy', publicCode: 'LEGACYQR123', name: 'QR historique', beneficiaryId: 'bene-legacy', categoryId: 'cat-individuals', purpose: 'contact', destinationType: 'page', status: 'active', scanCount: 4, managerId: 'manager-legacy', createdAt: '2024-01-02T03:04:05.000Z' }],
    scans: [{ id: 1, qrCodeId: 'qr-legacy', scannedAt: '2024-02-03T04:05:06.000Z' }],
    audit: [{ id: 1, actor: 'PDG', action: 'create', entityType: 'qr_code', entityId: 'qr-legacy', summary: 'QR historique créé.', createdAt: '2024-01-02T03:04:05.000Z' }],
    categories: [{ id: 'cat-individuals', name: 'Particuliers', slug: 'particuliers', isSystem: true }],
    settings: { defaultPublicTextSize: 'normal' },
  };
  await fs.writeFile(filePath, JSON.stringify(original), 'utf8');
  const store = createStore({ filePath });
  await store.init();
  assert.equal(store.state.managers.length, 1);
  assert.equal(store.state.managers[0].passwordHash, original.managers[0].passwordHash);
  assert.equal(store.state.managers[0].tokenVersion, 7);
  assert.equal(store.state.managers[0].avatarData, original.managers[0].avatarData);
  assert.equal(store.state.managers[0].canSelfActivateCodes, true, 'la permission historique est conservée lors de l’ajout du workflow');
  assert.equal(store.state.beneficiaries[0].photos[0].id, 'photo-legacy');
  assert.equal(store.state.qrCodes[0].status, 'active');
  assert.equal(store.state.qrCodes[0].managerId, 'manager-legacy');
  assert.equal(store.state.scans.length, 1);
  assert.equal(store.state.audit.length, 1);
  await store.init();
  assert.equal(store.state.managers.length, 1, 'une seconde initialisation ne duplique ni ne réinitialise les données');
  assert.equal(store.state.qrCodes.length, 1);
  assert.equal(store.state.scans.length, 1);
});

test('workflow QR, permissions serveur, notifications, audit, limites et paramètres gestionnaire', { timeout: 60000 }, async (t) => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qria-workflow-test-'));
  const port = await freePort();
  base = `http://127.0.0.1:${port}`;
  const env = { ...process.env };
  delete env.DATABASE_URL;
  Object.assign(env, {
    NODE_ENV: 'test', PORT: String(port), QRIA_STORE_FILE: path.join(tempDir, 'store.json'),
    ADMIN_USERNAME: 'ceo-workflow', ADMIN_PASSWORD: 'CEO-Workflow-Strong-2026!',
    SESSION_SECRET: 'workflow-test-session-secret-long-enough-for-authentication',
  });
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'), env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr.on('data', (chunk) => { output += chunk.toString(); });
  try { await waitForServer(); } catch (error) { throw new Error(`${error.message}\n${output}`); }
  t.after(async () => {
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), new Promise((resolve) => setTimeout(resolve, 5000))]);
    }
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  const ceo = await login('/api/auth/login', 'ceo-workflow', 'CEO-Workflow-Strong-2026!');
  const reviewPassword = 'Review-Manager-Secret-2026!';
  const selfPassword = 'Self-Manager-Secret-2026!';
  const lockedPassword = 'Locked-Manager-Secret-2026!';
  const reviewCreate = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('review.manager', 'Gestionnaire Validation', reviewPassword, { qrLimit: 2 }) });
  const selfCreate = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('self.manager', 'Gestionnaire Autonome', selfPassword, { canSelfActivateCodes: true }) });
  const lockedCreate = await call('/api/admin/managers', { cookie: ceo, method: 'POST', body: managerPayload('locked.manager', 'Gestionnaire Limité', lockedPassword, { canCreateCodes: false }) });
  assert.equal(reviewCreate.status, 201, JSON.stringify(reviewCreate.data));
  assert.equal(selfCreate.status, 201, JSON.stringify(selfCreate.data));
  assert.equal(lockedCreate.status, 201, JSON.stringify(lockedCreate.data));
  const reviewId = reviewCreate.data.data.id;
  const selfId = selfCreate.data.data.id;
  const lockedId = lockedCreate.data.data.id;
  assert.equal(reviewCreate.data.data.canSelfActivateCodes, false, 'un nouveau compte sans autorisation explicite ne peut pas activer seul');
  assert.equal(selfCreate.data.data.canSelfActivateCodes, true);
  assert.equal(lockedCreate.data.data.canCreateCodes, false);
  for (const record of [reviewCreate.data.data, selfCreate.data.data, lockedCreate.data.data]) assert.equal('passwordHash' in record, false);

  const pricing = await call('/api/admin/finance/pricing', { cookie: ceo, method: 'PUT', body: { plans: [{
    id: 'workflow-plan', name: 'Tarif de test', customerType: 'individual', qrPurpose: 'contact', destinationType: 'page', amountXof: 1000, options: [], active: true,
  }] } });
  assert.equal(pricing.status, 200, JSON.stringify(pricing.data));
  const reviewCookie = await login('/api/manager/auth/login', 'review.manager', reviewPassword);
  const selfCookie = await login('/api/manager/auth/login', 'self.manager', selfPassword);
  const lockedCookie = await login('/api/manager/auth/login', 'locked.manager', lockedPassword);
  const reviewBene = await call('/api/manager/beneficiaries', { cookie: reviewCookie, method: 'POST', body: benePayload('Bénéficiaire Validation') });
  const selfBene = await call('/api/manager/beneficiaries', { cookie: selfCookie, method: 'POST', body: benePayload('Bénéficiaire Autonome') });
  const lockedBene = await call('/api/manager/beneficiaries', { cookie: lockedCookie, method: 'POST', body: benePayload('Bénéficiaire Limité') });
  assert.equal(reviewBene.status, 201);
  assert.equal(selfBene.status, 201);
  assert.equal(lockedBene.status, 201);

  // Scénario 1 — soumission obligatoire contrôlée par le serveur, QR non public avant validation.
  const pendingCreate = await call('/api/manager/codes', { cookie: reviewCookie, method: 'POST', body: codePayload(reviewBene.data.data.id, 'QR en attente') });
  assert.equal(pendingCreate.status, 201, JSON.stringify(pendingCreate.data));
  const pending = pendingCreate.data.data;
  assert.equal(pending.status, 'pending_validation');
  assert.equal((await call(`/api/public/qr/${pending.publicCode}`)).status, 404, 'un QR en attente ne doit pas être visible du public');
  assert.equal((await call('/api/manager/dashboard', { cookie: reviewCookie })).data.stats.pendingCodes, 1);
  const attemptedSelfActivation = await call(`/api/manager/codes/${pending.id}/status`, { cookie: reviewCookie, method: 'PATCH', body: { status: 'active' } });
  assert.equal(attemptedSelfActivation.status, 403, 'masquer le bouton ne suffit pas : l’API refuse aussi l’activation');
  assert.equal((await call(`/api/admin/codes/${pending.id}`, { cookie: ceo })).data.data.status, 'pending_validation');

  // Scénario 2 — brouillon séparé du workflow public, limite transactionnelle et non-destructive.
  const draftCreate = await call('/api/manager/codes', { cookie: reviewCookie, method: 'POST', body: codePayload(reviewBene.data.data.id, 'QR brouillon', 'draft') });
  assert.equal(draftCreate.status, 201, JSON.stringify(draftCreate.data));
  assert.equal(draftCreate.data.data.status, 'draft');
  assert.equal((await call(`/api/public/qr/${draftCreate.data.data.publicCode}`)).status, 404);
  const limitBlocked = await call('/api/manager/codes', { cookie: reviewCookie, method: 'POST', body: codePayload(reviewBene.data.data.id, 'QR hors limite') });
  assert.equal(limitBlocked.status, 409, 'la limite de deux QR est appliquée côté serveur');
  assert.equal((await call('/api/manager/codes', { cookie: reviewCookie })).data.total, 2);

  // Scénario 3 — le PDG valide; activation, exposition publique, notification et audit sont liés.
  const approval = await call(`/api/admin/codes/${pending.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active' } });
  assert.equal(approval.status, 200, JSON.stringify(approval.data));
  assert.equal(approval.data.data.status, 'active');
  assert.equal((await call(`/api/public/qr/${pending.publicCode}`)).status, 200);
  let reviewNotices = await call('/api/manager/notifications', { cookie: reviewCookie });
  const approvalNotice = reviewNotices.data.data.find((row) => row.entityId === pending.id && row.type === 'code_approved');
  assert.ok(approvalNotice, 'la décision du PDG crée une notification au bon compte');
  const approvalAudit = await call(`/api/admin/manager-activities?managerId=${reviewId}&action=activate&entityType=qr_code`, { cookie: ceo });
  const approvalEvent = approvalAudit.data.data.find((row) => row.entityId === pending.id && row.actorType === 'admin');
  assert.ok(approvalEvent);
  assert.equal(approvalEvent.result, 'success');
  assert.ok(approvalEvent.createdAt);
  assert.equal(approvalEvent.afterData.status, 'active');

  // Scénario 4 — suspension/refus avec motif obligatoire, motif durable et resoumission non publique.
  const missingReason = await call(`/api/admin/codes/${pending.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended' } });
  assert.equal(missingReason.status, 400, 'le serveur exige le motif avant toute suspension par le PDG');
  const suspended = await call(`/api/admin/codes/${pending.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Vérifier les coordonnées du bénéficiaire.' } });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.data.data.statusReason, 'Vérifier les coordonnées du bénéficiaire.');
  assert.equal((await call(`/api/public/qr/${pending.publicCode}`)).status, 404);
  const suspendedNotice = (await call('/api/manager/notifications', { cookie: reviewCookie })).data.data.find((row) => row.entityId === pending.id && row.type === 'code_suspended');
  assert.equal(suspendedNotice.body, 'Vérifier les coordonnées du bénéficiaire.');
  const reactivationByManager = await call(`/api/manager/codes/${pending.id}/status`, { cookie: reviewCookie, method: 'PATCH', body: { status: 'active' } });
  assert.equal(reactivationByManager.status, 403, 'seul le PDG réactive un QR précédemment suspendu');
  const resubmitted = await call('/api/manager/codes', { cookie: reviewCookie, method: 'POST', body: codePayload(reviewBene.data.data.id, 'QR à refuser') });
  assert.equal(resubmitted.status, 409, 'la limite reste effective jusqu’à la suppression explicite du brouillon');
  const deleteDraft = await call(`/api/manager/codes/${draftCreate.data.data.id}`, { cookie: reviewCookie, method: 'DELETE' });
  assert.equal(deleteDraft.status, 200);
  const rejectedCreate = await call('/api/manager/codes', { cookie: reviewCookie, method: 'POST', body: codePayload(reviewBene.data.data.id, 'QR à refuser') });
  assert.equal(rejectedCreate.status, 201, JSON.stringify(rejectedCreate.data));
  assert.equal(rejectedCreate.data.data.status, 'pending_validation');
  const reason = 'Destination non conforme aux règles QRia.';
  const rejection = await call(`/api/admin/codes/${rejectedCreate.data.data.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'rejected', reason } });
  assert.equal(rejection.status, 200);
  assert.equal(rejection.data.data.status, 'rejected');
  assert.equal(rejection.data.data.statusReason, reason);
  assert.equal((await call(`/api/public/qr/${rejectedCreate.data.data.publicCode}`)).status, 404);
  reviewNotices = await call('/api/manager/notifications', { cookie: reviewCookie });
  assert.ok(reviewNotices.data.data.some((row) => row.entityId === rejectedCreate.data.data.id && row.type === 'code_rejected' && row.body === reason));
  const rejectionAudit = await call(`/api/admin/manager-activities?managerId=${reviewId}&action=reject&entityType=qr_code`, { cookie: ceo });
  assert.ok(rejectionAudit.data.data.some((row) => row.entityId === rejectedCreate.data.data.id && row.metadata?.reason === reason && row.actorType === 'admin'));

  // Scénario 5 — l’autonomie n’est accordée qu’au compte choisi; le PDG peut ensuite suspendre.
  const selfQr = await call('/api/manager/codes', { cookie: selfCookie, method: 'POST', body: codePayload(selfBene.data.data.id, 'QR autonome') });
  assert.equal(selfQr.status, 201, JSON.stringify(selfQr.data));
  assert.equal(selfQr.data.data.status, 'active');
  assert.equal((await call(`/api/public/qr/${selfQr.data.data.publicCode}`)).status, 200);
  const selfSuspension = await call(`/api/admin/codes/${selfQr.data.data.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'suspended', reason: 'Contrôle ponctuel.' } });
  assert.equal(selfSuspension.status, 200);
  assert.equal((await call(`/api/public/qr/${selfQr.data.data.publicCode}`)).status, 404);
  const selfReactivationAttempt = await call(`/api/manager/codes/${selfQr.data.data.id}/status`, { cookie: selfCookie, method: 'PATCH', body: { status: 'active' } });
  assert.equal(selfReactivationAttempt.status, 403);
  const editedSuspendedQr = await call(`/api/manager/codes/${selfQr.data.data.id}`, { cookie: selfCookie, method: 'PUT', body: {
    name: selfQr.data.data.name, beneficiaryId: selfBene.data.data.id, categoryId: 'cat-individuals', purpose: 'contact', destinationType: 'page', targetUrl: '',
    title: selfQr.data.data.title, description: selfQr.data.data.description, contentText: selfQr.data.data.contentText, extraLinks: selfQr.data.data.extraLinks,
    selectedFields: selfQr.data.data.selectedFields, selectedPhotoIds: [], style: selfQr.data.data.style, saveMode: 'publish',
  } });
  assert.equal(editedSuspendedQr.status, 200, JSON.stringify(editedSuspendedQr.data));
  assert.equal(editedSuspendedQr.data.data.status, 'pending_validation', 'même un gestionnaire autonome doit soumettre une modification après suspension');
  assert.equal((await call(`/api/public/qr/${selfQr.data.data.publicCode}`)).status, 404);
  const selfReactivation = await call(`/api/admin/codes/${selfQr.data.data.id}/status`, { cookie: ceo, method: 'PATCH', body: { status: 'active' } });
  assert.equal(selfReactivation.status, 200);
  assert.equal((await call(`/api/public/qr/${selfQr.data.data.publicCode}`)).status, 200);

  // Scénario 6 — autorisation de création/edit contrôlée côté serveur et données isolées entre gestionnaires.
  const forbiddenCreate = await call('/api/manager/codes', { cookie: lockedCookie, method: 'POST', body: codePayload(lockedBene.data.data.id, 'QR interdit') });
  assert.equal(forbiddenCreate.status, 403, 'la permission désactivée par le PDG est appliquée par l’API');
  const foreignRead = await call(`/api/manager/codes/${pending.id}`, { cookie: selfCookie });
  assert.equal(foreignRead.status, 403);
  const foreignNotification = await call(`/api/manager/notifications/${approvalNotice.id}/read`, { cookie: selfCookie, method: 'PATCH' });
  assert.equal(foreignNotification.status, 404, 'un gestionnaire ne peut pas marquer comme lue la notification d’un autre');
  assert.equal((await call('/api/manager/codes', { cookie: selfCookie })).data.total, 1);
  assert.equal((await call('/api/manager/codes', { cookie: reviewCookie })).data.total, 2, 'les listes ne comprennent que les QR non supprimés de ce compte');
  const managerMessage = await call(`/api/admin/managers/${reviewId}/messages`, { cookie: ceo, method: 'POST', body: { title: 'Information QRia', body: 'Merci de corriger les coordonnées avant une nouvelle soumission.' } });
  assert.equal(managerMessage.status, 201, JSON.stringify(managerMessage.data));
  const reviewInbox = await call('/api/manager/notifications', { cookie: reviewCookie });
  const pdgMessage = reviewInbox.data.data.find((row) => row.type === 'pdg_message');
  assert.ok(pdgMessage);
  assert.equal(pdgMessage.body, 'Merci de corriger les coordonnées avant une nouvelle soumission.');
  assert.equal((await call('/api/manager/notifications', { cookie: selfCookie })).data.data.some((row) => row.type === 'pdg_message'), false);
  assert.equal((await call(`/api/manager/notifications/${pdgMessage.id}/read`, { cookie: reviewCookie, method: 'PATCH' })).status, 200);

  // Scénario 7 — profil, préférences, réauthentification et changement de mot de passe.
  const missingReauth = await call('/api/manager/profile', { cookie: reviewCookie, method: 'PUT', body: { email: 'review.updated@example.ci' } });
  assert.equal(missingReauth.status, 403, 'le changement d’e-mail exige le mot de passe courant');
  const updatedProfile = await call('/api/manager/profile', { cookie: reviewCookie, method: 'PUT', body: {
    displayName: 'Gestionnaire Validation Modifié', email: 'review.updated@example.ci', phone: '+225 05 11 22 33 44', currentPassword: reviewPassword,
    notificationPreferences: { codeUpdates: true, validationResults: false, suspensions: true, pdgMessages: true, securityAlerts: true },
  } });
  assert.equal(updatedProfile.status, 200, JSON.stringify(updatedProfile.data));
  assert.equal(updatedProfile.data.data.notificationPreferences.validationResults, false);
  assert.equal('passwordHash' in updatedProfile.data.data, false);
  assert.equal((await call('/api/manager/profile', { cookie: selfCookie })).data.data.email, 'self.manager@example.ci', 'le profil d’un autre gestionnaire n’est pas modifié ni exposé');
  const reviewActivities = await call('/api/manager/activity', { cookie: reviewCookie });
  assert.ok(reviewActivities.data.data.length > 0);
  const badCurrentPassword = await call('/api/manager/auth/update-password', { cookie: reviewCookie, method: 'POST', body: { currentPassword: 'wrong', newPassword: 'Review-Manager-New-Secret-2026!', confirmPassword: 'Review-Manager-New-Secret-2026!' } });
  assert.equal(badCurrentPassword.status, 403);
  const newPassword = 'Review-Manager-New-Secret-2026!';
  const changedPassword = await call('/api/manager/auth/update-password', { cookie: reviewCookie, method: 'POST', body: { currentPassword: reviewPassword, newPassword, confirmPassword: newPassword } });
  assert.equal(changedPassword.status, 200, JSON.stringify(changedPassword.data));
  assert.equal((await call('/api/manager/auth/me', { cookie: reviewCookie })).status, 401, 'les anciennes sessions sont révoquées après le changement de mot de passe');
  const newLogin = await call('/api/manager/auth/login', { method: 'POST', body: { username: 'review.manager', password: newPassword } });
  assert.equal(newLogin.status, 200);
  assert.equal((await call('/api/manager/auth/login', { method: 'POST', body: { username: 'review.manager', password: reviewPassword } })).status, 401);

  // Les vues livrées présentent bien les workflows, sans exposition de mots de passe.
  const managerHtml = await fetch(`${base}/manager`).then((response) => response.text());
  const adminHtml = await fetch(`${base}/admin`).then((response) => response.text());
  assert.match(managerHtml, /view-notifications|Notifications/i);
  assert.match(managerHtml, /view-profile|Mon profil/i);
  assert.match(managerHtml, /pending_validation|En attente de validation/i);
  assert.match(adminHtml, /statPendingCodes/);
  assert.match(adminHtml, /pending_validation/);

  const persistedRaw = await fs.readFile(path.join(tempDir, 'store.json'), 'utf8');
  for (const secret of ['CEO-Workflow-Strong-2026!', reviewPassword, selfPassword, lockedPassword, newPassword]) assert.equal(persistedRaw.includes(secret), false);
  const persisted = JSON.parse(persistedRaw);
  assert.ok(persisted.audit.some((event) => event.action === 'reject' && event.managerId === reviewId), 'le refus est durablement audité et rattaché au gestionnaire');
});
