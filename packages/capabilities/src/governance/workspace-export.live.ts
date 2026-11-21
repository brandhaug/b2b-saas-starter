import { type WorkspaceId } from '@b2b-saas-starter/db/ids'
import { workspaceAuditAttribution } from '@b2b-saas-starter/billing/ports'
import { workspaceExports } from '@b2b-saas-starter/db/schema/governance'
import { workspaces } from '@b2b-saas-starter/db/schema/workspaces'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { DateTime, Effect, Layer, Option, Result } from 'effect'
import { desc, eq } from 'drizzle-orm'

import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { randomHex } from '@b2b-saas-starter/failure/crypto'
import { newCapabilityId } from '../internal/ids.ts'
import { makeQueuePublisher } from '../internal/queue-publisher.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'
import { WorkspaceSuspensionService } from './workspace-suspension.ts'
import { workspaceExportFileName } from './workspace-export-archive.ts'
import { objectKeyFor, pendingWhere } from './workspace-export.internal.ts'
import {
  completedWorkspaceExportStatus,
  failedWorkspaceExportStatus,
  initialWorkspaceExportStatus,
  issueWorkspaceExportDownloadLink,
  isWorkspaceExportDownloadable,
  verifyWorkspaceExportDownload,
  workspaceExportExpiresAt,
  workspaceExportHumanRecipient,
  WorkspaceExports,
  type CompleteWorkspaceExportInput,
  type FailWorkspaceExportInput,
  type IssueWorkspaceExportDownloadInput,
  type OpenWorkspaceExportDownloadInput,
  type WorkspaceExport,
  type WorkspaceExportAvailability,
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding,
  workspaceExportDownloadAttribution
} from './workspace-export.ts'

const CAPABILITY = 'workspace-exports'
const unavailable = orUnavailable(CAPABILITY)

export type LiveWorkspaceExportsOptions = {
  /** `WORKSPACE_EXPORT_QUEUE` — absent, exports report unavailable. */
  readonly queue?: WorkspaceExportQueueBinding | undefined
  /** `WORKSPACE_EXPORT_BUCKET` — absent, exports report unavailable. */
  readonly bucket?: WorkspaceExportBucketBinding | undefined
}

function toRecord(row: typeof workspaceExports.$inferSelect): WorkspaceExport {
  return {
    id: row.id,
    status: row.status,
    requestedAt: row.createdAt,
    completedAt: row.completedAt,
    expiresAt: row.expiresAt,
    sizeBytes: row.sizeBytes,
    failureReason: row.failureReason
  }
}

/**
 * The provider-light gate. Both bindings are provisioned together by alchemy
 * when `WORKSPACE_EXPORTS_ENABLED` is set, so a worker with one and not the
 * other is a deployment mistake worth naming.
 */
function availabilityOf(
  options: LiveWorkspaceExportsOptions
): WorkspaceExportAvailability {
  const missing: Array<string> = []
  if (!options.queue) {
    missing.push('the WORKSPACE_EXPORT_QUEUE binding')
  }
  if (!options.bucket) {
    missing.push('the WORKSPACE_EXPORT_BUCKET binding')
  }
  if (missing.length === 0) {
    return { available: true }
  }
  return {
    available: false,
    reason: `Workspace exports need an R2 bucket and a queue: set WORKSPACE_EXPORTS_ENABLED at deploy time (this worker is missing ${missing.join(' and ')}).`
  }
}

export function LiveWorkspaceExports(
  options: LiveWorkspaceExportsOptions = {}
): Layer.Layer<
  WorkspaceExports,
  never,
  Database | RawD1 | AuditEventLog | NotificationFeed | WorkspaceSuspensionService
