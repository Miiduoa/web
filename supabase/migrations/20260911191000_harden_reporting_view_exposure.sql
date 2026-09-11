-- Public-schema views run with owner privileges unless security_invoker is set.
-- That can bypass RLS on their underlying tables when PostgREST exposes the
-- view. Make user-facing reporting views honor the caller's RLS context and
-- remove anonymous access to internal analytics. Public catalog/search views
-- are intentionally left unchanged.

alter view public.course_grade_rollups set (security_invoker = true);
revoke select on public.course_grade_rollups from anon;

alter view public.reporting_announcement_read_ratio set (security_invoker = true);
alter view public.reporting_at_risk_students set (security_invoker = true);
alter view public.reporting_course_leaderboard set (security_invoker = true);
alter view public.reporting_grade_course_item_scores set (security_invoker = true);
alter view public.reporting_learning_time_monthly set (security_invoker = true);
alter view public.reporting_live_attendance_overview set (security_invoker = true);
alter view public.reporting_participation_score set (security_invoker = true);
alter view public.reporting_quiz_overview set (security_invoker = true);
alter view public.reporting_student_dashboard set (security_invoker = true);

revoke select on public.reporting_announcement_read_ratio from anon;
revoke select on public.reporting_at_risk_students from anon;
revoke select on public.reporting_course_leaderboard from anon;
revoke select on public.reporting_grade_course_item_scores from anon;
revoke select on public.reporting_learning_time_monthly from anon;
revoke select on public.reporting_live_attendance_overview from anon;
revoke select on public.reporting_participation_score from anon;
revoke select on public.reporting_quiz_overview from anon;
revoke select on public.reporting_student_dashboard from anon;

-- These views are consumed only through admin SECURITY DEFINER wrappers. Direct
-- browser access would otherwise bypass those wrapper-level admin checks.
alter view public.reporting_ai_quota_overview set (security_invoker = true);
alter view public.reporting_push_dispatch_retry_curve set (security_invoker = true);
alter view public.reporting_teacher_workload set (security_invoker = true);

revoke select on public.reporting_ai_quota_overview from public, anon, authenticated;
revoke select on public.reporting_push_dispatch_retry_curve from public, anon, authenticated;
revoke select on public.reporting_teacher_workload from public, anon, authenticated;
grant select on public.reporting_ai_quota_overview to service_role;
grant select on public.reporting_push_dispatch_retry_curve to service_role;
grant select on public.reporting_teacher_workload to service_role;

-- Materialized views cannot be security_invoker. Keep this one inaccessible to
-- browser roles and expose it only through admin_course_engagement_7d().
revoke select on public.reporting_course_engagement_7d from public, anon, authenticated;
grant select on public.reporting_course_engagement_7d to service_role;

-- Anonymous callers never need the reporting/admin wrappers themselves.
revoke all on function public.admin_ai_quota_overview() from public, anon;
grant execute on function public.admin_ai_quota_overview() to authenticated, service_role;

revoke all on function public.admin_course_engagement_7d() from public, anon;
grant execute on function public.admin_course_engagement_7d() to authenticated, service_role;

revoke all on function public.admin_push_retry_curve(integer) from public, anon;
grant execute on function public.admin_push_retry_curve(integer) to authenticated, service_role;

revoke all on function public.admin_teacher_workload() from public, anon;
grant execute on function public.admin_teacher_workload() to authenticated, service_role;

revoke all on function public.refresh_reporting_course_engagement_7d() from public, anon;
grant execute on function public.refresh_reporting_course_engagement_7d() to authenticated, service_role;

revoke all on function public.my_course_rank(uuid) from public, anon;
grant execute on function public.my_course_rank(uuid) to authenticated, service_role;

revoke all on function public.my_dashboard() from public, anon;
grant execute on function public.my_dashboard() to authenticated, service_role;
