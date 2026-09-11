const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SYNC=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-replica-v3`;
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const DIRTY_PREFIX='nolu_standby_dirty_v3:';
const SEEDED_PREFIX='nolu_standby_seeded_v3:';
const state={
  version:'20260911-replica3-failback-guard',busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,
  lastError:'',lastReason:'',lastTier:'',peerSynced:false,peerSessionReady:false,manualReconcileRequired:false
};
let debounceTimer=null;

function canonicalToken(){return localStorage.getItem('puplan_session')||''}
function decodeV4(raw){
  try{
    const [p,s,...rest]=String(raw||'').split('.');if(!p||!s||rest.length)return null;
    const normalized=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if(data?.v!==4||!data?.uid||!data?.exp||data.exp*1000<=Date.now())return null;
    return data;
  }catch{return null}
}
function uid(){return String(decodeV4(canonicalToken())?.uid||'')}
function activeTier(){
  const api=String(window.NOLU_RESILIENCE?.state?.activeApi||'');
  if(api.includes(STANDBY_REF))return'standby';
  if(api.includes(PRIMARY_REF))return'primary';
  return window.NOLU_RESILIENCE?.preferredCloud?.()==='standby'?'standby':'primary';
}
function sameAccount(raw,id=uid()){return !!id&&String(decodeV4(raw)?.uid||'')===id}
function legacyPrimarySession(){
  const id=uid(),current=canonicalToken();if(!id||!sameAccount(current,id)||localStorage.getItem('nolu_preferred_cloud_v1')==='standby')return'';
  const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'',standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
  if(sameAccount(primary,id))return primary;
  if(sameAccount(standby,id)||primary||standby)return'';
  return current;
}
function primarySession(){
  const id=uid(),specific=localStorage.getItem(PRIMARY_SESSION_KEY)||'';
  if(sameAccount(specific,id))return specific;
  return legacyPrimarySession();
}
function sessionFor(tier){
  if(tier==='primary')return primarySession();
  const id=uid(),specific=localStorage.getItem(STANDBY_SESSION_KEY)||'';
  return sameAccount(specific,id)?specific:'';
}
function seedPrimarySessionFromCanonical(){
  const id=uid();if(!id)return false;
  const existing=localStorage.getItem(PRIMARY_SESSION_KEY)||'';if(sameAccount(existing,id))return true;
  const legacy=legacyPrimarySession();if(!legacy)return false;
  localStorage.setItem(PRIMARY_SESSION_KEY,legacy);return true;
}
function storeStandbyToken(raw){
  const currentUid=uid(),data=decodeV4(raw);if(!currentUid||!data||String(data.uid)!==currentUid)return false;
  localStorage.setItem(STANDBY_SESSION_KEY,String(raw));
  state.peerSessionReady=true;
  document.dispatchEvent(new CustomEvent('nolu:peer-session-ready',{detail:{uid:currentUid,tier:'standby',at:Date.now()}}));
  return true;
}
function dirtyKey(id=uid()){return id?`${DIRTY_PREFIX}${id}`:''}
function hasStandbyDirty(id=uid()){const key=dirtyKey(id);return !!key&&localStorage.getItem(key)==='1'}
function requireManualReconcile(reason='standby-dirty'){
  state.manualReconcileRequired=true;state.peerSynced=false;
  state.lastError='standby has unsafely divergent changes; manual reconciliation required';
  document.dispatchEvent(new CustomEvent('nolu:replica-manual-reconcile-required',{detail:{uid:uid(),reason,at:Date.now()}}));
}
function markStandbyDirty(){
  const id=uid();if(!id||activeTier()!=='standby')return false;
  localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1');requireManualReconcile('standby-write');return true;
}
function schedule(reason,delay=1200){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}

async function sync(reason='periodic',force=false){
  const id=uid();
  if(!id||localStorage.getItem('puplan_guest')==='1'||state.busy)return false;
  const tier=activeTier();state.lastTier=tier;state.lastReason=reason;
  if(tier!=='primary'){
    // Replica v3 intentionally supports trusted primary -> standby replication only.
    // Never send a Tokyo session to the primary endpoint or pretend reverse replication succeeded.
    state.peerSynced=false;
    if(hasStandbyDirty(id))requireManualReconcile('standby-dirty');
    else state.lastError='standby active; reverse replication is intentionally disabled';
    return false;
  }
  if(hasStandbyDirty(id)){
    // A previous Tokyo-side write is newer/independent state. Do not overwrite it
    // merely because Mumbai became reachable again; explicit conflict resolution is required.
    requireManualReconcile('primary-failback-blocked');return false;
  }
  seedPrimarySessionFromCanonical();
  const session=primarySession();if(!session)return false;
  const at=Date.now();if(!force&&at-state.lastAttemptAt<4000)return false;
  state.busy=true;state.lastAttemptAt=at;state.peerSessionReady=false;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
  try{
    const response=await fetch(PRIMARY_SYNC,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session}`},
      body:JSON.stringify({action:'sync_and_prewarm'}),cache:'no-store',signal:ctrl.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){state.lastError=data.message||data.error||`HTTP ${response.status}`;state.peerSynced=false;return false}
    if(data.peer_synced!==true||!storeStandbyToken(data.peer_token)){
      state.lastError='replica v3 completed without a valid standby-local session';state.peerSynced=false;return false;
    }
    state.lastSuccessAt=Date.now();state.lastPeerSyncAt=state.lastSuccessAt;state.lastError='';state.peerSynced=true;state.manualReconcileRequired=false;
    localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');
    document.dispatchEvent(new CustomEvent('nolu:replica-synced',{detail:{uid:id,tier:'primary',peerTier:'standby',at:state.lastPeerSyncAt,peerSessionReady:true}}));
    return true;
  }catch(error){state.lastError=String(error?.message||error||'sync unavailable');state.peerSynced=false;return false}
  finally{clearTimeout(timer);state.busy=false}
}

document.addEventListener('puplan:courses-changed',()=>{markStandbyDirty();schedule('schedule-change',1400)});
document.addEventListener('puplan:profile-changed',()=>{markStandbyDirty();schedule('profile-change',900)});
document.addEventListener('nolu:session-rotated',()=>schedule('session-rotated',250));
document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')schedule('connectivity-online',450)});
document.addEventListener('nolu:peer-session-needed',()=>schedule('peer-session-needed',50));
addEventListener('online',()=>schedule('browser-online',400));
addEventListener('focus',()=>schedule('focus',650));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule('visible',650)});
setInterval(()=>void sync('periodic'),30000);

seedPrimarySessionFromCanonical();
if(window.PUPLAN_CLOUD?.isSignedIn?.()||uid())schedule('startup',400);
window.NOLU_REPLICATION={
  state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty,hasStandbyDirty,
  sessionFor,seedPrimarySessionFromCanonical,PRIMARY_SESSION_KEY,STANDBY_SESSION_KEY
};
