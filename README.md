# Nolu｜Resilient Student Planner PWA

Nolu 是一個以學生課程、行程與社交協作為核心的 Progressive Web App。

這個 repo 最值得看的不是畫面，而是它怎麼處理 **登入、離線、跨區故障、資料隔離與恢復**。

## Architecture focus

目前 production path 以 Supabase 為主要資料層，並設計 primary / standby 區域。

核心流程可簡化成：

```text
browser / installed PWA
        ↓
regional session
        ↓
primary API
        ↓
durable outbox
        ↓
signed replication
        ↓
standby region
```

當 primary 不可用時，browser runtime 會走 resilience / recovery 邏輯，而不是直接把使用者資料清掉或無限 reload。

## Implemented reliability boundaries

### Hot standby

`docs/NOLU_HOT_STANDBY.md` 描述目前的 server-side replication path：

- primary → standby 單向 authority
- per-user monotonic revision
- durable outbox
- retry / acknowledgement sweep
- Ed25519 cross-region message signing
- replay protection
- stale revision rejection
- region-local sessions

目前 scope 明確限制在 account / profile verifier、schedule 與 semester core data；social / feed / chat 沒有假裝已被同一條 replication path 完整覆蓋。

### Browser resilience

`pu-plan/resilience.js` 處理：

- primary / standby API candidates
- circuit-breaker cooldown
- offline fallback
- pending mutation queue
- session-aware recovery
- no-reload recovery path

### Guest privacy

`pu-plan/guest-privacy.js` 會在 guest / account boundary 切換時清理：

- renderable account cache
- profile cache
- regional sessions
- portable session
- resilience snapshots / pending mutations
- assistant session state

它的目的不是只做登出按鈕，而是避免前一個帳號的資料殘留到 guest 或下一個帳號。

### Provider mesh

`pu-plan/provider-mesh.js` 對外部 mirror provider 做：

- portable session
- snapshot digest
- provider acknowledgement
- read quorum
- recovery candidate filtering
- local revision / session fingerprint validation

## Verification surface

這個 repo 目前有：

- **82** 個 GitHub Actions workflow files
- **19** 個 Supabase migration files
- **25** 個 Supabase Edge Function files

workflow 不只是 build/deploy，還包含：

- auth / authorization boundary
- guest privacy
- hot standby
- replication
- failover / failback
- session hygiene
- media URL security
- supply-chain checks
- resilience race / no-reload recovery

代表性檔案：

```text
.github/workflows/
  nolu-api-authz-boundary-smoke.yml
  nolu-guest-privacy-unit.yml
  nolu-hot-standby-smoke.yml
  nolu-replication-conflict-backoff.yml
  nolu-resilience-race-smoke.yml
  nolu-supply-chain-security.yml
```

## Front-end

PWA 入口：

```text
pu-plan/index.html
pu-plan/main.js
pu-plan/features/
pu-plan/styles/
pu-plan/sw.js
```

主要功能包含：

- 課表
- semester
- planner
- friends / community
- discover
- account / profile
- offline PWA path

## What this repo does not claim

- standby 不會自動反向覆蓋 primary。
- social / feed / chat 並沒有全部納入目前的 core-data replication。
- 多 provider 不等於所有 provider 都具有相同 authority。
- browser fallback 不是資料庫 backup 的替代品。
- workflow 數量本身不是品質指標；真正要看的是每個 contract 驗證哪個 failure mode。

## Why I keep this project

一般學生作品常停在「前端 + API + database」。

Nolu 比較想回答的是：

> 如果登入服務、主要 region、網路或 browser session 出問題，使用者的資料與身份邊界還能不能維持正確？

所以這個 repo 的重點是 resilience、privacy、replication 與 recovery contract，而不是再堆一個 dashboard。
