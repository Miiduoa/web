from pathlib import Path


def replace_once(path, old, new):
    p=Path(path); s=p.read_text()
    if old not in s:
        raise SystemExit(f'expected text missing in {path}: {old[:100]!r}')
    p.write_text(s.replace(old,new,1))

# transport-bridge: v8 core endpoints and a dedicated Tokyo v4 session.
p=Path('pu-plan/transport-bridge.js'); s=p.read_text()
s=s.replace("const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v7';","const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v8';")
s=s.replace("const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v7';","const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8';")
s=s.replace("const PORTABLE_KEY='puplan_portable_session_v1';","const STANDBY_SESSION_KEY='puplan_standby_session_v2';")
s=s.replace("function authTokenFor(endpoint){const primary=localStorage.getItem('puplan_session')||'',portable=localStorage.getItem(PORTABLE_KEY)||'';return endpoint===PRIMARY||endpoint===STANDBY?portable||primary:primary}","function standbyToken(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}\nfunction authTokenFor(endpoint){const primary=localStorage.getItem('puplan_session')||'';return endpoint===STANDBY?standbyToken():primary}")
s=s.replace("function ordered(action=''){\n  const prefer=localStorage.getItem('nolu_preferred_cloud_v1')==='standby';const cloud=prefer?[STANDBY,PRIMARY]:[PRIMARY,STANDBY];\n  return [...cloud,V6,CORE,LEGACY].filter((endpoint,index,array)=>array.indexOf(endpoint)===index&&!(endpoint===STANDBY&&(action==='signup'||action==='recover_password')));\n}","const PRIMARY_ONLY_ACTIONS=new Set(['signup','recover_password','change_password','rotate_recovery_code','search_people','send_request','accept_request','decline_request','remove_friend','create_meetup','respond_meetup','cancel_meetup']);\nfunction ordered(action=''){\n  const prefer=localStorage.getItem('nolu_preferred_cloud_v1')==='standby';const cloud=prefer?[STANDBY,PRIMARY]:[PRIMARY,STANDBY];\n  return [...cloud,V6,CORE,LEGACY].filter((endpoint,index,array)=>array.indexOf(endpoint)===index&&!(endpoint===STANDBY&&PRIMARY_ONLY_ACTIONS.has(action)));\n}")
s=s.replace("function storeTokens(response,endpoint){\n  if(!response?.ok)return Promise.resolve();\n  return response.clone().json().then(data=>{\n    const portable=typeof data?.portable_token==='string'?data.portable_token:endpoint===STANDBY&&typeof data?.token==='string'?data.token:'';\n    if(portable&&portable.split('.').length===2)localStorage.setItem(PORTABLE_KEY,portable);\n    if(endpoint!==STANDBY&&typeof data?.token==='string'&&data.token.split('.').length===2)localStorage.setItem('puplan_session',data.token);\n  }).catch(()=>{});\n}","function storeTokens(response,endpoint){\n  if(!response?.ok)return Promise.resolve();\n  return response.clone().json().then(data=>{\n    if(typeof data?.token!=='string'||data.token.split('.').length!==2)return;\n    if(endpoint===STANDBY)localStorage.setItem(STANDBY_SESSION_KEY,data.token);\n    else localStorage.setItem('puplan_session',data.token);\n  }).catch(()=>{});\n}")
s=s.replace("  for(const endpoint of candidates){\n    if(options.signal?.aborted)break;","  for(const endpoint of candidates){\n    if(options.signal?.aborted)break;\n    if(endpoint===STANDBY&&hasAuth(options)&&!standbyToken())continue;")
p.write_text(s)

