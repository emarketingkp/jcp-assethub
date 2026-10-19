const {test}=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const same=()=>({mode:'same',common:{category:'Monitor',brand:'Sample',model:'M-10',specifications:'Part Number: SHARED-10',site_id:'SITE-TEST',area:'Test Area'},units:[{serial:'001O0I1234'},{serial:''},{serial:'002O0I1234'}]});
const asset=(id,extra={})=>({asset_id:id,category:'Desktop PC',brand:'Sample',model:'PC-1',serial:'S-'+id,site_id:'SITE-TEST',area:'Original area',assigned_to:'Original person',updated_at:'2026-01-01T00:00:00.000Z',status:'Active',...extra});
test('batch creates separate exact-string records and one ledger entry; retries do not recreate them',()=>{
  const h=createHarness(),id=crypto.randomUUID(),payload=same(),first=h.batch(payload,{id}),second=h.batch(payload,{id});
  assert.equal(first.assets.length,3);assert.equal(new Set(first.assets.map(a=>a.asset_id)).size,3);assert.equal(first.assets[0].serial,'001O0I1234');
  assert.equal(first.assets[1].serial,'');assert.equal(h.read('Assets').length,3);assert.equal(h.read('AssetBatches').length,1);assert.equal(h.read('ActivityLog').length,3);assert.deepEqual(first,second);
  assert(h.formats.some(f=>f.sheet==='Assets'&&f.row===2&&f.count===3&&f.pattern==='@'));
});
test('mixed equipment set links existing units without overwriting their location, serial or assignment',()=>{
  const h=createHarness({assets:[asset('OLD-1')]}),before=h.read('Assets')[0];
  const related={AssetImages:[{image_id:'IMG-OLD',asset_id:'OLD-1',active:true}],Maintenance:[{maintenance_id:'M-OLD',asset_id:'OLD-1',issue:'Existing repair'}],AuditEntries:[{entry_id:'E-OLD',asset_id:'OLD-1',result:'Verified'}],AssetPrivate:[{asset_id:'OLD-1',account_number:'FAKE-TEST-ACCOUNT'}]};
  for(const [sheet,records]of Object.entries(related))h.seed(sheet,records);
  const snapshots=Object.fromEntries(Object.keys(related).map(sheet=>[sheet,h.read(sheet)]));
  const payload={mode:'set',set_name:'Marketing PC station',common:{site_id:'SITE-TEST',area:'New area',status:'Spare'},units:[{existing_asset_id:'OLD-1',expected_updated_at:before.updated_at},{category:'Keyboard',serial:''},{category:'Mouse',serial:''}]};
  const result=h.batch(payload),old=h.read('Assets').find(a=>a.asset_id==='OLD-1');
  assert.equal(result.assets.length,3);assert(result.set_id.startsWith('SET-'));assert.equal(new Set(result.assets.map(a=>a.set_id)).size,1);
  for(const key of ['serial','site_id','area','assigned_to','brand','model'])assert.equal(old[key],before[key]);
  assert.equal(h.read('Assets')[1].brand,'');assert.equal(h.read('Assets')[1].model,'');assert.equal(h.read('Movements').length,0);
  assert.equal(old.status,'Active');assert.equal(h.read('Assets')[1].status,'Spare');
  for(const [sheet,snapshot]of Object.entries(snapshots))assert.deepEqual(h.read(sheet),snapshot);
});
test('guest, missing confirmation, stale reviews and repeated serials cannot write a batch',()=>{
  for(const scenario of ['guest','confirmation','within','existing','stale']){
    const h=createHarness({assets:[asset('OLD-1')]}),p=same();let opts={};
    if(scenario==='guest')opts.user={role:'GUEST',username:'guest'};
    if(scenario==='confirmation')opts.confirmed='false';
    if(scenario==='within')p.units[1].serial=p.units[0].serial;
    if(scenario==='existing')p.units[0].serial='S-OLD-1';
    if(scenario==='stale')Object.assign(p,{mode:'set',set_name:'Station',units:[{existing_asset_id:'OLD-1',expected_updated_at:'wrong'}]});
    assert.throws(()=>h.batch(p,opts));assert.equal(h.read('Assets').length,1);assert.equal(h.read('AssetBatches').length,0);assert.equal(h.writes.length,0);
  }
});
test('partial spreadsheet write resumes the original plan and logs each unit once',()=>{
  const h=createHarness(),p=same(),id=crypto.randomUUID();h.fail({sheet:'Assets',when:'after',partialRows:1});
  assert.throws(()=>h.batch(p,{id}),/uncertain/);assert.equal(h.read('Assets').length,1);assert.equal(h.read('AssetBatches')[0].state,'prepared');
  const firstId=h.read('Assets')[0].asset_id,result=h.batch(p,{id});
  assert.equal(h.read('Assets').length,3);assert.equal(result.assets[0].asset_id,firstId);assert.equal(h.read('ActivityLog').length,3);
});
test('reserved IDs survive a prepared request and a different request created in between',()=>{
  const h=createHarness(),p=same(),id=crypto.randomUUID();h.fail({sheet:'Assets',when:'before'});assert.throws(()=>h.batch(p,{id}));
  const other=same();other.units=[{serial:'DIFFERENT-OTHER'}];const second=h.batch(other),first=h.batch(p,{id});
  assert(!first.assets.some(a=>a.asset_id===second.assets[0].asset_id));assert.equal(h.read('Assets').length,4);
});
test('an uncertain activity/custom write can retry without repeating asset creation or logs',()=>{
  for(const sheet of ['ActivityLog','CustomValues']){
    const h=createHarness({customFields:[{field_id:'CF-TEST',label:'Warranty note',active:true,required:true,field_type:'text'}]}),p=same(),id=crypto.randomUUID();p.common.custom={'CF-TEST':'Reviewed'};
    h.fail({sheet,when:'after',partialRows:1});assert.throws(()=>h.batch(p,{id}));const result=h.batch(p,{id});
    assert.equal(result.assets.length,3);assert.equal(h.read('Assets').length,3);assert.equal(h.read('CustomValues').length,3);assert.equal(h.read('ActivityLog').length,3);
  }
});
test('request fingerprints bind retry to the same actor and reviewed payload',()=>{
  const h=createHarness(),id=crypto.randomUUID(),p=same();h.batch(p,{id});p.units[0].serial='EDITED';
  assert.throws(()=>h.batch(p,{id}),/REQUEST_REUSED/);assert.throws(()=>h.batch(same(),{id,user:{username:'another-staff',role:'STAFF'}}),/REQUEST_REUSED/);assert.equal(h.read('Assets').length,3);
});
test('set unlink and rename require explicit complete selection and preserve item records',()=>{
  const set_id='SET-EXAMPLE00000001',rows=[asset('A',{set_id,set_name:'Old station'}),asset('B',{set_id,set_name:'Old station'})],h=createHarness({assets:rows});
  const selected=h.read('Assets').map(a=>({existing_asset_id:a.asset_id,expected_updated_at:a.updated_at}));
  assert.throws(()=>h.batch({mode:'rename',set_id,set_name:'New station',units:[selected[0]]}),/membership changed/);
  h.batch({mode:'rename',set_id,set_name:'New station',units:selected});assert(h.read('Assets').every(a=>a.set_name==='New station'));
  const a=h.read('Assets')[0];h.batch({mode:'detach',set_id,set_name:'New station',units:[{existing_asset_id:a.asset_id,expected_updated_at:a.updated_at}]});
  assert.equal(h.read('Assets')[0].set_id,'');assert.equal(h.read('Assets')[1].set_id,set_id);assert.equal(h.read('Assets').length,2);
});
test('an item in another set cannot be silently moved into a new set',()=>{
  const h=createHarness({assets:[asset('A',{set_id:'SET-EXAMPLE00000001',set_name:'Existing station'})]});
  assert.throws(()=>h.batch({mode:'attach',set_name:'Another station',units:[{existing_asset_id:'A',expected_updated_at:'2026-01-01T00:00:00.000Z'}]}),/already belongs/);assert.equal(h.writes.length,0);
});
test('old schemas advertise no group-write capability; setup adds columns without changing records',()=>{
  const h=createHarness({grouping:false,assets:[asset('A')]}),before=h.read('Assets')[0];
  assert.equal(h.context.groupingFeatures_().asset_groups,0);assert.throws(()=>h.batch(same()),/GROUPING_NOT_READY/);
  h.context.setupAssetGrouping();assert.equal(h.context.groupingFeatures_().asset_groups,1);for(const [k,v]of Object.entries(before))assert.equal(h.read('Assets')[0][k],v);
});
test('formula-shaped user text remains literal in new rows and set names',()=>{
  const h=createHarness(),p=same();p.mode='set';p.set_name='=HYPERLINK("test")';p.units=[{category:'Keyboard',brand:'=1+1',model:'',serial:'000123'}];
  const result=h.batch(p);assert.equal(result.assets[0].brand,'=1+1');assert.equal(result.assets[0].set_name,'=HYPERLINK("test")');assert.equal(result.assets[0].serial,'000123');
});
test('normal edits and image touches retain set columns and literal text',()=>{
  const set_id='SET-EXAMPLE00000001',h=createHarness({assets:[asset('A',{set_id,set_name:'Station',brand:'=1+1'})]});
  h.context.updateByKey_('Assets','asset_id','A',{main_image_id:'IMG-NEW',updated_at:'2026-10-19T00:00:00Z'});
  let a=h.read('Assets')[0];assert.equal(a.set_id,set_id);assert.equal(a.set_name,'Station');assert.equal(a.brand,'=1+1');
  const headers=h.sheets.get('Assets').cells[0],setColumn=headers.indexOf('set_id')+1;
  assert(h.writes.every(w=>w.col+w.width-1<setColumn),'Legacy asset writer touched membership columns absent from its patch');
  h.context.withAssetWriteLock_(()=>h.context.updateAsset_({asset_id:'A',site_id:'SITE-TEST',area:'Test Area',brand:'Sample',model:'PC-1',category:'Desktop PC',serial:'S-A'}, {role:'STAFF',username:'test-staff'}));
  a=h.read('Assets')[0];assert.equal(a.set_id,set_id);assert.equal(a.set_name,'Station');
});
test('current timestamp JCP tags round-trip through backend matching without a browser URL implementation',()=>{
  const id='JCP-AS-1700000000123',h=createHarness({assets:[asset(id)]});h.context.URL=undefined;
  for(const code of [id,'JCP-ASSET: '+id,'https://example.test/?asset='+id])assert.equal(h.context.matchIdentifier_(code).asset.asset_id,id);
  assert.equal(h.context.extractAssetIdFromCode_('JCP-AS-12345678901234567'),'');
  const next=h.batch(same()).assets[0].asset_id;assert.equal(h.context.matchIdentifier_('https://example.test/?asset='+next).asset.asset_id,next);
});
test('completed batch replay cannot undo later set membership changes',()=>{
  const h=createHarness(),id=crypto.randomUUID(),p=same(),created=h.batch(p,{id});
  const linked=h.batch({mode:'attach',set_name:'New station',units:created.assets.map(a=>({existing_asset_id:a.asset_id,expected_updated_at:a.updated_at}))});
  const replay=h.batch(p,{id});assert(replay.assets.every(a=>a.set_id===linked.set_id));assert.equal(h.read('Assets').length,3);
});
test('same shared product code is allowed while unique shared IMEI/MAC/serial labels are rejected',()=>{
  const h=createHarness();for(const label of ['Serial','MAC Address','IMEI','Hostname']){const p=same();p.common.specifications=label+': UNIQUE';assert.throws(()=>h.batch(p),/BATCH_NOT_STARTED:.*Unique device/);}
  assert.equal(h.read('Assets').length,0);assert.equal(h.batch(same()).assets.length,3);
});
test('same set name is not silently reused or duplicated, and cross-set merge requires unlinking',()=>{
  const h=createHarness({assets:[asset('A',{set_id:'SET-EXAMPLE00000001',set_name:'Station'}),asset('B')]});
  assert.throws(()=>h.batch({mode:'attach',set_name:'Station',units:[{existing_asset_id:'B',expected_updated_at:'2026-01-01T00:00:00.000Z'}]}),/already exists/);
  assert.throws(()=>h.context.mergeAssets_({source_asset_id:'A',target_asset_id:'B'}, {role:'STAFF',username:'test-staff'}),/SET_MEMBERSHIP_CONFLICT/);assert.equal(h.writes.length,0);
});
test('full 25-unit requests keep long numeric serials exact and reject oversized UTF-8 input',()=>{
  const h=createHarness(),p=same();p.units=Array.from({length:25},(_,i)=>({serial:i?'':'00012345678901234567890'}));p.common.specifications='Approved shared specifications '.repeat(50);
  const result=h.batch(p);assert.equal(result.assets.length,25);assert.equal(result.assets[0].serial,'00012345678901234567890');
  const tooLarge=same();tooLarge.units=Array.from({length:25},()=>({serial:'',note:'字'.repeat(700)}));
  assert.throws(()=>h.batch(tooLarge),/32 KiB/);assert.equal(h.read('Assets').length,25);
});
test('removing a retry ledger cannot make a saved blank-serial batch create again',()=>{
  const h=createHarness(),id=crypto.randomUUID(),p=same();p.units=[{serial:''},{serial:''}];h.batch(p,{id});
  h.sheets.get('AssetBatches').cells.splice(1);h.context.invalidateDataCache_();
  assert.throws(()=>h.batch(p,{id}),/BATCH_LEDGER_MISSING/);assert.equal(h.read('Assets').length,2);
});
