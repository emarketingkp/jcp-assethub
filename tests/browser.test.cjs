const assert=require('node:assert/strict');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const {chromium}=require('playwright');
const {test}=require('node:test');
const data=require('../public/data/input-knowledge.json');
const bwip=require('bwip-js');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
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
    const backend=createHarness(options);
    await context.exposeFunction('__assetBatchBridge',params=>({result:backend.request(params),assets:backend.read('Assets')}));
    await context.exposeFunction('__assetOperationBridge',(params,user)=>({result:JSON.parse(JSON.stringify(backend.context.saveAssetOperation_(params,user))),assets:backend.read('Assets')}));
    await context.exposeFunction('__assetReportBridge',params=>{backend.context.Session={getScriptTimeZone:()=> 'UTC'};backend.context.Utilities.formatDate=d=>d.toISOString().slice(0,10);return JSON.parse(JSON.stringify(backend.context.buildReport_(params)));});
    await context.addInitScript(({options,categories})=>{
      window.__mockOptions=options;window.__fixtureCategories=categories;
      if(!options.queue)localStorage.setItem('jcp_assethub_asset_grouping','on');
      if(options.disableIDB)Object.defineProperty(window,'indexedDB',{value:undefined});
      if(options.delayLocalAck){
        let queue;
        Object.defineProperty(window,'AssetSaveQueue',{configurable:true,get:()=>queue,set:value=>{
          const create=value.create;value.create=args=>{const q=create(args),enqueue=q.enqueue;q.enqueue=async(...args)=>{const row=await enqueue(...args);if(window.__holdLocalAck)await new Promise(resolve=>window.__releaseLocalSave=resolve);return row;};return q;};queue=value;
        }});
      }
      // Native capture is exercised with a file fixture, without granting real camera access.
      navigator.mediaDevices.getUserMedia=async()=>{throw new Error('No physical camera in automated tests');};
    },{options,categories:data.categories.map(r=>({category_id:r.categoryId,name:r.name,active:true}))});
    await context.route('**/api.js',route=>route.fulfill({path:path.join(__dirname,'fixtures/browser-api.js'),contentType:'text/javascript'}));
    await context.route('https://**',route=>route.abort());
    const page=await context.newPage(),errors=[];page.on('pageerror',err=>errors.push(err.message));
    page.setDefaultTimeout(7000);
    await page.goto(base);await page.waitForFunction(()=>window.AssetInput?.current&&window.__mock);
    if(!options.delayStartup)await page.locator('#appLoading').waitFor({state:'hidden'});
    return {page,context,errors,backend};
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
  const stock=(id,extra={})=>({asset_id:id,category:'Monitor',category_name:'Monitor',category_id:'CAT-MON',brand:'Sample',model:'M-10',specifications:'Size: 24 inch',serial:'',site_id:'SITE-TEST',site:'Test Site',site_name:'Test Site',area:'Test Area',area_name:'Test Area',status:'Active',updated_at:'2026-01-01T00:00:00.000Z',...extra});
  async function startSameBatch(page,count=2){
    await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetGroupBtn').click();await page.locator('[data-batch-mode="same"]').click();
    for(const [key,value]of Object.entries({category:'Monitor',brand:'Sample',model:'M-10',part_code:'SHARED-10',area:'Test Area'}))await page.locator(`[data-batch-common="${key}"]`).fill(value);
    await page.locator('[data-batch-common="site_id"]').selectOption('SITE-TEST');
    if(count!==2){await page.locator('#batchQuantity').fill(String(count));await page.locator('#batchQuantity').press('Tab');}
  }
  if(process.env.BROWSER_SCENARIO){const run=t.test.bind(t),pattern=new RegExp(process.env.BROWSER_SCENARIO,'i');t.test=(name,...args)=>pattern.test(name)?run(name,...args):Promise.resolve();}
  try{
    await t.test('Unified: generic named units register together without dropping fields or copying private identity',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,unified:true});
      try{
        await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerManualEntry').click();
        await page.locator('#assetForm [name="asset_name"]').fill('Lobby chair 01');await page.locator('#assetForm [name="category"]').fill('Furniture');
        await page.locator('#assetSite').selectOption('SITE-TEST');await page.locator('#assetArea').fill('Lobby');
        await page.locator('#assetForm [name="exact_location"]').fill('Entrance');await page.locator('#assetForm [name="assigned_to"]').fill('Front desk');
        await page.locator('#assetForm details').filter({hasText:'Staff-only information'}).locator('summary').click();await page.locator('[data-private="account_number"]').fill('000123');
        await page.locator('#addMatchingUnit').click();await page.locator('[data-unit-name]').fill('Lobby chair 02');await page.locator('#assetForm [type="submit"]').click();
        await page.waitForFunction(()=>window.__mock.assets.length===2);assert.equal(backend.read('Assets')[0].asset_name,'Lobby chair 01');assert.equal(backend.read('Assets')[1].asset_name,'Lobby chair 02');
        assert.equal(backend.read('Assets')[0].exact_location,'Entrance');assert.equal(backend.read('Assets')[1].exact_location,'Entrance');assert.equal(backend.read('AssetPrivate').length,1);assert.equal(backend.read('AssetPrivate')[0].account_number,'000123');
        assert.equal(await page.locator('#modalWrap').isVisible(),false);assert(await page.locator('#assetDrawer').evaluate(el=>el.classList.contains('open')));assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('Unified: scan result exposes the complete editor, a serial reader and immediate named detail',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,unified:true});
      try{
        await scan(page);await page.locator('[data-universal-field="asset_name"]').fill('Finance printer');await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Finance');
        assert.equal(await page.locator('#scanResult [data-entry-field="exact_location"]').count(),1);assert.equal(await page.locator('#scanResult [data-entry-field="assigned_to"]').count(),1);assert.equal(await page.locator('#scanResult .serial-reader-button').count(),1);
        await page.locator('.v27-photo img').click();await page.locator('.asset-media-dialog').waitFor();assert(await page.locator('#v27Create').isVisible());await page.locator('.asset-media-dialog .iconbtn').click();
        await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.waitForFunction(()=>window.__mock.assets.length===1);assert.equal(backend.read('Assets')[0].asset_name,'Finance printer');assert.match(await page.locator('#drawerBody .detail-title h2').textContent(),/Finance printer/);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('Unified: asset list only browses; matching registration in details resets names and serials',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,unified:true,assets:[stock('PC1',{asset_name:'Finance PC 01',serial:'PC-SN-001'}),stock('PC2',{asset_name:'Reception PC 01',serial:'PC-SN-002'})]},{width:1440,height:1100});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();assert(await page.locator('#addAssetBtn').isHidden());await page.locator('.asset-group summary').click();assert.equal(await page.locator('[data-group-add]').count(),0);
        await page.locator('[data-asset="PC1"]').click();await page.locator('#registerMatchingUnits').click();assert.equal(await page.locator('#assetForm [name="asset_name"]').inputValue(),'');assert.equal(await page.locator('#assetForm [name="serial"]').inputValue(),'');assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'M-10');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('Unified: an unfinished form and its photo survive Pending and a reload',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,unified:true});
      try {
        await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerManualEntry').click();
        await page.locator('#assetForm [name=asset_name]').fill('Unfinished pump');await page.locator('#assetForm [name=category]').fill('Pump');
        await page.locator('#assetPhotoPicker [data-photo-gallery-input]').setInputFiles(image('unfinished.png'));
        await page.locator('#cancelAssetForm').click();await page.locator('#editorDraftsBtn').waitFor({state:'visible'});
        await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.locator('#editorDraftsBtn').click();await page.locator('[data-resume-draft]').click();
        assert.equal(await page.locator('#assetForm [name=asset_name]').inputValue(),'Unfinished pump');assert.equal(await page.locator('#assetPhotoPicker .photo-picker-preview').count(),1);
        await page.locator('#assetPhotoPicker img').click();await page.locator('.asset-media-dialog .iconbtn').click();assert.equal(await page.locator('#assetForm [name=category]').inputValue(),'Pump');assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('Unified: full comparison edits missing fields, preserves omitted fields and explicitly clears reviewed data',async()=>{
      const a=stock('REVIEW',{serial:'O01I2345',asset_name:'Old name',exact_location:'Old location',assigned_to:'Keep team'});
      const {page,context,backend,errors}=await start({links:true,queue:true,unified:true,assets:[a],matches:[{asset:a,reasons:['Serial match'],conflicts:[]}]});
      try {
        await scan(page);await page.locator('[data-v27-match]').click();await page.locator('#reconcileForm').waitFor();
        assert.equal(await page.locator('#reconcileForm [data-review-field]').count(),12);assert.equal(await page.locator('#reconcileForm .serial-reader-button').count(),1);
        await page.locator('[data-review-field=asset_name]').fill('Reviewed name');await page.locator('[data-review-field=exact_location]').fill('');
        await page.locator('[data-review-field=assigned_to]').fill('');await page.locator('[name=choice_assigned_to][value=existing]').check();
        await page.locator('#reconcileForm [type=submit]').click();await page.waitForFunction(()=>window.__mock.assets[0].asset_name==='Reviewed name');
        assert.equal(backend.read('Assets')[0].exact_location,'');assert.equal(backend.read('Assets')[0].assigned_to,'Keep team');assert.equal(backend.read('Assets').length,1);assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('Unified: failed earlier scan review returns to the exact interrupted named form and photo',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,unified:true,assets:[stock('TAKEN',{serial:'OTHER'})]});
      try {
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Lobby');backend.context.writeLinkedAssetPatch_('TAKEN',{serial:'O01I2345'});await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.locator('#saveFailureNotice').waitFor();await page.locator('#closeDrawerBtn').click();
        await page.locator('[data-mobile-route=scanner]').click();await page.locator('#scannerManualEntry').click();await page.locator('#assetForm [name=asset_name]').fill('Continue this chair');await page.locator('#assetPhotoPicker [data-photo-gallery-input]').setInputFiles(image('chair.png'));
        await page.locator('#formPendingSaves').click();await page.locator('[data-review-save]').click();await page.locator('[data-universal-field=serial]').fill('UNIQUE-REVIEW');await page.locator('#v27Create').click();
        await page.locator('#assetForm').waitFor();assert.equal(await page.locator('#assetForm [name=asset_name]').inputValue(),'Continue this chair');assert.equal(await page.locator('#assetPhotoPicker .photo-picker-preview').count(),1);
        await page.waitForFunction(()=>window.__mock.assets.length===2);assert.equal(backend.read('Assets').length,2);assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('Unified: serial popup fills one exact barcode and stops the camera without changing pages',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,unified:true});
      try {
        await page.locator('[data-mobile-route=scanner]').click();await page.locator('#scannerManualEntry').click();
        await page.evaluate(()=>{
          window.__serialTracks=[];window.BarcodeDetector=class {async detect(){return [{rawValue:'000oO1iI23'}];}};
          navigator.mediaDevices.getUserMedia=async()=>{const c=document.createElement('canvas');c.width=640;c.height=360;c.getContext('2d').fillRect(0,0,640,360);const stream=c.captureStream(10);window.__serialTracks.push(...stream.getTracks());return stream;};
        });
        await page.locator('#assetForm .serial-reader-button').click();await page.waitForFunction(()=>document.querySelector('#assetForm [name=serial]').value==='000oO1iI23').catch(async err=>{throw new Error(err.message+' / '+await page.locator('.asset-media-dialog').textContent()+' / '+errors.join(';'));});
        assert.equal(await page.locator('.asset-media-dialog').count(),0);assert.equal(await page.evaluate(()=>window.__serialTracks.every(t=>t.readyState==='ended')),true);assert(await page.locator('#assetForm').isVisible());assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('Unified: linked OCR carries placement and shared custom information without unit identity',async()=>{
      const main=stock('MAIN',{asset_name:'Finance desk',serial:'MAIN-SN',exact_location:'Desk 2',assigned_to:'Finance',custom_fields:[{field_id:'COST',value:'Operations'},{field_id:'IMEI',value:'UNIQUE-IDENTITY'}]});
      const customFields=[{field_id:'COST',label:'Cost centre',field_type:'text',required:false,active:true},{field_id:'IMEI',label:'IMEI',field_type:'text',required:false,active:true}];
      const {page,context,errors}=await start({links:true,queue:true,unified:true,assets:[main],customFields});
      try {
        await page.locator('[data-mobile-route=assets]').click();if(await page.locator('.asset-group summary').count())await page.locator('.asset-group summary').click();await page.locator('[data-asset=MAIN]').click();await page.locator('#addLinkedAsset').click();await page.locator('#linkedAssetYes').click();await page.locator('#linkedAssetOcr').click();await page.locator('#scannerFile').setInputFiles(image('peripheral.png'));await page.locator('#v27Create').waitFor();
        assert.equal(await page.locator('#scanEntrySite').inputValue(),'SITE-TEST');assert.equal(await page.locator('#scanEntryArea').inputValue(),'Test Area');assert.equal(await page.locator('[data-entry-field=exact_location]').inputValue(),'Desk 2');assert.equal(await page.locator('[data-custom=COST]').inputValue(),'Operations');assert.equal(await page.locator('[data-custom=IMEI]').inputValue(),'');assert.equal(await page.locator('[data-universal-field=asset_name]').inputValue(),'');assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('Unified: matching units have individual placement, custom values, private details and photos',async()=>{
      const customFields=[{field_id:'COST',label:'Cost centre',field_type:'text',required:false,active:true}];
      const {page,context,backend,errors}=await start({links:true,queue:true,unified:true,customFields});
      try {
        await page.locator('[data-mobile-route=scanner]').click();await page.locator('#scannerManualEntry').click();
        await page.locator('#assetForm [name=asset_name]').fill('Room lamp 01');await page.locator('#assetForm [name=category]').fill('Lighting');await page.locator('#assetSite').selectOption('SITE-TEST');await page.locator('#assetArea').fill('Meeting room');await page.locator('[data-custom=COST]').fill('Team A');
        await page.locator('#addMatchingUnit').click();await page.locator('[data-unit-name]').fill('Room lamp 02');
        const unit=page.locator('[data-extra-unit]');await unit.locator('summary').first().click();await unit.locator('[data-unit-override=area]').fill('Lobby');
        await unit.locator('details').filter({hasText:'Custom information for this unit'}).last().locator('summary').click();await unit.locator('[data-unit-custom=COST]').fill('Team B');
        await unit.locator('details').filter({hasText:'Staff-only information for this unit'}).last().locator('summary').click();await unit.locator('[data-unit-private=account_number]').fill('00042');
        await unit.locator('[data-photo-gallery-input]').setInputFiles(image('lamp-02.png'));await checkNoOverflow(page);await page.locator('#assetForm [type=submit]').click();
        await page.waitForFunction(()=>window.__mock.assets.length===2);assert.equal(backend.read('Assets')[1].area,'Lobby');assert.deepEqual(backend.read('CustomValues').map(v=>v.value),['Team A','Team B']);assert.equal(backend.read('AssetPrivate').length,1);assert.equal(backend.read('AssetPrivate')[0].asset_id,backend.read('Assets')[1].asset_id);assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('Unified: browser Back closes previews and editors before returning to the previous page',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,unified:true});
      try {
        await page.locator('[data-mobile-route=assets]').click();await page.locator('[data-mobile-route=scanner]').click();await page.locator('#scannerManualEntry').click();await page.locator('#assetForm [name=asset_name]').fill('Keep this draft');await page.locator('#assetPhotoPicker [data-photo-gallery-input]').setInputFiles(image('back.png'));await page.locator('#assetPhotoPicker img').click();
        await page.goBack();await page.locator('.asset-media-dialog').waitFor({state:'detached'});assert(await page.locator('#assetForm').isVisible());await page.goBack();await page.locator('#modalWrap').waitFor({state:'hidden'});await page.goBack();assert(await page.locator('#page-assets').evaluate(el=>el.classList.contains('active')));await page.locator('#editorDraftsBtn').click();await page.locator('[data-resume-draft]').click();assert.equal(await page.locator('#assetForm [name=asset_name]').inputValue(),'Keep this draft');assert.deepEqual(errors,[]);
      } finally {await context.close();}
    });
    await t.test('scan save returns to the register before confirmation and linked OCR starts one fresh camera',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');
        await page.locator('#v27Create').click();await page.locator('#linkedAssetYes').waitFor();
        assert(await page.locator('#page-assets').evaluate(el=>el.classList.contains('active')));
        assert.equal(await page.locator('#scannerVideo').evaluate(el=>el.srcObject),null);
        await page.evaluate(()=>{
          window.__cameraRequests=0;
          navigator.mediaDevices.getUserMedia=async()=>{window.__cameraRequests++;const c=document.createElement('canvas');c.width=320;c.height=240;c.getContext('2d').fillRect(0,0,320,240);return c.captureStream(10);};
        });
        await page.locator('#linkedAssetYes').click();assert.equal(await page.evaluate(()=>window.__cameraRequests),0);
        await page.locator('#linkedAssetOcr').click();await page.waitForFunction(()=>document.getElementById('scannerVideo').videoWidth===320);
        assert.equal(await page.evaluate(()=>window.__cameraRequests),1);assert(await page.locator('#modalWrap').isHidden());assert.equal(await page.locator('.v27-photo').count(),0);
        assert(await page.locator('#scannerMainContext').isVisible());assert.equal(await page.locator('#page-scanner').evaluate(el=>el.scrollTop),0);
        await page.locator('#mobileScannerClose').click();await page.waitForFunction(()=>!document.getElementById('scannerVideo').srcObject);
        assert.equal(backend.read('Assets').length,1);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('leaving and returning to a processing scan preserves the review and never restarts its camera',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,ocrDelayed:true});
      try{
        await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerFile').setInputFiles(image('unfinished.png'));
        await page.waitForFunction(()=>window.__mock.ocrRelease);await page.locator('[data-universal-field="model"]').fill('Keep reviewed model');
        await page.locator('#scanEntryArea').fill('Keep placement');await page.locator('#mobileScannerResultClose').click();
        await page.evaluate(()=>{window.__cameraRequests=0;navigator.mediaDevices.getUserMedia=async()=>{window.__cameraRequests++;throw Error('Should not open');};window.__mock.ocrRelease();});
        await page.waitForFunction(()=>!document.getElementById('v27Create').disabled);
        assert(await page.locator('#page-dashboard').evaluate(el=>el.classList.contains('active')));
        await page.locator('[data-mobile-route="scanner"]').click();
        assert(await page.locator('#v27Create').isVisible());assert.equal(await page.locator('[data-universal-field="model"]').inputValue(),'Keep reviewed model');
        assert.equal(await page.locator('#scanEntryArea').inputValue(),'Keep placement');assert.equal(await page.evaluate(()=>window.__cameraRequests),0);
        await page.locator('#v27Reset').click();assert.equal(await page.locator('.v27-photo').count(),0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('scan-to-update starts fresh and a later linked scan cannot inherit that update target',async()=>{
      const main=stock('ROOT',{model:'Recorder'}),existing=stock('UPDATE-ME');
      const {page,context,errors}=await start({links:true,queue:true,assets:[main,existing]});
      try{
        await scan(page);await page.locator('[data-universal-field="model"]').fill('Previous evidence');await page.locator('#mobileScannerResultClose').click();
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('[data-asset="UPDATE-ME"]').click();await page.locator('#editAssetDrawer').click();
        await page.locator('#scanUpdateAsset').click();assert.equal(await page.locator('.v27-photo').count(),0);
        await page.locator('#scannerFile').setInputFiles(image('update-label.png'));await page.locator('#v27UpdateTarget').waitFor();
        await page.locator('#mobileScannerResultClose').click();await page.locator('[data-mobile-route="assets"]').click();
        await page.locator('[data-asset="ROOT"]').click();await page.locator('#addLinkedAsset').click();await page.locator('#linkedAssetYes').click();await page.locator('#linkedAssetOcr').click();
        await page.locator('#scannerFile').setInputFiles(image('child-label.png'));await page.locator('#v27Create').waitFor();
        assert.equal(await page.locator('#v27UpdateTarget').count(),0);assert.equal(await page.locator('.v27-photo').count(),1);assert.match(await page.locator('#scanMainSelected').textContent(),/ROOT/);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('photo-only linking retains choices on camera cancellation and dismisses the old drawer on manual entry',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,assets:[stock('ROOT')]});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('[data-asset="ROOT"]').click();await page.locator('#addLinkedAsset').click();await page.locator('#linkedAssetYes').click();
        const first=await Promise.all([page.waitForEvent('filechooser'),page.locator('#linkedAssetPhoto').click()]);await first[0].setFiles([]);
        assert(await page.locator('#linkedAssetPhoto').isVisible());assert.equal(await page.locator('#assetForm').count(),0);
        const next=await Promise.all([page.waitForEvent('filechooser'),page.locator('#linkedAssetPhoto').click()]);await next[0].setFiles(image('unlabelled.png'));
        await page.locator('#assetForm').waitFor();assert.equal(await page.locator('#assetDrawer').evaluate(el=>el.classList.contains('open')),false);
        assert.match(await page.locator('#formMainSelected').textContent(),/ROOT/);assert.equal(await page.locator('#assetPhotoPicker .photo-picker-preview').count(),1);
        await page.locator('#cancelAssetForm').click();assert(await page.locator('#modalWrap').isHidden());assert(await page.locator('#page-assets').evaluate(el=>el.classList.contains('active')));assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('late scan reconciliation cannot reopen a popup after navigating elsewhere',async()=>{
      const existing=stock('EXISTING',{brand:'Ricoh',model:'TEST-100',serial:'O01I2345'});
      const {page,context,errors}=await start({links:true,queue:true,delayAssetDetails:true,assets:[existing],matches:[{score:100,asset:existing,reasons:['same serial']}]});
      try{
        await scan(page);await page.locator('[data-v27-match="0"]').click();await page.waitForFunction(()=>window.__mock.detailReleases?.EXISTING);
        await page.locator('#mobileScannerResultClose').click();await page.evaluate(()=>window.__mock.detailReleases.EXISTING());await page.waitForTimeout(100);
        assert(await page.locator('#modalWrap').isHidden());assert(await page.locator('#page-dashboard').evaluate(el=>el.classList.contains('active')));assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a closed pending-draft review cannot replace a newly opened form when detail loading finishes',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,assets:[stock('EDIT')],delayAssetDetails:true});
      try{
        await page.evaluate(async()=>{
          const q=AssetSaveQueue.create({scope:'links-v1|/test-backend|test-staff|STAFF',api:AssetAPI,online:()=>false});
          const row=await q.enqueue({id:crypto.randomUUID(),kind:'update',params:{asset_id:'EDIT',brand:'New brand',model:'New model',site_id:'SITE-TEST',area:'Desk',custom_json:'{}'}});
          row.state='Retry';row.error='OPERATION_NOT_STARTED: STALE_ASSET';
          const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('jcp-assethub-operations',1);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
          await new Promise((resolve,reject)=>{const tx=db.transaction('operations','readwrite');tx.objectStore('operations').put(row);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
        });
        await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.locator('#pendingSavesBtn').click();await page.locator('[data-review-save]').click();await page.waitForFunction(()=>window.__mock.detailReleases?.EDIT);
        await page.locator('#modalCloseBtn').click();await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetBtn').click();await page.locator('#assetForm [name="model"]').fill('Keep this form');
        await page.evaluate(()=>window.__mock.detailReleases.EDIT());await page.waitForTimeout(100);assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'Keep this form');assert.equal(await page.locator('#pendingReviewForm').count(),0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('late image delivery cannot attach the old asset actions to a linked asset drawer',async()=>{
      const a=stock('A',{model:'Main model',thumbnail_file_id:'SLOW-IMAGE'}),b=stock('B',{model:'Child model',parent_asset_id:'A'});
      const {page,context,errors}=await start({links:true,queue:true,assets:[a,b],delayImages:true},{width:1440,height:1000});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('[data-asset="A"]').click();await page.waitForFunction(()=>window.__mock.imageReleases?.['SLOW-IMAGE']);
        await page.locator('[data-linked-member="B"]').click();await page.waitForFunction(()=>document.getElementById('drawerId').textContent==='B');
        await page.evaluate(()=>window.__mock.imageReleases['SLOW-IMAGE']());await page.waitForTimeout(100);
        await page.locator('#editAssetDrawer').click();assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'Child model');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a delayed cached detail lookup cannot replace a newer drawer with a loading screen',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,assets:[stock('A'),stock('B',{model:'Newest drawer'})]},{width:1440,height:1000});
      try{
        await page.evaluate(()=>{const get=AssetStore.get;AssetStore.get=(key,...args)=>String(key).startsWith('detail:')&&String(key).endsWith(':A')?new Promise(resolve=>window.__releaseCachedDetail=()=>resolve(null)):get(key,...args);});
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('[data-asset="A"]').click();await page.waitForFunction(()=>window.__releaseCachedDetail);
        await page.locator('#closeDrawerBtn').click();await page.locator('[data-asset="B"]').click();await page.locator('#editAssetDrawer').waitFor();
        await page.evaluate(()=>window.__releaseCachedDetail());await page.waitForTimeout(100);await page.locator('#editAssetDrawer').click();assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'Newest drawer');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a main-tag lookup finishing after cancel cannot change a replacement form',async()=>{
      const {page,context,errors}=await start({links:true,queue:true});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetBtn').click();await page.locator('#formMainField summary').click();await page.locator('[name="formMainMode"][value="link"]').check();
        await page.evaluate(()=>{AssetCode.scanAll=()=>new Promise(resolve=>window.__releaseTag=()=>resolve([]));});
        const chooser=await Promise.all([page.waitForEvent('filechooser'),page.locator('#formMainScan').click()]);await chooser[0].setFiles(image('tag.png'));await page.waitForFunction(()=>window.__releaseTag);
        await page.locator('#cancelAssetForm').click();await page.locator('#addAssetBtn').click();await page.locator('#assetForm [name="model"]').fill('New form');
        await page.evaluate(()=>window.__releaseTag());await page.waitForTimeout(100);assert.equal(await page.locator('#formMainError').textContent(),'');assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'New form');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a scan save finishing after leaving does not close the new form or reopen the saved review',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,delayLocalAck:true});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');await page.evaluate(()=>window.__holdLocalAck=true);
        await page.locator('#v27Create').click();await page.waitForFunction(()=>window.__releaseLocalSave);await page.locator('#mobileScannerResultClose').click();
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetBtn').click();await page.locator('#assetForm [name="model"]').fill('Next form');
        await page.evaluate(()=>window.__releaseLocalSave());await page.waitForTimeout(100);assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'Next form');
        await page.locator('#cancelAssetForm').click();await page.locator('[data-mobile-route="scanner"]').click();assert.equal(await page.locator('.v27-photo').count(),0);assert.equal(await page.locator('#linkedAssetYes').count(),0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a reviewed scan update finishing after cancel cannot replace a new form',async()=>{
      const existing=stock('EXISTING',{brand:'Ricoh',model:'TEST-100',serial:'O01I2345'});
      const {page,context,errors}=await start({links:true,queue:true,delayLocalAck:true,assets:[existing],matches:[{score:100,asset:existing,reasons:['same serial']}]});
      try{
        await scan(page);await page.locator('[data-v27-match="0"]').click();await page.locator('#reconcileForm').waitFor();await page.evaluate(()=>window.__holdLocalAck=true);
        await page.locator('#reconcileForm [type="submit"]').click();await page.waitForFunction(()=>window.__releaseLocalSave);await page.locator('#modalCloseBtn').click();await page.locator('#mobileScannerResultClose').click();
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetBtn').click();await page.locator('#assetForm [name="model"]').fill('Next form');
        await page.evaluate(()=>window.__releaseLocalSave());await page.waitForTimeout(100);assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'Next form');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('cached Guest boot cannot send anonymous drafts using a saved Staff sign-in',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,delayStartup:true});
      try{
        await page.evaluate(async()=>{
          const proof=crypto.randomUUID();localStorage.setItem('jcp_assethub_guest_drafts',proof);localStorage.setItem('fixture-session','test-session-test-staff');
          localStorage.setItem('jcp_assethub_cache_boot_v1',JSON.stringify({saved_at:Date.now(),data:{success:true,features:{asset_links:1,sequential_saves:1},authenticated:false,user:{name:'Guest',username:'guest',role:'GUEST'},references:{sites:[],areas:[],categories:window.__fixtureCategories,custom_fields:[],brands:[],assignees:[],locations:[],users:[]},dashboard:{}}}));
          const q=AssetSaveQueue.create({scope:'links-v1|/test-backend|guest:'+proof+'|GUEST',guestKey:proof,api:AssetAPI,online:()=>false});await q.enqueue({id:crypto.randomUUID(),kind:'create',params:{category:'Camera',brand:'',model:'',serial:'ANONYMOUS',site_id:'SITE-TEST',area:'Desk',custom_json:'{}'}});
        });
        await page.reload();await page.waitForFunction(()=>window.__mock?.syncRelease);await page.waitForTimeout(150);
        assert.equal(backend.read('Assets').length,0);assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='saveAssetOperation').length),0);assert(await page.locator('#pendingSavesBtn').isHidden());
        await page.evaluate(()=>window.__mock.syncRelease());await page.waitForFunction(()=>document.getElementById('profileRole').textContent==='STAFF');assert.equal(backend.read('Assets').length,0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('scanning an existing asset links it only after explicit approval and preserves its placement',async()=>{
      const main=stock('ROOT',{model:'Recorder',serial:'ROOT-SERIAL'}),old=stock('OLD',{model:'Old main'}),camera=stock('CAMERA',{brand:'Ricoh',model:'TEST-100',serial:'O01I2345',parent_asset_id:'OLD',area:'Door',area_name:'Door'});
      const {page,context,backend,errors}=await start({links:true,queue:true,assets:[main,old,camera],matches:[{score:100,reasons:['same serial'],asset:camera}]});
      try{await page.locator('[data-mobile-route="assets"]').click();await page.locator('[data-asset="ROOT"]').click();await page.locator('#addLinkedAsset').click();await page.locator('#linkedAssetYes').click();await page.locator('#linkedAssetOcr').click();await page.locator('#scannerFile').setInputFiles(image('known-asset-label.png'));await page.locator('[data-v27-match="0"]').waitFor();await page.waitForFunction(()=>!document.getElementById('v27Create').disabled);await page.locator('[data-v27-match="0"]').click();await page.locator('#reconcileForm').waitFor();assert(await page.locator('[name="reviewMainLink"][value="keep"]').isChecked());await page.locator('[name="reviewMainLink"][value="link"]').check();await page.locator('#reconcileForm [type="submit"]').click();await page.waitForFunction(()=>window.__mock.assets.find(a=>a.asset_id==='CAMERA').parent_asset_id==='ROOT');const saved=backend.read('Assets').find(a=>a.asset_id==='CAMERA');assert.equal(saved.area,'Door');assert.equal(backend.read('Assets').length,3);assert.equal(backend.read('Movements').length,0);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('selected main context survives reopening without carrying serials or photos into a new scan',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,assets:[stock('ROOT',{model:'Recorder',serial:'ROOT-SERIAL'})]});
      try{await page.locator('[data-mobile-route="assets"]').click();await page.locator('[data-asset="ROOT"]').click();await page.locator('#addLinkedAsset').click();await page.locator('#linkedAssetYes').click();await page.locator('#linkedAssetOcr').click();await page.waitForFunction(async()=>!!await AssetStore.get('entry-main:'+encodeURIComponent('links-v1|/test-backend|test-staff|STAFF')));await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.locator('[data-mobile-route="scanner"]').click();await page.locator('#scannerMainContext').waitFor();assert.match(await page.locator('#scannerMainContext').textContent(),/Recorder/);assert.equal(await page.locator('.v27-photo').count(),0);await page.locator('#scannerFile').setInputFiles(image('new-label.png'));await page.locator('#scanMainSelected').waitFor();assert.match(await page.locator('#scanMainSelected').textContent(),/ROOT/);assert.equal(await page.locator('#scanEntryArea').inputValue(),'Test Area');assert.equal(await page.locator('[data-universal-field="serial"]').inputValue(),'O01I2345');assert.equal(await page.locator('.v27-photo').count(),1);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('new workflow fallback loads more than 1000 summaries through pages',async()=>{
      const assets=Array.from({length:1003},(_,i)=>stock('ASSET-'+String(i).padStart(5,'0')));
      const {page,context,errors}=await start({links:true,queue:true,failStartupSync:true,assets},{width:1440,height:1000});
      try{await page.locator('.nav-btn[data-route="assets"]').click();await page.waitForFunction(()=>document.getElementById('assetScopeCount').textContent.includes('1003 loaded'));assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='assetSummaryPage').length),6);assert.equal(await page.locator('.asset-group').count(),0);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('direct result retains conflicts, manual overrides, placement and required custom values across two source photos',async()=>{
      const customFields=[{field_id:'CF-OWNER',label:'Owner',field_type:'text',required:true,active:true}];
      const {page,context,backend,errors}=await start({links:true,queue:true,customFields});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Keep this area');await page.locator('[data-universal-field="model"]').fill('Manual review');
        await page.evaluate(()=>window.__mockOptions.ocrText='Brand: Ricoh\nCategory: Printer\nModel: TEST-100\nSerial: DIFFERENT-2');await page.locator('#scannerFile').setInputFiles(image('second-label.png'));await page.locator('[data-conflict$=":serial"]').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.v27-photo').length===2&&!document.querySelector('.v27-step.busy'));
        assert(await page.locator('#v27Create').isDisabled());for(const select of await page.locator('[data-conflict]').all())await select.selectOption(await select.locator('option').nth(1).getAttribute('value'));await page.waitForFunction(()=>!document.getElementById('v27Create').disabled);
        assert.equal(await page.locator('#scanEntryArea').inputValue(),'Keep this area');assert.equal(await page.locator('[data-universal-field="model"]').inputValue(),'Manual review');await page.locator('#v27Create').click();assert.equal(backend.read('Assets').length,0);await page.locator('[data-custom="CF-OWNER"]').fill('Security');await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.waitForFunction(()=>window.__mock.assets.length===1);assert.equal(backend.read('Assets')[0].model,'Manual review');assert.equal(backend.read('CustomValues')[0].value,'Security');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a duplicate rejection reopens the original scan evidence and revises the same unstarted operation',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,assets:[stock('EXISTING',{serial:'O01I2345'})]});
      try{await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.locator('#pendingSavesBtn').click();await page.locator('[data-review-save]').click();assert.equal(await page.locator('.v27-photo').count(),1);assert.equal(await page.locator('#scanEntryArea').inputValue(),'Desk');await page.locator('[data-universal-field="serial"]').fill('NEW-UNIQUE');await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.waitForFunction(()=>window.__mock.assets.length===2);assert.equal(backend.read('Assets').length,2);assert.equal(backend.read('AssetBatches').length,1);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('stale queued edits compare latest values and apply a draft only after explicit review',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,assets:[stock('EDIT-ME')]},{width:1440,height:1000});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('[data-asset="EDIT-ME"]').click();await page.locator('#editAssetDrawer').click();await page.locator('#assetForm [name="model"]').fill('My draft');backend.context.writeLinkedAssetPatch_('EDIT-ME',{model:'Another user edit',updated_at:'2099-01-01T00:00:00.000Z'});await page.evaluate(()=>Object.assign(window.__mock.assets[0],{model:'Another user edit',updated_at:'2099-01-01T00:00:00.000Z'}));await page.locator('#assetForm [type="submit"]').click();await page.locator('#modalWrap').waitFor({state:'hidden'});await page.locator('#saveFailureNotice').waitFor();await page.locator('#pendingSavesBtn').click();await page.locator('[data-review-save]').click();await page.locator('#pendingReviewForm').waitFor();assert.match(await page.locator('#pendingReviewForm').textContent(),/Another user edit/);assert.match(await page.locator('#pendingReviewForm').textContent(),/My draft/);assert(await page.locator('[name="review_model"][value="latest"]').isChecked());await page.locator('[name="review_model"][value="draft"]').check();await page.locator('#pendingReviewForm [type="submit"]').click();await page.waitForFunction(()=>window.__mock.assets[0].model==='My draft');assert.equal(backend.read('Assets')[0].model,'My draft');assert.equal(backend.read('Assets').length,1);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('expired authentication hides drafts, another account cannot send them, and the original account resumes',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true});
      async function login(name){await page.locator('#loginUsername').fill(name);await page.locator('#loginPassword').fill('synthetic');await page.locator('#loginSubmit').click();await page.locator('#modalWrap').waitFor({state:'hidden'});}
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Private draft area');await page.evaluate(()=>window.__mock.expired=true);await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.locator('#pendingSavesBtn').click();await page.locator('#resumePendingSignIn').waitFor();assert.equal((await page.locator('#modalBody').textContent()).includes('Private draft area'),false);await page.locator('#resumePendingSignIn').click();await login('other-staff');assert.equal(backend.read('Assets').length,0);assert(await page.locator('#pendingSavesBtn').isHidden());
        await page.locator('#profileBtn').click();await page.locator('#logoutBtn').click();await page.waitForFunction(()=>document.getElementById('profileName').textContent==='Guest');await page.locator('#profileBtn').click();await page.locator('#signInBtn').click();await login('test-staff');await page.waitForFunction(()=>window.__mock.assets.length===1);assert.equal(backend.read('Assets').length,1);assert.equal(backend.read('Assets')[0].area,'Private draft area');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('placement updates and retirement leave related records in their original placement and status',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,role:'ADMIN',assets:[stock('ROOT'),stock('CHILD',{parent_asset_id:'ROOT'})]},{width:1440,height:1100});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('[data-asset="ROOT"]').click();await page.locator('.asset-drawer-more>summary').click();await page.locator('#moveAssetDrawer').click();await page.locator('#moveArea').fill('New room');await page.locator('#moveAssignForm [type="submit"]').click();await page.locator('#modalWrap').waitFor({state:'hidden'});await page.waitForFunction(()=>window.__mock.assets.find(a=>a.asset_id==='ROOT').area==='New room');assert.equal(backend.read('Assets').find(a=>a.asset_id==='CHILD').area,'Test Area');assert.equal(backend.read('Movements').length,1);
        await page.locator('#adminToggle').click();await page.locator('[data-asset="ROOT"]').click();await page.locator('#editAssetDrawer').click();await page.locator('#retireAssetBtn').click();assert.match(await page.locator('#modalBody').textContent(),/linked assets keep/);await page.locator('#confirmRetirement').click();await page.waitForFunction(()=>window.__mock.assets.find(a=>a.asset_id==='ROOT').status==='Retired');const child=backend.read('Assets').find(a=>a.asset_id==='CHILD');assert.equal(child.status,'Active');assert.equal(child.parent_asset_id,'ROOT');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('reports and ordinary register search include the main asset without grouping physical records',async()=>{
      const {page,context,errors}=await start({links:true,queue:true,assets:[stock('ROOT',{model:'Recorder'}),stock('CHILD',{parent_asset_id:'ROOT',model:'Camera'})]},{width:1440,height:1000});
      try{await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('#assetSearch').fill('Recorder');assert.equal(await page.locator('#assetList [data-asset]').count(),2);assert.equal(await page.locator('.asset-group').count(),0);await page.locator('.nav-btn[data-route="reports"]').click();await page.locator('#reportBody').getByText('Recorder',{exact:true}).first().waitFor();assert.match(await page.locator('#reportHead').textContent(),/Main Asset/);assert.match(await page.locator('#reportBody').textContent(),/CHILD/);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('direct scan saves reviewed evidence and placement once, with no second Add form',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');
        await page.locator('[data-universal-field="model"]').fill('Reviewed model');await page.locator('#v27Create').click();await page.locator('#linkedAssetYes').waitFor();
        assert.equal(await page.locator('#assetForm').count(),0);await page.waitForFunction(()=>window.__mock.assets.length===1);assert.equal(backend.read('Assets')[0].model,'Reviewed model');
        const op=await page.evaluate(()=>new Promise((resolve,reject)=>{const req=indexedDB.open('jcp-assethub-operations');req.onsuccess=()=>{const tx=req.result.transaction('operations'),q=tx.objectStore('operations').getAll();q.onsuccess=()=>resolve(q.result[0]);q.onerror=()=>reject(q.error);};}));
        assert.equal(op.evidence.type,'scan');assert.equal(op.evidence.photos.length,1);assert.equal(op.evidence.overrides.model,'Reviewed model');assert.equal(op.params.area,'Desk');
        await page.locator('#linkedAssetNo').click();assert.equal(await page.locator('#modalWrap').isHidden(),true);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('new main and photo-only child queue offline, resolve a real parent ID after refresh, and never create a set',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Security');await context.setOffline(true);await page.locator('#v27Create').click();await page.locator('#linkedAssetYes').click();
        assert.equal(await page.locator('.linked-capture-choices>button').count(),2);assert.equal(backend.read('Assets').length,0);
        const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.locator('#linkedAssetPhoto').click()]);await chooser.setFiles(image('unlabelled-camera.png'));await page.locator('#assetForm').waitFor();
        assert.equal(await page.locator('#assetPhotoPicker .photo-picker-preview').count(),1);assert.match(await page.locator('#formMainSelected').textContent(),/Details pending/);assert.equal(await page.locator('#assetSite').inputValue(),'SITE-TEST');
        for(const name of ['brand','model','serial'])assert.equal(await page.locator(`#assetForm [name="${name}"]`).inputValue(),'');
        await page.locator('#assetForm [name="category"]').fill('Camera');await page.locator('#assetArea').fill('Entrance');await page.locator('#assetForm [type="submit"]').click();await page.locator('#modalWrap').waitFor({state:'hidden'});assert.equal(backend.read('Assets').length,0);
        await context.setOffline(false);await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.waitForFunction(()=>window.__mock.assets.length===2);const rows=backend.read('Assets');const child=rows.find(a=>a.category==='Camera'),root=rows.find(a=>a.category!=='Camera');assert.equal(child.parent_asset_id,root.asset_id);assert.equal(child.brand,'');assert.equal(child.model,'');assert.equal(child.area,'Entrance');assert.equal(root.area,'Security');assert.ok(rows.every(a=>!a.set_id&&!a.set_name));assert.equal(backend.read('AssetBatches').length,2);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('details integrate icon-labelled direct links and offer confirmation plus two capture choices',async()=>{
      const rack=stock('RACK',{category_name:'Rack',model:'Rack'}),main=stock('RECORDER',{parent_asset_id:'RACK',category_name:'Network video recorder',model:'Recorder'}),child=stock('CAMERA',{parent_asset_id:'RECORDER',category_name:'Camera',model:'Camera'});
      const {page,context,errors}=await start({links:true,queue:true,assets:[rack,main,child]},{width:1440,height:1100});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('[data-asset="RECORDER"]').click();await page.locator('#assetLinksDetail').waitFor();assert.equal(await page.locator('#assetLinksDetail [data-linked-member]').count(),2);assert.equal(await page.locator('#assetLinksDetail .detail-asset-glyph').count(),2);assert.equal(await page.locator('#addAnotherDrawer').count(),0);assert.equal(await page.locator('#drawerBody>.group-detail').count(),0);
        await fs.mkdir(path.resolve('test-results'),{recursive:true});await page.locator('#assetDrawer').screenshot({path:path.resolve('test-results/simple-linked-details-desktop.png')});
        await page.locator('#assetLinksDetail [data-linked-member="CAMERA"]').click();await page.waitForFunction(()=>document.getElementById('drawerId').textContent==='CAMERA');await page.locator('#assetLinksDetail [data-linked-member="RECORDER"]').waitFor();
        await page.locator('#addLinkedAsset').click();await page.locator('#linkedAssetYes').click();assert.equal(await page.locator('.linked-capture-choices>button').count(),2);await page.locator('#linkedAssetOcr').click();assert.match(await page.locator('#scannerMainContext').textContent(),/Camera/);await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('editing changes and removes a reference without duplicating assets or changing their placement',async()=>{
      const main=stock('ROOT',{model:'Main'}),child=stock('CHILD',{parent_asset_id:'ROOT',model:'Child',area:'Separate area',area_name:'Separate area',set_id:'LEGACY',set_name:'Old set'});
      const {page,context,backend,errors}=await start({links:true,queue:true,assets:[main,child]},{width:1440,height:1100});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('[data-asset="CHILD"]').click();await page.locator('#editAssetDrawer').click();await page.locator('#formMainRemove').click();await page.locator('#assetForm [type="submit"]').click();await page.locator('#modalWrap').waitFor({state:'hidden'});await page.waitForFunction(()=>!window.__mock.assets.find(a=>a.asset_id==='CHILD').parent_asset_id);const saved=backend.read('Assets').find(a=>a.asset_id==='CHILD');assert.equal(saved.area,'Separate area');assert.equal(saved.set_id,'LEGACY');assert.equal(saved.set_name,'Old set');assert.equal(backend.read('Assets').length,2);assert.equal(backend.read('Movements').length,0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('lost new-operation response reconciles after reload with one physical asset and stable payload',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,loseOperationReply:true});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.locator('#pendingSavesBtn').click();await page.locator('[data-retry-save]').waitFor();assert.equal(backend.read('Assets').length,1);
        await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.locator('#pendingSavesBtn').click();await page.locator('[data-retry-save]').click();await page.waitForFunction(()=>window.__mock.assets.length===1&&document.getElementById('linkedPendingItems').textContent.includes('No pending'));assert.equal(backend.read('Assets').length,1);assert.equal(backend.read('AssetBatches').length,1);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('a failed background photo keeps details saved, retries only remaining uploads, and sends no success popup',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true});
      try{
        await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');await page.evaluate(()=>window.__mock.failNextUpload=true);await page.locator('#v27Create').click();await page.locator('#linkedAssetNo').click();await page.locator('#saveFailureNotice').waitFor();assert.equal(backend.read('Assets').length,1);await page.locator('#pendingSavesBtn').click();assert.match(await page.locator('#linkedPendingItems').textContent(),/DetailsSaved/);await page.locator('[data-retry-save]').click();await page.waitForFunction(()=>document.getElementById('linkedPendingItems').textContent.includes('No pending'));assert.equal(await page.evaluate(()=>window.__mock.uploadAttempts),2);assert.equal(backend.read('Assets').length,1);assert.equal(await page.locator('#toast.show:not(.error)').count(),0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('browser persistence failure keeps the original validated result open and sends nothing',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,disableIDB:true});
      try{await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');await page.locator('#v27Create').click();await page.waitForFunction(()=>document.getElementById('toast').textContent.includes('not saved'));assert.equal(await page.locator('#v27Create').isVisible(),true);assert.equal(backend.read('Assets').length,0);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('Guest direct saves and photo recovery remain scoped to their new asset',async()=>{
      const {page,context,backend,errors}=await start({links:true,queue:true,role:'GUEST'});
      try{await scan(page);await page.locator('#scanEntrySite').selectOption('SITE-TEST');await page.locator('#scanEntryArea').fill('Desk');assert.equal(await page.locator('#scanMainField').count(),0);await page.locator('#v27Create').click();await page.waitForFunction(()=>window.__mock.assets.length===1);await page.waitForFunction(()=>window.__mock.uploadAttempts===1);assert.equal(backend.read('Assets').length,1);assert.equal(await page.locator('#linkedAssetYes').count(),0);assert.deepEqual(errors,[]);}finally{await context.close();}
    });
    await t.test('sequential set persists offline, continues without network, clears unique IDs and survives refresh',async()=>{
      const {page,context,backend,errors}=await start({queue:true});
      try{
        await page.locator('[data-mobile-route="assets"]').click();
        assert.equal(await page.locator('#assetGroupToggle').isChecked(),false);
        await context.setOffline(true);
        await page.locator('#addAssetBtn').click();
        for(const [key,value] of Object.entries({category:'Monitor',brand:'Sample',model:'M-10',serial:'ROOT-1',area:'Test Area'}))await page.locator(`#assetForm [name="${key}"]`).fill(value);
        await page.locator('#assetSite').selectOption('SITE-TEST');
        await page.locator('#startsAssetSet').check();await page.locator('#linkedSetName').fill('Sequential desk');
        await page.locator('#assetForm [type="submit"]').click();await page.locator('#scanNextComponent').waitFor();
        assert.equal(backend.read('Assets').length,0);assert.match(await page.locator('#pendingSaveItems').textContent(),/Saving details/);
        await page.locator('#sameModelComponent').click();assert.equal(await page.locator('#assetForm [name="serial"]').inputValue(),'');assert.equal(await page.locator('#assetForm [name="model"]').inputValue(),'M-10');assert.equal(await page.locator('#assetSite').inputValue(),'SITE-TEST');
        await page.locator('#assetForm [name="serial"]').fill('CHILD-1');await page.locator('#assetForm [type="submit"]').click();await page.locator('#finishAssetSet').waitFor();
        assert.equal(backend.read('Assets').length,0);assert.match(await page.locator('#pendingSaveItems').textContent(),/Waiting for the main asset/);
        await page.locator('#finishAssetSet').click();await context.setOffline(false);await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});
        await page.waitForFunction(()=>window.__mock.assets.length===2);
        const rows=backend.read('Assets');assert.equal(rows.length,2);assert.equal(rows[0].set_id,rows[1].set_id);assert.ok(rows[0].set_id);assert.equal(rows[1].parent_asset_id,rows[0].asset_id);
        await page.locator('[data-mobile-route="assets"]').click();assert.equal(await page.locator('.asset-group').count(),0);assert.equal(await page.locator('#assetList [data-asset]').count(),2);
        assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('queued photos show pending, retry separately and keep the normal camera/gallery form',async()=>{
      const {page,context,backend,errors}=await start({queue:true});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetBtn').click();
        assert.equal(await page.locator('#assetPhotoPicker [data-photo-camera]').count(),1);assert.equal(await page.locator('#assetPhotoPicker [data-photo-gallery]').count(),1);
        for(const [key,value] of Object.entries({category:'Monitor',brand:'Sample',model:'M-10',serial:'PHOTO-1',area:'Test Area'}))await page.locator(`#assetForm [name="${key}"]`).fill(value);
        await page.locator('#assetSite').selectOption('SITE-TEST');
        await page.locator('#assetPhotoPicker input[type="file"]').last().setInputFiles(image('evidence.png'));
        await page.evaluate(()=>window.__mock.failNextUpload=true);
        await page.locator('#assetForm [type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#modalTitle').textContent.includes('QR Label'));await page.locator('#modalCloseBtn').click();await page.locator('#pendingSavesBtn').click();await page.locator('[data-retry-save]').waitFor();assert.equal(backend.read('Assets').length,1);assert.match(await page.locator('#pendingSaveItems').textContent(),/Retry/);
        await page.locator('[data-retry-save]').click();await page.waitForFunction(()=>document.querySelector('#pendingSaveItems').textContent.includes('Saved'));
        assert.equal(backend.read('Assets').length,1);assert.equal(await page.evaluate(()=>window.__mock.uploadAttempts),2);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('linked asset search attaches to the confirmed asset and keeps both physical register rows',async()=>{
      const anchor=stock('JCP-PC-0001',{model:'Office PC',serial:'PC-UNIQUE'});
      const {page,context,backend,errors}=await start({queue:true,assets:[anchor,stock('UNCHANGED',{model:'Other model'})]},{width:1440,height:1000});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('#assetSearch').fill('Sample');await page.evaluate(()=>window.__unchangedRow=document.querySelector('#assetList [data-asset="UNCHANGED"]'));await page.locator('#addAssetBtn').click();
        for(const [key,value] of Object.entries({category:'Monitor',brand:'Sample',model:'Screen',serial:'MON-1',area:'Test Area'}))await page.locator(`#assetForm [name="${key}"]`).fill(value);
        await page.locator('#assetSite').selectOption('SITE-TEST');await page.locator('#linkedAssetSearch').fill('PC-UNIQUE');await page.locator('#linkedAssetChoice').selectOption(anchor.asset_id);
        assert.match(await page.locator('#linkedAssetSummary').textContent(),/Office PC/);
        await page.locator('#assetForm [type="submit"]').click();await page.locator('#finishAssetSet').waitFor();await page.waitForFunction(()=>window.__mock.assets.length===3);
        assert.match(await page.locator('#pendingSaveItems').textContent(),/JCP-PC-0001/);
        const rows=backend.read('Assets'),child=rows.find(a=>a.serial==='MON-1');assert.equal(child.parent_asset_id,anchor.asset_id);assert.equal(rows[0].serial,'PC-UNIQUE');assert.equal(await page.evaluate(()=>window.__unchangedRow===document.querySelector('#assetList [data-asset="UNCHANGED"]')),true);assert.equal(await page.locator('#assetSearch').inputValue(),'Sample');
        await page.locator('#finishAssetSet').click();await page.locator(`[data-asset="${child.asset_id}"]`).click();await page.locator('[data-linked-member]').first().waitFor();assert.equal(await page.locator('[data-linked-member]').count(),2);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('unavailable durable storage keeps the set form and photos open without sending a write',async()=>{
      const {page,context,backend}=await start({queue:true,disableIDB:true});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetGroupBtn').click();
        for(const [key,value] of Object.entries({category:'Monitor',brand:'Sample',model:'M',serial:'A',area:'Test Area'}))await page.locator(`#assetForm [name="${key}"]`).fill(value);
        await page.locator('#assetSite').selectOption('SITE-TEST');await page.locator('#linkedSetName').fill('Desk');await page.locator('#assetForm [type="submit"]').click();
        await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Draft was not saved'));
        assert.equal(await page.locator('#assetForm [name="serial"]').inputValue(),'A');assert.equal(backend.read('Assets').length,0);
      }finally{await context.close();}
    });
    await t.test('detail camera/gallery photos persist offline and upload after reopening',async()=>{
      const {page,context,errors}=await start({queue:true,assets:[stock('A')]});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('[data-asset="A"]').click();await page.locator('.asset-detail-fold > summary').filter({hasText:'Images'}).click();await page.locator('#addAssetGallery').waitFor();
        await page.locator('#addAssetGallery').click();await page.locator('#detailPhotoPicker input[type="file"]').last().setInputFiles(image('detail.png'));await context.setOffline(true);await page.locator('#uploadImageSubmit').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert.equal(await page.evaluate(()=>window.__mock.uploadAttempts),0);await context.setOffline(false);await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.waitForFunction(()=>window.__mock.uploadAttempts===1);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('session expiry closes private details and pauses the scoped queue',async()=>{
      const {page,context}=await start({queue:true,assets:[stock('A',{private_details:{mobile_number:'private-fixture'}})]});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('[data-asset="A"]').click();await page.locator('.staff-private-section').waitFor({state:'attached'});
        await page.evaluate(()=>{const get=AssetAPI.get;AssetAPI.get=async(action,params)=>action==='sync'?{sync:{user:{username:'guest',role:'GUEST'},authenticated:false,assets:[],server_time:new Date().toISOString()}}:get(action,params);});
        await page.evaluate(()=>window.dispatchEvent(new Event('online')));await page.waitForFunction(()=>document.querySelector('#profileRole').textContent==='Read + Add');
        assert.equal(await page.locator('#assetDrawer').evaluate(el=>el.classList.contains('open')),false);assert.equal(await page.locator('#pendingSavesBtn').isVisible(),false);
      }finally{await context.close();}
    });
    await t.test('grouped register renders each physical unit once and searches inside collapsed sets',async()=>{
      const assets=[stock('JCP-AS-0001',{serial:'MON-001'}),stock('JCP-AS-0002',{serial:'MON-002'}),stock('JCP-AS-0003'),stock('JCP-PC-0001',{category:'Desktop PC',model:'PC-1',set_id:'SET-EXAMPLE00000001',set_name:'Marketing station'}),stock('JCP-KB-0001',{category:'Keyboard',brand:'',model:'',set_id:'SET-EXAMPLE00000001',set_name:'Marketing station'})];
      const {page,context,errors}=await start({assets});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('.asset-group').first().waitFor();
        assert.equal(await page.locator('.asset-group').count(),2);assert.equal(await page.locator('.group-unit').count(),0);
        assert.match(await page.locator('#assetScopeCount').textContent(),/5 matching physical items · 2 display rows/);
        await page.locator('#assetSearch').fill('MON-002');await page.locator('.group-unit').waitFor();
        assert.equal(await page.locator('.group-unit').count(),1);assert.match(await page.locator('.asset-group summary').textContent(),/1 of 3 loaded/);
        await page.locator('.group-unit [data-asset]').click();await page.locator('#drawerId').filter({hasText:'JCP-AS-0002'}).waitFor();await page.locator('#closeDrawerBtn').click();
        await page.locator('#assetSearch').fill('');await page.locator('#assetGroupToggle').uncheck();
        assert.equal(await page.locator('.asset-group').count(),0);assert.equal(await page.locator('#assetList [data-asset]').count(),5);
        await page.locator('#assetGridViewBtn').click();await page.waitForFunction(()=>document.querySelectorAll('#assetList .asset-grid-card').length===5);
        await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('same-model batch reviews blank/different serials and sends shared part codes to specifications',async()=>{
      const {page,context,errors,backend}=await start();
      try{
        await startSameBatch(page,3);await page.locator('[data-unit="0"][data-unit-field="serial"]').fill('001O0I1234');await page.locator('[data-unit="2"][data-unit-field="serial"]').fill('002O0I1234');
        await page.locator('#batchEntryForm [type="submit"]').click();
        assert.equal(backend.read('Assets').length,0);assert(await page.locator('#batchSave').isDisabled());assert.match(await page.locator('.group-review').textContent(),/1 new units have no recorded serial/);
        await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        const rows=backend.read('Assets');assert.equal(rows.length,3);assert.deepEqual(rows.map(r=>r.serial),['001O0I1234','','002O0I1234']);assert(rows.every(r=>r.specifications==='Part Number: SHARED-10'));
        assert.equal(await page.locator('.asset-group').count(),1);assert.match(await page.locator('#assetScopeCount').textContent(),/3 matching physical items · 1 display row/);
        await page.locator('[data-group-add]').click();assert.equal(await page.locator('[data-batch-common="brand"]').inputValue(),'Sample');assert.equal(await page.locator('[data-unit-field="serial"]').inputValue(),'');
        assert.equal(await page.locator('[data-batch-common="site_id"]').inputValue(),'');assert.equal(await page.locator('[data-batch-common="area"]').inputValue(),'');
        await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('PC set can reuse an existing PC, then rename and remove components without extra records',async()=>{
      const initial=stock('JCP-PC-0001',{category:'Desktop PC',model:'PC-1',serial:'PC-0001',area:'Original area',area_name:'Original area',assigned_to:'Original owner'});
      const {page,context,errors,backend}=await start({assets:[initial]});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetGroupBtn').click();await page.locator('[data-batch-mode="set"]').click();
        await page.locator('#batchSetName').fill('Marketing PC 01');await page.locator('[data-batch-common="site_id"]').selectOption('SITE-TEST');await page.locator('[data-batch-common="area"]').fill('New bench');
        await page.locator('#batchPcPreset').click();assert.equal(await page.locator('.batch-unit').count(),4);
        await page.locator('[data-unit-source="0"]').selectOption('existing');await page.locator('[data-unit="0"][data-unit-field="existing_asset_id"]').fill(initial.asset_id);await page.locator('[data-unit="0"][data-unit-field="existing_asset_id"]').press('Tab');
        await page.locator('[data-unit="1"][data-unit-field="serial"]').fill('MON-0001');await checkNoOverflow(page);
        await fs.mkdir(path.resolve('test-results'),{recursive:true});await page.screenshot({path:path.resolve('test-results/mobile-set-entry.png'),fullPage:true});
        await page.locator('#batchEntryForm [type="submit"]').click();assert.match(await page.locator('.group-review').textContent(),/3 new records · 1 existing items/);
        await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        let rows=backend.read('Assets');assert.equal(rows.length,4);assert.equal(new Set(rows.map(r=>r.set_id)).size,1);assert.equal(rows[0].area,'Original area');assert.equal(rows[0].assigned_to,'Original owner');assert.equal(rows[0].serial,'PC-0001');
        assert.equal(await page.locator('.asset-group').count(),1);assert.equal(await page.locator('.group-unit').count(),4);await checkNoOverflow(page);
        await page.locator('#toast .toast-close').click();
        await page.screenshot({path:path.resolve('test-results/mobile-equipment-set.png'),fullPage:true,style:'#toast,#mobileNav{visibility:hidden!important}'});
        await page.locator('[data-group-rename]').click();await page.locator('#batchSetName').fill('Marketing PC renamed');await page.locator('#batchEntryForm [type="submit"]').click();await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert(backend.read('Assets').every(a=>a.set_name==='Marketing PC renamed'));
        await page.locator(`summary[aria-label="Actions for ${initial.asset_id}"]`).click();await page.locator(`[data-unlink-asset="${initial.asset_id}"]`).click();await page.locator('#batchEntryForm [type="submit"]').click();await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        rows=backend.read('Assets');assert.equal(rows.length,4);assert.equal(rows[0].set_id,'');assert.equal(rows.filter(a=>a.set_id).length,3);assert.equal(backend.read('Movements').length,0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('lost batch reply survives reload and resumes the same real backend request',async()=>{
      const {page,context,errors,backend}=await start({loseBatchReply:true});
      try{
        await startSameBatch(page);await page.locator('#batchEntryForm [type="submit"]').click();await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();
        await page.waitForFunction(()=>document.querySelector('#batchSaveStatus').textContent.includes('Save not confirmed'));
        assert.equal(backend.read('Assets').length,2);assert(await page.locator('#batchReviewBack').isDisabled());
        const request=await page.evaluate(()=>JSON.parse(localStorage.getItem('jcp_assethub_pending_group_v1:test-staff')).request_id);
        await page.reload();await page.locator('#appLoading').waitFor({state:'hidden'});await page.waitForFunction(()=>document.querySelector('#profileRole').textContent==='STAFF');await page.locator('[data-mobile-route="assets"]').click();await page.locator('#addAssetGroupBtn').click();await page.locator('#batchResume').click();
        assert.equal(await page.locator('[data-batch-mode]').count(),0);await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert.equal(backend.read('Assets').length,2);assert.equal(backend.read('AssetBatches').length,1);assert.equal(backend.read('AssetBatches')[0].request_id,request);
        assert.equal(await page.evaluate(()=>localStorage.getItem('jcp_assethub_pending_group_v1:test-staff')),null);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('repeated serials are blocked before saving; server rejection leaves drafts editable',async()=>{
      const {page,context,errors,backend}=await start();
      try{
        await startSameBatch(page);for(const i of [0,1])await page.locator(`[data-unit="${i}"][data-unit-field="serial"]`).fill('SAME-SERIAL');
        await page.locator('#batchEntryForm [type="submit"]').click();assert.match(await page.locator('#batchEntryError').textContent(),/same serial/);assert.equal(backend.read('Assets').length,0);
        await page.locator('[data-unit="1"][data-unit-field="serial"]').fill('OTHER-SERIAL');await page.locator('#batchEntryForm [type="submit"]').click();
        backend.seed('Assets',[stock('JCP-AS-9999',{serial:'OTHER-SERIAL'})]);
        await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.waitForFunction(()=>document.querySelector('#batchSaveStatus').textContent.includes('Nothing was written'));
        assert.equal(backend.read('Assets').length,1);assert.equal(backend.read('AssetBatches').length,0);assert.equal(await page.evaluate(()=>localStorage.getItem('jcp_assethub_pending_group_v1:test-staff')),null);
        await page.locator('#batchReviewBack').click();assert.equal(await page.locator('[data-unit="0"][data-unit-field="serial"]').inputValue(),'SAME-SERIAL');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('old backends keep grouping views but disable new writes; guests must sign in',async()=>{
      const old=await start({grouping:false,assets:[stock('A'),stock('B')]});
      try{
        await old.page.locator('[data-mobile-route="assets"]').click();assert.equal(await old.page.locator('.asset-group').count(),1);await old.page.locator('#addAssetGroupBtn').click();
        assert(await old.page.locator('[data-batch-mode="same"]').isDisabled());assert.match(await old.page.locator('.group-intro').textContent(),/updated Apps Script/);assert.equal(old.backend.writes.length,0);
      }finally{await old.context.close();}
      const guest=await start({role:'GUEST'});
      try{await guest.page.locator('[data-mobile-route="assets"]').click();await guest.page.locator('#addAssetGroupBtn').click();await guest.page.locator('#loginForm').waitFor();assert.equal(guest.backend.writes.length,0);}
      finally{await guest.context.close();}
    });
    await t.test('large groups render units lazily, preserve counts and avoid detail/photo requests',async()=>{
      const assets=Array.from({length:1000},(_,i)=>stock('JCP-AS-'+String(i+1).padStart(4,'0'),{serial:i?'':'REPEATED'}));assets[1].serial='REPEATED';
      const {page,context,errors}=await start({assets});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('.asset-group').waitFor();assert.equal(await page.locator('.group-unit').count(),0);
        assert.match(await page.locator('#assetScopeCount').textContent(),/1000 matching physical items · 1 display row/);
        await page.locator('.asset-group summary').click();await page.locator('.group-unit').first().waitFor();assert.equal(await page.locator('.group-unit').count(),25);assert.match(await page.locator('.asset-group summary').textContent(),/Repeated serials/);
        await page.getByRole('button',{name:'Show more units',exact:true}).click();assert.equal(await page.locator('.group-unit').count(),50);
        await page.locator('#assetSearch').fill('REPEATED');assert.equal(await page.locator('.group-duplicate').count(),2);
        assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>['getAsset','getImageData'].includes(c.action)).length),0);await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('scans with a different serial describe related model units without a duplicate-create prompt',async()=>{
      const {page,context,errors}=await start({matches:[{asset:stock('JCP-AS-0001',{brand:'Ricoh',model:'TEST-100',serial:'DIFFERENT'}),reasons:['same brand','same model'],score:80}]});
      try{await scan(page);assert.match(await page.locator('#scanResult').textContent(),/different serials/);assert.equal(await page.locator('#v27Create').textContent(),'Review & Create Asset');await page.locator('#v27Create').click();await page.locator('#assetForm').waitFor();assert.deepEqual(errors,[]);}
      finally{await context.close();}
    });
    await t.test('desktop grouped view and cloning retain shared specs without copying per-unit identifiers',async()=>{
      const assets=[stock('A',{serial:'001',specifications:'RAM: 8 GB\nMAC: AA:BB:CC:DD:EE:FF\nHostname: Station-A'}),stock('B',{serial:'002',specifications:'RAM: 8 GB\nMAC: AA:BB:CC:DD:EE:00\nHostname: Station-B'})];
      const {page,context,errors}=await start({assets},{width:1440,height:1000});
      try{
        await page.locator('.nav-btn[data-route="assets"]').click();await page.locator('.asset-group summary').click();await page.locator('.group-unit').first().waitFor();assert.equal(await page.locator('.group-unit').count(),2);
        await checkNoOverflow(page);await page.screenshot({path:path.resolve('test-results/desktop-grouped-assets.png'),fullPage:true});await page.locator('[data-group-add]').click();
        assert.equal(await page.locator('[data-batch-common="specifications"]').inputValue(),'RAM: 8 GB');assert.equal(await page.locator('[data-unit-field="serial"]').inputValue(),'');await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('offline review does not queue or submit a batch and can save once after reconnecting',async()=>{
      const {page,context,errors,backend}=await start();
      try{
        await startSameBatch(page);await page.locator('#batchEntryForm [type="submit"]').click();await page.locator('#batchConfirm').check();await context.setOffline(true);await page.locator('#batchSave').click();
        assert.match(await page.locator('#batchSaveStatus').textContent(),/internet connection/);assert.equal(backend.read('Assets').length,0);assert.equal(backend.read('AssetBatches').length,0);
        assert.equal(await page.evaluate(()=>localStorage.getItem('jcp_assethub_pending_group_v1:test-staff')),null);
        await context.setOffline(false);await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});assert.equal(backend.read('Assets').length,2);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('cold startup overlaps reads and reuses its asset snapshot when opening the register',async()=>{
      for(const first of ['bootstrap','sync']){
        const {page,context,errors}=await start({delayStartup:true,assets:[stock('STARTUP-A'),stock('STARTUP-B')]});
        try{
          await page.waitForFunction(()=>window.__mock.bootstrapRelease&&window.__mock.syncRelease);
          assert.deepEqual(await page.evaluate(()=>window.__mock.calls.map(c=>c.action).sort()),['bootstrap','sync']);
          await page.evaluate(first=>window.__mock[first+'Release'](),first);
          if(first==='bootstrap')await page.locator('#appLoading').waitFor({state:'hidden'});
          else await page.evaluate(()=>window.__mock.bootstrapRelease());
          await page.locator('[data-mobile-route="assets"]').click();
          assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='listAssets').length),0);
          if(first==='bootstrap')await page.evaluate(()=>window.__mock.syncRelease());
          await page.waitForFunction(()=>document.querySelector('#assetScopeCount').textContent.includes('2 matching physical items'));
          assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='listAssets').length),0);assert.deepEqual(errors,[]);
        }finally{await context.close();}
      }
    });
    await t.test('failed initial sync falls back to ordinary asset loading',async()=>{
      const {page,context,errors}=await start({failStartupSync:true,assets:[stock('FALLBACK-A'),stock('FALLBACK-B')]});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.waitForFunction(()=>document.querySelector('#assetScopeCount').textContent.includes('2 matching physical items'));
        assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='listAssets').length),1);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('serial list import and keyboard navigation preserve identifiers and require review',async()=>{
      const {page,context,errors,backend}=await start();
      try{
        await startSameBatch(page);await page.locator('.batch-paste summary').click();
        await page.locator('#batchSerialList').fill('001O0I1234\n\n00012345678901234567890\n');await page.locator('#batchApplySerials').click();
        assert.equal(await page.locator('#batchQuantity').inputValue(),'3');
        const first=page.locator('[data-unit="0"][data-unit-field="serial"]'),second=page.locator('[data-unit="1"][data-unit-field="serial"]'),third=page.locator('[data-unit="2"][data-unit-field="serial"]');
        assert.equal(await first.inputValue(),'001O0I1234');assert.equal(await second.inputValue(),'');assert.equal(await third.inputValue(),'00012345678901234567890');
        assert(await first.evaluate(el=>document.activeElement===el));await checkNoOverflow(page);
        await page.screenshot({path:path.resolve('test-results/mobile-fast-entry.png'),fullPage:true});
        await first.press('Enter');assert(await second.evaluate(el=>document.activeElement===el));await third.press('Enter');
        assert.equal(await page.locator('.group-review').count(),0);assert.equal(backend.read('Assets').length,0);
        await page.locator('.batch-paste summary').click();await page.locator('#batchSerialList').fill('CHANGED');
        page.once('dialog',dialog=>dialog.dismiss());await page.locator('#batchApplySerials').click();assert.equal(await first.inputValue(),'001O0I1234');
        await page.locator('#batchSerialList').fill(Array(26).fill('TOO-MANY').join('\n'));await page.locator('#batchApplySerials').click();assert.match(await page.locator('#batchSerialListError').textContent(),/25 lines/);
        await page.locator('#batchEntryForm [type="submit"]').click();assert(await page.locator('#batchSave').isDisabled());await page.locator('#batchConfirm').check();await page.locator('#batchSave').click();await page.locator('#modalWrap').waitFor({state:'hidden'});
        assert.deepEqual(backend.read('Assets').map(a=>a.serial),['001O0I1234','','00012345678901234567890']);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('component suggestions use each component brand and never auto-fill another model',async()=>{
      const assets=[stock('HP-1',{brand:'HP',model:'EXACT-HP-10'}),stock('RICOH-1',{brand:'Ricoh',model:'EXACT-RICOH-20'})];
      const {page,context,errors}=await start({assets});
      try{
        await startSameBatch(page);const shared=page.locator('.group-common');await shared.locator('[data-batch-common="brand"]').fill('rico');
        await shared.getByRole('button',{name:'Ricoh',exact:true}).click();assert.equal(await shared.locator('[data-batch-common="brand"]').inputValue(),'Ricoh');
        await page.locator('#batchCancel').click();await page.locator('#addAssetGroupBtn').click();await page.locator('[data-batch-mode="set"]').click();await page.locator('#batchPcPreset').click();
        const pc=page.locator('[data-unit-card="0"]'),monitor=page.locator('[data-unit-card="1"]');
        await pc.locator('[data-unit-field="brand"]').fill('HP');await monitor.locator('[data-unit-field="brand"]').fill('Ricoh');
        await pc.locator('[data-unit-field="model"]').fill('EXACT');await monitor.locator('[data-unit-field="model"]').fill('EXACT');
        assert.equal(await pc.getByRole('button',{name:'EXACT-RICOH-20',exact:true}).count(),0);assert.equal(await monitor.getByRole('button',{name:'EXACT-HP-10',exact:true}).count(),0);
        await monitor.getByRole('button',{name:'EXACT-RICOH-20',exact:true}).click();assert.equal(await pc.locator('[data-unit-field="model"]').inputValue(),'EXACT');
        assert.equal(await monitor.locator('[data-unit-field="model"]').inputValue(),'EXACT-RICOH-20');await checkNoOverflow(page);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('broad search stays compact, exact results open, and synced edits invalidate cached search/sort',async()=>{
      const assets=Array.from({length:100},(_,i)=>stock('JCP-AS-'+i,{model:'M-'+Math.floor(i/2),serial:'SN-'+i}));
      const {page,context,errors}=await start({assets});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#assetSearch').fill('Sample');assert.equal(await page.locator('.group-unit').count(),0);
        await page.locator('#assetSearch').fill('SN-99');assert.equal(await page.locator('.group-unit').count(),1);
        await page.locator('#assetSearch').fill('Sample');assert.equal(await page.locator('.group-unit').count(),0);
        await page.locator('#assetGroupToggle').uncheck();await page.locator('#assetMobileSort').selectOption('device:asc');
        await page.evaluate(()=>{window.__mock.assets[99].brand='AAA Changed';window.__mock.assets.push({...window.__mock.assets[0],asset_id:'NEW-SYNC',brand:'ZZZ Added',serial:'UNIQUE-NEW'});window.dispatchEvent(new Event('online'));});
        await page.locator('#assetSearch').fill('AAA Changed');await page.waitForFunction(()=>document.querySelector('#assetList [data-asset]')?.dataset.asset==='JCP-AS-99');
        await page.locator('#assetSearch').fill('');assert.equal(await page.locator('#assetList [data-asset]').first().getAttribute('data-asset'),'JCP-AS-99');
        await page.locator('#assetSearch').fill('UNIQUE-NEW');assert.equal(await page.locator('#assetList [data-asset]').getAttribute('data-asset'),'NEW-SYNC');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('1000-asset search and layout stay within 150 ms p95 at 4x CPU slowdown',async()=>{
      const assets=Array.from({length:1000},(_,i)=>stock('JCP-AS-'+i,{model:'M-'+Math.floor(i/4),serial:'SN-'+i}));
      const {page,context,errors}=await start({assets});
      try{
        await page.locator('[data-mobile-route="assets"]').click();await page.locator('#assetMobileSort').selectOption('device:asc');
        const cdp=await context.newCDPSession(page);await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
        const result=await page.evaluate(()=>{
          const input=document.querySelector('#assetSearch'),times=[],calls=window.__mock.calls.length;
          for(let i=0;i<45;i++){
            input.value=['Sample','M-1','SN-99','Test',''][i%5];const started=performance.now();input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#assetList').getBoundingClientRect();if(i>=5)times.push(performance.now()-started);
          }
          times.sort((a,b)=>a-b);return {p50:times[20],p95:times[38],max:times[39],calls:window.__mock.calls.length-calls};
        });
        console.log('1000-asset search and layout milliseconds at 4x CPU slowdown:',JSON.stringify(result));
        assert(result.p95<150,'Search exceeded the 150 ms p95 budget');assert.equal(result.calls,0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('connection results appear independently and configured providers are never reported verified',async()=>{
      const {page,context,errors}=await start({diagDelayed:true,diagDriveFail:true});
      try{
        await page.locator('#systemStatusBtn').click();
        await page.locator('[data-connection="api"][data-state="ok"]').waitFor();await page.locator('[data-connection="storage"][data-state="ok"]').waitFor();
        assert.deepEqual(await page.evaluate(()=>{const p=window.__mock.calls.find(c=>c.action==='diagnostics'&&c.params.component==='api').params;return [p.frontend_version,p.frontend_release];}),['2.9.0','2.9.0']);
        assert.match(await page.locator('[data-connection="version"][data-state="ok"]').textContent(),/Frontend 2\.9\.0 requires backend API 2\.9\.0/);
        await page.waitForFunction(()=>window.__mock.diagReleases.sheets&&window.__mock.diagReleases.drive);
        assert.equal(await page.locator('[data-connection="drive"]').getAttribute('data-state'),'checking');
        await page.evaluate(()=>window.__mock.diagReleases.sheets());await page.locator('[data-connection="sheets"][data-state="ok"]').waitFor();
        assert.equal(await page.locator('[data-connection="drive"]').getAttribute('data-state'),'checking');
        assert.equal(await page.locator('[data-connection="ai"]').getAttribute('data-state'),'not_tested');assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='testScanConnection').length),0);
        await page.evaluate(()=>window.__mock.diagReleases.drive());await page.locator('[data-connection="drive"][data-state="error"]').waitFor();
        await page.locator('[data-connection="barcode"][data-state="ok"]').waitFor();assert.match(await page.locator('[data-connection="barcode"]').textContent(),/ZXing WASM/);
        await checkNoOverflow(page);await page.screenshot({path:path.resolve('test-results/mobile-connection-checks.png'),fullPage:true});assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('frontend patch compatibility still reports a genuinely different backend API',async()=>{
      const {page,context,errors}=await start({backendVersion:'2.7.2'});
      try{
        await page.locator('#systemStatusBtn').click();await page.locator('[data-connection="version"][data-state="error"]').waitFor();
        assert.match(await page.locator('[data-connection="version"]').textContent(),/backend 2\.7\.2/);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('explicit OCR/AI tests update separately and a successful sync cannot hide AI quota failure',async()=>{
      const {page,context,errors,backend}=await start({diagAiFail:true,diagProviderDelayed:true});
      try{
        await page.locator('#systemStatusBtn').click();await page.waitForFunction(()=>!document.querySelector('#diagProviderBtn').disabled);await page.locator('#diagProviderBtn').click();
        await page.locator('[data-connection="ai"][data-state="error"]').waitFor();assert.match(await page.locator('[data-connection="ai"]').textContent(),/quota/);
        assert.equal(await page.locator('[data-connection="ocr"]').getAttribute('data-state'),'checking');await page.evaluate(()=>window.__mock.providerReleases.ocr());await page.locator('[data-connection="ocr"][data-state="ok"]').waitFor();
        await page.locator('#diagSyncBtn').click();await page.waitForFunction(()=>document.querySelector('#systemStatusText').textContent==='Issues');assert.equal(await page.locator('[data-connection="ai"]').getAttribute('data-state'),'error');
        assert.equal(backend.read('Assets').length,0);assert.equal(backend.writes.length,0);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('Guest and legacy backends cannot run provider tests or report policy/configuration as a verified connection',async()=>{
      for(const options of [{role:'GUEST'},{diagLegacy:true},{diagAuthFail:true}]){
        const {page,context,errors}=await start(options,{width:1440,height:1000});
        try{
          await page.locator('#systemStatusBtn').click();await page.waitForFunction(()=>!document.querySelector('#diagRunBtn').disabled);
          assert(await page.locator('#diagProviderBtn').isDisabled());assert.equal(await page.locator('[data-connection="auth"]').getAttribute('data-state'),options.diagAuthFail?'error':'info');
          assert.equal(await page.locator('[data-connection="ai"]').getAttribute('data-state'),'not_tested');assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='testScanConnection').length),0);
          await checkNoOverflow(page);assert.deepEqual(errors,[]);
        }finally{await context.close();}
      }
    });
    await t.test('blocked storage, empty QR render and offline/failed sync do not show false success',async()=>{
      const {page,context,errors}=await start({failStartupSync:true});
      try{
        await page.evaluate(()=>{IDBObjectStore.prototype.put=()=>{throw new DOMException('Storage full','QuotaExceededError');};window.QRCode=class{constructor(){}};});
        await page.locator('#systemStatusBtn').click();await page.locator('[data-connection="storage"][data-state="error"]').waitFor();await page.locator('[data-connection="qr"][data-state="warning"]').waitFor();
        await page.locator('#diagSyncBtn').click();await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Sync did not complete'));assert(!await page.locator('#toast').textContent().then(t=>t.includes('Sync finished')));
        await context.setOffline(true);await page.waitForFunction(()=>document.querySelector('#systemStatusText').textContent==='Offline');assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('storage fallback is tested and described accurately instead of claiming IndexedDB',async()=>{
      const {page,context,errors}=await start({disableIDB:true});
      try{
        await page.locator('#systemStatusBtn').click();await page.locator('[data-connection="storage"][data-state="ok"]').waitFor();assert.match(await page.locator('[data-connection="storage"]').textContent(),/localStorage fallback/);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('late diagnostics cannot repaint a closed/replaced modal',async()=>{
      const {page,context,errors}=await start({diagDelayed:true,role:'GUEST'});
      try{
        await page.locator('#systemStatusBtn').click();await page.waitForFunction(()=>window.__mock.diagReleases.drive);await page.locator('#modalCloseBtn').click();
        await page.locator('#profileBtn').click();await page.locator('#signInBtn').click();assert.match(await page.locator('#modalTitle').textContent(),/Sign in/);
        await page.evaluate(()=>{window.__mock.diagReleases.sheets();window.__mock.diagReleases.drive();});assert.equal(await page.locator('#diagnosticBody').count(),0);assert(await page.locator('#loginForm').isVisible());assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
    await t.test('cached AI configuration refreshes before scanning and real failures remain visible with OCR fallback',async()=>{
      const {page,context,errors}=await start({ai:true,aiError:'AI_OUTPUT_LIMIT: Response incomplete',matchFail:true});
      try{
        await page.evaluate(()=>{const boot=JSON.parse(localStorage.getItem('jcp_assethub_cache_boot_v1'));boot.data.ai_ocr_enabled=false;localStorage.setItem('jcp_assethub_cache_boot_v1',JSON.stringify(boot));});
        await page.reload();await page.waitForFunction(()=>window.__mock?.calls.some(c=>c.action==='sync')&&document.querySelector('#profileRole').textContent==='STAFF');await scan(page);
        assert.equal(await page.evaluate(()=>window.__mock.calls.filter(c=>c.action==='interpretOcrUniversal').length),1);assert(await page.locator('[data-scan-step="ai"]').evaluate(el=>el.classList.contains('failed')));
        assert(await page.locator('[data-scan-step="matched"]').evaluate(el=>el.classList.contains('failed')));assert.equal(await page.locator('[data-universal-field="brand"]').inputValue(),'Ricoh');assert.match(await page.locator('#scanResult').textContent(),/output limit/);
        await page.locator('#scannerConnectionBtn').click();await page.waitForFunction(()=>!document.querySelector('#diagRunBtn').disabled);assert.equal(await page.locator('[data-connection="ai"]').getAttribute('data-state'),'error');assert.match(await page.locator('[data-connection="ai"]').textContent(),/output limit/);assert.deepEqual(errors,[]);
      }finally{await context.close();}
    });
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
          const keys=await caches.keys(),name=keys.find(k=>k.startsWith('jcp-assethub-v2.7-'));const cache=await caches.open(name);return !!(await cache.match('./vendor/zxing-wasm/zxing_reader.wasm'));
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
