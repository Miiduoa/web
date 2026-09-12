-- TOKYO STANDBY ONLY: the owner-domain apply function already decides which
-- shared aggregate a per-user revision may reconcile. Row-level authority
-- triggers must not reject child rows whose own author/sender/member differs
-- from the aggregate owner, otherwise a root-author or conversation-creator
-- snapshot silently loses replies, likes, participants and messages.
--
-- Keep row guards only where the row's authority column is the same as the
-- aggregate authority used by puplan_apply_server_replica_unchecked:
--   friendships=requester, meetups=creator, conversations=creator,
--   media=owner, feed preferences/affinity=viewer.
-- Child rows are protected by the owner-domain apply itself.

DROP TRIGGER IF EXISTS nolu_replica_authority_posts
ON public.puplan_app_posts;

DROP TRIGGER IF EXISTS nolu_replica_authority_likes
ON public.puplan_app_post_likes;

DROP TRIGGER IF EXISTS nolu_replica_authority_members
ON public.puplan_app_conversation_members;

DROP TRIGGER IF EXISTS nolu_replica_authority_messages
ON public.puplan_app_messages;

-- The public wrapper remains service-role only. The unchecked implementation is
-- an internal implementation detail and must never become directly callable by
-- browser roles.
REVOKE ALL ON FUNCTION public.puplan_apply_server_replica_unchecked(jsonb)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.puplan_apply_replica_media_unchecked(jsonb)
FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;
