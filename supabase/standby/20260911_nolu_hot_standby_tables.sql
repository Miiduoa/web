-- TOKYO STANDBY ONLY. Do not place this file in the primary migration stream.

CREATE TABLE IF NOT EXISTS public.puplan_replica_server_state (
  user_id uuid PRIMARY KEY,
  last_revision bigint NOT NULL DEFAULT 0 CHECK (last_revision>=0),
  last_applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.puplan_replica_server_nonces (
  nonce uuid PRIMARY KEY,
  issuer text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS puplan_replica_server_nonces_expiry_idx
  ON public.puplan_replica_server_nonces(expires_at);

ALTER TABLE public.puplan_replica_server_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puplan_replica_server_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.puplan_replica_server_state FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.puplan_replica_server_nonces FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replica_server_state TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replica_server_nonces TO service_role;

-- The active transport authenticates Mumbai with its pinned Ed25519 public key.
-- No cross-region shared secret is stored in Tokyo.
DROP TABLE IF EXISTS public.puplan_replication_shared_secret;
