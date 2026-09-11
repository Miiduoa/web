// Retired experimental standby social-core endpoint.
// The supported browser routes are pu-plan-api-v8 and pu-plan-social; keeping an
// additional write-capable compatibility surface would only widen the attack
// surface and create another session-validation implementation to maintain.
Deno.serve((_req: Request) => new Response(
  JSON.stringify({ error: 'DISABLED', message: 'Retired nolu standby social core endpoint' }),
  {
    status: 410,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  },
));
