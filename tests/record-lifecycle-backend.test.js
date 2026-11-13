const {test}=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const staff={username:'editor',role:'STAFF'},admin={username:'boss',role:'ADMIN'};
function setup(){const h=createHarness();return {...h,create(extra={}){return JSON.parse(JSON.stringify(h.context.saveAssetOperation_({request_id:randomUUID(),operation_json:JSON.stringify({version:2,kind:'create',fields:{category:'Monitor',brand:'Dell',model:'P2422H',serial:'',site_id:'SITE-TEST',area:'Lobby',status:'Active',...extra}})},staff))).asset;}};}
const call=(fn,...args)=>JSON.parse(JSON.stringify(fn(...args)));

test('a retired asset can be restored by an Admin, and legacy routes cannot retire or create retired assets',()=>{
  const h=setup(),a=h.create();
  assert.throws(()=>h.context.updateAsset_({asset_id:a.asset_id,site_id:'SITE-TEST',area:'Lobby',status:'Retired'},staff),/PERMISSION_DENIED/);
  assert.throws(()=>h.context.updateAsset_({asset_id:a.asset_id,site_id:'SITE-TEST',area:'Lobby',status:'Broken'},staff),/Invalid asset status/);
  assert.throws(()=>h.context.createAsset_({category:'Monitor',brand:'X',model:'Y',site_id:'SITE-TEST',area:'Lobby',status:'Retired'},staff),/cannot be created as Retired/);
  assert.throws(()=>h.context.restoreAsset_({asset_id:a.asset_id},admin),/Only a retired asset/);
  h.context.retireAsset_(a.asset_id,admin);
  const restored=call(h.context.restoreAsset_,{asset_id:a.asset_id,status:'Spare'},admin);
  assert.equal(restored.status,'Spare');assert.equal(h.read('Assets')[0].retired_at,'');
  assert(h.read('ActivityLog').some(r=>r.action==='RESTORE_ASSET'));
});

test('Admin deletion removes a trial from inventory and scan matching while reserving its ID',()=>{
  const h=setup(),asset=h.create({serial:'TRIAL-001'}),keep=h.create({serial:'KEEP-001'});
  const params={asset_id:asset.asset_id,expected_updated_at:asset.updated_at};
  assert.equal(h.context.assetFeatures_().asset_delete,1);
  assert.throws(()=>h.context.deleteAsset_(params,staff),/PERMISSION_DENIED/);
  assert.throws(()=>h.context.deleteAsset_({...params,expected_updated_at:'stale'},admin),/ITEM_CHANGED/);
  h.seed('AssetImages',[{asset_id:asset.asset_id,image_id:'TRIAL-IMAGE',drive_file_id:'TRIAL-FILE',active:true}]);
  assert.equal(h.context.deleteAsset_(params,admin),asset.asset_id);
  assert.equal(h.context.deleteAsset_(params,admin),asset.asset_id);
  assert.equal(h.read('ActivityLog').filter(row=>row.action==='DELETE_ASSET').length,1);
  assert.equal(h.read('Assets').find(row=>row.asset_id===asset.asset_id).status,'Deleted');
  assert.equal(h.read('AssetImages').length,1);
  assert.throws(()=>h.context.getImageData_('TRIAL-FILE'),/Image not found/);
  assert.throws(()=>h.context.getAssetBundle_(asset.asset_id,admin),/ASSET_DELETED/);
  assert.throws(()=>h.context.retireAsset_(asset.asset_id,admin),/Asset not found/);
  assert.equal(h.context.matchIdentifier_(asset.asset_id).found,false);
  assert.equal(h.context.matchIdentifier_('TRIAL-001').found,false);
  assert.deepEqual(call(h.context.listAssets_,{include_retired:true}).map(row=>row.asset_id),[keep.asset_id]);
  const synced=call(h.context.syncChanges_,{since:asset.updated_at},admin);
  assert(synced.removed_asset_ids.includes(asset.asset_id));
  assert(synced.deleted_asset_ids.includes(asset.asset_id));
  assert(synced.assets.every(row=>row.asset_id!==asset.asset_id));
  const replacement=h.create({serial:'TRIAL-001'});
  assert.notEqual(replacement.asset_id,asset.asset_id);
  assert.equal(h.context.matchIdentifier_('TRIAL-001').asset.asset_id,replacement.asset_id);
});

