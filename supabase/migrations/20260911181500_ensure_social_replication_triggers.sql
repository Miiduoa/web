-- PRIMARY ONLY: make the live social replication trigger topology explicit and reproducible.
-- Every social mutation that can affect failback conflict detection must advance
-- the affected users' replication revisions through puplan_enqueue_social_replication().

DROP TRIGGER IF EXISTS puplan_friendships_replication_outbox ON public.puplan_app_friendships;
CREATE TRIGGER puplan_friendships_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_friendships
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_meetups_replication_outbox ON public.puplan_app_meetups;
CREATE TRIGGER puplan_meetups_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_meetups
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_posts_replication_outbox ON public.puplan_app_posts;
CREATE TRIGGER puplan_posts_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_posts
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_likes_replication_outbox ON public.puplan_app_post_likes;
CREATE TRIGGER puplan_likes_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_post_likes
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_media_replication_outbox ON public.puplan_app_post_media;
CREATE TRIGGER puplan_media_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_post_media
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_conversations_replication_outbox ON public.puplan_app_conversations;
CREATE TRIGGER puplan_conversations_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_conversations
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_conversation_members_replication_outbox ON public.puplan_app_conversation_members;
CREATE TRIGGER puplan_conversation_members_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_conversation_members
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_messages_replication_outbox ON public.puplan_app_messages;
CREATE TRIGGER puplan_messages_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_messages
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_feed_preferences_replication_outbox ON public.puplan_app_feed_preferences;
CREATE TRIGGER puplan_feed_preferences_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_feed_preferences
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

DROP TRIGGER IF EXISTS puplan_affinity_replication_outbox ON public.puplan_app_author_affinity;
CREATE TRIGGER puplan_affinity_replication_outbox
AFTER INSERT OR UPDATE OR DELETE ON public.puplan_app_author_affinity
FOR EACH ROW EXECUTE FUNCTION public.puplan_enqueue_social_replication();

REVOKE ALL ON FUNCTION public.puplan_enqueue_social_replication() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.puplan_queue_replication_for_user(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_enqueue_social_replication() TO service_role;
GRANT EXECUTE ON FUNCTION public.puplan_queue_replication_for_user(uuid) TO service_role;
