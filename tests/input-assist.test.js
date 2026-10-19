const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {createEngine}=require('../public/input-assist');
const R=require('../public/recognition-v27');
const data=require('../public/data/input-knowledge.json');
const engine=createEngine(data);
const categories=data.categories.map(r=>({category_id:r.categoryId,name:r.name,active:true}));
function observation(raw,legacy={}){return R.fromOcr({text:raw,fields:legacy},'image_01',engine.analyze(raw,{categories}));}

test('recognizes equipment brands missing from the old fallback',()=>{
  for(const brand of ['Ricoh','Mimaki','Honeywell','Xprinter'])assert.equal(engine.analyze(brand+'\nModel: TEST-1').fields.brand.value,brand);
});
test('brand aliases normalize without confusing HP and HPE',()=>{
  assert.equal(engine.analyze('Hewlett-Packard\nModel: A1').fields.brand.value,'HP');
  assert.equal(engine.analyze('Hewlett Packard Enterprise\nModel: A1').fields.brand.value,'HPE');
  assert.equal(engine.canonical('brand','TP LINK'),'TP-Link');
});
test('component brands do not replace equipment brands',()=>{
  assert.equal(engine.analyze('Dell\nProcessor: Intel Core i5\nGraphics: NVIDIA').fields.brand.value,'Dell');
  assert(!engine.analyze('Processor: Intel Core i5\nGraphics: NVIDIA').fields.brand);
});
test('multiple equipment brands remain ambiguous',()=>{
  const result=engine.analyze('Dell\nHP');assert(!result.fields.brand);assert.equal(result.suggestions.brand.length,2);
});
test('compatibility claims do not identify the equipment brand',()=>{
  assert(!engine.analyze('Compatible with Canon and Epson printers').fields.brand);
});
test('unknown labeled brands and exact model values are preserved',()=>{
  const r=observation('Brand: ClearTech\nModel: CX-870-Z');
  assert.equal(r.fields.brand.value,'ClearTech');assert.equal(r.fields.model.value,'CX-870-Z');
});
test('Malay and separate-line field labels work without AI',()=>{
  const r=observation('Jenama\nRicoh\nModel No: MP C3004\nNombor Siri: O01I2345');
  assert.equal(r.fields.brand.value,'Ricoh');assert.equal(r.fields.serial.value,'O01I2345');assert.equal(r.fields.model.value,'MP C3004');
});
test('manufacturer stays separate from brand and hostname stays separate from model',()=>{
  const r=observation('Manufacturer: OEM Works\nDevice Name: STAFF-PC-1');
  assert.equal(r.fields.manufacturer.value,'OEM Works');assert(!r.fields.brand);assert(!r.fields.model);
});
test('a known manufacturer does not silently become the marketed brand',()=>{
  for(const raw of ['Manufacturer: HP','Manufacturer\nHP']){
    const r=observation(raw);assert.equal(r.fields.manufacturer.value,'HP');assert(!r.fields.brand);
  }
});
test('horsepower and component specification values do not imply equipment brands',()=>{
  assert(!engine.analyze('Rated Power: 1.5 HP').fields.brand);
});
test('serial characters are never fuzzy-corrected',()=>{
  assert.equal(observation('Serial: O01I1234').fields.serial.value,'O01I1234');
  assert.deepEqual(engine.suggest('serial','O01I1234'),[]);
});
test('specific printer phrase wins over generic printer',()=>{
  assert.equal(engine.analyze('EPSON THERMAL RECEIPT PRINTER').fields.category.value,'Thermal Printer');
  assert.equal(engine.analyze('multifunction printer').fields.category.value,'Scanner Printer / MFP');
});
test('Windows, RAM, LCD and monitored are insufficient to guess a category',()=>{
  const r=observation('Device Specifications\nWindows Security\nYour PC is monitored and protected\nInstalled RAM: 16 GB\nLCD',{category:'Desktop PC'});
  assert(!r.fields.category);assert.equal(r.attributes.find(a=>a.key==='ram').value,'16 GB');
});
test('equally strong category evidence remains undecided',()=>{
  const r=engine.analyze('Laptop\nMonitor');assert(!r.fields.category);assert.equal(r.suggestions.category.length,2);
});
test('only active live categories are automatically suggested',()=>{
  assert(!engine.analyze('Laptop',{categories:[]}).fields.category);
  assert(!engine.analyze('Category: Laptop',{categories:[{category_id:'CAT-LAP',name:'Laptop',active:false}]}).fields.category);
  assert.equal(engine.analyze('Category: Komputer riba',{categories}).fields.category.value,'Laptop');
});
test('RAM and storage labels stay distinct and quantities are not invented',()=>{
  const r=observation('RAM: 8 GB\nSSD: 512 GB\nInput Voltage: 100-240 V\n512 GB');
  assert.equal(r.attributes.find(a=>a.key==='ram').value,'8 GB');
  assert.equal(r.attributes.find(a=>a.key==='ssd').value,'512 GB');
  assert.equal(r.attributes.filter(a=>a.key==='ram').length,1);
  assert(!engine.analyze('512 GB').attributes.length);
});
test('AI and local RAM labels consolidate under one key and expose disagreements',()=>{
  const local=observation('RAM: 8 GB\nInstalled memory: 16 GB');
  const attribute=engine.canonicalAttribute({key:'memory',label:'Installed RAM',value:'16 GB',evidence:'Installed memory: 16 GB',status:'supported'});
  assert.equal(attribute.key,'ram');
  const merged=R.attachAi(local,{attributes:[attribute]});
  assert(R.consolidate([merged]).conflicts.some(c=>c.id==='attr:ram'));
});
test('brand typo yields a suggestion, never a replacement',()=>{
  const r=engine.analyze('Brand: EP5ON');assert.equal(r.fields.brand.value,'EP5ON');
  assert.equal(engine.suggest('brand','EP5ON')[0].value,'Epson');
});
test('model suggestions are scoped to known brand and retain exact codes',()=>{
  const assets=[{brand:'HP',model:'P-100'},{brand:'Dell',model:'D-200'}];
  assert.deepEqual(engine.modelChoices('Hewlett-Packard',assets),['P-100']);
  assert.deepEqual(engine.modelChoices('',assets),[]);
  assert.deepEqual(engine.suggest('model','D-20X',{brand:'Dell',assets}),[]);
});
test('AI disagreement becomes an explicit conflict instead of replacing local evidence',()=>{
  const local=observation('Brand: Dell\nHP compatible label\nModel: D-200');
  const merged=R.attachAi(local,{fields:{brand:{value:'HP',evidence:'HP compatible label',status:'supported'}}},(k,v)=>engine.canonical(k,v,{categories}));
  assert.equal(merged.fields.brand.value,'Dell');
  assert(R.consolidate([merged]).hasUnresolved);
  assert(!R.consolidate([merged],{'field:brand':'Dell'}).hasUnresolved);
});
test('inferred AI category from generic Windows text requires manual confirmation',()=>{
  const local=observation('Windows Security');
  const result=R.attachAi(local,{fields:{category:{value:'Desktop PC',evidence:'Windows Security',status:'inferred'}}},(k,v)=>engine.canonical(k,v,{categories}));
  assert(!result.fields.category);assert.equal(result.suggestions.category[0].value,'Desktop PC');
});
test('manual overrides survive late AI and unsupported values remain rejected',()=>{
  const local=observation('Brand: Dell\nModel: D-200\nSerial: O01I1234');
  const merged=R.attachAi(local,{fields:{serial:{value:'FAKE-123',evidence:'Serial: O01I1234',status:'supported'}}});
  assert.equal(R.toIncoming(R.consolidate([merged]),{brand:'Manual brand'}).brand,'Manual brand');
  assert.equal(merged.fields.serial.value,'O01I1234');
});
test('schema, size, alias collisions and dangerous label keys are rejected',()=>{
  assert.throws(()=>createEngine({...data,schemaVersion:2}));
  assert.throws(()=>createEngine({...data,padding:'x'.repeat(100001)}));
  assert.throws(()=>createEngine({...data,brands:[{name:'A',aliases:['same']},{name:'B',aliases:['same']}]}));
  assert.throws(()=>createEngine({...data,fieldLabels:{...data.fieldLabels,constructor:['bad']}}));
});
test('offline or malformed refresh retains the last validated dictionary',async()=>{
  const code=fs.readFileSync(require.resolve('../public/input-assist'),'utf8');
  for(const broken of ['offline','malformed']){
    let writes=0;
    const window={AssetStore:{get:async()=>data,set:async()=>{writes++;}}};
    const context={window,AbortController,setTimeout,clearTimeout,fetch:async()=>{
      if(broken==='offline')throw new Error('offline');
      return {ok:true,text:async()=>'{bad json'};
    }};
    vm.runInNewContext(code,context);
    const e=await window.AssetInput.ready();await new Promise(r=>setTimeout(r,0));
    assert.equal(e.version,data.dataVersion);assert.equal(window.AssetInput.current.version,data.dataVersion);assert.equal(writes,0);
  }
});
