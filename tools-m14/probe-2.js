const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 console.log('submenu:', await p.evaluate(()=>[...document.querySelectorAll('#m14Sub button')].map(b=>[b.dataset.subTab,b.dataset.subOps,b.offsetHeight])));
 const info=await p.evaluate(()=>({sideCls:document.getElementById('m14Side').className,
   logout:document.querySelector('#m14Side #mhLogout')?{id:document.querySelector('#m14Side #mhLogout').id,rect:document.querySelector('#m14Side #mhLogout').getBoundingClientRect().toJSON()}:null,
   dialogs:[...document.querySelectorAll('[id*=logout],[class*=logout]')].map(n=>n.id||n.className)}));
 console.log(JSON.stringify(info,null,1).slice(0,600));
 await p.click('#m14Side #mhLogout'); await p.waitForTimeout(1200);
 console.log('après clic:', await p.evaluate(()=>({appHidden:document.getElementById('appView')?.hidden,
   dialogs:[...document.querySelectorAll('dialog,[id*=logout],[class*=logout]')].filter(n=>n.offsetHeight>0).map(n=>[n.id,n.className,(n.innerText||'').slice(0,90)])})));
 await p.screenshot({path:'/tmp/after-logout.png'});
 await b.close();
})();
