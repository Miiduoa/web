from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    s = p.read_text()
    if old not in s:
        raise SystemExit(f'expected text missing in {path}: {old[:80]!r}')
    p.write_text(s.replace(old, new, 1))

# 1) Retired cross-project sync must stop generating repeated requests after HTTP 410.
p = Path('pu-plan/cloud-replication.js')
s = p.read_text()
s = s.replace(
    "const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false};\nlet debounceTimer=null;",
    "const state={busy:false,lastAttemptAt:0,lastSuccessAt:0,lastPeerSyncAt:0,lastError:'',lastReason:'',lastTier:'',peerSynced:false,disabled:false,disabledReason:''};\nlet debounceTimer=null,periodicTimer=null;"
)
s = s.replace(
    "function canSync(){\n  const id=uid();if(!id||localStorage.getItem('puplan_guest')==='1')return false;",
    "function canSync(force=false){\n  if(state.disabled&&!force)return false;\n  const id=uid();if(!id||localStorage.getItem('puplan_guest')==='1')return false;"
)
s = s.replace(
    "function schedule(reason,delay=1200){clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}",
    "function schedule(reason,delay=1200){if(state.disabled)return;clearTimeout(debounceTimer);debounceTimer=setTimeout(()=>void sync(reason),delay)}\nfunction ensurePeriodic(){if(!periodicTimer&&!state.disabled)periodicTimer=setInterval(()=>void sync('periodic'),30000)}\nfunction disableReplication(reason,tier,endpoint){\n  state.disabled=true;state.disabledReason=reason;state.peerSynced=false;state.lastError=reason;\n  clearTimeout(debounceTimer);debounceTimer=null;\n  if(periodicTimer){clearInterval(periodicTimer);periodicTimer=null}\n  document.dispatchEvent(new CustomEvent('nolu:replica-disabled',{detail:{reason,tier,endpoint}}));\n}"
)
s = s.replace(
    "if(state.busy||!canSync())return false;",
    "if(state.busy||!canSync(force))return false;"
)
s = s.replace(
    "if(!response.ok){state.lastError=data.message||`HTTP ${response.status}`;state.peerSynced=false;return false}\n    state.lastSuccessAt=Date.now();state.lastError='';state.peerSynced=data.peer_synced===true;",
    "if(!response.ok){\n      const message=data.message||`HTTP ${response.status}`;\n      if(response.status===410)disableReplication('跨區同步端點目前未啟用',tier,endpoint);\n      else{state.lastError=message;state.peerSynced=false}\n      return false\n    }\n    state.disabled=false;state.disabledReason='';ensurePeriodic();\n    state.lastSuccessAt=Date.now();state.lastError='';state.peerSynced=data.peer_synced===true;"
)
s = s.replace(
    "setInterval(()=>void sync('periodic'),30000);",
    "ensurePeriodic();"
)
p.write_text(s)

# 2) Provider status must not imply that an unseeded Tokyo project is already a usable backup.
p = Path('pu-plan/provider-status.js')
s = p.read_text()
s = s.replace(
    "const ready=configured.length>=target;",
    "const ready=configured.length>=target;\n  const replica=window.NOLU_REPLICATION?.state;"
)
s = s.replace(
    ":'目前仍會使用本機 IndexedDB 與既有 Supabase 備援，但要達到真正跨供應商容錯，還需要啟用 Neon 與 Render 鏡像。';",
    ":replica?.disabled\n      ?'目前以本機 IndexedDB 保護資料；Tokyo 跨區同步端點尚未啟用，因此不把它視為可接管的遠端副本。Neon 與 Render 鏡像也尚未啟用。'\n      :'目前只有 Supabase 這一個遠端供應商與本機 IndexedDB；必須完成可驗證的異地同步並啟用 Neon、Render 後，才算跨供應商容錯。';"
)
s = s.replace(
    "document.addEventListener('nolu:provider-recovered',render);",
    "document.addEventListener('nolu:provider-recovered',render);\ndocument.addEventListener('nolu:replica-disabled',render);\ndocument.addEventListener('nolu:replica-synced',render);"
)
p.write_text(s)

