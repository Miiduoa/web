# Replica v2 release checklist

- [x] Mumbai and Tokyo `pu-plan-replica-v2` endpoints deployed.
- [x] Live fail-closed smoke: health 200, unauthenticated sync 401, forged ingest 401, disallowed origin 403.
- [x] Client core routing moved from retired v7 to independent v8 endpoints.
- [x] Mumbai/Tokyo browser session slots separated.
- [x] Tokyo session overwrite race reproduced by CI and fixed.
- [x] Standby-to-primary reconciliation requires a peer-local session before failback.
- [x] Logout and guest transitions scrub regional auth state.
- [x] Primary-only social/privacy/admin calls use the Mumbai-local session.
- [x] PWA cache generation bumped for installed iPhone clients.
- [ ] Existing production users can be seeded only after Mumbai PostgreSQL becomes reachable again.
- [ ] Full social/chat cross-provider replication is intentionally out of scope for replica v2 core failover.
