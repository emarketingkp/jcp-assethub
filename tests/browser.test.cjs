const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const {test}=require('node:test');
const data=require('../public/data/input-knowledge.json');
const bwip=require('bwip-js');
const root=path.resolve(__dirname,'../public');
const types={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.wasm':'application/wasm','.webmanifest':'application/manifest+json'};
const pixel=require('node:fs').readFileSync(path.join(root,'assets/icon-192.png'));
const image=name=>({name,mimeType:'image/png',buffer:pixel});
const server=http.createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),filename=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));
    if(!filename.startsWith(root+path.sep)){res.writeHead(403);return res.end();}
    const body=await fs.readFile(filename);res.writeHead(200,{'Content-Type':types[path.extname(filename)]||'application/octet-stream'});res.end(body);
  }catch{res.writeHead(404);res.end();}
});

test('browser regressions on mobile and desktop',async t=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox']});
  async function start(options={},viewport={width:390,height:844}){
    const context=await browser.newContext({viewport,serviceWorkers:'block'});
    await context.addInitScript(({options,categories})=>{
      window.__mockOptions=options;window.__fixtureCategories=categories;
      // Native capture is exercised with a file fixture, without granting real camera access.
      navigator.mediaDevices.getUserMedia=async()=>{throw new Error('No physical camera in automated tests');};
    },{options,categories:data.categories.map(r=>({category_id:r.categoryId,name:r.name,active:true}))});
    await context.route('**/api.js',route=>route.fulfill({path:path.join(__dirname,'fixtures/browser-api.js'),contentType:'text/javascript'}));
    await context.route('https://**',route=>route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',err=>errors.push(err.message));
    page.setDefaultTimeout(7000);
    await page.goto(base);await page.waitForFunction(()=>window.AssetInput?.current&&window.__mock);
    await page.locator('#appLoading').waitFor({state:'hidden'});
    return {page,context,errors};
  }
  async function scan(page){
    await page.locator('[data-mobile-route="scanner"]').click();
    await page.locator('#scannerFile').setInputFiles(image('scan.png'));
    await page.locator('#v27Create').waitFor();
    await page.waitForFunction(()=>!document.querySelector('#v27Create').disabled);
  }
  async function formAfterScan(page){
    await scan(page);
    assert.equal(await page.locator('[data-universal-field="brand"]').inputValue(),'Ricoh');
    await page.locator('#v27Create').click();
    await page.locator('#assetSite').selectOption('SITE-TEST');
    await page.locator('#assetArea').fill('Test Area');
  }
  async function checkNoOverflow(page){
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1),'Page overflows horizontally');
    const wrap=page.locator('#modalWrap');
    if(await wrap.isVisible())assert(await page.locator('#modalBody').evaluate(el=>el.scrollWidth<=el.clientWidth+1),'Modal overflows horizontally');
  }
  async function barcodeFixture(page){
    const linear=await bwip.toBuffer({bcid:'code128',text:'001O0I1234',scale:3,height:16,includetext:true,paddingwidth:20,paddingheight:15,backgroundcolor:'FFFFFF'});
    const qr=await bwip.toBuffer({bcid:'qrcode',text:'https://example.test/warranty',scale:3,paddingwidth:10,paddingheight:10,backgroundcolor:'FFFFFF'});
    const uri=await page.evaluate(async({linear,qr})=>{
      const load=src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img);img.src=src;});
      const [a,b]=await Promise.all([load(linear),load(qr)]);
      const canvas=document.createElement('canvas');canvas.width=Math.max(a.width,b.width)+80;canvas.height=a.height+b.height+100;
      const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(a,40,30);ctx.drawImage(b,40,a.height+60);
      return canvas.toDataURL('image/png');
    },{linear:'data:image/png;base64,'+linear.toString('base64'),qr:'data:image/png;base64,'+qr.toString('base64')});
    return {name:'synthetic-multiple-codes.png',mimeType:'image/png',buffer:Buffer.from(uri.split(',')[1],'base64')};
  }
  try{
    await t.test('real local decoder finds a warranty QR and linear identifier in the same image',async()=>{
      const {page,context,errors}=await start();
      try{
        const fixture=await barcodeFixture(page);
        const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
        const result=await page.evaluate(async base64=>{
          window.BarcodeDetector=undefined;
          const file=await (await fetch('data:image/png;base64,'+base64)).blob();
          const started=performance.now();let ticks=0;const heartbeat=setInterval(()=>ticks++,10);
          const codes=await AssetCode.scanAll(file);clearInterval(heartbeat);
          return {codes,ticks,ms:performance.now()-started};
        },fixture.buffer.toString('base64'));
        assert(result.codes.some(c=>c.kind==='link'&&c.value==='https://example.test/warranty'));
        assert(result.codes.some(c=>c.kind==='candidate'&&c.serialCandidate==='001O0I1234'));
        assert(result.ticks>0,'Barcode decoding blocked the main thread');
        console.log('Local worker barcode cold scan at 4x CPU slowdown:',JSON.stringify({ms:result.ms,mainThreadTicks:result.ticks}));
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('native detection retains multiple codes and publishes before a stalled fallback',async()=>{
      const {page,context,errors}=await start();
      try{
        await context.route('**/barcode-worker.js',route=>route.fulfill({body:'self.onmessage=()=>{};',contentType:'text/javascript'}));
        const result=await page.evaluate(async()=>{
          window.BarcodeDetector=class{
            static async getSupportedFormats(){return ['qr_code','code_128'];}
            async detect(){return [{rawValue:'https://example.test/warranty',format:'qr_code'},{rawValue:'001O0I1234',format:'code_128'}];}
          };
          const file=await(await fetch('./assets/icon-192.png')).blob();let first=[];
          const codes=await AssetCode.scanAll(file,{budgetMs:150,onUpdate:r=>{if(!first.length)first=r.codes;}});
          return {codes,first};
        });
        assert.equal(result.first.length,2);assert.equal(result.codes.length,2);
        assert(result.codes.some(c=>c.serialCandidate==='001O0I1234'));assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('large phone-image OCR preparation enforces dimensions and upload bytes',async()=>{
      const {page,context,errors}=await start();
      try{
        const result=await page.evaluate(async()=>{
          const c=document.createElement('canvas');c.width=2600;c.height=1900;const ctx=c.getContext('2d'),pixels=ctx.createImageData(c.width,c.height);
          let seed=12345;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return seed&255;};
          for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=random();pixels.data[i+1]=random();pixels.data[i+2]=random();pixels.data[i+3]=255;}
          ctx.putImageData(pixels,0,0);const original=await new Promise(resolve=>c.toBlob(resolve,'image/png'));
          const uri=await AssetImage.prepareForOcr(original),prepared=await(await fetch(uri)).blob(),bitmap=await createImageBitmap(prepared);
          const result={original:original.size,prepared:prepared.size,width:bitmap.width,height:bitmap.height,type:prepared.type};bitmap.close();return result;
        });
        assert(result.original>2*1024*1024);assert(result.prepared<=2*1024*1024);assert(result.width<=2400&&result.height<=2400);
        assert(Math.abs(result.width/result.height-2600/1900)<.002);assert.equal(result.type,'image/jpeg');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('barcode candidates arrive before OCR and require approval; late OCR retains the approved serial',async()=>{
      const {page,context,errors}=await start({ocrDelayed:true,ai:true});
      try{
        const fixture=await barcodeFixture(page);
        await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerFile').setInputFiles(fixture);
        const use=page.getByRole('button',{name:'Use as serial',exact:true});await use.waitFor();
        assert.equal(await use.count(),1,'Warranty URL must not have a serial action');
        assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'');
        assert(await page.locator('#v27Create').isDisabled());
        assert.equal(await page.evaluate(()=>window.__mock.calls.some(c=>c.action==='createAsset'||c.action==='updateAsset')),false);
        await use.click();assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'001O0I1234');
        await page.evaluate(()=>window.__mock.ocrRelease());
        await page.waitForFunction(()=>!document.querySelector('#v27Create').disabled);
        assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'001O0I1234');
        await page.locator('[data-universal-field="serial"]').fill('MANUAL-SERIAL');
        page.once('dialog',dialog=>dialog.dismiss());await use.click();
        assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'MANUAL-SERIAL');
        page.once('dialog',dialog=>dialog.accept());await use.click();
        assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'001O0I1234');
        await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('cancelled recognition ignores late OCR and cannot leak candidates into the next asset',async()=>{
      const {page,context,errors}=await start({ocrDelayed:true});
      try{
        const fixture=await barcodeFixture(page);
        await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerFile').setInputFiles(fixture);
        await page.waitForFunction(()=>window.__mock.ocrRelease);await page.locator('#v27Reset').click();
        await page.evaluate(()=>window.__mock.ocrRelease());
        await page.locator('#scannerFile').setInputFiles(image('next-asset.png'));
        await page.waitForFunction(()=>window.__mock.calls.filter(c=>c.action==='ocr').length===2);
        await page.evaluate(()=>window.__mock.ocrRelease());
        await page.waitForFunction(()=>!document.querySelector('#v27Create').disabled);
        assert.equal(await page.locator('[data-barcode-candidate]').count(),0);
        assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'O01I2345');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('barcode timeout and missing worker keep manual entry usable',async()=>{
      const {page,context}=await start();
      try{
        await context.route('**/barcode-worker.js',route=>route.fulfill({body:'self.onmessage=()=>{};',contentType:'text/javascript'}));
        const result=await page.evaluate(async()=>{
          const file=await (await fetch('./assets/icon-192.png')).blob();let warning='';
          const start=performance.now();await AssetCode.scanAll(file,{budgetMs:100,onUpdate:r=>{warning=r.warning||warning;}});
          return {warning,ms:performance.now()-start};
        });
        assert.match(result.warning,/time limit/);assert(result.ms<1500);
        await page.evaluate(()=>{window.Worker=undefined;});await scan(page);
        assert.match(await page.locator('.v27-barcodes').textContent(),/reader unavailable/);
        assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'O01I2345');
      }finally{await context.close();}
    });
    await t.test('mobile shutter uses sensor still dimensions rather than preview dimensions',async()=>{
      const {page,context,errors}=await start();
      try{
        await page.evaluate(()=>{
          navigator.mediaDevices.getUserMedia=async()=>{
            const preview=document.createElement('canvas');preview.width=320;preview.height=240;preview.getContext('2d').fillRect(0,0,320,240);return preview.captureStream(10);
          };
          window.ImageCapture=class{
            async takePhoto(){
              const still=document.createElement('canvas');still.width=1800;still.height=1200;const ctx=still.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,1800,1200);
              return new Promise(resolve=>still.toBlob(resolve,'image/jpeg',.95));
            }
          };
        });
        await page.locator('[data-mobile-route="scanner"]').click();await page.waitForFunction(()=>document.querySelector('#scannerVideo').videoWidth===320);
        await page.locator('#captureBtn').click();await page.waitForFunction(()=>window.__mock.calls.some(c=>c.action==='ocr'));
        const dimensions=await page.evaluate(async()=>{const uri=window.__mock.calls.find(c=>c.action==='ocr').params.image;const bitmap=await createImageBitmap(await(await fetch(uri)).blob());const result=[bitmap.width,bitmap.height];bitmap.close();return result;});
        assert.deepEqual(dimensions,[1800,1200]);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('unsupported and failed still capture offer native camera without saving a preview frame',async()=>{
      for(const failure of [false,true]){
        const {page,context,errors}=await start();
        try{
          await page.evaluate(failure=>{
            navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=320;c.height=240;c.getContext('2d').fillRect(0,0,320,240);return c.captureStream(10);};
            window.ImageCapture=failure?class{async takePhoto(){throw new Error('Driver failure');}}:undefined;
          },failure);
          await page.locator('[data-mobile-route="scanner"]').click();await page.waitForFunction(()=>document.querySelector('#scannerVideo').videoWidth===320);
          if(failure){await page.locator('#captureBtn').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Tap Take photo again'));}
          const chooser=page.waitForEvent('filechooser');await page.locator('#captureBtn').click();const opened=await chooser;
          assert.equal(await opened.element().getAttribute('capture'),'environment');
          assert.equal(await page.evaluate(()=>window.__mock.calls.some(c=>c.action==='ocr')),false);assert.deepEqual(errors,[]);
        }finally{await context.close();}
      }
    });
    await t.test('closing the scanner releases a camera that finishes opening late',async()=>{
      const {page,context,errors}=await start();
      try{
        await page.evaluate(()=>{navigator.mediaDevices.getUserMedia=()=>new Promise(resolve=>{window.__cameraResolve=()=>resolve({getTracks:()=>[{stop(){window.__cameraStopped=true;}}]});});});
        await page.locator('[data-mobile-route="scanner"]').click();await page.waitForFunction(()=>window.__cameraResolve);
        await page.locator('#mobileScannerClose').click();await page.evaluate(()=>window.__cameraResolve());
        await page.waitForFunction(()=>window.__cameraStopped);assert.equal(await page.locator('#scannerVideo').evaluate(video=>video.srcObject),null);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('aborting a barcode search terminates a stalled worker promptly',async()=>{
      const {page,context,errors}=await start();
      try{
        await context.route('**/barcode-worker.js',route=>route.fulfill({body:'self.onmessage=()=>{};',contentType:'text/javascript'}));
        const elapsed=await page.evaluate(async()=>{
          window.BarcodeDetector=undefined;const file=await(await fetch('./assets/icon-192.png')).blob();
          const controller=new AbortController(),start=performance.now();const search=AssetCode.scanAll(file,{signal:controller.signal});
          setTimeout(()=>controller.abort(),50);
          await search;return performance.now()-start;
        });
        assert(elapsed<1000);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('barcode worker and WASM decode offline after a successful online scan',async()=>{
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
      try{
        await context.route('https://**',route=>route.abort());await page.goto(base);await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.AssetCode);
        const fixture=await barcodeFixture(page),base64=fixture.buffer.toString('base64');
        const decode=async()=>page.evaluate(async base64=>{
          window.BarcodeDetector=undefined;const file=await(await fetch('data:image/png;base64,'+base64)).blob();return AssetCode.scanAll(file);
        },base64);
        assert((await decode()).some(c=>c.serialCandidate==='001O0I1234'));
        await page.waitForFunction(async()=>{
          const cache=await caches.open('jcp-assethub-v2.7-still-barcodes-1');return !!(await cache.match('./vendor/zxing-wasm/zxing_reader.wasm'));
        });
        await context.setOffline(true);await page.reload();await page.waitForFunction(()=>window.AssetCode);
        assert((await decode()).some(c=>c.serialCandidate==='001O0I1234'));
      }finally{await context.close();}
    });
    await t.test('scanned form accumulates camera/gallery photos and opens details after save',async()=>{
      const {page,context,errors}=await start();
      try{
        await formAfterScan(page);
        assert.equal(await page.locator('#assetPhotoPicker [data-photo-camera-input]').getAttribute('capture'),'environment');
        assert.equal(await page.locator('#assetPhotoPicker [data-photo-gallery-input]').getAttribute('capture'),null);
        await page.locator('#assetPhotoPicker [data-photo-camera-input]').setInputFiles(image('camera.png'));
        await page.locator('#assetPhotoPicker [data-photo-gallery-input]').setInputFiles([image('gallery-1.png'),image('gallery-2.png')]);
        assert.equal(await page.locator('#assetPhotoPicker .photo-picker-preview').count(),4);
        await page.getByRole('button',{name:'Remove gallery-1.png',exact:true}).click();
        assert.equal(await page.locator('#assetPhotoPicker .photo-picker-preview').count(),3);
        await checkNoOverflow(page);
        await fs.mkdir(path.resolve('test-results'),{recursive:true});
        await page.screenshot({path:path.resolve('test-results/mobile-scanned-form.png'),fullPage:true});
        await page.locator('#assetForm [type="submit"]').click();
        await page.locator('#assetDrawer.open').waitFor();
        assert.equal(await page.locator('#drawerId').textContent(),'TEST-1');
        assert(await page.locator('#page-assets').evaluate(el=>el.classList.contains('active')));
        assert(await page.locator('#modalWrap').evaluate(el=>el.classList.contains('hidden')));
        const calls=await page.evaluate(()=>window.__mock.calls);
        assert.equal(calls.filter(c=>c.action==='createAsset').length,1);
        assert.deepEqual(calls.filter(c=>c.action==='uploadImage').map(c=>c.params.imageType),['serial_label','other','other']);
        assert(await page.locator('#addAssetGallery').count());
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('failed photo retry reuses the saved asset and uploads only pending photos',async()=>{
      const {page,context,errors}=await start();
      try{
        await formAfterScan(page);
        await page.evaluate(()=>{window.__mock.failNextUpload=true;});
        await page.locator('#assetForm [type="submit"]').click();
        await page.getByRole('button',{name:'Retry photo upload',exact:true}).waitFor();
        assert.match(await page.locator('#assetSaveStatus').textContent(),/TEST-1 is saved/);
        await page.getByRole('button',{name:'Retry photo upload',exact:true}).click();
        await page.locator('#assetDrawer.open').waitFor();
        const result=await page.evaluate(()=>({creates:window.__mock.calls.filter(c=>c.action==='createAsset').length,attempts:window.__mock.uploadAttempts,images:window.__mock.assets[0].images.length}));
        assert.deepEqual(result,{creates:1,attempts:2,images:1});assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('detail gallery and camera open distinct file choosers and retain image type',async()=>{
      const {page,context,errors}=await start();
      try{
        await formAfterScan(page);await page.locator('#assetForm [type="submit"]').click();await page.locator('#assetDrawer.open').waitFor();
        // Mobile details fold secondary sections; staff explicitly opens Images.
        await page.locator('summary').filter({hasText:/^Images$/}).click();
        const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#addAssetGallery').click()]);
        assert.equal(await chooser.element().getAttribute('capture'),null);
        await chooser.setFiles(image('detail-gallery.png'));
        await page.locator('#imageType').selectOption('condition');
        await page.locator('#uploadImageSubmit').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>window.__mock.assets[0].images.at(-1).image_type),'condition');
        await page.locator('summary').filter({hasText:/^Images$/}).click();
        const [camera]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#addAssetImage').click()]);
        assert.equal(await camera.element().getAttribute('capture'),'environment');
        await camera.setFiles([]);assert.equal(await page.locator('#detailPhotoPicker .photo-picker-preview').count(),0);
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('partial photo upload retry does not repeat already uploaded evidence',async()=>{
      const {page,context,errors}=await start();
      try{
        await formAfterScan(page);
        await page.locator('#assetPhotoPicker [data-photo-gallery-input]').setInputFiles(image('extra.png'));
        await page.evaluate(()=>{window.__mock.failUploadAt=2;});
        await page.locator('#assetForm [type="submit"]').click();
        await page.getByRole('button',{name:'Retry photo upload',exact:true}).click();
        await page.locator('#assetDrawer.open').waitFor();
        assert.deepEqual(await page.evaluate(()=>({creates:window.__mock.calls.filter(c=>c.action==='createAsset').length,attempts:window.__mock.uploadAttempts,images:window.__mock.assets[0].images.map(i=>i.image_type)})),{creates:1,attempts:3,images:['serial_label','other']});
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('editing an existing asset preserves its photos and returns to details',async()=>{
      const {page,context,errors}=await start();
      try{
        await formAfterScan(page);await page.locator('#assetForm [type="submit"]').click();await page.locator('#assetDrawer.open').waitFor();
        await page.locator('#editAssetDrawer').click();
        await page.locator('#assetForm [name="model"]').fill('TEST-101');await page.locator('#assetForm [type="submit"]').click();
        await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert.equal(await page.locator('#drawerId').textContent(),'TEST-1');
        assert.deepEqual(await page.evaluate(()=>({creates:window.__mock.calls.filter(c=>c.action==='createAsset').length,updates:window.__mock.calls.filter(c=>c.action==='updateAsset').length,model:window.__mock.assets[0].model,images:window.__mock.assets[0].images.length})),{creates:1,updates:1,model:'TEST-101',images:1});
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('admin replacement keeps the original image type and uses a single selection',async()=>{
      const {page,context,errors}=await start({role:'ADMIN'});
      try{
        await page.locator('#adminToggle').click();
        await formAfterScan(page);await page.locator('#assetForm [type="submit"]').click();await page.locator('#assetDrawer.open').waitFor();
        await page.locator('summary').filter({hasText:/^Images$/}).click();await page.locator('.gallery-item').first().click();
        await page.locator('#replaceGalleryImage').click();
        const input=page.locator('#replacePhotoPicker [data-photo-gallery-input]');
        assert.equal(await input.getAttribute('multiple'),null);
        await input.setInputFiles(image('replacement-1.png'));await input.setInputFiles(image('replacement-2.png'));
        assert.equal(await page.locator('#replacePhotoPicker .photo-picker-preview').count(),1);
        await page.locator('#replaceImageSubmit').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>window.__mock.calls.find(c=>c.action==='replaceImage').params.imageType),'serial_label');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('manual edits survive delayed AI and AI outage keeps local recognition usable',async()=>{
      const {page,context,errors}=await start({ai:true,aiDelayed:true});
      try{
        await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerFile').setInputFiles(image('scan.png'));
        await page.waitForFunction(()=>window.__mock.aiRelease);
        await page.locator('[data-universal-field="brand"]').fill('Manual brand');
        await page.evaluate(()=>window.__mock.aiRelease());
        await page.waitForFunction(()=>!document.querySelector('#v27Create').disabled);
        assert.equal(await page.locator('[data-universal-field="brand"]').inputValue(),'Manual brand');
        assert(await page.locator('[data-universal-field="brand"]').evaluate(el=>el===document.activeElement));assert.deepEqual(errors,[]);
      }finally{await context.close();}
      const outage=await start({ai:true});
      try{await scan(outage.page);assert.equal(await outage.page.locator('[data-universal-field="brand"]').inputValue(),'Ricoh');assert.match(await outage.page.locator('#scanResult').textContent(),/Groq unavailable/);assert.deepEqual(outage.errors,[]);}
      finally{await outage.context.close();}
    });
    await t.test('guest scan creation retains its restricted photo upload grant',async()=>{
      const {page,context,errors}=await start({role:'GUEST'});
      try{
        await formAfterScan(page);await page.locator('#assetForm [type="submit"]').click();await page.locator('#assetDrawer.open').waitFor();
        assert.equal(await page.evaluate(()=>window.__mock.calls.find(c=>c.action==='uploadImage').params.guest_upload_token),'test-upload-grant');
        const callsBefore=await page.evaluate(()=>window.__mock.uploadAttempts);
        await page.locator('summary').filter({hasText:/^Images$/}).click();await page.locator('#addAssetGallery').click();
        await page.locator('#loginForm').waitFor();assert.equal(await page.evaluate(()=>window.__mock.uploadAttempts),callsBefore);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('desktop manual creation keeps QR workflow and supports brand suggestions',async()=>{
      const {page,context,errors}=await start({}, {width:1440,height:1000});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('#addAssetBtn').click();
        await page.locator('#assetCategory').fill('Printer');await page.locator('#assetBrand').fill('EP5ON');
        await page.locator('#assetForm .input-suggestions').getByRole('button',{name:'Epson',exact:true}).click();
        assert.equal(await page.locator('#assetBrand').inputValue(),'Epson');
        await page.locator('#assetForm [name="model"]').fill('TEST-200');await page.locator('#assetSite').selectOption('SITE-TEST');await page.locator('#assetArea').fill('Test Area');
        await checkNoOverflow(page);await page.locator('#assetForm [type="submit"]').click();
        await page.getByRole('heading',{name:'JCP Asset QR Label',exact:true}).waitFor();assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('service worker retains the dictionary and classifier on offline reload',async()=>{
      const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
      try{
        await context.route('https://**',route=>route.abort());
        await page.goto(base);await page.waitForFunction(()=>navigator.serviceWorker.controller&&window.AssetInput?.current);
        await page.evaluate(()=>navigator.serviceWorker.ready);
        await context.setOffline(true);await page.reload();
        await page.waitForFunction(()=>window.AssetInput?.current);
        assert.equal(await page.evaluate(()=>window.AssetInput.current.analyze('Brand: Ricoh').fields.brand.value),'Ricoh');
      }finally{await context.close();}
    });
    await t.test('local recognition stays within its budget under simulated slower CPU',async()=>{
      const {page,context}=await start();
      try{
        const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
        const result=await page.evaluate(()=>{
          const label=['RICOH','MULTIFUNCTION PRINTER','Model: TEST-100','Serial: O01I2345','Input Voltage: 100-240 V','Rated Frequency: 50-60 Hz','RAM: 8 GB','SSD: 512 GB',...Array.from({length:24},(_,i)=>`Regulatory information line ${i} for test equipment only`)].join('\n');
          const engine=window.AssetInput.current,measurements=[];
          for(let i=0;i<110;i++){const start=performance.now();engine.analyze(label);if(i>=10)measurements.push(performance.now()-start);}
          measurements.sort((a,b)=>a-b);
          return {p50:measurements[50],p95:measurements[95],max:measurements[99]};
        });
        console.log('Local recognition milliseconds at 4x CPU slowdown:',JSON.stringify(result));
        assert(result.p95<50,'Local classification exceeded 50 ms p95 budget');
      }finally{await context.close();}
    });
  }finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
});
