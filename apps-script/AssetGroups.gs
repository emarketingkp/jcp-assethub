/* Additive equipment-set and multiple-unit operations. No advanced services/scopes. */
function setupAssetGrouping() {
  validateConfig_();
  const ss=getSpreadsheet_();
  ensureSheet_(ss,SHEETS.ASSETS,SCHEMA.Assets);
  ensureSheet_(ss,SHEETS.ASSET_BATCHES,SCHEMA.AssetBatches);
  invalidateDataCache_();
  return 'Main-asset reference and retry ledger ready. Legacy set data retained. Deploy both Code.gs and AssetGroups.gs.';
}

function groupingFeatures_() {
  try {
    const ss=getSpreadsheet_(),assets=ss.getSheetByName(SHEETS.ASSETS),ledger=ss.getSheetByName(SHEETS.ASSET_BATCHES);
    if(!assets||!ledger)return {asset_groups:0};
    const assetHeaders=new Set(headers_(assets)),ledgerHeaders=new Set(headers_(ledger));
    const ready=['set_id','set_name'].every(k=>assetHeaders.has(k))&&SCHEMA.AssetBatches.every(k=>ledgerHeaders.has(k));return {asset_groups:ready?1:0,sequential_saves:ready&&assetHeaders.has('parent_asset_id')?1:0,asset_links:ready&&assetHeaders.has('parent_asset_id')?1:0};
  } catch(_){return {asset_groups:0};}
}

function groupText_(value,max,label) {
  if(value!=null&&typeof value!=='string')throw new Error(label+' must be text.');
  const s=String(value||'').trim();if(s.length>max)throw new Error(label+' is too long.');return s;
}

