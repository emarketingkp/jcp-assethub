/* Durable scoped operations. Sign-in tokens are read at send time, never stored here. Guest proof grants access only to its own new-asset onboarding. */
(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./local-storage.js'):root.AssetLocalStorage);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetSaveQueue=api;})(typeof window!=='undefined'?window:null,(local)=>{
  function database(){
    let opened;
    const open=()=>opened||(opened=new Promise((resolve,reject)=>{
      if(typeof indexedDB==='undefined')return reject(new Error('Durable browser storage is unavailable. Keep this form open and enable IndexedDB.'));
      const r=indexedDB.open('jcp-assethub-operations',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('operations',{keyPath:'id'});
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }));
    async function transaction(mode,action){const db=await open();return new Promise((resolve,reject)=>{
      const tx=db.transaction('operations',mode),req=action(tx.objectStore('operations'));
      tx.oncomplete=()=>resolve(req.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error||new Error('Local save aborted'));
    });}
    return {put:async r=>{const stored=await local.encode(r);return transaction('readwrite',s=>s.put(stored));},putMany:async rows=>{const stored=await local.encode(rows);return transaction('readwrite',s=>{for(const row of stored)s.put(row);return {}; });},all:async()=>local.decode(await transaction('readonly',s=>s.getAll())),removeMany:ids=>transaction('readwrite',s=>{for(const id of ids)s.delete(id);return {};})};
  }
  function create({storage=database(),scope,api,online=()=>navigator.onLine,photosAllowed=()=>true,onChange=()=>{},onAsset=()=>{},onAuthRequired=()=>{},guestKey='',legacyScope='',legacyScopes=[],protocol=1,coordinationScope=scope,active=()=>true,prepare=async file=>{
    const {full,thumb}=await AssetImage.prepareForStorage(file);
    return {base64Data:await AssetImage.blobToBase64(full),thumbnailBase64:await AssetImage.blobToBase64(thumb),mimeType:'image/webp'};
  },lock=null}){
    let running=false,paused=false;const guestGrants=new Map();
    const safeAsset=asset=>{const copy={...asset};delete copy.private_details;delete copy.guest_upload_token;return copy;};
    const notify=(...args)=>{if(active()){try{onChange(...args);}catch(err){console.warn('Queue display failed',err);}}};
    const supported=()=>{if(!lock&&!globalThis.navigator?.locks)throw new Error('This browser needs Web Locks for safe durable saves.');};
    const coordinate=lock||(fn=>navigator.locks.request('assethub-saves:'+coordinationScope,fn));
    const metadataReady=(r,all)=>!r.asset&&r.state!=='Retry'&&(!r.parent||all.find(p=>p.id===r.parent)?.asset)&&(!r.photoParent||all.find(p=>p.id===r.photoParent)?.photos.find(p=>p.id===r.photoId)?.image);
    const rows=async()=> (await storage.all()).filter(r=>r.scope===scope).sort((a,b)=>a.created-b.created||(a.batchOrder||0)-(b.batchOrder||0));
    const persist=async r=>{await storage.put(r);notify(await rows());};
    let migration=null;
    function migrateLegacy(){
      const scopes=new Set([legacyScope,...legacyScopes].filter(s=>s&&s!==scope));if(!scopes.size)return Promise.resolve();
      if(migration)return migration;
      migration=(async()=>{supported();await coordinate(async()=>{
        if(!active())return;
        for(const row of await storage.all()){
          if(!active())return;
          // Only the older create/batch protocol may move into this queue.
          // New operation kinds stay hidden from older frontend processors on rollback.
          if(scopes.has(row.scope)&&(row.scope!==legacyScope||!row.kind)){row.scope=scope;await storage.put(row);}
        }
      });notify(await rows());void pump();})().catch(err=>notify(null,String(err.message||err))).finally(()=>migration=null);
      return migration;
    }
    async function enqueue({id,params,photos=[],parent='',setName='',setId='',anchor=null,kind='',evidence=null}){
      supported();
      const existing=(await rows()).find(r=>r.id===id);if(existing)return existing;
      const row={id,scope,protocol,params:structuredClone(params),kind,evidence:structuredClone(evidence),guestKey,photos:photos.map((p,i)=>({file:p.file,type:p.type||'other',main:!!p.main,id:id+'-photo-'+i})),parent,setName,setId,anchor,created:Date.now(),state:'Saving details',asset:null,error:''};
      await persist(row);void pump();return row;
    }
    async function enqueueMany(drafts){
      supported();if(!drafts.length||drafts.length>25)throw new Error('Register up to 25 units at once.');
      if(!storage.putMany)throw new Error('Atomic local storage is required for multiple units.');
      const old=await rows(),ids=new Set();const group=drafts.map((d,batchOrder)=>{
        if(ids.has(d.id))throw new Error('Duplicate operation ID.');ids.add(d.id);
        return old.find(r=>r.id===d.id)||{...d,scope,protocol,batchOrder,params:structuredClone(d.params),evidence:structuredClone(d.evidence||null),guestKey,photos:(d.photos||[]).map((p,i)=>({...p,id:d.id+'-photo-'+i})),parent:d.parent||'',anchor:d.anchor||null,created:Date.now(),state:'Saving details',asset:null,error:''};
      });await storage.putMany(group);notify(await rows());void pump();return group;
    }
    async function pump(){
      if(running||paused||!active()||!online())return;running=true;
      try{supported();await coordinate(async()=>{
        while(active()&&online()){
          const all=await rows();
          // Always drain ready metadata before even one background image.
          let row=all.find(r=>metadataReady(r,all));
          const metadata=!!row;
          if(!row&&photosAllowed())row=all.find(r=>r.asset&&r.state!=='Saved'&&r.state!=='Retry');
          if(!row)break;
          try{
            if(metadata){
              if(!row.payload){
                const parent=all.find(p=>p.id===row.parent),p=row.params;
                if(row.kind==='main_photo'){
                  if(row.photoParent){const source=all.find(p=>p.id===row.photoParent);p.asset_id=source.asset.asset_id;p.main_image_id=source.photos.find(p=>p.id===row.photoId).image.image_id;}
                  const latest=await api.get('getAsset',{asset_id:p.asset_id});p.expected_updated_at=latest.asset.updated_at;
                }
                if(row.kind){
                  const fields={...p};delete fields.asset_id;delete fields.expected_updated_at;delete fields.custom_json;delete fields.incoming_json;delete fields.choices_json;delete fields.private_json;
                  if(parent)fields.parent_asset_id=parent.asset.asset_id;
                  else if(row.anchor)fields.parent_asset_id=row.anchor.asset_id;
                  const operation={kind:row.kind,asset_id:p.asset_id||'',expected_updated_at:p.expected_updated_at||'',fields};
                  if(row.protocol===2){operation.version=2;if(p.private_json)operation.private=JSON.parse(p.private_json);}
                  if(p.custom_json!==undefined)operation.custom=JSON.parse(p.custom_json||'{}');
                  if(row.kind==='reconcile'){operation.incoming=JSON.parse(p.incoming_json);operation.choices=JSON.parse(p.choices_json);}
                  row.action='saveAssetOperation';row.payload={request_id:row.id,operation_json:JSON.stringify(operation)};
                  if(row.guestKey)row.payload.guest_key=row.guestKey;
                }else{
                  const setId=parent?.asset?.set_id||row.setId;
                  const units=[{category:p.category,category_id:p.category_id,brand:p.brand,model:p.model,serial:p.serial,specifications:p.specifications}];
                  if(row.anchor&&!setId)units.unshift({existing_asset_id:row.anchor.asset_id,expected_updated_at:row.anchor.updated_at||''});
                  row.payload={request_id:row.id,confirmed:'true',batch_json:JSON.stringify({parent_asset_id:parent?.asset?.asset_id||row.anchor?.asset_id||'',mode:setId||row.setName||parent?'set':'same',set_id:setId||'',set_name:parent?.asset?.set_name||row.setName,common:{...p,custom:JSON.parse(p.custom_json||'{}')},units})};
                }
                await persist(row); // Freeze reviewed bytes before the first transmission.
              }
              if(!active())break;
              const reply=await api.post(row.action||'saveAssetBatch',row.payload,row.guestKey?{publicCall:true}:undefined);
              const asset=reply.result.asset||reply.result.assets?.at(-1);
              if(!asset?.asset_id)throw new Error('Backend did not confirm an asset ID. Retry reconciliation.');
              if(asset.guest_upload_token)guestGrants.set(row.id,asset.guest_upload_token);
              row.relatedAssets=(reply.result.assets||[asset]).map(safeAsset);
              row.asset=safeAsset(asset);
              if(row.protocol===2)row.mainBase=asset.main_image_id||'';
              row.state=row.photos.length?'Uploading photos':'Saved';await persist(row);
              if(active())onAsset(row.asset,row,true);
            }else{
              const photo=row.photos.find(p=>!p.uploaded);
              if(!photo){row.state='Saved';await persist(row);continue;}
              if(!photo.prepared){photo.prepared=await prepare(photo.file);if(row.protocol===2)photo.preview='data:image/webp;base64,'+photo.prepared.thumbnailBase64;delete photo.file;await persist(row);}
              if(!active()||!photosAllowed())break;
              // Metadata queued while compression ran takes precedence over the next upload.
              if((await rows()).some(r=>metadataReady(r,all)))continue;
              if(row.guestKey&&!guestGrants.has(row.id)){
                const reply=await api.post('saveAssetOperation',row.payload,{publicCall:true});
                if(reply.result.asset?.guest_upload_token)guestGrants.set(row.id,reply.result.asset.guest_upload_token);
              }
              if(!active())break;
              if(row.protocol===2&&photo.frozenMain===undefined){photo.frozenMain=!!photo.main;await persist(row);}
              const sendPhoto=()=>api.post('uploadImage',{...photo.prepared,assetId:row.asset.asset_id,imageType:photo.type,operation_id:photo.id,...(row.protocol===2?{make_main:photo.frozenMain?'true':'false',expected_main_id:row.mainBase||''}:{}),...(row.guestKey?{guest_upload_token:guestGrants.get(row.id)}:{})},row.guestKey?{publicCall:true}:undefined);
              let reply;try{reply=await sendPhoto();}catch(err){
                if(!row.guestKey||!/AUTH_REQUIRED/.test(String(err.message||err)))throw err;
                // An expired short-lived grant can only be renewed by replaying the same Guest proof.
                const renewed=await api.post('saveAssetOperation',row.payload,{publicCall:true});guestGrants.set(row.id,renewed.result.asset.guest_upload_token);
                if(!active())break;reply=await sendPhoto();
              }
              photo.uploaded=true;delete photo.file;delete photo.prepared;
              photo.image=reply.image;
              row.asset.images=[...(row.asset.images||[]).filter(i=>i.image_id!==reply.image.image_id),reply.image];
              if(reply.image.uploaded_at)row.asset.updated_at=reply.image.uploaded_at;
              const confirmedMain=reply.image.asset_main_image_id;
              if(confirmedMain!==undefined)row.asset.main_image_id=confirmedMain;
              else if(row.protocol===2?photo.main:photo.type==='main')row.asset.main_image_id=reply.image.image_id;
              if(row.asset.main_image_id===reply.image.image_id){row.asset.thumbnail_file_id=reply.image.thumbnail_file_id||reply.image.drive_file_id;row.asset.image_file_id=reply.image.drive_file_id;}
              row.state=row.photos.every(p=>p.uploaded)?'Saved':'Uploading photos';await persist(row);
              if(active())onAsset(row.asset,row,false);
            }
          }catch(err){row.state='Retry';row.error=String(err.message||err);await persist(row);
            // Only a lost session pauses the whole queue; a permission error blocks just this row.
            if(authError(row.error)){paused=true;if(active())onAuthRequired(row.error);break;}}
        }
      });}catch(err){notify(null,String(err.message||err));}finally{running=false;if(active()){try{notify(await rows());}catch{}}}
    }
    async function retry(id){paused=false;const row=(await rows()).find(r=>r.id===id);if(!row)return;row.state=row.asset?'Uploading photos':'Saving details';row.error='';await persist(row);void pump();}
    // Opens a failed item for editing. If the server did apply the earlier request, resending
    // changed data under the same request ID is refused rather than duplicated.
    async function reopen(id){const row=(await rows()).find(r=>r.id===id);if(!row||row.asset)throw new Error('This item is already saved.');delete row.payload;delete row.action;row.state='Retry';row.error='OPERATION_NOT_STARTED: Reopened for editing.';await persist(row);return row;}
    // Rows that depend on this one (linked children, main-photo choices) go with it.
    const dependents=(id,all)=>{const out=new Set([id]);let grew=true;while(grew){grew=false;for(const r of all)if(!out.has(r.id)&&(out.has(r.parent)||out.has(r.photoParent))){out.add(r.id);grew=true;}}return [...out];};
    // A row is "sent" when its exact request may already have reached the server without a confirmed reply.
    const sentUnconfirmed=r=>!!r.payload&&!r.asset&&!/(?:BATCH|OPERATION)_NOT_STARTED:/.test(r.error||'');
    async function remove(id,{force=false}={}){
      const all=await rows(),row=all.find(r=>r.id===id);if(!row)return [];
      const ids=dependents(id,all),risky=ids.map(x=>all.find(r=>r.id===x)).filter(sentUnconfirmed);
      if(risky.length&&!force)throw new Error('SENT_UNCONFIRMED: This change may already be saved on the server. Check the asset register before discarding.');
      if(!storage.removeMany)throw new Error('This browser cannot remove pending items.');
      await storage.removeMany(ids);notify(await rows());void pump();return ids;
    }
    // Keep the saved asset and drop the photos that could not upload.
    async function finishWithoutPhotos(id){const row=(await rows()).find(r=>r.id===id);if(!row?.asset)throw new Error('Only a saved asset can skip its remaining photos.');row.photos=row.photos.filter(p=>p.uploaded);row.state='Saved';row.error='';await persist(row);void pump();return row;}
    async function discardPhoto(id,photoId){const row=(await rows()).find(r=>r.id===id);if(!row)return null;const photo=row.photos.find(p=>p.id===photoId);if(!photo||photo.uploaded)throw new Error('This photo has already uploaded.');row.photos=row.photos.filter(p=>p.id!==photoId);if(row.asset&&row.photos.every(p=>p.uploaded)){row.state='Saved';row.error='';}await persist(row);void pump();return row;}
    // A child waiting on a failed main asset can still be saved on its own.
    async function unlink(id){const row=(await rows()).find(r=>r.id===id);if(!row||row.asset||row.payload)throw new Error('This item has already been sent.');row.parent='';row.anchor=null;row.setName='';row.setId='';if(row.state==='Retry'){row.state='Saving details';row.error='';}await persist(row);void pump();return row;}
    // Confirmed rows are kept briefly so open screens can resolve them, then dropped with their blobs.
    async function prune(maxAge=24*60*60*1000){if(!storage.removeMany)return;const all=await rows(),cutoff=Date.now()-maxAge,old=all.filter(r=>r.state==='Saved'&&r.created<cutoff&&!all.some(c=>c.state!=='Saved'&&(c.parent===r.id||c.photoParent===r.id)));if(old.length){await storage.removeMany(old.map(r=>r.id));notify(await rows());}}
    async function enqueuePhotos({id,asset,photos}){
      supported();
      const existing=(await rows()).find(r=>r.id===id);if(existing)return existing;
      const safe=Object.fromEntries(['asset_id','asset_name','category_name','brand','model','serial','status','parent_asset_id','set_id','set_name','main_image_id','thumbnail_file_id','image_file_id','updated_at','images'].filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]));
      const row={id,scope,protocol,mainBase:safe.main_image_id||'',params:safe,photos:photos.map((p,i)=>({...p,id:id+'-photo-'+i})),created:Date.now(),state:'Uploading photos',asset:safe,error:''};
      await persist(row);void pump();return row;
    }
    async function enqueueMain({id,asset,image}){
      const params={asset_id:asset.asset_id,asset_name:asset.asset_name||'',main_image_id:image.image_id};
      if(!image._pending)return enqueue({id,kind:'main_photo',params});
      supported();const existing=(await rows()).find(r=>r.id===id);if(existing)return existing;
      const row={id,scope,protocol,kind:'main_photo',params,photoParent:image._photoOperation,photoId:image.image_id,photos:[],asset:null,created:Date.now(),state:'Waiting for photo',error:''};
      await persist(row);void pump();return row;
    }
    async function revise(id,params,photos,link,evidence){
      const row=(await rows()).find(r=>r.id===id);
      // Editable while the server has certainly not applied it: never sent, or explicitly not started.
      if(!row||row.asset||row.payload&&!/(?:BATCH|OPERATION)_NOT_STARTED:/.test(row.error))throw new Error('Reconcile this operation before changing its draft.');
      row.protocol=protocol;if(link?.kind)row.kind=link.kind;
      if(link)Object.assign(row,{parent:link.parent||'',setName:link.setName||'',setId:link.setId||'',anchor:link.anchor||null});
      row.params=structuredClone(params);if(evidence!==undefined)row.evidence=structuredClone(evidence);row.photos=photos.map((p,i)=>({...p,id:id+'-photo-'+i}));delete row.payload;delete row.action;row.error='';row.state='Saving details';await persist(row);void pump();return row;
    }
    return {enqueue,enqueueMany,enqueuePhotos,enqueueMain,rows,pump,retry,revise,reopen,remove,finishWithoutPhotos,discardPhoto,unlink,prune,sentUnconfirmed,migrateLegacy,scope};
  }
  const authError=message=>/AUTH_REQUIRED|SESSION_EXPIRED|USER_DISABLED|sign.in/i.test(String(message||''));
  // Errors worth retrying unchanged; anything else needs review or discarding.
  const transientError=message=>/network|fetch|timed? ?out|timeout|offline|LOCK_TIMEOUT|lock|temporar|too many|rate|quota|5\d\d|unavailable|Service invoked/i.test(String(message||''))&&!/NOT_STARTED|DUPLICATE|ITEM_CHANGED|PERMISSION|CONFLICT|REUSED|not found|NOT_READY/i.test(String(message||''));
  return {create,authError,transientError};
});
