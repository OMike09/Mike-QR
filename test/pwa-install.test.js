'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const pwa = require('../public/pwa-install.js');

function createStorage() {
  const values = new Map();
  return {
    getItem(key) { return values.has(key) ? values.get(key) : null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

test('l’état d’installation est local au navigateur, à l’origine et à l’identité PWA', () => {
  const origin = 'https://qr.example.ci';
  const ceoId = '/';
  const managerOneId = '/manager/install/manager-one-token';
  const managerTwoId = '/manager/install/manager-two-token';
  const ceoKey = pwa.storageKey(origin, ceoId);
  const managerOneKey = pwa.storageKey(origin, managerOneId);
  const managerTwoKey = pwa.storageKey(origin, managerTwoId);
  const phoneKey = pwa.storageKey('https://qr.example.ci', ceoId);
  const otherDomainKey = pwa.storageKey('https://qr-other.example.ci', ceoId);

  assert.notEqual(ceoKey, managerOneKey, 'l’installation d’un compte ne masque pas celle d’un autre compte');
  assert.notEqual(managerOneKey, managerTwoKey, 'les PWA personnalisées des Gestionnaires ont un état distinct');
  assert.notEqual(phoneKey, otherDomainKey, 'l’état n’est pas partagé entre domaines/origines');
  assert.equal(pwa.storageKey('https://qr.example.ci', ceoId), ceoKey, 'un même navigateur retrouve une clé stable après réouverture');

  const desktopStorage = createStorage();
  assert.equal(pwa.decideVisibility({}).show, true, '1. une application non installée affiche l’option');
  pwa.writeLocalRecord(desktopStorage, ceoKey, true);
  assert.equal(pwa.readLocalRecord(desktopStorage, ceoKey), true);
  assert.equal(pwa.decideVisibility({ locallyRecorded: pwa.readLocalRecord(desktopStorage, ceoKey) }).show, false, '2. appinstalled masque l’option sur cet appareil');
  assert.equal(pwa.decideVisibility({ locallyRecorded: pwa.readLocalRecord(desktopStorage, ceoKey) }).show, false, '3. le marqueur local persiste après fermeture/réouverture');

  const freshPhoneStorage = createStorage();
  assert.equal(pwa.readLocalRecord(freshPhoneStorage, ceoKey), false);
  assert.equal(pwa.decideVisibility({ locallyRecorded: pwa.readLocalRecord(freshPhoneStorage, ceoKey) }).show, true, '4. un nouvel appareil/navigateur sans marqueur propose l’installation');
});

test('la détection réelle des navigateurs prévaut sur le marqueur local lorsqu’elle est disponible', () => {
  assert.deepEqual(pwa.decideVisibility({ standalone: true }), { show: false, clearLocalRecord: false });
  assert.deepEqual(pwa.decideVisibility({ relatedInstalled: true, relatedCheckSucceeded: true }), { show: false, clearLocalRecord: false });
  assert.deepEqual(pwa.decideVisibility({ relatedCheckSucceeded: true, locallyRecorded: true }), { show: true, clearLocalRecord: true }, 'si le navigateur confirme que la PWA associée n’est plus installée, le marqueur local obsolète est effacé');

  const origin = 'https://qr.example.ci';
  const rootManifest = { related_applications: [{ platform: 'webapp', id: '/' }] };
  assert.equal(pwa.manifestSelfReferences(rootManifest, '/', `${origin}/manifest.webmanifest`, origin), true);
  assert.equal(pwa.relatedAppIsInstalled([{ platform: 'webapp', id: `${origin}/` }], '/', `${origin}/manifest.webmanifest`, origin), true);
  const managerId = '/manager/install/abc123token';
  const managerManifest = { related_applications: [{ platform: 'webapp', id: managerId }] };
  assert.equal(pwa.manifestSelfReferences(managerManifest, managerId, `${origin}/api/manager/install/abc123token/manifest.webmanifest`, origin), true);
  assert.equal(pwa.relatedAppIsInstalled([{ platform: 'webapp', id: `${origin}${managerId}` }], managerId, `${origin}/api/manager/install/abc123token/manifest.webmanifest`, origin), true);
  assert.equal(pwa.pageWithinScope(`${origin}/manager`, { scope: '/manager' }, origin), true, 'le lien de l’espace Gestionnaire reste dans le scope permettant la détection');
  assert.equal(pwa.pageWithinScope(`${origin}/manager/install/abc123token`, { scope: '/manager' }, origin), true);
  assert.equal(pwa.pageWithinScope(`${origin}/manager-other`, { scope: '/manager' }, origin), false, 'la frontière de chemin du scope est respectée');
  assert.equal(pwa.pageWithinScope(`${origin}/admin`, { scope: '/manager' }, origin), false);
  assert.equal(pwa.relatedAppIsInstalled([{ platform: 'webapp', id: `${origin}/manager/install/other-token` }], managerId, `${origin}/api/manager/install/abc123token/manifest.webmanifest`, origin), false);
});

test('les guides varient selon l’appareil et ne prétendent pas détecter l’installation iOS depuis Safari', () => {
  const iosSafari = { navigator: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1', platform: 'iPhone', standalone: false } };
  const iosGuide = pwa.getInstallationGuide(iosSafari);
  assert.equal(iosGuide.supported, true);
  assert.ok(iosGuide.steps.join(' ').includes('Safari'));
  assert.ok(iosGuide.steps.join(' ').includes('Sur l’écran d’accueil'));
  assert.match(iosGuide.note, /ne permet pas.*savoir de façon fiable/i, 'les limites de détection iOS sont expliquées sans fausse promesse');
  assert.equal(pwa.isStandalone(iosSafari), false, 'un onglet Safari ne peut pas confirmer une installation sur l’écran d’accueil');
  assert.equal(pwa.decideVisibility({ standalone: pwa.isStandalone(iosSafari) }).show, true, '6. les instructions restent accessibles dans Safari tant qu’aucun mode autonome n’est détecté');
  const iosHomeScreen = { navigator: { ...iosSafari.navigator, standalone: true }, matchMedia: () => ({ matches: false }) };
  assert.equal(pwa.isStandalone(iosHomeScreen), true, 'l’application ouverte depuis l’écran d’accueil est détectée par navigator.standalone');
  assert.equal(pwa.decideVisibility({ standalone: pwa.isStandalone(iosHomeScreen) }).show, false);
  const standaloneMedia = { navigator: {}, matchMedia: (query) => ({ matches: query === '(display-mode: standalone)' }) };
  assert.equal(pwa.isStandalone(standaloneMedia), true, 'le mode autonome standard est également détecté sur Android/ordinateur');

  const androidGuide = pwa.getInstallationGuide({ navigator: { userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/128.0 Mobile Safari/537.36' } });
  assert.equal(androidGuide.supported, true);
  assert.ok(androidGuide.steps.join(' ').includes('menu ⋮'));
  const desktopGuide = pwa.getInstallationGuide({ navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/128.0 Safari/537.36' } });
  assert.equal(desktopGuide.supported, true);
  assert.ok(desktopGuide.steps.join(' ').includes('barre d’adresse'));
  const unsupportedGuide = pwa.getInstallationGuide({ navigator: { userAgent: 'Mozilla/5.0 Firefox/130.0' } });
  assert.equal(unsupportedGuide.supported, false, '5. un navigateur non pris en charge reçoit une explication et une alternative');
});

test('le contrôleur PWA écoute les événements officiels et vérifie le manifeste lié', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'pwa-install.js'), 'utf8');
  assert.match(source, /addEventListener\('beforeinstallprompt'/);
  assert.match(source, /addEventListener\('appinstalled'/);
  assert.match(source, /getInstalledRelatedApps/);
  assert.match(source, /display-mode:\s*standalone/);
  assert.match(source, /navigator\?\.standalone/);
  assert.match(source, /localStorage|win\.localStorage/);
});
