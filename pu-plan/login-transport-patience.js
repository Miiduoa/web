(()=>{
  const baseFetch=window.fetch.bind(window);
  const PRIMARY_HOST='hrrmkrayvrgnwcroyttp.supabase.co';
  const LOGIN_PATH=/\/functions\/v1\/(?:pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;
  const PRIMARY_LOGIN_TIMEOUT_MS=5500;

  function urlOf(input){
    try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}
  }
  function actionOf(options){
    if(typeof options?.body!=='string')return'';
    try{return String(JSON.parse(options.body)?.action||'')}catch{return''}
  }

  window.fetch=async function noluLoginTransportPatience(input,options={}){
    const url=urlOf(input);
    if(!url||url.hostname!==PRIMARY_HOST||!LOGIN_PATH.test(url.pathname)||actionOf(options)!=='login'){
      return baseFetch(input,options);
    }

    // Normal app requests use the HA layer's short circuit-breaker timeout. Login
    // is allowed a bounded grace window because a recovering Postgres pool can be
    // healthy but take longer than 1.8 seconds to answer. We do not retry here and
    // we never alter HTTP responses: 401/429/500 still propagate unchanged.
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),PRIMARY_LOGIN_TIMEOUT_MS);
    try{
      const {signal:_ignored,...rest}=options||{};
      return await baseFetch(input,{...rest,signal:ctrl.signal,cache:'no-store'});
    }finally{
      clearTimeout(timer);
    }
  };

  window.NOLU_LOGIN_TRANSPORT={
    version:'20260911-login-patience1',
    primaryLoginTimeoutMs:PRIMARY_LOGIN_TIMEOUT_MS
  };
})();