test('deletion leaves linked assets and active maintenance intact',()=>{
  const h=setup(),parent=h.create(),child=h.create({parent_asset_id:parent.asset_id}),other=h.create();
  const remove=asset=>h.context.deleteAsset_({asset_id:asset.asset_id,expected_updated_at:asset.updated_at},admin);
  assert.throws(()=>remove(parent),/Unlink its linked assets/);
  h.context.createMaintenance_({asset_id:other.asset_id,issue:'Check screen'},staff);
  assert.throws(()=>remove(other),/open maintenance tickets/);
  assert.equal(remove(child),child.asset_id);
  assert.equal(remove(parent),parent.asset_id);
  assert.equal(h.read('Assets').find(row=>row.asset_id===other.asset_id).status,'Active');
});

test('unmerge restores the source, moves its history back and reverts only untouched target fields',()=>{
  const h=setup(),source=h.create({serial:'SRC-1',exact_location:'Desk 4'}),target=h.create({brand:'Dell'});
  h.seed('Maintenance',[{maintenance_id:'MNT-1',asset_id:source.asset_id,issue:'Flicker',status:'Open'}]);
  h.context.mergeAssets_({source_asset_id:source.asset_id,target_asset_id:target.asset_id},staff);
  assert.equal(h.read('Maintenance')[0].asset_id,target.asset_id);
  const merged=h.read('Assets').find(a=>a.asset_id===target.asset_id);assert.equal(merged.serial,'SRC-1');
  h.context.updateByKey_('Assets','asset_id',target.asset_id,{exact_location:'Edited after merge'});
  call(h.context.unmergeAsset_,{source_asset_id:source.asset_id},staff);
  const rows=h.read('Assets'),s=rows.find(a=>a.asset_id===source.asset_id),t=rows.find(a=>a.asset_id===target.asset_id);
  assert.equal(s.status,'Active');assert.equal(s.serial,'SRC-1');assert.equal(s.source_ref,source.source_ref);
  assert.equal(t.serial,'');assert.equal(t.exact_location,'Edited after merge');
  assert.equal(h.read('Maintenance')[0].asset_id,source.asset_id);
  assert.throws(()=>h.context.unmergeAsset_({source_asset_id:source.asset_id},staff),/not merged/);
});

test('maintenance updates are merge-patches with validated status, and archived tickets leave lists and counts',()=>{
  const h=setup(),a=h.create(),b=h.create();
  const m=call(h.context.createMaintenance_,{asset_id:a.asset_id,issue:'Dead pixel'},staff);
  h.context.updateMaintenance_({maintenance_id:m.maintenance_id,status:'In Progress',assigned_to:'Ravi',cost:'50'},staff);
  h.context.updateMaintenance_({maintenance_id:m.maintenance_id,status:'Waiting Parts'},staff);
  let row=h.read('Maintenance')[0];assert.equal(row.assigned_to,'Ravi');assert.equal(String(row.cost),'50');
  assert.throws(()=>h.context.updateMaintenance_({maintenance_id:m.maintenance_id,status:'Done-ish'},staff),/Invalid maintenance status/);
  assert.throws(()=>h.context.updateMaintenance_({maintenance_id:m.maintenance_id,status:'Waiting Parts',issue:'Typo fix'},staff),/only be changed while the ticket is Open/);
  const open=call(h.context.createMaintenance_,{asset_id:a.asset_id,issue:'Wrong asset'},staff);
  h.context.updateMaintenance_({maintenance_id:open.maintenance_id,status:'Open',issue:'Right issue',asset_id:b.asset_id},staff);
  row=h.read('Maintenance').find(r=>r.maintenance_id===open.maintenance_id);assert.equal(row.issue,'Right issue');assert.equal(row.asset_id,b.asset_id);
  h.context.archiveMaintenance_({maintenance_id:open.maintenance_id},staff,true);
  assert.equal(h.context.listMaintenance_().length,1);assert.equal(h.context.listMaintenance_(true).length,2);
  assert.throws(()=>h.context.updateMaintenance_({maintenance_id:open.maintenance_id,status:'Completed'},staff),/Restore this maintenance record/);
  h.context.archiveMaintenance_({maintenance_id:open.maintenance_id},staff,false);
  assert.equal(h.context.listMaintenance_().length,2);
});

