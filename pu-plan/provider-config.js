// Public, non-secret endpoints only. Authentication is carried with Nolu's
// portable signed session token; never put database credentials in this file.
//
// Provider identity is a failure-domain label, not a hostname. Multiple Supabase
// projects still count as ONE provider because a provider-wide incident can affect
// them together. The target topology is:
//   1. Supabase (existing primary + Tokyo standby)
//   2. Neon (independent Postgres/data API mirror)
//   3. Render (independent service + Postgres mirror)
// plus IndexedDB on the user's device as a fourth durable local copy.

export const PROVIDER_MESH_VERSION='20260911-mesh1';
export const REQUIRED_REMOTE_PROVIDERS=3;
export const MIRROR_READ_QUORUM=2;

// These are intentionally disabled until their independent backends are
// provisioned. Keeping them in source makes the failure domains explicit while
// preventing the browser from sending account snapshots to an unverified URL.
export const PROVIDER_MIRRORS=Object.freeze([
  Object.freeze({id:'neon-mirror',provider:'neon',endpoint:'',enabled:false}),
  Object.freeze({id:'render-mirror',provider:'render',endpoint:'',enabled:false})
]);
