const LEGACY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const FALLBACK='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const CANDIDATES=[PRIMARY,FALLBACK,LEGACY];
const baseFetch=window.fetch.bind(window);
const state={active:'',lastError:'',lastSuccessAt:0};

async function timed(url,options={},ms=2800){
  const ctrl=new AbortController(),outer=options.signal,t=setTimeout(()=>ctrl.abort(),ms),abort=()=>ctrl.abort();
  if(outer)outer.addEventListener('abort',abort,{once:true});
  try{return await baseFetch(url,{...options,signal:ctrl.signal,cache:'no-store'})}
  finally{clearTimeout(t);if(outer)outer.removeEventListener('abort',abort)}
}

window.fetch=async function noluLegacyFailover(input,options={}){
  const url=typeof input==='string'?input:input?.url;
  if(String(url)!==LEGACY)return baseFetch(input,options);
  let lastResponse=null,lastError=null;
  for(const endpoint of CANDIDATES){
    if(options.signal?.aborted)break;
    try{
      const response=await timed(endpoint,options);lastResponse=response;
      if(response.status<500){state.active=endpoint;state.lastSuccessAt=Date.now();state.lastError='';return response}
      lastError=new Error(`HTTP ${response.status}`);
    }catch(error){lastError=error}
  }
  state.lastError=String(lastError||'transport unavailable');
  if(lastResponse)return lastResponse;
  throw lastError||new TypeError('Nolu transport unavailable');
};

window.NOLU_TRANSPORT={state,candidates:[...CANDIDATES]};
