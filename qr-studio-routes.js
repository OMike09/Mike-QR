'use strict';

const QR_STUDIO = require('./qr-studio-config');

const MODEL_KEY = 'qrPageTemplates';
const GALLERY_KEY = 'qrDesignGallery';
const MAX_GALLERY_ASSETS = 24;

function publicTemplate(template) {
  const { history, createdAt, updatedAt, ...data } = template;
  return data;
}
function modelAudit(template) {
  return { id:template.id, label:template.label, version:template.version, enabled:template.enabled, fieldCount:template.fields?.length || 0, sectionCount:template.sections?.length || 0 };
}
function sortByOrder(items) { return items.slice().sort((a,b) => (Number(a.order)||0)-(Number(b.order)||0) || String(a.title||a.label||'').localeCompare(String(b.title||b.label||''),'fr')); }

module.exports = function registerQrStudioRoutes({ app, store, requireAdmin, makeAudit, apiError, validateCustomFieldsForTemplate }) {
  async function settings() { return store.getSettings(); }
  async function saveModels(models) { return store.updateSettings({ [MODEL_KEY]:models }); }
  async function saveGallery(gallery) { return store.updateSettings({ [GALLERY_KEY]:gallery }); }
  async function listAllCodesByModel(id) {
    const matches = []; let page = 1; const limit = 100;
    while (page <= 1000) {
      const batch = await store.listCodes({ page, limit });
      for (const row of batch.data || []) if (row.profileData?.templateId === id) matches.push(row);
      if (!batch.data?.length || page * limit >= batch.total) break;
      page += 1;
    }
    return matches;
  }
  app.get('/api/public/qr-templates', async (_req, res) => {
    try {
      const current = await settings();
      res.json({ data:(current[MODEL_KEY] || []).filter((item) => item.enabled !== false).sort((a,b) => (a.order||0)-(b.order||0)).map(publicTemplate) });
    } catch (error) { apiError(res,error,'Impossible de charger les modèles publics.'); }
  });
  app.get('/api/public/design-gallery', async (_req, res) => {
    try {
      const current = await settings();
      res.json({ data:sortByOrder((current[GALLERY_KEY] || []).filter((item) => item.active !== false)) });
    } catch (error) { apiError(res,error,'Impossible de charger la galerie.'); }
  });
  app.get('/api/admin/qr-templates', requireAdmin, async (_req,res) => {
    try { const current=await settings(); res.json({ data:(current[MODEL_KEY]||[]).sort((a,b)=>(a.order||0)-(b.order||0)), categories:await store.listCategories() }); }
    catch(error) { apiError(res,error,'Impossible de charger les modèles QR.'); }
  });
  app.post('/api/admin/qr-templates', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const models=current[MODEL_KEY]||[]; const categories=await store.listCategories();
      const model=QR_STUDIO.normalizeTemplate(req.body||{},{categories});
      if (models.some((item)=>item.id===model.id)) return res.status(409).json({error:'Un modèle possède déjà cet identifiant.'});
      if (models.some((item)=>item.label.toLocaleLowerCase('fr')===model.label.toLocaleLowerCase('fr'))) return res.status(409).json({error:'Un modèle porte déjà ce nom.'});
      const data=[...models,model]; await saveModels(data);
      await store.addAudit(makeAudit('create','qr_template',model.id,null,modelAudit(model),`Modèle QR « ${model.label} » créé (version ${model.version}).`));
      res.status(201).json({data:model});
    } catch(error) { if(error.message&&!error.code) return res.status(400).json({error:error.message}); apiError(res,error,'Impossible de créer le modèle QR.'); }
  });
  app.put('/api/admin/qr-templates/:id', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const models=current[MODEL_KEY]||[]; const index=models.findIndex((item)=>item.id===req.params.id);
      if(index<0) return res.status(404).json({error:'Modèle QR introuvable.'});
      const categories=await store.listCategories();
      const model=QR_STUDIO.normalizeTemplate(req.body||{},{id:req.params.id,previous:models[index],categories});
      if(models.some((item,i)=>i!==index&&item.label.toLocaleLowerCase('fr')===model.label.toLocaleLowerCase('fr'))) return res.status(409).json({error:'Un modèle porte déjà ce nom.'});
      const next=[...models]; next[index]=model; await saveModels(next);
      if(model.version!==models[index].version) await store.addAudit(makeAudit('update','qr_template',model.id,modelAudit(models[index]),modelAudit(model),`Modèle QR « ${model.label} » modifié. Les pages déjà créées gardent leur version jusqu’à une migration explicite.`));
      res.json({data:model});
    } catch(error) { if(error.message&&!error.code) return res.status(400).json({error:error.message}); apiError(res,error,'Impossible de modifier le modèle QR.'); }
  });
  app.post('/api/admin/qr-templates/:id/duplicate', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const models=current[MODEL_KEY]||[]; const source=models.find((item)=>item.id===req.params.id);
      if(!source) return res.status(404).json({error:'Modèle QR introuvable.'});
      const categories=await store.listCategories();
      const copy=QR_STUDIO.normalizeTemplate({...QR_STUDIO.stripTemplateHistory(source),label:`${QR_STUDIO.text(req.body?.label,100)||source.label+' — copie'}`,enabled:true,order:models.length},{categories});
      const next=[...models,copy]; await saveModels(next);
      await store.addAudit(makeAudit('create','qr_template',copy.id,modelAudit(source),modelAudit(copy),`Modèle QR « ${source.label} » dupliqué en « ${copy.label} ».`));
      res.status(201).json({data:copy});
    } catch(error) { if(error.message&&!error.code) return res.status(400).json({error:error.message}); apiError(res,error,'Impossible de dupliquer le modèle QR.'); }
  });
  app.patch('/api/admin/qr-templates/:id/status', requireAdmin, async (req,res) => {
    try {
      if(typeof req.body?.enabled!=='boolean') return res.status(400).json({error:'Choisissez Actif ou Désactivé.'});
      const current=await settings(); const models=current[MODEL_KEY]||[]; const index=models.findIndex((item)=>item.id===req.params.id);
      if(index<0) return res.status(404).json({error:'Modèle QR introuvable.'});
      const old=models[index]; const updated={...old,enabled:req.body.enabled,recommended:req.body.enabled?old.recommended:false,updatedAt:new Date().toISOString()};
      const next=[...models]; next[index]=updated; await saveModels(next);
      await store.addAudit(makeAudit('update','qr_template',updated.id,modelAudit(old),modelAudit(updated),`Modèle QR « ${old.label} » ${updated.enabled?'activé':'désactivé'}.`));
      res.json({data:updated});
    } catch(error) { apiError(res,error,'Impossible de modifier le statut du modèle.'); }
  });
  app.post('/api/admin/qr-templates/reorder', requireAdmin, async (req,res) => {
    try {
      const ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[]; const current=await settings(); const models=current[MODEL_KEY]||[];
      if(ids.length!==models.length||new Set(ids).size!==models.length||ids.some((id)=>!models.some((item)=>item.id===id))) return res.status(400).json({error:'La liste de modèles à réordonner est invalide.'});
      const rank=new Map(ids.map((id,index)=>[id,index])); const next=models.map((item)=>({...item,order:rank.get(item.id)})); await saveModels(next);
      await store.addAudit(makeAudit('update','qr_template','order',{ids:models.slice().sort((a,b)=>(a.order||0)-(b.order||0)).map((item)=>item.id)},{ids},'Ordre des modèles QR du PDG modifié.'));
      res.json({data:next.sort((a,b)=>a.order-b.order)});
    } catch(error) { apiError(res,error,'Impossible de réorganiser les modèles QR.'); }
  });
  app.delete('/api/admin/qr-templates/:id', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const models=current[MODEL_KEY]||[]; const model=models.find((item)=>item.id===req.params.id);
      if(!model) return res.status(404).json({error:'Modèle QR introuvable.'});
      const references=await listAllCodesByModel(model.id);
      if(references.length) return res.status(409).json({error:`Ce modèle est encore utilisé par ${references.length} QR. Désactivez-le pour les nouvelles créations; les anciennes pages conserveront leur version.`});
      await saveModels(models.filter((item)=>item.id!==model.id));
      await store.addAudit(makeAudit('delete','qr_template',model.id,modelAudit(model),null,`Modèle QR « ${model.label} » supprimé (aucun QR actif ou brouillon ne le référence).`));
      res.json({ok:true});
    } catch(error) { apiError(res,error,'Impossible de supprimer le modèle QR.'); }
  });
  app.post('/api/admin/qr-templates/:id/migrate', requireAdmin, async (req,res) => {
    try {
      if(req.body?.confirm!==true) return res.status(400).json({error:'Confirmez explicitement cette migration contrôlée.'});
      const current=await settings(); const model=(current[MODEL_KEY]||[]).find((item)=>item.id===req.params.id);
      if(!model) return res.status(404).json({error:'Modèle QR introuvable.'});
      const matches=await listAllCodesByModel(model.id); const nextSnapshot=QR_STUDIO.templateSnapshot(model); const migrated=[]; const failures=[];
      for(const item of matches){
        try {
          const before=await store.getCode(item.id); const profileData=before.profileData||{};
          if(Number(profileData.modelVersion)===Number(model.version)) continue;
          const history=[...(profileData.modelHistory||[]),{version:Number(profileData.modelVersion)||1,migratedAt:new Date().toISOString(),snapshot:profileData.templateSnapshot||null}].slice(-10);
          const priorValues=profileData.customFields&&typeof profileData.customFields==='object'?profileData.customFields:{};
          const nextKeys=new Set((nextSnapshot.fields||[]).map((field)=>field.key));
          const orphanedCustomFields={...(profileData.orphanedCustomFields||{})};
          for(const [key,value] of Object.entries(priorValues))if(!nextKeys.has(key))orphanedCustomFields[key]=value;
          const customFields=validateCustomFieldsForTemplate(nextSnapshot,priorValues);
          const updatedProfile={...profileData,templateSnapshot:nextSnapshot,modelVersion:model.version,kind:nextSnapshot.kind,templateLabel:model.label,modelHistory:history,customFields,orphanedCustomFields};
          const updated=await store.updateCode(before.id,{name:before.name,beneficiaryId:before.beneficiaryId,categoryId:before.categoryId,purpose:before.purpose,destinationType:before.destinationType,targetUrl:before.targetUrl||'',title:before.title||'',description:before.description||'',contentText:before.contentText||'',selectedFields:before.selectedFields||[],selectedPhotoIds:before.selectedPhotoIds||[],photos:before.photos||[],profileData:updatedProfile,extraLinks:before.extraLinks||[],style:before.style||{},status:before.status,statusReason:before.statusReason||''});
          if(updated) migrated.push(updated.id); else failures.push({id:item.id,error:'QR introuvable pendant la migration.'});
        } catch(error) { failures.push({id:item.id,error:error.message||'Échec inconnu'}); }
      }
      await store.addAudit(makeAudit('update','qr_template',model.id,null,{version:model.version,migrated:migrated.length,failed:failures.length},`Migration contrôlée du modèle « ${model.label} » vers la version ${model.version} : ${migrated.length} QR mis à jour, ${failures.length} échec(s).`));
      res.json({data:{templateId:model.id,version:model.version,migrated:migrated.length,failed:failures}});
    } catch(error) { apiError(res,error,'Impossible de migrer les QR vers cette version.'); }
  });
  app.get('/api/admin/design-gallery', requireAdmin, async (_req,res) => {
    try { const current=await settings(); res.json({data:sortByOrder(current[GALLERY_KEY]||[]),categories:QR_STUDIO.GALLERY_CATEGORIES}); }
    catch(error) { apiError(res,error,'Impossible de charger la galerie de design.'); }
  });
  app.post('/api/admin/design-gallery', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const gallery=current[GALLERY_KEY]||[];
      if(gallery.length>=MAX_GALLERY_ASSETS) return res.status(409).json({error:`La galerie peut contenir au maximum ${MAX_GALLERY_ASSETS} images.`});
      const asset=QR_STUDIO.normalizeGalleryAsset({...req.body,order:gallery.length}); const next=[...gallery,asset]; await saveGallery(next);
      await store.addAudit(makeAudit('create','qr_design_asset',asset.id,null,{title:asset.title,category:asset.categoryId},`Image « ${asset.title} » ajoutée à la galerie de design.`));
      res.status(201).json({data:asset});
    } catch(error) { if(error.message&&!error.code) return res.status(400).json({error:error.message}); apiError(res,error,'Impossible d’ajouter cette image.'); }
  });
  app.put('/api/admin/design-gallery/:id', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const gallery=current[GALLERY_KEY]||[]; const index=gallery.findIndex((item)=>item.id===req.params.id);
      if(index<0) return res.status(404).json({error:'Image de galerie introuvable.'});
      const before=gallery[index];const asset=QR_STUDIO.normalizeGalleryAsset({...before,...req.body},{id:req.params.id,previous:before}); const next=[...gallery]; next[index]=asset; await saveGallery(next);
      await store.addAudit(makeAudit('update','qr_design_asset',asset.id,{title:before.title,category:before.categoryId,active:before.active},{title:asset.title,category:asset.categoryId,active:asset.active},`Image « ${asset.title} » modifiée dans la galerie.`));
      res.json({data:asset});
    } catch(error) { if(error.message&&!error.code) return res.status(400).json({error:error.message}); apiError(res,error,'Impossible de modifier cette image.'); }
  });
  app.post('/api/admin/design-gallery/reorder', requireAdmin, async (req,res) => {
    try {
      const ids=Array.isArray(req.body?.ids)?req.body.ids.map(String):[]; const current=await settings(); const gallery=current[GALLERY_KEY]||[];
      if(ids.length!==gallery.length||new Set(ids).size!==gallery.length||ids.some((id)=>!gallery.some((item)=>item.id===id))) return res.status(400).json({error:'La liste d’images à réorganiser est invalide.'});
      const rank=new Map(ids.map((id,index)=>[id,index])); const next=gallery.map((item)=>({...item,order:rank.get(item.id)})); await saveGallery(next);
      await store.addAudit(makeAudit('update','qr_design_asset','order',{ids:sortByOrder(gallery).map((item)=>item.id)},{ids},'Ordre des images de la galerie QR modifié.'));
      res.json({data:sortByOrder(next)});
    } catch(error) { apiError(res,error,'Impossible de réorganiser la galerie.'); }
  });
  app.delete('/api/admin/design-gallery/:id', requireAdmin, async (req,res) => {
    try {
      const current=await settings(); const gallery=current[GALLERY_KEY]||[]; const asset=gallery.find((item)=>item.id===req.params.id);
      if(!asset) return res.status(404).json({error:'Image de galerie introuvable.'});
      await saveGallery(gallery.filter((item)=>item.id!==asset.id));
      await store.addAudit(makeAudit('delete','qr_design_asset',asset.id,{title:asset.title,category:asset.categoryId},null,`Image « ${asset.title} » retirée de la galerie. Les QR déjà enregistrés conservent leur copie.`));
      res.json({ok:true});
    } catch(error) { apiError(res,error,'Impossible de supprimer cette image.'); }
  });
};
