import { workspaceExportStatuses } from '@b2b-saas-starter/db/enums'
import { Context, DateTime, Effect, Option, Schema } from 'effect'

import { type CapabilityUnavailable } from '../errors.ts'
import { hmacSha256Hex } from '../internal/crypto.ts'
import { type WorkspaceContext } from '../workspace-context.ts'

/**
 * Workspace data export (ADR 0055): an owner asks for a ZIP of everything the
 * workspace holds, a background job builds it into the export bucket, and a
 * signed, time-limited link on the API worker hands it back.
 *
 * This is the contract: the wire schemas, the queue message, the two binding
 * ports (queue and bucket), the signed-link recipe both workers agree on, and
 * the service tag. The in-memory adapter is
 * [`workspace-export.seed.ts`](./workspace-export.seed.ts), the D1 + queue +
 * R2 adapter is [`workspace-export.live.ts`](./workspace-export.live.ts), and
 * the archive itself is [`workspace-export-archive.ts`](./workspace-export-archive.ts).
 */

export const WorkspaceExportStatus = Schema.Literals(workspaceExportStatuses)
export type WorkspaceExportStatus = typeof WorkspaceExportStatus.Type

export const WorkspaceExport = Schema.Struct({
  id: Schema.String,
  status: WorkspaceExportStatus,
  requestedAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  /** When the artifact stops being downloadable — the bucket's lifecycle horizon. */
  expiresAt: Schema.NullOr(Schema.String),
  sizeBytes: Schema.NullOr(Schema.Number),
  failureReason: Schema.NullOr(Schema.String)
})
export type WorkspaceExport = typeof WorkspaceExport.Type

/**
 * Whether the deployment can produce exports at all. `unavailable` is the
 * provider-light answer for a worker with no export queue or bucket bound
 * (CLAUDE.md rule 3): the UI explains instead of offering a button that 503s.
 */
export type WorkspaceExportAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: string }

/**
 * The job message. The web worker enqueues it after writing the export row;
 * the background consumer decodes it against this same schema. `workspaceSlug`
 * lets the consumer resolve a trusted `WorkspaceContext` the way a request
 * would, and `workspaceId` is re-checked against what that resolves to.
 */
export const WorkspaceExportQueueMessage = Schema.Struct({
  exportId: Schema.String,
  workspaceId: Schema.String,
  workspaceSlug: Schema.String,
  // Same reasoning as `WebhookQueueMessage.traceparent`: unchecked so a trace
  // defect cannot turn into a dropped export.
  traceparent: Schema.optionalKey(Schema.String)
})
export type WorkspaceExportQueueMessage = typeof WorkspaceExportQueueMessage.Type

/** Structural subset of Cloudflare's `Queue` binding, like `WebhookQueueBinding`. */
export type WorkspaceExportQueueBinding = {
  readonly send: (message: WorkspaceExportQueueMessage) => Promise<void>
}

/**
 * Structural subset of Cloudflare's `R2Bucket`: put the archive, read it back
 * whole. Archives are JSON of one workspace, so the download path reads the
 * object into memory rather than streaming — a starter-scale trade recorded
 * in the leaf intent node.
 *
 * `put` resolves `void` for the same reason `WebhookQueueBinding.send` does:
 * the real binding resolves an `R2Object`, but this package neither reads it
 * nor wants it in the port's contract — the write either happened or rejected.
 */
export type WorkspaceExportBucketBinding = {
  readonly put: (
    key: string,
    value: Uint8Array,
    options?: { readonly httpMetadata?: { readonly contentType?: string } }
  ) => Promise<void>
  readonly get: (key: string) => Promise<{
    readonly size: number
    readonly arrayBuffer: () => Promise<ArrayBuffer>
  } | null>
}

export type WorkspaceExportDownloadLink = {
  /**
   * Path plus query on the API worker (`/exports/<id>/download?expires=…&signature=…`).
   * The surface that hands it out prefixes the worker origin: the web app from
   * `API_PUBLIC_URL`, the API worker from the request it is answering.
   */
  readonly path: string
  readonly expiresAt: string
}

