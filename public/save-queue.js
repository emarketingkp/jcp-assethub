/* Durable scoped operations. Sign-in tokens are read at send time, never stored here. Guest proof grants access only to its own new-asset onboarding. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetSaveQueue=api;})(typeof window!=='undefined'?window:null,()=>{
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
    return {put:r=>transaction('readwrite',s=>s.put(r)),all:()=>transaction('readonly',s=>s.getAll())};
  }
  function create({storage=database(),scope,api,online=()=>navigator.onLine,photosAllowed=()=>true,onChange=()=>{},onAsset=()=>{},onAuthRequired=()=>{},guestKey='',active=()=>true,prepare=async file=>{
    const {full,thumb}=await AssetImage.prepareForStorage(file);
    return {base64Data:await AssetImage.blobToBase64(full),thumbnailBase64:await AssetImage.blobToBase64(thumb),mimeType:'image/webp'};
  },lock=null}){
    let running=false,paused=false;const guestGrants=new Map();
    const safeAsset=asset=>{const copy={...asset};delete copy.private_details;delete copy.guest_upload_token;return copy;};
    const notify=(...args)=>{if(active()){try{onChange(...args);}catch(err){console.warn('Queue display failed',err);}}};
    const supported=()=>{if(!lock&&!globalThis.navigator?.locks)throw new Error('This browser needs Web Locks for safe durable saves.');};
    const coordinate=lock||(fn=>navigator.locks.request('assethub-saves:'+scope,fn));
    const rows=async()=> (await storage.all()).filter(r=>r.scope===scope).sort((a,b)=>a.created-b.created);
    const persist=async r=>{await storage.put(r);notify(await rows());};
    async function enqueue({id,params,photos=[],parent='',setName='',setId='',anchor=null,kind='',evidence=null}){
      supported();
      const existing=(await rows()).find(r=>r.id===id);if(existing)return existing;
      const row={id,scope,params:structuredClone(params),kind,evidence:structuredClone(evidence),guestKey,photos:photos.map((p,i)=>({file:p.file,type:p.type||'other',id:id+'-photo-'+i})),parent,setName,setId,anchor,created:Date.now(),state:'Saving details',asset:null,error:''};
      await persist(row);void pump();return row;
    }
    async function pump(){
      if(running||paused||!active()||!online())return;running=true;
      try{supported();await coordinate(async()=>{
        while(active()&&online()){
          const all=await rows();
          // Always drain ready metadata before even one background image.
          let row=all.find(r=>!r.asset&&r.state!=='Retry'&&(!r.parent||all.find(p=>p.id===r.parent)?.asset));
          const metadata=!!row;
          if(!row&&photosAllowed())row=all.find(r=>r.asset&&r.state!=='Saved'&&r.state!=='Retry');
          if(!row)break;
          try{
            if(metadata){
              if(!row.payload){
                const parent=all.find(p=>p.id===row.parent),p=row.params;
                if(row.kind){
                  const fields={...p};delete fields.asset_id;delete fields.expected_updated_at;delete fields.custom_json;delete fields.incoming_json;delete fields.choices_json;
                  if(parent)fields.parent_asset_id=parent.asset.asset_id;
                  else if(row.anchor)fields.parent_asset_id=row.anchor.asset_id;
                  const operation={kind:row.kind,asset_id:p.asset_id||'',expected_updated_at:p.expected_updated_at||'',fields};
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
              const reply=await api.post(row.action||'saveAssetBatch',row.payload);
              const asset=reply.result.asset||reply.result.assets?.at(-1);
              if(!asset?.asset_id)throw new Error('Backend did not confirm an asset ID. Retry reconciliation.');
              if(asset.guest_upload_token)guestGrants.set(row.id,asset.guest_upload_token);
              row.relatedAssets=(reply.result.assets||[asset]).map(safeAsset);
              row.asset=safeAsset(asset);
              row.state=row.photos.length?'Uploading photos':'Saved';await persist(row);
              if(active())onAsset(row.asset,row,true);
            }else{
              const photo=row.photos.find(p=>!p.uploaded);
              if(!photo){row.state='Saved';await persist(row);continue;}
              if(!photo.prepared){photo.prepared=await prepare(photo.file);delete photo.file;await persist(row);}
              if(!active()||!photosAllowed())break;
              // Metadata queued while compression ran takes precedence over the next upload.
              if((await rows()).some(r=>!r.asset&&r.state!=='Retry'&&(!r.parent||(all.find(p=>p.id===r.parent)?.asset))))continue;
              if(row.guestKey&&!guestGrants.has(row.id)){
                const reply=await api.post('saveAssetOperation',row.payload);
                if(reply.result.asset?.guest_upload_token)guestGrants.set(row.id,reply.result.asset.guest_upload_token);
              }
              if(!active())break;
              const sendPhoto=()=>api.post('uploadImage',{...photo.prepared,assetId:row.asset.asset_id,imageType:photo.type,operation_id:photo.id,...(row.guestKey?{guest_upload_token:guestGrants.get(row.id)}:{})});
              let reply;try{reply=await sendPhoto();}catch(err){
                if(!row.guestKey||!/AUTH_REQUIRED/.test(String(err.message||err)))throw err;
                // An expired short-lived grant can only be renewed by replaying the same Guest proof.
                const renewed=await api.post('saveAssetOperation',row.payload);guestGrants.set(row.id,renewed.result.asset.guest_upload_token);
                if(!active())break;reply=await sendPhoto();
              }
              photo.uploaded=true;delete photo.file;delete photo.prepared;
              row.asset.images=[...(row.asset.images||[]).filter(i=>i.image_id!==reply.image.image_id),reply.image];
              if(reply.image.uploaded_at)row.asset.updated_at=reply.image.uploaded_at;
              if(photo.type==='main'){row.asset.main_image_id=reply.image.image_id;row.asset.thumbnail_file_id=reply.image.thumbnail_file_id||reply.image.drive_file_id;row.asset.image_file_id=reply.image.drive_file_id;}
              row.state=row.photos.every(p=>p.uploaded)?'Saved':'Uploading photos';await persist(row);
              if(active())onAsset(row.asset,row,false);
            }
          }catch(err){row.state='Retry';row.error=String(err.message||err);await persist(row);if(/AUTH|SESSION|sign.in|permission|USER_DISABLED/i.test(row.error)){paused=true;if(/AUTH|SESSION|sign.in|USER_DISABLED/i.test(row.error)&&active())onAuthRequired(row.error);break;}}
        }
      });}catch(err){notify(null,String(err.message||err));}finally{running=false;if(active()){try{notify(await rows());}catch{}}}
    }
    async function retry(id){paused=false;const row=(await rows()).find(r=>r.id===id);if(!row)return;row.state=row.asset?'Uploading photos':'Saving details';row.error='';await persist(row);void pump();}
    async function enqueuePhotos({id,asset,photos}){
      supported();
      const existing=(await rows()).find(r=>r.id===id);if(existing)return existing;
      const safe=Object.fromEntries(['asset_id','category_name','brand','model','serial','status','parent_asset_id','set_id','set_name','main_image_id','thumbnail_file_id','image_file_id','updated_at','images'].filter(k=>asset[k]!==undefined).map(k=>[k,asset[k]]));
      const row={id,scope,params:safe,photos:photos.map((p,i)=>({...p,id:id+'-photo-'+i})),created:Date.now(),state:'Uploading photos',asset:safe,error:''};
      await persist(row);void pump();return row;
    }
    async function revise(id,params,photos,link,evidence){
      const row=(await rows()).find(r=>r.id===id);
      if(!row||row.asset||!/(?:BATCH|OPERATION)_NOT_STARTED:/.test(row.error))throw new Error('Reconcile this operation before changing its draft.');
      if(link?.kind)row.kind=link.kind;
      if(link)Object.assign(row,{parent:link.parent||'',setName:link.setName||'',setId:link.setId||'',anchor:link.anchor||null});
      row.params=structuredClone(params);if(evidence!==undefined)row.evidence=structuredClone(evidence);row.photos=photos.map((p,i)=>({...p,id:id+'-photo-'+i}));delete row.payload;delete row.action;row.error='';row.state='Saving details';await persist(row);void pump();return row;
    }
    return {enqueue,enqueuePhotos,rows,pump,retry,revise,scope};
  }
  return {create};
});
