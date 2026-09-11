const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SYNC=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-replica-v2`;
const STANDBY_SYNC=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-replica-v2`;
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
const DIRTY_PREFIX='nolu_standby_dirty_v2:';
const SEEDED_PREFIX='nolu_standby_seeded_v2:';
const state={
  version:'20260911-replica2',busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,
  lastError:'',lastReason:'',lastTier:'',peerSynced:false,peerSessionReady:false
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
function legacyPrimarySession(){
  const id=uid(),current=canonicalToken();if(!id||!sameAccount(current,id)||localStorage.getItem('nolu_preferred_cloud_v1')==='standby')return'';
  const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'',standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
  if(sameAccount(primary,id))return primary;
  if(sameAccount(standby,id)||primary||standby)return'';
  return current;
}
function sessionFor(tier){
  const id=uid(),specific=localStorage.getItem(sessionKey(tier))||'';
  if(sameAccount(specific,id))return specific;
  return tier==='primary'?legacyPrimarySession():'';
}
function seedPrimarySessionFromCanonical(){
  const id=uid();if(!id)return false;
  const existing=localStorage.getItem(PRIMARY_SESSION_KEY)||'';if(sameAccount(existing,id))return true;
  const legacy=legacyPrimarySession();if(!legacy)return false;
  localStorage.setItem(PRIMARY_SESSION_KEY,legacy);return true;
}
function storePeerToken(sourceTier,raw){
  const currentUid=uid(),data=decodeV4(raw);if(!currentUid||!data||String(data.uid)!==currentUid)return false;
  const peerTier=sourceTier==='standby'?'primary':'standby';
  localStorage.setItem(sessionKey(peerTier),String(raw));
  state.peerSessionReady=true;
  document.dispatchEvent(new CustomEvent('nolu:peer-session-ready',{detail:{uid:currentUid,tier:peerTier,at:Date.now()}}));
  return true;
}
function canSync(){return !!uid()&&localStorage.getItem('puplan_guest')!=='1'&&!!sessionFor(activeTier())}
function markStandbyDirty(){const id=uid();if(id&&activeTier()==='standby')localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1')}
function schedule(reason,delay=1200){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}

async function sync(reason='periodic',force=false){
  if(state.busy||!canSync())return false;
  const at=Date.now();if(!force&&at-state.lastAttemptAt<4000)return false;
  seedPrimarySessionFromCanonical();
  const id=uid(),tier=activeTier(),endpoint=tier==='standby'?STANDBY_SYNC:PRIMARY_SYNC,session=sessionFor(tier);if(!id||!session)return false;
  state.busy=true;state.lastAttemptAt=at;state.lastReason=reason;state.lastTier=tier;state.peerSessionReady=false;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),8000);
  try{
    const response=await fetch(endpoint,{
      method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session}`},
      body:JSON.stringify({action:'sync_and_prewarm'}),cache:'no-store',signal:ctrl.signal
    });
    const data=await response.json().catch(()=>({}));
    if(!response.ok){state.lastError=data.message||`HTTP ${response.status}`;state.peerSynced=false;return false}
    if(data.peer_synced!==true||!storePeerToken(tier,data.peer_token)){
      state.lastError='peer sync completed without a valid peer-local session';state.peerSynced=false;return false;
    }
    state.lastSuccessAt=Date.now();state.lastPeerSyncAt=state.lastSuccessAt;state.lastError='';state.peerSynced=true;
    localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');localStorage.removeItem(`${DIRTY_PREFIX}${id}`);
    document.dispatchEvent(new CustomEvent('nolu:replica-synced',{detail:{uid:id,tier,at:state.lastPeerSyncAt,peerSessionReady:true}}));
    if(tier==='standby')document.dispatchEvent(new CustomEvent('nolu:replica-primary-ready',{detail:{uid:id,at:state.lastPeerSyncAt}}));
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
  state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty,
  sessionFor,seedPrimarySessionFromCanonical,PRIMARY_SESSION_KEY,STANDBY_SESSION_KEY
};
