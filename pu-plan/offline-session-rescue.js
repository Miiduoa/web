const wrappedFetch=window.fetch.bind(window);
const encoder=new TextEncoder();
const MAX_EXPIRED_GRACE_MS=7*24*60*60*1000;
const MAX_SNAPSHOT_AGE_MS=45*24*60*60*1000;

function safeJson(raw,fallback=null){try{return JSON.parse(raw)}catch{return fallback}}
function requestBody(options){return typeof options?.body==='string'?safeJson(options.body,{}):{}}
function requestUrl(input){return typeof input==='string'?input:input?.url||''}
function isNoluCore(url){
  try{return /\/functions\/v1\/(?:pu-plan-api(?:-v\d+)?|pu-plan-core-v1)$/.test(new URL(url,location.href).pathname)}catch{return false}
}
function parseSession(raw){
  try{
    const [payload,signature,...rest]=String(raw||'').split('.');if(!payload||!signature||rest.length)return null;
    const normalized=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if(data?.v!==4||!data?.uid||!data?.iat||!data?.exp||!data?.cv)return null;
    if(!Number.isFinite(data.iat)||!Number.isFinite(data.exp)||data.exp<=data.iat)return null;
    if(data.iat*1000>Date.now()+5*60*1000)return null;
    return data;
  }catch{return null}
}
async function fingerprint(raw){
  try{
    const digest=await crypto.subtle.digest('SHA-256',encoder.encode(raw));
    return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,'0')).join('');
  }catch{return''}
}
async function trustedSnapshot(){
  const primary=localStorage.getItem('puplan_session')||'',standby=localStorage.getItem('puplan_standby_session_v2')||'';
  const raw=localStorage.getItem('nolu_preferred_cloud_v1')==='standby'?(standby||primary):(primary||standby);const session=parseSession(raw);if(!session)return null;
  if(session.exp*1000+MAX_EXPIRED_GRACE_MS<Date.now())return null;
  if((localStorage.getItem('puplan_course_owner')||'')!==String(session.uid))return null;
  const fp=await fingerprint(raw);if(!fp)return null;
  let durable=null;try{durable=await window.NOLU_DURABLE?.getSnapshot?.(String(session.uid))}catch{}
  const local=safeJson(localStorage.getItem(`nolu_account_snapshot_v1:${session.uid}`),null);
  const candidates=[durable,local].filter(Boolean).sort((a,b)=>Number(b?.savedAt||0)-Number(a?.savedAt||0));
  const snap=candidates.find(x=>x?.uid===String(session.uid)&&x?.profile?.id===String(session.uid)&&x?.sessionFingerprint===fp);
  if(!snap||Date.now()-Number(snap.savedAt||0)>MAX_SNAPSHOT_AGE_MS)return null;
  return {session,raw,snap};
}
function queue(uid,action,body,snap){
  const key=`nolu_pending_mutations_v1:${uid}`,q=safeJson(localStorage.getItem(key),{})||{},changedAt=Date.now();
  if(action==='save_schedule'){
    const courses=Array.isArray(body?.courses)?body.courses.slice(0,80):[];
    q.schedule={courses,changedAt};localStorage.setItem('puplan_courses',JSON.stringify(courses));
  }
  if(action==='update_profile'){
    const payload={...body};delete payload.action;q.profile={payload,changedAt};
    if(payload.display_name!==undefined)localStorage.setItem('puplan_name',String(payload.display_name).slice(0,80));
    if(payload.username!==undefined)localStorage.setItem('puplan_username',String(payload.username).slice(0,24));
    if(payload.bio!==undefined)localStorage.setItem('puplan_bio',String(payload.bio).slice(0,120));
    if(payload.discoverable!==undefined)localStorage.setItem('puplan_discoverable',payload.discoverable===false?'0':'1');
    if(payload.avatar_data!==undefined){if(payload.avatar_data)localStorage.setItem('puplan_avatar',String(payload.avatar_data).slice(0,180000));else localStorage.removeItem('puplan_avatar')}
  }
  localStorage.setItem(key,JSON.stringify(q));
  return q;
}
function profileFromStorage(uid,snap){
  const base=snap?.profile||{};
  return {...base,id:uid,display_name:localStorage.getItem('puplan_name')||base.display_name||'使用者',username:localStorage.getItem('puplan_username')||base.username||'',bio:localStorage.getItem('puplan_bio')||base.bio||'',avatar_data:localStorage.getItem('puplan_avatar')||base.avatar_data||'',discoverable:localStorage.getItem('puplan_discoverable')!=='0'};
}
function activate(){
  document.documentElement.dataset.noluConnectivity='offline';
  document.documentElement.dataset.noluLocalRescue='1';
  let banner=document.querySelector('#noluResilienceBanner');
  if(!banner){banner=document.createElement('div');banner.id='noluResilienceBanner';banner.style.cssText='position:fixed;left:10px;right:10px;top:max(10px,env(safe-area-inset-top));z-index:99999;padding:10px 12px;border-radius:14px;background:#171717;color:#fff;font:700 12px/1.35 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;box-shadow:0 8px 30px #0003;text-align:center';document.body.appendChild(banner)}
  banner.textContent='本機救援模式｜已使用此裝置先前驗證的登入資料，變更會保留並在雲端恢復後補同步';
}
function bootstrapResponse(snap){
  return new Response(JSON.stringify({profile:profileFromStorage(snap.uid,snap),courses:Array.isArray(snap.courses)?snap.courses.slice(0,80):[],semesters:[],active_semester:null,social:{relationships:[],profiles:[],friends:[],meetups:[],deferred:true},offline:true,local_recovery:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function mutationResponse(uid,action,body,snap){
  queue(uid,action,body,snap);activate();
  if(action==='update_profile')return new Response(JSON.stringify({profile:profileFromStorage(uid,snap),queued:true,offline:true,local_recovery:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
  return new Response(JSON.stringify({ok:true,queued:true,offline:true,local_recovery:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}

window.fetch=async function noluOfflineSessionRescue(input,options={}){
  const url=requestUrl(input);if(!isNoluCore(url))return wrappedFetch(input,options);
  const body=requestBody(options),action=String(body?.action||'');let response=null,error=null;
  try{response=await wrappedFetch(input,options);if(response.status<500&&response.status!==410)return response}catch(e){error=e}
  if(action==='bootstrap'||action==='save_schedule'||action==='update_profile'){
    const trusted=await trustedSnapshot();
    if(trusted){activate();const snap=trusted.snap;if(action==='bootstrap')return bootstrapResponse(snap);return mutationResponse(String(trusted.session.uid),action,body,snap)}
  }
  if(response)return response;throw error||new TypeError('Nolu cloud unavailable');
};

window.NOLU_OFFLINE_RESCUE={trustedSnapshot,active:()=>document.documentElement.dataset.noluLocalRescue==='1'};