export type WorkspaceExportDownload = {
  readonly fileName: string
  readonly sizeBytes: number
  readonly body: Uint8Array
}

export type CompleteWorkspaceExportInput = {
  readonly exportId: string
  readonly workspaceId: string
  readonly archive: Uint8Array
}

export type FailWorkspaceExportInput = {
  readonly exportId: string
  readonly workspaceId: string
  readonly reason: string
}

export type OpenWorkspaceExportDownloadInput = {
  readonly exportId: string
  /** Unix seconds the link stops working, as carried in the URL. */
  readonly expires: number
  readonly signature: string
}

export type WorkspaceExportsInterface = {
  readonly availability: Effect.Effect<WorkspaceExportAvailability>

  /** Every export of the current workspace, newest first. */
  readonly list: Effect.Effect<
    ReadonlyArray<WorkspaceExport>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * Writes a `pending` export for the current workspace, records
   * `workspace.export_requested`, and enqueues the job. Fails
   * `CapabilityUnavailable` when the deployment has no export queue or bucket
   * — the UI should have read `availability` and explained instead.
   */
  readonly request: Effect.Effect<
    WorkspaceExport,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * A signed link for one `ready`, unexpired export of the current workspace.
   * `Option.none()` for anything else — an unknown id, another workspace's
   * export, a pending or failed one, an expired artifact.
   */
  readonly issueDownloadLink: (input: {
    readonly exportId: string
  }) => Effect.Effect<
    Option.Option<WorkspaceExportDownloadLink>,
    CapabilityUnavailable,
    WorkspaceContext
  >

  /**
   * Background-worker surface — no `WorkspaceContext` exists on the queue
   * consumer, so the ids travel in the message and are re-applied here: the
   * row is matched on `(exportId, workspaceId, status = pending)`. Stores the
   * archive, marks the row `ready` with the retention horizon, records
   * `workspace.export_completed`, and notifies the requester. Resolves `false`
   * when no pending row matched (already completed, or a stale message).
   */
  readonly complete: (
    input: CompleteWorkspaceExportInput
  ) => Effect.Effect<boolean, CapabilityUnavailable>

  /** Marks a pending export `failed` with a reason. Same matching as `complete`. */
  readonly fail: (
    input: FailWorkspaceExportInput
  ) => Effect.Effect<boolean, CapabilityUnavailable>

  /**
   * API-worker surface: verifies the signed link (per-export secret, expiry),
   * reads the artifact, and records `workspace.export_downloaded`. Every
   * rejection is `Option.none()` so the route answers one 404 and discloses
   * nothing about why.
   */
  readonly openDownload: (
    input: OpenWorkspaceExportDownloadInput
  ) => Effect.Effect<Option.Option<WorkspaceExportDownload>, CapabilityUnavailable>
}

export class WorkspaceExports extends Context.Service<
  WorkspaceExports,
  WorkspaceExportsInterface
>()('@b2b-saas-starter/capabilities/WorkspaceExports') {}

/** How long a signed download link stays valid. */
export const WORKSPACE_EXPORT_LINK_TTL_SECONDS = 15 * 60

/**
 * The artifact retention horizon, from `completedAt`. Mirrors the bucket's
 * lifecycle rule (`WORKSPACE_EXPORT_RETENTION_DAYS` in `infra/bindings.ts`);
 * the two are kept in step by the drift test rather than by an import, since
 * this package does not depend on `infra`.
 */
export const WORKSPACE_EXPORT_RETENTION_DAYS = 7

export function workspaceExportExpiresAt(completedAt: DateTime.Utc): string {
  return DateTime.formatIso(
    DateTime.addDuration(completedAt, `${WORKSPACE_EXPORT_RETENTION_DAYS} days`)
  )
}

