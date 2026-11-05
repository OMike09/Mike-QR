'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const net=require('node:net');
const QR_STUDIO=require('../qr-studio-config');
const QR_TEMPLATES=require('../public/qr-templates');

const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaHjwHwAExAKAc00zmAAAAABJRU5ErkJggg==';
const PDF=`data:application/pdf;base64,${Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF').toString('base64')}`;
const palette=()=>QR_TEMPLATES.palettes.find(item=>item.id==='forest');
let child,base,tempDir,output='';
async function freePort(){return new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(error=>error?reject(error):resolve(port));});});}
async function waitForServer(){const until=Date.now()+15000;while(Date.now()<until){if(child.exitCode!==null)throw new Error(`Server exited ${child.exitCode}\n${output}`);try{if((await fetch(`${base}/api/health`)).ok)return;}catch(_){}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Server startup timed out\n${output}`);}
async function startServer(port,file){output='';const env={...process.env};delete env.DATABASE_URL;Object.assign(env,{NODE_ENV:'test',PORT:String(port),QRIA_STORE_FILE:file,ADMIN_USERNAME:'studio-ceo',ADMIN_PASSWORD:'Studio-CEO-Strong-2026!',SESSION_SECRET:'custom-studio-tests-session-secret-long-enough'});child=spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>output+=chunk.toString());child.stderr.on('data',chunk=>output+=chunk.toString());await waitForServer();}
async function stopServer(){if(!child||child.exitCode!==null)return;child.kill('SIGTERM');await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,6000))]);}
async function call(url,{cookie='',method='GET',body}={}){const headers={Origin:base};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';const response=await fetch(`${base}${url}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'manual'});const type=response.headers.get('content-type')||'';const data=type.includes('application/json')?await response.json().catch(()=>({})):{};const text=type.includes('application/json')?'':await response.text().catch(()=> '');const cookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);const active=cookies.map(value=>value.split(';')[0]).find(value=>/^qria_(?:admin|manager)=/.test(value)&&value.slice(value.indexOf('=')+1));return{status:response.status,data,text,cookie:active||cookie};}
async function login(url,username,password){const result=await call(url,{method:'POST',body:{username,password}});assert.equal(result.status,200,JSON.stringify(result.data));return result.cookie;}
function customTemplate(){return{label:'Maquis — menu et contacts',group:'Restauration',description:'Menu illustré et informations de contact.',icon:'🍲',kind:'restaurant',purpose:'menu',beneficiaryType:'commerce',categoryId:'cat-shops',recommended:true,enabled:true,defaultTheme:{paletteId:'forest',style:'modern',layout:'catalog'},defaultGroups:['Entrées','Grillades','Poissons','Boissons'],sections:[{id:'identite',title:'Informations du maquis',description:'Coordonnées et détails.'},{id:'menu',title:'Informations du menu',description:'Données propres à cette activité.'}],fields:[{key:'specialite',label:'Spécialité',type:'text',sectionId:'identite',required:true,maxLength:140,description:'Plat emblématique.'},{key:'prixFormule',label:'Prix de la formule',type:'price',sectionId:'menu',required:true,min:0,max:1000000},{key:'serviceSurPlace',label:'Service sur place',type:'checkbox',sectionId:'menu'},{key:'jourSpecial',label:'Jour spécial',type:'select',sectionId:'menu',options:['Vendredi','Samedi']},{key:'photoPlat',label:'Photo du plat',type:'image',sectionId:'menu'},{key:'menuPdf',label:'Menu PDF externe ou importé',type:'document',sectionId:'menu'},{key:'urlMenu',label:'Lien du menu',type:'url',sectionId:'menu'}]};}
function profileFor(templateId,extra={}){return{templateId,kind:'restaurant',templateLabel:'Maquis — menu et contacts',entityName:'Chez Awa',subtitle:'Cuisine locale',description:'Menu de la semaine',logo:'',coverImage:'',phone:'+225 07 11 22 33 44',whatsapp:'',email:'',address:'Bouaké',city:'Bouaké',mapUrl:'',website:'',hours:'',deliveryInfo:'',eventDate:'',eventTime:'',venue:'',organizer:'',registrationUrl:'',bookingUrl:'',orderMode:'simple',socials:[],documents:[],items:[{name:'Poisson braisé',group:'Grillades',description:'Poisson et attiéké',priceXof:6500,available:true,photos:[],variants:[],options:[]}],itemGroups:['Entrées','Grillades','Poissons','Boissons'],customFields:{specialite:'Poisson braisé du jour',prixFormule:4500,serviceSurPlace:true,jourSpecial:'Vendredi',photoPlat:PNG,menuPdf:PDF,urlMenu:'https://example.ci/menu'},theme:{paletteId:'forest',components:{footerText:'Merci pour votre visite.',footerLink:'https://example.ci/contact'}},...extra};}
function codeFor(beneficiaryId,templateId,extra={}){return{name:'Menu Chez Awa',beneficiaryId,categoryId:'cat-shops',purpose:'menu',destinationType:'page',targetUrl:'',title:'Chez Awa',description:'',contentText:'',extraLinks:[],selectedFields:['phone'],selectedPhotoIds:[],photos:[],style:{foreground:'#111111',background:'#FFFFFF',correction:'M',dotStyle:'dots',eyeStyle:'rounded',frameStyle:'poster',frameColor:'#112233',frameTextColor:'#FFFFFF',labelTop:'Scannez pour consulter',labelBottom:'Oymike QR',logo:PNG,logoScale:10},saveMode:'publish',profileData:profileFor(templateId,extra)};}

