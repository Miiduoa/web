const OWNER_KEY='puplan_course_owner';
let observedOwner=localStorage.getItem(OWNER_KEY)||'';
let reloading=false;

function currentOwner(){
  return localStorage.getItem(OWNER_KEY)||'';
}

function enforceAccountBoundary(reason='account-change'){
  const next=currentOwner();
  if(next===observedOwner)return false;
  const previous=observedOwner;
  observedOwner=next;

  // A first sign-in starts from an empty account context, so there is no prior
  // private in-memory state to purge. Any transition away from an established
  // owner (logout, guest mode, or A -> B account switch) gets a hard reload so
  // feature-module caches and in-flight responses cannot cross identities.
  if(!previous||reloading)return false;
  reloading=true;
  try{
    sessionStorage.setItem('nolu_account_boundary_v1',JSON.stringify({
      reason,
      from:previous,
      to:next,
      at:Date.now()
    }));
  }catch{}
  location.reload();
  return true;
}

document.addEventListener('puplan:profile-changed',()=>enforceAccountBoundary('profile-changed'));
window.addEventListener('storage',event=>{
  if(event.key===OWNER_KEY)enforceAccountBoundary('cross-tab-storage');
});

window.NOLU_ACCOUNT_BOUNDARY={
  version:'20260911-account-boundary1',
  ownerKey:OWNER_KEY,
  enforce:enforceAccountBoundary
};
