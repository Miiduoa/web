-- PRIMARY ONLY: retire the superseded shared-secret cross-region transport.
-- Active cross-region authority is Ed25519; the only remaining HMAC is local DB -> local relay.
DROP TABLE IF EXISTS public.puplan_replication_shared_secret;
