const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 await p.evaluate(()=>{const btn=[...document.querySelectorAll('#m14Sub button')].find(n=>n.dataset.subTab==='ops'); btn.click();});
 await p.waitForTimeout(1500);
 const st=await p.evaluate(()=>({panels:[...document.querySelectorAll('[id^="panel-"]')].filter(n=>n.offsetHeight>0).map(n=>n.id),
   opsTabs:[...document.querySelectorAll('[data-ops-tab]')].map(n=>[n.dataset.opsTab,n.offsetHeight>0,n.getAttribute('aria-pressed'),n.className.slice(0,30)]).slice(0,8),
   active:document.querySelector('#workspaceMenu [aria-current="page"]')?.dataset.rubric}));
 console.log(JSON.stringify(st,null,1));
 await b.close();
})();
