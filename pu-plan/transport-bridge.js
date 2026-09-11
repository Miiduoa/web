const LEGACY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api';
const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v8';
const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8';
const V6='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const CORE='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const CANDIDATES=[PRIMARY,STANDBY,V6,CORE,LEGACY];
const baseFetch=window.fetch.bind(window);
const BASE_COOLDOWN=15000;
const MAX_COOLDOWN=60000;
const PORTABLE_KEY='puplan_portable_session_v1';
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const state={active:'',lastError:'',lastSuccessAt:0,endpoints:{}};

function health(endpoint){if(!state.endpoints[endpoint])state.endpoints[endpoint]={failures:0,openUntil:0,lastFailureAt:0,lastSuccessAt:0,lastError:''};return state.endpoints[endpoint]}
function isOpen(endpoint,at=Date.now()){return health(endpoint).openUntil>at}
function success(endpoint){const h=health(endpoint);h.failures=0;h.openUntil=0;h.lastSuccessAt=Date.now();h.lastError='';state.active=endpoint;state.lastSuccessAt=h.lastSuccessAt;state.lastError=''}
function failure(endpoint,error){const h=health(endpoint);h.failures=Math.min(8,(h.failures||0)+1);h.lastFailureAt=Date.now();h.lastError=String(error?.message||error||'transport unavailable');h.openUntil=Date.now()+Math.min(MAX_COOLDOWN,BASE_COOLDOWN*Math.pow(2,Math.max(0,h.failures-1)));state.lastError=h.lastError}
function bodyOf(options){try{return typeof options?.body==='string'?JSON.parse(options.body):{}}catch{return{}}}
function hasAuth(options){try{return new Headers(options?.headers||{}).has('Authorization')}catch{return false}}
function parseUid(raw){try{const [p,s,...rest]=String(raw||'').split('.');if(!p||!s||rest.length)return'';const n=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');const d=JSON.parse(decodeURIComponent(escape(atob(n))));return d?.v===4&&d?.uid&&d?.exp*1000>Date.now()?String(d.uid):''}catch{return''}}
function legacyPrimarySession(){const current=localStorage.getItem('puplan_session')||'',uid=parseUid(current);if(!uid||localStorage.getItem('nolu_preferred_cloud_v1')==='standby')return'';const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'',standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';if(parseUid(primary)===uid)return primary;if(parseUid(standby)===uid||primary||standby)return'';localStorage.setItem(PRIMARY_SESSION_KEY,current);return current}
function tierSession(endpoint){const current=localStorage.getItem('puplan_session')||'',uid=parseUid(current);if(!uid)return'';const key=endpoint===STANDBY?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY,specific=localStorage.getItem(key)||'';if(parseUid(specific)===uid)return specific;return endpoint===STANDBY?'':legacyPrimarySession()}
function authTokenFor(endpoint){return endpoint===STANDBY?tierSession(STANDBY):endpoint===PRIMARY||endpoint===V6||endpoint===CORE||endpoint===LEGACY?tierSession(PRIMARY):localStorage.getItem('puplan_session')||''}
function freshOptions(endpoint,options={}){
  if(!hasAuth(options))return options;const value=authTokenFor(endpoint);if(!value)return options;
  const headers=new Headers(options.headers||{});headers.set('Authorization',`Bearer ${value}`);return {...options,headers};
}
function ordered(action=''){
  const prefer=localStorage.getItem('nolu_preferred_cloud_v1')==='standby';const cloud=prefer?[STANDBY,PRIMARY]:[PRIMARY,STANDBY];
  return [...cloud,V6,CORE,LEGACY].filter((endpoint,index,array)=>array.indexOf(endpoint)===index&&!(endpoint===STANDBY&&['signup','recover_password','change_password','rotate_recovery_code','search_people','send_request','accept_request','decline_request','remove_friend','create_meetup','respond_meetup','cancel_meetup','social'].includes(action)));
}
function storeTokens(response,endpoint){
  if(!response?.ok)return Promise.resolve();
  return response.clone().json().then(data=>{
    const portable=typeof data?.portable_token==='string'?data.portable_token:'';
    if(portable&&portable.split('.').length===3)localStorage.setItem(PORTABLE_KEY,portable);
    const session=typeof data?.token==='string'&&data.token.split('.').length===2?data.token:'';
    if(session)localStorage.setItem(endpoint===STANDBY?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY,session);
  }).catch(()=>{});
}
async function timed(url,options={},ms=1800){
  const ctrl=new AbortController(),outer=options.signal,t=setTimeout(()=>ctrl.abort(),ms),abort=()=>ctrl.abort();if(outer)outer.addEventListener('abort',abort,{once:true});
  try{return await baseFetch(url,{...freshOptions(url,options),signal:ctrl.signal,cache:'no-store'})}finally{clearTimeout(t);if(outer)outer.removeEventListener('abort',abort)}
}

window.fetch=async function noluLegacyFailover(input,options={}){
  const url=typeof input==='string'?input:input?.url;if(String(url)!==LEGACY)return baseFetch(input,options);
  const action=String(bodyOf(options)?.action||'');let lastResponse=null,lastError=null,tierAuth401=false;
  const candidates=ordered(action).filter(endpoint=>!isOpen(endpoint));if(!candidates.length)throw new TypeError('Nolu transport temporarily unavailable');
  for(const endpoint of candidates){
    if(options.signal?.aborted)break;
    if(hasAuth(options)&&!authTokenFor(endpoint))continue;
    try{
      const response=await timed(endpoint,options);lastResponse=response;
      if((endpoint===PRIMARY||endpoint===STANDBY)&&response.status===401&&hasAuth(options)){tierAuth401=true;lastError=new Error('tier-local authorization unavailable');continue}
      if(response.status<500){success(endpoint);if(endpoint===STANDBY)localStorage.setItem('nolu_preferred_cloud_v1','standby');await storeTokens(response,endpoint);return response}
      lastError=new Error(`HTTP ${response.status}`);failure(endpoint,lastError);
    }catch(error){lastError=error;failure(endpoint,error)}
  }
  if(tierAuth401&&hasAuth(options))return new Response(JSON.stringify({error:'TIER_AUTH_UNCERTAIN',message:'雲端暫時無法驗證這個裝置的登入狀態'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  if(lastResponse)return lastResponse;throw lastError||new TypeError('Nolu transport unavailable');
};

window.NOLU_TRANSPORT={state,candidates:[...CANDIDATES],isOpen};
