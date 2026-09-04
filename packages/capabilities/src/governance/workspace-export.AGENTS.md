# Workspace Exports

## Purpose & Scope

Workspace data export (ADR 0055): an owner requests a ZIP of everything the workspace holds, a background job builds it into the export bucket, and a signed, time-limited link on the API worker hands it back. This node covers four modules:

- `workspace-export.ts` — the contract: `WorkspaceExport` DTO, `WorkspaceExportQueueMessage`, the queue and bucket ports, the service, and the signed-link recipe (`signWorkspaceExportDownload`, `verifyWorkspaceExportDownload`, `issueWorkspaceExportDownloadLink`, `isWorkspaceExportDownloadable`).
- `workspace-export-archive.ts` — pure: `WorkspaceExportSnapshot` → entries → STORE-mode ZIP (`buildWorkspaceExportArchive`), the `README.txt` text, `crc32`. No clock, no randomness; the same snapshot is always the same bytes.
- `workspace-export-snapshot.ts` — `collectWorkspaceExportSnapshot({ exportId, generatedAt })`: reads members, invitations, API tokens, webhook endpoints + deliveries, every audit page, and broadcast notifications through the capability services, for the `WorkspaceContext` in scope.
- `workspace-export.seed.ts` / `workspace-export.live.ts` — the two adapters.

## Public surface

- `WorkspaceExport` — `{ id, status: pending | ready | failed, requestedAt, completedAt, expiresAt, sizeBytes, failureReason }`. `expiresAt` is the artifact's retention horizon (`WORKSPACE_EXPORT_RETENTION_DAYS`, 7 — the R2 lifecycle rule in `infra/bindings.ts` uses the same number; `apps/background/src/export-consumer.test.ts` asserts they agree).
- `availability` — `{ available: true } | { available: false, reason }`. Live answers by binding presence (queue **and** bucket); Seed is always available. The settings page reads this to explain instead of offering a button.
- `list` — this workspace's exports, newest first.
- `request` — writes the `pending` row + `workspace.export_requested` in one batch, then enqueues `{ exportId, workspaceId, workspaceSlug, traceparent? }`. An enqueue failure marks the row `failed` (`enqueue_failed`) and surfaces `CapabilityUnavailable`. Unconfigured: `CapabilityUnavailable('not_configured')`. **Seed runs the whole job inline** — snapshot, archive, `complete` — so the row returns `ready`.
- `issueDownloadLink({ exportId })` — `Option<{ path, expiresAt }>` for a `ready`, unexpired export of the current workspace. `path` is `/exports/<id>/download?expires=<unix>&signature=<hex>`; the caller prefixes the API worker origin (web: `API_PUBLIC_URL`, default `http://localhost:8787`; API: the request's own origin). TTL 15 minutes, capped at the artifact's horizon.
- `complete({ exportId, workspaceId, archive })` — background surface, no `WorkspaceContext`: puts the object (`workspaces/<workspaceId>/<exportId>.zip`), then batches the row update (`ready`, `objectKey`, `sizeBytes`, `completedAt`, `expiresAt`) with `workspace.export_completed`, then `NotificationFeed.notify` for the requester. `false` when no `pending` row matched.
- `fail({ exportId, workspaceId, reason })` — marks a pending row `failed`.
- `openDownload({ exportId, expires, signature })` — API surface: verifies the link against the row's `downloadSecret` (constant-time), the link expiry, and `isWorkspaceExportDownloadable`; reads the object; records `workspace.export_downloaded` (`actorUserId: null`). Every refusal is `Option.none()` so the route answers one 404.

## Storage

- Table: `workspaceExports` (`packages/db`). `downloadSecret` is 32 random bytes minted at request time — the per-export HMAC key. Both workers share the D1 row and nothing else, so no cross-worker secret exists and a leaked link is good for one artifact.
- Bucket: `WORKSPACE_EXPORT_BUCKET` (R2), lifecycle-deleted after seven days. The download path reads the object whole (`arrayBuffer`) rather than streaming: archives are JSON of one workspace. Revisit if a workspace's audit trail grows past what a Worker holds comfortably.
- Queue: `WORKSPACE_EXPORT_QUEUE`, consumed by `apps/background` (`export-consumer.ts`), batch size 1, three attempts a minute apart.

## What is exported, and what is not

Every file is the wire DTO the app renders — never a raw row. API tokens are metadata only (the DTO has no hash), webhook endpoints carry no signing secret, audit events carry no `metadata` JSON. Notifications are workspace broadcasts only: the snapshot runs with `actor: null` on the queue consumer, and user-targeted notifications are the user's data, not the workspace's. The README in every archive says so.

## Anti-patterns

- Don't build the snapshot from Drizzle rows. Go through the services so the export cannot show a field the UI hides.
- Don't put the API worker's origin into the capability. It returns a path; the surface that hands out the link knows where it lives.
- Don't skip `isWorkspaceExportDownloadable` on the verify side because the issue side already checked — the row can expire between the two.
- Don't add a `download` REST operation that returns the bytes. The signed route rides beside the contract on purpose; a bearer-gated binary endpoint would put the ZIP behind a long-lived credential.
