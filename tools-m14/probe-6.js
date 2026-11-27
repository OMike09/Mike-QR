const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 p.on('console',m=>{if(m.type()==='error')console.log('ERR',m.text().slice(0,140))});
 p.on('pageerror',e=>console.log('PAGEERR',e.message.slice(0,140)));
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 const snap=async(tag)=>{const s=await p.evaluate(()=>({panels:[...document.querySelectorAll('[id^="panel-"]')].filter(n=>n.offsetHeight>0).map(n=>n.id),
   hidden:[...document.querySelectorAll('[id^="panel-"]')].map(n=>n.id+':'+(n.hidden?'h':'v')).slice(0,12)}));
   console.log(tag,JSON.stringify(s));};
 // comparer : chemin hub (référence) puis chemin sous-menu (nouveau)
 await p.click('#workspaceMenu button[data-rubric="team"]'); await p.waitForTimeout(900);
 console.log('hub affiché:', await p.evaluate(()=>!!document.querySelector('#panel-hub-team')?.offsetHeight));
 await p.click('#panel-hub-team [data-hub-tab="ops"]'); await p.waitForTimeout(1200); await snap('hub→points');
 await p.click('#workspaceMenu button[data-rubric="team"]'); await p.waitForTimeout(700);
 await p.evaluate(()=>{const btn=[...document.querySelectorAll('#m14Sub button')].find(n=>n.dataset.subTab==='ops'); console.log('submenu click', btn?.dataset); btn.click();});
 await p.waitForTimeout(1200); await snap('sub→points');
 await b.close();
})();
