from pathlib import Path


def must_replace(path, old, new, count=1):
    p=Path(path); s=p.read_text()
    if s.count(old) < count:
        raise SystemExit(f'expected text missing in {path}: {old[:100]!r}')
    p.write_text(s.replace(old,new,count))

# Keep the current Neon/PostgREST + portable-token implementation intact and only
# apply the shared strict avatar allowlist at the mirror trust boundary.
must_replace(
    'pu-plan/provider-mesh.js',
    "import {putSnapshot} from './durable-store.js';\n",
    "import {putSnapshot} from './durable-store.js';\nimport {cleanAvatar} from './core/state.js';\n"
)
must_replace(
    'pu-plan/provider-mesh.js',
    "  const avatar=String(profile.avatar_data||'');\n",
    "  const avatar=cleanAvatar(profile.avatar_data||'');\n"
)
must_replace(
    'pu-plan/provider-mesh.js',
    "    avatar_data:avatar.length<=180000?avatar:'',\n",
    "    avatar_data:avatar,\n"
)

# The retired cross-project sync endpoint currently returns 410. Probe once, then
# stop the 30s loop and event-driven retries for this browser session. Manual sync
# remains able to re-probe so the circuit can recover if the endpoint returns.
p=Path('pu-plan/cloud-replication.js'); s=p.read_text()
s=s.replace(
    "const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false};\nlet debounceTimer=null;",
    "const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false,disabled:false,disabledReason:''};\nlet debounceTimer=null,periodicTimer=null;"
)
s=s.replace(
    "function canSync(){\n  const id=uid();if(!id||localStorage.getItem('puplan_guest')==='1')return false;",
    "function canSync(force=false){\n  if(state.disabled&&!force)return false;\n  const id=uid();if(!id||localStorage.getItem('puplan_guest')==='1')return false;"
)
s=s.replace(
    "function schedule(reason,delay=1200){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}",
    "function schedule(reason,delay=1200){if(state.disabled)return;clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}\nfunction ensurePeriodic(){if(!periodicTimer&&!state.disabled)periodicTimer=setInterval(()=>void sync('periodic'),30000)}\nfunction disableReplication(reason,tier,endpoint){\n  state.disabled=true;state.disabledReason=reason;state.peerSynced=false;state.lastError=reason;\n  clearTimeout(debounceTimer);debounceTimer=null;\n  if(periodicTimer){clearInterval(periodicTimer);periodicTimer=null}\n  document.dispatchEvent(new CustomEvent('nolu:replica-disabled',{detail:{reason,tier,endpoint}}));\n}"
)
s=s.replace("if(state.busy||!canSync())return false;","if(state.busy||!canSync(force))return false;")
s=s.replace(
    "if(!response.ok){state.lastError=data.message||`HTTP ${response.status}`;state.peerSynced=false;return false}\n    state.lastSuccessAt=Date.now();state.lastError='';state.peerSynced=data.peer_synced===true;",
    "if(!response.ok){\n      const message=data.message||`HTTP ${response.status}`;\n      if(response.status===410)disableReplication('跨區同步端點目前未啟用',tier,endpoint);\n      else{state.lastError=message;state.peerSynced=false}\n      return false\n    }\n    state.disabled=false;state.disabledReason='';ensurePeriodic();\n    state.lastSuccessAt=Date.now();state.lastError='';state.peerSynced=data.peer_synced===true;"
)
s=s.replace("setInterval(()=>void sync('periodic'),30000);","ensurePeriodic();")
if "response.status===410" not in s or "clearInterval(periodicTimer)" not in s:
    raise SystemExit('cloud-replication patch did not apply')
p.write_text(s)

# Report actual failure-domain readiness. Supabase + Neon is currently two remote
# providers; Render is still missing, and a disabled Tokyo sync path is not counted
# as an independently recoverable mirror.
p=Path('pu-plan/provider-status.js'); s=p.read_text()
s=s.replace(
    "  const ready=configured.length>=target;\n",
    "  const ready=configured.length>=target;\n  const replica=window.NOLU_REPLICATION?.state;\n  const missing=['neon','render'].filter(provider=>!configured.includes(provider));\n"
)
s=s.replace(
    "    :'目前仍會使用本機 IndexedDB 與既有 Supabase 備援，但要達到真正跨供應商容錯，還需要啟用 Neon 與 Render 鏡像。';",
    "    :replica?.disabled\n      ?`本機 IndexedDB 持續保護資料；Tokyo 跨區同步目前未啟用，不計為可接管的遠端副本。${missing.length?`尚未完成：${missing.join('、')}。`:''}`\n      :`目前已設定 ${configured.length}/${target} 個獨立遠端供應商；${missing.length?`尚未完成：${missing.join('、')}。`:''}只有達成遠端 quorum 才會自動救援。`;"
)
s=s.replace(
    "document.addEventListener('nolu:provider-recovered',render);",
    "document.addEventListener('nolu:provider-recovered',render);\ndocument.addEventListener('nolu:replica-disabled',render);\ndocument.addEventListener('nolu:replica-synced',render);"
)
if "Tokyo 跨區同步目前未啟用" not in s or "missing=['neon','render']" not in s:
    raise SystemExit('provider-status patch did not apply')
p.write_text(s)

print('mesh security/product patch applied')
