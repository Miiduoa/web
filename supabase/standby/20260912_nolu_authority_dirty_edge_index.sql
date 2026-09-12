-- TOKYO STANDBY ONLY: the replica wrapper probes authority_user_id on every
-- incoming owner-domain snapshot. The edge table's primary key starts with the
-- actor, so keep the authority-side conflict lookup indexed as well.
CREATE INDEX IF NOT EXISTS puplan_standby_dirty_authorities_authority_idx
ON public.puplan_standby_dirty_authorities(authority_user_id, actor_user_id);
