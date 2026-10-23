const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
function photos(){
  const h=createHarness({assets:[{asset_id:'A',brand:'Sample',model:'M',status:'Active'}]});
  const files=new Map();let counter=0;
  const folder={getFilesByName:name=>{const file=files.get(name);let used=false;return {hasNext:()=>!!file&&!used,next:()=>{used=true;return file;}};},createFile:blob=>{const file={getId:()=>String(++counter),getName:()=>blob.name};const id=String(++counter);file.getId=()=>id;files.set(blob.name,file);return file;}};
  h.context.getOrCreateAssetFolder_=()=>folder;
  h.context.Utilities.base64Decode=value=>Buffer.from(value,'base64');h.context.Utilities.newBlob=(bytes,mime,name)=>({bytes,mime,name});
  const user={username:'staff',role:'STAFF'};
  const p={assetId:'A',operation_id:'11111111-1111-4111-8111-111111111111-photo-0',base64Data:'YQ==',thumbnailBase64:'Yg==',mimeType:'image/webp',imageType:'main'};
  return {...h,files,p,user,send:()=>h.context.uploadQueuedImage_(p,user)};
}
test('queued photo replay after a lost response creates one image and two Drive files',()=>{
  const h=photos(),first=h.send(),second=h.send();assert.equal(first.image_id,second.image_id);assert.equal(h.read('AssetImages').length,1);assert.equal(h.files.size,2);assert.equal(h.read('Assets')[0].main_image_id,first.image_id);
});
test('queued photo recovers Drive files after uncertain spreadsheet write',()=>{
  const h=photos();h.fail({sheet:'AssetImages',when:'before'});assert.throws(h.send,/Injected/);assert.equal(h.files.size,2);h.send();assert.equal(h.files.size,2);assert.equal(h.read('AssetImages').length,1);
});
test('queued photo repairs asset touch after image row committed but asset update failed',()=>{
  const h=photos();h.fail({sheet:'Assets',when:'before'});assert.throws(h.send,/Injected/);const image=h.read('AssetImages')[0];assert.ok(image);h.send();assert.equal(h.read('Assets')[0].main_image_id,image.image_id);assert.equal(h.files.size,2);
});
test('queued photo rejects changed payload and expired/guest permissions',()=>{
  const h=photos();h.send();h.p.base64Data='Yw==';assert.throws(h.send,/REQUEST_REUSED/);assert.throws(()=>h.context.uploadQueuedImage_(h.p,{role:'GUEST'}),/AUTH|permission|Staff|Access/i);
});
test('summary pagination returns every item and required list fields without duplication',()=>{
  const assets=Array.from({length:511},(_,i)=>({asset_id:'A-'+String(i).padStart(4,'0'),brand:'Sample',model:'M',serial:'S-'+i,site_id:'SITE-TEST',area:'Desk',assigned_to:'Staff',status:'Active'}));
  const h=createHarness({assets}),seen=[];let cursor='';do{const page=h.context.assetSummaryPage_({after:cursor,page_size:200});seen.push(...page.assets);cursor=page.next_cursor;}while(cursor);
  assert.equal(seen.length,511);assert.equal(new Set(seen.map(a=>a.asset_id)).size,511);assert.equal(seen[300].serial,'S-300');assert.equal(seen[300].assigned_to,'Staff');
});
test('nonimage detail batches enforce size, omit image arrays and respect private permissions',()=>{
  const h=createHarness({assets:[{asset_id:'A',status:'Active'}]});h.seed('AssetPrivate',[{asset_id:'A',mobile_number:'private-fixture'}]);
  const guest=h.context.assetDetailsBatch_({ids_json:'["A"]'},{role:'GUEST'}).assets[0];assert.equal(guest.images,undefined);assert.equal(guest.private_details,undefined);
  const staff=h.context.assetDetailsBatch_({ids_json:'["A"]'},{role:'STAFF'}).assets[0];assert.equal(staff.private_details.mobile_number,'private-fixture');
  assert.throws(()=>h.context.assetDetailsBatch_({ids_json:JSON.stringify(Array(13).fill('A'))},{role:'GUEST'}),/12/);
});
test('completed photo replay does not undo a later chosen main photo or edit',()=>{
  const h=photos();h.send();h.context.updateByKey_('Assets','asset_id','A',{main_image_id:'NEWER-MAIN',model:'Manually edited',updated_at:'2099-01-01T00:00:00Z'});h.send();const a=h.read('Assets')[0];assert.equal(a.main_image_id,'NEWER-MAIN');assert.equal(a.model,'Manually edited');
});
test('server rejects parent cycles and removal of a parent with linked children',()=>{
  const h=createHarness(),root=h.batch({mode:'set',set_name:'Desk',common:{site_id:'SITE-TEST',area:'Test Area'},units:[{category:'Monitor',brand:'Sample',model:'M',serial:'ROOT'}]}).assets[0];
  const child=h.batch({mode:'set',set_id:root.set_id,set_name:root.set_name,parent_asset_id:root.asset_id,common:{site_id:'SITE-TEST',area:'Test Area'},units:[{category:'Monitor',brand:'Sample',model:'M',serial:'CHILD'}]}).assets[0];
  assert.equal(child.parent_asset_id,root.asset_id);
  assert.throws(()=>h.batch({mode:'attach',set_id:root.set_id,set_name:root.set_name,parent_asset_id:child.asset_id,common:{},units:[{existing_asset_id:root.asset_id,expected_updated_at:root.updated_at}]}),/cycle/);
  assert.throws(()=>h.batch({mode:'detach',set_id:root.set_id,set_name:root.set_name,common:{},units:[{existing_asset_id:root.asset_id,expected_updated_at:root.updated_at}]}),/components/);
});
test('a single ordinary asset retains unique specification evidence; shared multi-item fields do not',()=>{
  const h=createHarness(),p={mode:'same',common:{category:'Monitor',brand:'Sample',model:'M',specifications:'Serial: EVIDENCE-1',site_id:'SITE-TEST',area:'Test Area'},units:[{serial:'EVIDENCE-1'}]};assert.equal(h.batch(p).assets[0].specifications,'Serial: EVIDENCE-1');p.units=[{serial:'X'},{serial:'Y'}];assert.throws(()=>h.batch(p),/Unique device identifiers/);
});

