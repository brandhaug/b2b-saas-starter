# API Token Registry

## Purpose & Scope

Workspace-scoped programmatic-access tokens for the REST + MCP surface. Tokens carry one or more scopes from a fixed three-tier hierarchy (`read | write | admin`) and are stored as SHA-256 hashes, never plaintext. Full lifecycle (issue, list, revoke, verify) is wired and emits audit events.

## Public surface

- `ApiTokenScope = 'read' | 'write' | 'admin'` — schema literal. Treat as a closed set; widening it requires a migration.
- `ApiToken` — DTO returned to UI/CLI: `{ id, name, prefix, scopes, lastUsedAt, createdAt }`. `prefix` is the first 17 chars of the plaintext (`bsk_live_…` / `bsk_seed_…`) shown in lists so users can recognise tokens. The hash is never exposed.
- `CreatedApiToken = ApiToken & { token }` — only returned from `create`. **The `token` plaintext is shown exactly once and never persisted.**
- `VerifiedApiToken = { id, workspaceId, workspaceSlug, scopes }` — what `verifyBearerToken` resolves to and what route handlers receive after the bearer middleware succeeds.
- `ApiTokenRegistry.list` — `readonly ApiToken[]` for the current `WorkspaceContext`. Filters revoked rows (`isNull(revokedAt)`), newest first.
- `ApiTokenRegistry.create({ name, scopes, actorUserId? })` — mints a high-entropy token, hashes it, stores `tokenPrefix + tokenHash`, and emits `api_token.created`. Returns `CreatedApiToken` (with plaintext).
- `ApiTokenRegistry.revoke({ tokenId, actorUserId? })` — stamps `revokedAt`, emits `api_token.revoked`. The where-clause includes `isNull(revokedAt)` so double-revoke is a no-op.
- `ApiTokenRegistry.verifyBearerToken(token, requiredScope)` — hashes the plaintext, looks up by `tokenHash`, checks `revokedAt` and scope set, bumps `lastUsedAt`, emits `api_token.used`, returns `VerifiedApiToken`. **Fails with `AuthorizationDenied` (403), not `WorkspaceNotFound`** — this is the capability layer's one authorization-shaped failure.

## Storage

- Table: `apiTokens` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- Columns of note:
  - `tokenHash` — SHA-256 hex of the plaintext token. **Plaintext is shown to the user exactly once at issuance and never persisted.**
  - `tokenPrefix` — first 17 plaintext chars, used by the UI to identify tokens without exposing the secret.
  - `revokedAt` — soft-delete timestamp; the Live layer filters on `isNull(revokedAt)`.
  - `lastUsedAt` — bumped by `verifyBearerToken` on each successful auth.
  - `createdByUserId` — set from `actorUserId` for the audit trail.

## Integrations

- Bearer middleware in [`apps/api/src/index.ts`](../../../../apps/api/src/index.ts) (search: `bearerToken`) parses `Authorization: Bearer …`, calls `verifyBearerToken`, and short-circuits with `401 missing_bearer_token` or `403 invalid_or_insufficient_token` via wide-event-annotated responses.
- All three mutators emit through [`audit-event-log`](../governance/audit-event-log.AGENTS.md). The `LiveApiTokenRegistry` Layer requires `AuditEventLog` — keep that dependency wired when composing layers.

## Anti-patterns

- Don't return `tokenHash` from any capability method. The DTO schema does not include it; keep it that way.
- Don't widen `ApiTokenScope` with free-form strings. Add a literal here and a column constraint in the migration together.
- Don't reuse `ApiTokenRegistry` for Better Auth session tokens. Sessions live in Better Auth's `session` table — these are two different auth principals.
- Don't introduce a non-emitting mutation path. Every state change (`create`, `revoke`, `verifyBearerToken`) emits to `auditEvents` — that's the contract the admin audit view depends on.
