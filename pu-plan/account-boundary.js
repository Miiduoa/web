const OWNER_KEY='puplan_course_owner';
const RELOAD_STATE_KEY='nolu_account_boundary_v2';
let observedOwner=localStorage.getItem(OWNER_KEY)||'';
let reloading=false;

function currentOwner(){
  return localStorage.getItem(OWNER_KEY)||'';
}

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
  if(!next||window.PUPLAN_CLOUD?.isSignedIn?.()!==true)return;
  try{sessionStorage.removeItem(RELOAD_STATE_KEY)}catch{}
}

function enforceAccountBoundary(reason='account-change'){
  const next=currentOwner();
  if(next===observedOwner)return false;
  const previous=observedOwner;
  observedOwner=next;

  // A first verified sign-in starts from an empty account context. Re-arm the
  // guard only after cloud auth has actually established an account; transient
  // cache/session recovery must not erase a loop guard while bootstrap is failing.
  if(!previous||reloading){
    if(!previous)clearReloadStateAfterVerifiedSignIn(next);
    return false;
  }

  // The boundary survives a reload through sessionStorage. If bootstrap/durable
  // recovery reconstructs the old owner and then rejects it again, the exact same
  // transition must not reload forever. The login gate can render in-place instead.
  const last=readReloadState();
  if(last?.from===previous&&last?.to===next){
    document.documentElement?.setAttribute?.('data-nolu-boundary-loop-guard','1');
    return false;
  }

  reloading=true;
  rememberReload(reason,previous,next);
  location.reload();
  return true;
}

document.addEventListener('puplan:profile-changed',()=>enforceAccountBoundary('profile-changed'));
window.addEventListener('storage',event=>{
  if(event.key===OWNER_KEY)enforceAccountBoundary('cross-tab-storage');
});

window.NOLU_ACCOUNT_BOUNDARY={
  version:'20260912-account-boundary2',
  ownerKey:OWNER_KEY,
  reloadStateKey:RELOAD_STATE_KEY,
  enforce:enforceAccountBoundary
};
