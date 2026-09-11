import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
const PRIMARY_REF = 'hrrmkrayvrgnwcroyttp';
const SELF_REF = new URL(SUPABASE_URL).hostname.split('.')[0] || '';
const encoder = new TextEncoder();
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = 'BAD_REQUEST') { super(message); this.status = status; this.code = code; }
}
function equalBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
}
async function requireWorker(req: Request) {
  if (SELF_REF !== PRIMARY_REF) throw new ApiError(503, 'primary worker only', 'PRIMARY_ONLY');
  if (req.headers.get('origin')) throw new ApiError(403, 'browser origin not allowed', 'BROWSER_ORIGIN_NOT_ALLOWED');
  const supplied = req.headers.get('x-nolu-worker-token') || '';
  if (!supplied) throw new ApiError(401, 'worker token required', 'UNAUTHORIZED');
  const { data, error } = await db.from('puplan_replication_worker_secret').select('token').eq('id', 1).maybeSingle();
  if (error || !data?.token) throw new ApiError(503, 'worker token unavailable', 'WORKER_TOKEN_UNAVAILABLE');
  if (!equalBytes(encoder.encode(String(data.token)), encoder.encode(supplied))) throw new ApiError(401, 'worker token invalid', 'UNAUTHORIZED');
}

Deno.serve(async (req: Request) => {
  try {
    if (req.method === 'GET') return json({ ok: true, service: 'nolu-replica-worker-v1', role: SELF_REF === PRIMARY_REF ? 'primary' : 'invalid', mode: 'sql-sweep' });
    if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    await requireWorker(req);
    const { data, error } = await db.rpc('puplan_sweep_replication');
    if (error) throw new ApiError(503, 'replication sweep failed', 'SWEEP_FAILED');
    return json({ ok: true, result: data });
  } catch (error) {
    if (error instanceof ApiError) return json({ error: error.code, message: error.message }, error.status);
    console.error('replication worker failed');
    return json({ error: 'SERVER_ERROR', message: 'replication worker failed' }, 503);
  }
});
