# API Token Registry

## Purpose & Scope

Workspace-scoped programmatic-access tokens for the REST + MCP surface. Tokens carry one or more scopes from a fixed three-tier hierarchy (`read | write | admin`) and are stored as SHA-256 hashes, never plaintext. Full lifecycle (issue, list, revoke, verify) is wired and emits audit events.

## Module layout

The capability is split along its section seams — no barrel file; consumers import the specific module:

- `api-token-registry.ts` — shared contract: schemas (`ApiToken`, `ApiTokenScope`, `CreateApiTokenPayload`, `CreatedApiTokenSchema`), input types, `ApiTokenRegistryInterface` + service class, the `lastUsedAt` throttle policy (`LAST_USED_WRITE_INTERVAL_MS`, `shouldBumpLastUsedAt`), the stored-hash scheme (`hashApiToken`, shared with `scripts/seed.ts`), and the two documented fixture credentials (`SEED_API_TOKEN`, `SEED_READONLY_API_TOKEN` — published credentials the API worker's tests quote, so they live in the contract rather than in the Seed adapter).
- `api-token-registry.seed.ts` — `SeedApiTokenRegistry` and its fixture scope map.
- `api-token-registry.live.ts` — `LiveApiTokenRegistry` plus its query helpers (`activeTokenWhere`, `toTokenProjection`, token minting).

## Public surface

- `ApiTokenScope = 'read' | 'write' | 'admin'` — schema literal. Treat as a closed set; widening it requires a migration.
- `ApiToken` — DTO returned to UI/CLI: `{ id, name, prefix, scopes, lastUsedAt, createdAt }`. `prefix` is the first 17 chars of the plaintext (`bsk_live_…` / `bsk_seed_…`) shown in lists so users can recognise tokens. The hash is never exposed.
- `CreatedApiToken = ApiToken & { token }` — only returned from `create`. **The `token` plaintext is shown exactly once and never persisted.**
- `VerifiedApiToken = { id, workspaceId, workspaceSlug, scopes }` — what `verifyBearerToken` resolves to. `scopes` is the input the route boundary turns into a `tokenPrincipal` for the permission check.
- `ApiTokenRegistry.list` — `readonly ApiToken[]` for the current `WorkspaceContext`. Filters revoked rows (`isNull(revokedAt)`), newest first.
- `ApiTokenRegistry.create({ name, scopes })` — enforces the plan's token-count ceiling (`assertWithinPlanLimit` from the billing capability; counting lives here so callers cannot forget the gate), mints a high-entropy token, hashes it, stores `tokenPrefix + tokenHash`, emits `api_token.created`, and fans out a best-effort `api_token.created` webhook event (projection only — never the plaintext). Returns `CreatedApiToken` (with plaintext). Fails with `PlanLimitExceeded` when the plan cap is reached.
- `ApiTokenRegistry.revoke({ tokenId })` — stamps `revokedAt`, emits `api_token.revoked`, resolves `true` when a row was revoked. The lookup and where-clause include `workspaceId` and `isNull(revokedAt)`, so double-revoke and cross-workspace revoke are no-ops that resolve `false` — and **no audit event or webhook fan-out happens when nothing matched**.
- Mutating fan-out is implementation detail: both Seed and Live layers are built with a `WebhookPublisher` (Seed uses the no-op) via `publishWebhookEventWith`, so `WebhookPublisher` never appears in this capability's interface — every surface (REST, MCP bearer flows, web server functions) gets identical behavior for free.
- `ApiTokenRegistry.verifyBearerToken(token)` — hashes the plaintext, looks up by `tokenHash`, checks `revokedAt`, returns `VerifiedApiToken`. It **authenticates only**: the reported `scopes` are the token's own, and whether they cover the request is decided by `requirePermission` at the route boundary. **Fails with `AuthorizationDenied`, not `WorkspaceNotFound`** — this is the capability layer's one authorization-shaped failure, and its `reason` is always `invalid_token` (unknown or revoked; the API worker answers 401).
- `verifyBearerToken` bumps `lastUsedAt` **at most once per `LAST_USED_WRITE_INTERVAL_MS` (60s)** — the throttle decision is the exported pure helper `shouldBumpLastUsedAt`. The per-request `api_token.used` audit event was **removed**: it cost a second D1 write per authenticated request and flooded the governance log with noise. Verification is therefore no longer audit-emitting; `create`/`revoke` still are.
- Mutations (`create`, `revoke`) run their row write and the audit insert as **one atomic D1 batch** through the shared [`governance/audited-mutation`](../audited-mutation.ts) combinator (as do WebhookEndpoints' mutations and the terminal delivery write) — it owns the `prepareRecord` + `batch` wiring, the zero-match skip, and the documented phantom-audit race. All methods can additionally fail with `CapabilityUnavailable` (503) when D1 is unreachable.

## Seed semantics

The Seed layer is a **stateful mirror of Live's post-conditions**, not a static fixture: `create` appends (and audits + fans out), `revoke` stamps revocation on a mutable store entry, and `list` reads the store scoped to `WorkspaceContext` — so the plan gate can actually trip and contract cases (`developer-platform.contract.ts`) run unmodified against both adapters. Fixture tokens belong to the seed workspace (`wrk_starter`).

The Seed layer's `verifyBearerToken` accepts **exactly two** documented fixture credentials, both resolving to the seed workspace:

- `SEED_API_TOKEN` (`'bsk_seed_0000000000000000'`) — all scopes (`read`, `write`, `admin`).
- `SEED_READONLY_API_TOKEN` (`'bsk_seed_readonly000000'`) — the `read` scope only.

The narrow one exists so the denial half of the permission matrix is reachable without a live D1: with one all-powerful fixture token, no Seed-backed test could ever observe a 403. Every other token fails with `AuthorizationDenied`. Never make the seed layer accept arbitrary tokens — it is the auth gate when the API worker runs without D1.

## Storage

- Table: `apiTokens` (see [`@b2b-saas-starter/db`](../../../db/AGENTS.md)).
- Columns of note:
  - `tokenHash` — SHA-256 hex of the plaintext token. **Plaintext is shown to the user exactly once at issuance and never persisted.**
  - `tokenPrefix` — first 17 plaintext chars, used by the UI to identify tokens without exposing the secret.
  - `revokedAt` — soft-delete timestamp; the Live layer filters on `isNull(revokedAt)`.
  - `lastUsedAt` — bumped by `verifyBearerToken` on successful auth, throttled to once per 60s (see `LAST_USED_WRITE_INTERVAL_MS`).
  - `createdByUserId` — set from `WorkspaceContext.actor` for the audit trail.

## Integrations

- `enforcePermission` in [`apps/api/src/handlers.ts`](../../../../apps/api/src/handlers.ts) parses `Authorization: Bearer …`, calls `verifyBearerToken`, and short-circuits with `401 missing_bearer_token` or `401 invalid_token` via wide-event-annotated responses. It then asks `requirePermission` for the route's permission, which answers `403 insufficient_permission`. Workspace routes additionally reject tokens whose `workspaceSlug` differs from the URL slug with `403 token_workspace_mismatch`.
- All three mutators emit through [`audit-event-log`](../governance/audit-event-log.AGENTS.md). The `LiveApiTokenRegistry` Layer requires `AuditEventLog` — keep that dependency wired when composing layers.

## Anti-patterns

- Don't return `tokenHash` from any capability method. The DTO schema does not include it; keep it that way.
- Don't widen `ApiTokenScope` with free-form strings. Add a literal here and a column constraint in the migration together.
- Don't reuse `ApiTokenRegistry` for Better Auth session tokens. Sessions live in Better Auth's `session` table — these are two different auth principals.
- Don't introduce a non-emitting mutation path. Every lifecycle state change (`create`, `revoke`) emits to `auditEvents` — that's the contract the admin audit view depends on. The one deliberate exception is `verifyBearerToken`'s `lastUsedAt` bump: it is an activity signal, not a lifecycle event, and per-request `api_token.used` events were removed for flooding the log.
- Don't re-add a per-request write to `verifyBearerToken`. It runs on every authenticated API request; keep it read-mostly (throttled `lastUsedAt` bump only).