# resilience: same v8/session split, never reuse provider-mesh portable auth for core API.
p=Path('pu-plan/resilience.js'); s=p.read_text()
s=s.replace("const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v7';","const PRIMARY='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-api-v8';")
s=s.replace("const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v7';","const STANDBY='https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8';")
s=s.replace("const VERSION='20260911-ha2';","const VERSION='20260911-ha3-session-split';")
s=s.replace("const PORTABLE_KEY='puplan_portable_session_v1';","const STANDBY_SESSION_KEY='puplan_standby_session_v2';")
s=s.replace("const NO_STANDBY_ACTIONS=new Set(['signup','recover_password']);","const NO_STANDBY_ACTIONS=new Set(['signup','recover_password','change_password','rotate_recovery_code','search_people','send_request','accept_request','decline_request','remove_friend','create_meetup','respond_meetup','cancel_meetup']);")
s=s.replace("function portableToken(){return localStorage.getItem(PORTABLE_KEY)||''}","function standbyToken(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}")
s=s.replace("function authTokenFor(api){return api===PRIMARY||api===STANDBY?portableToken()||token():token()}","function authTokenFor(api){return api===STANDBY?standbyToken():token()}")
s=s.replace("function storeResponseTokens(data,api){\n  const portable=typeof data?.portable_token==='string'?data.portable_token:api===STANDBY&&typeof data?.token==='string'?data.token:'';\n  if(portable&&portable.split('.').length===2)localStorage.setItem(PORTABLE_KEY,portable);\n  if(api!==STANDBY&&typeof data?.token==='string'&&data.token.split('.').length===2&&data.token!==token())localStorage.setItem('puplan_session',data.token);\n  if(portable||api!==STANDBY&&data?.token)document.dispatchEvent(new CustomEvent('nolu:session-rotated',{detail:{api,tier:api===STANDBY?'standby':'primary'}}));\n}","function storeResponseTokens(data,api){\n  const next=typeof data?.token==='string'&&data.token.split('.').length===2?data.token:'';\n  if(!next)return;\n  if(api===STANDBY){if(next!==standbyToken())localStorage.setItem(STANDBY_SESSION_KEY,next)}\n  else if(next!==token())localStorage.setItem('puplan_session',next);\n  document.dispatchEvent(new CustomEvent('nolu:session-rotated',{detail:{api,tier:api===STANDBY?'standby':'primary'}}));\n}")
s=s.replace("  for(const api of candidates){\n    if(options?.signal?.aborted)break;","  for(const api of candidates){\n    if(options?.signal?.aborted)break;\n    if(api===STANDBY&&hasAuthorization(options)&&!standbyToken())continue;")
p.write_text(s)

