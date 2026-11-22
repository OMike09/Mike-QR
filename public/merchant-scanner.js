// Scanner QR du marchand : caméra arrière, détection automatique, arrêt propre de la caméra.
// Aucune décision n'est prise ici : le contenu lu est vérifié côté serveur (boutique, activation, autorisation).
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const state = { stream: null, raf: 0, detector: null, canvas: null, context: null, active: false, lastValue: '', lastAt: 0, onRead: null, onError: null };

  const MESSAGES = {
    insecure: 'La caméra nécessite une connexion sécurisée (HTTPS) sur ce téléphone. Utilisez la sélection manuelle de la table.',
    denied: 'L’accès à la caméra a été refusé. Autorisez la caméra dans les réglages du navigateur, ou choisissez la table manuellement.',
    missing: 'Aucune caméra n’est disponible sur cet appareil. Choisissez la table manuellement.',
    busy: 'La caméra est déjà utilisée par une autre application. Fermez-la puis réessayez.',
    generic: 'La caméra n’a pas pu démarrer. Réessayez ou choisissez la table manuellement.',
  };

  function safeStop() {
    cancelAnimationFrame(state.raf); state.raf = 0; state.active = false;
    if (state.stream) { for (const track of state.stream.getTracks()) track.stop(); state.stream = null; }
    const video = $('#scanVideo'); if (video) { video.pause?.(); video.srcObject = null; }
    const torch = $('#scanTorchButton'); if (torch) { torch.hidden = true; torch.classList.remove('is-on'); }
  }

  function setHint(message, tone = '') {
    const node = $('#scanHint'); if (!node) return;
    node.textContent = message; node.classList.toggle('is-error', tone === 'error');
  }

  function supported() { return Boolean(navigator.mediaDevices?.getUserMedia); }

  async function readFrame() {
    if (!state.active) return;
    const video = $('#scanVideo');
    if (video && video.readyState >= 2 && video.videoWidth) {
      const now = Date.now();
      // ~7 analyses/seconde : suffisant pour une détection rapide sans saturer le téléphone.
      if (now - state.lastAt > 140) {
        state.lastAt = now;
        let value = '';
        try {
          if (state.detector) {
            const codes = await state.detector.detect(video);
            value = codes?.[0]?.rawValue || '';
          } else if (window.jsQR) {
            const width = Math.min(640, video.videoWidth); const height = Math.round((video.videoHeight / video.videoWidth) * width);
            state.canvas.width = width; state.canvas.height = height;
            state.context.drawImage(video, 0, 0, width, height);
            const frame = state.context.getImageData(0, 0, width, height);
            value = window.jsQR(frame.data, width, height, { inversionAttempts: 'attemptBoth' })?.data || '';
          }
        } catch (_) { /* une image illisible n'interrompt pas la détection */ }
        // Repli : certains appareils/caméras produisent des images très bruitées ; une seconde
        // tentative sur une image réduite (plus stable) évite un faux « rien détecté ».
        if (!value && window.jsQR) {
          try {
            const width = Math.min(400, video.videoWidth); const height = Math.round((video.videoHeight / video.videoWidth) * width);
            state.canvas.width = width; state.canvas.height = height;
            state.context.drawImage(video, 0, 0, width, height);
            const frame = state.context.getImageData(0, 0, width, height);
            value = window.jsQR(frame.data, width, height, { inversionAttempts: 'invertFirst' })?.data || '';
          } catch (_) {}
        }
        if (value && value !== state.lastValue) {
          state.lastValue = value;
          safeStop();
          state.onRead?.(value);
          return;
        }
      }
    }
    state.raf = requestAnimationFrame(() => { readFrame().catch(() => {}); });
  }

  async function start({ onRead, onError }) {
    safeStop();
    state.onRead = onRead; state.onError = onError; state.lastValue = '';
    const overlay = $('#scanOverlay'); if (overlay) overlay.hidden = false;
    const retry = $('#scanRetryButton'); if (retry) retry.hidden = true;
    if (!window.isSecureContext) { setHint(MESSAGES.insecure, 'error'); retry && (retry.hidden = false); return; }
    if (!supported()) { setHint(MESSAGES.missing, 'error'); retry && (retry.hidden = false); return; }
    setHint('Ouverture de la caméra arrière…');
    try {
      state.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    } catch (error) {
      const name = String(error?.name || '');
      const message = name === 'NotAllowedError' || name === 'SecurityError' ? MESSAGES.denied : name === 'NotFoundError' || name === 'OverconstrainedError' ? MESSAGES.missing : name === 'NotReadableError' || name === 'AbortError' ? MESSAGES.busy : MESSAGES.generic;
      setHint(message, 'error'); retry && (retry.hidden = false); onError?.(message); return;
    }
    const video = $('#scanVideo');
    try {
      video.setAttribute('playsinline', 'true'); video.muted = true; video.srcObject = state.stream; await video.play();
    } catch (_) { setHint(MESSAGES.generic, 'error'); safeStop(); retry && (retry.hidden = false); return; }
    const track = state.stream.getVideoTracks?.()[0];
    const capabilities = track?.getCapabilities?.() || {};
    const torch = $('#scanTorchButton');
    if (torch && capabilities.torch) {
      torch.hidden = false; torch.onclick = async () => {
        try { const on = !torch.classList.contains('is-on'); await track.applyConstraints({ advanced: [{ torch: on }] }); torch.classList.toggle('is-on', on); }
        catch (_) { torch.hidden = true; }
      };
    }
    if ('BarcodeDetector' in window) {
      try { const formats = await window.BarcodeDetector.getSupportedFormats?.(); if (!formats || formats.includes('qr_code')) state.detector = new window.BarcodeDetector({ formats: ['qr_code'] }); } catch (_) { state.detector = null; }
    }
    if (!state.detector && !window.jsQR) { setHint('Le décodeur QR local n’a pas pu être chargé. Choisissez la table manuellement.', 'error'); safeStop(); retry && (retry.hidden = false); return; }
    if (!state.canvas) { state.canvas = document.createElement('canvas'); state.context = state.canvas.getContext('2d', { willReadFrequently: true }); }
    state.active = true;
    setHint('Placez le QR dans le cadre. La détection est automatique.');
    readFrame().catch(() => setHint(MESSAGES.generic, 'error'));
  }

  window.QRMerchantScanner = { start, stop: safeStop, supported, isOpen: () => state.active };
})();
