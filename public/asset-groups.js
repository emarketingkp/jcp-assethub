/* View grouping never merges records or treats a shared model code as a serial. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.AssetGroups=api;})(typeof window!=='undefined'?window:null,()=>{
  const text=v=>String(v??'').trim();
  const normalized=v=>text(v).toLowerCase().replace(/\s+/g,' ');
  const known=v=>text(v)&&! /^(?:unknown|n\/?a|none|not (?:known|recorded|available)|-)$/i.test(text(v));
  const serialKey=v=>text(v).toUpperCase().replace(/[^A-Z0-9]/g,'');
  function sharedSpecifications(value){return text(value).split(/\r?\n/).filter(line=>!/^\s*(?:serial(?:\s+(?:number|no\.?))?|s\s*\/\s*n|sn|imei\s*2?|mac(?:\s+address)?|service\s+tag|jcp\s+asset\s+id|asset\s+id|host\s*name|device\s+name|device\s+id|uuid|product\s+id|license\s+key)\s*[:=#]/i.test(line)).join('\n').trim();}
  function modelKey(a){
    if(!known(a.brand)||!known(a.model))return '';
    const category=a.category_id||a.category_name||a.category;
    if(!known(category))return '';
    // Exact model punctuation and specification text keep revisions/capacities apart.
    return JSON.stringify([normalized(category),normalized(a.brand),normalized(a.model),normalized(sharedSpecifications(a.specifications))]);
  }
  function unmarkedKey(a){const category=a.category_id||a.category_name||a.category;return known(category)&&!modelKey(a)?JSON.stringify([normalized(category),known(a.brand)?normalized(a.brand):'',known(a.model)?normalized(a.model):'',normalized(sharedSpecifications(a.specifications))]):'';}
  function uniqueAssets(assets){
    const byId=new Map();
    for(const asset of assets||[]){
      const id=text(asset?.asset_id);if(!id||asset.status==='Merged')continue;
      const old=byId.get(id);
      if(!old||text(asset.updated_at)>text(old.updated_at))byId.set(id,asset);
    }
    return [...byId.values()];
  }
  function buildIndex(assets){
    const all=uniqueAssets(assets),serials=new Map(),sets=new Map(),models=new Map(),unmarked=new Map();
    for(const asset of all){
      const serial=serialKey(asset.serial);
      if(serial){if(!serials.has(serial))serials.set(serial,[]);serials.get(serial).push(asset.asset_id);}
      if(asset.set_id){if(!sets.has(asset.set_id))sets.set(asset.set_id,[]);sets.get(asset.set_id).push(asset);}
      const key=modelKey(asset);if(key){if(!models.has(key))models.set(key,[]);models.get(key).push(asset);}
      const unknown=unmarkedKey(asset);if(unknown){if(!unmarked.has(unknown))unmarked.set(unknown,[]);unmarked.get(unknown).push(asset);}
    }
    return {all,serials,sets,models,unmarked};
  }
  function project(rows,index,{grouped=true}={}){
    const entries=[],byGroup=new Map();
    for(const asset of uniqueAssets(rows)){
      let kind='asset',key=asset.asset_id;
      if(grouped&&asset.set_id){kind='set';key=asset.set_id;}
      else if(grouped){const model=modelKey(asset),unknown=unmarkedKey(asset);if(model){kind='model';key=model;}else if(unknown){kind='unmarked';key=unknown;}}
      const id=kind+':'+key;
      if(!byGroup.has(id)){const entry={key:id,kind,assets:[],total:0};byGroup.set(id,entry);entries.push(entry);}
      byGroup.get(id).assets.push(asset);
    }
    for(const entry of entries){
      const first=entry.assets[0];
      if(entry.kind==='set')entry.total=index.sets.get(first.set_id)?.length||entry.assets.length;
      else if(entry.kind==='model')entry.total=(index.models.get(modelKey(first))||[]).filter(a=>!a.set_id).length;
      else if(entry.kind==='unmarked')entry.total=(index.unmarked.get(unmarkedKey(first))||[]).filter(a=>!a.set_id).length;
      else entry.total=1;
      if(['model','unmarked'].includes(entry.kind)&&entry.assets.length===1&&entry.total===1)entry.kind='asset';
    }
    return entries;
  }
  function template(a){
    // Whitelist shared product details. No serial, IDs, photos, assignment or history.
    return {category:a.category_name||a.category||'',category_id:a.category_id||'',brand:known(a.brand)?text(a.brand):'',model:known(a.model)?text(a.model):'',specifications:sharedSpecifications(a.specifications)};
  }
  function duplicateSerials(units,index){
    const seen=new Map(),issues=[];
    units.forEach((unit,i)=>{
      if(unit.existing_asset_id)return;
      const key=serialKey(unit.serial);if(!key)return;
      if(seen.has(key))issues.push(`Items ${seen.get(key)+1} and ${i+1} have the same serial. Shared product codes belong in the common product details.`);
      else seen.set(key,i);
      const ids=index.serials.get(key);if(ids?.length)issues.push(`Item ${i+1}: serial already belongs to ${ids.join(', ')}. Choose the existing item instead.`);
    });return issues;
  }
  function matchKind(match,incoming){
    const asset=match.asset||{},serial=serialKey(incoming.serial),other=serialKey(asset.serial);
    if(serial&&serial===other)return 'identity';
    if((match.reasons||[]).some(r=>/exact JCP|matching (?:imei|imei2|mac|service.tag)|same serial/i.test(r)))return 'identity';
    if(serial&&other&&serial!==other)return 'different_unit';
    return 'similar';
  }
  return {modelKey,unmarkedKey,sharedSpecifications,uniqueAssets,buildIndex,project,template,duplicateSerials,serialKey,matchKind};
});
