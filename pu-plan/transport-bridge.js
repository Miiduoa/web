const LEGACY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v7';
const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v7';
const V6='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const CORE='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const CANDIDATES=[PRIMARY,STANDBY,V6,CORE,LEGACY];
const baseFetch=window.fetch.bind(window);
const BASE_COOLDOWN=15000;
const MAX_COOLDOWN=60000;
const PORTABLE_KEY='puplan_portable_session_v1';
const state={active:'',lastError:'',lastSuccessAt:0,endpoints:{}};

function health(endpoint){if(!state.endpoints[endpoint])state.endpoints[endpoint]={failures:0,openUntil:0,lastFailureAt:0,lastSuccessAt:0,lastError:''};return state.endpoints[endpoint]}
function isOpen(endpoint,at=Date.now()){return health(endpoint).openUntil>at}
function success(endpoint){const h=health(endpoint);h.failures=0;h.openUntil=0;h.lastSuccessAt=Date.now();h.lastError='';state.active=endpoint;state.lastSuccessAt=h.lastSuccessAt;state.lastError=''}
function failure(endpoint,error){const h=health(endpoint);h.failures=Math.min(8,(h.failures||0)+1);h.lastFailureAt=Date.now();h.lastError=String(error?.message||error||'transport unavailable');h.openUntil=Date.now()+Math.min(MAX_COOLDOWN,BASE_COOLDOWN*Math.pow(2,Math.max(0,h.failures-1)));state.lastError=h.lastError}
function bodyOf(options){try{return typeof options?.body==='string'?JSON.parse(options.body):{}}catch{return{}}}
function hasAuth(options){try{return new Headers(options?.headers||{}).has('Authorization')}catch{return false}}
function authTokenFor(endpoint){const primary=localStorage.getItem('puplan_session')||'',portable=localStorage.getItem(PORTABLE_KEY)||'';return endpoint===PRIMARY||endpoint===STANDBY?portable||primary:primary}
function freshOptions(endpoint,options={}){
  if(!hasAuth(options))return options;const value=authTokenFor(endpoint);if(!value)return options;
  const headers=new Headers(options.headers||{});headers.set('Authorization',`Bearer ${value}`);return {...options,headers};
}
function ordered(action=''){
  const prefer=localStorage.getItem('nolu_preferred_cloud_v1')==='standby';const cloud=prefer?[STANDBY,PRIMARY]:[PRIMARY,STANDBY];
  return [...cloud,V6,CORE,LEGACY].filter((endpoint,index,array)=>array.indexOf(endpoint)===index&&!(endpoint===STANDBY&&(action==='signup'||action==='recover_password')));
}
function storeTokens(response,endpoint){
  if(!response?.ok)return Promise.resolve();
  return response.clone().json().then(data=>{
    const portable=typeof data?.portable_token==='string'?data.portable_token:endpoint===STANDBY&&typeof data?.token==='string'?data.token:'';
    if(portable&&portable.split('.').length===2)localStorage.setItem(PORTABLE_KEY,portable);
    if(endpoint!==STANDBY&&typeof data?.token==='string'&&data.token.split('.').length===2)localStorage.setItem('puplan_session',data.token);
  }).catch(()=>{});
}
async function timed(url,options={},ms=1800){
  const ctrl=new AbortController(),outer=options.signal,t=setTimeout(()=>ctrl.abort(),ms),abort=()=>ctrl.abort();if(outer)outer.addEventListener('abort',abort,{once:true});
  try{return await baseFetch(url,{...freshOptions(url,options),signal:ctrl.signal,cache:'no-store'})}finally{clearTimeout(t);if(outer)outer.removeEventListener('abort',abort)}
}

window.fetch=async function noluLegacyFailover(input,options={}){
  const url=typeof input==='string'?input:input?.url;if(String(url)!==LEGACY)return baseFetch(input,options);
  const action=String(bodyOf(options)?.action||'');let lastResponse=null,lastError=null,standby401=false;
  const candidates=ordered(action).filter(endpoint=>!isOpen(endpoint));if(!candidates.length)throw new TypeError('Nolu transport temporarily unavailable');
  for(const endpoint of candidates){
    if(options.signal?.aborted)break;
    try{
      const response=await timed(endpoint,options);lastResponse=response;
      if(endpoint===STANDBY&&response.status===401&&hasAuth(options)){standby401=true;failure(endpoint,new Error('standby authorization unavailable'));continue}
      if(response.status<500){success(endpoint);if(endpoint===STANDBY)localStorage.setItem('nolu_preferred_cloud_v1','standby');await storeTokens(response,endpoint);return response}
      lastError=new Error(`HTTP ${response.status}`);failure(endpoint,lastError);
    }catch(error){lastError=error;failure(endpoint,error)}
  }
  if(standby401&&hasAuth(options))return new Response(JSON.stringify({error:'STANDBY_AUTH_UNCERTAIN',message:'主雲端暫時無法驗證登入狀態'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  if(lastResponse)return lastResponse;throw lastError||new TypeError('Nolu transport unavailable');
};

window.NOLU_TRANSPORT={state,candidates:[...CANDIDATES],isOpen};
