(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root && root.window === root && root.document) api.mount(root, root.document);
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const STORAGE_PREFIX = 'qria:pwa-installed:v1:';

  function normalizeAppId(value, origin) {
    const base = origin || 'https://qria.invalid';
    let url;
    try { url = new URL(String(value || '/'), base); }
    catch (_) { url = new URL('/', base); }
    url.search = '';
    url.hash = '';
    if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');
    return `${url.origin}${url.pathname}`;
  }

  function storageKey(origin, appId) {
    return `${STORAGE_PREFIX}${encodeURIComponent(normalizeAppId(appId, origin))}`;
  }

  function isStandalone(environment) {
    const env = environment || {};
    let displayMode = false;
    try { displayMode = Boolean(env.matchMedia?.('(display-mode: standalone)')?.matches); }
    catch (_) { /* A restricted browser may not expose matchMedia. */ }
    return displayMode || env.navigator?.standalone === true;
  }

  function platformInfo(environment) {
    const env = environment || {};
    const nav = env.navigator || {};
    const ua = String(nav.userAgent || '');
    const platform = String(nav.platform || '');
    const touchMac = platform === 'MacIntel' && Number(nav.maxTouchPoints || 0) > 1;
    const ios = /iPhone|iPad|iPod/i.test(ua) || touchMac;
    const android = /Android/i.test(ua);
    const safari = /Safari/i.test(ua) && !/(Chrome|Chromium|CriOS|Edg|EdgiOS|FxiOS|OPR|Android)/i.test(ua);
    const mac = !ios && /Macintosh|MacIntel|MacPPC|Mac68K/i.test(`${ua} ${platform}`);
    const chromium = /(Chrome|Chromium|CriOS|Edg|EdgiOS)/i.test(ua);
    return { ios, android, safari, mac, chromium };
  }

  function getInstallationGuide(environment) {
    const info = platformInfo(environment);
    if (info.ios) {
      return {
        supported: true,
        title: 'Installer QRia sur votre iPhone ou iPad',
        intro: 'iOS ne propose pas de fenêtre d’installation web pilotable par QRia. Ajoutez l’application depuis Safari :',
        steps: [
          'Ouvrez cette page dans Safari.',
          'Touchez Partager (le carré avec la flèche vers le haut).',
          'Choisissez « Sur l’écran d’accueil ».',
          'Touchez « Ajouter ».',
        ],
        note: 'iOS ne permet pas à une page Safari de savoir de façon fiable si son icône a déjà été ajoutée. QRia masque cette option lorsqu’il est ouvert depuis l’icône installée; dans Safari, les instructions peuvent rester visibles.',
      };
    }
    if (info.android) {
      return {
        supported: true,
        title: 'Installer QRia sur Android',
        intro: 'Si le navigateur ne présente pas directement sa fenêtre d’installation, ouvrez son menu :',
        steps: [
          'Touchez le menu ⋮ du navigateur.',
          'Choisissez « Installer l’application » ou « Ajouter à l’écran d’accueil ».',
          'Confirmez l’ajout de QRia.',
        ],
        note: 'Si cette commande n’apparaît pas, ouvrez le lien dans Chrome ou un autre navigateur Android compatible, puis réessayez.',
      };
    }
    if (info.mac && info.safari) {
      return {
        supported: true,
        title: 'Installer QRia sur cet ordinateur',
        intro: 'Dans Safari sur macOS, utilisez le menu du navigateur :',
        steps: [
          'Ouvrez le menu « Fichier ».',
          'Choisissez « Ajouter au Dock » si cette commande est proposée.',
          'Confirmez l’ajout de QRia au Dock.',
        ],
        note: 'Cette commande dépend de la version de Safari et de macOS. Si elle n’est pas proposée, utilisez un navigateur compatible ou conservez QRia dans vos favoris.',
      };
    }
    if (info.chromium) {
      return {
        supported: true,
        title: 'Installer QRia sur cet ordinateur',
        intro: 'Si le navigateur ne présente pas directement sa fenêtre d’installation :',
        steps: [
          'Cherchez l’icône Installer dans la barre d’adresse, si elle est affichée.',
          'Sinon, ouvrez le menu du navigateur (⋮ ou …).',
          'Choisissez « Installer QRia » ou « Installer cette application ».',
        ],
        note: 'L’intitulé varie selon Chrome, Edge et leur version. Si aucune commande d’installation n’est disponible, la page peut ne pas satisfaire les critères du navigateur sur cet appareil.',
      };
    }
    return {
      supported: false,
      title: 'Installation non prise en charge par ce navigateur',
      intro: 'Ce navigateur ne fournit pas de méthode d’installation de QRia que nous puissions guider de façon fiable.',
      steps: [
        'Ouvrez le lien dans Chrome ou Edge sur ordinateur, ou dans un navigateur compatible sur Android.',
        'Sur iPhone ou iPad, ouvrez-le dans Safari puis utilisez Partager → « Sur l’écran d’accueil ».',
      ],
      note: 'Vous pouvez aussi ajouter QRia aux favoris, mais un favori n’est pas une application installée.',
    };
  }

  function sameUrl(left, right, origin) {
    if (!left || !right) return false;
    try {
      const a = new URL(String(left), origin); const b = new URL(String(right), origin);
      a.hash = ''; b.hash = '';
      return a.origin === b.origin && a.pathname.replace(/\/+$/, '/') === b.pathname.replace(/\/+$/, '/');
    } catch (_) { return false; }
  }

  function manifestSelfReferences(manifest, appId, manifestHref, origin) {
    const related = Array.isArray(manifest?.related_applications) ? manifest.related_applications : [];
    return related.some((app) => app?.platform === 'webapp' && (
      (app.id && normalizeAppId(app.id, origin) === normalizeAppId(appId, origin)) ||
      (app.url && sameUrl(app.url, manifestHref, origin))
    ));
  }

  function relatedAppIsInstalled(apps, appId, manifestHref, origin) {
    if (!Array.isArray(apps)) return false;
    const expectedId = normalizeAppId(appId, origin);
    return apps.some((app) => app?.platform === 'webapp' && (
      (app.id && normalizeAppId(app.id, origin) === expectedId) ||
      (app.url && sameUrl(app.url, manifestHref, origin))
    ));
  }

  function pageWithinScope(pageUrl, manifest, origin) {
    try {
      const page = new URL(String(pageUrl || '/'), origin);
      const scope = new URL(String(manifest?.scope || '/'), origin);
      if (page.origin !== scope.origin) return false;
      const path = scope.pathname;
      const directoryPrefix = path.endsWith('/') ? path : `${path}/`;
      return page.pathname === path || page.pathname.startsWith(directoryPrefix);
    } catch (_) { return false; }
  }

  function decideVisibility({ standalone = false, relatedInstalled = false, relatedCheckSucceeded = false, locallyRecorded = false } = {}) {
    if (standalone || relatedInstalled) return { show: false, clearLocalRecord: false };
    if (relatedCheckSucceeded) return { show: true, clearLocalRecord: locallyRecorded };
    return { show: !locallyRecorded, clearLocalRecord: false };
  }

  function readLocalRecord(storage, key) {
    try { return storage?.getItem(key) === 'installed'; }
    catch (_) { return false; }
  }

  function writeLocalRecord(storage, key, installed) {
    try {
      if (installed) storage?.setItem(key, 'installed');
      else storage?.removeItem(key);
      return true;
    } catch (_) { return false; }
  }

  function fallbackAppId(win) {
    const pathname = String(win.location?.pathname || '/');
    if (pathname.startsWith('/manager/install/')) return pathname;
    if (pathname.startsWith('/manager')) return '/manager/';
    return '/';
  }

  function buildDialog(win, doc) {
    const overlay = doc.createElement('div');
    overlay.className = 'pwa-install-overlay';
    overlay.hidden = true;
    overlay.innerHTML = '<section class="pwa-install-dialog" role="dialog" aria-modal="true" aria-labelledby="pwaInstallTitle" aria-describedby="pwaInstallIntro"><button class="pwa-install-close" type="button" aria-label="Fermer les instructions" data-pwa-close>×</button><span class="pwa-install-kicker">QRIA · INSTALLATION</span><h2 id="pwaInstallTitle">Installer QRia</h2><p id="pwaInstallIntro"></p><ol id="pwaInstallSteps"></ol><p class="pwa-install-note" id="pwaInstallNote"></p><button class="pwa-install-done" type="button" data-pwa-close>Compris</button></section>';
    doc.body.appendChild(overlay);
    const close = () => {
      overlay.hidden = true;
      if (overlay.returnFocus?.isConnected) overlay.returnFocus.focus();
    };
    const closeButtons = overlay.querySelectorAll('[data-pwa-close]');
    closeButtons.forEach((button) => button.addEventListener('click', close));
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });
    doc.addEventListener('keydown', (event) => { if (event.key === 'Escape' && !overlay.hidden) close(); });
    return {
      open(focusTarget) {
        const guide = getInstallationGuide(win);
        overlay.returnFocus = focusTarget;
        overlay.querySelector('#pwaInstallTitle').textContent = guide.title;
        overlay.querySelector('#pwaInstallIntro').textContent = guide.intro;
        overlay.querySelector('#pwaInstallNote').textContent = guide.note;
        const list = overlay.querySelector('#pwaInstallSteps');
        list.replaceChildren();
        guide.steps.forEach((step) => {
          const item = doc.createElement('li');
          item.textContent = step;
          list.appendChild(item);
        });
        overlay.hidden = false;
        overlay.querySelector('[data-pwa-close]').focus();
      },
      close,
    };
  }

  function mount(win, doc) {
    const buttons = [...doc.querySelectorAll('[data-pwa-install]')];
    if (!buttons.length) return null;

    const origin = win.location.origin;
    const storage = (() => { try { return win.localStorage; } catch (_) { return null; } })();
    const dialog = buildDialog(win, doc);
    const manifestLink = doc.querySelector('link[rel="manifest"]');
    let installPrompt = null;
    let currentAppId = normalizeAppId(fallbackAppId(win), origin);
    let currentKey = storageKey(origin, currentAppId);
    let installedThisPage = new Set();
    let refreshSequence = 0;

    const render = (show) => buttons.forEach((button) => { button.hidden = !show; });

    async function readIdentity() {
      const hrefValue = manifestLink?.getAttribute('href') || '/manifest.webmanifest';
      let manifestUrl;
      try { manifestUrl = new URL(hrefValue, win.location.href); }
      catch (_) { manifestUrl = new URL('/manifest.webmanifest', origin); }
      let manifest = null;
      if ((manifestUrl.protocol === 'https:' || manifestUrl.protocol === 'http:') && manifestUrl.origin === origin && typeof win.fetch === 'function') {
        try {
          const response = await win.fetch(manifestUrl.href, { credentials: 'same-origin', cache: 'no-cache' });
          if (response.ok) manifest = await response.json();
        } catch (_) { /* The local path remains usable when the manifest cannot be fetched. */ }
      }
      const ready = Boolean(manifest && (manifest.id || manifest.start_url));
      const appId = normalizeAppId(manifest?.id || manifest?.start_url || fallbackAppId(win), origin);
      const manifestHref = manifestUrl.origin === origin ? manifestUrl.href : '';
      return { ready, appId, manifestHref, manifest };
    }

    async function refresh() {
      const sequence = ++refreshSequence;
      const identity = await readIdentity();
      if (sequence !== refreshSequence) return;
      if (!identity.ready) { render(false); return; }
      currentAppId = identity.appId;
      currentKey = storageKey(origin, currentAppId);
      const locallyRecorded = readLocalRecord(storage, currentKey);
      const standalone = isStandalone(win);
      let relatedCheckSucceeded = false;
      let relatedInstalled = false;
      const selfRelated = manifestSelfReferences(identity.manifest, currentAppId, identity.manifestHref, origin);
      if (selfRelated && pageWithinScope(win.location.href, identity.manifest, origin) && typeof win.navigator?.getInstalledRelatedApps === 'function') {
        try {
          const apps = await win.navigator.getInstalledRelatedApps();
          relatedCheckSucceeded = Array.isArray(apps);
          relatedInstalled = relatedAppIsInstalled(apps, currentAppId, identity.manifestHref, origin);
        } catch (_) { /* Fall back to the browser install event, standalone mode and local marker. */ }
      }
      if (sequence !== refreshSequence) return;
      if ((standalone || relatedInstalled || installedThisPage.has(currentAppId)) && !installPrompt) {
        writeLocalRecord(storage, currentKey, true);
        render(false);
        return;
      }
      if (installPrompt && !standalone && !relatedInstalled) {
        writeLocalRecord(storage, currentKey, false);
      }
      const decision = decideVisibility({
        standalone,
        relatedInstalled,
        relatedCheckSucceeded,
        locallyRecorded: installPrompt && !relatedInstalled ? false : locallyRecorded,
      });
      if (decision.clearLocalRecord) writeLocalRecord(storage, currentKey, false);
      if (installedThisPage.has(currentAppId) && !installPrompt) render(false);
      else render(decision.show);
    }

    async function onInstallClick(event) {
      const button = event.currentTarget;
      if (isStandalone(win)) { render(false); return; }
      if (!installPrompt) { dialog.open(button); return; }
      const prompt = installPrompt;
      installPrompt = null;
      buttons.forEach((item) => { item.disabled = true; });
      try {
        await prompt.prompt();
        const result = await prompt.userChoice;
        if (result?.outcome !== 'accepted') dialog.open(button);
      } catch (_) {
        dialog.open(button);
      } finally {
        buttons.forEach((item) => { item.disabled = false; });
        refresh().catch(() => render(true));
      }
    }

    buttons.forEach((button) => button.addEventListener('click', onInstallClick));
    win.addEventListener('beforeinstallprompt', (event) => {
      if (typeof event.preventDefault === 'function') event.preventDefault();
      installPrompt = event;
      refresh().catch(() => render(true));
    });
    win.addEventListener('appinstalled', () => {
      const installedId = currentAppId;
      installedThisPage.add(installedId);
      writeLocalRecord(storage, storageKey(origin, installedId), true);
      render(false);
    });
    win.addEventListener('pageshow', () => refresh().catch(() => {}));
    win.addEventListener('storage', (event) => {
      if (event.key?.startsWith(STORAGE_PREFIX)) refresh().catch(() => {});
    });
    doc.addEventListener('visibilitychange', () => {
      if (!doc.hidden) refresh().catch(() => {});
    });
    try {
      const displayMode = win.matchMedia?.('(display-mode: standalone)');
      displayMode?.addEventListener?.('change', () => refresh().catch(() => {}));
    } catch (_) { /* Older WebKit does not expose media query change events. */ }
    if (manifestLink && typeof win.MutationObserver === 'function') {
      new win.MutationObserver(() => refresh().catch(() => {})).observe(manifestLink, { attributes: true, attributeFilter: ['href'] });
    }

    if ('serviceWorker' in win.navigator && !String(win.location.pathname || '').startsWith('/manager')) {
      win.navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
    }
    refresh().catch(() => {
      const installed = readLocalRecord(storage, currentKey);
      render(!isStandalone(win) && !installed);
    });

    return {
      refresh,
      get appId() { return currentAppId; },
      get installPromptAvailable() { return Boolean(installPrompt); },
      openInstructions: () => dialog.open(null),
    };
  }

  return {
    STORAGE_PREFIX,
    normalizeAppId,
    storageKey,
    isStandalone,
    platformInfo,
    getInstallationGuide,
    manifestSelfReferences,
    relatedAppIsInstalled,
    pageWithinScope,
    decideVisibility,
    readLocalRecord,
    writeLocalRecord,
    mount,
  };
});
