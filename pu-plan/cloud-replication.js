const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SYNC=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-sync-v1`;
const STANDBY_SYNC=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-sync-v1`;
const DIRTY_PREFIX='nolu_standby_dirty_v1:';
const SEEDED_PREFIX='nolu_standby_seeded_v1:';
const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false};
let debounceTimer=null;

function token(){return localStorage.getItem('puplan_session')||''}
function uid(){
  try{
    const [p,s,...rest]=token().split('.');if(!p||!s||rest.length)return'';
    const normalized=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if(data?.v!==4||!data?.uid||!data?.exp||data.exp*1000<=Date.now())return'';
    return String(data.uid);
  }catch{return''}
}
function activeTier(){
  const api=String(window.NOLU_RESILIENCE?.state?.activeApi||'');
  if(api.includes(STANDBY_REF))return'standby';
  if(api.includes(PRIMARY_REF))return'primary';
  return window.NOLU_RESILIENCE?.preferredCloud?.()==='standby'?'standby':'primary';
}
function canSync(){return !!uid()&&localStorage.getItem('puplan_guest')!=='1'&&window.NOLU_RESILIENCE?.getMode?.()!=='offline'}
function markStandbyDirty(){const id=uid();if(id&&activeTier()==='standby')localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1')}
function schedule(reason,delay=1200){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}

async function sync(reason='periodic',force=false){
  if(state.busy||!canSync())return false;
  const at=Date.now();if(!force&&at-state.lastAttemptAt<4000)return false;
  const id=uid(),tier=activeTier(),endpoint=tier==='standby'?STANDBY_SYNC:PRIMARY_SYNC;
  state.busy=true;state.lastAttemptAt=at;state.lastReason=reason;state.lastTier=tier;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),5200);
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`},body:JSON.stringify({action:'sync'}),cache:'no-store',signal:ctrl.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){state.lastError=data.message||`HTTP ${response.status}`;state.peerSynced=false;return false}
    state.lastSuccessAt=Date.now();state.lastError='';state.peerSynced=data.peer_synced===true;
    if(data.peer_synced===true){
      state.lastPeerSyncAt=Date.now();
      if(tier==='primary'){
        localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');
        localStorage.removeItem(`${DIRTY_PREFIX}${id}`);
      }else{
        localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');
        localStorage.removeItem(`${DIRTY_PREFIX}${id}`);
        document.dispatchEvent(new CustomEvent('nolu:replica-primary-ready',{detail:{uid:id,at:state.lastPeerSyncAt}}));
      }
      document.dispatchEvent(new CustomEvent('nolu:replica-synced',{detail:{uid:id,tier,at:state.lastPeerSyncAt}}));
    }
    return data.peer_synced===true;
  }catch(error){state.lastError=String(error?.message||error||'sync unavailable');state.peerSynced=false;return false}
  finally{clearTimeout(timer);state.busy=false}
}

document.addEventListener('puplan:courses-changed',()=>{markStandbyDirty();schedule('schedule-change',1400)});
document.addEventListener('puplan:profile-changed',()=>{markStandbyDirty();schedule('profile-change',900)});
document.addEventListener('nolu:session-rotated',()=>schedule('session-rotated',150));
document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')schedule('connectivity-online',250)});
addEventListener('online',()=>schedule('browser-online',300));
addEventListener('focus',()=>schedule('focus',500));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule('visible',500)});
setInterval(()=>void sync('periodic'),30000);

if(window.PUPLAN_CLOUD?.isSignedIn?.())schedule('startup',250);
window.NOLU_REPLICATION={state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty};
