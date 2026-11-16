'use strict';

const crypto = require('node:crypto');
const clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
const text = (value, max = 500) => String(value == null ? '' : value).trim().slice(0, max);
const err = (message, code = '') => Object.assign(new Error(message), code ? { code } : {});
const uid = () => crypto.randomUUID();
const ref = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('base64url').toUpperCase()}`;
const categoriesOf = (value) => [...new Set((Array.isArray(value) ? value : []).map((item) => text(item, 60).replace(/\s+/g, ' ')).filter(Boolean))].slice(0, 20);
const safeSupplier = (row) => row && ({
  id: row.id, username: row.username, companyName: row.companyName ?? row.company_name ?? '',
  contactName: row.contactName ?? row.contact_name ?? '', email: row.email || '', phone: row.phone || '',
  address: row.address || '', bio: row.bio || '', categories: categoriesOf(row.categories),
  publicContact: Boolean(row.publicContact ?? row.public_contact), status: row.status,
  statusReason: row.statusReason ?? row.status_reason ?? '', publicCode: row.publicCode ?? row.public_code ?? '',
  createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at,
  reviewedAt: row.reviewedAt ?? row.reviewed_at ?? null, reviewedBy: row.reviewedBy ?? row.reviewed_by ?? '',
  lastLoginAt: row.lastLoginAt ?? row.last_login_at ?? null,
});
const safeProduct = (row) => row && ({
  id: row.id, supplierId: row.supplierId ?? row.supplier_id, name: row.name,
  description: row.description || '', sku: row.sku || '', category: row.category || '', unit: row.unit || 'unité',
  priceXof: Number(row.priceXof ?? row.price_xof) || 0, stockQuantity: Number(row.stockQuantity ?? row.stock_quantity) || 0,
  minimumOrderQuantity: Number(row.minimumOrderQuantity ?? row.minimum_order_quantity) || 1,
  status: row.status, createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at,
});
const safeRequest = (row) => row && ({
  id: row.id, reference: row.reference, buyerMerchantId: row.buyerMerchantId ?? row.buyer_merchant_id,
  storeId: row.storeId ?? row.store_id, storeName: row.storeName ?? row.store_name ?? '',
  targetSupplierId: row.targetSupplierId ?? row.target_supplier_id ?? '', title: row.title,
  details: row.details || '', category: row.category || '', items: clone(row.items || []),
  deliveryAddress: row.deliveryAddress ?? row.delivery_address ?? '', wantedBy: row.wantedBy ?? row.wanted_by ?? null,
  status: row.status, createdAt: row.createdAt ?? row.created_at,
});
const safeQuote = (row) => row && ({
  id: row.id, requestId: row.requestId ?? row.request_id, supplierId: row.supplierId ?? row.supplier_id,
  supplierName: row.supplierName ?? row.supplier_name ?? '', items: clone(row.items || []),
  totalXof: Number(row.totalXof ?? row.total_xof) || 0, notes: row.notes || '',
  validUntil: row.validUntil ?? row.valid_until ?? null, status: row.status,
  createdAt: row.createdAt ?? row.created_at,
});
const safeOrder = (row) => row && ({
  id: row.id, reference: row.reference ?? row.order_reference, requestId: row.requestId ?? row.request_id,
  quoteId: row.quoteId ?? row.quote_id, buyerMerchantId: row.buyerMerchantId ?? row.buyer_merchant_id,
  supplierId: row.supplierId ?? row.supplier_id, storeName: row.storeName ?? row.store_name ?? '',
  supplierName: row.supplierName ?? row.supplier_name ?? '', items: clone(row.items || []),
  totalXof: Number(row.totalXof ?? row.total_xof) || 0,
  deliveryAddress: row.deliveryAddress ?? row.delivery_address ?? '', trackingReference: row.trackingReference ?? row.tracking_reference ?? '',
  status: row.status, createdAt: row.createdAt ?? row.created_at, updatedAt: row.updatedAt ?? row.updated_at,
  events: clone(row.events || []),
});

class SupplierCommerceStore {
  constructor(base, commerce) { this.base = base; this.commerce = commerce; this.pg = Boolean(base.pool); }
  async init() {
    if (this.pg) return;
    const state = this.base.state;
    let changed = false;
    for (const [key, value] of Object.entries({
      supplierAccounts: [], supplierProducts: [], sourcingRequests: [], supplierQuotes: [], supplyOrders: [],
      supplyOrderEvents: [], supplyNotifications: [], supplyOrderMessages: [],
    })) if (!Array.isArray(state[key])) { state[key] = value; changed = true; }
    if (changed) await this.base.save();
  }
  _lock(work) { return this.commerce?.withJsonLock ? this.commerce.withJsonLock(work) : Promise.resolve().then(work); }
  _supplierFields(alias = '') {
    const p = alias ? `${alias}.` : '';
    return `${p}id,${p}username,${p}company_name AS "companyName",${p}contact_name AS "contactName",${p}email,${p}phone,${p}address,${p}bio,${p}categories,${p}public_contact AS "publicContact",${p}status,${p}status_reason AS "statusReason",${p}public_code AS "publicCode",${p}token_version AS "tokenVersion",${p}created_at AS "createdAt",${p}updated_at AS "updatedAt",${p}reviewed_at AS "reviewedAt",${p}reviewed_by AS "reviewedBy",${p}last_login_at AS "lastLoginAt"`;
  }
  _productFields(alias = '') {
    const p = alias ? `${alias}.` : '';
    return `${p}id,${p}supplier_id AS "supplierId",${p}name,${p}description,${p}sku,${p}category,${p}unit,${p}price_xof AS "priceXof",${p}stock_quantity AS "stockQuantity",${p}minimum_order_quantity AS "minimumOrderQuantity",${p}status,${p}created_at AS "createdAt",${p}updated_at AS "updatedAt"`;
  }
  _requestFields(alias = '') {
    const p = alias ? `${alias}.` : '';
    return `${p}id,${p}reference,${p}buyer_merchant_id AS "buyerMerchantId",${p}store_id AS "storeId",${p}target_supplier_id AS "targetSupplierId",${p}title,${p}details,${p}category,${p}items,${p}delivery_address AS "deliveryAddress",${p}wanted_by AS "wantedBy",${p}status,${p}created_at AS "createdAt"`;
  }
  _quoteFields(alias = '') {
    const p = alias ? `${alias}.` : '';
    return `${p}id,${p}request_id AS "requestId",${p}supplier_id AS "supplierId",${p}items,${p}total_xof AS "totalXof",${p}notes,${p}valid_until AS "validUntil",${p}status,${p}created_at AS "createdAt"`;
  }
  _orderFields(alias = '') {
    const p = alias ? `${alias}.` : '';
    return `${p}id,${p}order_reference AS reference,${p}request_id AS "requestId",${p}quote_id AS "quoteId",${p}buyer_merchant_id AS "buyerMerchantId",${p}supplier_id AS "supplierId",${p}items,${p}total_xof AS "totalXof",${p}delivery_address AS "deliveryAddress",${p}tracking_reference AS "trackingReference",${p}status,${p}created_at AS "createdAt",${p}updated_at AS "updatedAt"`;
  }

  async registerSupplier(data) {
    const id = uid(); const publicCode = ref('S'); const now = new Date().toISOString();
    if (this.pg) {
      try {
        const { rows } = await this.base.pool.query(
          `INSERT INTO supplier_accounts (id,username,company_name,contact_name,email,phone,address,bio,categories,public_contact,password_hash,status,public_code)
           VALUES ($1,LOWER($2),$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'pending',$12) RETURNING ${this._supplierFields()}`,
          [id,data.username,data.companyName,data.contactName,data.email,data.phone,data.address,data.bio,JSON.stringify(data.categories),data.publicContact,data.passwordHash,publicCode]);
        return safeSupplier(rows[0]);
      } catch (error) { if (error.code === '23505') throw err('Cet identifiant fournisseur est déjà utilisé.','DUPLICATE'); throw error; }
    }
    return this._lock(async () => {
      if (this.base.state.supplierAccounts.some((row) => !row.deletedAt && row.username.toLowerCase() === data.username.toLowerCase())) throw err('Cet identifiant fournisseur est déjà utilisé.','DUPLICATE');
      let code = publicCode;
      while (this.base.state.supplierAccounts.some((row) => row.publicCode === code)) code = ref('S');
      const row = { id, username:data.username.toLowerCase(), companyName:data.companyName, contactName:data.contactName, email:data.email,
        phone:data.phone,address:data.address,bio:data.bio,categories:clone(data.categories),publicContact:data.publicContact,passwordHash:data.passwordHash,
        status:'pending',statusReason:'',publicCode:code,tokenVersion:1,createdAt:now,updatedAt:now,reviewedAt:null,reviewedBy:'',lastLoginAt:null,deletedAt:null };
      this.base.state.supplierAccounts.push(row); await this.base.save(); return safeSupplier(row);
    });
  }
  async getSupplierByUsername(username) {
    const key = text(username,80).toLowerCase();
    if (this.pg) { const { rows }=await this.base.pool.query(`SELECT ${this._supplierFields()},password_hash AS "passwordHash" FROM supplier_accounts WHERE LOWER(username)=$1 AND deleted_at IS NULL`,[key]); return rows[0]||null; }
    const row=this.base.state.supplierAccounts.find((item)=>!item.deletedAt&&item.username.toLowerCase()===key);return row?clone(row):null;
  }
  async getSupplierById(id,{includeSecrets=false}={}) {
    if (this.pg) { const { rows }=await this.base.pool.query(`SELECT ${this._supplierFields()}${includeSecrets?',password_hash AS "passwordHash"':''} FROM supplier_accounts WHERE id=$1 AND deleted_at IS NULL`,[id]);return rows[0]||null; }
    const row=this.base.state.supplierAccounts.find((item)=>item.id===id&&!item.deletedAt);if(!row)return null;return includeSecrets?clone(row):safeSupplier(row);
  }
  async markSupplierLogin(id) {
    if (this.pg) { const {rows}=await this.base.pool.query(`UPDATE supplier_accounts SET last_login_at=NOW(),updated_at=NOW() WHERE id=$1 RETURNING ${this._supplierFields()}`, [id]);return safeSupplier(rows[0]||null); }
    return this._lock(async()=>{const row=this.base.state.supplierAccounts.find((item)=>item.id===id&&!item.deletedAt);if(!row)return null;row.lastLoginAt=new Date().toISOString();row.updatedAt=row.lastLoginAt;await this.base.save();return safeSupplier(row);});
  }
  async listAdminSuppliers({status='',limit=500}={}) {
    const safeLimit=Math.max(1,Math.min(1000,Number(limit)||500));
    if (this.pg) {const {rows}=await this.base.pool.query(`SELECT ${this._supplierFields()} FROM supplier_accounts WHERE deleted_at IS NULL AND ($1='' OR status=$1) ORDER BY created_at DESC LIMIT $2`,[status,safeLimit]);return rows.map(safeSupplier);}
    return this.base.state.supplierAccounts.filter((row)=>!row.deletedAt&&(!status||row.status===status)).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,safeLimit).map(safeSupplier);
  }
  async decideSupplier(id,status,reason,reviewedBy) {
    if (!['active','rejected','suspended'].includes(status)) throw err('Décision fournisseur invalide.');
    if (this.pg) {const {rows}=await this.base.pool.query(`UPDATE supplier_accounts SET status=$2,status_reason=$3,reviewed_at=NOW(),reviewed_by=$4,token_version=token_version+1,updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING ${this._supplierFields()}`,[id,status,text(reason,500),text(reviewedBy,100)]);return safeSupplier(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.supplierAccounts.find((item)=>item.id===id&&!item.deletedAt);if(!row)return null;row.status=status;row.statusReason=text(reason,500);row.reviewedAt=new Date().toISOString();row.reviewedBy=text(reviewedBy,100);row.tokenVersion=(Number(row.tokenVersion)||0)+1;row.updatedAt=row.reviewedAt;await this.base.save();return safeSupplier(row);});
  }
  async updateSupplierProfile(id,data) {
    if (this.pg) {const {rows}=await this.base.pool.query(`UPDATE supplier_accounts SET company_name=$2,contact_name=$3,email=$4,phone=$5,address=$6,bio=$7,categories=$8::jsonb,public_contact=$9,updated_at=NOW() WHERE id=$1 AND deleted_at IS NULL RETURNING ${this._supplierFields()}`,[id,data.companyName,data.contactName,data.email,data.phone,data.address,data.bio,JSON.stringify(data.categories),data.publicContact]);return safeSupplier(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.supplierAccounts.find((item)=>item.id===id&&!item.deletedAt);if(!row)return null;Object.assign(row,{companyName:data.companyName,contactName:data.contactName,email:data.email,phone:data.phone,address:data.address,bio:data.bio,categories:clone(data.categories),publicContact:data.publicContact,updatedAt:new Date().toISOString()});await this.base.save();return safeSupplier(row);});
  }
  async listSupplierProducts(supplierId,{activeOnly=false}={}) {
    if (this.pg) {const {rows}=await this.base.pool.query(`SELECT ${this._productFields()} FROM supplier_products WHERE supplier_id=$1 AND ($2=FALSE OR status='active') ORDER BY updated_at DESC LIMIT 500`,[supplierId,activeOnly]);return rows.map(safeProduct);}
    return this.base.state.supplierProducts.filter((row)=>row.supplierId===supplierId&&(!activeOnly||row.status==='active')).sort((a,b)=>String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0,500).map(safeProduct);
  }
  async saveSupplierProduct(supplierId,data,id='') {
    const now=new Date().toISOString();
    if (this.pg) {
      try {
        const sql=id?`UPDATE supplier_products SET name=$3,description=$4,sku=$5,category=$6,unit=$7,price_xof=$8,stock_quantity=$9,minimum_order_quantity=$10,status=$11,updated_at=NOW() WHERE id=$1 AND supplier_id=$2 RETURNING ${this._productFields()}`
          :`INSERT INTO supplier_products (id,supplier_id,name,description,sku,category,unit,price_xof,stock_quantity,minimum_order_quantity,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING ${this._productFields()}`;
        const args=id?[id,supplierId,data.name,data.description,data.sku,data.category,data.unit,data.priceXof,data.stockQuantity,data.minimumOrderQuantity,data.status]:[uid(),supplierId,data.name,data.description,data.sku,data.category,data.unit,data.priceXof,data.stockQuantity,data.minimumOrderQuantity,data.status];
        const {rows}=await this.base.pool.query(sql,args);return safeProduct(rows[0]||null);
      } catch(error) {if(error.code==='23505')throw err('Cette référence fournisseur existe déjà.','DUPLICATE');throw error;}
    }
    return this._lock(async()=>{
      let row=id?this.base.state.supplierProducts.find((item)=>item.id===id&&item.supplierId===supplierId):null;if(id&&!row)return null;
      if(data.sku&&this.base.state.supplierProducts.some((item)=>item.supplierId===supplierId&&item.id!==id&&item.status!=='archived'&&item.sku.toLowerCase()===data.sku.toLowerCase()))throw err('Cette référence fournisseur existe déjà.','DUPLICATE');
      if(row)Object.assign(row,data,{updatedAt:now});else{row={id:uid(),supplierId,...data,createdAt:now,updatedAt:now};this.base.state.supplierProducts.push(row);}await this.base.save();return safeProduct(row);
    });
  }
  async archiveSupplierProduct(supplierId,id) {
    if(this.pg){const {rows}=await this.base.pool.query(`UPDATE supplier_products SET status='archived',updated_at=NOW() WHERE id=$1 AND supplier_id=$2 RETURNING ${this._productFields()}`,[id,supplierId]);return safeProduct(rows[0]||null);}
    return this._lock(async()=>{const row=this.base.state.supplierProducts.find((item)=>item.id===id&&item.supplierId===supplierId);if(!row)return null;row.status='archived';row.updatedAt=new Date().toISOString();await this.base.save();return safeProduct(row);});
  }
  async listSupplierDirectory({search='',category='',limit=100}={}) {
    const q=text(search,100).toLocaleLowerCase('fr');const cat=text(category,60).toLocaleLowerCase('fr');const safeLimit=Math.max(1,Math.min(200,Number(limit)||100));
    if(this.pg){
      const {rows}=await this.base.pool.query(`SELECT ${this._supplierFields('s')},COALESCE(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'description',p.description,'sku',p.sku,'category',p.category,'unit',p.unit,'priceXof',p.price_xof,'stockQuantity',p.stock_quantity,'minimumOrderQuantity',p.minimum_order_quantity,'status',p.status) ORDER BY p.name) FILTER (WHERE p.id IS NOT NULL AND p.status='active'),'[]'::jsonb) AS products
        FROM supplier_accounts s LEFT JOIN supplier_products p ON p.supplier_id=s.id WHERE s.status='active' AND s.deleted_at IS NULL AND ($1='' OR s.company_name ILIKE $2 OR s.bio ILIKE $2 OR s.username ILIKE $2) AND ($3='' OR s.categories ? $3 OR EXISTS (SELECT 1 FROM supplier_products pc WHERE pc.supplier_id=s.id AND pc.status='active' AND LOWER(pc.category)=LOWER($3)))
        GROUP BY s.id ORDER BY s.company_name LIMIT $4`,[q,`%${q}%`,cat,safeLimit]);
      return rows.map((row)=>{const supplier=safeSupplier(row);if(!supplier.publicContact){supplier.email='';supplier.phone='';supplier.address='';supplier.contactName='';}return {...supplier,products:(row.products||[]).filter((p)=>p.status==='active').map((p)=>({...p,priceXof:Number(p.priceXof)||0,stockQuantity:Number(p.stockQuantity)||0,minimumOrderQuantity:Number(p.minimumOrderQuantity)||1}))};});
    }
    const accounts=this.base.state.supplierAccounts.filter((row)=>row.status==='active'&&!row.deletedAt&&(!q||`${row.companyName} ${row.bio} ${row.username}`.toLocaleLowerCase('fr').includes(q))&&(!cat||categoriesOf(row.categories).some((item)=>item.toLocaleLowerCase('fr')===cat)||this.base.state.supplierProducts.some((p)=>p.supplierId===row.id&&p.status==='active'&&p.category.toLocaleLowerCase('fr')===cat))).slice(0,safeLimit);
    return accounts.map((row)=>{const supplier=safeSupplier(row);if(!supplier.publicContact){supplier.email='';supplier.phone='';supplier.address='';supplier.contactName='';}return {...supplier,products:this.base.state.supplierProducts.filter((p)=>p.supplierId===row.id&&p.status==='active').map(safeProduct)};});
  }
  async getPublicSupplierByCode(code) {
    let supplier;
    if(this.pg){const {rows}=await this.base.pool.query(`SELECT ${this._supplierFields()} FROM supplier_accounts WHERE public_code=$1 AND status='active' AND deleted_at IS NULL`,[code]);supplier=rows[0]||null;}
    else supplier=this.base.state.supplierAccounts.find((row)=>row.publicCode===code&&row.status==='active'&&!row.deletedAt)||null;
    if(!supplier)return null;const products=await this.listSupplierProducts(supplier.id,{activeOnly:true});
    const safe=safeSupplier(supplier);if(!safe.publicContact){safe.email='';safe.phone='';safe.address='';safe.contactName='';}
    return {...safe,products};
  }
  async _eligibleSupplierIds(category,targetSupplierId='') {
    if(targetSupplierId){const supplier=await this.getSupplierById(targetSupplierId);return supplier?.status==='active'?[targetSupplierId]:[];}
    if(this.pg){const {rows}=await this.base.pool.query(`SELECT id,categories FROM supplier_accounts WHERE status='active' AND deleted_at IS NULL`,[]);return rows.filter((r)=>categoriesOf(r.categories).some((item)=>item.toLowerCase()===String(category).toLowerCase())).map((r)=>r.id);}
    return this.base.state.supplierAccounts.filter((row)=>row.status==='active'&&!row.deletedAt&&categoriesOf(row.categories).some((item)=>item.toLowerCase()===category.toLowerCase())).map((row)=>row.id);
  }
  async createSourcingRequest(data) {
    const id=uid();const reference=ref('RFQ');const now=new Date().toISOString();
    if(this.pg){
      const {rows}=await this.base.pool.query(`INSERT INTO sourcing_requests (id,reference,buyer_merchant_id,store_id,target_supplier_id,title,details,category,items,delivery_address,wanted_by,status)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,'open') RETURNING ${this._requestFields()}`,[id,reference,data.buyerMerchantId,data.storeId,data.targetSupplierId||null,data.title,data.details,data.category,JSON.stringify(data.items),data.deliveryAddress,data.wantedBy||null]);
      const row=safeRequest({...rows[0],storeName:data.storeName});
      const recipients=await this._eligibleSupplierIds(data.category,data.targetSupplierId||'');for(const supplierId of recipients)await this.createNotification('supplier',supplierId,'request_received','Nouvelle demande d’approvisionnement',`${data.storeName} · ${data.title}`,'sourcing_request',id);
      return row;
    }
    const row=await this._lock(async()=>{const item={id,reference,buyerMerchantId:data.buyerMerchantId,storeId:data.storeId,storeName:data.storeName,targetSupplierId:data.targetSupplierId||'',title:data.title,details:data.details,category:data.category,items:clone(data.items),deliveryAddress:data.deliveryAddress,wantedBy:data.wantedBy||null,status:'open',createdAt:now};this.base.state.sourcingRequests.push(item);await this.base.save();return safeRequest(item);});
    const recipients=await this._eligibleSupplierIds(data.category,data.targetSupplierId||'');for(const supplierId of recipients)await this.createNotification('supplier',supplierId,'request_received','Nouvelle demande d’approvisionnement',`${data.storeName} · ${data.title}`,'sourcing_request',id);
    return row;
  }
  async listSupplierRequests(supplierId) {
    const supplier=await this.getSupplierById(supplierId);if(!supplier)return [];
    let rows;
    if(this.pg){const {rows:r}=await this.base.pool.query(`SELECT ${this._requestFields('r')},s.name AS "storeName" FROM sourcing_requests r JOIN merchant_stores s ON s.id=r.store_id
      WHERE r.status='open' AND (r.target_supplier_id=$1 OR (r.target_supplier_id IS NULL AND LOWER(r.category)=ANY($2::text[]))) ORDER BY r.created_at DESC LIMIT 500`,[supplierId,categoriesOf(supplier.categories).map((x)=>x.toLowerCase())]);rows=r;}
    else rows=this.base.state.sourcingRequests.filter((row)=>row.status==='open'&&(row.targetSupplierId===supplierId||(!row.targetSupplierId&&categoriesOf(supplier.categories).some((c)=>c.toLowerCase()===row.category.toLowerCase())))).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,500);
    const ownQuotes=await this.listSupplierQuotes(supplierId);const quoteByRequest=new Map(ownQuotes.map((q)=>[q.requestId,q]));
    return rows.map((row)=>({...safeRequest(row),deliveryAddress:'',myQuote:quoteByRequest.get(row.id)||null}));
  }
  async createSupplierQuote(supplierId,requestId,{items,notes,validUntil}={}) {
    const id=uid();const now=new Date().toISOString();
    if(this.pg){
      const client=await this.base.pool.connect();let result;
      try{await client.query('BEGIN');
        const {rows:requestRows}=await client.query(`SELECT ${this._requestFields('r')},s.name AS "storeName" FROM sourcing_requests r JOIN merchant_stores s ON s.id=r.store_id WHERE r.id=$1 FOR UPDATE`,[requestId]);const request=requestRows[0];if(!request||request.status!=='open')throw err('Cette demande n’est plus ouverte.','REQUEST_CLOSED');
        const supplier=await client.query(`SELECT categories,status FROM supplier_accounts WHERE id=$1 AND deleted_at IS NULL`,[supplierId]);if(!supplier.rows[0]||supplier.rows[0].status!=='active')throw err('Le compte fournisseur n’est pas actif.','NOT_FOUND');
        const cat=categoriesOf(supplier.rows[0].categories).some((c)=>c.toLowerCase()===String(request.category).toLowerCase());if(request.targetSupplierId?request.targetSupplierId!==supplierId:!cat)throw err('Cette demande n’est pas destinée à ce fournisseur.','FORBIDDEN');
        const prior=await client.query('SELECT id FROM supplier_quotes WHERE request_id=$1 AND supplier_id=$2',[requestId,supplierId]);if(prior.rows[0])throw err('Un devis a déjà été envoyé pour cette demande.','DUPLICATE');
        const products=[];for(const line of items){const {rows}=await client.query(`SELECT ${this._productFields()} FROM supplier_products WHERE id=$1 AND supplier_id=$2 AND status='active' FOR UPDATE`,[line.productId,supplierId]);const p=rows[0];if(!p)throw err('Un produit proposé n’est plus disponible.','STOCK_UNAVAILABLE');if(line.quantity<p.minimumOrderQuantity||line.quantity>p.stockQuantity)throw err(`Stock ou minimum de commande invalide pour « ${p.name} ».`,'STOCK_UNAVAILABLE');products.push({...safeProduct(p),quantity:line.quantity});}
        const quoteItems=products.map((p)=>({productId:p.id,name:p.name,sku:p.sku,category:p.category,unit:p.unit,quantity:p.quantity,unitPriceXof:p.priceXof,lineTotalXof:p.priceXof*p.quantity}));const total=quoteItems.reduce((sum,line)=>sum+line.lineTotalXof,0);if(!Number.isSafeInteger(total)||total<1)throw err('Le montant du devis est invalide.');
        const {rows}=await client.query(`INSERT INTO supplier_quotes (id,request_id,supplier_id,items,total_xof,notes,valid_until,status) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::timestamptz,'pending') RETURNING ${this._quoteFields()}`,[id,requestId,supplierId,JSON.stringify(quoteItems),total,text(notes,1000),validUntil||null]);result=safeQuote({...rows[0],supplierName:(await client.query('SELECT company_name FROM supplier_accounts WHERE id=$1',[supplierId])).rows[0]?.company_name||''});
        await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
      const buyer=await this.getRequestBuyer(requestId);if(buyer)await this.createNotification('merchant',buyer.merchantId,'quote_received','Nouveau devis fournisseur',`${result.supplierName} · ${result.totalXof.toLocaleString('fr-FR')} XOF`,'supplier_quote',id);return result;
    }
    const result=await this._lock(async()=>{
      const request=this.base.state.sourcingRequests.find((row)=>row.id===requestId);if(!request||request.status!=='open')throw err('Cette demande n’est plus ouverte.','REQUEST_CLOSED');
      const supplier=this.base.state.supplierAccounts.find((row)=>row.id===supplierId&&row.status==='active');if(!supplier)throw err('Le compte fournisseur n’est pas actif.','NOT_FOUND');
      const eligible=request.targetSupplierId?request.targetSupplierId===supplierId:categoriesOf(supplier.categories).some((c)=>c.toLowerCase()===request.category.toLowerCase());if(!eligible)throw err('Cette demande n’est pas destinée à ce fournisseur.','FORBIDDEN');
      if(this.base.state.supplierQuotes.some((row)=>row.requestId===requestId&&row.supplierId===supplierId))throw err('Un devis a déjà été envoyé pour cette demande.','DUPLICATE');
      const products=items.map((line)=>{const p=this.base.state.supplierProducts.find((row)=>row.id===line.productId&&row.supplierId===supplierId&&row.status==='active');if(!p)throw err('Un produit proposé n’est plus disponible.','STOCK_UNAVAILABLE');if(line.quantity<p.minimumOrderQuantity||line.quantity>p.stockQuantity)throw err(`Stock ou minimum de commande invalide pour « ${p.name} ».`,'STOCK_UNAVAILABLE');return {...safeProduct(p),quantity:line.quantity};});
      const quoteItems=products.map((p)=>({productId:p.id,name:p.name,sku:p.sku,category:p.category,unit:p.unit,quantity:p.quantity,unitPriceXof:p.priceXof,lineTotalXof:p.priceXof*p.quantity}));const total=quoteItems.reduce((sum,line)=>sum+line.lineTotalXof,0);if(!Number.isSafeInteger(total)||total<1)throw err('Le montant du devis est invalide.');
      const row={id,requestId,supplierId,items:quoteItems,totalXof:total,notes:text(notes,1000),validUntil:validUntil||null,status:'pending',createdAt:now,supplierName:supplier.companyName};this.base.state.supplierQuotes.push(row);await this.base.save();return safeQuote(row);
    });
    const buyer=await this.getRequestBuyer(requestId);if(buyer)await this.createNotification('merchant',buyer.merchantId,'quote_received','Nouveau devis fournisseur',`${result.supplierName||'Fournisseur'} · ${result.totalXof.toLocaleString('fr-FR')} XOF`,'supplier_quote',id);return result;
  }
  async getRequestBuyer(requestId) {
    if(this.pg){const {rows}=await this.base.pool.query('SELECT buyer_merchant_id AS "merchantId" FROM sourcing_requests WHERE id=$1',[requestId]);return rows[0]||null;}
    const row=this.base.state.sourcingRequests.find((item)=>item.id===requestId);return row?{merchantId:row.buyerMerchantId}:null;
  }
  async listSupplierQuotes(supplierId) {
    if(this.pg){const {rows}=await this.base.pool.query(`SELECT ${this._quoteFields('q')},r.reference AS "requestReference",r.title AS "requestTitle",r.store_id AS "storeId",s.name AS "storeName" FROM supplier_quotes q JOIN sourcing_requests r ON r.id=q.request_id JOIN merchant_stores s ON s.id=r.store_id WHERE q.supplier_id=$1 ORDER BY q.created_at DESC LIMIT 500`,[supplierId]);return rows.map((row)=>({...safeQuote(row),requestReference:row.requestReference,requestTitle:row.requestTitle,storeName:row.storeName}));}
    return this.base.state.supplierQuotes.filter((row)=>row.supplierId===supplierId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,500).map((row)=>{const req=this.base.state.sourcingRequests.find((item)=>item.id===row.requestId)||{};return {...safeQuote(row),requestReference:req.reference||'',requestTitle:req.title||'',storeName:req.storeName||''};});
  }
  async listMerchantRequests(merchantId) {
    let requests,quotes;
    if(this.pg){const {rows}=await this.base.pool.query(`SELECT ${this._requestFields('r')},s.name AS "storeName" FROM sourcing_requests r JOIN merchant_stores s ON s.id=r.store_id WHERE r.buyer_merchant_id=$1 ORDER BY r.created_at DESC LIMIT 200`,[merchantId]);requests=rows;
      if(!requests.length)return [];const {rows:q}=await this.base.pool.query(`SELECT ${this._quoteFields('q')},s.company_name AS "supplierName" FROM supplier_quotes q JOIN supplier_accounts s ON s.id=q.supplier_id WHERE q.request_id=ANY($1::text[]) ORDER BY q.created_at`,[requests.map((r)=>r.id)]);quotes=q;}
    else {requests=this.base.state.sourcingRequests.filter((row)=>row.buyerMerchantId===merchantId).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,200);quotes=this.base.state.supplierQuotes.filter((row)=>requests.some((r)=>r.id===row.requestId)).map((row)=>({...row,supplierName:this.base.state.supplierAccounts.find((s)=>s.id===row.supplierId)?.companyName||''}));}
    return requests.map((row)=>({...safeRequest(row),quotes:quotes.filter((q)=>q.requestId===row.id).map(safeQuote),orders:[]}));
  }
  async acceptSupplierQuote(merchantId,quoteId) {
    const id=uid();const reference=ref('PO');const now=new Date().toISOString();
    if(this.pg){const client=await this.base.pool.connect();let result;
      try{await client.query('BEGIN');const {rows}=await client.query(`SELECT ${this._quoteFields('q')},q.status AS "quoteStatus",r.buyer_merchant_id AS "buyerMerchantId",r.store_id AS "storeId",r.status AS "requestStatus",s.company_name AS "supplierName",m.name AS "storeName",r.delivery_address AS "deliveryAddress"
          FROM supplier_quotes q JOIN sourcing_requests r ON r.id=q.request_id JOIN supplier_accounts s ON s.id=q.supplier_id JOIN merchant_stores m ON m.id=r.store_id WHERE q.id=$1 FOR UPDATE OF q,r`,[quoteId]);const q=rows[0];if(!q||q.buyerMerchantId!==merchantId)throw err('Devis introuvable.','NOT_FOUND');if(q.quoteStatus!=='pending'||q.requestStatus!=='open')throw err('Ce devis ou cette demande n’est plus disponible.','QUOTE_CLOSED');
        const {rows:orders}=await client.query(`INSERT INTO supply_orders (id,order_reference,request_id,quote_id,buyer_merchant_id,supplier_id,items,total_xof,delivery_address,status) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,'pending_supplier') RETURNING ${this._orderFields()}`,[id,reference,q.requestId,quoteId,merchantId,q.supplierId,JSON.stringify(q.items),q.totalXof,q.deliveryAddress]);
        await client.query(`UPDATE supplier_quotes SET status=CASE WHEN id=$2 THEN 'accepted' WHEN status='pending' THEN 'not_selected' ELSE status END WHERE request_id=$1`,[q.requestId,quoteId]);await client.query(`UPDATE sourcing_requests SET status='awarded',updated_at=NOW() WHERE id=$1`,[q.requestId]);await client.query(`INSERT INTO supply_order_events (id,order_id,actor_type,actor_id,status,note) VALUES ($1,$2,'merchant',$3,'pending_supplier','Devis accepté; aucune transaction de paiement n’a été traitée.')`,[uid(),id,merchantId]);result=safeOrder({...orders[0],supplierName:q.supplierName,storeName:q.storeName,events:[{actorType:'merchant',status:'pending_supplier',note:'Devis accepté; aucune transaction de paiement n’a été traitée.',createdAt:now}]});await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
      await this.createNotification('supplier',result.supplierId,'purchase_order_received','Nouvelle commande d’approvisionnement',`${result.reference} · ${result.totalXof.toLocaleString('fr-FR')} XOF`,'supply_order',result.id);return result;
    }
    const result=await this._lock(async()=>{const q=this.base.state.supplierQuotes.find((row)=>row.id===quoteId);if(!q)throw err('Devis introuvable.','NOT_FOUND');const request=this.base.state.sourcingRequests.find((row)=>row.id===q.requestId);if(!request||request.buyerMerchantId!==merchantId)throw err('Devis introuvable.','NOT_FOUND');if(q.status!=='pending'||request.status!=='open')throw err('Ce devis ou cette demande n’est plus disponible.','QUOTE_CLOSED');
      const order={id,reference,requestId:q.requestId,quoteId,buyerMerchantId:merchantId,supplierId:q.supplierId,items:clone(q.items),totalXof:q.totalXof,deliveryAddress:request.deliveryAddress,status:'pending_supplier',createdAt:now,updatedAt:now,trackingReference:''};this.base.state.supplyOrders.push(order);q.status='accepted';for(const other of this.base.state.supplierQuotes)if(other.requestId===q.requestId&&other.id!==q.id&&other.status==='pending')other.status='not_selected';request.status='awarded';this.base.state.supplyOrderEvents.push({id:uid(),orderId:id,actorType:'merchant',actorId:merchantId,status:'pending_supplier',note:'Devis accepté; aucune transaction de paiement n’a été traitée.',createdAt:now});await this.base.save();return safeOrder({...order,supplierName:this.base.state.supplierAccounts.find((s)=>s.id===q.supplierId)?.companyName||'',storeName:request.storeName,events:this.base.state.supplyOrderEvents.filter((e)=>e.orderId===id)});});
    await this.createNotification('supplier',result.supplierId,'purchase_order_received','Nouvelle commande d’approvisionnement',`${result.reference} · ${result.totalXof.toLocaleString('fr-FR')} XOF`,'supply_order',result.id);return result;
  }
  async listOrders({merchantId='',supplierId=''}={}) {
    let rows;
    if(this.pg){const where=merchantId?'o.buyer_merchant_id=$1':supplierId?'o.supplier_id=$1':'TRUE';const args=merchantId?[merchantId]:supplierId?[supplierId]:[];const {rows:r}=await this.base.pool.query(`SELECT ${this._orderFields('o')},s.company_name AS "supplierName",m.name AS "storeName" FROM supply_orders o JOIN supplier_accounts s ON s.id=o.supplier_id JOIN merchant_stores m ON m.id=(SELECT store_id FROM sourcing_requests WHERE id=o.request_id) WHERE ${where} ORDER BY o.created_at DESC LIMIT 1000`,args);rows=r;
      const ids=rows.map((r)=>r.id);const events=ids.length?(await this.base.pool.query(`SELECT id,order_id AS "orderId",actor_type AS "actorType",actor_id AS "actorId",status,note,tracking_reference AS "trackingReference",created_at AS "createdAt" FROM supply_order_events WHERE order_id=ANY($1::text[]) ORDER BY created_at`,[ids])).rows:[];return rows.map((row)=>safeOrder({...row,events:events.filter((e)=>e.orderId===row.id)}));}
    rows=this.base.state.supplyOrders.filter((row)=>merchantId?row.buyerMerchantId===merchantId:supplierId?row.supplierId===supplierId:true).sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))).slice(0,1000);
    return rows.map((row)=>{const request=this.base.state.sourcingRequests.find((r)=>r.id===row.requestId)||{};const supplier=this.base.state.supplierAccounts.find((s)=>s.id===row.supplierId)||{};return safeOrder({...row,storeName:request.storeName||'',supplierName:supplier.companyName||'',events:this.base.state.supplyOrderEvents.filter((e)=>e.orderId===row.id)});});
  }
  async transitionSupplyOrder({actorType,actorId,orderId,status,note='',trackingReference=''}) {
    const allowed={supplier:{pending_supplier:['confirmed','cancelled'],confirmed:['processing'],processing:['shipped'],shipped:['delivered']},merchant:{pending_supplier:['cancelled'],delivered:['received'],shipped:['disputed'],delivered_dispute:['disputed']}};
    const valid=status==='disputed'&&actorType==='merchant';const now=new Date().toISOString();
    const transition=async(client,order)=>{
      if(actorType==='supplier'&&order.supplierId!==actorId||actorType==='merchant'&&order.buyerMerchantId!==actorId)throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');
      const nexts=allowed[actorType]?.[order.status]||[];if(!nexts.includes(status)&&!valid)throw err('Cette transition de commande n’est pas permise.','ORDER_TRANSITION');
      if(status==='disputed'&&!['shipped','delivered'].includes(order.status))throw err('Un litige est disponible après expédition.','ORDER_TRANSITION');
      if(actorType==='supplier'&&status==='confirmed'){
        for(const item of order.items){
          if(client){const {rows}=await client.query(`SELECT stock_quantity AS stock,status FROM supplier_products WHERE id=$1 AND supplier_id=$2 FOR UPDATE`,[item.productId,actorId]);if(!rows[0]||rows[0].status!=='active'||Number(rows[0].stock)<item.quantity)throw err(`Stock insuffisant pour « ${item.name} »; le fournisseur doit réviser son inventaire avant de confirmer.`,'STOCK_UNAVAILABLE');await client.query(`UPDATE supplier_products SET stock_quantity=stock_quantity-$2,updated_at=NOW() WHERE id=$1`,[item.productId,item.quantity]);}
          else {const p=this.base.state.supplierProducts.find((row)=>row.id===item.productId&&row.supplierId===actorId&&row.status==='active');if(!p||Number(p.stockQuantity)<item.quantity)throw err(`Stock insuffisant pour « ${item.name} »; le fournisseur doit réviser son inventaire avant de confirmer.`,'STOCK_UNAVAILABLE');p.stockQuantity-=item.quantity;p.updatedAt=now;}
        }
      }
      const track=status==='shipped'?text(trackingReference,120):'';const safeNote=text(note,500)||`Statut d’approvisionnement : ${status}.`;
      if(client){const {rows}=await client.query(`UPDATE supply_orders SET status=$2,tracking_reference=CASE WHEN $2='shipped' THEN $3 ELSE tracking_reference END,updated_at=NOW() WHERE id=$1 RETURNING ${this._orderFields()}`,[order.id,status,track]);await client.query(`INSERT INTO supply_order_events (id,order_id,actor_type,actor_id,status,note,tracking_reference) VALUES ($1,$2,$3,$4,$5,$6,$7)`,[uid(),order.id,actorType,actorId,status,safeNote,track]);return {...rows[0],trackingReference:status==='shipped'?track:rows[0].trackingReference};}
      order.status=status;if(status==='shipped'&&track)order.trackingReference=track;order.updatedAt=now;this.base.state.supplyOrderEvents.push({id:uid(),orderId:order.id,actorType,actorId,status,note:safeNote,trackingReference:track,createdAt:now});return order;
    };
    let result;
    if(this.pg){const client=await this.base.pool.connect();try{await client.query('BEGIN');const {rows}=await client.query(`SELECT ${this._orderFields()} FROM supply_orders WHERE id=$1 FOR UPDATE`,[orderId]);if(!rows[0])throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');const next=await transition(client,rows[0]);await client.query('COMMIT');result=next;}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}
    else result=await this._lock(async()=>{const order=this.base.state.supplyOrders.find((row)=>row.id===orderId);if(!order)throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');await transition(null,order);await this.base.save();const req=this.base.state.sourcingRequests.find((r)=>r.id===order.requestId)||{};const supplier=this.base.state.supplierAccounts.find((s)=>s.id===order.supplierId)||{};return safeOrder({...order,storeName:req.storeName||'',supplierName:supplier.companyName||'',events:this.base.state.supplyOrderEvents.filter((e)=>e.orderId===order.id)});});
    const recipientType=actorType==='supplier'?'merchant':'supplier';const recipientId=actorType==='supplier'?result.buyerMerchantId:result.supplierId;
    await this.createNotification(recipientType,recipientId,'supply_order_updated','Mise à jour d’approvisionnement',`${result.reference} · ${status}`,'supply_order',result.id);
    return result;
  }
  async listOrderMessages(orderId,{actorType,actorId}={}) {
    if(this.pg){const {rows:orderRows}=await this.base.pool.query(`SELECT buyer_merchant_id AS "buyerMerchantId",supplier_id AS "supplierId" FROM supply_orders WHERE id=$1`,[orderId]);const order=orderRows[0];if(!order||actorType==='merchant'&&order.buyerMerchantId!==actorId||actorType==='supplier'&&order.supplierId!==actorId)throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');const {rows}=await this.base.pool.query(`SELECT id,order_id AS "orderId",sender_type AS "senderType",body,created_at AS "createdAt" FROM supply_order_messages WHERE order_id=$1 ORDER BY created_at LIMIT 1000`,[orderId]);return rows;}
    const order=this.base.state.supplyOrders.find((row)=>row.id===orderId);if(!order||actorType==='merchant'&&order.buyerMerchantId!==actorId||actorType==='supplier'&&order.supplierId!==actorId)throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');return this.base.state.supplyOrderMessages.filter((row)=>row.orderId===orderId).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))).map(({id,orderId,senderType,body,createdAt})=>({id,orderId,senderType,body,createdAt}));
  }
  async createOrderMessage(orderId,{actorType,actorId,body}={}) {
    const message=text(body,2000);if(message.length<2)throw err('Le message doit contenir au moins 2 caractères.');if(!['merchant','supplier'].includes(actorType))throw err('Type d’expéditeur invalide.');const id=uid();const now=new Date().toISOString();let row,recipientType,recipientId,orderRef;
    if(this.pg){const client=await this.base.pool.connect();try{await client.query('BEGIN');const {rows}=await client.query(`SELECT buyer_merchant_id AS "buyerMerchantId",supplier_id AS "supplierId",order_reference AS reference FROM supply_orders WHERE id=$1 FOR SHARE`,[orderId]);const order=rows[0];if(!order||actorType==='merchant'&&order.buyerMerchantId!==actorId||actorType==='supplier'&&order.supplierId!==actorId)throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');const {rows:inserted}=await client.query(`INSERT INTO supply_order_messages (id,order_id,sender_type,sender_id,body) VALUES ($1,$2,$3,$4,$5) RETURNING id,order_id AS "orderId",sender_type AS "senderType",body,created_at AS "createdAt"`,[id,orderId,actorType,actorId,message]);row=inserted[0];recipientType=actorType==='merchant'?'supplier':'merchant';recipientId=actorType==='merchant'?order.supplierId:order.buyerMerchantId;orderRef=order.reference;await this.createNotification(recipientType,recipientId,'supply_message_received','Nouveau message d’approvisionnement',`${orderRef} · ${message.slice(0,160)}`,'supply_order',orderId,client);await client.query('COMMIT');}catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}}
    else await this._lock(async()=>{const order=this.base.state.supplyOrders.find((item)=>item.id===orderId);if(!order||actorType==='merchant'&&order.buyerMerchantId!==actorId||actorType==='supplier'&&order.supplierId!==actorId)throw err('Commande d’approvisionnement introuvable.','NOT_FOUND');row={id,orderId,senderType:actorType,senderId:actorId,body:message,createdAt:now};recipientType=actorType==='merchant'?'supplier':'merchant';recipientId=actorType==='merchant'?order.supplierId:order.buyerMerchantId;orderRef=order.reference;const notification={id:uid(),actorType:recipientType,actorId:recipientId,type:'supply_message_received',title:'Nouveau message d’approvisionnement',body:`${orderRef} · ${message.slice(0,160)}`,entityType:'supply_order',entityId:orderId,createdAt:now,readAt:null};this.base.state.supplyOrderMessages.push(row);this.base.state.supplyNotifications.unshift(notification);await this.base.save();});
    return {id:row.id,orderId:row.orderId,senderType:row.senderType,body:row.body,createdAt:row.createdAt};
  }
  async createNotification(actorType,actorId,type,title,body,entityType,entityId,dbClient=null) {
    if(!['supplier','merchant'].includes(actorType)||!actorId)return null;const row={id:uid(),actorType,actorId,type:text(type,60),title:text(title,160),body:text(body,500),entityType:text(entityType,60),entityId:text(entityId,100),createdAt:new Date().toISOString(),readAt:null};
    if(this.pg){const db=dbClient||this.base.pool;const {rows}=await db.query(`INSERT INTO supply_notifications (id,actor_type,actor_id,type,title,body,entity_type,entity_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id,actor_type AS "actorType",actor_id AS "actorId",type,title,body,entity_type AS "entityType",entity_id AS "entityId",created_at AS "createdAt",read_at AS "readAt"`,[row.id,row.actorType,row.actorId,row.type,row.title,row.body,row.entityType,row.entityId]);return rows[0]||null;}
    await this._lock(async()=>{this.base.state.supplyNotifications.unshift(row);await this.base.save();});return clone(row);
  }
  async listNotifications(actorType,actorId) {
    if(this.pg){const {rows}=await this.base.pool.query(`SELECT id,type,title,body,entity_type AS "entityType",entity_id AS "entityId",created_at AS "createdAt",read_at AS "readAt" FROM supply_notifications WHERE actor_type=$1 AND actor_id=$2 ORDER BY created_at DESC LIMIT 100`,[actorType,actorId]);return rows;}
    return this.base.state.supplyNotifications.filter((row)=>row.actorType===actorType&&row.actorId===actorId).slice(0,100).map(clone);
  }
  async markNotificationRead(actorType,actorId,id) {
    if(this.pg){const {rowCount}=await this.base.pool.query(`UPDATE supply_notifications SET read_at=NOW() WHERE id=$1 AND actor_type=$2 AND actor_id=$3 AND read_at IS NULL`,[id,actorType,actorId]);return rowCount>0;}
    return this._lock(async()=>{const row=this.base.state.supplyNotifications.find((item)=>item.id===id&&item.actorType===actorType&&item.actorId===actorId);if(!row)return false;if(!row.readAt){row.readAt=new Date().toISOString();await this.base.save();}return true;});
  }
}

module.exports={SupplierCommerceStore,safeSupplier,safeProduct,safeRequest,safeQuote,safeOrder,categoriesOf,text,err};
