const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {create}=require('../public/save-queue.js');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const fields=serial=>({category:'Camera',brand:'',model:'',serial,site_id:'SITE-TEST',area:'Entrance',custom_json:'{}'});
function setup(extra={}){
  const backend=createHarness(),data=new Map(),calls=[],user=extra.user||{username:'staff',role:'STAFF'};let online=false,lose=false;
  const storage={all:async()=>structuredClone([...data.values()]),put:async row=>data.set(row.id,structuredClone(row))};
  const api={post:async(action,p)=>{calls.push({action,params:structuredClone(p)});if(action==='saveAssetOperation'){const result=JSON.parse(JSON.stringify(backend.context.saveAssetOperation_(p,user)));if(lose){lose=false;throw new Error('Lost reply');}return {result};}if(user.role==='GUEST')backend.context.assertGuestImageAdd_(p.assetId,p.guest_upload_token);return {image:{image_id:p.operation_id,uploaded_at:new Date().toISOString()}};}};
  const options={scope:'test|staff|STAFF',storage,api,online:()=>online,lock:fn=>fn(),prepare:async()=>({base64Data:'once'}),...extra};
  return {backend,data,calls,options,q:create(options),online:()=>online=true,lose:()=>lose=true};
}
test('simple linked creates persist offline, wait for confirmed main ID and never generate set records',async()=>{
  const h=setup(),root=randomUUID(),child=randomUUID();await h.q.enqueue({id:root,kind:'create',params:fields('ROOT')});await h.q.enqueue({id:child,kind:'create',parent:root,params:fields('CHILD'),photos:[{file:new Blob(['raw'])}],evidence:{type:'scan',overrides:{serial:'CHILD'},photos:[{ocr:{text:'Serial: CHILD'}}]}});assert.equal(h.calls.length,0);h.online();await h.q.pump();const assets=h.backend.read('Assets');assert.equal(assets.length,2);assert.equal(assets[1].parent_asset_id,assets[0].asset_id);assert.ok(assets.every(a=>!a.set_id&&!a.set_name));assert.equal(h.calls[1].params.operation_json.includes(assets[0].asset_id),true);assert.deepEqual(h.calls.map(c=>c.action),['saveAssetOperation','saveAssetOperation','uploadImage']);assert.equal((await h.q.rows())[1].evidence.overrides.serial,'CHILD');
});
test('lost response reconciles the same operation after reopening, preserving reviewed bytes',async()=>{
  const h=setup(),id=randomUUID();await h.q.enqueue({id,kind:'create',params:fields('A')});h.online();h.lose();await h.q.pump();assert.equal(h.backend.read('Assets').length,1);const q=create(h.options);await q.retry(id);await q.pump();await new Promise(r=>setTimeout(r,10));assert.equal(h.backend.read('Assets').length,1);assert.equal((await q.rows())[0].state,'Saved');assert.deepEqual(h.calls[0].params,h.calls[1].params);
});
test('a frozen uncertain save cannot be edited; definite duplicate rejection retains evidence for review',async()=>{
  const h=setup(),id=randomUUID();h.backend.seed('Assets',[{asset_id:'EXISTING',serial:'A'}]);await h.q.enqueue({id,kind:'create',params:fields('A'),evidence:{type:'scan',photos:[{ocr:{text:'Serial: A'}}]}});h.online();await h.q.pump();assert.match((await h.q.rows())[0].error,/OPERATION_NOT_STARTED:.*DUPLICATE_SERIAL/);await h.q.revise(id,fields('NEW'),[],{kind:'create'});await new Promise(r=>setTimeout(r,10));assert.equal(h.backend.read('Assets').length,2);assert.equal((await h.q.rows())[0].evidence.photos[0].ocr.text,'Serial: A');await assert.rejects(h.q.revise(id,fields('X'),[]),/Reconcile/);
});
test('new metadata queued during compression is sent before the prepared photo',async()=>{
  let h,once=true;h=setup({prepare:async()=>{if(once){once=false;await h.q.enqueue({id:randomUUID(),kind:'create',params:fields('SECOND')});}return {base64Data:'once'};}});await h.q.enqueue({id:randomUUID(),kind:'create',params:fields('FIRST'),photos:[{file:new Blob(['photo'])}]});h.online();await h.q.pump();assert.deepEqual(h.calls.map(c=>c.action),['saveAssetOperation','saveAssetOperation','uploadImage']);
});
test('Guest proof resumes only its own onboarding and upload grants are not persisted',async()=>{
  let allowed=false;const h=setup({user:{username:'guest',role:'GUEST'},guestKey:randomUUID(),scope:'endpoint|guest-session|GUEST',photosAllowed:()=>allowed}),id=randomUUID();await h.q.enqueue({id,kind:'create',params:fields('GUEST'),photos:[{file:new Blob(['photo'])}]});h.online();await h.q.pump();let row=(await h.q.rows())[0];assert.equal(row.state,'Uploading photos');assert.equal(row.asset.guest_upload_token,undefined);assert.equal(row.params.guest_upload_token,undefined);allowed=true;const resumed=create(h.options);await resumed.pump();assert.equal((await resumed.rows())[0].state,'Saved');assert.equal(h.backend.read('Assets').length,1);assert.equal(h.calls.filter(c=>c.action==='saveAssetOperation').length,2);assert.ok(h.calls.find(c=>c.action==='uploadImage').params.guest_upload_token);const other=create({...h.options,scope:'endpoint|other-user|STAFF'});assert.deepEqual(await other.rows(),[]);
});
test('an expired session pauses writes, notifies the owner and keeps all drafts in their scope',async()=>{
  let expired=true,notified=0;const h=setup({onAuthRequired:()=>notified++}),original=h.options.api.post;h.options.api.post=async(action,p)=>{if(expired)throw new Error('SESSION_EXPIRED');return original(action,p);};const id=randomUUID();await h.q.enqueue({id,kind:'create',params:fields('A')});await h.q.enqueue({id:randomUUID(),kind:'create',params:fields('B')});h.online();await h.q.pump();await h.q.pump();assert.equal(notified,1);assert.equal(h.backend.read('Assets').length,0);expired=false;await h.q.retry(id);await new Promise(r=>setTimeout(r,10));assert.equal(h.backend.read('Assets').length,2);
});
