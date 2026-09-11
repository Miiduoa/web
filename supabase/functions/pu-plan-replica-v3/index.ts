import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const PRIMARY_REF = 'hrrmkrayvrgnwcroyttp';
const STANDBY_REF = 'ltfurqaspqsvswmebyzw';
const SELF_REF = new URL(SUPABASE_URL).hostname.split('.')[0] || '';
const PEER_REF = SELF_REF === PRIMARY_REF ? STANDBY_REF : PRIMARY_REF;
const IS_PRIMARY = SELF_REF === PRIMARY_REF;
const PEER_URL = `https://${PEER_REF}.supabase.co/functions/v1/pu-plan-replica-v3`;
const KEY_DOMAIN = 'nolu-replica-v3-signing-seed-20260911';
const SESSION_SECONDS = 60 * 60 * 24 * 30;
const ENVELOPE_SECONDS = 75;
const MAX_BODY_BYTES = 650_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_ORIGINS = new Set([
  'https://miiduoa.github.io',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);
const PINNED_KEYS: Record<string, { kid: string; key: string }> = {
  [PRIMARY_REF]: { kid: 'rv3-3ku8g6TEfZMcnpyj', key: 'dLZNjauIfxSs6xKq_9DVsvbPUiinh0IOZs18ht9USbk' },
  [STANDBY_REF]: { kid: 'rv3-w-TaIrgeMY5T9Nb0', key: 'legz5M60_6mhg3jeClvhtCOhQAL_PVvzMfbacUO4o-o' },
};

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'BAD_REQUEST') {
    super(message); this.status = status; this.code = code;
  }
}

