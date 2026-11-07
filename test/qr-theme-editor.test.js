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
    if (url.includes('/beneficiaries?')) return { data:[{ id:'bene-smoke', name:'Restaurant Démo', type:'commerce', phone:'+2250711223344', whatsapp:'' }] };
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

test('création QR: saisie conservée et reprise idempotente après réponses réseau perdues', async () => {
  const dom=new JSDOM('<!doctype html><html><body><div id="modalRoot" hidden></div></body></html>',{url:'https://studio.oymike.example/admin',runScripts:'dangerously',pretendToBeVisual:true});
  const {window}=dom;window.QRIA_TEMPLATES=templates;window.QRIAProfile={};window.eval(readPublic('qr-profile-renderer.js'));window.eval(readPublic('qr-wizard.js'));
  const categories=[{id:'cat-shops',name:'Commerces'},{id:'cat-businesses',name:'Entreprises'},{id:'cat-organizations',name:'Organisations'},{id:'cat-individuals',name:'Particuliers'},{id:'cat-other',name:'Autres'}];
  const calls=[];let beneficiaryCommitted=false,codeCommitted=null,beneficiaryPosts=0,codePosts=0,savedResult=null;
  const api=async(url,init={})=>{
    const body=init.body?JSON.parse(init.body):null;calls.push({url,method:init.method||'GET',body});
    if(url.includes('/api/public/qr-templates'))return {data:[]};
    if(url.includes('/api/public/design-gallery'))return {data:[]};
    if(url.includes('/beneficiaries?'))return {data:[]};
    if(url.endsWith('/beneficiaries')&&init.method==='POST'){
      beneficiaryPosts+=1;beneficiaryCommitted=true;
      if(beneficiaryPosts===1)throw new TypeError('Failed to fetch');
      return {data:{id:'bene-retry-001',type:'commerce',name:body.name,phone:body.phone,whatsapp:body.whatsapp},idempotent:true};
    }
    if(url.endsWith('/beneficiaries/bene-retry-001')&&init.method==='PUT')return {data:{id:'bene-retry-001',...body}};
    if(url.endsWith('/codes')&&init.method==='POST'){
      codePosts+=1;
      if(!codeCommitted){codeCommitted={data:{id:'qr-retry-001',publicCode:'retryCode123',beneficiaryId:body.beneficiaryId,name:body.name,status:'active'}};throw new TypeError('Failed to fetch');}
      return {...codeCommitted,idempotent:true};
    }
    throw new Error(`API non prévue : ${url} ${init.method||'GET'}`);
  };
  const modal=window.document.getElementById('modalRoot');
  window.QRIAQRWizard.open({role:'admin',modalRoot:modal,api,categories,publicBaseUrl:'https://studio.oymike.example',onSaved:async(result)=>{savedResult=result;}});
  const settle=async()=>{for(let i=0;i<5;i+=1)await turn();};
  await settle();
  modal.querySelector('[data-template-id="restaurant"]').click();
  modal.querySelector('[data-wizard-action="next"]').click();
  await settle();
  const nameInput=modal.querySelector('[data-profile-field="entityName"]');nameInput.value='Maquis Awa';nameInput.dispatchEvent(new window.Event('input',{bubbles:true}));
  modal.querySelector('[data-wizard-action="next"]').click();await settle();
  assert.match(modal.querySelector('.wizard-error')?.textContent||'',/Ajoutez au moins une information/);
  assert.equal(beneficiaryPosts,0,'une validation échouée ne crée pas de bénéficiaire orphelin');
  const phoneInput=modal.querySelector('[data-profile-field="phone"]');phoneInput.value='+2250711223344';phoneInput.dispatchEvent(new window.Event('input',{bubbles:true}));
  modal.querySelector('[data-wizard-action="next"]').click();modal.querySelector('[data-wizard-action="next"]').click();
  const submit=async()=>{const confirmation=modal.querySelector('#wizardConfirmPublish');confirmation.checked=true;modal.querySelector('[data-wizard-action="publish"]').click();await settle();};
  await submit();
  assert.match(modal.querySelector('.wizard-error')?.textContent||'',/Connexion interrompue/);
  assert.ok(beneficiaryCommitted);assert.equal(codePosts,0);
  modal.querySelector('[data-wizard-action="back"]').click();modal.querySelector('[data-wizard-action="back"]').click();
  assert.equal(modal.querySelector('[data-profile-field="entityName"]').value,'Maquis Awa','le formulaire reste rempli après échec réseau');
  modal.querySelector('[data-wizard-action="next"]').click();modal.querySelector('[data-wizard-action="next"]').click();
  await submit();
  assert.match(modal.querySelector('.wizard-error')?.textContent||'',/Connexion interrompue/);
  assert.equal(codePosts,1,'la première réponse QR est perdue après persistance');
  await submit();
  assert.equal(codePosts,2);assert.equal(savedResult?.idempotent,true);
  assert.equal(savedResult.data.beneficiaryId,'bene-retry-001');assert.equal(savedResult.data.publicCode,'retryCode123');
  const beneficiaryRequests=calls.filter((item)=>item.url.endsWith('/beneficiaries')&&item.method==='POST');
  const qrRequests=calls.filter((item)=>item.url.endsWith('/codes')&&item.method==='POST');
  assert.equal(beneficiaryRequests.length,2);assert.equal(beneficiaryRequests[0].body.clientRequestId,beneficiaryRequests[1].body.clientRequestId);
  assert.equal(qrRequests.length,2);assert.equal(qrRequests[0].body.clientRequestId,qrRequests[1].body.clientRequestId);
  assert.equal(qrRequests[0].body.beneficiaryId,'bene-retry-001');assert.equal(qrRequests[1].body.beneficiaryId,'bene-retry-001');
  assert.equal(modal.hidden,true,'la fenêtre ne se ferme qu’après une réponse de sauvegarde confirmée');
  dom.window.close();
});
