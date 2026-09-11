# Replica client invariants

- Mumbai and Tokyo use independent Supabase service-role signing keys for Nolu session v4.
- `puplan_session_primary_v1` and `puplan_session_standby_v1` are never interchangeable.
- The legacy `puplan_session` remains the local account/durable-cache identity anchor; regional request routing chooses the matching regional session instead of rewriting that anchor during failover.
- Tokyo receives a usable account only after authenticated server-to-server replica-v2 seeding from Mumbai.
- Replica-v2 returns a peer-local session only after the peer confirms the same credential version (`cv`).
- Standby-to-primary failback is unlocked only after replica-v2 confirms the primary accepted the core snapshot and returned a primary-local session.
- Primary-only identity, recovery, social, moderation, and community services must authenticate with the Mumbai-local session.
- Logout and guest-mode transitions scrub both regional session slots, old portable-session state, cloud preference, and replica markers.
- Browser code never receives password hashes or replica signing private keys.
