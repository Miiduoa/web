-- Quiz integrity hardening.
--
-- Students previously had direct INSERT/UPDATE access to quiz_attempts, allowing
-- them to bypass max_attempts and mutate server-owned fields such as score,
-- submitted_at, started_at and drawn_question_ids. quiz_answers also allowed a
-- student to supply manual_score, which submit_quiz_attempt trusts for essays.
-- Keep attempt lifecycle server-owned and limit direct answer writes to the
-- answer payload only.

-- Attempt lifecycle is exclusively managed by SECURITY DEFINER RPCs.
drop policy if exists quiz_attempts_insert on public.quiz_attempts;
drop policy if exists quiz_attempts_update_self_unsubmitted on public.quiz_attempts;

revoke insert, update, delete, truncate on table public.quiz_attempts
  from public, anon, authenticated;

-- Keep student answer editing, but require the question to belong to the attempt
-- (and to the server-drawn pool when one exists), and never accept manual_score
-- from a student-controlled Data API write.
drop policy if exists quiz_answers_write_student on public.quiz_answers;
create policy quiz_answers_write_student
on public.quiz_answers
for insert
to authenticated
with check (
  manual_score is null
  and exists (
    select 1
    from public.quiz_attempts qa
    join public.quizzes q on q.id = qa.quiz_id
    join public.quiz_questions qq
      on qq.id = quiz_answers.question_id
     and qq.quiz_id = qa.quiz_id
    where qa.id = quiz_answers.attempt_id
      and qa.student_id = auth.uid()
      and qa.submitted_at is null
      and public.is_course_member(q.course_id)
      and (
        qa.drawn_question_ids is null
        or quiz_answers.question_id = any (qa.drawn_question_ids)
      )
  )
);

drop policy if exists quiz_answers_update_student on public.quiz_answers;
create policy quiz_answers_update_student
on public.quiz_answers
for update
to authenticated
using (
  manual_score is null
  and exists (
    select 1
    from public.quiz_attempts qa
    where qa.id = quiz_answers.attempt_id
      and qa.student_id = auth.uid()
      and qa.submitted_at is null
  )
)
with check (
  manual_score is null
  and exists (
    select 1
    from public.quiz_attempts qa
    join public.quizzes q on q.id = qa.quiz_id
    join public.quiz_questions qq
      on qq.id = quiz_answers.question_id
     and qq.quiz_id = qa.quiz_id
    where qa.id = quiz_answers.attempt_id
      and qa.student_id = auth.uid()
      and qa.submitted_at is null
      and public.is_course_member(q.course_id)
      and (
        qa.drawn_question_ids is null
        or quiz_answers.question_id = any (qa.drawn_question_ids)
      )
  )
);

drop policy if exists quiz_answers_delete_student on public.quiz_answers;
create policy quiz_answers_delete_student
on public.quiz_answers
for delete
to authenticated
using (
  manual_score is null
  and exists (
    select 1
    from public.quiz_attempts qa
    where qa.id = quiz_answers.attempt_id
      and qa.student_id = auth.uid()
      and qa.submitted_at is null
  )
);

-- Remove broad table-level INSERT/UPDATE grants, then grant only the columns a
-- student is supposed to control. RLS above remains a second independent gate.
revoke insert, update on table public.quiz_answers
  from public, anon, authenticated;
revoke delete, truncate on table public.quiz_answers
  from public, anon;
revoke truncate on table public.quiz_answers
  from authenticated;

grant insert (attempt_id, question_id, answer)
  on table public.quiz_answers to authenticated;
grant update (answer)
  on table public.quiz_answers to authenticated;
grant delete on table public.quiz_answers to authenticated;

-- Student-facing quiz RPCs require a signed-in role. SECURITY DEFINER keeps the
-- underlying attempt/score writes server-owned after the table grants above are
-- removed.
revoke all on function public.start_quiz_attempt(uuid) from public, anon;
grant execute on function public.start_quiz_attempt(uuid) to authenticated, service_role;

revoke all on function public.submit_quiz_attempt(uuid) from public, anon;
grant execute on function public.submit_quiz_attempt(uuid) to authenticated, service_role;

revoke all on function public.sync_quiz_gradebook_from_attempt(uuid) from public, anon;
grant execute on function public.sync_quiz_gradebook_from_attempt(uuid) to authenticated, service_role;

revoke all on function public.set_quiz_manual_score(uuid, uuid, numeric) from public, anon;
grant execute on function public.set_quiz_manual_score(uuid, uuid, numeric) to authenticated, service_role;
