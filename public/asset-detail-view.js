/* Presentation only: saved asset fields and action nodes keep their existing meaning. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetDetailView=api;})(typeof window==='undefined'?null:window,()=>{
  const views=new Map();
  const present=v=>v!==null&&v!==undefined&&String(v).trim()!=='';
  const esc=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
  function specifications(value){
    // Only newline-separated Label: Value entries are interpreted. Source text is never rewritten.
    return String(value??'').split(/\r?\n/).filter(line=>line.trim()).map(line=>{
      const at=line.indexOf(':');
      return at>0&&at<80&&!/^\s*[a-z]+:\/\//i.test(line)?{label:line.slice(0,at).trim(),value:line.slice(at+1).trim()}:{label:'',value:line};
    });
  }
  function highlights(asset){
    const references=new Set(['manufacturer','brand','model','secondary model','device id','product id','device name','serial','serial number']);
    return specifications(asset.specifications).filter(r=>r.label&&present(r.value)&&r.value.length<=110&&!references.has(r.label.toLowerCase().replace(/[_-]/g,' ').trim())).slice(0,4);
  }
  const fields=pairs=>'<dl class="overview-fields">'+pairs.map(([label,value])=>'<div><dt>'+esc(label)+'</dt><dd>'+esc(present(value)?value:'Not recorded')+'</dd></div>').join('')+'</dl>';
  function remember(body){
    const id=body?.dataset.detailAssetId;if(!id||!body.querySelector('.asset-detail-tabs'))return;
    const focused=body.contains(document.activeElement)?document.activeElement:null;
    const focus=focused?.dataset.detailTab?{tab:focused.dataset.detailTab}:focused?.parentElement?.dataset.detailFold?{fold:focused.parentElement.dataset.detailFold}:focused?.id?{id:focused.id}:null;
    const folds=Object.fromEntries([...body.querySelectorAll('details[data-detail-fold]')].map(d=>[d.dataset.detailFold,d.open]));
    views.delete(id);views.set(id,{tab:body.dataset.detailActiveTab||'overview',folds,scroll:body.scrollTop,focus});
    while(views.size>30)views.delete(views.keys().next().value);
  }
  function migrate(from,to){if(views.has(from)){views.set(to,views.get(from));views.delete(from);}}
  function status(body,message,{error=false,retry=null}={}){
    const box=body.querySelector('#detailLoadStatus');if(!box)return;
    box.replaceChildren();box.hidden=!message;box.classList.toggle('has-error',error);box.setAttribute('role',error?'alert':'status');
    if(!message)return;
    const text=document.createElement('span');text.textContent=message;box.append(text);
    if(retry){const button=document.createElement('button');button.type='button';button.className='btn light sm';button.textContent='Retry';button.onclick=async()=>{button.disabled=true;button.textContent='Retrying…';try{await retry();}catch{if(button.isConnected){button.disabled=false;button.textContent='Retry';}}};box.append(button);}
  }
  function queueStatus(body,row,onReview){
    const box=body.querySelector('#detailQueueStatus');if(!box)return;
    box.replaceChildren();box.hidden=!row||row.state==='Saved';if(box.hidden)return;
    const text=document.createElement('span');
    text.textContent=row.state==='Retry'?'This save needs attention. Your saved draft is kept on this device.':row.asset?'Asset saved. Photos are still uploading.':'Saved on this device. Waiting for the server to confirm the asset.';
    box.append(text);box.classList.toggle('has-error',row.state==='Retry');box.setAttribute('role',row.state==='Retry'?'alert':'status');
    const button=document.createElement('button');button.type='button';button.className='btn light sm';button.textContent=row.state==='Retry'?'Review save':'View progress';button.onclick=onReview;box.append(button);
  }
  function fold(key,title,node,{open=false}={}){
    const details=document.createElement('details');details.className='overview-fold';details.dataset.detailFold=key;details.open=open;
    if(node?.classList.contains('staff-private-section'))details.classList.add('staff-private-section');
    const summary=document.createElement('summary');summary.textContent=title;details.append(summary);
    const content=document.createElement('div');content.className='overview-fold-body';details.append(content);
    if(node){node.querySelectorAll(':scope>h3,:scope>.panel-head h3,.staff-private-head h3').forEach(h=>h.hidden=true);content.append(node);}
    return details;
  }
  function mount(body,asset,{icon=()=>'',productName=()=>'',onCopy=()=>{},onRetry=()=>{}}={}){
    const id=String(asset.asset_id),saved=views.get(id)||{tab:'overview',folds:{},scroll:0};
    body.dataset.detailAssetId=id;body.classList.add('asset-overview-body');
    const hero=body.querySelector('.detail-hero'),title=hero.querySelector('.detail-title');hero.classList.add('overview-hero');
    const category=document.createElement('p');category.className='overview-category';category.textContent=asset.category_name||asset.category||'Asset';title.prepend(category);
    const oldSubtitle=title.querySelector('p:not(.overview-category)');if(oldSubtitle){const product=productName(asset);oldSubtitle.textContent=product;oldSubtitle.className='overview-product';oldSubtitle.hidden=!present(asset.asset_name)||!present(product)||String(asset.asset_name).toLowerCase()===product.toLowerCase();}
    const meta=document.createElement('div');meta.className='overview-meta';meta.innerHTML='<div class="overview-asset-id"><span>'+esc(asset._localOperation?'Asset ID pending':id)+'</span>'+(asset._localOperation?'':'<button type="button" class="btn light sm" id="copyDetailAssetId" aria-label="Copy asset ID">Copy</button>')+'</div><p>'+icon('pin','sm')+'<span>'+esc([asset.site_name||asset.site,asset.area_name||asset.area].filter(present).join(' · ')||'Location not recorded')+'</span></p>';hero.after(meta);
    meta.querySelector('#copyDetailAssetId')?.addEventListener('click',()=>onCopy(id));
    const notices=document.createElement('div');notices.innerHTML='<div id="detailLoadStatus" class="overview-notice" role="status" hidden></div><div id="detailQueueStatus" class="overview-notice" role="status" hidden></div>';meta.after(notices);
    const tabs=document.createElement('nav');tabs.className='asset-detail-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Asset information');
    const panels={};
    for(const [key,label]of [['overview','Overview'],['photos','Photos'],['activity','Activity']]){
      const tab=document.createElement('button');tab.type='button';tab.dataset.detailTab=key;tab.id='asset-detail-tab-'+key;tab.textContent=label;tab.setAttribute('role','tab');tab.setAttribute('aria-controls','asset-detail-panel-'+key);tabs.append(tab);
      const panel=document.createElement('div');panel.className='asset-detail-panel';panel.dataset.detailPanel=key;panel.id='asset-detail-panel-'+key;panel.setAttribute('role','tabpanel');panel.setAttribute('aria-labelledby',tab.id);panels[key]=panel;
    }
    const sections=[...body.querySelectorAll(':scope>.detail-section')];
    const find=text=>sections.find(s=>s.querySelector('h3')?.textContent?.trim()===text);
    const placement=find('Placement & assignment'),device=find('Device information'),photos=find('Images');
    const entries=specifications(asset.specifications),cards=highlights(asset);
    if(entries.length){
      const summary=document.createElement('section');summary.className='overview-key-info';summary.innerHTML='<h3>Key information</h3>'+(cards.length?'<div class="overview-highlights">'+cards.map(r=>'<div><span>'+esc(r.label)+'</span><strong>'+esc(r.value)+'</strong></div>').join('')+'</div>':'<p class="overview-spec-text">'+esc(asset.specifications)+'</p>');panels.overview.append(summary);
      const specNode=document.createElement('section');specNode.innerHTML=entries.map(r=>r.label?fields([[r.label,r.value]]):'<p class="overview-spec-text">'+esc(r.value)+'</p>').join('');
      const raw=document.createElement('details');raw.dataset.detailFold='saved-text';raw.className='overview-saved-text';raw.innerHTML='<summary>View saved text</summary><pre>'+esc(asset.specifications)+'</pre>';specNode.append(raw);
      panels.overview.append(fold('specifications','All specifications · '+entries.length+' '+(entries.length===1?'entry':'entries'),specNode));
    }
    device?.remove();
    if(placement)panels.overview.append(fold('placement','Placement & assignment',placement));
    const identity=document.createElement('section');identity.innerHTML=fields([['Category',asset.category_name||asset.category],['Brand',asset.brand],['Model',asset.model],['Serial number',asset.serial]]);panels.overview.append(fold('identity','Asset information',identity));
    const custom=(asset.custom_fields||[]).filter(f=>present(f.value));if(custom.length){const section=document.createElement('section');section.innerHTML=fields(custom.map(f=>[f.label||f.field_id,f.value]));panels.overview.append(fold('custom','Additional information',section));}
    const privateSection=sections.find(s=>s.classList.contains('staff-private-section'));if(privateSection)panels.overview.append(fold('private','Staff-only information',privateSection));
    if(photos){panels.photos.append(photos);photos.classList.add('overview-photos');photos.querySelector('h3').textContent='Photos';}
    for(const [heading,key]of [['Maintenance','maintenance'],['Movement history','movements'],['Activity log','activity']]){const section=find(heading);if(section)panels.activity.append(fold(key,heading,section,{open:key==='maintenance'}));}
    const links=body.querySelector('#assetLinksDetail'),matching=body.querySelector('#matchingProductDetails');
    if(matching){const nested=matching.querySelector('details.side-note');if(nested){const note=document.createElement('p');note.className='linked-empty';note.textContent=nested.querySelector('summary')?.textContent||'Matching models';nested.replaceWith(note,...[...nested.children].filter(n=>n.tagName!=='SUMMARY'));}}
    if(links||matching){const section=document.createElement('div');if(links)section.append(links);if(matching)section.append(matching);panels.overview.append(fold('related','Related assets',section));}
    const legacy=[...body.querySelectorAll(':scope>.group-detail')];if(legacy.length){const section=document.createElement('div');legacy.forEach(n=>section.append(n));panels.overview.append(fold('legacy','Earlier equipment set',section));}
    if(asset._nonimageOnly){
      // A prefetched summary is not evidence that there is no history.
      for(const section of panels.activity.querySelectorAll('.overview-fold-body')){section.innerHTML='<div class="overview-partial" role="status">Full details are still loading. <button type="button" class="btn light sm">Retry loading</button></div>';section.querySelector('button').onclick=onRetry;}
    }
    notices.after(tabs,panels.overview,panels.photos,panels.activity);
    body.querySelectorAll('details[data-detail-fold]').forEach(d=>{if(Object.hasOwn(saved.folds||{},d.dataset.detailFold))d.open=saved.folds[d.dataset.detailFold];d.addEventListener('toggle',()=>remember(body));});
    const select=(key,{focus=false,save=true}={})=>{
      if(!panels[key])key='overview';body.dataset.detailActiveTab=key;
      for(const tab of tabs.children){const active=tab.dataset.detailTab===key;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;if(active&&focus)tab.focus({preventScroll:true});}
      for(const [name,panel]of Object.entries(panels))panel.hidden=name!==key;
      if(save)remember(body);
    };
    for(const tab of tabs.children){tab.onclick=()=>select(tab.dataset.detailTab);tab.onkeydown=e=>{const keys=['overview','photos','activity'],at=keys.indexOf(tab.dataset.detailTab);let next;if(e.key==='ArrowRight')next=keys[(at+1)%3];if(e.key==='ArrowLeft')next=keys[(at+2)%3];if(e.key==='Home')next=keys[0];if(e.key==='End')next=keys[2];if(next){e.preventDefault();select(next,{focus:true});}};}
    select(saved.tab,{save:false});body.scrollTop=saved.scroll||0;
    if(saved.focus){const target=saved.focus.tab?tabs.querySelector('[data-detail-tab="'+saved.focus.tab+'"]'):saved.focus.fold?[...body.querySelectorAll('details[data-detail-fold]')].find(d=>d.dataset.detailFold===saved.focus.fold)?.querySelector('summary'):saved.focus.id?document.getElementById(saved.focus.id):null;target?.focus({preventScroll:true});}
  }
  return {present,specifications,highlights,fields,remember,migrate,mount,status,queueStatus};
});
