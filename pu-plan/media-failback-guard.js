(()=>{
  const STANDBY_REF='ltfurqaspqsvswmebyzw';
  const FAILBACK_PATH='/functions/v1/pu-plan-failback-v1';
  const MEDIA_SYNC=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-media-failback-v1`;
  const baseFetch=window.fetch.bind(window);
  let inFlight=null;

  function isReconcile(input,init){
    try{
      const raw=typeof input==='string'||input instanceof URL?String(input):input?.url||'';
      const url=new URL(raw,location.href);
      if(url.hostname!==`${STANDBY_REF}.supabase.co`||url.pathname!==FAILBACK_PATH)return false;
      if(String(init?.method||input?.method||'GET').toUpperCase()!=='POST')return false;
      const body=typeof init?.body==='string'?init.body:'';
      return JSON.parse(body||'{}')?.action==='reconcile';
    }catch{return false}
  }

  function authHeader(input,init){
    const direct=new Headers(init?.headers||{}).get('Authorization');
    if(direct)return direct;
    try{return input instanceof Request?input.headers.get('Authorization')||'':''}catch{return''}
  }

  async function syncMedia(auth){
    let offset=0,passes=0,total=0;
    while(passes<20){
      passes++;
      const response=await baseFetch(MEDIA_SYNC,{method:'POST',headers:{'Content-Type':'application/json','Authorization':auth},body:JSON.stringify({offset,limit:2}),cache:'no-store'});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||data.ok!==true){
        const error=new Error(data.message||`媒體回灌失敗 (${response.status})`);
        error.status=response.status||503;error.code=data.error||'MEDIA_FAILBACK_FAILED';throw error;
      }
      total+=Number(data.transferred||0);
      if(data.complete===true||data.next_offset==null)return {ok:true,total};
      offset=Number(data.next_offset);if(!Number.isFinite(offset)||offset<0)throw new Error('媒體回灌游標無效');
    }
    const error=new Error('媒體數量過多，請稍後再試');error.status=503;error.code='MEDIA_FAILBACK_INCOMPLETE';throw error;
  }

  window.fetch=async function noluMediaFailbackGuard(input,init={}){
    if(!isReconcile(input,init))return baseFetch(input,init);
    const auth=authHeader(input,init);
    if(!auth)return baseFetch(input,init);
    try{
      if(!inFlight)inFlight=syncMedia(auth).finally(()=>{inFlight=null});
      const result=await inFlight;
      document.dispatchEvent(new CustomEvent('nolu:media-failback-ready',{detail:{objects:result.total,at:Date.now()}}));
      return baseFetch(input,init);
    }catch(error){
      const status=Number(error?.status)||503;
      return new Response(JSON.stringify({error:error?.code||'MEDIA_FAILBACK_FAILED',message:String(error?.message||'媒體回灌暫時無法完成')}),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
    }
  };

  window.NOLU_MEDIA_FAILBACK={version:'20260912-media-failback1',sync:syncMedia};
})();
