'use strict';

const crypto=require('node:crypto');
const {categoriesOf,text,err}=require('./supplier-commerce');
const COOKIE='qria_supplier';const ADMIN_COOKIE='qria_admin';const MANAGER_COOKIE='qria_manager';const MERCHANT_COOKIE='qria_merchant';const TTL=8*60*60;
const attempts=new Map();
function hashPassword(password){const salt=crypto.randomBytes(16);return `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(password,salt,64).toString('base64url')}`;}
const DUMMY_SALT=Buffer.from('oymike-supplier-login-dummy-salt');
function checkPassword(password,stored){const [algorithm,saltText,digestText]=String(stored||'').split('$');if(algorithm!=='scrypt'||!saltText||!digestText){crypto.scryptSync(String(password),DUMMY_SALT,64);return false;}try{const expected=Buffer.from(digestText,'base64url');const actual=crypto.scryptSync(String(password),Buffer.from(saltText,'base64url'),expected.length||64);return actual.length===expected.length&&crypto.timingSafeEqual(actual,expected);}catch(_){return false;}}
function readCookie(req,name){for(const part of String(req.headers.cookie||'').split(';')){const i=part.indexOf('=');if(i<0||part.slice(0,i).trim()!==name)continue;try{return decodeURIComponent(part.slice(i+1).trim());}catch(_){return '';}}return '';}
function safeSupplierView(row){if(!row)return null;const {passwordHash,tokenVersion,passwordResetTokenHash,...safe}=row;return safe;}
function sameOrigin(req){const origin=req.get('origin');if(!origin)return true;try{return new URL(origin).host===(req.get('x-forwarded-host')||req.get('host'));}catch(_){return false;}}
function allow(map,key,limit,windowMs){const now=Date.now();let item=map.get(key);if(item&&now-item.start<windowMs){if(item.count>=limit)return false;item.count++;}else map.set(key,{start:now,count:1});if(map.size>5000)for(const [k,v] of map)if(now-v.start>=windowMs)map.delete(k);return true;}
function phoneValid(value){const raw=text(value,32);return raw.replace(/\D/g,'').length>=7?raw:'';}
function emailValid(value){const email=text(value,254).toLowerCase();return !email||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)?email:'';}
function supplierProfileInput(input){
  const companyName=text(input?.companyName,140).replace(/[\t\n\r ]+/gu,' ');const contactName=text(input?.contactName,120).replace(/[\t\n\r ]+/gu,' ');
  const email=emailValid(input?.email);if(input?.email&&!email)throw new Error('L’adresse e-mail n’est pas valide.');
  const phone=phoneValid(input?.phone);if(input?.phone&&!phone)throw new Error('Le téléphone n’est pas valide.');
  const categories=categoriesOf(input?.categories);if(!categories.length)throw new Error('Indiquez au moins une catégorie d’approvisionnement.');
  if(companyName.length<2)throw new Error('Le nom de l’entreprise doit contenir au moins 2 caractères.');
  return {companyName,contactName,email,phone,address:text(input?.address,300),bio:text(input?.bio,1200),categories,publicContact:input?.publicContact===true};
}
function productInput(input){
  const name=text(input?.name,140).replace(/[\t\n\r ]+/gu,' ');const category=text(input?.category,60);const unit=text(input?.unit||'unité',30);
  const priceXof=Number(input?.priceXof);const stockQuantity=Number(input?.stockQuantity);const minimumOrderQuantity=Number(input?.minimumOrderQuantity??1);const status=text(input?.status||'active',20);
  if(name.length<2||!category)throw new Error('Saisissez le nom et la catégorie du produit.');
  if(!Number.isSafeInteger(priceXof)||priceXof<1||priceXof>2_000_000_000)throw new Error('Le prix doit être un montant entier positif en XOF.');
  if(!Number.isSafeInteger(stockQuantity)||stockQuantity<0||stockQuantity>100_000_000)throw new Error('Le stock doit être un entier positif ou nul.');
  if(!Number.isSafeInteger(minimumOrderQuantity)||minimumOrderQuantity<1||minimumOrderQuantity>100_000_000)throw new Error('La quantité minimale doit être un entier positif.');
  if(!['active','unavailable'].includes(status))throw new Error('État de produit invalide.');
  return {name,description:text(input?.description,1000),sku:text(input?.sku,60),category,unit,priceXof,stockQuantity,minimumOrderQuantity,status};
}
function orderRequestInput(input){
  const title=text(input?.title,140).replace(/[\t\n\r ]+/gu,' ');const category=text(input?.category,60).replace(/[\t\n\r ]+/gu,' ');
  if(title.length<3||!category)throw new Error('Saisissez le titre et la catégorie de la demande.');
  const items=Array.isArray(input?.items)?input.items.slice(0,30).map((row)=>({name:text(row?.name,140),quantity:Number(row?.quantity),unit:text(row?.unit||'unité',30)})):[];
  if(!items.length||items.some((row)=>row.name.length<2||!Number.isSafeInteger(row.quantity)||row.quantity<1||row.quantity>100_000_000))throw new Error('Ajoutez au moins un article avec une quantité valide.');
  let wantedBy=null;if(input?.wantedBy){const time=Date.parse(input.wantedBy);if(!Number.isFinite(time)||time<Date.now()-86400000||time>Date.now()+366*86400000)throw new Error('La date souhaitée est invalide.');wantedBy=new Date(time).toISOString();}
  const targetSupplierId=text(input?.targetSupplierId,100);
  return {title,category,details:text(input?.details,2000),items,deliveryAddress:text(input?.deliveryAddress,500),wantedBy,targetSupplierId};
}
function mapError(res,error,fallback='Impossible de traiter la demande fournisseur.'){
  if(error.message&&!error.code)return res.status(400).json({error:error.message});
  const codes={DUPLICATE:409,REQUEST_CLOSED:409,QUOTE_CLOSED:409,STOCK_UNAVAILABLE:409,ORDER_TRANSITION:409,FORBIDDEN:403,NOT_FOUND:404};
  if(codes[error.code])return res.status(codes[error.code]).json({error:error.message,code:error.code});
  return res.status(500).json({error:fallback});
}

