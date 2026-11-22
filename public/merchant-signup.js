// Formulaire public « Devenir marchand » : aucune donnée privée n'est lue ni affichée,
// et le formulaire n'est jamais réinitialisé par erreur (brouillon local conservé).
(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const STATUS_LABELS = { pending: 'En attente de validation', in_review: 'En cours d’examen', approved: 'Approuvée', rejected: 'Refusée', suspended: 'Suspendue' };
  const STATUS_HINTS = {
    pending: 'Votre demande est enregistrée. Elle n’est pas encore examinée : aucun accès marchand n’est actif.',
    in_review: 'Un administrateur examine votre dossier. Aucun QR ne peut être utilisé avant l’approbation et l’activation par le PDG.',
    approved: 'Votre demande est approuvée. Votre espace marchand est créé : connectez-vous pour publier votre boutique. Le QR de boutique sera activé par le PDG selon la procédure en vigueur.',
    rejected: 'Votre demande a été refusée. Le motif est indiqué ci-dessous. Vous pouvez envoyer une nouvelle demande si la situation a évolué.',
    suspended: 'L’espace marchand lié à ce dossier est suspendu. Contactez le PDG pour la suite.',
  };
  const SECTOR_FIELDS = {
    restaurant: [['capacity', 'Nombre de places'], ['specialties', 'Spécialités']],
    maquis: [['capacity', 'Nombre de places'], ['specialties', 'Spécialités / boissons']],
    hardware: [['mainProducts', 'Familles de produits'], ['deliveryZone', 'Zone de livraison']],
    clothing: [['sizes', 'Tailles proposées'], ['brands', 'Marques / styles']],
    outdoor: [['surface', 'Surface ou espace'], ['services', 'Prestations']],
    general: [],
  };
  const state = { busy: false, logo: '', cover: '', reference: '' };
  const DRAFT_KEY = 'oymike-merchant-signup-draft-v1';

  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function showError(message) { const node = $('#formError'); node.textContent = message; node.hidden = !message; }
  function setStep(name) { ['introCard', 'formCard', 'doneCard', 'trackCard'].forEach((id) => { $(`#${id}`).hidden = id !== name; }); }

  // Compression locale avant l'envoi : limite serveur 350 Ko par image.
  function compress(file, maxSide = 1400) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Lecture impossible de ce fichier.'));
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Ce fichier n’est pas une image lisible.'));
        image.onload = () => {
          let { width, height } = image;
          const scale = Math.min(1, maxSide / Math.max(width, height));
          width = Math.round(width * scale); height = Math.round(height * scale);
          const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
          const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, width, height);
          context.drawImage(image, 0, 0, width, height);
          for (const quality of [0.82, 0.7, 0.55, 0.4]) {
            const data = canvas.toDataURL('image/jpeg', quality);
            if (data.length * 0.75 <= 340 * 1024) return resolve(data);
          }
          return reject(new Error('Cette image reste trop lourde. Choisissez une image plus légère.'));
        };
        image.src = String(reader.result);
      };
      reader.readAsDataURL(file);
    });
  }

  async function attach(kind, file) {
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Choisissez un fichier PNG, JPEG ou WEBP.');
    const data = await compress(file, kind === 'cover' ? 1600 : 900);
    state[kind] = data;
    const preview = $(`#${kind}Preview`); const image = $('img', preview);
    image.src = data; preview.hidden = false;
  }

  function renderSectorDetails() {
    const sector = $('#sector').value; const root = $('#sectorDetails');
    const fields = SECTOR_FIELDS[sector] || [];
    root.innerHTML = fields.map(([key, label]) => `<div class="field"><label for="sector-${esc(key)}">${esc(label)}</label><input id="sector-${esc(key)}" data-sector-key="${esc(key)}" maxlength="160"></div>`).join('') || '<p class="muted">Aucun champ supplémentaire pour ce secteur.</p>';
  }

  function collect() {
    const sectorDetails = {};
    $$('[data-sector-key]').forEach((input) => { const value = input.value.trim(); if (value) sectorDetails[input.dataset.sectorKey] = value; });
    const openingHours = $('#openingHours')?.value.trim() || '';
    if (openingHours) sectorDetails.horaires = openingHours;
    return {
      contactName: $('#contactName').value.trim(), businessName: $('#businessName').value.trim(), username: $('#username').value.trim().toLowerCase(),
      phone: $('#phone').value.trim(), email: $('#email').value.trim(), sector: $('#sector').value, city: $('#city').value.trim(),
      location: $('#location').value.trim(), address: $('#address').value.trim(), activityDomain: $('#activityDomain').value.trim(),
      description: $('#description').value.trim(), sectorDetails,
      logo: state.logo, coverImageUrl: state.cover,
      password: $('#password').value, passwordConfirm: $('#passwordConfirm').value,
    };
  }

  function validate(payload) {
    if (!payload.contactName || payload.contactName.length < 2) return 'Indiquez le nom et le prénom du responsable.';
    if (!payload.businessName || payload.businessName.length < 2) return 'Indiquez le nom commercial de votre commerce.';
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(payload.username)) return 'L’identifiant doit contenir 3 à 80 caractères (lettres minuscules, chiffres, point, tiret ou soulignement).';
    if (!/^[0-9+().\s-]{7,32}$/.test(payload.phone) || payload.phone.replace(/\D/g, '').length < 7) return 'Le numéro de téléphone n’est pas valide.';
    if (payload.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) return 'L’adresse e-mail n’est pas valide.';
    if (!payload.city) return 'Indiquez la ville.';
    if (!payload.address) return 'Indiquez l’adresse du commerce.';
    if (!payload.activityDomain) return 'Indiquez votre domaine d’activité.';
    if (payload.description.length < 10) return 'Décrivez votre activité en quelques mots (10 caractères minimum).';
    if (payload.password.length < 12) return 'Le mot de passe doit contenir au moins 12 caractères.';
    if (payload.password !== payload.passwordConfirm) return 'Les deux mots de passe ne correspondent pas.';
    return '';
  }

  function saveDraft() {
    // Brouillon local : un rechargement accidentel ne fait pas perdre la saisie (hors mot de passe).
    try { const { password, passwordConfirm, logo, coverImageUrl, ...rest } = collect(); localStorage.setItem(DRAFT_KEY, JSON.stringify(rest)); } catch (_) {}
  }
  function restoreDraft() {
    try {
      const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); if (!draft) return false;
      for (const key of ['contactName', 'businessName', 'username', 'phone', 'email', 'sector', 'city', 'location', 'address', 'activityDomain', 'description', 'openingHours']) {
        const field = $(`#${key}`); if (field && draft[key] !== undefined) field.value = draft[key];
      }
      renderSectorDetails();
      for (const [key, value] of Object.entries(draft.sectorDetails || {})) { const input = $(`[data-sector-key="${key}"]`); if (input) input.value = value; }
      return Object.values(draft).some((value) => typeof value === 'string' && value.trim());
    } catch (_) { return false; }
  }

  async function request(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { const error = new Error(data.error || `Erreur ${response.status}`); error.code = data.code || ''; throw error; }
    return data;
  }

  function renderTrack(data) {
    $('#trackResult').hidden = false;
    $('#trackRefLabel').textContent = data.reference || '';
    $('#trackBusiness').textContent = data.businessName || '';
    const pill = $('#trackStatus'); pill.textContent = STATUS_LABELS[data.status] || data.status; pill.className = `status-pill ${data.status || 'pending'}`;
    $('#trackDetail').textContent = STATUS_HINTS[data.status] || '';
    $('#trackNext').textContent = data.decisionReason ? `Motif communiqué : ${data.decisionReason}` : '';
  }

  async function init() {
    const status = await request('/api/public/merchant-registration/status').catch(() => null);
    if (!status || !status.data) {
      $('#closedNotice').hidden = false; $('#closedNotice').textContent = 'Le service d’inscription est momentanément indisponible. Réessayez plus tard ou contactez le PDG.';
      $('#startButton').disabled = true; $('#startButton').title = 'Service indisponible';
      return;
    }
    if (status.data.open === false) { $('#closedNotice').hidden = false; $('#startButton').disabled = true; }
    if (location.pathname.replace(/\/+$/, '') === '/devenir-marchand/suivi') { setStep('trackCard'); trackFromBrowser(); }
  }

  async function trackFromBrowser() {
    const result = await request('/api/public/merchant-registrations/track').catch(() => null);
    if (result?.data) renderTrack(result.data);
  }

  $('#startButton').addEventListener('click', () => { setStep('formCard'); renderSectorDetails(); const hadDraft = restoreDraft(); if (hadDraft) { const node = $('#formError'); node.className = 'message warn'; node.textContent = 'Votre saisie précédente a été restaurée (mot de passe non conservé).'; node.hidden = false; } $('#contactName').focus(); });
  $('#sector').addEventListener('change', renderSectorDetails);
  $('#logoFile').addEventListener('change', (event) => attach('logo', event.target.files[0]).catch((error) => showError(error.message)));
  $('#coverFile').addEventListener('change', (event) => attach('cover', event.target.files[0]).catch((error) => showError(error.message)));
  $$('[data-clear-media]').forEach((button) => button.addEventListener('click', () => {
    const kind = button.dataset.clearMedia; state[kind] = ''; $(`#${kind}Preview`).hidden = true; $(`#${kind}File`).value = '';
  }));
  let draftTimer = 0;
  $('#signupForm').addEventListener('input', () => { clearTimeout(draftTimer); draftTimer = setTimeout(saveDraft, 500); });

  $('#signupForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (state.busy) return;
    showError('');
    const payload = collect();
    const problem = validate(payload);
    if (problem) { showError(problem); return; }
    state.busy = true; const button = $('#submitButton'); button.disabled = true; button.textContent = 'Envoi en cours…';
    try {
      const result = await request('/api/public/merchant-registrations', { method: 'POST', body: JSON.stringify(payload) });
      state.reference = result.data.reference;
      localStorage.removeItem(DRAFT_KEY);
      // Seuls les champs non sensibles sont vidés : le brouillon local est supprimé après succès.
      $('#doneReference').textContent = result.data.reference;
      $('#doneMessage').textContent = result.data.message;
      setStep('doneCard');
    } catch (error) {
      if (error.code === 'ACCOUNT_EXISTS') showError(`${error.message} Utilisez « J’ai déjà un compte marchand » ou la réinitialisation de mot de passe.`);
      else if (error.code === 'DUPLICATE_OPEN_REGISTRATION') showError(`${error.message} Ouvrez « Suivre ma demande » pour consulter son statut.`);
      else showError(error.message);
    } finally { state.busy = false; button.disabled = false; button.textContent = 'Envoyer ma demande'; }
  });

  $('#copyReference').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(state.reference); $('#copyReference').textContent = 'Référence copiée'; }
    catch (_) { window.prompt('Copiez votre référence :', state.reference); }
  });

  $('#trackForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const error = $('#trackError'); error.hidden = true;
    const reference = $('#trackReference').value.trim().toUpperCase();
    if (!reference) { error.textContent = 'Indiquez la référence de votre dossier.'; error.hidden = false; return; }
    try {
      const result = await request('/api/public/merchant-registrations/lookup', { method: 'POST', body: JSON.stringify({ reference }) });
      renderTrack(result.data);
    } catch (failure) { $('#trackResult').hidden = true; error.textContent = failure.message; error.hidden = false; }
  });

  init().catch(() => { $('#closedNotice').hidden = false; });
})();
