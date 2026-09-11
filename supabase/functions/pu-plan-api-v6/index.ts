import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertCredentialCurrent,
  SessionError,
  signSessionV4,
  verifySignedSessionV4,
} from '../_shared/session-v4.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const ORIG = `${URL}/functions/v1/pu-plan-api`;
const enc = new TextEncoder();
const ALLOWED = new Set(['https://miiduoa.github.io', 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500']);
const PBKDF2_ITERATIONS = 210000;

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
  const o = req.headers.get('origin') || '';
  return {
    'Access-Control-Allow-Origin': ALLOWED.has(o) ? o : 'https://miiduoa.github.io',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}
const json = (req: Request, x: unknown, s = 200) => new Response(JSON.stringify(x), {
  status: s,
  headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
});

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(s: string) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const raw = atob(s), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
async function hmac(m: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(m)));
}
async function passwordHash(password: string, salt: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations: PBKDF2_ITERATIONS }, k, 256);
  return b64url(new Uint8Array(bits));
}
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}
async function checkPassword(password: string, salt: string, expected: string) {
  return !!salt && !!expected && equal(fromB64url(await passwordHash(password, salt)), fromB64url(expected));
}

function sessionApiError(error: unknown): ApiError {
  if (error instanceof SessionError) return new ApiError(401, error.message, error.code);
  return new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
}

async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let session;
  try {
    session = await verifySignedSessionV4(token, KEY);
  } catch (error) {
    throw sessionApiError(error);
  }

  const { data: u, error } = await db.from('puplan_app_users')
    .select('id,email,display_name,username,avatar_data,bio,discoverable,role,profile_visibility,password_salt')
    .eq('id', session.uid)
    .maybeSingle();
  if (error) throw error;
  if (!u) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  try {
    await assertCredentialCurrent(session, u.password_salt || '');
  } catch (credentialError) {
    throw sessionApiError(credentialError);
  }
  return u;
}

function pub(u: any) {
  return {
    id: u.id,
    display_name: u.display_name,
    username: u.username,
    avatar_data: u.avatar_data || '',
    bio: u.bio || '',
    discoverable: u.discoverable !== false,
    role: u.role || 'user',
    profile_visibility: u.profile_visibility || 'public',
  };
}
function sem(s: any) {
  return {
    id: s.id,
    semester_key: s.semester_key,
    label: s.label,
    school: s.school || '',
    department: s.department || '',
    class_name: s.class_name || '',
    credits: Number(s.credits || 0),
    is_current: !!s.is_current,
    updated_at: s.updated_at,
    courses: Array.isArray(s.courses) ? s.courses : [],
  };
}

async function ownBundle(uid: string) {
  const { data, error } = await db.from('puplan_app_semesters')
    .select('id,user_id,semester_key,label,school,department,class_name,credits,courses,is_current,updated_at')
    .eq('user_id', uid)
    .order('is_current', { ascending: false })
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const list = data || [], active = list.find((s: any) => s.is_current) || list[0];
  return active
    ? { semesters: list.map(sem), active_semester: sem(active), courses: Array.isArray(active.courses) ? active.courses : [] }
    : { semesters: [], active_semester: null, courses: [] };
}

async function rateLimit(req: Request, action: string, limit: number, minutes: number) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim();
  const key = b64url(await hmac(`rate:${ip}`)), since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count, error } = await db.from('puplan_app_rate_limits').select('id', { count: 'exact', head: true })
    .eq('rate_key', key).eq('action', action).gte('created_at', since);
  if (error) throw error;
  if ((count || 0) >= limit) throw new ApiError(429, '操作太頻繁，請稍後再試', 'RATE_LIMITED');
  const inserted = await db.from('puplan_app_rate_limits').insert({ rate_key: key, action });
  if (inserted.error) throw inserted.error;
}

async function profiles(ids: string[]) {
  if (!ids.length) return [];
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('puplan_app_users').select('id,display_name,username,avatar_data,bio,discoverable').in('id', ids.slice(i, i + 100));
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}
async function schedules(ids: string[]) {
  if (!ids.length) return [];
  const out: any[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await db.from('puplan_app_semesters').select('user_id,courses,updated_at,semester_key,label').in('user_id', ids.slice(i, i + 100)).eq('is_current', true);
    if (error) throw error;
    out.push(...(data || []));
  }
  return out;
}