module.exports=function registerSupplierRoutes(deps){
  const {app,store,commerce,suppliers,requireAdmin,requireMerchant,checkSameOrigin,apiError,sessionSecret,isProduction,
    setSupplierSession,clearSupplierSession,clearAdminSession,clearManagerSession,clearMerchantSession,publicBaseUrl}=deps;
  const sign=(payload)=>crypto.createHmac('sha256',sessionSecret).update(payload).digest('base64url');
  function clearAll(res){clearSupplierSession(res);clearAdminSession(res);clearManagerSession(res);clearMerchantSession(res);}
  function readSession(req){const token=readCookie(req,COOKIE);const i=token.lastIndexOf('.');if(i<1)return null;const payload=token.slice(0,i),signature=token.slice(i+1);const expected=sign(payload);const left=Buffer.from(signature),right=Buffer.from(expected);if(left.length!==right.length||!crypto.timingSafeEqual(left,right))return null;try{const data=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));return data.role==='supplier'&&data.supplierId&&Number(data.exp)>Date.now()?data:null;}catch(_){return null;}}
  async function requireSupplier(req,res,next){
    const roles=[COOKIE,ADMIN_COOKIE,MANAGER_COOKIE,MERCHANT_COOKIE].map((name)=>readCookie(req,name)).filter(Boolean);
    if(roles.length>1){clearAll(res);return res.status(401).json({error:'Sessions de rôles différentes détectées. Reconnectez-vous.'});}
    const session=readSession(req);if(!session)return res.status(401).json({error:'Session fournisseur expirée. Reconnectez-vous.'});
    const supplier=await suppliers.getSupplierById(session.supplierId,{includeSecrets:true}).catch(()=>null);
    if(!supplier||Number(supplier.tokenVersion)!==Number(session.ver)){clearSupplierSession(res);return res.status(401).json({error:'Le compte fournisseur ou cette session n’est plus valide. Reconnectez-vous.'});}
    req.supplier=supplier;
    if(!['GET','HEAD','OPTIONS'].includes(req.method)&&!sameOrigin(req))return res.status(403).json({error:'Origine de requête non autorisée.'});
    return next();
  }
  function requireApprovedSupplier(req,res,next){if(req.supplier?.status!=='active')return res.status(403).json({error:req.supplier?.status==='pending'?'Compte en attente de l’approbation du PDG.':'Compte fournisseur non actif.',code:'SUPPLIER_APPROVAL_REQUIRED'});return next();}
  const audit=async(actorType,actorId,supplierId,action,summary,entityId='',metadata={})=>{const merchantActor=actorType==='merchant';const actor=actorType==='admin'?`PDG (@${String(process.env.ADMIN_USERNAME||'admin')})`:merchantActor?`Marchand (${actorId})`:`Fournisseur (${actorId})`;const ownerMetadata=merchantActor?{merchantId:actorId}:{supplierId:supplierId||actorId};return store.addAudit({actor,actorType,actorId,action,entityType:merchantActor?'merchant':'supplier',entityId:entityId||supplierId,summary,metadata:{...ownerMetadata,...metadata}}).catch(()=>{});};
  const approved=(res,supplier)=>supplier.status==='active'?true:(res.status(403).json({error:supplier.status==='pending'?'Compte en attente de l’approbation du PDG.':'Compte fournisseur non actif.',code:'SUPPLIER_APPROVAL_REQUIRED'}),false);

  app.post('/api/supplier/register',checkSameOrigin,async(req,res)=>{
    const ip=req.ip||'unknown';if(!allow(attempts,`register:${ip}`,4,10*60_000))return res.status(429).json({error:'Trop de créations de comptes; réessayez dans dix minutes.'});
    try{
      const username=text(req.body?.username,80).toLowerCase();const password=String(req.body?.password||'');
      if(!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(username))throw new Error('L’identifiant doit contenir 3 à 80 caractères (lettres, chiffres, point, tiret ou soulignement).');
      if(password.length<12||password.length>128)throw new Error('Le mot de passe doit contenir entre 12 et 128 caractères.');
      const profile=supplierProfileInput(req.body);if(!profile.email&&!profile.phone)throw new Error('Un e-mail ou un téléphone professionnel est requis pour le suivi du compte.');
      const supplier=await suppliers.registerSupplier({...profile,username,passwordHash:hashPassword(password)});
      setSupplierSession(res,{...supplier,tokenVersion:1});await audit('supplier',supplier.id,supplier.id,'supplier_registered','Demande de compte fournisseur soumise pour examen du PDG.',supplier.id);
      res.status(201).json({data:supplier,message:'Demande enregistrée. Le compte reste en attente de l’approbation du PDG.'});
    }catch(error){if(error.code==='DUPLICATE')return res.status(409).json({error:error.message});if(error.message&&!error.code)return res.status(400).json({error:error.message});return apiError(res,error,'Impossible de créer la demande fournisseur.');}
  });
  app.post('/api/supplier/auth/login',checkSameOrigin,async(req,res)=>{
    const ip=req.ip||'unknown';const username=text(req.body?.username,80).toLowerCase();if(!allow(attempts,`login:${ip}:${username}`,8,10*60_000))return res.status(429).json({error:'Trop de tentatives. Réessayez dans dix minutes.'});
    const supplier=await suppliers.getSupplierByUsername(username).catch(()=>null);const valid=checkPassword(String(req.body?.password||''),supplier?.passwordHash);
    if(!supplier||!valid)return res.status(401).json({error:'Identifiant ou mot de passe incorrect.'});
    if(supplier.status==='suspended'||supplier.status==='rejected')return res.status(403).json({error:supplier.status==='rejected'?'Demande fournisseur refusée. Consultez le motif ou contactez le PDG.':'Compte fournisseur suspendu. Consultez le motif ou contactez le PDG.',status:supplier.status,statusReason:supplier.statusReason||''});
    const updated=await suppliers.markSupplierLogin(supplier.id);setSupplierSession(res,supplier);await audit('supplier',supplier.id,supplier.id,'supplier_login','Connexion fournisseur réussie.',supplier.id);
    res.json({data:safeSupplierView(updated||supplier)});
  });
  app.get('/api/supplier/auth/me',requireSupplier,async(req,res)=>res.setHeader('Cache-Control','no-store').json({data:safeSupplierView(req.supplier)}));
  app.post('/api/supplier/auth/logout',requireSupplier,async(req,res)=>{await audit('supplier',req.supplier.id,req.supplier.id,'supplier_logout','Déconnexion fournisseur.',req.supplier.id);clearSupplierSession(res);res.json({ok:true});});
  app.get('/api/supplier/profile',requireSupplier,async(req,res)=>res.json({data:safeSupplierView(req.supplier)}));
  app.put('/api/supplier/profile',requireSupplier,async(req,res)=>{
    if(!['active','pending'].includes(req.supplier.status))return res.status(403).json({error:'Le profil de ce compte n’est pas modifiable dans son état actuel.'});
    try{const profile=supplierProfileInput(req.body);const before=safeSupplierView(req.supplier);const row=await suppliers.updateSupplierProfile(req.supplier.id,profile);await audit('supplier',req.supplier.id,req.supplier.id,'supplier_profile_updated','Profil professionnel fournisseur modifié.',req.supplier.id,{before:{companyName:before.companyName,categories:before.categories},after:{companyName:row.companyName,categories:row.categories}});res.json({data:row});}
    catch(error){if(error.message&&!error.code)return res.status(400).json({error:error.message});return apiError(res,error,'Impossible d’enregistrer le profil fournisseur.');}
  });
  app.get('/api/supplier/products',requireSupplier,requireApprovedSupplier,async(req,res)=>res.json({data:await suppliers.listSupplierProducts(req.supplier.id)}));
  app.post('/api/supplier/products',requireSupplier,requireApprovedSupplier,async(req,res)=>{
    try{const row=await suppliers.saveSupplierProduct(req.supplier.id,productInput(req.body));await audit('supplier',req.supplier.id,req.supplier.id,'supplier_product_created',`Produit fournisseur « ${row.name} » créé.`,row.id,{productId:row.id,priceXof:row.priceXof,stockQuantity:row.stockQuantity});res.status(201).json({data:row});}
    catch(error){return mapError(res,error,'Impossible d’enregistrer le produit fournisseur.');}
  });
  app.put('/api/supplier/products/:productId',requireSupplier,requireApprovedSupplier,async(req,res)=>{
    try{const before=(await suppliers.listSupplierProducts(req.supplier.id)).find((row)=>row.id===req.params.productId);if(!before)return res.status(404).json({error:'Produit fournisseur introuvable.'});const row=await suppliers.saveSupplierProduct(req.supplier.id,productInput(req.body),req.params.productId);if(!row)return res.status(404).json({error:'Produit fournisseur introuvable.'});await audit('supplier',req.supplier.id,req.supplier.id,'supplier_product_updated',`Produit fournisseur « ${row.name} » modifié.`,row.id,{before:{priceXof:before.priceXof,stockQuantity:before.stockQuantity,status:before.status},after:{priceXof:row.priceXof,stockQuantity:row.stockQuantity,status:row.status}});res.json({data:row});}
    catch(error){return mapError(res,error,'Impossible de modifier le produit fournisseur.');}
  });
  app.delete('/api/supplier/products/:productId',requireSupplier,requireApprovedSupplier,async(req,res)=>{const row=await suppliers.archiveSupplierProduct(req.supplier.id,req.params.productId);if(!row)return res.status(404).json({error:'Produit fournisseur introuvable.'});await audit('supplier',req.supplier.id,req.supplier.id,'supplier_product_archived',`Produit fournisseur « ${row.name} » archivé.`,row.id);res.json({data:row});});
  app.get('/api/supplier/sourcing-requests',requireSupplier,requireApprovedSupplier,async(req,res)=>res.json({data:await suppliers.listSupplierRequests(req.supplier.id)}));
  app.get('/api/supplier/quotes',requireSupplier,requireApprovedSupplier,async(req,res)=>res.json({data:await suppliers.listSupplierQuotes(req.supplier.id)}));
  app.post('/api/supplier/sourcing-requests/:requestId/quotes',requireSupplier,requireApprovedSupplier,async(req,res)=>{
    try{const lines=Array.isArray(req.body?.items)?req.body.items.slice(0,50).map((line)=>({productId:text(line?.productId,100),quantity:Number(line?.quantity)})):[];if(!lines.length||lines.some((line)=>!line.productId||!Number.isSafeInteger(line.quantity)||line.quantity<1))throw new Error('Sélectionnez au moins un produit de votre catalogue et une quantité positive.');if(new Set(lines.map((line)=>line.productId)).size!==lines.length)throw new Error('Un produit ne peut apparaître qu’une fois dans le devis.');
      let validUntil=null;if(req.body?.validUntil){const stamp=Date.parse(req.body.validUntil);if(!Number.isFinite(stamp)||stamp<=Date.now()||stamp>Date.now()+90*86400000)throw new Error('La date de validité du devis est invalide.');validUntil=new Date(stamp).toISOString();}
      const quote=await suppliers.createSupplierQuote(req.supplier.id,req.params.requestId,{items:lines,notes:text(req.body?.notes,1000),validUntil});await audit('supplier',req.supplier.id,req.supplier.id,'supplier_quote_sent',`Devis de ${quote.totalXof.toLocaleString('fr-FR')} XOF envoyé pour la demande ${quote.requestId}.`,quote.id,{requestId:quote.requestId,totalXof:quote.totalXof});res.status(201).json({data:quote});}
    catch(error){return mapError(res,error,'Impossible d’envoyer ce devis.');}
  });
  app.get('/api/supplier/orders',requireSupplier,requireApprovedSupplier,async(req,res)=>res.json({data:await suppliers.listOrders({supplierId:req.supplier.id})}));
  app.post('/api/supplier/orders/:orderId/status',requireSupplier,requireApprovedSupplier,async(req,res)=>{
    const status=text(req.body?.status,30);try{const row=await suppliers.transitionSupplyOrder({actorType:'supplier',actorId:req.supplier.id,orderId:req.params.orderId,status,note:text(req.body?.note,500),trackingReference:text(req.body?.trackingReference,120)});await audit('supplier',req.supplier.id,req.supplier.id,'supplier_order_status',`Approvisionnement ${row.reference} : statut ${status}.`,row.id,{status,reference:row.reference});res.json({data:row});}catch(error){return mapError(res,error,'Impossible de mettre à jour cette commande d’approvisionnement.');}
  });
  app.get('/api/supplier/orders/:orderId/messages',requireSupplier,requireApprovedSupplier,async(req,res)=>{try{res.json({data:await suppliers.listOrderMessages(req.params.orderId,{actorType:'supplier',actorId:req.supplier.id})});}catch(error){return mapError(res,error,'Impossible de charger les échanges.');}});
  app.post('/api/supplier/orders/:orderId/messages',requireSupplier,requireApprovedSupplier,async(req,res)=>{try{const row=await suppliers.createOrderMessage(req.params.orderId,{actorType:'supplier',actorId:req.supplier.id,body:req.body?.body});await audit('supplier',req.supplier.id,req.supplier.id,'supply_message_sent',`Message envoyé pour la commande ${row.orderId}.`,row.id,{orderId:row.orderId});res.status(201).json({data:row});}catch(error){return mapError(res,error,'Impossible d’envoyer le message.');}});
  app.get('/api/supplier/notifications',requireSupplier,async(req,res)=>res.json({data:await suppliers.listNotifications('supplier',req.supplier.id)}));
  app.post('/api/supplier/notifications/:notificationId/read',requireSupplier,async(req,res)=>{if(!await suppliers.markNotificationRead('supplier',req.supplier.id,req.params.notificationId))return res.status(404).json({error:'Notification introuvable.'});res.json({ok:true});});
  app.get('/api/supplier/qr',requireSupplier,async(req,res)=>{const code=req.supplier.publicCode;const path=`/v/${encodeURIComponent(code)}`;res.json({data:{publicCode:code,path,url:`${publicBaseUrl||`${req.protocol}://${req.get('host')}`}${path}`}});});

  app.get('/api/admin/suppliers',requireAdmin,async(req,res)=>{try{const status=['pending','active','suspended','rejected'].includes(text(req.query.status,20))?text(req.query.status,20):'';res.setHeader('Cache-Control','no-store');res.json({data:await suppliers.listAdminSuppliers({status})});}catch(error){apiError(res,error,'Impossible de charger les fournisseurs.');}});
  app.get('/api/admin/supply-orders',requireAdmin,async(_req,res)=>{try{res.setHeader('Cache-Control','no-store');res.json({data:await suppliers.listOrders()});}catch(error){apiError(res,error,'Impossible de charger la supervision des approvisionnements.');}});
  app.post('/api/admin/suppliers/:supplierId/decision',requireAdmin,async(req,res)=>{
    const before=await suppliers.getSupplierById(req.params.supplierId);if(!before)return res.status(404).json({error:'Fournisseur introuvable.'});const decision=text(req.body?.decision,20);const reason=text(req.body?.reason,500);if(reason.length<4)return res.status(400).json({error:'Ajoutez une note de revue (au moins 4 caractères).'});
    const status=({approved:'active',rejected:'rejected',suspended:'suspended',reactivated:'active'})[decision];if(!status)return res.status(400).json({error:'Choisissez approuver, refuser, suspendre ou réactiver.'});
    try{const row=await suppliers.decideSupplier(req.params.supplierId,status,reason,String(process.env.ADMIN_USERNAME||'admin'));if(!row)return res.status(404).json({error:'Fournisseur introuvable.'});await store.addAudit({actor:`PDG (@${String(process.env.ADMIN_USERNAME||'admin')})`,actorType:'admin',actorId:String(process.env.ADMIN_USERNAME||'admin'),action:`supplier_${decision}`,entityType:'supplier',entityId:row.id,summary:`Décision PDG « ${decision} » pour le fournisseur « ${row.companyName} ».`,beforeData:{status:before.status},afterData:{status:row.status,statusReason:row.statusReason,reviewedAt:row.reviewedAt},metadata:{supplierId:row.id,decision}}).catch(()=>{});await suppliers.createNotification('supplier',row.id,'supplier_account_review','Mise à jour de votre compte fournisseur',`${row.status==='active'?'Compte approuvé.':row.status==='rejected'?'Demande refusée.':'Compte suspendu.'} ${row.statusReason}`,'supplier',row.id);res.json({data:row});}
    catch(error){return mapError(res,error,'Impossible d’enregistrer la décision fournisseur.');}
  });

  app.get('/api/public/suppliers/:code',async(req,res)=>{const code=text(req.params.code,100);const row=await suppliers.getPublicSupplierByCode(code);if(!row)return res.status(404).json({error:'Profil fournisseur indisponible.'});res.setHeader('Cache-Control','no-store');res.json({data:row});});
  app.get('/api/merchant/sourcing/suppliers',requireMerchant,async(req,res)=>{const data=await suppliers.listSupplierDirectory({search:text(req.query.search,100),category:text(req.query.category,60),limit:req.query.limit});res.setHeader('Cache-Control','no-store');res.json({data});});
  app.get('/api/merchant/sourcing/requests',requireMerchant,async(req,res)=>res.json({data:await suppliers.listMerchantRequests(req.merchant.id)}));
  app.post('/api/merchant/sourcing/requests',requireMerchant,async(req,res)=>{
    try{const storeRow=await commerce.getStoreByMerchantId(req.merchant.id);if(!storeRow||storeRow.status!=='active')return res.status(409).json({error:'Configurez d’abord une boutique active.'});const input=orderRequestInput(req.body);if(input.targetSupplierId){const target=await suppliers.getSupplierById(input.targetSupplierId);if(!target||target.status!=='active')return res.status(404).json({error:'Le fournisseur choisi n’est pas disponible.'});}
      const row=await suppliers.createSourcingRequest({...input,buyerMerchantId:req.merchant.id,storeId:storeRow.id,storeName:storeRow.name});await audit('merchant',req.merchant.id,req.merchant.id,'sourcing_request_created',`Demande d’approvisionnement ${row.reference} créée.`,row.id,{storeId:storeRow.id,category:row.category,targetSupplierId:row.targetSupplierId||''});res.status(201).json({data:row});}
    catch(error){return mapError(res,error,'Impossible de créer la demande d’approvisionnement.');}
  });
  app.post('/api/merchant/sourcing/quotes/:quoteId/accept',requireMerchant,async(req,res)=>{
    try{const row=await suppliers.acceptSupplierQuote(req.merchant.id,req.params.quoteId);await audit('merchant',req.merchant.id,req.merchant.id,'supply_quote_accepted',`Devis accepté; commande d’approvisionnement ${row.reference} créée sans paiement intégré.`,row.id,{requestId:row.requestId,quoteId:row.quoteId,totalXof:row.totalXof});res.status(201).json({data:row});}
    catch(error){return mapError(res,error,'Impossible d’accepter ce devis.');}
  });
  app.get('/api/merchant/sourcing/orders',requireMerchant,async(req,res)=>res.json({data:await suppliers.listOrders({merchantId:req.merchant.id})}));
  app.post('/api/merchant/sourcing/orders/:orderId/status',requireMerchant,async(req,res)=>{
    try{const status=text(req.body?.status,30);const row=await suppliers.transitionSupplyOrder({actorType:'merchant',actorId:req.merchant.id,orderId:req.params.orderId,status,note:text(req.body?.note,500)});await audit('merchant',req.merchant.id,req.merchant.id,'supply_order_status',`Approvisionnement ${row.reference} : statut ${status}.`,row.id,{status,reference:row.reference});res.json({data:row});}
    catch(error){return mapError(res,error,'Impossible de mettre à jour cet approvisionnement.');}
  });
  app.get('/api/merchant/sourcing/orders/:orderId/messages',requireMerchant,async(req,res)=>{try{res.json({data:await suppliers.listOrderMessages(req.params.orderId,{actorType:'merchant',actorId:req.merchant.id})});}catch(error){return mapError(res,error,'Impossible de charger les échanges.');}});
  app.post('/api/merchant/sourcing/orders/:orderId/messages',requireMerchant,async(req,res)=>{try{const row=await suppliers.createOrderMessage(req.params.orderId,{actorType:'merchant',actorId:req.merchant.id,body:req.body?.body});await audit('merchant',req.merchant.id,req.merchant.id,'supply_message_sent',`Message envoyé pour la commande ${row.orderId}.`,row.id,{orderId:row.orderId});res.status(201).json({data:row});}catch(error){return mapError(res,error,'Impossible d’envoyer le message.');}});
  app.get('/api/merchant/sourcing/notifications',requireMerchant,async(req,res)=>res.json({data:await suppliers.listNotifications('merchant',req.merchant.id)}));
  app.post('/api/merchant/sourcing/notifications/:notificationId/read',requireMerchant,async(req,res)=>{if(!await suppliers.markNotificationRead('merchant',req.merchant.id,req.params.notificationId))return res.status(404).json({error:'Notification introuvable.'});res.json({ok:true});});
};
