-- TOKYO STANDBY ONLY: monotonic, transactional apply for signed server replication.

CREATE OR REPLACE FUNCTION public.puplan_apply_server_replica(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='public'
AS $$
DECLARE
  v_uid uuid;
  v_revision bigint;
  v_kind text;
  v_last_revision bigint;
  v_user jsonb;
  v_schedule jsonb;
  v_semesters jsonb;
  v_semester jsonb;
  v_now timestamptz:=now();
BEGIN
  IF coalesce((p_payload->>'v')::int,0)<>2
     OR p_payload->>'iss'<>'hrrmkrayvrgnwcroyttp'
     OR p_payload->>'aud'<>'ltfurqaspqsvswmebyzw' THEN
    RAISE EXCEPTION 'invalid replica authority';
  END IF;

  v_kind:=p_payload->>'kind';
  IF v_kind NOT IN ('core-seed','core-delete') THEN RAISE EXCEPTION 'invalid replica kind'; END IF;
  v_uid:=(p_payload->>'uid')::uuid;
  v_revision:=(p_payload->>'revision')::bigint;
  IF v_revision<=0 THEN RAISE EXCEPTION 'invalid replica revision'; END IF;

  INSERT INTO public.puplan_replica_server_state(user_id,last_revision,updated_at)
  VALUES (v_uid,0,v_now) ON CONFLICT (user_id) DO NOTHING;
  SELECT last_revision INTO v_last_revision
  FROM public.puplan_replica_server_state WHERE user_id=v_uid FOR UPDATE;
  IF v_revision<=coalesce(v_last_revision,0) THEN
    RETURN jsonb_build_object('ok',true,'ignored',true,'applied_revision',v_last_revision);
  END IF;

  IF v_kind='core-delete' THEN
    DELETE FROM public.puplan_app_semesters WHERE user_id=v_uid;
    DELETE FROM public.puplan_app_schedules WHERE user_id=v_uid;
    DELETE FROM public.puplan_replica_state WHERE user_id=v_uid;
    DELETE FROM public.puplan_app_users WHERE id=v_uid;
    UPDATE public.puplan_replica_server_state
    SET last_revision=v_revision,last_applied_at=v_now,updated_at=v_now WHERE user_id=v_uid;
    RETURN jsonb_build_object('ok',true,'ignored',false,'applied_revision',v_revision,'kind',v_kind);
  END IF;

  v_user:=p_payload#>'{bundle,user}';
  v_schedule:=p_payload#>'{bundle,schedule}';
  v_semesters:=coalesce(p_payload#>'{bundle,semesters}','[]'::jsonb);
  IF v_user IS NULL OR coalesce(v_user->>'id','')<>v_uid::text
     OR coalesce(v_user->>'email','')='' OR coalesce(v_user->>'username','')=''
     OR coalesce(v_user->>'password_salt','')='' OR coalesce(v_user->>'password_hash','')=''
     OR jsonb_typeof(v_semesters)<>'array' THEN
    RAISE EXCEPTION 'invalid replica bundle';
  END IF;

  INSERT INTO public.puplan_app_users(
    id,email,display_name,username,password_salt,password_hash,created_at,updated_at,
    avatar_data,bio,discoverable,recovery_salt,recovery_hash,recovery_created_at,role,profile_visibility
  ) VALUES (
    v_uid,lower(left(v_user->>'email',254)),left(coalesce(v_user->>'display_name',''),24),
    lower(left(v_user->>'username',24)),v_user->>'password_salt',v_user->>'password_hash',
    coalesce((v_user->>'created_at')::timestamptz,v_now),coalesce((v_user->>'updated_at')::timestamptz,v_now),
    left(coalesce(v_user->>'avatar_data',''),180000),left(coalesce(v_user->>'bio',''),120),
    coalesce((v_user->>'discoverable')::boolean,true),nullif(v_user->>'recovery_salt',''),
    nullif(v_user->>'recovery_hash',''),nullif(v_user->>'recovery_created_at','')::timestamptz,
    CASE WHEN v_user->>'role'='admin' THEN 'admin' ELSE 'user' END,
    CASE WHEN v_user->>'profile_visibility'='private' THEN 'private' ELSE 'public' END
  ) ON CONFLICT (id) DO UPDATE SET
    email=excluded.email,display_name=excluded.display_name,username=excluded.username,
    password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=excluded.updated_at,
    avatar_data=excluded.avatar_data,bio=excluded.bio,discoverable=excluded.discoverable,
    recovery_salt=excluded.recovery_salt,recovery_hash=excluded.recovery_hash,
    recovery_created_at=excluded.recovery_created_at,role=excluded.role,profile_visibility=excluded.profile_visibility;

  IF v_schedule IS NULL OR v_schedule='null'::jsonb THEN
    DELETE FROM public.puplan_app_schedules WHERE user_id=v_uid;
  ELSE
    IF coalesce(v_schedule->>'user_id','')<>v_uid::text OR jsonb_typeof(v_schedule->'courses')<>'array' THEN
      RAISE EXCEPTION 'invalid schedule bundle';
    END IF;
    INSERT INTO public.puplan_app_schedules(user_id,courses,updated_at)
    VALUES (v_uid,coalesce(v_schedule->'courses','[]'::jsonb),coalesce((v_schedule->>'updated_at')::timestamptz,v_now))
    ON CONFLICT (user_id) DO UPDATE SET courses=excluded.courses,updated_at=excluded.updated_at;
  END IF;

  DELETE FROM public.puplan_app_semesters s
  WHERE s.user_id=v_uid
    AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_semesters) x WHERE (x->>'id')::uuid=s.id);

  FOR v_semester IN SELECT value FROM jsonb_array_elements(v_semesters)
  LOOP
    IF coalesce(v_semester->>'user_id','')<>v_uid::text OR jsonb_typeof(v_semester->'courses')<>'array' THEN
      RAISE EXCEPTION 'invalid semester bundle';
    END IF;
    INSERT INTO public.puplan_app_semesters(
      id,user_id,semester_key,label,school,department,class_name,credits,courses,is_current,created_at,updated_at
    ) VALUES (
      (v_semester->>'id')::uuid,v_uid,left(coalesce(v_semester->>'semester_key',''),24),left(coalesce(v_semester->>'label',''),60),
      left(coalesce(v_semester->>'school',''),80),left(coalesce(v_semester->>'department',''),80),left(coalesce(v_semester->>'class_name',''),80),
      greatest(0,least(60,coalesce((v_semester->>'credits')::int,0))),coalesce(v_semester->'courses','[]'::jsonb),
      coalesce((v_semester->>'is_current')::boolean,false),coalesce((v_semester->>'created_at')::timestamptz,v_now),
      coalesce((v_semester->>'updated_at')::timestamptz,v_now)
    ) ON CONFLICT (id) DO UPDATE SET
      semester_key=excluded.semester_key,label=excluded.label,school=excluded.school,department=excluded.department,
      class_name=excluded.class_name,credits=excluded.credits,courses=excluded.courses,
      is_current=excluded.is_current,updated_at=excluded.updated_at;
  END LOOP;

  INSERT INTO public.puplan_replica_state(user_id,enabled,seeded_at,credentials_synced_at,updated_at)
  VALUES (v_uid,true,v_now,v_now,v_now)
  ON CONFLICT (user_id) DO UPDATE SET
    enabled=true,seeded_at=coalesce(public.puplan_replica_state.seeded_at,excluded.seeded_at),
    credentials_synced_at=excluded.credentials_synced_at,updated_at=excluded.updated_at;

  UPDATE public.puplan_replica_server_state
  SET last_revision=v_revision,last_applied_at=v_now,updated_at=v_now WHERE user_id=v_uid;
  RETURN jsonb_build_object('ok',true,'ignored',false,'applied_revision',v_revision,'kind',v_kind);
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;