# replica-v2 browser integration: peer-local sessions are distinct from provider portable auth.
Path('pu-plan/cloud-replication.js').write_text(r'''const PRIMARY_REF='hrrmkrayvrgnwcroyttp';
const STANDBY_REF='ltfurqaspqsvswmebyzw';
const PRIMARY_REPLICA=`https://${PRIMARY_REF}.supabase.co/functions/v1/pu-plan-replica-v2`;
const STANDBY_REPLICA=`https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-replica-v2`;
const PRIMARY_SESSION_KEY='puplan_session';
const STANDBY_SESSION_KEY='puplan_standby_session_v2';
const DIRTY_PREFIX='nolu_standby_dirty_v2:';
const SEEDED_PREFIX='nolu_standby_seeded_v2:';
const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false,disabled:false,disabledReason:'',failures:0,nextAttemptAt:0};
let debounceTimer=null,periodicTimer=null;

function primaryToken(){return localStorage.getItem(PRIMARY_SESSION_KEY)||''}
function standbyToken(){return localStorage.getItem(STANDBY_SESSION_KEY)||''}
function tokenUid(raw=''){
  try{
    const [p,s,...extra]=String(raw||'').split('.');if(!p||!s||extra.length)return'';
    const normalized=p.replace(/-/g,'+').replace(/_/g,'/').padEnd(Math.ceil(p.length/4)*4,'=');
    const data=JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if(data?.v!==4||!data?.uid||!data?.iat||!data?.exp||data.exp*1000<=Date.now()||data.iat*1000>Date.now()+5*60*1000)return'';
    return String(data.uid);
  }catch{return''}
}
function uid(){
  const a=tokenUid(primaryToken()),b=tokenUid(standbyToken());
  if(a&&b&&a!==b)return'';
  return a||b||'';
}
function validPeerToken(raw,id){return !!raw&&tokenUid(raw)===id}
function activeTier(){
  const api=String(window.NOLU_RESILIENCE?.state?.activeApi||'');
  if(api.includes(STANDBY_REF))return'standby';
  if(api.includes(PRIMARY_REF))return'primary';
  return window.NOLU_RESILIENCE?.preferredCloud?.()==='standby'?'standby':'primary';
}
function authToken(tier){return tier==='standby'?standbyToken():primaryToken()}
function backoff(){return Math.min(10*60*1000,15000*Math.pow(2,Math.max(0,state.failures-1)))}
function canSync(force=false){
  if(localStorage.getItem('puplan_guest')==='1'||!uid())return false;
  if(state.disabled&&!force)return false;
  if(!force&&Date.now()<state.nextAttemptAt)return false;
  return !!authToken(activeTier());
}
function markStandbyDirty(){const id=uid();if(id&&activeTier()==='standby')localStorage.setItem(`${DIRTY_PREFIX}${id}`,'1')}
function schedule(reason,delay=1200){if(state.disabled)return;clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}
function ensurePeriodic(){if(!periodicTimer&&!state.disabled)periodicTimer=setInterval(()=>void sync('periodic'),60000)}
function disableReplication(reason,tier,endpoint){
  state.disabled=true;state.disabledReason=reason;state.peerSynced=false;state.lastError=reason;
  clearTimeout(debounceTimer);debounceTimer=null;if(periodicTimer){clearInterval(periodicTimer);periodicTimer=null}
  document.dispatchEvent(new CustomEvent('nolu:replica-disabled',{detail:{reason,tier,endpoint}}));
}
function fail(message){state.failures=Math.min(8,state.failures+1);state.peerSynced=false;state.lastError=message;state.nextAttemptAt=Date.now()+backoff()}
function succeed(){state.failures=0;state.nextAttemptAt=0;state.disabled=false;state.disabledReason='';state.lastError='';ensurePeriodic()}

async function sync(reason='periodic',force=false){
  if(state.busy||!canSync(force))return false;
  const at=Date.now();if(!force&&at-state.lastAttemptAt<4000)return false;
  const id=uid(),tier=activeTier(),endpoint=tier==='standby'?STANDBY_REPLICA:PRIMARY_REPLICA,session=authToken(tier);if(!id||!session)return false;
  state.busy=true;state.lastAttemptAt=at;state.lastReason=reason;state.lastTier=tier;
  const ctrl=new AbortController(),timer=setTimeout(()=>ctrl.abort(),7000);
  try{
    const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${session}`},body:JSON.stringify({action:'sync_and_prewarm'}),cache:'no-store',signal:ctrl.signal});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){
      const message=data.message||`HTTP ${response.status}`;
      if(response.status===410)disableReplication('跨區 replica-v2 目前未啟用',tier,endpoint);else fail(message);
      return false;
    }
    const peer=String(data.peer_token||'');
    if(data.peer_synced!==true||!validPeerToken(peer,id)){fail('備援端未回傳可驗證的對端登入憑證');return false}
    if(tier==='primary')localStorage.setItem(STANDBY_SESSION_KEY,peer);else localStorage.setItem(PRIMARY_SESSION_KEY,peer);
    succeed();state.lastSuccessAt=Date.now();state.lastPeerSyncAt=state.lastSuccessAt;state.peerSynced=true;
    localStorage.setItem(`${SEEDED_PREFIX}${id}`,'1');localStorage.removeItem(`${DIRTY_PREFIX}${id}`);
    if(tier==='standby'){
      localStorage.setItem('nolu_preferred_cloud_v1','primary');
      document.dispatchEvent(new CustomEvent('nolu:replica-primary-ready',{detail:{uid:id,at:state.lastPeerSyncAt}}));
    }
    document.dispatchEvent(new CustomEvent('nolu:session-rotated',{detail:{tier:tier==='primary'?'standby':'primary',source:'replica-v2'}}));
    document.dispatchEvent(new CustomEvent('nolu:replica-synced',{detail:{uid:id,tier,at:state.lastPeerSyncAt,protocol:'replica-v2'}}));
    return true;
  }catch(error){fail(error?.name==='AbortError'?'跨區同步逾時':String(error?.message||error||'replica-v2 unavailable'));return false}
  finally{clearTimeout(timer);state.busy=false}
}

document.addEventListener('puplan:courses-changed',()=>{markStandbyDirty();schedule('schedule-change',1400)});
document.addEventListener('puplan:profile-changed',()=>{markStandbyDirty();schedule('profile-change',900)});
document.addEventListener('nolu:session-rotated',event=>{if(event.detail?.source!=='replica-v2')schedule('session-rotated',250)});
document.addEventListener('nolu:connectivity',event=>{if(event.detail?.mode==='online')schedule('connectivity-online',500)});
addEventListener('online',()=>schedule('browser-online',500));addEventListener('focus',()=>schedule('focus',800));
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')schedule('visible',800)});
ensurePeriodic();
if(window.PUPLAN_CLOUD?.isSignedIn?.())schedule('startup',400);
window.NOLU_REPLICATION={state,sync:(reason='manual',force=true)=>sync(reason,force),activeTier,markStandbyDirty};
''')

# Provider mesh stays fail-closed until portable mint is intentionally restored.
p=Path('pu-plan/provider-config.js'); s=p.read_text()
s=s.replace("    enabled:true\n  }),","    enabled:false\n  }),",1)
s=s.replace("  Object.freeze({\n    id:'neon-singapore',","  // Portable provider authentication is intentionally disabled (HTTP 410) on\n  // both Supabase projects. Keep Neon disabled until that trust chain is restored.\n  Object.freeze({\n    id:'neon-singapore',",1)
p.write_text(s)

p=Path('pu-plan/provider-mesh.js'); s=p.read_text()
if "import {cleanAvatar} from './core/state.js';" not in s:
    s=s.replace("import {putSnapshot} from './durable-store.js';","import {putSnapshot} from './durable-store.js';\nimport {cleanAvatar} from './core/state.js';",1)
