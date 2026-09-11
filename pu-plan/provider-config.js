// Public, non-secret endpoints only. Authentication for independent mirrors must
// use a portable session whose signing key is secret-managed and whose credential
// version is revalidated at mint time. Until that design is deployed and rotated,
// every remote provider that depends on portable auth stays fail-closed.
//
// Provider identity is a failure-domain label, not a hostname. Multiple Supabase
// projects still count as ONE provider because a provider-wide incident can affect
// them together. The production target remains at least three independent remote
// providers, plus IndexedDB on the user's device as an additional durable local copy.
//
// A candidate MUST stay disabled until its storage plane, authenticated read/write
// path, health check, recovery semantics, key management, and revocation semantics
// have all been verified live.

export const PROVIDER_MESH_VERSION='20260911-mesh3-safehold1';
export const REQUIRED_REMOTE_PROVIDERS=3;
export const MIRROR_READ_QUORUM=2;

// Safehold: both Supabase mint endpoints intentionally return HTTP 410. Do not
// repopulate this list until the portable signing key has been rotated into secret
// storage and minting verifies the user's current credential version server-side.
export const PORTABLE_MINT_ENDPOINTS=Object.freeze([]);

export const PROVIDER_MIRRORS=Object.freeze([
  Object.freeze({
    id:'neon-singapore',
    provider:'neon',
    kind:'postgrest',
    endpoint:'https://ep-delicate-frost-b3q46ijf.apirest.c-4.ap-southeast-1.aws.neon.tech/neondb/rest/v1',
    enabled:false
  }),
  Object.freeze({
    id:'render-singapore',
    provider:'render',
    kind:'action-api',
    endpoint:'https://nolu-render-mirror.onrender.com/mirror',
    enabled:false
  }),
  Object.freeze({id:'railway-mirror',provider:'railway',kind:'action-api',endpoint:'',enabled:false}),
  Object.freeze({
    id:'netlify-blobs',
    provider:'netlify',
    kind:'action-api',
    endpoint:'https://nolu-mirror.netlify.app/mirror',
    enabled:false
  })
]);
