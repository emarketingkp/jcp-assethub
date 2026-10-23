const {test}=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../public/save-queue.js');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const params=serial=>({category:'Monitor',brand:'Sample',model:'M-10',serial,site_id:'SITE-TEST',area:'Test Area',custom_json:'{}'});
function setup(overrides={}){
  const data=new Map(),backend=createHarness(),calls=[];
  let online=false,lose=false;
  const storage={all:async()=>structuredClone([...data.values()]),put:async row=>data.set(row.id,structuredClone(row))};
  const api={post:async(action,p)=>{
    calls.push({action,p:structuredClone(p)});
    if(action==='saveAssetBatch'){const result=backend.request(p);if(lose){lose=false;throw new Error('Lost reply');}return {result};}
    return {image:{image_id:p.operation_id}};
  }};
  const options={scope:'user-A',storage,api,online:()=>online,lock:fn=>fn(),prepare:async()=>({base64Data:'fixture'}),...overrides};
  const q=create(options);
  return {q,data,backend,calls,options,setOnline:v=>{online=v;},lose:()=>{lose=true;}};
}
test('local persistence happens offline before any backend request',async()=>{
  const h=setup();await h.q.enqueue({id:'11111111-1111-4111-8111-111111111111',params:params('A'),photos:[{file:new Blob(['photo'])}]});
  assert.equal(h.calls.length,0);assert.equal((await h.q.rows())[0].photos[0].file.size,5);
});
test('failed local persistence rejects without sending a write',async()=>{
  const h=setup({storage:{all:async()=>[],put:async()=>{throw new Error('Quota exceeded');}}});
  await assert.rejects(h.q.enqueue({id:'op',params:params('A')}),/Quota/);assert.equal(h.calls.length,0);
});
test('lost metadata reply reconciles on reopen using the identical operation',async()=>{
  const h=setup(),id='11111111-1111-4111-8111-111111111111';await h.q.enqueue({id,params:params('A')});h.lose();h.setOnline(true);await h.q.pump();
  assert.equal(h.backend.read('Assets').length,1);assert.equal((await h.q.rows())[0].state,'Retry');
  const q=create(h.options);await q.retry(id);await new Promise(r=>setTimeout(r,10));
  assert.equal(h.backend.read('Assets').length,1);assert.equal((await q.rows())[0].state,'Saved');assert.deepEqual(h.calls[0].p,h.calls[1].p);
});
test('components await root confirmation; metadata precedes photos and no container is created',async()=>{
  const h=setup(),root='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
  await h.q.enqueue({id:root,params:params('ROOT'),setName:'Desk A',photos:[{file:new Blob(['a'])}]});
  await h.q.enqueue({id:child,parent:root,params:params('CHILD'),setName:'Desk A',photos:[{file:new Blob(['b'])}]});
  h.setOnline(true);await h.q.pump();
  assert.deepEqual(h.calls.map(c=>c.action),['saveAssetBatch','saveAssetBatch','uploadImage','uploadImage']);
  const rows=h.backend.read('Assets');assert.equal(rows.length,2);assert.ok(rows[0].set_id);assert.equal(rows[0].set_id,rows[1].set_id);assert.notEqual(rows[0].asset_id,rows[1].asset_id);assert.equal(rows[1].parent_asset_id,rows[0].asset_id);
});
test('failed root leaves dependent components unsent and actionable',async()=>{
  const h=setup(),root='11111111-1111-4111-8111-111111111111';await h.q.enqueue({id:root,params:{...params('A'),site_id:'bad'},setName:'Desk A'});await h.q.enqueue({id:'22222222-2222-4222-8222-222222222222',parent:root,params:params('B')});
  h.setOnline(true);await h.q.pump();assert.equal(h.calls.length,1);assert.equal(h.backend.read('Assets').length,0);assert.match((await h.q.rows())[0].error,/site/i);
});
test('scope isolation and expired session pause prevent another actor sending work',async()=>{
  let active=true;const h=setup({active:()=>active}),id='11111111-1111-4111-8111-111111111111';await h.q.enqueue({id,params:params('A')});
  const other=create({...h.options,scope:'user-B'});assert.deepEqual(await other.rows(),[]);
  active=false;h.setOnline(true);await h.q.pump();assert.equal(h.calls.length,0);
});
test('photos pause during interactive scans; metadata still saves and compressed bytes are reused',async()=>{
  let allowed=false,prepared=0,fail=true;const h=setup({photosAllowed:()=>allowed,prepare:async()=>{prepared++;return {base64Data:'once'};}});
  const original=h.options.api.post;h.options.api.post=async(a,p)=>{if(a==='uploadImage'&&fail){fail=false;throw new Error('Upload timeout');}return original(a,p);};
  const id='11111111-1111-4111-8111-111111111111';await h.q.enqueue({id,params:params('A'),photos:[{file:new Blob(['a'])}]});h.setOnline(true);await h.q.pump();assert.equal((await h.q.rows())[0].state,'Uploading photos');assert.equal(prepared,0);
  allowed=true;await h.q.pump();assert.equal((await h.q.rows())[0].state,'Retry');await h.q.retry(id);await new Promise(r=>setTimeout(r,10));assert.equal(prepared,1);assert.equal((await h.q.rows())[0].state,'Saved');
});
test('server checks duplicates even when client summaries are stale',async()=>{
  const h=setup();h.backend.seed('Assets',[{asset_id:'EXISTING',serial:'A'}]);await h.q.enqueue({id:'11111111-1111-4111-8111-111111111111',params:params('A')});h.setOnline(true);await h.q.pump();assert.equal(h.backend.read('Assets').length,1);assert.match((await h.q.rows())[0].error,/DUPLICATE_SERIAL/);
});
test('a definitively rejected draft can be corrected; uncertain requests cannot be edited',async()=>{
  const h=setup(),id='11111111-1111-4111-8111-111111111111';await h.q.enqueue({id,params:{...params('A'),site_id:'bad'}});h.setOnline(true);await h.q.pump();
  await h.q.revise(id,params('A'),[]);await new Promise(r=>setTimeout(r,10));assert.equal(h.backend.read('Assets').length,1);await assert.rejects(h.q.revise(id,params('B'),[]),/Reconcile/);
});
test('authentication errors pause subsequent writes until explicit retry after sign-in',async()=>{
  let authenticated=false;const h=setup();const post=h.options.api.post;
  h.options.api.post=async(a,p)=>{if(!authenticated){h.calls.push({action:a,p});throw new Error('AUTH_REQUIRED');}return post(a,p);};
  const first='11111111-1111-4111-8111-111111111111';await h.q.enqueue({id:first,params:params('A')});await h.q.enqueue({id:'22222222-2222-4222-8222-222222222222',params:params('B')});h.setOnline(true);await h.q.pump();await h.q.pump();assert.equal(h.calls.length,1);
  authenticated=true;await h.q.retry(first);await new Promise(r=>setTimeout(r,10));assert.equal(h.backend.read('Assets').length,2);
});
test('photo-only operations do not persist private detail fields or upload credentials',async()=>{
  const h=setup();await h.q.enqueuePhotos({id:'11111111-1111-4111-8111-111111111111',asset:{asset_id:'A',model:'M',private_details:{account_number:'private'},guest_upload_token:'never-store'},photos:[{file:new Blob(['photo']),type:'condition'}]});const row=(await h.q.rows())[0];assert.equal(row.asset.private_details,undefined);assert.equal(row.params.guest_upload_token,undefined);assert.equal(row.photos[0].file.size,5);
});

