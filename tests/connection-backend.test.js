const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHarness}=require('./fixtures/sheets-harness.cjs');
const staff={username:'test-staff',role:'STAFF'};
const properties=()=>({GROQ_API_KEY:'synthetic-groq-secret',OCR_API_KEY:'synthetic-ocr-secret'});
const answer=(code,data)=>({getResponseCode:()=>code,getContentText:()=>typeof data==='string'?data:JSON.stringify(data)});
function mapping(){
 const row=(name,value,evidence)=>({name,value,evidence,status:value?'supported':'not_detected'});
 return {brand:row('brand','JCP Test Brand','Brand: JCP Test Brand'),model:row('model','TEST-CHECK-01','Model: TEST-CHECK-01'),serial:row('serial','CHECK001234','Serial: CHECK001234'),category:row('category','',''),manufacturer:row('manufacturer','',''),secondary_model:row('secondary_model','',''),identifiers:[],attributes:[]};
}
const aiReply=()=>answer(200,{output:[{content:[{type:'output_text',text:JSON.stringify(mapping())}]}]});
test('configured providers remain untested, missing AI is disabled, and secrets never appear in diagnostics',()=>{
 const h=createHarness({properties:properties()}),d=h.context.diagnostics_('2.7','api','');
 assert.equal(d.diagnostics_version,2);assert.equal(d.components.ai.state,'not_tested');assert.equal(d.components.ai.ok,false);assert.equal(d.components.ocr.ok,false);assert.equal(d.components.auth.state,'info');
 assert(!JSON.stringify(d).includes('synthetic-'));assert.equal(h.writes.length,0);
 const missing=createHarness().context.diagnostics_('2.7','api','');assert.equal(missing.components.ai.state,'disabled');assert.equal(missing.components.ocr.state,'error');
});
test('individual Sheets and Drive checks verify only their own reads, never writes or all permissions',()=>{
 const h=createHarness();let driveCalls=0;h.context.DriveApp={getFolderById:()=>({getName:()=>{driveCalls++;return 'Private folder name must not be returned';}})};
 const sheet=h.context.diagnostics_('2.7','sheets');assert.equal(sheet.components.sheets.state,'ok');assert.equal(driveCalls,0);assert.match(sheet.components.sheets.message,/Write access was not tested/);
 const drive=h.context.diagnostics_('2.7','drive');assert.equal(driveCalls,1);assert.equal(drive.components.drive.state,'ok');assert(!JSON.stringify(drive).includes('Private folder'));
 h.sheets.delete('Assets');assert.equal(h.context.diagnostics_('2.7','sheets').components.sheets.state,'error');
 h.context.DriveApp.getFolderById=()=>{throw new Error('Secret folder ID');};assert.equal(h.context.diagnostics_('2.7','drive').components.drive.state,'error');assert.equal(h.writes.length,0);
});
test('provider test route enforces a real Staff session and never saves assets or audit rows',()=>{
 const h=createHarness({properties:properties()});h.context.postReply_=(_,value)=>value;h.context.json_=value=>value;
 let calls=0;h.context.UrlFetchApp.fetch=()=>{calls++;return aiReply();};
 assert.equal(h.context.doPost({parameter:{action:'testScanConnection',service:'ai'}}).success,false);assert.equal(calls,0);
 const deniedLogCount=h.read('ActivityLog').length;assert.equal(deniedLogCount,1,'Denied probe retains the existing security audit');
 const token='synthetic-session';h.seed('Users',[{username:'test-staff',role:'STAFF',active:true}]);h.seed('Sessions',[{session_id:'S',token_hash:h.context.hash_(token),email:'test-staff',expires_at:'2099-01-01T00:00:00Z'}]);h.writes.length=0;
 const result=h.context.doPost({parameter:{action:'testScanConnection',service:'ai',token}});assert.equal(result.check.state,'ok');assert.equal(calls,1);assert.equal(h.read('Assets').length,0);assert.equal(h.read('ActivityLog').length,deniedLogCount);assert.equal(h.writes.length,0);
 assert.equal(h.context.diagnostics_('2.7','auth',token).components.auth.state,'ok');assert.equal(h.context.diagnostics_('2.7','auth','invalid').components.auth.state,'error');
});
test('AI test uses the real scan schema, shares a credential-bound cache and does not use the scan allowance',()=>{
 const props=properties(),h=createHarness({properties:props});let calls=0;
 h.context.UrlFetchApp.fetch=(url,options)=>{calls++;assert.equal(url,'https://api.groq.com/openai/v1/responses');const p=JSON.parse(options.payload);assert.equal(p.text.format.name,'universal_assethub_v27');assert.equal(p.text.format.strict,true);assert.equal(p.max_output_tokens,2300);assert.match(p.input[0].content[0].text,/CHECK001234/);return aiReply();};
 h.context.CacheService.getScriptCache().put('ocr_ai_v27_'+Buffer.from('test-staff').toString('base64url'),30,3600);
 const first=h.context.testScanConnection_('ai',staff),cached=h.context.testScanConnection_('ai',{username:'other-staff',role:'STAFF'});assert.equal(first.state,'ok');assert.equal(cached.cached,true);assert.equal(calls,1);
 props.GROQ_MODEL='different-test-model';assert.equal(h.context.testScanConnection_('ai',staff).state,'ok');assert.equal(calls,2);
 assert.throws(()=>h.context.interpretUniversalOcr_('Brand: JCP Test Brand','{}','image_01',staff),/AI_RATE_LIMIT_LOCAL/);
 const token='synthetic-session';h.seed('Users',[{username:'test-staff',role:'STAFF',active:true}]);h.seed('Sessions',[{session_id:'S',token_hash:h.context.hash_(token),email:'test-staff',expires_at:'2099-01-01T00:00:00Z'}]);h.context.postReply_=(_,value)=>value;
 const external=h.context.doPost({parameter:{action:'interpretOcrUniversal',text:'Brand: JCP Test Brand',token,diagnostic:'true'}});assert.equal(external.success,false);assert.match(external.error,/AI_RATE_LIMIT_LOCAL/);
});
test('OCR provider test submits only the built-in image; empty/poor OCR is not a false success',()=>{
 for(const [text,state]of [['JCP CHECK 1234','ok'],['','warning']]){
  const h=createHarness({properties:properties()});h.context.UrlFetchApp.fetch=(url,options)=>{assert.equal(url,'https://api.ocr.space/parse/image');assert.match(options.payload.base64Image,/^data:image\/png;base64,/);return answer(200,{ParsedResults:[{ParsedText:text}]});};
  assert.equal(h.context.testScanConnection_('ocr',staff).state,state);assert.equal(h.writes.length,0);
 }
});
test('provider rejection, quota, transport, incomplete and invalid output have safe distinct errors',()=>{
 const cases=[
  [()=>answer(401,{error:'synthetic-groq-secret'}),'AI_AUTH'],
  [()=>answer(429,{error:'synthetic-groq-secret'}),'AI_RATE_LIMIT_PROVIDER'],
  [()=>answer(400,{error:'synthetic-groq-secret'}),'AI_REQUEST_REJECTED'],
  [()=>answer(400,{error:{code:'model_decommissioned',message:'synthetic-groq-secret'}}),'AI_MODEL_UNAVAILABLE'],
  [()=>answer(400,{error:{code:'json_validate_failed',message:'synthetic-groq-secret'}}),'AI_SCHEMA_REJECTED'],
  [()=>answer(503,'synthetic-groq-secret'),'AI_HTTP_503'],
  [()=>{throw new Error('synthetic-groq-secret');},'AI_TRANSPORT'],
  [()=>answer(200,{status:'incomplete',incomplete_details:{reason:'max_output_tokens'}}),'AI_OUTPUT_LIMIT'],
  [()=>answer(200,{status:'incomplete',incomplete_details:{reason:'other'}}),'AI_INCOMPLETE'],
  [()=>answer(200,{output:[{content:[{type:'refusal'}]}]}),'AI_REFUSED'],
  [()=>answer(200,'not JSON'),'AI_INVALID_JSON'],
  [()=>answer(200,'null'),'AI_INVALID_JSON'],
  [()=>answer(200,{output:[null,{content:[null]}]}),'AI_INVALID_JSON'],
  [()=>answer(200,{output:[{content:[{type:'output_text',text:'[]'}]}]}),'AI_INVALID_SCHEMA'],
  [()=>answer(200,{output:[]}),'AI_INVALID_JSON']
 ];
 for(const [reply,code]of cases){const h=createHarness({properties:properties()});h.context.UrlFetchApp.fetch=reply;const r=h.context.testScanConnection_('ai',staff);assert.equal(r.state,'error');assert.match(r.message,new RegExp('^'+code));assert(!r.message.includes('synthetic-groq-secret'));}
 const complete=createHarness({properties:properties()});complete.context.UrlFetchApp.fetch=()=>answer(200,{status:'completed',incomplete_details:{},output:[{content:[{type:'output_text',text:JSON.stringify(mapping())}]}]});assert.equal(complete.context.testScanConnection_('ai',staff).state,'ok');
 const h=createHarness({properties:properties()});h.context.UrlFetchApp.fetch=()=>answer(403,'synthetic-ocr-secret');assert.match(h.context.testScanConnection_('ocr',staff).message,/^OCR_AUTH/);
 for(const [message,code]of [['Invalid API key','OCR_AUTH'],['Quota reached','OCR_RATE_LIMIT_PROVIDER'],['File size too large','OCR_IMAGE_TOO_LARGE']]){const h=createHarness({properties:properties()});h.context.UrlFetchApp.fetch=()=>answer(200,{IsErroredOnProcessing:true,ErrorMessage:message});assert.match(h.context.testScanConnection_('ocr',staff).message,new RegExp('^'+code));}
});
test('in-flight and failed provider probes are reused instead of making parallel/repeated calls',()=>{
 const h=createHarness({properties:properties()});let calls=0;
 h.context.UrlFetchApp.fetch=()=>{calls++;assert.equal(h.context.testScanConnection_('ai',staff).state,'checking');return answer(429,{});};
 assert.equal(h.context.testScanConnection_('ai',staff).state,'error');assert.equal(h.context.testScanConnection_('ai',staff).cached,true);assert.equal(calls,1);
 assert.throws(()=>h.context.testScanConnection_('ai',{role:'GUEST'}),/AUTH_REQUIRED/);assert.throws(()=>h.context.testScanConnection_('other',staff),/Invalid/);
});