s=s.replace("  const avatar=String(profile.avatar_data||'');","  const avatar=cleanAvatar(profile.avatar_data||'');",1)
s=s.replace("    avatar_data:avatar.length<=180000?avatar:'',","    avatar_data:avatar,",1)
p.write_text(s)

Path('pu-plan/provider-status.js').write_text(r'''const $=s=>document.querySelector(s);
function ensureCard(){const grid=$('#settings .settings');if(!grid)return null;let card=$('#providerMeshCard');if(card)return card;card=document.createElement('article');card.id='providerMeshCard';card.className='setting-card';card.innerHTML=`<h3>資料備援</h3><p id="providerMeshSummary">正在檢查備援狀態…</p><div class="cloud-state" id="providerMeshState"></div><small id="providerMeshHint"></small>`;grid.append(card);return card}
function render(){
  const card=ensureCard();if(!card)return;const mesh=window.NOLU_PROVIDER_MESH?.state,replica=window.NOLU_REPLICATION?.state;
  if(!mesh){$('#providerMeshSummary').textContent='備援模組尚未啟動';return}
  const configured=[...new Set(mesh.configuredProviders||[])],healthy=[...new Set(mesh.healthyProviders||[])],target=Number(mesh.requiredRemoteProviders||3),ready=configured.length>=target;
  $('#providerMeshSummary').textContent=ready?`已設定 ${configured.length} 個獨立雲端供應商；目前偵測 ${healthy.length} 個可用。`:`目前只有 ${configured.length}/${target} 個獨立雲端供應商完成設定。`;
  $('#providerMeshState').textContent=`目標 ${target} 雲端 + 本機副本｜${configured.join(' · ')||'尚未設定'}`;
  if(ready)$('#providerMeshHint').textContent='遠端救援必須至少兩個獨立鏡像對同一版資料達成一致，避免單一故障或錯誤副本覆寫。';
  else if(replica?.peerSynced)$('#providerMeshHint').textContent='Mumbai ↔ Tokyo 的 Supabase replica-v2 已為此帳號完成同步；Neon 與 Render 的跨供應商 portable 驗證目前仍停用，因此不計入可用鏡像。';
  else $('#providerMeshHint').textContent='目前使用 Supabase 與本機 IndexedDB 保護資料；Tokyo 需先由 replica-v2 完成此帳號同步。Neon 與 Render 的 portable 驗證目前停用。';
}
document.addEventListener('nolu:provider-mesh',render);document.addEventListener('nolu:provider-recovered',render);document.addEventListener('nolu:replica-disabled',render);document.addEventListener('nolu:replica-synced',render);document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render()});setTimeout(render,0);setInterval(render,15000);
''')

# Account/logout privacy: clear all three credential classes.
p=Path('pu-plan/auth.js'); s=p.read_text()
s=s.replace("  'puplan_session','puplan_portable_session_v1','nolu_preferred_cloud_v1'","  'puplan_session','puplan_standby_session_v2','puplan_portable_session_v1','nolu_preferred_cloud_v1'",1)
p.write_text(s)

p=Path('pu-plan/cloud.js'); s=p.read_text()
s=s.replace("function clearSession(toast=true){token='';profile=null;socialLoaded=false;socialLoading=null;socialSummary={};socialData={relationships:[],profiles:[],friends:[],meetups:[]};localStorage.removeItem('puplan_session');","function clearSession(toast=true){token='';profile=null;socialLoaded=false;socialLoading=null;socialSummary={};socialData={relationships:[],profiles:[],friends:[],meetups:[]};for(const key of ['puplan_session','puplan_standby_session_v2','puplan_portable_session_v1','nolu_preferred_cloud_v1'])localStorage.removeItem(key);",1)
p.write_text(s)

p=Path('pu-plan/guest-privacy.js'); s=p.read_text()
s=s.replace("function clearPrivateAccountState(uid=''){\n  localStorage.removeItem(SESSION_KEY);","function clearPrivateAccountState(uid=''){\n  for(const key of [SESSION_KEY,'puplan_standby_session_v2','puplan_portable_session_v1','nolu_preferred_cloud_v1'])localStorage.removeItem(key);",1)
p.write_text(s)

# Remove the obsolete v7-specific quarantine wrapper now that v8 is the active core.
p=Path('pu-plan/main.js'); s=p.read_text()
start=s.find('// v7 is provisioned separately from the static app')
end=s.find('// If the database is unreachable',start)
if start<0 or end<0: raise SystemExit('v7 guard block not found in main.js')
s=s[:start]+"// Core transport now targets v8 directly; retired v7 is not in the candidate set.\n\n"+s[end:]
p.write_text(s)

p=Path('pu-plan/sw.js'); s=p.read_text().replace("const CACHE='nolu-shell-20260911-mesh2';","const CACHE='nolu-shell-20260911-ha3';",1); p.write_text(s)

print('session split + replica-v2 patch applied')
