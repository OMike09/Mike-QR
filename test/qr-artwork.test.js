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
