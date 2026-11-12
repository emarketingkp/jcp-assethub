const {test}=require('node:test');
const assert=require('node:assert/strict');
const {present,specifications,highlights,fields}=require('../public/asset-detail-view.js');
test('detail highlights use saved labels across asset types without inventing technical fields',()=>{
  assert.deepEqual(highlights({specifications:'Color: BLACK\nTip Diameter: 0.5mm\nLine Quality: FINE'}),[{label:'Color',value:'BLACK'},{label:'Tip Diameter',value:'0.5mm'},{label:'Line Quality',value:'FINE'}]);
  assert.deepEqual(highlights({specifications:'250GB HDD'}),[]);
  assert.deepEqual(highlights({}),[]);
  assert.deepEqual(highlights({specifications:'Manufacturer: HP\nDevice ID: abc\nRAM: 8 GB\nCPU: i5'}),[{label:'RAM',value:'8 GB'},{label:'CPU',value:'i5'}]);
});
test('details keep all saved specification text and conflicts; URLs and prose stay readable',()=>{
  const text='Color: black\r\nColor: blue\r\nhttps://example.test/info\r\nFree form information';
  assert.deepEqual(specifications(text),[{label:'Color',value:'black'},{label:'Color',value:'blue'},{label:'',value:'https://example.test/info'},{label:'',value:'Free form information'}]);
  assert.equal(text.includes('\r\n'),true);
  assert.equal(specifications('Time: 12:30')[0].value,'12:30');
});
test('zero and false custom values remain present and all rendered text is escaped',()=>{
  assert(present(0));assert(present(false));assert(!present(' '));assert(!present(null));
  const html=fields([['<img onerror=evil()>',0],['Enabled',false],['Missing','']]);
  assert(!html.includes('<img'));assert(html.includes('&lt;img'));assert(html.includes('<dd>0</dd>'));assert(html.includes('<dd>false</dd>'));assert(html.includes('Not recorded'));
});