test('an audit can be renamed, results reset to pending, and cancelled; a cancelled audit is read-only',()=>{
  const h=setup(),a=h.create();
  const audit=call(h.context.startAudit_,{site_id:'SITE-TEST',name:'Q4 check'},staff);
  h.context.verifyAuditAsset_({audit_id:audit.audit_id,asset_id:a.asset_id},staff);
  assert.equal(h.read('AuditEntries')[0].result,'Verified');
  call(h.context.resetAuditEntry_,{audit_id:audit.audit_id,asset_id:a.asset_id},staff);
  assert.equal(h.read('AuditEntries')[0].result,'Pending');
  call(h.context.renameAudit_,{audit_id:audit.audit_id,name:'Q4 lobby check'},staff);
  assert.equal(h.read('Audits')[0].name,'Q4 lobby check');
  call(h.context.cancelAudit_,{audit_id:audit.audit_id},staff);
  assert.equal(h.read('Audits')[0].status,'Cancelled');
  assert.throws(()=>h.context.verifyAuditAsset_({audit_id:audit.audit_id,asset_id:a.asset_id},staff),/Active audit not found/);
  assert.throws(()=>h.context.renameAudit_({audit_id:audit.audit_id,name:'x'},staff),/in-progress/);
});

test('users are edited by id, never forked by a rename, and the last Admin cannot be removed',()=>{
  const h=setup();
  assert.throws(()=>h.context.saveUser_({username:'newbie',role:'STAFF'},admin),/password is required/);
  const boss=call(h.context.saveUser_,{username:'boss',role:'ADMIN',password:'secret-123'},admin);
  const staffer=call(h.context.saveUser_,{username:'amy',role:'STAFF',password:'secret-123'},admin);
  assert.throws(()=>h.context.saveUser_({username:'amy',password:'x'},admin),/already exists/);
  h.context.saveUser_({user_id:staffer.user_id,username:'renamed',name:'Amy Tan'},admin);
  const users=h.read('Users');assert.equal(users.length,2);assert.equal(users.find(u=>u.user_id===staffer.user_id).username,'amy');
  assert.throws(()=>h.context.saveUser_({user_id:boss.user_id,role:'STAFF'},admin),/your own Admin access/);
  assert.throws(()=>h.context.saveUser_({user_id:boss.user_id,active:'false'},{username:'someone-else',role:'ADMIN'}),/last active Admin/);
});

test('public image reads only serve registered photos, and admin references require a session',()=>{
  const h=setup();
  assert.throws(()=>h.context.getImageData_('ANY-DRIVE-FILE'),/Image not found/);
  assert.throws(()=>h.context.adminReferences_(''),/AUTH_REQUIRED/);
});

test('disabling and enabling a user keeps their name, email and role',()=>{
  const h=setup();
  call(h.context.saveUser_,{username:'boss',role:'ADMIN',password:'secret-123'},admin);
  const amy=call(h.context.saveUser_,{username:'amy',name:'Amy Tan',email:'amy@example.com',role:'STAFF',password:'secret-123'},admin);
  h.context.saveUser_({user_id:amy.user_id,active:'false'},admin);
  h.context.saveUser_({user_id:amy.user_id,active:'true'},admin);
  const row=h.read('Users').find(u=>u.user_id===amy.user_id);
  assert.equal(row.name,'Amy Tan');assert.equal(row.email,'amy@example.com');assert.equal(row.role,'STAFF');assert.equal(String(row.active),'true');
});

test('large values survive the per-value cache limit, and a partial set is never returned',()=>{
  const h=setup(),store=new Map();
  const fake={get:k=>store.get(k)??null,put:(k,v)=>store.set(k,v),putAll:o=>{for(const k in o)store.set(k,o[k]);},getAll:keys=>Object.fromEntries(keys.filter(k=>store.has(k)).map(k=>[k,store.get(k)])),remove:k=>store.delete(k)};
  h.context.CacheService={getScriptCache:()=>fake};
  const text='x'.repeat(120000);h.context.cachePutLarge_('boot',text,90);
  assert(store.size>2);assert.equal(h.context.cacheGetLarge_('boot'),text);
  store.delete('boot_1');assert.equal(h.context.cacheGetLarge_('boot'),'');
  h.context.cachePutLarge_('boot',text,90);h.context.cacheRemoveLarge_('boot');assert.equal(h.context.cacheGetLarge_('boot'),'');
});

test('log reads return only the newest rows, in order',()=>{
  const h=setup();
  h.seed('ActivityLog',Array.from({length:50},(_,i)=>({timestamp:'t'+i,action:'A'+i})));
  h.context.clearRequestCache_();
  assert.deepEqual(h.context.tailObjects_('ActivityLog',2).map(r=>r.action),['A48','A49']);
});
