# Workspace exports

Workspace export (ADR 0055): an owner requests an archive, the background consumer writes gzipped JSON to R2, and the API worker serves signed downloads.

## Contracts

- `WorkspaceExportGeneration` owns queued generation: suspension re-check,
  context resolution, snapshot collection, archive construction, workspace
  identity matching, completion, and terminal failure settlement. The queue
  adapter only decodes the message, selects the trusted context resolver,
  annotates the wide event, and turns a retry disposition into platform
  scheduling. Seed and Live use the same snapshot/archive recipe; Seed runs it
  inline because it has no queue or bucket. Seed invokes the same generation
  constructor on its next read with the request's workspace and a trusted
  `actor: null` context, so private Member notifications stay out of archives.
- `request` batches the `pending` row with `workspace.export_requested`, then enqueues, and answers the `pending` projection on both adapters — Seed defers its inline build to the next read rather than returning `ready`. An enqueue failure marks the row `failed` (`enqueue_failed`); unconfigured fails `CapabilityUnavailable('not_configured')`.
- Settling an export as failed is audited `workspace.export_failed` and batched with the transition, so an operator sees why a pending export stopped. Seed records that evidence before changing its in-memory row; an audit outage leaves deferred work pending for retry.
- `issueDownloadLink` requires an explicit session or API Token recipient and returns a path and expiry, never an origin. TTL is 15 minutes, capped at the artifact's horizon. Human links sign the user, session and Workspace slug with the artifact identity. Issuance boundaries check recent authentication and download permission.
- The API download boundary rechecks human session freshness and current Workspace membership/permission. `openDownload` verifies the complete signature, expiry and `isWorkspaceExportDownloadable`, then audits the signed recipient. Refusals answer 404 before artifact storage is read.

`workspace-export.contract.ts` runs the shared lifecycle cases against both adapters; the artifact half stays in each adapter's own suite.

## Pitfalls

- `WORKSPACE_EXPORT_RETENTION_DAYS` and the R2 lifecycle rule in `infra/bindings.ts` must stay equal, as `export-consumer.test.ts` asserts.
- `downloadSecret` is 32 random bytes per export, so the workers share only the D1 row and a leaked link buys one artifact. `workspace-export-archive.ts` stays pure, so one snapshot always yields the same bytes.
- The snapshot comes from the capability services, so an export cannot show a field the UI hides: tokens are metadata only, endpoints carry no signing secret, audit events no `metadata`, notifications only broadcasts (the consumer runs with `actor: null`).

## Boundaries

- No snapshot built from Drizzle rows, and no API worker origin inside the capability.
- No skipping `isWorkspaceExportDownloadable` on verify because issue checked; the row can expire between them.
- Queue execution rechecks the current workspace suspension and matches `(exportId, workspaceId, status = pending)` before writing an artifact. A stale or cross-workspace message cannot complete a row; Live checks pending before the bucket write so a duplicate ready message cannot overwrite an artifact.
- A transient snapshot, archive, or completion failure returns a retry
  disposition while attempts remain. On the final attempt the generation
  workflow marks the pending row failed; if that settlement write is itself
  unavailable, the typed failure remains visible so the queue retries and the
  row honestly remains pending.
