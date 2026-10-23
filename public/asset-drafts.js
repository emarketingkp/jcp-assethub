/* Unsubmitted drafts are durable, scoped and separate from server operations. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetDrafts=api;})(typeof window==='undefined'?null:window,()=>{
  let opened;
  const open=()=>opened||(opened=new Promise((resolve,reject)=>{
    if(typeof indexedDB==='undefined')return reject(new Error('Draft storage is unavailable. Keep your editor open.'));
    const request=indexedDB.open('jcp-assethub-editor-drafts',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('drafts',{keyPath:'id'});
    request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
  }));
  async function transaction(mode,fn){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('drafts',mode),result=fn(tx.objectStore('drafts'));tx.oncomplete=()=>resolve(result.value);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Draft was not persisted.'));});}
  function create(scope){
    if(!scope)throw new Error('A signed-in or Guest draft scope is required.');
    return {
      async put(draft){const row=structuredClone({...draft,scope,updated:Date.now()});await transaction('readwrite',s=>{s.put(row);return {value:row};});return row;},
      async get(id){const result={};await transaction('readonly',s=>{const r=s.get(id);r.onsuccess=()=>result.value=r.result?.scope===scope?r.result:null;return result;});return result.value;},
      async list(){const result={};await transaction('readonly',s=>{const r=s.getAll();r.onsuccess=()=>result.value=r.result.filter(d=>d.scope===scope).sort((a,b)=>b.updated-a.updated);return result;});return result.value||[];},
      async remove(id){return transaction('readwrite',s=>{const r=s.get(id);r.onsuccess=()=>{if(r.result?.scope===scope)s.delete(id);};return {};});},
      scope
    };
  }
  return {create};
});
