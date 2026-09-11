-- Close two direct-Data-API gaps where row-level access alone was not enough to
-- preserve workflow state. Peer review submission has timing/state checks in the
-- RPC; grade approval decisions are admin-owned fields.

-- A direct insert into peer_review_responses could bypass submit_peer_review()
-- open/due checks and, more importantly, would not atomically advance the pair
-- from pending -> submitted. Force all user submissions through the guarded RPC.
drop policy if exists peer_review_responses_insert_self on public.peer_review_responses;
revoke insert, update, delete, truncate on table public.peer_review_responses from anon, authenticated;
grant select on table public.peer_review_responses to authenticated;

revoke all on function public.submit_peer_review(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_peer_review(uuid, jsonb, text) to authenticated, service_role;

-- Decision metadata is controlled only by the platform-admin decision path. Keep
-- request payload fields editable according to their existing RLS policies, but
-- prevent a normal authenticated caller from self-approving (or rewriting an
-- already-recorded decision) through a direct table update.
create or replace function public.protect_grade_approval_decision()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.role() = 'service_role' or public.is_platform_admin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'pending';
    new.decided_by := null;
    new.decided_at := null;
    new.decision_note := '';
  elsif tg_op = 'UPDATE' then
    new.status := old.status;
    new.decided_by := old.decided_by;
    new.decided_at := old.decided_at;
    new.decision_note := old.decision_note;
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_grade_approval_decision() from public, anon, authenticated;
grant execute on function public.protect_grade_approval_decision() to service_role;

drop trigger if exists grade_approval_requests_protect_decision on public.grade_approval_requests;
create trigger grade_approval_requests_protect_decision
before insert or update on public.grade_approval_requests
for each row execute function public.protect_grade_approval_decision();

-- The decision RPC already performs the authoritative admin check. Remove the
-- inherited PUBLIC/anon execute surface so anonymous callers cannot reach it.
revoke all on function public.decide_grade_approval(uuid, text, text) from public, anon;
grant execute on function public.decide_grade_approval(uuid, text, text) to authenticated, service_role;
