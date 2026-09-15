(()=>{
  const baseFetch=window.fetch.bind(window);
  const NOLU_HOSTS=new Set([
    'hrrmkrayvrgnwcroyttp.supabase.co',
    'ltfurqaspqsvswmebyzw.supabase.co'
  ]);
  const PRIMARY_HOST='hrrmkrayvrgnwcroyttp.supabase.co';
  const PRIMARY_API='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v8';
  const STANDBY_API='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8';
  const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
  const STANDBY_SESSION_KEY='puplan_session_standby_v1';
  const LOGIN_PATH=/\/functions\/v1\/(?:nolu-browser-gateway-v1|pu-plan-api|pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;
  const OVERALL_LOGIN_TIMEOUT_MS=14000;
  const AUTH_REVALIDATE_TIMEOUT_MS=5500;
  const DEADLINE_FIELD='__noluLoginDeadline';
  const PREFERRED_CLOUD_KEY='nolu_preferred_cloud_v1';
  let revalidation=null;

  function requestUrl(input){
    try{return new URL(typeof input==='string'?input:input?.url||'',location.href)}catch{return null}
  }
  function actionOf(options){
    if(typeof options?.body!=='string')return'';
    try{return String(JSON.parse(options.body)?.action||'')}catch{return''}
  }
  function authHeaderOf(options){
    try{return new Headers(options?.headers||{}).get('Authorization')||''}catch{return''}
  }
  function bearerOf(authorization){return String(authorization||'').startsWith('Bearer ')?String(authorization).slice(7):''}
  function trace(type,details={}){window.NOLU_AUTH_TRACE?.record?.(type,details)}
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

  function uncertainResponse(kind='uncertain'){
    const message=kind==='valid'
      ?'登入狀態仍有效，雲端端點暫時不同步，已保留登入狀態，請再試一次'
      :'暫時無法確認登入狀態，已保留登入狀態，請稍後再試';
    return new Response(JSON.stringify({error:'AUTH_REVALIDATION_REQUIRED',message}),{
      status:503,
      headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
    });
  }

  function issuerCandidates(authorization){
    const token=bearerOf(authorization);
    if(!token)return[];
    const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'';
    const standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
    if(token===primary&&token!==standby)return[PRIMARY_API];
    if(token===standby&&token!==primary)return[STANDBY_API];
    const preferred=localStorage.getItem(PREFERRED_CLOUD_KEY)==='standby';
    return preferred?[STANDBY_API,PRIMARY_API]:[PRIMARY_API,STANDBY_API];
  }

  async function probeEndpoint(api,authorization){
    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),AUTH_REVALIDATE_TIMEOUT_MS);
    try{
      const res=await baseFetch(api,{
        method:'POST',
        headers:{'Content-Type':'application/json','Authorization':authorization},
        body:JSON.stringify({action:'bootstrap'}),
        signal:ctrl.signal,
        cache:'no-store'
      });
      if(res.status===401)return {status:'invalid',httpStatus:401,api};
      if(!res.ok)return {status:'uncertain',httpStatus:Number(res.status)||0,api};
      try{
        const data=await res.clone().json();
        if(data?.offline===true||!data?.profile?.id)return {status:'uncertain',httpStatus:200,api};
      }catch{return {status:'uncertain',httpStatus:200,api}}
      return {status:'valid',httpStatus:200,api};
    }catch(error){
      return {status:'uncertain',httpStatus:0,outcome:error?.name==='AbortError'?'timeout':'unreachable',api};
    }finally{
      clearTimeout(timer);
    }
  }

  async function probeSession(authorization){
    if(!authorization)return {status:'uncertain'};
    if(revalidation?.authorization===authorization)return revalidation.promise;

    const promise=(async()=>{
      const candidates=issuerCandidates(authorization);
      if(!candidates.length)return {status:'uncertain'};
      const results=await Promise.all(candidates.map(api=>probeEndpoint(api,authorization)));
      const valid=results.find(result=>result.status==='valid');
      if(valid)return {status:'valid',httpStatus:200,issuer:valid.api===STANDBY_API?'standby':'primary'};
      // A session is only proven invalid when every plausible issuer explicitly
      // rejects it. One 401 plus a timeout/5xx is an availability disagreement,
      // not proof that the user's credential should be destroyed locally.
      if(results.length&&results.every(result=>result.status==='invalid'))return {status:'invalid',httpStatus:401};
      const strongest=results.find(result=>result.httpStatus)||results[0]||{};
      return {status:'uncertain',httpStatus:Number(strongest.httpStatus)||0,outcome:strongest.outcome||''};
    })();

    revalidation={authorization,promise};
    promise.finally(()=>{if(revalidation?.promise===promise)revalidation=null});
    return promise;
  }

  async function protectAuthenticated401(input,options,response,url,action){
    if(response?.status!==401||!url||!NOLU_HOSTS.has(url.hostname)||!LOGIN_PATH.test(url.pathname)||action==='login')return response;
    const authorization=authHeaderOf(options);
    if(!authorization)return response;

    trace('auth-401-quorum',{action,status:'checking',httpStatus:401});
    const verdict=await probeSession(authorization);
    if(verdict.status==='invalid'){
      trace('auth-401-quorum',{action,status:'confirmed-invalid',httpStatus:401,outcome:'logout-allowed'});
      return response;
    }

    trace('auth-401-quorum',{
      action,
      status:verdict.status==='valid'?'session-valid':'auth-uncertain',
      httpStatus:Number(verdict.httpStatus)||0,
      outcome:'session-preserved'
    });
    return uncertainResponse(verdict.status);
  }

  window.fetch=async function noluLoginFailoverBudget(input,options={}){
    const url=requestUrl(input);
    const action=actionOf(options);
    const isNoluCore=!!url&&NOLU_HOSTS.has(url.hostname)&&LOGIN_PATH.test(url.pathname);

    if(isNoluCore&&action==='login'){
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
    }

    const response=await baseFetch(input,options);
    return protectAuthenticated401(input,options,response,url,action);
  };

  window.NOLU_LOGIN_FAILOVER_BUDGET={
    version:'20260915-login-auth-quorum4',
    overallLoginTimeoutMs:OVERALL_LOGIN_TIMEOUT_MS,
    authRevalidateTimeoutMs:AUTH_REVALIDATE_TIMEOUT_MS,
    deadlineField:DEADLINE_FIELD,
    auth401Quorum:true,
    issuerAware401Revalidation:true
  };
})();