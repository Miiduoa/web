-- PRIMARY ONLY: a standby authority/dirty conflict is an expected consistency
-- fence, not a transient success. Do not redispatch the same blocked revision in
-- the same sweep; wait for signed failback to clear the standby dirty generation.
-- Other transport failures also get a short retry delay so one cron sweep cannot
-- spin on a failing endpoint.

CREATE OR REPLACE FUNCTION public.puplan_sweep_replication()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','extensions','net'
AS $$
DECLARE
  v_req record;
  v_out record;
  v_status integer;
  v_timed_out boolean;
  v_error text;
  v_found boolean;
  v_ok integer:=0;
  v_failed integer:=0;
  v_dispatched integer:=0;
  v_pending integer:=0;
BEGIN
  UPDATE public.puplan_replication_health
  SET last_run_at=now(),updated_at=now()
  WHERE id=1;

  FOR v_req IN
    SELECT request_id,user_id,revision,created_at
    FROM public.puplan_replication_requests
    ORDER BY created_at
    LIMIT 100
  LOOP
    v_status:=NULL;
    v_timed_out:=NULL;
    v_error:=NULL;
    v_found:=false;

    SELECT r.status_code,r.timed_out,coalesce(r.error_msg,''),true
    INTO v_status,v_timed_out,v_error,v_found
    FROM net._http_response r
    WHERE r.id=v_req.request_id;

    IF coalesce(v_found,false) THEN
      IF coalesce(v_status,0) BETWEEN 200 AND 299
         AND NOT coalesce(v_timed_out,false) THEN
        DELETE FROM public.puplan_replication_outbox
        WHERE user_id=v_req.user_id AND revision=v_req.revision;
        v_ok:=v_ok+1;
      ELSE
        UPDATE public.puplan_replication_outbox
        SET attempts=attempts+1,
            next_attempt_at=CASE
              -- 409 is the standby dirty/authority fence. Rechecking every cron
              -- minute is enough; five minutes avoids a conflict retry storm.
              WHEN v_status=409 THEN now()+interval '5 minutes'
              ELSE now()+interval '1 minute'
            END,
            last_error=left(
              coalesce(nullif(v_error,''),'HTTP '||coalesce(v_status::text,'unknown')),
              500
            )
        WHERE user_id=v_req.user_id AND revision=v_req.revision;
        v_failed:=v_failed+1;
      END IF;

      DELETE FROM public.puplan_replication_requests
      WHERE request_id=v_req.request_id;

    ELSIF v_req.created_at<now()-interval '30 seconds' THEN
      UPDATE public.puplan_replication_outbox
      SET attempts=attempts+1,
          next_attempt_at=now()+interval '1 minute',
          last_error='replication acknowledgement timed out'
      WHERE user_id=v_req.user_id AND revision=v_req.revision;

      DELETE FROM public.puplan_replication_requests
      WHERE request_id=v_req.request_id;
      v_failed:=v_failed+1;
    END IF;
  END LOOP;

  FOR v_out IN
    SELECT o.user_id,o.revision
    FROM public.puplan_replication_outbox o
    WHERE o.next_attempt_at<=now()
      AND NOT EXISTS (
        SELECT 1
        FROM public.puplan_replication_requests r
        WHERE r.user_id=o.user_id AND r.revision=o.revision
      )
    ORDER BY o.changed_at
    LIMIT 20
  LOOP
    BEGIN
      PERFORM public.puplan_dispatch_replication(v_out.user_id);
      v_dispatched:=v_dispatched+1;
    EXCEPTION WHEN OTHERS THEN
      UPDATE public.puplan_replication_outbox
      SET attempts=attempts+1,
          next_attempt_at=now()+interval '1 minute',
          last_error=left(sqlerrm,500)
      WHERE user_id=v_out.user_id AND revision=v_out.revision;
      v_failed:=v_failed+1;
    END;
  END LOOP;

  SELECT count(*)::int
  INTO v_pending
  FROM public.puplan_replication_outbox;

  UPDATE public.puplan_replication_health
  SET last_success_at=CASE WHEN v_failed=0 THEN now() ELSE last_success_at END,
      last_error=CASE
        WHEN v_failed=0 THEN ''
        ELSE v_failed::text||' replication operation(s) failed'
      END,
      pending_count=v_pending,
      updated_at=now()
  WHERE id=1;

  RETURN jsonb_build_object(
    'ok',v_ok,
    'failed',v_failed,
    'dispatched',v_dispatched,
    'pending',v_pending
  );
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_sweep_replication() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_sweep_replication() TO service_role;
