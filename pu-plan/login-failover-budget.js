(()=>{
  const baseFetch=window.fetch.bind(window);
  const NOLU_HOSTS=new Set([
    'hrrmkrayvrgnwcroyttp.supabase.co',
    'ltfurqaspqsvswmebyzw.supabase.co'
  ]);
  const PRIMARY_HOST='hrrmkrayvrgnwcroyttp.supabase.co';
  const LOGIN_PATH=/\/functions\/v1\/(?:nolu-browser-gateway-v1|pu-plan-api|pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;
  const OVERALL_LOGIN_TIMEOUT_MS=14000;
  const DEADLINE_FIELD='__noluLoginDeadline';
  const PREFERRED_CLOUD_KEY='nolu_preferred_cloud_v1';

  function requestUrl(input){
    try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}
  }
  function actionOf(options){
    if(typeof options?.body!=='string')return'';
    try{return String(JSON.parse(options.body)?.action||'')}catch{return''}
  }
  function reopenPrimaryCircuit(){
    const resilience=window.NOLU_RESILIENCE;
    const endpoints=resilience?.state?.endpoints;
    if(!endpoints||typeof endpoints!=='object')return;
    for(const [endpoint,health] of Object.entries(endpoints)){
      try{
        if(new URL(endpoint).hostname!==PRIMARY_HOST||!health||typeof health!=='object')continue;
        // A password submit is an explicit user retry. Do not let an earlier
        // transient timeout/circuit-breaker decision prevent this new attempt
        // from actually probing the Mumbai authority again.
        health.openUntil=0;
      }catch{}
    }
  }

  window.fetch=async function noluLoginFailoverBudget(input,options={}){
    const url=requestUrl(input);
    if(!url||!NOLU_HOSTS.has(url.hostname)||!LOGIN_PATH.test(url.pathname)||actionOf(options)!=='login'){
      return baseFetch(input,options);
    }
    if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError');

    // A fresh password login must always ask the Mumbai authority first. Tokyo is
    // an outage fallback with an independently signed Session v4; allowing an old
    // standby preference to win here can leave the canonical session signed for
    // Tokyo and make primary-only/admin endpoints reject it as invalid.
    localStorage.setItem(PREFERRED_CLOUD_KEY,'primary');
    reopenPrimaryCircuit();

    // cloud.js historically gives the complete call about 6.5 seconds. That is
    // shorter than a bounded Mumbai attempt plus a real Tokyo attempt. Give the
    // complete failover chain 14 seconds and attach the absolute deadline as a
    // private RequestInit field. The per-hop wrapper consumes and strips that
    // field before the browser network layer sees it, so it cannot affect CORS.
    const deadline=Date.now()+OVERALL_LOGIN_TIMEOUT_MS;
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),OVERALL_LOGIN_TIMEOUT_MS);
    try{
      const {signal:_ignored,...rest}=options||{};
      return await baseFetch(input,{...rest,signal:ctrl.signal,cache:'no-store',[DEADLINE_FIELD]:deadline});
    }finally{
      clearTimeout(timer);
    }
  };

  window.NOLU_LOGIN_FAILOVER_BUDGET={
    version:'20260912-login-authority2',
    overallLoginTimeoutMs:OVERALL_LOGIN_TIMEOUT_MS,
    deadlineField:DEADLINE_FIELD
  };
})();
