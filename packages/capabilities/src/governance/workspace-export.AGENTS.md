# Workspace exports

Workspace export (ADR 0055): an owner requests an archive, the background consumer writes gzipped JSON to R2, and the API worker serves signed downloads.

## Contracts

- `request` batches the `pending` row with `workspace.export_requested`, then enqueues. An enqueue failure marks the row `failed` (`enqueue_failed`); unconfigured fails `CapabilityUnavailable('not_configured')`.
- `issueDownloadLink` requires an explicit session or API Token recipient and returns a path and expiry, never an origin. TTL is 15 minutes, capped at the artifact's horizon. Human links sign the user, session and Workspace slug with the artifact identity. Issuance boundaries check recent authentication and download permission.
- The API download boundary rechecks human session freshness and current Workspace membership/permission. `openDownload` verifies the complete signature, expiry and `isWorkspaceExportDownloadable`, then audits the signed recipient. Refusals answer 404 before artifact storage is read.

## Pitfalls

- `WORKSPACE_EXPORT_RETENTION_DAYS` and the R2 lifecycle rule in `infra/bindings.ts` must stay equal, as `export-consumer.test.ts` asserts.
- `downloadSecret` is 32 random bytes per export, so the workers share only the D1 row and a leaked link buys one artifact. `workspace-export-archive.ts` stays pure, so one snapshot always yields the same bytes.
- The snapshot comes from the capability services, so an export cannot show a field the UI hides: tokens are metadata only, endpoints carry no signing secret, audit events no `metadata`, notifications only broadcasts (the consumer runs with `actor: null`).

## Boundaries

- No snapshot built from Drizzle rows, and no API worker origin inside the capability.
- No skipping `isWorkspaceExportDownloadable` on verify because issue checked; the row can expire between them.
- Queue execution rechecks the current workspace suspension and matches `(exportId, workspaceId, status = pending)` before writing an artifact. A stale or cross-workspace message cannot complete a row; Live checks pending before the bucket write so a duplicate ready message cannot overwrite an artifact.
