// Public, non-secret endpoints only. Authentication is carried with Nolu's
// portable ES256 session token; never put database credentials in this file.
//
// Provider identity is a failure-domain label, not a hostname. Multiple Supabase
// projects still count as ONE provider because a provider-wide incident can affect
// them together. The production target is at least three independent remote
// providers, plus IndexedDB on the user's device as an additional durable local copy.
//
// A candidate MUST stay disabled until its storage plane, authenticated read/write
// path, health check, and recovery semantics have all been verified live.

export const PROVIDER_MESH_VERSION='20260911-mesh5';
export const REQUIRED_REMOTE_PROVIDERS=3;
export const MIRROR_READ_QUORUM=2;

export const PORTABLE_MINT_ENDPOINTS=Object.freeze([
  'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-portable-v2',
  'https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-portable-v2'
]);

export const PROVIDER_MIRRORS=Object.freeze([
  Object.freeze({
    id:'neon-singapore',
    provider:'neon',
    kind:'postgrest',
    endpoint:'https://ep-delicate-frost-b3q46ijf.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1',
    enabled:true
  }),
  // Render service is deployed, but it remains excluded from quorum until its
  // independent Render Postgres DATABASE_URL is safely bound and live R/W passes.
  Object.freeze({
    id:'render-singapore',
    provider:'render',
    kind:'action-api',
    endpoint:'https://nolu-render-mirror.onrender.com/mirror',
    enabled:false
  }),
  // Railway remains an optional additional failure domain after the production
  // three-provider target is satisfied.
  Object.freeze({id:'railway-mirror',provider:'railway',kind:'action-api',endpoint:'',enabled:false}),
  // Netlify Blobs passed authenticated production write/read, unauthenticated
  // rejection, and storage health checks with the rotated portable ES256 token.
  Object.freeze({
    id:'netlify-blobs',
    provider:'netlify',
    kind:'action-api',
    endpoint:'https://nolu-mirror.netlify.app/mirror',
    enabled:true
  })
]);
