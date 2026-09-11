-- Close direct Data API paths that could bypass the intended server-side
-- authorization flows for platform roles, course enrollment, quiz grade sync,
-- and assignment grading metadata.

-- A user may edit their own profile, but must never be able to promote their
-- own platform role. is_platform_admin() trusts profiles.role, so this boundary
-- must be enforced before the row is written.
create or replace function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is not null
     and old.id = auth.uid()
     and new.role is distinct from old.role then
    raise exception 'platform role is server-managed';
  end if;
  return new;
end;
$function$;

revoke all on function public.protect_profile_role() from public, anon, authenticated;

DROP TRIGGER IF EXISTS profiles_protect_role ON public.profiles;
create trigger profiles_protect_role
before update on public.profiles
for each row execute function public.protect_profile_role();

-- Enrollment must pass through enroll_by_code(), which validates the code,
-- archived state, and prerequisites. The old self-insert policy allowed joining
-- any existing course by guessing its UUID.
drop policy if exists course_members_insert_self_student on public.course_members;
revoke all on function public.enroll_by_code(text) from public, anon;
grant execute on function public.enroll_by_code(text) to authenticated, service_role;

-- Quiz grades are derived by submit_quiz_attempt()/sync_quiz_gradebook_from_attempt().
-- The old student policies allowed direct arbitrary writes to grade_scores.score.
drop policy if exists grade_scores_insert_student_own_quiz on public.grade_scores;
drop policy if exists grade_scores_update_student_own_quiz on public.grade_scores;

-- Submission grading fields and timestamps are server/staff-owned. Keep the
-- existing student content-edit path, but make row identity immutable, stamp
-- initial submission time on the server, and block self-grading metadata.
create or replace function public.protect_submission_integrity()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_course uuid;
  v_is_staff boolean := false;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    select a.course_id into v_course
    from public.assignments a
    where a.id = new.assignment_id;

    v_is_staff := coalesce(public.is_course_teacher(v_course), false)
                  or public.is_platform_admin();

    if not v_is_staff then
      new.student_id := auth.uid();
      new.submitted_at := now();
      new.grade := null;
      new.feedback := null;
      new.graded_at := null;
      new.graded_by := null;
    end if;
    return new;
  end if;

  -- Assignment/student/group identity is immutable after creation for every
  -- browser-authenticated caller. Server jobs with auth.uid() null are unaffected.
  if new.assignment_id is distinct from old.assignment_id
     or new.student_id is distinct from old.student_id
     or new.group_id is distinct from old.group_id then
    raise exception 'submission identity is immutable';
  end if;

  select a.course_id into v_course
  from public.assignments a
  where a.id = old.assignment_id;

  v_is_staff := coalesce(public.is_course_teacher(v_course), false)
                or public.is_platform_admin();

  if not v_is_staff then
    if new.grade is distinct from old.grade
       or new.feedback is distinct from old.feedback
       or new.graded_at is distinct from old.graded_at
       or new.graded_by is distinct from old.graded_by then
      raise exception 'grading fields are staff-managed';
    end if;
    if new.submitted_at is distinct from old.submitted_at then
      raise exception 'submitted_at is server-managed';
    end if;
  end if;

  return new;
end;
$function$;

revoke all on function public.protect_submission_integrity() from public, anon, authenticated;

DROP TRIGGER IF EXISTS submissions_protect_integrity ON public.submissions;
create trigger submissions_protect_integrity
before insert or update on public.submissions
for each row execute function public.protect_submission_integrity();

-- Make student INSERT policy itself reject forged grading fields too. This is an
-- independent RLS guard in addition to the trigger above.
drop policy if exists submissions_insert_self on public.submissions;
create policy submissions_insert_self
on public.submissions
for insert
to authenticated
with check (
  student_id = auth.uid()
  and grade is null
  and feedback is null
  and graded_at is null
  and graded_by is null
  and exists (
    select 1
    from public.assignments a
    where a.id = submissions.assignment_id
      and public.is_course_member(a.course_id)
  )
);
