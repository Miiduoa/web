import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertCredentialCurrent,
  SessionError,
  verifySignedSessionV4,
} from '../_shared/session-v4.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const ALLOWED_ORIGINS = new Set([
  'https://miiduoa.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);

class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = 'BAD_REQUEST') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function cors(req: Request) {
  const origin = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://miiduoa.github.io',
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}

const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors(req),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });

function sessionApiError(error: unknown): ApiError {
  if (error instanceof SessionError) return new ApiError(401, error.message, error.code);
  return new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let session;
  try {
    session = await verifySignedSessionV4(token, SERVICE_KEY);
  } catch (error) {
    throw sessionApiError(error);
  }

  const { data: user, error } = await db
    .from('puplan_app_users')
    .select('id,email,display_name,username,role,password_salt')
    .eq('id', session.uid)
    .maybeSingle();

  if (error) throw error;
  if (!user) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  try {
    await assertCredentialCurrent(session, user.password_salt || '');
  } catch (credentialError) {
    throw sessionApiError(credentialError);
  }
  if (user.role !== 'admin') {
    throw new ApiError(403, '你沒有管理權限', 'FORBIDDEN');
  }
  return user;
}

const clean = (value: any, max = 600) =>
  String(value ?? '').trim().slice(0, max);

const AUDIT_METADATA_KEYS = new Set([
  'visibility',
  'discoverable',
  'conversation_id',
  'message_id',
  'content_id',
  'kind',
  'mode',
  'limit',
  'offset',
  'query_used',
]);

function safeAuditMetadata(metadata: Record<string, unknown> = {}) {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!AUDIT_METADATA_KEYS.has(key)) continue;
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      out[key] = value;
      continue;
    }
    if (typeof value === 'string') out[key] = value.slice(0, 120);
  }
  return out;
}

async function audit(
  admin: { id: string },
  action: string,
  targetUserId: string | null = null,
  metadata: Record<string, unknown> = {},
) {
  // Intentionally log identifiers and action metadata only. Never log email,
  // display names, post/chat bodies, passwords, recovery codes or session tokens.
  console.info(
    JSON.stringify({
      event: 'nolu.admin.audit',
      timestamp: new Date().toISOString(),
      admin_user_id: admin.id,
      action: clean(action, 80),
      target_user_id: targetUserId || null,
      metadata: safeAuditMetadata(metadata),
    }),
  );
}

async function count(table: string, filter?: (query: any) => any) {
  let query = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const { count: total } = await query;
  return total || 0;
}

