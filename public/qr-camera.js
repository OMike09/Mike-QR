// Mission 12 — Scanner QR commun aux espaces marchand, équipe et gérant.
//
// CE QUI A CHANGÉ (et pourquoi)
//   · UN SEUL flux vidéo. Avant, un élément <video> d'aperçu existait en double (celui de la
//     modale et celui de l'écran Scanner). Selon l'ordre d'ouverture, l'aperçu restait noir et
//     la lecture ne démarrait jamais : le scanner « ne fonctionnait pas ». Désormais le module
//     possède le flux et le place dans le conteneur demandé (`inline`), sinon dans sa modale.
//   · La lecture démarre dès la première image, avec deux horloges de secours : si
//     requestAnimationFrame est suspendu (onglet en arrière-plan, économie d'énergie), un
//     setInterval continue la détection et la retire dès que l'onglet reprend le dessus.
//   · Le bouton « Ouvrir la caméra » demande la permission dans le geste de l'utilisateur :
//     `getUserMedia` est appelé immédiatement (aucun écran intermédiaire, aucune photo).
//
// CE QUI N'A PAS CHANGÉ
//   · caméra ARRIÈRE en priorité (`facingMode: ideal: environment`) avec replis souples ;
//   · AUCUNE photo, AUCUNE vidéo enregistrée : pas de MediaRecorder, pas d'<input capture> ;
//   · détection automatique (BarcodeDetector si présent, sinon jsQR chargé à la demande) ;
//   · la saisie manuelle reste disponible, et le code est vérifié par le serveur.
//
// API : window.QrCamera.{ open, close, supported, isOpen, attach }
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const MESSAGES = {
    insecure: 'La caméra ne fonctionne que sur une adresse sécurisée (HTTPS). Utilisez la saisie manuelle : le code est écrit sous le QR.',
    unsupported: 'Ce navigateur ne permet pas d’ouvrir la caméra. Utilisez la saisie manuelle : le code est écrit sous le QR.',
    denied: 'L’accès à la caméra a été refusé. Autorisez la caméra dans les réglages du navigateur (icône à gauche de l’adresse), puis appuyez sur « Réessayer ».',
    missing: 'Aucune caméra utilisable n’a été trouvée sur cet appareil. Utilisez la saisie manuelle ci-dessous.',
    busy: 'La caméra est déjà utilisée par une autre application. Fermez-la, puis appuyez sur « Réessayer ».',
    decode: 'Le décodeur de QR n’a pas pu être chargé. Vérifiez la connexion, ou utilisez la saisie manuelle.',
    play: 'L’aperçu de la caméra n’a pas pu démarrer. Appuyez sur « Réessayer ».',
    generic: 'La caméra n’a pas pu démarrer. Appuyez sur « Réessayer » ou utilisez la saisie manuelle.',
  };

  const state = {
    stream: null, raf: 0, timer: 0, detector: null, canvas: null, context: null, active: false,
    lastValue: '', lastAt: 0, onRead: null, onError: null, options: {}, starting: false,
    facing: 'environment', track: null, container: null, video: null, startedAt: 0,
  };

  function ensureVideo() {
    if (state.video) return state.video;
    const video = document.createElement('video');
    video.id = 'qrCameraVideo';
    video.setAttribute('playsinline', 'true');
    video.setAttribute('webkit-playsinline', 'true');
    video.muted = true;
    video.autoplay = true;
    video.setAttribute('muted', '');
    state.video = video;
    return video;
  }

  function modal() {
    let node = $('#qrCameraOverlay');
    if (node) return node;
    node = document.createElement('div');
    node.id = 'qrCameraOverlay';
    node.className = 'qr-camera-overlay';
    node.hidden = true;
    node.setAttribute('role', 'dialog');
    node.setAttribute('aria-modal', 'true');
    node.setAttribute('aria-labelledby', 'qrCameraTitle');
    node.innerHTML = `
      <div class="qr-camera-sheet">
        <header class="qr-camera-head">
          <div><span class="eyebrow">SCAN DU QR</span><h3 id="qrCameraTitle">Visez le QR code</h3></div>
          <button type="button" class="qr-camera-close" id="qrCameraClose" aria-label="Fermer le scanner">Fermer</button>
        </header>
        <div class="qr-camera-stage">
          <div class="qr-camera-view" id="qrCameraMount"></div>
          <p class="qr-camera-status" id="qrCameraStatus" role="status" aria-live="polite">Ouverture de la caméra…</p>
          <p class="qr-camera-privacy" id="qrCameraPrivacy">Lecture directe : aucune photo, aucune vidéo, aucun enregistrement d’écran.</p>
        </div>
        <div class="qr-camera-actions">
          <button type="button" class="qr-camera-action" id="qrCameraTorch" hidden>Torche</button>
          <button type="button" class="qr-camera-action" id="qrCameraFlip" hidden>Caméra avant / arrière</button>
          <button type="button" class="qr-camera-action" id="qrCameraRetry" hidden>Réessayer</button>
        </div>
        <form class="qr-camera-manual" id="qrCameraManualForm">
          <label for="qrCameraManualInput">Saisie manuelle (si la caméra ne s’ouvre pas)</label>
          <div class="qr-camera-manual-row">
            <input id="qrCameraManualInput" type="text" inputmode="text" autocomplete="off" maxlength="2000" placeholder="Code ou lien écrit sous le QR">
            <button type="submit">Vérifier ce code</button>
          </div>
          <button type="button" class="qr-camera-choose" id="qrCameraChoose" hidden>Choisir la table dans la liste</button>
        </form>
      </div>`;
    document.body.appendChild(node);
    node.addEventListener('click', (event) => { if (event.target === node) close(); });
    $('#qrCameraClose', node).addEventListener('click', () => close());
    $('#qrCameraRetry', node).addEventListener('click', () => start());
    $('#qrCameraTorch', node).addEventListener('click', () => toggleTorch());
    $('#qrCameraFlip', node).addEventListener('click', () => {
      state.facing = state.facing === 'environment' ? 'user' : 'environment';
      start();
    });
    $('#qrCameraManualForm', node).addEventListener('submit', (event) => {
      event.preventDefault();
      const input = $('#qrCameraManualInput', node);
      const value = String(input?.value || '').trim();
      if (!value) { setStatus('Saisissez le code écrit sous le QR.', 'error'); input?.focus(); return; }
      const handler = state.onRead;
      close();
      try { handler?.(value, 'manual'); } catch (_) {}
    });
    $('#qrCameraChoose', node).addEventListener('click', () => {
      const handler = state.options.onChooseTable;
      close();
      try { handler?.(); } catch (_) {}
    });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && state.active) close(); });
    return node;
  }

  function setStatus(message, tone = '') {
    // L'état doit s'afficher LÀ OÙ l'utilisateur regarde : dans le bloc d'aperçu intégré s'il y en
    // a un (écran Scanner), sinon dans la modale. Chercher dans le voisinage du conteneur, et non
    // dans la modale cachée, évite le « la caméra reste sur Ouverture… » alors qu'elle filme.
    const scope = state.container ? (state.container.closest('.qr-scan-inline') || state.container.parentElement) : null;
    const target = (scope && ($('[data-scan-status]', scope) || $('.qr-scan-status', scope))) || $('#qrCameraStatus');
    if (!target) return;
    target.textContent = message;
    target.dataset.tone = tone;
    target.classList.toggle('is-error', tone === 'error');
    target.closest('.qr-camera-stage, .qr-scan-stage')?.classList.toggle('is-error', tone === 'error');
    if (state.container) {
      const inlineStatus = $('[data-scan-status]', state.container);
      if (inlineStatus) { inlineStatus.textContent = message; inlineStatus.dataset.tone = tone; inlineStatus.classList.toggle('is-error', tone === 'error'); }
    }
  }
  function showRetry(visible = true) {
    const inline = state.container && $('[data-scan-retry]', state.container);
    if (inline) inline.hidden = !visible;
    const node = $('#qrCameraRetry');
    if (node) node.hidden = !visible;
  }

  function supported() { return Boolean(navigator.mediaDevices?.getUserMedia); }

  function stopStream() {
    cancelAnimationFrame(state.raf); state.raf = 0;
    if (state.timer) { clearInterval(state.timer); state.timer = 0; }
    state.active = false; state.starting = false;
    if (state.stream) { for (const track of state.stream.getTracks()) { try { track.stop(); } catch (_) {} } state.stream = null; }
    state.track = null;
    const video = state.video;
    if (video) { try { video.pause?.(); } catch (_) {} try { video.srcObject = null; } catch (_) {} }
    const flip = $('#qrCameraFlip'); if (flip) flip.hidden = true;
  }

  function close() {
    stopStream();
    const node = $('#qrCameraOverlay');
    if (node) node.hidden = true;
    if (state.video && state.video.parentElement && state.container) {
      // Le flux est retiré du conteneur : aucun aperçu noir ne reste affiché.
      try { state.video.parentElement.removeChild(state.video); } catch (_) {}
    }
    document.documentElement.classList.remove('qr-camera-open');
    document.body.classList.remove('qr-camera-open');
    const onClose = state.options.onClose;
    state.container = null;
    try { onClose?.(); } catch (_) {}
  }

  async function openStream() {
    const wanted = state.facing;
    const attempts = [
      { video: { facingMode: { ideal: wanted }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false },
      { video: { facingMode: { ideal: wanted } }, audio: false },
      { video: { facingMode: wanted }, audio: false },
      { video: true, audio: false },
    ];
    let lastError = null;
    for (const constraints of attempts) {
      try { return await navigator.mediaDevices.getUserMedia(constraints); }
      catch (error) {
        lastError = error;
        if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(String(error?.name || ''))) throw error;
      }
    }
    throw lastError || new Error('CAMERA_UNAVAILABLE');
  }

  function messageFor(error) {
    const name = String(error?.name || '');
    if (['NotAllowedError', 'SecurityError', 'PermissionDeniedError'].includes(name)) return MESSAGES.denied;
    if (['NotFoundError', 'DevicesNotFoundError', 'OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(name)) return MESSAGES.missing;
    if (['NotReadableError', 'TrackStartError', 'AbortError'].includes(name)) return MESSAGES.busy;
    return MESSAGES.generic;
  }

  // La torche n'existe que sur certains téléphones (Android surtout). On ne l'affiche que si
  // l'appareil la déclare : sinon le bouton resterait sans effet, ce qui est pire que son absence.
  async function refreshTorch() {
    const button = $('#qrCameraTorch');
    if (!button) return;
    state.torchOn = false;
    try {
      const capabilities = state.track?.getCapabilities?.() || {};
      if (!capabilities.torch) { button.hidden = true; return; }
      button.hidden = false;
      button.setAttribute('aria-pressed', 'false');
      button.textContent = 'Torche';
    } catch (_) { button.hidden = true; }
  }
  async function toggleTorch() {
    if (!state.track?.getCapabilities?.().torch) return;
    state.torchOn = !state.torchOn;
    try {
      await state.track.applyConstraints({ advanced: [{ torch: state.torchOn }] });
      const button = $('#qrCameraTorch');
      if (button) { button.textContent = state.torchOn ? 'Torche allumée' : 'Torche'; button.setAttribute('aria-pressed', String(state.torchOn)); }
    } catch (_) { state.torchOn = false; }
  }

  function mountVideo() {
    const video = ensureVideo();
    const host = state.container || $('#qrCameraMount');
    if (host && video.parentElement !== host) {
      video.className = state.container ? 'qr-scan-video' : '';
      host.appendChild(video);
    }
    return video;
  }

  async function start() {
    if (state.starting) return;
    state.starting = true;
    showRetry(false);
    stopStream();
    state.starting = true;
    const title = $('#qrCameraTitle');
    if (title) title.textContent = state.options.title || 'Visez le QR code';
    const choose = $('#qrCameraChoose'); if (choose) choose.hidden = !state.options.onChooseTable;
    const privacy = $('#qrCameraPrivacy'); if (privacy) privacy.textContent = state.options.privacyNote || 'Lecture directe : aucune photo, aucune vidéo, aucun enregistrement d’écran.';

    if (!window.isSecureContext) { setStatus(MESSAGES.insecure, 'error'); state.onError?.(MESSAGES.insecure); state.starting = false; return; }
    if (!supported()) { setStatus(MESSAGES.unsupported, 'error'); state.onError?.(MESSAGES.unsupported); state.starting = false; return; }

    setStatus('Autorisation de la caméra…');
    try { state.stream = await openStream(); }
    catch (error) {
      const message = messageFor(error);
      setStatus(message, 'error'); showRetry(true); state.onError?.(message); state.starting = false; return;
    }

    const video = mountVideo();
    try {
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      video.srcObject = state.stream;
      // `play()` peut être refusé avant interaction : on réessaie une fois au premier toucher.
      try { await video.play(); }
      catch (_) {
        state.stream = state.stream;
        const resume = () => { video.play().catch(() => {}); document.removeEventListener('touchstart', resume); document.removeEventListener('click', resume); };
        document.addEventListener('touchstart', resume, { once: true, passive: true });
        document.addEventListener('click', resume, { once: true });
      }
    } catch (_) {
      setStatus(MESSAGES.play, 'error'); showRetry(true); stopStream(); state.onError?.(MESSAGES.play); state.starting = false; return;
    }

    state.track = state.stream.getVideoTracks?.()[0] || null;
    await refreshTorch();
    const flip = $('#qrCameraFlip');
    try {
      const devices = await navigator.mediaDevices.enumerateDevices?.();
      const cameras = (devices || []).filter((device) => device.kind === 'videoinput');
      if (flip) flip.hidden = cameras.length < 2;
    } catch (_) { if (flip) flip.hidden = true; }

    if (!state.detector && 'BarcodeDetector' in window) {
      try {
        const formats = await window.BarcodeDetector.getSupportedFormats?.();
        if (!formats || formats.includes('qr_code')) state.detector = new window.BarcodeDetector({ formats: ['qr_code'] });
      } catch (_) { state.detector = null; }
    }
    if (!state.detector && !window.jsQR) {
      setStatus('Préparation du décodeur QR…');
      try { await (window.ensureQrDecoder ? window.ensureQrDecoder() : loadDecoder()); } catch (_) {}
    }
    if (!state.detector && !window.jsQR) { setStatus(MESSAGES.decode, 'error'); showRetry(true); stopStream(); state.onError?.(MESSAGES.decode); state.starting = false; return; }
    if (!state.canvas) { state.canvas = document.createElement('canvas'); state.context = state.canvas.getContext('2d', { willReadFrequently: true }); }

    state.active = true;
    state.starting = false;
    state.startedAt = Date.now();
    document.body.classList.add('qr-camera-open');
    setStatus(state.options.hint || 'Placez le QR dans le cadre : la lecture est automatique.');
    // Deux horloges : l'animation pour la fluidité, l'intervalle pour ne jamais s'arrêter si
    // requestAnimationFrame est suspendu par le navigateur.
    state.raf = requestAnimationFrame(tick);
    state.timer = setInterval(() => { if (!state.raf) tick(); }, 220);
  }

  function loadDecoder() {
    return new Promise((resolve, reject) => {
      const tag = document.createElement('script');
      tag.src = '/vendor/jsQR.js';
      tag.async = true;
      tag.onload = () => resolve(true);
      tag.onerror = () => reject(new Error(MESSAGES.decode));
      document.head.append(tag);
    });
  }

  function readFrameFrom(image, width, height, inversion) {
    state.canvas.width = width; state.canvas.height = height;
    state.context.drawImage(image, 0, 0, width, height);
    const frame = state.context.getImageData(0, 0, width, height);
    return window.jsQR(frame.data, width, height, { inversionAttempts: inversion })?.data || '';
  }

  function tick() {
    state.raf = 0;
    if (!state.active) return;
    readOnce().catch(() => {}).finally(() => {
      if (state.active) state.raf = requestAnimationFrame(tick);
    });
  }

  async function readOnce() {
    const video = state.video;
    if (!video || !state.active) return;
    // Tant que la première image n'est pas arrivée, on réessaie (aperçu noir = pas de lecture).
    if (video.readyState < 2 || !video.videoWidth) return;
    const now = Date.now();
    if (now - state.lastAt < 130) return;
    state.lastAt = now;
    let value = '';
    try {
      if (state.detector) {
        const codes = await state.detector.detect(video);
        value = codes?.[0]?.rawValue || '';
      } else if (window.jsQR) {
        const width = Math.min(640, video.videoWidth);
        value = readFrameFrom(video, width, Math.round((video.videoHeight / video.videoWidth) * width), 'attemptBoth');
      }
    } catch (_) { /* une image illisible n'interrompt pas la lecture */ }
    if (!value && window.jsQR) {
      try {
        const width = Math.min(400, video.videoWidth);
        value = readFrameFrom(video, width, Math.round((video.videoHeight / video.videoWidth) * width), 'invertFirst');
      } catch (_) {}
    }
    if (value && value !== state.lastValue) {
      state.lastValue = value;
      const handler = state.onRead;
      // Le flux est coupé AVANT la navigation : aucun accès caméra résiduel, aucune vidéo.
      close();
      try { handler?.(value, 'camera'); } catch (_) {}
    }
  }

  // `open(options)` :
  //   · `inline` (élément) : l'aperçu s'affiche DANS la page, sans modale (écran Scanner) ;
  //   · sinon une modale est ouverte par-dessus la page (scan depuis n'importe quel écran).
  async function open(options = {}) {
    state.options = { ...options };
    state.onRead = typeof options.onRead === 'function' ? options.onRead : null;
    state.onError = typeof options.onError === 'function' ? options.onError : null;
    state.lastValue = '';
    state.facing = options.facing || 'environment';
    if (options.inline) {
      state.container = options.inline;
      state.container.classList.add('is-active');
      const node = $('#qrCameraOverlay'); if (node) node.hidden = true;
    } else {
      state.container = null;
      const node = modal();
      node.hidden = false;
      document.documentElement.classList.add('qr-camera-open');
    }
    await start();
    return true;
  }

  // `attach(container, options)` : forme utilisée par les écrans à aperçu intégré.
  function attach(container, options = {}) { return open({ ...options, inline: container }); }

  window.QrCamera = { open, attach, close, stop: close, supported, isOpen: () => state.active, MESSAGES };
})();
