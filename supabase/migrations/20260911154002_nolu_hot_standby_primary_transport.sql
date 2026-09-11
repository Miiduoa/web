-- PRIMARY ONLY: payload construction and event transport.

CREATE OR REPLACE FUNCTION public.puplan_next_replication_revision(p_uid uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $$
DECLARE v_revision bigint;
BEGIN
  INSERT INTO public.puplan_replication_versions(user_id,revision,updated_at)
  VALUES (p_uid,1,now())
  ON CONFLICT (user_id) DO UPDATE SET revision=public.puplan_replication_versions.revision+1,updated_at=now()
  RETURNING revision INTO v_revision;
  RETURN v_revision;
END;
$$;

CREATE OR REPLACE FUNCTION public.puplan_build_replication_payload(p_uid uuid,p_revision bigint)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $$
DECLARE v_user jsonb; v_schedule jsonb; v_semesters jsonb; v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT jsonb_build_object(
    'id',u.id,'email',u.email,'display_name',u.display_name,'username',u.username,
    'password_salt',u.password_salt,'password_hash',u.password_hash,
    'created_at',u.created_at,'updated_at',u.updated_at,'avatar_data',u.avatar_data,
    'bio',u.bio,'discoverable',u.discoverable,'recovery_salt',u.recovery_salt,
    'recovery_hash',u.recovery_hash,'recovery_created_at',u.recovery_created_at,
    'role',u.role,'profile_visibility',u.profile_visibility
  ) INTO v_user FROM public.puplan_app_users u WHERE u.id=p_uid;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object('v',2,'kind','core-delete','iss','hrrmkrayvrgnwcroyttp','aud','ltfurqaspqsvswmebyzw','iat',v_now,'exp',v_now+interval '2 minutes','nonce',gen_random_uuid(),'uid',p_uid,'revision',p_revision);
  END IF;

  SELECT jsonb_build_object('user_id',s.user_id,'courses',s.courses,'updated_at',s.updated_at)
  INTO v_schedule FROM public.puplan_app_schedules s WHERE s.user_id=p_uid;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'user_id',s.user_id,'semester_key',s.semester_key,'label',s.label,
    'school',s.school,'department',s.department,'class_name',s.class_name,'credits',s.credits,
    'courses',s.courses,'is_current',s.is_current,'created_at',s.created_at,'updated_at',s.updated_at
  ) ORDER BY s.updated_at,s.id),'[]'::jsonb)
  INTO v_semesters FROM public.puplan_app_semesters s WHERE s.user_id=p_uid;

  RETURN jsonb_build_object('v',2,'kind','core-seed','iss','hrrmkrayvrgnwcroyttp','aud','ltfurqaspqsvswmebyzw','iat',v_now,'exp',v_now+interval '2 minutes','nonce',gen_random_uuid(),'uid',p_uid,'revision',p_revision,'bundle',jsonb_build_object('user',v_user,'schedule',v_schedule,'semesters',v_semesters));
END;
$$;

CREATE OR REPLACE FUNCTION public.puplan_dispatch_replication(p_uid uuid)
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public','extensions','net'
AS $$
DECLARE v_revision bigint; v_secret text; v_payload jsonb; v_payload_text text; v_auth text; v_request_id bigint;
BEGIN
  SELECT revision INTO v_revision FROM public.puplan_replication_outbox WHERE user_id=p_uid;
  IF v_revision IS NULL THEN RETURN NULL; END IF;
  SELECT token INTO v_secret FROM public.puplan_replication_worker_secret WHERE id=1;
  IF v_secret IS NULL THEN RAISE EXCEPTION 'replication worker secret missing'; END IF;
  v_payload:=public.puplan_build_replication_payload(p_uid,v_revision);
  v_payload_text:=v_payload::text;
  v_auth:=encode(hmac(convert_to(v_payload_text,'utf8'),decode(v_secret,'hex'),'sha256'),'hex');
  SELECT net.http_post(
    url:='https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-replica-relay-v2',
    body:=jsonb_build_object('payload',v_payload_text,'auth',v_auth),
    headers:=jsonb_build_object('Content-Type','application/json'),timeout_milliseconds:=20000
  ) INTO v_request_id;
  IF v_request_id IS NULL THEN RAISE EXCEPTION 'replication request was not queued'; END IF;
  INSERT INTO public.puplan_replication_requests(request_id,user_id,revision,created_at)
  VALUES (v_request_id,p_uid,v_revision,clock_timestamp()) ON CONFLICT (request_id) DO NOTHING;
  UPDATE public.puplan_replication_outbox SET next_attempt_at=now()+interval '1 minute'
  WHERE user_id=p_uid AND revision=v_revision;
  RETURN v_request_id;
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_next_replication_revision(uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.puplan_build_replication_payload(uuid,bigint) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.puplan_dispatch_replication(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_next_replication_revision(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_build_replication_payload(uuid,bigint) TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_dispatch_replication(uuid) TO service_role;
