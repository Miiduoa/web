# Nolu｜Student Planner PWA

[![durable sync](https://github.com/Miiduoa/web/actions/workflows/nolu-durable-sync-smoke.yml/badge.svg)](https://github.com/Miiduoa/web/actions/workflows/nolu-durable-sync-smoke.yml) [![secret scan](https://github.com/Miiduoa/web/actions/workflows/nolu-history-secret-scan.yml/badge.svg)](https://github.com/Miiduoa/web/actions/workflows/nolu-history-secret-scan.yml) [![checkout hygiene](https://github.com/Miiduoa/web/actions/workflows/nolu-checkout-hygiene.yml/badge.svg)](https://github.com/Miiduoa/web/actions/workflows/nolu-checkout-hygiene.yml)

學生課表、學期規劃與社交協作 PWA。除了前端功能，這個 repo 也包含登入與帳號隔離、離線復原，以及以 Supabase 為資料層的 primary／standby 同步流程。

[程式導覽](docs/REVIEW_GUIDE.md) · [跨區同步設計](docs/NOLU_HOT_STANDBY.md) · [自動化驗證](.github/workflows/)

## 本機預覽

在 repo 根目錄啟動 HTTP server：

```bash
python3 -m http.server 8080
```

開啟 <http://localhost:8080/pu-plan/>。

這個方式可預覽靜態 PWA shell、Service Worker 與不依賴後端的流程。完整登入、Supabase、regional API、replication 及 Netlify Functions 需要相應的環境設定與部署端點。

## 程式入口

- [`pu-plan/index.html`](pu-plan/index.html)、[`main.js`](pu-plan/main.js)：前端入口
- [`pu-plan/features/`](pu-plan/features/)：課表、學期、planner、friends／community、discover、account／profile 等功能
- [`pu-plan/styles/`](pu-plan/styles/)、[`sw.js`](pu-plan/sw.js)：樣式與 Service Worker
- [`pu-plan/resilience.js`](pu-plan/resilience.js)：API 候選、離線快照、待送出操作及恢復流程
- [`pu-plan/guest-privacy.js`](pu-plan/guest-privacy.js)：guest／account 切換時的資料清理
- [`pu-plan/provider-mesh.js`](pu-plan/provider-mesh.js)：provider acknowledgement、read quorum 與恢復候選檢查

## 資料同步與恢復

```text
Browser / PWA → regional session → primary API
                                      ↓
                                 durable outbox
                                      ↓
                               signed replication
                                      ↓
                                 standby region
```

### 跨區同步

目前 core data 採 **primary → standby 單向 authority**。每位使用者的 revision 單調遞增，透過 durable outbox、重試及 acknowledgement sweep 處理同步；跨區訊息使用 Ed25519 簽章，並檢查 replay 與 stale revision。

同步範圍為 account／profile verifier、schedule 與 semester。Regional sessions 保留在各區；密碼不會複寫，server-to-server 僅傳既有 verifier 欄位。完整安全條件與部署說明見 [NOLU_HOT_STANDBY](docs/NOLU_HOT_STANDBY.md)。

### 瀏覽器恢復

`resilience.js` 管理 primary／standby API candidates、circuit-breaker cooldown、offline snapshot 與 pending mutation queue。恢復流程依 session 狀態判斷，包含不 reload 的復原路徑。

`provider-mesh.js` 檢查 portable session、snapshot digest、provider acknowledgement、read quorum、local revision 與 session fingerprint，再篩選可用的 recovery candidate。

### 帳號隔離

`guest-privacy.js` 在 guest／account 邊界切換時清理 account／profile cache、regional／portable session、resilience snapshot、pending mutation 與 assistant session，避免前一個帳號的資料殘留。

## 驗證入口

可先從以下幾個具體情境閱讀測試：

- **guest 與跨帳號快取隔離**：[unit workflow](.github/workflows/nolu-guest-privacy-unit.yml) 與 [測試程式](.github/tests/guest-privacy.cjs)
- **舊回應不得刪除較新的離線修改**：[resilience race smoke](.github/workflows/nolu-resilience-race-smoke.yml)
- **API 授權邊界**：[authz boundary smoke](.github/workflows/nolu-api-authz-boundary-smoke.yml)
- **standby 與同步衝突**：[hot standby smoke](.github/workflows/nolu-hot-standby-smoke.yml)、[conflict／backoff](.github/workflows/nolu-replication-conflict-backoff.yml)
- **供應鏈檢查**：[supply-chain security](.github/workflows/nolu-supply-chain-security.yml)

其他 workflows 涵蓋 checkout／credential hygiene、failover／failback、session hygiene、media URL security 及 no-reload recovery。各項執行結果請看 [GitHub Actions](https://github.com/Miiduoa/web/actions)。

## 目前邊界

- Standby 不會自動反向覆蓋 primary。
- Social／feed／chat 尚未全部納入上述 core-data replication。
- 各 provider 的 authority 不同；多個 provider 不代表可以互相任意覆寫資料。
- Browser fallback 不能取代資料庫備份。
- 本機靜態預覽不包含完整登入及跨區服務，workflow 也只驗證各自定義的情境。

## 提交與檢查

文件與程式變更皆透過 pull request 合併至 `main`。主分支的 [提交來源檢查](.github/workflows/nolu-main-push-provenance.yml) 會核對該次提交是否對應已合併的 PR，保留可追溯的審查紀錄。

查看驗證結果時，請對照 PR 的 head commit 與合併後的 commit；分支檢查、主分支來源檢查和各功能的 smoke tests 分別回答不同問題。文件修改未觸發某項功能測試時，不代表該功能已在這次提交重新驗證。
