/* Decodes observations only. A manufacturer code is never an approved serial. */
(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AssetCode=api;
})(typeof window!=='undefined'?window:null,function(root){
  const formats=['qr_code','code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','data_matrix','codabar'];
  function extractAssetId(value){
    const raw=String(value??'').trim();
    // Current timestamp IDs have 13 digits. Reject partial matches of longer IDs.
    const pattern=/^JCP-[A-Z0-9]{1,8}-\d{1,16}$/i;
    if(pattern.test(raw))return raw.toUpperCase();
    const tagged=raw.match(/^JCP-ASSET\s*:\s*(JCP-[A-Z0-9]{1,8}-\d{1,16})$/i);
    if(tagged)return tagged[1].toUpperCase();
    try{const id=new URL(raw).searchParams.get('asset');if(id&&pattern.test(id))return id.toUpperCase();}catch{}
    return '';
  }
  function classify(code){
    const value=String(code?.value??'').trim(),format=String(code?.format||'barcode');
    const assetId=extractAssetId(value);
    if(assetId)return {...code,value,format,kind:'asset_id',assetId,label:'JCP asset tag'};
    if((/^(?:[a-z][a-z\d+.-]*:|www\.)/i.test(value)&&!/^(?:SN|S\/N|SERIAL)\s*:/i.test(value))||/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?:[/?#]|$)/i.test(value))
      return {...code,value,format,kind:'link',label:'Link / structured code · not a serial'};
    if(/ean|upc|isbn/i.test(format))return {...code,value,format,kind:'product_code',label:'Product barcode · shared across units'};
    // Do not reinterpret URLs, control characters or long text as serials.
    const serial=value.replace(/^(?:SN|S\/N|SERIAL(?:\s+NUMBER)?)\s*[:=]\s*/i,'');
    const candidate=/^[A-Z0-9][A-Z0-9._/-]{3,63}$/i.test(serial);
    return {...code,value,format,kind:candidate?'candidate':'other',serialCandidate:candidate?serial:'',label:candidate?'Identifier candidate · check the printed label':'Unclassified code · review manually'};
  }
  async function scanAll(file,{signal,onUpdate,budgetMs=5000}={}){
    if(!file||signal?.aborted)return [];
    const deadline=Date.now()+Math.min(8000,Math.max(100,budgetMs));
    const codes=[],seen=new Set();let accepting=true;
    const publish=(results,warning='')=>{
      if(!accepting||signal?.aborted)return;
      for(const result of results||[]){
        const code=classify(result),key=code.value;
        if(!key||seen.has(key))continue;
        seen.add(key);codes.push(code);
      }
      onUpdate?.({codes:codes.slice(),warning});
    };
    const native=async()=>{
      if(!root?.BarcodeDetector||!root.createImageBitmap)return;
      let bitmap;
      try{
        const supported=await root.BarcodeDetector.getSupportedFormats();
        const available=formats.filter(f=>supported.includes(f));if(!available.length)return;
        bitmap=await root.createImageBitmap(file);
        if(signal?.aborted||!accepting)return;
        const results=await new root.BarcodeDetector({formats:available}).detect(bitmap);
        publish(results.map(r=>({value:r.rawValue,format:r.format,engine:'BarcodeDetector'})));
      }catch{}finally{bitmap?.close?.();}
    };
    // Finish the fast native pass before decoding another full-size bitmap in
    // the worker. This avoids holding two full camera images for barcode work.
    let nativeTimer,abortNative;
    await Promise.race([native(),new Promise(resolve=>{
      nativeTimer=setTimeout(resolve,Math.min(800,Math.max(1,deadline-Date.now())));
      abortNative=resolve;signal?.addEventListener('abort',abortNative,{once:true});
    })]);
    clearTimeout(nativeTimer);signal?.removeEventListener('abort',abortNative);
    if(signal?.aborted){accepting=false;return codes;}
    // Terminating the worker bounds CPU time even inside synchronous WASM code.
    let worker,timer;
    const fallback=new Promise(resolve=>{
      let finished=false;
      const finish=(warning='')=>{
        if(finished)return;finished=true;
        clearTimeout(timer);worker?.terminate();signal?.removeEventListener('abort',abort);
        if(warning)publish([],warning);resolve();
      };
      const abort=()=>finish();
      signal?.addEventListener('abort',abort,{once:true});
      try{
        worker=new root.Worker('./barcode-worker.js');
        worker.onmessage=event=>{publish(event.data.codes,event.data.warning);if(event.data.done)finish();};
        worker.onerror=()=>finish('Local barcode reader unavailable. OCR and manual entry remain available.');
        timer=setTimeout(()=>finish('Barcode time limit reached. Try a close, sharp label photo or enter the serial manually.'),Math.max(1,deadline-Date.now()));
        worker.postMessage({file});
      }catch{finish('Local barcode reader unavailable. OCR and manual entry remain available.');}
    });
    await fallback;accepting=false;
    return codes;
  }
  async function scanFile(file,options){
    const codes=await scanAll(file,options);
    return codes.find(x=>x.kind==='asset_id')||codes.find(x=>x.kind==='candidate')||codes[0]||null;
  }
  return {scanAll,scanFile,extractAssetId,classify};
});