async function userMap(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data } = await db
    .from('puplan_app_users')
    .select('id,display_name,username,email,avatar_data')
    .in('id', unique);
  return new Map((data || []).map((user: any) => [user.id, user]));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';

  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      return new Response('forbidden', { status: 403 });
    }
    return new Response('ok', { headers: cors(req) });
  }

  if (req.method !== 'POST') {
    return json(req, { message: '不支援這個操作' }, 405);
  }

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(req, { message: '來源不允許' }, 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const admin = await requireAdmin(req);

    if (action === 'whoami') {
      return json(req, {
        is_admin: true,
        profile: {
          id: admin.id,
          email: admin.email,
          display_name: admin.display_name,
          username: admin.username,
          role: admin.role,
        },
      });
    }

    if (action === 'overview') {
      const [
        users,
        posts,
        replies,
        messages,
        conversations,
        friendships,
        semesters,
        media,
      ] = await Promise.all([
        count('puplan_app_users'),
        count('puplan_app_posts', (q) =>
          q.is('parent_id', null).is('deleted_at', null)
        ),
        count('puplan_app_posts', (q) =>
          q.not('parent_id', 'is', null).is('deleted_at', null)
        ),
        count('puplan_app_messages'),
        count('puplan_app_conversations'),
        count('puplan_app_friendships', (q) => q.eq('status', 'accepted')),
        count('puplan_app_semesters'),
        count('puplan_app_post_media'),
      ]);
      await audit(admin, '查看營運總覽');
      return json(req, {
        stats: {
          users,
          posts,
          replies,
          messages,
          conversations,
          friendships,
          semesters,
          media,
        },
      });
    }

    if (action === 'users') {
      const term = clean(body.query, 80).replace(/[%,()]/g, '');
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const offset = Math.max(0, Number(body.offset) || 0);
      let query = db
        .from('puplan_app_users')
        .select(
          'id,email,display_name,username,created_at,updated_at,avatar_data,bio,discoverable,role,profile_visibility',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (term) {
        query = query.or(
          `email.ilike.%${term}%,display_name.ilike.%${term}%,username.ilike.%${term}%`,
        );
      }
      const { data, count: total, error } = await query;
      if (error) throw error;
      await audit(admin, '查看會員清單', null, {
        query_used: Boolean(term),
        limit,
        offset,
      });
      return json(req, { users: data || [], total: total || 0 });
    }

    if (action === 'user_detail') {
      const id = String(body.user_id || '');
      const { data: user } = await db
        .from('puplan_app_users')
        .select(
          'id,email,display_name,username,created_at,updated_at,avatar_data,bio,discoverable,role,profile_visibility',
        )
        .eq('id', id)
        .maybeSingle();
      if (!user) throw new ApiError(404, '找不到這位會員');

      const [semesters, friendships, posts, memberships] = await Promise.all([
        db
          .from('puplan_app_semesters')
          .select('*')
          .eq('user_id', id)
          .order('updated_at', { ascending: false }),
        db
          .from('puplan_app_friendships')
          .select('*')
          .or(`requester_id.eq.${id},addressee_id.eq.${id}`)
          .order('created_at', { ascending: false }),
        db
          .from('puplan_app_posts')
          .select(
            'id,parent_id,body,visibility,created_at,updated_at,deleted_at',
          )
          .eq('author_id', id)
          .order('created_at', { ascending: false })
          .limit(100),
        db
          .from('puplan_app_conversation_members')
          .select('conversation_id,joined_at,last_read_at')
          .eq('user_id', id),
      ]);
      await audit(admin, '查看會員資料', id);
      return json(req, {
        user,
        semesters: semesters.data || [],
        friendships: friendships.data || [],
        posts: posts.data || [],
        memberships: memberships.data || [],
      });
    }

    if (action === 'set_user_privacy') {
      const id = String(body.user_id || '');
      const visibility = body.profile_visibility === 'private' ? 'private' : 'public';
      const discoverable = body.discoverable !== false;
      const { error } = await db
        .from('puplan_app_users')
        .update({
          profile_visibility: visibility,
          discoverable,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      await audit(admin, '調整會員隱私', id, { visibility, discoverable });
      return json(req, { ok: true });
    }

    if (action === 'posts') {
      const kind = body.kind === 'reply' ? 'reply' : 'post';
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const offset = Math.max(0, Number(body.offset) || 0);
      let query = db
        .from('puplan_app_posts')
        .select(
          'id,author_id,parent_id,body,visibility,created_at,updated_at,deleted_at',
          { count: 'exact' },
        )
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      query = kind === 'reply'
        ? query.not('parent_id', 'is', null)
        : query.is('parent_id', null);
      const { data, count: total, error } = await query;
      if (error) throw error;
      const authors = await userMap((data || []).map((item: any) => item.author_id));
      await audit(admin, '查看貼文或留言清單', null, { kind, limit, offset });
      return json(req, {
        items: (data || []).map((item: any) => ({
          ...item,
          author: authors.get(item.author_id) || null,
        })),
        total: total || 0,
      });
    }

    if (action === 'moderate_post') {
      const id = String(body.id || '');
      const mode = String(body.mode || '');
      const now = new Date().toISOString();
      if (mode === 'remove') {
        const { error } = await db
          .from('puplan_app_posts')
          .update({ deleted_at: now, updated_at: now })
          .eq('id', id);
        if (error) throw error;
      } else if (mode === 'restore') {
        const { error } = await db
          .from('puplan_app_posts')
          .update({ deleted_at: null, updated_at: now })
          .eq('id', id);
        if (error) throw error;
      } else {
        throw new ApiError(400, '不支援的處理方式');
      }
      await audit(
        admin,
        mode === 'remove' ? '下架貼文或留言' : '恢復貼文或留言',
        null,
        { content_id: id, mode },
      );
      return json(req, { ok: true });
    }

    if (action === 'conversations') {
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const offset = Math.max(0, Number(body.offset) || 0);
      const { data, count: total, error } = await db
        .from('puplan_app_conversations')
        .select('id,kind,title,created_by,created_at,updated_at', {
          count: 'exact',
        })
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (error) throw error;

      const ids = (data || []).map((item: any) => item.id);
      let members: any[] = [];
      let messages: any[] = [];
      if (ids.length) {
        members =
          (
            await db
              .from('puplan_app_conversation_members')
              .select('conversation_id,user_id')
              .in('conversation_id', ids)
          ).data || [];
        messages =
          (
            await db
              .from('puplan_app_messages')
              .select('conversation_id,id')
              .in('conversation_id', ids)
          ).data || [];
      }
      await audit(admin, '查看聊天室清單', null, { limit, offset });
      return json(req, {
        items: (data || []).map((conversation: any) => ({
          ...conversation,
          member_count: members.filter(
            (member: any) => member.conversation_id === conversation.id,
          ).length,
          message_count: messages.filter(
            (message: any) => message.conversation_id === conversation.id,
          ).length,
        })),
        total: total || 0,
      });
    }

    if (action === 'conversation_detail') {
      const id = String(body.id || '');
      const { data: conversation } = await db
        .from('puplan_app_conversations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (!conversation) throw new ApiError(404, '找不到這個聊天室');

      const members =
        (
          await db
            .from('puplan_app_conversation_members')
            .select('user_id,joined_at,last_read_at')
            .eq('conversation_id', id)
        ).data || [];
      const messages =
        (
          await db
            .from('puplan_app_messages')
            .select('id,sender_id,body,created_at,edited_at')
            .eq('conversation_id', id)
            .order('created_at', { ascending: true })
            .limit(500)
        ).data || [];
      const users = await userMap([
        ...members.map((member: any) => member.user_id),
        ...messages.map((message: any) => message.sender_id),
      ]);
      await audit(admin, '查看聊天室', null, { conversation_id: id });
      return json(req, {
        conversation,
        members: members.map((member: any) => ({
          ...member,
          user: users.get(member.user_id) || null,
        })),
        messages: messages.map((message: any) => ({
          ...message,
          sender: users.get(message.sender_id) || null,
        })),
      });
    }

    if (action === 'rename_conversation') {
      const id = String(body.id || '');
      const title = clean(body.title, 80);
      if (!title) throw new ApiError(400, '聊天室名稱不能空白');
      const { error } = await db
        .from('puplan_app_conversations')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await audit(admin, '修改聊天室名稱', null, { conversation_id: id });
      return json(req, { ok: true });
    }

    if (action === 'remove_message') {
      const id = String(body.id || '');
      const { error } = await db
        .from('puplan_app_messages')
        .update({
          body: '此訊息已由管理員移除',
          edited_at: new Date().toISOString(),
        })
        .eq('id', id);
      if (error) throw error;
      await audit(admin, '移除聊天訊息', null, { message_id: id });
      return json(req, { ok: true });
    }

    throw new ApiError(400, '找不到這個管理功能');
  } catch (error) {
    console.error(error);
    if (error instanceof ApiError) {
      return json(req, { error: error.code, message: error.message }, error.status);
    }
    return json(
      req,
      { error: 'SERVER_ERROR', message: '管理功能暫時無法使用' },
      500,
    );
  }
});