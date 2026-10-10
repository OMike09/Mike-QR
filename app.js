(() => {
  'use strict';

  const $ = (selector) => document.querySelector(selector);
  const textValue = $('#textValue');
  const wifiSsid = $('#wifiSsid');
  const wifiPassword = $('#wifiPassword');
  const togglePassword = $('#togglePassword');
  const wifiSecurity = $('#wifiSecurity');
  const wifiHidden = $('#wifiHidden');
  const textPanel = $('#textFields');
  const wifiPanel = $('#wifiFields');
  const qrCanvas = $('#qrCanvas');
  const qrPaper = $('#qrPaper');
  const emptyState = $('#emptyState');
  const emptyText = $('#emptyText');
  const errorMessage = $('#errorMessage');
  const readyBadge = $('#readyBadge');
  const readyText = $('#readyText');
  const downloadPng = $('#downloadPng');
  const downloadSvg = $('#downloadSvg');
  const copyButton = $('#copyButton');
  const toast = $('#toast');

  const DEFAULTS = {
    text: 'https://ma-boutique.ci',
    foreground: '#173b32',
    background: '#ffffff',
    level: 'M',
    size: 512,
  };

  let mode = 'text';
  let currentQr = null;
  let currentPayload = '';
  let toastTimer = null;

  function formatNumber(value) {
    return new Intl.NumberFormat('fr-FR').format(value);
  }

  function escapeWifi(value) {
    return value.replace(/([\\;,:"'])/g, '\\$1');
  }

  function collectPayload() {
    if (mode === 'text') {
      return { payload: textValue.value.trim(), error: '' };
    }

    const ssid = wifiSsid.value;
    const security = wifiSecurity.value;
    if (!ssid.trim()) return { payload: '', error: '' };
    if (security !== 'nopass' && !wifiPassword.value) {
      return { payload: '', error: 'Ajoutez le mot de passe du réseau, ou choisissez « Aucun mot de passe ».' };
    }

    let payload = `WIFI:T:${security};S:${escapeWifi(ssid)};`;
    if (security !== 'nopass') payload += `P:${escapeWifi(wifiPassword.value)};`;
    if (wifiHidden.checked) payload += 'H:true;';
    payload += ';';
    return { payload, error: '' };
  }

  function getColors() {
    return {
      foreground: $('#foreground').value.toUpperCase(),
      background: $('#background').value.toUpperCase(),
    };
  }

  function drawCode(canvas, qr, size, colors, margin = 4) {
    const count = qr.getModuleCount();
    const total = count + margin * 2;
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d', { alpha: false });
    context.imageSmoothingEnabled = false;
    context.fillStyle = colors.background;
    context.fillRect(0, 0, size, size);
    context.fillStyle = colors.foreground;

    // Snap every module edge to a whole pixel so the PNG stays crisp at any export size.
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (!qr.isDark(row, column)) continue;
        const x0 = Math.round(((column + margin) / total) * size);
        const x1 = Math.round(((column + margin + 1) / total) * size);
        const y0 = Math.round(((row + margin) / total) * size);
        const y1 = Math.round(((row + margin + 1) / total) * size);
        context.fillRect(x0, y0, x1 - x0, y1 - y0);
      }
    }
  }

  function drawEmptyCanvas() {
    const context = qrCanvas.getContext('2d', { alpha: false });
    context.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
  }

  function updateColorsUI() {
    const foreground = $('#foreground').value.toUpperCase();
    const background = $('#background').value.toUpperCase();
    $('#foregroundValue').textContent = foreground;
    $('#backgroundValue').textContent = background;

    const [fr, fg, fb] = hexToRgb(foreground);
    const [br, bg, bb] = hexToRgb(background);
    const ratio = (Math.max(luminance(fr, fg, fb), luminance(br, bg, bb)) + .05) /
      (Math.min(luminance(fr, fg, fb), luminance(br, bg, bb)) + .05);
    $('#contrastWarning').hidden = ratio >= 4.5;
  }

  function hexToRgb(hex) {
    const value = hex.replace('#', '');
    return [0, 2, 4].map((index) => parseInt(value.slice(index, index + 2), 16));
  }

  function luminance(red, green, blue) {
    const toLinear = (channel) => {
      const value = channel / 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    };
    return .2126 * toLinear(red) + .7152 * toLinear(green) + .0722 * toLinear(blue);
  }

  function setPreviewEmpty(message, state = 'waiting') {
    currentQr = null;
    currentPayload = '';
    drawEmptyCanvas();
    qrPaper.classList.add('is-empty');
    emptyState.hidden = false;
    emptyText.textContent = message;
    $('#payloadPreview').textContent = '—';
    $('#moduleCount').textContent = 'Format standard';
    downloadPng.disabled = true;
    downloadSvg.disabled = true;
    copyButton.disabled = true;
    errorMessage.hidden = true;
    errorMessage.textContent = '';

    if (state === 'error') {
      readyBadge.classList.add('is-error');
      readyText.textContent = 'À vérifier';
    } else {
      readyBadge.classList.remove('is-error');
      readyText.textContent = 'À compléter';
    }
  }

  function updateModeUI() {
    document.querySelectorAll('.mode-tab').forEach((button) => {
      const active = button.dataset.mode === mode;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
    textPanel.hidden = mode !== 'text';
    wifiPanel.hidden = mode !== 'wifi';
    updatePasswordAvailability();
  }

  function updatePasswordAvailability() {
    const isOpen = wifiSecurity.value === 'nopass';
    const group = $('#passwordGroup');
    wifiPassword.disabled = isOpen;
    togglePassword.disabled = isOpen;
    group.classList.toggle('password-disabled', isOpen);
    if (isOpen) {
      wifiPassword.value = '';
      wifiPassword.type = 'password';
      togglePassword.classList.remove('is-active');
      togglePassword.setAttribute('aria-pressed', 'false');
      togglePassword.setAttribute('aria-label', 'Afficher le mot de passe');
      togglePassword.title = 'Afficher le mot de passe';
    }
  }

  function formatDisplayPayload(payload) {
    if (mode === 'wifi') {
      return `Wi-Fi · ${wifiSsid.value.trim()}`;
    }
    return payload.replace(/\s+/g, ' ');
  }

  function render() {
    updateColorsUI();
    $('#charCount').textContent = `${formatNumber(textValue.value.length)} / 3 000`;
    const size = Number($('#imageSize').value);
    const formattedSize = `${formatNumber(size)} px`;
    $('#sizeLabel').textContent = formattedSize;
    $('#pngFormat').textContent = formattedSize;

    const collected = collectPayload();
    if (collected.error) {
      setPreviewEmpty('Complétez les informations Wi-Fi', 'error');
      errorMessage.textContent = collected.error;
      errorMessage.hidden = false;
      return;
    }
    if (!collected.payload) {
      const prompt = mode === 'wifi' ? 'Renseignez votre réseau Wi-Fi' : 'Saisissez un lien ou un texte';
      setPreviewEmpty(prompt);
      return;
    }

    try {
      const qr = qrcode(0, $('#ecLevel').value);
      qr.addData(collected.payload);
      qr.make();
      currentQr = qr;
      currentPayload = collected.payload;
      drawCode(qrCanvas, qr, 480, getColors());
      qrPaper.classList.remove('is-empty');
      emptyState.hidden = true;
      errorMessage.hidden = true;
      errorMessage.textContent = '';
      readyBadge.classList.remove('is-error');
      readyText.textContent = 'Prêt';
      downloadPng.disabled = false;
      downloadSvg.disabled = false;
      copyButton.disabled = false;
      $('#payloadPreview').textContent = formatDisplayPayload(collected.payload);
      $('#moduleCount').textContent = `${qr.getModuleCount()} × ${qr.getModuleCount()} modules`;
      qrCanvas.setAttribute('aria-label', mode === 'wifi'
        ? `Code QR pour le réseau Wi-Fi ${wifiSsid.value.trim()}`
        : 'Code QR généré pour le contenu saisi');
    } catch (error) {
      const message = String(error && error.message ? error.message : 'Erreur inconnue');
      const friendly = /overflow|code length/i.test(message)
        ? 'Ce contenu est trop long pour un seul QR code. Raccourcissez-le, puis réessayez.'
        : 'Impossible de générer ce QR code. Vérifiez votre contenu et réessayez.';
      setPreviewEmpty('Contenu trop long ou invalide', 'error');
      errorMessage.textContent = friendly;
      errorMessage.hidden = false;
    }
  }

  function createSvg(qr, size, colors, margin = 4) {
    const count = qr.getModuleCount();
    const total = count + margin * 2;
    const paths = [];
    for (let row = 0; row < count; row += 1) {
      for (let column = 0; column < count; column += 1) {
        if (qr.isDark(row, column)) {
          const x = column + margin;
          const y = row + margin;
          paths.push(`M${x} ${y}h1v1h-1z`);
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges"><rect width="${total}" height="${total}" fill="${colors.background}"/><path d="${paths.join('')}" fill="${colors.foreground}"/></svg>`;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1200);
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('is-visible');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('is-visible'), 2600);
  }

  function downloadPngFile() {
    if (!currentQr) return;
    const exportCanvas = document.createElement('canvas');
    const size = Number($('#imageSize').value);
    drawCode(exportCanvas, currentQr, size, getColors());
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        showToast('Le téléchargement a échoué. Réessayez.');
        return;
      }
      saveBlob(blob, 'qria-code-qr.png');
      showToast(`PNG téléchargé · ${formatNumber(size)} × ${formatNumber(size)} px`);
    }, 'image/png');
  }

  function downloadSvgFile() {
    if (!currentQr) return;
    const size = Number($('#imageSize').value);
    const svg = createSvg(currentQr, size, getColors());
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    saveBlob(blob, 'qria-code-qr.svg');
    showToast('Fichier SVG téléchargé.');
  }

  async function copyPayload() {
    if (!currentPayload) return;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(currentPayload);
      } else {
        const temporary = document.createElement('textarea');
        temporary.value = currentPayload;
        temporary.setAttribute('readonly', '');
        temporary.style.position = 'fixed';
        temporary.style.opacity = '0';
        document.body.appendChild(temporary);
        temporary.select();
        document.execCommand('copy');
        temporary.remove();
      }
      showToast('Contenu copié dans le presse-papiers.');
    } catch (_) {
      showToast('La copie n’est pas disponible dans ce navigateur.');
    }
  }

  function reset() {
    mode = 'text';
    textValue.value = DEFAULTS.text;
    $('#ecLevel').value = DEFAULTS.level;
    $('#foreground').value = DEFAULTS.foreground;
    $('#background').value = DEFAULTS.background;
    $('#imageSize').value = String(DEFAULTS.size);
    wifiSsid.value = '';
    wifiPassword.value = '';
    wifiSecurity.value = 'WPA';
    wifiHidden.checked = false;
    updateModeUI();
    render();
    showToast('Options réinitialisées.');
  }

  document.querySelectorAll('.mode-tab').forEach((button) => {
    button.addEventListener('click', () => {
      mode = button.dataset.mode;
      updateModeUI();
      render();
    });
  });

  [textValue, wifiSsid, wifiPassword, wifiHidden, wifiSecurity, $('#ecLevel'), $('#foreground'), $('#background'), $('#imageSize')]
    .forEach((control) => {
      control.addEventListener('input', render);
      control.addEventListener('change', render);
    });

  wifiSecurity.addEventListener('change', updatePasswordAvailability);
  $('#resetButton').addEventListener('click', reset);
  togglePassword.addEventListener('click', () => {
    const isVisible = wifiPassword.type === 'text';
    wifiPassword.type = isVisible ? 'password' : 'text';
    togglePassword.classList.toggle('is-active', !isVisible);
    togglePassword.setAttribute('aria-pressed', String(!isVisible));
    togglePassword.setAttribute('aria-label', isVisible ? 'Afficher le mot de passe' : 'Masquer le mot de passe');
    togglePassword.title = isVisible ? 'Afficher le mot de passe' : 'Masquer le mot de passe';
    wifiPassword.focus();
  });
  downloadPng.addEventListener('click', downloadPngFile);
  downloadSvg.addEventListener('click', downloadSvgFile);
  copyButton.addEventListener('click', copyPayload);

  render();
})();
