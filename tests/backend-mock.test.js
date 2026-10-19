const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const code=fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');
const sample='Brand: GeneralWorks\nModel: GW-82\nSerial: ABCD1234\nIMEI: 987654321098765\nRAM: 16 GB';
let requests=0;
const context={
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>({GROQ_API_KEY:'mock-secret',GROQ_MODEL:'openai/gpt-oss-20b'}[k]||'')})},
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  CacheService:{getScriptCache:()=>({get(){return null},put(){}})},
  Utilities:{base64EncodeWebSafe:()=>''},
  UrlFetchApp:{fetch:(url,params)=>{requests++;assert(url.endsWith('/responses'));
    assert.equal(params.headers.Authorization,'Bearer mock-secret');
    const payload=JSON.parse(params.payload);
    assert.equal(payload.model,'openai/gpt-oss-20b');
    assert.equal(payload.text.format.strict,true);
    const result={
      category:{value:'Desktop PC',evidence:'RAM: 16 GB',status:'inferred',name:'category'},
      brand:{value:'GeneralWorks',evidence:'Brand: GeneralWorks',status:'supported',name:'brand'},
      manufacturer:{value:'',evidence:'',status:'not_detected',name:'manufacturer'},
      model:{value:'GW-82',evidence:'Model: GW-82',status:'supported',name:'model'},
      secondary_model:{value:'',evidence:'',status:'not_detected',name:'secondary_model'},
      serial:{value:'FAKE_SERIAL',evidence:'Serial: ABCD1234',status:'supported',name:'serial'},
      identifiers:[{type:'imei',value:'987654321098765',evidence:'IMEI: 987654321098765'},{type:'mac',value:'ABCD1234',evidence:'Serial: ABCD1234'}],
      attributes:[{key:'memory',label:'Installed RAM',value:'16 GB',evidence:'RAM: 16 GB'}]
    };
    return {getResponseCode:()=>200,getContentText:()=>JSON.stringify({output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]})};
  }}
};
vm.createContext(context);vm.runInContext(code,context);
const result=context.interpretUniversalOcr_(sample,'{}','image_01',{role:'STAFF',username:'mock-user'});
assert.equal(result.fields.brand.value,'GeneralWorks');
assert.equal(result.fields.model.value,'GW-82');
assert(!result.fields.serial,'unsupported serial must be rejected');
assert.equal(result.identifiers.length,1,'MAC from serial evidence must be rejected');
assert.equal(result.identifiers[0].type,'imei');
assert.equal(result.attributes[0].key,'memory');
assert.equal(requests,1);
const merged=context.combineSpecifications_('CPU: Intel Core i5\nRAM: 8 GB','RAM: 16 GB\nSSD: 512 GB');
assert(merged.includes('RAM: 8 GB')&&!merged.includes('RAM: 16 GB'));
assert(merged.includes('SSD: 512 GB'));
console.log('PASS: mocked backend (strict schema, security, typed IDs, non-destructive spec combination)');
