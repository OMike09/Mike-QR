const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,200)));
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 console.log('API:',await p.evaluate(()=>Object.keys(window.WorkspaceUI||{})));
 await p.evaluate(()=>window.WorkspaceUI.openTab('ops',true,{opsTab:'points'}));
 await p.waitForTimeout(1500);
 console.log(JSON.stringify(await p.evaluate(()=>({panels:[...document.querySelectorAll('[id^="panel-"]')].filter(n=>n.offsetHeight>0).map(n=>n.id),
   opsHidden:document.getElementById('panel-ops')?.hidden,
   opsClass:document.getElementById('panel-ops')?.className,
   style:getComputedStyle(document.getElementById('panel-ops')).display}))));
 await b.close();
})();
