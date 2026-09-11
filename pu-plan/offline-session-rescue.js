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
function rebindFromDurable(id,snap){
  const p=snap?.profile||{};
  localStorage.setItem('puplan_course_owner',id);
  if(p.display_name)localStorage.setItem('puplan_name',String(p.display_name).slice(0,80));else localStorage.removeItem('puplan_name');
  if(p.username!==undefined)localStorage.setItem('puplan_username',String(p.username).slice(0,24));else localStorage.removeItem('puplan_username');
  if(p.bio!==undefined)localStorage.setItem('puplan_bio',String(p.bio).slice(0,120));else localStorage.removeItem('puplan_bio');
  if(p.discoverable!==undefined)localStorage.setItem('puplan_discoverable',p.discoverable===false?'0':'1');else localStorage.removeItem('puplan_discoverable');
  if(p.avatar_data&&String(p.avatar_data).length<=180000)localStorage.setItem('puplan_avatar',String(p.avatar_data));else localStorage.removeItem('puplan_avatar');
  if(Array.isArray(snap?.courses))localStorage.setItem('puplan_courses',JSON.stringify(snap.courses.slice(0,80)));else localStorage.removeItem('puplan_courses');
  if(snap?.meta&&typeof snap.meta==='object')localStorage.setItem('puplan_schedule_meta',JSON.stringify(snap.meta));else localStorage.removeItem('puplan_schedule_meta');
}
async function trustedSnapshot(){
  const raw=localStorage.getItem('puplan_session')||'';const session=parseSession(raw);if(!session)return null;
  if(session.exp*1000+MAX_EXPIRED_GRACE_MS<Date.now())return null;
  const id=String(session.uid),owner=localStorage.getItem('puplan_course_owner')||'';
  const fp=await fingerprint(raw);if(!fp)return null;
  let durable=null;try{durable=await window.NOLU_DURABLE?.getSnapshot?.(id)}catch{}
  const local=safeJson(localStorage.getItem(`nolu_account_snapshot_v1:${id}`),null);
  const exact=x=>x?.uid===id&&x?.profile?.id===id&&x?.sessionFingerprint===fp&&Date.now()-Number(x?.savedAt||0)<=MAX_SNAPSHOT_AGE_MS;
  const candidates=[];
  // IndexedDB is session-fingerprint bound. An exact durable match is allowed to
  // repair a stale/wrong owner key left by a prior failed auth/cache transition.
  if(exact(durable))candidates.push({snap:durable,durable:true});
  // localStorage is not allowed to repair ownership; it is trusted only if the
  // owner already matches the signed session uid.
  if(owner===id&&exact(local))candidates.push({snap:local,durable:false});
  candidates.sort((a,b)=>Number(b.snap?.savedAt||0)-Number(a.snap?.savedAt||0));
  const best=candidates[0];if(!best)return null;
  if(best.durable&&owner!==id)rebindFromDurable(id,best.snap);
  return {session,raw,snap:best.snap,ownerRebound:best.durable&&owner!==id};
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
function loginResponse(trusted){
  const uid=String(trusted.session.uid),snap=trusted.snap;
  return new Response(JSON.stringify({token:trusted.raw,profile:profileFromStorage(uid,snap),courses:Array.isArray(snap.courses)?snap.courses.slice(0,80):[],semesters:[],active_semester:null,social:{relationships:[],profiles:[],friends:[],meetups:[],deferred:true},offline:true,local_recovery:true,login_recovery:true}),{status:200,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
}
function outageLoginFailure(){
  const recovery=window.NOLU_SESSION_RECOVERY?.result||{};
  const hadAnchor=!!(localStorage.getItem('puplan_session')||localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session_standby_v1'));
  const message=hadAnchor||recovery?.status==='local-grace'
    ?'主雲端目前無法連線；這台裝置有舊登入資料，但目前找不到可安全驗證的本機快照。請勿清除 nolu 網站資料。'
    :'主雲端目前無法連線，而且東京備援尚未有這個帳號；這台裝置也沒有可驗證的舊登入狀態。請勿重新註冊同一個 Email。';
  return new Response(JSON.stringify({error:'AUTHORITY_UNAVAILABLE',message,local_recovery:false}),{status:503,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
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
  if(action==='login'){
    const trusted=await trustedSnapshot();
    const recovery=window.NOLU_SESSION_RECOVERY?.result||{};
    if(trusted&&String(recovery?.uid||'')===String(trusted.session.uid)&&['canonical-ok','recovered','local-grace'].includes(String(recovery.status||''))){
      activate();
      return loginResponse(trusted);
    }
    return outageLoginFailure();
  }
  if(action==='bootstrap'||action==='save_schedule'||action==='update_profile'){
    const trusted=await trustedSnapshot();
    if(trusted){activate();const snap=trusted.snap;if(action==='bootstrap')return bootstrapResponse(snap);return mutationResponse(String(trusted.session.uid),action,body,snap)}
  }
  if(response)return response;throw error||new TypeError('Nolu cloud unavailable');
};

window.NOLU_OFFLINE_RESCUE={trustedSnapshot,active:()=>document.documentElement.dataset.noluLocalRescue==='1'};