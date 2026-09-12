const CANONICAL_KEY='puplan_session';
const PRIMARY_KEY='puplan_session_primary_v1';
const STANDBY_KEY='puplan_session_standby_v1';
const PORTABLE_KEY='puplan_portable_session_v1';
const RECOVERY_STATE_KEY='nolu_session_recovery_v1';
const ACCOUNT_BOUNDARY_KEY='nolu_account_boundary_v2';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_SECONDS=45*24*60*60;
const LOCAL_EXPIRED_GRACE_SECONDS=7*24*60*60;

function parse(raw,{allowRecentlyExpired=false}={}){
  try{
    const [payload,signature,...extra]=String(raw||'').split('.');
    if(!payload||!signature||extra.length)return null;
    const normalized=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    const now=Math.floor(Date.now()/1000);
    if(data?.v!==4||!UUID.test(String(data?.uid||'')))return null;
    if(!Number.isFinite(data?.iat)||!Number.isFinite(data?.exp)||data.exp<=data.iat)return null;
    if(data.iat>now+300||data.exp-data.iat>MAX_SESSION_SECONDS)return null;
    if(data.exp<=now&&(!allowRecentlyExpired||now-data.exp>LOCAL_EXPIRED_GRACE_SECONDS))return null;
    if(!data.cv||String(data.cv).length>160)return null;
    return {raw:String(raw),uid:String(data.uid),iat:data.iat,exp:data.exp,cv:String(data.cv),expired:data.exp<=now};
  }catch{return null}
}

function writeState(result){
  sessionStorage.setItem(RECOVERY_STATE_KEY,JSON.stringify({...result,at:Date.now()}));
  return result;
}

function signedOutBoundary(){
  try{
    const state=JSON.parse(sessionStorage.getItem(ACCOUNT_BOUNDARY_KEY)||'null');
    return !!state&&typeof state==='object'&&!!state.from&&state.to==='';
  }catch{return false}
}

function clearCredentialCopies(){
  for(const key of [CANONICAL_KEY,PRIMARY_KEY,STANDBY_KEY,PORTABLE_KEY])localStorage.removeItem(key);
}

function recover(){
  // Guest mode is an explicit privacy choice and must win over every credential,
  // including a leftover canonical token from an interrupted logout/older build.
  if(localStorage.getItem('puplan_guest')==='1')return writeState({status:'guest',uid:'',recovered:false});

  // A hard account boundary that ended signed-out is authoritative for this tab.
  // Do not reconstruct a server-rejected/logout credential from regional copies on
  // the next reload; doing so recreates bootstrap -> 401 -> reload loops forever.
  if(signedOutBoundary()){
    clearCredentialCopies();
    document.documentElement.dataset.noluSessionRecovered='blocked-by-account-boundary';
    return writeState({status:'boundary-signed-out',uid:'',recovered:false});
  }

  const canonicalRaw=localStorage.getItem(CANONICAL_KEY)||'';
  const canonical=parse(canonicalRaw);
  if(canonical)return writeState({status:'canonical-ok',uid:canonical.uid,recovered:false});

  const primaryRaw=localStorage.getItem(PRIMARY_KEY)||'';
  const standbyRaw=localStorage.getItem(STANDBY_KEY)||'';
  const primary=parse(primaryRaw);
  const standby=parse(standbyRaw);
  if(primary&&standby&&primary.uid!==standby.uid)return writeState({status:'conflict',uid:'',recovered:false});

  // A current regional session is the strongest device-local anchor. Prefer the
  // primary credential because the historical IndexedDB fingerprint was normally
  // created from Mumbai; Tokyo is accepted only when it belongs to the same user.
  const currentCandidate=primary||standby;
  if(currentCandidate){
    const staleCanonical=parse(canonicalRaw,{allowRecentlyExpired:true});
    if(staleCanonical&&staleCanonical.uid!==currentCandidate.uid)return writeState({status:'conflict',uid:'',recovered:false});
    localStorage.setItem(CANONICAL_KEY,currentCandidate.raw);
    const source=primary?'primary':'standby';
    document.documentElement.dataset.noluSessionRecovered=source;
    return writeState({status:'recovered',source,uid:currentCandidate.uid,recovered:true});
  }

  // A previous auth/cache cleanup can remove only the canonical key while a
  // recently-expired regional Session v4 and the exact IndexedDB snapshot remain.
  // Restoring that token here DOES NOT make it cloud-valid. It is only a local
  // fingerprint anchor; offline-session-rescue still requires an exact, recent
  // IndexedDB snapshot before any account data can be shown.
  const staleCanonical=parse(canonicalRaw,{allowRecentlyExpired:true});
  const stalePrimary=parse(primaryRaw,{allowRecentlyExpired:true});
  const staleStandby=parse(standbyRaw,{allowRecentlyExpired:true});
  const stale=[staleCanonical,stalePrimary,staleStandby].filter(Boolean);
  const identities=new Set(stale.map(x=>x.uid));
  if(identities.size>1)return writeState({status:'conflict',uid:'',recovered:false});

  if(staleCanonical){
    document.documentElement.dataset.noluSessionRecovered='canonical-local-grace';
    return writeState({status:'local-grace',source:'canonical',uid:staleCanonical.uid,recovered:false,expired:true});
  }

  const staleCandidate=stalePrimary||staleStandby;
  if(staleCandidate){
    localStorage.setItem(CANONICAL_KEY,staleCandidate.raw);
    const source=stalePrimary?'primary-local-grace':'standby-local-grace';
    document.documentElement.dataset.noluSessionRecovered=source;
    return writeState({status:'local-grace',source,uid:staleCandidate.uid,recovered:true,expired:true});
  }

  return writeState({status:'none',uid:'',recovered:false});
}

const result=recover();
window.NOLU_SESSION_RECOVERY={
  result,recover,parse,
  version:'20260912-device-rescue3',
  localExpiredGraceSeconds:LOCAL_EXPIRED_GRACE_SECONDS
};