const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const staff={username:'editor',role:'STAFF'},guest={username:'guest',role:'GUEST'};
function setup(){const h=createHarness();return {...h,save(op,{id=randomUUID(),user=staff,proof=''}={}){return JSON.parse(JSON.stringify(h.context.saveAssetOperation_({request_id:id,operation_json:JSON.stringify({version:2,...op}),guest_key:proof},user)));}};}
const fields=(extra={})=>({category:'Furniture',brand:'',model:'Visitor chair',serial:'',site_id:'SITE-TEST',area:'Lobby',status:'Active',...extra});
const create=(h,extra={})=>h.save({kind:'create',fields:fields(extra)}).asset;
test('asset names are additive, independent from the model and survive older-client edits',()=>{
  const h=setup(),a=create(h,{asset_name:'Lobby chair 01'}),b=create(h,{asset_name:'Lobby chair 02'});
  assert.equal(a.asset_name,'Lobby chair 01');assert.equal(b.asset_name,'Lobby chair 02');assert.equal(a.model,b.model);assert.equal(h.read('Assets').length,2);
  h.context.updateByKey_('Assets','asset_id',a.asset_id,{main_image_id:'X'});assert.equal(h.read('Assets')[0].asset_name,'Lobby chair 01');
  h.context.saveAssetOperation_({request_id:randomUUID(),operation_json:JSON.stringify({kind:'update',asset_id:b.asset_id,expected_updated_at:b.updated_at,fields:{brand:'New brand'}})},staff);
  assert.equal(h.read('Assets')[1].asset_name,'Lobby chair 02');
});
test('full reconciliation reviews placement, name, status and explicit clearing without changing other facts',()=>{
  const h=setup(),a=create(h,{asset_name:'Chair',serial:'SN-01',exact_location:'Door',assigned_to:'Old team'}),root=create(h,{asset_name:'Main'});
  const incoming={asset_name:'Reception chair',serial:'',area:'Reception',exact_location:'',assigned_to:'New team',status:'Spare',parent_asset_id:root.asset_id,model:'Unapproved'};
  const choices=Object.fromEntries(Object.keys(incoming).map(k=>[k,k==='model'?'existing':'incoming'])),id=randomUUID();
  const saved=h.save({kind:'reconcile',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{movement_note:'Reviewed placement'},incoming,choices},{id}).asset;
  assert.equal(saved.asset_name,'Reception chair');assert.equal(saved.serial,'');assert.equal(saved.exact_location,'');assert.equal(saved.area_name,'Reception');assert.equal(saved.parent_asset_id,root.asset_id);assert.equal(saved.model,'Visitor chair');assert.equal(saved.status,'Spare');
  h.save({kind:'reconcile',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{movement_note:'Reviewed placement'},incoming,choices},{id});assert.equal(h.read('Movements').length,1);
});
test('an inherited main link cannot create cycles through full reconciliation',()=>{
  const h=setup(),a=create(h),b=create(h,{parent_asset_id:a.asset_id});
  assert.throws(()=>h.save({kind:'reconcile',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{},incoming:{parent_asset_id:b.asset_id},choices:{parent_asset_id:'incoming'}}),/cycle/);
  assert.equal(h.read('Assets')[0].parent_asset_id,'');
});
test('confirmed Staff category and site-scoped area choices persist exactly once after uncertain writes',()=>{
  const h=setup(),id=randomUUID(),op={kind:'create',fields:fields({category:'Workshop fixture',area:'Paint booth',asset_name:'Fixture A'})};
  h.fail({sheet:'Categories',when:'after'});assert.throws(()=>h.save(op,{id}),/Injected/);h.save(op,{id});
  assert.equal(h.read('Assets').length,1);assert.equal(h.read('Categories').filter(r=>r.name==='Workshop fixture').length,1);assert.equal(h.read('Areas').filter(r=>r.name==='Paint booth').length,1);
  create(h,{category:'workshop fixture',area:'Paint booth'});assert.equal(h.read('Categories').filter(r=>String(r.name).toLowerCase()==='workshop fixture').length,1);
});
test('a rejected duplicate does not publish a guessed category or area',()=>{
  const h=setup();create(h,{serial:'DUP'});assert.throws(()=>create(h,{serial:'DUP',category:'Unconfirmed option',area:'Unknown area'}),/DUPLICATE_SERIAL/);
  assert.equal(h.read('Categories').some(r=>r.name==='Unconfirmed option'),false);assert.equal(h.read('Areas').some(r=>r.name==='Unknown area'),false);
});
test('Staff-only values save separately, support clearing and are never included in Guest bundles or public activity',()=>{
  const h=setup(),op={kind:'create',fields:fields({asset_name:'Office phone'}),private:{mobile_number:'001234',account_number:'000987',register_owner:'Owner',amount_paid:'RM 30'}};
  const a=h.save(op).asset;assert.equal(a.private_details.account_number,'000987');
  const b=h.save({kind:'update',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{asset_name:'Renamed phone'},private:{account_number:''}}).asset;
  assert.equal(b.private_details.account_number,'');assert.equal(b.private_details.mobile_number,'001234');
  const publicAsset=h.context.getAssetBundle_(a.asset_id,guest);assert.equal(publicAsset.private_details,undefined);
  assert.equal(JSON.stringify(h.read('ActivityLog')).includes('000987'),false);assert.equal(h.read('AssetPrivate').length,1);
});
test('private value writes reconcile after partial success without creating another asset or private record',()=>{
  const h=setup(),id=randomUUID(),op={kind:'create',fields:fields(),private:{account_number:'000123'}};
  h.fail({sheet:'AssetPrivate',when:'after'});assert.throws(()=>h.save(op,{id}),/Injected/);const a=h.save(op,{id}).asset;
  assert.equal(a.private_details.account_number,'000123');assert.equal(h.read('Assets').length,1);assert.equal(h.read('AssetPrivate').length,1);
});
test('Guest registration may name an asset but cannot write private data, link or publish master choices',()=>{
  const h=setup(),proof=randomUUID();assert.throws(()=>h.save({kind:'create',fields:fields(),private:{account_number:'x'}},{user:guest,proof}),/PERMISSION_DENIED/);
  assert.equal(h.read('Assets').length,0);const a=h.save({kind:'create',fields:fields({asset_name:'Guest chair',category:'Guest custom type',area:'Guest area'})},{user:guest,proof}).asset;
  assert.equal(a.asset_name,'Guest chair');assert.equal(a.private_details,undefined);assert.equal(h.read('Categories').some(r=>r.name==='Guest custom type'),false);
});
test('choosing a main image preserves its evidence classification and cannot select another asset image',()=>{
  const h=setup(),a=create(h),b=create(h);h.seed('AssetImages',[{image_id:'LABEL',asset_id:a.asset_id,image_type:'serial_label',active:true},{image_id:'OTHER',asset_id:b.asset_id,image_type:'other',active:true}]);
  const saved=h.save({kind:'main_photo',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{main_image_id:'LABEL'}}).asset;
  assert.equal(saved.main_image_id,'LABEL');assert.equal(h.read('AssetImages')[0].image_type,'serial_label');
  assert.throws(()=>h.save({kind:'main_photo',asset_id:a.asset_id,expected_updated_at:saved.updated_at,fields:{main_image_id:'OTHER'}}),/belonging/);
});
test('completed main-image replay cannot reverse a later image choice',()=>{
  const h=setup(),a=create(h);h.seed('AssetImages',[{image_id:'A',asset_id:a.asset_id,image_type:'serial_label',active:true},{image_id:'B',asset_id:a.asset_id,image_type:'other',active:true}]);
  const id=randomUUID(),op={kind:'main_photo',asset_id:a.asset_id,expected_updated_at:a.updated_at,fields:{main_image_id:'A'}};const first=h.save(op,{id}).asset;
  h.save({kind:'main_photo',asset_id:a.asset_id,expected_updated_at:first.updated_at,fields:{main_image_id:'B'}});assert.equal(h.save(op,{id}).asset.main_image_id,'B');
});
