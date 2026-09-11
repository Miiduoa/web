-- nolu uses its own signed V4 session at Edge Function boundaries. Browser
-- clients do not authenticate to PostgREST as Supabase `authenticated`; all
-- application-table access is performed by server-side Edge Functions with the
-- service role. Keep that architecture explicit so a future permissive RLS
-- policy or default grant cannot accidentally expose account/social data.

DO $block$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p')
      AND c.relname LIKE 'puplan_app\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      r.relname
    );
    EXECUTE format(
      'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO service_role',
      r.relname
    );
  END LOOP;

  -- These helpers are internal implementation details called by Edge Functions
  -- (and replication/database code), never public browser APIs. Revoke every
  -- current puplan_* function overload instead of relying on a hand-maintained
  -- function list.
  FOR r IN
    SELECT p.proname, oidvectortypes(p.proargtypes) AS argtypes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE 'puplan\_%' ESCAPE '\'
  LOOP
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated',
      r.proname,
      r.argtypes
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
      r.proname,
      r.argtypes
    );
  END LOOP;
END
$block$;

-- Storage uploads are intentionally not changed here. The browser uses
-- uploadToSignedUrl() tokens minted by pu-plan-social; it does not need direct
-- PostgREST table/RPC privileges for that flow.
