const {chromium}=require('/tmp/node_modules/playwright');
const base='http://127.0.0.1:3720';
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 for(const [name,vp] of [['desktop',{width:1440,height:1000}],['tablette',{width:900,height:1000}],['telephone',{width:390,height:844}]]){
  const ctx=await b.newContext({viewport:vp,deviceScaleFactor:1});
  const p=await ctx.newPage();
  const errs=[]; p.on('pageerror',e=>errs.push(e.message.slice(0,100)));
  await p.goto(base+'/merchant/',{waitUntil:'networkidle'});
  await p.fill('#loginUsername','baobab377639'); await p.fill('#loginPassword','482913');
  await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2500);
  await p.screenshot({path:`/tmp/m14-${name}-home.png`});
  if(name!=='desktop'){
    await p.click('#m14MenuToggle'); await p.waitForTimeout(600);
    await p.screenshot({path:`/tmp/m14-${name}-menu.png`});
  }
  const st=await p.evaluate(()=>({
    sideOpen:document.getElementById('m14Side')?.className,
    submenu:[...document.querySelectorAll('#m14Sub button')].map(b=>b.innerText),
    logoutVisible:(()=>{const b=document.querySelector('#mhLogout'); if(!b)return false; const r=b.getBoundingClientRect(); return r.height>0;})(),
    topbar:getComputedStyle(document.getElementById('m14Topbar')).display,
    menuVisible:document.getElementById('m14Side').getBoundingClientRect().x>-10,
    overflowX:document.documentElement.scrollWidth>document.documentElement.clientWidth+2
  }));
  console.log(name, JSON.stringify(st), 'JS:',errs.slice(0,2));
  await ctx.close();
 }
 await b.close();
})();
