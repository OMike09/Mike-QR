const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 const log=await p.evaluate(async()=>{
   const out=[]; const node=document.getElementById('panel-ops');
   const obs=new MutationObserver((ms)=>{ms.forEach(m=>out.push(m.attributeName+' -> '+(m.target===node?node.hidden:'?')));});
   obs.observe(node,{attributes:true,attributeFilter:['hidden','class']});
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1500));
   obs.disconnect();
   return {events:out.slice(0,12),hidden:node.hidden,parent:node.parentElement.id||node.parentElement.className.slice(0,20)};
 });
 console.log(JSON.stringify(log,null,1));
 await b.close();
})();
