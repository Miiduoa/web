const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SYNC=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-replica-v3`;
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const DIRTY_PREFIX='nolu_standby_dirty_v3:';
const SEEDED_PREFIX='nolu_standby_seeded_v3:';
const state={
  version:'20260911-replica3',busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,
  lastError:'',lastReason:'',lastTier:'',peerSynced:false,peerSessionReady:false,
  failbackMode:'manual-reconcile'
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
function sessionKey(tier){return tier==='standby'?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY}
function sameAccount(raw,id=uid()){return !!id&&String(decodeV4(raw)?.uid||'')===id}
function sessionFor(tier){
  const id=uid(),specific=localStorage.getItem(sessionKey(tier))||'';
  if(sameAccount(specific,id))return specific;
  const current=canonicalToken();
  // Historical installations only had puplan_session, which was the Mumbai token.
  // It can bootstrap the primary slot, but it must never replace a Tokyo-local token.
  return tier==='primary'&&sameAccount(current,id)?current:'';
}
function seedPrimarySessionFromCanonical(){
  const current=canonicalToken(),data=decodeV4(current);if(!data)return false;
  const existing=localStorage.getItem(PRIMARY_SESSION_KEY)||'';
  if(!sameAccount(existing,String(data.uid)))localStorage.setItem(PRIMARY_SESSION_KEY,current);
  return true;
}
function storePeerToken(raw){
  const currentUid=uid(),data=decodeV4(raw);if(!currentUid||!data||String(data.uid)!==currentUid)return false;
  localStorage.setItem(STANDBY_SESSION_KEY,String(raw));
  state.peerSessionReady=true;
  document.dispatchEvent(new CustomEvent('nolu:peer-session-ready',{detail:{uid:currentUid,tier:'standby',at:Date.now()}}));
  return true;
}
function hasStandbyDirty(id=uid()){return !!id&&localStorage.getItem(`${DIRTY_PREFIX}${id}`)==='1'}
function canSyncPrimary(){return !!uid()&&localStorage.getItem('puplan_guest')!=='1'&&!!sessionFor('primary')}
function markStandbyDirty(){
  const id=uid();if(!id||activeTier()!=='standby')return false;
  localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1');
  state.lastTier='standby';state.lastReason='manual-failback-required';state.peerSynced=false;
  return true;
}
function schedule(reason,delay=1200){
  clearTimeout(debounceTimer);
  if(activeTier()!=='primary'){
    state.lastTier='standby';
    if(hasStandbyDirty())state.lastReason='manual-failback-required';
    else state.lastReason='standby-active-no-reverse-sync';
    return;
  }
  if(hasStandbyDirty()){
    state.lastTier='primary';state.lastReason='manual-failback-required';state.peerSynced=false;
    return;
  }
  debounceTimer=setTimeout(()=>void sync(reason),delay);
}

async function sync(reason='periodic',force=false){
  if(state.busy)return false;
  seedPrimarySessionFromCanonical();
  const id=uid(),tier=activeTier();
  state.lastTier=tier;
  if(!id)return false;

  // Replica v3 is deliberately one-way. A standby-originated edit must never be
  // pushed automatically into Mumbai, and primary-to-standby refresh is blocked
  // while such edits are pending so stale primary data cannot overwrite Tokyo.
  if(tier!=='primary'){
    state.lastReason=hasStandbyDirty(id)?'manual-failback-required':'standby-active-no-reverse-sync';
    state.peerSynced=false;
    return false;
  }
  if(hasStandbyDirty(id)){
    state.lastReason='manual-failback-required';state.peerSynced=false;
    return false;
  }
  if(!canSyncPrimary())return false;

  const at=Date.now();if(!force&&at-state.lastAttemptAt<4000)return false;
  const session=sessionFor('primary');if(!session)return false;
  state.busy=true;state.lastAttemptAt=at;state.lastReason=reason;state.peerSessionReady=false;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
  try{
    const response=await fetch(PRIMARY_SYNC,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session}`},
      body:JSON.stringify({action:'sync_and_prewarm'}),cache:'no-store',signal:ctrl.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){state.lastError=data.message||`HTTP ${response.status}`;state.peerSynced=false;return false}
    if(data.peer_synced!==true||!storePeerToken(data.peer_token)){
      state.lastError='peer sync completed without a valid Tokyo-local session';state.peerSynced=false;return false;
    }
    state.lastSuccessAt=Date.now();state.lastPeerSyncAt=state.lastSuccessAt;state.lastError='';state.peerSynced=true;
    localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');
    document.dispatchEvent(new CustomEvent('nolu:replica-synced',{detail:{uid:id,tier:'primary',at:state.lastPeerSyncAt,peerSessionReady:true}}));
    return true;
  }catch(error){state.lastError=String(error?.message||error||'sync unavailable');state.peerSynced=false;return false}
  finally{clearTimeout(timer);state.busy=false}
}

document.addEventListener('puplan:courses-changed',()=>{if(markStandbyDirty())return;schedule('schedule-change',1400)});
document.addEventListener('puplan:profile-changed',()=>{if(markStandbyDirty())return;schedule('profile-change',900)});
document.addEventListener('nolu:session-rotated',()=>schedule('session-rotated',250));
document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')schedule('connectivity-online',450)});
document.addEventListener('nolu:peer-session-needed',()=>schedule('peer-session-needed',50));
addEventListener('online',()=>schedule('browser-online',400));
addEventListener('focus',()=>schedule('focus',650));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule('visible',650)});
setInterval(()=>{if(activeTier()==='primary'&&!hasStandbyDirty())void sync('periodic')},30000);

seedPrimarySessionFromCanonical();
if(window.PUPLAN_CLOUD?.isSignedIn?.()||uid())schedule('startup',400);
window.NOLU_REPLICATION={
  state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty,hasStandbyDirty,
  sessionFor,seedPrimarySessionFromCanonical,PRIMARY_SESSION_KEY,STANDBY_SESSION_KEY
};
