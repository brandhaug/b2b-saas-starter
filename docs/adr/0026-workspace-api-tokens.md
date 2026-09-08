# Workspace API tokens

Workspace API tokens authenticate REST and MCP independently of browser sessions. Only hashes are stored; issuance and replacement return plaintext once. Lifecycle mutations are audited, while last-use tracking is throttled instead of writing a noisy audit event for every request. Verification reads current revocation, expiry, scopes, and resource entitlements.

Replacement preserves the workspace and can only narrow scopes and expiry. The old credential retires immediately or within a caller-selected overlap of at most 24 hours. D1 batches the guarded source update, successor insert, and audit; a lost claim rolls back instead of minting another credential. Replacement is non-idempotent and must not be automatically retried.

A replacement transfers the plan slot. Overlapping ancestors remain usable until their own deadlines but occupy no extra slot, and revoking one token does not revoke its relatives. Seed and Live enforce the same lifecycle and audit guarantees. Caller-grant checks prevent issuing permissions the caller does not hold.
