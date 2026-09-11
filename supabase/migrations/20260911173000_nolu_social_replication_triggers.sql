create or replace function public.puplan_enqueue_social_replication()
returns trigger
language plpgsql
security definer
set search_path to 'public','extensions','net'
as $$
declare
  v_uid uuid;
  v_uid2 uuid;
begin
  if current_setting('nolu.failback_apply', true) = '1' then
    return coalesce(new, old);
  end if;

  case tg_table_name
    when 'puplan_app_friendships' then
      v_uid := case when tg_op='DELETE' then old.requester_id else new.requester_id end;
      v_uid2 := case when tg_op='DELETE' then old.addressee_id else new.addressee_id end;
    when 'puplan_app_meetups' then
      v_uid := case when tg_op='DELETE' then old.creator_id else new.creator_id end;
      v_uid2 := case when tg_op='DELETE' then old.invitee_id else new.invitee_id end;
    when 'puplan_app_posts' then
      v_uid := case when tg_op='DELETE' then old.author_id else new.author_id end;
    when 'puplan_app_post_likes' then
      v_uid := case when tg_op='DELETE' then old.user_id else new.user_id end;
    when 'puplan_app_post_media' then
      v_uid := case when tg_op='DELETE' then old.owner_id else new.owner_id end;
    when 'puplan_app_conversations' then
      v_uid := case when tg_op='DELETE' then old.created_by else new.created_by end;
    when 'puplan_app_conversation_members' then
      v_uid := case when tg_op='DELETE' then old.user_id else new.user_id end;
    when 'puplan_app_messages' then
      v_uid := case when tg_op='DELETE' then old.sender_id else new.sender_id end;
    when 'puplan_app_feed_preferences' then
      v_uid := case when tg_op='DELETE' then old.viewer_id else new.viewer_id end;
    when 'puplan_app_author_affinity' then
      v_uid := case when tg_op='DELETE' then old.viewer_id else new.viewer_id end;
    else
      return coalesce(new, old);
  end case;

  if v_uid is not null then perform public.puplan_queue_replication_for_user(v_uid); end if;
  if v_uid2 is not null and v_uid2 is distinct from v_uid then perform public.puplan_queue_replication_for_user(v_uid2); end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.puplan_enqueue_social_replication() from public, anon, authenticated;
grant execute on function public.puplan_enqueue_social_replication() to service_role;

create trigger puplan_friendships_replication_outbox after insert or update or delete on public.puplan_app_friendships for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_meetups_replication_outbox after insert or update or delete on public.puplan_app_meetups for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_posts_replication_outbox after insert or update or delete on public.puplan_app_posts for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_likes_replication_outbox after insert or delete on public.puplan_app_post_likes for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_media_replication_outbox after insert or update or delete on public.puplan_app_post_media for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_conversations_replication_outbox after insert or update or delete on public.puplan_app_conversations for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_conversation_members_replication_outbox after insert or update or delete on public.puplan_app_conversation_members for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_messages_replication_outbox after insert or update or delete on public.puplan_app_messages for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_feed_preferences_replication_outbox after insert or update or delete on public.puplan_app_feed_preferences for each row execute function public.puplan_enqueue_social_replication();
create trigger puplan_affinity_replication_outbox after insert or update or delete on public.puplan_app_author_affinity for each row execute function public.puplan_enqueue_social_replication();
