const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 await p.click('#m14Side #mhLogout'); await p.waitForTimeout(800);
 const d=await p.evaluate(()=>{const n=document.getElementById('wsLogoutDialog'); if(!n) return 'absent';
   const cs=getComputedStyle(n); const r=n.getBoundingClientRect();
   return {hidden:n.hidden,display:cs.display,vis:cs.visibility,opacity:cs.opacity,z:cs.zIndex,rect:[r.x,r.y,r.width,r.height],cls:n.className,parent:n.parentElement.tagName};});
 console.log(JSON.stringify(d));
 await p.screenshot({path:'/tmp/dialog.png'});
 await b.close();
})();
