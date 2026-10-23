/* One consistent camera/gallery picker; selected photos accumulate until removed. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AssetPhotoPicker=api;
})(typeof window==='undefined'?null:window,function(){
  function mount(container,{initial=[],multiple=true,maxFiles=12,onError=()=>{},preview=false,onChange=()=>{}}={}){
    const items=[];let busy=false,disposed=false;
    container.classList.add('photo-picker');
    container.innerHTML='<div class="photo-picker-actions"><button type="button" class="btn light" data-photo-camera>Take photo</button><button type="button" class="btn light" data-photo-gallery>Choose from gallery</button></div><input type="file" accept="image/*" capture="environment" hidden data-photo-camera-input><input type="file" accept="image/*" hidden data-photo-gallery-input><p class="photo-picker-status" aria-live="polite"></p><div class="photo-picker-previews"></div>';
    const camera=container.querySelector('[data-photo-camera-input]'),gallery=container.querySelector('[data-photo-gallery-input]');
    gallery.multiple=multiple;
    function render(){
      if(disposed)return;
      if(preview&&items.length&&!items.some(p=>p.main))items[0].main=true;
      const pending=items.filter(i=>!i.uploaded).length;
      container.querySelector('.photo-picker-status').textContent=items.length?`${items.length} photo${items.length===1?'':'s'} selected${items.some(i=>i.uploaded)?` · ${pending} pending upload`:''}`:'No photos selected.';
      const previews=container.querySelector('.photo-picker-previews');previews.replaceChildren();
      for(const item of items){
        const row=document.createElement('div');row.className='photo-picker-preview';
        const image=document.createElement('img');image.src=item.url;image.alt='Selected photo';
        const name=document.createElement('span');name.textContent=item.file.name+(item.uploaded?' · uploaded':item.type==='serial_label'?' · scan evidence':'');
        const remove=document.createElement('button');remove.type='button';remove.className='btn light sm';remove.textContent='Remove';remove.setAttribute('aria-label','Remove '+item.file.name);remove.disabled=busy||item.uploaded;
        remove.addEventListener('click',()=>{if(busy||item.uploaded)return;items.splice(items.indexOf(item),1);URL.revokeObjectURL(item.url);render();onChange();});
        row.append(image,name,remove);previews.append(row);
        if(preview){
          image.tabIndex=0;image.setAttribute('role','button');image.setAttribute('aria-label','Preview '+item.file.name);image.onclick=()=>AssetMedia.preview({items:items.map(p=>({id:p.id,src:p.url,caption:p.file.name,main:!!p.main,removable:!p.uploaded})),index:items.indexOf(item),active:()=>!disposed,onMain:chosen=>{items.forEach(p=>p.main=p.id===chosen.id);render();onChange();},onRemove:chosen=>{const p=items.find(p=>p.id===chosen.id);if(p&&!p.uploaded){items.splice(items.indexOf(p),1);URL.revokeObjectURL(p.url);render();onChange();}}});image.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();image.click();}};
          const main=document.createElement('button');main.type='button';main.className='photo-main-button';main.textContent=item.main?'★ Main':'☆';main.title='Set as main image';main.setAttribute('aria-label','Set '+item.file.name+' as main image');main.onclick=()=>{items.forEach(p=>p.main=p===item);render();onChange();};row.prepend(main);
        }
      }
      container.querySelectorAll('.photo-picker-actions button,input').forEach(el=>{el.disabled=busy;});
    }
    function add(files,type='other'){
      if(busy||disposed)return;
      for(const file of files){
        if(!file.type.startsWith('image/')&&!(file.type===''&&/\.(?:jpe?g|png|webp|gif|avif|bmp|heic)$/i.test(file.name))){onError('Choose an image file.');continue;}
        if(items.some(i=>i.file===file||(i.file.name===file.name&&i.file.size===file.size&&i.file.lastModified===file.lastModified)))continue;
        if(!multiple){for(const old of items)URL.revokeObjectURL(old.url);items.length=0;}
        if(items.length>=maxFiles){onError(`Up to ${maxFiles} photos can be attached at a time.`);break;}
        items.push({id:crypto.randomUUID(),file,type,url:URL.createObjectURL(file),uploaded:false,main:preview&&!items.length});
      }
      render();onChange();
    }
    camera.addEventListener('change',()=>{add(Array.from(camera.files||[]));camera.value='';});
    gallery.addEventListener('change',()=>{add(Array.from(gallery.files||[]));gallery.value='';});
    container.querySelector('[data-photo-camera]').addEventListener('click',()=>camera.click());
    container.querySelector('[data-photo-gallery]').addEventListener('click',()=>gallery.click());
    for(const item of initial){add([item.file||item],item.file?(item.type||'serial_label'):'serial_label');if(item.main){items.forEach(p=>p.main=p.file===(item.file||item));}}
    render();
    return {items,add,setBusy(value){busy=value;render();},markUploaded(item){item.uploaded=true;render();},dispose(){disposed=true;for(const item of items)URL.revokeObjectURL(item.url);}};
  }
  return {mount};
});
