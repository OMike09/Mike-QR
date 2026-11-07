/* Shared, vector-based printable QR artwork. QR modules keep a four-module quiet zone. */
(function(root){
  'use strict';
  const esc=(value)=>String(value==null?'':value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const hex=(value,fallback)=>/^#[0-9a-f]{6}$/i.test(String(value||''))?String(value).toUpperCase():fallback;
  const label=(value)=>String(value||'').replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,80);
  const safeDataImage=(value)=>/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(String(value||''))?String(value):'';
  function matrixFor(data,style={}){
    if(typeof root.qrcode!=='function')throw new Error('Le moteur QR n’est pas chargé.');
    const logo=safeDataImage(style.logo);const correction=logo?'H':(['L','M','Q','H'].includes(style.correction)?style.correction:'M');
    const qr=root.qrcode(0,correction);qr.addData(String(data||''));qr.make();
    const count=qr.getModuleCount();const matrix=[];for(let r=0;r<count;r++){const row=[];for(let c=0;c<count;c++)row.push(Boolean(qr.isDark(r,c)));matrix.push(row);}return matrix;
  }
  function createSvg(data,style={},size=1024){
    const matrix=matrixFor(data,style);const count=matrix.length;if(!count)throw new Error('Données QR invalides.');
    const fg=hex(style.foreground,'#111111'),bg=hex(style.background,'#FFFFFF');
    const frameColor=hex(style.frameColor,bg),textColor=hex(style.frameTextColor,fg);
    const frame=['none','simple','rounded','poster'].includes(style.frameStyle)?style.frameStyle:'none';
    const eye=['square','rounded'].includes(style.eyeStyle)?style.eyeStyle:'square';
    const dot=['square','rounded','dots'].includes(style.dotStyle)?style.dotStyle:'square';
    const top=label(style.labelTop),bottom=label(style.labelBottom);const topBand=top?52:0,bottomBand=bottom?52:0;
    const qrSize=400,viewWidth=456,viewHeight=32+topBand+qrSize+bottomBand;
    const qrX=(viewWidth-qrSize)/2,qrY=16+topBand,margin=4,total=count+margin*2,unit=qrSize/total;
    const px=(v)=>Number(v.toFixed(3));const parts=[];
    const isPoster=frame==='poster';const border=frame==='simple'||frame==='rounded';
    if(isPoster)parts.push(`<rect x="8" y="8" width="${viewWidth-16}" height="${viewHeight-16}" rx="${frame==='rounded'?28:8}" fill="${frameColor}"/>`);
    else if(border)parts.push(`<rect x="8" y="8" width="${viewWidth-16}" height="${viewHeight-16}" rx="${frame==='rounded'?28:8}" fill="${bg}" stroke="${frameColor}" stroke-width="3"/>`);
    else parts.push(`<rect width="${viewWidth}" height="${viewHeight}" fill="${bg}"/>`);
    parts.push(`<rect x="${px(qrX)}" y="${px(qrY)}" width="${qrSize}" height="${qrSize}" fill="${bg}"/>`);
    const center=qrX+qrSize/2,centerY=qrY+qrSize/2,logo=safeDataImage(style.logo),logoScale=Math.min(14,Math.max(8,Number(style.logoScale)||10));
    const plateSize=logo?qrSize*logoScale/100+14:0;
    for(let r=0;r<count;r++)for(let c=0;c<count;c++){
      if(!matrix[r][c])continue;
      const x=qrX+(c+margin)*unit,y=qrY+(r+margin)*unit;
      const finder=(r<8&&c<8)||(r<8&&c>=count-8)||(r>=count-8&&c<8);
      if(finder)continue;
      if(logo&&Math.abs(x+unit/2-center)<plateSize/2&&Math.abs(y+unit/2-centerY)<plateSize/2)continue;
      if(dot==='dots')parts.push(`<circle cx="${px(x+unit/2)}" cy="${px(y+unit/2)}" r="${px(unit*.34)}" fill="${fg}"/>`);
      else if(dot==='rounded')parts.push(`<rect x="${px(x)}" y="${px(y)}" width="${px(unit)}" height="${px(unit)}" rx="${px(unit*.22)}" fill="${fg}"/>`);
      else parts.push(`<rect x="${px(x)}" y="${px(y)}" width="${px(unit+.04)}" height="${px(unit+.04)}" fill="${fg}"/>`);
    }
    const finder=(row,col)=>{
      const x=qrX+(col+margin)*unit,y=qrY+(row+margin)*unit,outer=7*unit,inner=5*unit,centerBox=3*unit,radius=eye==='rounded'?unit*.9:0;
      parts.push(`<rect x="${px(x)}" y="${px(y)}" width="${px(outer)}" height="${px(outer)}" rx="${px(radius)}" fill="${fg}"/>`);
      parts.push(`<rect x="${px(x+unit)}" y="${px(y+unit)}" width="${px(inner)}" height="${px(inner)}" rx="${eye==='rounded'?px(unit*.55):0}" fill="${bg}"/>`);
      parts.push(`<rect x="${px(x+2*unit)}" y="${px(y+2*unit)}" width="${px(centerBox)}" height="${px(centerBox)}" rx="${eye==='rounded'?px(unit*.45):0}" fill="${fg}"/>`);
    };
    finder(0,0);finder(0,count-7);finder(count-7,0);
    if(logo){parts.push(`<rect x="${px(center-plateSize/2)}" y="${px(centerY-plateSize/2)}" width="${px(plateSize)}" height="${px(plateSize)}" rx="8" fill="${bg}" stroke="${hex(style.frameColor,'#FFFFFF')}" stroke-width="1.5"/>`);parts.push(`<image href="${esc(logo)}" x="${px(center-plateSize/2+7)}" y="${px(centerY-plateSize/2+7)}" width="${px(plateSize-14)}" height="${px(plateSize-14)}" preserveAspectRatio="xMidYMid meet"/>`);}
    const textFill=isPoster?textColor:textColor;
    const textSize=top.length>38||bottom.length>38?16:19;
    if(top)parts.push(`<text x="${viewWidth/2}" y="${16+topBand/2+7}" text-anchor="middle" dominant-baseline="middle" fill="${textFill}" font-family="Arial, sans-serif" font-size="${textSize}" font-weight="700" textLength="${viewWidth-56}" lengthAdjust="spacingAndGlyphs">${esc(top)}</text>`);
    if(bottom)parts.push(`<text x="${viewWidth/2}" y="${qrY+qrSize+bottomBand/2}" text-anchor="middle" dominant-baseline="middle" fill="${textFill}" font-family="Arial, sans-serif" font-size="${textSize}" font-weight="700" textLength="${viewWidth-56}" lengthAdjust="spacingAndGlyphs">${esc(bottom)}</text>`);
    const finalSize=Math.max(128,Math.min(4096,Number(size)||1024));
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${finalSize}" height="${Math.round(finalSize*viewHeight/viewWidth)}" viewBox="0 0 ${viewWidth} ${viewHeight}" role="img" aria-label="Code QR Oymike${top?` — ${esc(top)}`:''}">${parts.join('')}</svg>`;
  }
  function renderCanvas(canvas,data,style={},size=480){
    return new Promise((resolve,reject)=>{
      if(!canvas)return reject(new Error('Aucun aperçu QR disponible.'));
      let svg;try{svg=createSvg(data,style,size);}catch(error){reject(error);return;}
      // The app's CSP intentionally does not allow blob: images. Use the already permitted
      // data: scheme so the shared preview, PNG export and print renderer work under CSP.
      const image=new Image();
      image.onload=()=>{try{canvas.width=size;canvas.height=Math.round(size*image.height/image.width);const ctx=canvas.getContext('2d',{alpha:false});if(!ctx)throw new Error('Canvas indisponible.');ctx.fillStyle=hex(style.background,'#FFFFFF');ctx.fillRect(0,0,canvas.width,canvas.height);ctx.imageSmoothingEnabled=true;ctx.drawImage(image,0,0,canvas.width,canvas.height);resolve(canvas);}catch(error){reject(error);}};
      image.onerror=()=>reject(new Error('Le navigateur a refusé de charger le rendu QR. Vérifiez la politique de sécurité puis réessayez.'));
      image.src=`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
  }
  function download(data,style={},filename='oymike-qr',format='png'){
    const clean=String(filename||'oymike-qr').replace(/[^A-Za-z0-9_-]+/g,'-').slice(0,80)||'oymike-qr';
    const save=(blob,name)=>{const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1200);};
    if(format==='svg'){save(new Blob([createSvg(data,style,1600)],{type:'image/svg+xml;charset=utf-8'}),`${clean}.svg`);return Promise.resolve();}
    const canvas=document.createElement('canvas');return renderCanvas(canvas,data,style,1600).then(()=>new Promise((resolve,reject)=>canvas.toBlob(blob=>{if(!blob){reject(new Error('Impossible de créer le fichier PNG.'));return;}save(blob,`${clean}.png`);resolve();},'image/png')));
  }
  root.QRIAQRArtwork={createSvg,renderCanvas,download,matrixFor};
})(typeof window!=='undefined'?window:globalThis);
