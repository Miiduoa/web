import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PRIMARY_REF = 'hrrmkrayvrgnwcroyttp';
const STANDBY_REF = 'ltfurqaspqsvswmebyzw';
const SELF_REF = new URL(SUPABASE_URL).hostname.split('.')[0] || '';
const STANDBY_INGEST = `https://${STANDBY_REF}.supabase.co/functions/v1/pu-plan-replica-ingest-v3`;
const KEY_DOMAIN = 'nolu-replica-v3-signing-seed-20260911';
const PRIMARY_PUBLIC_KEY = 'dLZNjauIfxSs6xKq_9DVsvbPUiinh0IOZs18ht9USbk';
const MAX_BODY_BYTES = 800000;
const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'BAD_REQUEST') { super(message); this.status = status; this.code = code; }
}
function b64url(bytes: Uint8Array) {
  let raw = ''; for (const b of bytes) raw += String.fromCharCode(b);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function fromB64url(value: string) {
  let n = String(value || '').replace(/-/g, '+').replace(/_/g, '/'); while (n.length % 4) n += '=';
  const raw = atob(n), out = new Uint8Array(raw.length); for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i); return out;
}
function hexToBytes(value: string) {
  if (!/^[0-9a-f]+$/i.test(value) || value.length % 2) throw new ApiError(401, 'invalid auth encoding', 'UNAUTHORIZED');
  const out = new Uint8Array(value.length / 2); for (let i = 0; i < out.length; i++) out[i] = parseInt(value.slice(i * 2, i * 2 + 2), 16); return out;
}
function equalBytes(a: Uint8Array, b: Uint8Array) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }
function json(body: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }
async function readJson(req: Request) {
  const declared = Number(req.headers.get('content-length') || 0); if (declared > MAX_BODY_BYTES) throw new ApiError(413, 'payload too large', 'PAYLOAD_TOO_LARGE');
  const text = await req.text(); if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw new ApiError(413, 'payload too large', 'PAYLOAD_TOO_LARGE');
  try { const value = JSON.parse(text || '{}'); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid'); return value as Record<string, any>; }
  catch { throw new ApiError(400, 'invalid json', 'INVALID_JSON'); }
}
async function workerSecret() {
  const { data, error } = await db.from('puplan_replication_worker_secret').select('token').eq('id', 1).maybeSingle();
  if (error || !data?.token) throw new ApiError(503, 'worker secret unavailable', 'WORKER_SECRET_UNAVAILABLE');
  return String(data.token);
}
async function verifyDbAuth(payloadText: string, authHex: string) {
  const key = await crypto.subtle.importKey('raw', hexToBytes(await workerSecret()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const expected = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(payloadText)));
  if (!equalBytes(expected, hexToBytes(authHex))) throw new ApiError(401, 'database auth invalid', 'UNAUTHORIZED');
}
async function signingSeed() {
  if (SELF_REF !== PRIMARY_REF || !SERVICE_KEY) throw new ApiError(503, 'primary relay only', 'PRIMARY_ONLY');
  const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(`${KEY_DOMAIN}:${SERVICE_KEY}`)));
  if (!equalBytes(ed25519.getPublicKey(seed), fromB64url(PRIMARY_PUBLIC_KEY))) throw new ApiError(503, 'primary signing key mismatch', 'SIGNING_KEY_MISMATCH');
  return seed;
}
async function signPayload(payload: Record<string, any>) {
  const encoded = b64url(encoder.encode(JSON.stringify(payload)));
  return `${encoded}.${b64url(ed25519.sign(encoder.encode(encoded), await signingSeed()))}`;
}
function validatePayload(payload: Record<string, any>) {
  const now = Date.now(), iat = Date.parse(String(payload.iat || '')), exp = Date.parse(String(payload.exp || '')), revision = Number(payload.revision);
  if (payload.v !== 2 || payload.iss !== PRIMARY_REF || payload.aud !== STANDBY_REF || !['core-seed', 'core-delete'].includes(String(payload.kind || '')) || !UUID.test(String(payload.uid || '')) || !UUID.test(String(payload.nonce || '')) || !Number.isSafeInteger(revision) || revision <= 0 || !Number.isFinite(iat) || !Number.isFinite(exp) || exp <= now || iat > now + 30000 || exp - iat > 180000 || now - iat > 180000) throw new ApiError(400, 'invalid replication payload', 'REPLICA_PAYLOAD_INVALID');
  if (payload.kind === 'core-seed' && String(payload?.bundle?.user?.id || '') !== String(payload.uid)) throw new ApiError(400, 'bundle identity mismatch', 'REPLICA_DATA_INVALID');
}
async function forward(envelope: string) {
  const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const response = await fetch(STANDBY_INGEST, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ envelope }), cache: 'no-store', signal: ctrl.signal });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok !== true) throw new ApiError(response.status || 503, data.message || 'standby apply failed', data.error || 'PEER_SYNC_FAILED');
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, 'standby unavailable', 'PEER_UNAVAILABLE');
  } finally { clearTimeout(timer); }
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'GET') return json({ ok: true, service: 'nolu-replica-relay-v2', role: SELF_REF === PRIMARY_REF ? 'primary' : 'invalid' });
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (req.headers.get('origin')) return json({ error: 'BROWSER_ORIGIN_NOT_ALLOWED' }, 403);
    const body = await readJson(req), payloadText = String(body.payload || ''), auth = String(body.auth || '');
    if (!payloadText || !auth) throw new ApiError(401, 'database auth required', 'UNAUTHORIZED');
    await verifyDbAuth(payloadText, auth);
    let payload: Record<string, any>; try { payload = JSON.parse(payloadText); } catch { throw new ApiError(400, 'invalid replication payload', 'REPLICA_PAYLOAD_INVALID'); }
    validatePayload(payload);
    const result = await forward(await signPayload(payload));
    return json({ ok: true, result: result.result || result });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code, message: error.message }, error.status);
    console.error('replica relay failed');
    return json({ error: 'SERVER_ERROR', message: 'replica relay failed' }, 503);
  }
});