test('multiple units persist atomically before starting any writes, in input order',async()=>{
  let online=false;const data=new Map(),calls=[];
  const storage={all:async()=>structuredClone([...data.values()]),put:async r=>data.set(r.id,structuredClone(r)),putMany:async rows=>{for(const r of rows)data.set(r.id,structuredClone(r));}};
  const q=create({scope:'atomic',protocol:2,storage,online:()=>online,lock:fn=>fn(),api:{post:async(a,p)=>{calls.push(p);return {result:{asset:{asset_id:'A'+calls.length,images:[]}}};}}});
  await q.enqueueMany([{id:'Z',kind:'create',params:params('1')},{id:'A',kind:'create',params:params('2')}]);
  assert.equal(calls.length,0);assert.deepEqual((await q.rows()).map(r=>r.id),['Z','A']);online=true;await q.pump();
  assert.deepEqual(calls.map(p=>JSON.parse(p.operation_json).fields.serial),['1','2']);
});
test('failure to persist a multi-unit transaction sends none of its units',async()=>{
  let writes=0;const q=create({scope:'atomic-fail',protocol:2,storage:{all:async()=>[],putMany:async()=>{throw new Error('Quota exceeded');}},online:()=>true,lock:fn=>fn(),api:{post:async()=>{writes++;}}});
  await assert.rejects(q.enqueueMany([{id:'one',params:params('1')},{id:'two',params:params('2')}]),/Quota/);assert.equal(writes,0);
});
test('choosing a pending photo waits for its upload and uses the real image ID and latest revision',async()=>{
  let online=false;const data=new Map(),calls=[];
  const storage={all:async()=>structuredClone([...data.values()]),put:async r=>data.set(r.id,structuredClone(r))};
  const api={get:async()=>({asset:{asset_id:'AS-1',updated_at:'latest-revision'}}),post:async(action,p)=>{calls.push({action,p});if(action==='uploadImage')return {image:{image_id:'REAL-IMAGE',image_type:'serial_label',active:true},asset_main_image_id:'OLD-MAIN'};return {result:{asset:{asset_id:'AS-1',main_image_id:JSON.parse(p.operation_json).fields.main_image_id,images:[]}}};}};
  const q=create({scope:'pending-main',protocol:2,storage,api,online:()=>online,lock:fn=>fn(),prepare:async()=>({base64Data:'fixture'})});
  const asset={asset_id:'AS-1',main_image_id:'OLD-MAIN',updated_at:'old-revision'};
  await q.enqueuePhotos({id:'photos',asset,photos:[{file:new Blob(['label']),type:'serial_label'}]});
  await q.enqueueMain({id:'choose',asset,image:{image_id:'photos-photo-0',_pending:true,_photoOperation:'photos'}});
  online=true;await q.pump();assert.deepEqual(calls.map(c=>c.action),['uploadImage','saveAssetOperation']);
  const operation=JSON.parse(calls[1].p.operation_json);assert.equal(operation.kind,'main_photo');assert.equal(operation.fields.main_image_id,'REAL-IMAGE');assert.equal(operation.expected_updated_at,'latest-revision');
});
