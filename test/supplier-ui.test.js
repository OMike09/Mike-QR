'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {JSDOM}=require('jsdom');

const root=path.resolve(__dirname,'..');
const wait=(ms=10)=>new Promise((resolve)=>setTimeout(resolve,ms));
function response(data,status=200){return{ok:status>=200&&status<300,status,async json(){return JSON.parse(JSON.stringify(data));}};}

const order={id:'supply-order-ui-1',reference:'SUP-UI-001',status:'pending_supplier',createdAt:'2026-10-09T09:00:00.000Z',storeName:'Boutique UI',supplierName:'Fournisseur UI',items:[{name:'Emballage',quantity:4,lineTotalXof:8000}],totalXof:8000,deliveryAddress:'Abidjan',events:[]};

test('espace fournisseur : échange de messages rendu, envoyé et rechargé par API',async(t)=>{
  const html=await fs.readFile(path.join(root,'public/supplier.html'),'utf8');const script=await fs.readFile(path.join(root,'public/supplier.js'),'utf8');
  const dom=new JSDOM(html,{url:'https://example.test/supplier/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());const w=dom.window;const calls=[];
  const supplier={id:'supplier-ui-1',username:'fournisseur.ui',companyName:'Fournisseur UI',status:'active',publicCode:'S-UI001',categories:['Emballage']};
  const messages=[{id:'message-1',orderId:order.id,senderType:'merchant',body:'Pouvez-vous confirmer le délai ?',createdAt:'2026-10-09T09:05:00.000Z'}];
  w.fetch=async(url,options={})=>{const path=String(url);const method=options.method||'GET';const body=options.body?JSON.parse(options.body):{};calls.push({path,method,body});
    if(path==='/api/supplier/auth/me'||path==='/api/supplier/profile')return response({data:supplier});
    if(path==='/api/supplier/products')return response({data:[]});if(path==='/api/supplier/sourcing-requests')return response({data:[]});if(path==='/api/supplier/quotes')return response({data:[]});
    if(path==='/api/supplier/orders')return response({data:[order]});if(path==='/api/supplier/notifications')return response({data:[]});if(path==='/api/supplier/qr')return response({data:{url:'https://example.test/v/S-UI001',path:'/v/S-UI001'}});
    if(path===`/api/supplier/orders/${order.id}/messages`&&method==='GET')return response({data:messages});
    if(path===`/api/supplier/orders/${order.id}/messages`&&method==='POST'){const row={id:'message-2',orderId:order.id,senderType:'supplier',body:body.body,createdAt:'2026-10-09T09:10:00.000Z'};messages.push(row);return response({data:row},201);}
    return response({error:`Unexpected request: ${method} ${path}`},404);
  };
  w.eval(script);await wait(30);
  assert.equal(w.document.querySelector('#appRoot').hidden,false);assert.match(w.document.querySelector('#orderList').textContent,/SUP-UI-001/);
  w.document.querySelector('[data-load-order-messages]').click();await wait();assert.match(w.document.querySelector('[data-order-messages]').textContent,/confirmer le délai/);
  const form=w.document.querySelector('[data-order-message-form]');form.querySelector('[data-message-body]').value='Livraison prévue vendredi.';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();
  assert.equal(calls.find((call)=>call.path.endsWith('/messages')&&call.method==='POST').body.body,'Livraison prévue vendredi.');
  assert.match(w.document.querySelector('[data-order-messages]').textContent,/Livraison prévue vendredi/);
});

test('espace marchand de sourcing : échange bilatéral avec le fournisseur via API',async(t)=>{
  const html=await fs.readFile(path.join(root,'public/sourcing.html'),'utf8');const script=await fs.readFile(path.join(root,'public/sourcing.js'),'utf8');
  const dom=new JSDOM(html,{url:'https://example.test/sourcing/',runScripts:'outside-only',pretendToBeVisual:true});t.after(()=>dom.window.close());const w=dom.window;const calls=[];
  const messages=[{id:'message-1',orderId:order.id,senderType:'supplier',body:'Disponible; livraison sous 48 h.',createdAt:'2026-10-09T09:05:00.000Z'}];
  w.fetch=async(url,options={})=>{const path=String(url);const method=options.method||'GET';const body=options.body?JSON.parse(options.body):{};calls.push({path,method,body});
    if(path==='/api/merchant/auth/me')return response({data:{id:'merchant-ui-1',displayName:'Boutique UI'}});if(path==='/api/merchant/store')return response({data:{id:'store-ui-1',name:'Boutique UI'}});
    if(path.startsWith('/api/merchant/sourcing/suppliers?'))return response({data:[]});if(path==='/api/merchant/sourcing/requests')return response({data:[]});if(path==='/api/merchant/sourcing/orders')return response({data:[order]});if(path==='/api/merchant/sourcing/notifications')return response({data:[]});
    if(path===`/api/merchant/sourcing/orders/${order.id}/messages`&&method==='GET')return response({data:messages});
    if(path===`/api/merchant/sourcing/orders/${order.id}/messages`&&method==='POST'){const row={id:'message-2',orderId:order.id,senderType:'merchant',body:body.body,createdAt:'2026-10-09T09:10:00.000Z'};messages.push(row);return response({data:row},201);}
    return response({error:`Unexpected request: ${method} ${path}`},404);
  };
  w.eval(script);await wait(30);
  assert.match(w.document.querySelector('#orderList').textContent,/SUP-UI-001/);
  w.document.querySelector('[data-load-order-messages]').click();await wait();assert.match(w.document.querySelector('[data-order-messages]').textContent,/sous 48 h/);
  const form=w.document.querySelector('[data-order-message-form]');form.querySelector('[data-message-body]').value='Merci, nous confirmons.';form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait();
  assert.equal(calls.find((call)=>call.path.endsWith('/messages')&&call.method==='POST').body.body,'Merci, nous confirmons.');
  assert.match(w.document.querySelector('[data-order-messages]').textContent,/nous confirmons/);
});
