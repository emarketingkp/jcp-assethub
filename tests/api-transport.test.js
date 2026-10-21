const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');
test('iframe retries send one stable backend request ID rather than a second random envelope field',async()=>{
  const forms=[],frames=[],listeners=new Map(),values=new Map();
  const context={URL,performance:{now:()=>0},location:{origin:'https://test.invalid'},localStorage:{getItem:k=>values.get(k)||'',setItem:(k,v)=>values.set(k,v)},setTimeout:()=>1,clearTimeout(){},window:{ASSETHUB_CONFIG:{API_URL:'https://script.google.com/macros/s/test/exec'},addEventListener:(k,fn)=>listeners.set(k,fn),removeEventListener:k=>listeners.delete(k)},document:{createElement:tag=>({tag,style:{},children:[],setAttribute(){},appendChild(el){this.children.push(el);},remove(){},submit(){forms.push(this);}}),body:{appendChild(el){if(el.tag==='iframe')frames.push(el);}}}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../public/api.js'),'utf8'),context);
  const id='11111111-1111-4111-8111-111111111111';
  for(let attempt=0;attempt<2;attempt++){
    const pending=context.window.AssetAPI.post('saveAssetBatch',{request_id:id,batch_json:'fixture'});
    const fields=forms.at(-1).children.filter(el=>el.name==='request_id');assert.equal(fields.length,1);assert.equal(fields[0].value,id);
    listeners.get('message')({origin:'https://script.google.com',data:{__jcpAssetHubReply:true,request_id:id,data:{success:true}}});await pending;
  }
  assert.equal(forms.length,2);
});
