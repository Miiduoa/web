-- PRIMARY ONLY: remove duplicate social replication triggers, fan conversation
-- changes out to every affected member, and make stored media metadata authoritative.

CREATE OR REPLACE FUNCTION public.puplan_enqueue_social_replication()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','extensions','net'
AS $$
DECLARE
  v_uid uuid;
  v_uid2 uuid;
  v_conversation_id uuid;
  v_post_id uuid;
  v_parent_id uuid;
  v_other uuid;
BEGIN
  IF current_setting('nolu.failback_apply', true) = '1' THEN
    RETURN coalesce(new, old);
  END IF;

  CASE tg_table_name
    WHEN 'puplan_app_friendships' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.requester_id ELSE new.requester_id END;
      v_uid2 := CASE WHEN tg_op='DELETE' THEN old.addressee_id ELSE new.addressee_id END;

    WHEN 'puplan_app_meetups' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.creator_id ELSE new.creator_id END;
      v_uid2 := CASE WHEN tg_op='DELETE' THEN old.invitee_id ELSE new.invitee_id END;

    WHEN 'puplan_app_posts' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.author_id ELSE new.author_id END;
      v_parent_id := CASE WHEN tg_op='DELETE' THEN old.parent_id ELSE new.parent_id END;
      IF v_parent_id IS NOT NULL THEN
        SELECT author_id INTO v_uid2 FROM public.puplan_app_posts WHERE id=v_parent_id;
      END IF;

    WHEN 'puplan_app_post_likes' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.user_id ELSE new.user_id END;
      v_post_id := CASE WHEN tg_op='DELETE' THEN old.post_id ELSE new.post_id END;
      SELECT author_id INTO v_uid2 FROM public.puplan_app_posts WHERE id=v_post_id;

    WHEN 'puplan_app_post_media' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.owner_id ELSE new.owner_id END;
      v_post_id := CASE WHEN tg_op='DELETE' THEN old.post_id ELSE new.post_id END;
      SELECT author_id INTO v_uid2 FROM public.puplan_app_posts WHERE id=v_post_id;

    WHEN 'puplan_app_conversations' THEN
      v_conversation_id := CASE WHEN tg_op='DELETE' THEN old.id ELSE new.id END;
      v_uid := CASE WHEN tg_op='DELETE' THEN old.created_by ELSE new.created_by END;

    WHEN 'puplan_app_conversation_members' THEN
      v_conversation_id := CASE WHEN tg_op='DELETE' THEN old.conversation_id ELSE new.conversation_id END;
      v_uid := CASE WHEN tg_op='DELETE' THEN old.user_id ELSE new.user_id END;

    WHEN 'puplan_app_messages' THEN
      v_conversation_id := CASE WHEN tg_op='DELETE' THEN old.conversation_id ELSE new.conversation_id END;
      v_uid := CASE WHEN tg_op='DELETE' THEN old.sender_id ELSE new.sender_id END;

    WHEN 'puplan_app_feed_preferences' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.viewer_id ELSE new.viewer_id END;

    WHEN 'puplan_app_author_affinity' THEN
      v_uid := CASE WHEN tg_op='DELETE' THEN old.viewer_id ELSE new.viewer_id END;

    ELSE
      RETURN coalesce(new, old);
  END CASE;

  IF v_uid IS NOT NULL THEN
    PERFORM public.puplan_queue_replication_for_user(v_uid);
  END IF;
  IF v_uid2 IS NOT NULL AND v_uid2 IS DISTINCT FROM v_uid THEN
    PERFORM public.puplan_queue_replication_for_user(v_uid2);
  END IF;

  -- Conversation payloads contain the whole member/message view. A message,
  -- membership change, or conversation metadata change therefore needs a fresh
  -- standby revision for every member, not only the actor/creator.
  IF v_conversation_id IS NOT NULL THEN
    FOR v_other IN
      SELECT cm.user_id
      FROM public.puplan_app_conversation_members cm
      WHERE cm.conversation_id=v_conversation_id
        AND cm.user_id IS DISTINCT FROM v_uid
        AND cm.user_id IS DISTINCT FROM v_uid2
    LOOP
      PERFORM public.puplan_queue_replication_for_user(v_other);
    END LOOP;
  END IF;

  RETURN coalesce(new, old);
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_enqueue_social_replication() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_enqueue_social_replication() TO service_role;

