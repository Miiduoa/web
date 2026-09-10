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
function clearPrivateCaches(){
  clearLocal([...ACCOUNT_DATA_KEYS,...PROFILE_KEYS]);
  clearAssistantSession();
}
function clearPrivateAccountState(){
  localStorage.removeItem(SESSION_KEY);
  clearPrivateCaches();
}

// Decode only enough of the custom session payload to partition local cache before
// any UI renders. This is NOT authentication: the server remains authoritative.
// Treat malformed/expired payloads as unsafe and clear private local state.
function decodeBase64UrlAscii(raw=''){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const s=String(raw).replace(/-/g,'+').replace(/_/g,'/').replace(/=+$/,'');
  let out='',buffer=0,bits=0;
  for(const ch of s){
    const value=alphabet.indexOf(ch);if(value<0)return'';
    buffer=(buffer<<6)|value;bits+=6;
    if(bits>=8){bits-=8;out+=String.fromCharCode((buffer>>bits)&255)}
  }
  return out;
}
function sessionUid(raw=''){
  try{
    const [payload,signature,...extra]=String(raw).split('.');
    if(!payload||!signature||extra.length)return'';
    const data=JSON.parse(decodeBase64UrlAscii(payload));
    if(!data?.uid||!data?.exp||Number(data.exp)*1000<=Date.now())return'';
    const uid=String(data.uid);
    return /^[A-Za-z0-9._:-]{1,100}$/.test(uid)?uid:'';
  }catch{return''}
}

const rawSession=localStorage.getItem(SESSION_KEY)||'';
const hasSession=!!rawSession;
const isGuest=localStorage.getItem(GUEST_KEY)==='1';
const owner=localStorage.getItem('puplan_course_owner')||'';

if(hasSession){
  const uid=sessionUid(rawSession);
  if(!uid){
    // Never render account-scoped cache behind a malformed or expired session.
    clearPrivateAccountState();
    localStorage.removeItem(GUEST_SCOPE_MARKER);
  }else{
    // Account switches must be isolated before app.js can render the previous
    // account. Missing ownership is also unsafe because legacy cache may remain.
    if(owner!==uid)clearPrivateCaches();
    localStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(GUEST_SCOPE_MARKER);
  }
}else if(isGuest){
  // One-time migration for guest sessions created by older builds. Those builds could
  // leave the previous account's profile/schedule cache behind, so start from a clean
  // guest scope once. If an account owner somehow survives, scrub it again even when
  // the migration marker already exists; genuine guest-created data has no owner.
  if(localStorage.getItem(GUEST_SCOPE_MARKER)!=='1'||owner){
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
