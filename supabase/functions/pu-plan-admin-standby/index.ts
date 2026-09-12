import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertCredentialCurrent,
  DEFAULT_SESSION_SECONDS,
  SessionError,
  verifySignedSessionV4,
} from './session-v4.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const MAX_BODY_BYTES = 128_000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED = new Set([
  'https://miiduoa.github.io',
  'https://nolu.tw',
  'https://www.nolu.tw',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);
const READ_ONLY = new Set([
  'whoami',
  'overview',
  'users',
  'user_detail',
  'posts',
  'conversations',
  'conversation_detail',
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
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
  if (ALLOWED.has(origin)) headers['Access-Control-Allow-Origin'] = origin;
  return headers;
}

const json = (req: Request, body: Record<string, unknown>, status = 200) =>
  new Response(JSON.stringify({ ...body, cloud_tier: 'standby' }), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });

function sessionError(error: unknown) {
  if (error instanceof SessionError) return new ApiError(401, error.message, error.code);
  return new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
}

async function readJson(req: Request) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, '請求內容過大', 'PAYLOAD_TOO_LARGE');
  if (!req.body) return {} as Record<string, unknown>;
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      try { await reader.cancel('payload too large'); } catch { /* noop */ }
      throw new ApiError(413, '請求內容過大', 'PAYLOAD_TOO_LARGE');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(bytes) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, '資料格式錯誤', 'INVALID_JSON');
  }
}

async function requireAdmin(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let session;
  try {
    session = await verifySignedSessionV4(token, KEY);
  } catch (error) {
    throw sessionError(error);
  }
  // The shared verifier protects signature, expiry and future-issued tokens.
  // Standby admin additionally narrows identity format and maximum lifetime so a
  // privileged read surface never accepts a nonstandard long-lived V4 token.
  if (!UUID_RE.test(session.uid) || session.exp - session.iat > DEFAULT_SESSION_SECONDS + 600) {
    throw new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
  }
  const { data, error } = await db
    .from('puplan_app_users')
    .select('id,email,display_name,username,role,password_salt')
    .eq('id', session.uid)
    .maybeSingle();
  if (error) throw new ApiError(503, '備援資料庫暫時無法使用', 'DB_UNAVAILABLE');
  if (!data) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  try {
    await assertCredentialCurrent(session, data.password_salt || '');
  } catch (error) {
    throw sessionError(error);
  }
  if (data.role !== 'admin') throw new ApiError(403, '你沒有管理權限', 'FORBIDDEN');
  return data;
}

const clean = (value: unknown, max = 80) => String(value ?? '').trim().slice(0, max);
const validUuid = (value: unknown) => UUID_RE.test(String(value || ''));

async function count(table: string, filter?: (query: any) => any) {
  let query = db.from(table).select('*', { count: 'exact', head: true });
  if (filter) query = filter(query);
  const result = await query;
  if (result.error) throw result.error;
  return result.count || 0;
}

