import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { ed25519 } from 'npm:@noble/curves@1.8.2/ed25519';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const PRIMARY_REF = 'hrrmkrayvrgnwcroyttp';
const STANDBY_REF = 'ltfurqaspqsvswmebyzw';
const SELF_REF = new URL(SUPABASE_URL).hostname.split('.')[0] || '';
const PRIMARY_PUBLIC_KEY = 'dLZNjauIfxSs6xKq_9DVsvbPUiinh0IOZs18ht9USbk';
const MAX_BODY_BYTES = 800000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'BAD_REQUEST') { super(message); this.status = status; this.code = code; }
}
function fromB64url(value: string) {
  let n = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  while (n.length % 4) n += '=';
  const raw = atob(n); const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function readJson(req: Request) {
  const declared = Number(req.headers.get('content-length') || 0);
  if (declared > MAX_BODY_BYTES) throw new ApiError(413, 'payload too large', 'PAYLOAD_TOO_LARGE');
  const text = await req.text();
  if (encoder.encode(text).byteLength > MAX_BODY_BYTES) throw new ApiError(413, 'payload too large', 'PAYLOAD_TOO_LARGE');
  try { return JSON.parse(text || '{}') as Record<string, any>; }
  catch { throw new ApiError(400, 'invalid json', 'INVALID_JSON'); }
}
async function verifyEnvelope(raw: string) {
  if (SELF_REF !== STANDBY_REF) throw new ApiError(503, 'standby ingest only', 'STANDBY_ONLY');
  const [p, s, ...extra] = String(raw || '').split('.');
  if (!p || !s || extra.length) throw new ApiError(401, 'invalid replica signature', 'REPLICA_SIGNATURE_INVALID');
  let verified = false;
  try { verified = ed25519.verify(fromB64url(s), encoder.encode(p), fromB64url(PRIMARY_PUBLIC_KEY)); } catch { verified = false; }
  if (!verified) throw new ApiError(401, 'invalid replica signature', 'REPLICA_SIGNATURE_INVALID');
  let payload: any;
  try { payload = JSON.parse(decoder.decode(fromB64url(p))); }
  catch { throw new ApiError(400, 'invalid replica payload', 'REPLICA_PAYLOAD_INVALID'); }
  const now = Date.now();
  const iat = Date.parse(String(payload.iat || ''));
  const exp = Date.parse(String(payload.exp || ''));
  const revision = Number(payload.revision);
  if (payload?.v !== 2 || payload.iss !== PRIMARY_REF || payload.aud !== STANDBY_REF ||
      !['core-seed', 'core-delete'].includes(String(payload.kind || '')) || !UUID.test(String(payload.uid || '')) ||
      !UUID.test(String(payload.nonce || '')) || !Number.isSafeInteger(revision) || revision <= 0 ||
      !Number.isFinite(iat) || !Number.isFinite(exp) || exp <= now || iat > now + 30000 || exp - iat > 180000 || now - iat > 180000) {
    throw new ApiError(401, 'replica envelope expired or invalid', 'REPLICA_ENVELOPE_INVALID');
  }
  return payload;
}
async function consumeNonce(payload: any) {
  await db.from('puplan_replica_server_nonces').delete().lt('expires_at', new Date(Date.now() - 300000).toISOString());
  const { error } = await db.from('puplan_replica_server_nonces').insert({ nonce: payload.nonce, issuer: payload.iss, expires_at: payload.exp });
  if (error?.code === '23505') throw new ApiError(409, 'duplicate replica request', 'REPLICA_REPLAY');
  if (error) throw new ApiError(503, 'replica nonce store unavailable', 'REPLICA_NONCE_UNAVAILABLE');
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'GET') return json({ ok: true, service: 'nolu-replica-ingest-v3', protocol: 2, role: SELF_REF === STANDBY_REF ? 'standby' : 'invalid' });
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (req.headers.get('origin')) return json({ error: 'BROWSER_ORIGIN_NOT_ALLOWED' }, 403);
    const body = await readJson(req);
    const payload = await verifyEnvelope(String(body.envelope || ''));
    await consumeNonce(payload);
    const { data, error } = await db.rpc('puplan_apply_server_replica', { p_payload: payload });
    if (error) throw new ApiError(503, 'standby apply failed', 'STANDBY_APPLY_FAILED');
    let media:any={ok:true,count:0,skipped:true};
    if(payload.kind==='core-seed'&&data?.ignored!==true){
      const applied=await db.rpc('puplan_apply_replica_media',{p_payload:payload});
      if(applied.error)throw new ApiError(503,'standby media metadata apply failed','STANDBY_MEDIA_APPLY_FAILED');
      media=applied.data;
    }
    return json({ ok: true, result: data, media });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code, message: error.message }, error.status);
    console.error('replica ingest v3 failed');
    return json({ error: 'SERVER_ERROR', message: 'replica ingest failed' }, 503);
  }
});
