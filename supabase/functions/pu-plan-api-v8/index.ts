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
const PRIMARY_REF = 'hrrmkrayvrgnwcroyttp';
const STANDBY_REF = 'ltfurqaspqsvswmebyzw';
const PROJECT_REF = new URL(URL).hostname.split('.')[0] || '';
const TIER = PROJECT_REF === STANDBY_REF ? 'standby' : 'primary';
const IS_STANDBY = TIER === 'standby';
const LEGACY = `${URL}/functions/v1/pu-plan-api`;
const enc = new TextEncoder();
const PBKDF2_ITERATIONS = 210000;
const COLORS = new Set(['violet', 'blue', 'mint', 'orange', 'pink', 'lime', 'gray']);
const ALLOWED = new Set([
  'https://miiduoa.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);
const PRIMARY_ONLY = new Set([
  'signup', 'recover_password', 'change_password', 'rotate_recovery_code',
  'send_request', 'accept_request', 'decline_request', 'remove_friend',
  'create_meetup', 'respond_meetup', 'cancel_meetup', 'search_people',
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
    'Access-Control-Allow-Origin': ALLOWED.has(origin) ? origin : 'https://miiduoa.github.io',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
  };
}
function response(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8' },
  });
}
function ok(req: Request, body: Record<string, unknown> = {}, status = 200) {
  return response(req, { ...body, cloud_tier: TIER, project_ref: PROJECT_REF }, status);
}
function b64url(bytes: Uint8Array) {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return btoa(value).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(value: string) {
  let normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const raw = atob(normalized), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
async function hmac(message: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}
async function passwordHash(password: string, salt: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: fromB64url(salt), iterations: PBKDF2_ITERATIONS }, key, 256);
  return b64url(new Uint8Array(bits));
}
async function checkPassword(password: string, salt: string, expected: string) {
  if (!salt || !expected) return false;
  return equalBytes(fromB64url(await passwordHash(password, salt)), fromB64url(expected));
}
function sessionApiError(error: unknown) {
  if (error instanceof SessionError) return new ApiError(401, error.message, error.code);
  return new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
}
function cleanUsername(value: unknown) { return String(value || '').trim().replace(/^@/, '').toLowerCase(); }
function cleanName(value: unknown) { return String(value || '').trim().slice(0, 24); }
function cleanEmail(value: unknown) { return String(value || '').trim().toLowerCase().slice(0, 254); }
function cleanBio(value: unknown) { return String(value || '').trim().slice(0, 120); }
function cleanText(value: unknown, max = 80) { return String(value || '').trim().slice(0, max); }
function cleanAvatar(value: unknown) {
  const s = String(value || '');
  if (!s) return '';
  if (!/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(s)) throw new ApiError(400, '頭像格式不正確');
  if (s.length > 180000) throw new ApiError(400, '頭像檔案太大');
  return s;
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
function validateCourses(value: unknown) {
  if (!Array.isArray(value) || value.length > 80) throw new ApiError(400, '課表資料格式不正確');
  return value.map((raw: any) => {
    let day = Number(raw.day), start = Number(raw.start), end = Number(raw.end);
    if (!Number.isInteger(day) || day < 0 || day > 5) throw new ApiError(400, '課程星期格式不正確');
    if (day === 0) { start = 0; end = 0; }
    else if (!Number.isInteger(start) || start < 1 || start > 13 || !Number.isInteger(end) || end < start || end > 13) throw new ApiError(400, '課程時間格式不正確');
    const name = String(raw.name || '').trim().slice(0, 100);
    if (!name) throw new ApiError(400, '課程名稱不能空白');
    return {
      id: String(raw.id || crypto.randomUUID()).slice(0, 80), name, day, start, end,
      teacher: String(raw.teacher || '').trim().slice(0, 80),
      room: String(raw.room || '').trim().slice(0, 80),
      color: COLORS.has(raw.color) ? raw.color : 'gray',
    };
  });
}
function defaultSemester() {
  const d = new Date(), year = d.getUTCFullYear(), month = d.getUTCMonth() + 1;
  const roc = month >= 8 ? year - 1911 : year - 1912;
  const semester = (month >= 8 || month === 1) ? 1 : 2;
  return { semester_key: `${roc}-${semester}`, label: `${roc} 學年度・第 ${semester} 學期` };
}
function semesterPublic(s: any) {
  return {
    id: s.id, semester_key: s.semester_key, label: s.label, school: s.school || '',
    department: s.department || '', class_name: s.class_name || '', credits: Number(s.credits || 0),
    is_current: !!s.is_current, updated_at: s.updated_at, courses: Array.isArray(s.courses) ? s.courses : [],
  };
}
async function semesterRows(uid: string) {
  const { data, error } = await db.from('puplan_app_semesters')
    .select('id,user_id,semester_key,label,school,department,class_name,credits,courses,is_current,updated_at')
    .eq('user_id', uid).order('is_current', { ascending: false }).order('updated_at', { ascending: false });
  if (error) throw error;
  return data || [];
}
async function ensureCurrentSemester(uid: string, legacyCourses: any[] = []) {
  let rows = await semesterRows(uid);
  if (!rows.length) {
    const defaults = defaultSemester();
    const { data, error } = await db.from('puplan_app_semesters')
      .insert({ user_id: uid, ...defaults, courses: Array.isArray(legacyCourses) ? legacyCourses : [], is_current: true })
      .select('*').single();
    if (error) throw error;
    rows = [data];
  }
  let active = rows.find((s: any) => s.is_current);
  if (!active) {
    active = rows[0];
    if (!active) throw new ApiError(500, '無法建立目前學期', 'SEMESTER_STATE_INVALID');
    await db.from('puplan_app_semesters').update({ is_current: false }).eq('user_id', uid);
    await db.from('puplan_app_semesters').update({ is_current: true, updated_at: new Date().toISOString() }).eq('id', active.id);
    active = { ...active, is_current: true };
    rows = rows.map((s: any) => ({ ...s, is_current: s.id === active.id }));
  }
  return { rows, active };
}
async function semesterBundle(uid: string) {
  const { data: legacy } = await db.from('puplan_app_schedules').select('courses').eq('user_id', uid).maybeSingle();
  const { rows, active } = await ensureCurrentSemester(uid, legacy?.courses || []);
  return {
    semesters: rows.map(semesterPublic),
    active_semester: semesterPublic(active),
    courses: Array.isArray(active.courses) ? active.courses : [],
  };
}
async function mirrorLegacy(uid: string, courses: any[]) {
  const { error } = await db.from('puplan_app_schedules').upsert({ user_id: uid, courses, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
async function rateLimit(req: Request, action: string, limit: number, minutes: number) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown').split(',')[0].trim();
  const rateKey = b64url(await hmac(`rate:${ip}`));
  const since = new Date(Date.now() - minutes * 60000).toISOString();
  const { count, error } = await db.from('puplan_app_rate_limits').select('id', { count: 'exact', head: true })
    .eq('rate_key', rateKey).eq('action', action).gte('created_at', since);
  if (error) throw error;
  if ((count || 0) >= limit) throw new ApiError(429, '操作太頻繁，請稍後再試', 'RATE_LIMITED');
  const inserted = await db.from('puplan_app_rate_limits').insert({ rate_key: rateKey, action });
  if (inserted.error) throw inserted.error;
}
async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let session;
  try { session = await verifySignedSessionV4(token, KEY); }
  catch (error) { throw sessionApiError(error); }
  const { data: user, error } = await db.from('puplan_app_users')
    .select('id,email,display_name,username,avatar_data,bio,discoverable,role,profile_visibility,password_salt,password_hash')
    .eq('id', session.uid).maybeSingle();
  if (error) throw error;
  if (!user) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  try { await assertCredentialCurrent(session, user.password_salt || ''); }
  catch (error) { throw sessionApiError(error); }
  return user;
}
async function forwardPrimary(req: Request, body: any) {
  if (IS_STANDBY) throw new ApiError(503, '此操作需由主雲端完成', 'PRIMARY_REQUIRED');
  const forwarded = await fetch(LEGACY, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': req.headers.get('authorization') || '',
      'Origin': req.headers.get('origin') || 'https://miiduoa.github.io',
    },
    body: JSON.stringify(body),
  });
  const data = await forwarded.json().catch(() => ({}));
  return ok(req, data, forwarded.status);
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED.has(origin)) return new Response('forbidden', { status: 403 });
    return new Response('ok', { headers: cors(req) });
  }
  if (req.method !== 'POST') return response(req, { error: 'METHOD_NOT_ALLOWED' }, 405);
  if (origin && !ALLOWED.has(origin)) return response(req, { error: 'ORIGIN_NOT_ALLOWED', message: '來源不允許' }, 403);

  const body = await req.json().catch(() => ({}));
  const action = String(body.action || '');
  try {
    if (action === 'health') return ok(req, { ok: true, protocol: 'independent-session-v1' });

    if (action === 'login') {
      await rateLimit(req, 'login', 20, 5);
      const email = cleanEmail(body.email), password = String(body.password || '');
      const { data: user, error } = await db.from('puplan_app_users')
        .select('id,email,display_name,username,avatar_data,bio,discoverable,role,profile_visibility,password_salt,password_hash')
        .ilike('email', email).maybeSingle();
      if (error) throw error;
      if (!user) {
        if (IS_STANDBY) throw new ApiError(503, '這個帳號尚未完成異地備援同步', 'STANDBY_NOT_SEEDED');
        throw new ApiError(401, 'Email 或密碼錯誤', 'INVALID_LOGIN');
      }
      if (!(await checkPassword(password, user.password_salt, user.password_hash))) throw new ApiError(401, 'Email 或密碼錯誤', 'INVALID_LOGIN');
      return ok(req, {
        token: await signSessionV4(user.id, user.password_salt, KEY),
        profile: pub(user),
        ...(await semesterBundle(user.id)),
        social: { relationships: [], profiles: [], friends: [], meetups: [], deferred: true },
      });
    }

    if (PRIMARY_ONLY.has(action)) return forwardPrimary(req, body);

    const user = await requireUser(req);
    if (action === 'bootstrap') {
      return ok(req, {
        profile: pub(user), ...(await semesterBundle(user.id)),
        social: { relationships: [], profiles: [], friends: [], meetups: [], deferred: true },
      });
    }
    if (action === 'update_profile') {
      const display_name = cleanName(body.display_name), username = cleanUsername(body.username), bio = cleanBio(body.bio);
      const discoverable = body.discoverable !== false;
      const avatar_data = body.avatar_data === undefined ? user.avatar_data : cleanAvatar(body.avatar_data);
      if (!display_name) throw new ApiError(400, '請輸入顯示名稱');
      if (!/^[a-z0-9_.]{2,24}$/.test(username)) throw new ApiError(400, '@帳號格式不正確');
      const { data: updated, error } = await db.from('puplan_app_users')
        .update({ display_name, username, bio, avatar_data, discoverable, updated_at: new Date().toISOString() })
        .eq('id', user.id)
        .select('id,display_name,username,avatar_data,bio,discoverable,role,profile_visibility').single();
      if (error) {
        if (error.code === '23505') throw new ApiError(409, '這個 @帳號已有人使用', 'USERNAME_TAKEN');
        throw error;
      }
      return ok(req, { profile: pub(updated) });
    }
    if (action === 'save_schedule') {
      const courses = validateCourses(body.courses), key = cleanText(body.semester_key, 24);
      let target: any = null;
      if (key) {
        const found = await db.from('puplan_app_semesters').select('id,is_current').eq('user_id', user.id).eq('semester_key', key).maybeSingle();
        if (found.error) throw found.error;
        target = found.data;
      }
      if (!target) target = (await ensureCurrentSemester(user.id)).active;
      const { error } = await db.from('puplan_app_semesters').update({ courses, updated_at: new Date().toISOString() }).eq('id', target.id).eq('user_id', user.id);
      if (error) throw error;
      if (target.is_current !== false) await mirrorLegacy(user.id, courses);
      return ok(req, { ok: true });
    }
    if (action === 'semesters') return ok(req, await semesterBundle(user.id));
    if (action === 'upsert_semester') {
      const key = cleanText(body.semester_key, 24);
      if (!/^[0-9A-Za-z_-]{2,24}$/.test(key)) throw new ApiError(400, '學期代碼格式不正確');
      const label = cleanText(body.label, 60) || key, school = cleanText(body.school, 80), department = cleanText(body.department, 80), class_name = cleanText(body.class_name, 80);
      const credits = Math.max(0, Math.min(60, Number(body.credits) || 0)), setCurrent = body.set_current !== false;
      const existing = await db.from('puplan_app_semesters').select('id').eq('user_id', user.id).eq('semester_key', key).maybeSingle();
      if (existing.error) throw existing.error;
      if (setCurrent) await db.from('puplan_app_semesters').update({ is_current: false }).eq('user_id', user.id);
      if (existing.data) {
        const updated = await db.from('puplan_app_semesters').update({ label, school, department, class_name, credits, is_current: setCurrent, updated_at: new Date().toISOString() }).eq('id', existing.data.id);
        if (updated.error) throw updated.error;
      } else {
        const inserted = await db.from('puplan_app_semesters').insert({ user_id: user.id, semester_key: key, label, school, department, class_name, credits, courses: [], is_current: setCurrent });
        if (inserted.error) throw inserted.error;
      }
      const bundle = await semesterBundle(user.id);
      if (setCurrent) await mirrorLegacy(user.id, bundle.courses);
      return ok(req, bundle);
    }
    if (action === 'switch_semester') {
      const key = cleanText(body.semester_key, 24);
      const found = await db.from('puplan_app_semesters').select('id').eq('user_id', user.id).eq('semester_key', key).maybeSingle();
      if (found.error) throw found.error;
      if (!found.data) throw new ApiError(404, '找不到這個學期');
      await db.from('puplan_app_semesters').update({ is_current: false }).eq('user_id', user.id);
      const changed = await db.from('puplan_app_semesters').update({ is_current: true, updated_at: new Date().toISOString() }).eq('id', found.data.id);
      if (changed.error) throw changed.error;
      const bundle = await semesterBundle(user.id); await mirrorLegacy(user.id, bundle.courses); return ok(req, bundle);
    }
    if (action === 'delete_semester') {
      const key = cleanText(body.semester_key, 24), rows = await semesterRows(user.id);
      if (rows.length <= 1) throw new ApiError(400, '至少要保留一個學期');
      const target = rows.find((row: any) => row.semester_key === key);
      if (!target) throw new ApiError(404, '找不到這個學期');
      const deleted = await db.from('puplan_app_semesters').delete().eq('id', target.id).eq('user_id', user.id);
      if (deleted.error) throw deleted.error;
      if (target.is_current) {
        const remaining = (await semesterRows(user.id))[0];
        if (remaining) await db.from('puplan_app_semesters').update({ is_current: true }).eq('id', remaining.id);
      }
      const bundle = await semesterBundle(user.id); await mirrorLegacy(user.id, bundle.courses); return ok(req, bundle);
    }
    if (action === 'social') {
      if (IS_STANDBY) return ok(req, { social: { relationships: [], profiles: [], friends: [], meetups: [], deferred: true } });
      return forwardPrimary(req, body);
    }
    if (!IS_STANDBY) return forwardPrimary(req, body);
    throw new ApiError(503, '備援雲端目前只提供登入、個人資料與課表核心功能', 'STANDBY_CORE_ONLY');
  } catch (error) {
    console.error(error);
    if (error instanceof ApiError) return response(req, { error: error.code, message: error.message, cloud_tier: TIER }, error.status);
    return response(req, { error: 'SERVER_ERROR', message: '伺服器暫時忙碌，請稍後再試', cloud_tier: TIER }, 500);
  }
});
