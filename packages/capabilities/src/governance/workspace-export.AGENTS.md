# Workspace Exports

## Purpose & Scope

Workspace data export (ADR 0055): an owner requests a ZIP, the background consumer builds it into R2, and a signed time-limited link on the API worker hands it back.

## Entry Points & Contracts

- `availability` answers from binding presence (queue and bucket), so the settings page explains instead of offering a dead button. Seed is always available and runs the job inline.
- `request` batches the `pending` row with `workspace.export_requested`, then enqueues. An enqueue failure marks the row `failed` (`enqueue_failed`); unconfigured fails `CapabilityUnavailable('not_configured')`.
- `complete` puts the object, batches the row update with `workspace.export_completed`, then notifies the requester.
- `issueDownloadLink` returns a path and expiry, never an origin; the caller prefixes the API worker's. TTL is 15 minutes, capped at the artifact's horizon.
- `openDownload` verifies the signature constant-time against the row's `downloadSecret`, the expiry, and `isWorkspaceExportDownloadable`, then audits `workspace.export_downloaded` actorless. Every refusal is `Option.none()`, so the route answers 404.

## Patterns & Pitfalls

- `WORKSPACE_EXPORT_RETENTION_DAYS` and the R2 lifecycle rule in `infra/bindings.ts` must stay equal, as `export-consumer.test.ts` asserts.
- `downloadSecret` is 32 random bytes per export, so the workers share only the D1 row and a leaked link buys one artifact. `workspace-export-archive.ts` stays pure, so one snapshot always yields the same bytes.
- The snapshot comes from the capability services, so an export cannot show a field the UI hides: tokens are metadata only, endpoints carry no signing secret, audit events no `metadata`, notifications only broadcasts (the consumer runs with `actor: null`).

## Anti-patterns

- No snapshot built from Drizzle rows, and no API worker origin inside the capability.
- No skipping `isWorkspaceExportDownloadable` on verify because issue checked; the row can expire between them.
- No REST `download` operation returning bytes; the signed route keeps the ZIP off a bearer credential.
