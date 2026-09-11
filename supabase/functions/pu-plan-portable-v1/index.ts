Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: 'DISABLED', message: 'Portable provider authentication is temporarily disabled' }),
  {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  },
));