> {
  return Layer.effect(WorkspaceExports)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const suspension = yield* WorkspaceSuspensionService
      function requireProduct(workspaceId: WorkspaceId) {
        return suspension.requireAllowed(workspaceId, 'product')
      }
      const auditedMutation = yield* auditedMutations({
        prepareAuditRecord: audit.prepareRecord,
        unavailable
      })
      const availability = availabilityOf(options)
      // The shared queue-port recipe, same as the seat-sync and webhook
      // producers. The binding is required here, not provider-light: the
      // availability gate above already refused an unconfigured deployment,
      // and a send that still fails is folded below into a `failed` row.
      const enqueueExport = makeQueuePublisher(
        CAPABILITY,
        options.queue,
        (input: {
          readonly exportId: string
          readonly workspaceId: WorkspaceId
          readonly workspaceSlug: string
        }) => input
      )

      function pendingMatched(exportId: string, workspaceId: WorkspaceId) {
        return unavailable(
          db
            .select({ id: workspaceExports.id })
            .from(workspaceExports)
            .where(pendingWhere(exportId, workspaceId))
            .limit(1)
        ).pipe(Effect.map((rows) => rows.length > 0))
      }

      function findRow(exportId: string) {
        return unavailable(
          db
            .select({ row: workspaceExports, workspace: workspaces })
            .from(workspaceExports)
            .innerJoin(workspaces, eq(workspaces.id, workspaceExports.workspaceId))
            .where(eq(workspaceExports.id, exportId))
            .limit(1)
        ).pipe(Effect.map((rows) => rows[0]))
      }

      /**
       * Settles a pending export as failed. The transition and its audit row
       * commit as one batch, like every other export state change — a
       * failure is the outcome an operator most needs a trail for, and two
       * loose statements could leave the row settled with no record of why.
       * Resolves `false` when the export was already settled.
       */
      function markFailed(exportId: string, workspaceId: WorkspaceId, reason: string) {
        return Effect.gen(function* () {
          const completedAt = yield* DateTime.now
          return yield* auditedMutation({
            matched: pendingMatched(exportId, workspaceId),
            auditEvent: {
              workspaceId,
              actorUserId: null,
              actorType: 'system',
              eventType: 'workspace.export_failed',
              targetType: 'workspace_export',
              targetId: exportId,
              metadata: { reason }
            },
            write: () => [
              db
                .update(workspaceExports)
                .set({
                  // Legal by the transition map: `matched` and the WHERE
                  // clause both pin the row to the pending status.
                  status: failedWorkspaceExportStatus,
                  failureReason: reason,
                  completedAt: DateTime.formatIso(completedAt)
                })
                .where(pendingWhere(exportId, workspaceId))
            ]
          })
        })
      }

      return {
        availability: Effect.succeed(availability).pipe(
          Effect.withSpan('WorkspaceExports.availability')
        ),
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          yield* requireProduct(ctx.workspace.id)
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceExports)
              .where(eq(workspaceExports.workspaceId, ctx.workspace.id))
              .orderBy(desc(workspaceExports.createdAt), desc(workspaceExports.id))
          )
          return rows.map(toRecord)
        }).pipe(Effect.withSpan('WorkspaceExports.list')),
        request: Effect.gen(function* () {
          if (!availability.available) {
            return yield* new CapabilityUnavailable({
              capability: CAPABILITY,
              reason: 'not_configured'
            })
          }
          const ctx = yield* WorkspaceContext
          yield* requireProduct(ctx.workspace.id)
          const id = yield* newCapabilityId('exp')
          const createdAt = DateTime.formatIso(yield* DateTime.now)
          const row = {
            id,
            workspaceId: ctx.workspace.id,
            requestedByUserId: ctx.actor?.userId ?? null,
            status: initialWorkspaceExportStatus,
            objectKey: null,
            sizeBytes: null,
            // 32 random bytes: the per-export HMAC key behind the signed link.
            downloadSecret: randomHex(32),
            failureReason: null,
            createdAt,
            completedAt: null,
            expiresAt: null
          } satisfies typeof workspaceExports.$inferInsert
          // Row + audit event as one batch, then the enqueue: a job that never
          // reaches the queue is marked failed rather than left pending forever.
          yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              ...workspaceAuditAttribution(ctx),
              eventType: 'workspace.export_requested',
              targetType: 'workspace_export',
              targetId: id,
              metadata: {}
            },
            write: () => [db.insert(workspaceExports).values(row)]
          })
          const enqueued = yield* Effect.result(
            enqueueExport({
              exportId: id,
              workspaceId: ctx.workspace.id,
              workspaceSlug: ctx.workspace.slug
            })
          )
          if (Result.isFailure(enqueued)) {
            yield* markFailed(id, ctx.workspace.id, 'enqueue_failed')
            return yield* enqueued.failure
          }
          return toRecord(row)
        }).pipe(Effect.withSpan('WorkspaceExports.request')),
        issueDownloadLink: Effect.fn('WorkspaceExports.issueDownloadLink')(function* (
          input: IssueWorkspaceExportDownloadInput
        ) {
          const ctx = yield* WorkspaceContext
          const found = yield* findRow(input.exportId)
          if (!found || found.row.workspaceId !== ctx.workspace.id) {
            return Option.none()
          }
          yield* requireProduct(ctx.workspace.id)
          return yield* issueWorkspaceExportDownloadLink({
            downloadSecret: found.row.downloadSecret,
            record: toRecord(found.row),
            now: yield* DateTime.now,
            human: workspaceExportHumanRecipient(input.recipient, ctx.workspace.slug)
          })
        }),
        complete: Effect.fn('WorkspaceExports.complete')(function* (
          input: CompleteWorkspaceExportInput
        ) {
          const bucket = options.bucket
          if (!bucket) {
            return yield* new CapabilityUnavailable({
              capability: CAPABILITY,
              reason: 'not_configured'
            })
          }
          const found = yield* findRow(input.exportId)
          yield* requireProduct(input.workspaceId)
          if (!found || found.row.workspaceId !== input.workspaceId) {
            return false
          }
          // Re-check the pending state before writing the object. A duplicate
          // or stale queue message must not overwrite a ready artifact (and a
          // cross-workspace message must not write under its guessed key).
          if (!(yield* pendingMatched(input.exportId, input.workspaceId))) {
            return false
          }
          const objectKey = objectKeyFor(input.workspaceId, input.exportId)
          // The object first: a row marked `ready` must point at bytes that
          // exist. A crash between the two leaves an orphan object the
          // lifecycle rule collects and a pending row the retry completes.
          yield* unavailable(
            Effect.tryPromise(() =>
              bucket.put(objectKey, input.archive, {
                httpMetadata: { contentType: 'application/gzip' }
              })
            )
          )
          const completedAt = yield* DateTime.now
          const expiresAt = workspaceExportExpiresAt(completedAt)
          const applied = yield* auditedMutation({
            matched: Effect.succeed(true),
            auditEvent: {
              workspaceId: input.workspaceId,
              actorUserId: null,
              actorType: 'system',
              eventType: 'workspace.export_completed',
              targetType: 'workspace_export',
              targetId: input.exportId,
              metadata: { sizeBytes: input.archive.length }
            },
            write: () => [
              db
                .update(workspaceExports)
                .set({
                  // Legal by the transition map: the WHERE clause pins the
                  // row to the pending status the bucket write just proved.
                  status: completedWorkspaceExportStatus,
                  objectKey,
                  sizeBytes: input.archive.length,
                  completedAt: DateTime.formatIso(completedAt),
                  expiresAt
                })
                .where(pendingWhere(input.exportId, input.workspaceId))
            ]
          })
          if (!applied) {
            return false
          }
          yield* feed.create({
            workspaceId: input.workspaceId,
            userId: found.row.requestedByUserId,
            kind: 'announcement',
            title: 'Workspace export ready',
            message: `Your export of ${found.workspace.name} is ready to download from workspace settings until ${expiresAt}.`,
            event: {
              type: 'workspace.export_ready',
              workspaceName: found.workspace.name,
              expiresAt
            }
          })
          return true
        }),
        fail: Effect.fn('WorkspaceExports.fail')(function* (
          input: FailWorkspaceExportInput
        ) {
          return yield* markFailed(input.exportId, input.workspaceId, input.reason)
        }),
        openDownload: Effect.fn('WorkspaceExports.openDownload')(function* (
          input: OpenWorkspaceExportDownloadInput
        ) {
          const bucket = options.bucket
          if (!bucket) {
            return Option.none()
          }
          const now = yield* DateTime.now
          const found = yield* findRow(input.exportId)
          if (found) {
            yield* requireProduct(found.row.workspaceId)
          }
          if (!found) {
            return Option.none()
          }
          const objectKey = found.row.objectKey
          if (
            objectKey === null ||
            !isWorkspaceExportDownloadable(toRecord(found.row), now)
          ) {
            return Option.none()
          }
          const valid = yield* verifyWorkspaceExportDownload({
            downloadSecret: found.row.downloadSecret,
            exportId: input.exportId,
            expires: input.expires,
            signature: input.signature,
            human: input.human,
            now
          })
          if (!valid) {
            return Option.none()
          }
          const object = yield* unavailable(
            Effect.tryPromise(() => bucket.get(objectKey))
          )
          if (object === null) {
            return Option.none()
          }
          const body = yield* unavailable(Effect.tryPromise(() => object.arrayBuffer()))
          yield* audit.record({
            workspaceId: found.row.workspaceId,
            ...workspaceExportDownloadAttribution(input.human),
            eventType: 'workspace.export_downloaded',
            targetType: 'workspace_export',
            targetId: found.row.id,
            metadata: {}
          })
          return Option.some({
            fileName: workspaceExportFileName(found.workspace.slug, found.row.id),
            sizeBytes: object.size,
            body: new Uint8Array(body)
          })
        })
      }
    })
  )
}
