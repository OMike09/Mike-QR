const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 // vérifier l'API exposée
 console.log('targetPanelFor ops =', await p.evaluate(()=>window.WorkspaceUI.targetPanelFor('ops')));
 const log=await p.evaluate(async()=>{
   const node=document.getElementById('panel-ops'); const out=[];
   const d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'hidden');
   Object.defineProperty(node,'hidden',{configurable:true,get(){return d.get.call(this);},set(v){out.push(v+' @ '+new Error().stack.split('\n')[2].trim().slice(-60)); d.set.call(this,v);}});
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1200));
   return {out, final:node.hidden};
 });
 console.log(JSON.stringify(log,null,1));
 await b.close();
})();
