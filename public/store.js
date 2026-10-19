(() => {
  const DB_NAME = 'jcp-assethub-cache';
  const DB_VERSION = 1;
  const STORE = 'kv';
  let dbPromise = null;

  function openDb(){
    if(!('indexedDB' in window)) return Promise.resolve(null);
    if(dbPromise) return dbPromise;
    dbPromise = new Promise((resolve,reject)=>{
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE,{keyPath:'key'});
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).catch(()=>null);
    return dbPromise;
  }

  async function get(key,{maxAge=Infinity}={}){
    const db = await openDb();
    if(!db){
      try{
        const raw = localStorage.getItem('jcp_idb_fallback_'+key);
        const item = raw ? JSON.parse(raw) : null;
        if(!item) return null;
        if(Number.isFinite(maxAge) && Date.now()-Number(item.savedAt||0)>maxAge) return null;
        return item.value;
      }catch{return null;}
    }
    return new Promise(resolve=>{
      const tx=db.transaction(STORE,'readonly');
      const req=tx.objectStore(STORE).get(key);
      req.onsuccess=()=>{
        const item=req.result;
        if(!item) return resolve(null);
        if(Number.isFinite(maxAge) && Date.now()-Number(item.savedAt||0)>maxAge) return resolve(null);
        resolve(item.value);
      };
      req.onerror=()=>resolve(null);
    });
  }

  async function set(key,value){
    const item={key,value,savedAt:Date.now()};
    const db=await openDb();
    if(!db){
      try{localStorage.setItem('jcp_idb_fallback_'+key,JSON.stringify(item));}catch{}
      return value;
    }
    return new Promise(resolve=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).put(item);
      tx.oncomplete=()=>resolve(value);
      tx.onerror=()=>resolve(value);
    });
  }

  async function remove(key){
    const db=await openDb();
    if(!db){try{localStorage.removeItem('jcp_idb_fallback_'+key);}catch{};return;}
    return new Promise(resolve=>{
      const tx=db.transaction(STORE,'readwrite');
      tx.objectStore(STORE).delete(key);
      tx.oncomplete=()=>resolve(); tx.onerror=()=>resolve();
    });
  }

  async function clear(prefix=''){
    const db=await openDb();
    if(!db){
      try{Object.keys(localStorage).filter(k=>k.startsWith('jcp_idb_fallback_'+prefix)).forEach(k=>localStorage.removeItem(k));}catch{}
      return;
    }
    return new Promise(resolve=>{
      const tx=db.transaction(STORE,'readwrite');
      const store=tx.objectStore(STORE);
      const req=store.openCursor();
      req.onsuccess=()=>{const c=req.result;if(!c)return;if(!prefix||String(c.key).startsWith(prefix))c.delete();c.continue();};
      tx.oncomplete=()=>resolve();tx.onerror=()=>resolve();
    });
  }

  window.AssetStore={get,set,remove,clear};
})();
