(() => {
  'use strict';
  const $=(selector)=>document.querySelector(selector);const esc=(value)=>String(value??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=(value)=>`${new Intl.NumberFormat('fr-FR').format(Number(value)||0)} XOF`;
  async function load(){const code=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()||'');try{const response=await fetch(`/api/public/suppliers/${encodeURIComponent(code)}`,{cache:'no-store'});const result=await response.json().catch(()=>({}));if(!response.ok||!result.data)throw new Error(result.error||'Profil indisponible.');const supplier=result.data;$('#companyName').textContent=supplier.companyName;$('#bio').textContent=supplier.bio||'Fournisseur professionnel présent sur Oymike Tech.';
      const contacts=[];if(supplier.publicContact){if(supplier.contactName)contacts.push(`<span>${esc(supplier.contactName)}</span>`);if(supplier.phone)contacts.push(`<a href="tel:${esc(supplier.phone)}">${esc(supplier.phone)}</a>`);if(supplier.email)contacts.push(`<a href="mailto:${esc(supplier.email)}">${esc(supplier.email)}</a>`);if(supplier.address)contacts.push(`<span>${esc(supplier.address)}</span>`);}if(supplier.categories?.length)contacts.push(`<span>Catégories : ${esc(supplier.categories.join(' · '))}</span>`);$('#contacts').innerHTML=contacts.join('');
      const products=$('#products');products.innerHTML=(supplier.products||[]).filter((p)=>p.status==='active').length?(supplier.products||[]).filter((p)=>p.status==='active').map((p)=>`<article class="item"><h3>${esc(p.name)}</h3><p>${esc(p.description||p.category)}</p><p class="price">${money(p.priceXof)} / ${esc(p.unit)}</p><p>Stock déclaré : ${Number(p.stockQuantity)||0} · minimum : ${Number(p.minimumOrderQuantity)||1}</p></article>`).join(''):'<p class="empty">Aucun produit disponible à afficher.</p>';
      $('#loading').hidden=true;$('#profile').hidden=false;document.title=`${supplier.companyName} — Fournisseur Oymike Tech`;
    }catch(error){$('#loading').hidden=true;$('#errorText').textContent=error.message;$('#error').hidden=false;}}
  load();
})();
