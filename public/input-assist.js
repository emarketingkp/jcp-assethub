/* Local, evidence-based suggestions. Knowledge is data, never executable rules. */
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.AssetInput=api;
})(typeof window==='undefined'?null:window,function(){
  const text=v=>String(v??'').trim();
  const norm=v=>text(v).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
  const phrase=(line,term)=>(' '+norm(line)+' ').includes(' '+norm(term)+' ');
  const strings=a=>Array.isArray(a)&&a.length<=200&&a.every(s=>typeof s==='string'&&s.length>0&&s.length<=100&&norm(s));
  function validate(data){
    if(!data||JSON.stringify(data).length>100000||data.schemaVersion!==1||typeof data.dataVersion!=='string')throw new Error('Unsupported input knowledge');
    for(const kind of ['brands','categories','specificationLabels','models']){
      if(!Array.isArray(data[kind])||data[kind].length>500)throw new Error('Invalid knowledge list');
    }
    const names=new Set(),ids=new Set();
    for(const row of data.brands){
      if(!strings([row.name])||!strings(row.aliases)||names.has(norm(row.name)))throw new Error('Invalid brand');
      names.add(norm(row.name));
    }
    for(const row of data.categories){
      if(!strings([row.name,row.categoryId])||!strings(row.aliases)||ids.has(row.categoryId))throw new Error('Invalid category');
      ids.add(row.categoryId);
    }
    for(const row of data.specificationLabels){
      if(!/^[a-z][a-z0-9_]{0,40}$/.test(row.key)||!strings([row.label])||!strings(row.aliases))throw new Error('Invalid specification label');
    }
    const allowedLabels=['brand','manufacturer','model','category','serial'];
    if(!data.fieldLabels||Object.keys(data.fieldLabels).some(k=>!allowedLabels.includes(k)))throw new Error('Invalid field label key');
    for(const k of allowedLabels)if(!strings(data.fieldLabels[k]))throw new Error('Invalid field labels');
    for(const row of data.models)if(!strings([row.brand,row.model]))throw new Error('Invalid model');
    return data;
  }
  function createEngine(input){
    // Copy validated data: an update cannot mutate a running scan's dictionary.
    const data=JSON.parse(JSON.stringify(validate(input)));
    const brandMap=new Map(),labelMap=new Map(),specMap=new Map();
    const brandRules=data.brands.map(row=>({...row,terms:[row.name,...row.aliases].map(alias=>({alias,match:' '+norm(alias)+' '})).sort((a,b)=>b.match.length-a.match.length)}));
    for(const row of data.brands)for(const alias of [row.name,...row.aliases]){
      const k=norm(alias),old=brandMap.get(k);
      if(old&&old!==row.name)throw new Error('Ambiguous brand alias');
      brandMap.set(k,row.name);
    }
    for(const [key,labels]of Object.entries(data.fieldLabels))for(const label of labels){
      if(labelMap.has(norm(label))&&labelMap.get(norm(label))!==key)throw new Error('Ambiguous field label');
      labelMap.set(norm(label),key);
    }
    for(const row of data.specificationLabels)for(const label of [row.label,...row.aliases]){
      if(specMap.has(norm(label))&&specMap.get(norm(label)).key!==row.key)throw new Error('Ambiguous specification label');
      specMap.set(norm(label),row);
    }
    function categories(refs){
      if(!Array.isArray(refs))return data.categories.map(r=>({...r,name:r.name}));
      return refs.filter(r=>r.active!==false&&String(r.active)!=='false').map(r=>{
        const def=data.categories.find(d=>d.categoryId===r.category_id||norm(d.name)===norm(r.name));
        return {name:r.name,categoryId:r.category_id,aliases:def?[def.name,...def.aliases]:[]};
      });
    }
    function canonical(field,value,refs){
      if(field==='brand')return brandMap.get(norm(value))||'';
      if(field==='category'){
        const matches=categories(refs?.categories).filter(r=>[r.name,...r.aliases].some(a=>norm(a)===norm(value)));
        return matches.length===1?matches[0].name:'';
      }
      return text(value);
    }
    function modelChoices(brand,assets=[]){
      if(!text(brand))return [];
      const b=norm(canonical('brand',brand)||brand);
      return [...new Set([...data.models,...assets].filter(r=>norm(canonical('brand',r.brand)||r.brand)===b).map(r=>text(r.model)).filter(Boolean))].sort();
    }
    function analyze(raw,refs={}){
      const lines=text(raw).slice(0,24000).split(/\r?\n/).map(text).filter(Boolean).slice(0,180);
      const contexts=lines.map(line=>({line,normalized:' '+norm(line)+' ',compatibility:/(?:compatible|replacement|driver|works with)/i.test(line)}));
      const fields={},attributes=[],suggestions={brand:[],category:[]},brandExcluded=new Set();
      const put=(key,value,evidence,origin='label')=>{
        const item={value:text(value),evidence,origin,status:origin==='label'?'supported':'inferred'};
        if(fields[key]&&norm(fields[key].value)!==norm(item.value)){
          suggestions[key]||=[];suggestions[key].push({...item,reason:'Different labeled value; review'});
        }else fields[key]=item;
      };
      for(let i=0;i<lines.length;i++){
        const line=lines[i],pair=line.match(/^([^:=]{1,40})\s*[:=]\s*(.{1,145})$/);
        const label=norm(pair?pair[1]:line.replace(/[:=]\s*$/,''));
        const key=labelMap.get(label),spec=specMap.get(label);
        if(!key&&!spec)continue;
        const value=text(pair?pair[2]:lines[i+1]);
        if(!value||value.length>145||(!pair&&(/[:=]/.test(value)||labelMap.has(norm(value))||specMap.has(norm(value)))))continue;
        const evidence=pair?line:line+'\n'+value;
        if(key==='manufacturer'||spec){brandExcluded.add(line);if(!pair)brandExcluded.add(value);}
        if(key){
          if(key==='serial'&&!/^[a-z0-9-]{4,40}$/i.test(value))continue;
          const standard=['brand','category'].includes(key)?canonical(key,value,refs):'';
          if(key==='category'&&!standard){suggestions.category.push({value,evidence,reason:'Category not in active list; confirm'});continue;}
          put(key,standard||value,evidence);
        }else attributes.push({key:spec.key,label:spec.label,value,evidence,origin:'label',status:'supported'});
      }
      if(!fields.brand){
        const candidates=[];
        for(const row of brandRules){
          for(const context of contexts){
            if(brandExcluded.has(context.line)||context.compatibility||/(?:processor|graphics|chipset|manufactur|made by|distributed by|imported by)/i.test(context.line))continue;
            const term=row.terms.find(term=>context.normalized.includes(term.match));
            if(term){candidates.push({value:row.name,evidence:context.line,alias:term.alias,origin:'dictionary',status:'inferred',reason:'Brand name found in label text'});break;}
          }
        }
        suggestions.brand=candidates.filter(a=>!candidates.some(b=>b!==a&&b.evidence===a.evidence&&norm(b.alias)!==norm(a.alias)&&phrase(b.alias,a.alias)));
        if(suggestions.brand.length===1)fields.brand=suggestions.brand[0];
      }
      if(!fields.category){
        const candidates=[];
        for(const row of categories(refs.categories)){
          let best=null;
          for(const alias of [row.name,...row.aliases]){
            const term=norm(alias),line=contexts.find(c=>!c.compatibility&&c.normalized.includes(' '+term+' '))?.line;
            const score=term.split(' ').length*2;
            if(line&&(!best||score>best.score))best={value:row.name,evidence:line,score,origin:'dictionary',status:'inferred',reason:'Matched equipment phrase: '+alias};
          }
          if(best)candidates.push(best);
        }
        candidates.sort((a,b)=>b.score-a.score);
        suggestions.category=[...suggestions.category,...candidates].slice(0,3);
        if(candidates.length&&(!candidates[1]||candidates[0].score-candidates[1].score>=2))fields.category=candidates[0];
      }
      return {fields,attributes,suggestions,categoryNames:categories(refs.categories).map(r=>r.name),version:data.dataVersion};
    }
    function distance(a,b){
      if(Math.abs(a.length-b.length)>1)return 2;
      let prev=Array.from({length:b.length+1},(_,i)=>i);
      for(let i=1;i<=a.length;i++){
        const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,prev[j]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=next;
      }
      return prev[b.length];
    }
    function suggest(field,query,refs={}){
      const q=norm(query);if(!q)return [];
      const exact=canonical(field,query,refs);
      const choices=field==='brand'?data.brands.map(r=>r.name):field==='category'?categories(refs.categories).map(r=>r.name):modelChoices(refs.brand,refs.assets);
      const result=[];
      if(exact&&text(exact)!==text(query))result.push({value:exact,reason:'Standard name'});
      for(const name of choices){
        if(norm(name).includes(q)&&!result.some(r=>r.value===name))result.push({value:name,reason:'Matching name'});
      }
      // Misspellings are suggestions only. Never fuzzy-match serials or model codes.
      if(field==='brand'&&q.length>=4&&!result.length){
        for(const [alias,name]of brandMap)if(distance(q,alias)===1&&!result.some(r=>r.value===name))result.push({value:name,reason:'Possible spelling; confirm'});
      }
      return result.slice(0,3);
    }
    function canonicalAttribute(item){
      const standard=specMap.get(norm(item.key))||specMap.get(norm(item.label));
      return standard?{...item,key:standard.key,label:standard.label}:item;
    }
    return {analyze,canonical,suggest,modelChoices,canonicalAttribute,brands:()=>data.brands.map(r=>r.name),version:data.dataVersion};
  }
  let current=null,loading=null;
  function ready(){
    if(loading)return loading;
    loading=(async()=>{
      const store=typeof window==='undefined'?null:window.AssetStore;
      try{const cached=await store?.get('input-knowledge:v1');if(cached)current=createEngine(cached);}catch{}
      const refresh=async()=>{
        const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),2000);
        try{
          const response=await fetch('./data/input-knowledge.json',{signal:controller.signal,cache:'no-cache'});
          if(!response.ok)throw new Error('Knowledge unavailable');
          const raw=await response.text();if(raw.length>100000)throw new Error('Knowledge too large');
          const data=JSON.parse(raw),engine=createEngine(data);
          current=engine;await store?.set('input-knowledge:v1',data);
        }catch{/* Keep the last validated copy; manual entry remains available. */}
        finally{clearTimeout(timer);}
        return current;
      };
      if(current){void refresh();return current;}
      return refresh();
    })();
    return loading;
  }
  return {createEngine,validate,norm,ready,get current(){return current;}};
});
