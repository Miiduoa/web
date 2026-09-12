-- TOKYO STANDBY ONLY: make media metadata replay part of the same guarded transaction as the core/social snapshot.
DO $block$
BEGIN
  IF to_regprocedure('public.puplan_apply_replica_media_unchecked(jsonb)') IS NULL THEN
    ALTER FUNCTION public.puplan_apply_replica_media(jsonb) RENAME TO puplan_apply_replica_media_unchecked;
  END IF;
END;
$block$;

REVOKE ALL ON FUNCTION public.puplan_apply_replica_media_unchecked(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.puplan_apply_replica_media(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  v_uid:=(p_payload->>'uid')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text,90210));
  IF EXISTS(SELECT 1 FROM public.puplan_standby_dirty_users d WHERE d.user_id=v_uid AND d.is_dirty=true) THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'error','STANDBY_DIRTY');
  END IF;
  PERFORM set_config('nolu.replica_apply','1',true);
  PERFORM set_config('nolu.replica_uid',v_uid::text,true);
  RETURN public.puplan_apply_replica_media_unchecked(p_payload);
END;
$function$;
REVOKE ALL ON FUNCTION public.puplan_apply_replica_media(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_replica_media(jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public.puplan_apply_server_replica(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_last_revision bigint; v_result jsonb; v_media jsonb;
BEGIN
  v_uid:=(p_payload->>'uid')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text,90210));
  SELECT last_revision INTO v_last_revision FROM public.puplan_replica_server_state WHERE user_id=v_uid;
  IF EXISTS(SELECT 1 FROM public.puplan_standby_dirty_users d WHERE d.user_id=v_uid AND d.is_dirty=true) THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'error','STANDBY_DIRTY','applied_revision',coalesce(v_last_revision,0),'incoming_revision',coalesce((p_payload->>'revision')::bigint,0));
  END IF;
  PERFORM set_config('nolu.replica_apply','1',true);
  PERFORM set_config('nolu.replica_uid',v_uid::text,true);
  v_result:=public.puplan_apply_server_replica_unchecked(p_payload);
  IF p_payload->>'kind'='core-seed' AND coalesce((v_result->>'ignored')::boolean,false)=false THEN
    v_media:=public.puplan_apply_replica_media_unchecked(p_payload);
  ELSE
    v_media:=jsonb_build_object('ok',true,'count',0,'skipped',true);
  END IF;
  RETURN coalesce(v_result,'{}'::jsonb)||jsonb_build_object('media',v_media);
END;
$function$;
REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;