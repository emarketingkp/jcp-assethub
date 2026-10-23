/* Shared editor metadata. Product templates never contain a unit's identity. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetEditor=api;})(typeof window==='undefined'?null:window,()=>{
  const text=v=>String(v??'').trim(),norm=v=>text(v).toLowerCase().replace(/\s+/g,' ');
  const fields=[
    ['asset_name','Asset name','identity',160],['category','Category','identity',100],['brand','Brand','identity',120],['model','Model','identity',160],['serial','Serial number','identity',80],['specifications','Specifications','identity',4800],
    ['site_id','Site','placement',80],['area','Area / Department','placement',120],['exact_location','Exact location','placement',160],['assigned_to','Assigned person / team','placement',160],['status','Status','placement',30],['movement_note','Movement note','placement',500],['parent_asset_id','Main asset','links',80]
  ].map(([key,label,section,max])=>({key,label,section,max}));
  const privateFields=[['mobile_number','Mobile number'],['register_owner','Registered owner'],['account_number','Account number'],['amount_paid','Amount paid']].map(([key,label])=>({key,label,max:160}));
  const statuses=['Active','Spare','Faulty','Under Repair','Missing','Retired'];
  function productName(a={}){const brand=text(a.brand),model=text(a.model);return model.toLowerCase().startsWith(brand.toLowerCase()+' ')?model:[brand,model].filter(Boolean).join(' ')||text(a.category_name||a.category);}
  function displayName(a={}){return text(a.asset_name)||[productName(a)||'Asset',text(a.asset_id)].filter(Boolean).join(' · ');}
  function values(a={}){return Object.fromEntries(fields.map(f=>[f.key,text(f.key==='category'?a.category_name||a.category:f.key==='area'?a.area_name||a.area:a[f.key])]));}
  function unique(values){const found=new Map();for(const v of values){const s=text(v);if(s&&!found.has(norm(s)))found.set(norm(s),s);}return [...found.values()].sort((a,b)=>a.localeCompare(b));}
  function choices(field,{refs={},assets=[],pending=[],brand='',category='',site_id='',dictionary=[]}={}){
    const rows=[...assets,...pending.map(r=>r.params||r)];
    if(field==='category')return unique([...(refs.categories||[]).filter(a=>a.active!==false&&String(a.active)!=='false').map(a=>a.name),...rows.map(a=>a.category_name||a.category)]);
    if(field==='brand')return unique([...(refs.brands||[]),...dictionary,...rows.map(a=>a.brand)]);
    if(field==='model')return unique(rows.filter(a=>(!brand||norm(a.brand)===norm(brand))&&(!category||norm(a.category_name||a.category)===norm(category))).map(a=>a.model).concat((refs.models||[]).filter(a=>(!brand||norm(a.brand)===norm(brand))&&(!category||norm(a.category)===norm(category))).map(a=>a.model)));
    if(field==='area')return unique([...(refs.areas||[]).filter(a=>!site_id||a.site_id===site_id).map(a=>a.name),...rows.filter(a=>!site_id||a.site_id===site_id).map(a=>a.area_name||a.area)]);
    if(field==='exact_location'||field==='assigned_to')return unique([...(refs[field==='assigned_to'?'assignees':'locations']||[]),...rows.map(a=>a[field])]);
    return [];
  }
  function changes(existing,incoming){const base=values(existing);return fields.filter(f=>f.key!=='movement_note'&&Object.hasOwn(incoming,f.key)&&text(incoming[f.key])!==base[f.key]).map(f=>({...f,existing:base[f.key],incoming:text(incoming[f.key]),conflict:!!base[f.key]}));}
  function reviewed(existing,incoming,choices={}){const out={};for(const f of fields)if(f.key!=='movement_note'&&Object.hasOwn(incoming,f.key)&&choices[f.key]==='incoming')out[f.key]=text(incoming[f.key]);return out;}
  function shared(a={}){return {category:text(a.category_name||a.category),category_id:text(a.category_id),brand:text(a.brand),model:text(a.model),specifications:typeof AssetGroups!=='undefined'?AssetGroups.sharedSpecifications(a.specifications):text(a.specifications)};}
  function placement(a={}){return Object.fromEntries(['site_id','area','exact_location','assigned_to'].map(k=>[k,text(k==='area'?a.area_name||a.area:a[k])]));}
  function sharedCustom(values=[],definitions=[]){
    const source=Array.isArray(values)?Object.fromEntries(values.map(f=>[f.field_id,f.value])):values;
    return Object.fromEntries(definitions.filter(f=>!/(?:serial|imei|uuid|host.?name|device.?name|asset.?name|mac.?address|asset.?tag|account|password|phone|mobile|owner|payment|paid)/i.test(f.label+' '+f.field_id)).filter(f=>Object.hasOwn(source,f.field_id)).map(f=>[f.field_id,source[f.field_id]]));
  }
  return {sharedCustom,fields,privateFields,statuses,values,displayName,productName,choices,changes,reviewed,shared,placement,unique,norm};
});
