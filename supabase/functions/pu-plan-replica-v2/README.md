# pu-plan-replica-v2

Production peer-replication runtime is deployed directly to the two Supabase projects and intentionally keeps its per-project private signing keys out of this public repository.

Protocol goals:
- authenticate the local browser with that project's existing Nolu session v4;
- export only the authenticated user's core account/profile/schedule/semester rows server-to-server;
- sign every replication envelope with a project-specific P-256 key;
- verify the peer project's public key before accepting a replication envelope;
- reject expired, replayed, cross-project, or credential-version-mismatched envelopes;
- seed the Tokyo standby with password verifier material without ever returning password hashes to the browser;
- return only a peer-local session token after the peer confirms matching credential version;
- on failback to Mumbai, accept profile/schedule/semester updates but never let the standby create a new primary identity or overwrite primary password/role authority.

The browser integration lives in `pu-plan/cloud-replication.js`. Runtime source should not be copied here with embedded private JWK material.
