-- Nolu replication and failback helpers run with SECURITY DEFINER and must never
-- be callable through the public Data API. Edge functions and database triggers
-- operate with service-role / owner privileges instead.

revoke all on function public.puplan_apply_failback_snapshot(jsonb) from public;
revoke all on function public.puplan_apply_failback_snapshot(jsonb) from anon, authenticated;
grant execute on function public.puplan_apply_failback_snapshot(jsonb) to service_role;

revoke all on function public.puplan_enqueue_social_replication() from public;
revoke all on function public.puplan_enqueue_social_replication() from anon, authenticated;
grant execute on function public.puplan_enqueue_social_replication() to service_role;

revoke all on function public.puplan_queue_replication_for_user(uuid) from public;
revoke all on function public.puplan_queue_replication_for_user(uuid) from anon, authenticated;
grant execute on function public.puplan_queue_replication_for_user(uuid) to service_role;
