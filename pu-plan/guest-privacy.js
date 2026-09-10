const SESSION_KEY='puplan_session';
const GUEST_KEY='puplan_guest';
const GUEST_SCOPE_MARKER='nolu_guest_scope_v1';

const ACCOUNT_DATA_KEYS=[
  'puplan_courses','puplan_friends','puplan_schedule_meta','puplan_course_owner'
];
const PROFILE_KEYS=[
  'puplan_name','puplan_username','puplan_bio','puplan_avatar','puplan_discoverable'
];

function clearLocal(keys){for(const key of keys)localStorage.removeItem(key)}
function clearAssistantSession(){
  for(let i=sessionStorage.length-1;i>=0;i--){
    const key=sessionStorage.key(i)||'';
    if(key.startsWith('puplan_assistant_')||key==='puplan_assistant_history')sessionStorage.removeItem(key);
  }
}
function clearPrivateAccountState(){
  clearLocal([SESSION_KEY,...ACCOUNT_DATA_KEYS,...PROFILE_KEYS]);
  clearAssistantSession();
}

const hasSession=!!localStorage.getItem(SESSION_KEY);
const isGuest=localStorage.getItem(GUEST_KEY)==='1';

if(hasSession){
  // A signed-in session owns the account-scoped cache. Guest data is never reused here.
  localStorage.removeItem(GUEST_SCOPE_MARKER);
}else if(isGuest){
  // One-time migration for guest sessions created by older builds. Those builds could
  // leave the previous account's profile/schedule cache behind, so start from a clean
  // guest scope once. New guest data then remains local across later reloads.
  if(localStorage.getItem(GUEST_SCOPE_MARKER)!=='1'){
    clearPrivateAccountState();
    localStorage.setItem(GUEST_KEY,'1');
    localStorage.setItem(GUEST_SCOPE_MARKER,'1');
  }
}else{
  // No authenticated or guest session means no private account data should be visible.
  clearPrivateAccountState();
  localStorage.removeItem(GUEST_SCOPE_MARKER);
}

// Run before cloud.js' guest button handler. This guarantees that updateAccountUI()
// cannot repopulate guest mode from the account that was active moments earlier.
document.addEventListener('click',event=>{
  if(!event.target?.closest?.('#guestMode'))return;
  clearPrivateAccountState();
  localStorage.setItem(GUEST_KEY,'1');
  localStorage.setItem(GUEST_SCOPE_MARKER,'1');
},true);
