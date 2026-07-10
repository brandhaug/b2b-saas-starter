# Platform API Token Registry

Merchant-scoped server credentials for Platform API v1, separate from the legacy Workspace registry.

## Invariants

- The six `PLATFORM_API_TOKEN_SCOPES` values are the complete vocabulary.
- Persist hashes and safe metadata only; plaintext is returned once by create/bootstrap.
- Bootstrap requires password proof no older than 15 minutes and an empty Merchant registry.
- Delegation is limited to the caller's Merchant and held scopes.
- Status precedence is revoked, expired, active; expiration performs no write or audit.
- Unknown, malformed, expired, and revoked credentials are indistinguishable.
- Effective create/revoke operations emit secret-free audits; no-op revoke emits nothing.
- Seed and Live adapters implement the same lifecycle semantics.

Storage: `platformApiTokens`. API boundary: `/v1/api-tokens`. Better Auth sessions and customer capabilities are never Platform API credentials.
