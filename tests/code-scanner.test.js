const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../public/code-scanner.js');

test('current JCP timestamp IDs work without accepting partial or embedded IDs',()=>{
  for(const value of ['JCP-AS-1700000000123','JCP-ASSET: JCP-AS-1700000000123','https://example.test/?asset=JCP-AS-1700000000123'])
    assert.equal(C.extractAssetId(value),'JCP-AS-1700000000123');
  for(const value of ['JCP-AS-12345678901234567','JCP-AS-123abc','prefix JCP-AS-123','https://example.test/JCP-AS-123'])assert.equal(C.extractAssetId(value),'');
});
test('links and shared retail product codes cannot become serial candidates',()=>{
  for(const value of ['http://consumer.example.test/verification.html','javascript:alert(1)','WIFI:T:WPA;S:Example','www.example.test','example.test/warranty'])assert.equal(C.classify({value,format:'QRCode'}).kind,'link');
  for(const format of ['EAN-13','ean_8','UPC-A'])assert.equal(C.classify({value:'0012345678905',format}).kind,'product_code');
  assert.equal(C.classify({value:'JCP-AS-1700000000123',format:'QRCode'}).kind,'asset_id');
});
test('unapproved barcode observations preserve leading zeros and exact serial characters',()=>{
  assert.equal(C.classify({value:'001O0I1234',format:'Code128'}).serialCandidate,'001O0I1234');
  assert.equal(C.classify({value:'S/N: 001O0I1234',format:'Code128'}).serialCandidate,'001O0I1234');
  for(const value of ['abc\ndef','A'.repeat(65),'<script>bad</script>','12'])assert.equal(C.classify({value}).kind,'other');
});
