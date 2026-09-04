# API Token Registry

## Purpose & Scope

Workspace-scoped programmatic-access tokens for the REST and MCP surface. Tokens are stored as SHA-256 hashes; the plaintext is shown once by `create` and never persisted.

## Entry Points & Contracts

- `create` gates on the plan's token ceiling with `assertWithinPlanLimit` (billing owns the rule), audits `api_token.created`, and fans out a best-effort webhook projection that must never carry the plaintext.
- `revoke` stamps `revokedAt`. Its where clause carries `workspaceId` and `isNull(revokedAt)`, so a double or cross-workspace revoke resolves `false` and emits no audit event and no webhook.
- `verifyBearerToken` authenticates only: it reports the token's scopes and `requirePermission` decides. It fails `AuthorizationDenied` with `reason: 'invalid_token'`, this layer's single authorization-shaped failure, which `apps/api` answers as 401.
- `verifyBearerToken` bumps `lastUsedAt` at most once per `LAST_USED_WRITE_INTERVAL_MS`, decided by the pure `shouldBumpLastUsedAt`. It emits no audit event; the per-request `api_token.used` event was dropped for flooding the log.
- `ApiTokenScope` is closed: widening it means a literal here plus a column constraint in the same migration.

## Patterns & Pitfalls

- Seed `verifyBearerToken` accepts exactly two fixture credentials, `SEED_API_TOKEN` (all scopes) and `SEED_READONLY_API_TOKEN`. The narrow one makes a 403 reachable without D1, and both live in the contract module because the API worker's tests quote them. Never let Seed accept arbitrary tokens: it is the auth gate when the worker runs without D1.
- `hashApiToken` is shared with `scripts/seed.ts`; both must mint the same hash.

## Anti-patterns

- No `tokenHash` on any returned DTO.
- No per-request write added back to `verifyBearerToken`; it runs on every authenticated API request and stays read-mostly.
- No non-emitting lifecycle mutation; `create` and `revoke` feed the admin audit view.
- Not for Better Auth session tokens; those are a different principal in Better Auth's own tables.
