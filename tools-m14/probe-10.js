const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,200)));
 p.on('console',m=>{if(m.type()==='error')console.log('CONSOLE',m.text().slice(0,140));});
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 const r=await p.evaluate(async()=>{
   const trace=[];
   const origOpenView=window.MerchantOps.openView;
   window.MerchantOps.openView=(v)=>{trace.push('openView('+v+')'); return origOpenView(v);};
   const node=document.getElementById('panel-ops');
   const origDesc=Object.getOwnPropertyDescriptor(HTMLElement.prototype,'hidden');
   Object.defineProperty(node,'hidden',{configurable:true,get(){return origDesc.get.call(this);},set(v){ trace.push('panel-ops.hidden='+v+' @'+(new Error().stack.split('\n')[2]||'').trim().slice(0,80)); origDesc.set.call(this,v);}});
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1400));
   return {trace:trace.slice(0,14), hidden:node.hidden};
 });
 console.log(JSON.stringify(r,null,1));
 await b.close();
})();
