const CANONICAL_KEY='puplan_session';
const PRIMARY_KEY='puplan_session_primary_v1';
const STANDBY_KEY='puplan_session_standby_v1';
const RECOVERY_STATE_KEY='nolu_session_recovery_v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SESSION_SECONDS=45*24*60*60;

function parse(raw){
  try{
    const [payload,signature,...extra]=String(raw||'').split('.');
    if(!payload||!signature||extra.length)return null;
    const normalized=payload.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(payload.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    const now=Math.floor(Date.now()/1000);
    if(data?.v!==4||!UUID.test(String(data?.uid||'')))return null;
    if(!Number.isFinite(data?.iat)||!Number.isFinite(data?.exp)||data.exp<=data.iat)return null;
    if(data.iat>now+300||data.exp<=now||data.exp-data.iat>MAX_SESSION_SECONDS)return null;
    if(!data.cv||String(data.cv).length>160)return null;
    return {raw:String(raw),uid:String(data.uid),iat:data.iat,exp:data.exp,cv:String(data.cv)};
  }catch{return null}
}

function recover(){
  const canonical=parse(localStorage.getItem(CANONICAL_KEY)||'');
  if(canonical){
    sessionStorage.setItem(RECOVERY_STATE_KEY,JSON.stringify({status:'canonical-ok',uid:canonical.uid,at:Date.now()}));
    return {status:'canonical-ok',uid:canonical.uid,recovered:false};
  }

  // Guest mode is an explicit privacy choice. Never silently turn it back into
  // an authenticated session merely because old regional credentials still exist.
  if(localStorage.getItem('puplan_guest')==='1'){
    sessionStorage.setItem(RECOVERY_STATE_KEY,JSON.stringify({status:'guest',at:Date.now()}));
    return {status:'guest',uid:'',recovered:false};
  }

  const primary=parse(localStorage.getItem(PRIMARY_KEY)||'');
  const standby=parse(localStorage.getItem(STANDBY_KEY)||'');
  if(primary&&standby&&primary.uid!==standby.uid){
    sessionStorage.setItem(RECOVERY_STATE_KEY,JSON.stringify({status:'conflict',at:Date.now()}));
    return {status:'conflict',uid:'',recovered:false};
  }

  // Prefer the primary credential because the durable IndexedDB snapshot was
  // historically fingerprint-bound to the canonical Mumbai session. Falling
  // back to Tokyo is allowed only when it is the sole valid regional session.
  const candidate=primary||standby;
  if(!candidate){
    sessionStorage.setItem(RECOVERY_STATE_KEY,JSON.stringify({status:'none',at:Date.now()}));
    return {status:'none',uid:'',recovered:false};
  }

  localStorage.setItem(CANONICAL_KEY,candidate.raw);
  const source=primary?'primary':'standby';
  sessionStorage.setItem(RECOVERY_STATE_KEY,JSON.stringify({status:'recovered',source,uid:candidate.uid,at:Date.now()}));
  document.documentElement.dataset.noluSessionRecovered=source;
  return {status:'recovered',source,uid:candidate.uid,recovered:true};
}

const result=recover();
window.NOLU_SESSION_RECOVERY={result,recover,parse,version:'20260911-device-rescue1'};
