/* Additive equipment-set and multiple-unit operations. No advanced services/scopes. */
function setupAssetGrouping() {
  validateConfig_();
  const ss=getSpreadsheet_();
  ensureSheet_(ss,SHEETS.ASSETS,SCHEMA.Assets);
  ensureSheet_(ss,SHEETS.ASSET_BATCHES,SCHEMA.AssetBatches);
  invalidateDataCache_();
  return 'Grouping columns and retry ledger ready. Deploy both Code.gs and AssetGroups.gs.';
}

function groupingFeatures_() {
  try {
    const ss=getSpreadsheet_(),assets=ss.getSheetByName(SHEETS.ASSETS),ledger=ss.getSheetByName(SHEETS.ASSET_BATCHES);
    if(!assets||!ledger)return {asset_groups:0};
    const assetHeaders=new Set(headers_(assets)),ledgerHeaders=new Set(headers_(ledger));
    return {asset_groups:['set_id','set_name'].every(k=>assetHeaders.has(k))&&SCHEMA.AssetBatches.every(k=>ledgerHeaders.has(k))?1:0};
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
  if(p.mode==='same'&&/^\s*(?:serial(?:\s+(?:number|no\.?))?|s\s*\/\s*n|imei\s*2?|mac(?:\s+address)?|service\s+tag|jcp\s+asset\s+id|asset\s+id|host\s*name|device\s+(?:id|name)|uuid|license\s+key)\s*[:=#]/im.test(common.specifications))throw new Error('Unique device identifiers cannot be shared across new units. Enter each serial in its own row; add other unit identifiers in individual asset details.');
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
  if(p.mode==='rename'&&(setMembers.length!==chosen.size||setMembers.some(r=>!chosen.has(String(r.asset_id)))))throw new Error('Set membership changed. Reload and review every component before renaming.');
  p.units.forEach(u=>{
    if(!u.existing_asset_id)return;
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
  const plan={ids:ids,set_id:setId||'',set_name:setName||'',created_at:now,before:before};
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
        site_id:site.site_id,site:site.name,area_id:area?area.area_id:'',area:area?area.name:p.common.area,exact_location:p.common.exact_location,assigned_to:p.common.assigned_to,status:p.common.status,main_image_id:'',drive_folder_id:'',created_at:plan.created_at,updated_at:writeTime,created_by:actor,updated_by:actor,retired_at:'',source_ref:source,set_id:p.mode==='set'?plan.set_id:'',set_name:p.mode==='set'?plan.set_name:''});
    });
    appendBatchRows_(SHEETS.ASSETS,newRows);
    const customRows=listObjects_(SHEETS.CUSTOM_VALUES),pendingCustom=[];
    plan.ids.forEach((id,i)=>{if(p.units[i].existing_asset_id)return;Object.keys(p.common.custom).forEach(field=>{if(!customRows.some(r=>r.asset_id===id&&r.field_id===field))pendingCustom.push({asset_id:id,field_id:field,value:p.common.custom[field],updated_at:plan.created_at,updated_by:actor});});});
    appendBatchRows_(SHEETS.CUSTOM_VALUES,pendingCustom);
    const existingIds=p.units.filter(u=>u.existing_asset_id).map(u=>u.existing_asset_id);
    writeSetColumns_(existingIds,{set_id:p.mode==='detach'?'':plan.set_id,set_name:p.mode==='detach'?'':plan.set_name,updated_at:writeTime,updated_by:actor});
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
