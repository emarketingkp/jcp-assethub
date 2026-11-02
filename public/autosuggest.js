/* Suggestions while typing: a small list under an input. Free typing always stays allowed. */
(function(root){
  const MAX=6;let open=null;
  function close(){if(!open)return;open.list.remove();open.input.setAttribute('aria-expanded','false');open=null;}
  function matches(input){
    const q=input.value.trim().toLowerCase(),seen=new Set([q]),out=[];
    const sources=(input._suggestSources||[]).slice().sort((a,b)=>a.priority-b.priority);
    for(const source of sources){
      for(const raw of source.get(input.value)||[]){
        const item=typeof raw==='string'?{value:raw}:raw,key=String(item.value||'').toLowerCase();
        if(!key||seen.has(key)||source.filter&&q&&!key.includes(q))continue;
        seen.add(key);out.push(item);if(out.length>=MAX)return out;
      }
    }
    return out;
  }
  function pick(input,value){
    input.value=value;close();
    input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));
  }
  function show(input){
    close();if(input.disabled||input.readOnly)return;
    const items=matches(input);if(!items.length)return;
    const list=document.createElement('div');list.className='autosuggest';list.setAttribute('role','listbox');
    for(const item of items){
      const b=document.createElement('button');b.type='button';b.setAttribute('role','option');b.tabIndex=-1;b.textContent=item.value;if(item.hint)b.title=item.hint;
      // Keep focus in the input so the keyboard stays up while the tap lands.
      b.addEventListener('pointerdown',e=>e.preventDefault());
      b.addEventListener('click',()=>pick(input,item.value));
      list.append(b);
    }
    input.parentElement.append(list);
    const box=input.getBoundingClientRect(),height=list.offsetHeight,below=box.bottom+4+height<=(window.visualViewport?.height||innerHeight)-8;
    list.style.left=box.left+'px';list.style.width=box.width+'px';list.style.top=(below?box.bottom+4:Math.max(8,box.top-height-4))+'px';
    input.setAttribute('aria-expanded','true');open={input,list,active:-1};
  }
  function keys(e){
    if(!open||open.input!==e.target)return;
    const options=[...open.list.children];
    if(e.key==='Escape'){close();return;}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open.active=(open.active+(e.key==='ArrowDown'?1:-1)+options.length)%options.length;options.forEach((o,i)=>o.classList.toggle('active',i===open.active));}
    if(e.key==='Enter'&&open.active>=0){e.preventDefault();pick(open.input,options[open.active].textContent);}
  }
  // `get(text)` returns strings or {value,hint}. `filter:true` narrows by what was typed;
  // lower `priority` ranks first. An input may have several sources.
  function attach(input,get,{priority=5,filter=true,key=''}={}){
    const sources=input._suggestSources||(input._suggestSources=[]);
    if(key){const i=sources.findIndex(s=>s.key===key);if(i>=0)sources.splice(i,1);}
    sources.push({get,priority,filter,key});
    if(input._suggestBound)return;input._suggestBound=true;
    input.setAttribute('autocomplete','off');input.setAttribute('aria-autocomplete','list');input.setAttribute('aria-expanded','false');
    input.addEventListener('focus',()=>show(input));input.addEventListener('input',()=>{if(document.activeElement===input)show(input);});
    input.addEventListener('blur',()=>{if(open?.input===input)close();});input.addEventListener('keydown',keys);
  }
  document.addEventListener('scroll',e=>{if(open&&!open.list.contains(e.target))close();},true);
  root.AssetSuggest={attach,close};
})(window);
