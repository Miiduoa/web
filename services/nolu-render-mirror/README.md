# Nolu Render mirror

This is an independent Node action API for Nolu, not the Gugu ordering service or the campus-ai-server service. Its public hostname is `https://nolu-render-mirror.onrender.com`.

## Deployment

| Setting | Value |
| --- | --- |
| Workspace | My Workspace (`tea-d0c6nf95pdvs73dajb4g`) |
| Service | `srv-db4uuc3bc2fs73dn8u6g` |
| Repository | `https://github.com/Miiduoa/web` |
| Branch | `main` |
| Runtime / region / plan | Node 22 / Singapore / free |
| Root directory | Empty (repository root) |
| Build | `cd services/nolu-render-mirror && npm install --omit=dev` |
| Start | `node services/nolu-render-mirror/server.mjs` |
| Automatic deploy | On commit |
| Port | Listen on `0.0.0.0`, use Render's `PORT` (default 10000) |
| Platform liveness | Default TCP check while storage is unconfigured |

The root `render.yaml` records these settings. Committing the file does not itself attach the service to a Blueprint; an operator must explicitly import/sync it to manage the service that way. Check the service ID before applying it. Do not create a second service under another project.

Public environment settings: `NODE_VERSION=22`, `NODE_ENV=production`, `NOLU_PROVIDER_ID=render`, `NOLU_STORAGE_LABEL=render-postgres`, `NOLU_JWKS_URL=https://miiduoa.github.io/web/nolu-mesh-jwks.json`.

### Storage is a separate prerequisite

`DATABASE_URL` is deliberately not stored in Git. Bind it in this service's Render Environment page to the internal connection string of a dedicated, persistent Render PostgreSQL database in the same region/workspace. Use a database/role with permission to create and access `public.nolu_snapshots` and its index. Do not borrow another application's database and do not relabel the primary Supabase database as an independent Render replica.

No database was provisioned as part of the 2026-10-10 endpoint repair. No paid plan was enabled. Render free PostgreSQL expires after 30 days, so it is not a permanent backup solution; choose the database lifecycle explicitly rather than silently creating another expiring copy.

After the secret is bound, deploy the environment update. `/health` must return **200**, `ok:true`, `configured:true`, `status:"available"`. Only then can `/health` be used as an HTTP platform readiness probe. Leaving the TCP liveness check in place never makes storage ready: the application health response and live smoke still decide that separately.

Before setting the Render entry in `pu-plan/provider-config.js` to `enabled:true`, also verify authenticated production write/read, two-account ownership isolation, digest/revision checks, and recovery quorum semantics. It remains `enabled:false` until all of these pass. CI's isolated database test is not a replacement for production storage acceptance.

## Verification

- `.github/workflows/nolu-render-live-smoke.yml` checks the **public** endpoint. Keep its source, unauthenticated, forged/retired-token, origin, preflight and method checks intact. HTTP 404 at `/health` always fails. HTTP 503 passes the boundary contract only for the existing precise `unconfigured` state; a configured-but-unavailable store fails.
- `.github/workflows/nolu-render-storage-isolation.yml` runs the actual server against disposable loopback PostgreSQL with ephemeral ES256 identities. It checks positive and negative authorization, two users' reads and writes, owner mismatch, digest validation and revision conflicts. It cannot access production: the test refuses any non-loopback URL or database name other than `nolu_mirror_ci`.
- Primary Supabase availability belongs to `.github/workflows/nolu-primary-data-api-health.yml`, not the Render check.

Manual read-only checks:

```sh
BASE=https://nolu-render-mirror.onrender.com
curl --max-time 90 -i "$BASE/health"
curl --max-time 30 -i -X POST "$BASE/mirror" \
  -H 'Origin: https://miiduoa.github.io' \
  -H 'Content-Type: application/json' \
  --data '{"action":"get_snapshot"}'
```

The second command must return 401 `UNAUTHORIZED`. Opening `/mirror` with GET must return the application's JSON 404; this is intentional and different from the platform's plain-text `Not Found`.

## 2026-10-10 deployment incident

At diagnosis, the connected workspace inventory contained neither the Nolu mirror service nor a PostgreSQL instance. The failed public run returned plain-text `Not Found` at `/health`, although main already implemented that route. The root cause that could be established was a missing public service binding/deployment, not a missing application route and not the earlier Supabase Data API outage. No deletion audit was available, so who removed the old resource, when, or why is not established.

The dedicated free service was recreated at the original hostname, using the **unchanged** main runtime at commit `a8e6804ef971de9eb68074a4499924c823fab733`. Deploy `dep-db4uucrbc2fs73dn9210` became live at 2026-10-10 07:54:57 UTC.

The original public smoke was rerun without changing any assertion: run `38029438719`, attempt 2, job `114166753516`. At 07:55:49 UTC it returned the correct JSON 503 (`configured:false`, `status:"unconfigured"`); all public authentication/CORS denial checks passed. This restores the endpoint and security boundary, **not** a usable production database mirror.

The primary Supabase health job was independently rerun: run `38018101183`, attempt 2, job `114166715327`. Its zero-row public catalog query returned HTTP 200 at 07:55:35 UTC. No Supabase configuration, schema, or user data was changed.

References: [Render health checks](https://render.com/docs/health-checks), [free instance limits](https://render.com/docs/free), [Blueprint specification](https://render.com/docs/blueprint-spec).
