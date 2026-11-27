const {chromium}=require('/tmp/node_modules/playwright');
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 const p=await b.newPage();
 await p.goto('http://127.0.0.1:3720/merchant/',{waitUntil:'networkidle'});
 await p.fill('#loginUsername','baobab377639'); await p.fill('#loginPassword','482913');
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(2500);
 const out=await p.evaluate(()=>{
   const btn=document.querySelector('#workspaceMenu button[data-rubric="ops"]');
   const cs=getComputedStyle(btn);
   const side=document.getElementById('m14Side');
   const cur=document.querySelector('#workspaceMenu button[aria-current="page"]');
   return {btnBg:cs.backgroundColor,btnColor:cs.color,btnBorder:cs.borderTopColor,radius:cs.borderRadius,
     sideBg:getComputedStyle(side).backgroundColor,
     curBg:cur?getComputedStyle(cur).backgroundColor:'',curColor:cur?getComputedStyle(cur).color:'',
     sheets:[...document.styleSheets].map(s=>s.href&&s.href.split('/').pop())};
 });
 console.log(JSON.stringify(out,null,1));
 await b.close();
})();
