const SESSION_KEY='puplan_session';
const STANDBY_SESSION_KEY='puplan_standby_session_v2';
const GUEST_KEY='puplan_guest';
const GUEST_SCOPE_MARKER='nolu_guest_scope_v1';

const ACCOUNT_DATA_KEYS=[
  'puplan_courses','puplan_friends','puplan_schedule_meta','puplan_course_owner'
];
const PROFILE_KEYS=[
  'puplan_name','puplan_username','puplan_bio','puplan_avatar','puplan_discoverable'
];
const RESILIENCE_PREFIXES=['nolu_account_snapshot_v1:','nolu_pending_mutations_v1:'];

function clearLocal(keys){for(const key of keys)localStorage.removeItem(key)}
function clearAssistantSession(){
  for(let i=sessionStorage.length-1;i>=0;i--){
    const key=sessionStorage.key(i)||'';
    if(key.startsWith('puplan_assistant_')||key==='puplan_assistant_history')sessionStorage.removeItem(key);
  }
}
function clearResilienceFor(uid=''){
  const id=String(uid||'').trim();if(!id)return;
  for(const prefix of RESILIENCE_PREFIXES)localStorage.removeItem(`${prefix}${id}`);
}
function clearPrivateCaches(uid=''){
  const ownerBefore=localStorage.getItem('puplan_course_owner')||'';
  clearLocal([...ACCOUNT_DATA_KEYS,...PROFILE_KEYS]);
  clearResilienceFor(uid||ownerBefore);
  clearAssistantSession();
}
function clearPrivateRuntime(uid=''){
  const ownerBefore=localStorage.getItem('puplan_course_owner')||'';
  clearPrivateCaches(uid||ownerBefore);
  // Runtime state is storage-backed. Re-render after the purge so data that was
  // already painted before an authoritative 401 cannot remain visible.
  globalThis.window?.PUPLAN_APP?.setSelectedFriend?.(null);
  globalThis.window?.PUPLAN_APP?.render?.();
}
function clearPrivateAccountState(uid=''){
  for(const key of [SESSION_KEY,'puplan_standby_session_v2','puplan_portable_session_v1','nolu_preferred_cloud_v1'])localStorage.removeItem(key);
  clearPrivateRuntime(uid);
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

const rawPrimary=localStorage.getItem(SESSION_KEY)||'';
const rawStandby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
let primaryUid=sessionUid(rawPrimary),standbyUid=sessionUid(rawStandby);
if(rawPrimary&&!primaryUid)localStorage.removeItem(SESSION_KEY);
if(rawStandby&&!standbyUid)localStorage.removeItem(STANDBY_SESSION_KEY);
const sessionConflict=!!(primaryUid&&standbyUid&&primaryUid!==standbyUid);
const activeUid=sessionConflict?'':(primaryUid||standbyUid);
const hasSession=!!activeUid;
const isGuest=localStorage.getItem(GUEST_KEY)==='1';
const owner=localStorage.getItem('puplan_course_owner')||'';

if(sessionConflict){
  // Two region credentials for different accounts must never share one browser cache.
  clearPrivateAccountState(owner);
  localStorage.removeItem(GUEST_SCOPE_MARKER);
}else if(hasSession){
  // Account switches must be isolated before app.js can render the previous account.
  if(owner!==activeUid)clearPrivateCaches(owner);
  localStorage.removeItem(GUEST_KEY);
  localStorage.removeItem(GUEST_SCOPE_MARKER);
}else if(isGuest){
  // One-time migration for guest sessions created by older builds. Those builds could
  // leave the previous account's profile/schedule cache behind, so start from a clean
  // guest scope once. If an account owner somehow survives, scrub it again even when
  // the migration marker already exists; genuine guest-created data has no owner.
  if(localStorage.getItem(GUEST_SCOPE_MARKER)!=='1'||owner){
    clearPrivateAccountState(owner);
    localStorage.setItem(GUEST_KEY,'1');
    localStorage.setItem(GUEST_SCOPE_MARKER,'1');
  }
}else{
  // No authenticated or guest session means no private account data should be visible.
  clearPrivateAccountState(owner);
  localStorage.removeItem(GUEST_SCOPE_MARKER);
}

// Run before cloud.js' guest button handler. This guarantees that updateAccountUI()
// cannot repopulate guest mode from the account that was active moments earlier.
document.addEventListener('click',event=>{
  if(!event.target?.closest?.('#guestMode'))return;
  const uid=localStorage.getItem('puplan_course_owner')||sessionUid(localStorage.getItem(SESSION_KEY)||'')||sessionUid(localStorage.getItem(STANDBY_SESSION_KEY)||'');
  clearPrivateAccountState(uid);
  localStorage.setItem(GUEST_KEY,'1');
  localStorage.setItem(GUEST_SCOPE_MARKER,'1');
},true);

// A syntactically valid token can still be forged, revoked, or otherwise rejected by
// the server. cloud.js removes the session before emitting this event on a 401. Keep
// offline cache when a session still exists, but once authoritative auth rejects it,
// scrub the browser state and repaint from empty storage immediately.
document.addEventListener('puplan:profile-changed',event=>{
  if(event.detail)return;
  if(localStorage.getItem(SESSION_KEY)||localStorage.getItem(GUEST_KEY)==='1')return;
  clearPrivateRuntime();
});