/**
 * The signed-link recipe, in one place for both the issuer and the verifier:
 * HMAC-SHA256 over `"<exportId>.<expires>"` with the export's own
 * `downloadSecret`. Per-export secrets mean the web and API workers share
 * nothing but the D1 row, and a leaked link is good for one artifact only.
 */
export function signWorkspaceExportDownload(
  downloadSecret: string,
  exportId: string,
  expires: number
): Effect.Effect<string> {
  return Effect.promise(() => hmacSha256Hex(downloadSecret, `${exportId}.${expires}`))
}

/** The link's path on the API worker, for a signature already computed. */
export function workspaceExportDownloadPath(
  exportId: string,
  expires: number,
  signature: string
): string {
  return `/exports/${encodeURIComponent(exportId)}/download?expires=${expires}&signature=${signature}`
}

/**
 * Constant-time hex comparison, so a verifier cannot be timed toward a valid
 * signature byte by byte.
 */
function equalHex(left: string, right: string): boolean {
  if (left.length !== right.length) {
    return false
  }
  let difference = 0
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index)
  }
  return difference === 0
}

/**
 * Verifies a presented link against the stored secret: not yet expired at
 * `now`, and the signature matches. Shared by both adapters so Seed refuses
 * exactly what Live refuses.
 */
export function verifyWorkspaceExportDownload(input: {
  readonly downloadSecret: string
  readonly exportId: string
  readonly expires: number
  readonly signature: string
  readonly now: DateTime.Utc
}): Effect.Effect<boolean> {
  return Effect.gen(function* () {
    if (!Number.isSafeInteger(input.expires)) {
      return false
    }
    const nowSeconds = Math.floor(DateTime.toEpochMillis(input.now) / 1000)
    if (input.expires <= nowSeconds) {
      return false
    }
    const expected = yield* signWorkspaceExportDownload(
      input.downloadSecret,
      input.exportId,
      input.expires
    )
    return equalHex(expected, input.signature)
  })
}

/**
 * Whether a stored export can still be downloaded: `ready`, and its artifact
 * not past the retention horizon. The one rule both adapters apply before
 * issuing or honouring a link.
 */
export function isWorkspaceExportDownloadable(
  record: Pick<WorkspaceExport, 'status' | 'expiresAt'>,
  now: DateTime.Utc
): boolean {
  if (record.status !== 'ready' || record.expiresAt === null) {
    return false
  }
  return (
    DateTime.toEpochMillis(DateTime.makeUnsafe(record.expiresAt)) >
    DateTime.toEpochMillis(now)
  )
}

/**
 * Issues a link for a downloadable export: expiry `WORKSPACE_EXPORT_LINK_TTL_SECONDS`
 * from `now`, capped at the artifact's own horizon so no link outlives the
 * object it points at.
 */
export function issueWorkspaceExportDownloadLink(input: {
  readonly downloadSecret: string
  readonly record: Pick<WorkspaceExport, 'id' | 'status' | 'expiresAt'>
  readonly now: DateTime.Utc
}): Effect.Effect<Option.Option<WorkspaceExportDownloadLink>> {
  return Effect.gen(function* () {
    const artifactExpiresAt = input.record.expiresAt
    if (
      artifactExpiresAt === null ||
      !isWorkspaceExportDownloadable(input.record, input.now)
    ) {
      return Option.none()
    }
    const nowSeconds = Math.floor(DateTime.toEpochMillis(input.now) / 1000)
    const artifactSeconds = Math.floor(
      DateTime.toEpochMillis(DateTime.makeUnsafe(artifactExpiresAt)) / 1000
    )
    const expires = Math.min(
      nowSeconds + WORKSPACE_EXPORT_LINK_TTL_SECONDS,
      artifactSeconds
    )
    const signature = yield* signWorkspaceExportDownload(
      input.downloadSecret,
      input.record.id,
      expires
    )
    return Option.some({
      path: workspaceExportDownloadPath(input.record.id, expires, signature),
      expiresAt: DateTime.formatIso(DateTime.makeUnsafe(expires * 1000))
    })
  })
}