function b64url(bytes: Uint8Array) {
  let raw = '';
  for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(value: string) {
  let normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (normalized.length % 4) normalized += '=';
  const raw = atob(normalized), out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function corsHeaders(origin: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  if (ALLOWED_ORIGINS.has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}
function json(origin: string, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) });
}
async function readJson(req: Request) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, '同步資料過大', 'PAYLOAD_TOO_LARGE');
  const text = await req.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw new ApiError(413, '同步資料過大', 'PAYLOAD_TOO_LARGE');
  try {
    const value = JSON.parse(text || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, any>;
  } catch {
    throw new ApiError(400, '資料格式錯誤', 'INVALID_JSON');
  }
}
async function deriveSeed() {
  if (!SERVICE_KEY) throw new ApiError(503, '簽章服務未就緒', 'SIGNING_KEY_UNAVAILABLE');
  const key = await crypto.subtle.importKey('raw', encoder.encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(KEY_DOMAIN)));
}
async function assertSigningKey() {
  const expected = PINNED_KEYS[SELF_REF];
  if (!expected) throw new ApiError(503, '未知的區域身分', 'REGION_NOT_CONFIGURED');
  const seed = await deriveSeed();
  const actual = ed25519.getPublicKey(seed);
  if (!equalBytes(actual, fromB64url(expected.key))) throw new ApiError(503, '區域簽章金鑰已變更，暫停備援', 'SIGNING_KEY_MISMATCH');
  return seed;
}
async function localHmac(message: string) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(SERVICE_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}
async function credentialVersion(passwordSalt: string) {
  if (!passwordSalt) throw new ApiError(401, '登入憑證已變更，請重新登入', 'SESSION_REVOKED');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`nolu-session-v4:${passwordSalt}`)));
  return b64url(digest).slice(0, 22);
}
async function verifyLocalV4(token: string) {
  const [payloadPart, signaturePart, ...extra] = String(token || '').split('.');
  if (!payloadPart || !signaturePart || extra.length) throw new ApiError(401, '請重新登入', 'UNAUTHORIZED');
  let payload: any;
  try {
    const expected = await localHmac(payloadPart), actual = fromB64url(signaturePart);
    if (!equalBytes(expected, actual)) throw new Error('bad signature');
    payload = JSON.parse(decoder.decode(fromB64url(payloadPart)));
  } catch {
    throw new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload?.v !== 4 || !UUID.test(String(payload.uid || '')) || !payload.cv || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= now || payload.iat > now + 300 || payload.exp - payload.iat > SESSION_SECONDS + 600) {
    throw new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
  }
  return payload;
}
async function signLocalV4(uid: string, passwordSalt: string) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 4, uid, iat: now, exp: now + SESSION_SECONDS, cv: await credentialVersion(passwordSalt) };
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${b64url(await localHmac(encoded))}`;
}
async function signEnvelope(payload: Record<string, unknown>) {
  const seed = await assertSigningKey();
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${b64url(ed25519.sign(encoder.encode(encoded), seed))}`;
}
async function verifyPeerEnvelope(raw: string, expectedKind: 'core-seed' | 'probe') {
  const [payloadPart, signaturePart, ...extra] = String(raw || '').split('.');
  if (!payloadPart || !signaturePart || extra.length) throw new ApiError(401, '備援同步簽章無效', 'REPLICA_SIGNATURE_INVALID');
  const peer = PINNED_KEYS[PEER_REF];
  if (!peer || !ed25519.verify(fromB64url(signaturePart), encoder.encode(payloadPart), fromB64url(peer.key))) {
    throw new ApiError(401, '備援同步簽章無效', 'REPLICA_SIGNATURE_INVALID');
  }
  let payload: any;
  try { payload = JSON.parse(decoder.decode(fromB64url(payloadPart))); }
  catch { throw new ApiError(400, '備援同步資料格式錯誤', 'REPLICA_PAYLOAD_INVALID'); }
  const now = Math.floor(Date.now() / 1000);
  if (payload?.v !== 3 || payload.kind !== expectedKind || payload.iss !== PEER_REF || payload.aud !== SELF_REF || !UUID.test(String(payload.nonce || '')) || !Number.isFinite(payload.iat) || !Number.isFinite(payload.exp) || payload.exp <= now || payload.iat > now + 30 || payload.exp - payload.iat > ENVELOPE_SECONDS + 5 || now - payload.iat > ENVELOPE_SECONDS) {
    throw new ApiError(401, '備援同步憑證已失效', 'REPLICA_ENVELOPE_EXPIRED');
  }
  if (expectedKind === 'core-seed' && (!UUID.test(String(payload.uid || '')) || typeof payload.cv !== 'string' || payload.cv.length > 64)) {
    throw new ApiError(400, '備援同步資料格式錯誤', 'REPLICA_PAYLOAD_INVALID');
  }
  return payload;
}
function authToken(req: Request) {
  const auth = req.headers.get('authorization') || '';
  return auth.startsWith('Bearer ') ? auth.slice(7) : '';
}
async function requireLocalUser(req: Request) {
  const session = await verifyLocalV4(authToken(req));
  const { data: user, error } = await db.from('puplan_app_users')
    .select('id,email,display_name,username,avatar_data,bio,discoverable,role,profile_visibility,password_salt,password_hash,recovery_salt,recovery_hash,recovery_created_at,created_at,updated_at')
    .eq('id', session.uid).maybeSingle();
  if (error) throw new ApiError(503, '資料庫暫時無法使用', 'DB_UNAVAILABLE');
  if (!user) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  if (session.cv !== await credentialVersion(user.password_salt || '')) throw new ApiError(401, '登入憑證已變更，請重新登入', 'SESSION_REVOKED');
  return { session, user };
}
async function exportBundle(uid: string, user: any) {
  const [scheduleResult, semestersResult] = await Promise.all([
    db.from('puplan_app_schedules').select('user_id,courses,updated_at').eq('user_id', uid).maybeSingle(),
    db.from('puplan_app_semesters').select('id,user_id,semester_key,label,school,department,class_name,credits,courses,is_current,created_at,updated_at').eq('user_id', uid).order('updated_at', { ascending: true }),
  ]);
  if (scheduleResult.error || semestersResult.error) throw new ApiError(503, '資料庫暫時無法使用', 'DB_UNAVAILABLE');
  return { user, schedule: scheduleResult.data || null, semesters: semestersResult.data || [] };
}
async function validateBundle(payload: any) {
  const bundle = payload?.bundle, user = bundle?.user;
  if (!bundle || !user || String(user.id) !== String(payload.uid)) throw new ApiError(400, '備援同步資料不完整', 'REPLICA_DATA_INVALID');
  for (const field of ['email', 'username', 'password_salt', 'password_hash']) if (typeof user[field] !== 'string' || !user[field]) throw new ApiError(400, '備援帳號資料不完整', 'REPLICA_DATA_INVALID');
  if (user.email.length > 254 || user.username.length > 24 || user.password_salt.length > 512 || user.password_hash.length > 512 || String(user.display_name || '').length > 24 || String(user.bio || '').length > 120 || String(user.avatar_data || '').length > 180000) throw new ApiError(400, '備援帳號資料超出限制', 'REPLICA_DATA_INVALID');
  if (await credentialVersion(user.password_salt) !== payload.cv) throw new ApiError(409, '同步憑證版本不一致', 'CREDENTIAL_VERSION_MISMATCH');
  const semesters = Array.isArray(bundle.semesters) ? bundle.semesters : [];
  if (semesters.length > 32 || semesters.filter((row: any) => row?.is_current === true).length > 1) throw new ApiError(400, '學期備援資料格式錯誤', 'REPLICA_DATA_INVALID');
  const seen = new Set<string>();
  for (const row of semesters) {
    const id = String(row?.id ?? '');
    if (!id || seen.has(id) || String(row.user_id) !== String(payload.uid) || !Array.isArray(row.courses) || row.courses.length > 80 || String(row.semester_key || '').length > 24 || String(row.label || '').length > 60) throw new ApiError(400, '學期備援資料格式錯誤', 'REPLICA_DATA_INVALID');
    seen.add(id);
  }
  if (bundle.schedule && (String(bundle.schedule.user_id) !== String(payload.uid) || !Array.isArray(bundle.schedule.courses) || bundle.schedule.courses.length > 80)) throw new ApiError(400, '課表備援資料格式錯誤', 'REPLICA_DATA_INVALID');
  return { ...bundle, semesters };
}
async function consumeNonce(payload: any) {
  await db.from('puplan_replica_v3_nonces').delete().lt('expires_at', new Date(Date.now() - 5 * 60 * 1000).toISOString());
  const { error } = await db.from('puplan_replica_v3_nonces').insert({ nonce: payload.nonce, issuer: payload.iss, expires_at: new Date(payload.exp * 1000).toISOString() });
  if (error?.code === '23505') throw new ApiError(409, '重複的備援同步請求', 'REPLICA_REPLAY');
  if (error) throw new ApiError(503, '備援防重放機制暫時無法使用', 'REPLICA_NONCE_UNAVAILABLE');
}
async function applyPrimaryBundleOnStandby(payload: any) {
  if (IS_PRIMARY || payload.iss !== PRIMARY_REF) throw new ApiError(403, '只允許主區域建立備援快照', 'PRIMARY_ONLY_SEED');
  const bundle = await validateBundle(payload), incoming = bundle.user, uid = String(payload.uid);
  const { data: existingUser, error: existingError } = await db.from('puplan_app_users').select('id').eq('id', uid).maybeSingle();
  if (existingError) throw new ApiError(503, '備援資料庫暫時無法使用', 'DB_UNAVAILABLE');
  if (existingUser) {
    const { error } = await db.from('puplan_replica_state').upsert({ user_id: uid, enabled: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (error) throw new ApiError(503, '備援狀態暫時無法更新', 'DB_UNAVAILABLE');
  }
  const nextUser = {
    id: uid,
    email: String(incoming.email).toLowerCase().slice(0, 254),
    display_name: String(incoming.display_name || '').slice(0, 24),
    username: String(incoming.username).toLowerCase().slice(0, 24),
    avatar_data: String(incoming.avatar_data || '').slice(0, 180000),
    bio: String(incoming.bio || '').slice(0, 120),
    discoverable: incoming.discoverable !== false,
    role: incoming.role === 'admin' ? 'admin' : 'user',
    profile_visibility: incoming.profile_visibility === 'private' ? 'private' : 'public',
    password_salt: String(incoming.password_salt),
    password_hash: String(incoming.password_hash),
    recovery_salt: incoming.recovery_salt ? String(incoming.recovery_salt).slice(0, 512) : null,
    recovery_hash: incoming.recovery_hash ? String(incoming.recovery_hash).slice(0, 512) : null,
    recovery_created_at: incoming.recovery_created_at || null,
    created_at: incoming.created_at || new Date().toISOString(),
    updated_at: incoming.updated_at || new Date().toISOString(),
  };
  const userWrite = await db.from('puplan_app_users').upsert(nextUser, { onConflict: 'id' });
  if (userWrite.error) throw new ApiError(503, '備援帳號暫時無法更新', 'DB_UNAVAILABLE');
  if (!existingUser) {
    const stateWrite = await db.from('puplan_replica_state').upsert({ user_id: uid, enabled: false, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
    if (stateWrite.error) throw new ApiError(503, '備援狀態暫時無法更新', 'DB_UNAVAILABLE');
  }
  if (bundle.schedule) {
    const scheduleWrite = await db.from('puplan_app_schedules').upsert({ user_id: uid, courses: bundle.schedule.courses, updated_at: bundle.schedule.updated_at || new Date().toISOString() }, { onConflict: 'user_id' });
    if (scheduleWrite.error) throw new ApiError(503, '備援課表暫時無法更新', 'DB_UNAVAILABLE');
  } else {
    const scheduleDelete = await db.from('puplan_app_schedules').delete().eq('user_id', uid);
    if (scheduleDelete.error) throw new ApiError(503, '備援課表暫時無法更新', 'DB_UNAVAILABLE');
  }
  const { data: localSemesters, error: localReadError } = await db.from('puplan_app_semesters').select('id').eq('user_id', uid);
  if (localReadError) throw new ApiError(503, '備援學期暫時無法讀取', 'DB_UNAVAILABLE');
  const incomingIds = new Set(bundle.semesters.map((row: any) => String(row.id)));
  for (const row of bundle.semesters) {
    const semesterWrite = await db.from('puplan_app_semesters').upsert({
      id: row.id, user_id: uid, semester_key: String(row.semester_key || '').slice(0, 24), label: String(row.label || '').slice(0, 60),
      school: String(row.school || '').slice(0, 80), department: String(row.department || '').slice(0, 80), class_name: String(row.class_name || '').slice(0, 80),
      credits: Math.max(0, Math.min(60, Number(row.credits) || 0)), courses: row.courses, is_current: row.is_current === true,
      created_at: row.created_at || new Date().toISOString(), updated_at: row.updated_at || new Date().toISOString(),
    }, { onConflict: 'id' });
    if (semesterWrite.error) throw new ApiError(503, '備援學期暫時無法更新', 'DB_UNAVAILABLE');
  }
  const staleIds = (localSemesters || []).map((row: any) => row.id).filter((id: any) => !incomingIds.has(String(id)));
  if (staleIds.length) {
    const staleDelete = await db.from('puplan_app_semesters').delete().in('id', staleIds).eq('user_id', uid);
    if (staleDelete.error) throw new ApiError(503, '備援學期暫時無法清理', 'DB_UNAVAILABLE');
  }
  const now = new Date().toISOString();
  const stateReady = await db.from('puplan_replica_state').upsert({ user_id: uid, enabled: true, seeded_at: now, credentials_synced_at: now, updated_at: now }, { onConflict: 'user_id' });
  if (stateReady.error) throw new ApiError(503, '備援狀態暫時無法啟用', 'DB_UNAVAILABLE');
  const { data: readyUser, error: readyError } = await db.from('puplan_app_users').select('id,password_salt').eq('id', uid).maybeSingle();
  if (readyError || !readyUser) throw new ApiError(503, '備援帳號尚未就緒', 'REPLICA_NOT_READY');
  if (await credentialVersion(readyUser.password_salt || '') !== payload.cv) {
    await db.from('puplan_replica_state').update({ enabled: false, updated_at: new Date().toISOString() }).eq('user_id', uid);
    throw new ApiError(409, '備援登入憑證驗證失敗', 'CREDENTIAL_VERSION_MISMATCH');
  }
  return { peer_token: await signLocalV4(uid, readyUser.password_salt) };
}
async function syncPrimaryToStandby(req: Request) {
  if (!IS_PRIMARY) throw new ApiError(503, '備援區域不會自動回寫主資料庫', 'PRIMARY_REQUIRED');
  const { session, user } = await requireLocalUser(req);
  const bundle = await exportBundle(user.id, user);
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 3, kind: 'core-seed', iss: SELF_REF, aud: PEER_REF, iat: now, exp: now + ENVELOPE_SECONDS, nonce: crypto.randomUUID(), uid: user.id, cv: session.cv, bundle };
  const envelope = await signEnvelope(payload);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 7000);
  try {
    const response = await fetch(PEER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'ingest', envelope }), cache: 'no-store', signal: ctrl.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new ApiError(response.status, data.message || '異地備援同步失敗', data.error || 'PEER_SYNC_FAILED');
    if (typeof data.peer_token !== 'string' || data.peer_token.split('.').length !== 2) throw new ApiError(503, '備援區域未核發有效登入狀態', 'PEER_SESSION_MISSING');
    return { peer_token: data.peer_token, peer_ref: PEER_REF };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, '異地備援暫時無法連線', 'PEER_UNAVAILABLE');
  } finally { clearTimeout(timer); }
}
async function peerProbe() {
  const now = Math.floor(Date.now() / 1000);
  const payload = { v: 3, kind: 'probe', iss: SELF_REF, aud: PEER_REF, iat: now, exp: now + ENVELOPE_SECONDS, nonce: crypto.randomUUID() };
  const envelope = await signEnvelope(payload);
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const response = await fetch(PEER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'verify_probe', envelope }), cache: 'no-store', signal: ctrl.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true || data.verified_peer !== SELF_REF) throw new ApiError(503, '備援簽章交握失敗', 'PEER_PROBE_FAILED');
    return { ok: true, peer_ref: PEER_REF, peer_verified: true };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, '備援簽章交握失敗', 'PEER_PROBE_FAILED');
  } finally { clearTimeout(timer); }
}
async function health() {
  await assertSigningKey();
  return { ok: true, protocol: 'replica-v3', project_ref: SELF_REF, peer_ref: PEER_REF, role: IS_PRIMARY ? 'primary' : 'standby', alg: 'Ed25519', kid: PINNED_KEYS[SELF_REF]?.kid || '', seed_direction: 'primary-to-standby', failback: 'manual-reconcile' };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED_ORIGINS.has(origin)) return new Response('forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(origin, { error: 'ORIGIN_NOT_ALLOWED' }, 403);
  try {
    if (req.method === 'GET') return json(origin, await health());
    if (req.method !== 'POST') return json(origin, { error: 'METHOD_NOT_ALLOWED' }, 405);
    await assertSigningKey();
    const body = await readJson(req), action = String(body.action || '');
    if (action === 'health') return json(origin, await health());
    if (action === 'peer_probe') return json(origin, await peerProbe());
    if (action === 'verify_probe') {
      const payload = await verifyPeerEnvelope(String(body.envelope || ''), 'probe');
      return json(origin, { ok: true, project_ref: SELF_REF, verified_peer: payload.iss, protocol: 'replica-v3' });
    }
    if (action === 'ingest') {
      const payload = await verifyPeerEnvelope(String(body.envelope || ''), 'core-seed');
      await consumeNonce(payload);
      const result = await applyPrimaryBundleOnStandby(payload);
      return json(origin, { ok: true, peer_synced: true, project_ref: SELF_REF, peer_token: result.peer_token });
    }
    if (action === 'sync' || action === 'sync_and_prewarm') {
      const result = await syncPrimaryToStandby(req);
      return json(origin, { ok: true, peer_synced: true, project_ref: SELF_REF, peer_ref: result.peer_ref, peer_token: result.peer_token });
    }
    return json(origin, { error: 'UNKNOWN_ACTION' }, 400);
  } catch (error) {
    if (error instanceof ApiError) return json(origin, { error: error.code, message: error.message, project_ref: SELF_REF }, error.status);
    console.error('replica-v3 unhandled error');
    return json(origin, { error: 'SERVER_ERROR', message: '備援同步服務暫時無法使用', project_ref: SELF_REF }, 503);
  }
});
