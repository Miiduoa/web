// Public, non-secret endpoints only. Authentication is carried with Nolu's
// portable ES256 session token; never put database credentials in this file.
//
// Provider identity is a failure-domain label, not a hostname. Multiple Supabase
// projects still count as ONE provider because a provider-wide incident can affect
// them together. The target topology is:
//   1. Supabase (existing primary + Tokyo standby)
//   2. Neon Singapore (independent Postgres/Data API mirror)
//   3. Render (independent service + Postgres mirror)
// plus IndexedDB on the user's device as a fourth durable local copy.

export const PROVIDER_MESH_VERSION='20260911-mesh2';
export const REQUIRED_REMOTE_PROVIDERS=3;
export const MIRROR_READ_QUORUM=2;

export const PORTABLE_MINT_ENDPOINTS=Object.freeze([
  'https://hrrmkrayvrgnwcroyttp.supabase.co/functions/v1/pu-plan-portable-v1',
  'https://ltfurqaspqsvswmebyzw.supabase.co/functions/v1/pu-plan-portable-v1'
]);

export const PROVIDER_MIRRORS=Object.freeze([
  Object.freeze({
    id:'neon-singapore',
    provider:'neon',
    kind:'postgrest',
    endpoint:'https://ep-delicate-frost-b3q46ijf.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1',
    enabled:true
  }),
  // Render remains disabled until its independent account/service connection is
  // authorized. It will use the same portable public-key token, never a browser DB secret.
  Object.freeze({id:'render-mirror',provider:'render',kind:'action-api',endpoint:'',enabled:false})
]);
