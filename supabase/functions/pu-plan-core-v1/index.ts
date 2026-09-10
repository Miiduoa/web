import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  assertCredentialCurrent,
  SessionError,
  signSessionV4,
  verifySignedSessionV4,
} from '../_shared/session-v4.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const LEGACY = `${URL}/functions/v1/pu-plan-api`;
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 210_000;
const ALLOWED = new Set(['https://miiduoa.github.io', 'http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:5500']);

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
const json = (req: Request, body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
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
async function hmac(message: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(message)));
}
function equal(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

function sessionApiError(error: unknown): ApiError {
  if (error instanceof SessionError) return new ApiError(401, error.message, error.code);
  return new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
}

async function tokenUid(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let session;
  try {
    session = await verifySignedSessionV4(token, KEY);
  } catch (error) {
    throw sessionApiError(error);
  }

  const { data: user, error } = await db.from('puplan_app_users')
    .select('id,password_salt')
    .eq('id', session.uid)
    .maybeSingle();
  if (error) throw error;
  if (!user) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  try {
    await assertCredentialCurrent(session, user.password_salt || '');
  } catch (credentialError) {
    throw sessionApiError(credentialError);
  }
  return String(user.id);
}

async function passwordHash(password: string, salt: string) {
  const k = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations: PBKDF2_ITERATIONS }, k, 256);
  return b64url(new Uint8Array(bits));
}
async function checkPassword(password: string, salt: string, expected: string) {
  if (!salt || !expected) return false;
  return equal(fromB64url(await passwordHash(password, salt)), fromB64url(expected));
}

async function rateLimit(req: Request, action: string, limit: number, minutes: number) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim();
  const rateKey = b64url(await hmac(`rate:${ip}`)), since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count } = await db.from('puplan_app_rate_limits').select('id', { count: 'exact', head: true })
    .eq('rate_key', rateKey).eq('action', action).gte('created_at', since);
  if ((count || 0) >= limit) throw new ApiError(429, '操作太頻繁，請稍後再試', 'RATE_LIMITED');
  await db.from('puplan_app_rate_limits').insert({ rate_key: rateKey, action });
}

function publicProfile(u: any) {
  return { id: u.id, display_name: u.display_name, username: u.username, avatar_data: u.avatar_data || '', bio: u.bio || '', discoverable: u.discoverable !== false };
}
function semesterPublic(s: any) {
  return { id: s.id, semester_key: s.semester_key, label: s.label, school: s.school || '', department: s.department || '', class_name: s.class_name || '', credits: Number(s.credits || 0), is_current: !!s.is_current, updated_at: s.updated_at, courses: Array.isArray(s.courses) ? s.courses : [] };
}
const emptySocial = () => ({ relationships: [], profiles: [], friends: [], meetups: [] });

async function socialSummary(uid: string) {
  const [friends, incoming, meetups] = await Promise.all([
    db.from('puplan_app_friendships').select('id', { count: 'exact', head: true }).eq('status', 'accepted').or(`requester_id.eq.${uid},addressee_id.eq.${uid}`),
    db.from('puplan_app_friendships').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('addressee_id', uid),
    db.from('puplan_app_meetups').select('id', { count: 'exact', head: true }).eq('status', 'pending').eq('invitee_id', uid),
  ]);
  return { friend_count: friends.count || 0, incoming_request_count: incoming.count || 0, pending_meetup_count: meetups.count || 0 };
}

async function userBundle(uid: string) {
  const [{ data: u, error: ue }, { data: rows, error: se }, { data: legacy }] = await Promise.all([
    db.from('puplan_app_users').select('id,email,display_name,username,avatar_data,bio,discoverable').eq('id', uid).maybeSingle(),
    db.from('puplan_app_semesters').select('id,user_id,semester_key,label,school,department,class_name,credits,courses,is_current,updated_at').eq('user_id', uid).order('is_current', { ascending: false }).order('updated_at', { ascending: false }),
    db.from('puplan_app_schedules').select('courses').eq('user_id', uid).maybeSingle(),
  ]);
  if (ue) throw ue;
  if (!u) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  if (se) throw se;
  const semesters = (rows || []).map(semesterPublic), active = semesters.find((x: any) => x.is_current) || semesters[0] || null;
  const courses = active?.courses || (Array.isArray(legacy?.courses) ? legacy.courses : []);
  return { profile: publicProfile(u), semesters, active_semester: active, courses, social: emptySocial(), social_summary: await socialSummary(uid) };
}

async function forward(req: Request, body: any) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'Origin': req.headers.get('origin') || 'https://miiduoa.github.io' };
  const auth = req.headers.get('authorization');
  if (auth) headers.Authorization = auth;
  const r = await fetch(LEGACY, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await r.text();
  return new Response(text, { status: r.status, headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' } });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED.has(origin)) return new Response('forbidden', { status: 403 });
    return new Response('ok', { headers: cors(req) });
  }
  if (req.method !== 'POST') return json(req, { message: '不支援的操作' }, 405);
  if (origin && !ALLOWED.has(origin)) return json(req, { message: '來源不允許' }, 403);
  const body = await req.json().catch(() => ({})), action = String(body.action || '');
  try {
    if (action === 'login') {
      await rateLimit(req, 'login', 20, 5);
      const email = String(body.email || '').trim().toLowerCase().slice(0, 254), password = String(body.password || '');
      const { data: u, error } = await db.from('puplan_app_users').select('id,password_salt,password_hash').ilike('email', email).maybeSingle();
      if (error) throw error;
      if (!u || !(await checkPassword(password, u.password_salt, u.password_hash))) throw new ApiError(401, 'Email 或密碼錯誤', 'INVALID_LOGIN');
      const [token, bundle] = await Promise.all([signSessionV4(u.id, u.password_salt, KEY), userBundle(u.id)]);
      return json(req, { token, ...bundle });
    }
    if (action === 'bootstrap') {
      const uid = await tokenUid(req);
      return json(req, await userBundle(uid));
    }
    // Signup/recovery and all write operations retain the established API contract.
    return await forward(req, body);
  } catch (e) {
    console.error(e);
    if (e instanceof ApiError) return json(req, { error: e.code, message: e.message }, e.status);
    return json(req, { error: 'SERVER_ERROR', message: '伺服器暫時忙碌，請稍後再試' }, 500);
  }
});
