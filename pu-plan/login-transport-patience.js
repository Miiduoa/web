(()=>{
  const baseFetch=window.fetch.bind(window);
  const LOGIN_HOST_TIMEOUTS=new Map([
    ['hrrmkrayvrgnwcroyttp.supabase.co',5000],
    ['ltfurqaspqsvswmebyzw.supabase.co',6500]
  ]);
  const LOGIN_PATH=/\/functions\/v1\/(?:nolu-browser-gateway-v1|pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;

  function urlOf(input){
    try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}
  }
  function actionOf(options){
    if(typeof options?.body!=='string')return'';
    try{return String(JSON.parse(options.body)?.action||'')}catch{return''}
  }

  window.fetch=async function noluLoginTransportPatience(input,options={}){
    const url=urlOf(input);
    const timeoutMs=url?LOGIN_HOST_TIMEOUTS.get(url.hostname):0;
    if(!url||!timeoutMs||!LOGIN_PATH.test(url.pathname)||actionOf(options)!=='login'){
      return baseFetch(input,options);
    }

    // Login needs enough per-hop time for PBKDF2 and a recovering database in
    // either region. This layer replaces the HA router's short hop signal only;
    // login-failover-budget.js separately caps the complete two-region attempt.
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),timeoutMs);
    try{
      const {signal:_ignored,...rest}=options||{};
      return await baseFetch(input,{...rest,signal:ctrl.signal,cache:'no-store'});
    }finally{
      clearTimeout(timer);
    }
  };

  window.NOLU_LOGIN_TRANSPORT={
    version:'20260911-login-patience2',
    primaryLoginTimeoutMs:5000,
    standbyLoginTimeoutMs:6500
  };
})();
