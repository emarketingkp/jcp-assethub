const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const http=require('node:http');
const root=path.resolve(__dirname,'..');
const {chromium}=require(path.join(root,'node_modules/playwright'));
const server=http.createServer(async(req,res)=>{
  if(req.url==='/test.html'){res.setHeader('Content-Type','text/html');return res.end('<!doctype html><title>Local regression</title>');}
  const file=path.resolve(root,'public','.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(path.resolve(root,'public')+path.sep)){res.writeHead(403);return res.end();}
  try{const body=await fs.readFile(file);res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(body);}catch{res.writeHead(404);res.end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  let browser;
  try{
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const base='http://127.0.0.1:'+server.address().port;
    await page.goto(base+'/test.html');
    // Use a minimal document so every tested request stays local.
    await page.setContent('<div id="toast"></div><form id="assetForm"><input name="category" value="Monitor"><input name="serial" value="0001"><button type="button" id="formPendingSaves"></button></form>');
    for(const file of ['local-storage.js','asset-drafts.js','save-queue.js','autosuggest.js','asset-editor.js','asset-groups.js','asset-workflows.js'])await page.addScriptTag({url:base+'/'+file});
    const result=await page.evaluate(async()=>{
      const original=IDBObjectStore.prototype.put;
      const hasBlob=x=>x instanceof Blob||Array.isArray(x)&&x.some(hasBlob)||x&&Object.getPrototypeOf(x)===Object.prototype&&Object.values(x).some(hasBlob);
      IDBObjectStore.prototype.put=function(value,...args){if(hasBlob(value))throw new DOMException('Failed to write blobs (InvalidBlob)','UnknownError');return original.call(this,value,...args);};
      const store=AssetDrafts.create('test'),file=new File(['photo bytes'],'phone-label.jpg',{type:'image/jpeg',lastModified:10});
      await Promise.all(Array.from({length:12},(_,n)=>store.put({id:'repeated',values:{serial:String(n)},photos:[{file}]})));
      const saved=await store.get('repeated');
      if(saved.values.serial!=='11'||await saved.photos[0].file.text()!=='photo bytes')throw Error('Draft round trip failed');
      const queue=AssetSaveQueue.create({scope:'test',protocol:2,api:{},online:()=>false,lock:fn=>fn()});
      await queue.enqueueMany([{id:'op1',kind:'create',params:{serial:'0001'},photos:[{file}]}]);
      const reopened=AssetSaveQueue.create({scope:'test',protocol:2,api:{},online:()=>false,lock:fn=>fn()});
      if(await (await reopened.rows())[0].photos[0].file.text()!=='photo bytes')throw Error('Queue round trip failed');
      await store.put({id:'remove',photos:[{file}]});
      const pending=store.put({id:'remove',photos:[{file}]});await store.remove('remove');await pending;
      if(await store.get('remove'))throw Error('Deleted draft returned');
      const stale={id:'stale',scope:'workflow-test',kind:'form',operationId:'sent-op',asset:{},values:{},photos:[]};
      await AssetDrafts.create('workflow-test').put(stale);
      let opened='',saveCount=0,closed=0,notice='';
      const c={icon:()=>'',esc:x=>x,scope:()=> 'workflow-test',state:{boot:{features:{unified_editor:1}},refs:{custom_fields:[]},assets:[],route:'assets'},setDraftCount(){},rows:()=>[{id:'sent-op',payload:{request_id:'sent-op'},state:'Retry'}],closeModal(){closed++;},openLocalOperation:r=>opened=r.id,toast:m=>notice=m,queue:()=>({enqueueMany:async ops=>{saveCount++;return ops;}}),contextFromRow:r=>r,confirmAddLinkedAsset(){},hasModalReturn:()=>false};
      const workflow=AssetWorkflows.create(c);workflow.syncScope();
      const host=document.createElement('div');host.id='localDraftItems';document.body.append(host);await workflow.paintDrafts(host);
      host.querySelector('[data-resume-draft]').click();
      await new Promise(r=>setTimeout(r,20));
      if(opened!=='sent-op')throw Error('Sent operation reopened as an editable draft');
      const form=document.querySelector('#assetForm');
      workflow.mountForm(form,{_origin:{route:'assets'}}, {items:[]},null,'new-op');
      const remove=AssetDrafts.create('workflow-test');
      // Simulate a recovery-draft deletion failing after the durable queue accepted a save.
      const oldRemove=IDBObjectStore.prototype.delete;
      IDBObjectStore.prototype.delete=function(...args){if(this.name==='drafts')throw Error('Storage cleanup failed');return oldRemove.apply(this,args);};
      const control=workflow.forms.get(form);control.dirty=true;control.snapshot();await new Promise(r=>setTimeout(r,20));
      const row=await workflow.saveForm({},form,{items:[]},null,'new-op');
      IDBObjectStore.prototype.delete=oldRemove;
      if(saveCount!==1||row.id!=='new-op'||!notice.includes('Asset saved on this device'))throw Error('Cleanup failure masked confirmed local save');
      return {draftWrites:12,photoBytesRestored:true,queuedPhotoRestored:true,noDraftResurrection:true,sentDraftRoutesToPending:true,cleanupDoesNotResubmit:true};
    });
    const app=await fs.readFile(path.join(root,'public/app.js'),'utf8');
    const toast=app.slice(app.indexOf('  function toast('),app.indexOf('  function humanError('));
    await page.addStyleTag({url:base+'/app.css'});
    await page.evaluate(source=>{window.testToast=new Function('$','esc',source+';return toast;')(id=>document.getElementById(id),s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;'));},toast);
    await page.evaluate(()=>{document.body.classList.add('modal-open');for(let i=0;i<25;i++)testToast('Scan draft could not be stored. Keep this result open. Failed to write blobs (InvalidBlob)','error');});
    assert.equal(await page.locator('.toast-item').count(),1);
    await page.evaluate(()=>{for(let i=0;i<10;i++)testToast('Different failure '+i,'error');});
    assert.equal(await page.locator('.toast-item').count(),2);
    const box=await page.locator('#toast').boundingBox();assert(box.height<=844*.35+1);
    await page.locator('.toast-close').first().click();assert.equal(await page.locator('.toast-item').count(),1);
    console.log(JSON.stringify({...result,duplicateErrorsCollapsed:true,notificationsBounded:true,notificationsDismissible:true}));
  }finally{await browser?.close();await new Promise(r=>server.close(r));}
})().catch(err=>{console.error(err);process.exitCode=1;});

