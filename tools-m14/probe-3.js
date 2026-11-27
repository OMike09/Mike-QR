const {chromium}=require('/tmp/node_modules/playwright');
const acc=JSON.parse(require('fs').readFileSync(__dirname+'/recette.json','utf8'));
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await (await b.newContext({viewport:{width:1440,height:900}})).newPage();
 p.on('console',m=>console.log('  console:',m.type(),m.text().slice(0,100)));
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2600);
 await p.evaluate(()=>{window.__calls=0; const orig=window.WorkspaceShell.confirmLogout; window.WorkspaceShell.confirmLogout=(fn)=>{window.__calls++; return orig(fn);};});
 console.log('listeners?',await p.evaluate(()=>typeof window.__wsLogout));
 const r=await p.evaluate(()=>{const b=document.getElementById('mhLogout'); const ev=new MouseEvent('click',{bubbles:true,cancelable:true}); const prevented=!b.dispatchEvent(ev); return {prevented,visible:!!window.WorkspaceShell};});
 console.log('dispatch:',r,'confirmLogout appelé:',await p.evaluate(()=>window.__calls));
 await p.waitForTimeout(600);
 console.log('dialog visible:',await p.evaluate(()=>{const d=[...document.querySelectorAll('[hidden]')];const w=[...document.querySelectorAll('*')].filter(n=>n.id.includes('logout')||/logout/i.test(n.className)).map(n=>[n.id,n.className,n.hidden,n.offsetHeight]);return w;}));
 await b.close();
})();
