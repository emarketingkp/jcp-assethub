(() => {
  async function fileToDataUrl(file){
    return new Promise((resolve,reject)=>{
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function loadBitmap(fileOrBlob){
    if('createImageBitmap' in window) return createImageBitmap(fileOrBlob);
    const dataUrl = await fileToDataUrl(fileOrBlob);
    return new Promise((resolve,reject)=>{
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = dataUrl;
    });
  }

  function canvasBlob(canvas, mime, quality){
    return new Promise((resolve,reject)=>{
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Image conversion failed.')), mime, quality);
    });
  }

  async function resize(fileOrBlob, maxSize, mime='image/webp', quality=.82){
    const bitmap = await loadBitmap(fileOrBlob);
    let width = bitmap.width, height = bitmap.height;
    const scale = Math.min(1, maxSize / Math.max(width,height));
    width = Math.max(1, Math.round(width*scale));
    height = Math.max(1, Math.round(height*scale));
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', {alpha:false});
    ctx.drawImage(bitmap,0,0,width,height);
    if(bitmap.close) bitmap.close();
    return canvasBlob(canvas,mime,quality);
  }

  async function blobToBase64(blob){
    const dataUrl = await fileToDataUrl(blob);
    return dataUrl.split(',')[1];
  }

  async function prepareForStorage(file){
    const full = await resize(file,1600,'image/webp',.82);
    const thumb = await resize(file,360,'image/webp',.74);
    return {full,thumb};
  }

  async function prepareForOcr(file){
    // Keep small originals, but shrink typical phone photos before OCR transport.
    // This keeps label text readable while avoiding multi-megabyte mobile POST payloads.
    if(file.size <= 2 * 1024 * 1024) return fileToDataUrl(file);
    const lighter = await resize(file,2400,'image/jpeg',.90);
    return fileToDataUrl(lighter);
  }

  async function videoFrameToFile(video, name='camera-label.jpg'){
    const w = video.videoWidth || 1920, h = video.videoHeight || 1080;
    if(!w || !h) throw new Error('Camera frame is not ready.');
    const canvas = document.createElement('canvas');
    canvas.width=w; canvas.height=h;
    canvas.getContext('2d').drawImage(video,0,0,w,h);
    const blob = await canvasBlob(canvas,'image/jpeg',.95);
    return new File([blob], name, {type:'image/jpeg'});
  }

  window.AssetImage = {fileToDataUrl,resize,blobToBase64,prepareForStorage,prepareForOcr,videoFrameToFile};
})();
