-- These SECURITY DEFINER helpers either expose sensitive derived data or mutate
-- server-owned state without checking auth.uid()/role themselves. They are
-- internal helpers and must not be reachable from PostgREST by anon or normal
-- authenticated clients.

revoke all on function public.apply_late_penalty(uuid) from public;
revoke all on function public.apply_late_penalty(uuid) from anon, authenticated;
grant execute on function public.apply_late_penalty(uuid) to service_role;

revoke all on function public.increment_ai_usage(uuid) from public;
revoke all on function public.increment_ai_usage(uuid) from anon, authenticated;
grant execute on function public.increment_ai_usage(uuid) to service_role;

revoke all on function public.enqueue_webhook_event(text, jsonb) from public;
revoke all on function public.enqueue_webhook_event(text, jsonb) from anon, authenticated;
grant execute on function public.enqueue_webhook_event(text, jsonb) to service_role;
