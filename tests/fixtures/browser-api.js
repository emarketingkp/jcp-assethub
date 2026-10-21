// Synthetic backend for browser regression tests. Never connects to production.
(() => {
  const options=window.__mockOptions||{};
  const refs={sites:[{site_id:'SITE-TEST',name:'Test Site',active:true}],areas:[{area_id:'AREA-TEST',site_id:'SITE-TEST',name:'Test Area',active:true}],categories:window.__fixtureCategories,brands:[],custom_fields:[],assignees:[],locations:[],users:[]};
  const user={name:'Test Staff',username:'test-staff',role:options.role||'STAFF'};
  const state=window.__mock={calls:[],assets:cloneInitial(),uploadAttempts:0,failNextUpload:false,failUploadAt:0,aiRelease:null,ocrRelease:null,loseBatchReply:!!options.loseBatchReply&&!sessionStorage.getItem('test-batch-reply-lost')};
  function cloneInitial(){return structuredClone(options.assets||[]);}
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jgE0AAAAASUVORK5CYII=';
  const clone=x=>structuredClone(x);
  state.diagReleases={};state.providerReleases={};
  const diagnosticReply=params=>{
    const row=(label,state,message)=>({label,state,ok:state==='ok',message,checked_at:new Date().toISOString()});
    const components={api:row('Apps Script API','ok','Backend replied.'),version:row('App version','ok','Frontend/backend compatible.'),auth:row('Session',options.diagAuthFail?'error':user.role==='GUEST'?'info':'ok',options.diagAuthFail?'Session expired.':user.role==='GUEST'?'Guest browsing.':'Active Staff session verified.'),ocr:{...row('OCR.Space','not_tested','Configured; provider request not tested.'),configured:true,evidence:'configuration'},ai:{...row('Groq AI','not_tested','Configured; model not tested.'),configured:true,evidence:'configuration'}};
    if(params.component&&params.component!=='api')return {diagnostics:{diagnostics_version:2,components:{[params.component]:row(params.component,params.component==='drive'&&options.diagDriveFail?'error':'ok',params.component==='drive'&&options.diagDriveFail?'Drive read failed.':'Read verified; writes not tested.')}}};
    return {diagnostics:options.diagLegacy?{components:{...Object.fromEntries(Object.entries(components).map(([id,row])=>[id,{ok:true,label:row.label,message:id==='auth'?'Guest/Staff/Admin policy':row.message}])),sheets:{ok:true,message:'Old read check'},drive:{ok:true,message:'Old read check'}}}:{diagnostics_version:2,components}};
  };
  const startupReply=(action,result)=>{
    if(action==='sync'&&options.failStartupSync)throw new Error('Simulated initial sync outage');
    return options.delayStartup?new Promise(resolve=>{state[action+'Release']=()=>resolve(result);}):result;
  };
  const api={getUrl:()=>'/test-backend',setUrl(){},getToken:()=>user.role==='GUEST'?'':'test-session',setToken(){},getLastTiming:()=>null};
  api.get=async(action,params={})=>{
    state.calls.push({action,params:clone(params)});
    if(action==='bootstrap')return startupReply(action,{success:true,version:'2.7',features:{asset_groups:options.grouping===false?0:1,sequential_saves:options.queue?1:0},user,references:clone(refs),dashboard:{},authenticated:user.role!=='GUEST',ai_ocr_enabled:!!options.ai});
    if(action==='sync')return startupReply(action,{sync:{version:'2.7',ai_ocr_enabled:!!options.ai,features:{asset_groups:options.grouping===false?0:1,sequential_saves:options.queue?1:0},user,authenticated:user.role!=='GUEST',assets:clone(state.assets),references:clone(refs),server_time:new Date().toISOString()}});
    if(action==='suggestMatchesV27'){if(options.matchFail)throw new Error('Matching service unavailable');return {matches:clone(options.matches||[])};}
    if(action==='listAssets')return {assets:clone(state.assets)};
    if(action==='assetDetailsBatch')return {assets:clone(state.assets.filter(a=>JSON.parse(params.ids_json).includes(a.asset_id)).map(a=>{const b={...a};delete b.images;return b;}))};
    if(action==='getAsset')return {asset:clone(state.assets.find(a=>a.asset_id===params.asset_id))};
    if(action==='getImageData')return {data:{data_url:pixel}};
    if(action==='diagnostics'){
      if(options.diagDelayed&&['sheets','drive'].includes(params.component))return new Promise(resolve=>{state.diagReleases[params.component]=()=>resolve(diagnosticReply(params));});
      return diagnosticReply(params);
    }
    throw new Error('Unexpected mock GET: '+action);
  };
  api.post=async(action,params={})=>{
    state.calls.push({action,params:clone(params)});
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
    throw new Error('Unexpected mock POST: '+action);
  };
  window.AssetAPI=api;
})();
