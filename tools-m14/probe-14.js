const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 const r=await p.evaluate(async()=>{
   const calls=[];
   const orig=window.WorkspaceUI.openTab;
   window.WorkspaceUI.openTab=(t,n,o)=>{calls.push('openTab('+t+','+n+','+JSON.stringify(o||{})+')'); return orig(t,n,o);};
   const origTabFor=window.WorkspaceUI.targetPanelFor;
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1200));
   return calls;
 });
 console.log(r.join('\n'));
 await b.close();
})();
