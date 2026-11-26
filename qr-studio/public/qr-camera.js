// Mission 11 (sous-prompt 3) — Scanner caméra commun aux espaces marchand et équipe.
//
// Principes :
//   · la caméra ARRIÈRE est demandée en premier, sans contrainte stricte (`ideal` puis replis
//     successifs) : un iPhone ou un Android qui refuse `facingMode: 'environment'` exact obtient
//     quand même un aperçu au lieu d'un écran noir ou d'une capture photo ;
//   · l'aperçu est un simple flux vidéo. AUCUNE photo, AUCUN enregistrement vidéo ou d'écran :
//     pas de MediaRecorder, pas de `<input capture>`, rien n'est conservé sur l'appareil ;
//   · la détection est automatique (BarcodeDetector si disponible, sinon jsQR chargé à la demande) ;
//   · le code lu est renvoyé tel quel : c'est le serveur qui décide s'il est valable ;
//   · la saisie manuelle reste toujours accessible, y compris si la caméra est refusée.
//
// API : window.QrCamera.{ open, close, supported, isOpen }
(() => {
  'use strict';

  const $ = (selector, root = document) => root.querySelector(selector);
  const MESSAGES = {
    insecure: 'La caméra n’est autorisée que sur une adresse sécurisée (HTTPS). Utilisez la saisie manuelle ci-dessous : le code du QR est écrit dessous.',
    unsupported: 'Ce navigateur ne permet pas d’ouvrir la caméra. Utilisez la saisie manuelle ci-dessous.',
    denied: 'L’accès à la caméra a été refusé. Autorisez la caméra dans les réglages du navigateur, puis appuyez sur « Réessayer ». La saisie manuelle reste disponible.',
    missing: 'Aucune caméra utilisable n’a été trouvée sur cet appareil. Utilisez la saisie manuelle ci-dessous.',
    busy: 'La caméra est déjà utilisée par une autre application. Fermez-la, puis appuyez sur « Réessayer ».',
    decode: 'Le décodeur de QR n’a pas pu être chargé. Vérifiez la connexion, ou utilisez la saisie manuelle.',
    play: 'L’aperçu de la caméra n’a pas pu démarrer. Appuyez sur « Réessayer » ou utilisez la saisie manuelle.',
    generic: 'La caméra n’a pas pu démarrer. Appuyez sur « Réessayer » ou utilisez la saisie manuelle.',
  };

  const state = {
    stream: null, raf: 0, detector: null, canvas: null, context: null, active: false,
    lastValue: '', lastAt: 0, onRead: null, onError: null, options: {}, starting: false,
    facing: 'environment', track: null,
  };

  function overlay() {
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
          <div class="qr-camera-view">
            <video id="qrCameraVideo" playsinline muted autoplay></video>
            <div class="qr-camera-frame" aria-hidden="true"><span></span><span></span><span></span><span></span></div>
          </div>
          <p class="qr-camera-status" id="qrCameraStatus" role="status" aria-live="polite">Ouverture de la caméra…</p>
          <p class="qr-camera-privacy" id="qrCameraPrivacy">Lecture directe : aucune photo, aucune vidéo, aucun enregistrement d’écran.</p>
        </div>
        <div class="qr-camera-actions">
          <button type="button" class="qr-camera-action" id="qrCameraFlash" hidden>Éclair</button>
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
    $('#qrCameraRetry', node).addEventListener('click', () => {
      const video = $('#qrCameraVideo');
      if (video) { video.pause?.(); video.srcObject = null; }
      startStream().catch(() => {});
    });
    $('#qrCameraFlash', node).addEventListener('click', toggleTorch);
    $('#qrCameraFlip', node).addEventListener('click', () => {
      state.facing = state.facing === 'environment' ? 'user' : 'environment';
      startStream().catch(() => {});
    });
    $('#qrCameraManualForm', node).addEventListener('submit', (event) => {
      event.preventDefault();
      submitManual();
    });
    $('#qrCameraChoose', node).addEventListener('click', () => {
      const handler = state.options.onChooseTable;
      close();
      try { handler?.(); } catch (_) {}
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && state.active) close();
    });
    return node;
  }

  function setStatus(message, tone = '') {
    const node = $('#qrCameraStatus');
    if (!node) return;
    node.textContent = message;
    node.dataset.tone = tone;
    node.classList.toggle('is-error', tone === 'error');
    // En cas d'échec, la zone vidéo se réduit : message lisible, saisie manuelle immédiatement
    // accessible, aucune grande zone noire inutile sur le téléphone.
    node.closest('.qr-camera-stage')?.classList.toggle('is-error', tone === 'error');
  }

  function showRetry(visible = true) {
    const node = $('#qrCameraRetry');
    if (node) node.hidden = !visible;
  }

  function supported() { return Boolean(navigator.mediaDevices?.getUserMedia); }

  function stopStream() {
    cancelAnimationFrame(state.raf); state.raf = 0; state.active = false; state.starting = false;
    if (state.stream) { for (const track of state.stream.getTracks()) { try { track.stop(); } catch (_) {} } state.stream = null; }
    state.track = null;
    const video = $('#qrCameraVideo');
    if (video) { try { video.pause?.(); } catch (_) {} video.srcObject = null; }
    const flash = $('#qrCameraFlash');
    if (flash) { flash.hidden = true; flash.classList.remove('is-on'); flash.setAttribute('aria-pressed', 'false'); }
    const flip = $('#qrCameraFlip');
    if (flip) flip.hidden = true;
  }

  function close() {
    stopStream();
    const node = $('#qrCameraOverlay');
    if (node) node.hidden = true;
    document.documentElement.classList.remove('qr-camera-open');
  }

  function submitManual() {
    const input = $('#qrCameraManualInput');
    const value = String(input?.value || '').trim();
    if (!value) { setStatus('Saisissez le code écrit sous le QR, ou choisissez la table dans la liste.', 'error'); input?.focus(); return; }
    const handler = state.onRead;
    close();
    try { handler?.(value, 'manual'); } catch (_) {}
  }

  async function toggleTorch() {
    const track = state.track;
    const button = $('#qrCameraFlash');
    if (!track || !button) return;
    try {
      const on = !button.classList.contains('is-on');
      await track.applyConstraints({ advanced: [{ torch: on }] });
      button.classList.toggle('is-on', on);
      button.setAttribute('aria-pressed', on ? 'true' : 'false');
    } catch (_) { button.hidden = true; }
  }

  // Demande la caméra avec des contraintes SOUPLES, puis des replis de plus en plus larges.
  // Aucun appareil n'est écarté à cause d'un `facingMode` trop strict.
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
        // Un refus explicite ne se règle pas en changeant de contraintes : on s'arrête tout de suite.
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

  async function startStream() {
    if (state.starting) return;
    const node = overlay();
    node.hidden = false;
    document.documentElement.classList.add('qr-camera-open');
    state.starting = true;
    showRetry(false);
    const title = $('#qrCameraTitle');
    if (title) title.textContent = state.options.title || 'Visez le QR code';
    const choose = $('#qrCameraChoose');
    if (choose) choose.hidden = !state.options.onChooseTable;
    const privacy = $('#qrCameraPrivacy');
    if (privacy) privacy.textContent = state.options.privacyNote || 'Lecture directe : aucune photo, aucune vidéo, aucun enregistrement d’écran.';

    stopStream();
    state.starting = true;

    if (!window.isSecureContext) { setStatus(MESSAGES.insecure, 'error'); showRetry(false); state.onError?.(MESSAGES.insecure); state.starting = false; return; }
    if (!supported()) { setStatus(MESSAGES.unsupported, 'error'); state.onError?.(MESSAGES.unsupported); state.starting = false; return; }

    setStatus('Autorisation de la caméra…');
    try {
      state.stream = await openStream();
    } catch (error) {
      const message = messageFor(error);
      setStatus(message, 'error');
      showRetry(true);
      state.onError?.(message);
      state.starting = false;
      return;
    }

    const video = $('#qrCameraVideo');
    try {
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      video.srcObject = state.stream;
      await video.play();
    } catch (_) {
      setStatus(MESSAGES.play, 'error');
      showRetry(true);
      stopStream();
      state.onError?.(MESSAGES.play);
      state.starting = false;
      return;
    }

    state.track = state.stream.getVideoTracks?.()[0] || null;
    const capabilities = state.track?.getCapabilities?.() || {};
    const flash = $('#qrCameraFlash');
    if (flash && capabilities.torch) { flash.hidden = false; flash.setAttribute('aria-pressed', 'false'); }
    const flip = $('#qrCameraFlip');
    // Le changement de caméra n'est proposé que si l'appareil en a réellement plusieurs.
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
      try { await (window.ensureQrDecoder ? window.ensureQrDecoder() : loadDecoder()); } catch (_) { /* message ci-dessous */ }
    }
    if (!state.detector && !window.jsQR) {
      setStatus(MESSAGES.decode, 'error');
      showRetry(true);
      stopStream();
      state.onError?.(MESSAGES.decode);
      state.starting = false;
      return;
    }
    if (!state.canvas) {
      state.canvas = document.createElement('canvas');
      state.context = state.canvas.getContext('2d', { willReadFrequently: true });
    }
    state.active = true;
    state.starting = false;
    $('#qrCameraStatus')?.closest('.qr-camera-stage')?.classList.remove('is-error');
    setStatus(state.options.hint || 'Placez le QR dans le cadre : la lecture est automatique.');
    readFrame().catch(() => setStatus(MESSAGES.generic, 'error'));
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

  async function readFrame() {
    if (!state.active) return;
    const video = $('#qrCameraVideo');
    if (video && video.readyState >= 2 && video.videoWidth) {
      const now = Date.now();
      // ~7 analyses par seconde : réactif sans faire chauffer le téléphone.
      if (now - state.lastAt > 140) {
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
        // Certains capteurs produisent des images bruitées : une seconde lecture, plus petite,
        // évite de rater un QR parfaitement lisible à l'œil.
        if (!value && window.jsQR) {
          try {
            const width = Math.min(400, video.videoWidth);
            value = readFrameFrom(video, width, Math.round((video.videoHeight / video.videoWidth) * width), 'invertFirst');
          } catch (_) {}
        }
        if (value && value !== state.lastValue) {
          state.lastValue = value;
          const handler = state.onRead;
          close();
          try { handler?.(value, 'camera'); } catch (_) {}
          return;
        }
      }
    }
    state.raf = requestAnimationFrame(() => { readFrame().catch(() => {}); });
  }

  // `open` est idempotent : un second appel réutilise l'aperçu déjà ouvert au lieu d'en créer un autre.
  async function open(options = {}) {
    state.options = { ...options };
    state.onRead = typeof options.onRead === 'function' ? options.onRead : null;
    state.onError = typeof options.onError === 'function' ? options.onError : null;
    state.lastValue = '';
    state.facing = options.facing || 'environment';
    await startStream();
    return true;
  }

  window.QrCamera = { open, close, stop: close, supported, isOpen: () => state.active, MESSAGES };
})();
