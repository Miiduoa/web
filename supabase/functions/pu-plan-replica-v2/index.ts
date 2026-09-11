Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: 'DISABLED', message: 'Replica v2 retired after signing-key hardening; use replica v3 when enabled' }),
  {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  },
));
