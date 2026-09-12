-- PRIMARY ONLY: make the social replication payload reproducible from Git.
-- The Tokyo standby applies shared aggregates by a single owner domain, while
-- these snapshots still include the full viewer-visible dependency set needed
-- for failover reads and deterministic owner reconstruction.

CREATE OR REPLACE FUNCTION public.puplan_build_replication_payload(p_uid uuid,p_revision bigint)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public'
AS $$
DECLARE
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
  v_now timestamptz:=clock_timestamp();
BEGIN
  SELECT jsonb_build_object(
    'id',u.id,'email',u.email,'display_name',u.display_name,'username',u.username,
    'password_salt',u.password_salt,'password_hash',u.password_hash,
    'created_at',u.created_at,'updated_at',u.updated_at,'avatar_data',u.avatar_data,
    'bio',u.bio,'discoverable',u.discoverable,'recovery_salt',u.recovery_salt,
    'recovery_hash',u.recovery_hash,'recovery_created_at',u.recovery_created_at,
    'role',u.role,'profile_visibility',u.profile_visibility
  ) INTO v_user
  FROM public.puplan_app_users u
  WHERE u.id=p_uid;

  IF v_user IS NULL THEN
    RETURN jsonb_build_object(
      'v',2,'kind','core-delete','iss','hrrmkrayvrgnwcroyttp','aud','ltfurqaspqsvswmebyzw',
      'iat',v_now,'exp',v_now+interval '2 minutes','nonce',gen_random_uuid(),
      'uid',p_uid,'revision',p_revision
    );
  END IF;

  SELECT jsonb_build_object('user_id',s.user_id,'courses',s.courses,'updated_at',s.updated_at)
  INTO v_schedule
  FROM public.puplan_app_schedules s
  WHERE s.user_id=p_uid;

  SELECT coalesce(jsonb_agg(to_jsonb(s) ORDER BY s.updated_at,s.id),'[]'::jsonb)
  INTO v_semesters
  FROM public.puplan_app_semesters s
  WHERE s.user_id=p_uid;

  SELECT coalesce(jsonb_agg(to_jsonb(f) ORDER BY f.updated_at,f.id),'[]'::jsonb)
  INTO v_friendships
  FROM public.puplan_app_friendships f
  WHERE f.requester_id=p_uid OR f.addressee_id=p_uid;

  SELECT coalesce(jsonb_agg(to_jsonb(m) ORDER BY m.updated_at,m.id),'[]'::jsonb)
  INTO v_meetups
  FROM public.puplan_app_meetups m
  WHERE m.creator_id=p_uid OR m.invitee_id=p_uid;

  WITH roots AS (
    SELECT p.id
    FROM public.puplan_app_posts p
    WHERE p.author_id=p_uid AND p.parent_id IS NULL
    UNION
    SELECT p.parent_id
    FROM public.puplan_app_posts p
    WHERE p.author_id=p_uid AND p.parent_id IS NOT NULL
  ), relevant AS (
    SELECT p.*
    FROM public.puplan_app_posts p
    WHERE p.author_id=p_uid
       OR p.id IN(SELECT id FROM roots)
       OR p.parent_id IN(SELECT id FROM roots)
  )
  SELECT coalesce(jsonb_agg(to_jsonb(relevant) ORDER BY relevant.created_at,relevant.id),'[]'::jsonb)
  INTO v_posts
  FROM relevant;

  WITH relevant_posts AS (
    SELECT p.id
    FROM public.puplan_app_posts p
    WHERE p.author_id=p_uid
    UNION
    SELECT p.parent_id
    FROM public.puplan_app_posts p
    WHERE p.author_id=p_uid AND p.parent_id IS NOT NULL
    UNION
    SELECT p.id
    FROM public.puplan_app_posts p
    WHERE p.parent_id IN(
      SELECT x.id
      FROM public.puplan_app_posts x
      WHERE x.author_id=p_uid AND x.parent_id IS NULL
    )
  )
  SELECT coalesce(jsonb_agg(to_jsonb(l) ORDER BY l.created_at,l.post_id,l.user_id),'[]'::jsonb)
  INTO v_likes
  FROM public.puplan_app_post_likes l
  WHERE l.user_id=p_uid OR l.post_id IN(SELECT id FROM relevant_posts);

  WITH conv AS (
    SELECT cm.conversation_id AS id
    FROM public.puplan_app_conversation_members cm
    WHERE cm.user_id=p_uid
  )
  SELECT coalesce(jsonb_agg(to_jsonb(c) ORDER BY c.updated_at,c.id),'[]'::jsonb)
  INTO v_conversations
  FROM public.puplan_app_conversations c
  WHERE c.id IN(SELECT id FROM conv);

  WITH conv AS (
    SELECT cm.conversation_id AS id
    FROM public.puplan_app_conversation_members cm
    WHERE cm.user_id=p_uid
  )
  SELECT coalesce(jsonb_agg(to_jsonb(cm) ORDER BY cm.joined_at,cm.conversation_id,cm.user_id),'[]'::jsonb)
  INTO v_members
  FROM public.puplan_app_conversation_members cm
  WHERE cm.conversation_id IN(SELECT id FROM conv);

  WITH conv AS (
    SELECT cm.conversation_id AS id
    FROM public.puplan_app_conversation_members cm
    WHERE cm.user_id=p_uid
  )
  SELECT coalesce(jsonb_agg(to_jsonb(msg) ORDER BY msg.created_at,msg.id),'[]'::jsonb)
  INTO v_messages
  FROM public.puplan_app_messages msg
  WHERE msg.conversation_id IN(SELECT id FROM conv);

  SELECT coalesce(jsonb_agg(to_jsonb(fp) ORDER BY fp.updated_at,fp.preference_key),'[]'::jsonb)
  INTO v_feed_preferences
  FROM public.puplan_app_feed_preferences fp
  WHERE fp.viewer_id=p_uid;

  SELECT coalesce(jsonb_agg(to_jsonb(a) ORDER BY a.updated_at,a.author_id),'[]'::jsonb)
  INTO v_affinity
  FROM public.puplan_app_author_affinity a
  WHERE a.viewer_id=p_uid;

  RETURN jsonb_build_object(
    'v',2,'kind','core-seed','iss','hrrmkrayvrgnwcroyttp','aud','ltfurqaspqsvswmebyzw',
    'iat',v_now,'exp',v_now+interval '2 minutes','nonce',gen_random_uuid(),
    'uid',p_uid,'revision',p_revision,
    'bundle',jsonb_build_object(
      'user',v_user,
      'schedule',v_schedule,
      'semesters',v_semesters,
      'friendships',v_friendships,
      'meetups',v_meetups,
      'posts',v_posts,
      'post_likes',v_likes,
      'conversations',v_conversations,
      'conversation_members',v_members,
      'messages',v_messages,
      'feed_preferences',v_feed_preferences,
      'author_affinity',v_affinity
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_build_replication_payload(uuid,bigint) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_build_replication_payload(uuid,bigint) TO service_role;
