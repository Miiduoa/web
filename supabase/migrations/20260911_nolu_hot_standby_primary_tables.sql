-- PRIMARY ONLY: durable state for Mumbai -> Tokyo core replication.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pgcrypto') THEN RAISE EXCEPTION 'pgcrypto extension is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN RAISE EXCEPTION 'pg_net extension is required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN RAISE EXCEPTION 'pg_cron extension is required'; END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.puplan_replication_worker_secret (
  id smallint PRIMARY KEY CHECK (id=1),
  token text NOT NULL CHECK (length(token)>=48),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.puplan_replication_versions (
  user_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.puplan_replication_outbox (
  user_id uuid PRIMARY KEY,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts>=0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text NOT NULL DEFAULT '',
  revision bigint NOT NULL DEFAULT 1 CHECK (revision>0)
);
CREATE TABLE IF NOT EXISTS public.puplan_replication_requests (
  request_id bigint PRIMARY KEY,
  user_id uuid NOT NULL,
  revision bigint NOT NULL CHECK (revision>0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.puplan_replication_health (
  id smallint PRIMARY KEY CHECK (id=1),
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text NOT NULL DEFAULT '',
  pending_count integer NOT NULL DEFAULT 0 CHECK (pending_count>=0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS puplan_replication_outbox_due_idx ON public.puplan_replication_outbox(next_attempt_at,changed_at);
CREATE INDEX IF NOT EXISTS puplan_replication_requests_user_revision_idx ON public.puplan_replication_requests(user_id,revision);

ALTER TABLE public.puplan_replication_worker_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puplan_replication_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puplan_replication_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puplan_replication_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.puplan_replication_health ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.puplan_replication_worker_secret FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.puplan_replication_versions FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.puplan_replication_outbox FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.puplan_replication_requests FROM PUBLIC,anon,authenticated;
REVOKE ALL ON public.puplan_replication_health FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replication_worker_secret TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replication_versions TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replication_outbox TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replication_requests TO service_role;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.puplan_replication_health TO service_role;

-- This token authenticates only the local Postgres -> local relay hop and is generated in-database.
INSERT INTO public.puplan_replication_worker_secret(id,token)
VALUES (1,encode(gen_random_bytes(32),'hex')) ON CONFLICT (id) DO NOTHING;
INSERT INTO public.puplan_replication_health(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
