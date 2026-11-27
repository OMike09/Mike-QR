// ============================================================================================
// MISSION 15 — §3.6 : APPARENCE DU QR DE TABLE ET DU NUMÉRO AFFICHÉ.
//
// Le PDG règle, une fois pour toutes les tables, l'habillage du QR imprimé :
//   · taille de l'affiche, taille du numéro, épaisseur du numéro ;
//   · couleur du numéro, couleur du fond de l'affiche, alignement et position du numéro ;
//   · taille du QR lui-même.
// Le NUMÉRO, lui, n'est jamais saisi ni choisi : il vient du serveur (merchant_service_points.
// table_number) au moment de la composition. Aucun paramètre d'URL ne peut le changer.
// Les réglages sont stockés dans app_settings (clé `tableQrArtwork`) : aucune donnée n'est
// supprimée, et un réglage absent retombe sur une valeur sûre et lisible.
// ============================================================================================
'use strict';

const DEFAULTS = Object.freeze({
  posterSize: 900,        // largeur de l'affiche exportée (px)
  qrSize: 620,            // largeur du QR dans l'affiche (px)
  numberSize: 120,        // taille de police du numéro (px)
  numberWeight: 800,      // épaisseur (400 à 900)
  numberColor: '#14251f',
  background: '#ffffff',
  align: 'center',        // left | center | right
  position: 'below',      // above | below
  caption: 'Table',       // libellé au-dessus du numéro
  showCaption: true,
});

const HEX = /^#[0-9a-f]{6}$/i;
const clampInt = (value, min, max, fallback) => {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};

/** Normalise des réglages reçus du PDG : aucune valeur hors bornes ne peut être enregistrée. */
function normalize(input = {}) {
  const source = input && typeof input === 'object' ? input : {};
  return {
    posterSize: clampInt(source.posterSize, 480, 1600, DEFAULTS.posterSize),
    qrSize: clampInt(source.qrSize, 240, 1400, DEFAULTS.qrSize),
    numberSize: clampInt(source.numberSize, 40, 260, DEFAULTS.numberSize),
    numberWeight: clampInt(source.numberWeight, 400, 900, DEFAULTS.numberWeight),
    numberColor: HEX.test(String(source.numberColor || '')) ? String(source.numberColor).toLowerCase() : DEFAULTS.numberColor,
    background: HEX.test(String(source.background || '')) ? String(source.background).toLowerCase() : DEFAULTS.background,
    align: ['left', 'center', 'right'].includes(source.align) ? source.align : DEFAULTS.align,
    position: ['above', 'below'].includes(source.position) ? source.position : DEFAULTS.position,
    caption: String(source.caption == null ? DEFAULTS.caption : source.caption).replace(/[<>&"]/g, '').slice(0, 40),
    showCaption: source.showCaption !== false,
  };
}

/** Le QR doit rester lisible : on refuse un numéro qui déborderait de l'affiche. */
function validate(input) {
  const value = normalize(input);
  const problems = [];
  if (value.qrSize > value.posterSize - 40) problems.push('Le QR doit rester plus petit que l’affiche (au moins 20 px de marge de chaque côté).');
  if (value.numberSize > value.posterSize / 2) problems.push('Le numéro est trop grand pour l’affiche : réduisez sa taille ou agrandissez l’affiche.');
  return { value, problems };
}

/** Contraste du numéro sur le fond : le numéro doit rester lisible sur une impression. */
function contrastRatio(foreground, background) {
  const luminance = (hex) => {
    const value = hex.replace('#', '');
    const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
  };
  const a = luminance(foreground); const b = luminance(background);
  return Number(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)).toFixed(2));
}

function attach({ app, store, requireAdmin, checkSameOrigin, apiError }) {
  // Lecture : accessible au PDG (réglages) ET au marchand (aperçu réel de ses QR) — aucune donnée
  // privée. Les DEUX chemins sont servis : l'écran PDG interroge /api/admin/table-qr-artwork et
  // appelait cette adresse en lecture, ce qui produisait un 404 dans la console (défaut corrigé).
  const readArtwork = async (_req, res) => {
    try {
      const settings = await store.getSettings().catch(() => ({}));
      const value = normalize(settings.tableQrArtwork || {});
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { ...value, defaults: DEFAULTS, contrast: contrastRatio(value.numberColor, value.background) } });
    } catch (error) { apiError(res, error, 'Impossible de lire les réglages du QR de table.'); }
  };
  app.get('/api/table-qr-artwork', readArtwork);
  app.get('/api/admin/table-qr-artwork', requireAdmin, readArtwork);

  app.put('/api/admin/table-qr-artwork', requireAdmin, checkSameOrigin, async (req, res) => {
    try {
      const { value, problems } = validate(req.body || {});
      if (problems.length) return res.status(400).json({ error: problems[0], problems, code: 'INVALID_QR_ARTWORK' });
      if (contrastRatio(value.numberColor, value.background) < 4.5) {
        return res.status(400).json({ error: 'Le numéro serait illisible sur ce fond (contraste insuffisant). Choisissez une couleur plus foncée ou un fond plus clair.', code: 'LOW_CONTRAST' });
      }
      const settings = await store.getSettings().catch(() => ({}));
      await store.updateSettings({ tableQrArtwork: value });
      await store.addAudit({ actor: 'Administrateur', actorType: 'admin', action: 'table_qr_artwork_updated',
        entityType: 'settings', entityId: 'tableQrArtwork', summary: 'Apparence du QR de table mise à jour.', beforeData: settings.tableQrArtwork || null, afterData: value }).catch(() => {});
      res.setHeader('Cache-Control', 'no-store');
      res.json({ data: { ...value, contrast: contrastRatio(value.numberColor, value.background) } });
    } catch (error) { apiError(res, error, 'Impossible d’enregistrer l’apparence du QR de table.'); }
  });

  return { normalize, validate, contrastRatio, DEFAULTS };
}

module.exports = { attach, normalize, validate, contrastRatio, DEFAULTS };
