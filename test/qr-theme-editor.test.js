'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const templates = require('../public/qr-templates');

const readPublic = (name) => fs.readFileSync(path.join(__dirname, '../public', name), 'utf8');
const turn = () => new Promise((resolve) => setImmediate(resolve));

test('éditeur visuel: couleurs HEX, aperçu immédiat, typographie et dégradé appliqués au vrai composant', async () => {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM('<!doctype html><html><body><div id="modalRoot" hidden></div></body></html>', {
    url:'https://studio.oymike.example/admin', runScripts:'dangerously', pretendToBeVisual:true, virtualConsole,
  });
  const { window } = dom;
  window.QRIA_TEMPLATES = templates;
  window.QRIAProfile = {};
  window.eval(readPublic('qr-profile-renderer.js'));
  window.eval(readPublic('qr-wizard.js'));
  const calls = [];
  const api = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.includes('/beneficiaries?')) return { data:[{ id:'bene-smoke', name:'Restaurant Démo', type:'commerce', phone:'', whatsapp:'' }] };
    if (url.endsWith('/categories')) return { data:[
      {id:'cat-shops',name:'Commerces'},{id:'cat-businesses',name:'Entreprises'},{id:'cat-organizations',name:'Organisations'},
      {id:'cat-individuals',name:'Particuliers'},{id:'cat-other',name:'Autres'},
    ] };
    throw new Error(`API non prévue par ce smoke test : ${url}`);
  };
  const modal = window.document.getElementById('modalRoot');
  const opened = window.QRIAQRWizard.open({ role:'admin', modalRoot:modal, api, publicBaseUrl:'https://studio.oymike.example' });
  await turn();
  await turn();
  assert.ok(modal.querySelector('[data-template-id="restaurant"]'));
  modal.querySelector('[data-template-id="restaurant"]').click();
  modal.querySelector('[data-wizard-action="next"]').click();
  await turn();
  const beneficiary = modal.querySelector('#wizardBeneficiary');
  beneficiary.value = 'bene-smoke';
  beneficiary.dispatchEvent(new window.Event('change',{bubbles:true}));
  const entityName = modal.querySelector('[data-profile-field="entityName"]');
  entityName.value = 'Restaurant Démo';
  entityName.dispatchEvent(new window.Event('input',{bubbles:true}));
  modal.querySelector('[data-wizard-action="next"]').click();
  await turn();
  assert.match(modal.querySelector('.wizard-progress')?.textContent || '', /Apparence/);
  modal.querySelector('[data-design-tab="colors"]').click();
  let swatch = modal.querySelector('[data-theme-field="colors.pageBg"]');
  swatch.value = '#ff0000';
  swatch.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(modal.querySelector('.qr-experience')?.style.getPropertyValue('--experience-page-bg'),'#FF0000');
  assert.equal(modal.querySelector('[data-theme-hex="colors.pageBg"]').value,'#FF0000');
  const manualHex = modal.querySelector('[data-theme-hex="colors.pageBg"]');
  manualHex.value = '#006B45';
  manualHex.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(modal.querySelector('[data-theme-field="colors.pageBg"]').value,'#006b45');
  assert.equal(modal.querySelector('.qr-experience')?.style.getPropertyValue('--experience-page-bg'),'#006B45');
  modal.querySelector('[data-wizard-action="undo-theme"]').click();
  assert.equal(modal.querySelector('.qr-experience')?.style.getPropertyValue('--experience-page-bg'),'#FF0000');
  modal.querySelector('[data-wizard-action="redo-theme"]').click();
  assert.equal(modal.querySelector('.qr-experience')?.style.getPropertyValue('--experience-page-bg'),'#006B45');
  modal.querySelector('[data-design-tab="type"]').click();
  const titleFont = modal.querySelector('[data-theme-field="typography.title.family"]');
  titleFont.value = 'Poppins';
  titleFont.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.equal(modal.querySelector('.qr-experience')?.style.getPropertyValue('--experience-title-family'),'"Poppins",ui-sans-serif,system-ui,sans-serif');
  modal.querySelector('[data-design-tab="background"]').click();
  const backgroundType = modal.querySelector('[data-theme-field="backgroundStyle.type"]');
  backgroundType.value = 'gradient';
  backgroundType.dispatchEvent(new window.Event('input',{bubbles:true}));
  assert.match(modal.querySelector('.qr-experience')?.style.backgroundImage || '',/linear-gradient/);
  modal.querySelector('[data-wizard-action="back"]').click();
  modal.querySelector('[data-wizard-action="back"]').click();
  modal.querySelector('[data-template-group="commerce"]').click();
  modal.querySelector('[data-template-id="boutique"]').click();
  modal.querySelector('[data-wizard-action="next"]').click();
  await turn();
  assert.equal(modal.querySelector('[data-profile-field="entityName"]').value,'Restaurant Démo','changer de modèle conserve les informations saisies');
  assert.ok(calls.some((call) => call.url.includes('/beneficiaries?')));
  opened.close();
  dom.window.close();
});
