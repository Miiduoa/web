const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
// The app's largest legitimate request is an avatar update capped at 180 KB.
// Keep the public proxy comfortably below provider ingress buffering limits while
// leaving room for JSON framing and the rest of the profile payload.
const MAX_BODY_BYTES = 256_000;
const TARGETS = new Set([
  'pu-plan-api',
  'pu-plan-api-v6',
  'pu-plan-api-v8',
  'pu-plan-core-v1',
  'pu-plan-social',
  'pu-plan-admin',
  'pu-plan-portable-v2',
  'pu-plan-replica-v3',
  'pu-plan-sync-v1',
  'campus-member-profile',
]);
const EXACT_ORIGINS = new Set([
  'https://miiduoa.github.io',
  'https://nolu.tw',
  'https://www.nolu.tw',
  'https://nolu-8r2.pages.dev',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5500',
]);

function allowedOrigin(origin: string) {
  if (!origin) return true;
  if (EXACT_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && url.hostname.endsWith('.nolu-8r2.pages.dev')) return true;
    if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) return true;
  } catch {}
  return false;
}

function responseHeaders(origin: string) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, content-type, x-nolu-mesh-version, apikey, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  });
  if (origin && allowedOrigin(origin)) headers.set('Access-Control-Allow-Origin', origin);
  return headers;
}

function json(origin: string, status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: responseHeaders(origin) });
}

function clientAddress(req: Request) {
  const cloudflare = String(req.headers.get('cf-connecting-ip') || '').trim();
  if (cloudflare && cloudflare.length <= 64) return cloudflare;
  const real = String(req.headers.get('x-real-ip') || '').trim();
  if (real && real.length <= 64) return real;
  const forwarded = String(req.headers.get('x-forwarded-for') || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const candidate = forwarded.at(-1) || '';
  return candidate && candidate.length <= 64 ? candidate : '';
}

async function readBoundedBody(req: Request) {
  const declaredRaw = req.headers.get('content-length');
  if (declaredRaw) {
    const declared = Number(declaredRaw);
    if (!Number.isFinite(declared) || declared < 0) throw new Error('INVALID_CONTENT_LENGTH');
    if (declared > MAX_BODY_BYTES) throw new Error('PAYLOAD_TOO_LARGE');
  }
  if (!req.body) return new Uint8Array();
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel('payload too large').catch(() => {});
        throw new Error('PAYLOAD_TOO_LARGE');
      }
      chunks.push(value);
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  if (!allowedOrigin(origin)) return json(origin, 403, { error: 'ORIGIN_NOT_ALLOWED' });
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders(origin) });
  if (req.method !== 'GET' && req.method !== 'POST') return json(origin, 405, { error: 'METHOD_NOT_ALLOWED' });

  let requestUrl: URL;
  try { requestUrl = new URL(req.url); } catch { return json(origin, 400, { error: 'BAD_URL' }); }
  const target = String(requestUrl.searchParams.get('target') || '');
  if (!TARGETS.has(target)) return json(origin, 404, { error: 'TARGET_NOT_ALLOWED' });

  const upstream = new URL(`${SUPABASE_URL}/functions/v1/${target}`);
  for (const [key, value] of requestUrl.searchParams.entries()) {
    if (key !== 'target') upstream.searchParams.append(key, value);
  }

  const headers = new Headers();
  const authorization = req.headers.get('authorization');
  const contentType = req.headers.get('content-type');
  const meshVersion = req.headers.get('x-nolu-mesh-version');
  const address = clientAddress(req);
  if (authorization) headers.set('Authorization', authorization);
  if (contentType) headers.set('Content-Type', contentType);
  if (meshVersion) headers.set('X-Nolu-Mesh-Version', meshVersion);
  // Preserve the platform-observed browser address so downstream login throttling
  // remains per client instead of collapsing every request onto one gateway egress.
  // Browser-provided forwarding headers are never copied through verbatim.
  if (address) headers.set('X-Forwarded-For', address);
  headers.set('X-Nolu-Browser-Gateway', 'v3');

  let body: Uint8Array | undefined;
  if (req.method === 'POST') {
    try {
      body = await readBoundedBody(req);
    } catch (error) {
      if (String((error as Error)?.message || error) === 'PAYLOAD_TOO_LARGE') {
        return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });
      }
      return json(origin, 400, { error: 'INVALID_REQUEST_BODY' });
    }
  }

  try {
    const upstreamResponse = await fetch(upstream, {
      method: req.method,
      headers,
      body,
      cache: 'no-store',
      signal: AbortSignal.timeout(12_000),
    });
    const responseBody = await upstreamResponse.arrayBuffer();
    const outHeaders = responseHeaders(origin);
    const upstreamType = upstreamResponse.headers.get('content-type');
    if (upstreamType) outHeaders.set('Content-Type', upstreamType);
    const retryAfter = upstreamResponse.headers.get('retry-after');
    if (retryAfter) outHeaders.set('Retry-After', retryAfter);
    return new Response(responseBody, { status: upstreamResponse.status, headers: outHeaders });
  } catch (error) {
    console.error('gateway upstream failure', target, error);
    return json(origin, 503, { error: 'UPSTREAM_UNAVAILABLE', message: '雲端服務暫時無法連線' });
  }
});
