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
- `ApiTokenRegistry.revoke({ tokenId, actorUserId? })` — stamps `revokedAt`, emits `api_token.revoked`, resolves `true` when a row was revoked. The lookup and where-clause include `workspaceId` and `isNull(revokedAt)`, so double-revoke and cross-workspace revoke are no-ops that resolve `false` — and **no audit event is recorded when nothing matched**.
- `ApiTokenRegistry.verifyBearerToken(token, requiredScope)` — hashes the plaintext, looks up by `tokenHash`, checks `revokedAt` and scope set, returns `VerifiedApiToken`. **Fails with `AuthorizationDenied`, not `WorkspaceNotFound`** — this is the capability layer's one authorization-shaped failure. The failure `reason` distinguishes `invalid_token` (unknown/revoked — the API worker answers 401) from `insufficient_scope` (valid token, missing scope — 403).
- `verifyBearerToken` bumps `lastUsedAt` **at most once per `LAST_USED_WRITE_INTERVAL_MS` (60s)** — the throttle decision is the exported pure helper `shouldBumpLastUsedAt`. The per-request `api_token.used` audit event was **removed**: it cost a second D1 write per authenticated request and flooded the governance log with noise. Verification is therefore no longer audit-emitting; `create`/`revoke` still are.
- Mutations (`create`, `revoke`) run their row write and the audit insert as **one atomic D1 batch** (via `AuditEventLog.prepareRecord` + `batch` from `@b2b-saas-starter/db`). All methods can additionally fail with `CapabilityUnavailable` (503) when D1 is unreachable.

## Seed semantics

The Seed layer's `verifyBearerToken` accepts **exactly one** documented fixture credential: the exported constant `SEED_API_TOKEN` (`'bsk_seed_0000000000000000'`). It resolves to the seed workspace with **all scopes** (`read`, `write`, `admin`); every other token fails with `AuthorizationDenied`, mirroring Live behavior for unknown tokens. Never make the seed layer accept arbitrary tokens — it is the auth gate when the API worker runs without D1.

## Storage

- Table: `apiTokens` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- Columns of note:
  - `tokenHash` — SHA-256 hex of the plaintext token. **Plaintext is shown to the user exactly once at issuance and never persisted.**
  - `tokenPrefix` — first 17 plaintext chars, used by the UI to identify tokens without exposing the secret.
  - `revokedAt` — soft-delete timestamp; the Live layer filters on `isNull(revokedAt)`.
  - `lastUsedAt` — bumped by `verifyBearerToken` on successful auth, throttled to once per 60s (see `LAST_USED_WRITE_INTERVAL_MS`).
  - `createdByUserId` — set from `actorUserId` for the audit trail.

## Integrations

- Bearer middleware in [`apps/api/src/index.ts`](../../../../apps/api/src/index.ts) (search: `bearerToken`) parses `Authorization: Bearer …`, calls `verifyBearerToken`, and short-circuits with `401 missing_bearer_token`, `401 invalid_token`, or `403 insufficient_scope` via wide-event-annotated responses. Workspace routes additionally reject tokens whose `workspaceSlug` differs from the URL slug with `403 token_workspace_mismatch`.
- All three mutators emit through [`audit-event-log`](../governance/audit-event-log.AGENTS.md). The `LiveApiTokenRegistry` Layer requires `AuditEventLog` — keep that dependency wired when composing layers.

## Anti-patterns

- Don't return `tokenHash` from any capability method. The DTO schema does not include it; keep it that way.
- Don't widen `ApiTokenScope` with free-form strings. Add a literal here and a column constraint in the migration together.
- Don't reuse `ApiTokenRegistry` for Better Auth session tokens. Sessions live in Better Auth's `session` table — these are two different auth principals.
- Don't introduce a non-emitting mutation path. Every lifecycle state change (`create`, `revoke`) emits to `auditEvents` — that's the contract the admin audit view depends on. The one deliberate exception is `verifyBearerToken`'s `lastUsedAt` bump: it is an activity signal, not a lifecycle event, and per-request `api_token.used` events were removed for flooding the log.
- Don't re-add a per-request write to `verifyBearerToken`. It runs on every authenticated API request; keep it read-mostly (throttled `lastUsedAt` bump only).
