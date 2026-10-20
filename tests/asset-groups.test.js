const {test}=require('node:test'),assert=require('node:assert/strict');
const G=require('../public/asset-groups.js');
const a=(id,extra={})=>({asset_id:id,category:'Monitor',brand:'Sample',model:'M-10',specifications:'Size: 24 inch',serial:'',updated_at:'2026-01-01',...extra});
test('sets are shown once, retain every component and do not inflate physical counts',()=>{
  const rows=[a('A',{set_id:'SET-EXAMPLE0001',set_name:'Station 1'}),a('B',{category:'Keyboard',brand:'',model:'',set_id:'SET-EXAMPLE0001',set_name:'Station 1'}),a('C'),a('D',{serial:'DIFFERENT'})];
  const index=G.buildIndex(rows),entries=G.project(rows,index);
  assert.deepEqual(entries.map(e=>[e.kind,e.assets.length]),[['set',2],['model',2]]);
  assert.equal(entries.reduce((n,e)=>n+e.assets.length,0),4);
  assert.equal(G.project(rows,index,{grouped:false}).length,4);
});
test('different serials and missing serials group by product without merging records',()=>{
  const rows=[a('A',{serial:'001'}),a('B',{serial:'002'}),a('C')],index=G.buildIndex(rows);
  assert.equal(G.project(rows,index)[0].assets.length,3);assert.equal(index.serials.size,2);
  assert.deepEqual(G.project([rows[1]],index).map(e=>[e.assets.length,e.total]),[[1,3]]);
});
test('model revisions, specs, capacities and unmarked models are not guessed into one group',()=>{
  const rows=[a('A'),a('B',{model:'M10'}),a('C',{specifications:'Size: 27 inch'}),a('D',{model:''}),a('E',{model:''}),a('F',{brand:'Unknown'}),a('G',{brand:'Unknown'})];
  const entries=G.project(rows,G.buildIndex(rows));assert.equal(entries.length,5);assert.equal(entries.filter(e=>e.kind==='unmarked').length,2);
});
test('repeated JCP summaries render once, but repeated serials keep both records for review',()=>{
  const rows=[a('A',{serial:'001-ABC'}),a('A',{serial:'001-ABC'}),a('B',{serial:'001ABC'}),a('C',{status:'Merged'})],index=G.buildIndex(rows);
  assert.equal(index.all.length,2);assert.deepEqual(index.serials.get('001ABC'),['A','B']);assert.equal(G.project(rows,index)[0].assets.length,2);
});
test('new-unit templates cannot inherit identity, membership, photos or placement',()=>{
  const draft=G.template(a('A',{serial:'SECRET',set_id:'SET-EXAMPLE0001',images:[{}],assigned_to:'Someone',site_id:'SITE-TEST',specifications:'RAM: 8 GB\nIMEI: 001234567890\nMAC Address: AA:BB:CC:DD:EE:FF\nHostname: Unique-host\nPart Number: SHARED',private_details:{account_number:'not-for-copying'}}));
  assert.deepEqual(Object.keys(draft).sort(),['brand','category','category_id','model','specifications']);
  assert.equal(draft.specifications,'RAM: 8 GB\nPart Number: SHARED');
});
test('serial warnings distinguish missing serials, shared codes and selected existing records',()=>{
  const index=G.buildIndex([a('A',{serial:'001ABC'})]);
  assert.equal(G.duplicateSerials([{serial:''},{serial:''}],index).length,0);
  assert.equal(G.duplicateSerials([{serial:'002ABC'},{serial:'002ABC'}],index).length,1);
  assert.equal(G.duplicateSerials([{existing_asset_id:'A'},{serial:'001ABC'}],index).length,1);
  assert.equal(G.matchKind({asset:a('A',{serial:'001ABC'}),reasons:['same model']},{serial:'002ABC'}),'different_unit');
  assert.equal(G.matchKind({asset:a('A',{serial:'001ABC'}),reasons:['matching imei']},{serial:'002ABC'}),'identity');
});
test('unit-specific typed identifiers do not split otherwise identical model groups',()=>{
  const rows=[a('A',{specifications:'RAM: 8 GB\nMAC: AA:BB:CC:DD:EE:FF\nHostname: Station-A'}),a('B',{specifications:'RAM: 8 GB\nMAC: AA:BB:CC:DD:EE:00\nHostname: Station-B'})];
  assert.equal(G.project(rows,G.buildIndex(rows)).length,1);
});
