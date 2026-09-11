-- Server-only replay protection for Nolu cross-region replica-v3 envelopes.
-- This table is intentionally inaccessible to browser roles; Edge Functions use
-- the project-local service-role connection and therefore bypass RLS.
create table if not exists public.puplan_replica_v3_nonces (
  nonce uuid primary key,
  issuer text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

alter table public.puplan_replica_v3_nonces enable row level security;
revoke all on table public.puplan_replica_v3_nonces from anon, authenticated;

create index if not exists puplan_replica_v3_nonces_expires_idx
  on public.puplan_replica_v3_nonces (expires_at);
