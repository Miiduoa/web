const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || '';
const MAX_BODY_BYTES = 512_000;
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
  if (authorization) headers.set('Authorization', authorization);
  if (contentType) headers.set('Content-Type', contentType);
  if (meshVersion) headers.set('X-Nolu-Mesh-Version', meshVersion);
  headers.set('X-Nolu-Browser-Gateway', 'v1');

  let body: Uint8Array | undefined;
  if (req.method === 'POST') {
    const declared = Number(req.headers.get('content-length') || 0);
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (bytes.byteLength > MAX_BODY_BYTES) return json(origin, 413, { error: 'PAYLOAD_TOO_LARGE' });
    body = bytes;
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
