# Nolu server-side hot standby

Production core-data authority is Mumbai (`hrrmkrayvrgnwcroyttp`) with Tokyo (`ltfurqaspqsvswmebyzw`) as a hot standby.

## Replication path

1. Changes to `puplan_app_users`, `puplan_app_schedules`, or `puplan_app_semesters` enqueue a per-user monotonic revision in Postgres.
2. The primary database immediately sends the current bundle to `pu-plan-replica-relay-v2` with a database-local HMAC. The local HMAC key never leaves Mumbai.
3. The relay validates that database request, signs the cross-region envelope with the primary Ed25519 identity, then forwards it to Tokyo `pu-plan-replica-ingest-v3`.
4. Tokyo pins the Mumbai public key, rejects replayed nonces and stale revisions, and atomically applies account/profile verifier material, schedule, and semesters.
5. A one-minute `pg_cron` sweep only handles acknowledgements and retries; normal replication is event-driven and does not wait for the cron tick.

Browser login is not part of this replication path. Existing users are backfilled through the durable outbox, so a primary outage does not require a successful primary login before the standby can know the account.

## Security invariants

- Automatic authority is one-way: Mumbai -> Tokyo. Tokyo never automatically overwrites Mumbai.
- Regional Session-v4 tokens remain region-local. Passwords are never replicated; only the existing password verifier fields are copied server-to-server.
- Internal SQL helpers are `SECURITY DEFINER` but execution is revoked from `PUBLIC`, `anon`, and `authenticated`; only `service_role`/database owners may invoke them.
- Replication tables have RLS enabled and no browser policies.
- Browser-origin requests are rejected by the relay/ingest transport endpoints.
- Cross-region messages are signed with Ed25519 and replay-protected. The earlier shared-secret cross-region transport is retired.
- Every user has a monotonic revision. Tokyo ignores equal or older revisions, preventing delayed requests from rolling data backward.

## Operations

The Mumbai schema is split into three ordered primary migrations:

- `supabase/migrations/20260911_nolu_hot_standby_primary_tables.sql`
- `supabase/migrations/20260911_nolu_hot_standby_primary_transport.sql`
- `supabase/migrations/20260911_nolu_hot_standby_primary_runtime.sql`

Tokyo's role-specific schema is deliberately kept outside the normal primary migration stream so primary triggers cannot be installed on the standby by accident:

- `supabase/standby/20260911_nolu_hot_standby_tables.sql`
- `supabase/standby/20260911_nolu_hot_standby_apply.sql`

Active transport functions are `pu-plan-replica-relay-v2`, `pu-plan-replica-ingest-v3`, and `pu-plan-replica-worker-v1`. The worker is only an authenticated manual kick for the canonical SQL sweep; it does not implement a second replication protocol. Earlier ingest/relay generations are retired with HTTP 410.

Health is healthy when the primary outbox is empty, `puplan_replication_health.pending_count = 0`, and Tokyo's `puplan_replica_server_state.last_revision` reaches the latest primary revision for each user.

The current scope is core account/profile verifier data, schedule, and semesters. Social/feed/chat/meetup tables are deliberately not included yet; adding them requires explicit conflict and ordering rules rather than silently pretending they are covered.