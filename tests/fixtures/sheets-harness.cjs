// Runs the actual Apps Script code against in-memory spreadsheet primitives.
// No network access, mocked business rules, real credentials or live records.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const data=require('../../public/data/input-knowledge.json');
function createHarness(options={}){
  const sheets=new Map(),writes=[],formats=[];let failure=null,locked=false;
  const literal=value=>typeof value==='string'&&/^'\s*=/.test(value)?value.slice(1):value;
  class Sheet{
    constructor(name,headers=[]){this.name=name;this.cells=headers.length?[headers.slice()]:[];}
    getName(){return this.name;}
    getLastRow(){return this.cells.length;}
    getLastColumn(){return Math.max(0,...this.cells.map(r=>r.length));}
    getDataRange(){return this.getRange(1,1,Math.max(1,this.getLastRow()),Math.max(1,this.getLastColumn()));}
    appendRow(row){this.getRange(this.getLastRow()+1,1,1,row.length).setValues([row]);}
    getRange(row,col,count=1,width=1){
      const sheet=this;
      return {
        getValues(){return Array.from({length:count},(_,i)=>Array.from({length:width},(_,j)=>sheet.cells[row+i-1]?.[col+j-1]??''));},
        getDisplayValues(){return this.getValues().map(r=>r.map(v=>String(v)));},
        setNumberFormat(pattern){formats.push({sheet:sheet.name,row,col,count,width,pattern});return this;},
        setValues(values){
          if(values.length!==count||values.some(r=>r.length!==width))throw new Error('Range dimension mismatch');
          const inject=failure?.sheet===sheet.name&&row>1?failure:null;if(inject)failure=null;
          if(inject?.when==='before')throw new Error('Injected write failure');
          const limit=inject?.partialRows??count;
          values.slice(0,limit).forEach((r,i)=>r.forEach((value,j)=>{if(typeof value==='string'&&/^\s*=/.test(value))throw new Error('Unescaped spreadsheet formula');if(!sheet.cells[row+i-1])sheet.cells[row+i-1]=[];sheet.cells[row+i-1][col+j-1]=literal(value);}));
          writes.push({sheet:sheet.name,row,col,count:Math.min(limit,count),width});
          if(inject)throw new Error('Injected uncertain write failure');return this;
        },
        setValue(value){return this.setValues(Array.from({length:count},()=>Array(width).fill(value)));}
      };
    }
    getRangeList(addresses){return {setValue:value=>{for(const address of addresses){const m=address.match(/^([A-Z]+)(\d+)$/);let col=0;for(const c of m[1])col=col*26+c.charCodeAt(0)-64;this.getRange(Number(m[2]),col).setValue(value);}}};}
  }
  const ss={getSheets:()=>[...sheets.values()],getSheetByName:name=>sheets.get(name)||null,insertSheet(name){const sheet=new Sheet(name);sheets.set(name,sheet);return sheet;}};
  const cached=new Map(),cache={get(key){const item=cached.get(key);return item&&item.expires>Date.now()?item.value:null;},put(key,value,seconds=600){cached.set(key,{value,expires:Date.now()+seconds*1000});},remove(key){cached.delete(key);}};
  const context={console,URL,PropertiesService:{getScriptProperties:()=>({getProperty:k=>({SPREADSHEET_ID:'test-only-sheet',DRIVE_FOLDER_ID:'test-only-folder',...(options.properties||{})}[k]||'')})},SpreadsheetApp:{openById:()=>ss},CacheService:{getScriptCache:()=>cache},LockService:{getScriptLock:()=>({waitLock(){if(locked)throw new Error('Nested lock');locked=true;},releaseLock(){locked=false;}})},Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,value)=>crypto.createHash('sha256').update(String(value)).digest(),base64Encode:value=>Buffer.from(value).toString('base64'),base64EncodeWebSafe:value=>Buffer.from(value).toString('base64url')},UrlFetchApp:{fetch(){throw new Error('Network calls forbidden in the spreadsheet harness');}}};
  vm.createContext(context);for(const file of ['Code.gs','AssetGroups.gs'])vm.runInContext(fs.readFileSync(path.resolve(__dirname,'../../apps-script',file),'utf8'),context,{filename:file});
  const schema=JSON.parse(vm.runInContext('JSON.stringify(SCHEMA)',context));
  Object.entries(schema).forEach(([name,headers])=>{if(options.grouping===false&&name==='AssetBatches')return;sheets.set(name,new Sheet(name,options.grouping===false&&name==='Assets'?headers.filter(h=>!['set_id','set_name'].includes(h)):headers));});
  function seed(name,objects){const sheet=sheets.get(name),headers=sheet.cells[0];for(const object of objects)sheet.cells.push(headers.map(k=>object[k]??''));context.invalidateDataCache_();}
  seed('Sites',[{site_id:'SITE-TEST',name:'Test Site',active:true}]);seed('Areas',[{area_id:'AREA-TEST',name:'Test Area',site_id:'SITE-TEST',active:true}]);
  seed('Categories',data.categories.map(c=>({category_id:c.categoryId,name:c.name,prefix:'AS',active:true})));
  seed('Assets',options.assets||[]);seed('CustomFields',options.customFields||[]);
  const read=name=>JSON.parse(JSON.stringify(context.listObjects_(name)));
  const staff={username:'test-staff',name:'Test Staff',role:options.role||'STAFF'};
  return {context,sheets,writes,formats,seed,read,fail:config=>{failure=config;},batch(payload,{id=crypto.randomUUID(),user=staff,confirmed='true'}={}){return JSON.parse(JSON.stringify(context.saveAssetBatch_({request_id:id,batch_json:JSON.stringify(payload),confirmed},user)));},request(params,user=staff){return JSON.parse(JSON.stringify(context.saveAssetBatch_(params,user)));}};
}
module.exports={createHarness};