async function userMap(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, any>();
  const result = await db
    .from('puplan_app_users')
    .select('id,display_name,username,email,avatar_data')
    .in('id', unique);
  if (result.error) throw result.error;
  return new Map((result.data || []).map((item: any) => [item.id, item]));
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'GET') {
    return json(req, { ok: true, service: 'pu-plan-admin', role: 'standby', read_only: true });
  }
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED.has(origin)) return new Response('forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    return new Response(null, { status: 204, headers: cors(req) });
  }
  if (req.method !== 'POST') return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);
  if (origin && !ALLOWED.has(origin)) return json(req, { error: 'ORIGIN_NOT_ALLOWED', message: '來源不允許' }, 403);

  try {
    const body = await readJson(req);
    const action = String(body.action || '');
    const admin = await requireAdmin(req);
    if (!READ_ONLY.has(action)) {
      throw new ApiError(503, '備援區管理模式目前為唯讀；修改操作需由主雲端完成', 'PRIMARY_REQUIRED');
    }

    if (action === 'whoami') {
      return json(req, {
        is_admin: true,
        read_only: true,
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
      const [users, posts, replies, messages, conversations, friendships, semesters, media] = await Promise.all([
        count('puplan_app_users'),
        count('puplan_app_posts', (q) => q.is('parent_id', null).is('deleted_at', null)),
        count('puplan_app_posts', (q) => q.not('parent_id', 'is', null).is('deleted_at', null)),
        count('puplan_app_messages'),
        count('puplan_app_conversations'),
        count('puplan_app_friendships', (q) => q.eq('status', 'accepted')),
        count('puplan_app_semesters'),
        count('puplan_app_post_media'),
      ]);
      return json(req, { read_only: true, stats: { users, posts, replies, messages, conversations, friendships, semesters, media } });
    }

    if (action === 'users') {
      const term = clean(body.query, 80).replace(/[%,()]/g, '');
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const offset = Math.max(0, Number(body.offset) || 0);
      let query = db
        .from('puplan_app_users')
        .select('id,email,display_name,username,created_at,updated_at,avatar_data,bio,discoverable,role,profile_visibility', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (term) query = query.or(`email.ilike.%${term}%,display_name.ilike.%${term}%,username.ilike.%${term}%`);
      const result = await query;
      if (result.error) throw result.error;
      return json(req, { read_only: true, users: result.data || [], total: result.count || 0 });
    }

    if (action === 'user_detail') {
      const id = String(body.user_id || '');
      if (!validUuid(id)) throw new ApiError(400, '會員識別碼無效');
      const user = await db
        .from('puplan_app_users')
        .select('id,email,display_name,username,created_at,updated_at,avatar_data,bio,discoverable,role,profile_visibility')
        .eq('id', id)
        .maybeSingle();
      if (user.error) throw user.error;
      if (!user.data) throw new ApiError(404, '找不到這位會員');
      const [semesters, friendships, posts, memberships] = await Promise.all([
        db.from('puplan_app_semesters').select('*').eq('user_id', id).order('updated_at', { ascending: false }),
        db.from('puplan_app_friendships').select('*').or(`requester_id.eq.${id},addressee_id.eq.${id}`).order('created_at', { ascending: false }),
        db.from('puplan_app_posts').select('id,parent_id,body,visibility,created_at,updated_at,deleted_at').eq('author_id', id).order('created_at', { ascending: false }).limit(100),
        db.from('puplan_app_conversation_members').select('conversation_id,joined_at,last_read_at').eq('user_id', id),
      ]);
      for (const result of [semesters, friendships, posts, memberships]) if (result.error) throw result.error;
      return json(req, {
        read_only: true,
        user: user.data,
        semesters: semesters.data || [],
        friendships: friendships.data || [],
        posts: posts.data || [],
        memberships: memberships.data || [],
      });
    }

    if (action === 'posts') {
      const kind = body.kind === 'reply' ? 'reply' : 'post';
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const offset = Math.max(0, Number(body.offset) || 0);
      let query = db
        .from('puplan_app_posts')
        .select('id,author_id,parent_id,body,visibility,created_at,updated_at,deleted_at', { count: 'exact' })
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);
      query = kind === 'reply' ? query.not('parent_id', 'is', null) : query.is('parent_id', null);
      const result = await query;
      if (result.error) throw result.error;
      const users = await userMap((result.data || []).map((item: any) => item.author_id));
      return json(req, {
        read_only: true,
        items: (result.data || []).map((item: any) => ({ ...item, author: users.get(item.author_id) || null })),
        total: result.count || 0,
      });
    }

    if (action === 'conversations') {
      const limit = Math.min(100, Math.max(1, Number(body.limit) || 50));
      const offset = Math.max(0, Number(body.offset) || 0);
      const result = await db
        .from('puplan_app_conversations')
        .select('id,kind,title,created_by,created_at,updated_at', { count: 'exact' })
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (result.error) throw result.error;
      const ids = (result.data || []).map((item: any) => item.id);
      let members: any[] = [];
      let messages: any[] = [];
      if (ids.length) {
        const [memberResult, messageResult] = await Promise.all([
          db.from('puplan_app_conversation_members').select('conversation_id,user_id').in('conversation_id', ids),
          db.from('puplan_app_messages').select('conversation_id,id').in('conversation_id', ids),
        ]);
        if (memberResult.error) throw memberResult.error;
        if (messageResult.error) throw messageResult.error;
        members = memberResult.data || [];
        messages = messageResult.data || [];
      }
      return json(req, {
        read_only: true,
        items: (result.data || []).map((conversation: any) => ({
          ...conversation,
          member_count: members.filter((member) => member.conversation_id === conversation.id).length,
          message_count: messages.filter((message) => message.conversation_id === conversation.id).length,
        })),
        total: result.count || 0,
      });
    }

    if (action === 'conversation_detail') {
      const id = String(body.id || '');
      if (!validUuid(id)) throw new ApiError(400, '聊天室識別碼無效');
      const conversation = await db.from('puplan_app_conversations').select('*').eq('id', id).maybeSingle();
      if (conversation.error) throw conversation.error;
      if (!conversation.data) throw new ApiError(404, '找不到這個聊天室');
      const [members, messages] = await Promise.all([
        db.from('puplan_app_conversation_members').select('user_id,joined_at,last_read_at').eq('conversation_id', id),
        db.from('puplan_app_messages').select('id,sender_id,body,created_at,edited_at').eq('conversation_id', id).order('created_at', { ascending: true }).limit(500),
      ]);
      if (members.error) throw members.error;
      if (messages.error) throw messages.error;
      const users = await userMap([
        ...(members.data || []).map((item: any) => item.user_id),
        ...(messages.data || []).map((item: any) => item.sender_id),
      ]);
      return json(req, {
        read_only: true,
        conversation: conversation.data,
        members: (members.data || []).map((item: any) => ({ ...item, user: users.get(item.user_id) || null })),
        messages: (messages.data || []).map((item: any) => ({ ...item, sender: users.get(item.sender_id) || null })),
      });
    }

    throw new ApiError(400, '找不到這個管理功能');
  } catch (error) {
    if (error instanceof ApiError) return json(req, { error: error.code, message: error.message }, error.status);
    console.error('standby admin request failed');
    return json(req, { error: 'SERVER_ERROR', message: '備援管理功能暫時無法使用' }, 500);
  }
});
