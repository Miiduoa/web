# Nolu review guide

這份文件給第一次進 repo 的人。不是完整文件索引，只列最能代表專案設計取捨的幾個入口。

## 1. 先看 failure boundary

Nolu 的主題不是「學生行事曆有哪些頁面」，而是當登入、網路或主要區域出問題時，資料與身份邊界是否還能保持正確。

建議先讀：

- `README.md`：整體 scope 與限制
- `docs/NOLU_HOT_STANDBY.md`：primary / standby authority
- `pu-plan/resilience.js`：browser recovery path
- `pu-plan/guest-privacy.js`：guest / account boundary
- `pu-plan/provider-mesh.js`：provider acknowledgement 與 recovery candidate

## 2. 再看測試是不是對應真實 failure mode

代表性的 workflow：

- `nolu-api-authz-boundary-smoke.yml`
- `nolu-guest-privacy-unit.yml`
- `nolu-hot-standby-smoke.yml`
- `nolu-replication-conflict-backoff.yml`
- `nolu-resilience-race-smoke.yml`
- `nolu-supply-chain-security.yml`

重點不是 workflow 很多，而是每一個都有明確的 contract：身份邊界、replay、stale revision、failover、session hygiene 或 supply-chain。

## 3. 最後才看 UI

靜態 PWA 入口在 `pu-plan/`。只想快速看 shell，可以在 repo 根目錄：

```bash
python3 -m http.server 8080
```

再開：

```text
http://localhost:8080/pu-plan/
```

完整登入與 regional API 仍需要環境設定；README 沒有把靜態 preview 說成 production deployment。

## Scope boundary

目前最重要的限制仍是：core data 的 standby path 不代表 social / feed / chat 已全部具備相同 replication guarantees。這個邊界刻意保留在文件中。
