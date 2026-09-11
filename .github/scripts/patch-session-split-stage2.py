from pathlib import Path


def replace_once(path, old, new):
    p=Path(path)
    s=p.read_text()
    if old not in s:
        raise SystemExit(f'expected text missing in {path}: {old[:160]!r}')
    p.write_text(s.replace(old,new,1))

# resilience.js must be able to own a Tokyo-only authenticated cache. Keep the
# region credentials distinct and fail closed if two valid tokens name different users.
replace_once(
    'pu-plan/resilience.js',
    "function currentUid(){const uid=parseTokenUid();const owner=ownerId();return uid&&owner&&uid===owner?uid:''}",
    "function currentUid(){const primary=parseTokenUid(token()),standby=parseTokenUid(standbyToken());if(primary&&standby&&primary!==standby)return'';const uid=preferredCloud()==='standby'?(standby||primary):(primary||standby);const owner=ownerId();return uid&&owner&&uid===owner?uid:''}"
)
replace_once(
    'pu-plan/resilience.js',
    "  document.addEventListener('puplan:profile-changed',()=>{if(!localStorage.getItem('puplan_session')){localStorage.removeItem(PORTABLE_KEY);localStorage.removeItem(PREFERRED_KEY)}});",
    "  document.addEventListener('puplan:profile-changed',()=>{if(!token()&&!standbyToken())localStorage.removeItem(PREFERRED_KEY)});"
)
replace_once(
    'pu-plan/resilience.js',
    "window.NOLU_RESILIENCE={state,getMode:()=>state.mode,recover,flushPending,snapshot,currentUid,circuitOpen,apiCandidates,preferredCloud,setPreferredCloud,portableToken,PRIMARY,STANDBY};",
    "window.NOLU_RESILIENCE={state,getMode:()=>state.mode,recover,flushPending,snapshot,currentUid,circuitOpen,apiCandidates,preferredCloud,setPreferredCloud,PRIMARY,STANDBY};"
)

# When replica-v2 rotates from Tokyo to Mumbai (or vice versa), immediately rebind
# the exact-token durable snapshot fingerprint so offline rescue does not go stale.
replace_once(
    'pu-plan/durable-bridge.js',
    "document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')void mirror('connectivity-online')});",
    "document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')void mirror('connectivity-online')});\ndocument.addEventListener('nolu:session-rotated',()=>{void bindSession({allowHydrate:false}).then(()=>mirror('session-rotated'))});"
)

# Provider portable-token minting is currently disabled, but when restored it must
# authenticate each Supabase mint endpoint with that endpoint's own regional v4 token.
p=Path('pu-plan/provider-mesh.js')
s=p.read_text()
s=s.replace(
    "const PORTABLE_KEY='puplan_portable_session_v1';",
    "const PORTABLE_KEY='puplan_portable_session_v1';\nconst PRIMARY_REF='hrrmkrayvrgnwcroyttp';\nconst STANDBY_REF='ltfurqaspqsvswmebyzw';",
    1
)
s=s.replace(
    "function sessionToken(){return localStorage.getItem('puplan_session')||''}",
    "function primarySession(){return localStorage.getItem('puplan_session')||''}\nfunction standbySession(){return localStorage.getItem('puplan_standby_session_v2')||''}\nfunction sessionToken(){return localStorage.getItem('nolu_preferred_cloud_v1')==='standby'?(standbySession()||primarySession()):(primarySession()||standbySession())}\nfunction sessionForMintEndpoint(endpoint){const value=String(endpoint||'');if(value.includes(STANDBY_REF))return standbySession();if(value.includes(PRIMARY_REF))return primarySession();return''}",
    1
)
s=s.replace(
    "    const source=sessionToken();\n    for(const endpoint of PORTABLE_MINT_ENDPOINTS||[]){",
    "    for(const endpoint of PORTABLE_MINT_ENDPOINTS||[]){\n      const source=sessionForMintEndpoint(endpoint);if(!source)continue;",
    1
)
p.write_text(s)

# The browser smoke must wait for the module graph (including cloud.js) to finish
# before it switches auth tabs; DOMContentLoaded alone does not await module TLA.
replace_once(
    '.github/workflows/nolu-regional-session-isolation.yml',
    "              await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30000});\n              await page.locator('[data-auth-tab=\"login\"]').click();",
    "              await page.goto('http://127.0.0.1:4173/',{waitUntil:'domcontentloaded',timeout:30000});\n              await page.waitForFunction(()=>!!window.PUPLAN_CLOUD,{timeout:15000});\n              await page.locator('[data-auth-tab=\"login\"]').click();"
)
