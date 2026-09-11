const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_REPLICA=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-replica-v2`;
const STANDBY_REPLICA=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-replica-v2`;
const PRIMARY_SESSION_KEY='puplan_session';
const STANDBY_SESSION_KEY='puplan_standby_session_v2';
const DIRTY_PREFIX='nolu_standby_dirty_v2:';
const SEEDED_PREFIX='nolu_standby_seeded_v2:';
const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false,disabled:false,disabledReason:'',failures:0,nextAttemptAt:0};
let debounceTimer=null,periodicTimer=null;

function primaryToken(){return localStorage.getItem(PRIMARY_SESSION_KEY)||''}
function standbyToken(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}
function tokenUid(raw=''){
  try{
    const [p,s,...extra]=String(raw||'').split('.');if(!p||!s||extra.length)return'';
    const normalized=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if(data?.v!==4||!data?.uid||!data?.iat||!data?.exp||data.exp*1000<=Date.now()||data.iat*1000>Date.now()+5*60*1000)return'';
    return String(data.uid);
  }catch{return''}
}
function uid(){
  const a=tokenUid(primaryToken()),b=tokenUid(standbyToken());
  if(a&&b&&a!==b)return'';
  return a||b||'';
}
function validPeerToken(raw,id){return !!raw&&tokenUid(raw)===id}
function activeTier(){
  const api=String(window.NOLU_RESILIENCE?.state?.activeApi||'');
  if(api.includes(STANDBY_REF))return'standby';
  if(api.includes(PRIMARY_REF))return'primary';
  return window.NOLU_RESILIENCE?.preferredCloud?.()==='standby'?'standby':'primary';
}
function authToken(tier){return tier==='standby'?standbyToken():primaryToken()}
function backoff(){return Math.min(10*60*1000,15000*Math.pow(2,Math.max(0,state.failures-1)))}
function canSync(force=false){
  if(localStorage.getItem('puplan_guest')==='1'||!uid())return false;
  if(state.disabled&&!force)return false;
  if(!force&&Date.now()<state.nextAttemptAt)return false;
  return !!authToken(activeTier());
}
function markStandbyDirty(){const id=uid();if(id&&activeTier()==='standby')localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1')}
function schedule(reason,delay=1200){if(state.disabled)return;clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}
function ensurePeriodic(){if(!periodicTimer&&!state.disabled)periodicTimer=setInterval(()=>void sync('periodic'),60000)}
function disableReplication(reason,tier,endpoint){
  state.disabled=true;state.disabledReason=reason;state.peerSynced=false;state.lastError=reason;
  clearTimeout(debounceTimer);debounceTimer=null;if(periodicTimer){clearInterval(periodicTimer);periodicTimer=null}
  document.dispatchEvent(new CustomEvent('nolu:replica-disabled',{detail:{reason,tier,endpoint}}));
}
function fail(message){state.failures=Math.min(8,state.failures+1);state.peerSynced=false;state.lastError=message;state.nextAttemptAt=Date.now()+backoff()}
function succeed(){state.failures=0;state.nextAttemptAt=0;state.disabled=false;state.disabledReason='';state.lastError='';ensurePeriodic()}

async function sync(reason='periodic',force=false){
  if(state.busy||!canSync(force))return false;
  const at=Date.now();if(!force&&at-state.lastAttemptAt<4000)return false;
  const id=uid(),tier=activeTier(),endpoint=tier==='standby'?STANDBY_REPLICA:PRIMARY_REPLICA,session=authToken(tier);if(!id||!session)return false;
  state.busy=true;state.lastAttemptAt=at;state.lastReason=reason;state.lastTier=tier;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),7000);
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session}`},body:JSON.stringify({action:'sync_and_prewarm'}),cache:'no-store',signal:ctrl.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=data.message||`HTTP ${response.status}`;
      if(response.status===410)disableReplication('跨區 replica-v2 目前未啟用',tier,endpoint);else fail(message);
      return false;
    }
    const peer=String(data.peer_token||'');
    if(data.peer_synced!==true||!validPeerToken(peer,id)){fail('備援端未回傳可驗證的對端登入憑證');return false}
    if(tier==='primary')localStorage.setItem(STANDBY_SESSION_KEY,peer);else localStorage.setItem(PRIMARY_SESSION_KEY,peer);
    succeed();state.lastSuccessAt=Date.now();state.lastPeerSyncAt=state.lastSuccessAt;state.peerSynced=true;
    localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');localStorage.removeItem(`${DIRTY_PREFIX}${id}`);
    if(tier==='standby'){
      localStorage.setItem('nolu_preferred_cloud_v1','primary');
      document.dispatchEvent(new CustomEvent('nolu:replica-primary-ready',{detail:{uid:id,at:state.lastPeerSyncAt}}));
    }
    document.dispatchEvent(new CustomEvent('nolu:session-rotated',{detail:{tier:tier==='primary'?'standby':'primary',source:'replica-v2'}}));
    document.dispatchEvent(new CustomEvent('nolu:replica-synced',{detail:{uid:id,tier,at:state.lastPeerSyncAt,protocol:'replica-v2'}}));
    return true;
  }catch(error){fail(error?.name==='AbortError'?'跨區同步逾時':String(error?.message||error||'replica-v2 unavailable'));return false}
  finally{clearTimeout(timer);state.busy=false}
}

document.addEventListener('puplan:courses-changed',()=>{markStandbyDirty();schedule('schedule-change',1400)});
document.addEventListener('puplan:profile-changed',()=>{markStandbyDirty();schedule('profile-change',900)});
document.addEventListener('nolu:session-rotated',event=>{if(event.detail?.source!=='replica-v2')schedule('session-rotated',250)});
document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')schedule('connectivity-online',500)});
addEventListener('online',()=>schedule('browser-online',500));addEventListener('focus',()=>schedule('focus',800));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule('visible',800)});
ensurePeriodic();
if(window.PUPLAN_CLOUD?.isSignedIn?.())schedule('startup',400);
window.NOLU_REPLICATION={state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty};
