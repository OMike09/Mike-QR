'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
async function text(relative){return fs.readFile(path.join(root,relative),'utf8');}
async function manifest(relative){return JSON.parse(await text(relative));}
async function pngSize(relative){const image=await fs.readFile(path.join(root,'public',relative.replace(/^\//,'')));assert.deepEqual([...image.subarray(0,8)],[137,80,78,71,13,10,26,10],`${relative} is a PNG`);return{width:image.readUInt32BE(16),height:image.readUInt32BE(20)};}

test('les trois PWA ont des identités, destinations, scopes et icônes indépendants',async()=>{
  const [legacyAdmin,admin,manager,merchant]=await Promise.all([
    manifest('public/manifest.webmanifest'),manifest('public/admin/manifest.webmanifest'),manifest('public/manager/manifest.webmanifest'),manifest('public/merchant/manifest.webmanifest'),
  ]);
  const apps=[admin,manager,merchant];
  assert.deepEqual(apps.map((app)=>app.id),['/admin/','/manager/','/merchant/']);
  assert.deepEqual(apps.map((app)=>app.start_url),['/admin/','/manager/','/merchant/']);
  assert.deepEqual(apps.map((app)=>app.scope),['/admin/','/manager/','/merchant/']);
  assert.equal(new Set(apps.map((app)=>app.id.replace(/\/$/,''))).size,3,'the normalized manifest IDs remain distinct');
  assert.ok(apps.every((app)=>app.display==='standalone'));
  assert.deepEqual(admin.icons,legacyAdmin.icons,'the PDG keeps the exact current icon set');
  // Mission 7 (demande du client) : le client, les marchands et leurs dépendants partagent le MÊME
  // logo officiel. Ce qui reste distinct, c'est l'identité, la destination et le périmètre de chaque
  // application — pas le visuel.
  const BRAND='/icons/oymike-brand/';
  for(const app of apps){
    assert.ok(app.icons.every((icon)=>icon.src.startsWith(BRAND)),'toutes les icônes viennent du logo officiel partagé');
    for(const size of ['192x192','512x512'])assert.ok(app.icons.some((icon)=>icon.sizes===size),`l'icône ${size} est déclarée`);
    assert.ok(app.icons.some((icon)=>icon.purpose==='maskable'),'une icône maskable est déclarée');
    assert.equal(app.shortcuts?.[0]?.url,app.start_url,'the launcher shortcut stays inside its app destination');
  }
  // et l'application CLIENT utilise exactement le même jeu d'icônes
  const client=await manifest('public/app/manifest.webmanifest');
  const equipe=await manifest('public/equipe/manifest.webmanifest');
  for(const app of [client,equipe]){
    assert.deepEqual(app.icons,apps[0].icons,'le client et l’espace équipe partagent le même logo que les espaces marchand et gestionnaire');
  }
  assert.equal(client.start_url,'/app/');
  assert.equal(equipe.start_url,'/equipe/');
  for(const app of apps.concat([client,equipe]))for(const icon of app.icons)assert.deepEqual(await pngSize(icon.src),{width:Number(icon.sizes.split('x')[0]),height:Number(icon.sizes.split('x')[1])});
  // Un seul logo pour tout le monde : les fichiers servis sont identiques, pas seulement ressemblants.
  for(const size of ['32','180','192','512','512-maskable']){
    const file = await fs.readFile(path.join(root,`public/icons/oymike-brand/oymike-${size}.png`));
    assert.ok(file.length > 0, `le logo partagé ${size} existe`);
    assert.equal((await pngSize(`/icons/oymike-brand/oymike-${size}.png`)).width, Number(size.split('-')[0]), `le logo ${size} est au bon format`);
  }
});

test('chaque écran de connexion référence sa PWA, son icône et son bouton d’installation',async()=>{
  const [adminHtml,managerHtml,merchantHtml,installJs,managerJs,merchantJs,adminCss]=await Promise.all([
    text('public/index.html'),text('public/manager.html'),text('public/merchant.html'),text('public/pwa-install.js'),text('public/manager.js'),text('public/merchant.js'),text('public/admin.css'),
  ]);
  assert.match(adminHtml,/rel="manifest" href="\/admin\/manifest\.webmanifest"/);
  assert.match(adminHtml,/id="loginScreen"[\s\S]*?Installer l’application Administrateur général/);
  assert.match(adminHtml,/href="\/admin\/merchant-control\/" aria-label="Gérer les comptes marchands"[\s\S]*?<span>Comptes marchands<\/span>/,'the PDG sidebar clearly exposes merchant-account management inside the installed-app scope');
  // Même logo partout (client, marchand, équipe, gestionnaire, PDG).
  assert.match(adminHtml,/href="\/icons\/oymike-brand\/oymike-180\.png"/,'the PDG touch icon uses the shared logo');
  assert.match(managerHtml,/rel="manifest" href="\/manager\/manifest\.webmanifest"/);
  assert.match(managerHtml,/id="loginView"[\s\S]*?Installer l’application Gestionnaire[\s\S]*?<\/main>/);
  assert.match(managerHtml,/href="\/icons\/oymike-brand\/oymike-180\.png"/);
  assert.match(managerHtml,/src="\/icons\/oymike-brand\/oymike-192\.png"/);
  assert.match(merchantHtml,/rel="manifest" href="\/merchant\/manifest\.webmanifest"/);
  assert.match(merchantHtml,/id="loginView"[\s\S]*?Installer l’application Marchand[\s\S]*?<\/main>/);
  assert.match(merchantHtml,/href="\/icons\/oymike-brand\/oymike-180\.png"/);
  assert.match(merchantHtml,/src="\/icons\/oymike-brand\/oymike-512\.png"/);
  const clientHtml=await text('public/app/index.html');
  const staffHtml=await text('public/staff.html');
  assert.match(clientHtml,/apple-touch-icon" sizes="180x180" href="\/icons\/oymike-brand\/oymike-180\.png"/);
  assert.match(clientHtml,/src="\/icons\/oymike-brand\/oymike-192\.png"/);
  assert.match(staffHtml,/rel="manifest" href="\/equipe\/manifest\.webmanifest"/);
  assert.match(staffHtml,/class="staff-brand"><img src="\/icons\/oymike-brand\/oymike-192\.png"/);
  assert.match(staffHtml,/class="staff-header-logo" src="\/icons\/oymike-brand\/oymike-192\.png"/);
  assert.match(merchantHtml,/\/pwa-install\.js/);
  assert.match(adminCss,/\.side-nav\{[^}]*overflow-y:auto/,'the PDG navigation scrolls instead of clipping the last sections on short screens');
  assert.match(adminCss,/\.sidebar-bottom\{flex:0 0 auto/,'the PDG account footer remains visible while the menu scrolls');
  for(const [html,role,prefix] of [[managerHtml,'manager','qria-manager'],[merchantHtml,'merchant','qria-merchant']]){
    const splashPaths=[...html.matchAll(/rel="apple-touch-startup-image" href="([^"]+)"/g)].map((match)=>match[1]);
    assert.equal(splashPaths.length,8,`${role} declares startup images for supported iPhone dimensions`);
    for(const splashPath of splashPaths){
      assert.ok(splashPath.includes('/icons/oymike-brand/oymike-startup-'),'les écrans de lancement portent le logo partagé');
      const dimensions=splashPath.match(/-(\d+)x(\d+)\.png$/);
      assert.ok(dimensions,`${splashPath} names its pixel dimensions`);
      // Les images de démarrage ont été réduites à 512 px de haut (poids du colis) : ce qui compte
      // est le ratio exact déduit du nom de fichier, pas une résolution native qui n'existe plus.
      const actual=await pngSize(splashPath);
      const expected=Number(dimensions[1])/Number(dimensions[2]);
      assert.ok(Math.abs(actual.width/actual.height-expected)<0.01,
        `${splashPath} conserve le ratio ${dimensions[1]}x${dimensions[2]} (réel ${actual.width}x${actual.height})`);
      assert.ok(actual.height<=512,`${splashPath} reste allégée (hauteur <= 512 px)`);
    }
  }
  assert.match(installJs,/register\('\/admin\/sw\.js',\{scope:'\/admin\/'\}\)/);
  assert.match(managerJs,/register\('\/manager\/sw\.js',\{scope:'\/manager\/'\}\)/);
  assert.match(merchantJs,/registerMerchantPwa\(\)/);
  assert.doesNotMatch(merchantJs,/beforeinstallprompt/,'the shared installer owns one prompt handler and supplies device-specific fallback instructions');
});

test('le manifeste PDG garde le branding actuel et les service workers restent à périmètre limité',async()=>{
  const [legacy,adminWorker,managerWorker,merchantWorker,serverSource]=await Promise.all([
    manifest('public/manifest.webmanifest'),text('public/admin/sw.js'),text('public/manager/sw.js'),text('public/merchant/sw.js'),text('server.js'),
  ]);
  const admin=await manifest('public/admin/manifest.webmanifest');
  // Mission 7 : le fond et la couleur de thème suivent désormais le logo officiel partagé
  // (#0d1015), pour que le lancement de l'application ne montre pas de flash blanc.
  for(const key of ['name','short_name','description','orientation','categories'])assert.deepEqual(admin[key],legacy[key],`PDG visual field ${key} stays unchanged`);
  // (le manifeste racine a lui aussi été aligné sur le logo partagé : les deux valent #0d1015)
  assert.equal(admin.theme_color,'#0d1015','la couleur de thème reprend le fond du logo partagé');
  for(const worker of [adminWorker,managerWorker])assert.doesNotMatch(worker,/caches\.open|cache\.put/,'private dashboard responses are never cached');
  assert.match(serverSource,/app\.get\('\/equipe\/manifest\.webmanifest'/,'le manifeste de l’espace équipe est servi sous son propre chemin');
  assert.match(merchantWorker,/url\.pathname\.startsWith\('\/api\/'\)/,'the merchant worker never caches authenticated API responses');
  assert.match(serverSource,/app\.get\(\['\/admin', '\/admin\/'\]/);
  assert.match(serverSource,/app\.get\(\['\/manager', '\/manager\/'\]/);
  assert.match(serverSource,/app\.get\(\['\/admin\/merchant-control', '\/admin\/merchant-control\/'\]/,'merchant account management also has an admin-scope entry for standalone PDG navigation');
  assert.match(serverSource,/app\.get\('\/merchant\/'/);
  assert.match(serverSource,/require\('\.\/manager-routes'\)/);
});
