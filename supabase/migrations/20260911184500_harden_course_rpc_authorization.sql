-- Harden user-facing SECURITY DEFINER RPCs that previously bypassed row-level
-- authorization checks. Keep the checks inside the RPCs because SECURITY DEFINER
-- deliberately bypasses RLS, and mirror the same boundaries in direct-table RLS
-- where clients can write through PostgREST.

create unique index if not exists peer_review_responses_one_per_pair_idx
  on public.peer_review_responses (pair_id);

create or replace function public.submit_peer_review(
  p_pair_id uuid,
  p_scores jsonb,
  p_comment text
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_response uuid;
  v_reviewer uuid;
  v_status text;
  v_open timestamptz;
  v_due timestamptz;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  select pr.reviewer_id, pr.status, pa.open_at, pa.due_at
    into v_reviewer, v_status, v_open, v_due
  from public.peer_review_pairs pr
  join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
  where pr.id = p_pair_id
  for update of pr;

  if not found then
    raise exception 'peer review pair not found';
  end if;
  if v_reviewer is distinct from auth.uid() then
    raise exception 'forbidden';
  end if;
  if v_status <> 'pending' then
    raise exception 'peer review already submitted';
  end if;
  if v_open is not null and now() < v_open then
    raise exception 'peer review not open yet';
  end if;
  if v_due is not null and now() > v_due then
    raise exception 'peer review closed';
  end if;

  insert into public.peer_review_responses (pair_id, scores, comment)
  values (p_pair_id, coalesce(p_scores, '{}'::jsonb), coalesce(p_comment, ''))
  returning id into v_response;

  update public.peer_review_pairs
  set status = 'submitted'
  where id = p_pair_id
    and reviewer_id = auth.uid()
    and status = 'pending';

  if not found then
    raise exception 'peer review state changed';
  end if;

  return v_response;
end;
$function$;

create or replace function public.submit_rubric_score(
  p_rubric_id uuid,
  p_target_kind text,
  p_target_id uuid,
  p_scores jsonb,
  p_comment text
)
returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_total numeric := 0;
  v_course uuid;
  v_bound_kind text;
  v_bound_id uuid;
  v_target_course uuid;
  v_target_binding uuid;
  v_pair_reviewer uuid;
  c record;
  v_score numeric;
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;
  if p_target_kind not in ('submission', 'peer_review_pair') then
    raise exception 'invalid target_kind';
  end if;

  select r.course_id, r.bound_kind, r.bound_id
    into v_course, v_bound_kind, v_bound_id
  from public.rubrics r
  where r.id = p_rubric_id;

  if not found then
    raise exception 'rubric not found';
  end if;

  if p_target_kind = 'submission' then
    select a.course_id, s.assignment_id
      into v_target_course, v_target_binding
    from public.submissions s
    join public.assignments a on a.id = s.assignment_id
    where s.id = p_target_id;

    if not found or v_target_course is distinct from v_course then
      raise exception 'target is outside rubric course';
    end if;
    if v_bound_kind is not null and v_bound_kind <> 'assignment' then
      raise exception 'rubric binding does not match target kind';
    end if;
    if v_bound_id is not null and v_bound_id is distinct from v_target_binding then
      raise exception 'rubric is bound to a different assignment';
    end if;
    if not public.course_member_has_capability(v_course, 'assignments.grade'::text) then
      raise exception 'forbidden';
    end if;
  else
    select pa.course_id, pr.review_assignment_id, pr.reviewer_id
      into v_target_course, v_target_binding, v_pair_reviewer
    from public.peer_review_pairs pr
    join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
    where pr.id = p_target_id;

    if not found or v_target_course is distinct from v_course then
      raise exception 'target is outside rubric course';
    end if;
    if v_bound_kind is not null and v_bound_kind <> 'peer_review' then
      raise exception 'rubric binding does not match target kind';
    end if;
    if v_bound_id is not null and v_bound_id is distinct from v_target_binding then
      raise exception 'rubric is bound to a different peer review assignment';
    end if;
    if v_pair_reviewer is distinct from auth.uid()
       and not public.is_course_staff(v_course) then
      raise exception 'forbidden';
    end if;
  end if;

  for c in
    select id, weight, max_points
    from public.rubric_criteria
    where rubric_id = p_rubric_id
  loop
    begin
      v_score := least(
        greatest(coalesce((p_scores->>c.id::text)::numeric, 0), 0),
        c.max_points
      );
    exception when invalid_text_representation then
      raise exception 'invalid rubric score';
    end;
    v_total := v_total + (v_score * c.weight);
  end loop;

  insert into public.rubric_scores (
    rubric_id, target_kind, target_id, scorer_id, scores, total_points, comment
  ) values (
    p_rubric_id, p_target_kind, p_target_id, auth.uid(),
    coalesce(p_scores, '{}'::jsonb), v_total, coalesce(p_comment, '')
  )
  on conflict (rubric_id, target_kind, target_id, scorer_id)
  do update set
    scores = excluded.scores,
    total_points = excluded.total_points,
    comment = excluded.comment;

  return v_total;
end;
$function$;

create or replace function public.mark_announcement_read(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null then
    raise exception 'unauthenticated';
  end if;

  if not exists (
    select 1
    from public.announcements a
    where a.id = p_announcement_id
      and public.is_course_member(a.course_id)
      and (
        a.scheduled_at is null
        or a.scheduled_at <= now()
        or public.is_course_staff(a.course_id)
      )
      and (
        a.visibility_scope = 'course'
        or (
          a.visibility_scope = 'group'
          and exists (
            select 1
            from public.course_group_members cgm
            where cgm.group_id = a.visibility_target_id
              and cgm.user_id = auth.uid()
          )
        )
        or public.is_course_staff(a.course_id)
      )
  ) then
    raise exception 'forbidden';
  end if;

  insert into public.announcement_reads (announcement_id, user_id)
  values (p_announcement_id, auth.uid())
  on conflict do nothing;
end;
$function$;

create or replace function public.my_calendar_events(
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns setof public.calendar_events
language sql
stable
security definer
set search_path to 'public'
as $function$
  select e.*
  from public.calendar_events e
  where auth.uid() is not null
    and (
      e.scope = 'platform'
      or (e.scope = 'course' and e.course_id is not null and public.is_course_member(e.course_id))
      or (e.scope = 'personal' and e.owner_id = auth.uid())
    )
    and (p_from is null or e.starts_at >= p_from)
    and (p_to is null or e.starts_at <= p_to)
  order by e.starts_at asc
  limit 500;
$function$;

-- Direct Data API writes must enforce the same announcement visibility boundary.
drop policy if exists announcement_reads_insert_self on public.announcement_reads;
create policy announcement_reads_insert_self
on public.announcement_reads
for insert
to public
with check (
  user_id = auth.uid()
  and exists (
    select 1
    from public.announcements a
    where a.id = announcement_reads.announcement_id
      and public.is_course_member(a.course_id)
      and (
        a.scheduled_at is null
        or a.scheduled_at <= now()
        or public.is_course_staff(a.course_id)
      )
      and (
        a.visibility_scope = 'course'
        or (
          a.visibility_scope = 'group'
          and exists (
            select 1
            from public.course_group_members cgm
            where cgm.group_id = a.visibility_target_id
              and cgm.user_id = auth.uid()
          )
        )
        or public.is_course_staff(a.course_id)
      )
  )
);

-- Direct rubric writes were previously protected only by scorer_id=self, which
-- allowed an authenticated caller to score unrelated targets. Mirror the RPC
-- course/binding/role checks in RLS so direct PostgREST writes cannot bypass it.
drop policy if exists rubric_scores_insert_self on public.rubric_scores;
create policy rubric_scores_insert_self
on public.rubric_scores
for insert
to public
with check (
  scorer_id = auth.uid()
  and exists (
    select 1
    from public.rubrics r
    where r.id = rubric_scores.rubric_id
      and (
        (
          rubric_scores.target_kind = 'submission'
          and (r.bound_kind is null or r.bound_kind = 'assignment')
          and exists (
            select 1
            from public.submissions s
            join public.assignments a on a.id = s.assignment_id
            where s.id = rubric_scores.target_id
              and a.course_id = r.course_id
              and (r.bound_id is null or r.bound_id = s.assignment_id)
              and public.course_member_has_capability(r.course_id, 'assignments.grade'::text)
          )
        )
        or (
          rubric_scores.target_kind = 'peer_review_pair'
          and (r.bound_kind is null or r.bound_kind = 'peer_review')
          and exists (
            select 1
            from public.peer_review_pairs pr
            join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
            where pr.id = rubric_scores.target_id
              and pa.course_id = r.course_id
              and (r.bound_id is null or r.bound_id = pr.review_assignment_id)
              and (
                pr.reviewer_id = auth.uid()
                or public.is_course_staff(r.course_id)
              )
          )
        )
      )
  )
);

drop policy if exists rubric_scores_update_self on public.rubric_scores;
create policy rubric_scores_update_self
on public.rubric_scores
for update
to public
using (
  scorer_id = auth.uid()
  and exists (
    select 1
    from public.rubrics r
    where r.id = rubric_scores.rubric_id
      and (
        (
          rubric_scores.target_kind = 'submission'
          and (r.bound_kind is null or r.bound_kind = 'assignment')
          and exists (
            select 1
            from public.submissions s
            join public.assignments a on a.id = s.assignment_id
            where s.id = rubric_scores.target_id
              and a.course_id = r.course_id
              and (r.bound_id is null or r.bound_id = s.assignment_id)
              and public.course_member_has_capability(r.course_id, 'assignments.grade'::text)
          )
        )
        or (
          rubric_scores.target_kind = 'peer_review_pair'
          and (r.bound_kind is null or r.bound_kind = 'peer_review')
          and exists (
            select 1
            from public.peer_review_pairs pr
            join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
            where pr.id = rubric_scores.target_id
              and pa.course_id = r.course_id
              and (r.bound_id is null or r.bound_id = pr.review_assignment_id)
              and (
                pr.reviewer_id = auth.uid()
                or public.is_course_staff(r.course_id)
              )
          )
        )
      )
  )
)
with check (
  scorer_id = auth.uid()
  and exists (
    select 1
    from public.rubrics r
    where r.id = rubric_scores.rubric_id
      and (
        (
          rubric_scores.target_kind = 'submission'
          and (r.bound_kind is null or r.bound_kind = 'assignment')
          and exists (
            select 1
            from public.submissions s
            join public.assignments a on a.id = s.assignment_id
            where s.id = rubric_scores.target_id
              and a.course_id = r.course_id
              and (r.bound_id is null or r.bound_id = s.assignment_id)
              and public.course_member_has_capability(r.course_id, 'assignments.grade'::text)
          )
        )
        or (
          rubric_scores.target_kind = 'peer_review_pair'
          and (r.bound_kind is null or r.bound_kind = 'peer_review')
          and exists (
            select 1
            from public.peer_review_pairs pr
            join public.peer_review_assignments pa on pa.id = pr.review_assignment_id
            where pr.id = rubric_scores.target_id
              and pa.course_id = r.course_id
              and (r.bound_id is null or r.bound_id = pr.review_assignment_id)
              and (
                pr.reviewer_id = auth.uid()
                or public.is_course_staff(r.course_id)
              )
          )
        )
      )
  )
);

-- These four RPCs are meaningful only for signed-in users. Remove inherited
-- PUBLIC execute so anonymous PostgREST callers cannot even reach the function.
revoke all on function public.submit_peer_review(uuid, jsonb, text) from public, anon;
grant execute on function public.submit_peer_review(uuid, jsonb, text) to authenticated, service_role;

revoke all on function public.submit_rubric_score(uuid, text, uuid, jsonb, text) from public, anon;
grant execute on function public.submit_rubric_score(uuid, text, uuid, jsonb, text) to authenticated, service_role;

revoke all on function public.mark_announcement_read(uuid) from public, anon;
grant execute on function public.mark_announcement_read(uuid) to authenticated, service_role;

revoke all on function public.my_calendar_events(timestamptz, timestamptz) from public, anon;
grant execute on function public.my_calendar_events(timestamptz, timestamptz) to authenticated, service_role;
