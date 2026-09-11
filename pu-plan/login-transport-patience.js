(()=>{
  const baseFetch=window.fetch.bind(window);
  const PRIMARY_HOST='hrrmkrayvrgnwcroyttp.supabase.co';
  const STANDBY_HOST='ltfurqaspqsvswmebyzw.supabase.co';
  const LOGIN_PATH=/\/functions\/v1\/(?:pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;
  const V8_PATH=/\/functions\/v1\/pu-plan-api-v8$/;
  const PRIMARY_LOGIN_TIMEOUT_MS=5500;
  const STANDBY_LOGIN_TIMEOUT_MS=5500;
  const BOOTSTRAP_TIMEOUT_MS=4500;

  function urlOf(input){
    try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}
  }
  function actionOf(options){
    if(typeof options?.body!=='string')return'';
    try{return String(JSON.parse(options.body)?.action||'')}catch{return''}
  }
  async function boundedFetch(input,options,timeout){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeout);
    try{
      const {signal:_ignored,...rest}=options||{};
      return await baseFetch(input,{...rest,signal:ctrl.signal,cache:'no-store'});
    }finally{
      clearTimeout(timer);
    }
  }

  window.fetch=async function noluLoginTransportPatience(input,options={}){
    const url=urlOf(input),action=actionOf(options);

    // The HA layer normally uses a very short transport timeout. On iPhone/4G a
    // healthy edge function can need a few seconds after a cold start. Give only
    // authenticated startup hydration a bounded grace window so a valid saved
    // session is not mistaken for an offline/guest state.
    if(url&&V8_PATH.test(url.pathname)&&action==='bootstrap'&&(url.hostname===PRIMARY_HOST||url.hostname===STANDBY_HOST)){
      return boundedFetch(input,options,BOOTSTRAP_TIMEOUT_MS);
    }

    // Tokyo is the real regional failover for login. It needs the same bounded
    // cold-start allowance as Mumbai; otherwise the HA layer aborts it at 1.8 s.
    if(url&&url.hostname===STANDBY_HOST&&LOGIN_PATH.test(url.pathname)&&action==='login'){
      return boundedFetch(input,options,STANDBY_LOGIN_TIMEOUT_MS);
    }

    if(!url||url.hostname!==PRIMARY_HOST||!LOGIN_PATH.test(url.pathname)||actionOf(options)!=='login'){
      return baseFetch(input,options);
    }

    // Authoritative Mumbai login gets a bounded grace window while its Postgres
    // pool or edge isolate wakes up. HTTP errors still propagate unchanged and no
    // credentials are cached or bypassed here.
    return boundedFetch(input,options,PRIMARY_LOGIN_TIMEOUT_MS);
  };

  window.NOLU_LOGIN_TRANSPORT={
    version:'20260911-cloud-reconnect1',
    primaryLoginTimeoutMs:PRIMARY_LOGIN_TIMEOUT_MS,
    standbyLoginTimeoutMs:STANDBY_LOGIN_TIMEOUT_MS,
    bootstrapTimeoutMs:BOOTSTRAP_TIMEOUT_MS
  };
})();
