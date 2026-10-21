(() => {
  const KEY_URL = 'jcp_assethub_api_url';
  const KEY_TOKEN = 'jcp_assethub_token';
  const KEY_OVERRIDE = 'jcp_assethub_api_override';
  let lastTiming = null;

  function getUrl(){
    const configured=String(window.ASSETHUB_CONFIG?.API_URL||'').trim();
    const stored=String(localStorage.getItem(KEY_URL)||'').trim();
    return localStorage.getItem(KEY_OVERRIDE)==='1' ? (stored||configured) : (configured||stored);
  }
  function setUrl(url){ localStorage.setItem(KEY_URL, String(url || '').trim()); localStorage.setItem(KEY_OVERRIDE,'1'); }
  function getToken(){ return localStorage.getItem(KEY_TOKEN) || ''; }
  function setToken(token){ if(token) localStorage.setItem(KEY_TOKEN, token); else localStorage.removeItem(KEY_TOKEN); }

  function assertUrl(){
    const url = getUrl();
    if(!url) throw new Error('API_NOT_CONFIGURED');
    if(!/^https:\/\/script\.google\.com\/macros\/s\/.+\/exec/i.test(url)) throw new Error('INVALID_API_URL');
    return url;
  }

  async function parseResponse(response, action){
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); }
    catch {
      const hint = response.redirected ? ' The Apps Script deployment may be redirecting to a login/error page.' : '';
      throw new Error(`Invalid backend response for ${action}.${hint} ${text.slice(0,100)}`.trim());
    }
    if(!response.ok) throw new Error(data.error || `${action} failed with HTTP ${response.status}`);
    if(data.success === false) throw new Error(data.error || `${action} failed. Backend returned success:false; check deployment version.`);
    return data;
  }

  async function timedFetch(action, input, init){
    const start = performance.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(input, {...(init||{}), signal:controller.signal});
      const data = await parseResponse(response, action);
      lastTiming = {action, ms:Math.round(performance.now()-start), ok:true, at:Date.now(), transport:'fetch'};
      return data;
    } catch (err) {
      lastTiming = {action, ms:Math.round(performance.now()-start), ok:false, at:Date.now(), transport:'fetch'};
      if(err?.name==='AbortError') throw new Error('REQUEST_TIMEOUT');
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  function addFormField(form, name, value){
    const str = typeof value === 'string' ? value : String(value ?? '');
    let el;
    // Textareas are much more reliable than giant hidden-input values for OCR image payloads.
    if(str.length > 50000){
      el = document.createElement('textarea');
      el.style.display = 'none';
      el.value = str;
    }else{
      el = document.createElement('input');
      el.type = 'hidden';
      el.value = str;
    }
    el.name = name;
    form.appendChild(el);
  }

  function postViaIframe(action, params = {}, {publicCall=false, requestId=''} = {}){
    const start = performance.now();
    const apiUrl = assertUrl();
    const id = requestId || params.request_id || `jcp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return new Promise((resolve,reject)=>{
      const frameName = `jcp_api_${id.replace(/[^a-z0-9_-]/gi,'')}`;
      const iframe = document.createElement('iframe');
      iframe.name = frameName;
      iframe.title = 'AssetHub background request';
      iframe.setAttribute('aria-hidden','true');
      iframe.tabIndex = -1;
      iframe.style.cssText = 'display:none!important;width:0;height:0;border:0;';

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = apiUrl;
      form.target = frameName;
      form.enctype = 'application/x-www-form-urlencoded';
      form.acceptCharset = 'UTF-8';
      form.style.display = 'none';

      addFormField(form,'action',action);
      addFormField(form,'transport','iframe');
      addFormField(form,'request_id',id);
      addFormField(form,'reply_origin',location.origin);
      if(!publicCall && getToken()) addFormField(form,'token',getToken());
      Object.entries(params).forEach(([k,v])=>{
        if(k !== 'request_id' && v !== undefined && v !== null) addFormField(form,k,v);
      });

      let settled = false;
      const clean = ()=>{
        window.removeEventListener('message',onMessage);
        clearTimeout(timer);
        setTimeout(()=>{ form.remove(); iframe.remove(); },0);
      };
      const fail = err=>{
        if(settled)return; settled=true; clean();
        lastTiming = {action, ms:Math.round(performance.now()-start), ok:false, at:Date.now(), transport:'iframe'};
        reject(err instanceof Error ? err : new Error(String(err||'POST transport failed')));
      };
      const onMessage = event=>{
        const msg = event?.data;
        if(!msg || msg.__jcpAssetHubReply !== true || msg.request_id !== id) return;
        // Replies should come from Apps Script/Google-hosted HTML. Ignore unrelated page messages.
        if(event.origin){
          let host=''; try{host=new URL(event.origin).hostname;}catch{}
          if(host && !/\.googleusercontent\.com$/.test(host) && event.origin!=='https://script.google.com') return;
        }
        if(settled)return; settled=true; clean();
        const data = msg.data || {};
        lastTiming = {action, ms:Math.round(performance.now()-start), ok:data.success!==false, at:Date.now(), transport:'iframe'};
        if(data.success === false) reject(new Error(data.error || `${action} failed.`));
        else resolve(data);
      };
      window.addEventListener('message',onMessage);
      const timer=setTimeout(()=>fail(new Error('REQUEST_TIMEOUT')),45000);
      document.body.appendChild(iframe);
      document.body.appendChild(form);
      try{ form.submit(); }catch(err){ fail(err); }
    });
  }

  async function get(action, params = {}, {publicCall=false} = {}){
    const url = new URL(assertUrl());
    url.searchParams.set('action', action);
    url.searchParams.set('_t', Date.now());
    if(!publicCall && getToken()) url.searchParams.set('token', getToken());
    Object.entries(params).forEach(([k,v]) => {
      if(v !== undefined && v !== null && String(v) !== '') url.searchParams.set(k, String(v));
    });
    return timedFetch(action, url.toString(), {cache:'no-store'});
  }

  async function post(action, params = {}, {publicCall=false} = {}){
    // Cross-origin POST redirects from Apps Script can fail on mobile browsers even while GET works.
    // A normal HTML form submission inside a hidden iframe avoids CORS while still returning data
    // securely to this page through postMessage. Use it consistently for all write/OCR/login actions.
    return postViaIframe(action, params, {publicCall});
  }

  function getLastTiming(){ return lastTiming ? {...lastTiming} : null; }

  window.AssetAPI = {getUrl,setUrl,getToken,setToken,get,post,getLastTiming};
})();
