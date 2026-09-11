-- TOKYO STANDBY ONLY: build the authoritative snapshot used for signed
-- standby -> primary failback. This source mirrors the live RPC so disaster
-- recovery can rebuild the standby without relying on dashboard-only history.

CREATE OR REPLACE FUNCTION public.puplan_build_failback_snapshot(p_uid uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_user jsonb; v_schedule jsonb; v_semesters jsonb; v_friendships jsonb; v_meetups jsonb;
  v_posts jsonb; v_likes jsonb; v_media jsonb; v_conversations jsonb; v_members jsonb; v_messages jsonb;
  v_feed_preferences jsonb; v_affinity jsonb; v_now timestamptz:=clock_timestamp(); v_base_revision bigint:=0;
begin
  select to_jsonb(u) into v_user from public.puplan_app_users u where u.id=p_uid;
  if v_user is null then raise exception 'user not found'; end if;
  select coalesce(s.last_revision,0) into v_base_revision from public.puplan_replica_server_state s where s.user_id=p_uid;
  v_base_revision:=coalesce(v_base_revision,0);
  select to_jsonb(s) into v_schedule from public.puplan_app_schedules s where s.user_id=p_uid;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.updated_at,s.id),'[]'::jsonb) into v_semesters from public.puplan_app_semesters s where s.user_id=p_uid;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.updated_at,f.id),'[]'::jsonb) into v_friendships from public.puplan_app_friendships f where f.requester_id=p_uid or f.addressee_id=p_uid;
  select coalesce(jsonb_agg(to_jsonb(m) order by m.updated_at,m.id),'[]'::jsonb) into v_meetups from public.puplan_app_meetups m where m.creator_id=p_uid or m.invitee_id=p_uid;
  with roots as (
    select p.id from public.puplan_app_posts p where p.author_id=p_uid and p.parent_id is null
    union select p.parent_id from public.puplan_app_posts p where p.author_id=p_uid and p.parent_id is not null
  ), relevant as (
    select p.* from public.puplan_app_posts p where p.author_id=p_uid or p.id in(select id from roots) or p.parent_id in(select id from roots)
  ) select coalesce(jsonb_agg(to_jsonb(relevant) order by relevant.created_at,relevant.id),'[]'::jsonb) into v_posts from relevant;
  with relevant_posts as (
    select p.id from public.puplan_app_posts p where p.author_id=p_uid
    union select p.parent_id from public.puplan_app_posts p where p.author_id=p_uid and p.parent_id is not null
    union select p.id from public.puplan_app_posts p where p.parent_id in(select x.id from public.puplan_app_posts x where x.author_id=p_uid and x.parent_id is null)
  ) select coalesce(jsonb_agg(to_jsonb(l) order by l.created_at,l.post_id,l.user_id),'[]'::jsonb) into v_likes from public.puplan_app_post_likes l where l.user_id=p_uid or l.post_id in(select id from relevant_posts);
  select coalesce(jsonb_agg(to_jsonb(pm) order by pm.created_at,pm.id),'[]'::jsonb) into v_media from public.puplan_app_post_media pm where pm.owner_id=p_uid or pm.post_id in(select p.id from public.puplan_app_posts p where p.author_id=p_uid);
  with conv as(select cm.conversation_id id from public.puplan_app_conversation_members cm where cm.user_id=p_uid)
  select coalesce(jsonb_agg(to_jsonb(c) order by c.updated_at,c.id),'[]'::jsonb) into v_conversations from public.puplan_app_conversations c where c.id in(select id from conv);
  with conv as(select cm.conversation_id id from public.puplan_app_conversation_members cm where cm.user_id=p_uid)
  select coalesce(jsonb_agg(to_jsonb(cm) order by cm.joined_at,cm.conversation_id,cm.user_id),'[]'::jsonb) into v_members from public.puplan_app_conversation_members cm where cm.conversation_id in(select id from conv);
  with conv as(select cm.conversation_id id from public.puplan_app_conversation_members cm where cm.user_id=p_uid)
  select coalesce(jsonb_agg(to_jsonb(msg) order by msg.created_at,msg.id),'[]'::jsonb) into v_messages from public.puplan_app_messages msg where msg.conversation_id in(select id from conv);
  select coalesce(jsonb_agg(to_jsonb(fp) order by fp.updated_at,fp.preference_key),'[]'::jsonb) into v_feed_preferences from public.puplan_app_feed_preferences fp where fp.viewer_id=p_uid;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.updated_at,a.author_id),'[]'::jsonb) into v_affinity from public.puplan_app_author_affinity a where a.viewer_id=p_uid;
  return jsonb_build_object(
    'v',2,'kind','failback-snapshot','iss','ltfurqaspqsvswmebyzw','aud','hrrmkrayvrgnwcroyttp','uid',p_uid,
    'base_primary_revision',v_base_revision,'iat',v_now,'exp',v_now+interval '2 minutes','nonce',gen_random_uuid(),
    'bundle',jsonb_build_object('user',v_user,'schedule',v_schedule,'semesters',v_semesters,'friendships',v_friendships,'meetups',v_meetups,'posts',v_posts,'post_likes',v_likes,'post_media',v_media,'conversations',v_conversations,'conversation_members',v_members,'messages',v_messages,'feed_preferences',v_feed_preferences,'author_affinity',v_affinity));
end;
$function$;

REVOKE ALL ON FUNCTION public.puplan_build_failback_snapshot(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_build_failback_snapshot(uuid) TO service_role;
