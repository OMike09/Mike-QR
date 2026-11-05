/* PDG-only management console for versioned page templates and the shared design gallery. */
(function(root){
  'use strict';
  const $=(s,scope=document)=>scope.querySelector(s);
  const esc=(v)=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const paletteOptions=['forest','dark-green-gold','mono','navy','beige','luxury','blue-gray','wine','blush','minimal','violet','sunset','turquoise'];
  const styleOptions=['modern','elegant','minimal','professional','luxury','creative','classic','natural','colorful','premium'];
  const layoutOptions=['cover','logo','cards','catalog','tabs','grid','list','gallery'];
  const kinds=[['restaurant','Restaurant / Maquis / Bar'],['catalog','Boutique / Commerce'],['hotel','Hôtel / Résidence'],['professional','Entreprise / Professionnel'],['health','Clinique / Centre de santé'],['education','École / Formation'],['organization','Association / Organisation'],['event','Événement'],['contact','Carte de visite'],['link','Lien / Redirection'],['gallery','Galerie'],['other','Autre activité']];
  const fieldTypes=[['text','Texte court'],['textarea','Texte long'],['number','Nombre'],['price','Prix en FCFA'],['phone','Téléphone'],['email','E-mail'],['date','Date'],['url','Lien HTTPS'],['image','Image importée'],['document','Document PDF ou lien'],['checkbox','Oui / Non'],['select','Liste de choix']];
  const categoryNames=[['perroquets','Perroquets'],['paons','Paons'],['colibris','Colibris'],['fleurs','Fleurs'],['forets','Forêts'],['cascades','Cascades'],['rivieres','Rivières'],['montagnes','Montagnes'],['tropical','Paysages tropicaux'],['africain','Paysages africains'],['couchers-soleil','Couchers de soleil'],['nature','Nature et jardins']];
  let viewRoot=null; let toast=()=>{};
  const state={tab:'models',models:[],gallery:[],categories:[],editor:null,drag:null,loading:false};
  const options=(list,selected)=>list.map(([value,label])=>`<option value="${esc(value)}"${value===selected?' selected':''}>${esc(label)}</option>`).join('');
  async function api(url,init={}){
    const response=await fetch(url,{credentials:'same-origin',...init,headers:{...(init.body?{'Content-Type':'application/json'}:{}),...(init.headers||{})}});
    const result=await response.json().catch(()=>({})); if(!response.ok) throw new Error(result.error||'La requête a échoué.'); return result;
  }
  function sectionRow(section,index){return `<div class="studio-sort-row studio-section-row" data-sort-kind="section" data-index="${index}" draggable="true"><span class="studio-grip" aria-label="Glisser pour réorganiser">⠿</span><label>Clé<input data-section-key value="${esc(section.id)}" maxlength="40" required></label><label>Titre<input data-section-title value="${esc(section.title)}" maxlength="100" required></label><label>Description<input data-section-description value="${esc(section.description||'')}" maxlength="300"></label><button type="button" class="studio-icon-button" data-studio-action="move-section-up" data-index="${index}" aria-label="Monter">↑</button><button type="button" class="studio-icon-button" data-studio-action="move-section-down" data-index="${index}" aria-label="Descendre">↓</button><button type="button" class="studio-icon-button danger" data-studio-action="remove-section" data-index="${index}" aria-label="Supprimer la rubrique">×</button></div>`;}
  function fieldRow(field,index){
    const sections=state.editor?.sections||[];
    return `<div class="studio-sort-row studio-field-row" data-sort-kind="field" data-index="${index}" draggable="true"><span class="studio-grip" aria-label="Glisser pour réorganiser">⠿</span><label>Clé<input data-field-key value="${esc(field.key)}" maxlength="40" required pattern="[A-Za-z][A-Za-z0-9_]{1,39}"></label><label>Libellé<input data-field-label value="${esc(field.label)}" maxlength="100" required></label><label>Rubrique<select data-field-section>${sections.map(s=>`<option value="${esc(s.id)}"${s.id===field.sectionId?' selected':''}>${esc(s.title)}</option>`).join('')}</select></label><label>Type<select data-field-type>${options(fieldTypes,field.type)}</select></label><label>Obligatoire<input data-field-required type="checkbox"${field.required?' checked':''}></label><label>Max. caractères<input data-field-max type="number" min="1" max="2000" value="${esc(field.maxLength||240)}"></label><label>Indication<input data-field-help value="${esc(field.description||'')}" maxlength="240"></label><label>Choix (si liste)<input data-field-options value="${esc((field.options||[]).join(' | '))}" placeholder="Choix A | Choix B"></label><button type="button" class="studio-icon-button" data-studio-action="move-field-up" data-index="${index}" aria-label="Monter">↑</button><button type="button" class="studio-icon-button" data-studio-action="move-field-down" data-index="${index}" aria-label="Descendre">↓</button><button type="button" class="studio-icon-button danger" data-studio-action="remove-field" data-index="${index}" aria-label="Supprimer le champ">×</button></div>`;
  }
  function renderEditor(){
    const editor=state.editor; if(!editor) return '';
    const defaults=(editor.defaultGroups||[]).join('\n');
    return `<section class="panel studio-editor-panel"><div class="studio-panel-head"><div><span class="eyebrow">ÉDITEUR DE MODÈLE · VERSIONNÉ</span><h2>${editor.id?'Modifier':'Créer'} un modèle QR</h2><p>Les QR existants gardent leur instantané; une migration est toujours volontaire.</p></div><button type="button" class="button button-secondary" data-studio-action="close-editor">Fermer</button></div>
      <form id="qrTemplateEditor" class="studio-editor-form"><input type="hidden" name="id" value="${esc(editor.id||'')}">
        <div class="studio-form-grid"><label>Nom du modèle<input name="label" maxlength="100" required value="${esc(editor.label||'')}" placeholder="Ex. Restaurant — menu complet"></label><label>Collection / groupe<input name="collectionLabel" maxlength="40" required value="${esc(editor.collectionLabel||editor.group||'Modèles du PDG')}" placeholder="Ex. Restauration"></label><label>Icône<input name="icon" maxlength="12" value="${esc(editor.icon||'✳')}" aria-label="Icône du modèle"></label><label class="span-2">Description<input name="description" maxlength="300" required value="${esc(editor.description||'')}" placeholder="À quoi sert ce modèle ?"></label>
          <label>Activité / renderer<select name="kind">${options(kinds,editor.kind||'other')}</select><small>Détermine le type de page publique et les actions disponibles.</small></label><label>Catégorie Oymike QR<select name="categoryId">${state.categories.map(c=>`<option value="${esc(c.id)}"${c.id===(editor.categoryId||'cat-businesses')?' selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label>But du QR<select name="purpose">${options([['contact','Coordonnées'],['catalog','Catalogue'],['prices','Tarifs'],['menu','Menu'],['website','Site Internet'],['social','Réseaux sociaux'],['services','Services'],['order','Commande / formulaire'],['other','Autre']],editor.purpose||'other')}</select></label><label>Type de bénéficiaire<select name="beneficiaryType">${options([['individual','Particulier'],['business','Entreprise'],['commerce','Commerce'],['organization','Organisation'],['other','Autre']],editor.beneficiaryType||'business')}</select></label>
          <label>Palette par défaut<select name="paletteId">${options(paletteOptions.map(x=>[x,x]),editor.defaultTheme?.paletteId||'forest')}</select></label><label>Style par défaut<select name="style">${options(styleOptions.map(x=>[x,x]),editor.defaultTheme?.style||'professional')}</select></label><label>Disposition par défaut<select name="layout">${options(layoutOptions.map(x=>[x,x]),editor.defaultTheme?.layout||'catalog')}</select></label><label>Catégories préchargées<textarea name="defaultGroups" rows="4" placeholder="Une catégorie par ligne">${esc(defaults)}</textarea><small>Ex. Entrées, Grillades, Boissons. Les gestionnaires pourront les réorganiser.</small></label>
          <label class="studio-check"><input name="recommended" type="checkbox"${editor.recommended?' checked':''}> Recommander ce modèle</label><label class="studio-check"><input name="enabled" type="checkbox"${editor.enabled!==false?' checked':''}> Actif pour les nouvelles créations</label></div>
        <section class="studio-definition-section"><div class="studio-panel-head"><div><h3>Rubriques</h3><p>Glissez pour réordonner; les boutons ↑/↓ restent disponibles au clavier.</p></div><button type="button" class="button button-secondary" data-studio-action="add-section">＋ Ajouter une rubrique</button></div><div id="studioSectionRows">${editor.sections.map(sectionRow).join('')||'<p class="studio-empty">Ajoutez une rubrique pour organiser les champs.</p>'}</div></section>
        <section class="studio-definition-section"><div class="studio-panel-head"><div><h3>Champs</h3><p>Les champs obligatoires sont vérifiés côté serveur. Images et PDF sont limités et validés.</p></div><button type="button" class="button button-secondary" data-studio-action="add-field">＋ Ajouter un champ</button></div><div id="studioFieldRows">${editor.fields.map(fieldRow).join('')||'<p class="studio-empty">Ajoutez les champs utiles à votre activité.</p>'}</div></section>
        <div class="studio-editor-actions"><span>Version actuelle : ${Number(editor.version)||'nouvelle'}</span><button class="button button-primary" type="submit">Enregistrer le modèle</button></div>
      </form></section>`;
  }
  function renderModels(){
    return `<div class="page-heading page-heading-compact"><div><span class="eyebrow">CONSTRUCTEUR DE PAGES QR</span><h1>Gestion des modèles QR</h1><p>Créez et versionnez les structures que les gestionnaires retrouveront dans leur assistant.</p></div><button class="button button-primary" type="button" data-studio-action="new-model">＋ Nouveau modèle</button></div>
      ${renderEditor()}<section class="panel studio-list-panel"><div class="studio-panel-head"><div><span class="eyebrow">MODÈLES DU PDG</span><h2>${state.models.length} modèle${state.models.length===1?'':'s'} personnalisé${state.models.length===1?'':'s'}</h2><p>Modifier une définition ne change aucune page existante; utilisez « Migrer » après vérification si vous souhaitez appliquer une nouvelle version.</p></div><button class="button button-secondary" type="button" data-studio-action="refresh">Actualiser</button></div>
      ${state.models.length?`<div id="studioModelList" class="studio-model-list">${state.models.map((item,index)=>`<article class="studio-model-card" draggable="true" data-model-id="${esc(item.id)}" data-index="${index}"><span class="studio-model-icon">${esc(item.icon||'✳')}</span><div class="studio-model-copy"><strong>${esc(item.label)}${item.recommended?' · Recommandé':''}</strong><span>${esc(item.description)}</span><small>${esc(item.group||'Modèles du PDG')} · ${esc(kinds.find(([id])=>id===item.kind)?.[1]||item.kind)} · ${item.sections?.length||0} rubriques · ${item.fields?.length||0} champs · v${item.version||1}</small></div><span class="studio-status ${item.enabled?'is-active':'is-off'}">${item.enabled?'Actif':'Désactivé'}</span><div class="studio-card-actions"><button type="button" data-studio-action="edit-model" data-id="${esc(item.id)}">Modifier</button><button type="button" data-studio-action="duplicate-model" data-id="${esc(item.id)}">Dupliquer</button><button type="button" data-studio-action="toggle-model" data-id="${esc(item.id)}">${item.enabled?'Désactiver':'Activer'}</button><button type="button" data-studio-action="migrate-model" data-id="${esc(item.id)}">Migrer les QR…</button><button type="button" class="danger" data-studio-action="delete-model" data-id="${esc(item.id)}">Supprimer si inutilisé</button><button type="button" data-studio-action="move-model-up" data-index="${index}" aria-label="Monter">↑</button><button type="button" data-studio-action="move-model-down" data-index="${index}" aria-label="Descendre">↓</button></div></article>`).join('')}</div>`:'<div class="studio-empty-card"><strong>Aucun modèle personnalisé pour le moment.</strong><span>Les modèles intégrés restent disponibles. Créez ici des structures réutilisables pour les nouveaux QR.</span></div>'}</section>`;
  }
  function renderGallery(){
    return `<div class="page-heading page-heading-compact"><div><span class="eyebrow">BIBLIOTHÈQUE DE DESIGN</span><h1>Galerie d’images</h1><p>Le PDG choisit les visuels disponibles; les gestionnaires peuvent les utiliser comme arrière-plan. Les QR déjà enregistrés conservent leur image.</p></div><span class="studio-gallery-count">${state.gallery.length}/24 images</span></div>
      <section class="panel studio-upload-panel"><form id="qrGalleryUpload" class="studio-upload-form"><label>Nom de l’image<input name="title" required maxlength="100" placeholder="Ex. Jardin tropical au coucher du soleil"></label><label>Thème<select name="categoryId">${options(categoryNames,'nature')}</select></label><label>Description (facultative)<input name="description" maxlength="240" placeholder="Description pour les lecteurs d’écran"></label><label class="studio-file-label">Image à ajouter<input name="file" type="file" accept="image/jpeg,image/png,image/webp" required><small>Compressée sur l’appareil, max. 100 Kio et 1 400 px. Jusqu’à 24 images.</small></label><button class="button button-primary" type="submit"${state.gallery.length>=24?' disabled':''}>Ajouter à la galerie</button></form><p class="studio-licence-note">Importez uniquement des images que vous êtes autorisé à utiliser. Les fichiers importés sont validés côté serveur; aucun stock photo tiers n’est ajouté sans licence vérifiable.</p></section>
      <section class="panel studio-gallery-panel"><div class="studio-panel-head"><div><span class="eyebrow">VISUELS APPROUVÉS</span><h2>Images gérées par le PDG</h2><p>Glissez pour organiser. « Masquer » retire l’image des choix des gestionnaires sans altérer les pages déjà enregistrées.</p></div><button class="button button-secondary" type="button" data-studio-action="refresh">Actualiser</button></div>
      ${state.gallery.length?`<div id="studioGalleryGrid" class="studio-gallery-grid">${state.gallery.slice().sort((a,b)=>(a.order||0)-(b.order||0)).map((asset,index)=>`<article class="studio-gallery-card" draggable="true" data-asset-id="${esc(asset.id)}" data-index="${index}"><img src="${esc(asset.image)}" alt="${esc(asset.alt||asset.title)}" loading="lazy"><div class="studio-gallery-card-copy"><label>Nom<input data-gallery-title value="${esc(asset.title)}" maxlength="100"></label><label>Catégorie<select data-gallery-category>${options(categoryNames,asset.categoryId)}</select></label><label>Description<input data-gallery-alt value="${esc(asset.description||asset.alt||'')}" maxlength="240"></label><div class="studio-gallery-actions"><button type="button" data-studio-action="save-asset" data-id="${esc(asset.id)}">Enregistrer</button><button type="button" data-studio-action="toggle-asset" data-id="${esc(asset.id)}">${asset.active?'Masquer':'Réactiver'}</button><button type="button" class="danger" data-studio-action="delete-asset" data-id="${esc(asset.id)}">Supprimer</button><button type="button" data-studio-action="move-asset-up" data-index="${index}" aria-label="Monter">↑</button><button type="button" data-studio-action="move-asset-down" data-index="${index}" aria-label="Descendre">↓</button><span class="studio-status ${asset.active?'is-active':'is-off'}">${asset.active?'Visible':'Masquée'}</span></div></div></article>`).join('')}</div>`:'<div class="studio-empty-card"><strong>La galerie est vide.</strong><span>Ajoutez vos propres photos (oiseaux, fleurs, forêts, cascades, rivières, montagnes ou paysages) pour que les gestionnaires puissent les choisir. Aucune image non licenciée n’est préchargée.</span></div>'}</section>`;
  }
  function render(){
    if(!viewRoot) return;
    viewRoot.innerHTML=`<div class="qr-studio-admin"><nav class="studio-tabs" aria-label="Gestion du studio QR"><button type="button" data-studio-tab="models" class="${state.tab==='models'?'is-active':''}">Modèles</button><button type="button" data-studio-tab="gallery" class="${state.tab==='gallery'?'is-active':''}">Galerie d’images</button></nav>${state.loading?'<div class="studio-loading">Chargement des réglages du studio…</div>':''}${state.tab==='models'?renderModels():renderGallery()}</div>`;
  }
  async function load(){
    if(!viewRoot) return; state.loading=true;render();
    try{const [models,gallery,categories]=await Promise.all([api('/api/admin/qr-templates'),api('/api/admin/design-gallery'),api('/api/admin/categories')]);state.models=models.data||[];state.categories=models.categories||categories.data||[];state.gallery=gallery.data||[];state.loading=false;render();}
    catch(error){state.loading=false;render();throw error;}
  }
  function newEditor(){state.editor={id:'',label:'',group:'Modèles du PDG',description:'',kind:'other',purpose:'other',beneficiaryType:'business',categoryId:state.categories[0]?.id||'cat-businesses',icon:'✳',defaultTheme:{paletteId:'forest',style:'professional',layout:'cover'},defaultGroups:['Services'],recommended:false,enabled:true,sections:[{id:'general',title:'Informations complémentaires',description:''}],fields:[],version:1};render();}
  function move(list,from,to){if(from<0||to<0||from>=list.length||to>=list.length)return;const [item]=list.splice(from,1);list.splice(to,0,item);}
  function readEditor(form){
    const sections=[...form.querySelectorAll('.studio-section-row')].map((row)=>({id:$('[data-section-key]',row).value.trim(),title:$('[data-section-title]',row).value.trim(),description:$('[data-section-description]',row).value.trim()}));
    const fields=[...form.querySelectorAll('.studio-field-row')].map((row)=>({key:$('[data-field-key]',row).value.trim(),label:$('[data-field-label]',row).value.trim(),sectionId:$('[data-field-section]',row).value,type:$('[data-field-type]',row).value,required:$('[data-field-required]',row).checked,maxLength:Number($('[data-field-max]',row).value)||240,description:$('[data-field-help]',row).value.trim(),options:$('[data-field-options]',row).value.split('|').map(s=>s.trim()).filter(Boolean)}));
    const byName=(name)=>$(`[name="${name}"]`,form);
    return {id:byName('id').value||undefined,label:byName('label').value.trim(),collectionLabel:byName('collectionLabel').value.trim(),description:byName('description').value.trim(),icon:byName('icon').value.trim(),kind:byName('kind').value,categoryId:byName('categoryId').value,purpose:byName('purpose').value,beneficiaryType:byName('beneficiaryType').value,defaultTheme:{paletteId:byName('paletteId').value,style:byName('style').value,layout:byName('layout').value},defaultGroups:byName('defaultGroups').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),recommended:byName('recommended').checked,enabled:byName('enabled').checked,sections,fields};
  }
  async function prepareImage(file,maxBytes=100*1024,maxDimension=1400){
    if(!file||!/^image\/(jpeg|png|webp)$/i.test(file.type||''))throw new Error('Choisissez une image JPG, PNG ou WebP.');
    const bitmap=typeof createImageBitmap==='function'?await createImageBitmap(file):null;
    if(!bitmap)throw new Error('L’optimisation d’image n’est pas disponible dans ce navigateur.');
    try{
      let scale=Math.min(1,maxDimension/Math.max(bitmap.width,bitmap.height));let quality=.86;
      for(let i=0;i<16;i++){
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
        const ctx=canvas.getContext('2d');ctx.fillStyle='#FFFFFF';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));
        if(blob&&blob.size<=maxBytes)return await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(new Error('Impossible de lire l’image.'));reader.readAsDataURL(blob);});
        if(quality>.5)quality-=.08;else scale*=.82;
      }
      throw new Error('Cette image est trop lourde même après compression.');
    } finally { bitmap.close?.(); }
  }
  async function reorderModels(ids){await api('/api/admin/qr-templates/reorder',{method:'POST',body:JSON.stringify({ids})});await load();}
  async function reorderGallery(ids){await api('/api/admin/design-gallery/reorder',{method:'POST',body:JSON.stringify({ids})});await load();}
  async function action(name,button){
    if(state.editor&&['add-section','add-field','remove-section','remove-field','move-section-up','move-section-down','move-field-up','move-field-down'].includes(name)){const form=$('#qrTemplateEditor',viewRoot);if(form)state.editor={...state.editor,...readEditor(form)};}
    const id=button.dataset.id;const index=Number(button.dataset.index);
    if(name==='new-model'){newEditor();return;}
    if(name==='refresh'){await load();return;}
    if(name==='close-editor'){state.editor=null;render();return;}
    if(name==='add-section'){if(!state.editor)return;state.editor.sections.push({id:`section-${state.editor.sections.length+1}`,title:'Nouvelle rubrique',description:''});render();return;}
    if(name==='add-field'){if(!state.editor)return;state.editor.fields.push({key:`customField${state.editor.fields.length+1}`,label:'Nouveau champ',sectionId:state.editor.sections[0]?.id||'general',type:'text',required:false,maxLength:240,options:[]});render();return;}
    if(name==='remove-section'){const section=state.editor.sections[index];if(state.editor.fields.some(f=>f.sectionId===section.id)){throw new Error('Cette rubrique contient des champs. Déplacez-les avant de la supprimer.');}state.editor.sections.splice(index,1);render();return;}
    if(name==='remove-field'){state.editor.fields.splice(index,1);render();return;}
    if(name==='move-section-up'||name==='move-section-down'){move(state.editor.sections,index,index+(name.endsWith('up')?-1:1));render();return;}
    if(name==='move-field-up'||name==='move-field-down'){move(state.editor.fields,index,index+(name.endsWith('up')?-1:1));render();return;}
    if(name==='edit-model'){state.editor=structuredClone(state.models.find(m=>m.id===id));render();return;}
    if(name==='duplicate-model'){await api(`/api/admin/qr-templates/${encodeURIComponent(id)}/duplicate`,{method:'POST',body:JSON.stringify({})});toast('Modèle dupliqué.');await load();return;}
    if(name==='toggle-model'){const model=state.models.find(m=>m.id===id);await api(`/api/admin/qr-templates/${encodeURIComponent(id)}/status`,{method:'PATCH',body:JSON.stringify({enabled:!model.enabled})});await load();return;}
    if(name==='delete-model'){if(!window.confirm('Supprimer ce modèle uniquement s’il n’est référencé par aucun QR ?'))return;await api(`/api/admin/qr-templates/${encodeURIComponent(id)}`,{method:'DELETE'});toast('Modèle supprimé.');await load();return;}
    if(name==='migrate-model'){const model=state.models.find(m=>m.id===id);if(!window.confirm(`Migrer explicitement les QR « ${model?.label} » vers la version ${model?.version} ? Les informations, prix, photos et thèmes resteront conservés.`))return;const result=await api(`/api/admin/qr-templates/${encodeURIComponent(id)}/migrate`,{method:'POST',body:JSON.stringify({confirm:true})});toast(`${result.data.migrated} QR migré(s); ${result.data.failed.length} erreur(s).`);return;}
    if(name==='save-asset'){const card=button.closest('.studio-gallery-card');const body={title:$('[data-gallery-title]',card).value.trim(),categoryId:$('[data-gallery-category]',card).value,description:$('[data-gallery-alt]',card).value.trim(),alt:$('[data-gallery-alt]',card).value.trim()};await api(`/api/admin/design-gallery/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify(body)});toast('Image mise à jour.');await load();return;}
    if(name==='toggle-asset'){const asset=state.gallery.find(x=>x.id===id);await api(`/api/admin/design-gallery/${encodeURIComponent(id)}`,{method:'PUT',body:JSON.stringify({active:!asset.active})});await load();return;}
    if(name==='delete-asset'){if(!window.confirm('Retirer cette image de la galerie ? Les pages existantes conserveront leur copie.'))return;await api(`/api/admin/design-gallery/${encodeURIComponent(id)}`,{method:'DELETE'});await load();return;}
    if(name==='move-model-up'||name==='move-model-down'){const ordered=state.models.slice().sort((a,b)=>(a.order||0)-(b.order||0));move(ordered,index,index+(name.endsWith('up')?-1:1));await reorderModels(ordered.map(m=>m.id));return;}
    if(name==='move-asset-up'||name==='move-asset-down'){const ordered=state.gallery.slice().sort((a,b)=>(a.order||0)-(b.order||0));move(ordered,index,index+(name.endsWith('up')?-1:1));await reorderGallery(ordered.map(a=>a.id));return;}
  }
  function bind(rootNode){
    if(rootNode.dataset.qrStudioBound==='true')return;rootNode.dataset.qrStudioBound='true';
    rootNode.addEventListener('click',async event=>{
      const tab=event.target.closest('[data-studio-tab]');if(tab){state.tab=tab.dataset.studioTab;state.editor=null;render();return;}
      const button=event.target.closest('[data-studio-action]');if(button){event.preventDefault();try{await action(button.dataset.studioAction,button);}catch(error){toast(error.message);}}
    });
    rootNode.addEventListener('submit',async event=>{
      if(event.target.id==='qrTemplateEditor'){
        event.preventDefault();try{const payload=readEditor(event.target);const id=payload.id;await api(id?`/api/admin/qr-templates/${encodeURIComponent(id)}`:'/api/admin/qr-templates',{method:id?'PUT':'POST',body:JSON.stringify(payload)});state.editor=null;toast('Modèle enregistré. Les anciens QR ne sont pas modifiés automatiquement.');await load();}catch(error){toast(error.message);}return;
      }
      if(event.target.id==='qrGalleryUpload'){
        event.preventDefault();const form=event.target;const button=$('button[type="submit"]',form);button.disabled=true;
        try{const file=$('[name="file"]',form).files?.[0];const image=await prepareImage(file);const payload={title:$('[name="title"]',form).value.trim(),categoryId:$('[name="categoryId"]',form).value,description:$('[name="description"]',form).value.trim(),image};await api('/api/admin/design-gallery',{method:'POST',body:JSON.stringify(payload)});toast('Image optimisée et ajoutée à la galerie.');await load();}catch(error){toast(error.message);}finally{if(button.isConnected)button.disabled=false;}return;
      }
    });
    rootNode.addEventListener('dragstart',event=>{
      const row=event.target.closest('[data-sort-kind]');const model=event.target.closest('.studio-model-card');const asset=event.target.closest('.studio-gallery-card');
      if(row){state.drag={kind:row.dataset.sortKind,index:Number(row.dataset.index)};event.dataTransfer?.setData('text/plain',`${state.drag.kind}:${state.drag.index}`);}
      else if(model){state.drag={kind:'model',index:Number(model.dataset.index)};event.dataTransfer?.setData('text/plain',`model:${state.drag.index}`);}
      else if(asset){state.drag={kind:'asset',index:Number(asset.dataset.index)};event.dataTransfer?.setData('text/plain',`asset:${state.drag.index}`);}
      if(state.drag&&event.dataTransfer)event.dataTransfer.effectAllowed='move';
    });
    rootNode.addEventListener('dragover',event=>{if(event.target.closest('[data-sort-kind],.studio-model-card,.studio-gallery-card'))event.preventDefault();});
    rootNode.addEventListener('drop',async event=>{
      const target=event.target.closest('[data-sort-kind],.studio-model-card,.studio-gallery-card');if(!target||!state.drag)return;event.preventDefault();
      const kind=target.dataset.sortKind|| (target.classList.contains('studio-model-card')?'model':target.classList.contains('studio-gallery-card')?'asset':'');
      if(kind!==state.drag.kind)return;
      const from=state.drag.index;const to=Number(target.dataset.index);state.drag=null;
      if(kind==='section'||kind==='field'){const form=$('#qrTemplateEditor',viewRoot);if(form&&state.editor)state.editor={...state.editor,...readEditor(form)};const list=kind==='section'?state.editor?.sections:state.editor?.fields;if(!list)return;move(list,from,to);render();}
      if(kind==='model'){const list=state.models.slice().sort((a,b)=>(a.order||0)-(b.order||0));move(list,from,to);await reorderModels(list.map(x=>x.id));}
      if(kind==='asset'){const list=state.gallery.slice().sort((a,b)=>(a.order||0)-(b.order||0));move(list,from,to);await reorderGallery(list.map(x=>x.id));}
    });
    rootNode.addEventListener('dragend',()=>{state.drag=null;});
  }
  async function mount(options={}){
    viewRoot=options.root||document.getElementById('qrStudioRoot');if(!viewRoot)return;
    toast=options.toast||((message)=>{const el=document.getElementById('toast');if(el){el.textContent=message;el.classList.add('is-visible');setTimeout(()=>el.classList.remove('is-visible'),2600);}});
    bind(viewRoot);await load();
  }
  root.QRIAQRStudio={mount,load};
})(typeof window!=='undefined'?window:globalThis);