# 3) Future independent mirrors must pass remote avatars through the same strict allowlist.
p = Path('pu-plan/provider-mesh.js')
s = p.read_text()
s = s.replace(
    "import {putSnapshot} from './durable-store.js';",
    "import {putSnapshot} from './durable-store.js';\nimport {cleanAvatar} from './core/state.js';"
)
s = s.replace(
    "  const avatar=String(profile.avatar_data||'');",
    "  const avatar=cleanAvatar(profile.avatar_data||'');"
)
s = s.replace(
    "    avatar_data:avatar.length<=180000?avatar:'',",
    "    avatar_data:avatar,"
)
p.write_text(s)

# 4) Strengthen provider-mesh CI with a hostile remote avatar.
p = Path('.github/workflows/nolu-provider-mesh-smoke.yml')
s = p.read_text()
s = s.replace(
    "profile:{id:uid,display_name:'Mesh Test',username:'mesh_test',bio:'',avatar_data:'',discoverable:true,role:'user',profile_visibility:'public'},",
    "profile:{id:uid,display_name:'Mesh Test',username:'mesh_test',bio:'',avatar_data:'data:image/svg+xml,<svg onload=alert(1)>',discoverable:true,role:'user',profile_visibility:'public'},"
)
s = s.replace(
    "assert(stored?.courses?.[0]?.name==='遠端雙副本課程','quorum recovery should persist the agreed remote snapshot');",
    "assert(stored?.courses?.[0]?.name==='遠端雙副本課程','quorum recovery should persist the agreed remote snapshot');\n              assert(stored?.profile?.avatar_data==='', 'unsafe remote mirror avatar must be stripped before local recovery');"
)
s = s.replace(
    "assert(writes.neon.at(-1)?.uid===uid&&writes.render.at(-1)?.uid===uid,'both mirrors must receive only the current account snapshot');",
    "assert(writes.neon.at(-1)?.uid===uid&&writes.render.at(-1)?.uid===uid,'both mirrors must receive only the current account snapshot');\n              assert(writes.neon.at(-1)?.profile?.avatar_data===''&&writes.render.at(-1)?.profile?.avatar_data==='', 'unsafe avatar must never fan out to mirrors');"
)
p.write_text(s)

