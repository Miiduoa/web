create table if not exists public.puplan_failback_nonces(
  nonce uuid primary key,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
alter table public.puplan_failback_nonces enable row level security;
revoke all on public.puplan_failback_nonces from public, anon, authenticated;
grant all on public.puplan_failback_nonces to service_role;
create index if not exists puplan_failback_nonces_expires_idx on public.puplan_failback_nonces(expires_at);

create or replace function public.puplan_apply_failback_snapshot(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid; v_user jsonb; v_schedule jsonb; v_semesters jsonb; v_friendships jsonb; v_meetups jsonb;
  v_posts jsonb; v_likes jsonb; v_media jsonb; v_conversations jsonb; v_members jsonb; v_messages jsonb; v_feed_preferences jsonb; v_affinity jsonb;
  v_now timestamptz:=now(); v_base_revision bigint; v_current_revision bigint;
begin
  if coalesce((p_payload->>'v')::int,0)<>2 or p_payload->>'kind'<>'failback-snapshot' or p_payload->>'iss'<>'ltfurqaspqsvswmebyzw' or p_payload->>'aud'<>'hrrmkrayvrgnwcroyttp' then raise exception 'invalid failback authority'; end if;
  if (p_payload->>'exp')::timestamptz < now() or (p_payload->>'iat')::timestamptz > now()+interval '30 seconds' then raise exception 'expired failback snapshot'; end if;
  v_uid:=(p_payload->>'uid')::uuid;
  v_base_revision:=coalesce((p_payload->>'base_primary_revision')::bigint,-1);
  select coalesce(r.revision,0) into v_current_revision from public.puplan_replication_versions r where r.user_id=v_uid;
  v_current_revision:=coalesce(v_current_revision,0);
  if v_base_revision<>v_current_revision then
    return jsonb_build_object('ok',false,'conflict',true,'code','PRIMARY_ADVANCED','base_primary_revision',v_base_revision,'current_primary_revision',v_current_revision);
  end if;

  v_user:=p_payload#>'{bundle,user}'; v_schedule:=p_payload#>'{bundle,schedule}'; v_semesters:=coalesce(p_payload#>'{bundle,semesters}','[]'::jsonb);
  v_friendships:=coalesce(p_payload#>'{bundle,friendships}','[]'::jsonb); v_meetups:=coalesce(p_payload#>'{bundle,meetups}','[]'::jsonb); v_posts:=coalesce(p_payload#>'{bundle,posts}','[]'::jsonb); v_likes:=coalesce(p_payload#>'{bundle,post_likes}','[]'::jsonb); v_media:=coalesce(p_payload#>'{bundle,post_media}','[]'::jsonb);
  v_conversations:=coalesce(p_payload#>'{bundle,conversations}','[]'::jsonb); v_members:=coalesce(p_payload#>'{bundle,conversation_members}','[]'::jsonb); v_messages:=coalesce(p_payload#>'{bundle,messages}','[]'::jsonb); v_feed_preferences:=coalesce(p_payload#>'{bundle,feed_preferences}','[]'::jsonb); v_affinity:=coalesce(p_payload#>'{bundle,author_affinity}','[]'::jsonb);
  if v_user is null or v_user->>'id'<>v_uid::text then raise exception 'invalid failback user'; end if;
  if jsonb_typeof(v_semesters)<>'array' or jsonb_typeof(v_friendships)<>'array' or jsonb_typeof(v_meetups)<>'array' or jsonb_typeof(v_posts)<>'array' or jsonb_typeof(v_likes)<>'array' or jsonb_typeof(v_media)<>'array' or jsonb_typeof(v_conversations)<>'array' or jsonb_typeof(v_members)<>'array' or jsonb_typeof(v_messages)<>'array' or jsonb_typeof(v_feed_preferences)<>'array' or jsonb_typeof(v_affinity)<>'array' then raise exception 'invalid failback arrays'; end if;
  perform set_config('nolu.failback_apply','1',true);

  insert into public.puplan_app_users select * from jsonb_populate_record(null::public.puplan_app_users,v_user)
  on conflict(id) do update set email=excluded.email,display_name=excluded.display_name,username=excluded.username,password_salt=excluded.password_salt,password_hash=excluded.password_hash,updated_at=excluded.updated_at,avatar_data=excluded.avatar_data,bio=excluded.bio,discoverable=excluded.discoverable,recovery_salt=excluded.recovery_salt,recovery_hash=excluded.recovery_hash,recovery_created_at=excluded.recovery_created_at,role=excluded.role,profile_visibility=excluded.profile_visibility
  where excluded.updated_at>=public.puplan_app_users.updated_at;

  if v_schedule is not null and v_schedule<>'null'::jsonb then
    insert into public.puplan_app_schedules select * from jsonb_populate_record(null::public.puplan_app_schedules,v_schedule)
    on conflict(user_id) do update set courses=excluded.courses,updated_at=excluded.updated_at where excluded.updated_at>=public.puplan_app_schedules.updated_at;
  end if;
  insert into public.puplan_app_semesters select * from jsonb_populate_recordset(null::public.puplan_app_semesters,v_semesters)
  on conflict(id) do update set semester_key=excluded.semester_key,label=excluded.label,school=excluded.school,department=excluded.department,class_name=excluded.class_name,credits=excluded.credits,courses=excluded.courses,is_current=excluded.is_current,updated_at=excluded.updated_at where excluded.updated_at>=public.puplan_app_semesters.updated_at;

  delete from public.puplan_app_friendships f where (f.requester_id=v_uid or f.addressee_id=v_uid) and not exists(select 1 from jsonb_array_elements(v_friendships) x where (x->>'id')::bigint=f.id);
  insert into public.puplan_app_friendships select * from jsonb_populate_recordset(null::public.puplan_app_friendships,v_friendships)
  on conflict(id) do update set requester_id=excluded.requester_id,addressee_id=excluded.addressee_id,status=excluded.status,updated_at=excluded.updated_at where excluded.updated_at>=public.puplan_app_friendships.updated_at;

  delete from public.puplan_app_meetups m where (m.creator_id=v_uid or m.invitee_id=v_uid) and not exists(select 1 from jsonb_array_elements(v_meetups) x where (x->>'id')::uuid=m.id);
  insert into public.puplan_app_meetups select * from jsonb_populate_recordset(null::public.puplan_app_meetups,v_meetups)
  on conflict(id) do update set creator_id=excluded.creator_id,invitee_id=excluded.invitee_id,kind=excluded.kind,day=excluded.day,start_period=excluded.start_period,end_period=excluded.end_period,note=excluded.note,status=excluded.status,updated_at=excluded.updated_at where excluded.updated_at>=public.puplan_app_meetups.updated_at;

  insert into public.puplan_app_posts select * from jsonb_populate_recordset(null::public.puplan_app_posts,v_posts) where parent_id is null
  on conflict(id) do update set body=excluded.body,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,visibility=excluded.visibility where excluded.updated_at>=public.puplan_app_posts.updated_at;
  insert into public.puplan_app_posts select * from jsonb_populate_recordset(null::public.puplan_app_posts,v_posts) where parent_id is not null
  on conflict(id) do update set body=excluded.body,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at,visibility=excluded.visibility where excluded.updated_at>=public.puplan_app_posts.updated_at;
  delete from public.puplan_app_post_likes l where l.user_id=v_uid and not exists(select 1 from jsonb_array_elements(v_likes) x where (x->>'post_id')::uuid=l.post_id and (x->>'user_id')::uuid=l.user_id);
  insert into public.puplan_app_post_likes select * from jsonb_populate_recordset(null::public.puplan_app_post_likes,v_likes) on conflict(post_id,user_id) do nothing;
  insert into public.puplan_app_post_media select * from jsonb_populate_recordset(null::public.puplan_app_post_media,v_media)
  on conflict(id) do update set post_id=excluded.post_id,owner_id=excluded.owner_id,storage_path=excluded.storage_path,media_type=excluded.media_type,mime_type=excluded.mime_type,size_bytes=excluded.size_bytes,width=excluded.width,height=excluded.height,duration_ms=excluded.duration_ms,sort_order=excluded.sort_order;

  insert into public.puplan_app_conversations select * from jsonb_populate_recordset(null::public.puplan_app_conversations,v_conversations)
  on conflict(id) do update set kind=excluded.kind,title=excluded.title,created_by=excluded.created_by,direct_key=excluded.direct_key,updated_at=excluded.updated_at,last_message_body=excluded.last_message_body,last_message_sender_id=excluded.last_message_sender_id,last_message_at=excluded.last_message_at where excluded.updated_at>=public.puplan_app_conversations.updated_at;
  insert into public.puplan_app_conversation_members select * from jsonb_populate_recordset(null::public.puplan_app_conversation_members,v_members)
  on conflict(conversation_id,user_id) do update set role=excluded.role,last_read_at=case when excluded.last_read_at is null then public.puplan_app_conversation_members.last_read_at when public.puplan_app_conversation_members.last_read_at is null or excluded.last_read_at>=public.puplan_app_conversation_members.last_read_at then excluded.last_read_at else public.puplan_app_conversation_members.last_read_at end,unread_count=case when public.puplan_app_conversation_members.last_read_at is null or coalesce(excluded.last_read_at,'epoch'::timestamptz)>=public.puplan_app_conversation_members.last_read_at then excluded.unread_count else public.puplan_app_conversation_members.unread_count end;
  insert into public.puplan_app_messages select * from jsonb_populate_recordset(null::public.puplan_app_messages,v_messages)
  on conflict(id) do update set body=excluded.body,edited_at=excluded.edited_at where excluded.edited_at is not null and (public.puplan_app_messages.edited_at is null or excluded.edited_at>=public.puplan_app_messages.edited_at);

  delete from public.puplan_app_feed_preferences where viewer_id=v_uid;
  insert into public.puplan_app_feed_preferences select * from jsonb_populate_recordset(null::public.puplan_app_feed_preferences,v_feed_preferences) on conflict(viewer_id,preference_key) do update set direction=excluded.direction,expires_at=excluded.expires_at,updated_at=excluded.updated_at;
  delete from public.puplan_app_author_affinity where viewer_id=v_uid;
  insert into public.puplan_app_author_affinity select * from jsonb_populate_recordset(null::public.puplan_app_author_affinity,v_affinity) on conflict(viewer_id,author_id) do update set score=excluded.score,updated_at=excluded.updated_at;

  update public.puplan_app_posts p set like_count=(select count(*)::int from public.puplan_app_post_likes l where l.post_id=p.id),reply_count=(select count(*)::int from public.puplan_app_posts r where r.parent_id=p.id and r.deleted_at is null)
  where p.parent_id is null and (p.author_id=v_uid or p.id in(select (x->>'id')::uuid from jsonb_array_elements(v_posts) x where x->>'parent_id' is null));

  perform set_config('nolu.failback_apply','0',true);
  perform public.puplan_queue_replication_for_user(v_uid);
  return jsonb_build_object('ok',true,'conflict',false,'uid',v_uid,'applied_at',v_now,'reseed_queued',true);
end;
$$;
revoke all on function public.puplan_apply_failback_snapshot(jsonb) from public, anon, authenticated;
grant execute on function public.puplan_apply_failback_snapshot(jsonb) to service_role;
