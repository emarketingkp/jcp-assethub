const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const staff={username:'staff-A',role:'STAFF'},admin={username:'admin-A',role:'ADMIN'},guest={username:'guest',role:'GUEST'};
const fields=(serial='')=>({category:'Camera',brand:'',model:'',serial,site_id:'SITE-TEST',area:'Front entrance',status:'Active'});
function setup(options={}){const h=createHarness(options);return {...h,save(op,{id=randomUUID(),user=staff,guestKey=''}={}){return JSON.parse(JSON.stringify(h.context.saveAssetOperation_({request_id:id,operation_json:JSON.stringify(op),guest_key:guestKey},user)));}};}
function create(h,serial,extra={}){return h.save({kind:'create',fields:{...fields(serial),...extra}}).asset;}

test('single-column links support unknown devices and retain old set data without a container',()=>{
  const h=setup(),main=create(h,'ROOT'),child=create(h,'',{parent_asset_id:main.asset_id});
  assert.equal(h.read('Assets').length,2);assert.equal(child.brand,'');assert.equal(child.model,'');assert.equal(child.parent_asset_id,main.asset_id);assert.equal(child.set_id,'');assert.equal(child.set_name,'');
});
test('link, unlink and relink change only the existing child and preserve independent placement/history/legacy fields',()=>{
  const h=setup(),one=create(h,'A'),two=create(h,'B');h.context.writeLinkedAssetPatch_(two.asset_id,{set_id:'LEGACY',set_name:'Do not migrate',specifications:'Own details'});
  let child=h.save({kind:'link',asset_id:two.asset_id,expected_updated_at:two.updated_at,fields:{parent_asset_id:one.asset_id}}).asset;
  assert.equal(child.area_name,'Front entrance');assert.equal(child.set_id,'LEGACY');assert.equal(child.specifications,'Own details');assert.equal(h.read('Movements').length,0);
  child=h.save({kind:'link',asset_id:child.asset_id,expected_updated_at:child.updated_at,fields:{parent_asset_id:''}}).asset;
  assert.equal(child.parent_asset_id,'');assert.equal(child.set_name,'Do not migrate');assert.equal(h.read('Assets').length,2);
});
test('server prevents self-links, nested cycles, unavailable parents and stale edits',()=>{
  const h=setup(),root=create(h,'R'),middle=create(h,'M',{parent_asset_id:root.asset_id}),leaf=create(h,'L',{parent_asset_id:middle.asset_id});
  for(const parent of [root.asset_id,leaf.asset_id])assert.throws(()=>h.save({kind:'link',asset_id:root.asset_id,expected_updated_at:root.updated_at,fields:{parent_asset_id:parent}}),/cycle|itself/);
  assert.throws(()=>create(h,'X',{parent_asset_id:'missing'}),/PARENT_NOT_READY/);
  const updated=h.save({kind:'update',asset_id:leaf.asset_id,expected_updated_at:leaf.updated_at,fields:{...fields('L'),model:'Changed'}}).asset;
  assert.throws(()=>h.save({kind:'link',asset_id:leaf.asset_id,expected_updated_at:leaf.updated_at,fields:{parent_asset_id:''}}),/ITEM_CHANGED/);assert.equal(updated.model,'Changed');
});
test('one operation survives lost replies, stale replays and request ID reuse',()=>{
  const h=setup(),id=randomUUID(),op={kind:'create',fields:fields('0000123456789012345')},first=h.save(op,{id}).asset;
  h.context.writeLinkedAssetPatch_(first.asset_id,{model:'Newer edit',updated_at:'2099-01-01T00:00:00Z'});
  const replay=h.save(op,{id}).asset;assert.equal(h.read('Assets').length,1);assert.equal(replay.model,'Newer edit');assert.equal(replay.serial,'0000123456789012345');
  assert.throws(()=>h.save({...op,fields:fields('different')},{id}),/REQUEST_REUSED/);assert.throws(()=>h.save(op,{id,user:{username:'other',role:'STAFF'}}),/REQUEST_REUSED/);
});
for(const sheet of ['Assets','CustomValues','ActivityLog','AssetBatches'])for(const when of ['before','after'])test('new record recovers '+sheet+' '+when+' write without duplicates',()=>{
  const h=setup({customFields:[{field_id:'CF-TEST',label:'Test',field_type:'text',active:true}]}),id=randomUUID(),op={kind:'create',fields:fields('RECOVER'),custom:{'CF-TEST':'Owned'}};
  h.fail({sheet,when});assert.throws(()=>h.save(op,{id}),/Injected/);const r=h.save(op,{id});assert.ok(r.asset.asset_id);assert.equal(h.read('Assets').length,1);assert.equal(h.read('CustomValues').length,1);assert.equal(h.read('ActivityLog').length,1);
});
test('movement, custom values and activity are replayed once after an uncertain edit',()=>{
  const h=setup(),a=create(h,'MOVE'),id=randomUUID(),op={kind:'update',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{...fields('MOVE'),area:'Loading bay',model:'New'}};
  h.fail({sheet:'Movements',when:'after'});assert.throws(()=>h.save(op,{id}),/Injected/);
  assert.throws(()=>h.save({kind:'link',asset_id:a.asset_id,expected_updated_at:h.read('Assets')[0].updated_at,fields:{parent_asset_id:''}}),/ASSET_PENDING/);
  h.save(op,{id});h.save(op,{id});assert.equal(h.read('Movements').length,1);assert.equal(h.read('ActivityLog').filter(a=>a.action==='UPDATE_ASSET').length,1);
});
test('duplicate serials are rejected before writing and can be corrected using the same unstarted ID',()=>{
  const h=setup(),first=create(h,'S-1234'),id=randomUUID();assert.throws(()=>h.save({kind:'create',fields:fields('s1234')},{id}),/OPERATION_NOT_STARTED:.*DUPLICATE_SERIAL/);assert.equal(h.read('AssetBatches').length,1);h.save({kind:'create',fields:fields('OTHER')},{id});assert.equal(h.read('Assets').length,2);assert.ok(first.asset_id);
});
test('retirement affects one physical record and requires Admin',()=>{
  const h=setup(),main=create(h,'R'),child=create(h,'C',{parent_asset_id:main.asset_id}),op={kind:'retire',asset_id:main.asset_id,expected_updated_at:main.updated_at};
  assert.throws(()=>h.save(op),/PERMISSION|Admin/i);assert.throws(()=>h.save({kind:'update',asset_id:main.asset_id,expected_updated_at:main.updated_at,fields:{...fields('R'),status:'Retired'}}),/PERMISSION|Admin/i);
  h.save(op,{user:admin});const c=h.read('Assets').find(a=>a.asset_id===child.asset_id);assert.equal(c.status,'Active');assert.equal(c.parent_asset_id,main.asset_id);assert.throws(()=>create(h,'X',{parent_asset_id:main.asset_id}),/PARENT_NOT_READY/);
});
test('reviewed scan choices remain explicit and replay does not overwrite later values',()=>{
  const h=setup(),a=create(h,'SERIAL',{brand:'Hikvision',model:'Keep model',specifications:'Power: 12 V'}),id=randomUUID();
  const op={kind:'reconcile',asset_id:a.asset_id,expected_updated_at:a.updated_at,incoming:{model:'Incoming model',specifications:'Power: 24 V\nResolution: 4 MP'},choices:{model:'existing',specifications:'combine'}};
  const saved=h.save(op,{id}).asset;assert.equal(saved.model,'Keep model');assert.equal(saved.specifications,'Power: 12 V\nResolution: 4 MP');h.save(op,{id});assert.equal(h.read('Assets').length,1);
});
test('Guest recovery is bound to a secret onboarding proof and cannot edit/link existing assets',()=>{
  const h=setup(),id=randomUUID(),key=randomUUID(),op={kind:'create',fields:fields('GUEST')};
  const first=h.save(op,{id,user:guest,guestKey:key}).asset;assert.ok(first.guest_upload_token);assert.equal(h.save(op,{id,user:guest,guestKey:key}).asset.asset_id,first.asset_id);
  assert.throws(()=>h.save(op,{id,user:guest,guestKey:randomUUID()}),/REQUEST_REUSED/);
  for(const kind of ['update','link','reconcile','retire'])assert.throws(()=>h.save({kind,asset_id:first.asset_id,fields:{parent_asset_id:'OTHER'}},{user:guest,guestKey:key}),/PERMISSION/);
  assert.equal(JSON.stringify(h.read('ActivityLog')).includes(key),false);assert.equal(JSON.stringify(h.read('Assets')).includes(key),false);
});
test('asset exports include main ID/name, preserve original columns and count each record once',()=>{
  const h=setup(),a=create(h,'MAIN',{brand:'Hikvision',model:'Recorder'});create(h,'CHILD',{parent_asset_id:a.asset_id});h.context.Session={getScriptTimeZone:()=> 'UTC'};h.context.Utilities.formatDate=date=>date.toISOString().slice(0,10);const report=h.context.buildReport_({type:'asset'});assert.equal(report.rows.length,2);const row=report.rows.find(r=>r.parent_asset_id===a.asset_id);assert.equal(row.main_asset_id,a.asset_id);assert.equal(row.main_asset_name,'Hikvision Recorder');assert.ok(report.export_columns.includes('parent_asset_id'));assert.ok(report.export_columns.includes('main_asset_name'));
});

