const SESSION_KEY='puplan_session';
const GUEST_KEY='puplan_guest';
const OWNER_KEY='puplan_course_owner';
const RELOAD_STATE_KEY='nolu_account_boundary_v2';
const SIGNED_OUT_SETTLE_MS=500;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
let reloading=false,pendingSignedOut=null;

const trace=(type,details={})=>window.NOLU_AUTH_TRACE?.record?.(type,details);

function sessionUid(raw=''){
  try{
    const [payload,signature,...extra]=String(raw).split('.');
    if(!payload||!signature||extra.length)return'';
    const normalized=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    return data?.v===4&&UUID.test(String(data?.uid||''))?String(data.uid):'';
  }catch{return''}
}

function currentIdentity(){
  if(localStorage.getItem(GUEST_KEY)==='1')return'';
  return sessionUid(localStorage.getItem(SESSION_KEY)||'');
}

function transitionLabel(previous,next){
  if(previous&&next)return previous===next?'same-account':'account-switch';
  if(previous&&!next)return'signed-in->signed-out';
  if(!previous&&next)return'signed-out->signed-in';
  return'signed-out';
}

let observedIdentity=currentIdentity();

function readReloadState(){
  try{
    const value=JSON.parse(sessionStorage.getItem(RELOAD_STATE_KEY)||'null');
    return value&&typeof value==='object'?value:null;
  }catch{return null}
}

function rememberReload(reason,from,to){
  try{sessionStorage.setItem(RELOAD_STATE_KEY,JSON.stringify({reason,from,to,at:Date.now()}))}catch{}
}

function clearReloadStateAfterVerifiedSignIn(next){
  const profileId=String(window.PUPLAN_CLOUD?.getProfile?.()?.id||'');
  if(!next||window.PUPLAN_CLOUD?.isSignedIn?.()!==true||profileId!==next)return;
  try{sessionStorage.removeItem(RELOAD_STATE_KEY)}catch{}
  trace('auth-boundary-rearmed',{status:'verified-sign-in',transition:'signed-out->signed-in'});
}

function cancelPendingSignedOut(outcome='transient-restored'){
  if(!pendingSignedOut)return false;
  clearTimeout(pendingSignedOut.timer);
  trace('auth-boundary-settle',{reason:pendingSignedOut.reason,transition:'signed-in->signed-out',outcome});
  pendingSignedOut=null;
  return true;
}

function commitAccountBoundary(reason,previous,next){
  if(previous!==observedIdentity)return false;
  observedIdentity=next;
  const transition=transitionLabel(previous,next);
  trace('auth-boundary-change',{reason,transition});

  if(!previous||reloading){
    if(!previous)clearReloadStateAfterVerifiedSignIn(next);
    trace('auth-boundary-settle',{reason,transition,outcome:reloading?'reload-already-pending':'no-reload'});
    return false;
  }

  const last=readReloadState();
  if(last?.from===previous&&last?.to===next){
    document.documentElement?.setAttribute?.('data-nolu-boundary-loop-guard','1');
    trace('auth-boundary-suppressed',{reason,transition,outcome:'loop-guard'});
    return false;
  }

  reloading=true;
  rememberReload(reason,previous,next);
  trace('auth-boundary-reload',{reason,transition,reload:true});
  location.reload();
  return true;
}

function scheduleSignedOutBoundary(reason,previous){
  if(pendingSignedOut?.from===previous)return false;
  cancelPendingSignedOut('superseded');
  const pending={from:previous,reason,timer:null};
  pending.timer=setTimeout(()=>{
    if(pendingSignedOut!==pending)return;
    pendingSignedOut=null;
    const settled=currentIdentity();
    if(settled===previous){
      trace('auth-boundary-settle',{reason,transition:'signed-in->signed-out',outcome:'transient-restored'});
      return;
    }
    commitAccountBoundary(`${reason}-settled`,previous,settled);
  },SIGNED_OUT_SETTLE_MS);
  pendingSignedOut=pending;
  trace('auth-boundary-settle',{reason,transition:'signed-in->signed-out',outcome:'pending'});
  return false;
}

function enforceAccountBoundary(reason='account-change'){
  const next=currentIdentity();

  // A canonical credential may be replaced atomically by different browser/PWA
  // contexts as failover sessions rotate. Treat a very short A -> empty -> A gap as
  // transport churn, not a real logout. A -> B remains an immediate hard boundary.
  if(next===observedIdentity){
    if(pendingSignedOut&&next===pendingSignedOut.from)cancelPendingSignedOut('transient-restored');
    return false;
  }

  const previous=observedIdentity;
  if(pendingSignedOut){
    if(next===pendingSignedOut.from){cancelPendingSignedOut('transient-restored');return false}
    cancelPendingSignedOut('superseded');
  }

  if(previous&&!next&&localStorage.getItem(GUEST_KEY)!=='1'){
    return scheduleSignedOutBoundary(reason,previous);
  }

  return commitAccountBoundary(reason,previous,next);
}

document.addEventListener('puplan:profile-changed',()=>enforceAccountBoundary('profile-changed'));
window.addEventListener('storage',event=>{
  // localStorage is shared by Safari tabs and the installed PWA. Cache-owner churn
  // must never bounce those contexts against each other; only credentials matter.
  if(event.key===SESSION_KEY||event.key===GUEST_KEY)enforceAccountBoundary('cross-tab-auth');
});

window.NOLU_ACCOUNT_BOUNDARY={
  version:'20260912-account-boundary5',
  sessionKey:SESSION_KEY,
  guestKey:GUEST_KEY,
  ownerKey:OWNER_KEY,
  reloadStateKey:RELOAD_STATE_KEY,
  signedOutSettleMs:SIGNED_OUT_SETTLE_MS,
  identity:currentIdentity,
  enforce:enforceAccountBoundary
};