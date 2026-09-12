-- TOKYO STANDBY ONLY: preserve local standby writes while Mumbai is unavailable.
--
-- Shared rows have one deterministic primary-replication authority. Row guards
-- prevent another user's stale snapshot from overwriting that authority, while a
-- generation-based dirty fence blocks the authority's own primary stream until
-- signed failback has reconciled Tokyo's newer write.

CREATE TABLE IF NOT EXISTS public.puplan_standby_dirty_users (
  user_id uuid PRIMARY KEY,
  is_dirty boolean NOT NULL DEFAULT true,
  generation bigint NOT NULL DEFAULT 1 CHECK (generation > 0),
  first_dirty_at timestamptz NOT NULL DEFAULT now(),
  last_dirty_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT ''
);
ALTER TABLE public.puplan_standby_dirty_users ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.puplan_standby_dirty_users FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.puplan_standby_dirty_users TO service_role;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_user(p_uid uuid, p_reason text DEFAULT '')
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_generation bigint;
BEGIN
  IF p_uid IS NULL OR current_setting('nolu.replica_apply', true)='1' OR current_setting('nolu.failback_apply', true)='1' THEN RETURN 0; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_uid::text,90210));
  INSERT INTO public.puplan_standby_dirty_users(user_id,is_dirty,generation,first_dirty_at,last_dirty_at,reason)
  VALUES(p_uid,true,1,clock_timestamp(),clock_timestamp(),left(coalesce(p_reason,''),120))
  ON CONFLICT(user_id) DO UPDATE SET
    is_dirty=true,
    generation=public.puplan_standby_dirty_users.generation+1,
    first_dirty_at=CASE WHEN public.puplan_standby_dirty_users.is_dirty THEN public.puplan_standby_dirty_users.first_dirty_at ELSE clock_timestamp() END,
    last_dirty_at=clock_timestamp(),
    reason=left(coalesce(excluded.reason,''),120)
  RETURNING generation INTO v_generation;
  RETURN v_generation;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_get_standby_dirty_generation(p_uid uuid)
RETURNS bigint
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce((SELECT generation FROM public.puplan_standby_dirty_users WHERE user_id=p_uid AND is_dirty=true),0)::bigint
$function$;

