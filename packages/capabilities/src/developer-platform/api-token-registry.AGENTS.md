# API Token Registry

## Purpose & Scope

Workspace-scoped programmatic-access tokens for the REST and MCP surface. Tokens are stored as SHA-256 hashes; the plaintext is shown once by `create` and never persisted.

## Entry Points & Contracts

- `create` gates on the plan's token ceiling with `assertWithinPlanLimit` (billing owns the rule), audits `api_token.created`, and fans out a best-effort webhook projection that must never carry the plaintext.
- `revoke` stamps `revokedAt`. Its where clause carries `workspaceId` and `isNull(revokedAt)`, so a double or cross-workspace revoke resolves `false` and emits no audit event and no webhook.
- `verifyBearerToken` authenticates only: it reports the token's scopes and `requirePermission` decides. It fails `AuthorizationDenied` with `reason: 'invalid_token'`, this layer's single authorization-shaped failure, which `apps/api` answers as 401.
- `verifyBearerToken` bumps `lastUsedAt` at most once per `LAST_USED_WRITE_INTERVAL_MS`, decided by the pure `shouldBumpLastUsedAt`. It emits no audit event; the per-request `api_token.used` event was dropped for flooding the log.
- `replace` requires `apiToken:create` at the boundary. The shared policy preserves workspace, scope subset, and expiry; overlap is 0–86,400 seconds. D1 claims the source, inserts the replacement, and audits in one batch. Its mandatory workspace subquery makes a lost concurrent claim roll back. See ADR 0026 before changing this write.
- `expiresAt <= now` fails bearer verification. Replaced parents remain usable only until their shortened expiry and cannot be replaced again.
- `ApiTokenScope` is closed: widening it means a literal here plus a column constraint in the same migration.

## Patterns & Pitfalls

- Seed stores hashes for fixture and newly issued credentials. `seedApiTokenValue` in the fixture resolves the two documented credentials by ID; `scripts/seed.ts` uses the same mapping and scopes. Verification reads revocation and expiry on every call.
- `hashApiToken` is shared with `scripts/seed.ts`; both must mint the same hash.

## Anti-patterns

- No `tokenHash` on any returned DTO.
- No per-request write added back to `verifyBearerToken`; it runs on every authenticated API request and stays read-mostly.
- No non-emitting lifecycle mutation; `create` and `revoke` feed the admin audit view.
- Not for Better Auth session tokens; those are a different principal in Better Auth's own tables.
