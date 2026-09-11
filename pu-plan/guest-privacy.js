const SESSION_KEY='puplan_session';
const GUEST_KEY='puplan_guest';
const GUEST_SCOPE_MARKER='nolu_guest_scope_v1';
const GUEST_DURABLE_PURGE_KEY='nolu_guest_durable_purge_uid_v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_SECONDS=45*24*60*60;
const LOCAL_EXPIRED_GRACE_SECONDS=7*24*60*60;
let trackedAccountUid='';

const ACCOUNT_DATA_KEYS=[
  'puplan_courses','puplan_friends','puplan_schedule_meta','puplan_course_owner'
];
const PROFILE_KEYS=[
  'puplan_name','puplan_username','puplan_bio','puplan_avatar','puplan_discoverable'
];
const CLOUD_SESSION_KEYS=[
  'puplan_session_primary_v1','puplan_session_standby_v1','puplan_portable_session_v1','nolu_preferred_cloud_v1'
];
const RESILIENCE_PREFIXES=[
  'nolu_account_snapshot_v1:','nolu_pending_mutations_v1:',
  'nolu_standby_dirty_v1:','nolu_standby_seeded_v1:',
  'nolu_standby_dirty_v2:','nolu_standby_seeded_v2:',
  'nolu_standby_dirty_v3:','nolu_standby_seeded_v3:'
];

function clearLocal(keys){for(const key of keys)localStorage.removeItem(key)}
function clearAssistantSession(){
  for(let i=sessionStorage.length-1;i>=0;i--){
    const key=sessionStorage.key(i)||'';
    if(key.startsWith('puplan_assistant_')||key==='puplan_assistant_history')sessionStorage.removeItem(key);
  }
}
function rememberDurablePurge(uid=''){
  const id=String(uid||'').trim();
  if(UUID.test(id))sessionStorage.setItem(GUEST_DURABLE_PURGE_KEY,id);
}
function clearResilienceFor(uid=''){
  const id=String(uid||'').trim();if(!id)return;
  for(const prefix of RESILIENCE_PREFIXES)localStorage.removeItem(`${prefix}${id}`);
}
function clearPrivateCaches(uid=''){
  const ownerBefore=localStorage.getItem('puplan_course_owner')||'';
  clearLocal([...ACCOUNT_DATA_KEYS,...PROFILE_KEYS,...CLOUD_SESSION_KEYS]);
  clearResilienceFor(uid||ownerBefore);
  clearAssistantSession();
}
function quarantineRenderableCache(candidateUid=''){
  const ownerBefore=localStorage.getItem('puplan_course_owner')||'';
  clearLocal([...ACCOUNT_DATA_KEYS,...PROFILE_KEYS]);
  clearAssistantSession();
  if(ownerBefore&&candidateUid&&ownerBefore!==candidateUid){
    clearResilienceFor(ownerBefore);
    clearLocal(CLOUD_SESSION_KEYS);
  }
}
function clearPrivateRuntime(uid=''){
  const ownerBefore=localStorage.getItem('puplan_course_owner')||'';
  const targetUid=String(uid||trackedAccountUid||ownerBefore||'');
  clearPrivateCaches(targetUid);
  trackedAccountUid='';
  globalThis.window?.PUPLAN_APP?.setSelectedFriend?.(null);
  globalThis.window?.PUPLAN_APP?.render?.();
}
function clearPrivateAccountState(uid='',{purgeDurable=false}={}){
  const targetUid=String(uid||trackedAccountUid||localStorage.getItem('puplan_course_owner')||'');
  if(purgeDurable)rememberDurablePurge(targetUid);
  localStorage.removeItem(SESSION_KEY);
  clearPrivateRuntime(targetUid);
}

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
function sessionInfo(raw='',{allowRecentlyExpired=false}={}){
  try{
    const [payload,signature,...extra]=String(raw).split('.');
    if(!payload||!signature||extra.length)return null;
    const data=JSON.parse(decodeBase64UrlAscii(payload));
    const now=Math.floor(Date.now()/1000);
    if(data?.v!==4||!UUID.test(String(data?.uid||'')))return null;
    if(!Number.isFinite(data?.iat)||!Number.isFinite(data?.exp)||data.exp<=data.iat)return null;
    if(data.iat>now+300||data.exp-data.iat>MAX_SESSION_SECONDS)return null;
    if(data.exp<=now&&(!allowRecentlyExpired||now-data.exp>LOCAL_EXPIRED_GRACE_SECONDS))return null;
    if(!data.cv||String(data.cv).length>160)return null;
    return {uid:String(data.uid),iat:data.iat,exp:data.exp,expired:data.exp<=now};
  }catch{return null}
}
function sessionUid(raw=''){return sessionInfo(raw,{allowRecentlyExpired:true})?.uid||''}

const rawSession=localStorage.getItem(SESSION_KEY)||'';
const hasSession=!!rawSession;
const isGuest=localStorage.getItem(GUEST_KEY)==='1';
const owner=localStorage.getItem('puplan_course_owner')||'';

if(isGuest){
  if(localStorage.getItem(GUEST_SCOPE_MARKER)!=='1'||owner||hasSession){
    clearPrivateAccountState(owner||sessionUid(rawSession),{purgeDurable:true});
    localStorage.setItem(GUEST_KEY,'1');
    localStorage.setItem(GUEST_SCOPE_MARKER,'1');
  }
}else if(hasSession){
  const current=sessionInfo(rawSession);
  const recovery=globalThis.window?.NOLU_SESSION_RECOVERY?.result||null;
  const grace=sessionInfo(rawSession,{allowRecentlyExpired:true});
  const localGrace=recovery?.status==='local-grace'&&grace?.expired&&recovery.uid===grace.uid?grace:null;
  const candidate=current||localGrace;
  if(!candidate){
    clearPrivateAccountState(owner);
    localStorage.removeItem(GUEST_SCOPE_MARKER);
  }else{
    trackedAccountUid=candidate.uid;
    quarantineRenderableCache(candidate.uid);
    localStorage.removeItem(GUEST_SCOPE_MARKER);
  }
}else{
  clearPrivateAccountState(owner);
  localStorage.removeItem(GUEST_SCOPE_MARKER);
}

document.addEventListener('click',event=>{
  if(!event.target?.closest?.('#guestMode'))return;
  const uid=localStorage.getItem('puplan_course_owner')||trackedAccountUid||sessionUid(localStorage.getItem(SESSION_KEY)||'');
  clearPrivateAccountState(uid,{purgeDurable:true});
  localStorage.setItem(GUEST_KEY,'1');
  localStorage.setItem(GUEST_SCOPE_MARKER,'1');
  if(typeof CustomEvent==='function'&&UUID.test(String(uid||'')))document.dispatchEvent(new CustomEvent('nolu:guest-durable-purge',{detail:{uid:String(uid)}}));
},true);

document.addEventListener('puplan:profile-changed',event=>{
  if(event.detail){
    const uid=String(event.detail?.id||'');
    if(UUID.test(uid))trackedAccountUid=uid;
    return;
  }
  if(localStorage.getItem(SESSION_KEY)||localStorage.getItem(GUEST_KEY)==='1')return;
  clearPrivateRuntime();
});