CREATE OR REPLACE FUNCTION public.puplan_clear_standby_dirty_user(p_uid uuid, p_expected_generation bigint)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_dirty boolean; v_generation bigint;
BEGIN
  IF p_uid IS NULL OR p_expected_generation<0 THEN RETURN false; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_uid::text,90210));
  SELECT is_dirty,generation INTO v_dirty,v_generation FROM public.puplan_standby_dirty_users WHERE user_id=p_uid FOR UPDATE;
  IF NOT FOUND THEN RETURN p_expected_generation=0; END IF;
  IF coalesce(v_dirty,false)=false THEN RETURN p_expected_generation=0 OR p_expected_generation=v_generation; END IF;
  IF v_generation<>p_expected_generation THEN RETURN false; END IF;
  UPDATE public.puplan_standby_dirty_users SET is_dirty=false,last_dirty_at=clock_timestamp(),reason=''
  WHERE user_id=p_uid AND is_dirty=true AND generation=p_expected_generation;
  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_user(uuid,text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_get_standby_dirty_generation(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_clear_standby_dirty_user(uuid,bigint) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_mark_standby_dirty_user(uuid,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_get_standby_dirty_generation(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_clear_standby_dirty_user(uuid,bigint) TO service_role;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_column()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row jsonb; v_uid uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' OR current_setting('nolu.failback_apply', true)='1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  v_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  BEGIN v_uid:=nullif(v_row->>TG_ARGV[0],'')::uuid; EXCEPTION WHEN OTHERS THEN v_uid:=NULL; END;
  IF v_uid IS NOT NULL THEN PERFORM public.puplan_mark_standby_dirty_user(v_uid,TG_TABLE_NAME||':'||lower(TG_OP)); END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_post()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' OR current_setting('nolu.failback_apply', true)='1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  IF TG_OP='UPDATE'
     AND NEW.author_id IS NOT DISTINCT FROM OLD.author_id
     AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
     AND NEW.body IS NOT DISTINCT FROM OLD.body
     AND NEW.deleted_at IS NOT DISTINCT FROM OLD.deleted_at
     AND NEW.visibility IS NOT DISTINCT FROM OLD.visibility THEN RETURN NEW; END IF;
  v_uid:=CASE WHEN TG_OP='DELETE' THEN OLD.author_id ELSE NEW.author_id END;
  PERFORM public.puplan_mark_standby_dirty_user(v_uid,'post:'||lower(TG_OP));
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_mark_standby_dirty_member_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' OR current_setting('nolu.failback_apply', true)='1' THEN RETURN NEW; END IF;
  IF NEW.role IS NOT DISTINCT FROM OLD.role
     AND NEW.joined_at IS NOT DISTINCT FROM OLD.joined_at
     AND NEW.last_read_at IS NOT DISTINCT FROM OLD.last_read_at
     AND NEW.unread_count=OLD.unread_count+1 THEN RETURN NEW; END IF;
  PERFORM public.puplan_mark_standby_dirty_user(NEW.user_id,'conversation_member:update');
  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_column() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_post() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_mark_standby_dirty_member_update() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS puplan_standby_dirty_users ON public.puplan_app_users;
CREATE TRIGGER puplan_standby_dirty_users BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_users FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('id');
DROP TRIGGER IF EXISTS puplan_standby_dirty_schedules ON public.puplan_app_schedules;
CREATE TRIGGER puplan_standby_dirty_schedules BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_schedules FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('user_id');
DROP TRIGGER IF EXISTS puplan_standby_dirty_semesters ON public.puplan_app_semesters;
CREATE TRIGGER puplan_standby_dirty_semesters BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_semesters FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('user_id');
DROP TRIGGER IF EXISTS puplan_standby_dirty_posts ON public.puplan_app_posts;
CREATE TRIGGER puplan_standby_dirty_posts BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_posts FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_post();
DROP TRIGGER IF EXISTS puplan_standby_dirty_likes ON public.puplan_app_post_likes;
CREATE TRIGGER puplan_standby_dirty_likes BEFORE INSERT OR DELETE ON public.puplan_app_post_likes FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('user_id');
DROP TRIGGER IF EXISTS puplan_standby_dirty_conversations ON public.puplan_app_conversations;
CREATE TRIGGER puplan_standby_dirty_conversations BEFORE INSERT ON public.puplan_app_conversations FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('created_by');
DROP TRIGGER IF EXISTS puplan_standby_dirty_members ON public.puplan_app_conversation_members;
CREATE TRIGGER puplan_standby_dirty_members BEFORE UPDATE ON public.puplan_app_conversation_members FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_member_update();
DROP TRIGGER IF EXISTS puplan_standby_dirty_messages ON public.puplan_app_messages;
CREATE TRIGGER puplan_standby_dirty_messages BEFORE INSERT ON public.puplan_app_messages FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('sender_id');
DROP TRIGGER IF EXISTS puplan_standby_dirty_feed_preferences ON public.puplan_app_feed_preferences;
CREATE TRIGGER puplan_standby_dirty_feed_preferences BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_feed_preferences FOR EACH ROW EXECUTE FUNCTION public.puplan_mark_standby_dirty_column('viewer_id');

CREATE OR REPLACE FUNCTION public.puplan_replica_authority_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_row jsonb; v_authority uuid; v_replica_uid uuid;
BEGIN
  IF current_setting('nolu.replica_apply', true)<>'1' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
  END IF;
  BEGIN v_replica_uid:=nullif(current_setting('nolu.replica_uid',true),'')::uuid; EXCEPTION WHEN OTHERS THEN v_replica_uid:=NULL; END;
  v_row:=CASE WHEN TG_OP='DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  BEGIN v_authority:=nullif(v_row->>TG_ARGV[0],'')::uuid; EXCEPTION WHEN OTHERS THEN v_authority:=NULL; END;
  IF v_replica_uid IS NULL OR v_authority IS NULL OR v_authority<>v_replica_uid THEN RETURN NULL; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END;
$function$;
REVOKE ALL ON FUNCTION public.puplan_replica_authority_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS nolu_replica_authority_friendships ON public.puplan_app_friendships;
CREATE TRIGGER nolu_replica_authority_friendships BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_friendships FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('requester_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_meetups ON public.puplan_app_meetups;
CREATE TRIGGER nolu_replica_authority_meetups BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_meetups FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('creator_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_posts ON public.puplan_app_posts;
CREATE TRIGGER nolu_replica_authority_posts BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_posts FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('author_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_likes ON public.puplan_app_post_likes;
CREATE TRIGGER nolu_replica_authority_likes BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_post_likes FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('user_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_media ON public.puplan_app_post_media;
CREATE TRIGGER nolu_replica_authority_media BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_post_media FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('owner_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_conversations ON public.puplan_app_conversations;
CREATE TRIGGER nolu_replica_authority_conversations BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_conversations FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('created_by');
DROP TRIGGER IF EXISTS nolu_replica_authority_members ON public.puplan_app_conversation_members;
CREATE TRIGGER nolu_replica_authority_members BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_conversation_members FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('user_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_messages ON public.puplan_app_messages;
CREATE TRIGGER nolu_replica_authority_messages BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_messages FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('sender_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_feed_preferences ON public.puplan_app_feed_preferences;
CREATE TRIGGER nolu_replica_authority_feed_preferences BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_feed_preferences FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('viewer_id');
DROP TRIGGER IF EXISTS nolu_replica_authority_affinity ON public.puplan_app_author_affinity;
CREATE TRIGGER nolu_replica_authority_affinity BEFORE INSERT OR UPDATE OR DELETE ON public.puplan_app_author_affinity FOR EACH ROW EXECUTE FUNCTION public.puplan_replica_authority_guard('viewer_id');

CREATE OR REPLACE FUNCTION public.puplan_on_like_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' THEN RETURN coalesce(NEW,OLD); END IF;
  IF TG_OP='INSERT' THEN UPDATE public.puplan_app_posts SET like_count=like_count+1 WHERE id=NEW.post_id; RETURN NEW;
  ELSIF TG_OP='DELETE' THEN UPDATE public.puplan_app_posts SET like_count=greatest(0,like_count-1) WHERE id=OLD.post_id; RETURN OLD; END IF;
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_on_reply_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' THEN RETURN coalesce(NEW,OLD); END IF;
  IF TG_OP='INSERT' AND NEW.parent_id IS NOT NULL AND NEW.deleted_at IS NULL THEN UPDATE public.puplan_app_posts SET reply_count=reply_count+1 WHERE id=NEW.parent_id; RETURN NEW;
  ELSIF TG_OP='DELETE' AND OLD.parent_id IS NOT NULL AND OLD.deleted_at IS NULL THEN UPDATE public.puplan_app_posts SET reply_count=greatest(0,reply_count-1) WHERE id=OLD.parent_id; RETURN OLD;
  ELSIF TG_OP='UPDATE' AND NEW.parent_id IS NOT NULL THEN
    IF OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL THEN UPDATE public.puplan_app_posts SET reply_count=greatest(0,reply_count-1) WHERE id=NEW.parent_id;
    ELSIF OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS NULL THEN UPDATE public.puplan_app_posts SET reply_count=reply_count+1 WHERE id=NEW.parent_id; END IF;
    RETURN NEW;
  END IF;
  RETURN coalesce(NEW,OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.puplan_on_message_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF current_setting('nolu.replica_apply', true)='1' THEN RETURN NEW; END IF;
  UPDATE public.puplan_app_conversations SET last_message_body=NEW.body,last_message_sender_id=NEW.sender_id,last_message_at=NEW.created_at,updated_at=NEW.created_at WHERE id=NEW.conversation_id;
  UPDATE public.puplan_app_conversation_members SET unread_count=CASE WHEN user_id=NEW.sender_id THEN 0 ELSE unread_count+1 END,last_read_at=CASE WHEN user_id=NEW.sender_id THEN NEW.created_at ELSE last_read_at END WHERE conversation_id=NEW.conversation_id;
  RETURN NEW;
END;
$function$;

DO $block$
BEGIN
  IF to_regprocedure('public.puplan_apply_server_replica_unchecked(jsonb)') IS NULL THEN
    ALTER FUNCTION public.puplan_apply_server_replica(jsonb) RENAME TO puplan_apply_server_replica_unchecked;
  END IF;
END;
$block$;

REVOKE ALL ON FUNCTION public.puplan_apply_server_replica_unchecked(jsonb) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.puplan_apply_server_replica(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_uid uuid; v_last_revision bigint;
BEGIN
  v_uid:=(p_payload->>'uid')::uuid;
  PERFORM pg_advisory_xact_lock(hashtextextended(v_uid::text,90210));
  SELECT last_revision INTO v_last_revision FROM public.puplan_replica_server_state WHERE user_id=v_uid;
  IF EXISTS(SELECT 1 FROM public.puplan_standby_dirty_users d WHERE d.user_id=v_uid AND d.is_dirty=true) THEN
    RETURN jsonb_build_object('ok',false,'conflict',true,'error','STANDBY_DIRTY','applied_revision',coalesce(v_last_revision,0),'incoming_revision',coalesce((p_payload->>'revision')::bigint,0));
  END IF;
  PERFORM set_config('nolu.replica_apply','1',true);
  PERFORM set_config('nolu.replica_uid',v_uid::text,true);
  RETURN public.puplan_apply_server_replica_unchecked(p_payload);
END;
$function$;

REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;