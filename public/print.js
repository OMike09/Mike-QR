(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const loading = $('#printLoading');
  const error = $('#printError');
  const card = $('#printCard');
  const actions = $('#printActions');
  const escapeHtml = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const codeId = new URLSearchParams(window.location.search).get('id');
  function draw(canvas, code) {
    const qr = qrcode(0, code.style?.correction || 'M');
    qr.addData(`${window.location.origin}/r/${encodeURIComponent(code.publicCode)}`); qr.make();
    const count = qr.getModuleCount(), margin = 4, total = count + margin * 2, size = 1024;
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d', { alpha: false }); ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = code.style?.background || '#FFFFFF'; ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = code.style?.foreground || '#173B32';
    for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) if (qr.isDark(row, col)) {
      const x0 = Math.round(((col + margin) / total) * size), x1 = Math.round(((col + margin + 1) / total) * size);
      const y0 = Math.round(((row + margin) / total) * size), y1 = Math.round(((row + margin + 1) / total) * size);
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
  }
  async function load() {
    if (!codeId) { loading.hidden = true; error.hidden = false; error.textContent = 'Identifiant du QR code manquant.'; return; }
    try {
      const response = await fetch(`/api/admin/codes/${encodeURIComponent(codeId)}`, { credentials: 'same-origin' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'QR code introuvable.');
      const code = payload.data;
      draw($('#printCanvas'), code);
      $('#printName').textContent = code.name;
      $('#printBeneficiary').textContent = code.beneficiaryName;
      $('#printUrl').textContent = `${window.location.origin}/r/${code.publicCode}`;
      $('#printIdentifier').textContent = `ID ${code.publicCode} · Généré avec QRia`;
      document.title = `${code.name} — QRia`;
      card.hidden = false; actions.hidden = false; loading.hidden = true;
    } catch (failure) { loading.hidden = true; error.hidden = false; error.textContent = failure.message; }
  }
  $('#printButton').addEventListener('click', () => window.print());
  load();
})();