-- Older rollout paths installed a second trigger with the puplan_replica_* name.
-- Keeping both doubles revisions and outbound replication work for one mutation.
DROP TRIGGER IF EXISTS puplan_replica_affinity ON public.puplan_app_author_affinity;
DROP TRIGGER IF EXISTS puplan_replica_members ON public.puplan_app_conversation_members;
DROP TRIGGER IF EXISTS puplan_replica_conversations ON public.puplan_app_conversations;
DROP TRIGGER IF EXISTS puplan_replica_feed_preferences ON public.puplan_app_feed_preferences;
DROP TRIGGER IF EXISTS puplan_replica_friendships ON public.puplan_app_friendships;
DROP TRIGGER IF EXISTS puplan_replica_meetups ON public.puplan_app_meetups;
DROP TRIGGER IF EXISTS puplan_replica_messages ON public.puplan_app_messages;
DROP TRIGGER IF EXISTS puplan_replica_likes ON public.puplan_app_post_likes;
DROP TRIGGER IF EXISTS puplan_replica_posts ON public.puplan_app_posts;

CREATE OR REPLACE FUNCTION public.puplan_validate_post_media()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path='public','storage'
AS $$
DECLARE
  v_author uuid;
  v_metadata jsonb;
  v_size bigint;
  v_mime text;
  v_type text;
  v_existing_bytes bigint;
  v_existing_count integer;
BEGIN
  IF new.owner_id IS NULL OR new.post_id IS NULL OR coalesce(new.storage_path,'')='' THEN
    RAISE EXCEPTION 'invalid media ownership';
  END IF;

  IF cardinality(string_to_array(new.storage_path,'/'))<>2
     OR split_part(new.storage_path,'/',1)<>new.owner_id::text
     OR split_part(new.storage_path,'/',2)='' THEN
    RAISE EXCEPTION 'invalid media path';
  END IF;

  SELECT p.author_id INTO v_author
  FROM public.puplan_app_posts p
  WHERE p.id=new.post_id;
  IF v_author IS NULL OR v_author<>new.owner_id THEN
    RAISE EXCEPTION 'media owner does not match post author';
  END IF;

  SELECT o.metadata INTO v_metadata
  FROM storage.objects o
  WHERE o.bucket_id='puplan-media'
    AND o.name=new.storage_path
    AND coalesce(o.is_delete_marker,false)=false
  ORDER BY o.updated_at DESC
  LIMIT 1;
  IF v_metadata IS NULL THEN
    RAISE EXCEPTION 'stored media object not found';
  END IF;

  BEGIN
    v_size := nullif(v_metadata->>'size','')::bigint;
  EXCEPTION WHEN OTHERS THEN
    v_size := NULL;
  END;
  v_mime := lower(coalesce(v_metadata->>'mimetype',v_metadata->>'contentType',''));

  IF v_size IS NULL OR v_size<1 THEN
    RAISE EXCEPTION 'invalid stored media size';
  END IF;

  IF v_mime IN ('image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif') THEN
    v_type := 'image';
    IF v_size>12*1024*1024 THEN RAISE EXCEPTION 'image exceeds 12 MB'; END IF;
  ELSIF v_mime IN ('video/mp4','video/quicktime','video/webm') THEN
    v_type := 'video';
    IF v_size>80*1024*1024 THEN RAISE EXCEPTION 'video exceeds 80 MB'; END IF;
  ELSE
    RAISE EXCEPTION 'unsupported stored media type';
  END IF;

  SELECT coalesce(sum(pm.size_bytes),0), count(*)::int
  INTO v_existing_bytes, v_existing_count
  FROM public.puplan_app_post_media pm
  WHERE pm.post_id=new.post_id
    AND pm.id IS DISTINCT FROM new.id;

  IF v_existing_count>=6 THEN RAISE EXCEPTION 'post media count exceeds 6'; END IF;
  IF v_existing_bytes+v_size>100*1024*1024 THEN RAISE EXCEPTION 'post media total exceeds 100 MB'; END IF;

  -- Never trust client-declared metadata after upload. Persist the values that
  -- Supabase Storage actually recorded for the object.
  new.size_bytes := v_size;
  new.mime_type := v_mime;
  new.media_type := v_type;
  RETURN new;
END;
$$;

REVOKE ALL ON FUNCTION public.puplan_validate_post_media() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_validate_post_media() TO service_role;

DROP TRIGGER IF EXISTS puplan_validate_post_media_storage ON public.puplan_app_post_media;
CREATE TRIGGER puplan_validate_post_media_storage
BEFORE INSERT OR UPDATE OF post_id,owner_id,storage_path,media_type,mime_type,size_bytes
ON public.puplan_app_post_media
FOR EACH ROW EXECUTE FUNCTION public.puplan_validate_post_media();

-- Storage itself should never accept an object larger than the application's
-- largest legitimate single-file limit (80 MiB video).
UPDATE storage.buckets
SET file_size_limit=80*1024*1024
WHERE id='puplan-media'
  AND (file_size_limit IS NULL OR file_size_limit>80*1024*1024);
