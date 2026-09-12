-- TOKYO STANDBY ONLY: preserve the live helper ACLs in disaster-recovery source.
-- This runs after the shared-domain authority migrations so CREATE OR REPLACE
-- changes cannot leave SECURITY DEFINER helpers executable by browser roles.

revoke all on function public.puplan_adjust_affinity(uuid,uuid,real) from public, anon, authenticated;
revoke all on function public.puplan_affinity_like_change() from public, anon, authenticated;
revoke all on function public.puplan_affinity_reply_change() from public, anon, authenticated;
revoke all on function public.puplan_on_like_change() from public, anon, authenticated;
revoke all on function public.puplan_on_message_insert() from public, anon, authenticated;
revoke all on function public.puplan_on_reply_change() from public, anon, authenticated;

 grant execute on function public.puplan_adjust_affinity(uuid,uuid,real) to service_role;
 grant execute on function public.puplan_affinity_like_change() to service_role;
 grant execute on function public.puplan_affinity_reply_change() to service_role;
 grant execute on function public.puplan_on_like_change() to service_role;
 grant execute on function public.puplan_on_message_insert() to service_role;
 grant execute on function public.puplan_on_reply_change() to service_role;
