const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,200)));
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 await p.evaluate(()=>{window.__err=[];window.addEventListener('error',e=>window.__err.push(e.message));});
 await p.click('#workspaceMenu button[data-rubric="team"]'); await p.waitForTimeout(700);
 const btn=await p.evaluate(()=>{const b=document.querySelector('#panel-hub-team [data-hub-tab="ops"]');return b?{txt:b.innerText.slice(0,40),ops:b.dataset.hubOps,h:b.offsetHeight}:null;});
 console.log('bouton hub ops:',JSON.stringify(btn));
 await p.click('#panel-hub-team [data-hub-tab="ops"]',{force:true}); await p.waitForTimeout(1400);
 console.log('après clic hub:', JSON.stringify(await p.evaluate(()=>({
   err:window.__err, panelOps:(()=>{const n=document.getElementById('panel-ops');return n?{h:n.hidden,off:n.offsetHeight}:null;})(),
   panels:[...document.querySelectorAll('[id^="panel-"]')].filter(n=>n.offsetHeight>0).map(n=>n.id),
   opsView:window.MerchantOps?Object.keys(window.MerchantOps):null,
   activeTab:document.querySelector('.tab.active')?.dataset.tab}))));
 await b.close();
})();