function normalizedBatch_(json) {
  if(typeof json!=='string'||json.length>32768||encodeURIComponent(json).replace(/%[A-F\d]{2}/gi,'x').length>32768)throw new Error('Batch exceeds the 32 KiB limit. Use a smaller batch.');
  let p;try{p=JSON.parse(json);}catch(_){throw new Error('Invalid batch data.');}
  if(!p||!['same','set','attach','detach','rename'].includes(p.mode)||!Array.isArray(p.units)||p.units.length<1||p.units.length>(p.mode==='rename'?250:25))throw new Error('Use up to 25 items per batch (250 existing components for a complete-set rename).');
  const product=r=>({category:groupText_(r.category,100,'Category'),category_id:groupText_(r.category_id,80,'Category ID'),brand:groupText_(r.brand,120,'Brand'),model:groupText_(r.model,160,'Model'),specifications:groupText_(r.specifications,2000,'Specifications')});
  const c=p.common||{};
  const common=Object.assign(product(c),{site_id:groupText_(c.site_id,80,'Site'),area:groupText_(c.area,120,'Area'),exact_location:groupText_(c.exact_location,160,'Location'),assigned_to:groupText_(c.assigned_to,160,'Assignment')});
  common.status=groupText_(c.status,30,'Status')||'Active';if(!['Active','Spare','Faulty','Under Repair','Missing'].includes(common.status))throw new Error('Choose a supported status for the new items.');
  if(p.mode==='same'&&p.units.length>1&&/^\s*(?:serial(?:\s+(?:number|no\.?))?|s\s*\/\s*n|imei\s*2?|mac(?:\s+address)?|service\s+tag|jcp\s+asset\s+id|asset\s+id|host\s*name|device\s+(?:id|name)|uuid|license\s+key)\s*[:=#]/im.test(common.specifications))throw new Error('Unique device identifiers cannot be shared across new units. Enter each serial in its own row; add other unit identifiers in individual asset details.');
  const custom=Object.create(null);if(c.custom&&typeof c.custom==='object'&&!Array.isArray(c.custom))Object.keys(c.custom).sort().forEach(k=>{if(!/^[A-Za-z0-9_-]{1,80}$/.test(k)||['__proto__','constructor','prototype'].includes(k))throw new Error('Invalid custom field.');custom[k]=groupText_(c.custom[k],1000,'Custom value');});common.custom=custom;
  const seen=Object.create(null);
  const units=p.units.map((r,index)=>{
    if(!r||typeof r!=='object'||r.asset_id)throw new Error('Choose an existing item explicitly; do not copy its JCP ID into a new item.');
    if(r.existing_asset_id){
      const id=groupText_(r.existing_asset_id,80,'Existing asset ID');if(seen[id])throw new Error('The same existing asset was selected twice.');seen[id]=true;
      if(p.mode==='same')throw new Error('Use the set workflow to link existing items.');
      return {existing_asset_id:id,expected_updated_at:groupText_(r.expected_updated_at,50,'Review timestamp')};
    }
    if(['attach','detach','rename'].includes(p.mode))throw new Error('This operation only accepts existing assets.');
    const row=Object.assign(p.mode==='same'?product(common):product(r),{serial:groupText_(r.serial,80,'Serial')});
    if(!row.category&&!row.category_id)throw new Error('Item '+(index+1)+': category is required.');return row;
  });
  const result={mode:p.mode,set_id:groupText_(p.set_id,60,'Set ID'),set_name:groupText_(p.set_name,100,'Set name'),common:common,units:units};
  if(p.parent_asset_id){if(!['set','attach'].includes(p.mode))throw new Error('Parent links require a set operation.');result.parent_asset_id=groupText_(p.parent_asset_id,80,'Parent asset ID');}
  if(result.set_id&&!/^SET-[A-Za-z0-9-]{10,50}$/.test(result.set_id))throw new Error('Invalid set ID.');
  if(result.mode==='same'&&(result.set_id||result.set_name))throw new Error('Same-model items are grouped by their product details, not a physical set.');
  if(['attach','detach','rename'].includes(result.mode)&&!result.set_id&&result.mode!=='attach')throw new Error('Choose a set.');
  return result;
}

function batchCustom_(common,hasNew) {
  if(!hasNew)return;
  const defs=activeOnly_(listObjects_(SHEETS.CUSTOM_FIELDS));
  Object.keys(common.custom).forEach(id=>{if(!defs.some(d=>d.field_id===id))throw new Error('Unknown custom field: '+id);});
  defs.forEach(d=>{
    const v=common.custom[d.field_id]||'';
    if(truthy_(d.required)&&!v)throw new Error('Required custom information: '+d.label);
    if(v&&d.field_type==='number'&&!isFinite(Number(v)))throw new Error('Invalid number: '+d.label);
    if(v&&d.field_type==='boolean'&&!['Yes','No'].includes(v))throw new Error('Invalid choice: '+d.label);
    if(v&&d.field_type==='date'&&!/^\d{4}-\d{2}-\d{2}$/.test(v))throw new Error('Invalid date: '+d.label);
    if(v&&d.field_type==='select'){let choices;try{choices=JSON.parse(d.options_json||'[]');}catch(_){throw new Error('Invalid custom field configuration.');}if(!Array.isArray(choices)||!choices.map(String).includes(v))throw new Error('Invalid choice: '+d.label);}
  });
}

function batchSerials_(payload,rows,ownIds) {
  const seen=new Set();
  payload.units.forEach(u=>{
    if(u.existing_asset_id)return;
    const key=normalizeIdentifier_(u.serial);if(!key)return;
    if(seen.has(key))throw new Error('DUPLICATE_SERIAL: Different units cannot share a serial. Put shared model/part codes in specifications instead.');seen.add(key);
    const duplicate=rows.find(r=>!ownIds.has(String(r.asset_id))&&normalizeIdentifier_(r.serial)===key);
    if(duplicate)throw new Error('DUPLICATE_SERIAL: '+u.serial+' already belongs to '+duplicate.asset_id+'. Choose the existing item.');
    if(reservedAssetOperations_().some(r=>!ownIds.has(r.asset_id)&&normalizeIdentifier_(r.serial)===key))throw new Error('DUPLICATE_SERIAL: A pending save reserved this serial. Reconcile that save first.');
  });
}

function resolveBatchProducts_(p) {
  const hasNew=p.units.some(u=>!u.existing_asset_id),common=p.common;
  batchCustom_(common,hasNew);
  if(!hasNew)return {site:null,area:null,categories:[]};
  const site=findByKey_(SHEETS.SITES,'site_id',common.site_id);
  if(!site||!truthy_(site.active)||!common.area)throw new Error('Choose an active site and enter an area for the new items.');
  const area=resolveArea_('',common.area,site.site_id,{role:'STAFF'},false);
  // Unknown category names stay plain text; validation never creates reference rows.
  const categories=p.units.map(u=>u.existing_asset_id?null:resolveCategory_(u.category_id,u.category,{role:'STAFF'}));
  return {site:site,area:area,categories:categories};
}

function validateBatchMembers_(p,rows,plan,resuming) {
  const chosen=new Set(p.units.filter(u=>u.existing_asset_id).map(u=>u.existing_asset_id));
  const setMembers=rows.filter(r=>r.set_id===plan.set_id&&r.status!=='Merged');
  if(p.parent_asset_id){
    const parent=rows.find(r=>r.asset_id===p.parent_asset_id&&r.status!=='Merged'&&r.status!=='Retired');
    if(!parent||parent.set_id!==plan.set_id&&!chosen.has(parent.asset_id))throw new Error('PARENT_NOT_READY: Choose a confirmed member of this set.');
    for(const id of chosen){if(id===p.parent_asset_id)continue;let ancestor=parent,seen=new Set();while(ancestor){if(ancestor.asset_id===id||seen.has(ancestor.asset_id))throw new Error('Linked assets cannot form a cycle.');seen.add(ancestor.asset_id);ancestor=rows.find(r=>r.asset_id===ancestor.parent_asset_id);}}
  }
  if(p.mode==='detach'&&rows.some(r=>chosen.has(r.parent_asset_id)&&!chosen.has(r.asset_id)&&r.status!=='Merged'))throw new Error('Remove linked components before removing their parent from the set.');
  if(p.mode==='rename'&&(setMembers.length!==chosen.size||setMembers.some(r=>!chosen.has(String(r.asset_id)))))throw new Error('Set membership changed. Reload and review every component before renaming.');
  p.units.forEach(u=>{
    if(!u.existing_asset_id)return;
    assertNoPendingAssetOperation_(u.existing_asset_id);
    const r=rows.find(a=>String(a.asset_id)===u.existing_asset_id);
    if(!r||r.status==='Merged'||(!['detach','rename'].includes(p.mode)&&r.status==='Retired'))throw new Error('Existing item unavailable: '+u.existing_asset_id);
    const desired=p.mode==='detach'?'':plan.set_id;
    const applied=resuming&&String(r.set_id||'')===desired&&String(r.set_name||'')===(desired?plan.set_name:'');
    if(!applied&&String(r.updated_at||'')!==u.expected_updated_at)throw new Error('ITEM_CHANGED: '+r.asset_id+' changed since review. Reload before grouping.');
    if(p.mode==='detach'){
      if(r.set_id&&r.set_id!==p.set_id)throw new Error('Item belongs to a different set.');
      if(!resuming&&!r.set_id)throw new Error('Item is no longer in this set.');
    }else if(r.set_id&&r.set_id!==plan.set_id)throw new Error(r.asset_id+' already belongs to '+(r.set_name||r.set_id)+'. Remove it from that set first.');
  });
}

function batchPlan_(p,rows,ledgerRows) {
  const now=new Date().toISOString(),setMembers=p.set_id?rows.filter(r=>r.set_id===p.set_id&&r.status!=='Merged'):[];
  if(p.set_id&&!setMembers.length)throw new Error('Set no longer exists. Reload before continuing.');
  let setId=p.set_id,setName=p.set_name;
  if(p.mode!=='same'&&p.mode!=='detach'){
    if(!setId){if(!setName)throw new Error('Give this equipment set a name.');setId='SET-'+shortId_()+shortId_();}
    else if(p.mode!=='rename'){
      setName=clean_(setMembers[0].set_name);if(!setName)throw new Error('Set name is missing. Repair it before adding items.');
      if(p.set_name&&p.set_name!==setName)throw new Error('Set name changed. Reload it before adding items.');
    }
    if(!setName)throw new Error('Set name is required.');
    if(rows.some(r=>r.status!=='Merged'&&r.set_id&&r.set_id!==setId&&clean_(r.set_name).toLowerCase()===setName.toLowerCase()))throw new Error('An equipment set with this name already exists. Choose that set instead of creating a second one.');
  }
  const products=resolveBatchProducts_(p),used=new Set(rows.map(r=>String(r.asset_id)));
  ledgerRows.filter(r=>r.state!=='complete').forEach(r=>{let existing;try{existing=JSON.parse(r.plan_json);}catch(_){throw new Error('Retry ledger contains invalid data. Ask an administrator to inspect it.');}(existing.ids||[]).forEach(id=>used.add(id));});
  const ids=p.units.map((u,i)=>{
    if(u.existing_asset_id)return u.existing_asset_id;
    const base=nextAssetId_(products.categories[i].prefix||'AS');let id=base;
    while(used.has(id)){const m=id.match(/^(.*-)(\d+)$/);id=m[1]+String(Number(m[2])+1).padStart(4,'0');}used.add(id);return id;
  });
  const before=p.units.map(u=>{const r=rows.find(a=>a.asset_id===u.existing_asset_id);return r?{set_id:r.set_id||'',set_name:r.set_name||'',updated_at:r.updated_at||''}:null;});
  const plan={ids:ids,set_id:setId||'',set_name:setName||'',created_at:now,before:before,reservations:ids.map((id,i)=>({asset_id:id,serial:p.units[i].serial||''}))};
  if(JSON.stringify(plan).length>45000)throw new Error('This set change exceeds the spreadsheet retry-record limit. Ask an administrator to review the oversized set.');
  return plan;
}

function groupSheetValue_(value) {
  // Range.setValues interprets '=' strings as formulas. Keep user text literal.
  return typeof value==='string'&&/^\s*=/.test(value)?"'"+value:value;
}

function appendBatchRows_(name,objects) {
  if(!objects.length)return;
  const sheet=getSheet_(name),h=headers_(sheet),start=sheet.getLastRow()+1;
  const range=sheet.getRange(start,1,objects.length,h.length);
  // Exact serial/ID strings, including zeros and long numeric codes, on NEW rows only.
  try{range.setNumberFormat('@');range.setValues(objects.map(o=>h.map(k=>groupSheetValue_(o[k]==null?'':o[k]))));}
  finally{clearRequestCache_(name);}
}

function writeSetColumns_(ids,patch) {
  if(!ids.length)return;
  const sheet=getSheet_(SHEETS.ASSETS),values=sheet.getDataRange().getValues(),headers=values[0].map(String),wanted=new Set(ids);
  const a1col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
  const rowNumbers=[];values.slice(1).forEach((row,i)=>{if(wanted.has(String(row[headers.indexOf('asset_id')])))rowNumbers.push(i+2);});
  if(rowNumbers.length!==wanted.size)throw new Error('An item disappeared before the set could be saved.');
  try{Object.keys(patch).forEach(key=>{const col=headers.indexOf(key);if(col<0)throw new Error('Grouping column missing; run setupAssetGrouping.');sheet.getRangeList(rowNumbers.map(row=>a1col(col)+row)).setValue(groupSheetValue_(patch[key]));});}
  finally{clearRequestCache_(SHEETS.ASSETS);}
}

function batchResult_(requestId,plan) {
  const rows=listObjects_(SHEETS.ASSETS),categories=objectMap_(listObjects_(SHEETS.CATEGORIES),'category_id'),sites=objectMap_(listObjects_(SHEETS.SITES),'site_id'),areas=objectMap_(listObjects_(SHEETS.AREAS),'area_id');
  return {request_id:requestId,set_id:plan.set_id,set_name:plan.set_name,assets:plan.ids.map(id=>rows.find(r=>String(r.asset_id)===id)).filter(Boolean).map(r=>decorateAsset_(r,categories,sites,areas,{}))};
}

function saveAssetBatch_(params,user) {
  requireRole_(user,'STAFF');
  if(!groupingFeatures_().asset_groups)throw new Error('GROUPING_NOT_READY: Run setupAssetGrouping and deploy both backend files.');
  if(params.confirmed!=='true')throw new Error('Review and confirm the individual items first.');
  const requestId=groupText_(params.request_id,80,'Request ID');if(!/^[A-Za-z0-9-]{16,80}$/.test(requestId))throw new Error('Invalid request ID.');
  const actor=actorKey_(user);
  const lock=LockService.getScriptLock();lock.waitLock(10000);
  let started=false;
  try {
    clearRequestCache_();
    const ledgers=listObjects_(SHEETS.ASSET_BATCHES),prior=ledgers.find(r=>r.request_id===requestId);
    started=!!prior;
    const p=normalizedBatch_(params.batch_json),fingerprint=hash_(JSON.stringify(p));
    if(prior&&(prior.actor!==actor||prior.fingerprint!==fingerprint))throw new Error('REQUEST_REUSED: This request belongs to a different actor or different reviewed items.');
    let rows=listObjects_(SHEETS.ASSETS),plan=prior?JSON.parse(prior.plan_json):batchPlan_(p,rows,ledgers);
    if(!prior&&rows.some(r=>String(r.source_ref||'').indexOf('batch:'+requestId+':')===0)){started=true;throw new Error('BATCH_LEDGER_MISSING: Existing items already reference this request. Restore its retry record; do not recreate the batch.');}
    if(prior&&prior.state==='complete')return batchResult_(requestId,plan);
    const ownIds=new Set(plan.ids.filter((id,i)=>!p.units[i].existing_asset_id));
    batchSerials_(p,rows,ownIds);validateBatchMembers_(p,rows,plan,!!prior);
    const products=resolveBatchProducts_(p);
    if(!prior){started=true;appendBatchRows_(SHEETS.ASSET_BATCHES,[{request_id:requestId,actor:actor,fingerprint:fingerprint,plan_json:JSON.stringify(plan),state:'prepared',created_at:plan.created_at,updated_at:plan.created_at}]);}
    const newRows=[],writeTime=new Date().toISOString();
    p.units.forEach((unit,i)=>{
      if(unit.existing_asset_id)return;
      const id=plan.ids[i],source='batch:'+requestId+':'+i,existing=rows.find(r=>String(r.asset_id)===id);
      if(existing){if(existing.source_ref!==source)throw new Error('Reserved JCP ID is already occupied. No record was overwritten.');return;}
      const category=products.categories[i],site=products.site,area=products.area;
      newRows.push({asset_id:id,category_id:category.category_id,category:category.name,brand:unit.brand,model:unit.model,serial:unit.serial,specifications:unit.specifications,
        site_id:site.site_id,site:site.name,area_id:area?area.area_id:'',area:area?area.name:p.common.area,exact_location:p.common.exact_location,assigned_to:p.common.assigned_to,status:p.common.status,main_image_id:'',drive_folder_id:'',created_at:plan.created_at,updated_at:writeTime,created_by:actor,updated_by:actor,retired_at:'',source_ref:source,set_id:p.mode==='set'?plan.set_id:'',set_name:p.mode==='set'?plan.set_name:'',parent_asset_id:p.parent_asset_id||''});
    });
    appendBatchRows_(SHEETS.ASSETS,newRows);
    const customRows=listObjects_(SHEETS.CUSTOM_VALUES),pendingCustom=[];
    plan.ids.forEach((id,i)=>{if(p.units[i].existing_asset_id)return;Object.keys(p.common.custom).forEach(field=>{if(!customRows.some(r=>r.asset_id===id&&r.field_id===field))pendingCustom.push({asset_id:id,field_id:field,value:p.common.custom[field],updated_at:plan.created_at,updated_by:actor});});});
    appendBatchRows_(SHEETS.CUSTOM_VALUES,pendingCustom);
    const existingIds=p.units.filter(u=>u.existing_asset_id).map(u=>u.existing_asset_id);
    writeSetColumns_(existingIds,{set_id:p.mode==='detach'?'':plan.set_id,set_name:p.mode==='detach'?'':plan.set_name,updated_at:writeTime,updated_by:actor});
    if(p.mode==='detach'&&groupingFeatures_().sequential_saves)writeSetColumns_(existingIds,{parent_asset_id:''});
    else if(p.parent_asset_id)writeSetColumns_(existingIds.filter(id=>id!==p.parent_asset_id),{parent_asset_id:p.parent_asset_id});
    const activity=listObjects_(SHEETS.ACTIVITY),pendingLogs=[],finalRows=listObjects_(SHEETS.ASSETS);
    plan.ids.forEach((id,i)=>{
      const action=p.units[i].existing_asset_id?'SET_MEMBERSHIP':'CREATE_ASSET_BATCH';
      if(activity.some(r=>{if(r.asset_id!==id||r.action!==action)return false;try{return JSON.parse(r.details).request_id===requestId;}catch(_){return r.details==='batch:'+requestId;}}))return;
      const summary=p.mode==='same'?'Added with shared product details':p.mode==='detach'?'Removed from equipment set':p.mode==='rename'?'Equipment set renamed':p.units[i].existing_asset_id?'Linked to equipment set':'Added to equipment set';
      pendingLogs.push({timestamp:plan.created_at,user:actor,role:user.role,action:action,asset_id:id,before_json:plan.before[i]?JSON.stringify(plan.before[i]):'',after_json:JSON.stringify(p.units[i].existing_asset_id?{set_id:p.mode==='detach'?'':plan.set_id,set_name:p.mode==='detach'?'':plan.set_name,mode:p.mode}:finalRows.find(r=>r.asset_id===id)),details:JSON.stringify({summary:summary,set_name:plan.set_name,request_id:requestId})});
    });appendBatchRows_(SHEETS.ACTIVITY,pendingLogs);
    updateByKey_(SHEETS.ASSET_BATCHES,'request_id',requestId,{state:'complete',updated_at:new Date().toISOString()});invalidateDataCache_();
    return batchResult_(requestId,plan);
  } catch(err){throw new Error((started?'':'BATCH_NOT_STARTED: ')+String(err.message||err));}
  finally {lock.releaseLock();}
}

/* Single physical-asset operations. Legacy set columns/operations remain intact. */
function linkedOperation_(json) {
  if(typeof json!=='string'||json.length>48000)throw new Error('Operation exceeds the local-save request limit.');
  let p;try{p=JSON.parse(json);}catch(_){throw new Error('Invalid asset operation.');}
  if(!p||!['create','update','link','reconcile','retire'].includes(p.kind))throw new Error('Invalid asset operation kind.');
  const out={kind:p.kind,asset_id:groupText_(p.asset_id,80,'Asset ID'),expected_updated_at:groupText_(p.expected_updated_at,50,'Review timestamp'),fields:{}};
  const limits={category:100,category_id:80,brand:120,model:160,serial:80,specifications:4800,site_id:80,area:120,exact_location:160,assigned_to:160,status:30,movement_note:500,parent_asset_id:80};
  Object.keys(limits).forEach(k=>{if(p.fields&&Object.prototype.hasOwnProperty.call(p.fields,k))out.fields[k]=groupText_(p.fields[k],limits[k],k);});
  if(p.custom!==undefined){
    if(!p.custom||typeof p.custom!=='object'||Array.isArray(p.custom))throw new Error('Invalid custom values.');
    const c={custom:Object.create(null)};Object.keys(p.custom).sort().forEach(k=>{if(!/^[A-Za-z0-9_-]{1,80}$/.test(k)||['__proto__','constructor','prototype'].includes(k))throw new Error('Invalid custom field.');c.custom[k]=groupText_(p.custom[k],1000,'Custom value');});
    batchCustom_(c,true);out.custom=c.custom;
  }
  if(p.kind==='reconcile'){
    out.incoming={};out.choices={};['category','brand','model','serial','specifications'].forEach(k=>{out.incoming[k]=groupText_(p.incoming&&p.incoming[k],limits[k],k);const v=p.choices&&p.choices[k]||'existing';if(!['existing','incoming','combine'].includes(v)||v==='combine'&&k!=='specifications')throw new Error('Invalid reviewed field choice.');out.choices[k]=v;});
  }
  if(p.kind!=='create'&&!out.asset_id)throw new Error('Choose an existing asset.');
  return out;
}

function validateMainAsset_(assetId,parentId,rows) {
  if(!parentId)return;
  const parent=rows.find(r=>String(r.asset_id)===parentId);
  if(!parent||['Merged','Retired'].includes(String(parent.status)))throw new Error('PARENT_NOT_READY: Choose an available main asset.');
  let current=parent;const seen=new Set();
  while(current){
    if(String(current.asset_id)===assetId||seen.has(String(current.asset_id)))throw new Error('A main asset link cannot point to itself or create a cycle.');
    seen.add(String(current.asset_id));current=rows.find(r=>String(r.asset_id)===String(current.parent_asset_id));
  }
}

function unfinishedAssetOperation_(assetId,except) {
  if(!getSpreadsheet_().getSheetByName(SHEETS.ASSET_BATCHES))return null;
  return listObjects_(SHEETS.ASSET_BATCHES).find(r=>r.request_id!==except&&r.state!=='complete'&&(()=>{try{const p=JSON.parse(r.plan_json);return p.operation_version===1&&p.ids.includes(assetId);}catch(_){return false;}})());
}
function assertNoPendingAssetOperation_(assetId) {
  if(unfinishedAssetOperation_(assetId,''))throw new Error('ASSET_PENDING: Reconcile the earlier save for this asset before changing it again.');
}

function planLinkedOperation_(op,user,requestId,rows,ledgerRows) {
  const creating=op.kind==='create',existing=creating?null:rows.find(a=>String(a.asset_id)===op.asset_id);
  if(!creating&&(!existing||existing.status==='Merged'))throw new Error('Asset not found or merged.');
  if(existing){
    assertNoPendingAssetOperation_(existing.asset_id);
    if(!op.expected_updated_at||String(existing.updated_at||'')!==op.expected_updated_at)throw new Error('ITEM_CHANGED: This asset changed since review. Reload and compare before saving.');
  }
  if(op.custom)batchCustom_({custom:op.custom},true);
  const f=op.fields,actor=actorKey_(user),guest=String(user.role).toUpperCase()==='GUEST';
  if(guest&&(op.kind!=='create'||f.parent_asset_id))throw new Error('PERMISSION_DENIED: Sign in to link or change existing assets.');
  if(op.kind==='retire')requireRole_(user,'ADMIN');
  else if(!creating)requireRole_(user,'STAFF');
  const stamp=new Date(Math.max(Date.now(),Date.parse(existing&&existing.updated_at||'')+1||0)).toISOString();
  let patch={},category,site,area;
  if(creating||op.kind==='update'){
    const value=k=>Object.prototype.hasOwnProperty.call(f,k)?f[k]:String(existing&&existing[k]||'');
    if(!value('category')&&!value('category_id'))throw new Error('Choose a category.');
    if(!value('site_id')||!value('area'))throw new Error('Choose a site and enter an area.');
    category=resolveCategory_(f.category_id||(existing&&value('category')===existing.category?existing.category_id:''),value('category'),user);
    site=findByKey_(SHEETS.SITES,'site_id',value('site_id'));if(!site||!truthy_(site.active))throw new Error('Choose an active site.');
    area=resolveArea_('',value('area'),site.site_id,user,false);
    ['brand','model','serial','specifications','exact_location','assigned_to'].forEach(k=>patch[k]=value(k));
    patch.status=value('status')||'Active';if(!['Active','Spare','Faulty','Under Repair','Missing','Retired'].includes(patch.status))throw new Error('Invalid asset status.');
    if(creating&&patch.status==='Retired')throw new Error('Register the asset before retiring it.');
    if(!creating&&patch.status==='Retired'&&existing.status!=='Retired')requireRole_(user,'ADMIN');
    Object.assign(patch,{category:category.name,category_id:category.category_id,site_id:site.site_id,site:site.name,area_id:area&&area.area_id||'',area:area&&area.name||value('area')});
    if(op.custom===undefined&&creating)batchCustom_({custom:{}},true);
  }else if(op.kind==='reconcile'){
    ['category','brand','model','serial','specifications'].forEach(k=>{const v=op.incoming[k];if(!v)return;if(op.choices[k]==='incoming')patch[k]=v;else if(k==='specifications'&&op.choices[k]==='combine')patch[k]=combineSpecifications_(existing[k],v);});
    if(patch.category!==undefined){category=resolveCategory_('',patch.category,user);patch.category=category.name;patch.category_id=category.category_id;}
  }else if(op.kind==='retire'){patch.status='Retired';patch.retired_at=stamp;}
  if(Object.prototype.hasOwnProperty.call(patch,'serial'))assertUniqueSerial_(patch.serial,op.asset_id);
  const used=new Set(rows.map(r=>String(r.asset_id)));
  ledgerRows.filter(r=>r.state!=='complete').forEach(r=>{const plan=JSON.parse(r.plan_json);(plan.ids||[]).forEach(id=>used.add(id));});
  let id=op.asset_id;
  if(creating){id=nextAssetId_(category.prefix||'AS');while(used.has(id)){const m=id.match(/^(.*-)(\d+)$/);id=m[1]+String(Number(m[2])+1).padStart(4,'0');}}
  if(creating||Object.prototype.hasOwnProperty.call(f,'parent_asset_id')){
    const parent=f.parent_asset_id||'';
    if(creating||parent!==String(existing.parent_asset_id||''))validateMainAsset_(id,parent,rows);
    patch.parent_asset_id=parent;
  }
  if(op.kind==='link'&&!Object.prototype.hasOwnProperty.call(f,'parent_asset_id'))throw new Error('Choose a main asset or explicitly remove the reference.');
  // Linking and retirement intentionally do not alter placement, legacy membership or children.
  Object.assign(patch,{updated_at:stamp,updated_by:actor});
  if(!creating&&patch.status==='Retired'&&existing.status!=='Retired')patch.retired_at=stamp;
  if(creating)Object.assign(patch,{asset_id:id,created_at:stamp,created_by:actor,source_ref:'operation:'+requestId,main_image_id:'',drive_folder_id:'',retired_at:'',set_id:'',set_name:''});
  const moved=existing&&['site','area','exact_location','assigned_to'].some(k=>patch[k]!==undefined&&String(patch[k])!==String(existing[k]||''));
  const movement=moved?{movement_id:'MOV-Q-'+requestId,asset_id:id,from_site:existing.site,from_area:existing.area,from_location:existing.exact_location,from_assigned:existing.assigned_to,to_site:patch.site,to_area:patch.area,to_location:patch.exact_location,to_assigned:patch.assigned_to,moved_by:actor,moved_at:stamp,note:f.movement_note||''}:null;
  const plan={operation_version:1,kind:op.kind,ids:[id],patch:patch,before:existing,custom:op.custom||null,movement:movement,created_at:stamp};
  if(JSON.stringify(plan).length>45000)throw new Error('This save is too large for the retry ledger. Reduce specifications or custom information.');
  return plan;
}

function writeLinkedAssetPatch_(assetId,patch) {
  const sheet=getSheet_(SHEETS.ASSETS),data=sheet.getDataRange().getValues(),h=data[0].map(String),idCol=h.indexOf('asset_id');
  const index=data.findIndex((r,i)=>i>0&&String(r[idCol])===assetId);if(index<1)throw new Error('Asset disappeared before saving.');
  const row=Object.assign({},rowToObject_(h,data[index]),patch);
  try{const range=sheet.getRange(index+1,1,1,h.length);range.setNumberFormat('@');range.setValues([h.map(k=>groupSheetValue_(row[k]==null?'':row[k]))]);}finally{clearRequestCache_(SHEETS.ASSETS);}
}

function applyLinkedOperation_(plan,op,user,requestId) {
  const id=plan.ids[0],creating=plan.kind==='create',current=findByKey_(SHEETS.ASSETS,'asset_id',id);
  const keys=Object.keys(plan.patch).filter(k=>!['updated_at','updated_by','main_image_id','drive_folder_id'].includes(k));
  const applied=current&&keys.every(k=>String(current[k]||'')===String(plan.patch[k]||''));
  if(creating){
    if(current&&current.source_ref!==plan.patch.source_ref)throw new Error('Reserved asset ID belongs to another operation.');
    if(!current){assertUniqueSerial_(plan.patch.serial,id);validateMainAsset_(id,plan.patch.parent_asset_id,listObjects_(SHEETS.ASSETS));appendBatchRows_(SHEETS.ASSETS,[plan.patch]);}
  }else if(!applied){
    if(!current||keys.some(k=>String(current[k]||'')!==String(plan.before[k]||'')))throw new Error('ITEM_CHANGED: Reconcile the incomplete operation before changing newer data.');
    if(plan.patch.serial!==undefined)assertUniqueSerial_(plan.patch.serial,id);
    if(plan.patch.parent_asset_id!==undefined&&plan.patch.parent_asset_id!==String(current.parent_asset_id||''))validateMainAsset_(id,plan.patch.parent_asset_id,listObjects_(SHEETS.ASSETS));
    const patch=Object.assign({},plan.patch,{updated_at:String(current.updated_at||'')>plan.patch.updated_at?current.updated_at:plan.patch.updated_at});
    writeLinkedAssetPatch_(id,patch);
  }
  if(plan.custom){
    const values=listObjects_(SHEETS.CUSTOM_VALUES);
    Object.keys(plan.custom).forEach(field=>{const old=values.find(r=>r.asset_id===id&&r.field_id===field);const value={asset_id:id,field_id:field,value:plan.custom[field],updated_at:plan.created_at,updated_by:actorKey_(user)};if(!old)appendBatchRows_(SHEETS.CUSTOM_VALUES,[value]);else if(old.value!==value.value)updateByComposite_(SHEETS.CUSTOM_VALUES,{asset_id:id,field_id:field},value);});
  }
  if(plan.movement&&!findByKey_(SHEETS.MOVEMENTS,'movement_id',plan.movement.movement_id))appendBatchRows_(SHEETS.MOVEMENTS,[plan.movement]);
  const action={create:'CREATE_ASSET',update:'UPDATE_ASSET',link:'LINK_ASSET',reconcile:'RECONCILE_ASSET',retire:'RETIRE_ASSET'}[plan.kind];
  if(!listObjects_(SHEETS.ACTIVITY).some(r=>r.asset_id===id&&r.action===action&&(()=>{try{return JSON.parse(r.details).request_id===requestId;}catch(_){return false;}})())){
    appendBatchRows_(SHEETS.ACTIVITY,[{timestamp:plan.created_at,user:actorKey_(user),role:user.role,action:action,asset_id:id,before_json:JSON.stringify(plan.before),after_json:JSON.stringify(plan.patch),details:JSON.stringify({summary:plan.kind==='link'?'Main asset reference changed':'Asset '+plan.kind,request_id:requestId})}]);
  }
}

function saveAssetOperation_(params,user) {
  const requestId=groupText_(params.request_id,80,'Request ID');if(!/^[A-Za-z0-9-]{16,80}$/.test(requestId))throw new Error('Invalid request ID.');
  const guest=String(user.role).toUpperCase()==='GUEST';
  if(guest&&!/^[A-Za-z0-9-]{32,80}$/.test(String(params.guest_key||'')))throw new Error('Guest onboarding proof is missing.');
  const actor=guest?'guest:'+hash_(params.guest_key):actorKey_(user);
  let op;try{op=linkedOperation_(params.operation_json);}catch(err){throw new Error('OPERATION_NOT_STARTED: '+String(err.message||err));}
  if(guest&&(op.kind!=='create'||op.fields.parent_asset_id))throw new Error('PERMISSION_DENIED: Guest access permits only creating an unlinked new asset.');
  if(!guest)requireRole_(user,op.kind==='retire'?'ADMIN':'STAFF');
  if(!groupingFeatures_().asset_links)throw new Error('LINKS_NOT_READY: Run setupAssetGrouping and update both backend files.');
  const lock=LockService.getScriptLock();lock.waitLock(10000);let started=false;
  try{
    clearRequestCache_();const rows=listObjects_(SHEETS.ASSETS),ledgers=listObjects_(SHEETS.ASSET_BATCHES),prior=ledgers.find(r=>r.request_id===requestId);
    started=!!prior;const fingerprint=hash_(JSON.stringify(op));
    if(prior&&(prior.actor!==actor||prior.fingerprint!==fingerprint))throw new Error('REQUEST_REUSED: An operation ID cannot be used for different reviewed data or another user.');
    let plan;
    if(prior){plan=JSON.parse(prior.plan_json);if(plan.operation_version!==1)throw new Error('REQUEST_REUSED: Operation ID belongs to a legacy batch.');}
    else{
      if(rows.some(r=>r.source_ref==='operation:'+requestId)){started=true;throw new Error('OPERATION_LEDGER_MISSING: Restore the retry ledger before reconciling this save.');}
      plan=planLinkedOperation_(op,user,requestId,rows,ledgers);started=true;
      appendBatchRows_(SHEETS.ASSET_BATCHES,[{request_id:requestId,actor:actor,fingerprint:fingerprint,plan_json:JSON.stringify(plan),state:'prepared',created_at:plan.created_at,updated_at:plan.created_at}]);
    }
    if(!prior||prior.state!=='complete'){
      applyLinkedOperation_(plan,op,user,requestId);
      updateByKey_(SHEETS.ASSET_BATCHES,'request_id',requestId,{state:'complete',updated_at:new Date().toISOString()});invalidateDataCache_();
    }
    const asset=getAssetBundle_(plan.ids[0],user);
    if(guest){const grant=shortId_()+shortId_();CacheService.getScriptCache().put('guest-upload:'+grant,asset.asset_id,900);asset.guest_upload_token=grant;}
    return {request_id:requestId,asset:asset};
  }catch(err){throw new Error((started?'':'OPERATION_NOT_STARTED: ')+String(err.message||err));}
  finally{lock.releaseLock();}
}
