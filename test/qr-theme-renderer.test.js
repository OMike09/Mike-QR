'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRenderer() {
  const source = fs.readFileSync(path.join(__dirname, '../public/qr-profile-renderer.js'), 'utf8');
  const listeners = {};
  const article = { style:{ values:{}, setProperty(name,value){this.values[name]=String(value);} }, dataset:{} };
  const rootElement = {
    innerHTML:'', dataset:{}, listeners,
    querySelector(selector){ return selector === '.qr-experience' ? article : null; },
    addEventListener(name,fn){ listeners[name]=fn; },
  };
  const document = { body:{ style:{} }, addEventListener(){} };
  const window = { location:{ origin:'https://oymike.example', href:'https://oymike.example/r/demo' }, matchMedia(){return {matches:false};} };
  const context = { window, document, URL, Intl, JSON, Math, Number, String, Object, Array, Map, encodeURIComponent, console };
  vm.runInNewContext(source, context, { filename:'qr-profile-renderer.js' });
  return { renderer:window.QRIAProfile, rootElement, article, document, window };
}

const baseTheme = {
  colors:{ pageBg:'#FF0000', mainBg:'#006B45', card:'#FFFFFF', panel:'#F4F8F5', title:'#173B2E', subtitle:'#315B4C', description:'#20352B', price:'#176B52', button:'#173B2E', buttonText:'#FFFFFF', icon:'#176B52', border:'#CAD9D0', separator:'#DCE8E0', menuBg:'#DDF3E8', menuText:'#14543D', link:'#116B4B', badgeBg:'#DDF3E8', badgeText:'#14543D' },
  typography:{ title:{family:'Poppins',size:42,weight:800,italic:true,align:'center',lineHeight:1.1,letterSpacing:-.02,transform:'uppercase'}, subtitle:{family:'Montserrat',size:18,weight:600,align:'center'}, description:{family:'Merriweather',size:17,weight:400}, price:{family:'Roboto',size:26,weight:800}, button:{family:'Inter',size:15,weight:700} },
  backgroundStyle:{ type:'gradient', color1:'#FF0000', color2:'#006B45', color3:'#FFFFFF', angle:135, panelOpacity:92 },
  components:{ radius:18,borderWidth:1,spacing:26,buttonShape:'pill',shadow:'medium',gridColumns:2,coverHeight:320,coverPositionX:55,coverPositionY:42,enableAnimation:true },
  style:'premium', layout:'grid',
};

test('renderer applique les variables sur le composant qui les consomme et reflète le thème en direct', () => {
  const { renderer, rootElement, article } = loadRenderer();
  renderer.render(rootElement, { qr:{title:'Page test',publicCode:'demo'}, beneficiary:{name:'Démo'}, profileData:{templateId:'restaurant',entityName:'Démo',theme:baseTheme} }, { preview:true });
  assert.equal(article.style.values['--experience-page-bg'], '#FF0000');
  assert.equal(article.style.values['--experience-main-background'], '#006B45');
  assert.equal(article.style.values['--experience-title'], '#173B2E');
  assert.equal(article.style.values['--experience-title-family'], '"Poppins",ui-sans-serif,system-ui,sans-serif');
  assert.equal(article.style.values['--experience-price-size'], 'clamp(16px, 3.0588235294117645vw, 26px)');
  assert.match(article.style.backgroundImage, /linear-gradient\(135deg, #FF0000, #006B45, #FFFFFF\)/);
  assert.equal(article.dataset.experienceStyle, 'premium');
  assert.equal(article.dataset.experienceLayout, 'grid');
  assert.match(rootElement.innerHTML, /qr-experience/);
  assert.equal(rootElement.dataset.preview, 'true');
});

test('renderer applique la couleur au document public et sécurise l’image de fond après chargement', () => {
  const { renderer, rootElement, article, document } = loadRenderer();
  const imageTheme = { ...baseTheme, colors:{...baseTheme.colors,pageBg:'#000000',mainBg:'#000000',title:'#FFFFFF',subtitle:'#EEEEEE',description:'#F3F3F3',panel:'#222222',card:'#111111'},
    backgroundStyle:{type:'image',image:'data:image/png;base64,AA==',imageOpacity:100,color1:'#000000',panelOpacity:96} };
  renderer.render(rootElement, { qr:{title:'Page test'}, beneficiary:{name:'Démo'}, profileData:{theme:imageTheme} });
  assert.equal(document.body.style.backgroundColor, '#000000');
  assert.equal(article.style.values['--experience-page-bg'], '#000000');
  assert.match(article.style.backgroundImage, /data:image\/png;base64,AA==/);
  assert.equal(rootElement.dataset.preview, undefined);
});

test('pied de page personnalisé et champs PDG sont réellement rendus sur la page publique',()=>{
  const {renderer,rootElement}=loadRenderer();
  const snapshot={id:'custom-restaurant',label:'Menu du maquis',sections:[{id:'menu',title:'Menu du jour',description:'Spécialités disponibles'}],fields:[{key:'specialite',label:'Spécialité',type:'text',sectionId:'menu'},{key:'menuUrl',label:'Menu en ligne',type:'url',sectionId:'menu'}]};
  renderer.render(rootElement,{qr:{title:'Chez Awa'},beneficiary:{name:'Chez Awa'},profileData:{templateId:snapshot.id,templateLabel:snapshot.label,templateSnapshot:snapshot,customFields:{specialite:'Poisson braisé',menuUrl:'https://example.ci/menu'},theme:{...baseTheme,components:{...baseTheme.components,footerText:'Merci pour votre visite.',footerLink:'https://example.ci/contact'}}}},{preview:true});
  assert.match(rootElement.innerHTML,/Menu du jour/);
  assert.match(rootElement.innerHTML,/Poisson braisé/);
  assert.match(rootElement.innerHTML,/href="https:\/\/example\.ci\/menu"/);
  assert.match(rootElement.innerHTML,/Merci pour votre visite\./);
  assert.match(rootElement.innerHTML,/href="https:\/\/example\.ci\/contact"/);
});