test('missing retry records cannot recreate an already committed physical asset',()=>{
  const h=setup(),id=randomUUID(),op={kind:'create',fields:fields('LEDGER')};h.save(op,{id});h.sheets.get('AssetBatches').cells.splice(1);h.context.invalidateDataCache_();assert.throws(()=>h.save(op,{id}),/OPERATION_LEDGER_MISSING/);assert.equal(h.read('Assets').length,1);
});
test('legacy merge cannot leave a child reference pointing at a merged source',()=>{
  const h=setup(),main=create(h,'MAIN'),child=create(h,'CHILD',{parent_asset_id:main.asset_id}),target=create(h,'TARGET');assert.throws(()=>h.context.mergeAssets_({source_asset_id:main.asset_id,target_asset_id:target.asset_id},staff),/ASSET_LINK_CONFLICT/);assert.equal(h.read('Assets').find(a=>a.asset_id===child.asset_id).parent_asset_id,main.asset_id);assert.equal(h.read('Assets').find(a=>a.asset_id===main.asset_id).status,'Active');
});

test('older creation clients cannot consume an ID or serial reserved by an unfinished operation',()=>{
  const h=setup(),id=randomUUID(),op={kind:'create',fields:fields('PENDING')};h.fail({sheet:'Assets',when:'before'});assert.throws(()=>h.save(op,{id}),/Injected/);assert.throws(()=>h.context.createAsset_({...fields('PENDING'),brand:'Sample',model:'M'},staff),/pending save/);assert.throws(()=>h.context.importLegacyInventory_(admin),/ASSET_PENDING/);const other=h.context.createAsset_({...fields('OTHER'),brand:'Sample',model:'M'},staff);h.save(op,{id});const assets=h.read('Assets');assert.equal(assets.length,2);assert.equal(new Set(assets.map(a=>a.asset_id)).size,2);assert.notEqual(other.asset_id,assets.find(a=>a.serial==='PENDING').asset_id);
});
