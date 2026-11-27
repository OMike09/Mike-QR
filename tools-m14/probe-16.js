const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 const out=await p.evaluate(async()=>{
   const log=[];
   const orig=window.WorkspaceUI.openTab;
   const logErr=(err)=>log.push('ERR '+err.message+' | '+err.stack.split('\n').slice(1,4).join(' | ').replace(/https?:\/\/[^ ]+/g,''));
   window.WorkspaceUI.openTab=function(t,n,o){ try { return orig(t,n,o); } catch(e){ logErr(e); throw e; } };
   const origTab=window.__wsOnTab;
   window.WorkspaceUI.openTab('ops',true,{opsTab:'points'});
   await new Promise(r=>setTimeout(r,1000));
   return log;
 });
 console.log(out.join('\n') || 'aucune exception capturée');
 await b.close();
})();
