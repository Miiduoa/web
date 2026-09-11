const LEGACY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const V6='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const CORE='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const CANDIDATES=[V6,CORE,LEGACY];
const baseFetch=window.fetch.bind(window);
const BASE_COOLDOWN=15000;
const MAX_COOLDOWN=60000;
const state={active:'',lastError:'',lastSuccessAt:0,endpoints:{}};

function health(endpoint){if(!state.endpoints[endpoint])state.endpoints[endpoint]={failures:0,openUntil:0,lastFailureAt:0,lastSuccessAt:0,lastError:''};return state.endpoints[endpoint]}
function isOpen(endpoint,at=Date.now()){return health(endpoint).openUntil>at}
function success(endpoint){const h=health(endpoint);h.failures=0;h.openUntil=0;h.lastSuccessAt=Date.now();h.lastError='';state.active=endpoint;state.lastSuccessAt=h.lastSuccessAt;state.lastError=''}
function failure(endpoint,error){const h=health(endpoint);h.failures=Math.min(8,(h.failures||0)+1);h.lastFailureAt=Date.now();h.lastError=String(error?.message||error||'transport unavailable');h.openUntil=Date.now()+Math.min(MAX_COOLDOWN,BASE_COOLDOWN*Math.pow(2,Math.max(0,h.failures-1)));state.lastError=h.lastError}
async function timed(url,options={},ms=2800){
  const ctrl=new AbortController(),outer=options.signal,t=setTimeout(()=>ctrl.abort(),ms),abort=()=>ctrl.abort();if(outer)outer.addEventListener('abort',abort,{once:true});
  try{return await baseFetch(url,{...options,signal:ctrl.signal,cache:'no-store'})}finally{clearTimeout(t);if(outer)outer.removeEventListener('abort',abort)}
}

window.fetch=async function noluLegacyFailover(input,options={}){
  const url=typeof input==='string'?input:input?.url;if(String(url)!==LEGACY)return baseFetch(input,options);
  let lastResponse=null,lastError=null;
  const candidates=CANDIDATES.filter(endpoint=>!isOpen(endpoint));if(!candidates.length)throw new TypeError('Nolu transport temporarily unavailable');
  for(const endpoint of candidates){
    if(options.signal?.aborted)break;
    try{
      const response=await timed(endpoint,options);lastResponse=response;
      if(response.status<500){success(endpoint);return response}
      lastError=new Error(`HTTP ${response.status}`);failure(endpoint,lastError);
    }catch(error){lastError=error;failure(endpoint,error)}
  }
  if(lastResponse)return lastResponse;throw lastError||new TypeError('Nolu transport unavailable');
};

window.NOLU_TRANSPORT={state,candidates:[...CANDIDATES],isOpen};
