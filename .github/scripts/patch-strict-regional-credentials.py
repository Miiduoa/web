from pathlib import Path


def replace_once(path: str, old: str, new: str):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f"expected text missing in {path}: {old[:160]!r}")
    p.write_text(s.replace(old, new, 1))

# 1) Core resilience: a regional request may only use that region's v4 session.
replace_once(
    'pu-plan/resilience.js',
    """function tierSession(api){
  const current=token(),uid=parseTokenUid(current),key=api===STANDBY?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY,specific=localStorage.getItem(key)||'';
  if(uid&&parseTokenUid(specific)===uid)return specific;
  return current;
}
function authTokenFor(api){return api===STANDBY?tierSession(STANDBY):api===PRIMARY||api===COMPAT_V6||api===COMPAT_CORE?tierSession(PRIMARY):token()}
""",
    """function legacyPrimarySession(){
  const current=token(),uid=parseTokenUid(current);if(!uid||preferredCloud()==='standby')return'';
  const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'',standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
  if(parseTokenUid(primary)===uid)return primary;
  // A same-account Tokyo credential proves the canonical anchor is not safe to
  // infer as Mumbai. Invalid/stale tier slots also fail closed instead of guessing.
  if(parseTokenUid(standby)===uid||primary||standby)return'';
  localStorage.setItem(PRIMARY_SESSION_KEY,current);return current;
}
function tierSession(api){
  const uid=parseTokenUid(token());if(!uid)return'';
  const key=api===STANDBY?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY,specific=localStorage.getItem(key)||'';
  if(parseTokenUid(specific)===uid)return specific;
  return api===STANDBY?'':legacyPrimarySession();
}
function authTokenFor(api){return api===STANDBY?tierSession(STANDBY):api===PRIMARY||api===COMPAT_V6||api===COMPAT_CORE?tierSession(PRIMARY):token()}
"""
)
replace_once(
    'pu-plan/resilience.js',
    """  for(const api of candidates){
    if(options?.signal?.aborted)break;
    try{
""",
    """  for(const api of candidates){
    if(options?.signal?.aborted)break;
    if(hasAuthorization(options)&&!authTokenFor(api))continue;
    try{
"""
)
replace_once(
    'pu-plan/resilience.js',
    """async function directJson(api,action,payload={},auth=true,ms=3600){
  const headers={'Content-Type':'application/json'};if(auth&&authTokenFor(api))headers.Authorization=`Bearer ${authTokenFor(api)}`;
""",
    """async function directJson(api,action,payload={},auth=true,ms=3600){
  const headers={'Content-Type':'application/json'},regional=auth?authTokenFor(api):'';
  if(auth&&!regional)return {res:new Response(JSON.stringify({error:'REGIONAL_SESSION_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json'}}),data:{error:'REGIONAL_SESSION_UNAVAILABLE'}};
  if(regional)headers.Authorization=`Bearer ${regional}`;
"""
)

# 2) Legacy transport: same fail-closed regional routing. Canonical fallback is
# allowed only for an unambiguous legacy Mumbai installation.
replace_once(
    'pu-plan/transport-bridge.js',
    """function tierSession(endpoint){const current=localStorage.getItem('puplan_session')||'',uid=parseUid(current),key=endpoint===STANDBY?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY,specific=localStorage.getItem(key)||'';return uid&&parseUid(specific)===uid?specific:current}
function authTokenFor(endpoint){return endpoint===STANDBY?tierSession(STANDBY):endpoint===PRIMARY||endpoint===V6||endpoint===CORE||endpoint===LEGACY?tierSession(PRIMARY):localStorage.getItem('puplan_session')||''}
""",
    """function legacyPrimarySession(){const current=localStorage.getItem('puplan_session')||'',uid=parseUid(current);if(!uid||localStorage.getItem('nolu_preferred_cloud_v1')==='standby')return'';const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'',standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';if(parseUid(primary)===uid)return primary;if(parseUid(standby)===uid||primary||standby)return'';localStorage.setItem(PRIMARY_SESSION_KEY,current);return current}
function tierSession(endpoint){const current=localStorage.getItem('puplan_session')||'',uid=parseUid(current);if(!uid)return'';const key=endpoint===STANDBY?STANDBY_SESSION_KEY:PRIMARY_SESSION_KEY,specific=localStorage.getItem(key)||'';if(parseUid(specific)===uid)return specific;return endpoint===STANDBY?'':legacyPrimarySession()}
function authTokenFor(endpoint){return endpoint===STANDBY?tierSession(STANDBY):endpoint===PRIMARY||endpoint===V6||endpoint===CORE||endpoint===LEGACY?tierSession(PRIMARY):localStorage.getItem('puplan_session')||''}
"""
)
replace_once(
    'pu-plan/transport-bridge.js',
    """  for(const endpoint of candidates){
    if(options.signal?.aborted)break;
    try{
""",
    """  for(const endpoint of candidates){
    if(options.signal?.aborted)break;
    if(hasAuth(options)&&!authTokenFor(endpoint))continue;
    try{
"""
)

