-- TOKYO STANDBY ONLY: social-aware server replica apply used by the signed
-- primary -> standby replication path. Shared social rows are reconstructed
-- from an authenticated primary snapshot; revisions are monotonic per user.
--
-- Media object bytes are intentionally not replicated here. Standby social is
-- text-only during outage mode, so post_media metadata remains a separate
-- helper until object replication exists.

CREATE OR REPLACE FUNCTION public.puplan_apply_server_replica(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
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
  v_now timestamptz := now();
begin
  if coalesce((p_payload->>'v')::int,0)<>2 or p_payload->>'iss'<>'hrrmkrayvrgnwcroyttp' or p_payload->>'aud'<>'ltfurqaspqsvswmebyzw' then raise exception 'invalid replica authority'; end if;
  v_kind:=p_payload->>'kind';
  if v_kind not in ('core-seed','core-delete') then raise exception 'invalid replica kind'; end if;
  v_uid:=(p_payload->>'uid')::uuid; v_revision:=(p_payload->>'revision')::bigint;
  if v_revision<=0 then raise exception 'invalid replica revision'; end if;

  insert into public.puplan_replica_server_state(user_id,last_revision,updated_at) values(v_uid,0,v_now) on conflict(user_id) do nothing;
  select last_revision into v_last_revision from public.puplan_replica_server_state where user_id=v_uid for update;
  if v_revision<=coalesce(v_last_revision,0) then return jsonb_build_object('ok',true,'ignored',true,'applied_revision',v_last_revision); end if;

  if v_kind='core-delete' then
    delete from public.puplan_app_feed_preferences where viewer_id=v_uid;
    delete from public.puplan_app_author_affinity where viewer_id=v_uid or author_id=v_uid;
    delete from public.puplan_app_post_likes where user_id=v_uid;
    delete from public.puplan_app_posts where author_id=v_uid;
    delete from public.puplan_app_meetups where creator_id=v_uid or invitee_id=v_uid;
    delete from public.puplan_app_friendships where requester_id=v_uid or addressee_id=v_uid;
    delete from public.puplan_app_semesters where user_id=v_uid;
    delete from public.puplan_app_schedules where user_id=v_uid;
    delete from public.puplan_replica_state where user_id=v_uid;
    delete from public.puplan_app_users where id=v_uid;
    update public.puplan_replica_server_state set last_revision=v_revision,last_applied_at=v_now,updated_at=v_now where user_id=v_uid;
    return jsonb_build_object('ok',true,'ignored',false,'applied_revision',v_revision,'kind',v_kind);
  end if;

  v_user:=p_payload#>'{bundle,user}'; v_schedule:=p_payload#>'{bundle,schedule}';
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
  if v_user is null or coalesce(v_user->>'id','')<>v_uid::text or coalesce(v_user->>'email','')='' or coalesce(v_user->>'username','')='' or coalesce(v_user->>'password_salt','')='' or coalesce(v_user->>'password_hash','')='' then raise exception 'invalid replica bundle'; end if;
  if jsonb_typeof(v_semesters)<>'array' or jsonb_typeof(v_friendships)<>'array' or jsonb_typeof(v_meetups)<>'array' or jsonb_typeof(v_posts)<>'array' or jsonb_typeof(v_likes)<>'array' or jsonb_typeof(v_conversations)<>'array' or jsonb_typeof(v_members)<>'array' or jsonb_typeof(v_messages)<>'array' or jsonb_typeof(v_feed_preferences)<>'array' or jsonb_typeof(v_affinity)<>'array' then raise exception 'invalid replica arrays'; end if;

  insert into public.puplan_app_users(id,email,display_name,username,password_salt,password_hash,created_at,updated_at,avatar_data,bio,discoverable,recovery_salt,recovery_hash,recovery_created_at,role,profile_visibility)
  values(v_uid,lower(left(v_user->>'email',254)),left(coalesce(v_user->>'display_name',''),24),lower(left(v_user->>'username',24)),v_user->>'password_salt',v_user->>'password_hash',coalesce((v_user->>'created_at')::timestamptz,v_now),coalesce((v_user->>'updated_at')::timestamptz,v_now),left(coalesce(v_user->>'avatar_data',''),180000),left(coalesce(v_user->>'bio',''),120),coalesce((v_user->>'discoverable')::boolean,true),nullif(v_user->>'recovery_salt',''),nullif(v_user->>'recovery_hash',''),nullif(v_user->>'recovery_created_at','')::timestamptz,case when v_user->>'role'='admin' then 'admin' else 'user' end,case when v_user->>'profile_visibility'='private' then 'private' else 'public' end)
  on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,username=excluded.username,password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=excluded.updated_at,avatar_data=excluded.avatar_data,bio=excluded.bio,discoverable=excluded.discoverable,recovery_salt=excluded.recovery_salt,recovery_hash=excluded.recovery_hash,recovery_created_at=excluded.recovery_created_at,role=excluded.role,profile_visibility=excluded.profile_visibility;

  if v_schedule is null or v_schedule='null'::jsonb then delete from public.puplan_app_schedules where user_id=v_uid; else
    insert into public.puplan_app_schedules(user_id,courses,updated_at) values(v_uid,coalesce(v_schedule->'courses','[]'::jsonb),coalesce((v_schedule->>'updated_at')::timestamptz,v_now)) on conflict(user_id) do update set courses=excluded.courses,updated_at=excluded.updated_at;
  end if;
  delete from public.puplan_app_semesters where user_id=v_uid;
  insert into public.puplan_app_semesters select * from jsonb_populate_recordset(null::public.puplan_app_semesters,v_semesters);

  delete from public.puplan_app_friendships f where (f.requester_id=v_uid or f.addressee_id=v_uid) and not exists(select 1 from jsonb_array_elements(v_friendships) x where (x->>'id')::bigint=f.id);
  insert into public.puplan_app_friendships select * from jsonb_populate_recordset(null::public.puplan_app_friendships,v_friendships) on conflict(id) do update set requester_id=excluded.requester_id,addressee_id=excluded.addressee_id,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at;

  delete from public.puplan_app_meetups m where (m.creator_id=v_uid or m.invitee_id=v_uid) and not exists(select 1 from jsonb_array_elements(v_meetups) x where (x->>'id')::uuid=m.id);
  insert into public.puplan_app_meetups select * from jsonb_populate_recordset(null::public.puplan_app_meetups,v_meetups) on conflict(id) do update set creator_id=excluded.creator_id,invitee_id=excluded.invitee_id,kind=excluded.kind,day=excluded.day,start_period=excluded.start_period,end_period=excluded.end_period,note=excluded.note,status=excluded.status,created_at=excluded.created_at,updated_at=excluded.updated_at;

  delete from public.puplan_app_post_likes l where l.user_id=v_uid or l.post_id in (select (x->>'id')::uuid from jsonb_array_elements(v_posts) x);
  delete from public.puplan_app_posts p where p.id in (select (x->>'id')::uuid from jsonb_array_elements(v_posts) x) or p.author_id=v_uid or p.parent_id in (select id from public.puplan_app_posts where author_id=v_uid and parent_id is null);
  insert into public.puplan_app_posts(id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,like_count,reply_count)
    select id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,0,0 from jsonb_populate_recordset(null::public.puplan_app_posts,v_posts) where parent_id is null;
  insert into public.puplan_app_posts(id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,like_count,reply_count)
    select id,author_id,parent_id,body,created_at,updated_at,deleted_at,visibility,0,0 from jsonb_populate_recordset(null::public.puplan_app_posts,v_posts) where parent_id is not null;
  insert into public.puplan_app_post_likes select * from jsonb_populate_recordset(null::public.puplan_app_post_likes,v_likes) on conflict(post_id,user_id) do nothing;

  delete from public.puplan_app_conversations c where c.id in (select cm.conversation_id from public.puplan_app_conversation_members cm where cm.user_id=v_uid) and not exists(select 1 from jsonb_array_elements(v_conversations) x where (x->>'id')::uuid=c.id);
  insert into public.puplan_app_conversations select * from jsonb_populate_recordset(null::public.puplan_app_conversations,v_conversations) on conflict(id) do update set kind=excluded.kind,title=excluded.title,created_by=excluded.created_by,direct_key=excluded.direct_key,created_at=excluded.created_at,updated_at=excluded.updated_at,last_message_body=excluded.last_message_body,last_message_sender_id=excluded.last_message_sender_id,last_message_at=excluded.last_message_at;
  insert into public.puplan_app_conversation_members select * from jsonb_populate_recordset(null::public.puplan_app_conversation_members,v_members) on conflict(conversation_id,user_id) do update set role=excluded.role,joined_at=excluded.joined_at,last_read_at=excluded.last_read_at,unread_count=excluded.unread_count;
  insert into public.puplan_app_messages select * from jsonb_populate_recordset(null::public.puplan_app_messages,v_messages) on conflict(id) do update set body=excluded.body,edited_at=excluded.edited_at;

  delete from public.puplan_app_feed_preferences where viewer_id=v_uid;
  insert into public.puplan_app_feed_preferences select * from jsonb_populate_recordset(null::public.puplan_app_feed_preferences,v_feed_preferences) on conflict(viewer_id,preference_key) do update set direction=excluded.direction,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
  delete from public.puplan_app_author_affinity where viewer_id=v_uid;
  insert into public.puplan_app_author_affinity select * from jsonb_populate_recordset(null::public.puplan_app_author_affinity,v_affinity) on conflict(viewer_id,author_id) do update set score=excluded.score,updated_at=excluded.updated_at;

  insert into public.puplan_replica_state(user_id,enabled,seeded_at,credentials_synced_at,updated_at) values(v_uid,true,v_now,v_now,v_now) on conflict(user_id) do update set enabled=true,seeded_at=coalesce(public.puplan_replica_state.seeded_at,excluded.seeded_at),credentials_synced_at=excluded.credentials_synced_at,updated_at=excluded.updated_at;
  update public.puplan_replica_server_state set last_revision=v_revision,last_applied_at=v_now,updated_at=v_now where user_id=v_uid;
  return jsonb_build_object('ok',true,'ignored',false,'applied_revision',v_revision,'kind',v_kind,'social',true);
end;
$function$;

REVOKE ALL ON FUNCTION public.puplan_apply_server_replica(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_server_replica(jsonb) TO service_role;

-- Metadata-only helper retained for compatibility with earlier rollout paths.
-- It is not called by the current text-only standby social path.
CREATE OR REPLACE FUNCTION public.puplan_apply_replica_media(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid;
  v_media jsonb;
begin
  if coalesce((p_payload->>'v')::int,0)<>2 or p_payload->>'kind'<>'core-seed' or p_payload->>'iss'<>'hrrmkrayvrgnwcroyttp' or p_payload->>'aud'<>'ltfurqaspqsvswmebyzw' then
    raise exception 'invalid media replica authority';
  end if;
  v_uid:=(p_payload->>'uid')::uuid;
  v_media:=coalesce(p_payload#>'{bundle,post_media}','[]'::jsonb);
  if jsonb_typeof(v_media)<>'array' then raise exception 'invalid media replica array'; end if;
  delete from public.puplan_app_post_media pm
  where pm.owner_id=v_uid
    and not exists(select 1 from jsonb_array_elements(v_media) x where (x->>'id')::uuid=pm.id);
  insert into public.puplan_app_post_media
  select * from jsonb_populate_recordset(null::public.puplan_app_post_media,v_media)
  on conflict(id) do update set
    post_id=excluded.post_id,
    owner_id=excluded.owner_id,
    storage_path=excluded.storage_path,
    media_type=excluded.media_type,
    mime_type=excluded.mime_type,
    size_bytes=excluded.size_bytes,
    width=excluded.width,
    height=excluded.height,
    duration_ms=excluded.duration_ms,
    sort_order=excluded.sort_order;
  return jsonb_build_object('ok',true,'count',jsonb_array_length(v_media));
end;
$function$;

REVOKE ALL ON FUNCTION public.puplan_apply_replica_media(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.puplan_apply_replica_media(jsonb) TO service_role;
