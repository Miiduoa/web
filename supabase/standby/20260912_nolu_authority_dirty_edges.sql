-- TOKYO STANDBY ONLY: bind outage-era child writes to the user that owns the
-- replicated aggregate. A dirty actor alone is not enough: per-user primary
-- revisions mean an otherwise-clean root author / conversation creator could
-- replay a stale aggregate and erase another user's newer reply, like, message
-- or read state before that actor has completed signed failback.

CREATE TABLE IF NOT EXISTS public.puplan_standby_dirty_authorities (
  actor_user_id uuid NOT NULL,
  authority_user_id uuid NOT NULL,
  generation bigint NOT NULL CHECK (generation > 0),
  reason text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, authority_user_id)
);
ALTER TABLE public.puplan_standby_dirty_authorities ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.puplan_standby_dirty_authorities FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puplan_standby_dirty_authorities TO service_role;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_authority(
  p_actor uuid,
  p_authority uuid,
  p_reason text DEFAULT ''
)
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_authority uuid:=coalesce(p_authority,p_actor);
  v_generation bigint;
BEGIN
  IF p_actor IS NULL
     OR current_setting('nolu.replica_apply', true)='1'
     OR current_setting('nolu.failback_apply', true)='1' THEN
    RETURN 0;
  END IF;

  -- The replica wrapper locks the authority with the same advisory namespace.
  -- Lock actor + authority in deterministic UUID-text order so cross-user
  -- interactions cannot deadlock while still making the BEFORE trigger and
  -- incoming authority replay mutually exclusive.
  IF p_actor::text <= v_authority::text THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,90210));
    IF v_authority IS DISTINCT FROM p_actor THEN
      PERFORM pg_advisory_xact_lock(hashtextextended(v_authority::text,90210));
    END IF;
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended(v_authority::text,90210));
    PERFORM pg_advisory_xact_lock(hashtextextended(p_actor::text,90210));
  END IF;

  v_generation:=public.puplan_mark_standby_dirty_user(p_actor,p_reason);
  IF v_generation<=0 THEN RETURN v_generation; END IF;

  INSERT INTO public.puplan_standby_dirty_authorities(
    actor_user_id,authority_user_id,generation,reason,updated_at
  ) VALUES (
    p_actor,v_authority,v_generation,left(coalesce(p_reason,''),120),clock_timestamp()
  )
  ON CONFLICT(actor_user_id,authority_user_id) DO UPDATE SET
    generation=greatest(public.puplan_standby_dirty_authorities.generation,excluded.generation),
    reason=excluded.reason,
    updated_at=excluded.updated_at;
  RETURN v_generation;
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_authority(uuid,uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_mark_standby_dirty_authority(uuid,uuid,text) TO service_role;

-- Clearing a user's dirty generation after a successful signed failback clears
-- only authority edges represented by that same snapshot. A write racing the
-- failback increments generation first and therefore keeps both fences alive.
CREATE OR REPLACE FUNCTION public.puplan_clear_standby_dirty_user(
  p_uid uuid,
  p_expected_generation bigint
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_dirty boolean;
  v_generation bigint;
BEGIN
  IF p_uid IS NULL OR p_expected_generation<0 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_uid::text,90210));
  SELECT is_dirty,generation
  INTO v_dirty,v_generation
  FROM public.puplan_standby_dirty_users
  WHERE user_id=p_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    IF p_expected_generation=0 THEN
      DELETE FROM public.puplan_standby_dirty_authorities WHERE actor_user_id=p_uid;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF coalesce(v_dirty,false)=false THEN
    IF p_expected_generation=0 OR p_expected_generation=v_generation THEN
      DELETE FROM public.puplan_standby_dirty_authorities WHERE actor_user_id=p_uid;
      RETURN true;
    END IF;
    RETURN false;
  END IF;

  IF v_generation<>p_expected_generation THEN RETURN false; END IF;
  UPDATE public.puplan_standby_dirty_users
  SET is_dirty=false,last_dirty_at=clock_timestamp(),reason=''
  WHERE user_id=p_uid AND is_dirty=true AND generation=p_expected_generation;
  IF NOT FOUND THEN RETURN false; END IF;

  DELETE FROM public.puplan_standby_dirty_authorities
  WHERE actor_user_id=p_uid AND generation<=p_expected_generation;
  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_clear_standby_dirty_user(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_clear_standby_dirty_user(uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_post_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_parent uuid;
  v_authority uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1'
     OR current_setting('nolu.failback_apply', true)='1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  IF TG_OP='UPDATE'
     AND NEW.author_id IS NOT DISTINCT FROM OLD.author_id
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility THEN
    RETURN NEW;
  END IF;

  v_actor:=CASE WHEN TG_OP='DELETE' THEN OLD.author_id ELSE NEW.author_id END;
  v_parent:=CASE WHEN TG_OP='DELETE' THEN OLD.parent_id ELSE NEW.parent_id END;
  IF v_parent IS NULL THEN
    v_authority:=v_actor;
  ELSE
    SELECT author_id INTO v_authority
    FROM public.puplan_app_posts
    WHERE id=v_parent AND parent_id IS NULL;
    v_authority:=coalesce(v_authority,v_actor);
  END IF;
  PERFORM public.puplan_mark_standby_dirty_authority(v_actor,v_authority,'post:'||lower(TG_OP));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_like_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_post uuid;
  v_authority uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1'
     OR current_setting('nolu.failback_apply', true)='1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  v_actor:=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_post:=CASE WHEN TG_OP='DELETE' THEN OLD.post_id ELSE NEW.post_id END;
  SELECT author_id INTO v_authority
  FROM public.puplan_app_posts
  WHERE id=v_post AND parent_id IS NULL;
  PERFORM public.puplan_mark_standby_dirty_authority(v_actor,coalesce(v_authority,v_actor),'like:'||lower(TG_OP));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_message_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_conversation uuid;
  v_authority uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1'
     OR current_setting('nolu.failback_apply', true)='1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  v_actor:=CASE WHEN TG_OP='DELETE' THEN OLD.sender_id ELSE NEW.sender_id END;
  v_conversation:=CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  SELECT created_by INTO v_authority
  FROM public.puplan_app_conversations
  WHERE id=v_conversation;
  PERFORM public.puplan_mark_standby_dirty_authority(v_actor,coalesce(v_authority,v_actor),'message:'||lower(TG_OP));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_member_authority()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_actor uuid;
  v_conversation uuid;
  v_authority uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1'
     OR current_setting('nolu.failback_apply', true)='1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;

  -- Recipient unread +1 is a derived message-cache update; the message trigger
  -- itself records the sender -> conversation-authority edge.
  IF TG_OP='UPDATE'
     AND NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.joined_at IS NOT DISTINCT FROM OLD.joined_at
     AND NEW.last_read_at IS NOT DISTINCT FROM OLD.last_read_at
     AND NEW.unread_count=OLD.unread_count+1 THEN
    RETURN NEW;
  END IF;

  v_conversation:=CASE WHEN TG_OP='DELETE' THEN OLD.conversation_id ELSE NEW.conversation_id END;
  SELECT created_by INTO v_authority
  FROM public.puplan_app_conversations
  WHERE id=v_conversation;

  IF TG_OP='UPDATE' THEN
    v_actor:=NEW.user_id;
  ELSE
    -- Standby currently changes membership only while the conversation creator
    -- builds the aggregate. Using the aggregate authority avoids dirtying an
    -- invited member who did not initiate the write.
    v_actor:=coalesce(v_authority,CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END);
  END IF;
  PERFORM public.puplan_mark_standby_dirty_authority(v_actor,coalesce(v_authority,v_actor),'conversation_member:'||lower(TG_OP));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_post_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_like_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_message_authority() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_member_authority() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS puplan_standby_dirty_posts ON public.puplan_app_posts;
CREATE TRIGGER puplan_standby_dirty_posts
BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_posts
FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_post_authority();

DROP TRIGGER IF EXISTS puplan_standby_dirty_likes ON public.puplan_app_post_likes;
CREATE TRIGGER puplan_standby_dirty_likes
BEFORE INSERT OR DELETE ON public.puplan_app_post_likes
FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_like_authority();

DROP TRIGGER IF EXISTS puplan_standby_dirty_messages ON public.puplan_app_messages;
CREATE TRIGGER puplan_standby_dirty_messages
BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_messages
FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_message_authority();

DROP TRIGGER IF EXISTS puplan_standby_dirty_members ON public.puplan_app_conversation_members;
CREATE TRIGGER puplan_standby_dirty_members
BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_conversation_members
FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_member_authority();

-- The public service-role wrapper now rejects both direct user dirtiness and a
-- dirty child actor that belongs to the incoming user's authority domain.
CREATE OR REPLACE FUNCTION public.puplan_apply_server_replica(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid;
  v_last_revision bigint;
  v_blocked_actor uuid;
BEGIN
  v_uid:=(p_payload->>'uid')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text,90210));
  SELECT last_revision INTO v_last_revision
  FROM public.puplan_replica_server_state
  WHERE user_id=v_uid;

  IF EXISTS(
    SELECT 1 FROM public.puplan_standby_dirty_users d
    WHERE d.user_id=v_uid AND d.is_dirty=true
  ) THEN
    RETURN jsonb_build_object(
      'ok',false,'conflict',true,'error','STANDBY_DIRTY',
      'applied_revision',coalesce(v_last_revision,0),
      'incoming_revision',coalesce((p_payload->>'revision')::bigint,0)
    );
  END IF;

  SELECT da.actor_user_id INTO v_blocked_actor
  FROM public.puplan_standby_dirty_authorities da
  JOIN public.puplan_standby_dirty_users d
    ON d.user_id=da.actor_user_id AND d.is_dirty=true
  WHERE da.authority_user_id=v_uid
  LIMIT 1;
  IF v_blocked_actor IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok',false,'conflict',true,'error','STANDBY_SHARED_DIRTY',
      'applied_revision',coalesce(v_last_revision,0),
      'incoming_revision',coalesce((p_payload->>'revision')::bigint,0)
    );
  END IF;

  PERFORM set_config('nolu.replica_apply','1',true);
  PERFORM set_config('nolu.replica_uid',v_uid::text,true);
  RETURN public.puplan_apply_server_replica_unchecked(p_payload);
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;
