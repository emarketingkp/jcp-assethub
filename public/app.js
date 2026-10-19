(() => {
  const $ = id => document.getElementById(id);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const state = {
    boot:null,user:null,refs:{sites:[],areas:[],categories:[],custom_fields:[],brands:[],assignees:[],locations:[],users:[]},
    assets:[],maintenance:[],audits:[],movements:[],report:null,route:'dashboard',adminTab:'sites',
    cameraStream:null,scanTimer:null,barcodeDetector:null,scanFile:null,recognitionSession:null,scanUpdateTarget:null,imageCache:new Map(),assetDetails:new Map(),detailRequests:new Map(),activeAuditId:'',
    adminMode:false,diagnostics:null,deepLinkHandled:false,lastRecognition:null,latestVersion:null,modalRestoreFocus:null,
    assetView:localStorage.getItem('jcp_assethub_asset_view')||'list',
    sync:{inFlight:false,lastCursor:localStorage.getItem('jcp_assethub_sync_cursor')||'',lastStarted:0,lastCompleted:0},
    indicator:{jobs:new Map(),next:0},passiveJobs:0,openAssetId:'',
    cacheHydrated:false,reportCacheKey:'',
    assetSort:{key:'updated_at',dir:'desc'},
    assetFilters:{site:'',area:'',category:'',status:'',assigned:'',location:'',dateField:'updated_at',dateFrom:'',dateTo:''},
    maintenanceSort:{key:'reported_at',dir:'desc'},
    maintenanceFilters:{status:'',type:'',assigned:'',dateField:'reported_at',dateFrom:'',dateTo:''}
  };
  const APP_VERSION = '2.7';
  const ASSET_BASE_URL = 'https://assets.jcpmalaysia.com/';
  const CACHE_BOOT = 'jcp_assethub_cache_boot_v1';
  const CACHE_ASSETS = 'jcp_assethub_cache_assets_v1';
  const CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const DATA_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
  const DETAIL_CACHE_MAX_AGE = 24 * 60 * 60 * 1000;
  const DETAIL_REVALIDATE_MS = 2 * 60 * 1000;
  const THUMB_CACHE_MAX_AGE = 14 * 24 * 60 * 60 * 1000;
  const SYNC_MIN_GAP = 12000;
  const STORE_KEYS = {assets:'data:assets',maintenance:'data:maintenance',audits:'data:audits',reportPrefix:'report:',detailPrefix:'detail:',thumbPrefix:'thumb:',cursor:'meta:cursor'};

  function cacheRead(key,maxAge=CACHE_MAX_AGE){
    try{
      const item=JSON.parse(localStorage.getItem(key)||'null');
      if(!item||!item.saved_at||Date.now()-item.saved_at>maxAge)return null;
      return item.data;
    }catch{return null;}
  }
  function cacheWrite(key,data){try{localStorage.setItem(key,JSON.stringify({saved_at:Date.now(),data}));}catch{}}
  function cacheRemove(key){try{localStorage.removeItem(key);}catch{}}
  function safeBootCache(data){
    if(!data)return null;
    const refs={...(data.references||{}),users:[]};
    return {success:true,version:data.version,guest_can_add:true,authenticated:false,ai_ocr_enabled:!!data.ai_ocr_enabled,write_auth_required:data.write_auth_required,user:{name:'Guest',username:'guest',email:'',role:'GUEST'},references:refs,dashboard:data.dashboard||{},legacy_import:data.legacy_import||null};
  }


  function publicAssetSummary(asset){
    if(!asset)return null;
    const copy={...asset};
    ['private_details','images','custom_fields','maintenance','movements','activity','guest_upload_token'].forEach(k=>delete copy[k]);
    return copy;
  }
  function publicAssetDetail(asset){
    if(!asset)return null;
    const copy=JSON.parse(JSON.stringify(asset));
    delete copy.private_details;
    delete copy.guest_upload_token;
    return copy;
  }
  function detailStoreKey(assetId){return STORE_KEYS.detailPrefix+String(assetId||'');}
  function detailMemoryRecord(assetId){return state.assetDetails.get(String(assetId||''))||null;}
  function cacheAssetDetail(asset,{persist=true}={}){
    if(!asset?.asset_id)return asset;
    const id=String(asset.asset_id);
    state.assetDetails.set(id,{data:asset,savedAt:Date.now(),role:role()});
    optimisticAsset(asset);
    if(persist&&window.AssetStore) window.AssetStore.set(detailStoreKey(id),publicAssetDetail(asset));
    return asset;
  }
  function invalidateAssetDetail(assetId){
    const id=String(assetId||''); if(!id)return;
    state.assetDetails.delete(id);
    window.AssetStore?.remove?.(detailStoreKey(id));
  }
  function markDetailStaleFromSummary(asset){
    if(!asset?.asset_id)return;
    const rec=detailMemoryRecord(asset.asset_id);
    if(!rec)return;
    const detailStamp=new Date(rec.data?.updated_at||0).getTime()||0;
    const summaryStamp=new Date(asset.updated_at||0).getTime()||0;
    if(summaryStamp>detailStamp)invalidateAssetDetail(asset.asset_id);
  }
  function clearSensitiveDetailCache(){state.assetDetails.clear();}
  function detailNeedsRefresh(record){
    if(!record)return true;
    if(Date.now()-Number(record.savedAt||0)>DETAIL_REVALIDATE_MS)return true;
    if(isAuthenticated() && String(record.role||'GUEST')==='GUEST')return true;
    return false;
  }
  function roleAtLeastClient(required){
    const rank={GUEST:0,STAFF:1,ADMIN:2};
    return (rank[role()]||0)>=(rank[String(required||'GUEST').toUpperCase()]||0);
  }
  function upsertByKey(list,row,key){
    if(!row)return list||[];
    const out=Array.isArray(list)?list.slice():[];
    const idx=out.findIndex(x=>String(x?.[key])===String(row?.[key]));
    if(idx>=0)out[idx]={...out[idx],...row}; else out.unshift(row);
    return out;
  }
  function removeByIds(list,ids,key){
    const set=new Set((ids||[]).map(String));
    return (list||[]).filter(x=>!set.has(String(x?.[key])));
  }
  function refreshDerivedReferences(){
    const uniq=arr=>Array.from(new Set(arr.filter(Boolean).map(String))).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'}));
    state.refs.brands=uniq((state.assets||[]).map(a=>a.brand));
    state.refs.assignees=uniq((state.assets||[]).map(a=>a.assigned_to));
    state.refs.locations=uniq((state.assets||[]).map(a=>a.exact_location));
  }
  function decorateMaintenanceLocal(row){
    if(!row)return row;
    const a=state.assets.find(x=>String(x.asset_id)===String(row.asset_id));
    return {...row,asset:row.asset||(a?{asset_id:a.asset_id,brand:a.brand,model:a.model,status:a.status}:null)};
  }
  function renderIndicator(){
    const el=$('syncIndicator'),txt=$('syncIndicatorText'); if(!el)return;
    const jobs=Array.from(state.indicator.jobs.values());
    const show=jobs.length>0;
    el.classList.toggle('hidden',!show);
    el.setAttribute('aria-busy',show?'true':'false');
    if(txt&&show){
      const label=jobs[jobs.length-1]||'Working…';
      txt.textContent=jobs.length>1?`${label} · ${jobs.length} tasks`:label;
    }
  }
  function beginIndicator(label='Working…'){
    const id=++state.indicator.next;
    state.indicator.jobs.set(id,label);
    renderIndicator();
    return id;
  }
  function updateIndicator(id,label){if(state.indicator.jobs.has(id)){state.indicator.jobs.set(id,label);renderIndicator();}}
  function endIndicator(id){if(id){state.indicator.jobs.delete(id);renderIndicator();}}
  async function withIndicator(label,fn){const id=beginIndicator(label);try{return await fn(id);}finally{endIndicator(id);}}
  function renderPassiveSync(){
    const btn=$('systemStatusBtn'),dot=$('systemStatusDot'),text=$('systemStatusText');
    if(!btn||!dot||!text)return;
    const active=state.passiveJobs>0;
    btn.classList.toggle('passive-sync',active);
    if(active){dot.className='system-status-dot checking';text.textContent='Syncing';return;}
    const status=state.diagnostics?.status || (navigator.onLine?'online':'warning');
    dot.className='system-status-dot '+status;
    text.textContent=status==='online'?'Online':status==='warning'?'Warning':status==='issues'?'Issues':'Checking';
  }
  function beginPassiveSync(){state.passiveJobs++;renderPassiveSync();}
  function endPassiveSync(){state.passiveJobs=Math.max(0,state.passiveJobs-1);renderPassiveSync();}
  async function withPassiveSync(fn){beginPassiveSync();try{return await fn();}finally{endPassiveSync();}}
  function markSyncCursor(cursor){
    if(!cursor)return;
    state.sync.lastCursor=cursor;
    try{localStorage.setItem('jcp_assethub_sync_cursor',cursor);}catch{}
    window.AssetStore?.set?.(STORE_KEYS.cursor,cursor);
  }
  async function persistPublicData(){
    if(!window.AssetStore)return;
    await Promise.allSettled([
      window.AssetStore.set(STORE_KEYS.assets,(state.assets||[]).map(publicAssetSummary)),
      window.AssetStore.set(STORE_KEYS.maintenance,state.maintenance||[]),
      window.AssetStore.set(STORE_KEYS.audits,state.audits||[])
    ]);
  }
  async function hydratePersistentData(){
    if(!window.AssetStore||state.cacheHydrated)return false;
    state.cacheHydrated=true;
    const [assets,maintenance,audits,cursor]=await Promise.all([
      window.AssetStore.get(STORE_KEYS.assets,{maxAge:DATA_CACHE_MAX_AGE}),
      window.AssetStore.get(STORE_KEYS.maintenance,{maxAge:DATA_CACHE_MAX_AGE}),
      window.AssetStore.get(STORE_KEYS.audits,{maxAge:DATA_CACHE_MAX_AGE}),
      window.AssetStore.get(STORE_KEYS.cursor,{maxAge:Infinity})
    ]);
    if(Array.isArray(assets)&&assets.length)state.assets=assets;
    if(Array.isArray(maintenance))state.maintenance=maintenance;
    if(Array.isArray(audits))state.audits=audits;
    // A delta cursor is only useful when the base asset snapshot still exists.
    // If browser storage was cleared/expired but localStorage kept the cursor,
    // force the next sync to return a complete asset snapshot.
    if(Array.isArray(assets)) {
      if(cursor&&!state.sync.lastCursor)markSyncCursor(cursor);
    } else {
      state.sync.lastCursor='';
      try{localStorage.removeItem('jcp_assethub_sync_cursor');}catch{}
      window.AssetStore?.remove?.(STORE_KEYS.cursor);
    }
    return !!(state.assets.length||state.maintenance.length||state.audits.length);
  }
  function renderCurrentData(){
    if(state.route==='assets')renderAssets();
    else if(state.route==='maintenance')renderMaintenance();
    else if(state.route==='audit')renderAudits();
    else if(state.route==='dashboard')renderDashboard();
  }
  async function backgroundSync(reason='background',{force=false}={}){
    if(!navigator.onLine||state.sync.inFlight)return null;
    const now=Date.now();
    if(!force && now-state.sync.lastStarted<SYNC_MIN_GAP)return null;
    state.sync.inFlight=true;state.sync.lastStarted=now;
    beginPassiveSync();
    try{
      const r=await AssetAPI.get('sync',{since:state.sync.lastCursor||''});
      const d=r.sync||{};
      const openAssetChanged=!!state.openAssetId&&(d.assets||[]).some(a=>String(a.asset_id)===String(state.openAssetId));
      (d.assets||[]).forEach(a=>{markDetailStaleFromSummary(a);state.assets=upsertByKey(state.assets,publicAssetSummary(a),'asset_id');});
      if(d.removed_asset_ids?.length)state.assets=removeByIds(state.assets,d.removed_asset_ids,'asset_id');
      refreshDerivedReferences();
      (d.maintenance||[]).forEach(m=>{
        state.maintenance=upsertByKey(state.maintenance,decorateMaintenanceLocal(m),'maintenance_id');
        const rec=detailMemoryRecord(m.asset_id);
        if(rec?.data){rec.data.maintenance=upsertByKey(rec.data.maintenance||[],m,'maintenance_id');rec.savedAt=Date.now();window.AssetStore?.set?.(detailStoreKey(m.asset_id),publicAssetDetail(rec.data));}
      });
      (d.activity||[]).forEach(x=>{
        if(!x.asset_id)return;
        const rec=detailMemoryRecord(x.asset_id); if(!rec?.data)return;
        const rows=rec.data.activity||[];
        const duplicate=rows.some(r=>String(r.timestamp)===String(x.timestamp)&&String(r.action)===String(x.action)&&String(r.details||'')===String(x.details||''));
        if(!duplicate)rec.data.activity=[x,...rows].slice(0,30);
        rec.savedAt=Date.now(); window.AssetStore?.set?.(detailStoreKey(x.asset_id),publicAssetDetail(rec.data));
      });
      (d.audits||[]).forEach(a=>{state.audits=upsertByKey(state.audits,a,'audit_id');});
      if(d.references){state.refs={...state.refs,...d.references};populateFilters();if(isAdmin()&&state.route==='admin')renderAdmin();}
      if(d.dashboard){state.boot={...(state.boot||{}),version:d.version||state.boot?.version||APP_VERSION,write_auth_required:d.write_auth_required!==undefined?d.write_auth_required:state.boot?.write_auth_required,authenticated:d.authenticated!==undefined?d.authenticated:state.boot?.authenticated,references:state.refs,dashboard:d.dashboard,legacy_import:d.legacy_import||state.boot?.legacy_import||null};cacheWrite(CACHE_BOOT,safeBootCache(state.boot));}
      if(d.user){
        state.user=d.user;
        if(d.authenticated===false && AssetAPI.getToken()) AssetAPI.setToken('');
        if(!hasAdminRole())state.adminMode=false;
        applyRole();
      }
      markSyncCursor(d.server_time||new Date().toISOString());
      state.sync.lastCompleted=Date.now();
      await persistPublicData();
      renderCurrentData();
      if(openAssetChanged&&state.openAssetId){
        const id=state.openAssetId;
        fetchAssetDetail(id,{label:'Refreshing open asset…'}).then(a=>{if(state.openAssetId===id&&a)renderDrawer(a);}).catch(err=>console.warn('Open asset refresh failed',err));
      }
      return d;
    }catch(err){
      console.warn('Background sync failed',err);
      updateSystemStatus({status:navigator.onLine?'warning':'offline'});
      return null;
    }finally{
      state.sync.inFlight=false;endPassiveSync();
    }
  }
  function scheduleSync(reason='change',delay=120){setTimeout(()=>backgroundSync(reason,{force:true}),delay);}
  function optimisticAsset(asset){
    const safe=publicAssetSummary(asset); if(!safe)return;
    state.assets=upsertByKey(state.assets,safe,'asset_id');
    refreshDerivedReferences();
    window.AssetStore?.set?.(STORE_KEYS.assets,state.assets.map(publicAssetSummary));
    if(state.route==='assets')renderAssets();
  }
  function optimisticMaintenance(row){
    if(!row)return;
    const decorated=decorateMaintenanceLocal(row);
    state.maintenance=upsertByKey(state.maintenance,decorated,'maintenance_id');
    const rec=detailMemoryRecord(row.asset_id);
    if(rec?.data){
      rec.data.maintenance=upsertByKey(rec.data.maintenance||[],row,'maintenance_id');
      rec.savedAt=Date.now();
      state.assetDetails.set(String(row.asset_id),rec);
      window.AssetStore?.set?.(detailStoreKey(row.asset_id),publicAssetDetail(rec.data));
    }
    window.AssetStore?.set?.(STORE_KEYS.maintenance,state.maintenance); if(state.route==='maintenance')renderMaintenance();
  }
  function optimisticAudit(row){
    if(!row)return; state.audits=upsertByKey(state.audits,row,'audit_id');
    window.AssetStore?.set?.(STORE_KEYS.audits,state.audits); if(state.route==='audit')renderAudits();
  }
  function reportCacheKey(params){
    const ordered=Object.keys(params).sort().map(k=>`${k}=${params[k]||''}`).join('&');
    return STORE_KEYS.reportPrefix+APP_VERSION+':'+ordered;
  }

  function esc(v){ return String(v ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function assetDisplayName(a){
    const brand=String(a?.brand||'').trim(),model=String(a?.model||'').trim();
    if(!brand)return model||'Unknown device';
    return model.toLowerCase().startsWith(brand.toLowerCase()+' ')?model:[brand,model].filter(Boolean).join(' ');
  }
  function icon(id, cls=''){ return `<svg class="ico ${cls}"><use href="#i-${id}"/></svg>`; }
  function nowText(iso){
    if(!iso) return '';
    const d = new Date(iso); if(isNaN(d)) return String(iso);
    const diff = Date.now()-d.getTime(); const m=Math.floor(diff/60000),h=Math.floor(m/60),days=Math.floor(h/24);
    if(m<1) return 'now'; if(m<60) return `${m}m`; if(h<24) return `${h}h`; if(days<7) return `${days}d`;
    return d.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});
  }
  function money(v){ const n=Number(v); return isFinite(n)&&v!=='' ? 'RM '+n.toFixed(2) : '—'; }
  function toast(message,type='ok'){
    const t=$('toast'); if(!t)return;
    const isError=type==='error';
    t.innerHTML=`<div class="toast-mark" aria-hidden="true">${isError?'!':'✓'}</div><div class="toast-copy"><b>${isError?'Something needs attention':'Done'}</b><span>${esc(message)}</span></div><button class="toast-close" type="button" aria-label="Close notification">×</button>`;
    t.className='toast show'+(isError?' error':'');
    t.setAttribute('role',isError?'alert':'status');
    const hide=()=>{t.classList.remove('show');};
    t.querySelector('.toast-close')?.addEventListener('click',hide,{once:true});
    clearTimeout(toast._t); toast._t=setTimeout(hide,isError?5200:2800);
  }
  function humanError(err){
    const raw=String(err?.message||err||'Unknown error');
    const map={
      AUTH_REQUIRED:'Sign in is required for this action.',
      PERMISSION_DENIED:'Your account does not have permission for this action.',
      SESSION_EXPIRED:'Your session expired. Please sign in again.',
      USER_DISABLED:'This account is disabled.',
      API_NOT_CONFIGURED:'Apps Script connection is not configured.',
      INVALID_API_URL:'The Apps Script Web App URL is invalid.',
      REQUEST_TIMEOUT:'Apps Script took too long to respond. Cached data remains usable; try Sync Now again.'
    };
    for(const [key,msg] of Object.entries(map)) if(raw.includes(key)) return msg;
    return raw;
  }
  function setButtonBusy(btn,busy,label='Working...'){
    if(!btn)return;
    if(busy){
      if(!btn.dataset.originalHtml) btn.dataset.originalHtml=btn.innerHTML;
      btn.disabled=true; btn.classList.add('busy'); btn.innerHTML=`<span class="btn-spinner" aria-hidden="true"></span>${esc(label)}`;
    }else{
      btn.disabled=false; btn.classList.remove('busy');
      if(btn.dataset.originalHtml){btn.innerHTML=btn.dataset.originalHtml;delete btn.dataset.originalHtml;}
    }
  }
  // Persistent, accessible activity indicator for long Apps Script calls. Toasts remain the
  // authoritative success/error feedback; the indicator only promises that work is underway.
  const operationLabels=new Map(); let operationCount=0;
  function updateOperationIndicator(label){
    let el=$('operationIndicator');
    if(!el){el=document.createElement('div');el.id='operationIndicator';el.className='operation-indicator hidden';el.setAttribute('role','status');el.setAttribute('aria-live','polite');document.body.appendChild(el);}
    if(!label){el.classList.add('hidden');el.innerHTML='';return;}
    el.innerHTML=`<span class="btn-spinner" aria-hidden="true"></span><span>${esc(label)}</span>`;
    el.classList.remove('hidden');
  }
  async function withBusy(btn,label,fn){
    if(btn?.disabled) return;
    setButtonBusy(btn,true,label);
    const job=++operationCount;
    operationLabels.set(job,label);updateOperationIndicator(label);
    // A slow Apps Script write may take several seconds. Say so rather than looking frozen.
    const slowNotice=setTimeout(()=>{
      if(operationLabels.has(job)){
        const slowLabel=label.replace(/\.{3}|…/g,'').trim()+' — still waiting for server…';
        operationLabels.set(job,slowLabel);updateOperationIndicator(slowLabel);
        if(btn&&btn.isConnected)btn.setAttribute('aria-label',slowLabel);
        const status=$('assetSaveStatus');if(status)status.textContent='Still saving to Google Sheets. Please keep this screen open; do not tap Save again.';
      }
    },8000);
    try{return await fn();}
    finally{
      clearTimeout(slowNotice);if(btn)btn.removeAttribute('aria-label');
      setButtonBusy(btn,false);operationLabels.delete(job);
      const remaining=Array.from(operationLabels.values());updateOperationIndicator(remaining.length?remaining[remaining.length-1]:'');
    }
  }
  function setAppLoading(show,text='Loading AssetHub...'){
    const el=$('appLoading'); if(!el)return;
    el.classList.toggle('hidden',!show); el.setAttribute('aria-hidden',show?'false':'true');
    const label=el.querySelector('[data-loading-text]'); if(label)label.textContent=text;
  }
  async function loadCurrentRouteData(){
    renderCurrentData();
    if(state.route==='reports' && state.report) renderReport();
    scheduleSync('route',20);
    return true;
  }
  function statusBadge(status){
    const s=String(status||'').toLowerCase().replace(/\s+/g,'-');
    const cls=s==='active'?'active':s==='spare'?'spare':(s==='retired'||s==='merged')?'retired':s==='missing'?'missing':(s.includes('repair')?'repair':s==='faulty'?'faulty':'spare');
    return `<span class="badge ${cls}">${esc(status||'Unknown')}</span>`;
  }
  function catIcon(category){
    const s=String(category||'').toLowerCase();
    if(s.includes('monitor')) return 'monitor'; if(s.includes('laptop')||s.includes('notebook')) return 'laptop';
    if(s.includes('printer')) return 'printer'; if(s.includes('phone')||s.includes('mobile')) return 'phone';
    if(s.includes('camera')) return 'camera'; if(s.includes('walkie')||s.includes('radio')) return 'radio'; if(s.includes('pc')||s.includes('desktop')||s.includes('cpu')) return 'cpu';
    return 'box';
  }
  function role(){ return String(state.user?.role || 'GUEST').toUpperCase(); }
  function isGuest(){ return role()==='GUEST'; }
  function isAuthenticated(){ return !isGuest(); }
  function hasAdminRole(){ return role()==='ADMIN'; }
  function isAdmin(){ return hasAdminRole() && state.adminMode; }

  function withAccess(requiredRole, action){
    const need = String(requiredRole || 'STAFF').toUpperCase();
    if(need === 'ADMIN'){
      if(isAdmin()) return action?.();
      if(hasAdminRole()){
        state.adminMode = true;
        applyRole();
        return action?.();
      }
      return openLogin({
        requiredRole:'ADMIN',
        reason:'Admin sign-in is required for this action.',
        after:()=>{
          state.adminMode = true;
          applyRole();
          action?.();
        }
      });
    }
    if(isAuthenticated()) return action?.();
    return openLogin({
      requiredRole:'STAFF',
      reason:'Sign in for Staff operations. Guests can browse and add new assets without signing in.',
      after:action
    });
  }

  function setRoute(route){
    if(route==='admin' && !isAdmin()){
      withAccess('ADMIN',()=>setRoute('admin'));
      return;
    }
    state.route=route;
    $$('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${route}`));
    $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.route===route));
    syncMobileNav(route);
    closeSidebar();
    if(route!=='scanner'){ stopCamera(); setScannerStage('camera'); }
    else if(window.matchMedia('(max-width:760px)').matches){ setScannerStage('camera'); startCamera(); }
    if(route==='assets'){
      if(state.assets.length){renderAssets();} else loadAssets();
    }
    if(route==='maintenance'){
      if(state.maintenance.length){renderMaintenance();} else loadMaintenance();
    }
    if(route==='audit'){
      if(state.audits.length){renderAudits();} else loadAudits();
    }
    if(route==='reports'){
      if(state.report)renderReport(); else runReport();
    }
    if(route==='admin') renderAdmin();
  }

  function syncMobileNav(route){
    $$('[data-mobile-route]').forEach(b=>b.classList.toggle('active',b.dataset.mobileRoute===route));
    const more=$('mobileMoreBtn');
    if(more) more.classList.toggle('active',['audit','reports','admin'].includes(route));
  }

  function applyRole(){
    $$('.admin-only').forEach(el=>el.classList.toggle('hidden',!isAdmin()));

    const guest = isGuest();
    const displayName = guest ? 'Guest' : (state.user?.name || state.user?.email || 'User');
    $('profileName').textContent = displayName;
    $('profileRole').textContent = guest
      ? 'Read + Add'
      : (hasAdminRole() ? (state.adminMode ? 'ADMIN · Admin view' : 'ADMIN · Staff view') : 'STAFF');

    $('menuName').textContent = displayName;
    $('menuEmail').textContent = guest ? 'Browse + add without sign-in' : (state.user?.username || state.user?.email || '');
    $('menuRole').textContent = guest ? 'GUEST' : role();
    $('avatar').textContent = guest ? 'G' : displayName.slice(0,1).toUpperCase();

    $('signInBtn').classList.toggle('hidden',!guest);
    $('logoutBtn').classList.toggle('hidden',guest);
    $('apiSettingsBtn').classList.toggle('hidden',!isAdmin());

    const toggle = $('adminToggle');
    toggle.classList.toggle('active',isAdmin());
    toggle.setAttribute('aria-pressed',isAdmin() ? 'true' : 'false');
    toggle.title = isAdmin() ? 'Exit Admin view' : (hasAdminRole() ? 'Enter Admin view' : 'Sign in with an Admin account');

    if(state.route==='admin' && !isAdmin()){
      state.route='dashboard';
      $$('.page').forEach(p=>p.classList.toggle('active',p.id==='page-dashboard'));
      $$('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.route==='dashboard'));
      syncMobileNav('dashboard');
    }
  }

  async function init(){
    bindStaticEvents();
    applyReportDatePreset(false);
    syncMobileNav(state.route);
    registerServiceWorker();
    monitorOnline();
    const [persistentCache] = await Promise.all([hydratePersistentData()]);
    const hadBootCache=hydrateCachedBoot();
    const hadCache=hadBootCache||persistentCache;
    if(state.route==='dashboard'&&hadBootCache)renderDashboard();
    setAppLoading(!hadCache,'Connecting to AssetHub...');
    if(!AssetAPI.getUrl()){ setAppLoading(false); return showSetupRequired(); }
    const loadingFailsafe=setTimeout(()=>{
      setAppLoading(false);
      updateSystemStatus({status:'warning'});
    },12000);
    try {
      if(hadBootCache){
        setAppLoading(false);
        updateSystemStatus({status:'checking'});
        backgroundSync('boot',{force:true}).then(result=>updateSystemStatus({status:result?'online':'warning'}));
      }else{
        await boot();
        backgroundSync('prefetch',{force:true});
      }
    }
    catch(err){
      const raw=String(err?.message||err||'');
      if(raw.includes('API_NOT_CONFIGURED')||raw.includes('INVALID_API_URL')) showSetupRequired();
      else { toast(humanError(err),'error'); updateSystemStatus({status:'warning'}); }
    }
    finally{
      clearTimeout(loadingFailsafe);
      setAppLoading(false);
    }
    setInterval(()=>backgroundSync('background'),60*1000);
    setInterval(checkRemoteVersion,15*60*1000);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){checkRemoteVersion();backgroundSync('resume');}});
  }

  function hydrateCachedBoot(){
    const data=cacheRead(CACHE_BOOT);
    if(!data)return false;
    state.boot=data;
    state.user={name:'Guest',username:'guest',email:'',role:'GUEST'};
    state.refs=data.references||state.refs;
    applyRole();
    populateFilters();
    renderDashboard();
    updateSystemStatus({status:navigator.onLine?'checking':'warning'});
    return true;
  }

  async function boot(options={}){
    const data = await AssetAPI.get('bootstrap');
    await useBoot(data,options);
    return data;
  }

  async function useBoot(data,{closeModalAfter=true,loadLists=false}={}){
    state.boot=data;
    state.user=data.user || {name:'Guest',email:'',role:'GUEST'};
    state.refs=data.references||state.refs;
    if(!data.authenticated && AssetAPI.getToken()) AssetAPI.setToken('');
    if(!hasAdminRole()) state.adminMode=false;
    applyRole();
    populateFilters();
    renderDashboard();
    cacheWrite(CACHE_BOOT,safeBootCache(data));
    if(loadLists){
      await Promise.allSettled([loadAssets(true),loadMaintenance(),loadAudits()]);
    }
    setAppLoading(false);
    if(closeModalAfter) closeModal();
    // A successful bootstrap already proves the API is reachable. Full diagnostics are
    // now on-demand so startup does not immediately trigger another Apps Script call.
    updateSystemStatus({status:'online'});
    checkRemoteVersion();
    handleDeepLink();
  }

  function bindStaticEvents(){
    $$('.nav-btn').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.route)));
    $$('[data-go]').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.go)));
    $('menuBtn').addEventListener('click',toggleSidebar);
    $('sidebarBackdrop').addEventListener('click',closeSidebar);
    $('profileBtn').addEventListener('click',()=> $('profileMenu').classList.toggle('open'));
    document.addEventListener('click',e=>{ if(!e.target.closest('.profile-btn')&&!e.target.closest('.profile-menu')) $('profileMenu').classList.remove('open'); });
    $('apiSettingsBtn').addEventListener('click',()=>withAccess('ADMIN',()=>openApiSetup(false)));
    $('systemStatusBtn').addEventListener('click',openSystemDiagnostics);
    $('signInBtn').addEventListener('click',()=>openLogin({reason:'Sign in for Staff/Admin actions such as editing, moving, maintenance and system setup.'}));
    $('logoutBtn').addEventListener('click',logout);
    $('adminToggle').addEventListener('click',toggleAdminMode);
    $('updateBtn').addEventListener('click',applyAppUpdate);
    $('modalCloseBtn').addEventListener('click',closeModal);
    $('modalWrap').addEventListener('click',e=>{ if(e.target===$('modalWrap') && !$('modalWrap').classList.contains('locked')) closeModal(); });
    document.addEventListener('keydown',e=>{
      const modalOpen=!$('modalWrap').classList.contains('hidden');
      if(e.key==='Escape'){
        if(modalOpen&&!$('modalWrap').classList.contains('locked')) closeModal();
        else if($('sidebar').classList.contains('open')) closeSidebar();
        return;
      }
      if(e.key==='Tab'&&modalOpen){
        const focusable=Array.from($('modalWrap').querySelectorAll('button:not([disabled]):not(.hidden),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')).filter(el=>el.offsetParent!==null);
        if(!focusable.length)return;
        const first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
    $('closeDrawerBtn').addEventListener('click',closeDrawer); $('drawerBackdrop').addEventListener('click',closeDrawer);
    $('globalSearch').addEventListener('keydown',e=>{ if(e.key==='Enter'){ $('assetSearch').value=e.target.value; setRoute('assets'); renderAssets(); }});
    $('assetSearch').addEventListener('input',renderAssets);
    $('assetDateBtn').addEventListener('click',openAssetDateFilter);
    $('assetFilterBtn').addEventListener('click',openAssetFilters);
    $$('#assetViewToggle [data-view]').forEach(b=>b.addEventListener('click',()=>setAssetView(b.dataset.view)));
    $('assetMobileSort').addEventListener('change',()=>{const [key,dir]=$('assetMobileSort').value.split(':');state.assetSort={key,dir};renderAssets();});
    $('maintenanceSearch').addEventListener('input',renderMaintenance);
    $('maintenanceDateBtn').addEventListener('click',openMaintenanceDateFilter);
    $('maintenanceFilterBtn').addEventListener('click',openMaintenanceFilters);
    $('maintenanceMobileSort').addEventListener('change',()=>{const [key,dir]=$('maintenanceMobileSort').value.split(':');state.maintenanceSort={key,dir};renderMaintenance();});
    $('addAssetBtn').addEventListener('click',()=>openAssetForm());
    $('reportIssueBtn').addEventListener('click',()=>withAccess('STAFF',()=>openIssueForm()));
    $$('[data-action="find"]').forEach(b=>b.addEventListener('click',()=>{setRoute('assets');$('assetSearch').focus();}));
    $$('[data-action="reportIssue"]').forEach(b=>b.addEventListener('click',()=>withAccess('STAFF',()=>openIssueForm())));
    $$('[data-action="continueAudit"]').forEach(b=>b.addEventListener('click',()=>{setRoute('audit');}));
    $('startAuditBtn').addEventListener('click',()=>withAccess('STAFF',openStartAudit));
    $('runReportBtn').addEventListener('click',runReport); $('exportReportBtn').addEventListener('click',exportReport); $('printReportBtn').addEventListener('click',()=>window.print());
    ['reportType','reportSite','reportArea','reportCategory','reportStatus','reportDateField'].forEach(id=>$(id).addEventListener('change',()=>{ if(id==='reportSite') populateReportAreas(); if(id==='reportType'){syncReportControls();if(['asset','incomplete','warranty'].includes($('reportType').value)){$('reportDatePreset').value='all';applyReportDatePreset(true);}} }));
    $('reportDatePreset').addEventListener('change',()=>{if($('reportDatePreset').value==='custom'){if($('reportFilterDetails'))$('reportFilterDetails').open=true;return;}applyReportDatePreset(true);});
    $('reportDateFrom').addEventListener('change',()=>{$('reportDatePreset').value='custom';});
    $('reportDateTo').addEventListener('change',()=>{$('reportDatePreset').value='custom';});
    $('reportAssigned').addEventListener('keydown',e=>{if(e.key==='Enter')runReport();});
    $$('[data-mobile-route]').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.mobileRoute)));
    $('mobileMoreBtn').addEventListener('click',toggleSidebar);
    $$('.admin-tab').forEach(b=>b.addEventListener('click',()=>{state.adminTab=b.dataset.admin;$$('.admin-tab').forEach(x=>x.classList.toggle('active',x===b));renderAdmin();}));
    $('startCameraBtn').addEventListener('click',startCamera);
    $('mobileScannerClose').addEventListener('click',()=>setRoute('dashboard'));
    $('mobileScannerResultClose').addEventListener('click',()=>setRoute('dashboard'));
    $('mobileTorchBtn').addEventListener('click',toggleMobileTorch);
    $('captureBtn').addEventListener('click',()=>{
      if(window.matchMedia('(max-width:760px)').matches && state.cameraStream) captureMobileFrame();
      else {if(state.cameraStream)stopCamera(); $('scannerCameraFile')?.click();}
    });
    $('scannerCameraFile').addEventListener('change',async e=>{ const f=e.target.files?.[0]; if(!f)return; try{showScannerPhotoPreview(f);setScannerStage('processing');await processScanFile(f);}catch(err){toast(humanError(err),'error');}finally{e.target.value='';} });
    $('scannerFile').addEventListener('change',async e=>{ const f=e.target.files?.[0]; if(!f)return; try{showScannerPhotoPreview(f);setScannerStage('processing');await processScanFile(f);}catch(err){toast(humanError(err),'error');}finally{e.target.value='';} });
  }

  function toggleSidebar(){
    const open=!$('sidebar').classList.contains('open');
    $('sidebar').classList.toggle('open',open); $('sidebarBackdrop').classList.toggle('show',open); document.body.classList.toggle('sidebar-open',open);
  }
  function closeSidebar(){ $('sidebar').classList.remove('open'); $('sidebarBackdrop').classList.remove('show'); document.body.classList.remove('sidebar-open'); }
  function openModal(title,html,onReady,options={}){
    const wrap=$('modalWrap'), modal=wrap.querySelector('.modal');
    state.modalRestoreFocus=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    $('modalTitle').textContent=title; $('modalBody').innerHTML=html;
    modal.className='modal modal-'+(options.size||'md');
    wrap.classList.toggle('locked',options.closeable===false);
    $('modalCloseBtn').classList.toggle('hidden',options.closeable===false);
    wrap.classList.remove('hidden'); document.body.classList.add('modal-open');
    if(onReady) onReady();
    requestAnimationFrame(()=>{ const target=wrap.querySelector('input:not([type=hidden]),select,textarea,button:not(#modalCloseBtn)'); target?.focus?.(); });
  }
  function closeModal(){
    const wrap=$('modalWrap'); if(wrap.classList.contains('hidden'))return;
    wrap.classList.add('hidden');wrap.classList.remove('locked');$('modalBody').innerHTML='';document.body.classList.remove('modal-open');
    $('modalCloseBtn').classList.remove('hidden');state.modalRestoreFocus?.focus?.();state.modalRestoreFocus=null;
  }
  function updateSystemStatus(diag){
    state.diagnostics=diag||null;
    const dot=$('systemStatusDot'), text=$('systemStatusText');
    const status=diag?.status || 'checking';
    dot.className='system-status-dot '+status;
    text.textContent=status==='online'?'Online':status==='warning'?'Warning':status==='issues'?'Issues':'Checking';
  }

  function diagnosticsHtml(diag){
    const c=diag?.components||{};
    const order=['api','version','sheets','drive','ocr','ai','auth'];
    const backendRows=order.map(k=>{
      const x=c[k]||{ok:false,label:k,message:'Not tested'};
      const cls=x.warning?'warn':(x.ok?'ok':'bad');
      return `<div class="diag-row ${cls}"><span class="diag-icon"></span><div><b>${esc(x.label||k)}</b><small>${esc(x.message||'')}</small></div></div>`;
    }).join('');
    const codeOk=('BarcodeDetector' in window)||!!window.ZXing;
    const timing=AssetAPI.getLastTiming?.();
    const latencyRow=timing?`<div class="diag-row ${timing.ms<=2000?'ok':timing.ms<=5000?'warn':'bad'}"><span class="diag-icon"></span><div><b>Last API response</b><small>${esc(timing.action)} · ${esc(timing.ms)} ms${timing.transport?' · '+esc(timing.transport):''}${timing.ms>5000?' · slow':timing.ms>2000?' · usable but slower than ideal':''}</small></div></div>`:'';
    const lastSync=state.sync.lastCompleted?new Date(state.sync.lastCompleted).toLocaleTimeString('en-MY',{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'Not synced yet';
    const cacheRow=`<div class="diag-row ok"><span class="diag-icon"></span><div><b>Browser cache</b><small>IndexedDB + in-memory state · last sync ${esc(lastSync)}</small></div></div>`;
    const frontendRows=`${latencyRow}${cacheRow}<div class="diag-row ${codeOk?'ok':'warn'}"><span class="diag-icon"></span><div><b>Barcode / QR reader</b><small>${codeOk?('Available via '+(('BarcodeDetector' in window)?'browser BarcodeDetector':'ZXing fallback')):'Native code reading unavailable. Image OCR still works; ZXing fallback loads separately.'}</small></div></div><div class="diag-row ${window.QRCode?'ok':'warn'}"><span class="diag-icon"></span><div><b>QR label generator</b><small>${window.QRCode?'QRCode library loaded':'QR helper is still loading or unavailable. Reopen the QR label after connection is stable.'}</small></div></div>`;
    return `<div class="diag-list">${backendRows}${frontendRows}</div>`;
  }

  async function runDiagnostics(silent=false){
    if(!AssetAPI.getUrl()){
      const diag={status:'issues',components:{api:{ok:false,label:'Apps Script API',message:'No /exec URL configured.'},version:{ok:true,label:'Frontend',message:'Frontend '+APP_VERSION},sheets:{ok:false,label:'Google Sheets',message:'Not tested'},drive:{ok:false,label:'Google Drive',message:'Not tested'},ocr:{ok:false,label:'OCR API',message:'Not tested'},auth:{ok:true,label:'Access control',message:'Guest read + add available'}}};
      updateSystemStatus(diag);
      return diag;
    }
    try{
      const r=await AssetAPI.get('diagnostics',{frontend_version:APP_VERSION},{publicCall:true});
      updateSystemStatus(r.diagnostics);
      return r.diagnostics;
    }catch(err){
      const diag={status:'issues',components:{api:{ok:false,label:'Apps Script API',message:humanError(err)},version:{ok:true,label:'Frontend',message:'Frontend '+APP_VERSION},sheets:{ok:false,label:'Google Sheets',message:'API unavailable'},drive:{ok:false,label:'Google Drive',message:'API unavailable'},ocr:{ok:false,label:'OCR API',message:'API unavailable'},auth:{ok:true,label:'Access control',message:'Guest read + add intended'}}};
      updateSystemStatus(diag);
      if(!silent) throw err;
      return diag;
    }
  }

  async function openSystemDiagnostics(){
    openModal('System connection',`<div class="login-card"><div class="login-note">AssetHub checks each layer separately so a failure tells you exactly where to look.</div><div id="diagnosticBody"><div class="loading-inline"><span class="btn-spinner"></span>Running diagnostics...</div></div><div class="diag-actions"><button id="diagConnectionBtn" class="btn light">Connection Settings</button><button id="diagSyncBtn" class="btn light">Sync Now</button><button id="diagRunBtn" class="btn blue">Run Diagnostics</button></div></div>`,()=>{
      const render=async()=>{
        try{const d=await runDiagnostics(false);if($('diagnosticBody'))$('diagnosticBody').innerHTML=diagnosticsHtml(d);}catch(err){if($('diagnosticBody'))$('diagnosticBody').innerHTML=`<div class="empty-state compact">${esc(humanError(err))}</div>`;}
      };
      $('diagRunBtn').addEventListener('click',()=>withBusy($('diagRunBtn'),'Checking...',render));
      $('diagConnectionBtn').addEventListener('click',()=>withAccess('ADMIN',()=>openApiSetup(false)));
      $('diagSyncBtn').addEventListener('click',()=>withBusy($('diagSyncBtn'),'Syncing...',async()=>{try{await backgroundSync('manual',{force:true});await render();toast('Sync finished.');}catch(err){toast(humanError(err),'error');}}));
      withBusy($('diagRunBtn'),'Checking...',render);
    },{size:'sm'});
  }

  function showSetupRequired(){
    // No endpoint configured for a fresh device. Never request a deployment URL from a normal staff user.
    openModal('AssetHub connection unavailable', `<div class="login-card"><div class="login-note"><b>Configuration is required.</b> Ask the AssetHub administrator to set the production Apps Script endpoint in api-config.js before deploying this website. No asset data has been changed.</div><div class="modal-actions"><button id="setupRetryBtn" class="btn blue" type="button">Retry</button></div></div>`, ()=>{
      $('setupRetryBtn').addEventListener('click',()=>location.reload());
    }, {size:'sm',closeable:false});
  }

  function openApiSetup(lock){
    const current=AssetAPI.getUrl();
    openModal('Connection settings',`<div class="login-card"><div class="login-note">Paste the deployed Apps Script <b>/exec</b> URL. AssetHub checks the API, Sheet, Drive, OCR and version separately.</div><div class="field"><label>Apps Script Web App URL</label><input id="apiUrlInput" value="${esc(current)}" placeholder="https://script.google.com/macros/s/.../exec"></div><div class="modal-actions"><button id="saveApiBtn" class="btn blue">Save & Diagnose</button></div><div id="apiTestStatus" class="status-message" aria-live="polite"></div></div>`,()=>{
      $('saveApiBtn').addEventListener('click',async()=>{
        const btn=$('saveApiBtn'); const url=$('apiUrlInput').value.trim(); const previous=AssetAPI.getUrl();
        AssetAPI.setUrl(url);
        $('apiTestStatus').innerHTML='<div class="loading-inline"><span class="btn-spinner"></span>Testing connection...</div>';
        await withBusy(btn,'Testing...',async()=>{
          try{
            const ping=await AssetAPI.get('ping',{}, {publicCall:true});
            const d=await runDiagnostics(false);
            $('apiTestStatus').innerHTML=`<div class="login-note"><b>${esc(ping.message)}</b> · backend ${esc(ping.version||'unknown')}</div>${diagnosticsHtml(d)}`;
            if(d.ok){ wrapUnlock(); setAppLoading(true,'Loading AssetHub...'); await boot({closeModalAfter:false}); closeModal(); toast('Connection ready.'); }
          }catch(err){ AssetAPI.setUrl(previous); $('apiTestStatus').innerHTML=`<div class="diag-row bad"><span class="diag-icon"></span><div><b>Connection failed</b><small>${esc(humanError(err))}</small></div></div>`; }
        });
      });
      function wrapUnlock(){ $('modalWrap').classList.remove('locked'); $('modalCloseBtn').classList.remove('hidden'); }
    },{size:'sm',closeable:!lock});
  }

  function openLogin({requiredRole='STAFF',reason='',after=null}={}){
    const title=requiredRole==='ADMIN'?'Admin sign in':'Sign in to JCP AssetHub';
    const defaultReason=requiredRole==='ADMIN'?'Sign in with an Admin account to enter Admin view.':'Guests can browse and add assets. Sign in for Staff operations.';
    openModal(title,`<div class="login-card"><div class="login-note">${esc(reason||defaultReason)}</div><form id="loginForm"><div class="field"><label>Username</label><input id="loginUsername" autocomplete="username" placeholder="e.g. printjc" required></div><div class="field login-password"><label>Password</label><input id="loginPassword" type="password" autocomplete="current-password" required></div><div class="modal-actions"><button id="loginSubmit" class="btn blue" type="submit">Sign In</button></div><div id="loginStatus" class="status-message" aria-live="polite"></div></form></div>`,()=>{
      const form=$('loginForm');
      form.addEventListener('submit',async e=>{
        e.preventDefault(); const btn=$('loginSubmit'); const status=$('loginStatus'); status.textContent='';
        await withBusy(btn,'Signing in...',async()=>{
          try{
            const r=await AssetAPI.post('login',{username:$('loginUsername').value.trim(),password:$('loginPassword').value},{publicCall:true});
            AssetAPI.setToken(r.token);
            const data=await AssetAPI.get('bootstrap');
            await useBoot(data,{closeModalAfter:false,loadLists:false});
            if(requiredRole==='ADMIN'&&!hasAdminRole()){
              status.innerHTML='<span class="status-error">Signed in, but this account does not have Admin access.</span>';
              return;
            }
            closeModal();
            if(after) await after();
            await loadCurrentRouteData();
            toast(requiredRole==='ADMIN'?'Admin access confirmed.':'Signed in.');
          }catch(err){ status.innerHTML=`<span class="status-error">${esc(humanError(err))}</span>`; }
        });
      });
    },{size:'sm'});
  }

  function toggleAdminMode(){
    if(isAdmin()){
      state.adminMode=false;
      if(state.route==='admin') setRoute('dashboard');
      applyRole();
      toast('Admin view off.');
      return;
    }
    withAccess('ADMIN',()=>{
      state.adminMode=true;
      applyRole();
      toast('Admin view on.');
    });
  }

  async function logout(){
    await withPassiveSync(async()=>{try{await AssetAPI.post('logout',{});}catch{}});
    AssetAPI.setToken('');
    clearSensitiveDetailCache();
    state.user={name:'Guest',username:'guest',email:'',role:'GUEST'};
    state.adminMode=false;
    state.refs.users=[];
    state.boot=safeBootCache(state.boot)||state.boot;
    if(state.boot){state.boot.user=state.user;state.boot.authenticated=false;state.boot.references={...(state.boot.references||{}),users:[]};}
    applyRole(); populateFilters(); renderDashboard();
    closeDrawer(); closeModal();
    scheduleSync('logout',20);
    toast('Signed out. Guest read + add access remains available.');
  }
  function fillSelect(sel,rows,valueKey,labelKey,first){ if(!sel)return; const value=sel.value; sel.innerHTML=`<option value="">${esc(first)}</option>`+rows.map(r=>`<option value="${esc(r[valueKey])}">${esc(r[labelKey])}</option>`).join(''); if(rows.some(r=>String(r[valueKey])===String(value))) sel.value=value; }
  function populateFilters(){
    fillSelect($('reportSite'),state.refs.sites,'site_id','name','All sites');
    fillSelect($('reportCategory'),state.refs.categories,'category_id','name','All categories');
    populateReportAreas();
    syncReportControls();
    updateAssetToolbarState();
  }
  function populateReportAreas(){ const site=$('reportSite').value; const rows=state.refs.areas.filter(a=>!site||String(a.site_id)===String(site)); fillSelect($('reportArea'),rows,'area_id','name','All areas'); }

  function syncReportControls(){
    const type=$('reportType')?.value||'asset';
    const status=$('reportStatus'); if(!status)return;
    const current=status.value;
    let options=[];
    if(type==='maintenance') options=['Open','In Progress','Waiting Parts','Completed','Cancelled'];
    else if(type==='audit') options=['In Progress','Completed'];
    else if(type==='activity') options=['GUEST','STAFF','ADMIN'];
    else if(!['movement'].includes(type)) options=['Active','Spare','Faulty','Under Repair','Retired','Missing'];
    status.innerHTML='<option value="">'+(type==='activity'?'All roles':'All statuses')+'</option>'+options.map(x=>`<option>${esc(x)}</option>`).join('');
    if(options.includes(current))status.value=current;
    const statusWrap=$('reportStatusWrap');
    statusWrap.classList.toggle('hidden',type==='movement');
    if(statusWrap.childNodes[0]) statusWrap.childNodes[0].nodeValue=type==='activity'?'Role ':'Status ';
    $('reportDateFieldWrap').classList.toggle('hidden',!['asset','warranty','incomplete'].includes(type));
    const label=$('reportAssignedWrap'); if(label&&label.childNodes[0]) label.childNodes[0].nodeValue=type==='activity'?'User ':'Assigned / user ';
    const input=$('reportAssigned'); if(input) input.placeholder=type==='activity'?'User contains...':'Person / team';
  }

  function applyReportDatePreset(run=false){
    const preset=$('reportDatePreset').value;
    const today=new Date(); const iso=d=>d.toISOString().slice(0,10);
    let from='',to='';
    if(preset==='7'||preset==='30'||preset==='90'){const d=new Date(today);d.setDate(d.getDate()-Number(preset)+1);from=iso(d);to=iso(today);}
    else if(preset==='month'){from=iso(new Date(today.getFullYear(),today.getMonth(),1));to=iso(today);}
    else if(preset==='all'){from='';to='';}
    if(preset!=='custom'){$('reportDateFrom').value=from;$('reportDateTo').value=to;}
    if(run)runReport();
  }


  async function loadAssets(silent=false){
    let showedCache=state.assets.length>0;
    if(showedCache)renderAssets();
    if(!showedCache){
      const cached=cacheRead(CACHE_ASSETS);
      if(Array.isArray(cached)&&cached.length){state.assets=cached;renderAssets();showedCache=true;}
    }
    if(!silent&&!showedCache) $('assetList').innerHTML=assetSkeletonHtml(5);
    const indicatorId=!showedCache?beginIndicator('Loading assets…'):null;
    if(showedCache)beginPassiveSync();
    try{
      const r=await AssetAPI.get('listAssets',{limit:1000,include_retired:true});
      state.assets=(r.assets||[]).map(publicAssetSummary); refreshDerivedReferences(); cacheWrite(CACHE_ASSETS,state.assets); await window.AssetStore?.set?.(STORE_KEYS.assets,state.assets); renderAssets();
      markSyncCursor(r.server_time||new Date().toISOString());
      return state.assets;
    }catch(err){
      if(!showedCache) $('assetList').innerHTML=`<div class="empty-state">${esc(humanError(err))}</div>`;
      else console.warn('Asset refresh failed; cached data remains visible',err);
      return state.assets;
    }finally{if(indicatorId)endIndicator(indicatorId);else if(showedCache)endPassiveSync();}
  }
  function assetSkeletonHtml(count=5){return Array.from({length:count},()=>`<div class="skeleton-row"><i></i><div><b></b><span></span></div><em></em></div>`).join('');}
  function renderAssets(){
    const box=$('assetList'), header=$('assetListHeader');
    if(!state.assets.length){ header.innerHTML=''; box.innerHTML='<div class="empty-state">No assets found.</div>'; return; }
    const q=$('assetSearch').value.trim().toLowerCase();
    const f=state.assetFilters;
    let rows=state.assets.filter(a=>{
      if(f.site&&String(a.site_id)!==f.site)return false;
      if(f.area&&String(a.area_id)!==f.area)return false;
      if(f.category&&String(a.category_id)!==f.category)return false;
      if(f.status&&String(a.status)!==f.status)return false;
      if(f.assigned&&!String(a.assigned_to||'').toLowerCase().includes(f.assigned.toLowerCase()))return false;
      if(f.location&&!String(a.exact_location||'').toLowerCase().includes(f.location.toLowerCase()))return false;
      if((f.dateFrom||f.dateTo)&&!dateWithin(a[f.dateField]||a.updated_at,f.dateFrom,f.dateTo))return false;
      if(q&&!([a.asset_id,a.category_name,a.brand,a.model,a.serial,a.site_name,a.area_name,a.assigned_to,a.exact_location].join(' ').toLowerCase().includes(q)))return false;
      return true;
    });
    rows=sortAssets(rows);
    const listMode=state.assetView!=='grid';
    box.className=listMode?'asset-list mode-list':'asset-list mode-grid';
    header.classList.toggle('hidden',!listMode);
    header.innerHTML=listMode?assetHeaderHtml():'';
    box.innerHTML=rows.length?(listMode?rows.map(assetListRowHtml).join(''):rows.map(assetGridCardHtml).join('')):'<div class="empty-state">No matching assets.</div>';
    $$('#assetList [data-asset]').forEach(b=>b.addEventListener('click',()=>openAsset(b.dataset.asset)));
    $$('#assetListHeader [data-sort]').forEach(b=>b.addEventListener('click',()=>setAssetSort(b.dataset.sort)));
    updateAssetToolbarState(); hydrateThumbs(box);
  }

  function dateWithin(value,from,to){
    if(!from&&!to)return true; const d=new Date(value); if(isNaN(d))return false;
    if(from&&d<new Date(from+'T00:00:00'))return false;
    if(to&&d>new Date(to+'T23:59:59.999'))return false;
    return true;
  }

  function sortAssets(rows){
    const {key,dir}=state.assetSort; const sign=dir==='asc'?1:-1;
    return rows.slice().sort((a,b)=>{
      let av,bv;
      if(key==='device'){av=`${a.brand||''} ${a.model||''}`;bv=`${b.brand||''} ${b.model||''}`;}
      else{av=a[key]??'';bv=b[key]??'';}
      if(key==='updated_at'||key==='created_at'){av=new Date(av).getTime()||0;bv=new Date(bv).getTime()||0;return (av-bv)*sign;}
      return String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'})*sign;
    });
  }

  function setAssetSort(key){
    if(state.assetSort.key===key)state.assetSort.dir=state.assetSort.dir==='asc'?'desc':'asc';
    else state.assetSort={key,dir:(key==='updated_at'||key==='created_at')?'desc':'asc'};
    $('assetMobileSort').value=`${state.assetSort.key}:${state.assetSort.dir}`;
    renderAssets();
  }

  function sortMark(key){if(state.assetSort.key!==key)return'';return state.assetSort.dir==='asc'?' ↑':' ↓';}
  function assetHeaderHtml(){
    return `<div></div><button data-sort="device">Device${sortMark('device')}</button><button data-sort="asset_id">Asset ID${sortMark('asset_id')}</button><button data-sort="site_name">Location${sortMark('site_name')}</button><button data-sort="assigned_to">Assigned${sortMark('assigned_to')}</button><button data-sort="status">Status${sortMark('status')}</button><button data-sort="updated_at">Updated${sortMark('updated_at')}</button><div></div>`;
  }
  function assetListRowHtml(a){
    return `<button class="asset-row asset-table-row" data-asset="${esc(a.asset_id)}"><div class="asset-thumb" data-thumb="${esc(a.thumbnail_file_id||'')}">${icon(catIcon(a.category_name),'lg')}</div><div class="asset-main"><b>${esc(assetDisplayName(a))}</b><small>${esc(a.asset_id)} · ${esc(a.category_name||'Uncategorised')}</small><span class="mobile-status">${statusBadge(a.status)}</span></div><div class="asset-meta asset-id-col"><b>${esc(a.asset_id)}</b><small>${esc(a.serial||'No serial')}</small></div><div class="asset-meta"><b>${esc(a.site_name||'—')}</b><small>${esc(a.area_name||a.exact_location||'No area')}</small></div><div class="asset-meta"><b>${esc(a.assigned_to||'Unassigned')}</b><small>${esc(a.exact_location||'No exact location')}</small></div><div class="asset-status-col">${statusBadge(a.status)}</div><div class="asset-meta updated-col"><b>${esc(nowText(a.updated_at))}</b><small>${esc(formatDateCompact(a.updated_at))}</small></div><span class="arrow-btn">${icon('arrow','sm')}</span></button>`;
  }
  function assetGridCardHtml(a){
    return `<button class="asset-grid-card" data-asset="${esc(a.asset_id)}"><div class="asset-grid-media" data-thumb="${esc(a.thumbnail_file_id||'')}">${icon(catIcon(a.category_name),'xl')}</div><div class="asset-grid-top"><div><b>${esc(assetDisplayName(a))}</b><small>${esc(a.asset_id)} · ${esc(a.category_name||'Uncategorised')}</small></div>${statusBadge(a.status)}</div><div class="asset-grid-facts"><span>${icon('pin','sm')}<b>${esc(a.site_name||'—')}</b> · ${esc(a.area_name||'No area')}</span><span>${icon('user','sm')}${esc(a.assigned_to||'Unassigned')}</span><span>${icon('clock','sm')}Updated ${esc(nowText(a.updated_at))}</span></div></button>`;
  }
  function formatDateCompact(value){const d=new Date(value);return isNaN(d)?'':d.toLocaleDateString('en-MY',{day:'2-digit',month:'short',year:'numeric'});}

  function setAssetView(view){
    if(!['list','grid'].includes(view)||state.assetView===view)return;
    state.assetView=view; localStorage.setItem('jcp_assethub_asset_view',view);
    const box=$('assetList'); box.classList.add('view-switching');
    updateAssetToolbarState(); setTimeout(()=>{renderAssets();requestAnimationFrame(()=>box.classList.remove('view-switching'));},110);
  }

  function updateAssetToolbarState(){
    const toggle=$('assetViewToggle'); if(toggle){toggle.classList.toggle('grid-active',state.assetView==='grid');toggle.querySelectorAll('[data-view]').forEach(b=>{const on=b.dataset.view===state.assetView;b.classList.toggle('active',on);b.setAttribute('aria-pressed',on?'true':'false');});}
    const f=state.assetFilters; const filterCount=['site','area','category','status','assigned','location'].filter(k=>f[k]).length;
    const dateCount=(f.dateFrom||f.dateTo)?1:0;
    const fb=$('assetFilterBadge'),db=$('assetDateBadge'); if(fb){fb.textContent=filterCount;fb.classList.toggle('hidden',!filterCount);} if(db){db.textContent=dateCount;db.classList.toggle('hidden',!dateCount);}
    const chips=[];
    const site=state.refs.sites.find(x=>String(x.site_id)===f.site); const area=state.refs.areas.find(x=>String(x.area_id)===f.area); const cat=state.refs.categories.find(x=>String(x.category_id)===f.category);
    if(site)chips.push(site.name); if(area)chips.push(area.name); if(cat)chips.push(cat.name); if(f.status)chips.push(f.status); if(f.assigned)chips.push('Assigned: '+f.assigned); if(f.location)chips.push('Location: '+f.location);
    if(f.dateFrom||f.dateTo)chips.push(`${f.dateField==='created_at'?'Created':'Updated'}: ${f.dateFrom||'…'} → ${f.dateTo||'…'}`);
    const wrap=$('assetFilterChips'); if(wrap)wrap.innerHTML=chips.length?chips.map(x=>`<span>${esc(x)}</span>`).join('')+`<button id="clearAssetFilters" type="button">Clear all</button>`:'';
    $('clearAssetFilters')?.addEventListener('click',()=>{state.assetFilters={site:'',area:'',category:'',status:'',assigned:'',location:'',dateField:'updated_at',dateFrom:'',dateTo:''};renderAssets();});
    if($('assetMobileSort'))$('assetMobileSort').value=`${state.assetSort.key}:${state.assetSort.dir}`;
  }

  function openAssetDateFilter(){
    const f=state.assetFilters;
    openModal('Filter Assets by Date',`<form id="assetDateForm"><div class="form-grid"><div class="field"><label>Date field</label><select name="dateField"><option value="updated_at" ${f.dateField==='updated_at'?'selected':''}>Updated date</option><option value="created_at" ${f.dateField==='created_at'?'selected':''}>Created date</option></select></div><div class="field"><label>Quick range</label><select id="assetDatePreset"><option value="custom">Custom</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="month">This month</option><option value="all">All time</option></select></div><div class="field"><label>From</label><input name="dateFrom" type="date" value="${esc(f.dateFrom)}"></div><div class="field"><label>To</label><input name="dateTo" type="date" value="${esc(f.dateTo)}"></div></div><div class="modal-actions"><button id="clearAssetDate" type="button" class="btn light">Clear</button><button type="submit" class="btn blue">Apply Date</button></div></form>`,()=>{
      const form=$('assetDateForm'); const preset=$('assetDatePreset');
      preset.addEventListener('change',()=>{const v=preset.value,today=new Date(),iso=d=>d.toISOString().slice(0,10);let from='',to='';if(['7','30','90'].includes(v)){const d=new Date(today);d.setDate(d.getDate()-Number(v)+1);from=iso(d);to=iso(today);}else if(v==='month'){from=iso(new Date(today.getFullYear(),today.getMonth(),1));to=iso(today);}else if(v==='all'){from='';to='';}if(v!=='custom'){form.elements.dateFrom.value=from;form.elements.dateTo.value=to;}});
      $('clearAssetDate').addEventListener('click',()=>{f.dateFrom='';f.dateTo='';closeModal();renderAssets();});
      form.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form).entries());f.dateField=d.dateField;f.dateFrom=d.dateFrom;f.dateTo=d.dateTo;closeModal();renderAssets();});
    },{size:'sm'});
  }

  function openAssetFilters(){
    const f=state.assetFilters; const siteOptions=state.refs.sites.map(x=>`<option value="${esc(x.site_id)}" ${f.site===x.site_id?'selected':''}>${esc(x.name)}</option>`).join('');
    const areaOptions=state.refs.areas.filter(x=>!f.site||String(x.site_id)===String(f.site)).map(x=>`<option value="${esc(x.area_id)}" ${f.area===x.area_id?'selected':''}>${esc(x.name)}</option>`).join('');
    const catOptions=state.refs.categories.map(x=>`<option value="${esc(x.category_id)}" ${f.category===x.category_id?'selected':''}>${esc(x.name)}</option>`).join('');
    openModal('More Asset Filters',`<form id="assetFilterForm"><div class="form-grid"><div class="field"><label>Site</label><select name="site"><option value="">All sites</option>${siteOptions}</select></div><div class="field"><label>Area / Department</label><select name="area"><option value="">All areas</option>${areaOptions}</select></div><div class="field"><label>Category</label><select name="category"><option value="">All categories</option>${catOptions}</select></div><div class="field"><label>Status</label><select name="status"><option value="">All statuses</option>${['Active','Spare','Faulty','Under Repair','Retired','Missing'].map(x=>`<option ${f.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Assigned person / team</label><input name="assigned" value="${esc(f.assigned)}" placeholder="Contains..."></div><div class="field"><label>Exact location</label><input name="location" value="${esc(f.location)}" placeholder="Contains..."></div></div><div class="modal-actions"><button id="clearAssetMoreFilters" type="button" class="btn light">Clear</button><button type="submit" class="btn blue">Apply Filters</button></div></form>`,()=>{
      const form=$('assetFilterForm');
      form.elements.site.addEventListener('change',()=>{const site=form.elements.site.value;const rows=state.refs.areas.filter(a=>!site||String(a.site_id)===site);form.elements.area.innerHTML='<option value="">All areas</option>'+rows.map(a=>`<option value="${esc(a.area_id)}">${esc(a.name)}</option>`).join('');});
      $('clearAssetMoreFilters').addEventListener('click',()=>{Object.assign(f,{site:'',area:'',category:'',status:'',assigned:'',location:''});closeModal();renderAssets();});
      form.addEventListener('submit',e=>{e.preventDefault();Object.assign(f,Object.fromEntries(new FormData(form).entries()));closeModal();renderAssets();});
    },{size:'sm'});
  }


  async function hydrateThumbs(root){
    const els=Array.from(root.querySelectorAll('[data-thumb]')).filter(el=>el.dataset.thumb&&!el.dataset.loaded&&!el.dataset.loading);
    const loadOne=async el=>{
      el.dataset.loading='1';
      try{const data=await imageData(el.dataset.thumb,{persistent:true});if(data){el.innerHTML=`<img src="${data}" alt="Asset thumbnail">`;el.dataset.loaded='1';}}
      catch{el.classList.add('thumb-error');el.title='Thumbnail unavailable';}
      finally{delete el.dataset.loading;}
    };
    if(!('IntersectionObserver' in window)){ for(const el of els.slice(0,40)) await loadOne(el); return; }
    const io=new IntersectionObserver(entries=>{entries.filter(e=>e.isIntersecting).forEach(e=>{io.unobserve(e.target);loadOne(e.target);});},{rootMargin:'180px'});
    els.forEach(el=>io.observe(el));
  }
  async function imageData(fileId,{persistent=false}={}){
    if(!fileId)return '';
    const key=String(fileId);
    if(state.imageCache.has(key))return state.imageCache.get(key);
    if(persistent&&window.AssetStore){
      const cached=await window.AssetStore.get(STORE_KEYS.thumbPrefix+key,{maxAge:THUMB_CACHE_MAX_AGE});
      if(cached){state.imageCache.set(key,cached);return cached;}
    }
    const r=await AssetAPI.get('getImageData',{file_id:key});
    const data=r.data?.data_url||'';
    if(data){state.imageCache.set(key,data);if(persistent)window.AssetStore?.set?.(STORE_KEYS.thumbPrefix+key,data);}
    return data;
  }
  function invalidateImageCache(fileIds=[]){
    (fileIds||[]).filter(Boolean).forEach(id=>{const key=String(id);state.imageCache.delete(key);window.AssetStore?.remove?.(STORE_KEYS.thumbPrefix+key);});
  }

  function renderDashboard(){
    const d=state.boot?.dashboard||{};
    $('statusStrip').innerHTML=`<button class="status-item ${d.open_repairs?'danger':'good'}" data-go2="maintenance"><span class="status-icon">${icon('tools','sm')}</span><span><b>${d.open_repairs||0} open repairs</b><small>${d.open_repairs?'Needs follow-up':'No open repair cases'}</small></span></button><button class="status-item ${d.warranty_attention?'warn':'good'}" data-go2="reports"><span class="status-icon">${icon('clock','sm')}</span><span><b>${d.warranty_attention||0} warranty attention</b><small>Expired or within 90 days</small></span></button><button class="status-item ${d.active_audits?'warn':'good'}" data-go2="audit"><span class="status-icon">${icon('check','sm')}</span><span><b>${d.active_audits||0} active audits</b><small>${d.active_audits?'Continue verification':'No active audit'}</small></span></button>`;
    $$('[data-go2]').forEach(b=>b.addEventListener('click',()=>setRoute(b.dataset.go2)));
    const acts=d.recent_activity||[]; $('activityList').innerHTML=acts.length?acts.slice(0,8).map(r=>`<div class="activity-item"><div class="activity-icon">${icon(activityIcon(r.action),'sm')}</div><div class="activity-copy"><b>${esc(activityLabel(r.action))}</b><span>${esc(r.asset_id||'')} ${activityDetails(r.details)}</span></div><span class="activity-time">${esc(nowText(r.timestamp))}</span></div>`).join(''):'<div class="empty-state compact">No activity yet.</div>';
    const recent=d.recent_assets||[]; $('recentAssets').innerHTML=recent.length?recent.map(a=>`<button class="compact-asset" data-recent="${esc(a.asset_id)}"><div class="compact-thumb" data-thumb="${esc(a.thumbnail_file_id||'')}">${icon(catIcon(a.category_name),'lg')}</div><div><b>${esc(a.brand)} ${esc(a.model)}</b><small>${esc(a.site_name)} · ${esc(a.area_name||'No area')}</small></div><span class="arrow-btn">${icon('arrow','sm')}</span></button>`).join(''):'<div class="empty-state compact">No assets yet.</div>';
    $$('#recentAssets [data-recent]').forEach(b=>b.addEventListener('click',()=>openAsset(b.dataset.recent))); hydrateThumbs($('recentAssets'));
  }
  function activityIcon(a){ a=String(a); if(a.includes('ISSUE')||a.includes('MAINTENANCE'))return'tools'; if(a.includes('AUDIT'))return'check'; if(a.includes('IMAGE'))return'image'; if(a.includes('LOGIN'))return'user'; return'box'; }
  function activityLabel(a){ return String(a||'Activity').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase()); }
  function activityDetails(s){ if(!s)return''; try{const o=JSON.parse(s);return Object.values(o).filter(v=>typeof v!=='boolean').slice(0,2).map(esc).join(' · ');}catch{return esc(String(s).slice(0,90));} }

  async function fetchAssetDetail(id,{label='Refreshing asset…'}={}){
    const key=String(id||'');
    if(state.detailRequests.has(key))return state.detailRequests.get(key);
    const promise=withPassiveSync(async()=>{
      const r=await AssetAPI.get('getAsset',{asset_id:key});
      cacheAssetDetail(r.asset);
      return r.asset;
    }).finally(()=>state.detailRequests.delete(key));
    state.detailRequests.set(key,promise);
    return promise;
  }
  async function openAsset(id,{force=false}={}){
    id=String(id||'').trim(); if(!id)return;
    state.openAssetId=id;
    $('drawerId').textContent=id;
    $('assetDrawer').classList.add('open'); $('drawerBackdrop').classList.remove('hidden'); document.body.classList.add('drawer-open');

    let record=detailMemoryRecord(id),cached=record?.data||null;
    if(!cached&&window.AssetStore){
      const stored=await window.AssetStore.get(detailStoreKey(id),{maxAge:DETAIL_CACHE_MAX_AGE});
      if(stored){
        cached=stored;
        record={data:stored,savedAt:0,role:'GUEST'};
        state.assetDetails.set(id,record);
      }
    }

    if(cached) await renderDrawer(cached);
    else $('drawerBody').innerHTML='<div class="drawer-loading"><span class="btn-spinner"></span><b>Loading asset details…</b><small>You can continue using AssetHub while this loads.</small></div>';

    const shouldRefresh=force||!record||detailNeedsRefresh(record);
    if(!shouldRefresh)return cached;
    try{
      const fresh=await fetchAssetDetail(id,{label:cached?'Refreshing asset…':'Loading asset…'});
      if(state.openAssetId===id&&$('assetDrawer').classList.contains('open')) await renderDrawer(fresh);
      return fresh;
    }catch(err){
      if(!cached&&state.openAssetId===id)$('drawerBody').innerHTML=`<div class="empty-state">${esc(humanError(err))}</div>`;
      else if(cached)console.warn('Asset refresh failed; cached detail remains visible',err);
      return cached;
    }
  }
  function closeDrawer(){ state.openAssetId=''; $('assetDrawer').classList.remove('open'); $('drawerBackdrop').classList.add('hidden'); document.body.classList.remove('drawer-open'); }
  async function renderDrawer(a){
    if(state.openAssetId&&String(state.openAssetId)!==String(a?.asset_id))return;
    const mainImage=a.images?.find(x=>String(x.image_id)===String(a.main_image_id)&&String(x.active)!=='false')||a.images?.find(x=>String(x.image_type)==='main'&&String(x.active)!=='false')||null;
    const mainFile=mainImage?.thumbnail_file_id||mainImage?.drive_file_id||a.thumbnail_file_id||a.image_file_id;
    const custom=(a.custom_fields||[]).filter(f=>f.value).map(f=>`<div class="detail-field"><label>${esc(f.label)}</label><div>${esc(f.value)}</div></div>`).join('');
    const pd=a.private_details||null;
    const privateSection=pd&&Object.values(pd).some(Boolean)?`<div class="detail-section staff-private-section"><div class="staff-private-head"><div><h3>Staff-only information</h3><small>Visible only to signed-in Staff and Admin.</small></div><span class="private-badge">STAFF / ADMIN</span></div><div class="detail-grid"><div class="detail-field"><label>Mobile number</label><div>${esc(pd.mobile_number||'—')}</div></div><div class="detail-field"><label>Registered owner</label><div>${esc(pd.register_owner||'—')}</div></div><div class="detail-field"><label>Account number</label><div>${esc(pd.account_number||'—')}</div></div><div class="detail-field"><label>Amount paid</label><div>${esc(pd.amount_paid||'—')}</div></div></div></div>`:'';
    $('drawerBody').innerHTML=`<div class="detail-hero"><div id="drawerMainPhoto" class="detail-photo">${icon(catIcon(a.category_name),'xl')}</div><div class="detail-title"><h2>${esc(assetDisplayName(a))}</h2><p>${esc(a.asset_id)} · ${esc(a.category_name)}</p>${statusBadge(a.status)}<div class="actions asset-primary-actions" style="margin-top:10px"><button id="editAssetDrawer" class="btn blue sm">${icon('edit','sm')}Edit Asset</button><button id="reportAssetIssue" class="btn light sm">${icon('tools','sm')}Report Issue</button></div><details class="asset-drawer-more"><summary>More actions</summary><div class="actions"><button id="moveAssetDrawer" class="btn light sm">${icon('pin','sm')}Move / Assign</button><button id="assetQrBtn" class="btn light sm">${icon('scan','sm')}QR Label</button>${isAuthenticated()?`<button id="scanUpdateDrawer" class="btn light sm">${icon('scan','sm')}Scan to Update</button>`:''}${isAuthenticated()?`<button id="mergeAssetDrawer" class="btn light sm">${icon('refresh','sm')}Merge / Reconcile</button>`:''}</div></details></div></div><div class="detail-section"><h3>Placement & assignment</h3><div class="detail-grid"><div class="detail-field"><label>Site</label><div>${esc(a.site_name||'—')}</div></div><div class="detail-field"><label>Area</label><div>${esc(a.area_name||'—')}</div></div><div class="detail-field"><label>Exact location</label><div>${esc(a.exact_location||'—')}</div></div><div class="detail-field"><label>Assigned to</label><div>${esc(a.assigned_to||'—')}</div></div></div></div><div class="detail-section"><h3>Device information</h3><div class="detail-grid"><div class="detail-field"><label>Serial</label><div>${esc(a.serial||'—')}</div></div><div class="detail-field"><label>Specifications</label><div>${esc(a.specifications||'—')}</div></div>${custom}</div></div>${privateSection}<div class="detail-section"><div class="panel-head"><div><h3>Images</h3><small>Main, label, condition, damage and repair photos.</small></div><button id="addAssetImage" class="btn light sm">${icon('upload','sm')}Add image</button></div><div id="drawerGallery" class="gallery"></div></div><div class="detail-section"><h3>Maintenance</h3><div>${(a.maintenance||[]).slice(0,5).map(m=>`<div class="ref-row"><div><b>${esc(m.issue)}</b><small>${esc(m.status)} · ${esc(nowText(m.reported_at))}</small></div>${isAuthenticated()?`<button class="btn light sm" data-drawer-maint="${esc(m.maintenance_id)}">${icon('edit','sm')}Edit</button>`:''}</div>`).join('')||'<div class="empty-state compact">No maintenance history.</div>'}</div></div><div class="detail-section"><h3>Movement history</h3><div>${(a.movements||[]).slice(0,5).map(m=>`<div class="ref-row"><div><b>${esc(m.from_site||'—')} → ${esc(m.to_site||'—')}</b><small>${esc(m.from_area||'')} → ${esc(m.to_area||'')} · ${esc(nowText(m.moved_at))}</small></div></div>`).join('')||'<div class="empty-state compact">No movement history.</div>'}</div></div><div class="detail-section"><h3>Activity log</h3><div>${(a.activity||[]).slice(0,8).map(x=>`<div class="ref-row"><div><b>${esc(activityLabel(x.action))}</b><small>${esc(x.user||'Guest')} · ${esc(nowText(x.timestamp))}</small></div></div>`).join('')||'<div class="empty-state compact">No activity yet.</div>'}</div></div>`;
    // Keep the essential placement visible; collapse supporting detail only on phones.
    if(window.matchMedia('(max-width:760px)').matches){
      const sections=Array.from($('drawerBody').querySelectorAll(':scope > .detail-section'));
      sections.slice(1).forEach(section=>{
        const heading=section.querySelector('h3')?.textContent?.trim()||'Additional information';
        const fold=document.createElement('details');fold.className='asset-detail-fold';
        const summary=document.createElement('summary');summary.textContent=heading;
        section.parentNode.insertBefore(fold,section);fold.append(summary,section);
      });
    }
    if(mainFile){
      try{
        const src=await imageData(mainFile,{persistent:true});
        if(state.openAssetId===String(a.asset_id)&&$('drawerMainPhoto'))$('drawerMainPhoto').innerHTML=`<img src="${src}" alt="${esc(a.asset_id)}">`;
      }catch{if(state.openAssetId===String(a.asset_id)&&$('drawerMainPhoto')){$('drawerMainPhoto').classList.add('thumb-error');$('drawerMainPhoto').title='Image unavailable';}}
    }
    if(state.openAssetId===String(a.asset_id))renderGallery(a);
    $('editAssetDrawer')?.addEventListener('click',()=>withAccess('STAFF',()=>openAssetForm(a)));
    $('moveAssetDrawer')?.addEventListener('click',()=>withAccess('STAFF',()=>openMoveAssign(a)));
    $('assetQrBtn')?.addEventListener('click',()=>showAssetQr(a));
    $('reportAssetIssue').addEventListener('click',()=>withAccess('STAFF',()=>openIssueForm(a.asset_id)));
    $('scanUpdateDrawer')?.addEventListener('click',()=>withAccess('STAFF',()=>{state.scanUpdateTarget={asset_id:a.asset_id,brand:a.brand,model:a.model};closeDrawer();setRoute('scanner');toast('Scan to update '+a.asset_id+'.');}));
    $('mergeAssetDrawer')?.addEventListener('click',()=>withAccess('STAFF',()=>openManualMerge(a)));
    $$('[data-drawer-maint]').forEach(b=>b.addEventListener('click',()=>openMaintenanceManage((a.maintenance||[]).find(m=>String(m.maintenance_id)===String(b.dataset.drawerMaint)))));
    $('addAssetImage').addEventListener('click',()=>withAccess('STAFF',()=>openImageUpload(a.asset_id)));
  }
  function assetPublicUrl(assetId){
    const base = ASSET_BASE_URL.endsWith('/') ? ASSET_BASE_URL : ASSET_BASE_URL + '/';
    return base + '?asset=' + encodeURIComponent(assetId);
  }

  function handleDeepLink(){
    if(state.deepLinkHandled) return;
    const id = new URLSearchParams(location.search).get('asset');
    if(!id) return;
    state.deepLinkHandled=true;
    setTimeout(()=>openAsset(id),120);
  }

  function qrDataUrl(container){
    const canvas=container.querySelector('canvas');
    if(canvas) return canvas.toDataURL('image/png');
    const img=container.querySelector('img');
    return img?.src || '';
  }

  function showAssetQr(asset){
    const url=assetPublicUrl(asset.asset_id);
    openModal('JCP Asset QR Label',`<div class="qr-label-wrap"><div class="qr-card"><div class="qr-brand">JCP ASSETHUB</div><div id="assetQrCode" class="qr-code"></div><div class="qr-asset-id">${esc(asset.asset_id)}</div><div class="qr-device">${esc((asset.brand||'')+' '+(asset.model||''))}</div></div><div class="qr-info"><h3>Permanent JCP asset tag</h3><p>Attach this label to the device. Scanning it opens the exact AssetHub record. Manufacturer barcodes remain separate and are used mainly during onboarding.</p><div class="qr-link">${esc(url)}</div><div class="qr-actions"><button id="downloadQrBtn" class="btn light">Download QR</button><button id="printQrBtn" class="btn blue">Print Label</button></div><div id="qrStatus" style="font-size:10px;color:var(--muted);margin-top:8px"></div></div></div>`,()=>{
      const holder=$('assetQrCode');
      if(!window.QRCode){
        $('qrStatus').textContent='QR library did not load. Check internet access, then reopen this label.';
        return;
      }
      new QRCode(holder,{text:url,width:156,height:156,colorDark:'#0f1f39',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.M});
      $('downloadQrBtn').addEventListener('click',()=>{
        const src=qrDataUrl(holder);
        if(!src)return toast('QR image is not ready yet.','error');
        const a=document.createElement('a');a.href=src;a.download=`${asset.asset_id}__qr.png`;a.click();
      });
      $('printQrBtn').addEventListener('click',()=>{
        const src=qrDataUrl(holder);
        if(!src)return toast('QR image is not ready yet.','error');
        const w=window.open('','_blank','width=520,height=650');
        if(!w)return toast('Popup blocked. Allow popups to print the label.','error');
        w.document.write(`<!doctype html><html><head><title>${esc(asset.asset_id)} QR</title><style>body{font-family:Arial,sans-serif;margin:0;padding:28px;color:#102b5a}.label{width:300px;border:2px solid #102b5a;border-radius:14px;padding:18px;text-align:center}.brand{font-size:13px;font-weight:800;letter-spacing:.08em;margin-bottom:10px}.id{font-size:22px;font-weight:900;margin-top:10px}.device{font-size:12px;color:#596579;margin-top:4px}img{width:210px;height:210px}@media print{body{padding:0}.label{margin:0}}</style></head><body><div class="label"><div class="brand">JCP ASSETHUB</div><img src="${src}"><div class="id">${esc(asset.asset_id)}</div><div class="device">${esc((asset.brand||'')+' '+(asset.model||''))}</div></div><script>window.onload=()=>{window.print();}<\/script></body></html>`);
        w.document.close();
      });
    });
  }

  async function renderGallery(a){
    const box=$('drawerGallery');
    const imgs=(a.images||[]).filter(x=>String(x.active)!=='false');
    box.innerHTML=imgs.length
      ? imgs.map((x,i)=>`<button class="gallery-item ${String(a.main_image_id)===String(x.image_id)?'is-main':''}" data-img-index="${i}"><div data-thumb="${esc(x.thumbnail_file_id||x.drive_file_id)}">${icon('image','lg')}</div><span class="gallery-label">${String(a.main_image_id)===String(x.image_id)?'★ Main photo':esc(x.image_type)}</span></button>`).join('')
      : '<div class="empty-state compact" style="grid-column:1/-1">No images yet.</div>';
    box.querySelectorAll('[data-thumb]').forEach(el=>el.classList.add('asset-thumb'));
    await hydrateThumbs(box);
    box.querySelectorAll('[data-img-index]').forEach(b=>b.addEventListener('click',()=>openGalleryViewer(a,Number(b.dataset.imgIndex))));
  }

  async function openGalleryViewer(asset,index){
    const imgs=(asset.images||[]).filter(x=>String(x.active)!=='false');
    if(!imgs.length)return;
    const i=((index%imgs.length)+imgs.length)%imgs.length;
    const img=imgs[i];
    openModal('Image Gallery',`<div class="gallery-viewer"><div class="gallery-stage"><div class="gallery-loading">Loading image...</div></div><div class="gallery-meta"><div><b>${esc(img.image_type||'Image')}</b><small>${esc(img.file_name||'')}</small></div><div><small>Uploaded by ${esc(img.uploaded_by||'—')} · ${esc(nowText(img.uploaded_at))}</small></div></div><div class="gallery-view-actions"><button id="galleryPrev" class="btn light sm">← Previous</button><span>${i+1} / ${imgs.length}</span><button id="galleryNext" class="btn light sm">Next →</button>${isAuthenticated()&&String(asset.main_image_id)!==String(img.image_id)?`<button id="chooseMainImage" class="btn blue sm">Set as main photo</button>`:''}${isAdmin()?`<button id="replaceGalleryImage" class="btn light sm">${icon('upload','sm')}Replace</button><button id="deleteGalleryImage" class="btn danger sm">${icon('trash','sm')}Delete</button>`:''}</div></div>`,async()=>{
      try{
        const src=await imageData(img.drive_file_id,{persistent:false});
        const stage=document.querySelector('.gallery-stage');
        if(stage)stage.innerHTML=`<img src="${src}" alt="${esc(img.image_type||'Asset image')}">`;
      }catch(err){toast(humanError(err),'error');}
      $('galleryPrev')?.addEventListener('click',()=>openGalleryViewer(asset,i-1));
      $('galleryNext')?.addEventListener('click',()=>openGalleryViewer(asset,i+1));
      $('chooseMainImage')?.addEventListener('click',()=>withAccess('STAFF',async()=>{
        const btn=$('chooseMainImage');await withBusy(btn,'Setting main…',async()=>{
          try{const r=await AssetAPI.post('setMainImage',{asset_id:asset.asset_id,image_id:img.image_id});
            cacheAssetDetail(r.asset);closeModal();toast('Main image selected.');openAsset(asset.asset_id);scheduleSync('main-image',6500);
          }catch(err){toast(humanError(err),'error');}
        });
      }));
      $('replaceGalleryImage')?.addEventListener('click' ,()=>withAccess('ADMIN',()=>openReplaceImage(asset,img)));
      $('deleteGalleryImage')?.addEventListener('click',()=>withAccess('ADMIN',async()=>{
        if(!confirm('Delete this image from AssetHub and move the Drive files to trash?'))return;
        try{
          await AssetAPI.post('deleteImage',{image_id:img.image_id});
          invalidateImageCache([img.drive_file_id,img.thumbnail_file_id]);
          invalidateAssetDetail(asset.asset_id);
          toast('Image deleted.');
          closeModal();
          scheduleSync('image-deleted',20);
          openAsset(asset.asset_id,{force:true});
        }catch(err){toast(humanError(err),'error');}
      }));
    },{size:'lg'});
  }

  function openReplaceImage(asset,img){
    openModal('Replace Asset Image',`<div class="login-note">The replacement keeps the same image type: <b>${esc(img.image_type)}</b>.</div><div class="field"><label>Replacement image</label><input id="replaceImageFile" type="file" accept="image/*" capture="environment"></div><div class="modal-actions"><button id="replaceImageSubmit" class="btn blue">Compress & Replace</button></div><div id="replaceImageStatus" style="font-size:11px;color:var(--muted);margin-top:8px"></div>`,()=>{
      $('replaceImageSubmit').addEventListener('click',async()=>{
        const file=$('replaceImageFile').files?.[0]; if(!file)return toast('Choose an image first.','error');
        const btn=$('replaceImageSubmit');
        await withBusy(btn,'Replacing...',async()=>{
          try{
            $('replaceImageStatus').textContent='Compressing image...';
            const {full,thumb}=await AssetImage.prepareForStorage(file);
            const [base64,thumbnailBase64]=await Promise.all([AssetImage.blobToBase64(full),AssetImage.blobToBase64(thumb)]);
            $('replaceImageStatus').textContent='Uploading replacement...';
            const r=await AssetAPI.post('replaceImage',{image_id:img.image_id,imageType:img.image_type,base64Data:base64,thumbnailBase64,mimeType:'image/webp'});
            invalidateImageCache([img.drive_file_id,img.thumbnail_file_id,r.image?.drive_file_id,r.image?.thumbnail_file_id]);
            invalidateAssetDetail(asset.asset_id);
            toast('Image replaced.'); closeModal(); scheduleSync('image-replaced',20); openAsset(asset.asset_id,{force:true});
          }catch(err){$('replaceImageStatus').textContent=humanError(err);}
        });
      });
    });
  }

  function chooserOptions(values){
    return [...new Set((values||[]).map(x=>String(x||'').trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  }
  function editablePicker(fieldId,name,value,choices,placeholder){
    const opts=chooserOptions(choices);
    return `<div class="editable-picker"><input id="${fieldId}" name="${name}" value="${esc(value||'')}" placeholder="${esc(placeholder||'Type or choose')}" autocomplete="off" required><select aria-label="Choose ${esc(name)}" data-picker-for="${fieldId}"><option value="">Choose…</option>${opts.map(x=>`<option value="${esc(x)}" ${x===value?'selected':''}>${esc(x)}</option>`).join('')}</select></div>`;
  }
  function bindEditablePickers(scope){
    scope.querySelectorAll('[data-picker-for]').forEach(picker=>{
      picker.addEventListener('change',()=>{const target=scope.querySelector('#'+picker.dataset.pickerFor);if(picker.value&&target){target.value=picker.value;target.dispatchEvent(new Event('input',{bubbles:true}));}});
    });
  }
  function assetFormHtml(a={}){
    const catValue=a.category_name||a.category||''; const site=a.site_id||''; const area=a.area_name||a.area||'';
    return `<form id="assetForm" class="form-grid">${a.asset_id?`<div class="field full asset-form-scan-action"><div><b>Update from a device photo</b><small>Scan a label or Windows specifications screen, then review differences before saving.</small></div><button type="button" id="scanUpdateAsset" class="btn light">${icon('scan','sm')} Scan to update</button></div>`:''}<div class="field"><label>Category</label>${editablePicker("assetCategory","category",catValue,state.refs.categories.map(x=>x.name),"Enter category")}<small>You can type a new device type. Admin can later add it to the master category list.</small></div><div class="field"><label>Brand</label>${editablePicker("assetBrand","brand",a.brand||"",state.refs.brands,"Enter brand")}</div><div class="field"><label>Model</label><input name="model" value="${esc(a.model||'')}" required></div><div class="field"><label>Serial number</label><input name="serial" value="${esc(a.serial||'')}"></div><div class="field"><label>Site</label><select name="site_id" id="assetSite" required><option value="">Select site</option>${state.refs.sites.map(x=>`<option value="${esc(x.site_id)}" ${String(x.site_id)===String(site)?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label>Area / Department</label>${editablePicker("assetArea","area",area,[],"Enter area / department")}</div><div class="field"><label>Status</label><select name="status">${['Active','Spare','Faulty','Under Repair','Missing','Retired'].map(s=>`<option ${String(a.status||'Active')===s?'selected':''}>${s}</option>`).join('')}</select></div><details class="asset-form-extra field full"><summary>Additional information <small>Location, assignment, specifications and photos</small></summary><div class="asset-form-extra-grid form-grid"><div class="field"><label>Exact location <span style="font-weight:500">(optional)</span></label><input name="exact_location" list="locationOptions" value="${esc(a.exact_location||'')}" placeholder="e.g. DTF A3 Station"><datalist id="locationOptions">${state.refs.locations.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field"><label>Assigned person / team <span style="font-weight:500">(optional)</span></label><input name="assigned_to" list="assigneeOptions" value="${esc(a.assigned_to||'')}" placeholder="Person or team"><datalist id="assigneeOptions">${state.refs.assignees.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field full"><label>Specifications</label><textarea name="specifications" rows="3">${esc(a.specifications||'')}</textarea></div><div class="field"><label>Movement note <span style="font-weight:500">(only if placement changes)</span></label><input name="movement_note" placeholder="Optional reason"></div></div></details>${state.refs.custom_fields.some(f=>String(f.required)==='true'||f.required===true)?`<div id="customFieldsForm" class="field full"><span class="label">Required custom information</span><div class="form-grid">${customFieldsHtml(a.custom_fields||[],state.refs.custom_fields.filter(f=>String(f.required)==='true'||f.required===true))}</div></div>`:''}${state.refs.custom_fields.some(f=>!(String(f.required)==='true'||f.required===true))?`<details class="asset-form-extra field full"><summary>Other custom information</summary><div class="asset-form-extra-grid form-grid">${customFieldsHtml(a.custom_fields||[],state.refs.custom_fields.filter(f=>!(String(f.required)==='true'||f.required===true)))}</div></details>`:''}<details class="asset-form-extra field full"><summary>Photos <small>Add condition, serial or other images</small></summary><div class="asset-photo-extra"><div class="field full"><label>Photos</label><input id="assetPhotoFiles" type="file" accept="image/*" multiple><small>Photos are compressed in the browser before Drive upload.</small><div id="assetPhotoPreview" class="preview-strip"></div></div></div></details><div id="assetSaveStatus" class="asset-save-status" role="status" aria-live="polite"></div><div class="field full"><div class="modal-actions">${a.asset_id&&a.status!=='Retired'&&isAdmin()?'<button type="button" id="retireAssetBtn" class="btn danger">Retire Asset</button>':''}<button type="button" id="cancelAssetForm" class="btn light">Cancel</button><button type="submit" class="btn blue">${a.asset_id?'Save Changes':'Create Asset'}</button></div></div></form>`;
  }
  function customFieldsHtml(existing,fields=state.refs.custom_fields){ const map={}; existing.forEach(x=>map[x.field_id]=x.value); return fields.map(f=>{ const v=map[f.field_id]||''; const req=String(f.required)==='true'||f.required===true?'required':''; if(f.field_type==='select'){let opts=[];try{opts=JSON.parse(f.options_json||'[]')}catch{} return `<div class="field"><label>${esc(f.label)}</label><select data-custom="${esc(f.field_id)}" ${req}><option value="">—</option>${opts.map(o=>`<option ${String(o)===String(v)?'selected':''}>${esc(o)}</option>`).join('')}</select></div>`;} if(f.field_type==='boolean') return `<div class="field"><label>${esc(f.label)}</label><select data-custom="${esc(f.field_id)}" ${req}><option value="">—</option><option value="Yes" ${v==='Yes'?'selected':''}>Yes</option><option value="No" ${v==='No'?'selected':''}>No</option></select></div>`; return `<div class="field"><label>${esc(f.label)}</label><input type="${['date','number'].includes(f.field_type)?f.field_type:'text'}" data-custom="${esc(f.field_id)}" value="${esc(v)}" ${req}></div>`; }).join('')||'<div class="empty-state compact">No custom fields configured.</div>'; }
  function openAssetForm(asset={}){
    if(asset.asset_id && !isAuthenticated()) return withAccess('STAFF',()=>openAssetForm(asset));
    const initialScanFiles = Array.isArray(asset._scanFiles)?asset._scanFiles:(asset._scanFile?[asset._scanFile]:[]);
    openModal(asset.asset_id?'Edit Asset':'Add Asset',assetFormHtml(asset),()=>{
      const form=$('assetForm'); const siteSel=$('assetSite'); const areaInput=$('assetArea');
      function updateAreas(){ const rows=state.refs.areas.filter(x=>!siteSel.value||String(x.site_id)===String(siteSel.value)); form.querySelector('[data-picker-for="assetArea"]').innerHTML='<option value="">Choose…</option>'+chooserOptions(rows.map(x=>x.name)).map(x=>`<option value="${esc(x)}" ${x===areaInput.value?'selected':''}>${esc(x)}</option>`).join(''); }
      bindEditablePickers(form);
      siteSel.addEventListener('change',updateAreas); updateAreas();
      $('scanUpdateAsset')?.addEventListener('click',()=>{
        state.scanUpdateTarget={asset_id:asset.asset_id,brand:asset.brand,model:asset.model};
        closeModal();closeDrawer();setRoute('scanner');
        toast('Scan a label to compare against '+asset.asset_id+'.');
      });
      const files=$('assetPhotoFiles');
      if(initialScanFiles.length){ $('assetPhotoPreview').innerHTML=initialScanFiles.map(f=>`<div class="preview-chip"><img src="${URL.createObjectURL(f)}" alt="OCR source preview"></div>`).join(''); }
      files.addEventListener('change',()=>{ const chosen=Array.from(files.files||[]); const all=[...initialScanFiles,...chosen]; $('assetPhotoPreview').innerHTML=all.map(f=>`<div class="preview-chip"><img src="${URL.createObjectURL(f)}" alt="Preview"></div>`).join(''); });
      $('cancelAssetForm').addEventListener('click',closeModal);
      $('retireAssetBtn')?.addEventListener('click',()=>withAccess('ADMIN',async()=>{ if(!confirm(`Retire ${asset.asset_id}?`))return; try{const r=await AssetAPI.post('retireAsset',{asset_id:asset.asset_id});cacheAssetDetail(r.asset);toast('Asset retired.');closeModal();closeDrawer();scheduleSync('retire');}catch(err){toast(humanError(err),'error');} }));
      form.addEventListener('submit',async e=>{
        e.preventDefault(); const fd=new FormData(form); const custom={}; form.querySelectorAll('[data-custom]').forEach(el=>custom[el.dataset.custom]=el.value);
        const params=Object.fromEntries(fd.entries()); params.custom_json=JSON.stringify(custom); if(asset.asset_id)params.asset_id=asset.asset_id;
        const submit=form.querySelector('[type="submit"]');
        await withBusy(submit,asset.asset_id?'Saving...':'Creating...',async()=>{
          try{
            const creating=!asset.asset_id;
            const saveMsg=()=>{const el=$('assetSaveStatus');if(el)el.textContent='Saving changes to Google Sheets…';};saveMsg();
            const r=await AssetAPI.post(creating?'createAsset':'updateAsset',params); const id=r.asset.asset_id;
            if($('assetSaveStatus'))$('assetSaveStatus').textContent='Saved. Updating local view and photos…';
            cacheAssetDetail(r.asset);
            const guestUploadToken=r.asset.guest_upload_token||''; const chosen=Array.from(files.files||[]);
            for(const photo of initialScanFiles) await uploadAssetImage(id,photo,'serial_label',()=>{},guestUploadToken);
            for(let i=0;i<chosen.length;i++) await uploadAssetImage(id,chosen[i],i===0&&creating?'main':'other',()=>{},guestUploadToken);
            if(initialScanFiles.length||chosen.length)invalidateAssetDetail(id);
            toast(creating?'Asset created.':'Asset updated.'); closeModal(); closeDrawer(); scheduleSync(creating?'asset-created':'asset-updated',6500);
            if(creating){ const fresh=state.assets.find(x=>x.asset_id===id)||r.asset; showAssetQr(fresh); } else {if(initialScanFiles.length||chosen.length){invalidateAssetDetail(id);openAsset(id,{force:true});}else openAsset(id);}
          }catch(err){toast(humanError(err),'error');}
        });
      });
    },{size:'lg'});
  }

  function openMoveAssign(a){
    const currentSite=a.site_id||'';
    openModal('Move / Assign Asset',`<form id="moveAssignForm" class="form-grid"><div class="field"><label>Asset</label><input value="${esc(a.asset_id)} — ${esc((a.brand||'')+' '+(a.model||''))}" disabled></div><div class="field"><label>Site</label><select name="site_id" id="moveSite" required>${state.refs.sites.map(s=>`<option value="${esc(s.site_id)}" ${String(s.site_id)===String(currentSite)?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Area / Department</label><input name="area" id="moveArea" list="moveAreaOptions" value="${esc(a.area_name||a.area||'')}" required><datalist id="moveAreaOptions"></datalist></div><div class="field"><label>Exact location <span style="font-weight:500">(optional)</span></label><input name="exact_location" value="${esc(a.exact_location||'')}" list="locationOptionsMove"><datalist id="locationOptionsMove">${state.refs.locations.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field"><label>Assigned person / team <span style="font-weight:500">(optional)</span></label><input name="assigned_to" value="${esc(a.assigned_to||'')}" list="assigneeOptionsMove"><datalist id="assigneeOptionsMove">${state.refs.assignees.map(x=>`<option value="${esc(x)}">`).join('')}</datalist></div><div class="field full"><label>Movement note</label><input name="movement_note" placeholder="Reason / note (optional)"></div><div class="field full"><div class="modal-actions"><button type="button" id="cancelMoveAssign" class="btn light">Cancel</button><button class="btn blue" type="submit">Save Move / Assignment</button></div></div></form>`,()=>{
      const form=$('moveAssignForm'), site=$('moveSite'), area=$('moveArea');
      const updateAreas=()=>{const rows=state.refs.areas.filter(x=>!site.value||String(x.site_id)===String(site.value));$('moveAreaOptions').innerHTML=rows.map(x=>`<option value="${esc(x.name)}">`).join('');};
      site.addEventListener('change',()=>{area.value='';updateAreas();}); updateAreas();
      $('cancelMoveAssign').addEventListener('click',closeModal);
      form.addEventListener('submit',async e=>{e.preventDefault();const p=Object.fromEntries(new FormData(form).entries());Object.assign(p,{asset_id:a.asset_id,category_id:a.category_id||'',category:a.category_name||a.category||'',brand:a.brand||'',model:a.model||'',serial:a.serial||'',specifications:a.specifications||'',status:a.status||'Active',custom_json:JSON.stringify(Object.fromEntries((a.custom_fields||[]).map(x=>[x.field_id,x.value||''])))});const btn=form.querySelector('[type="submit"]');await withBusy(btn,'Saving...',async()=>{try{const r=await AssetAPI.post('updateAsset',p);cacheAssetDetail(r.asset);toast('Placement / assignment updated.');closeModal();closeDrawer();scheduleSync('asset-moved');openAsset(a.asset_id);}catch(err){toast(humanError(err),'error');}});});
    });
  }

  function openImageUpload(assetId){
    if(!isAuthenticated()) return withAccess('STAFF',()=>openImageUpload(assetId));
    openModal('Add Asset Image',`<div class="field"><label>Image type</label><select id="imageType"><option value="main">Main Photo</option><option value="serial_label">Serial / Device Label</option><option value="condition">Condition</option><option value="damage">Damage</option><option value="repair">Repair</option><option value="other">Other</option></select></div><div class="field" style="margin-top:10px"><label>Image</label><input id="imageFile" type="file" accept="image/*" capture="environment"></div><div class="modal-actions"><button id="uploadImageSubmit" class="btn blue">Compress & Upload</button></div><div id="imageUploadStatus" style="font-size:11px;color:var(--muted);margin-top:8px"></div>`,()=>{
      $('uploadImageSubmit').addEventListener('click',async()=>{const file=$('imageFile').files?.[0];if(!file)return toast('Choose an image first.','error');const btn=$('uploadImageSubmit');await withBusy(btn,'Uploading...',async()=>{try{await uploadAssetImage(assetId,file,$('imageType').value,s=>$('imageUploadStatus').textContent=s);invalidateAssetDetail(assetId);toast('Image uploaded.');closeModal();scheduleSync('image-uploaded',20);openAsset(assetId,{force:true});}catch(err){$('imageUploadStatus').textContent=humanError(err);}});});
    });
  }
  async function uploadAssetImage(assetId,file,type,statusCb=()=>{},guestUploadToken=''){
    statusCb('Compressing image...'); const {full,thumb}=await AssetImage.prepareForStorage(file); statusCb(`Uploading ${Math.round(full.size/1024)} KB...`);
    const [base64,thumbnailBase64]=await Promise.all([AssetImage.blobToBase64(full),AssetImage.blobToBase64(thumb)]);
    return AssetAPI.post('uploadImage',{assetId,imageType:type,base64Data:base64,thumbnailBase64,mimeType:'image/webp',guest_upload_token:guestUploadToken});
  }

  async function loadMaintenance(){
    const had=state.maintenance.length>0;
    if(had&&state.route==='maintenance')renderMaintenance();
    if(!had&&state.route==='maintenance')$('maintenanceList').innerHTML=assetSkeletonHtml(3);
    const indicatorId=!had?beginIndicator('Loading maintenance…'):null;
    if(had)beginPassiveSync();
    try{
      const r=await AssetAPI.get('listMaintenance');
      state.maintenance=(r.rows||[]).map(decorateMaintenanceLocal);
      await window.AssetStore?.set?.(STORE_KEYS.maintenance,state.maintenance);
      renderMaintenance();
      return state.maintenance;
    }
    catch(err){
      if(!had&&state.route==='maintenance')$('maintenanceList').innerHTML=`<div class="empty-state">${esc(humanError(err))}</div>`;
      else console.warn('Maintenance refresh failed; cached data remains visible',err);
      return state.maintenance;
    }
    finally{if(indicatorId)endIndicator(indicatorId);else if(had)endPassiveSync();}
  }

  function maintenanceSearchText(m){
    const a=m.asset||{};
    return [m.maintenance_id,m.asset_id,a.brand,a.model,m.issue,m.status,m.maintenance_type,m.assigned_to,m.resolution]
      .filter(Boolean).join(' ').toLowerCase();
  }

  function maintenanceRowsFiltered(){
    const q=String($('maintenanceSearch')?.value||'').trim().toLowerCase();
    const f=state.maintenanceFilters;
    let rows=(state.maintenance||[]).filter(m=>{
      if(q&&!maintenanceSearchText(m).includes(q))return false;
      if(f.status==='Active'&&!['Open','In Progress','Waiting Parts'].includes(String(m.status)))return false;
      else if(f.status&&f.status!=='Active'&&String(m.status)!==String(f.status))return false;
      if(f.type&&String(m.maintenance_type)!==String(f.type))return false;
      if(f.assigned&&!String(m.assigned_to||'').toLowerCase().includes(String(f.assigned).toLowerCase()))return false;
      const stamp=m[f.dateField||'reported_at'];
      if((f.dateFrom||f.dateTo)&&stamp){
        const day=String(stamp).slice(0,10);
        if(f.dateFrom&&day<f.dateFrom)return false;
        if(f.dateTo&&day>f.dateTo)return false;
      }else if((f.dateFrom||f.dateTo)&&!stamp)return false;
      return true;
    });
    const {key,dir}=state.maintenanceSort;
    const sign=dir==='asc'?1:-1;
    rows=rows.slice().sort((a,b)=>{
      let av,bv;
      if(key==='device'){
        av=`${a.asset?.brand||''} ${a.asset?.model||a.asset_id||''}`;
        bv=`${b.asset?.brand||''} ${b.asset?.model||b.asset_id||''}`;
      }else {av=a[key]||'';bv=b[key]||'';}
      if(key.includes('_at'))return sign*((new Date(av).getTime()||0)-(new Date(bv).getTime()||0));
      return sign*String(av).localeCompare(String(bv),undefined,{numeric:true,sensitivity:'base'});
    });
    return rows;
  }

  function renderMaintenanceFilters(){
    const f=state.maintenanceFilters;
    const chips=[];
    if(f.status)chips.push(`Status: ${f.status}`);
    if(f.type)chips.push(`Type: ${f.type}`);
    if(f.assigned)chips.push(`Assigned: ${f.assigned}`);
    if(f.dateFrom||f.dateTo)chips.push(`${f.dateField==='completed_at'?'Completed':'Reported'}: ${f.dateFrom||'…'} → ${f.dateTo||'…'}`);
    $('maintenanceFilterChips').innerHTML=chips.map(x=>`<span class="filter-chip">${esc(x)}</span>`).join('');
    $('maintenanceFilterBadge')?.classList.toggle('hidden',!(f.status||f.type||f.assigned));
    if($('maintenanceFilterBadge'))$('maintenanceFilterBadge').textContent=[f.status,f.type,f.assigned].filter(Boolean).length;
    $('maintenanceDateBadge')?.classList.toggle('hidden',!(f.dateFrom||f.dateTo));
  }

  function renderMaintenanceHeader(){
    const dirFor=key=>state.maintenanceSort.key===key?(state.maintenanceSort.dir==='asc'?' ↑':' ↓'):'';
    $('maintenanceListHeader').innerHTML='';
    $$('#maintenanceListHeader [data-maint-sort]').forEach(btn=>btn.addEventListener('click',()=>{
      const key=btn.dataset.maintSort;
      state.maintenanceSort={key,dir:state.maintenanceSort.key===key&&state.maintenanceSort.dir==='asc'?'desc':'asc'};
      if($('maintenanceMobileSort'))$('maintenanceMobileSort').value=`${key}:${state.maintenanceSort.dir}`;
      renderMaintenance();
    }));
  }

  function maintenanceStatusTone(status){
    if(status==='Completed')return 'done';
    if(status==='Open')return 'open';
    if(status==='In Progress')return 'progress';
    if(status==='Waiting Parts')return 'waiting';
    return 'neutral';
  }
  function renderMaintenanceOverview(){
    const box=$('maintenanceOverview'); if(!box)return;
    const list=state.maintenance||[];
    const active=list.filter(m=>['Open','In Progress','Waiting Parts'].includes(String(m.status))).length;
    const completed=list.filter(m=>m.status==='Completed').length;
    const tabs=[['','All',list.length],['Active','Active',active],['Completed','Completed',completed]];
    const activeFilter=state.maintenanceFilters.status;
    box.innerHTML=`<div class="maintenance-overview-head"><div><b>Maintenance records</b><span>${list.length} total · ${active} need attention</span></div></div><div class="maintenance-quick-tabs" role="group" aria-label="Filter maintenance by status">${tabs.map(([val,label,count])=>`<button type="button" data-maint-tab="${val}" class="maintenance-quick-tab ${activeFilter===val?'selected':''}" aria-pressed="${activeFilter===val}"><span>${label}</span><b>${count}</b></button>`).join('')}</div>`;
    box.querySelectorAll('[data-maint-tab]').forEach(el=>el.addEventListener('click',()=>{
      state.maintenanceFilters.status=el.dataset.maintTab;renderMaintenance();
    }));
  }
  function renderMaintenance(){
    if(!$('maintenanceList'))return;
    const rows=maintenanceRowsFiltered();
    renderMaintenanceFilters();
    renderMaintenanceOverview();
    renderMaintenanceHeader();
    $('maintenanceList').innerHTML=rows.length?rows.map(m=>{
      const a=m.asset||{};
      const name=[a.brand,a.model].filter(Boolean).join(' ')||m.asset_id||'Unknown device';
      const status=String(m.status||'Open');
      const issue=String(m.issue||'No issue summary entered');
      const type=String(m.maintenance_type||'Repair');
      const date=m.reported_at?new Date(m.reported_at).toLocaleDateString('en-MY',{day:'numeric',month:'short',year:'numeric'}):'No date';
      return `<article class="maintenance-ticket">
        <div class="maintenance-ticket-header">
          <button type="button" class="maintenance-ticket-icon" data-maint-asset="${esc(m.asset_id)}" aria-label="Open ${esc(name)}">${icon(catIcon(a.category_name||''),'lg')}</button>
          <div class="maintenance-ticket-device"><b>${esc(name)}</b><small>${esc(m.asset_id)} · ${esc(a.category_name||'Asset')}</small></div>
          <span class="maintenance-ticket-status ${maintenanceStatusTone(status)}">${esc(status)}</span>
        </div>
        <div class="maintenance-ticket-problem"><span class="maintenance-ticket-label">ISSUE</span><strong>${esc(issue)}</strong><div class="maintenance-ticket-tags"><span>${esc(type)}</span>${m.assigned_to?`<span>Assigned: ${esc(m.assigned_to)}</span>`:'<span>Unassigned</span>'}</div></div>
        <div class="maintenance-ticket-footer"><span>Reported ${esc(date)} <span class="maintenance-ticket-age">· ${esc(nowText(m.reported_at))} ago</span></span><div class="maintenance-ticket-buttons"><button type="button" class="btn light sm" data-maint-asset="${esc(m.asset_id)}">View asset</button>${isAuthenticated()?`<button type="button" class="btn blue sm" data-maint="${esc(m.maintenance_id)}">Edit issue</button>`:''}</div></div>
      </article>`;
    }).join(''):'<div class="empty-state maintenance-empty">No maintenance records match. Try a different status, search, date or filter.</div>';
    $$('#maintenanceList [data-maint]').forEach(el=>el.addEventListener('click',()=>openMaintenanceManage(state.maintenance.find(x=>String(x.maintenance_id)===el.dataset.maint))));
    $$('#maintenanceList [data-maint-asset]').forEach(el=>el.addEventListener('click',()=>openAsset(el.dataset.maintAsset)));
  }

  function openMaintenanceDateFilter(){
    const f=state.maintenanceFilters;
    openModal('Filter Maintenance by Date',`<form id="maintenanceDateForm"><div class="form-grid"><div class="field"><label>Date field</label><select name="dateField"><option value="reported_at" ${f.dateField==='reported_at'?'selected':''}>Reported date</option><option value="completed_at" ${f.dateField==='completed_at'?'selected':''}>Completed date</option></select></div><div class="field"><label>Quick range</label><select id="maintenanceDatePreset"><option value="custom">Custom</option><option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="month">This month</option><option value="all">All time</option></select></div><div class="field"><label>From</label><input name="dateFrom" type="date" value="${esc(f.dateFrom)}"></div><div class="field"><label>To</label><input name="dateTo" type="date" value="${esc(f.dateTo)}"></div></div><div class="modal-actions"><button id="clearMaintenanceDate" type="button" class="btn light">Clear</button><button type="submit" class="btn blue">Apply Date</button></div></form>`,()=>{
      const form=$('maintenanceDateForm'),preset=$('maintenanceDatePreset');
      preset.addEventListener('change',()=>{const v=preset.value,today=new Date(),iso=d=>d.toISOString().slice(0,10);let from='',to='';if(['7','30','90'].includes(v)){const d=new Date(today);d.setDate(d.getDate()-Number(v)+1);from=iso(d);to=iso(today);}else if(v==='month'){from=iso(new Date(today.getFullYear(),today.getMonth(),1));to=iso(today);}else if(v==='all'){from='';to='';}if(v!=='custom'){form.elements.dateFrom.value=from;form.elements.dateTo.value=to;}});
      $('clearMaintenanceDate').addEventListener('click',()=>{f.dateFrom='';f.dateTo='';closeModal();renderMaintenance();});
      form.addEventListener('submit',e=>{e.preventDefault();const d=Object.fromEntries(new FormData(form).entries());f.dateField=d.dateField;f.dateFrom=d.dateFrom;f.dateTo=d.dateTo;closeModal();renderMaintenance();});
    },{size:'sm'});
  }

  function openMaintenanceFilters(){
    const f=state.maintenanceFilters;
    const types=Array.from(new Set((state.maintenance||[]).map(m=>m.maintenance_type).filter(Boolean))).sort();
    openModal('More Maintenance Filters',`<form id="maintenanceFilterForm"><div class="form-grid"><div class="field"><label>Status</label><select name="status"><option value="">All statuses</option>${['Active','Open','In Progress','Waiting Parts','Completed','Cancelled'].map(x=>`<option ${f.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Type</label><select name="type"><option value="">All types</option>${types.map(x=>`<option ${f.type===x?'selected':''}>${esc(x)}</option>`).join('')}</select></div><div class="field full"><label>Assigned to</label><input name="assigned" value="${esc(f.assigned)}" placeholder="Person, team or vendor"></div></div><div class="modal-actions"><button id="clearMaintenanceFilters" type="button" class="btn light">Clear</button><button type="submit" class="btn blue">Apply Filters</button></div></form>`,()=>{
      const form=$('maintenanceFilterForm');
      $('clearMaintenanceFilters').addEventListener('click',()=>{Object.assign(f,{status:'',type:'',assigned:''});closeModal();renderMaintenance();});
      form.addEventListener('submit',e=>{e.preventDefault();Object.assign(f,Object.fromEntries(new FormData(form).entries()));closeModal();renderMaintenance();});
    },{size:'sm'});
  }

  function issueAssetSearchMatches(query){
    const q=String(query||'').trim().toLowerCase();
    const rows=(state.assets||[]).filter(a=>String(a.status)!=='Retired');
    if(!q)return rows.slice(0,12);
    return rows.filter(a=>[a.asset_id,a.brand,a.model,a.serial,a.site_name,a.area_name,a.exact_location,a.assigned_to]
      .filter(Boolean).join(' ').toLowerCase().includes(q)).slice(0,20);
  }

  function issueAssetPickerRow(a,selected=false){
    return `<button type="button" class="issue-asset-option ${selected?'selected':''}" data-issue-asset="${esc(a.asset_id)}"><span class="issue-asset-icon">${icon(catIcon(a.category_name),'sm')}</span><span><b>${esc(a.brand)} ${esc(a.model)}</b><small>${esc(a.asset_id)} · ${esc(a.site_name||'No site')}${a.area_name?' · '+esc(a.area_name):''}</small></span>${statusBadge(a.status)}</button>`;
  }

  function openIssueForm(assetId=''){
    if(!isAuthenticated()) return withAccess('STAFF',()=>openIssueForm(assetId));
    const openPicker=async()=>{
      if(!state.assets.length)await loadAssets(true);
      const initial=state.assets.find(a=>String(a.asset_id)===String(assetId))||null;
      openModal('Report Maintenance Issue',`<form id="issueForm"><input type="hidden" name="asset_id" id="issueAssetId" value="${esc(initial?.asset_id||'')}"><div class="field"><label>Asset</label><div class="issue-asset-picker"><div class="asset-search-inline"><svg class="ico sm"><use href="#i-search"/></svg><input id="issueAssetSearch" placeholder="Search asset ID, brand, model, serial or location" autocomplete="off"></div><div id="issueAssetSelected" class="issue-asset-selected"></div><div id="issueAssetResults" class="issue-asset-results"></div></div></div><div class="form-grid issue-fields"><div class="field"><label>Type</label><select name="maintenance_type"><option>Repair</option><option>Inspection</option><option>Upgrade</option><option>Service</option></select></div><div class="field full"><label>Issue / problem</label><textarea name="issue" rows="4" required placeholder="What is wrong or what needs attention?"></textarea></div></div><div class="modal-actions"><button type="submit" class="btn blue">Submit Issue</button></div></form>`,()=>{
        const search=$('issueAssetSearch'),results=$('issueAssetResults'),selected=$('issueAssetSelected'),hidden=$('issueAssetId');
        const paint=()=>{
          const rows=issueAssetSearchMatches(search.value);
          results.innerHTML=rows.length?rows.map(a=>issueAssetPickerRow(a,String(a.asset_id)===String(hidden.value))).join(''):'<div class="empty-state compact">No assets found.</div>';
          const a=state.assets.find(x=>String(x.asset_id)===String(hidden.value));
          selected.innerHTML=a?`<div class="issue-selected-card"><span>Selected asset</span><b>${esc(a.brand)} ${esc(a.model)}</b><small>${esc(a.asset_id)} · ${esc(a.site_name||'No site')}${a.area_name?' · '+esc(a.area_name):''}</small></div>`:'<div class="issue-selected-empty">Choose an asset below.</div>';
          results.querySelectorAll('[data-issue-asset]').forEach(btn=>btn.addEventListener('click',()=>{hidden.value=btn.dataset.issueAsset;search.value='';paint();}));
        };
        search.addEventListener('input',paint);paint();
        $('issueForm').addEventListener('submit',async e=>{
          e.preventDefault();
          if(!hidden.value)return toast('Choose an asset first.','error');
          const btn=e.target.querySelector('[type="submit"]');
          await withBusy(btn,'Submitting...',async()=>{
            try{const r=await AssetAPI.post('createMaintenance',Object.fromEntries(new FormData(e.target).entries()));optimisticMaintenance(r.row);toast('Issue reported.');closeModal();scheduleSync('maintenance-created');}
            catch(err){toast(humanError(err),'error');}
          });
        });
      },{size:'md'});
    };
    openPicker();
  }

  function openMaintenanceManage(m){
    if(!m)return toast('Maintenance record not found.','error');
    if(!isAuthenticated())return withAccess('STAFF',()=>openMaintenanceManage(m));
    openModal('Edit Maintenance',`<form id="maintForm"><div class="maintenance-edit-asset"><b>${esc(m.asset?.brand||'')} ${esc(m.asset?.model||m.asset_id)}</b><small>${esc(m.asset_id)} · ${esc(m.issue)}</small></div><div class="form-grid"><div class="field"><label>Status</label><select name="status">${['Open','In Progress','Waiting Parts','Completed','Cancelled'].map(x=>`<option ${m.status===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="field"><label>Assigned to</label><input name="assigned_to" value="${esc(m.assigned_to||'')}"></div><div class="field"><label>Type</label><input name="maintenance_type" value="${esc(m.maintenance_type||'')}"></div><div class="field"><label>Cost</label><input name="cost" type="number" step="0.01" value="${esc(m.cost||'')}"></div><div class="field full"><label>Resolution / notes</label><textarea name="resolution" rows="4">${esc(m.resolution||'')}</textarea></div></div><div class="modal-actions"><button class="btn blue" type="submit">Save Changes</button></div></form>`,()=>{
      $('maintForm').addEventListener('submit',async e=>{
        e.preventDefault();const btn=e.target.querySelector('[type="submit"]');const params=Object.fromEntries(new FormData(e.target).entries());params.maintenance_id=m.maintenance_id;
        await withBusy(btn,'Saving...',async()=>{try{const r=await AssetAPI.post('updateMaintenance',params);optimisticMaintenance(r.row);toast('Maintenance updated.');closeModal();scheduleSync('maintenance-updated');}catch(err){toast(humanError(err),'error');}});
      });
    });
  }

  async function loadAudits(){
    const had=state.audits.length>0;
    if(had&&state.route==='audit')renderAudits();
    if(!had&&state.route==='audit')$('auditList').innerHTML=assetSkeletonHtml(3);
    const indicatorId=!had?beginIndicator('Loading audits…'):null;
    if(had)beginPassiveSync();
    try{const r=await AssetAPI.get('listAudits');state.audits=r.rows||[];await window.AssetStore?.set?.(STORE_KEYS.audits,state.audits);renderAudits();return state.audits;}
    catch(err){if(!had&&state.route==='audit')$('auditList').innerHTML=`<div class="empty-state">${esc(humanError(err))}</div>`;else console.warn('Audit refresh failed; cached data remains visible',err);return state.audits;}
    finally{if(indicatorId)endIndicator(indicatorId);else if(had)endPassiveSync();}
  }
  function renderAudits(){
    const rows=state.audits;
    $('auditList').innerHTML=rows.length?rows.map(a=>`<div class="audit-row"><div class="audit-icon">${icon('check','lg')}</div><div><b>${esc(a.name)} · ${esc(a.site_name)}${a.area_name?' · '+esc(a.area_name):''}</b><small>${esc(a.checked_count)} / ${esc(a.expected_count)} checked · ${esc(a.pending_count??Math.max(0,a.expected_count-a.checked_count))} pending · ${esc(a.mismatch_count)} mismatches · ${esc(a.status)}</small><div class="audit-progress"><i style="width:${Math.max(0,Math.min(100,Number(a.progress)||0))}%"></i></div></div><div class="actions">${a.status==='In Progress'?`<button class="btn blue sm" data-audit-open="${esc(a.audit_id)}">Continue audit</button>`:statusBadge(a.status)}</div></div>`).join(''):'<div class="empty-state">No audits yet.</div>';
    $$('#auditList [data-audit-open]').forEach(b=>b.addEventListener('click',()=>openAuditVerify(b.dataset.auditOpen)));
  }
  function openStartAudit(){
    if(!isAuthenticated())return withAccess('STAFF',openStartAudit);
    const sites=state.refs.sites.map(s=>`<option value="${esc(s.site_id)}">${esc(s.name)}</option>`).join('');
    openModal('Start Physical Audit',`<form id="auditStartForm"><div class="login-note">Choose a site and optionally an area. AssetHub snapshots the expected asset list before verification begins.</div><div class="form-grid"><div class="field"><label>Name</label><input name="name" value="Physical Audit"></div><div class="field"><label>Site</label><select id="auditSite" name="site_id" required><option value="">Select site</option>${sites}</select></div><div class="field full"><label>Area (optional)</label><select id="auditArea" name="area_id"><option value="">Whole site</option></select></div></div><div class="modal-actions"><button class="btn blue" type="submit">Start Audit</button></div></form>`,()=>{
      const site=$('auditSite'),area=$('auditArea');const fill=()=>{area.innerHTML='<option value="">Whole site</option>'+state.refs.areas.filter(x=>String(x.site_id)===String(site.value)).map(x=>`<option value="${esc(x.area_id)}">${esc(x.name)}</option>`).join('');};site.addEventListener('change',fill);
      $('auditStartForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('[type="submit"]');await withBusy(btn,'Starting...',async()=>{try{const r=await AssetAPI.post('startAudit',Object.fromEntries(new FormData(e.target).entries()));toast('Audit started.');closeModal();await loadAudits(true);if(r.row?.audit_id)openAuditVerify(r.row.audit_id);}catch(err){toast(humanError(err),'error');}});});
    },{size:'sm'});
  }
  function auditReviewHtml(a){
    const pending=Number(a.pending_count??Math.max(0,Number(a.expected_count)-Number(a.checked_count)));
    return `<div class="audit-review-count"><b>${esc(a.checked_count)} / ${esc(a.expected_count)}</b><span>expected assets checked</span><div class="audit-progress"><i style="width:${Math.max(0,Math.min(100,Number(a.progress)||0))}%"></i></div></div><div class="audit-tally"><span>Verified <b>${esc(a.verified_count??'—')}</b></span><span>Mismatch <b>${esc(a.mismatch_count??0)}</b></span><span>Not found <b>${esc(a.not_found_count??0)}</b></span><span>Pending <b>${esc(pending)}</b></span></div>${pending?`<div class="login-note">${pending} expected asset(s) still pending. Verify each device or mark it Not Found after checking.</div>`:`<div class="login-note">No pending expected assets. Review the counts before completing the audit.</div>`}`;
  }
  async function refreshAuditSummary(auditId){
    try{const r=await AssetAPI.get('listAudits');state.audits=r.rows||state.audits;renderAudits();}catch(err){console.warn('Audit summary refresh',err);}
    const a=state.audits.find(x=>x.audit_id===auditId);
    if(a&&$('auditProgressPanel'))$('auditProgressPanel').innerHTML=auditReviewHtml(a);
    if(a&&$('auditCompleteBtn'))$('auditCompleteBtn').disabled=Number(a.pending_count??Math.max(0,a.expected_count-a.checked_count))>0;
    return a;
  }
  function auditRosterRowsHtml(rows, auditId){
    const q=String($('auditRosterSearch')?.value||'').toLowerCase().trim();
    const filter=String($('auditRosterFilter')?.value||'pending');
    const visible=(rows||[]).filter(r=>{
      const matches=!q || [r.asset_id,r.brand,r.model,r.serial,r.category_name,r.site_name,r.area_name].join(' ').toLowerCase().includes(q);
      const status=String(r.result||'Pending');
      const included=filter==='all' || (filter==='pending'&&status==='Pending') || status===filter;
      return matches && included;
    });
    const counts={};(rows||[]).forEach(r=>counts[r.result]=(counts[r.result]||0)+1);
    const count=$('auditRosterCount');if(count)count.textContent=`${visible.length} shown · ${rows.length} total · ${counts.Pending||0} pending`;
    return visible.length ? visible.map(r=>{
      const status=r.result||'Pending',name=[r.brand,r.model].filter(Boolean).join(' ')||'Unnamed asset';
      const badgeClass=status==='Verified'?'good':status==='Mismatch'?'danger':status==='Pending'?'warn':'';
      return `<article class="audit-asset-card ${status==='Pending'?'awaiting':''}"><div class="audit-asset-main"><div class="audit-asset-id">${esc(r.asset_id)} <span class="recognition-badge ${badgeClass}">${esc(status)}</span></div><b>${esc(name)}</b><div class="audit-asset-context">${esc(r.category_name||'Unspecified type')} · ${esc(r.site_name||'No site')}${r.area_name?' / '+esc(r.area_name):''}</div>${r.serial?`<div class="audit-asset-context">Serial: ${esc(r.serial)}</div>`:''}${r.notes?`<div class="audit-asset-context">Note: ${esc(r.notes)}</div>`:''}</div><div class="audit-card-actions"><button class="btn light sm" data-audit-pick="${esc(r.asset_id)}" type="button">Select</button>${status==='Pending'?`<button class="btn blue sm" data-audit-confirm="${esc(r.asset_id)}" type="button">Verify</button>`:''}</div></article>`;
    }).join(''):'<div class="empty-state compact">No assets match this filter. Choose All or change your search.</div>';
  }

  async function refreshAuditRoster(auditId){
    const wrap=$('auditRosterList'); if(!wrap)return null;
    try {
      const res=await AssetAPI.get('getAuditRoster',{audit_id:auditId});
      const roster=res.roster||{rows:[]};
      const audit=roster.audit;
      if(audit){
        const existing=state.audits.find(x=>String(x.audit_id)===String(auditId));
        optimisticAudit(Object.assign({},existing||{},audit));
        if($('auditProgressPanel'))$('auditProgressPanel').innerHTML=auditReviewHtml(audit);
        if($('auditCompleteBtn'))$('auditCompleteBtn').disabled=Number(audit.pending_count||0)>0;
      }
      state.auditRoster=roster.rows||[];
      const paint=()=>{
        if(!$('auditRosterList'))return;
        $('auditRosterList').innerHTML=auditRosterRowsHtml(state.auditRoster,auditId);
        $$('#auditRosterList [data-audit-pick]').forEach(b=>b.addEventListener('click',()=>{
          const input=$('auditAssetInput'); if(!input)return;
          input.value=b.dataset.auditPick;input.dispatchEvent(new Event('input'));
          $('auditSelectionArea')?.scrollIntoView({behavior:'smooth',block:'center'});
        }));
        $$('#auditRosterList [data-audit-confirm]').forEach(b=>b.addEventListener('click',async()=>{
          const input=$('auditAssetInput'); if(input){input.value=b.dataset.auditConfirm;input.dispatchEvent(new Event('input'));}
          if($('auditScanFeedback')?.classList.contains('conflict')&&!confirm('Location conflict: record a mismatch without moving the asset?'))return;
          await withBusy(b,'Verifying…',async()=>verifyAudit(auditId,b.dataset.auditConfirm,$('auditNote')?.value||'',{keepOpen:true}));
        }));
      };
      state.paintAuditRoster=paint;paint();
      const picker=$('auditAssetOptions');
      if(picker)picker.innerHTML=state.auditRoster.map(x=>`<option value="${esc(x.asset_id)}">${esc([x.brand,x.model,x.serial].filter(Boolean).join(' · '))}</option>`).join('');
      return roster;
    }catch(err){
      wrap.innerHTML=`<div class="audit-roster-error">Could not load the audit's expected assets: ${esc(humanError(err))}. Deploy the matching V2.6 Apps Script backend, then reopen this audit.</div>`;
      return null;
    }
  }

  async function openAuditVerify(auditId){
    if(!isAuthenticated())return withAccess('STAFF',()=>openAuditVerify(auditId));
    const audit=state.audits.find(a=>a.audit_id===auditId);if(!audit)return toast('Audit not found.','error');
    openModal('Physical Audit',`<div class="audit-workspace"><div class="audit-scope"><b>${esc(audit.name)}</b><span>${esc(audit.site_name||'')}${audit.area_name?' · '+esc(audit.area_name):''}</span></div><div id="auditProgressPanel">${auditReviewHtml(audit)}</div><section class="audit-roster-panel"><div class="audit-roster-title"><h3>Expected assets</h3><small id="auditRosterCount">Loading expected assets…</small></div><div class="audit-roster-filters"><input id="auditRosterSearch" type="search" placeholder="Search name, type, brand, ID or serial"><select id="auditRosterFilter" aria-label="Filter audit assets"><option value="pending">Pending</option><option value="all">All</option><option value="Verified">Verified</option><option value="Mismatch">Mismatch</option><option value="Not Found">Not Found</option><option value="Unexpected">Unexpected</option></select></div><div id="auditRosterList" class="audit-roster-list"><div class="empty-state compact">Loading assets…</div></div></section><section id="auditSelectionArea" class="audit-verify-panel"><h3>Verify a device</h3><div class="field"><label>Selected asset ID or serial</label><input id="auditAssetInput" list="auditAssetOptions" placeholder="Select from list or type an asset ID" autocomplete="off"><datalist id="auditAssetOptions"></datalist></div><div class="audit-capture-actions"><label class="btn primary file-btn">${icon('camera','sm')} Capture label<input id="auditCameraFile" type="file" accept="image/*" capture="environment"></label><label class="btn light file-btn">${icon('image','sm')} Gallery<input id="auditGalleryFile" type="file" accept="image/*"></label></div><div id="auditScanFeedback" class="audit-feedback" aria-live="polite">Select an expected asset above, or capture its label and confirm the match.</div><div class="field"><label>Notes</label><input id="auditNote" placeholder="Optional observations"></div><div class="audit-capture-actions"><button id="auditVerifyBtn" class="btn blue" type="button">Verify selected</button><button id="auditNotFoundBtn" class="btn light" type="button">Mark Not Found</button></div></section><details class="audit-completion"><summary>Review & complete audit</summary><div id="auditCompleteReview" class="login-note">All expected devices must be reviewed before completion.</div><button id="auditCompleteBtn" class="btn primary" type="button" ${Number(audit.pending_count??Math.max(0,audit.expected_count-audit.checked_count))>0?'disabled':''}>Complete audit</button></details></div>`,()=>{
      const input=$('auditAssetInput'),feedback=$('auditScanFeedback');
      const findSelected=v=>(state.auditRoster||[]).find(x=>String(x.asset_id).toLowerCase()===String(v).toLowerCase());
      input.addEventListener('change',()=>{const val=input.value.trim().toLowerCase();const match=(state.auditRoster||[]).find(x=>x.serial&&String(x.serial).toLowerCase()===val);if(match)input.value=match.asset_id;input.dispatchEvent(new Event('input'));});
      input.addEventListener('input',()=>{
        const a=findSelected(input.value.trim());
        feedback.textContent=a?`${a.brand} ${a.model} · Registered at ${a.site_name||'—'} / ${a.area_name||'—'}${a.expected?'':' · Not in expected list'}`:'Choose an expected asset, or capture a label to match it.';
        feedback.classList.toggle('conflict',!!a&&(!a.expected || (String(a.site_name||'')!==String(audit.site_name||'')) || (audit.area_id && String(a.area_name||'')!==String(audit.area_name||''))));
      });
      $('auditRosterSearch').addEventListener('input',()=>state.paintAuditRoster?.());
      $('auditRosterFilter').addEventListener('change',()=>state.paintAuditRoster?.());
      const scan=async file=>{
        if(!file)return;feedback.classList.remove('conflict');feedback.textContent='Recognizing label…';
        await withBusy($('auditVerifyBtn'),'Recognizing…',async()=>{
          try{
            const [code,ocr]=await Promise.allSettled([window.AssetCode?.scanFile?.(file)||Promise.resolve(null),(async()=>{const image=await AssetImage.prepareForOcr(file);return (await AssetAPI.post('ocr',{image})).result;})()]);
            const codeValue=code.status==='fulfilled'?code.value?.value:'';
            const fields=ocr.status==='fulfilled'?ocr.value?.fields||{}:{};
            const identifier=window.AssetCode?.extractAssetId?.(codeValue)||fields.serial||codeValue;
            if(!identifier)throw new Error('No identifier detected. Search the asset manually.');
            const r=await AssetAPI.get('matchIdentifier',{value:identifier});
            if(!r.match?.found)throw new Error('Identifier not matched. Search manually; no audit record was changed.');
            input.value=r.match.asset.asset_id;input.dispatchEvent(new Event('input'));feedback.textContent='Recognized '+identifier+' — confirm the asset and tap Verify selected.';
          }catch(err){feedback.textContent=humanError(err);feedback.classList.add('conflict');}
        });
      };
      ['auditCameraFile','auditGalleryFile'].forEach(id=>$(id).addEventListener('change',async e=>{const f=e.target.files?.[0];e.target.value='';await scan(f);}));
      $('auditVerifyBtn').addEventListener('click',async()=>{if(feedback.classList.contains('conflict')&&!confirm('Location conflict: this asset may not be expected here. Record a mismatch without moving it?'))return;await withBusy($('auditVerifyBtn'),'Verifying…',async()=>verifyAudit(auditId,input.value,$('auditNote').value,{keepOpen:true}));});
      $('auditNotFoundBtn').addEventListener('click',async()=>{const selected=findSelected(input.value.trim());if(!selected?.expected)return toast('Select an expected asset to mark Not Found.','error');if(!confirm('Mark the selected expected asset as Not Found?'))return;await withBusy($('auditNotFoundBtn'),'Recording…',async()=>verifyAudit(auditId,input.value,$('auditNote').value,{keepOpen:true,result:'Not Found'}));});
      $('auditCompleteBtn').addEventListener('click',async()=>{await completeAudit(auditId,$('auditCompleteBtn'));});
      refreshAuditRoster(auditId);
    },{size:'lg'});
  }
  async function verifyAudit(auditId,assetId,notes='',opts={}){
    if(!isAuthenticated())return withAccess('STAFF',()=>verifyAudit(auditId,assetId,notes,opts));
    if(!assetId)return toast('Enter an asset ID.','error');
    try{const r=await AssetAPI.post('verifyAuditAsset',{audit_id:auditId,asset_id:assetId,notes,result:opts.result||''});toast(`Audit: ${r.row.result}`);if($('auditRosterList'))await refreshAuditRoster(auditId);else await refreshAuditSummary(auditId);
      if(opts.keepOpen){if($('auditScanFeedback'))$('auditScanFeedback').textContent=`${assetId}: ${r.row.result} recorded. Select another asset.`;if($('auditAssetInput'))$('auditAssetInput').value='';if($('auditNote'))$('auditNote').value='';}else closeModal();
    }catch(err){toast(humanError(err),'error');}
  }
  async function completeAudit(id,btn=null){
    if(!isAuthenticated())return withAccess('STAFF',()=>completeAudit(id,btn));
    const audit=await refreshAuditSummary(id);
    if(!audit)return toast('Unable to read audit progress.','error');
    const pending=Number(audit.pending_count??Math.max(0,audit.expected_count-audit.checked_count));
    if(pending>0)return toast(`${pending} expected assets still pending.`, 'error');
    if(!confirm(`Complete audit? Verified ${audit.verified_count||0}, mismatch ${audit.mismatch_count||0}, not found ${audit.not_found_count||0}.`))return;
    await withBusy(btn,'Completing…',async()=>{try{const r=await AssetAPI.post('completeAudit',{audit_id:id});const existing=state.audits.find(x=>x.audit_id===id);if(existing)optimisticAudit({...existing,...r.row,status:'Completed'});toast('Audit completed.');closeModal();await refreshAuditSummary(id);scheduleSync('audit-completed',20);}catch(err){toast(humanError(err),'error');}});
  }

  async function runReport(){
    const params={type:$('reportType').value,site_id:$('reportSite').value,area_id:$('reportArea').value,category_id:$('reportCategory').value,status:$('reportStatus').value,assigned:$('reportAssigned').value,date_from:$('reportDateFrom').value,date_to:$('reportDateTo').value,date_field:$('reportDateField').value};
    state.reportFilters=params;
    const key=reportCacheKey(params); state.reportCacheKey=key;
    const cached=await window.AssetStore?.get?.(key,{maxAge:30*60*1000});
    const indicatorId=!cached?beginIndicator('Loading report…'):null;
    if(cached){state.report=cached;renderReport();beginPassiveSync();}
    const btn=$('runReportBtn');
    if(!cached)setButtonBusy(btn,true,'Running...'); else btn?.classList.add('soft-busy');
    try{
      const r=await AssetAPI.get('report',params); state.report=r.report; renderReport(); await window.AssetStore?.set?.(key,state.report);
    }catch(err){if(!cached)toast(humanError(err),'error');else console.warn('Report refresh failed; cached report remains visible',err);}
    finally{setButtonBusy(btn,false);btn?.classList.remove('soft-busy');if(indicatorId)endIndicator(indicatorId);else if(cached)endPassiveSync();}
  }

  function reportColumnLabel(c){const names={asset_id:'Asset ID',asset_name:'Asset / device',category_name:'Type',site_name:'Site',area_name:'Area',reported_at:'Reported',updated_at:'Updated',assigned_to:'Assigned to',audit_id:'Audit ID',expected_count:'Expected',checked_count:'Checked',mismatch_count:'Mismatches',not_found_count:'Not found'};return names[c]||c.replaceAll('_',' ').replace(/\b\w/g,x=>x.toUpperCase());}
  function reportCell(v,c){if(v===null||v===undefined)return'';if(['timestamp','reported_at','completed_at','started_at','moved_at','updated_at'].includes(c)){const d=new Date(v);return isNaN(d)?v:d.toLocaleString('en-MY');}return v;}
  function reportIdentity(r){return [r.brand,r.model].filter(Boolean).join(' ')||r.asset_name||r.asset_id||'Unspecified asset';}
  function reportDisplayColumns(type){
    if(type==='maintenance')return ['asset_name','category_name','asset_id','issue','status','assigned_to','reported_at','cost'];
    if(type==='audit')return ['name','site_name','area_name','status','expected_count','checked_count','pending_count','mismatch_count','not_found_count'];
    if(type==='movement')return ['asset_name','category_name','asset_id','from_site','to_site','from_area','to_area','moved_at'];
    if(type==='activity')return ['timestamp','action','asset_name','category_name','asset_id','user','details'];
    if(type==='warranty')return ['asset_id','brand','model','category_name','site_name','area_name','warranty_expiry','status'];
    return ['asset_id','brand','model','category_name','serial','site_name','area_name','assigned_to','status'];
  }
  function reportDisplayValue(row,col){return col==='asset_name'?reportIdentity(row):row[col];}
  function renderReport(){
    const r=state.report||{rows:[],summary:{},visuals:{}};
    $('reportSummary').innerHTML=Object.entries(r.summary||{}).map(([k,v])=>`<div class="summary-chip"><strong>${esc(v)}</strong><span>${esc(reportColumnLabel(k))}</span></div>`).join('')||'<div class="empty-state compact">No summary available.</div>';
    renderReportVisuals(r.visuals||{});
    const rows=r.rows||[],cols=reportDisplayColumns(r.type);
    $('reportHead').innerHTML='<tr>'+cols.map(col=>`<th>${esc(reportColumnLabel(col))}</th>`).join('')+'</tr>';
    $('reportBody').innerHTML=rows.length?rows.map(row=>'<tr>'+cols.map(col=>`<td data-label="${esc(reportColumnLabel(col))}">${esc(reportCell(reportDisplayValue(row,col),col))}</td>`).join('')+'</tr>').join(''):`<tr><td colspan="${cols.length}" class="empty-state">No report rows.</td></tr>`;
    state.reportColumns=cols;
    if($('reportDetailCount'))$('reportDetailCount').textContent=`${rows.length} record${rows.length===1?'':'s'} · full sheet columns in CSV export`;
    renderReportPrintSheet(r,rows,cols);
    syncReportCascade();
  }
  function renderReportPrintSheet(report,rows,cols){
    const target=$('reportPrintSheet');if(!target)return;
    const name=({asset:'Asset register',maintenance:'Maintenance and repair',audit:'Physical audit',movement:'Movement history',activity:'Activity log',incomplete:'Missing information',warranty:'Warranty'})[report.type]||'AssetHub report';
    const summary=Object.entries(report.summary||{}).map(([k,v])=>`<div><b>${esc(v)}</b><span>${esc(reportColumnLabel(k))}</span></div>`).join('');
    const date=new Date().toLocaleString('en-MY');
    const f=state.reportFilters||{};
    const selected=[f.date_from||f.date_to?`Period: ${f.date_from||'start'} to ${f.date_to||'today'}`:'All dates',f.site_id?`Site ID: ${f.site_id}`:'All sites',f.category_id?`Category ID: ${f.category_id}`:'All types'].join(' · ');
    const printCols=cols.filter(c=>!['details'].includes(c)).slice(0,8);
    // Readable landscape print/PDF summary; the full unabridged sheet is the CSV.
    const groupable=['asset','incomplete','warranty'].includes(report.type);
    const ordered=groupable?rows.slice().sort((a,b)=>String(a.site_name||a.site||'').localeCompare(String(b.site_name||b.site||''))||String(a.category_name||'').localeCompare(String(b.category_name||''))||String(a.brand||'').localeCompare(String(b.brand||''))):rows;
    let currentGroup='';
    const printTable=ordered.map(r=>{
      const group=r.site_name||r.site||'Unassigned site';
      const head=groupable&&group!==currentGroup?`<tr class="print-group-title"><td colspan="${printCols.length}">${esc(group)}</td></tr>`:'';
      currentGroup=group;
      return head+'<tr>'+printCols.map(col=>`<td>${esc(reportCell(reportDisplayValue(r,col),col))||'—'}</td>`).join('')+'</tr>';
    }).join('');
    target.innerHTML=`<div class="print-report-header"><div><b>JCP <span>AssetHub</span></b><h1>${esc(name)}</h1><p>Generated ${esc(date)} · ${rows.length} records · ${esc(selected)}</p></div><div class="print-report-mark">JC PRINT & OFFICE</div></div><div class="print-report-summary">${summary}</div><table class="print-report-table"><thead><tr>${printCols.map(col=>`<th>${esc(reportColumnLabel(col))}</th>`).join('')}</tr></thead><tbody>${printTable||`<tr><td colspan="${printCols.length}">No results for these filters.</td></tr>`}</tbody></table><footer>JCP AssetHub · Internal asset reporting · For all original Assets sheet columns use CSV Export.</footer>`;
  }
  function renderReportVisuals(visuals){
    const trendWrap=$('reportVisuals'), breakdownWrap=$('reportBreakdowns');
    if(trendWrap)trendWrap.innerHTML=visuals.trend?.items?.length?reportTrendHtml(visuals.trend):'<div class="report-visual-empty">No trend available for this selection.</div>';
    if(breakdownWrap){const groups=(visuals.breakdowns||[]).filter(x=>x.items?.length);breakdownWrap.innerHTML=groups.length?groups.map(reportBreakdownHtml).join(''):'<div class="report-visual-empty">No breakdown available for this selection.</div>';}
  }
  function syncReportCascade(){
    const mobile=matchMedia('(max-width:760px)').matches;
    const trend=$('reportTrendDetails'),breakdowns=$('reportBreakdownDetails'),details=$('reportDetailDetails');
    if(!mobile){if(trend)trend.open=true;if(breakdowns)breakdowns.open=true;if(details)details.open=true;}
    else {if(trend)trend.open=false;if(breakdowns)breakdowns.open=false;if(details)details.open=false;}
  }
  function reportTrendHtml(trend){
    const items=trend.items||[]; const max=Math.max(1,...items.map(x=>Number(x.value)||0)); const w=620,h=150,pad=16;
    const pts=items.map((x,i)=>{const px=items.length===1?w/2:pad+i*(w-pad*2)/(items.length-1);const py=h-pad-(Number(x.value)||0)*(h-pad*2)/max;return`${px.toFixed(1)},${py.toFixed(1)}`;}).join(' ');
    const first=items[0]?.label||'',last=items[items.length-1]?.label||'';
    return `<section class="report-viz-card trend-card"><div class="report-viz-head"><div><h3>${esc(trend.title||'Trend')}</h3><small>${esc(first)}${last&&last!==first?' → '+esc(last):''}</small></div><b>${esc(items.reduce((s,x)=>s+(Number(x.value)||0),0))}</b></div><svg class="trend-svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(trend.title||'Trend')}"><line x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}" class="trend-axis"/><polyline points="${pts}" class="trend-line"/></svg></section>`;
  }
  function reportBreakdownHtml(group){
    const items=group.items||[]; const max=Math.max(1,...items.map(x=>Number(x.value)||0));
    return `<section class="report-viz-card"><div class="report-viz-head"><div><h3>${esc(group.title||'Breakdown')}</h3><small>${esc(items.length)} groups</small></div></div><div class="viz-bars">${items.map(x=>`<div class="viz-bar-row"><div class="viz-bar-label"><span>${esc(String(x.label||'Unspecified').replaceAll('_',' '))}</span><b>${esc(x.value)}</b></div><div class="viz-bar-track"><i style="width:${Math.max(2,Math.round((Number(x.value)||0)/max*100))}%"></i></div></div>`).join('')}</div></section>`;
  }
  function exportReport(){
    if(!state.report)return toast('Run a report first.','error');
    const report=state.report,rows=report.rows||[];
    const cols=Array.isArray(report.export_columns)&&report.export_columns.length?report.export_columns:Array.from(new Set([...(state.reportColumns||[]),...rows.flatMap(r=>Object.keys(r))]));
    // Prevent CSV formula injection without dropping data columns.
    const quote=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s)&&!/^-[0-9]+(?:\.[0-9]+)?$/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';};
    const csv='\ufeff'+[cols.map(quote).join(','),...rows.map(r=>cols.map(k=>quote(r[k])).join(','))].join('\r\n');
    const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=`JCP-AssetHub-${report.type}-${new Date().toISOString().slice(0,10)}-FULL.csv`;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);
    toast(`Exported ${rows.length} records · ${cols.length} columns.`);
  }



  function renderAdmin(){ if(!isAdmin())return; const p=$('adminPanel'); const tab=state.adminTab; if(tab==='sites')p.innerHTML=adminSitesHtml(); if(tab==='categories')p.innerHTML=adminCategoriesHtml(); if(tab==='fields')p.innerHTML=adminFieldsHtml(); if(tab==='users')p.innerHTML=adminUsersHtml(); if(tab==='system')p.innerHTML=adminSystemHtml(); bindAdminPanel(); }
  function adminSitesHtml(){return `<div class="admin-toolbar"><div><h3>Sites & Areas</h3><small>Physical site is separate from department/area.</small></div><button class="btn primary sm" data-admin-add="site">${icon('plus','sm')}Add Site</button></div><div class="ref-list">${state.refs.sites.map(s=>`<div class="ref-row"><div><b>${esc(s.name)}</b><small>${esc(s.site_id)}</small></div><button class="btn light sm" data-admin-edit="site" data-id="${esc(s.site_id)}">Edit</button></div>`).join('')}</div><div class="admin-toolbar" style="margin-top:20px"><div><h3>Areas / Departments</h3></div><button class="btn primary sm" data-admin-add="area">${icon('plus','sm')}Add Area</button></div><div class="ref-list">${state.refs.areas.map(a=>`<div class="ref-row"><div><b>${esc(a.name)}</b><small>${esc(state.refs.sites.find(s=>s.site_id===a.site_id)?.name||a.site_id)}</small></div><button class="btn light sm" data-admin-edit="area" data-id="${esc(a.area_id)}">Edit</button></div>`).join('')}</div>`;}
  function adminCategoriesHtml(){return `<div class="admin-toolbar"><div><h3>Dynamic Categories</h3><small>Admin manages the master category list and asset-ID prefixes. New free-text categories can still be used during asset creation.</small></div><button class="btn primary sm" data-admin-add="category">${icon('plus','sm')}Add Category</button></div><div class="ref-list">${state.refs.categories.map(c=>`<div class="ref-row"><div><b>${esc(c.name)}</b><small>Prefix ${esc(c.prefix||'AS')} · ${esc(c.category_id)}</small></div><button class="btn light sm" data-admin-edit="category" data-id="${esc(c.category_id)}">Edit</button></div>`).join('')}</div>`;}
  function adminFieldsHtml(){return `<div class="admin-toolbar"><div><h3>Custom Asset Information</h3><small>Add Warranty, Vendor, IP Address, Purchase Cost or future fields without changing the Assets sheet.</small></div><button class="btn primary sm" data-admin-add="customField">${icon('plus','sm')}Add Field</button></div><div class="ref-list">${state.refs.custom_fields.map(f=>`<div class="ref-row"><div><b>${esc(f.label)}</b><small>${esc(f.field_type)}${String(f.required)==='true'||f.required===true?' · required':''}</small></div><button class="btn light sm" data-admin-edit="customField" data-id="${esc(f.field_id)}">Edit</button></div>`).join('')}</div>`;}
  function adminUsersHtml(){const users=state.refs.users||[];return `<div class="admin-toolbar"><div><h3>Users & Access</h3><small>Guest can read + add assets. Staff handles operations. Admin controls configuration and destructive actions.</small></div><button class="btn primary sm" data-admin-add="user">${icon('plus','sm')}Add User</button></div><div id="adminUsersList" class="ref-list">${users.length?users.map(u=>`<div class="ref-row"><div><b>${esc(u.name||u.username||u.email)}</b><small>@${esc(u.username||'—')}${u.email?' · '+esc(u.email):''} · ${esc(u.role)} · ${u.active?'active':'disabled'}</small></div><button class="btn light sm" data-user-edit="${esc(u.username||u.email)}">Edit</button></div>`).join(''):'<div class="empty-state compact">No users configured yet. Use Add User.</div>'}</div>`;}
  function adminSystemHtml(){
    const imp=state.boot?.legacy_import||{total:83,imported:0,pending:83,source:'JCP DEVICES LIST - SUMMARRY.csv'};
    const done=Number(imp.pending||0)===0;
    const timing=AssetAPI.getLastTiming?.();
    const lastSync=state.sync.lastCompleted?new Date(state.sync.lastCompleted).toLocaleString('en-MY'):'Not synced yet';
    return `<h3>System</h3><div class="detail-grid" style="margin-top:12px"><div class="detail-field"><label>Frontend version</label><div>${APP_VERSION}</div></div><div class="detail-field"><label>Backend version</label><div>${esc(state.boot?.version||'—')}</div></div><div class="detail-field"><label>Authentication</label><div>${state.boot?.write_auth_required?'Guest: Read + Add · Staff: Operate · Admin: Configure':'Setup mode'}</div></div><div class="detail-field"><label>Last API request</label><div>${timing?esc(timing.ms)+' ms':'—'}</div></div><div class="detail-field"><label>Browser cache</label><div>IndexedDB + memory</div></div><div class="detail-field"><label>Last background sync</label><div>${esc(lastSync)}</div></div></div><div class="system-import-card"><div><span class="recognition-badge ${done?'good':'warn'}">${done?'Imported':'Ready to import'}</span><h4>Original JCP device list</h4><p>${esc(imp.source||'JCP DEVICES LIST - SUMMARRY.csv')}</p><b>${esc(imp.imported||0)} / ${esc(imp.total||83)} linked to AssetHub</b><small>${done?'All source records are linked. The importer is safe to run again.':esc(imp.pending||83)+' source records are still pending.'}</small><small>Phone numbers, account/telco details and billing information are stored separately and are only returned to signed-in Staff/Admin.</small></div><button id="importLegacyBtn" class="btn ${done?'light':'primary'}" ${done?'':'data-import-ready="1"'}>${done?'Check Import Again':'Import Original Data'}</button></div><div class="login-note" style="margin-top:14px">Firebase handles frontend releases and rollback. AssetHub checks version.json without cache; Apps Script configuration now reads IDs from Script Properties.</div>`;
  }
  function bindAdminPanel(){
    $$('[data-admin-add]').forEach(b=>b.addEventListener('click',()=>openAdminEditor(b.dataset.adminAdd)));
    $$('[data-admin-edit]').forEach(b=>b.addEventListener('click',()=>openAdminEditor(b.dataset.adminEdit,b.dataset.id)));
    $$('[data-user-edit]').forEach(b=>b.addEventListener('click',()=>openUserEditor((state.refs.users||[]).find(u=>(u.username||u.email)===b.dataset.userEdit)||{})));
    $('importLegacyBtn')?.addEventListener('click',importLegacyInventory);
  }
  async function importLegacyInventory(){
    const btn=$('importLegacyBtn');
    const imp=state.boot?.legacy_import||{};
    if(Number(imp.pending||0)>0){
      const ok=confirm(`Import the original JCP device list now?\n\nAssetHub will link or add up to ${imp.pending} pending records. Existing source-linked records will not be duplicated.`);
      if(!ok)return;
    }
    await withBusy(btn,'Importing...',async()=>{
      try{
        const r=await AssetAPI.post('importLegacyInventory',{});
        cacheRemove(CACHE_ASSETS); state.assets=[];
        await boot({closeModalAfter:false,loadLists:false});
        state.adminTab='system'; setRoute('admin'); renderAdmin();
        const x=r.result||{};
        toast(`Import complete: ${x.inserted||0} added, ${x.linked_existing||0} linked, ${x.already_imported||0} already imported.${x.unplaced?` ${x.unplaced} records remain unplaced because the source had no site/area.`:''}`);
      }catch(err){toast(humanError(err),'error');}
    });
  }
  function applyAdminRow(kind,row){
    if(!row)return;
    const map={site:['sites','site_id'],area:['areas','area_id'],category:['categories','category_id'],customField:['custom_fields','field_id']};
    const cfg=map[kind]; if(!cfg)return;
    state.refs[cfg[0]]=upsertByKey(state.refs[cfg[0]]||[],row,cfg[1]);
    if(kind==='customField')state.refs.custom_fields=(state.refs.custom_fields||[]).slice().sort((a,b)=>Number(a.sort_order||0)-Number(b.sort_order||0));
    state.assetDetails.clear();window.AssetStore?.clear?.(STORE_KEYS.detailPrefix);
    if(state.boot){state.boot.references=state.refs;cacheWrite(CACHE_BOOT,safeBootCache(state.boot));}
    populateFilters();
  }

  function openAdminEditor(kind,id=''){
    if(kind==='user')return openUserEditor();
    let row={}; if(id){const arr=kind==='site'?state.refs.sites:kind==='area'?state.refs.areas:kind==='category'?state.refs.categories:state.refs.custom_fields; const key=kind==='site'?'site_id':kind==='area'?'area_id':kind==='category'?'category_id':'field_id';row=arr.find(x=>x[key]===id)||{};}
    let fields=''; if(kind==='site')fields=`<div class="field"><label>Name</label><input name="name" value="${esc(row.name||'')}" required></div>`;
    if(kind==='area')fields=`<div class="field"><label>Site</label><select name="site_id">${state.refs.sites.map(s=>`<option value="${esc(s.site_id)}" ${s.site_id===row.site_id?'selected':''}>${esc(s.name)}</option>`).join('')}</select></div><div class="field"><label>Name</label><input name="name" value="${esc(row.name||'')}" required></div>`;
    if(kind==='category')fields=`<div class="field"><label>Name</label><input name="name" value="${esc(row.name||'')}" required></div><div class="field"><label>Asset ID prefix</label><input name="prefix" value="${esc(row.prefix||'AS')}" maxlength="5"></div>`;
    if(kind==='customField')fields=`<div class="field"><label>Label</label><input name="label" value="${esc(row.label||'')}" required></div><div class="field"><label>Type</label><select name="field_type">${['text','date','number','select','boolean'].map(t=>`<option ${row.field_type===t?'selected':''}>${t}</option>`).join('')}</select></div><div class="field full"><label>Options JSON <span style="font-weight:500">(select only)</span></label><input name="options_json" value='${esc(row.options_json||'')}' placeholder='["Option A","Option B"]'></div><div class="field"><label>Required</label><select name="required"><option value="false">No</option><option value="true" ${String(row.required)==='true'||row.required===true?'selected':''}>Yes</option></select></div><div class="field"><label>Sort order</label><input name="sort_order" type="number" value="${esc(row.sort_order||100)}"></div>`;
    openModal(`${id?'Edit':'Add'} ${kind}`,`<form id="adminEditForm" class="form-grid">${fields}<div class="field"><label>Active</label><select name="active"><option value="true">Yes</option><option value="false" ${String(row.active)==='false'?'selected':''}>No</option></select></div><div class="field full"><div class="modal-actions"><button class="btn blue" type="submit">Save</button></div></div></form>`,()=>{$('adminEditForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('[type=submit]');const p=Object.fromEntries(new FormData(e.target).entries());p.kind=kind;p.id=id;await withBusy(btn,'Saving...',async()=>{try{const r=await AssetAPI.post('adminSave',p);applyAdminRow(kind,r.row);toast('Saved.');closeModal();state.adminTab=kind==='customField'?'fields':kind==='category'?'categories':'sites';setRoute('admin');renderAdmin();scheduleSync('admin-config',40);}catch(err){toast(humanError(err),'error');}});});});
  }
  function openUserEditor(u={}){openModal((u.username||u.email)?'Edit User':'Add User',`<form id="userForm" class="form-grid"><div class="field"><label>Username</label><input name="username" value="${esc(u.username||'')}" required></div><div class="field"><label>Email <span style="font-weight:500">(optional)</span></label><input name="email" type="email" value="${esc(u.email||'')}"></div><div class="field"><label>Name</label><input name="name" value="${esc(u.name||'')}" required></div><div class="field"><label>Role</label><select name="role"><option ${u.role==='STAFF'?'selected':''}>STAFF</option><option ${u.role==='ADMIN'?'selected':''}>ADMIN</option></select></div><div class="field"><label>Password</label><input name="password" type="password"><small>Leave blank to keep the existing password.</small></div><div class="field"><label>Active</label><select name="active"><option value="true" ${u.active!==false?'selected':''}>Yes</option><option value="false" ${u.active===false?'selected':''}>No</option></select></div><div class="field full"><div class="modal-actions"><button class="btn blue" type="submit">Save User</button></div></div></form>`,()=>{$('userForm').addEventListener('submit',async e=>{e.preventDefault();const btn=e.target.querySelector('[type=submit]');await withBusy(btn,'Saving...',async()=>{try{const r=await AssetAPI.post('saveUser',Object.fromEntries(new FormData(e.target).entries()));state.refs.users=upsertByKey(state.refs.users||[],r.row,'user_id');toast('User saved.');closeModal();state.adminTab='users';setRoute('admin');renderAdmin();scheduleSync('user-config',40);}catch(err){toast(humanError(err),'error');}});});});}

  function setScannerStage(stage){
    const scanner=$('page-scanner'); if(!scanner)return;
    scanner.classList.toggle('scanner-show-result',stage==='result');
    scanner.classList.toggle('scanner-processing',stage==='processing');
  }
  async function captureMobileFrame(){
    const video=$('scannerVideo');
    if(!video?.videoWidth||!state.cameraStream) return $('scannerCameraFile')?.click();
    const canvas=document.createElement('canvas');
    canvas.width=video.videoWidth;canvas.height=video.videoHeight;
    canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.93));
    if(!blob){toast('Could not capture image. Try Gallery.','error');return;}
    const file=new File([blob],'device-label-'+Date.now()+'.jpg',{type:'image/jpeg'});
    showScannerPhotoPreview(file); setScannerStage('processing');
    try{await processScanFile(file);}catch(err){toast(humanError(err),'error');setScannerStage('result');}
  }
  async function toggleMobileTorch(){
    const track=state.cameraStream?.getVideoTracks?.()[0];
    const supported=track?.getCapabilities?.().torch;
    if(!supported){toast('Torch is not available on this device.','error');return;}
    const enabled=!($('mobileTorchBtn').dataset.enabled==='true');
    try{await track.applyConstraints({advanced:[{torch:enabled}]});$('mobileTorchBtn').dataset.enabled=String(enabled);$('mobileTorchBtn').classList.toggle('active',enabled);}catch{toast('Torch could not be enabled.','error');}
  }

  function resetScannerPreview(){
    const ph=$('scannerPlaceholder'); if(!ph)return;
    const old=ph.dataset.photoUrl; if(old){try{URL.revokeObjectURL(old);}catch{} delete ph.dataset.photoUrl;}
    ph.innerHTML=`${icon('camera','xl')}<b>Camera is off</b><span>Frame the device label, then take a photo or choose Gallery.</span>`;
    document.querySelector('.scanner-view')?.classList.remove('photo-previewing');
  }

  function showScannerPhotoPreview(file){
    if(!file)return;
    stopCamera();
    const ph=$('scannerPlaceholder'); if(!ph)return;
    const old=ph.dataset.photoUrl; if(old){try{URL.revokeObjectURL(old);}catch{}}
    const url=URL.createObjectURL(file); ph.dataset.photoUrl=url;
    ph.innerHTML=`<img class="scanner-photo-preview" src="${url}" alt="Captured device label"><span class="scanner-photo-caption">Photo ready · reading label…</span>`;
    ph.classList.remove('hidden');
    document.querySelector('.scanner-view')?.classList.add('photo-previewing');
    $('scanHint').textContent='Photo captured. AssetHub is checking QR/barcode and OCR together.';
  }

  async function startCamera(){
    if(state.cameraStream){stopCamera();return;}
    resetScannerPreview();
    const btn=$('startCameraBtn');
    if(!navigator.mediaDevices?.getUserMedia){
      $('scanHint').textContent='Live camera preview is unavailable in this browser. Tap the shutter to use your phone camera, or choose Gallery.';
      return;
    }
    await withBusy(btn,'Starting...',async()=>{
      try{
        state.cameraStream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'}},audio:false});
        $('scannerVideo').srcObject=state.cameraStream; await $('scannerVideo').play();
        $('scannerPlaceholder').classList.add('hidden');
        // On phones the shutter controls recognition. Desktop keeps V1.9 live QR detection.
        if(!window.matchMedia('(max-width:760px)').matches)setupBarcodeDetector();
      }catch(err){
        $('scanHint').textContent='Live preview is unavailable. Tap the shutter to use your phone camera or choose Gallery.';
        console.warn('Camera preview unavailable; native capture remains available:',err);
      }
    });
    if(state.cameraStream) btn.innerHTML=`${icon('camera','sm')}Stop Live Scanner`;
  }

  function stopCamera(){
    if(state.scanTimer)clearInterval(state.scanTimer);
    state.scanTimer=null;
    if(state.cameraStream){state.cameraStream.getTracks().forEach(t=>t.stop());state.cameraStream=null;}
    $('scannerVideo').srcObject=null;
    $('scannerPlaceholder').classList.remove('hidden');
    $('startCameraBtn').innerHTML=`${icon('scan','sm')}Live Scanner`;
  }

  async function setupBarcodeDetector(){
    if(!('BarcodeDetector' in window)){
      $('scanHint').textContent='Live barcode detection is not supported here. Take Label Photo or Choose Existing Photo still checks QR, barcode and OCR together.';
      return;
    }
    try{
      const formats=await BarcodeDetector.getSupportedFormats();
      state.barcodeDetector=new BarcodeDetector({formats:formats.filter(x=>['qr_code','code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','data_matrix','codabar'].includes(x))});
      state.scanTimer=setInterval(detectBarcode,700);
      $('scanHint').textContent="Watching for QR/barcodes. For labels, Take Label Photo uses your phone's normal camera capture flow.";
    }catch(err){$('scanHint').textContent='Live code detection unavailable. Take Label Photo and Choose Existing Photo still work.';}
  }

  async function detectBarcode(){
    const video=$('scannerVideo');
    if(!state.barcodeDetector||video.readyState<2)return;
    try{
      const codes=await state.barcodeDetector.detect(video);
      if(codes.length){
        const code=codes[0];
        clearInterval(state.scanTimer);state.scanTimer=null;
        await handleCode(code.rawValue,code.format||'barcode');
      }
    }catch{}
  }

  async function handleCode(value,format='barcode'){
    const v=String(value||'').trim();
    if(!v)return;
    $('scanResult').innerHTML='<div class="empty-state compact">Checking detected code...</div>';
    setScannerStage('processing');
    try{
      const r=await AssetAPI.get('matchIdentifier',{value:v});
      if(r.match?.found){
        renderScanAsset(r.match.asset,{source:format,note:r.match.match_type==='serial'?'Matched registered serial':'Matched JCP asset QR'});
        if(state.activeAuditId){await verifyAudit(state.activeAuditId,r.match.asset.asset_id,'Scanned in audit mode');state.activeAuditId='';}
        return;
      }
      const isJcp=window.AssetCode?.extractAssetId?.(v);
      renderScanCode(v,isJcp?'JCP asset code detected, but that asset was not found.':'Manufacturer barcode / identifier detected.',format);
    }catch(err){renderScanCode(v,'Code detected, but AssetHub lookup failed: '+humanError(err),format);}
  }

  function renderScanCode(v,note,format='barcode'){
    setScannerStage('result');
    $('scanResult').innerHTML=`<div class="result-card"><div class="recognition-badges"><span class="recognition-badge">${esc(String(format||'barcode').replaceAll('_',' '))}</span></div><strong>Code detected</strong><div class="result-grid"><span>Value</span><b>${esc(v)}</b><span>Meaning</span><b>${esc(note)}</b></div><div class="actions scan-result-actions" style="margin-top:10px"><button id="useCodeSerial" class="btn light sm">Use in New Asset</button><button id="scanAgain" class="btn light sm">Scan again</button></div></div>`;
    $('useCodeSerial')?.addEventListener('click',()=>openAssetForm({serial:v}));
    $('scanAgain')?.addEventListener('click',resetScannerResult);
  }

  function renderScanAsset(a,meta={}){
    setScannerStage('result');
    const incoming=meta.incoming||{};
    const hasEvidence=!!(incoming.brand||incoming.model||incoming.serial||incoming.category||incoming.specifications);
    const staff=isAuthenticated();
    state.lastRecognition={...(state.lastRecognition||{}),duplicate:a,ocr:meta.ocr||null,file:meta.scanFile||state.scanFile};
    $('scanResult').innerHTML=`<div class="result-card"><div class="recognition-badges"><span class="recognition-badge good">Existing asset</span>${meta.source?`<span class="recognition-badge">${esc(String(meta.source).replaceAll('_',' '))}</span>`:''}</div><strong>Existing JCP asset found</strong><div class="result-grid"><span>Asset</span><b>${esc(a.asset_id)}</b><span>Device</span><b>${esc(a.brand)} ${esc(a.model)}</b><span>Serial</span><b>${esc(a.serial||'—')}</b><span>Placement</span><b>${esc(a.site_name||'—')} · ${esc(a.area_name||'—')}</b><span>Status</span><b>${esc(a.status)}</b></div>${meta.note?`<div class="scan-existing"><b>${esc(meta.note)}</b><small>This scan will not create a duplicate.</small></div>`:''}
    ${state.scanUpdateTarget?`<div class="scan-target-panel"><b>Update selected asset ${esc(state.scanUpdateTarget.asset_id)}</b><small>Review the scanned evidence against the asset you selected.</small><button id="updateTargetFromExact" class="btn primary" type="button">Review changes</button></div>`:''}
    ${staff?`<div class="scan-match-primary"><b>Existing device? Review before changing records.</b><small>Reconcile fills missing information or compares conflicts. Merge combines two distinct records and always needs confirmation.</small>${hasEvidence?'<button id="reconcileExactScan" class="btn primary">Review scanned fields / Reconcile</button>':''}<button id="mergeExactScan" class="btn light">Compare / Merge another record</button></div>`:''}
    <div class="actions scan-result-actions"><button id="openScannedAsset" class="btn blue sm">Open Asset</button><button id="scanAgainExisting" class="btn light sm">Scan again</button></div></div>`;
    $('updateTargetFromExact')?.addEventListener('click',()=>withBusy($('updateTargetFromExact'),'Loading asset…',async()=>{
      const t=state.scanUpdateTarget;state.scanUpdateTarget=null;
      if(t)await openScanReconcile(t,incoming,meta.scanFile||state.scanFile);
    }));
    $('openScannedAsset')?.addEventListener('click' ,()=>openAsset(a.asset_id));
    $('scanAgainExisting')?.addEventListener('click',resetScannerResult);
    $('reconcileExactScan')?.addEventListener('click',()=>withAccess('STAFF',()=>openScanReconcile(a,incoming,meta.scanFile||state.scanFile)));
    $('mergeExactScan')?.addEventListener('click',()=>withAccess('STAFF',()=>openManualMerge(a)));
  }

  function resetScannerResult(){
    $('scanResult').innerHTML='<div class="empty-state compact">Ready for another scan.</div>';
    state.lastRecognition=null;
    state.scanFile=null;
    if(state.recognitionSession){state.recognitionSession.photos.forEach(x=>{try{URL.revokeObjectURL(x.url);}catch(_){}});state.recognitionSession=null;}
    setScannerBusy(false);
    if(state.cameraStream)setupBarcodeDetector(); else resetScannerPreview();
    setScannerStage('camera');
    if(window.matchMedia('(max-width:760px)').matches && !state.cameraStream)startCamera();
  }

  function normalizeCodeValue(value){return String(value||'').toUpperCase().replace(/[^A-Z0-9]/g,'');}
  function setScannerBusy(busy){
    ['startCameraBtn','captureBtn'].forEach(id=>{const b=$(id);if(b)b.disabled=busy;});
    ['scannerFile','scannerCameraFile'].forEach(id=>{const input=$(id);if(input)input.disabled=busy;});
    document.querySelector('.file-btn')?.classList.toggle('busy',busy);
  }

  function scanProgress(stage,message,fields={}){
    setScannerStage('result');
    const items=[['category','Type'],['brand','Brand'],['model','Model'],['serial','Serial'],['specifications','Specifications']];
    const step=Math.max(1,Math.min(4,stage));
    const names=['Reading photo','Extracting OCR','AI organizing fields','Comparing assets'];
    $('scanResult').innerHTML=`<div class="scan-progress-card" role="status" aria-live="polite"><div class="scan-progress-top"><span class="btn-spinner"></span><b>${esc(message)}</b><small>Step ${step} of 4</small></div><div class="scan-progress-bar"><span style="width:${step*25}%"></span></div><div class="scan-progress-steps">${names.map((name,i)=>`<span class="${i+1<step?'done':i+1===step?'current':''}">${esc(name)}</span>`).join('')}</div><div class="scan-progress-fields">${items.map(([key,title])=>`<div class="${fields[key]?'found':'waiting'}"><small>${title}</small><b>${esc(fields[key]||'Waiting for recognition…')}</b></div>`).join('')}</div></div>`;
  }
  function recognitionState(){
    if(!state.recognitionSession){state.recognitionSession={photos:[],resolutions:{},overrides:{},matches:[],matchVersion:0};}
    return state.recognitionSession;
  }
  function recognitionProposal(){
    const r=recognitionState();
    return window.AssetRecognition.consolidate(r.photos.filter(x=>x.observation).map(x=>x.observation),r.resolutions);
  }
  function recognitionIncoming(){
    return window.AssetRecognition.toIncoming(recognitionProposal(),recognitionState().overrides);
  }
  function recognitionPhotos(){return recognitionState().photos.map(x=>x.file);}
  function recognitionStatusHtml(){
    const session=recognitionState();
    const phases=[['captured','Captured'],['ocr','OCR read'],['ai','AI organized'],['matched','Matched']];
    const latest=session.photos[session.photos.length-1];
    return `<div class="v27-progress" role="status" aria-live="polite">${phases.map(([key,title])=>{
      const idx=phases.findIndex(p=>p[0]===key),done=latest?.steps?.[key]==='done',skipped=latest?.steps?.[key]==='skipped';
      const busy=latest?.steps?.[key]==='busy';
      return `<div class="v27-stage ${done?'complete':busy?'active':skipped?'skipped':''}"><span>${done?'✓':busy?'◌':skipped?'−':String(idx+1)}</span><small>${title}</small></div>`;
    }).join('')}</div>`;
  }
  function showUniversalRecognition(){
    const session=recognitionState(),proposal=recognitionProposal();
    const incoming=recognitionIncoming();
    const hasPhotos=session.photos.length>0;
    const running=session.photos.some(x=>x.processing);
    const unresolved=proposal.hasUnresolved;
    const photoHtml=session.photos.map((x,i)=>`<div class="v27-photo"><img src="${esc(x.url)}" alt="Source photo ${i+1}"><div><b>Image ${i+1}</b><small>${esc(x.processing?'Processing…':x.error?'Needs review':x.ai?'AI + OCR':x.observation?'OCR':'No OCR text')}</small></div><button type="button" class="v27-remove" data-remove-image="${esc(x.id)}" title="Remove this source" ${running?'disabled':''}>×</button></div>`).join('');
    const core=[['category','Category'],['brand','Brand'],['model','Model'],['serial','Serial number']].map(([k,label])=>{
      const original=proposal.fields[k];
      return `<label class="v27-edit-field"><span>${label}</span><input data-universal-field="${k}" value="${esc(incoming[k]||'')}" placeholder="Not detected — enter manually"><small>${original?.evidence?`Image ${esc(original.source_image.split('_')[1]||'?')} · ${esc(original.status)} · ${esc(original.evidence.slice(0,95))}`:'Not detected; manual confirmation required'}</small></label>`;
    }).join('');
    const conflictHtml=proposal.conflicts.length?`<section class="v27-conflicts"><b>Review conflicting values (${proposal.conflicts.length})</b><p>Choose the correct value for each discrepancy before creating or updating an asset.</p>${proposal.conflicts.map(c=>`<div class="v27-conflict"><label>${esc(c.label.replace(/_/g,' '))}</label><select data-conflict="${esc(c.id)}"><option value="">Choose a source value…</option>${c.options.map(o=>`<option value="${esc(o.value)}" ${c.resolved&&session.resolutions[c.id]===o.value?'selected':''}>${esc(o.value)} — ${esc(o.source_image)}</option>`).join('')}</select></div>`).join('')}</section>`:'';
    const attrRows=proposal.attributes.map(a=>`<tr><td>${esc(a.label||a.key)}</td><td>${esc(a.value)}</td><td>${esc(a.source_image)}<small class="v27-value-evidence">${esc(a.evidence||'OCR observation')}</small></td></tr>`).join('');
    const idRows=proposal.identifiers.map(a=>`<tr><td>${esc(window.AssetRecognition.ID_LABELS[a.type]||a.type)}</td><td>${esc(a.value)}</td><td>${esc(a.source_image)}<small class="v27-value-evidence">${esc(a.evidence||'OCR observation')}</small></td></tr>`).join('');
    const data=proposal.sourceCount;
    const raw=session.photos.filter(p=>p.ocr?.text).map(p=>`<h5>${esc(p.id)}</h5><pre>${esc(p.ocr.text)}</pre>`).join('');
    const matches=session.matches.map((m,i)=>`<div class="scan-match-card"><div class="scan-match-copy"><b>${esc(assetDisplayName(m.asset))}</b><small>${esc(m.asset.asset_id)} · ${esc(m.asset.site_name||'No site')} · ${esc(m.asset.area_name||'')}</small><small>${esc((m.reasons||[]).join(' · '))}</small>${m.conflicts?.length?`<small>Conflicts: ${esc(m.conflicts.join(', '))}</small>`:''}</div><button type="button" class="btn light sm" data-v27-match="${i}" ${running||unresolved?'disabled':''}>Review match</button></div>`).join('');
    const errors=session.photos.filter(x=>x.error||x.warning).map(x=>`<div class="scan-warning">${esc(x.id)}: ${esc(x.error||x.warning)}</div>`).join('');
    const sourceCount=session.photos.length;
    const pendingTarget=state.scanUpdateTarget;
    $('scanResult').innerHTML=`<div class="result-card v27-result"><div class="recognition-badges"><span class="recognition-badge">Universal recognition V2.7</span><span class="recognition-badge">${sourceCount} photo${sourceCount===1?'':'s'}</span>${running?'<span class="recognition-badge warn">Processing · preliminary fields visible</span>':''}</div><strong>One asset · multiple evidence sources</strong>${recognitionStatusHtml()}
      <div class="v27-photo-strip">${photoHtml}</div><div class="v27-photo-actions"><button id="v27AddPhoto" class="btn light sm" type="button" ${running||sourceCount>=6?'disabled':''}>+ Add another photo</button><button id="v27CameraPhoto" class="btn light sm" type="button" ${running||sourceCount>=6?'disabled':''}>Take another photo</button><button id="v27Reset" class="btn light sm" type="button">${running?'Cancel recognition':'Start new asset'}</button></div>
      ${errors}${conflictHtml}
      <div class="v27-core"><h4>Review the main information</h4><div class="v27-fields">${core}</div></div>
      ${idRows?`<details class="v27-evidence-block" open><summary>Additional identifiers (${proposal.identifiers.length})</summary><div class="v27-table-wrap"><table><thead><tr><th>Type</th><th>Value</th><th>Source</th></tr></thead><tbody>${idRows}</tbody></table></div></details>`:''}
      ${attrRows?`<details class="v27-evidence-block" open><summary>Technical attributes (${proposal.attributes.length})</summary><div class="v27-table-wrap"><table><thead><tr><th>Attribute</th><th>Value</th><th>Source</th></tr></thead><tbody>${attrRows}</tbody></table></div></details>`:''}
      <details class="v27-evidence-block"><summary>Specifications text · editable before save</summary><textarea id="v27Specs" rows="5" aria-label="Approved specifications">${esc(incoming.specifications)}</textarea></details>
      <details class="v27-evidence-block"><summary>Source evidence and raw OCR</summary>${raw||'<p>OCR text unavailable.</p>'}</details>
      ${session.matches.length?`<div class="scan-match-zone"><div class="scan-match-heading"><b>Possible existing assets (${session.matches.length})</b><small>These records were not modified. Review before creating a duplicate.</small></div>${matches}</div>`:''}
      ${pendingTarget?`<div class="scan-target-panel"><b>Scan to update: ${esc(pendingTarget.asset_id)}</b><small>Compare only changed or missing fields before approval.</small></div>`:''}
      ${unresolved?'<div class="scan-warning conflict-box">Conflicting source values need explicit resolution before the next step.</div>':''}
      <div class="scan-match-primary"><b>${pendingTarget?'Review changes to selected asset':'Confirm information before saving'}</b><small>${running?'You can inspect preliminary information while processing finishes.':'No record will be created or changed until you review and submit.'}</small>
      ${pendingTarget?'<button id="v27UpdateTarget" class="btn primary" type="button">Review changes</button>':`<button id="v27Create" class="btn primary" type="button">${session.matches.length?'Create separate asset anyway':'Review & Create Asset'}</button>`}
      <button id="v27FindMatch" class="btn light" type="button">Find existing asset</button></div></div>`;
    setScannerStage('result');
    $('v27AddPhoto')?.addEventListener('click',()=>$('scannerFile')?.click());
    $('v27CameraPhoto')?.addEventListener('click',()=>$('scannerCameraFile')?.click());
    $('v27Reset')?.addEventListener('click',resetScannerResult);
    $$('[data-remove-image]').forEach(btn=>btn.addEventListener('click',()=>{
      const idx=session.photos.findIndex(x=>x.id===btn.dataset.removeImage);
      if(idx<0)return;const [removed]=session.photos.splice(idx,1);URL.revokeObjectURL(removed.url);
      session.matches=[];session.overrides={};session.resolutions={};
      if(!session.photos.length)return resetScannerResult();
      showUniversalRecognition();updateUniversalMatches();
    }));
    $$('[data-conflict]').forEach(el=>el.addEventListener('change',()=>{
      if(el.value)session.resolutions[el.dataset.conflict]=el.value;
      else delete session.resolutions[el.dataset.conflict];
      showUniversalRecognition();updateUniversalMatches();
    }));
    $$('[data-universal-field]').forEach(el=>el.addEventListener('change',()=>{session.overrides[el.dataset.universalField]=el.value.trim();updateUniversalMatches();}));
    $('v27Specs')?.addEventListener('change',e=>{session.overrides.specifications=e.target.value;});
    const blocked=running||unresolved;
    ['v27Create','v27UpdateTarget','v27FindMatch'].forEach(id=>{const el=$(id);if(el)el.disabled=blocked;});
    const getIncoming=()=>{
      // Save any typed values, even when a button is clicked before the field loses focus.
      $$('[data-universal-field]').forEach(el=>session.overrides[el.dataset.universalField]=el.value.trim());
      if($('v27Specs'))session.overrides.specifications=$('v27Specs').value.trim();
      return recognitionIncoming();
    };
    $('v27Create')?.addEventListener('click',()=>{
      const f=getIncoming();
      if(!f.brand||!f.model)return toast('Brand and model are required; enter them manually if OCR could not detect them.','error');
      if(session.matches.length && !confirm('Possible existing assets were found. Create a separate asset anyway?'))return;
      openAssetForm({category_name:f.category,brand:f.brand,model:f.model,serial:f.serial,specifications:f.specifications,_scanFiles:recognitionPhotos()});
    });
    $('v27UpdateTarget')?.addEventListener('click',()=>withAccess('STAFF',()=>openScanReconcile(pendingTarget,getIncoming(),recognitionPhotos())));
    $('v27FindMatch')?.addEventListener('click',()=>withAccess('STAFF',()=>openScanMatchPicker(getIncoming(),recognitionPhotos())));
    $$('[data-v27-match]').forEach(btn=>btn.addEventListener('click',()=>{
      const m=session.matches[Number(btn.dataset.v27Match)];if(m)withAccess('STAFF',()=>openScanReconcile(m.asset,getIncoming(),recognitionPhotos()));
    }));
  }
  async function updateUniversalMatches(){
    const session=state.recognitionSession;if(!session)return;
    const proposal=recognitionProposal(),incoming=recognitionIncoming();
    const currentVersion=++session.matchVersion;
    if(proposal.hasUnresolved)return;
    if(!incoming.model&&!incoming.serial&&!proposal.identifiers.length)return;
    const ids=proposal.identifiers.map(x=>({type:x.type,value:x.value}));
    try{
      const result=await AssetAPI.get('suggestMatchesV27',{...incoming,identifiers_json:JSON.stringify(ids)});
      if(state.recognitionSession!==session||currentVersion!==session.matchVersion)return;
      session.matches=Array.isArray(result.matches)?result.matches:[];
      showUniversalRecognition();
    }catch(err){console.warn('Optional match suggestions unavailable',err);}
  }
  async function processScanFile(file){
    if(!file)return;
    const session=recognitionState();
    if(session.photos.some(x=>x.file.name===file.name && x.file.size===file.size && x.file.lastModified===file.lastModified))return toast('That image is already in this session.','error');
    if(session.photos.length>=6)return toast('Up to six photos per recognition session. Remove one to add another.','error');
    const id='image_'+String(session.photos.length+1).padStart(2,'0')+'_'+Date.now().toString(36);
    const item={id,file,url:URL.createObjectURL(file),steps:{captured:'done',ocr:'busy',ai:'pending',matched:'pending'},processing:true,ocr:null,observation:null,ai:null,error:'',warning:''};
    session.photos.push(item);
    state.scanFile=session.photos[0]?.file||file;
    setScannerBusy(true);showUniversalRecognition();
    try{
      const codePromise=window.AssetCode?.scanFile?AssetCode.scanFile(file).catch(e=>{console.warn('Barcode not recognized',e);return null;}):Promise.resolve(null);
      let ocr;
      try{
        const image=await AssetImage.prepareForOcr(file);
        const answer=await AssetAPI.post('ocr',{image});ocr=answer.result;
      }catch(err){item.error='OCR unavailable: '+humanError(err)+'. Retake or enter manually.';}
      if(state.recognitionSession!==session)return;
      if(ocr?.text){
        item.ocr=ocr;item.observation=window.AssetRecognition.fromOcr(ocr,item.id);
        item.steps.ocr='done';
      }else item.steps.ocr='skipped';
      // Partial fields appear now, without waiting for Groq.
      item.steps.ai=ocr?.text && state.boot?.ai_ocr_enabled && isAuthenticated()?'busy':'skipped';
      showUniversalRecognition();
      if(item.steps.ai==='busy'){
        try{
          const r=await AssetAPI.post('interpretOcrUniversal',{text:ocr.text,base_fields_json:JSON.stringify(ocr.fields||{}),source_image:item.id});
          if(state.recognitionSession!==session)return;
          item.ai=r.result;
          item.observation=window.AssetRecognition.attachAi(item.observation,item.ai);
          item.steps.ai='done';
        }catch(err){item.steps.ai='skipped';item.warning='Groq unavailable; OCR fallback retained ('+humanError(err)+').';}
        showUniversalRecognition();
      }
      item.code=await codePromise;
      if(state.recognitionSession!==session)return;
      if(item.code && window.AssetCode?.extractAssetId?.(item.code.value)){
        // JCP Asset ID is meaningful; generic manufacturer barcodes are not serials.
        const codeValue=window.AssetCode.extractAssetId(item.code.value);
        item.observation=item.observation||window.AssetRecognition.fromOcr({text:'',fields:{}},item.id);
        item.observation.identifiers.push({type:'asset_id',value:codeValue,evidence:String(item.code.value),source_image:item.id,status:'supported'});
      }
      item.steps.matched='busy';showUniversalRecognition();
      await updateUniversalMatches();
      item.steps.matched='done';
    }finally{
      item.processing=false;if(state.recognitionSession===session){setScannerBusy(false);showUniversalRecognition();}
    }
  }
  async function renderCombinedRecognition(code,ocr,file,ocrError=''){
    setScannerStage('result');
    const f=ocr?.fields||{};
    const barcodeValue=String(code?.value||'').trim();
    const barcodeNorm=normalizeCodeValue(barcodeValue);
    const ocrSerial=String(f.serial||'').trim();
    const ocrNorm=normalizeCodeValue(ocrSerial);
    let resolvedSerial=ocrSerial;
    let conflict=false;
    let confidence='';

    // Manufacturer QR links identify support pages, NOT device serials.
    const barcodeIsIdentifier=/^[A-Z0-9-]{5,30}$/i.test(barcodeValue);
    if(barcodeIsIdentifier){
      if(!ocrSerial){resolvedSerial=barcodeValue;confidence='Barcode supplied identifier (confirm)';}
      else if(barcodeNorm===ocrNorm){resolvedSerial=ocrSerial;confidence='Barcode and OCR agree';}
      else {resolvedSerial=ocrSerial;conflict=true;confidence='Barcode and OCR disagree';}
    }

    let duplicate=null;
    if(resolvedSerial){
      try{const r=await AssetAPI.get('matchIdentifier',{value:resolvedSerial});duplicate=r.match?.found?r.match.asset:null;}catch(err){console.warn('Exact identifier lookup failed',err);}
    }

    let suggestions=[];
    if(!duplicate && (f.brand||f.model||f.category||resolvedSerial||f.specifications)){
      try{
        const r=await AssetAPI.get('suggestMatches',{
          brand:f.brand||'', model:f.model||'', category:f.category||'', serial:resolvedSerial||'', specifications:f.specifications||''
        });
        suggestions=Array.isArray(r.matches)?r.matches:[];
      }catch(err){console.warn('Candidate matching failed',err);}
    }

    state.lastRecognition={code,ocr,file,resolvedSerial,duplicate,suggestions};
    const badges=[];
    if(code)badges.push(`<span class="recognition-badge">${esc(String(code.format||'barcode').replaceAll('_',' '))}</span>`);
    if(ocr)badges.push('<span class="recognition-badge">OCR</span>');
    if(ocr?.ai_assisted)badges.push(`<span class="recognition-badge good">${esc(ocr.ai_provider||'Groq')} AI mapped · ${esc(ocr.ai_confidence||'review')} · review</span>`);
    else if(ocr)badges.push('<span class="recognition-badge warn">OCR rules only · AI not applied</span>');
    if(confidence&&!conflict)badges.push(`<span class="recognition-badge good">${esc(confidence)}</span>`);
    if(conflict)badges.push('<span class="recognition-badge danger">Serial conflict</span>');

    const suggestionHtml=!duplicate&&suggestions.length?`<div class="scan-match-zone"><div class="scan-match-heading"><div><b>Possible existing assets</b><small>Review these before creating a new record. Similarity never merges automatically.</small></div><span>${suggestions.length}</span></div>${suggestions.map((m,i)=>{const a=m.asset;const hasConflict=(m.conflicts||[]).length>0;return `<div class="scan-match-card ${hasConflict?'conflict':''}"><div class="scan-match-copy"><b>${esc(assetDisplayName(a))}</b><small>${esc(a.asset_id)} · ${esc(a.site_name||'No site')}${a.area_name?' · '+esc(a.area_name):''}</small><small>${esc((m.reasons||[]).join(' · ')||'possible match')}</small>${hasConflict?`<div class="data-conflict-note">Conflict with existing ${esc((m.conflicts||[]).join(', '))}. Review before linking.</div>`:''}</div><button class="btn light sm" data-reconcile-index="${i}">Review match</button></div>`;}).join('')}</div>`:'';
    const createLabel=suggestions.length?'Create New Anyway':'Review & Create Asset';
    const pendingTarget=state.scanUpdateTarget;
    const updateAction=pendingTarget?`<div class="scan-target-panel"><b>Updating ${esc(assetDisplayName(pendingTarget))}</b><small>${esc(pendingTarget.asset_id)} — compare recognized information with this record before saving.</small><button id="updateTargetFromScan" class="btn primary" type="button">Review changes for this asset</button><button id="cancelTargetScan" class="btn light sm" type="button">Cancel update mode</button></div>`:'';
    const aiPanel=ocr?.ai_assisted?`<details class="ai-explain" open><summary>AI mapping details — what Groq suggested</summary><p>AI results are suggestions, not confirmed facts. Values supported by OCR appear below; missing values are left blank.</p><div class="ai-field-diff">${['category','brand','model','serial','specifications'].map(k=>`<div><small>${esc(k)}</small><span>OCR: ${esc(ocr.ocr_fields?.[k]||'—')}</span><b>Groq: ${esc(ocr.ai_fields?.[k]||'—')}</b></div>`).join('')}</div></details>`:`<div class="scan-ai-note">AI field mapping was not applied to this scan. Results are from rule-based OCR; sign in and check Groq configuration if AI was expected.</div>`;
    const extraKeys=[['imei','IMEI'],['mac_address','MAC'],['hardware_version','Hardware version'],['firmware_version','Firmware'],['part_number','Part number'],['rating','Rating']];
    const extraFields=extraKeys.filter(([k])=>f[k]).map(([k,name])=>`<span>${name}</span><b>${esc(f[k])}</b>`).join('');

    $('scanResult').innerHTML=`<div class="result-card"><div class="recognition-badges">${badges.join('')}</div><strong>${code&&ocr?'Combined recognition':'Device recognition'}</strong><div class="result-grid"><span>Category suggestion</span><b>${esc(f.category||'Not detected')}</b><span>Brand</span><b>${esc(f.brand||'Not detected')}</b><span>Model</span><b>${esc(f.model||'Not detected')}</b><span>Serial</span><b>${esc(resolvedSerial||'Not detected')}</b><span>Specs</span><b>${esc(f.specifications||'Not detected')}</b>${extraFields}${barcodeValue?`<span>Barcode / QR value</span><b>${esc(barcodeValue)}</b>`:''}</div>${conflict?`<div class="scan-warning conflict-box"><b>Serial conflict.</b> Barcode detected <b>${esc(barcodeValue)}</b>, while OCR detected <b>${esc(ocrSerial)}</b>. Confirm the serial below before using it.</div>`:''}${ocrError?`<div class="scan-warning">OCR warning: ${esc(ocrError)}. Barcode result is still usable.</div>`:''}${ocr?.ai_warning?`<div class="scan-warning">${esc(ocr.ai_warning)}</div>`:''}<div class="serial-resolver"><label>Serial / identifier to use</label><input id="resolvedSerial" value="${esc(resolvedSerial)}" placeholder="Confirm or enter manually"></div>${duplicate?`<div class="scan-existing"><b>${esc(duplicate.asset_id)} already uses this serial</b><small>${esc(duplicate.brand)} ${esc(duplicate.model)} · ${esc(duplicate.site_name||'')} ${duplicate.area_name?'· '+esc(duplicate.area_name):''}</small></div>`:''}${suggestionHtml}${updateAction}${aiPanel}<div class="scan-match-primary"><b>Already in AssetHub?</b><small>Match and reconcile this scan with an existing record. No automatic merge.</small><button id="matchScanExisting" class="btn light" type="button">Find existing asset to reconcile</button></div>${ocr?`<details class="raw-ocr-disclosure"><summary>Raw OCR</summary><textarea class="ocr-raw" readonly>${esc(ocr.text||'')}</textarea></details>`:''}<div class="actions scan-result-actions" style="margin-top:10px">${duplicate?'<button id="openDuplicateAsset" class="btn blue sm">Open Existing Asset</button><button id="reconcileDuplicateAsset" class="btn light sm">Reconcile this scan</button>':`<button id="createFromRecognition" class="btn primary sm">${createLabel}</button>`}<button id="scanAgain2" class="btn light sm">Scan again</button></div></div>`;

    $('updateTargetFromScan')?.addEventListener('click',()=>withBusy($('updateTargetFromScan'),'Loading asset…',async()=>{
      const t=state.scanUpdateTarget;if(!t)return;
      const incoming={category:f.category||'',brand:f.brand||'',model:f.model||'',serial:$('resolvedSerial')?.value.trim()||resolvedSerial||'',specifications:f.specifications||''};
      state.scanUpdateTarget=null;
      await openScanReconcile(t,incoming,file);
    }));
    $('cancelTargetScan')?.addEventListener('click',()=>{state.scanUpdateTarget=null;renderCombinedRecognition(code,ocr,file,ocrError);});
    $('openDuplicateAsset')?.addEventListener('click' ,()=>openAsset(duplicate.asset_id));
    $('reconcileDuplicateAsset')?.addEventListener('click',()=>withAccess('STAFF',()=>openScanReconcile(duplicate,{category:f.category||'',brand:f.brand||'',model:f.model||'',serial:$('resolvedSerial')?.value.trim()||resolvedSerial||'',specifications:f.specifications||''},file)));
    $('matchScanExisting')?.addEventListener('click',()=>withAccess('STAFF',()=>withBusy($('matchScanExisting'),'Opening match…',()=>openScanMatchPicker({category:f.category||'',brand:f.brand||'',model:f.model||'',serial:$('resolvedSerial')?.value.trim()||resolvedSerial||'',specifications:f.specifications||''},file))));
    $$('[data-reconcile-index]').forEach(btn=>btn.addEventListener('click',()=>{
      const m=suggestions[Number(btn.dataset.reconcileIndex)];
      if(!m)return;
      withAccess('STAFF',()=>withBusy(btn,'Loading match…',()=>openScanReconcile(m.asset,{category:f.category||'',brand:f.brand||'',model:f.model||'',serial:$('resolvedSerial')?.value.trim()||resolvedSerial||'',specifications:f.specifications||''},file)));
    }));
    $('createFromRecognition')?.addEventListener('click',()=>{
      const serial=$('resolvedSerial')?.value.trim()||'';
      if(suggestions.length&&!confirm('Possible existing assets were found. Create a separate new asset anyway?'))return;
      openAssetForm({category_name:f.category,brand:f.brand,model:f.model,serial:serial,specifications:f.specifications,_scanFile:file});
    });
    $('scanAgain2')?.addEventListener('click',resetScannerResult);

    if(duplicate && state.activeAuditId){
      try{await verifyAudit(state.activeAuditId,duplicate.asset_id,'Scanned in audit mode');state.activeAuditId='';}catch(err){console.warn('Audit verification from scan failed',err);}
    }
  }

  async function openScanMatchPicker(incoming,scanFile){
    if(!state.assets.length)await loadAssets(true);
    openModal('Match Scan to Existing Asset',`<div class="login-note">Search for the device already in AssetHub. Choosing a device opens a comparison; it never changes or merges records automatically.</div><div class="field"><label>Find an asset</label><input id="scanMatchSearch" placeholder="Asset ID, brand, model, serial, site" autocomplete="off"></div><div id="scanMatchOptions" class="scan-match-choices"></div>`,()=>{
      const search=$('scanMatchSearch'), list=$('scanMatchOptions');
      const draw=()=>{
        const q=search.value.trim().toLowerCase();
        const matches=(state.assets||[]).filter(x=>x.status!=='Merged'&&x.status!=='Retired'&&(!q||[x.asset_id,x.brand,x.model,x.serial,x.site_name,x.area_name].join(' ').toLowerCase().includes(q))).slice(0,20);
        list.innerHTML=matches.length?matches.map(x=>`<button class="scan-match-choice" data-match-pick="${esc(x.asset_id)}" type="button"><b>${esc(x.brand||'Unknown')} ${esc(x.model||'')}</b><small>${esc(x.asset_id)} · ${esc(x.site_name||'No site')} · ${esc(x.serial||'No serial')}</small></button>`).join(''):'<div class="empty-state compact">No matching assets. Check spelling or create a new record.</div>';
        list.querySelectorAll('[data-match-pick]').forEach(el=>el.addEventListener('click',()=>{
          const picked=matches.find(x=>String(x.asset_id)===el.dataset.matchPick);
          if(picked)openScanReconcile(picked,incoming,scanFile);
        }));
      };
      search.addEventListener('input',draw);draw();
    },{size:'md'});
  }

  function compareValue(a,b){return String(a||'').trim().toLowerCase()===String(b||'').trim().toLowerCase();}
  function fieldLabel(key){return ({category:'Category',brand:'Brand',model:'Model',serial:'Serial',specifications:'Specifications',exact_location:'Exact location',assigned_to:'Assigned to'})[key]||key;}

  async function openScanReconcile(existing,incoming,scanFile){
    const scanFiles=Array.isArray(scanFile)?scanFile:(scanFile?[scanFile]:[]);
    let full;
    try{full=await fetchAssetDetail(existing.asset_id,{label:'Loading latest asset…'});}
    catch(err){toast('Could not load the latest asset record: '+humanError(err),'error');return;}
    if(!full){toast('Unable to compare: the asset record is unavailable.','error');return;}
    const fields=['category','brand','model','serial','specifications'];
    const changed=fields.filter(key=>{
      const current=key==='category'?(full.category_name||full.category||''):full[key]||'';
      const next=incoming[key]||'';
      return !!next&&!compareValue(current,next);
    });
    const rows=changed.map(key=>{
      const current=key==='category'?(full.category_name||full.category||''):full[key]||'';
      const next=incoming[key]||'';
      const conflict=!!current&&!!next&&!compareValue(current,next);
      const willFill=!current&&!!next;
      const combine=key==='specifications'&&conflict;
      return `<div class="reconcile-row ${conflict?'has-conflict':''}"><div class="reconcile-label"><b>${esc(fieldLabel(key))}</b>${conflict?'<span>CONFLICT</span>':willFill?'<span class="fill">NEW</span>':''}</div><div class="reconcile-values"><label><input type="radio" name="choice_${esc(key)}" value="existing" ${conflict&&!combine?'checked':(!willFill&&!combine?'checked':'')}> <span><small>Keep existing</small><b>${esc(current||'—')}</b></span></label><label><input type="radio" name="choice_${esc(key)}" value="incoming" ${willFill?'checked':''}> <span><small>Use scanned</small><b>${esc(next||'—')}</b></span></label>${combine?`<label><input type="radio" name="choice_specifications" value="combine" checked> <span><small>Safely add new specification keys</small><b>Keep existing values; append only new attribute labels</b></span></label>`:''}</div>${conflict?`<div class="data-conflict-note">${combine?'Choose whether to keep, replace, or append non-conflicting specifications.':'Existing and scanned values differ. Explicitly choose the correct value.'}</div>`:''}</div>`;
    }).join('') || '<div class="scan-ai-note">No new or changed fields were detected. You can still attach the scan photos for evidence.</div>';
    openModal('Reconcile Existing Asset',`<form id="reconcileForm"><div class="reconcile-intro"><b>${esc(full.asset_id)} · ${esc(full.brand||'')} ${esc(full.model||'')}</b><span>This updates the existing record instead of creating a duplicate.</span></div>${rows}<div class="modal-actions"><button type="button" id="reconcileCancel" class="btn light">Cancel</button><button type="submit" class="btn blue">Link Scan to Asset</button></div></form>`,()=>{
      $('reconcileCancel').addEventListener('click',closeModal);
      $('reconcileForm').addEventListener('submit',async e=>{
        e.preventDefault(); const btn=e.target.querySelector('[type=submit]');
        const choices={}; fields.forEach(k=>{choices[k]=e.target.querySelector(`[name="choice_${k}"]:checked`)?.value||'existing';});
        await withBusy(btn,'Updating...',async()=>{
          try{
            const r=await AssetAPI.post('reconcileAsset',{asset_id:full.asset_id,incoming_json:JSON.stringify(incoming),choices_json:JSON.stringify(choices)});
            cacheAssetDetail(r.asset);
            for(const img of scanFiles){try{await uploadAssetImage(full.asset_id,img,'serial_label');}catch(err){console.warn('Reconcile image upload failed',err);}}
            if(scanFiles.length)invalidateAssetDetail(r.asset.asset_id); toast('Existing asset updated from scan.'); closeModal(); scheduleSync('asset-reconciled',6500); openAsset(r.asset.asset_id,{force:!!scanFiles.length});
          }catch(err){toast(humanError(err),'error');}
        });
      });
    },{size:'lg'});
  }

  async function openManualMerge(source){
    if(!state.assets.length)await loadAssets(true);
    const choices=state.assets.filter(a=>a.asset_id!==source.asset_id&&a.status!=='Merged').sort((a,b)=>`${a.brand} ${a.model}`.localeCompare(`${b.brand} ${b.model}`));
    openModal('Merge Assets',`<div class="merge-step"><div class="merge-source"><small>Source record</small><b>${esc(source.asset_id)} · ${esc(source.brand||'')} ${esc(source.model||'')}</b><span>This source record will be marked as merged after consolidation.</span></div><div class="field"><label>Merge into</label><input id="mergeTargetInput" list="mergeTargetOptions" placeholder="Type asset ID, brand or model"><datalist id="mergeTargetOptions">${choices.map(a=>`<option value="${esc(a.asset_id)}">${esc(a.brand||'')} ${esc(a.model||'')} · ${esc(a.site_name||'')} ${esc(a.area_name||'')}</option>`).join('')}</datalist></div><div id="mergeCompare"></div><div class="modal-actions"><button type="button" id="mergeCancel" class="btn light">Cancel</button><button type="button" id="mergeCompareBtn" class="btn blue">Compare Records</button></div></div>`,()=>{
      $('mergeCancel').addEventListener('click',closeModal);
      $('mergeCompareBtn').addEventListener('click',async()=>{
        const targetId=$('mergeTargetInput').value.trim();
        if(!targetId||targetId===source.asset_id)return toast('Choose a different target asset.','error');
        const btn=$('mergeCompareBtn'); await withBusy(btn,'Loading...',async()=>{
          try{const target=await fetchAssetDetail(targetId,{label:'Loading comparison…'});renderMergeComparison(source,target);}catch(err){toast(humanError(err),'error');}
        });
      });
    },{size:'lg'});
  }

  function renderMergeComparison(source,target){
    const fields=['category','brand','model','serial','specifications','exact_location','assigned_to'];
    const val=(a,k)=>k==='category'?(a.category_name||a.category||''):(a[k]||'');
    const conflictFields=[];
    const rows=fields.map(k=>{
      const sv=val(source,k),tv=val(target,k); const conflict=!!sv&&!!tv&&!compareValue(sv,tv); if(conflict)conflictFields.push(k);
      const sourceWins=!tv&&!!sv;
      return `<div class="reconcile-row ${conflict?'has-conflict':''}"><div class="reconcile-label"><b>${esc(fieldLabel(k))}</b>${conflict?'<span>CONFLICT</span>':sourceWins?'<span class="fill">FILL</span>':''}</div><div class="reconcile-values"><label><input type="radio" name="merge_${esc(k)}" value="target" ${!sourceWins?'checked':''}> <span><small>Keep target</small><b>${esc(tv||'—')}</b></span></label><label><input type="radio" name="merge_${esc(k)}" value="source" ${sourceWins?'checked':''}> <span><small>Use source</small><b>${esc(sv||'—')}</b></span></label></div>${conflict?'<div class="data-conflict-note">Both records contain different data. Confirm the value to keep.</div>':''}</div>`;
    }).join('');
    $('mergeCompare').innerHTML=`<div class="merge-target"><small>Target record kept</small><b>${esc(target.asset_id)} · ${esc(target.brand||'')} ${esc(target.model||'')}</b></div>${conflictFields.length?`<div class="merge-conflict-banner"><b>${conflictFields.length} conflict${conflictFields.length===1?'':'s'} found</b><span>Red rows require review before merging.</span></div>`:''}<form id="mergeCommitForm">${rows}<div class="modal-actions"><button type="button" id="mergeBackBtn" class="btn light">Choose Another</button><button type="submit" class="btn danger">Merge into ${esc(target.asset_id)}</button></div></form>`;
    $('mergeCompareBtn').classList.add('hidden'); $('mergeTargetInput').disabled=true;
    $('mergeBackBtn').addEventListener('click',()=>{$('mergeCompare').innerHTML='';$('mergeTargetInput').disabled=false;$('mergeTargetInput').value='';$('mergeCompareBtn').classList.remove('hidden');});
    $('mergeCommitForm').addEventListener('submit',async e=>{
      e.preventDefault();
      if(!confirm(`Merge ${source.asset_id} into ${target.asset_id}? The source will be marked Merged and linked records will move to the target.`))return;
      const mergeChoices={}; fields.forEach(k=>mergeChoices[k]=e.target.querySelector(`[name="merge_${k}"]:checked`)?.value||'target');
      const btn=e.target.querySelector('[type=submit]');
      await withBusy(btn,'Merging...',async()=>{
        try{const r=await AssetAPI.post('mergeAssets',{source_asset_id:source.asset_id,target_asset_id:target.asset_id,choices_json:JSON.stringify(mergeChoices)});state.assets=removeByIds(state.assets,[r.result.source_asset_id],'asset_id');state.maintenance=(state.maintenance||[]).map(m=>String(m.asset_id)===String(r.result.source_asset_id)?decorateMaintenanceLocal({...m,asset_id:r.result.target_asset_id,asset:null}):m);invalidateAssetDetail(r.result.source_asset_id);cacheAssetDetail(r.result.target);window.AssetStore?.set?.(STORE_KEYS.maintenance,state.maintenance);toast('Assets merged.');closeModal();closeDrawer();cacheRemove(CACHE_ASSETS);scheduleSync('assets-merged',20);openAsset(r.result.target_asset_id);}catch(err){toast(humanError(err),'error');}
      });
    });
  }

  async function refreshAll(){
    renderCurrentData();
    scheduleSync('change',20);
    return true;
  }
  async function renderDashboardAfterRefresh(){ scheduleSync('dashboard',20); }

  function monitorOnline(){ const paint=()=>{$('offlineBar').classList.toggle('hidden',navigator.onLine);};window.addEventListener('online',()=>{paint();backgroundSync('online',{force:true});});window.addEventListener('offline',paint);paint(); }
  async function checkRemoteVersion(){
    try{const r=await fetch(`./version.json?t=${Date.now()}`,{cache:'no-store'});const v=await r.json();state.latestVersion=v;const available=!!v.version&&v.version!==APP_VERSION;$('updateBtn').classList.toggle('hidden',!available);if(available)$('updateBtn').title=`Update ${APP_VERSION} → ${v.version}`;}
    catch(err){console.warn('Version check failed',err);}
  }
  async function applyAppUpdate(){
    const btn=$('updateBtn');
    await withBusy(btn,'Updating...',async()=>{
      try{
        if('serviceWorker' in navigator){const reg=await navigator.serviceWorker.getRegistration();if(reg){await reg.update();if(reg.waiting)reg.waiting.postMessage({type:'SKIP_WAITING'});}}
        if('caches' in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('jcp-assethub-')).map(k=>caches.delete(k)));}
        const u=new URL(location.href);u.searchParams.set('_updated',Date.now());location.replace(u.toString());
      }catch(err){toast('Update failed: '+humanError(err),'error');}
    });
  }
  function registerServiceWorker(){
    if(!('serviceWorker' in navigator)||!location.protocol.startsWith('http'))return;
    navigator.serviceWorker.register('./service-worker.js').then(reg=>{
      const reveal=()=>{if(reg.waiting){$('updateBtn')?.classList.remove('hidden');$('updateBtn').title='A new AssetHub version is ready';}};
      reveal();
      reg.addEventListener('updatefound',()=>{
        const worker=reg.installing;if(!worker)return;
        worker.addEventListener('statechange',()=>{if(worker.state==='installed'&&navigator.serviceWorker.controller)reveal();});
      });
    }).catch(err=>console.warn('Service worker failed',err));
  }

  init();
})();
