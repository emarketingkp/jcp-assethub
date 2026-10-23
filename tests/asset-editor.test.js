const {test}=require('node:test');
const assert=require('node:assert/strict');
const editor=require('../public/asset-editor.js');
const media=require('../public/asset-media.js');
const groups=require('../public/asset-groups.js');
test('unit names label assets without changing product grouping or fallback identity',()=>{
  const product={category:'Pump',brand:'Flow',model:'100',specifications:'Power: 1 kW'};
  const a={...product,asset_id:'A',asset_name:'Utility room pump',serial:'001'},b={...product,asset_id:'B',asset_name:'Workshop pump',serial:'002'};
  assert.equal(groups.modelKey(a),groups.modelKey(b));assert.equal(editor.displayName(a),'Utility room pump');assert.equal(editor.displayName({...b,asset_name:''}),'Flow 100 · B');
  assert.notEqual(groups.modelKey({...a,specifications:'Power: 2 kW'}),groups.modelKey(b));
});
test('only explicitly proposed and approved fields change; explicit blanks can clear',()=>{
  const old={asset_name:'Desk',category:'Furniture',serial:'001',assigned_to:'Team',exact_location:'Door'};
  const incoming={serial:'',asset_name:'New desk',assigned_to:'Other'};
  assert.deepEqual(editor.reviewed(old,incoming,{serial:'incoming',assigned_to:'existing'}),{serial:''});
  assert(!editor.changes(old,incoming).some(f=>f.key==='exact_location'));
});
test('learned choices are deduplicated, contextual, and include locally accepted drafts',()=>{
  const assets=[{category:'Pump',brand:'Flow',model:'100',site_id:'A',area:'Workshop'},{category:'Chair',brand:'Flow',model:'Seat',site_id:'B',area:'Lobby'}];
  assert.deepEqual(editor.choices('model',{assets,brand:'flow',category:'Pump'}),['100']);
  assert.deepEqual(editor.choices('area',{assets,site_id:'A',pending:[{params:{site_id:'A',area:'Annex'}}]}),['Annex','Workshop']);
  assert.deepEqual(editor.choices('category',{assets,pending:[{params:{category:'pump'}},{params:{category:'Fixture'}}]}),['Chair','Fixture','Pump']);
});
test('serial popup accepts one exact identifier and rejects links, asset tags and ambiguity',()=>{
  assert.equal(media.serialCandidate([{rawValue:'000oO1iI23'}]),'000oO1iI23');
  assert.equal(media.serialCandidate([{value:'https://example.test/warranty'},{value:'SN-001'}]),'SN-001');
  assert.equal(media.serialCandidate([{value:'JCP-ASSET:123'}]),'');assert.equal(media.serialCandidate([{value:'001'},{value:'002'}]),'');
});
test('linked units inherit applicable shared custom values without private or unit identifiers',()=>{
  const defs=[{field_id:'COST',label:'Cost centre'},{field_id:'IMEI',label:'IMEI'},{field_id:'PHONE',label:'Mobile number'},{field_id:'ACCOUNT',label:'Account number'}];
  assert.deepEqual(editor.sharedCustom({COST:'Operations',IMEI:'001',PHONE:'123',ACCOUNT:'456'},defs),{COST:'Operations'});
});
