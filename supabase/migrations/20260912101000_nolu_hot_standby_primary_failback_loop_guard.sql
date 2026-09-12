-- PRIMARY ONLY: failback writes are authoritative recovery writes and must not
-- immediately enqueue a new primary -> standby replication cycle. Social
-- triggers already honor nolu.failback_apply; make the core user/schedule/
-- semester trigger follow the same transaction-local guard.

CREATE OR REPLACE FUNCTION public.puplan_enqueue_replication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','extensions','net'
AS $$
DECLARE
  v_uid uuid;
  v_revision bigint;
BEGIN
  IF current_setting('nolu.failback_apply', true)='1' THEN
    IF tg_op='DELETE' THEN RETURN old; ELSE RETURN new; END IF;
  END IF;

  IF tg_table_name='puplan_app_users' THEN
    IF tg_op='DELETE' THEN v_uid:=old.id; ELSE v_uid:=new.id; END IF;
  ELSE
    IF tg_op='DELETE' THEN v_uid:=old.user_id; ELSE v_uid:=new.user_id; END IF;
  END IF;

  v_revision:=public.puplan_next_replication_revision(v_uid);
  INSERT INTO public.puplan_replication_outbox(
    user_id,changed_at,attempts,next_attempt_at,last_error,revision
  ) VALUES (
    v_uid,clock_timestamp(),0,now(),'',v_revision
  )
  ON CONFLICT(user_id) DO UPDATE SET
    changed_at=excluded.changed_at,
    attempts=0,
    next_attempt_at=now(),
    last_error='',
    revision=excluded.revision;

  BEGIN
    PERFORM public.puplan_dispatch_replication(v_uid);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.puplan_replication_outbox
    SET last_error=left(sqlerrm,500),next_attempt_at=now()
    WHERE user_id=v_uid AND revision=v_revision;
  END;

  IF tg_op='DELETE' THEN RETURN old; ELSE RETURN new; END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_enqueue_replication() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_enqueue_replication() TO service_role;
