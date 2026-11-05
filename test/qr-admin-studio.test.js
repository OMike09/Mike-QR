'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const src=fs.readFileSync(path.join(__dirname,'../public/qr-admin-studio.js'),'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaHjwHwAExAKAc00zmAAAAABJRU5ErkJggg==';
test('console PDG studio: éditeur de modèle, champs ordonnables et gestion d’image liée à l’API',async()=>{
  const dom=new JSDOM('<!doctype html><div id="qrStudioRoot"></div>',{url:'https://studio.oymike.example/admin',runScripts:'dangerously',pretendToBeVisual:true});
  const {window}=dom;const calls=[];let models=[];let gallery=[{id:'asset-a',title:'Cascade',categoryId:'cascades',description:'',alt:'Cascade',image,active:true,order:0}];
  window.fetch=async(url,init={})=>{
    const path=String(url);calls.push({path,init});let data={};
    if(path==='/api/admin/qr-templates'&&init.method==='POST'){const body=JSON.parse(init.body);const item={...body,id:'custom-console-test',version:1,groupId:'pdg-restauration',group:body.collectionLabel,enabled:body.enabled,sections:body.sections,fields:body.fields,defaultGroups:body.defaultGroups,order:models.length};models=[...models,item];data={data:item};}
    else if(path==='/api/admin/qr-templates')data={data:models,categories:[{id:'cat-shops',name:'Commerces'}]};
    else if(path==='/api/admin/design-gallery'&&(!init.method||init.method==='GET'))data={data:gallery,categories:[]};
    else if(path==='/api/admin/design-gallery/asset-a'&&init.method==='PUT'){const body=JSON.parse(init.body);gallery=gallery.map(item=>item.id==='asset-a'?{...item,...body}:item);data={data:gallery[0]};}
    else if(path==='/api/admin/categories')data={data:[{id:'cat-shops',name:'Commerces'}]};
    else data={error:'API de test non prévue'};
    return{ok:!data.error,status:data.error?404:200,json:async()=>data};
  };
  window.eval(src);const toastMessages=[];await window.QRIAQRStudio.mount({root:window.document.getElementById('qrStudioRoot'),toast:message=>toastMessages.push(message)});
  const root=window.document.getElementById('qrStudioRoot');root.querySelector('[data-studio-action="new-model"]').click();
  const form=root.querySelector('#qrTemplateEditor');assert.ok(form);form.querySelector('[name="label"]').value='Maquis de test';form.querySelector('[name="collectionLabel"]').value='Restauration';form.querySelector('[name="description"]').value='Menu et coordonnées';
  const sectionKey=form.querySelector('[data-section-key]');sectionKey.value='menu';form.querySelector('[data-section-title]').value='Menu';
  root.querySelector('[data-studio-action="add-field"]').click();
  const activeForm=root.querySelector('#qrTemplateEditor');const field=activeForm.querySelector('.studio-field-row');assert.ok(field);field.querySelector('[data-field-key]').value='signature';field.querySelector('[data-field-label]').value='Plat signature';
  activeForm.dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();await tick();
  assert.ok(calls.some(call=>call.path==='/api/admin/qr-templates'&&call.init.method==='POST'));
  assert.ok(root.textContent.includes('Maquis de test'));assert.ok(root.textContent.includes('Restauration'),root.textContent);
  root.querySelector('[data-studio-tab="gallery"]').click();assert.ok(root.querySelector('.studio-gallery-card img'));assert.equal(root.querySelector('.studio-gallery-card img').getAttribute('src'),image);
  root.querySelector('[data-studio-action="toggle-asset"]').click();await tick();await tick();
  assert.ok(calls.some(call=>call.path==='/api/admin/design-gallery/asset-a'&&call.init.method==='PUT'));
  assert.ok(root.textContent.includes('Masquée'));assert.ok(toastMessages.length>=1);
  dom.window.close();
});
