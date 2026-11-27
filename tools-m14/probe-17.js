const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 // qui appelle openTab avec undefined ? on pose un Error et on regarde TOUS les appels avec arguments
 const out=await p.evaluate(async()=>{
   const calls=[];
   const orig=window.WorkspaceUI.openTab;
   window.WorkspaceUI.openTab=function(t,n,o){ calls.push({t:t===undefined?'UNDEF':t,n,o:o||null, stack:new Error().stack.split('\n').slice(1,7).map(s=>s.trim().replace(/https?:\/\/[^ )]+/g,''))}); return orig(t,n,o); };
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1000));
   return calls.filter(c=>c.t==='UNDEF');
 });
 console.log(JSON.stringify(out,null,1).slice(0,1200));
 await b.close();
})();
