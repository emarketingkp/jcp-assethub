(() => {
  const PREFERRED_FORMATS = ['qr_code','code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','data_matrix','codabar'];

  function normalize(value){
    return String(value || '').trim();
  }

  function extractAssetId(value){
    const raw = normalize(value);
    const direct = raw.match(/\bJCP-[A-Z0-9]{1,8}-\d{1,8}\b/i);
    if(direct) return direct[0].toUpperCase();
    try{
      const u = new URL(raw);
      const id = u.searchParams.get('asset');
      if(id && /^JCP-[A-Z0-9]{1,8}-\d{1,8}$/i.test(id)) return id.toUpperCase();
    }catch{}
    const tagged = raw.match(/^JCP-ASSET\s*:\s*(JCP-[A-Z0-9]{1,8}-\d{1,8})$/i);
    return tagged ? tagged[1].toUpperCase() : '';
  }

  async function nativeScan(file){
    if(!('BarcodeDetector' in window) || !('createImageBitmap' in window)) return null;
    try{
      const supported = await BarcodeDetector.getSupportedFormats();
      const formats = PREFERRED_FORMATS.filter(f=>supported.includes(f));
      const detector = new BarcodeDetector(formats.length ? {formats} : undefined);
      const bitmap = await createImageBitmap(file);
      try{
        const results = await detector.detect(bitmap);
        if(!results.length) return null;
        const r = results[0];
        return {value:normalize(r.rawValue), format:r.format || 'barcode', engine:'BarcodeDetector'};
      } finally {
        if(bitmap.close) bitmap.close();
      }
    }catch{
      return null;
    }
  }

  function loadImage(file){
    return new Promise((resolve,reject)=>{
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload=()=>resolve({img,url});
      img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Unable to read image for barcode detection.'));};
      img.src=url;
    });
  }

  async function zxingScan(file){
    if(!window.ZXing || !ZXing.BrowserMultiFormatReader) return null;
    let resource;
    try{
      resource = await loadImage(file);
      let hints;
      if(ZXing.DecodeHintType && ZXing.BarcodeFormat){
        hints = new Map();
        const names=['QR_CODE','CODE_128','CODE_39','CODE_93','EAN_13','EAN_8','UPC_A','UPC_E','ITF','DATA_MATRIX','CODABAR'];
        const formats=names.map(n=>ZXing.BarcodeFormat[n]).filter(v=>v!==undefined);
        if(formats.length) hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS,formats);
        if(ZXing.DecodeHintType.TRY_HARDER!==undefined) hints.set(ZXing.DecodeHintType.TRY_HARDER,true);
      }
      const reader = new ZXing.BrowserMultiFormatReader(hints);
      const result = await reader.decodeFromImage(resource.img);
      const value = normalize(result?.text || result?.getText?.());
      if(!value) return null;
      let format='barcode';
      try{
        const f=result.getBarcodeFormat?.();
        format = ZXing.BarcodeFormat?.[f] || String(f || 'barcode');
      }catch{}
      return {value,format:String(format).toLowerCase(),engine:'ZXing'};
    }catch{
      return null;
    }finally{
      if(resource?.url) URL.revokeObjectURL(resource.url);
    }
  }

  async function scanFile(file){
    if(!file) return null;
    return (await nativeScan(file)) || (await zxingScan(file));
  }

  window.AssetCode = {scanFile,extractAssetId};
})();
