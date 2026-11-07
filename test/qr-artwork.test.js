'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
test('QR imprimable: générateur vectoriel, marge de silence, logo avec correction élevée, coins et cadre',()=>{
  const dom=new JSDOM('<!doctype html><canvas></canvas>',{url:'https://oymike.example',runScripts:'dangerously'});
  for(const asset of ['vendor/qrcode.js','vendor/qrcode_UTF8.js','qr-artwork.js'])dom.window.eval(fs.readFileSync(path.join(__dirname,'../public',asset),'utf8'));
  const logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNQaHjwHwAExAKAc00zmAAAAABJRU5ErkJggg==';
  const style={foreground:'#111111',background:'#FFFFFF',correction:'M',dotStyle:'dots',eyeStyle:'rounded',frameStyle:'poster',frameColor:'#112233',frameTextColor:'#FFFFFF',labelTop:'<Scannez & consultez>',labelBottom:'Oymike QR',logo,logoScale:10};
  const svg=dom.window.QRIAQRArtwork.createSvg('https://oymike.example/r/ABC123',style,1200);
  assert.match(svg,/viewBox="0 0 456 /);assert.match(svg,/&lt;Scannez &amp; consultez&gt;/);assert.match(svg,/fill="#112233"/);assert.match(svg,/data:image\/png;base64,/);assert.match(svg,/rx="[0-9.]+" fill="#111111"/);
  assert.doesNotMatch(svg,/<script/i);
  assert.ok(svg.length>5000);
  assert.equal(dom.window.QRIAQRArtwork.matrixFor('https://oymike.example/r/ABC123',style).length>20,true);
  dom.window.close();
});

test('QR canvas: l’aperçu reste fonctionnel sous la CSP sans URL blob',async()=>{
  const dom=new JSDOM('<!doctype html><canvas></canvas>',{url:'https://oymike.example',runScripts:'dangerously'});
  const {window}=dom;for(const asset of ['vendor/qrcode.js','vendor/qrcode_UTF8.js','qr-artwork.js'])window.eval(fs.readFileSync(path.join(__dirname,'../public',asset),'utf8'));
  const imageSources=[],drawn=[];
  window.URL.createObjectURL=()=>{throw new Error('blob: interdit par la CSP');};
  window.Image=class {constructor(){this.width=480;this.height=455;}set src(value){this._src=value;imageSources.push(value);queueMicrotask(()=>this.onload?.());}get src(){return this._src;}};
  window.HTMLCanvasElement.prototype.getContext=function(){return {fillStyle:'',imageSmoothingEnabled:false,fillRect(){},drawImage(image){drawn.push(image.src);}};};
  const canvas=window.document.querySelector('canvas');
  await window.QRIAQRArtwork.renderCanvas(canvas,'https://oymike.example/r/ABC123',{},480);
  assert.equal(canvas.width,480);assert.equal(canvas.height,455);
  assert.equal(imageSources.length,1);assert.match(imageSources[0],/^data:image\/svg\+xml;charset=utf-8,/);
  assert.match(decodeURIComponent(imageSources[0].split(',').slice(1).join(',')),/^<svg /);
  assert.deepEqual(drawn,imageSources);
  dom.window.close();
});

test('QR SVG/PNG: génération et déclenchement des téléchargements sans objet blob pour le rendu image',async()=>{
  const dom=new JSDOM('<!doctype html><body></body>',{url:'https://oymike.example',runScripts:'dangerously'});const {window}=dom;
  window.Blob=Blob;for(const asset of ['vendor/qrcode.js','vendor/qrcode_UTF8.js','qr-artwork.js'])window.eval(fs.readFileSync(path.join(__dirname,'../public',asset),'utf8'));
  const blobs=[],downloads=[];let objectUrl=0;
  window.URL.createObjectURL=(blob)=>{blobs.push(blob);objectUrl+=1;return `blob:download-${objectUrl}`;};window.URL.revokeObjectURL=()=>{};
  window.HTMLAnchorElement.prototype.click=function(){downloads.push({href:this.href,filename:this.download});};
  window.Image=class{constructor(){this.width=1600;this.height=1516;}set src(value){this._src=value;queueMicrotask(()=>this.onload?.());}get src(){return this._src;}};
  window.HTMLCanvasElement.prototype.getContext=function(){return {fillStyle:'',imageSmoothingEnabled:false,fillRect(){},drawImage(){}};};
  window.HTMLCanvasElement.prototype.toBlob=function(callback,type){callback(new Blob(['png-test-bytes'],{type}));};
  await window.QRIAQRArtwork.download('https://oymike.example/r/DOWNLOAD123',{},'qr-download-test','svg');
  await window.QRIAQRArtwork.download('https://oymike.example/r/DOWNLOAD123',{},'qr-download-test','png');
  assert.equal(downloads.length,2);assert.deepEqual(downloads.map((item)=>item.filename),['qr-download-test.svg','qr-download-test.png']);
  assert.match(await blobs[0].text(),/^<svg /);assert.equal(blobs[1].type,'image/png');assert.equal(await blobs[1].text(),'png-test-bytes');
  dom.window.close();
});
