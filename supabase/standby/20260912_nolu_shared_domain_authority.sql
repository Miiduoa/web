-- TOKYO STANDBY ONLY: prevent cross-user snapshot races from overwriting or
-- deleting shared social rows. Each shared aggregate has exactly one authority:
-- friendship=requester, meetup=creator, post thread=root post author,
-- conversation=conversation creator. Per-user revisions are monotonic only
-- within one user, so snapshots from different users must never compete for the
-- same shared aggregate.

CREATE OR REPLACE FUNCTION public.puplan_affinity_like_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' THEN
    RETURN coalesce(new,old);
  END IF;
  SELECT author_id INTO a FROM public.puplan_app_posts WHERE id=coalesce(new.post_id,old.post_id);
  PERFORM public.puplan_adjust_affinity(
    coalesce(new.user_id,old.user_id),
    a,
    CASE WHEN tg_op='INSERT' THEN 2.0 ELSE -2.0 END
  );
  RETURN coalesce(new,old);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_affinity_reply_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE a uuid; delta real:=0;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' THEN
    RETURN coalesce(new,old);
  END IF;
  IF coalesce(new.parent_id,old.parent_id) IS NULL THEN RETURN coalesce(new,old); END IF;
  SELECT author_id INTO a FROM public.puplan_app_posts WHERE id=coalesce(new.parent_id,old.parent_id);
  IF tg_op='INSERT' THEN delta:=3.0;
  ELSIF tg_op='DELETE' THEN delta:=-3.0;
  ELSIF old.deleted_at IS NULL AND new.deleted_at IS NOT NULL THEN delta:=-3.0;
  ELSIF old.deleted_at IS NOT NULL AND new.deleted_at IS NULL THEN delta:=3.0;
  END IF;
  IF delta<>0 THEN
    PERFORM public.puplan_adjust_affinity(coalesce(new.author_id,old.author_id),a,delta);
  END IF;
  RETURN coalesce(new,old);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_apply_server_replica(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_revision bigint;
  v_kind text;
  v_last_revision bigint;
  v_user jsonb;
  v_schedule jsonb;
  v_semesters jsonb;
  v_friendships jsonb;
  v_meetups jsonb;
  v_posts jsonb;
  v_likes jsonb;
  v_conversations jsonb;
  v_members jsonb;
  v_messages jsonb;
  v_feed_preferences jsonb;
  v_affinity jsonb;
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
  VALUES(v_uid,0,v_now)
  ON CONFLICT(user_id) DO NOTHING;
  SELECT last_revision INTO v_last_revision
  FROM public.puplan_replica_server_state
  WHERE user_id=v_uid
  FOR UPDATE;
  IF v_revision<=coalesce(v_last_revision,0) THEN
    RETURN jsonb_build_object('ok',true,'ignored',true,'applied_revision',v_last_revision);
  END IF;

  -- Replication replays source rows. Derived affinity must not be modified by
  -- the normal social interaction triggers while those rows are reconstructed.
  PERFORM set_config('nolu.replica_apply','1',true);

  IF v_kind='core-delete' THEN
    DELETE FROM public.puplan_app_feed_preferences WHERE viewer_id=v_uid;
    DELETE FROM public.puplan_app_author_affinity WHERE viewer_id=v_uid OR author_id=v_uid;
    DELETE FROM public.puplan_app_post_likes WHERE user_id=v_uid;
    DELETE FROM public.puplan_app_posts WHERE author_id=v_uid;
    DELETE FROM public.puplan_app_meetups WHERE creator_id=v_uid OR invitee_id=v_uid;
    DELETE FROM public.puplan_app_friendships WHERE requester_id=v_uid OR addressee_id=v_uid;
    DELETE FROM public.puplan_app_semesters WHERE user_id=v_uid;
    DELETE FROM public.puplan_app_schedules WHERE user_id=v_uid;
    DELETE FROM public.puplan_replica_state WHERE user_id=v_uid;
    DELETE FROM public.puplan_app_users WHERE id=v_uid;
    UPDATE public.puplan_replica_server_state
    SET last_revision=v_revision,last_applied_at=v_now,updated_at=v_now
    WHERE user_id=v_uid;
    PERFORM set_config('nolu.replica_apply','0',true);
    RETURN jsonb_build_object('ok',true,'ignored',false,'applied_revision',v_revision,'kind',v_kind);
  END IF;

  v_user:=p_payload#>'{bundle,user}';
  v_schedule:=p_payload#>'{bundle,schedule}';
  v_semesters:=coalesce(p_payload#>'{bundle,semesters}','[]'::jsonb);
  v_friendships:=coalesce(p_payload#>'{bundle,friendships}','[]'::jsonb);
  v_meetups:=coalesce(p_payload#>'{bundle,meetups}','[]'::jsonb);
  v_posts:=coalesce(p_payload#>'{bundle,posts}','[]'::jsonb);
  v_likes:=coalesce(p_payload#>'{bundle,post_likes}','[]'::jsonb);
  v_conversations:=coalesce(p_payload#>'{bundle,conversations}','[]'::jsonb);
  v_members:=coalesce(p_payload#>'{bundle,conversation_members}','[]'::jsonb);
  v_messages:=coalesce(p_payload#>'{bundle,messages}','[]'::jsonb);
  v_feed_preferences:=coalesce(p_payload#>'{bundle,feed_preferences}','[]'::jsonb);
  v_affinity:=coalesce(p_payload#>'{bundle,author_affinity}','[]'::jsonb);

  IF v_user IS NULL
     OR coalesce(v_user->>'id','')<>v_uid::text
     OR coalesce(v_user->>'email','')=''
     OR coalesce(v_user->>'username','')=''
     OR coalesce(v_user->>'password_salt','')=''
     OR coalesce(v_user->>'password_hash','')='' THEN
    RAISE EXCEPTION 'invalid replica bundle';
  END IF;
  IF jsonb_typeof(v_semesters)<>'array'
     OR jsonb_typeof(v_friendships)<>'array'
     OR jsonb_typeof(v_meetups)<>'array'
     OR jsonb_typeof(v_posts)<>'array'
     OR jsonb_typeof(v_likes)<>'array'
     OR jsonb_typeof(v_conversations)<>'array'
     OR jsonb_typeof(v_members)<>'array'
     OR jsonb_typeof(v_messages)<>'array'
     OR jsonb_typeof(v_feed_preferences)<>'array'
     OR jsonb_typeof(v_affinity)<>'array' THEN
    RAISE EXCEPTION 'invalid replica arrays';
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
  ) ON CONFLICT(id) DO UPDATE SET
    email=excluded.email,display_name=excluded.display_name,username=excluded.username,
    password_salt=excluded.password_salt,password_hash=excluded.password_hash,
    updated_at=excluded.updated_at,avatar_data=excluded.avatar_data,bio=excluded.bio,
    discoverable=excluded.discoverable,recovery_salt=excluded.recovery_salt,
    recovery_hash=excluded.recovery_hash,recovery_created_at=excluded.recovery_created_at,
    role=excluded.role,profile_visibility=excluded.profile_visibility;

  IF v_schedule IS NULL OR v_schedule='null'::jsonb THEN
    DELETE FROM public.puplan_app_schedules WHERE user_id=v_uid;
  ELSE
    IF coalesce(v_schedule->>'user_id','')<>v_uid::text
       OR jsonb_typeof(v_schedule->'courses')<>'array' THEN
      RAISE EXCEPTION 'invalid schedule bundle';
    END IF;
    INSERT INTO public.puplan_app_schedules(user_id,courses,updated_at)
    VALUES(v_uid,coalesce(v_schedule->'courses','[]'::jsonb),coalesce((v_schedule->>'updated_at')::timestamptz,v_now))
    ON CONFLICT(user_id) DO UPDATE SET courses=excluded.courses,updated_at=excluded.updated_at;
  END IF;

  DELETE FROM public.puplan_app_semesters WHERE user_id=v_uid;
  INSERT INTO public.puplan_app_semesters
  SELECT * FROM jsonb_populate_recordset(null::public.puplan_app_semesters,v_semesters)
  WHERE user_id=v_uid;

  -- Friendship state is requester-owned. Addressee snapshots may observe it but
  -- can never overwrite or delete the requester's newer revision.
  DELETE FROM public.puplan_app_friendships f
  WHERE f.requester_id=v_uid
    AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_friendships) x
      WHERE (x->>'id')::bigint=f.id AND x->>'requester_id'=v_uid::text
    );
  INSERT INTO public.puplan_app_friendships
  SELECT * FROM jsonb_populate_recordset(null::public.puplan_app_friendships,v_friendships)
  WHERE requester_id=v_uid
  ON CONFLICT(id) DO UPDATE SET
    requester_id=excluded.requester_id,addressee_id=excluded.addressee_id,
    status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at;

  -- Meetup state is creator-owned for the same reason. Invitee responses queue
  -- the creator as well, so the creator's monotonic stream carries final state.
  DELETE FROM public.puplan_app_meetups m
  WHERE m.creator_id=v_uid
    AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_meetups) x
      WHERE (x->>'id')::uuid=m.id AND x->>'creator_id'=v_uid::text
    );
  INSERT INTO public.puplan_app_meetups
  SELECT * FROM jsonb_populate_recordset(null::public.puplan_app_meetups,v_meetups)
  WHERE creator_id=v_uid
  ON CONFLICT(id) DO UPDATE SET
    creator_id=excluded.creator_id,invitee_id=excluded.invitee_id,kind=excluded.kind,
    day=excluded.day,start_period=excluded.start_period,end_period=excluded.end_period,
    note=excluded.note,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at;

  -- A post thread is owned by the top-level post author. Rebuilding only that
  -- owner's roots makes reply/like snapshots from other users observational,
  -- never authoritative. Deleting the root cascades its replies and likes.
  DELETE FROM public.puplan_app_posts p
  WHERE p.author_id=v_uid AND p.parent_id IS NULL;

  INSERT INTO public.puplan_app_posts(
    id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,like_count,reply_count
  )
  SELECT id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,0,0
  FROM jsonb_populate_recordset(null::public.puplan_app_posts,v_posts)
  WHERE parent_id IS NULL AND author_id=v_uid;

  INSERT INTO public.puplan_app_posts(
    id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,like_count,reply_count
  )
  SELECT p.id,p.author_id,p.parent_id,p.body,p.created_at,p.updated_at,p.deleted_at,p.visibility,0,0
  FROM jsonb_populate_recordset(null::public.puplan_app_posts,v_posts) p
  WHERE p.parent_id IN (
    SELECT root.id
    FROM jsonb_populate_recordset(null::public.puplan_app_posts,v_posts) root
    WHERE root.parent_id IS NULL AND root.author_id=v_uid
  );

  INSERT INTO public.puplan_app_post_likes
  SELECT l.*
  FROM jsonb_populate_recordset(null::public.puplan_app_post_likes,v_likes) l
  WHERE l.post_id IN (
    SELECT p.id FROM public.puplan_app_posts p
    WHERE (p.author_id=v_uid AND p.parent_id IS NULL)
       OR p.parent_id IN (
         SELECT r.id FROM public.puplan_app_posts r
         WHERE r.author_id=v_uid AND r.parent_id IS NULL
       )
  )
  ON CONFLICT(post_id,user_id) DO NOTHING;

  -- A conversation is creator-owned as one aggregate: metadata, members and
  -- messages. A removed participant's later snapshot therefore cannot delete
  -- the whole conversation or resurrect stale membership/message state.
  DELETE FROM public.puplan_app_conversations c
  WHERE c.created_by=v_uid
    AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_conversations) x
      WHERE (x->>'id')::uuid=c.id AND x->>'created_by'=v_uid::text
    );

  INSERT INTO public.puplan_app_conversations
  SELECT * FROM jsonb_populate_recordset(null::public.puplan_app_conversations,v_conversations)
  WHERE created_by=v_uid
  ON CONFLICT(id) DO UPDATE SET
    kind=excluded.kind,title=excluded.title,created_by=excluded.created_by,
    direct_key=excluded.direct_key,created_at=excluded.created_at,updated_at=excluded.updated_at,
    last_message_body=excluded.last_message_body,last_message_sender_id=excluded.last_message_sender_id,
    last_message_at=excluded.last_message_at;

  DELETE FROM public.puplan_app_conversation_members cm
  USING public.puplan_app_conversations c
  WHERE cm.conversation_id=c.id
    AND c.created_by=v_uid
    AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_members) x
      WHERE (x->>'conversation_id')::uuid=cm.conversation_id
        AND (x->>'user_id')::uuid=cm.user_id
    );

  INSERT INTO public.puplan_app_conversation_members
  SELECT cm.*
  FROM jsonb_populate_recordset(null::public.puplan_app_conversation_members,v_members) cm
  JOIN public.puplan_app_conversations c ON c.id=cm.conversation_id
  WHERE c.created_by=v_uid
  ON CONFLICT(conversation_id,user_id) DO UPDATE SET
    role=excluded.role,joined_at=excluded.joined_at,
    last_read_at=excluded.last_read_at,unread_count=excluded.unread_count;

  DELETE FROM public.puplan_app_messages msg
  USING public.puplan_app_conversations c
  WHERE msg.conversation_id=c.id
    AND c.created_by=v_uid
    AND NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_messages) x
      WHERE (x->>'id')::uuid=msg.id
    );

  INSERT INTO public.puplan_app_messages
  SELECT msg.*
  FROM jsonb_populate_recordset(null::public.puplan_app_messages,v_messages) msg
  JOIN public.puplan_app_conversations c ON c.id=msg.conversation_id
  WHERE c.created_by=v_uid
  ON CONFLICT(id) DO UPDATE SET
    conversation_id=excluded.conversation_id,sender_id=excluded.sender_id,
    body=excluded.body,created_at=excluded.created_at,edited_at=excluded.edited_at;

  DELETE FROM public.puplan_app_feed_preferences WHERE viewer_id=v_uid;
  INSERT INTO public.puplan_app_feed_preferences
  SELECT * FROM jsonb_populate_recordset(null::public.puplan_app_feed_preferences,v_feed_preferences)
  WHERE viewer_id=v_uid
  ON CONFLICT(viewer_id,preference_key) DO UPDATE SET
    direction=excluded.direction,expires_at=excluded.expires_at,updated_at=excluded.updated_at;

  DELETE FROM public.puplan_app_author_affinity WHERE viewer_id=v_uid;
  INSERT INTO public.puplan_app_author_affinity
  SELECT * FROM jsonb_populate_recordset(null::public.puplan_app_author_affinity,v_affinity)
  WHERE viewer_id=v_uid
  ON CONFLICT(viewer_id,author_id) DO UPDATE SET score=excluded.score,updated_at=excluded.updated_at;

  INSERT INTO public.puplan_replica_state(user_id,enabled,seeded_at,credentials_synced_at,updated_at)
  VALUES(v_uid,true,v_now,v_now,v_now)
  ON CONFLICT(user_id) DO UPDATE SET
    enabled=true,
    seeded_at=coalesce(public.puplan_replica_state.seeded_at,excluded.seeded_at),
    credentials_synced_at=excluded.credentials_synced_at,
    updated_at=excluded.updated_at;

  UPDATE public.puplan_replica_server_state
  SET last_revision=v_revision,last_applied_at=v_now,updated_at=v_now
  WHERE user_id=v_uid;
  PERFORM set_config('nolu.replica_apply','0',true);
  RETURN jsonb_build_object(
    'ok',true,'ignored',false,'applied_revision',v_revision,'kind',v_kind,
    'social',true,'shared_authority','owner-domain-v1'
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;