# 5) Replace the old synthetic-success hot-standby test with a production-truthful fail-safe test.
Path('.github/workflows/nolu-hot-standby-smoke.yml').write_text(r'''name: nolu standby fail-safe smoke

on:
  push:
    branches: [main, fix/nolu-replication-retired-sync-20260911]
    paths:
      - 'pu-plan/resilience.js'
      - 'pu-plan/transport-bridge.js'
      - 'pu-plan/cloud-replication.js'
      - 'pu-plan/provider-status.js'
      - 'supabase/functions/pu-plan-api-v8/**'
      - '.github/workflows/nolu-hot-standby-smoke.yml'
  pull_request:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read

jobs:
  standby-fail-safe:
    runs-on: ubuntu-24.04
    timeout-minutes: 7
    steps:
      - uses: actions/checkout@v6

      - name: Syntax and topology guardrails
        run: |
          set -euo pipefail
          node --check pu-plan/resilience.js
          node --check pu-plan/transport-bridge.js
          node --check pu-plan/cloud-replication.js
          node --check pu-plan/provider-status.js
          grep -q "response.status===410" pu-plan/cloud-replication.js
          grep -q "state.disabled" pu-plan/cloud-replication.js
          grep -q "clearInterval(periodicTimer)" pu-plan/cloud-replication.js
          grep -q "Tokyo 跨區同步端點尚未啟用" pu-plan/provider-status.js

      - name: Install Playwright
        run: |
          npm --prefix /tmp/nolu-standby init -y >/dev/null 2>&1
          npm --prefix /tmp/nolu-standby install playwright >/dev/null 2>&1
          cd /tmp/nolu-standby && npx playwright install --with-deps chromium >/dev/null

      - name: Retired sync endpoint must trip a client-side circuit breaker
        env:
          NODE_PATH: /tmp/nolu-standby/node_modules
        run: |
          cat >pu-plan/__replication_retired_test.html <<'HTML'
          <!doctype html><meta charset="utf-8"><body><script>
          window.NOLU_RESILIENCE={
            state:{activeApi:'https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v7'},
            getMode:()=> 'online',
            preferredCloud:()=> 'standby'
          };
          window.PUPLAN_CLOUD={isSignedIn:()=>true};
          </script><script type="module" src="./cloud-replication.js"></script></body>
          HTML
          python3 -m http.server 4174 --directory pu-plan >/tmp/nolu-standby-http.log 2>&1 &
          cat >/tmp/nolu-standby/check.cjs <<'NODE'
          const {chromium}=require('playwright');
          const assert=(ok,msg)=>{if(!ok)throw new Error(msg)};
          const b64=s=>Buffer.from(s).toString('base64url');
          const uid='55555555-5555-4555-8555-555555555555';
          const now=Math.floor(Date.now()/1000);
          const primary=`${b64(JSON.stringify({v:4,uid,iat:now,exp:now+3600,cv:'replica-test'}))}.${b64('primary-signature')}`;
          const portable=`${b64(JSON.stringify({v:4,uid,iat:now,exp:now+3600,cv:'replica-test'}))}.${b64('tokyo-signature')}`;
          (async()=>{
            const browser=await chromium.launch({headless:true});
            try{
              const context=await browser.newContext();
              let syncRequests=0;
              await context.route('https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-sync-v1',route=>{
                syncRequests++;
                return route.fulfill({status:410,contentType:'application/json',body:JSON.stringify({error:'DISABLED',message:'Experimental cross-project sync endpoint disabled'})});
              });
              const page=await context.newPage();
              await page.addInitScript(({uid,primary,portable})=>{
                localStorage.clear();sessionStorage.clear();
                localStorage.setItem('puplan_session',primary);
                localStorage.setItem('puplan_portable_session_v1',portable);
                localStorage.setItem('puplan_course_owner',uid);
              },{uid,primary,portable});
              await page.goto('http://127.0.0.1:4174/__replication_retired_test.html',{waitUntil:'domcontentloaded'});
              await page.waitForFunction(()=>!!window.NOLU_REPLICATION,{timeout:10000});
              const first=await page.evaluate(()=>window.NOLU_REPLICATION.sync('ci',true));
              assert(first===false,'retired replication endpoint must not report success');
              await page.waitForFunction(()=>window.NOLU_REPLICATION.state.disabled===true,{timeout:3000});
              const afterFirst=syncRequests;
              assert(afterFirst>=1,'replication endpoint was not probed');
              await page.evaluate(async()=>{
                await window.NOLU_REPLICATION.sync('periodic',false);
                document.dispatchEvent(new CustomEvent('puplan:courses-changed',{detail:[]}));
              });
              await page.waitForTimeout(1800);
              assert(syncRequests===afterFirst,'disabled replication kept polling after HTTP 410');
              const state=await page.evaluate(()=>window.NOLU_REPLICATION.state);
              assert(state.disabledReason.includes('尚未啟用'),'disabled reason was not exposed');
              console.log('REPLICATION_410_CIRCUIT_OK',{syncRequests,state});
            }finally{await browser.close()}
          })().catch(e=>{console.error(e);process.exit(1)});
          NODE
          timeout 60s node /tmp/nolu-standby/check.cjs
          rm -f pu-plan/__replication_retired_test.html

      - name: Live Tokyo topology stays fail-closed
        run: |
          set -euo pipefail
          ORIGIN='https://miiduoa.github.io'
          for path in pu-plan-api-v7 pu-plan-sync-v1; do
            code=$(curl -sS --max-time 12 -o /tmp/retired.json -w '%{http_code}' -X POST "https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/$path" -H "Origin: $ORIGIN" -H 'Content-Type: application/json' --data '{"action":"health"}')
            echo "[$path] HTTP $code :: $(cat /tmp/retired.json)"
            test "$code" = 410
            grep -q 'DISABLED' /tmp/retired.json
          done
          code=$(curl -sS --max-time 12 -o /tmp/v8.json -w '%{http_code}' -X POST 'https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-api-v8' -H "Origin: $ORIGIN" -H 'Content-Type: application/json' --data '{"action":"health"}')
          echo "[v8 health] HTTP $code :: $(cat /tmp/v8.json)"
          test "$code" = 200
          grep -q '"cloud_tier":"standby"' /tmp/v8.json
''')

# trigger-only comment: the one-time workflow was created after the script's first commit.
print('retired replication / provider security patch applied')
