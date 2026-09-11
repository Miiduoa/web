(()=>{
  const baseFetch=window.fetch.bind(window);
  const NOLU_HOSTS=new Set([
    'hrrmkrayvrgnwcroyttp.supabase.co',
    'ltfurqaspqsvswmebyzw.supabase.co'
  ]);
  const LOGIN_PATH=/\/functions\/v1\/(?:nolu-browser-gateway-v1|pu-plan-api|pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;
  const OVERALL_LOGIN_TIMEOUT_MS=14000;

  function requestUrl(input){
    try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}
  }
  function actionOf(options){
    if(typeof options?.body!=='string')return'';
    try{return String(JSON.parse(options.body)?.action||'')}catch{return''}
  }

  window.fetch=async function noluLoginFailoverBudget(input,options={}){
    const url=requestUrl(input);
    if(!url||!NOLU_HOSTS.has(url.hostname)||!LOGIN_PATH.test(url.pathname)||actionOf(options)!=='login'){
      return baseFetch(input,options);
    }
    if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError');

    // cloud.js historically gives the complete call about 6.5 seconds. That is
    // shorter than a bounded Mumbai attempt plus a real Tokyo attempt. Replace
    // that outer signal only for login so each regional hop gets a fair chance;
    // lower transport wrappers still cap every individual hop.
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),OVERALL_LOGIN_TIMEOUT_MS);
    try{
      const {signal:_ignored,...rest}=options||{};
      return await baseFetch(input,{...rest,signal:ctrl.signal,cache:'no-store'});
    }finally{
      clearTimeout(timer);
    }
  };

  window.NOLU_LOGIN_FAILOVER_BUDGET={
    version:'20260911-login-budget2',
    overallLoginTimeoutMs:OVERALL_LOGIN_TIMEOUT_MS
  };
})();
