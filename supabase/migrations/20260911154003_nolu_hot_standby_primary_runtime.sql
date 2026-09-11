-- PRIMARY ONLY: trigger enqueue, acknowledgement sweep, retry and legacy backfill.

CREATE OR REPLACE FUNCTION public.puplan_enqueue_replication()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions','net'
AS $$
DECLARE v_uid uuid; v_revision bigint;
BEGIN
  IF tg_table_name='puplan_app_users' THEN
    IF tg_op='DELETE' THEN v_uid:=old.id; ELSE v_uid:=new.id; END IF;
  ELSE
    IF tg_op='DELETE' THEN v_uid:=old.user_id; ELSE v_uid:=new.user_id; END IF;
  END IF;
  v_revision:=public.puplan_next_replication_revision(v_uid);
  INSERT INTO public.puplan_replication_outbox(user_id,changed_at,attempts,next_attempt_at,last_error,revision)
  VALUES (v_uid,clock_timestamp(),0,now(),'',v_revision)
  ON CONFLICT (user_id) DO UPDATE SET changed_at=excluded.changed_at,attempts=0,next_attempt_at=now(),last_error='',revision=excluded.revision;
  BEGIN
    PERFORM public.puplan_dispatch_replication(v_uid);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.puplan_replication_outbox SET last_error=left(sqlerrm,500),next_attempt_at=now()
    WHERE user_id=v_uid AND revision=v_revision;
  END;
  IF tg_op='DELETE' THEN RETURN old; ELSE RETURN new; END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.puplan_sweep_replication()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions','net'
AS $$
DECLARE
  v_req record; v_out record; v_status integer; v_timed_out boolean; v_error text; v_found boolean;
  v_ok integer:=0; v_failed integer:=0; v_dispatched integer:=0; v_pending integer:=0;
BEGIN
  UPDATE public.puplan_replication_health SET last_run_at=now(),updated_at=now() WHERE id=1;
  FOR v_req IN SELECT request_id,user_id,revision,created_at FROM public.puplan_replication_requests ORDER BY created_at LIMIT 100 LOOP
    v_status:=NULL; v_timed_out:=NULL; v_error:=NULL; v_found:=false;
    SELECT r.status_code,r.timed_out,coalesce(r.error_msg,''),true INTO v_status,v_timed_out,v_error,v_found
    FROM net._http_response r WHERE r.id=v_req.request_id;
    IF coalesce(v_found,false) THEN
      IF coalesce(v_status,0) BETWEEN 200 AND 299 AND NOT coalesce(v_timed_out,false) THEN
        DELETE FROM public.puplan_replication_outbox WHERE user_id=v_req.user_id AND revision=v_req.revision;
        v_ok:=v_ok+1;
      ELSE
        UPDATE public.puplan_replication_outbox
        SET attempts=attempts+1,next_attempt_at=now(),last_error=left(coalesce(nullif(v_error,''),'HTTP '||coalesce(v_status::text,'unknown')),500)
        WHERE user_id=v_req.user_id AND revision=v_req.revision;
        v_failed:=v_failed+1;
      END IF;
      DELETE FROM public.puplan_replication_requests WHERE request_id=v_req.request_id;
    ELSIF v_req.created_at<now()-interval '30 seconds' THEN
      UPDATE public.puplan_replication_outbox SET attempts=attempts+1,next_attempt_at=now(),last_error='replication acknowledgement timed out'
      WHERE user_id=v_req.user_id AND revision=v_req.revision;
      DELETE FROM public.puplan_replication_requests WHERE request_id=v_req.request_id;
      v_failed:=v_failed+1;
    END IF;
  END LOOP;
  FOR v_out IN
    SELECT o.user_id,o.revision FROM public.puplan_replication_outbox o
    WHERE o.next_attempt_at<=now() AND NOT EXISTS (
      SELECT 1 FROM public.puplan_replication_requests r WHERE r.user_id=o.user_id AND r.revision=o.revision
    ) ORDER BY o.changed_at LIMIT 20
  LOOP
    BEGIN
      PERFORM public.puplan_dispatch_replication(v_out.user_id);
      v_dispatched:=v_dispatched+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.puplan_replication_outbox
      SET attempts=attempts+1,next_attempt_at=now()+interval '1 minute',last_error=left(sqlerrm,500)
      WHERE user_id=v_out.user_id AND revision=v_out.revision;
      v_failed:=v_failed+1;
    END;
  END LOOP;
  SELECT count(*)::int INTO v_pending FROM public.puplan_replication_outbox;
  UPDATE public.puplan_replication_health
  SET last_success_at=CASE WHEN v_failed=0 THEN now() ELSE last_success_at END,
      last_error=CASE WHEN v_failed=0 THEN '' ELSE v_failed::text||' replication operation(s) failed' END,
      pending_count=v_pending,updated_at=now() WHERE id=1;
  RETURN jsonb_build_object('ok',v_ok,'failed',v_failed,'dispatched',v_dispatched,'pending',v_pending);
END;
$$;

CREATE OR REPLACE FUNCTION public.puplan_kick_replication()
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions','net'
AS $$
DECLARE v_token text; v_request_id bigint;
BEGIN
  SELECT token INTO v_token FROM public.puplan_replication_worker_secret WHERE id=1;
  IF v_token IS NULL THEN RETURN false; END IF;
  SELECT net.http_post(
    url:='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-replica-worker-v1',
    body:=jsonb_build_object('action','drain'),
    headers:=jsonb_build_object('Content-Type','application/json','x-nolu-worker-token',v_token),
    timeout_milliseconds:=15000
  ) INTO v_request_id;
  RETURN v_request_id IS NOT NULL;
EXCEPTION WHEN OTHERS THEN RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_enqueue_replication() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.puplan_sweep_replication() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.puplan_kick_replication() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_enqueue_replication() TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_sweep_replication() TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_kick_replication() TO service_role;

DROP TRIGGER IF EXISTS puplan_users_replication_outbox ON public.puplan_app_users;
DROP TRIGGER IF EXISTS puplan_schedules_replication_outbox ON public.puplan_app_schedules;
DROP TRIGGER IF EXISTS puplan_semesters_replication_outbox ON public.puplan_app_semesters;
CREATE TRIGGER puplan_users_replication_outbox AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_users FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_replication();
CREATE TRIGGER puplan_schedules_replication_outbox AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_schedules FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_replication();
CREATE TRIGGER puplan_semesters_replication_outbox AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_semesters FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_replication();

DO $$
DECLARE v_job record;
BEGIN
  FOR v_job IN SELECT jobid FROM cron.job WHERE jobname='nolu-replication-outbox' LOOP
    PERFORM cron.unschedule(v_job.jobid);
  END LOOP;
  PERFORM cron.schedule('nolu-replication-outbox','* * * * *','select public.puplan_sweep_replication();');
END $$;

INSERT INTO public.puplan_replication_versions(user_id,revision,updated_at)
SELECT id,1,now() FROM public.puplan_app_users ON CONFLICT (user_id) DO NOTHING;
INSERT INTO public.puplan_replication_outbox(user_id,changed_at,attempts,next_attempt_at,last_error,revision)
SELECT u.id,clock_timestamp(),0,now(),'backfill',v.revision
FROM public.puplan_app_users u JOIN public.puplan_replication_versions v ON v.user_id=u.id
ON CONFLICT (user_id) DO UPDATE SET changed_at=excluded.changed_at,attempts=0,next_attempt_at=now(),last_error='backfill',revision=greatest(public.puplan_replication_outbox.revision,excluded.revision);
