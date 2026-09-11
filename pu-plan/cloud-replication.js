const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SYNC=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-replica-v3`;
const FAILBACK_SYNC=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-failback-v1`;
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const DIRTY_PREFIX='nolu_standby_dirty_v3:';
const SEEDED_PREFIX='nolu_standby_seeded_v3:';
const state={
  version:'20260911-replica3-failback2',busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,
  lastError:'',lastReason:'',lastTier:'',peerSynced:false,peerSessionReady:false,manualReconcileRequired:false,
  failbackPending:false,lastFailbackAt:0,lastFailbackError:''
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
function uid(){return String(decodeV4(canonicalToken())?.uid||decodeV4(localStorage.getItem(STANDBY_SESSION_KEY)||'')?.uid||'')}
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
function requireManualReconcile(reason='standby-conflict'){
  state.manualReconcileRequired=true;state.peerSynced=false;state.failbackPending=true;
  state.lastError='主雲端與東京備援都有較新的變更，已停止自動覆寫';
  document.dispatchEvent(new CustomEvent('nolu:replica-manual-reconcile-required',{detail:{uid:uid(),reason,at:Date.now()}}));
}
function markStandbyDirty(force=false){
  const id=uid();if(!id||(!force&&activeTier()!=='standby'))return false;
  localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1');state.failbackPending=true;state.peerSynced=false;return true;
}
function clearStandbyDirty(id=uid()){
  const key=dirtyKey(id);if(key)localStorage.removeItem(key);
  state.failbackPending=false;state.manualReconcileRequired=false;state.lastFailbackError='';
}
function schedule(reason,delay=1200){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}

async function reconcileFromStandby(reason='standby-failback'){
  const id=uid(),session=sessionFor('standby');
  if(!id||!session||!hasStandbyDirty(id)||state.busy)return false;
  state.busy=true;state.lastReason=reason;state.lastTier='standby';state.lastAttemptAt=Date.now();state.failbackPending=true;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),15000);
  try{
    const response=await fetch(FAILBACK_SYNC,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session}`},body:JSON.stringify({action:'reconcile'}),cache:'no-store',signal:ctrl.signal});
    const data=await response.json().catch(()=>({}));
    if(response.status===409||data.conflict===true){state.lastFailbackError=data.message||'FAILBACK_CONFLICT';requireManualReconcile('primary-advanced');return false}
    if(!response.ok||data.reconciled!==true){state.lastFailbackError=data.message||data.error||`HTTP ${response.status}`;state.lastError=state.lastFailbackError;return false}
    clearStandbyDirty(id);state.lastFailbackAt=Date.now();state.lastSuccessAt=state.lastFailbackAt;state.lastPeerSyncAt=state.lastFailbackAt;state.lastError='';state.peerSynced=true;
    document.dispatchEvent(new CustomEvent('nolu:replica-failback-synced',{detail:{uid:id,tier:'standby',peerTier:'primary',at:state.lastFailbackAt}}));
    return true;
  }catch(error){state.lastFailbackError=String(error?.message||error||'failback unavailable');state.lastError=state.lastFailbackError;return false}
  finally{clearTimeout(timer);state.busy=false}
}

async function sync(reason='periodic',force=false){
  const id=uid();
  if(!id||localStorage.getItem('puplan_guest')==='1'||state.busy)return false;
  if(hasStandbyDirty(id))return reconcileFromStandby(reason);
  const tier=activeTier();state.lastTier=tier;state.lastReason=reason;
  if(tier!=='primary'){state.peerSynced=true;state.lastError='';return true}
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

document.addEventListener('puplan:courses-changed',()=>{if(activeTier()==='standby')markStandbyDirty();schedule('schedule-change',1400)});
document.addEventListener('puplan:profile-changed',()=>{if(activeTier()==='standby')markStandbyDirty();schedule('profile-change',900)});
document.addEventListener('nolu:standby-write',event=>{markStandbyDirty(true);schedule(`standby-write:${event.detail?.action||'unknown'}`,250)});
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
  state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty,hasStandbyDirty,reconcileFromStandby,
  sessionFor,seedPrimarySessionFromCanonical,PRIMARY_SESSION_KEY,STANDBY_SESSION_KEY
};
