/* Store photo bytes, not browser-managed Blob handles, in IndexedDB. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetLocalStorage=api;})(typeof window==='undefined'?null:window,()=>{
  const bytes=new WeakMap();
  async function encode(value){
    if(typeof Blob!=='undefined'&&value instanceof Blob){
      let pending=bytes.get(value);
      if(!pending){pending=value.arrayBuffer().catch(err=>{bytes.delete(value);throw err;});bytes.set(value,pending);}
      return {__assethubPhotoBytes:1,bytes:await pending,type:value.type,name:typeof value.name==='string'?value.name:null,lastModified:value.lastModified};
    }
    if(Array.isArray(value))return Promise.all(value.map(encode));
    if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(await Promise.all(Object.entries(value).map(async([k,v])=>[k,await encode(v)])));
    return value;
  }
  function decode(value){
    if(value?.__assethubPhotoBytes===1&&value.bytes instanceof ArrayBuffer){
      return value.name!==null&&typeof File!=='undefined'?new File([value.bytes],value.name,{type:value.type,lastModified:value.lastModified}):new Blob([value.bytes],{type:value.type});
    }
    if(Array.isArray(value))return value.map(decode);
    if(value&&Object.getPrototypeOf(value)===Object.prototype)return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,decode(v)]));
    // Existing drafts and operations containing Blobs remain readable.
    return value;
  }
  return {encode,decode};
});
