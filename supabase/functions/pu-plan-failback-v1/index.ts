import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';
import {
  assertCredentialCurrent,
  SessionError,
  verifySignedSessionV4,
} from '../_shared/session-v4.ts';

const URL = Deno.env.get('SUPABASE_URL') || '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const SELF = 'ltfurqaspqsvswmebyzw';
const PRIMARY = 'hrrmkrayvrgnwcroyttp';
const PRIMARY_INGEST = `https://${PRIMARY}.supabase.co/functions/v1/pu-plan-failback-ingest-v1`;
const DOMAIN = 'nolu-failback-ed25519-v1-20260911';
const enc = new TextEncoder();
const ALLOWED = new Set([
  'https://miiduoa.github.io',
  'https://nolu.tw',
  'https://www.nolu.tw',
  'https://nolu-8r2.pages.dev',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function b64(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function sessionError(error: unknown) {
  if (error instanceof SessionError) return new ApiError(401, error.message, error.code);
  return new ApiError(401, '登入狀態無效，請重新登入', 'UNAUTHORIZED');
}

async function requireUser(req: Request) {
  const auth = req.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) throw new ApiError(401, '缺少備援登入狀態', 'UNAUTHORIZED');
  let session;
  try {
    session = await verifySignedSessionV4(auth.slice(7), KEY);
  } catch (error) {
    throw sessionError(error);
  }
  const { data, error } = await db.from('puplan_app_users')
    .select('id,password_salt')
    .eq('id', session.uid)
    .maybeSingle();
  if (error) throw error;
  if (!data?.id || !data.password_salt) throw new ApiError(401, '找不到帳號', 'UNAUTHORIZED');
  try {
    await assertCredentialCurrent(session, data.password_salt);
  } catch (error) {
    throw sessionError(error);
  }
  return String(data.id);
}

async function rateLimit(req: Request, uid: string) {
  const ip = (req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown')
    .split(',')[0].trim();
  const material = `failback:${uid}:${ip}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(material)));
  const rateKey = b64(digest);
  const since = new Date(Date.now() - 5 * 60_000).toISOString();
  const { count, error } = await db.from('puplan_app_rate_limits')
    .select('id', { count: 'exact', head: true })
    .eq('rate_key', rateKey)
    .eq('action', 'failback')
    .gte('created_at', since);
  if (error) throw error;
  if ((count || 0) >= 8) throw new ApiError(429, '備援回灌操作太頻繁，請稍後再試', 'RATE_LIMITED');
  const inserted = await db.from('puplan_app_rate_limits').insert({ rate_key: rateKey, action: 'failback' });
  if (inserted.error) throw inserted.error;
}

async function signingSeed() {
  if (!KEY || !URL.includes(SELF)) throw new ApiError(503, 'signing unavailable', 'FAILBACK_UNAVAILABLE');
  return new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(`${DOMAIN}:${KEY}`)));
}

async function publicKey() {
  return b64(ed25519.getPublicKey(await signingSeed()));
}

function headers(origin = '') {
  const h: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  };
  if (ALLOWED.has(origin)) h['Access-Control-Allow-Origin'] = origin;
  return h;
}

function json(origin: string, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: headers(origin) });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (req.method === 'OPTIONS') {
    if (origin && !ALLOWED.has(origin)) return new Response('forbidden', { status: 403 });
    return new Response(null, { status: 204, headers: headers(origin) });
  }
  if (req.method === 'GET') {
    try {
      return json(origin, 200, { ok: true, service: 'pu-plan-failback-v1', protocol: 2, role: 'standby', public_key: await publicKey() });
    } catch {
      return json(origin, 503, { error: 'FAILBACK_UNAVAILABLE', message: '備援回灌暫時無法使用' });
    }
  }
  if (req.method !== 'POST') return json(origin, 405, { error: 'METHOD_NOT_ALLOWED' });
  if (origin && !ALLOWED.has(origin)) return json(origin, 403, { error: 'ORIGIN_NOT_ALLOWED' });

  try {
    const uid = await requireUser(req);
    await rateLimit(req, uid);
    const dirty = await db.rpc('puplan_get_standby_dirty_generation', { p_uid: uid });
    if (dirty.error) throw new ApiError(503, '無法讀取備援寫入保護狀態', 'FAILBACK_UNAVAILABLE');
    const dirtyGeneration = Math.max(0, Number(dirty.data || 0));
    const { data, error } = await db.rpc('puplan_build_failback_snapshot', { p_uid: uid });
    if (error || !data) throw new ApiError(503, '無法建立備援快照', 'FAILBACK_UNAVAILABLE');

    const payload = JSON.stringify(data);
    const encoded = b64(enc.encode(payload));
    const signature = b64(ed25519.sign(enc.encode(encoded), await signingSeed()));
    const envelope = `${encoded}.${signature}`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12_000);
    try {
      const res = await fetch(PRIMARY_INGEST, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ envelope }),
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const out = await res.json().catch(() => ({}));
      if (res.status === 409) {
        return json(origin, 409, { error: 'FAILBACK_CONFLICT', message: out.message || '主雲端已有較新的資料，暫不自動覆寫', conflict: true });
      }
      if (!res.ok || out.ok !== true) {
        return json(origin, res.status >= 500 ? 503 : res.status, { error: out.error || 'FAILBACK_FAILED', message: out.message || '主雲端回灌失敗' });
      }
      const cleared = await db.rpc('puplan_clear_standby_dirty_user', { p_uid: uid, p_expected_generation: dirtyGeneration });
      if (cleared.error) {
        return json(origin, 503, { error: 'FAILBACK_FENCE_CLEAR_FAILED', message: '主雲端已接收資料，但備援寫入保護尚未解除', primary_applied: true });
      }
      if (cleared.data !== true) {
        return json(origin, 409, { error: 'FAILBACK_STANDBY_CHANGED', message: '回灌期間偵測到新的備援寫入，保護狀態維持，請再同步一次', conflict: true, primary_applied: true });
      }
      return json(origin, 200, { ok: true, reconciled: true, uid, primary_applied: true, dirty_generation: dirtyGeneration, protocol: 2 });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new ApiError(503, '主雲端回灌逾時', 'FAILBACK_UNAVAILABLE');
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    if (error instanceof ApiError) return json(origin, error.status, { error: error.code, message: error.message });
    console.error('failback failed');
    return json(origin, 503, { error: 'FAILBACK_UNAVAILABLE', message: '備援回灌暫時無法完成' });
  }
});
