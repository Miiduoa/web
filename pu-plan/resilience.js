const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v6';
const FALLBACK='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-core-v1';
const CORE_APIS=[PRIMARY,FALLBACK];
const nativeFetch=window.fetch.bind(window);
const VERSION='20260910-r1';
const MAX_PROFILE_AVATAR=180000;
const state={mode:'online',activeApi:'',lastOnlineAt:0,lastError:'',version:VERSION};

function now(){return Date.now()}
function safeJson(raw,fallback=null){try{return JSON.parse(raw)}catch{return fallback}}
function cleanText(v,max=120){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,max)}
function ownerId(){return cleanText(localStorage.getItem('puplan_course_owner'),100)}
function token(){return localStorage.getItem('puplan_session')||''}
function pendingKey(uid){return `nolu_pending_mutations_v1:${uid}`}
function snapshotKey(uid){return `nolu_account_snapshot_v1:${uid}`}
function parseTokenUid(raw=token()){
  try{
    const [p,s,...extra]=String(raw).split('.');if(!p||!s||extra.length)return null;
    const b64=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const payload=JSON.parse(decodeURIComponent(escape(atob(b64))));
    if(!payload?.uid||!payload?.exp||payload.exp*1000<=Date.now())return null;
    return String(payload.uid);
  }catch{return null}
}
function currentUid(){const uid=parseTokenUid();const owner=ownerId();return uid&&owner&&uid===owner?uid:''}
function localProfile(uid=currentUid()){
  if(!uid)return null;
  const avatar=localStorage.getItem('puplan_avatar')||'';
  return {
    id:uid,
    display_name:cleanText(localStorage.getItem('puplan_name')||'使用者',80)||'使用者',
    username:cleanText(localStorage.getItem('puplan_username')||'',24),
    avatar_data:avatar.length<=MAX_PROFILE_AVATAR?avatar:'',
    bio:cleanText(localStorage.getItem('puplan_bio')||'',120),
    discoverable:localStorage.getItem('puplan_discoverable')!=='0',
    role:'user',profile_visibility:'public'
  };
}
function localCourses(){const v=safeJson(localStorage.getItem('puplan_courses'),[]);return Array.isArray(v)?v.slice(0,80):[]}
function localMeta(){const v=safeJson(localStorage.getItem('puplan_schedule_meta'),{});return v&&typeof v==='object'?v:{}}
function readPending(uid=currentUid()){const v=safeJson(localStorage.getItem(pendingKey(uid)),{});return v&&typeof v==='object'?v:{}}
function writePending(uid,value){if(uid)localStorage.setItem(pendingKey(uid),JSON.stringify(value||{}))}
function snapshot(uid=currentUid(),profile=localProfile(uid)){
  if(!uid||!profile)return;
  const data={uid,profile,courses:localCourses(),meta:localMeta(),savedAt:now()};
  try{localStorage.setItem(snapshotKey(uid),JSON.stringify(data))}catch{}
}
function queueMutation(action,payload){
  const uid=currentUid();if(!uid)return false;
  const q=readPending(uid);
  if(action==='save_schedule')q.schedule={courses:Array.isArray(payload?.courses)?payload.courses.slice(0,80):[],changedAt:now()};
  if(action==='update_profile')q.profile={payload:{...payload},changedAt:now()};
  writePending(uid,q);snapshot(uid);setMode('offline');return true;
}
function setMode(mode,api=''){
  state.mode=mode;state.activeApi=api||state.activeApi;if(mode==='online'){state.lastOnlineAt=now();state.lastError=''}
  document.documentElement.dataset.noluConnectivity=mode;
  let banner=document.querySelector('#noluResilienceBanner');
  if(mode==='offline'){
    if(!banner){banner=document.createElement('div');banner.id='noluResilienceBanner';banner.style.cssText='position:fixed;left:10px;right:10px;top:max(10px,env(safe-area-inset-top));z-index:99999;padding:10px 12px;border-radius:14px;background:#171717;color:#fff;font:700 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px #0003;text-align:center';document.body.appendChild(banner)}
    banner.textContent='離線保護模式｜資料已安全留在此裝置，雲端恢復後會自動補同步';
  }else banner?.remove();
  const cloud=document.querySelector('#cloudState');
  if(cloud&&mode==='offline')cloud.innerHTML='離線保護模式<br><b>本機資料可繼續使用</b><br><span>雲端恢復後會自動補同步。</span>';
  document.dispatchEvent(new CustomEvent('nolu:connectivity',{detail:{...state}}));
}
function apiCandidates(requested){
  const extra=Array.isArray(window.NOLU_SECONDARY_APIS)?window.NOLU_SECONDARY_APIS.filter(x=>typeof x==='string'&&/^https:\/\//.test(x)):[];
  return [...new Set([requested,...CORE_APIS,...extra])];
}
function requestBody(options){if(typeof options?.body!=='string')return null;return safeJson(options.body,null)}
function isCoreUrl(url){return CORE_APIS.includes(String(url))||(Array.isArray(window.NOLU_SECONDARY_APIS)&&window.NOLU_SECONDARY_APIS.includes(String(url)))}
async function timedFetch(url,options={},ms=2400){
  const ctrl=new AbortController(),outer=options.signal,t=setTimeout(()=>ctrl.abort(),ms);
  const abort=()=>ctrl.abort();if(outer)outer.addEventListener('abort',abort,{once:true});
  try{return await nativeFetch(url,{...options,signal:ctrl.signal})}
  finally{clearTimeout(t);if(outer)outer.removeEventListener('abort',abort)}
}
function syntheticBootstrap(){
  const uid=currentUid(),profile=localProfile(uid);if(!uid||!profile)return null;
  snapshot(uid,profile);setMode('offline');
  return new Response(JSON.stringify({profile,courses:localCourses(),semesters:[],active_semester:null,social:{relationships:[],profiles:[],friends:[],meetups:[],deferred:true},offline:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}})
}
function syntheticMutation(action,payload){
  if(!queueMutation(action,payload))return null;
  if(action==='update_profile'){
    const uid=currentUid(),p={...localProfile(uid),display_name:cleanText(payload.display_name,80),username:cleanText(payload.username,24),bio:cleanText(payload.bio,120),discoverable:payload.discoverable!==false};
    if(Object.prototype.hasOwnProperty.call(payload,'avatar_data'))p.avatar_data=String(payload.avatar_data||'').slice(0,MAX_PROFILE_AVATAR);
    return new Response(JSON.stringify({profile:p,queued:true,offline:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  }
  return new Response(JSON.stringify({ok:true,queued:true,offline:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
async function captureSuccess(res,body,api){
  if(!res?.ok)return;
  state.activeApi=api;setMode('online',api);
  try{
    const data=await res.clone().json();
    const uid=data?.profile?.id||currentUid();
    if(data?.profile?.id){localStorage.setItem('puplan_course_owner',String(data.profile.id));snapshot(String(data.profile.id),data.profile)}
    if(uid&&body?.action==='save_schedule'){const q=readPending(uid);delete q.schedule;writePending(uid,q)}
    if(uid&&body?.action==='update_profile'){const q=readPending(uid);delete q.profile;writePending(uid,q)}
  }catch{}
}

window.fetch=async function noluResilientFetch(input,options={}){
  const url=typeof input==='string'?input:input?.url;
  if(!isCoreUrl(url))return nativeFetch(input,options);
  const body=requestBody(options),action=String(body?.action||'');let lastError=null,lastResponse=null;
  for(const api of apiCandidates(String(url))){
    if(options?.signal?.aborted)break;
    try{
      const res=await timedFetch(api,options,2400);lastResponse=res;
      if(res.status<500){captureSuccess(res,body,api);return res}
      lastError=new Error(`HTTP ${res.status}`);
    }catch(e){lastError=e}
  }
  state.lastError=String(lastError||'cloud unavailable');
  if(action==='bootstrap'){const local=syntheticBootstrap();if(local)return local}
  if(action==='save_schedule'||action==='update_profile'){const local=syntheticMutation(action,body);if(local)return local}
  if(lastResponse)return lastResponse;
  throw lastError||new TypeError('Nolu cloud unavailable');
};

async function directJson(api,action,payload={},auth=true,ms=5000){
  const headers={'Content-Type':'application/json'};if(auth&&token())headers.Authorization=`Bearer ${token()}`;
  const res=await timedFetch(api,{method:'POST',headers,body:JSON.stringify({action,...payload}),cache:'no-store'},ms);
  const data=await res.json().catch(()=>({}));return {res,data};
}
async function flushPending(api){
  const uid=currentUid();if(!uid)return false;const q=readPending(uid);
  if(q.profile?.payload){const {res}=await directJson(api,'update_profile',q.profile.payload,true);if(!res.ok)return false;delete q.profile;writePending(uid,q)}
  if(q.schedule?.courses){const {res}=await directJson(api,'save_schedule',{courses:q.schedule.courses},true);if(!res.ok)return false;delete q.schedule;writePending(uid,q)}
  snapshot(uid);return true;
}
let recovering=false;
async function recover(){
  if(recovering||document.visibilityState==='hidden'||!currentUid())return;recovering=true;
  try{
    for(const api of apiCandidates(PRIMARY)){
      try{
        const {res}=await directJson(api,'bootstrap',{},true,3600);
        if(res.ok){if(await flushPending(api)){setMode('online',api);sessionStorage.setItem('puplan_api_index',String(CORE_APIS.indexOf(api)>=0?CORE_APIS.indexOf(api):0));location.reload()}return}
        if(res.status===401){document.querySelector('#authGate')?.classList.remove('off');return}
      }catch{}
    }
    if(currentUid())setMode('offline');
  }finally{recovering=false}
}

(function init(){
  const uid=currentUid();if(uid){snapshot(uid);setTimeout(()=>{if(!window.PUPLAN_CLOUD?.isSignedIn?.())setMode('offline')},50)}
  addEventListener('online',()=>setTimeout(recover,200));
  addEventListener('focus',()=>setTimeout(recover,400));
  document.addEventListener('puplan:courses-changed',e=>{const id=currentUid();if(!id)return;const q=readPending(id);q.schedule={courses:Array.isArray(e.detail)?e.detail.slice(0,80):localCourses(),changedAt:now()};writePending(id,q);snapshot(id);if(state.mode==='offline')setMode('offline')});
  setInterval(recover,30000);
})();

window.NOLU_RESILIENCE={state,getMode:()=>state.mode,recover,flushPending,snapshot,currentUid};
