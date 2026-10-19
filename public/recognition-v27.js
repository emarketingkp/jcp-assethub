/* Universal recognition consolidation - source evidence is mandatory for identifiers.
 * Pure functions are exported for repeatable tests; no API keys or remote calls here. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AssetRecognition=api;
})(typeof window!=='undefined'?window:null,function(){
  const CORE=['category','brand','manufacturer','model','secondary_model','serial'];
  const ID_LABELS={imei:'IMEI',imei2:'IMEI 2',mac:'MAC Address',service_tag:'Service Tag',part_number:'Part Number',asset_id:'JCP Asset ID',regulatory_id:'Regulatory ID',hardware_version:'Hardware Version',firmware_version:'Firmware Version',device_name:'Device Name',hostname:'Hostname'};
  const norm=s=>String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'');
  const value=s=>String(s??'').trim();
  const key=s=>value(s).toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,55);
  const entry=(v,evidence,source_image,status='supported')=>({value:value(v),evidence:value(evidence),source_image,status});
  function evidenceLine(text,needle){
    const match=norm(needle);if(!match)return '';
    const lines=value(text).split(/\r?\n/);
    return lines.find(s=>norm(s).includes(match))?.trim().slice(0,230)||'';
  }
  function fromOcr(ocr,source_image,local=null){
    const raw=value(ocr?.text), rawFields={...(ocr?.fields||{})};
    // Replace broad legacy guesses when the validated local dictionary is available.
    if(local){delete rawFields.category;delete rawFields.brand;delete rawFields.specifications;}
    const fields={},identifiers=[],attributes=[];
    ['category','brand','model','serial'].forEach(k=>{
      const v=value(rawFields[k]);if(!v)return;
      const ev=evidenceLine(raw,v)|| (k==='category' ? raw.split(/\r?\n/).find(Boolean)||'':'');
      if(k==='serial'&&!/(?:\bserial\b|\bs\s*\/\s*n\b|\bsn\b|service\s+tag)/i.test(ev))return;
      fields[k]=entry(v,ev,source_image,ev&&norm(ev).includes(norm(v))?'supported':'inferred');
    });
    // Generic label:value pairs complement legacy fixed-format parsing.
    const lines=raw.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    for(const line of lines.slice(0,90)){
      const m=line.match(/^([A-Za-z][A-Za-z0-9()\/_ .-]{1,38})\s*[:=]\s*(.{2,145})$/);
      if(!m)continue;
      const label=m[1].trim(),v=m[2].trim(),n=key(label);
      if(/^(serial|serial_no|serial_number|s_n|sn)$/.test(n)){
        if(/^[A-Z0-9-]{4,40}$/i.test(v))fields.serial=entry(v,line,source_image);
      }else if(/^(model|model_name|product_model)$/.test(n))fields.model=entry(v,line,source_image);
      else if(/^(brand|make)$/.test(n))fields.brand=entry(v,line,source_image);
      else if(/^(manufacturer|manufactured_by)$/.test(n))fields.manufacturer=entry(v,line,source_image);
      else if(/^(type|device_type|category)$/.test(n))fields.category=entry(v,line,source_image);
      else {
        const idType= /^(imei_?2|imei2)$/.test(n)?'imei2':
          /^(imei)$/.test(n)?'imei':/^(mac|mac_address|wifi_mac|lan_mac)$/.test(n)?'mac':
          /^(service_tag)$/.test(n)?'service_tag':/^(part_number|part_no|p_n|sku)$/.test(n)?'part_number':
          /^(hardware_version|hw_version)$/.test(n)?'hardware_version':
          /^(firmware_version|fw_version)$/.test(n)?'firmware_version':
          /^(regulatory_id)$/.test(n)?'regulatory_id':/^(device_name|hostname)$/.test(n)?n:null;
        if(idType)identifiers.push({...entry(v,line,source_image),type:idType});
        else if(v.length<=145 && !/^(website|https?|copyright|warning|email|tel|telephone|address|support|safety)/.test(n))
          attributes.push({...entry(v,line,source_image),key:n,label:label.slice(0,65)});
      }
    }
    const legacyIds=[['imei','imei'],['mac_address','mac'],['hardware_version','hardware_version'],['firmware_version','firmware_version'],['part_number','part_number'],['regulatory_id','regulatory_id']];
    for(const [field,type] of legacyIds){
      const v=value(rawFields[field]),line=evidenceLine(raw,v);
      if(v&&line&&norm(line).includes(norm(v))) identifiers.push({...entry(v,line,source_image),type});
    }
    if(rawFields.specifications){
      const spec=value(rawFields.specifications);
      // An OCR parser's summary is only fallback context; AI maps individual attributes.
      attributes.push({...entry(spec,'Legacy OCR text parsing',source_image,'inferred'),key:'ocr_specification_summary',label:'Additional OCR specifications'});
    }
    const alternatives=[];
    if(local){
      delete fields.brand;delete fields.category;
      for(const [k,it]of Object.entries(local.fields)){
        fields[k]={...it,source_image};
        for(let i=attributes.length-1;i>=0;i--)if(attributes[i].evidence===it.evidence)attributes.splice(i,1);
      }
      for(const it of local.attributes){
        for(let i=attributes.length-1;i>=0;i--)if(attributes[i].evidence===it.evidence)attributes.splice(i,1);
        attributes.push({...it,source_image});
      }
      for(const [field,items]of Object.entries(local.suggestions))for(const it of items){
        if(it.reason==='Different labeled value; review')alternatives.push({field,item:{...it,source_image}});
      }
    }
    return {version:'2.7',source_image,provider:local?'Local dictionary + OCR':'OCR',raw_text:raw,fields,identifiers,attributes,alternatives,suggestions:local?.suggestions||{},localAssisted:!!local};
  }
  function aiEvidenceValid(item,raw,{allowCategoryInference=false}={}){
    const v=value(item?.value),ev=value(item?.evidence),normalized=norm(raw);
    if(!v||!ev||!normalized.includes(norm(ev)))return false;
    if(!normalized.includes(norm(v)))return allowCategoryInference && item?.status==='inferred';
    return true;
  }
  function attachAi(observation,ai,canonical=null){
    const merged={...observation,fields:{...observation.fields},identifiers:[...observation.identifiers],attributes:[...observation.attributes],alternatives:[...(observation.alternatives||[])],suggestions:{...(observation.suggestions||{})},provider:'Groq + OCR'};
    for(const k of CORE){
      const it=ai?.fields?.[k]; if(!aiEvidenceValid(it,observation.raw_text,{allowCategoryInference:k==='category'}))continue;
      if(k==='serial' && it.status!=='supported')continue;
      const normalized=canonical&&['category','brand'].includes(k)?canonical(k,it.value):it.value;
      const incoming={...it,value:normalized||it.value,origin:'ai',source_image:observation.source_image};
      const current=merged.fields[k];
      if(observation.localAssisted&&k==='category'&&(!normalized||(!current&&it.status==='inferred'))){
        merged.suggestions[k]=[...(merged.suggestions[k]||[]),{...incoming,reason:'AI suggestion; confirm category'}];continue;
      }
      if(current?.origin&&norm(current.value)!==norm(incoming.value)){
        merged.alternatives.push({field:k,item:incoming});continue;
      }
      // Retain the more direct local evidence when AI agrees with it.
      if(!current?.origin)merged.fields[k]=incoming;
    }
    for(const kind of ['identifiers','attributes']){
      for(const it of ai?.[kind]||[]){
        if(!aiEvidenceValid(it,observation.raw_text))continue;
        const type=key(it.type),k=key(it.key),name=kind==='identifiers'?type:k;
        if(!name)continue;
        merged[kind].push({...it,...(kind==='identifiers'?{type:name}:{key:k,label:value(it.label)||k}),source_image:observation.source_image,status:'supported'});
      }
    }
    return merged;
  }
  function consolidate(observations,resolutions={}){
    const fields={},identifiers=[],attributes=[],conflicts=[],evidence={},suggestions={};
    function combine(kind,label,item,identity){
      if(!item?.value)return;
      const id=kind+':'+identity;
      if(!evidence[id])evidence[id]=[];
      const matching=evidence[id].find(x=>norm(x.value)===norm(item.value));
      if(matching){matching.sources.push(item.source_image);return;}
      evidence[id].push({...item,sources:[item.source_image]});
    }
    const detailedAttributes=observations.some(o=>(o.attributes||[]).some(a=>a.key!=='ocr_specification_summary'));
    for(const obs of observations){
      for(const k of CORE)if(obs.fields?.[k])combine('field',k,obs.fields[k],k);
      for(const alt of obs.alternatives||[])combine('field',alt.field,alt.item,alt.field);
      for(const [field,items]of Object.entries(obs.suggestions||{})){
        suggestions[field]||=[];
        for(const item of items)if(!suggestions[field].some(x=>norm(x.value)===norm(item.value)))suggestions[field].push({...item,source_image:obs.source_image});
      }
      for(const it of obs.identifiers||[])combine('id',it.type,it,it.type);
      for(const it of obs.attributes||[]){
        if(detailedAttributes&&it.key==='ocr_specification_summary')continue;
        combine('attr',it.key,it,it.key);
      }
    }
    for(const [id,options] of Object.entries(evidence)){
      const selected=options.find(o=>norm(o.value)===norm(resolutions[id]));
      const preferred=selected || options.find(o=>o.status==='supported') || options[0];
      if(options.length>1)conflicts.push({id,label:id.split(':')[1],options,resolved:!!selected});
      if(id.startsWith('field:'))fields[id.slice(6)]=preferred;
      else if(id.startsWith('id:'))identifiers.push({...preferred,type:id.slice(3)});
      else attributes.push({...preferred,key:id.slice(5)});
    }
    // OCR summaries are not automatically appended when precise attributes exist.
    const cleaned=attributes.filter(a=>a.key!=='ocr_specification_summary');
    if(!cleaned.length){
      const legacy=attributes.filter(a=>a.key==='ocr_specification_summary');
      cleaned.push(...legacy);
    }
    return {fields,identifiers,attributes:cleaned,conflicts,evidence,suggestions,hasUnresolved:conflicts.some(x=>!x.resolved),sourceCount:observations.length};
  }
  function specifications(proposal){
    const lines=[];
    for(const k of ['manufacturer','secondary_model']){
      const v=value(proposal.fields?.[k]?.value);if(v)lines.push((k==='manufacturer'?'Manufacturer':'Secondary Model')+': '+v);
    }
    for(const i of proposal.identifiers||[]){
      if(['serial','asset_id'].includes(i.type))continue;
      lines.push((ID_LABELS[i.type]||i.type.replace(/_/g,' '))+': '+value(i.value));
    }
    for(const a of proposal.attributes||[])if(a.value){
      lines.push((a.key==='ocr_specification_summary'?'OCR Specs':a.label||a.key)+': '+value(a.value));
    }
    return [...new Set(lines)].join('\n').slice(0,4800);
  }
  function toIncoming(proposal,overrides={}){
    const fields={};for(const k of ['category','brand','model','serial'])fields[k]=value(Object.hasOwn(overrides,k)?overrides[k]:(proposal.fields[k]?.value||''));
    fields.specifications=Object.hasOwn(overrides,'specifications')?value(overrides.specifications):specifications(proposal);
    return fields;
  }
  return {CORE,ID_LABELS,norm,fromOcr,attachAi,consolidate,specifications,toIncoming};
});
