# pu-plan-replica-v3

`pu-plan-replica-v3` is the hardened cross-region seed protocol for Nolu core data.

Security model:
- Mumbai and Tokyo keep independent Session-v4 HMAC keys; browser regional sessions are never interchangeable.
- Each replica endpoint derives an Ed25519 signing seed at runtime from that project's own `SUPABASE_SERVICE_ROLE_KEY` and a fixed domain separator. No cross-region private signing key is stored in this repository or sent to the browser.
- Only pinned peer **public** Ed25519 keys are accepted. A local service-role rotation that changes the derived key fails closed until the public key pin is deliberately rotated.
- Envelopes bind version, kind, issuer, audience, UUID nonce, issuance time and expiry. Database-backed nonce consumption rejects replayed seed envelopes.
- Automatic authority flows only from the Mumbai primary to the Tokyo standby. Tokyo may receive a complete authenticated core seed and issue its own local Session-v4 token; it does not automatically create or overwrite identities in Mumbai.
- Core seed scope is account/profile verifier material, schedule and semesters. Password verifier material is server-to-server only and is never returned to browser JavaScript.
- Failback is intentionally manual/reconciled until a conflict-safe protocol can preserve primary credential authority.

Live deployment currently exists in both Supabase projects as `pu-plan-replica-v3`. The browser replication client now uses v3 for Mumbai-to-Tokyo standby enrollment and prewarming. Reverse Tokyo-to-Mumbai replication remains intentionally disabled and fails closed until conflict-safe reconciliation is implemented.
