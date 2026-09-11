(()=>{
  const baseFetch=window.fetch.bind(window);
  const LOGIN_HOST_TIMEOUTS=new Map([
    ['hrrmkrayvrgnwcroyttp.supabase.co',5000],
    ['ltfurqaspqsvswmebyzw.supabase.co',6500]
  ]);
  const LOGIN_PATH=/\/functions\/v1\/(?:nolu-browser-gateway-v1|pu-plan-api|pu-plan-api-v8|pu-plan-api-v6|pu-plan-core-v1)$/;
  const DEADLINE_FIELD='__noluLoginDeadline';

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
    if(options?.signal?.aborted)throw new DOMException('Aborted','AbortError');

    // Give each region enough time for PBKDF2 / database recovery, but never let
    // one hop overrun the whole-login deadline established by login-failover-budget.
    const deadline=Number(options?.[DEADLINE_FIELD]||0);
    const remaining=deadline>0?deadline-Date.now():Infinity;
    if(Number.isFinite(remaining)&&remaining<=0)throw new DOMException('Aborted','AbortError');
    const effectiveTimeoutMs=Math.max(1,Math.min(timeoutMs,Number.isFinite(remaining)?remaining:timeoutMs));

    const ctrl=new AbortController();
    const timer=setTimeout(()=>ctrl.abort(),effectiveTimeoutMs);
    try{
      const rest={...(options||{})};
      delete rest.signal;
      delete rest[DEADLINE_FIELD];
      return await baseFetch(input,{...rest,signal:ctrl.signal,cache:'no-store'});
    }finally{
      clearTimeout(timer);
    }
  };

  window.NOLU_LOGIN_TRANSPORT={
    version:'20260911-login-patience3',
    primaryLoginTimeoutMs:5000,
    standbyLoginTimeoutMs:6500,
    deadlineAware:true
  };
})();
