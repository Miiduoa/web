create table if not exists public.puplan_replica_state (
  user_id uuid primary key references public.puplan_app_users(id) on delete cascade,
  enabled boolean not null default false,
  seeded_at timestamptz,
  credentials_synced_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.puplan_replica_state enable row level security;
revoke all on table public.puplan_replica_state from anon, authenticated;

create index if not exists puplan_replica_state_enabled_updated_idx
  on public.puplan_replica_state (enabled, updated_at desc);
