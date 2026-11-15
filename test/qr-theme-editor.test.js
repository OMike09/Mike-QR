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
  assert.match(modal.querySelector('.wizard-draft-recovery')?.textContent || '', /demande QR interrompue est protégée/);
  assert.equal(modal.querySelector('[data-wizard-action="back"]').disabled, true, 'la demande non confirmée est verrouillée afin de rejouer le même corps');
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

test('imports de photos dans le wizard : même corps de formulaire et même défilement pendant ajout, suppression et aperçu', async () => {
  const dom=new JSDOM('<!doctype html><html><body><div id="modalRoot" hidden></div></body></html>',{url:'https://studio.oymike.example/admin',runScripts:'dangerously',pretendToBeVisual:true});
  const {window}=dom;window.QRIA_TEMPLATES=templates;window.QRIAProfile={render(){}};window.TextDecoder=TextDecoder;
  window.createImageBitmap=async()=>({width:1200,height:800,close(){}});
  window.HTMLCanvasElement.prototype.getContext=()=>({drawImage(){},clearRect(){}});
  window.HTMLCanvasElement.prototype.toBlob=function(callback,type){callback(new window.Blob(['optimized-photo'],{type:type||'image/jpeg'}));};
  window.QRIAQRArtwork={async renderCanvas(canvas){canvas.width=240;canvas.height=240;}};
  window.eval(readPublic('qr-wizard.js'));
  const categories=[{id:'cat-shops',name:'Commerces'},{id:'cat-businesses',name:'Entreprises'},{id:'cat-organizations',name:'Organisations'},{id:'cat-individuals',name:'Particuliers'},{id:'cat-other',name:'Autres'}];
  const customTemplate={id:'pdg-imports',label:'Modèle fichiers de test',description:'Image et catalogue PDF.',groupId:'pdg-imports',group:'Fichiers PDG',category:'business',kind:'other',enabled:true,defaultGroups:['Ressources'],sections:[{id:'resources',title:'Ressources'}],fields:[{key:'decor-image',sectionId:'resources',label:'Image décorative',type:'image',description:'Image de test.'},{key:'catalog-pdf',sectionId:'resources',label:'Catalogue PDF',type:'document',description:'Document de test.'}]};
  const api=async(url)=>{
    if(url.includes('/api/public/qr-templates'))return {data:[customTemplate]};
    if(url.includes('/api/public/design-gallery'))return {data:[]};
    if(url.includes('/beneficiaries?'))return {data:[]};
    if(url.endsWith('/categories'))return {data:categories};
    throw new Error(`API inattendue dans le test de défilement: ${url}`);
  };
  const modal=window.document.getElementById('modalRoot');
  const opened=window.QRIAQRWizard.open({role:'admin',modalRoot:modal,api,categories,publicBaseUrl:'https://studio.oymike.example'});
  const settle=async()=>{for(let i=0;i<80;i+=1){await turn();if(i%4===0)await new Promise((resolve)=>setTimeout(resolve,0));}};
  const waitFor=async(predicate)=>{for(let i=0;i<100;i+=1){await turn();if(predicate())return;await new Promise((resolve)=>setTimeout(resolve,1));}throw new Error('Échéance dépassée pendant le traitement de la photo.');};
  const photo=(name)=>new window.File(['image bytes'],name,{type:'image/jpeg'});
  const choose=(input,files)=>{Object.defineProperty(input,'files',{configurable:true,value:files});input.dispatchEvent(new window.Event('change',{bubbles:true}));};
  const statusFor=(input)=>input.closest('label')?.querySelector('[data-upload-status]')||input.closest('label')?.parentElement?.querySelector('[data-upload-status]');
  await settle();
  modal.querySelector('[data-template-id="restaurant"]').click();modal.querySelector('[data-wizard-action="next"]').click();await settle();
  modal.querySelector('[data-wizard-action="beneficiary-new"]').click();
  const name=modal.querySelector('[data-profile-field="entityName"]');name.value='Restaurant Scroll';name.dispatchEvent(new window.Event('input',{bubbles:true}));
  const phone=modal.querySelector('[data-profile-field="phone"]');phone.value='+2250700000000';phone.dispatchEvent(new window.Event('input',{bubbles:true}));
  let body=modal.querySelector('.wizard-body');body.scrollTop=420;

  let input=modal.querySelector('[data-upload-field="logo"]');let status=statusFor(input);choose(input,[photo('logo.jpg')]);
  await waitFor(()=>status.textContent.includes('Logo optimisé'));
  assert.equal(modal.querySelector('.wizard-body'),body,'l’import du logo ne démonte pas le corps du wizard');assert.equal(body.scrollTop,420);
  assert.equal(modal.querySelector('[data-profile-image-preview="logo"] img').hidden,false,'l’aperçu du logo apparaît dans son emplacement réservé');

  input=modal.querySelector('[data-upload-field="coverImage"]');status=statusFor(input);choose(input,[photo('cover.jpg')]);
  await waitFor(()=>status.textContent.includes('Photo de couverture optimisée'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,420);

  input=modal.querySelector('[data-upload-qr-gallery]');status=statusFor(input);choose(input,[photo('one.jpg'),photo('two.jpg')]);
  await waitFor(()=>status.textContent.includes('optimisées'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,420);assert.equal(modal.querySelectorAll('.wizard-gallery-card').length,2);
  modal.querySelector('[data-wizard-action="delete-photo"]').click();await settle();
  assert.equal(modal.querySelector('.wizard-body'),body,'supprimer une photo ne démonte pas le formulaire');assert.equal(body.scrollTop,420);assert.equal(modal.querySelectorAll('.wizard-gallery-card').length,1);
  input=modal.querySelector('[data-upload-qr-gallery]');status=statusFor(input);choose(input,[photo('replacement.jpg')]);
  await waitFor(()=>status.textContent.includes('optimisée'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,420);assert.equal(modal.querySelectorAll('.wizard-gallery-card').length,2);

  modal.querySelector('[data-wizard-action="new-item"]').click();await settle();body=modal.querySelector('.wizard-body');body.scrollTop=510;
  const itemName=modal.querySelector('[data-item-field="name"]');itemName.value='Plat test';itemName.dispatchEvent(new window.Event('input',{bubbles:true}));
  input=modal.querySelector('[data-item-photo]');status=statusFor(input);choose(input,[photo('item.jpg')]);
  await waitFor(()=>status.textContent.includes('Photo de l’élément optimisée'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,510);assert.ok(modal.querySelector('#wizardItemPhotoPreview img'));
  modal.querySelector('[data-wizard-action="remove-item-photo"]').click();await settle();
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,510);assert.equal(modal.querySelector('#wizardItemPhotoPreview img'),null);

  modal.querySelector('[data-wizard-action="cancel-item"]').click();await settle();
  modal.querySelector('[data-wizard-action="next"]').click();await settle();
  modal.querySelector('[data-wizard-action="design-tab"][data-design-tab="background"]').click();await settle();body=modal.querySelector('.wizard-body');body.scrollTop=620;
  input=modal.querySelector('[data-theme-background-image]');status=statusFor(input);choose(input,[photo('background.jpg')]);
  await waitFor(()=>status.textContent.includes('Image de fond optimisée'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,620);assert.equal(modal.querySelector('[data-background-image-preview] img').hidden,false);
  modal.querySelector('[data-wizard-action="design-tab"][data-design-tab="qr-print"]').click();await settle();body=modal.querySelector('.wizard-body');body.scrollTop=560;
  input=modal.querySelector('[data-qr-logo]');status=statusFor(input);choose(input,[photo('qr-logo.jpg')]);
  await waitFor(()=>status.textContent.includes('Logo central optimisé'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,560);assert.equal(modal.querySelector('[data-qr-logo-preview] img').hidden,false);

  modal.querySelector('[data-wizard-action="back"]').click();await settle();
  modal.querySelector('[data-wizard-action="back"]').click();await settle();
  modal.querySelector('[data-template-group="pdg-imports"]').click();
  modal.querySelector('[data-template-id="pdg-imports"]').click();
  modal.querySelector('[data-wizard-action="next"]').click();await settle();
  body=modal.querySelector('.wizard-body');body.scrollTop=680;
  input=modal.querySelector('[data-custom-upload="decor-image"]');status=statusFor(input);choose(input,[photo('decorative-image.jpg')]);
  await waitFor(()=>status.textContent.includes('Image du modèle optimisée'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,680);assert.equal(modal.querySelector('[data-custom-preview="decor-image"] img').hidden,false);
  input=modal.querySelector('[data-custom-upload="catalog-pdf"]');status=statusFor(input);
  const pdf=new window.File(['%PDF-1.4\nCatalogue de test\n%%EOF'],'catalogue.pdf',{type:'application/pdf'});
  if(typeof pdf.arrayBuffer!=='function')Object.defineProperty(pdf,'arrayBuffer',{value:async()=>new TextEncoder().encode('%PDF-1.4\nCatalogue de test\n%%EOF').buffer});
  choose(input,[pdf]);await waitFor(()=>status.textContent.includes('Document prêt à être enregistré'));
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,680);assert.equal(modal.querySelector('[data-custom-remove][data-custom-key="catalog-pdf"]').hidden,false);
  modal.querySelector('[data-custom-remove][data-custom-key="catalog-pdf"]').click();await settle();
  assert.equal(modal.querySelector('.wizard-body'),body);assert.equal(body.scrollTop,680);assert.equal(modal.querySelector('[data-custom-remove][data-custom-key="catalog-pdf"]').hidden,true);

  const checkItemPhotoForTemplate=async(groupId,templateId,itemName,photoName,scrollTop)=>{
    modal.querySelector('[data-wizard-action="back"]').click();await settle();
    modal.querySelector(`[data-template-group="${groupId}"]`).click();modal.querySelector(`[data-template-id="${templateId}"]`).click();
    modal.querySelector('[data-wizard-action="next"]').click();await settle();modal.querySelector('[data-wizard-action="new-item"]').click();await settle();
    body=modal.querySelector('.wizard-body');body.scrollTop=scrollTop;
    const itemNameField=modal.querySelector('[data-item-field="name"]');itemNameField.value=itemName;itemNameField.dispatchEvent(new window.Event('input',{bubbles:true}));
    input=modal.querySelector('[data-item-photo]');status=statusFor(input);choose(input,[photo(photoName)]);
    await waitFor(()=>status.textContent.includes('Photo de l’élément optimisée'));
    assert.equal(modal.querySelector('.wizard-body'),body,`${templateId}: l’import ne remonte pas le formulaire`);assert.equal(body.scrollTop,scrollTop,`${templateId}: le défilement reste stable`);assert.ok(modal.querySelector('#wizardItemPhotoPreview img'));
    modal.querySelector('[data-wizard-action="cancel-item"]').click();await settle();
  };
  await checkItemPhotoForTemplate('hospitality','hotel','Chambre de test','hotel-room.jpg',710);
  await checkItemPhotoForTemplate('professional','coiffure','Prestation de test','service.jpg',730);
  opened.close();dom.window.close();
});
