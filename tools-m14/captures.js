const {chromium}=require(process.env.PLAYWRIGHT_PATH||'/tmp/node_modules/playwright');
const fs=require('fs'),path=require('path');
const BASE='http://127.0.0.1:3720';
const acc=JSON.parse(fs.readFileSync(path.join(__dirname,'recette.json'),'utf8'));
const out=process.env.OUT||'/home/user/colis-m14/OYMIKE-MISSION14/captures';
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const b=await chromium.launch({args:['--no-sandbox']});
 // --- ordinateur
 const ctx=await b.newContext({viewport:{width:1440,height:1000}});
 const p=await ctx.newPage();
 await p.goto(BASE+'/merchant/',{waitUntil:'domcontentloaded'}); await p.waitForTimeout(1200);
 await p.fill('#loginUsername',acc.username); await p.fill('#loginPassword',acc.password);
 await p.click('#loginForm button[type=submit]'); await p.waitForTimeout(3000);
 await p.screenshot({path:`${out}/01-accueil-ordinateur.png`});
 for(const [rubric,name] of [['tables','03-tables'],['team','05-mon-equipe'],['history','06-historiques'],['settings','07-parametres'],['overview','08-vue-ensemble'],['ops','04-commandes']]){
   await p.click(`#workspaceMenu button[data-rubric="${rubric}"]`); await p.waitForTimeout(1500);
   await p.screenshot({path:`${out}/${name}.png`});
 }
 for(const theme of ['black-gold','blue-white']){
   await p.evaluate((t)=>window.WorkspaceShell.applyTheme(t),theme); await p.waitForTimeout(900);
   await p.screenshot({path:`${out}/09-theme-${theme}.png`});
 }
 await p.evaluate(()=>window.WorkspaceShell.applyTheme('green')); await p.waitForTimeout(600);
 await ctx.close();
 // --- téléphone
 const m=await b.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
 const mp=await m.newPage();
 await mp.goto(BASE+'/merchant/',{waitUntil:'domcontentloaded'}); await mp.waitForTimeout(1200);
 await mp.fill('#loginUsername',acc.username); await mp.fill('#loginPassword',acc.password);
 await mp.click('#loginForm button[type=submit]'); await mp.waitForTimeout(3000);
 await mp.screenshot({path:`${out}/10-accueil-telephone.png`});
 await mp.click('#m14MenuToggle'); await mp.waitForTimeout(700);
 await mp.screenshot({path:`${out}/11-menu-telephone.png`});
 await mp.click('#workspaceMenu button[data-rubric="tables"]'); await mp.waitForTimeout(1600);
 await mp.screenshot({path:`${out}/12-tables-telephone.png`});
 await m.close();
 // --- tablette
 const t=await b.newContext({viewport:{width:834,height:1000},hasTouch:true});
 const tp=await t.newPage();
 await tp.goto(BASE+'/merchant/',{waitUntil:'domcontentloaded'}); await tp.waitForTimeout(1200);
 await tp.fill('#loginUsername',acc.username); await tp.fill('#loginPassword',acc.password);
 await tp.click('#loginForm button[type=submit]'); await tp.waitForTimeout(2800);
 await tp.screenshot({path:`${out}/13-accueil-tablette.png`});
 await t.close();
 await b.close();
 console.log('captures:',fs.readdirSync(out).sort().join(', '));
})();
