from pathlib import Path


def replace_once(path, old, new):
    p=Path(path)
    s=p.read_text()
    if old not in s:
        raise SystemExit(f'expected text missing in {path}: {old[:120]!r}')
    p.write_text(s.replace(old,new,1))

# Never send an authenticated request to a region when that region's own v4 token
# is absent. In particular, do not let cloud.js' runtime Tokyo token leak to Mumbai.
replace_once('pu-plan/transport-bridge.js',
"    if(endpoint===STANDBY&&hasAuth(options)&&!standbyToken())continue;",
"    if(hasAuth(options)&&!authTokenFor(endpoint))continue;")
replace_once('pu-plan/resilience.js',
"    if(api===STANDBY&&hasAuthorization(options)&&!standbyToken())continue;",
"    if(hasAuthorization(options)&&!authTokenFor(api))continue;")

# cloud.js may be authenticated solely by Tokyo during a Mumbai outage. Keep the
# runtime token usable, but persist it under the region-specific key selected by
# the resilience layer instead of always overwriting puplan_session.
p=Path('pu-plan/cloud.js'); s=p.read_text()
s=s.replace("const APIS=[API_PRIMARY,API_FALLBACK];\nconst $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];\nconst app=window.PUPLAN_APP;\nlet token=localStorage.getItem('puplan_session')||'', profile=null;",
"const APIS=[API_PRIMARY,API_FALLBACK];\nconst STANDBY_REF='ltfurqaspqsvswmebyzw';\nconst STANDBY_SESSION_KEY='puplan_standby_session_v2';\nconst $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];\nconst app=window.PUPLAN_APP;\nfunction primaryToken(){return localStorage.getItem('puplan_session')||''}\nfunction standbyToken(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}\nfunction preferredStoredToken(){return localStorage.getItem('nolu_preferred_cloud_v1')==='standby'?(standbyToken()||primaryToken()):(primaryToken()||standbyToken())}\nfunction responseTier(){return String(window.NOLU_RESILIENCE?.state?.activeApi||'').includes(STANDBY_REF)?'standby':'primary'}\nfunction persistRuntimeToken(next){\n  token=String(next||'');if(!token)return;\n  if(responseTier()==='standby'){localStorage.setItem(STANDBY_SESSION_KEY,token);localStorage.setItem('nolu_preferred_cloud_v1','standby')}\n  else localStorage.setItem('puplan_session',token);\n}\nlet token=preferredStoredToken(), profile=null;")
s=s.replace("async function login(email,password){const data=await api('login',{email,password},false);token=data.token;localStorage.setItem('puplan_session',token);localStorage.removeItem('puplan_guest');applyCoreBundle(data);hideGate();return data}\nasync function signup(display_name,username,email,password){const data=await api('signup',{display_name,username,email,password},false);token=data.token;localStorage.setItem('puplan_session',token);localStorage.removeItem('puplan_guest');applyCoreBundle(data);hideGate();return data}",
"async function login(email,password){const data=await api('login',{email,password},false);persistRuntimeToken(data.token);localStorage.removeItem('puplan_guest');applyCoreBundle(data);hideGate();return data}\nasync function signup(display_name,username,email,password){const data=await api('signup',{display_name,username,email,password},false);persistRuntimeToken(data.token);localStorage.removeItem('puplan_guest');applyCoreBundle(data);hideGate();return data}")
s=s.replace("document.addEventListener('puplan:courses-changed',e=>queueSchedule(e.detail||[]));",
"document.addEventListener('puplan:courses-changed',e=>queueSchedule(e.detail||[]));\ndocument.addEventListener('nolu:session-rotated',()=>{const next=preferredStoredToken();if(next)token=next});")
p.write_text(s)

# Pre-render privacy partitioning accepts either regional v4 token, removes only
# malformed/expired regional credentials, and fails closed on cross-account conflict.
p=Path('pu-plan/guest-privacy.js'); s=p.read_text()
s=s.replace("const SESSION_KEY='puplan_session';\nconst GUEST_KEY='puplan_guest';",
"const SESSION_KEY='puplan_session';\nconst STANDBY_SESSION_KEY='puplan_standby_session_v2';\nconst GUEST_KEY='puplan_guest';")
old="""const rawSession=localStorage.getItem(SESSION_KEY)||'';
const hasSession=!!rawSession;
const isGuest=localStorage.getItem(GUEST_KEY)==='1';
const owner=localStorage.getItem('puplan_course_owner')||'';

if(hasSession){
  const uid=sessionUid(rawSession);
  if(!uid){
    // Never render account-scoped cache behind a malformed or expired session.
    clearPrivateAccountState(owner);
    localStorage.removeItem(GUEST_SCOPE_MARKER);
  }else{
    // Account switches must be isolated before app.js can render the previous
    // account. Missing ownership is also unsafe because legacy cache may remain.
    if(owner!==uid)clearPrivateCaches(owner);
    localStorage.removeItem(GUEST_KEY);
    localStorage.removeItem(GUEST_SCOPE_MARKER);
  }
}else if(isGuest){"""
new="""const rawPrimary=localStorage.getItem(SESSION_KEY)||'';
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
}else if(isGuest){"""
if old not in s: raise SystemExit('guest-privacy session block missing')
s=s.replace(old,new,1)
s=s.replace("  const uid=localStorage.getItem('puplan_course_owner')||sessionUid(localStorage.getItem(SESSION_KEY)||'');",
"  const uid=localStorage.getItem('puplan_course_owner')||sessionUid(localStorage.getItem(SESSION_KEY)||'')||sessionUid(localStorage.getItem(STANDBY_SESSION_KEY)||'');")
p.write_text(s)

# Durable/offline rescue must bind to whichever regional session is currently
# preferred, while retaining an exact token fingerprint for local snapshot trust.
replace_once('pu-plan/durable-bridge.js',
"function rawToken(){return localStorage.getItem('puplan_session')||''}",
"function rawToken(){const primary=localStorage.getItem('puplan_session')||'',standby=localStorage.getItem('puplan_standby_session_v2')||'';return localStorage.getItem('nolu_preferred_cloud_v1')==='standby'?(standby||primary):(primary||standby)}")
replace_once('pu-plan/offline-session-rescue.js',
"  const raw=localStorage.getItem('puplan_session')||'';const session=parseSession(raw);if(!session)return null;",
"  const primary=localStorage.getItem('puplan_session')||'',standby=localStorage.getItem('puplan_standby_session_v2')||'';\n  const raw=localStorage.getItem('nolu_preferred_cloud_v1')==='standby'?(standby||primary):(primary||standby);const session=parseSession(raw);if(!session)return null;")

# Touch v2: workflow must exist before this push so the one-shot runner triggers.
