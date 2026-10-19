/* Guided batch review. Existing items are linked; their product/placement data is never copied over. */
(() => {
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=v=>String(v??'').trim();
  const makeId=()=>crypto.randomUUID();
  const PENDING='jcp_assethub_pending_group_v1';
  const pendingKey=actor=>PENDING+':'+encodeURIComponent(actor);
  function pending(actor){try{const p=JSON.parse(localStorage.getItem(pendingKey(actor))||'null');return p?.actor===actor&&p.request_id&&p.payload?p:null;}catch{return null;}}
  function open(config){
    const {host,api,refs,actor,enabled,onSaved}=config,index=AssetGroups.buildIndex(config.assets);
    let draft={mode:config.mode||'same',set_id:config.set?.id||'',set_name:config.set?.name||'',common:{...(config.template||{}),custom:{}},units:config.units||(config.template?[{}]:[{},{}])},requestId='',inFlight=false;
    const $=id=>document.getElementById(id);
    const show=(title,body,ready)=>host.openModal(title,body,ready,{size:'lg'});
    const field=(label,attrs,value='',options='')=>`<label class="field"><span>${esc(label)}</span>${options||`<input ${attrs} value="${esc(value)}">`}</label>`;
    const productFields=(row,prefix)=>field('Category',`data-${prefix}="category" list="batchCategories" maxlength="100"`,row.category||row.category_name)+field('Brand · if marked',`data-${prefix}="brand" maxlength="120"`,row.brand)+field('Model · if marked',`data-${prefix}="model" maxlength="160"`,row.model);
    function chooser(){
      const resume=pending(actor);
      show('Add multiple items or an equipment set',`<div class="group-intro"><p>Each physical item keeps its own JCP tag, location and history. Shared model or part codes are not unique serials.</p>${!enabled?'<div class="scan-warning">Saving sets and multiple items needs the updated Apps Script backend. The grouped asset view already works.</div>':''}${resume?'<button id="batchResume" class="btn primary">Review unconfirmed save</button>':''}<div class="group-choice-grid"><button data-batch-mode="same" ${enabled?'':'disabled'}><b>Same model items</b><span>Enter common details once, then each serial or leave it blank.</span></button><button data-batch-mode="set" ${enabled?'':'disabled'}><b>Equipment set</b><span>PC, monitor and peripherals under one named station. Add new or existing items.</span></button><button data-batch-mode="attach" ${enabled?'':'disabled'}><b>Group existing assets</b><span>Link existing records into a set without creating them again.</span></button></div></div>`,()=>{
        document.querySelectorAll('[data-batch-mode]').forEach(b=>b.addEventListener('click',()=>{draft.mode=b.dataset.batchMode;draft.units=draft.mode==='same'?[{},{}]:[{source:draft.mode==='attach'?'existing':'new'}];edit();}));
        $('batchResume')?.addEventListener('click',()=>review(resume.payload,resume.request_id,true));
      });
    }
    function collect(){
      document.querySelectorAll('[data-batch-common]').forEach(el=>draft.common[el.dataset.batchCommon]=el.value.trim());
      document.querySelectorAll('[data-batch-custom]').forEach(el=>draft.common.custom[el.dataset.batchCustom]=el.value.trim());
      document.querySelectorAll('[data-unit-field]').forEach(el=>{const i=Number(el.dataset.unit);draft.units[i][el.dataset.unitField]=el.value.trim();});
      if($('batchSetName'))draft.set_name=$('batchSetName').value.trim();
      if($('batchSetChoice'))draft.set_id=$('batchSetChoice').value;
    }
    function edit(){
      if(pending(actor))return chooser();
      const same=draft.mode==='same',operations=['rename','detach'].includes(draft.mode),newItems=!['attach','rename','detach'].includes(draft.mode)&&draft.units.some(u=>u.source!=='existing');
      const sets=[...index.sets].map(([id,items])=>({id,name:items[0].set_name||id}));
      const setChoice=['attach','set'].includes(draft.mode)?field('Equipment set','', '',`<select id="batchSetChoice"><option value="">New equipment set</option>${sets.map(s=>`<option value="${esc(s.id)}" ${s.id===draft.set_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`):'';
      const custom=(refs.custom_fields||[]).filter(f=>f.required===true||String(f.required)==='true').map(f=>{
        const value=draft.common.custom[f.field_id]||'';let options='';
        if(f.field_type==='select'){let choices=[];try{choices=JSON.parse(f.options_json||'[]');}catch{}options=`<select data-batch-custom="${esc(f.field_id)}" required><option value="">Choose…</option>${choices.map(v=>`<option ${v===value?'selected':''}>${esc(v)}</option>`).join('')}</select>`;}
        else if(f.field_type==='boolean')options=`<select data-batch-custom="${esc(f.field_id)}" required><option value="">Choose…</option>${['Yes','No'].map(v=>`<option ${v===value?'selected':''}>${v}</option>`).join('')}</select>`;
        return field(f.label,`data-batch-custom="${esc(f.field_id)}" type="${['date','number'].includes(f.field_type)?f.field_type:'text'}" required`,value,options);
      }).join('');
      show(operations?'Review set change':same?'Add same-model items':'Build an equipment set',`<form id="batchEntryForm" class="group-entry"><p class="group-step">1. Enter items → 2. Review → 3. Save</p>${!same?`<div class="form-grid">${setChoice}${field('Set name',`id="batchSetName" maxlength="100" ${draft.set_id&&draft.mode!=='rename'?'readonly':''}`,draft.set_name)}</div>`:''}${newItems?`<section class="group-common"><h3>${same?'Shared product and placement':'Placement for new components'}</h3><p>These fields apply to new records only. Existing items keep their current placement and information.</p><div class="form-grid">${same?productFields(draft.common,'batch-common')+field('Shared product / part code · optional','data-batch-common="part_code" maxlength="120"',draft.common.part_code)+field('Shared specifications · optional','', '',`<textarea data-batch-common="specifications" maxlength="1800">${esc(draft.common.specifications)}</textarea>`):''}${field('Site','', '',`<select data-batch-common="site_id" required><option value="">Choose site</option>${refs.sites.map(s=>`<option value="${esc(s.site_id)}" ${s.site_id===draft.common.site_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`)}${field('Area / department','data-batch-common="area" required list="batchAreas" maxlength="120"',draft.common.area)}${field('Exact location · optional','data-batch-common="exact_location" maxlength="160"',draft.common.exact_location)}${field('Assigned person / team · optional','data-batch-common="assigned_to" maxlength="160"',draft.common.assigned_to)}${field('Status for new items','', '',`<select data-batch-common="status">${['Active','Spare','Faulty','Under Repair','Missing'].map(v=>`<option ${(draft.common.status||'Active')===v?'selected':''}>${v}</option>`).join('')}</select>`)}${custom}</div></section>`:''}
        ${same?field('Number of separate physical items','id="batchQuantity" type="number" min="1" max="25" required',draft.units.length):''}
        ${draft.mode==='set'&&!draft.set_id?'<button type="button" id="batchPcPreset" class="btn light">Start with PC + monitor + keyboard + mouse</button>':''}
        <datalist id="batchCategories">${refs.categories.map(c=>`<option value="${esc(c.name)}">`).join('')}</datalist><datalist id="batchAreas">${refs.areas.map(a=>`<option value="${esc(a.name)}">`).join('')}</datalist><datalist id="batchExistingOptions"></datalist>
        <div id="batchUnits">${draft.units.map((unit,i)=>{
          const existing=unit.source==='existing'||['attach','rename','detach'].includes(draft.mode),asset=index.all.find(a=>a.asset_id===unit.existing_asset_id);
          return `<section class="batch-unit" data-unit-card="${i}"><div class="batch-unit-heading"><h3>${same?'Unit':'Component'} ${i+1}</h3>${!operations?`<button type="button" class="btn light sm" data-remove-unit="${i}" ${draft.units.length===1?'disabled':''}>Remove</button>`:''}</div>${draft.mode==='set'?`<label>Item source<select data-unit-source="${i}"><option value="new" ${!existing?'selected':''}>New record</option><option value="existing" ${existing?'selected':''}>Already in AssetHub</option></select></label>`:''}${existing?`<label class="field"><span>Existing JCP asset · search ID, model or serial</span><input data-unit="${i}" data-unit-field="existing_asset_id" list="batchExistingOptions" value="${esc(unit.existing_asset_id)}" ${operations?'readonly':''} autocomplete="off" required></label><small>${asset?esc([asset.category_name,asset.brand,asset.model,asset.serial||'No serial recorded',asset.set_name?'Set: '+asset.set_name:''].filter(Boolean).join(' · ')):'Select the exact JCP tag; this item will not be recreated.'}</small>`:`${!same?`<div class="form-grid">${productFields(unit,'unit-placeholder').replaceAll('data-unit-placeholder=',`data-unit="${i}" data-unit-field=`)}</div>`:''}<label class="field"><span>Serial for ${same?'unit':'component'} ${i+1} · optional</span><input data-unit="${i}" data-unit-field="serial" value="${esc(unit.serial)}" maxlength="80" autocomplete="off"></label><small>Leave blank if unreadable or unmarked. A separate JCP tag is generated.</small>`}</section>`;
        }).join('')}</div>${!same&&!operations?'<button id="batchAddUnit" type="button" class="btn light">Add component</button>':''}
        <div id="batchEntryError" class="scan-warning hidden" role="alert"></div><div class="modal-actions"><button type="button" id="batchCancel" class="btn light">Cancel</button><button type="submit" class="btn blue">Review ${operations?'change':draft.units.length+' items'}</button></div></form>`,()=>{
        $('batchCancel').addEventListener('click',host.closeModal);
        $('batchSetChoice')?.addEventListener('change',()=>{collect();draft.set_name=sets.find(s=>s.id===draft.set_id)?.name||'';edit();});
        $('batchQuantity')?.addEventListener('change',()=>{collect();const count=Math.max(1,Math.min(25,Math.floor(Number($('batchQuantity').value)||1)));if(count<draft.units.length&&draft.units.slice(count).some(u=>u.serial)&&!confirm('Remove the extra unit rows and their entered serials?'))return edit();draft.units=Array.from({length:count},(_,i)=>draft.units[i]||{});edit();});
        $('batchPcPreset')?.addEventListener('click',()=>{collect();const kept=draft.units.filter(u=>u.category||u.brand||u.model||u.serial||u.existing_asset_id);if(kept.length+4>25)return host.toast('A batch supports up to 25 items.','error');draft.units=kept.concat(['Desktop PC','Monitor','Keyboard','Mouse'].map(category=>({category,source:'new'})));edit();});
        $('batchAddUnit')?.addEventListener('click',()=>{collect();if(draft.units.length>=25)return host.toast('A batch supports up to 25 items.','error');draft.units.push({source:draft.mode==='attach'?'existing':'new'});edit();});
        document.querySelectorAll('[data-remove-unit]').forEach(b=>b.addEventListener('click',()=>{collect();const i=Number(b.dataset.removeUnit),u=draft.units[i];if((u.serial||u.model||u.existing_asset_id)&&!confirm('Remove this item from the draft?'))return;draft.units.splice(i,1);edit();}));
        document.querySelectorAll('[data-unit-source]').forEach(el=>el.addEventListener('change',()=>{collect();const i=Number(el.dataset.unitSource);draft.units[i]={source:el.value};edit();}));
        document.querySelectorAll('[data-unit-field="existing_asset_id"]').forEach(el=>{
          el.addEventListener('input',()=>{const q=el.value.trim().toLowerCase();$('batchExistingOptions').innerHTML=index.all.filter(a=>a.status!=='Retired'&&[a.asset_id,a.brand,a.model,a.serial,a.set_name].join(' ').toLowerCase().includes(q)).slice(0,30).map(a=>`<option value="${esc(a.asset_id)}" label="${esc([a.brand,a.model,a.serial,a.set_name].filter(Boolean).join(' · '))}">`).join('');});
          el.addEventListener('change',()=>{collect();edit();});
        });
        $('batchEntryForm').addEventListener('submit',e=>{e.preventDefault();collect();const result=payload();if(result.issues.length){$('batchEntryError').textContent=result.issues.join(' ');$('batchEntryError').classList.remove('hidden');return;}
          requestId=makeId();review(result.value,requestId,false);
        });
      });
    }
    function payload(){
      const issues=[],common={...draft.common,custom:{...draft.common.custom}};
      if(draft.mode==='same'&&common.part_code)common.specifications=[common.specifications,'Part Number: '+common.part_code].filter(Boolean).join('\n');delete common.part_code;
      const units=draft.units.map((unit,i)=>{
        if(unit.source==='existing'||['attach','rename','detach'].includes(draft.mode)){
          const asset=index.all.find(a=>a.asset_id===unit.existing_asset_id);
          if(!asset){issues.push('Component '+(i+1)+': choose an existing JCP asset.');return {existing_asset_id:unit.existing_asset_id};}
          if(draft.mode!=='detach'&&asset.set_id&&asset.set_id!==draft.set_id)issues.push(asset.asset_id+' is already in '+asset.set_name+'. Remove it from that set first.');
          return {existing_asset_id:asset.asset_id,expected_updated_at:String(asset.updated_at||'')};
        }
        const product=draft.mode==='same'?AssetGroups.template({...common,category_name:common.category}):AssetGroups.template({...unit,category_name:unit.category});
        if(!product.category&&!product.category_id)issues.push('Item '+(i+1)+': enter a category.');
        return draft.mode==='same'?{serial:unit.serial||''}:{...product,serial:unit.serial||''};
      });
      if(draft.mode!=='same'&&!draft.set_id&&!draft.set_name)issues.push('Give the equipment set a name.');
      if(!draft.set_id&&draft.set_name&&[...index.sets.values()].some(items=>text(items[0].set_name).toLowerCase()===draft.set_name.toLowerCase()))issues.push('This set name already exists. Choose that equipment set instead of creating it again.');
      if(units.filter(u=>u.existing_asset_id).length!==new Set(units.filter(u=>u.existing_asset_id).map(u=>u.existing_asset_id)).size)issues.push('The same existing asset was selected more than once.');
      issues.push(...AssetGroups.duplicateSerials(units,index));
      return {issues,value:{mode:draft.mode,set_id:draft.set_id,set_name:draft.set_name,common,units}};
    }
    function review(value,id,unconfirmed){
      const newCount=value.units.filter(u=>!u.existing_asset_id).length,existing=value.units.length-newCount,missing=value.units.filter(u=>!u.existing_asset_id&&!u.serial).length;
      const operation=value.mode==='detach'?'Remove from set':value.mode==='rename'?'Rename set':`Create ${newCount} new record${newCount===1?'':'s'}${existing?' and link '+existing+' existing item'+(existing===1?'':'s'):''}`;
      show('Review individual items',`<section class="group-review"><p class="group-step">2. Review → 3. Save</p>${unconfirmed?'<div class="scan-warning">The earlier save was not confirmed. Retry uses the same request ID and will not recreate saved units. Keep these reviewed details unchanged.</div>':''}<h3>${esc(value.set_name||'Same-model items')}</h3><p>${newCount} new records · ${existing} existing items. ${missing?missing+' new units have no recorded serial; each gets its own JCP tag.':''}</p>${existing?'<p>Existing product details, serials, photos, placement and history stay unchanged. This changes set membership only.</p>':''}${newCount?`<p>New items: ${esc(refs.sites.find(s=>s.site_id===value.common.site_id)?.name||value.common.site_id)} · ${esc(value.common.area)} · ${esc(value.common.status||'Active')}${value.common.assigned_to?' · '+esc(value.common.assigned_to):''}</p>`:''}${value.mode==='same'&&value.common.specifications?`<details open><summary>Shared specifications for the new units</summary><pre class="batch-review-specs">${esc(value.common.specifications)}</pre></details>`:''}<ol class="batch-review-items">${value.units.map(u=>{const a=u.existing_asset_id?index.all.find(a=>a.asset_id===u.existing_asset_id):value.mode==='same'?{...value.common,...u}:u;return `<li><b>${esc(a?[a.category_name||a.category,a.brand,a.model].filter(Boolean).join(' · '):u.existing_asset_id)}</b><span>${u.existing_asset_id?'Existing JCP tag: '+esc(u.existing_asset_id):'New JCP tag · Serial: '+esc(u.serial||'Not recorded')}</span></li>`;}).join('')}</ol><label class="group-confirm"><input type="checkbox" id="batchConfirm"> ${newCount?'I reviewed these as separate physical items.':'I approve this set membership/name change.'}</label><div id="batchSaveStatus" role="status" aria-live="polite"></div><div class="modal-actions"><button id="batchReviewBack" class="btn light" ${unconfirmed?'disabled':''}>Back</button><button id="batchSave" class="btn blue" disabled>${esc(operation)}</button></div></section>`,()=>{
        $('batchConfirm').addEventListener('change',()=>{$('batchSave').disabled=!$('batchConfirm').checked;});
        $('batchReviewBack').addEventListener('click',edit);
        $('batchSave').addEventListener('click',async()=>{
          if(inFlight||!$('batchConfirm').checked)return;
          if(navigator.onLine===false){$('batchSaveStatus').textContent='An internet connection is required to save. Your review is still open; reconnect and try again.';return;}
          if(pending(actor)&&pending(actor).request_id!==id){$('batchSaveStatus').textContent='Another save is unconfirmed for this account. Close this draft and review that saved request first.';return;}
          const saved={actor,request_id:id,payload:value};
          try{localStorage.setItem(pendingKey(actor),JSON.stringify(saved));}catch{host.toast('Cannot save a retry record on this device. Free browser storage and retry.','error');return;}
          inFlight=true;host.setBusy?.(true);$('batchSave').disabled=true;$('batchReviewBack').disabled=true;$('batchConfirm').disabled=true;$('batchSaveStatus').textContent='Saving the reviewed items…';
          try{
            const response=await api.post('saveAssetBatch',{request_id:id,batch_json:JSON.stringify(value),confirmed:'true'});
            if(!response.result?.assets?.length)throw new Error('Save response did not include the asset records. Retry the same reviewed request.');
            try{if(pending(actor)?.request_id===id)localStorage.removeItem(pendingKey(actor));}catch{}
            onSaved(response.result);host.toast('Saved '+response.result.assets.length+' individual items.');
          }catch(err){
            const notStarted=/^BATCH_NOT_STARTED:/.test(err.message||'');
            if(notStarted){try{localStorage.removeItem(pendingKey(actor));}catch{}if($('batchReviewBack'))$('batchReviewBack').disabled=false;}
            const detail=/REQUEST_TIMEOUT/.test(err.message||'')?'The server did not respond in time.':String(host.humanError?.(err)||err.message||err).replace(/^BATCH_NOT_STARTED:\s*/,'').replace(/^[A-Z_]+:\s*/,'');
            if($('batchSaveStatus'))$('batchSaveStatus').textContent=(notStarted?'Nothing was written. Go back to correct the reviewed items. ':'Save not confirmed. Retry the same reviewed request; do not start the batch again. ')+detail;
            if($('batchSave')){$('batchSave').disabled=false;$('batchSave').textContent='Retry reviewed save';}
          }finally{inFlight=false;host.setBusy?.(false);}
        });
      });
    }
    if(!enabled||!config.mode)chooser();else edit();
  }
  window.AssetGroupEntry={open};
})();
