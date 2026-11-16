'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

let child; let base; let tempDir; let output = '';
async function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer(); server.once('error', reject); server.listen(0, '127.0.0.1', () => {
      const port = server.address().port; server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}
async function startServer() {
  const port = await freePort(); base = `http://127.0.0.1:${port}`; tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'oymike-extras-test-'));
  const env = { ...process.env }; delete env.DATABASE_URL; delete env.WEB_PUSH_VAPID_PUBLIC_KEY; delete env.WEB_PUSH_VAPID_PRIVATE_KEY; delete env.WEB_PUSH_SUBJECT; delete env.PUBLIC_BASE_URL;
  Object.assign(env, { NODE_ENV:'test', PORT:String(port), QRIA_STORE_FILE:path.join(tempDir,'store.json'), ADMIN_USERNAME:'extras-ceo', ADMIN_PASSWORD:'Extras-CEO-Password-2026!', SESSION_SECRET:'merchant-extras-test-secret-long-enough-2026' });
  child = spawn(process.execPath,['server.js'],{cwd:path.resolve(__dirname,'..'),env,stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',(chunk)=>{output+=chunk.toString();}); child.stderr.on('data',(chunk)=>{output+=chunk.toString();});
  const deadline=Date.now()+20000;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error(`Server exited ${child.exitCode}\n${output}`);
    try{if((await fetch(`${base}/api/health`)).ok)return;}catch(_){}
    await new Promise((resolve)=>setTimeout(resolve,100));
  }
  throw new Error(`Server startup timeout\n${output}`);
}
async function stopServer(){
  if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise((resolve)=>child.once('exit',resolve));}
  if(tempDir)await fs.rm(tempDir,{recursive:true,force:true});
}
function sessionCookie(response,role){
  const cookies=typeof response.headers.getSetCookie==='function'?response.headers.getSetCookie():[response.headers.get('set-cookie')].filter(Boolean);
  return cookies.map((value)=>value.split(';')[0]).find((value)=>value.startsWith(`qria_${role}=`)&&value.slice(value.indexOf('=')+1))||'';
}
async function call(url,{cookie='',method='GET',body,redirect='manual'}={}){
  const headers={Origin:base};if(cookie)headers.Cookie=cookie;if(body!==undefined)headers['Content-Type']='application/json';
  const response=await fetch(`${base}${url}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect});
  const type=response.headers.get('content-type')||'';const data=type.includes('application/json')?await response.json().catch(()=>({})):{};
  const text=type.includes('application/json')?'':await response.text().catch(()=> '');return{response,status:response.status,data,text};
}
async function login(role,url,username,password){
  const result=await call(url,{method:'POST',body:{username,password}});assert.equal(result.status,200,JSON.stringify(result.data));
  const cookie=sessionCookie(result.response,role);assert.ok(cookie,`${role} session cookie`);return{...result,cookie};
}
const isoFromNow=(days,minutes=0)=>new Date(Date.now()+days*86400000+minutes*60000).toISOString();

test('commerce extras : secteur, découverte, annonces, QR d’emplacement et commandes reliées', {timeout:60000}, async(t)=>{
  await startServer();t.after(stopServer);
  const ceo=await login('admin','/api/auth/login','extras-ceo','Extras-CEO-Password-2026!');
  const managerCreated=await call('/api/admin/managers',{cookie:ceo.cookie,method:'POST',body:{username:'extras.manager',displayName:'Gestionnaire principal',password:'Extras-Manager-Password-2026!',canCreateCodes:true,canEditCodes:true,canManageMerchants:true}});
  assert.equal(managerCreated.status,201,JSON.stringify(managerCreated.data));const manager=managerCreated.data.data;
  const limitedCreated=await call('/api/admin/managers',{cookie:ceo.cookie,method:'POST',body:{username:'extras.limited',displayName:'Gestionnaire limité',password:'Extras-Limited-Password-2026!',canCreateCodes:false,canEditCodes:false,canManageMerchants:false}});
  assert.equal(limitedCreated.status,201,JSON.stringify(limitedCreated.data));const limitedManager=limitedCreated.data.data;
  const created=await call('/api/admin/merchants',{cookie:ceo.cookie,method:'POST',body:{username:'extras.restaurant',displayName:'Restaurant Extra',managerId:manager.id,temporaryPasswordLength:6}});
  assert.equal(created.status,201,JSON.stringify(created.data));const merchant=created.data.data;assert.equal(created.data.temporaryPassword.length,6);
  const limitedLogin=await login('manager','/api/manager/auth/login','extras.limited','Extras-Limited-Password-2026!');
  const firstLogin=await login('merchant','/api/merchant/auth/login','extras.restaurant',created.data.temporaryPassword);
  const passwordChange=await call('/api/merchant/auth/change-password',{cookie:firstLogin.cookie,method:'POST',body:{password:'Extras-Restaurant-Personal-2026!',confirmPassword:'Extras-Restaurant-Personal-2026!'}});
  assert.equal(passwordChange.status,200,JSON.stringify(passwordChange.data));const merchantCookie=sessionCookie(passwordChange.response,'merchant');
  const savedStore=await call('/api/merchant/store',{cookie:merchantCookie,method:'PUT',body:{name:'Restaurant Extra',slug:'restaurant-extra',sector:'restaurant',description:'Cuisine et boissons à Abidjan.',phone:'+225 0700000000',address:'Cocody, Abidjan',isPublished:true,deliveryEnabled:true,pickupEnabled:true,acceptsOrders:true}});
  assert.equal(savedStore.status,200,JSON.stringify(savedStore.data));assert.equal(savedStore.data.data.sector,'restaurant');const storeId=savedStore.data.data.id;
  const product=await call('/api/merchant/products',{cookie:merchantCookie,method:'POST',body:{name:'Attiéké poisson',category:'Plats',description:'Poisson braisé et attiéké',priceXof:3500,stockQuantity:100,trackStock:false,status:'active'}});
  assert.equal(product.status,201,JSON.stringify(product.data));

  const discoverPage=await call('/discover/');assert.equal(discoverPage.status,200);assert.match(discoverPage.text,/Découvrir les boutiques/i);
  const search=await call('/api/public/search?q=attiéké');assert.equal(search.status,200,JSON.stringify(search.data));
  assert.ok(search.data.data.products.some((row)=>row.name==='Attiéké poisson'&&row.storeSlug==='restaurant-extra'));
  const publicShop=await call('/api/public/shops/restaurant-extra');assert.equal(publicShop.status,200);
  assert.equal(publicShop.data.data.store.sector,'restaurant');

  const adBody={requestId:'ad-create-request-extra-0001',title:'Menu du jour',message:'Poisson braisé servi ce midi.',startsAt:isoFromNow(0,-2),endsAt:isoFromNow(2),status:'active'};
  const ad=await call('/api/merchant/ads',{cookie:merchantCookie,method:'POST',body:adBody});assert.equal(ad.status,201,JSON.stringify(ad.data));
  const adRetry=await call('/api/merchant/ads',{cookie:merchantCookie,method:'POST',body:adBody});assert.equal(adRetry.status,200);assert.equal(adRetry.data.data.id,ad.data.data.id);assert.equal(adRetry.data.data.idempotent,true);
  const adConflict=await call('/api/merchant/ads',{cookie:merchantCookie,method:'POST',body:{...adBody,message:'Texte différent'}});assert.equal(adConflict.status,409,'a retried request ID cannot create a changed campaign');
  assert.equal((await call('/api/merchant/ads',{cookie:limitedLogin.cookie})).status,401,'manager session cannot authenticate through merchant paths');
  const unassignedManager=await call(`/api/manager/merchants/${merchant.id}/ads`,{cookie:limitedLogin.cookie});assert.equal(unassignedManager.status,403);
  const assignment=await call(`/api/admin/merchants/${merchant.id}/assignments`,{cookie:ceo.cookie,method:'POST',body:{managerId:limitedManager.id,canManageStore:true,canManageProducts:false,canManageOrders:false,canCreateStoreQr:false,canViewAudit:false}});
  assert.equal(assignment.status,200);assert.equal((await call(`/api/manager/merchants/${merchant.id}/ads`,{cookie:limitedLogin.cookie})).status,200,'the delegated store scope can read announcements');
  assert.equal((await call(`/api/manager/merchants/${merchant.id}/reward-claims`,{cookie:limitedLogin.cookie})).status,403,'store permission does not grant order/code-redeem permission');
  const managerAd=await call(`/api/manager/merchants/${merchant.id}/ads`,{cookie:limitedLogin.cookie,method:'POST',body:{requestId:'ad-manager-request-extra-01',title:'Fermeture dimanche',message:'La boutique ferme dimanche.',status:'paused'}});
  assert.equal(managerAd.status,201,JSON.stringify(managerAd.data));

  const servicePointBody={requestId:'service-point-request-extra-01',type:'table',name:'Table 4',zone:'Terrasse',instructions:'Scanner avant de commander'};
  const point=await call('/api/merchant/service-points',{cookie:merchantCookie,method:'POST',body:servicePointBody});assert.equal(point.status,201,JSON.stringify(point.data));
  assert.equal(point.data.data.storeId,storeId);assert.match(point.data.data.url,/\/t\/T-/);assert.equal(point.data.data.path,`/t/${point.data.data.publicCode}`);
  const pointRetry=await call('/api/merchant/service-points',{cookie:merchantCookie,method:'POST',body:servicePointBody});assert.equal(pointRetry.status,200);assert.equal(pointRetry.data.data.id,point.data.data.id);assert.equal(pointRetry.data.data.publicCode,point.data.data.publicCode);
  const publicPoint=await call(`/api/public/service-points/${encodeURIComponent(point.data.data.publicCode)}`);assert.equal(publicPoint.status,200);assert.equal(publicPoint.data.data.storeSlug,'restaurant-extra');
  const qrScan=await call(`/t/${encodeURIComponent(point.data.data.publicCode)}`);assert.equal(qrScan.status,302);assert.equal(qrScan.response.headers.get('location'),`/shop/restaurant-extra?servicePoint=${encodeURIComponent(point.data.data.publicCode)}`);
  const pointsAfterScan=await call('/api/merchant/service-points',{cookie:merchantCookie});assert.equal(pointsAfterScan.data.data[0].qrScanCount,1);
  const order=await call('/api/public/shops/restaurant-extra/orders',{method:'POST',body:{clientRequestId:'request-order-table-extras-0001',customerName:'Client QR',customerPhone:'+225 0500000000',deliveryAddress:'Table 4 · Terrasse',servicePointCode:point.data.data.publicCode,items:[{productId:product.data.data.id,quantity:1}]}});
  assert.equal(order.status,201,JSON.stringify(order.data));assert.equal(order.data.data.order.servicePointName,'Table 4');
  const receivedOrders=await call('/api/merchant/orders',{cookie:merchantCookie});assert.equal(receivedOrders.data.data[0].servicePointName,'Table 4');

  const deactivate=await call(`/api/merchant/service-points/${encodeURIComponent(point.data.data.id)}`,{cookie:merchantCookie,method:'DELETE',body:{}});assert.equal(deactivate.status,200);assert.equal(deactivate.data.data.publicCode,point.data.data.publicCode);
  const inactiveOrder=await call('/api/public/shops/restaurant-extra/orders',{method:'POST',body:{clientRequestId:'request-order-table-extras-0002',customerName:'Client QR',customerPhone:'+225 0500000000',deliveryAddress:'Table 4',servicePointCode:point.data.data.publicCode,items:[{productId:product.data.data.id,quantity:1}]}});
  assert.equal(inactiveOrder.status,400,'disabled service point codes cannot be attached to a new order');
  for(const sector of ['restaurant','maquis','hardware','clothing']){
    const changedSector=await call('/api/merchant/store',{cookie:merchantCookie,method:'PUT',body:{sector}});assert.equal(changedSector.status,200);assert.equal(changedSector.data.data.sector,sector);
    const publicSector=await call('/api/public/shops/restaurant-extra');assert.equal(publicSector.data.data.store.sector,sector,`${sector} is persisted and served on the public catalogue`);
  }
});

test('récompenses et bons cadeaux : participation gratuite, codes à usage unique, stocks/solde atomiques, permissions', {timeout:60000}, async(t)=>{
  await startServer();t.after(stopServer);
  const ceo=await login('admin','/api/auth/login','extras-ceo','Extras-CEO-Password-2026!');
  const managerCreated=await call('/api/admin/managers',{cookie:ceo.cookie,method:'POST',body:{username:'rewards.manager',displayName:'Gestionnaire responsable',password:'Rewards-Manager-Password-2026!',canCreateCodes:true,canEditCodes:true,canManageMerchants:true}});
  assert.equal(managerCreated.status,201);const manager=managerCreated.data.data;
  const created=await call('/api/admin/merchants',{cookie:ceo.cookie,method:'POST',body:{username:'rewards.shop',displayName:'Boutique Récompenses',managerId:manager.id,temporaryPasswordLength:6}});
  assert.equal(created.status,201);const merchant=created.data.data;const firstLogin=await login('merchant','/api/merchant/auth/login','rewards.shop',created.data.temporaryPassword);
  const changed=await call('/api/merchant/auth/change-password',{cookie:firstLogin.cookie,method:'POST',body:{password:'Rewards-Shop-Personal-2026!',confirmPassword:'Rewards-Shop-Personal-2026!'}});
  assert.equal(changed.status,200);const merchantCookie=sessionCookie(changed.response,'merchant');
  const savedStore=await call('/api/merchant/store',{cookie:merchantCookie,method:'PUT',body:{name:'Boutique Récompenses',slug:'boutique-recompenses',sector:'clothing',description:'Mode et accessoires.',isPublished:true,acceptsOrders:true}});
  assert.equal(savedStore.status,200,JSON.stringify(savedStore.data));
  const start=isoFromNow(0,-5);const end=isoFromNow(5);
  const campaignBody={requestId:'reward-campaign-request-extra-01',title:'Offre de lancement',description:'Avantages gratuits de bienvenue.',startsAt:start,endsAt:end,maxParticipants:2,status:'paused',entryFeeXof:0,
    authorizationReference:'ARJH-2026-EXTRA-001',authorizationConfirmed:true,complianceAccepted:true,
    prizes:[{label:'Réduction de 10 %',kind:'benefit',quantity:1,weight:1},{label:'Pas de lot — merci de votre visite',kind:'no_prize',quantity:1,weight:1}]};
  const activeAtCreation=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:{...campaignBody,requestId:'reward-active-create-extra-01',status:'active'}});assert.equal(activeAtCreation.status,400,'a merchant cannot publish a campaign directly at creation');
  const campaign=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:campaignBody});assert.equal(campaign.status,201,JSON.stringify(campaign.data));assert.equal(campaign.data.data.status,'paused');assert.equal(campaign.data.data.authorizationStatus,'pending');
  const campaignRetry=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:campaignBody});assert.equal(campaignRetry.status,200);assert.equal(campaignRetry.data.data.id,campaign.data.data.id);
  const paidCampaign=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:{...campaignBody,requestId:'reward-campaign-paid-extra-01',entryFeeXof:500}});assert.equal(paidCampaign.status,400,'the server rejects paid participation');
  const cashCampaign=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:{...campaignBody,requestId:'reward-campaign-cash-extra-01',prizes:[{label:'Gain de 10 000 XOF',kind:'benefit',quantity:2,weight:1}]}});assert.equal(cashCampaign.status,400,'cash-like prize descriptions are blocked');
  const disguisedCash=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:{...campaignBody,requestId:'reward-campaign-cash-extra-02',prizes:[{label:'Gain de 10000',kind:'benefit',quantity:2,weight:1}]}});assert.equal(disguisedCash.status,400,'cash-like gain amounts without a currency suffix are blocked');
  const merchantAdminList=await call('/api/admin/reward-authorizations',{cookie:merchantCookie});assert.ok([401,403].includes(merchantAdminList.status),'merchants cannot list CEO authorization decisions');
  const prematureActivation=await call(`/api/merchant/reward-campaigns/${campaign.data.data.id}/status`,{cookie:merchantCookie,method:'POST',body:{status:'active',authorizationReference:campaignBody.authorizationReference,authorizationConfirmed:true}});assert.equal(prematureActivation.status,400,'merchant attestation alone cannot bypass CEO review');
  const authorizationQueue=await call('/api/admin/reward-authorizations',{cookie:ceo.cookie});assert.equal(authorizationQueue.status,200);assert.equal(authorizationQueue.data.data.length,1);assert.equal(authorizationQueue.data.data[0].authorizationStatus,'pending');
  const missingReviewNote=await call(`/api/admin/reward-authorizations/${campaign.data.data.id}/decision`,{cookie:ceo.cookie,method:'POST',body:{decision:'approved'}});assert.equal(missingReviewNote.status,400,'the approval requires an audit note');
  const approved=await call(`/api/admin/reward-authorizations/${campaign.data.data.id}/decision`,{cookie:ceo.cookie,method:'POST',body:{decision:'approved',reviewNote:'Document présenté, référence et dates examinées.'}});assert.equal(approved.status,200,JSON.stringify(approved.data));assert.equal(approved.data.data.authorizationStatus,'approved');assert.equal(approved.data.data.status,'paused','review approval does not publish the campaign automatically');
  const wrongReference=await call(`/api/merchant/reward-campaigns/${campaign.data.data.id}/status`,{cookie:merchantCookie,method:'POST',body:{status:'active',authorizationReference:'ARJH-OTHER-000',authorizationConfirmed:true}});assert.equal(wrongReference.status,400,'the activation reference must match the reviewed record');
  const activated=await call(`/api/merchant/reward-campaigns/${campaign.data.data.id}/status`,{cookie:merchantCookie,method:'POST',body:{status:'active',authorizationReference:campaignBody.authorizationReference,authorizationConfirmed:true}});assert.equal(activated.status,200,JSON.stringify(activated.data));assert.equal(activated.data.data.status,'active');
  const shop=await call('/api/public/shops/boutique-recompenses');assert.equal(shop.status,200);assert.equal(shop.data.data.rewardCampaigns.length,1);assert.equal(shop.data.data.rewardCampaigns[0].participationFeeXof,0);assert.match(shop.data.data.rewardCampaigns[0].rules,/examen hors plateforme/);

  const claimOneBody={phone:'+225 07 00 00 00 01',requestId:'reward-claim-request-extra-0001'};
  const claimOne=await call(`/api/public/shops/boutique-recompenses/rewards/${campaign.data.data.id}/claim`,{method:'POST',body:claimOneBody});assert.equal(claimOne.status,201,JSON.stringify(claimOne.data));
  assert.ok(claimOne.data.data.code);assert.equal(claimOne.data.data.idempotent,false);
  const claimOneRetry=await call(`/api/public/shops/boutique-recompenses/rewards/${campaign.data.data.id}/claim`,{method:'POST',body:claimOneBody});assert.equal(claimOneRetry.status,200);assert.equal(claimOneRetry.data.data.code,claimOne.data.data.code);assert.equal(claimOneRetry.data.data.idempotent,true);
  const duplicatePhone=await call(`/api/public/shops/boutique-recompenses/rewards/${campaign.data.data.id}/claim`,{method:'POST',body:{phone:claimOneBody.phone,requestId:'reward-claim-request-extra-0002'}});assert.equal(duplicatePhone.status,409);
  const concurrentClaims=await Promise.all(['+225 07 00 00 00 02','+225 07 00 00 00 03'].map((phone,index)=>call(`/api/public/shops/boutique-recompenses/rewards/${campaign.data.data.id}/claim`,{method:'POST',body:{phone,requestId:`reward-concurrent-request-extra-0${index+1}`}})));
  assert.equal(concurrentClaims.filter((row)=>row.status===201).length,1,'one remaining participant slot is granted exactly once under concurrent requests');
  assert.equal(concurrentClaims.filter((row)=>row.status===409).length,1,'the competing request is denied after capacity reaches zero');
  const rewardCode=claimOne.data.data.code;const consume=await call('/api/merchant/reward-claims/redeem',{cookie:merchantCookie,method:'POST',body:{code:rewardCode}});assert.equal(consume.status,200);assert.equal(consume.data.data.status,'redeemed');
  const consumeAgain=await call('/api/merchant/reward-claims/redeem',{cookie:merchantCookie,method:'POST',body:{code:rewardCode}});assert.equal(consumeAgain.status,404,'reward codes cannot be reused');
  const claims=await call('/api/merchant/reward-claims',{cookie:merchantCookie});assert.equal(claims.status,200);assert.equal(claims.data.data.length,2);assert.ok(!JSON.stringify(claims.data).includes(rewardCode),'claim lists never reveal full private codes');
  const draftCampaign=await call('/api/merchant/reward-campaigns',{cookie:merchantCookie,method:'POST',body:{...campaignBody,requestId:'reward-campaign-draft-extra-01',title:'Offre en brouillon',authorizationReference:'',authorizationConfirmed:false}});assert.equal(draftCampaign.status,201);assert.equal(draftCampaign.data.data.authorizationStatus,'not_submitted');
  const incompleteAuthorization=await call(`/api/merchant/reward-campaigns/${draftCampaign.data.data.id}/authorization`,{cookie:merchantCookie,method:'POST',body:{authorizationReference:'ARJH-2026-DRAFT-002',authorizationConfirmed:false}});assert.equal(incompleteAuthorization.status,400);
  const submittedAuthorization=await call(`/api/merchant/reward-campaigns/${draftCampaign.data.data.id}/authorization`,{cookie:merchantCookie,method:'POST',body:{authorizationReference:'ARJH-2026-DRAFT-002',authorizationConfirmed:true}});assert.equal(submittedAuthorization.status,200);assert.equal(submittedAuthorization.data.data.authorizationStatus,'pending');
  const authorizationQueueWithDraft=await call('/api/admin/reward-authorizations',{cookie:ceo.cookie});assert.equal(authorizationQueueWithDraft.data.data.length,2);
  const rejectedDraft=await call(`/api/admin/reward-authorizations/${draftCampaign.data.data.id}/decision`,{cookie:ceo.cookie,method:'POST',body:{decision:'rejected',reviewNote:'La référence fournie ne peut pas être vérifiée.'}});assert.equal(rejectedDraft.status,200);assert.equal(rejectedDraft.data.data.authorizationStatus,'rejected');
  const resubmittedAuthorization=await call(`/api/merchant/reward-campaigns/${draftCampaign.data.data.id}/authorization`,{cookie:merchantCookie,method:'POST',body:{authorizationReference:'ARJH-2026-DRAFT-003',authorizationConfirmed:true}});assert.equal(resubmittedAuthorization.status,200);assert.equal(resubmittedAuthorization.data.data.authorizationStatus,'pending');
  const attemptToReplaceApproved=await call(`/api/merchant/reward-campaigns/${campaign.data.data.id}/authorization`,{cookie:merchantCookie,method:'POST',body:{authorizationReference:'ARJH-REPLACE-001',authorizationConfirmed:true}});assert.equal(attemptToReplaceApproved.status,400);

  const giftBody={requestId:'gift-card-create-request-extra-0001',amountXof:1200};
  const gift=await call('/api/merchant/gift-cards',{cookie:merchantCookie,method:'POST',body:giftBody});assert.equal(gift.status,201,JSON.stringify(gift.data));assert.equal(gift.data.data.status,'pending');assert.ok(gift.data.code);
  const giftRetry=await call('/api/merchant/gift-cards',{cookie:merchantCookie,method:'POST',body:giftBody});assert.equal(giftRetry.status,200);assert.equal(giftRetry.data.code,gift.data.code);assert.equal(giftRetry.data.data.id,gift.data.data.id);
  const giftConflict=await call('/api/merchant/gift-cards',{cookie:merchantCookie,method:'POST',body:{...giftBody,amountXof:2500}});assert.equal(giftConflict.status,409);
  const giftList=await call('/api/merchant/gift-cards',{cookie:merchantCookie});assert.equal(giftList.status,200);assert.ok(!JSON.stringify(giftList.data).includes(gift.data.code),'gift-card lists reveal only a code suffix, not the bearer secret');
  const publicBefore=await call('/api/public/shops/boutique-recompenses/gift-cards/check',{method:'POST',body:{code:gift.data.code}});assert.equal(publicBefore.status,200);assert.equal(publicBefore.data.data.valid,false,'a pending card is not spendable');
  const activation=await call(`/api/merchant/gift-cards/${encodeURIComponent(gift.data.data.id)}/activate`,{cookie:merchantCookie,method:'POST',body:{confirmOfflinePayment:true}});assert.equal(activation.status,200);assert.equal(activation.data.data.status,'active');
  const publicAfter=await call('/api/public/shops/boutique-recompenses/gift-cards/check',{method:'POST',body:{code:gift.data.code}});assert.equal(publicAfter.data.data.valid,true);assert.equal(publicAfter.data.data.balanceXof,1200);
  const debitBody={code:gift.data.code,amountXof:500,requestId:'gift-card-debit-request-extra-0001'};
  const debit=await call('/api/merchant/gift-cards/redeem',{cookie:merchantCookie,method:'POST',body:debitBody});assert.equal(debit.status,200,JSON.stringify(debit.data));assert.equal(debit.data.data.card.balanceXof,700);
  const debitRetry=await call('/api/merchant/gift-cards/redeem',{cookie:merchantCookie,method:'POST',body:debitBody});assert.equal(debitRetry.status,200);assert.equal(debitRetry.data.data.idempotent,true);assert.equal(debitRetry.data.data.card.balanceXof,700,'a retry does not debit the balance twice');
  const overdraw=await call('/api/merchant/gift-cards/redeem',{cookie:merchantCookie,method:'POST',body:{code:gift.data.code,amountXof:701,requestId:'gift-card-debit-request-extra-0002'}});assert.equal(overdraw.status,409);
  const finalDebit=await call('/api/merchant/gift-cards/redeem',{cookie:merchantCookie,method:'POST',body:{code:gift.data.code,amountXof:700,requestId:'gift-card-debit-request-extra-0003'}});assert.equal(finalDebit.status,200);assert.equal(finalDebit.data.data.card.status,'redeemed');
  const noBalance=await call('/api/merchant/gift-cards/redeem',{cookie:merchantCookie,method:'POST',body:{code:gift.data.code,amountXof:1,requestId:'gift-card-debit-request-extra-0004'}});assert.equal(noBalance.status,409);

  const storeState=JSON.parse(await fs.readFile(path.join(tempDir,'store.json'),'utf8'));
  assert.ok(!JSON.stringify(storeState).includes(gift.data.code),'gift-card codes are encrypted at rest, not stored as cleartext');
  assert.ok(!JSON.stringify(storeState).includes(rewardCode),'reward claim codes are encrypted at rest, not stored as cleartext');
  const audit=await call(`/api/admin/merchants/${merchant.id}/audit`,{cookie:ceo.cookie});assert.equal(audit.status,200);
  assert.ok(audit.data.data.some((row)=>row.action==='gift_card_activated'));
  assert.ok(audit.data.data.some((row)=>row.action==='reward_code_redeemed'));
  assert.ok(audit.data.data.some((row)=>row.action==='reward_authorization_approved'),'the CEO approval is present in the audit log');
  const revoked=await call(`/api/admin/reward-authorizations/${campaign.data.data.id}/decision`,{cookie:ceo.cookie,method:'POST',body:{decision:'revoked',reviewNote:'Autorisation suspendue après vérification.'}});assert.equal(revoked.status,200);assert.equal(revoked.data.data.status,'paused');
  const publicAfterRevocation=await call('/api/public/shops/boutique-recompenses');assert.equal(publicAfterRevocation.data.data.rewardCampaigns.length,0,'revocation pauses and hides the campaign immediately');

});
