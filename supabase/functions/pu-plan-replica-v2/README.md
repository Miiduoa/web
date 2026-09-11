# pu-plan-replica-v2 — retired

`pu-plan-replica-v2` is retired and deployed as a fail-closed HTTP 410 `DISABLED` stub in both Supabase projects.

The v2 design is no longer permitted because the deployed implementation embedded project signing-key material in function source. No private key value is retained in this repository. Production must not route replication traffic to v2 and tests must keep the endpoint disabled.

Its replacement is `pu-plan-replica-v3`, which derives a project-local Ed25519 signing seed at runtime from that project's own `SUPABASE_SERVICE_ROLE_KEY`, pins only public peer keys in source, rejects malformed or expired envelopes, uses nonce replay protection, and currently allows automatic replication only from the Mumbai primary to the Tokyo standby.

Automatic Tokyo-to-Mumbai failback remains intentionally disabled until an explicit reconciliation/versioning protocol exists. Browser integration lives in `pu-plan/cloud-replication.js`.
