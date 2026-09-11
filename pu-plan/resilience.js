import {cleanAvatar} from './core/state.js';

const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v8';
const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8';
const COMPAT_V6='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const COMPAT_CORE='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const CORE_APIS=[PRIMARY,STANDBY,COMPAT_V6,COMPAT_CORE];
const nativeFetch=window.fetch.bind(window);
const VERSION='20260911-ha3-session-split';
const BASE_COOLDOWN=15000;
const MAX_COOLDOWN=60000;
const PREFERRED_KEY='nolu_preferred_cloud_v1';
const STANDBY_SESSION_KEY='puplan_standby_session_v2';
const NO_STANDBY_ACTIONS=new Set(['signup','recover_password','change_password','rotate_recovery_code','search_people','send_request','accept_request','decline_request','remove_friend','create_meetup','respond_meetup','cancel_meetup']);
const state={mode:'online',tier:'primary',activeApi:'',lastOnlineAt:0,lastError:'',version:VERSION,endpoints:{}};
let requestSequence=0,newestOfflineSequence=0;

function now(){return Date.now()}
function safeJson(raw,fallback=null){try{return JSON.parse(raw)}catch{return fallback}}
function sameJson(a,b){try{return JSON.stringify(a)===JSON.stringify(b)}catch{return false}}
function cleanText(v,max=120){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max)}
function ownerId(){return cleanText(localStorage.getItem('puplan_course_owner'),100)}
function token(){return localStorage.getItem('puplan_session')||''}
function standbyToken(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}
function pendingKey(uid){return `nolu_pending_mutations_v1:${uid}`}
function snapshotKey(uid){return `nolu_account_snapshot_v1:${uid}`}
function parseTokenUid(raw=token()){
  try{
    const [p,s,...extra]=String(raw).split('.');if(!p||!s||extra.length)return null;
    const b64=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const payload=JSON.parse(decodeURIComponent(escape(atob(b64))));
    if(payload?.v!==4||!payload?.uid||!payload?.exp||payload.exp*1000<=Date.now())return null;
    return String(payload.uid);
  }catch{return null}
}
function currentUid(){const primary=parseTokenUid(token()),standby=parseTokenUid(standbyToken());if(primary&&standby&&primary!==standby)return'';const uid=preferredCloud()==='standby'?(standby||primary):(primary||standby);const owner=ownerId();return uid&&owner&&uid===owner?uid:''}
function localProfile(uid=currentUid()){
  if(!uid)return null;
  return {id:uid,display_name:cleanText(localStorage.getItem('puplan_name')||'使用者',80)||'使用者',username:cleanText(localStorage.getItem('puplan_username')||'',24),avatar_data:cleanAvatar(localStorage.getItem('puplan_avatar')||''),bio:cleanText(localStorage.getItem('puplan_bio')||'',120),discoverable:localStorage.getItem('puplan_discoverable')!=='0',role:'user',profile_visibility:'public'};
}
function localCourses(){const v=safeJson(localStorage.getItem('puplan_courses'),[]);return Array.isArray(v)?v.slice(0,80):[]}
function localMeta(){const v=safeJson(localStorage.getItem('puplan_schedule_meta'),{});return v&&typeof v==='object'?v:{}}
function readPending(uid=currentUid()){const v=safeJson(localStorage.getItem(pendingKey(uid)),{});return v&&typeof v==='object'?v:{}}
function writePending(uid,value){if(uid)localStorage.setItem(pendingKey(uid),JSON.stringify(value||{}))}
function snapshot(uid=currentUid(),profile=localProfile(uid)){
  if(!uid||!profile)return;
  const safeProfile={...profile,avatar_data:cleanAvatar(profile?.avatar_data||'')};
  const data={uid,profile:safeProfile,courses:localCourses(),meta:localMeta(),savedAt:now()};
  try{localStorage.setItem(snapshotKey(uid),JSON.stringify(data))}catch{}
}
function queueMutation(action,payload){
  const uid=currentUid();if(!uid)return false;
  const q=readPending(uid);
  if(action==='save_schedule')q.schedule={courses:Array.isArray(payload?.courses)?payload.courses.slice(0,80):[],changedAt:now()};
  if(action==='update_profile'){
    const safePayload={...payload};
    if(Object.prototype.hasOwnProperty.call(safePayload,'avatar_data'))safePayload.avatar_data=cleanAvatar(safePayload.avatar_data||'');
    q.profile={payload:safePayload,changedAt:now()};
  }
  writePending(uid,q);snapshot(uid);setMode('offline');return true;
}
function preferredCloud(){return localStorage.getItem(PREFERRED_KEY)==='standby'?'standby':'primary'}
function setPreferredCloud(value){if(value==='standby'||value==='primary')localStorage.setItem(PREFERRED_KEY,value)}
function setMode(mode,api=''){
  state.mode=mode;if(api){state.activeApi=api;state.tier=api===STANDBY?'standby':'primary'}if(mode==='online'){state.lastOnlineAt=now();state.lastError=''}
  document.documentElement.dataset.noluConnectivity=mode;document.documentElement.dataset.noluCloudTier=state.tier;
  let banner=document.querySelector('#noluResilienceBanner');
  if(mode==='offline'){
    if(!banner){banner=document.createElement('div');banner.id='noluResilienceBanner';banner.style.cssText='position:fixed;left:10px;right:10px;top:max(10px,env(safe-area-inset-top));z-index:99999;padding:10px 12px;border-radius:14px;background:#171717;color:#fff;font:700 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px #0003;text-align:center';document.body.appendChild(banner)}
    banner.textContent='離線保護模式｜資料已安全留在此裝置，雲端恢復後會自動補同步';
  }else banner?.remove();
  const cloud=document.querySelector('#cloudState');if(cloud&&mode==='offline')cloud.innerHTML='離線保護模式<br><b>本機資料可繼續使用</b><br><span>雲端恢復後會自動補同步。</span>';
  document.dispatchEvent(new CustomEvent('nolu:connectivity',{detail:{...state}}));
}
function endpointState(api){if(!state.endpoints[api])state.endpoints[api]={failures:0,openUntil:0,lastFailureAt:0,lastSuccessAt:0,lastError:''};return state.endpoints[api]}
function circuitOpen(api,at=now()){return endpointState(api).openUntil>at}
function markSuccess(api){const h=endpointState(api);h.failures=0;h.openUntil=0;h.lastSuccessAt=now();h.lastError=''}
function markFailure(api,error){const h=endpointState(api);h.failures=Math.min(8,(h.failures||0)+1);h.lastFailureAt=now();h.lastError=String(error?.message||error||'cloud unavailable');h.openUntil=now()+Math.min(MAX_COOLDOWN,BASE_COOLDOWN*Math.pow(2,Math.max(0,h.failures-1)))}
function allApiCandidates(requested,action=''){
  const extra=Array.isArray(window.NOLU_SECONDARY_APIS)?window.NOLU_SECONDARY_APIS.filter(x=>typeof x==='string'&&/^https:\/\//.test(x)):[];
  const base=preferredCloud()==='standby'?[STANDBY,PRIMARY]:[PRIMARY,STANDBY];
  return [...new Set([...base,requested,COMPAT_V6,COMPAT_CORE,...extra].filter(Boolean))].filter(api=>!(api===STANDBY&&NO_STANDBY_ACTIONS.has(action)));
}
function apiCandidates(requested,{force=false,action=''}={}){const all=allApiCandidates(requested,action);return force?all:all.filter(api=>!circuitOpen(api))}
function earliestProbe(requested,action=''){const all=allApiCandidates(requested,action);if(!all.length)return'';return [...all].sort((a,b)=>(endpointState(a).openUntil||0)-(endpointState(b).openUntil||0))[0]}
function requestBody(options){if(typeof options?.body!=='string')return null;return safeJson(options.body,null)}
function isCoreUrl(url){return CORE_APIS.includes(String(url))||(Array.isArray(window.NOLU_SECONDARY_APIS)&&window.NOLU_SECONDARY_APIS.includes(String(url)))}
function hasAuthorization(options){try{return new Headers(options?.headers||{}).has('Authorization')}catch{return false}}
function authTokenFor(api){return api===STANDBY?standbyToken():token()}
function freshOptions(api,options={}){
  if(!hasAuthorization(options))return options;const fresh=authTokenFor(api);if(!fresh)return options;
  const headers=new Headers(options.headers||{});headers.set('Authorization',`Bearer ${fresh}`);return {...options,headers};
}
async function timedFetch(url,options={},ms=1800){
  const ctrl=new AbortController(),outer=options.signal,t=setTimeout(()=>ctrl.abort(),ms),abort=()=>ctrl.abort();if(outer)outer.addEventListener('abort',abort,{once:true});
  try{return await nativeFetch(url,{...freshOptions(url,options),signal:ctrl.signal,cache:'no-store'})}finally{clearTimeout(t);if(outer)outer.removeEventListener('abort',abort)}
}
function syntheticBootstrap(){const uid=currentUid(),profile=localProfile(uid);if(!uid||!profile)return null;snapshot(uid,profile);setMode('offline');return new Response(JSON.stringify({profile,courses:localCourses(),semesters:[],active_semester:null,social:{relationships:[],profiles:[],friends:[],meetups:[],deferred:true},offline:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})}
function syntheticMutation(action,payload){
  if(!queueMutation(action,payload))return null;
  if(action==='update_profile'){
    const uid=currentUid(),p={...localProfile(uid),display_name:cleanText(payload.display_name,80),username:cleanText(payload.username,24),bio:cleanText(payload.bio,120),discoverable:payload.discoverable!==false};if(Object.prototype.hasOwnProperty.call(payload,'avatar_data'))p.avatar_data=cleanAvatar(payload.avatar_data||'');
    return new Response(JSON.stringify({profile:p,queued:true,offline:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  }
  return new Response(JSON.stringify({ok:true,queued:true,offline:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function offlineResponse(action,body,sequence){if(action==='bootstrap'){newestOfflineSequence=Math.max(newestOfflineSequence,sequence);return syntheticBootstrap()}if(action==='save_schedule'||action==='update_profile'){newestOfflineSequence=Math.max(newestOfflineSequence,sequence);return syntheticMutation(action,body)}return null}
function clearMatchingPending(uid,action,body){const q=readPending(uid);if(action==='save_schedule'&&q.schedule){const sent=Array.isArray(body?.courses)?body.courses.slice(0,80):[];if(sameJson(q.schedule.courses,sent)){delete q.schedule;writePending(uid,q)}}if(action==='update_profile'&&q.profile&&sameJson(q.profile.payload,body)){delete q.profile;writePending(uid,q)}}
function storeResponseTokens(data,api){
  const next=typeof data?.token==='string'&&data.token.split('.').length===2?data.token:'';
  if(!next)return;
  if(api===STANDBY){if(next!==standbyToken())localStorage.setItem(STANDBY_SESSION_KEY,next)}
  else if(next!==token())localStorage.setItem('puplan_session',next);
  document.dispatchEvent(new CustomEvent('nolu:session-rotated',{detail:{api,tier:api===STANDBY?'standby':'primary'}}));
}
async function captureSuccess(res,body,api,sequence){
  if(!res?.ok)return;state.activeApi=api;if(api===STANDBY)setPreferredCloud('standby');if(sequence>=newestOfflineSequence)setMode('online',api);
  try{const data=await res.clone().json();storeResponseTokens(data,api);const uid=data?.profile?.id||currentUid();if(data?.profile?.id){localStorage.setItem('puplan_course_owner',String(data.profile.id));snapshot(String(data.profile.id),data.profile)}if(uid&&body?.action)clearMatchingPending(uid,body.action,body)}catch{}
}

window.fetch=async function noluResilientFetch(input,options={}){
  const url=typeof input==='string'?input:input?.url;if(!isCoreUrl(url))return nativeFetch(input,options);
  const sequence=++requestSequence,body=requestBody(options),action=String(body?.action||'');let lastError=null,lastResponse=null,standby401=null;
  const candidates=apiCandidates(String(url),{action});if(!candidates.length){state.lastError='all cloud circuits are temporarily open';const local=offlineResponse(action,body,sequence);if(local)return local;throw new TypeError('Nolu cloud temporarily unavailable')}
  for(const api of candidates){
    if(options?.signal?.aborted)break;
    if(hasAuthorization(options)&&!authTokenFor(api))continue;
    try{
      const res=await timedFetch(api,options,1800);lastResponse=res;
      if(api===STANDBY&&res.status===401&&hasAuthorization(options)){standby401=res;lastError=new Error('standby authorization unavailable');markFailure(api,lastError);continue}
      if(res.status<500){markSuccess(api);await captureSuccess(res,body,api,sequence);return res}
      lastError=new Error(`HTTP ${res.status}`);markFailure(api,lastError);
    }catch(e){lastError=e;markFailure(api,e)}
  }
  state.lastError=String(lastError||'cloud unavailable');const local=offlineResponse(action,body,sequence);if(local)return local;
  if(standby401&&hasAuthorization(options))return new Response(JSON.stringify({error:'STANDBY_AUTH_UNCERTAIN',message:'主雲端暫時無法驗證登入狀態，已保留本機登入資料'}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  if(lastResponse)return lastResponse;throw lastError||new TypeError('Nolu cloud unavailable');
};

async function directJson(api,action,payload={},auth=true,ms=3600){
  const headers={'Content-Type':'application/json'};if(auth&&authTokenFor(api))headers.Authorization=`Bearer ${authTokenFor(api)}`;
  try{const res=await timedFetch(api,{method:'POST',headers,body:JSON.stringify({action,...payload}),cache:'no-store'},ms);if(res.status<500)markSuccess(api);else markFailure(api,new Error(`HTTP ${res.status}`));const data=await res.json().catch(()=>({}));if(res.ok)storeResponseTokens(data,api);return {res,data}}catch(error){markFailure(api,error);throw error}
}
async function flushPending(api){
  const uid=currentUid();if(!uid)return false;let q=readPending(uid);
  if(q.profile?.payload){const sent=q.profile,{res}=await directJson(api,'update_profile',sent.payload,true);if(!res.ok)return false;const latest=readPending(uid);if(latest.profile?.changedAt===sent.changedAt&&sameJson(latest.profile.payload,sent.payload)){delete latest.profile;writePending(uid,latest)}}
  q=readPending(uid);if(q.schedule?.courses){const sent=q.schedule,{res}=await directJson(api,'save_schedule',{courses:sent.courses},true);if(!res.ok)return false;const latest=readPending(uid);if(latest.schedule?.changedAt===sent.changedAt&&sameJson(latest.schedule.courses,sent.courses)){delete latest.schedule;writePending(uid,latest)}}
  snapshot(uid);const remaining=readPending(uid);return !remaining.profile?.payload&&!remaining.schedule?.courses;
}
let recovering=false;
async function recover(){
  if(recovering||document.visibilityState==='hidden'||!currentUid())return;recovering=true;
  try{
    let candidates=apiCandidates(PRIMARY,{action:'bootstrap'});if(!candidates.length){const probe=earliestProbe(PRIMARY,'bootstrap');candidates=probe?[probe]:[]}
    for(const api of candidates){
      try{const {res}=await directJson(api,'bootstrap',{},true,3000);if(api===STANDBY&&res.status===401)continue;if(res.ok){if(await flushPending(api)){if(api===STANDBY)setPreferredCloud('standby');setMode('online',api);sessionStorage.setItem('puplan_api_index','0');location.reload()}return}if(res.status===401&&api!==STANDBY){document.querySelector('#authGate')?.classList.remove('off');return}}catch{}
    }
    if(currentUid())setMode('offline');
  }finally{recovering=false}
}

(function init(){
  const uid=currentUid();if(uid){snapshot(uid);setTimeout(()=>{if(!window.PUPLAN_CLOUD?.isSignedIn?.())setMode('offline')},50)}
  addEventListener('online',()=>setTimeout(recover,200));addEventListener('focus',()=>setTimeout(recover,400));
  document.addEventListener('puplan:courses-changed',e=>{const id=currentUid();if(!id)return;const q=readPending(id);q.schedule={courses:Array.isArray(e.detail)?e.detail.slice(0,80):localCourses(),changedAt:now()};writePending(id,q);snapshot(id);if(state.mode==='offline')setMode('offline')});
  document.addEventListener('puplan:profile-changed',()=>{if(!token()&&!standbyToken())localStorage.removeItem(PREFERRED_KEY)});
  document.addEventListener('nolu:replica-primary-ready',()=>{setPreferredCloud('primary');setTimeout(recover,80)});
  setInterval(recover,30000);
})();

window.NOLU_RESILIENCE={state,getMode:()=>state.mode,recover,flushPending,snapshot,currentUid,circuitOpen,apiCandidates,preferredCloud,setPreferredCloud,PRIMARY,STANDBY};
