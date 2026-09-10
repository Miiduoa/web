import {requestPersistentStorage,getSnapshot,putSnapshot,putMutation,listMutations,deleteMutation} from './durable-store.js';

const MAX_AVATAR=180000;
const state={ready:false,persistent:false,lastMirrorAt:0};

function safeJson(raw,fallback=null){try{return JSON.parse(raw)}catch{return fallback}}
function clean(v,n=160){return String(v??'').replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,n)}
function tokenUid(){
  try{
    const raw=localStorage.getItem('puplan_session')||'';
    const [p,s,...rest]=raw.split('.');if(!p||!s||rest.length)return'';
    const b64=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(b64))));
    if(!data?.uid||!data?.exp||data.exp*1000<=Date.now())return'';
    return String(data.uid);
  }catch{return''}
}
function uid(){const id=tokenUid(),owner=localStorage.getItem('puplan_course_owner')||'';return id&&owner===id?id:''}
function pendingKey(id){return `nolu_pending_mutations_v1:${id}`}
function snapshotKey(id){return `nolu_account_snapshot_v1:${id}`}
function profile(id){
  if(!id)return null;const avatar=localStorage.getItem('puplan_avatar')||'';
  return {id,display_name:clean(localStorage.getItem('puplan_name')||'使用者',80)||'使用者',username:clean(localStorage.getItem('puplan_username')||'',24),avatar_data:avatar.length<=MAX_AVATAR?avatar:'',bio:clean(localStorage.getItem('puplan_bio')||'',120),discoverable:localStorage.getItem('puplan_discoverable')!=='0',role:'user',profile_visibility:'public'};
}
function courses(){const v=safeJson(localStorage.getItem('puplan_courses'),[]);return Array.isArray(v)?v.slice(0,80):[]}
function meta(){const v=safeJson(localStorage.getItem('puplan_schedule_meta'),{});return v&&typeof v==='object'?v:{}}
function localSnapshot(id){const p=profile(id);if(!p)return null;return {uid:id,profile:p,courses:courses(),meta:meta(),savedAt:Date.now(),revision:Date.now()}}
function hydrate(snap){
  const id=uid();if(!id||snap?.uid!==id)return false;const p=snap.profile||{};
  localStorage.setItem('puplan_course_owner',id);
  if(p.display_name)localStorage.setItem('puplan_name',clean(p.display_name,80));
  if(p.username!==undefined)localStorage.setItem('puplan_username',clean(p.username,24));
  if(p.bio!==undefined)localStorage.setItem('puplan_bio',clean(p.bio,120));
  if(p.discoverable!==undefined)localStorage.setItem('puplan_discoverable',p.discoverable===false?'0':'1');
  if(p.avatar_data&&String(p.avatar_data).length<=MAX_AVATAR)localStorage.setItem('puplan_avatar',String(p.avatar_data));
  if(Array.isArray(snap.courses))localStorage.setItem('puplan_courses',JSON.stringify(snap.courses.slice(0,80)));
  if(snap.meta&&typeof snap.meta==='object')localStorage.setItem('puplan_schedule_meta',JSON.stringify(snap.meta));
  return true;
}
function row(id,action,payload,changedAt=Date.now(),revision=changedAt){return {id:`${id}:${action==='update_profile'?'profile':'schedule:current'}`,uid:id,action,payload,changedAt,revision,attempts:0,blocked:false,lastError:''}}
async function mirrorPending(id){
  const q=safeJson(localStorage.getItem(pendingKey(id)),{});if(!q||typeof q!=='object')return;
  if(q.profile?.payload)await putMutation(row(id,'update_profile',q.profile.payload,q.profile.changedAt||Date.now(),q.profile.revision||q.profile.changedAt||Date.now()));
  if(q.schedule?.courses)await putMutation(row(id,'save_schedule',{courses:q.schedule.courses},q.schedule.changedAt||Date.now(),q.schedule.revision||q.schedule.changedAt||Date.now()));
}
async function pruneSynced(id){
  const q=safeJson(localStorage.getItem(pendingKey(id)),{});const rows=await listMutations(id);
  for(const r of rows){if(r.action==='update_profile'&&!q?.profile)await deleteMutation(r.id);if(r.action==='save_schedule'&&!q?.schedule)await deleteMutation(r.id)}
}
async function mirror(prune=false){
  const id=uid();if(!id)return false;const snap=localSnapshot(id);if(snap){await putSnapshot(snap);try{localStorage.setItem(snapshotKey(id),JSON.stringify(snap))}catch{}}
  await mirrorPending(id);if(prune)await pruneSynced(id);state.lastMirrorAt=Date.now();return true;
}
async function restorePending(id){
  const rows=await listMutations(id);if(!rows.length)return false;const q=safeJson(localStorage.getItem(pendingKey(id)),{})||{};let changed=false;
  for(const r of rows){
    if(r.action==='update_profile'&&!q.profile){q.profile={payload:r.payload,changedAt:r.changedAt,revision:r.revision};changed=true}
    if(r.action==='save_schedule'&&!q.schedule){q.schedule={courses:Array.isArray(r.payload?.courses)?r.payload.courses:[],changedAt:r.changedAt,revision:r.revision};changed=true}
  }
  if(changed)localStorage.setItem(pendingKey(id),JSON.stringify(q));return changed;
}
async function prepare(){
  const id=uid();if(!id){state.ready=true;return}
  state.persistent=await requestPersistentStorage();
  const durable=await getSnapshot(id),legacy=safeJson(localStorage.getItem(snapshotKey(id)),null);
  if(durable&&Number(durable.savedAt||0)>=Number(legacy?.savedAt||0))hydrate(durable);
  await restorePending(id);await mirror(false);state.ready=true;
}
await prepare();

document.addEventListener('puplan:courses-changed',e=>{
  const id=uid();if(!id)return;const list=Array.isArray(e.detail)?e.detail.slice(0,80):courses();
  const r=row(id,'save_schedule',{courses:list});void putMutation(r);void putSnapshot({...localSnapshot(id),courses:list,savedAt:Date.now()});
});
document.addEventListener('puplan:profile-changed',()=>{void mirror(false)});
document.addEventListener('nolu:connectivity',e=>{void mirror(e.detail?.mode==='online')});
addEventListener('online',()=>{void restorePending(uid()).then(restored=>{if(restored)setTimeout(()=>window.NOLU_RESILIENCE?.recover?.(),50)})});
addEventListener('focus',()=>{void restorePending(uid()).then(restored=>{if(restored)setTimeout(()=>window.NOLU_RESILIENCE?.recover?.(),50)})});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')void restorePending(uid())});
setInterval(()=>void mirror(false),5000);

window.NOLU_DURABLE={state,mirror,restorePending,getSnapshot,listMutations};
