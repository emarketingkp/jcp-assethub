// Synthetic backend for browser regression tests. Never connects to production.
(() => {
  const options=window.__mockOptions||{};
  const refs={sites:[{site_id:'SITE-TEST',name:'Test Site',active:true}],areas:[{area_id:'AREA-TEST',site_id:'SITE-TEST',name:'Test Area',active:true}],categories:window.__fixtureCategories,brands:[],custom_fields:options.customFields||[],assignees:[],locations:[],users:[]};
  const user={name:options.role==='GUEST'?'Guest':'Test Staff',username:options.role==='GUEST'?'guest':'test-staff',role:options.role||'STAFF'};let token=localStorage.getItem('fixture-session')||(user.role==='GUEST'?'':'test-session');if(token.startsWith('test-session-'))user.username=user.name=token.slice('test-session-'.length);
  const state=window.__mock={calls:[],assets:cloneInitial(),uploadAttempts:0,failNextUpload:false,failUploadAt:0,aiRelease:null,ocrRelease:null,expired:false,loseOperationReply:!!options.loseOperationReply&&!sessionStorage.getItem('operation-reply-lost'),loseBatchReply:!!options.loseBatchReply&&!sessionStorage.getItem('test-batch-reply-lost')};
  function cloneInitial(){return structuredClone(options.assets||[]);}
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgE0AAAAASUVORK5CYII=';
  const clone=x=>structuredClone(x);
  state.diagReleases={};state.providerReleases={};
  state.maintenance=[];state.audits=[];state.auditEntries=[];
  const auditSummary=a=>{const rows=state.auditEntries.filter(e=>e.audit_id===a.audit_id),count=r=>rows.filter(e=>e.result===r).length,pending=count('Pending'),checked=rows.length-pending;return {...a,site_name:'Test Site',area_name:'',expected_count:rows.length,checked_count:checked,pending_count:pending,verified_count:count('Verified'),mismatch_count:count('Mismatch'),not_found_count:count('Not Found'),unexpected_count:0,progress:rows.length?Math.round(checked/rows.length*100):100};};
  const diagnosticReply=params=>{
    const row=(label,state,message)=>({label,state,ok:state==='ok',message,checked_at:new Date().toISOString()});
    const components={api:row('Apps Script API','ok','Backend replied.'),version:row('App version',params.frontend_version===(options.backendVersion||'2.10.0')?'ok':'error','API target '+params.frontend_version+' / backend '+(options.backendVersion||'2.10.0')),auth:row('Session',options.diagAuthFail?'error':user.role==='GUEST'?'info':'ok',options.diagAuthFail?'Session expired.':user.role==='GUEST'?'Guest browsing.':'Active Staff session verified.'),ocr:{...row('OCR.Space','not_tested','Configured; provider request not tested.'),configured:true,evidence:'configuration'},ai:{...row('Groq AI','not_tested','Configured; model not tested.'),configured:true,evidence:'configuration'}};
    if(params.component&&params.component!=='api')return {diagnostics:{diagnostics_version:2,components:{[params.component]:row(params.component,params.component==='drive'&&options.diagDriveFail?'error':'ok',params.component==='drive'&&options.diagDriveFail?'Drive read failed.':'Read verified; writes not tested.')}}};
    return {diagnostics:options.diagLegacy?{components:{...Object.fromEntries(Object.entries(components).map(([id,row])=>[id,{ok:true,label:row.label,message:id==='auth'?'Guest/Staff/Admin policy':row.message}])),sheets:{ok:true,message:'Old read check'},drive:{ok:true,message:'Old read check'}}}:{diagnostics_version:2,components}};
  };
  const startupReply=(action,result)=>{
    if(action==='sync'&&options.failStartupSync)throw new Error('Simulated initial sync outage');
    return options.delayStartup?new Promise(resolve=>{state[action+'Release']=()=>resolve(result);}):result;
  };
  const api={getUrl:()=>'/test-backend',setUrl(){},getToken:()=>token,setToken(value){token=value;if(value)localStorage.setItem('fixture-session',value);else localStorage.removeItem('fixture-session');},getLastTiming:()=>null};
  api.get=async(action,params={})=>{
    state.calls.push({action,params:clone(params)});
    if(action==='bootstrap')return startupReply(action,{success:true,version:'2.7',features:{asset_groups:options.grouping===false?0:1,sequential_saves:options.queue?1:0,asset_links:options.links?1:0,unified_editor:options.unified?1:0,record_lifecycle:options.lifecycle?1:0,asset_delete:options.deleteAsset?1:0},user,references:clone(refs),dashboard:{},authenticated:user.role!=='GUEST',ai_ocr_enabled:!!options.ai});
    if(action==='sync')return startupReply(action,{sync:{version:'2.7',ai_ocr_enabled:!!options.ai,features:{asset_groups:options.grouping===false?0:1,sequential_saves:options.queue?1:0,asset_links:options.links?1:0,unified_editor:options.unified?1:0,record_lifecycle:options.lifecycle?1:0,asset_delete:options.deleteAsset?1:0},user,authenticated:user.role!=='GUEST',assets:clone(state.assets),references:clone(refs),server_time:new Date().toISOString()}});
    if(action==='suggestMatchesV27'){if(options.matchFail)throw new Error('Matching service unavailable');return {matches:clone(options.matches||[])};}
    if(action==='listAssets')return {assets:clone(state.assets)};
    if(action==='listMaintenance')return {rows:clone(state.maintenance.filter(m=>params.include_archived||!m.archived_at).map(m=>({...m,asset:state.assets.find(x=>x.asset_id===m.asset_id)||null})))};
    if(action==='listAudits')return {rows:clone(state.audits.map(auditSummary))};
    if(action==='getAuditRoster')return {roster:{rows:clone(state.auditEntries.filter(e=>e.audit_id===params.audit_id).map(e=>({...state.assets.find(x=>x.asset_id===e.asset_id),...e,expected:true})))}};
    if(action==='assetSummaryPage'){const rows=clone(state.assets).filter(a=>a.status!=='Merged'&&a.asset_id>String(params.after||'')).sort((a,b)=>a.asset_id<b.asset_id?-1:1),size=Number(params.page_size)||200;return {assets:rows.slice(0,size),next_cursor:rows.length>size?rows[size-1].asset_id:''};}
    if(action==='assetDetailsBatch')return {assets:clone(state.assets.filter(a=>JSON.parse(params.ids_json).includes(a.asset_id)).map(a=>{const b={...a};delete b.images;return b;}))};
    if(action==='getAsset'){
      const result={asset:clone(state.assets.find(a=>a.asset_id===params.asset_id))};
      if(options.delayAssetDetails)return new Promise(resolve=>{(state.detailReleases||={})[params.asset_id]=()=>resolve(result);});
      return result;
    }
    if(action==='report'&&window.__assetReportBridge)return {report:await window.__assetReportBridge(params)};
    if(action==='getImageData'){
      const result={data:{data_url:pixel}};
      if(options.delayImages)return new Promise(resolve=>{(state.imageReleases||={})[params.file_id]=()=>resolve(result);});
      return result;
    }
    if(action==='diagnostics'){
      if(options.diagDelayed&&['sheets','drive'].includes(params.component))return new Promise(resolve=>{state.diagReleases[params.component]=()=>resolve(diagnosticReply(params));});
      return diagnosticReply(params);
    }
    throw new Error('Unexpected mock GET: '+action);
  };
  api.post=async(action,params={})=>{
    state.calls.push({action,params:clone(params)});
    if(action==='login'){Object.assign(user,{username:params.username,name:params.username,role:params.username==='guest'?'GUEST':'STAFF'});state.expired=false;return {token:'test-session-'+params.username,user:clone(user)};}
    if(action==='logout'){Object.assign(user,{username:'guest',name:'Guest',role:'GUEST'});token='';return {success:true};}
    if(action==='deleteAsset'){
      const result=await window.__assetDeleteBridge(params,clone(user));
      state.assets=state.assets.filter(row=>row.asset_id!==result.deleted_asset_id);
      return result;
    }
    if(action==='saveAssetOperation'){
      if(state.expired)throw new Error('SESSION_EXPIRED');
      const reply=await window.__assetOperationBridge(params,clone(user));
      state.assets=reply.assets.map(a=>({...state.assets.find(old=>old.asset_id===a.asset_id),...a,...(a.asset_id===reply.result.asset.asset_id?reply.result.asset:{})}));
      if(state.loseOperationReply){state.loseOperationReply=false;sessionStorage.setItem('operation-reply-lost','1');throw new Error('Simulated lost reply after backend committed');}
      return {result:reply.result};
    }
    if(action==='testScanConnection'){
      if(user.role==='GUEST')throw new Error('AUTH_REQUIRED');
      const result={check:{state:params.service==='ai'&&options.diagAiFail?'error':'ok',message:params.service==='ai'&&options.diagAiFail?'AI_RATE_LIMIT_PROVIDER: Groq quota reached.':'Built-in sample verified.',checked_at:new Date().toISOString(),evidence:'provider_test'}};
      if(options.diagProviderDelayed&&params.service==='ocr')return new Promise(resolve=>{state.providerReleases.ocr=()=>resolve(result);});
      return result;
    }
    if(action==='saveAssetBatch'){
      const reply=await window.__assetBatchBridge(params);state.assets=reply.assets;
      if(state.loseBatchReply){state.loseBatchReply=false;sessionStorage.setItem('test-batch-reply-lost','1');throw new Error('Simulated lost reply after the real backend saved');}
      return {result:reply.result};
    }
    if(action==='ocr'){
      const result={result:{text:options.ocrText||'Brand: Ricoh\nCategory: Printer\nModel: TEST-100\nSerial: O01I2345\nRAM: 8 GB',fields:{brand:'HP',category:'Desktop PC'}}};
      if(options.ocrDelayed)return new Promise(resolve=>{state.ocrRelease=()=>resolve(result);});
      return result;
    }
    if(action==='interpretOcrUniversal'){
      if(options.aiError)throw new Error(options.aiError);
      if(options.aiDelayed)return new Promise(resolve=>{state.aiRelease=()=>resolve({result:{fields:{brand:{value:'Ricoh',evidence:'Brand: Ricoh',status:'supported'}}}});});
      throw new Error('Simulated provider outage');
    }
    if(action==='createAsset'){
      const a={...params,asset_id:'TEST-'+(state.assets.length+1),category_name:params.category,site_name:'Test Site',area_name:params.area,images:[],custom_fields:[],maintenance:[],movements:[],activity:[],guest_upload_token:user.role==='GUEST'?'test-upload-grant':''};
      state.assets.push(a);return {asset:clone(a)};
    }
    if(action==='updateAsset'){
      const a=state.assets.find(a=>a.asset_id===params.asset_id);Object.assign(a,params);return {asset:clone(a)};
    }
    if(action==='uploadImage'){
      state.uploadAttempts++;
      if(state.failNextUpload||state.uploadAttempts===state.failUploadAt){state.failNextUpload=false;throw new Error('Simulated image upload failure');}
      const a=state.assets.find(a=>a.asset_id===params.assetId);
      if(user.role==='GUEST'&&params.guest_upload_token!=='test-upload-grant')throw new Error('Missing guest upload grant');
      const image={image_id:'IMG-'+state.uploadAttempts,image_type:params.imageType,drive_file_id:'FILE-'+state.uploadAttempts,thumbnail_file_id:'THUMB-'+state.uploadAttempts,active:true};
      (a.images||(a.images=[])).push(image);return {image:clone(image)};
    }
    if(action==='replaceImage'){
      const a=state.assets.find(a=>a.images.some(i=>i.image_id===params.image_id));
      const image=a.images.find(i=>i.image_id===params.image_id);
      if(user.role!=='ADMIN')throw new Error('PERMISSION_DENIED');
      if(params.imageType!==image.image_type)throw new Error('Image type changed');
      image.drive_file_id='REPLACED-FILE';image.thumbnail_file_id='REPLACED-THUMB';
      return {image:clone(image)};
    }
    if(action==='createMaintenance'){const row={maintenance_id:'MNT-'+(state.maintenance.length+1),asset_id:params.asset_id,issue:params.issue,maintenance_type:params.maintenance_type||'Repair',status:'Open',reported_by:user.username,reported_at:new Date().toISOString(),assigned_to:'',resolution:'',cost:'',completed_at:'',updated_at:new Date().toISOString(),archived_at:''};state.maintenance.push(row);return {row:clone(row)};}
    if(action==='updateMaintenance'||action==='archiveMaintenance'||action==='restoreMaintenance'){const row=state.maintenance.find(m=>m.maintenance_id===params.maintenance_id);if(action==='updateMaintenance')Object.assign(row,params,{updated_at:new Date().toISOString(),completed_at:params.status==='Completed'?new Date().toISOString():''});else row.archived_at=action==='archiveMaintenance'?new Date().toISOString():'';return {row:clone(row)};}
    if(action==='startAudit'){const row={audit_id:'AUD-'+(state.audits.length+1),site_id:params.site_id,area_id:params.area_id||'',name:params.name||'Physical Audit',started_at:new Date().toISOString(),status:'In Progress',completed_at:''};state.audits.push(row);for(const a of state.assets.filter(x=>x.site_id===params.site_id&&!['Retired','Merged'].includes(x.status)))state.auditEntries.push({audit_id:row.audit_id,asset_id:a.asset_id,result:'Pending',notes:''});return {row:clone(auditSummary(row))};}
    if(action==='verifyAuditAsset'||action==='resetAuditEntry'){const e=state.auditEntries.find(x=>x.audit_id===params.audit_id&&x.asset_id===params.asset_id);e.result=action==='resetAuditEntry'?'Pending':params.result||'Verified';e.notes=params.notes||'';return {row:clone(e)};}
    if(action==='completeAudit'||action==='cancelAudit'||action==='renameAudit'){const a=state.audits.find(x=>x.audit_id===params.audit_id);if(action==='renameAudit')a.name=params.name;else{a.status=action==='completeAudit'?'Completed':'Cancelled';a.completed_at=new Date().toISOString();}return {row:clone(auditSummary(a))};}
    if(action==='restoreAsset'){const a=state.assets.find(x=>x.asset_id===params.asset_id);a.status=params.status||'Active';return {asset:clone(a)};}
    throw new Error('Unexpected mock POST: '+action);
  };
  window.AssetAPI=api;
})();