test('studio QR: modèles PDG versionnés, galerie persistante, champs serveur, rendu public, QR imprimable et manager autorisé',{timeout:90000},async(t)=>{
  // The schema utilities reject ambiguous/unsafe definitions and create bounded, immutable snapshots.
  const categories=[{id:'cat-shops',name:'Commerce'}];
  const template=QR_STUDIO.normalizeTemplate(customTemplate(),{categories});
  assert.match(template.id,/^custom-/);assert.equal(template.version,1);assert.equal(template.group,'Restauration');
  assert.deepEqual(template.defaultGroups,['Entrées','Grillades','Poissons','Boissons']);
  const snapshot=QR_STUDIO.templateSnapshot(template);assert.equal(snapshot.version,1);assert.equal(snapshot.fields.length,7);assert.equal(snapshot.history,undefined);
  const changed=QR_STUDIO.normalizeTemplate({...customTemplate(),description:'Version adaptée.'},{id:template.id,previous:template,categories});
  assert.equal(changed.version,2);assert.equal(changed.history.length,1);
  assert.throws(()=>QR_STUDIO.normalizeTemplate({...customTemplate(),fields:[{key:'xx',label:'Champ A',sectionId:'identite',type:'text'},{key:'xx',label:'Champ B',sectionId:'identite',type:'text'}]},{categories}),/utilisée deux fois/);
  assert.throws(()=>QR_STUDIO.normalizeTemplate({...customTemplate(),fields:[{key:'choices',label:'Liste',sectionId:'menu',type:'select',options:['Un']}]},{categories}),/au moins deux choix/);
  const galleryAsset=QR_STUDIO.normalizeGalleryAsset({title:'Cascade de la région',categoryId:'cascades',image:PNG});assert.equal(galleryAsset.active,true);assert.equal(galleryAsset.categoryLabel,'Cascades');
  assert.throws(()=>QR_STUDIO.normalizeGalleryAsset({title:'SVG refusé',categoryId:'nature',image:'data:image/svg+xml;base64,PHN2Zy8+'}),/JPG, PNG ou WebP/);
  assert.throws(()=>QR_STUDIO.validateCustomFields(template,{specialite:'',prixFormule:'x'},{cleanText:QR_STUDIO.text,httpUrl:(v)=>v,validateImage:(v)=>v,validateDocument:(v)=>v}),/obligatoire/);
  assert.equal(QR_TEMPLATES.setCustomTemplates([template])[0].groupId,'pdg-restauration');
  assert.ok(QR_TEMPLATES.groups.some(group=>group.id==='pdg-restauration'));
  assert.equal(QR_TEMPLATES.get(template.id).fields.length,7);QR_TEMPLATES.setCustomTemplates([]);

  tempDir=await fs.mkdtemp(path.join(os.tmpdir(),'oymike-qr-studio-custom-'));const file=path.join(tempDir,'store.json');const port=await freePort();base=`http://127.0.0.1:${port}`;
  t.after(async()=>{await stopServer();if(tempDir)await fs.rm(tempDir,{recursive:true,force:true});});await startServer(port,file);
  const ceo=await login('/api/auth/login','studio-ceo','Studio-CEO-Strong-2026!');
  assert.equal((await call('/api/admin/qr-templates',{cookie:ceo})).status,200);
  const createdModel=await call('/api/admin/qr-templates',{cookie:ceo,method:'POST',body:customTemplate()});assert.equal(createdModel.status,201,JSON.stringify(createdModel.data));
  const modelId=createdModel.data.data.id;assert.equal(createdModel.data.data.version,1);
  let publicModels=await call('/api/public/qr-templates');assert.equal(publicModels.status,200);assert.ok(publicModels.data.data.some(item=>item.id===modelId));assert.equal(publicModels.data.data.find(item=>item.id===modelId).history,undefined);
  const gallery=await call('/api/admin/design-gallery',{cookie:ceo});assert.equal(gallery.status,200);assert.deepEqual(gallery.data.data,[]);
  const addedAsset=await call('/api/admin/design-gallery',{cookie:ceo,method:'POST',body:{title:'Cascade de la région',categoryId:'cascades',description:'Photo du PDG',image:PNG}});assert.equal(addedAsset.status,201,JSON.stringify(addedAsset.data));
  const publicGallery=await call('/api/public/design-gallery');assert.equal(publicGallery.status,200);assert.equal(publicGallery.data.data[0].title,'Cascade de la région');assert.equal(publicGallery.data.data[0].image,PNG);
  assert.equal((await call(`/api/admin/design-gallery/${addedAsset.data.data.id}`,{cookie:ceo,method:'PUT',body:{active:false}})).status,200);
  assert.equal((await call('/api/public/design-gallery')).data.data.length,0);
  await call(`/api/admin/design-gallery/${addedAsset.data.data.id}`,{cookie:ceo,method:'PUT',body:{active:true}});

  const beneficiary=await call('/api/admin/beneficiaries',{cookie:ceo,method:'POST',body:{type:'commerce',name:'Chez Awa',logo:'',photos:[],phone:'+225 07 11 22 33 44',whatsapp:'',email:'',address:'Bouaké',locationUrl:'',website:'',socials:[],bio:'',offers:[],documents:[]}});assert.equal(beneficiary.status,201,JSON.stringify(beneficiary.data));
  const beneficiaryId=beneficiary.data.data.id;
  const createdCode=await call('/api/admin/codes',{cookie:ceo,method:'POST',body:codeFor(beneficiaryId,modelId)});assert.equal(createdCode.status,201,JSON.stringify(createdCode.data));
  const code=createdCode.data.data;assert.equal(code.status,'active');assert.equal(code.style.correction,'H');assert.equal(code.style.eyeStyle,'rounded');assert.equal(code.style.frameStyle,'poster');assert.equal(code.profileData.customFields.prixFormule,4500);assert.deepEqual(code.profileData.itemGroups,['Entrées','Grillades','Poissons','Boissons']);assert.equal(code.profileData.modelVersion,1);assert.equal(code.profileData.templateSnapshot.fields.length,7);assert.equal(code.profileData.theme.components.footerText,'Merci pour votre visite.');
  const publicData=await call(`/api/public/qr/${code.publicCode}`);assert.equal(publicData.status,200);assert.equal(publicData.data.profileData.customFields.urlMenu,'https://example.ci/menu');assert.equal(publicData.data.profileData.orphanedCustomFields,undefined);assert.equal(publicData.data.profileData.modelHistory,undefined);assert.equal(publicData.data.profileData.templateSnapshot.id,modelId);
  const profileHtml=await call(`/r/${code.publicCode}`);assert.equal(profileHtml.status,200);assert.match(profileHtml.text,/qr-profile-renderer\.js/);

  const invalid=await call(`/api/admin/codes/${code.id}`,{cookie:ceo,method:'PUT',body:{...codeFor(beneficiaryId,modelId),profileData:profileFor(modelId,{customFields:{specialite:'Bon plat',prixFormule:'pas-un-prix',serviceSurPlace:true}})}});assert.equal(invalid.status,400);assert.match(invalid.data.error,/prix|valeur/i);
  const updateModel=await call(`/api/admin/qr-templates/${modelId}`,{cookie:ceo,method:'PUT',body:{...customTemplate(),label:'Maquis — menu enrichi',group:'Cuisine locale',description:'Version deux : menu illustré et contacts.'}});assert.equal(updateModel.status,200,JSON.stringify(updateModel.data));assert.equal(updateModel.data.data.version,2);
  const stillV1=await call(`/api/public/qr/${code.publicCode}`);assert.equal(stillV1.data.profileData.modelVersion,1);assert.equal(stillV1.data.profileData.templateSnapshot.label,'Maquis — menu et contacts');assert.equal(stillV1.data.profileData.items[0].priceXof,6500);
  const v2Code=await call('/api/admin/codes',{cookie:ceo,method:'POST',body:codeFor(beneficiaryId,modelId)});assert.equal(v2Code.status,201,JSON.stringify(v2Code.data));assert.equal(v2Code.data.data.profileData.modelVersion,2);assert.equal(v2Code.data.data.profileData.templateSnapshot.label,'Maquis — menu enrichi');
  const unconfirmed=await call(`/api/admin/qr-templates/${modelId}/migrate`,{cookie:ceo,method:'POST',body:{confirm:false}});assert.equal(unconfirmed.status,400);
  const migrated=await call(`/api/admin/qr-templates/${modelId}/migrate`,{cookie:ceo,method:'POST',body:{confirm:true}});assert.equal(migrated.status,200,JSON.stringify(migrated.data));assert.equal(migrated.data.data.migrated,1);assert.equal(migrated.data.data.version,2);
  const afterMigration=await call(`/api/public/qr/${code.publicCode}`);assert.equal(afterMigration.data.profileData.modelVersion,2);assert.equal(afterMigration.data.profileData.items[0].priceXof,6500);assert.equal(afterMigration.data.profileData.customFields.prixFormule,4500);
  const duplicated=await call(`/api/admin/qr-templates/${modelId}/duplicate`,{cookie:ceo,method:'POST',body:{label:'Copie menu'} });assert.equal(duplicated.status,201);assert.notEqual(duplicated.data.data.id,modelId);assert.equal(duplicated.data.data.label,'Copie menu');
  const blockedDelete=await call(`/api/admin/qr-templates/${modelId}`,{cookie:ceo,method:'DELETE'});assert.equal(blockedDelete.status,409);

  const managerPassword='Manager-Studio-Strong-2026!';const managerCreated=await call('/api/admin/managers',{cookie:ceo,method:'POST',body:{username:'studio.manager',displayName:'Gestionnaire Studio',email:'manager@example.ci',phone:'+225 07 00 00 00 01',password:managerPassword,canCreateCodes:true,canEditCodes:true,canSelfActivateCodes:false,qrLimit:0}});assert.equal(managerCreated.status,201,JSON.stringify(managerCreated.data));
  const manager=await login('/api/manager/auth/login','studio.manager',managerPassword);assert.equal((await call('/api/admin/qr-templates',{cookie:manager})).status,403);
  const managerBeneficiary=await call('/api/manager/beneficiaries',{cookie:manager,method:'POST',body:{type:'commerce',name:'Maquis du Gestionnaire',logo:'',photos:[],phone:'+225 07 99 88 77 66',whatsapp:'',email:'',address:'Bouaké',locationUrl:'',website:'',socials:[],bio:'',offers:[],documents:[]}});assert.equal(managerBeneficiary.status,201,JSON.stringify(managerBeneficiary.data));
  const managerProfile=profileFor(modelId,{entityName:'Maquis du Gestionnaire'});const managerBody={...codeFor(managerBeneficiary.data.data.id,modelId,{entityName:'Maquis du Gestionnaire'}),profileData:managerProfile,customerType:'business',pricingPlanId:'',optionIds:[],createOrder:false,paymentMethod:'cash',clientName:'Maquis du Gestionnaire',companyName:'Maquis du Gestionnaire',clientRequestId:'studio-custom-template-manager-0001'};
  const managerCode=await call('/api/manager/codes',{cookie:manager,method:'POST',body:managerBody});assert.equal(managerCode.status,201,JSON.stringify(managerCode.data));assert.equal(managerCode.data.data.status,'active');assert.equal(managerCode.data.order,null);assert.equal(managerCode.data.data.profileData.customFields.prixFormule,4500);

  // Disabling affects new manager selections immediately, while stored snapshots and data survive.
  const disabled=await call(`/api/admin/qr-templates/${modelId}/status`,{cookie:ceo,method:'PATCH',body:{enabled:false}});assert.equal(disabled.status,200);assert.equal((await call('/api/public/qr-templates')).data.data.some(item=>item.id===modelId),false);
  const newDisabled=await call('/api/manager/codes',{cookie:manager,method:'POST',body:{...managerBody,clientRequestId:'studio-custom-template-manager-0002'}});assert.equal(newDisabled.status,400);assert.match(newDisabled.data.error,/désactivé/);
  const managerOwn=await call(`/api/manager/codes/${managerCode.data.data.id}`,{cookie:manager});assert.equal(managerOwn.status,200);assert.equal(managerOwn.data.data.profileData.customFields.specialite,'Poisson braisé du jour');

  await stopServer();await startServer(port,file);
  const ceoAfterRestart=await login('/api/auth/login','studio-ceo','Studio-CEO-Strong-2026!');
  const settingsAfterRestart=await call('/api/admin/qr-templates',{cookie:ceoAfterRestart});assert.equal(settingsAfterRestart.status,200);assert.ok(settingsAfterRestart.data.data.some(item=>item.id===modelId&&item.enabled===false));
  assert.ok((await call('/api/admin/design-gallery',{cookie:ceoAfterRestart})).data.data.some(item=>item.title==='Cascade de la région'));
  const publicAfterRestart=await call(`/api/public/qr/${code.publicCode}`);assert.equal(publicAfterRestart.status,200);assert.equal(publicAfterRestart.data.profileData.modelVersion,2);assert.equal(publicAfterRestart.data.profileData.items[0].priceXof,6500);
});
