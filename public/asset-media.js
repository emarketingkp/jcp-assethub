/* Independent top-layer viewers never replace an editor or its selected photographs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetMedia=api;})(typeof window==='undefined'?null:window,()=>{
  function serialCandidate(codes){
    const values=[...new Set((codes||[]).map(c=>String(c.rawValue??c.value??'').trim()).filter(v=>v&&v.length<=80&&!/[\x00-\x1f]/.test(v)&&!/^\w+:\/\//i.test(v)&&!/^JCP[-:/]/i.test(v)))];
    return values.length===1?values[0]:'';
  }
  function dialog(label,onClose=()=>{}){
    const d=document.createElement('dialog');d.className='asset-media-dialog';d.setAttribute('aria-label',label);
    let disposed=false;
    const dispose=()=>{if(disposed)return;disposed=true;onClose();d.remove();};
    d.addEventListener('close',dispose);d.addEventListener('cancel',dispose);
    document.body.append(d);return {element:d,open:()=>d.showModal(),close:()=>{if(d.open)d.close();else dispose();},alive:()=>!disposed};
  }
  function serial({onRead,active=()=>true,onOpen=()=>{},onClose=()=>{}}){
    onOpen();let stream,timer,reading=false;const abort=new AbortController();
    const view=dialog('Read a serial barcode',()=>{abort.abort();clearTimeout(timer);stream?.getTracks().forEach(t=>t.stop());onClose();});
    const d=view.element;d.innerHTML='<div class="asset-media-head"><div><b>Read serial number</b><small>Frame one serial barcode. Detection fills the field automatically.</small></div><button type="button" class="iconbtn" aria-label="Close serial reader">×</button></div><div class="serial-camera"><video muted autoplay playsinline></video><div class="serial-frame"></div></div><p class="asset-media-status" role="status">Opening camera…</p><div class="asset-media-actions"><button type="button" class="btn light">Enter manually</button></div>';
    d.querySelector('.iconbtn').onclick=view.close;d.querySelector('.btn').onclick=view.close;view.open();
    const video=d.querySelector('video'),status=d.querySelector('[role=status]');
    const current=()=>view.alive()&&active()&&!abort.signal.aborted;
    const consume=codes=>{if(!current())return;const value=serialCandidate(codes);if(value){onRead(value);view.close();}else status.textContent=codes.length?'Keep only one serial barcode inside the frame.':'Hold the serial barcode inside the frame.';};
    void (async()=>{
      try{
        const opened=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:'environment'},width:{ideal:1280},height:{ideal:720}},audio:false});
        if(!current()){opened.getTracks().forEach(t=>t.stop());return;}stream=opened;video.srcObject=stream;await video.play();if(!current())return;
        let detector=null;if(globalThis.BarcodeDetector){try{detector=new BarcodeDetector({formats:['code_128','code_39','code_93','ean_13','ean_8','upc_a','upc_e','itf','data_matrix','qr_code']});}catch{}}
        const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');
        const tick=async()=>{
          if(!current()){view.close();return;}if(!reading&&video.videoWidth){reading=true;try{
            const w=video.videoWidth,h=video.videoHeight;canvas.width=Math.round(w*.88);canvas.height=Math.round(h*.46);ctx.drawImage(video,w*.06,h*.27,w*.88,h*.46,0,0,canvas.width,canvas.height);
            const codes=detector?await detector.detect(canvas):await new Promise(resolve=>canvas.toBlob(async blob=>{try{resolve(await AssetCode.scanAll(blob,{signal:abort.signal,budgetMs:700}));}catch{resolve([]);}},'image/jpeg',.9));
            consume(codes||[]);
          }catch{if(current())status.textContent='Move closer to the serial barcode, or enter it manually.';}finally{reading=false;}}
          if(current())timer=setTimeout(tick,180);
        };status.textContent='Hold the serial barcode inside the frame.';void tick();
      }catch{if(current())status.textContent='Camera preview is unavailable. Close this reader and enter the serial in its field.';}
    })();return view;
  }
  function preview({items,index=0,onMain=null,onRemove=null,onReplace=null,active=()=>true}){
    let at=index,generation=0;const view=dialog('Image preview'),d=view.element;
    d.innerHTML='<div class="asset-media-head"><div><b>Image preview</b><small class="preview-caption"></small></div><button type="button" class="iconbtn" aria-label="Close image preview">×</button></div><div class="asset-preview-frame"><img alt="Asset photograph"><span role="status"></span></div><div class="asset-media-actions"><button class="btn light" data-previous aria-label="Previous image">‹</button><button class="btn light" data-main>☆ Set as main</button><button class="btn light" data-replace>Replace</button><button class="btn light" data-remove>Remove</button><button class="btn light" data-next aria-label="Next image">›</button></div>';
    const image=d.querySelector('img'),message=d.querySelector('[role=status]'),main=d.querySelector('[data-main]'),remove=d.querySelector('[data-remove]');
    const paint=async()=>{if(!active()||!items.length){view.close();return;}const ticket=++generation;at=Math.min(at,items.length-1);const item=items[at];image.removeAttribute('src');message.textContent='Loading image…';d.querySelector('.preview-caption').textContent=(at+1)+' of '+items.length+' · '+(item.caption||'Asset photo');main.hidden=!onMain;main.textContent=item.main?'★ Main image':'☆ Set as main';main.disabled=!!item.main||item.mainDisabled;remove.hidden=!onRemove||item.removable===false;d.querySelector('[data-replace]').hidden=!onReplace||item.replaceable===false;d.querySelector('[data-previous]').disabled=at===0;d.querySelector('[data-next]').disabled=at===items.length-1;
      try{const src=item.src||await item.load();if(!view.alive()||ticket!==generation||!active())return;image.src=src;message.textContent='';}catch{if(view.alive()&&ticket===generation)message.textContent='Image unavailable. Close and retry when connected.';}
    };
    d.querySelector('.iconbtn').onclick=view.close;d.querySelector('[data-previous]').onclick=()=>{at--;void paint();};d.querySelector('[data-next]').onclick=()=>{at++;void paint();};
    main.onclick=async()=>{if(!active()){view.close();return;}main.disabled=true;try{await onMain(items[at]);items.forEach((item,i)=>item.main=i===at);void paint();}catch(err){message.textContent=String(err.message||err);main.disabled=false;}};
    d.querySelector('[data-replace]').onclick=()=>{if(!active()){view.close();return;}const item=items[at];view.close();onReplace(item);};
    remove.onclick=async()=>{if(!active()){view.close();return;}remove.disabled=true;try{const removed=await onRemove(items[at]);if(removed!==false)items.splice(at,1);void paint();}catch(err){message.textContent=String(err.message||err);}finally{remove.disabled=false;}};image.onclick=()=>d.querySelector('.asset-preview-frame').classList.toggle('zoomed');view.open();void paint();return view;
  }
  return {serialCandidate,serial,preview};
});
