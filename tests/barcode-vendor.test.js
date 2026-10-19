const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const manifest=require('../public/vendor/zxing-wasm/provenance.json');
const zxing=require('zxing-wasm/reader');
test('vendored barcode binaries match the pinned package and published WASM checksum',()=>{
  assert.equal(zxing.ZXING_WASM_VERSION,manifest.version);
  assert.equal(zxing.ZXING_CPP_COMMIT,manifest.zxingCppCommit);
  const sources={'reader.js':'dist/iife/reader/index.js','zxing_reader.wasm':'dist/reader/zxing_reader.wasm'};
  for(const [name,source] of Object.entries(sources)){
    const local=fs.readFileSync(path.resolve(__dirname,'../public/vendor/zxing-wasm',name));
    const upstream=fs.readFileSync(path.resolve(__dirname,'../node_modules/zxing-wasm',source));
    assert(local.equals(upstream),`${name} differs from the pinned package`);
    assert.equal(crypto.createHash('sha256').update(local).digest('hex'),manifest.files[name].sha256);
  }
  assert.equal(manifest.files['zxing_reader.wasm'].sha256,zxing.ZXING_WASM_SHA256);
});