# 3) Replica migration: never infer a Tokyo canonical token as a Mumbai token.
replace_once(
    'pu-plan/cloud-replication.js',
    """function sessionFor(tier){
  const id=uid(),specific=localStorage.getItem(sessionKey(tier))||'';
  if(sameAccount(specific,id))return specific;
  const current=canonicalToken();
  // Historical installations only had puplan_session, which was the Mumbai token.
  // It may be used as a one-time fallback while the primary-specific slot is
  // bootstrapped, but it must never overwrite the Tokyo-local peer token.
  return tier==='primary'&&sameAccount(current,id)?current:'';
}
function seedPrimarySessionFromCanonical(){
  const current=canonicalToken(),data=decodeV4(current);if(!data)return false;
  const existing=localStorage.getItem(PRIMARY_SESSION_KEY)||'';
  if(!sameAccount(existing,String(data.uid)))localStorage.setItem(PRIMARY_SESSION_KEY,current);
  return true;
}
""",
    """function legacyPrimarySession(){
  const id=uid(),current=canonicalToken();if(!id||!sameAccount(current,id)||localStorage.getItem('nolu_preferred_cloud_v1')==='standby')return'';
  const primary=localStorage.getItem(PRIMARY_SESSION_KEY)||'',standby=localStorage.getItem(STANDBY_SESSION_KEY)||'';
  if(sameAccount(primary,id))return primary;
  if(sameAccount(standby,id)||primary||standby)return'';
  return current;
}
function sessionFor(tier){
  const id=uid(),specific=localStorage.getItem(sessionKey(tier))||'';
  if(sameAccount(specific,id))return specific;
  return tier==='primary'?legacyPrimarySession():'';
}
function seedPrimarySessionFromCanonical(){
  const id=uid();if(!id)return false;
  const existing=localStorage.getItem(PRIMARY_SESSION_KEY)||'';if(sameAccount(existing,id))return true;
  const legacy=legacyPrimarySession();if(!legacy)return false;
  localStorage.setItem(PRIMARY_SESSION_KEY,legacy);return true;
}
"""
)

# 4) Provider mesh minting: select the v4 source by mint endpoint region.
replace_once(
    'pu-plan/provider-mesh.js',
    """const encoder=new TextEncoder();
const PORTABLE_KEY='puplan_portable_session_v1';
""",
    """const encoder=new TextEncoder();
const PORTABLE_KEY='puplan_portable_session_v1';
const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_SESSION_KEY='puplan_session_primary_v1';
const STANDBY_SESSION_KEY='puplan_session_standby_v1';
"""
)
replace_once(
    'pu-plan/provider-mesh.js',
    """function tokenUid(raw=sessionToken()){
  try{
    const [payload,signature,...extra]=String(raw||'').split('.');
    if(!payload||!signature||extra.length)return'';
    const data=decodePart(payload);
    if(data?.v!==4||!data?.uid||!data?.iat||!data?.exp||data.exp*1000<=Date.now())return'';
    if(data.iat*1000>Date.now()+5*60*1000)return'';
    return String(data.uid);
  }catch{return''}
}
""",
    """function tokenUid(raw=sessionToken()){
  try{
    const [payload,signature,...extra]=String(raw||'').split('.');
    if(!payload||!signature||extra.length)return'';
    const data=decodePart(payload);
    if(data?.v!==4||!data?.uid||!data?.iat||!data?.exp||data.exp*1000<=Date.now())return'';
    if(data.iat*1000>Date.now()+5*60*1000)return'';
    return String(data.uid);
  }catch{return''}
}
function regionalSessionForEndpoint(endpoint){
  const uid=tokenUid();if(!uid)return'';
  let host='';try{host=new URL(endpoint).hostname}catch{return''}
  const key=host.startsWith(STANDBY_REF)?STANDBY_SESSION_KEY:host.startsWith(PRIMARY_REF)?PRIMARY_SESSION_KEY:'';
  if(!key)return'';const raw=localStorage.getItem(key)||'';return tokenUid(raw)===uid?raw:'';
}
"""
)
replace_once(
    'pu-plan/provider-mesh.js',
    """  mintPromise=(async()=>{
    state.minting=true;
    const source=sessionToken();
    for(const endpoint of PORTABLE_MINT_ENDPOINTS||[]){
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);
      try{
        const response=await fetch(endpoint,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${source}`},
""",
    """  mintPromise=(async()=>{
    state.minting=true;
    for(const endpoint of PORTABLE_MINT_ENDPOINTS||[]){
      const source=regionalSessionForEndpoint(endpoint);if(!source)continue;
      const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),3500);
      try{
        const response=await fetch(endpoint,{
          method:'POST',
          headers:{'Content-Type':'application/json','Authorization':`Bearer ${source}`},
"""
)

# 5) Mumbai-only feature APIs must never fall back to the canonical token. The
# replica/migration layer runs before these optional modules and seeds old clients
# only when the canonical token is unambiguously a legacy Mumbai credential.
for path, old, new in [
    ('pu-plan/admin.js', "const token=()=>localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session')||'';", "const token=()=>localStorage.getItem('puplan_session_primary_v1')||'';"),
    ('pu-plan/community.js', "const token=()=>localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session')||'';", "const token=()=>localStorage.getItem('puplan_session_primary_v1')||'';"),
    ('pu-plan/discover.js', "const token=()=>localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session')||'';", "const token=()=>localStorage.getItem('puplan_session_primary_v1')||'';"),
    ('pu-plan/privacy.js', "const privacyToken=()=>localStorage.getItem('puplan_session_primary_v1')||localStorage.getItem('puplan_session')||'';", "const privacyToken=()=>localStorage.getItem('puplan_session_primary_v1')||'';"),
]:
    replace_once(path, old, new)

# Admin probes on startup; do not emit an empty Bearer credential while a device is
# legitimately Tokyo-only and waiting for replica-v2 to create its Mumbai session.
replace_once(
    'pu-plan/admin.js',
    """async function request(action,payload={}){
  const res=await fetch(ADMIN_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${token()}`},body:JSON.stringify({action,...payload})});
""",
    """async function request(action,payload={}){
  const regional=token();if(!regional)throw new Error('主雲端登入尚未就緒');
  const res=await fetch(ADMIN_API,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${regional}`},body:JSON.stringify({action,...payload})});
"""
)

print('strict regional credential patch applied')
