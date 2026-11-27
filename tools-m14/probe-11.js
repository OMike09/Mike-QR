const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,200)));
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 const r=await p.evaluate(async()=>{
   const trace=[];
   const node=document.getElementById('panel-ops');
   const d=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'hidden');
   Object.defineProperty(node,'hidden',{configurable:true,get(){return d.get.call(this);},set(v){trace.push(v+' @ '+(new Error().stack.split('\n')[2]||'').trim().replace('http://127.0.0.1:3720','')); d.set.call(this,v);}});
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1200));
   trace.push('fin hidden='+node.hidden);
   return trace.slice(0,10);
 });
 console.log(r.join('\n'));
 await b.close();
})();