test('distinct photo operations do not share deletable Drive files even when image bytes match',()=>{
  const h=photos();h.send();h.p.operation_id='22222222-2222-4222-8222-222222222222-photo-0';h.send();assert.equal(h.read('AssetImages').length,2);assert.equal(h.files.size,4);assert.notEqual(h.read('AssetImages')[0].drive_file_id,h.read('AssetImages')[1].drive_file_id);
});
test('delayed new main-photo upload cannot replace a main image chosen after it was queued',()=>{
  const h=photos();h.p.imageType='serial_label';h.p.make_main='true';h.p.expected_main_id='';
  h.context.updateByKey_('Assets','asset_id','A',{main_image_id:'LATER-CHOICE'});
  const result=h.send();assert.equal(result.asset_main_image_id,'LATER-CHOICE');assert.equal(h.read('Assets')[0].main_image_id,'LATER-CHOICE');assert.equal(result.image_type,'serial_label');
});
test('unfinished photo replay repairs metadata but respects a different selected main image',()=>{
  const h=photos();h.p.imageType='serial_label';h.p.make_main='true';h.p.expected_main_id='';
  h.fail({sheet:'Assets',when:'before'});assert.throws(h.send,/Injected/);
  h.context.updateByKey_('Assets','asset_id','A',{main_image_id:'LATER-CHOICE'});
  const replay=h.send();assert.equal(replay.asset_main_image_id,'LATER-CHOICE');assert.equal(h.read('Assets')[0].main_image_id,'LATER-CHOICE');assert.equal(h.files.size,2);
});
