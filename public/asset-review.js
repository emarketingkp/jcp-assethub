/* Every writable field can be reviewed; an omitted proposal never clears saved data. */
window.AssetReview = {
  open({full, incoming, files, session, entry, context:c, forget, queueRow=null}) {
    const E=AssetEditor, esc=c.esc, baseline=E.values(full), proposed={}, scope=c.scope();
    const fields=E.fields.filter(f=>f.key!=='movement_note');
    for(const f of fields) {
      if(Object.hasOwn(incoming,f.key)&&(incoming[f.key]!==''||session?.touched?.[f.key]||entry.changed?.[f.key])) proposed[f.key]=incoming[f.key];
    }
    if(entry.main?.mode==='link') {
      for(const key of ['site_id','area','exact_location','assigned_to']) if(entry[key]||entry.changed?.[key]) proposed[key]=entry[key]||'';
      const link=session?.mainBinding?.link();
      if(link?.anchor) proposed.parent_asset_id=link.anchor.asset_id;
      else if(link?.parent) proposed.parent_asset_id='pending:'+link.parent;
    } else if(entry.changed?.parent_asset_id) proposed.parent_asset_id='';
    const custom=Object.fromEntries((full.custom_fields||[]).map(f=>[f.field_id,f.value||'']));
    const customProposed=entry.customChanged?entry.custom||{}:{};
    const privateProposed=Object.fromEntries(Object.keys(entry.privateChanged||{}).map(k=>[k,entry.private?.[k]||'']));
    const controls=(key,label,old,value,editor)=>`<section class="reconcile-row" data-review-row="${esc(key)}"><b>${esc(label)}</b><div class="reconcile-values"><label><input type="radio" name="choice_${esc(key)}" value="existing" checked><span><small>Keep existing</small><b>${esc(old||'—')}</b></span></label><div class="review-value"><label><input type="radio" name="choice_${esc(key)}" value="incoming"><span>Apply value below</span></label>${editor}${value===''?'<small>Applying an empty value clears this field.</small>':''}</div>${key==='specifications'&&old&&value?'<label><input type="radio" name="choice_specifications" value="combine"><span>Combine new specification keys</span></label>':''}</div></section>`;
    function editor(f,value) {
      const attrs=`data-review-field="${esc(f.key)}" data-universal-field="${esc(f.key)}" name="${esc(f.key)}" aria-label="Review ${esc(f.label)}"`;
      if(f.key==='site_id') return `<select ${attrs}><option value="">Choose site</option>${c.state.refs.sites.filter(s=>String(s.active)!=='false').map(s=>`<option value="${esc(s.site_id)}" ${s.site_id===value?'selected':''}>${esc(s.name)}</option>`).join('')}</select>`;
      if(f.key==='status') return `<select ${attrs}>${E.statuses.filter(s=>s!=='Retired'||c.isAdmin()||full.status==='Retired').map(s=>`<option ${s===value?'selected':''}>${s}</option>`).join('')}</select>`;
      if(f.key==='specifications') return `<textarea ${attrs} maxlength="${f.max}" rows="3">${esc(value)}</textarea>`;
      return `<input ${attrs} maxlength="${f.key==='parent_asset_id'?100:f.max}" value="${esc(value)}">`;
    }
    const html=fields.map(f=>controls(f.key,f.label,baseline[f.key],proposed[f.key],editor(f,proposed[f.key]??baseline[f.key]))).join('');
    const customs=c.state.refs.custom_fields.map(f=>controls('custom_'+f.field_id,f.label,custom[f.field_id],customProposed[f.field_id],c.customFieldsHtml([{field_id:f.field_id,value:customProposed[f.field_id]??custom[f.field_id]}],[f]))).join('');
    const privateHtml=c.isAuthenticated()?E.privateFields.map(f=>controls('private_'+f.key,f.label,full.private_details?.[f.key],privateProposed[f.key],`<input data-review-private="${f.key}" aria-label="Review ${esc(f.label)}" maxlength="160" value="${esc(privateProposed[f.key]??full.private_details?.[f.key]??'')}">`)).join(''):'';
    c.openModal('Review asset changes',`<form id="reconcileForm"><div class="reconcile-intro"><b>${esc(E.displayName(full))}</b><span>${esc(full.asset_id)} · select each change to apply it</span></div>${html}${customs}${privateHtml}<div class="field"><label>Movement note <small>(optional)</small></label><input name="movement_note" maxlength="500"></div><p class="input-hint">${files.length} source photo${files.length===1?'':'s'} will be attached. You can fill missing information here. Main asset accepts an existing asset ID; an empty selected value removes its link.</p><div class="modal-actions"><button type="button" id="reconcileCancel" class="btn light">Cancel</button><button type="submit" class="btn blue">Save reviewed changes</button></div></form>`,()=>{
      const form=document.getElementById('reconcileForm');
      document.getElementById('reconcileCancel').onclick=()=>c.closeModal();
      form.querySelectorAll('[data-review-row]').forEach(row=>{
        const input=row.querySelector('[data-review-field],[data-custom],[data-review-private]');
        input.required=false;
        input.addEventListener('input',()=>row.querySelector('[value=incoming]').checked=true);
        input.addEventListener('change',()=>row.querySelector('[value=incoming]').checked=true);
      });
      // Reuse the same catalogs and serial popup without replacing this comparison.
      c.reviewControls?.(form);
      form.onsubmit=async e=>{
        e.preventDefault();const button=form.querySelector('[type=submit]');if(button.disabled)return;button.disabled=true;
        try {
          const choices={},sent={},privateValues={},customValues={...custom};
          const choice=key=>form.querySelector(`[name="choice_${key}"]:checked`)?.value||'existing';
          for(const f of fields) {
            const value=form.querySelector(`[data-review-field="${f.key}"]`).value;
            if(Object.hasOwn(proposed,f.key)||choice(f.key)!=='existing') {sent[f.key]=value;choices[f.key]=choice(f.key);}
          }
          const final={...baseline,...E.reviewed(full,sent,choices)};
          if(!final.category||!final.site_id||!final.area) throw new Error('Category, site and area are required.');
          for(const f of c.state.refs.custom_fields) {
            if(choice('custom_'+f.field_id)==='incoming') customValues[f.field_id]=form.querySelector(`[data-custom="${f.field_id}"]`).value;
            if((f.required===true||String(f.required)==='true')&&!customValues[f.field_id]) throw new Error(f.label+' is required.');
          }
          for(const f of E.privateFields) if(choice('private_'+f.key)==='incoming') privateValues[f.key]=form.querySelector(`[data-review-private="${f.key}"]`).value;
          let link={};
          if(choices.parent_asset_id==='incoming'&&String(sent.parent_asset_id||'').startsWith('pending:')) {link={parent:sent.parent_asset_id.slice(8)};delete sent.parent_asset_id;delete choices.parent_asset_id;}
          const params={asset_id:full.asset_id,expected_updated_at:full.updated_at,movement_note:form.elements.movement_note.value,custom_json:JSON.stringify(customValues),incoming_json:JSON.stringify(sent),choices_json:JSON.stringify(choices)};
          if(Object.keys(privateValues).length) params.private_json=JSON.stringify(privateValues);
          const id=queueRow?.id||session?.queueId||crypto.randomUUID();
          const photos=files.map(file=>({file,type:'serial_label',main:!!session?.photos.find(p=>p.file===file)?.main}));
          const old=c.rows().find(r=>r.id===id),evidence=session?c.recognitionEvidence(session):null;
          const saved=old?await c.queue().revise(id,params,photos,{...link,kind:'reconcile'},evidence):await c.queue().enqueue({id,kind:'reconcile',params,photos,evidence,...link});
          await forget(session?.draftId);
          if(scope!==c.scope()||!form.isConnected)return;
          if(session)session.locallySaved=true;
          if(c.returnToInterruptedTask(id))return;
          const restore=c.hasModalReturn();c.closeModal();if(restore)return;
          c.resetScannerResult({restartCamera:false});c.openLocalOperation(saved);
        } catch(err) {c.toast('Changes were not saved. '+err.message,'error');}
        finally {button.disabled=false;}
      };
    },{size:'lg',stack:true});
  }
};
