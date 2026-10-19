/* Lazy, same-origin decoder. Images remain on this device during barcode search. */
importScripts('./vendor/zxing-wasm/reader.js');
ZXingWASM.prepareZXingModule({overrides:{locateFile:()=>new URL('./vendor/zxing-wasm/zxing_reader.wasm',self.location.href).href}});
self.onmessage=async({data:{file}})=>{
  let bitmap;
  try{
    bitmap=await createImageBitmap(file);
    const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
    const canvas=new OffscreenCanvas(Math.max(1,Math.round(bitmap.width*scale)),Math.max(1,Math.round(bitmap.height*scale)));
    const ctx=canvas.getContext('2d',{willReadFrequently:true,alpha:false});
    ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();bitmap=null;
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const options={tryHarder:false,tryRotate:true,tryInvert:true,maxNumberOfSymbols:8,returnErrors:false,textMode:'Plain',minLineCount:2};
    const emit=(results,done=false)=>self.postMessage({codes:results.filter(r=>r.isValid&&!r.error).map(r=>({value:r.text,format:r.format,engine:'ZXing WASM'})),done});
    const results=await ZXingWASM.readBarcodes(pixels,options);emit(results);
    // A warranty QR must not suppress a nearby linear barcode.
    if(!results.some(r=>r.isValid&&!/QR|Matrix|Aztec|PDF/i.test(r.format)))
      emit(await ZXingWASM.readBarcodes(pixels,{...options,formats:['AllLinear'],tryHarder:true}),true);
    else emit([],true);
  }catch{self.postMessage({codes:[],done:true,warning:'Local barcode reader unavailable. OCR and manual entry remain available.'});}
  finally{bitmap?.close?.();}
};
