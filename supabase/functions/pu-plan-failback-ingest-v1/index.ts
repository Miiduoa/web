import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';

const URL = Deno.env.get('SUPABASE_URL') || '';
const KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const STANDBY = 'ltfurqaspqsvswmebyzw';
const PRIMARY = 'hrrmkrayvrgnwcroyttp';
const STANDBY_PUBLIC_KEY = 'y8vSmYdAMI209EvhUa-mRgXk2U6MV4GJN5ksnrF_R0c';
const enc = new TextEncoder();
const dec = new TextDecoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY = 900_000;

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function unb64(value: string) {
  let n = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (n.length % 4) n += '=';
  const raw = atob(n);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

async function rejectOversized(req: Request) {
  try { await req.body?.cancel('payload too large'); } catch { /* noop */ }
  throw new ApiError(413, 'failback payload too large', 'PAYLOAD_TOO_LARGE');
}

async function readJson(req: Request) {
  const declaredRaw = req.headers.get('content-length');
  if (declaredRaw) {
    const declared = Number(declaredRaw);
    if (!Number.isFinite(declared) || declared < 0 || declared > MAX_BODY) {
      await rejectOversized(req);
    }
  }
  if (!req.body) return {};
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > MAX_BODY) {
      try { await reader.cancel('payload too large'); } catch { /* noop */ }
      throw new ApiError(413, 'failback payload too large', 'PAYLOAD_TOO_LARGE');
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
    const value = JSON.parse(dec.decode(bytes) || '{}');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError(400, 'invalid json', 'INVALID_JSON');
  }
}

function verifyEnvelopeShape(payload: any) {
  const now = Date.now();
  const iat = Date.parse(String(payload?.iat || ''));
  const exp = Date.parse(String(payload?.exp || ''));
  const base = Number(payload?.base_primary_revision);
  if (
    payload?.v !== 2 ||
    payload?.kind !== 'failback-snapshot' ||
    payload?.iss !== STANDBY ||
    payload?.aud !== PRIMARY ||
    !UUID.test(String(payload?.uid || '')) ||
    !UUID.test(String(payload?.nonce || '')) ||
    !Number.isSafeInteger(base) ||
    base < 0 ||
    !Number.isFinite(iat) ||
    !Number.isFinite(exp) ||
    exp <= now ||
    iat > now + 30_000 ||
    exp - iat > 180_000 ||
    now - iat > 180_000
  ) {
    throw new ApiError(400, 'invalid failback payload', 'FAILBACK_REJECTED');
  }
  if (!payload.bundle || typeof payload.bundle !== 'object' || Array.isArray(payload.bundle)) {
    throw new ApiError(400, 'invalid failback bundle', 'FAILBACK_REJECTED');
  }
  if (String(payload.bundle?.user?.id || '') !== String(payload.uid)) {
    throw new ApiError(400, 'failback identity mismatch', 'FAILBACK_REJECTED');
  }
  for (const key of [
    'semesters', 'friendships', 'meetups', 'posts', 'post_likes', 'post_media',
    'conversations', 'conversation_members', 'messages', 'feed_preferences', 'author_affinity',
  ]) {
    if (!Array.isArray(payload.bundle?.[key])) {
      throw new ApiError(400, `invalid failback bundle field: ${key}`, 'FAILBACK_REJECTED');
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'GET') return json(200, { ok: true, service: 'pu-plan-failback-ingest-v1', protocol: 2, role: 'primary' });
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' });
  if (req.headers.get('origin')) return json(403, { error: 'BROWSER_ORIGIN_NOT_ALLOWED' });

  try {
    const body = await readJson(req);
    const envelope = String(body.envelope || '');
    const [payloadPart, signaturePart, ...extra] = envelope.split('.');
    if (!payloadPart || !signaturePart || extra.length) {
      throw new ApiError(401, 'invalid failback envelope', 'FAILBACK_REJECTED');
    }

    let verified = false;
    try {
      verified = ed25519.verify(unb64(signaturePart), enc.encode(payloadPart), unb64(STANDBY_PUBLIC_KEY));
    } catch {
      verified = false;
    }
    if (!verified) throw new ApiError(401, 'invalid failback signature', 'FAILBACK_REJECTED');

    let payload: any;
    try {
      payload = JSON.parse(dec.decode(unb64(payloadPart)));
    } catch {
      throw new ApiError(400, 'invalid failback payload', 'FAILBACK_REJECTED');
    }
    verifyEnvelopeShape(payload);

    await db.from('puplan_failback_nonces').delete().lt('expires_at', new Date().toISOString());
    const replay = await db.from('puplan_failback_nonces').insert({
      nonce: String(payload.nonce),
      expires_at: new Date(String(payload.exp)).toISOString(),
    });
    if (replay.error) {
      if (replay.error.code === '23505') throw new ApiError(409, 'failback envelope already used', 'FAILBACK_REPLAY');
      throw new ApiError(503, 'failback replay protection unavailable', 'FAILBACK_UNAVAILABLE');
    }

    const { data, error } = await db.rpc('puplan_apply_failback_snapshot', { p_payload: payload });
    if (error) throw new ApiError(503, 'failback apply failed', 'FAILBACK_UNAVAILABLE');
    if (data?.conflict === true || data?.ok === false) {
      return json(409, {
        error: 'FAILBACK_CONFLICT',
        message: '主雲端已有較新的資料，已停止自動覆寫',
        conflict: true,
        base_primary_revision: data?.base_primary_revision,
        current_primary_revision: data?.current_primary_revision,
      });
    }
    return json(200, { ok: true, result: data });
  } catch (error) {
    if (error instanceof ApiError) return json(error.status, { error: error.code, message: error.message });
    console.error('failback ingest failed');
    return json(503, { error: 'FAILBACK_UNAVAILABLE', message: '備援回灌暫時無法完成' });
  }
});
