/* Health is based on completed checks, never on key/library presence alone. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.ConnectionStatus=api;})(typeof window!=='undefined'?window:null,()=>{
  const labels={api:'Apps Script API',ocr:'OCR.Space',ai:'Groq AI',sheets:'Google Sheets',drive:'Google Drive',auth:'Session',version:'API compatibility',storage:'Browser storage',barcode:'Barcode / QR reader',qr:'QR label generator',local:'Local recognition'};
  const states=new Set(['ok','error','warning','not_tested','disabled','info','checking']);
  function create({onChange=()=>{},now=Date.now}={}){
    const rows=new Map(Object.entries(labels).map(([id,label])=>[id,{id,label,state:'not_tested',message:'Not checked in this tab.'}])),tickets=new Map();
    const update=(id,value)=>{
      if(!rows.has(id))return;
      const old=rows.get(id),state=states.has(value.state)?value.state:'not_tested';
      // Configuration refresh must not erase a recent real scan/test result.
      if(value.evidence==='configuration'&&value.state==='not_tested'&&value.configured!==false&&old.checked_at&&now()-new Date(old.checked_at).getTime()<300000&&['scan','provider_test'].includes(old.evidence))return;
      rows.set(id,{...old,...value,id,label:labels[id],state,ok:state==='ok'});onChange();
    };
    const snapshot=()=>({components:Object.fromEntries([...rows].map(([id,row])=>[id,{...row,stale:!!row.checked_at&&now()-new Date(row.checked_at).getTime()>300000}]))});
    const summary=()=>{
      const values=Object.values(snapshot().components),bad=values.filter(r=>r.state==='error'),warn=values.some(r=>r.state==='warning'||r.state==='disabled'||r.stale);
      return {status:bad.length?'issues':warn?'warning':rows.get('api').state==='ok'?'online':'checking',text:bad.length?'Issues':warn?'Warning':rows.get('api').state==='ok'?'API online':'Checking',message:bad.map(r=>r.label+': '+r.message).join(' · ')};
    };
    async function run(id,task,{timeoutMs=25000,evidence='read'}={}){
      const ticket=(tickets.get(id)||0)+1;tickets.set(id,ticket);const started=now();
      update(id,{state:'checking',message:'Checking…',evidence});let timer;
      try{
        const result=await Promise.race([Promise.resolve().then(task),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Check timed out. Retry when the connection is stable.')),timeoutMs);})]);
        if(tickets.get(id)===ticket)update(id,{...result,checked_at:result.checked_at||new Date(now()).toISOString(),elapsed_ms:result.elapsed_ms??Math.max(0,now()-started),evidence:result.evidence||evidence});
        return result;
      }catch(err){
        const result={state:'error',message:String(err.message||err),checked_at:new Date(now()).toISOString(),elapsed_ms:Math.max(0,now()-started),evidence};
        if(tickets.get(id)===ticket)update(id,result);return result;
      }finally{clearTimeout(timer);}
    }
    function cancel(){for(const [id,row]of rows){if(row.state!=='checking')continue;tickets.set(id,(tickets.get(id)||0)+1);update(id,{state:'not_tested',message:'Check stopped on this device. A server request may still complete.'});}}
    function record(id,value){tickets.set(id,(tickets.get(id)||0)+1);update(id,value);}
    return {update,record,run,snapshot,summary,cancel};
  }
  return {create,labels};
});
