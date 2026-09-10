# API Token Registry

## Purpose & Scope

Workspace-scoped programmatic-access tokens for the REST and MCP surface. Tokens are stored as SHA-256 hashes; the plaintext is shown once by `create` and never persisted.

## Entry Points & Contracts

- Creation admission belongs to [Resource entitlements](../../../billing/src/resource-entitlements.AGENTS.md); token writes and audits stay here. Published projections must never carry plaintext.
- `revoke` files `api_token_revoked` security evidence from both adapters and stamps `revokedAt`. Its where clause carries `workspaceId` and `isNull(revokedAt)`, so a double or cross-workspace revoke resolves `false` and emits no audit event and no webhook.
- `verifyBearerToken` authenticates only: it reports the token's scopes and `requirePermission` decides. It fails `AuthorizationDenied` with `reason: 'invalid_token'`, this layer's single authorization-shaped failure, which `apps/api` answers as 401.
- Bearer verification stays read-mostly and emits no audit event; preserve the throttle on `lastUsedAt` writes.
- `replace` requires `apiToken:create` at the boundary. The shared policy preserves workspace, scope subset, and expiry; overlap is 0–86,400 seconds. D1 claims the source, inserts the replacement, and audits in one batch. Its mandatory workspace subquery makes a lost concurrent claim roll back. See ADR 0026 before changing this write.
- `expiresAt <= now` fails bearer verification. Replaced parents remain usable only until their shortened expiry and cannot be replaced again.
- `ApiTokenScope` is closed: widening it means a literal here plus a column constraint in the same migration.

## Patterns & Pitfalls

- Seed stores hashes for fixture and newly issued credentials. `seedApiTokenValue` in the fixture resolves the two documented credentials by ID; `scripts/seed.ts` uses the same mapping and scopes. Verification reads revocation and expiry on every call.

## Anti-patterns

- No `tokenHash` on any returned DTO.
- Not for Better Auth session tokens; those are a different principal in Better Auth's own tables.