async function socialPage(uid: string, body: any) {
  const limit = Math.max(20, Math.min(100, Number(body.limit) || 100)), offset = Math.max(0, Number(body.offset) || 0);
  const base = `requester_id.eq.${uid},addressee_id.eq.${uid}`;
  const [pendingRes, acceptedRes] = await Promise.all([
    db.from('puplan_app_friendships').select('id,requester_id,addressee_id,status,created_at,updated_at').eq('status', 'pending').or(base).order('created_at', { ascending: false }).limit(100),
    db.from('puplan_app_friendships').select('id,requester_id,addressee_id,status,created_at,updated_at').eq('status', 'accepted').or(base).order('created_at', { ascending: false }).range(offset, offset + limit),
  ]);
  if (pendingRes.error) throw pendingRes.error;
  if (acceptedRes.error) throw acceptedRes.error;
  const acceptedAll = acceptedRes.data || [], has_more = acceptedAll.length > limit, accepted = acceptedAll.slice(0, limit), pending = offset === 0 ? (pendingRes.data || []) : [];
  const relationships = [...pending, ...accepted];
  const ids = [...new Set(relationships.flatMap((r: any) => [r.requester_id, r.addressee_id]).filter((id: string) => id !== uid))];
  const friendIds = accepted.map((r: any) => r.requester_id === uid ? r.addressee_id : r.requester_id);
  const [ps, ss, meet] = await Promise.all([
    profiles(ids), schedules(friendIds),
    offset === 0
      ? db.from('puplan_app_meetups').select('id,creator_id,invitee_id,kind,day,start_period,end_period,note,status,created_at,updated_at').or(`creator_id.eq.${uid},invitee_id.eq.${uid}`).order('created_at', { ascending: false }).limit(100)
      : Promise.resolve({ data: [], error: null } as any),
  ]);
  if (meet.error) throw meet.error;
  const pmap = new Map(ps.map((p: any) => [p.id, p])), smap = new Map(ss.map((s: any) => [s.user_id, s]));
  const friends = friendIds.map((id: string) => {
    const p: any = pmap.get(id) || { display_name: '好友', username: '', avatar_data: '', bio: '' }, s: any = smap.get(id);
    return { id, name: p.display_name, username: p.username, avatar: p.avatar_data || '', bio: p.bio || '', courses: Array.isArray(s?.courses) ? s.courses : [], semester_key: s?.semester_key || '', semester_label: s?.label || '', t: s?.updated_at || '', cloud: true };
  });
  return { relationships, profiles: ps.map(pub), friends, meetups: meet.data || [], page: { offset, limit, next_offset: has_more ? offset + limit : null, has_more } };
}

async function forward(req: Request, body: any) {
  const r = await fetch(ORIG, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': req.headers.get('authorization') || '',
      'Origin': req.headers.get('origin') || 'https://miiduoa.github.io',
    },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

Deno.serve(async (req: Request) => {
  const o = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    if (o && !ALLOWED.has(o)) return new Response('forbidden', { status: 403 });
    return new Response('ok', { headers: cors(req) });
  }
  if (req.method !== 'POST') return json(req, { message: 'METHOD_NOT_ALLOWED' }, 405);
  if (o && !ALLOWED.has(o)) return json(req, { message: '來源不允許' }, 403);
  const body = await req.json().catch(() => ({})), action = String(body.action || '');
  try {
    if (action === 'login') {
      await rateLimit(req, 'login', 20, 5);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 254), password = String(body.password || '');
      if (!password || password.length > 128) throw new ApiError(401, 'Email 或密碼錯誤', 'INVALID_LOGIN');
      const { data: u, error } = await db.from('puplan_app_users')
        .select('id,email,display_name,username,avatar_data,bio,discoverable,role,profile_visibility,password_salt,password_hash')
        .ilike('email', email).maybeSingle();
      if (error) throw error;
      if (!u || !(await checkPassword(password, u.password_salt, u.password_hash))) throw new ApiError(401, 'Email 或密碼錯誤', 'INVALID_LOGIN');
      return json(req, {
        token: await signSessionV4(u.id, u.password_salt, KEY),
        profile: pub(u),
        ...(await ownBundle(u.id)),
        social: { relationships: [], profiles: [], friends: [], meetups: [], deferred: true },
      });
    }
    if (action === 'bootstrap') {
      const u = await requireUser(req);
      return json(req, { profile: pub(u), ...(await ownBundle(u.id)), social: { relationships: [], profiles: [], friends: [], meetups: [], deferred: true } });
    }
    if (action === 'social') {
      const u = await requireUser(req);
      return json(req, { social: await socialPage(u.id, body) });
    }
    return forward(req, body);
  } catch (e) {
    console.error(e);
    if (e instanceof ApiError) return json(req, { error: e.code, message: e.message }, e.status);
    return json(req, { error: 'SERVER_ERROR', message: '伺服器暫時忙碌，請稍後再試' }, 500);
  }
});
