import { workspaceExports, workspaces } from '@b2b-saas-starter/db/schema'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { currentTraceparent } from '@b2b-saas-starter/logger'
import { DateTime, Effect, Layer, Option, Result } from 'effect'
import { and, desc, eq } from 'drizzle-orm'

import { CapabilityUnavailable } from '../errors.ts'
import { randomHex } from '../internal/crypto.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { auditedMutations } from './audited-mutation.ts'
import { workspaceExportFileName } from './workspace-export-archive.ts'
import {
  issueWorkspaceExportDownloadLink,
  isWorkspaceExportDownloadable,
  verifyWorkspaceExportDownload,
  workspaceExportExpiresAt,
  WorkspaceExports,
  type WorkspaceExport,
  type WorkspaceExportAvailability,
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding,
  type WorkspaceExportQueueMessage
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

/** The R2 key: one prefix per workspace, so a bucket listing groups by owner. */
function objectKeyFor(workspaceId: string, exportId: string): string {
  return `workspaces/${workspaceId}/${exportId}.zip`
}

/**
 * The provider-light gate. Both bindings are provisioned together by alchemy
 * when `WORKSPACE_EXPORT_BUCKET` is set, so a worker with one and not the other
 * is a deployment mistake worth naming.
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
    reason: `Workspace exports need an R2 bucket and a queue: set WORKSPACE_EXPORT_BUCKET at deploy time (this worker is missing ${missing.join(' and ')}).`
  }
}

/** The pending row a queue message names, scoped to its workspace. */
function pendingWhere(exportId: string, workspaceId: string) {
  return and(
    eq(workspaceExports.id, exportId),
    eq(workspaceExports.workspaceId, workspaceId),
    eq(workspaceExports.status, 'pending')
  )
}

function withTraceparent(
  message: WorkspaceExportQueueMessage,
  traceparent: string | undefined
): WorkspaceExportQueueMessage {
  if (traceparent === undefined) {
    return message
  }
  return { ...message, traceparent }
}

export function LiveWorkspaceExports(
  options: LiveWorkspaceExportsOptions = {}
): Layer.Layer<
  WorkspaceExports,
  never,
  Database | RawD1 | AuditEventLog | NotificationFeed
> {
  return Layer.effect(WorkspaceExports)(
    Effect.gen(function* () {
      const db = yield* Database
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const auditedMutation = yield* auditedMutations({
        prepareAuditRecord: audit.prepareRecord,
        unavailable
      })
      const availability = availabilityOf(options)

      function pendingMatched(exportId: string, workspaceId: string) {
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

      function markFailed(exportId: string, workspaceId: string, reason: string) {
        return unavailable(
          db
            .update(workspaceExports)
            .set({ status: 'failed', failureReason: reason })
            .where(pendingWhere(exportId, workspaceId))
        )
      }

      return {
        availability: Effect.succeed(availability),
        list: Effect.gen(function* () {
          const ctx = yield* WorkspaceContext
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceExports)
              .where(eq(workspaceExports.workspaceId, ctx.workspace.id))
              .orderBy(desc(workspaceExports.createdAt), desc(workspaceExports.id))
          )
          return rows.map(toRecord)
        }),
        request: Effect.gen(function* () {
          const queue = options.queue
          if (!availability.available || !queue) {
            return yield* new CapabilityUnavailable({
              capability: CAPABILITY,
              reason: 'not_configured'
            })
          }
          const ctx = yield* WorkspaceContext
          const id = yield* newCapabilityId('exp')
          const createdAt = DateTime.formatIso(yield* DateTime.now)
          const row = {
            id,
            workspaceId: ctx.workspace.id,
            requestedByUserId: ctx.actor?.userId ?? null,
            status: 'pending',
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
              workspaceId: ctx.workspace.id,
              actorUserId: ctx.actor?.userId ?? null,
              eventType: 'workspace.export_requested',
              targetType: 'workspace_export',
              targetId: id,
              metadata: {}
            },
            write: () => db.insert(workspaceExports).values(row)
          })
          const traceparent = yield* currentTraceparent
          const enqueued = yield* Effect.result(
            unavailable(
              Effect.tryPromise({
                try: () =>
                  queue.send(
                    withTraceparent(
                      {
                        exportId: id,
                        workspaceId: ctx.workspace.id,
                        workspaceSlug: ctx.workspace.slug
                      },
                      traceparent
                    )
                  ),
                catch: (cause) => cause
              })
            )
          )
          if (Result.isFailure(enqueued)) {
            yield* markFailed(id, ctx.workspace.id, 'enqueue_failed')
            return yield* enqueued.failure
          }
          return toRecord(row)
        }),
        issueDownloadLink: (input) =>
          Effect.gen(function* () {
            const ctx = yield* WorkspaceContext
            const found = yield* findRow(input.exportId)
            if (!found || found.row.workspaceId !== ctx.workspace.id) {
              return Option.none()
            }
            return yield* issueWorkspaceExportDownloadLink({
              downloadSecret: found.row.downloadSecret,
              record: toRecord(found.row),
              now: yield* DateTime.now
            })
          }),
        complete: (input) =>
          Effect.gen(function* () {
            const bucket = options.bucket
            if (!bucket) {
              return yield* new CapabilityUnavailable({
                capability: CAPABILITY,
                reason: 'not_configured'
              })
            }
            const found = yield* findRow(input.exportId)
            if (!found || found.row.workspaceId !== input.workspaceId) {
              return false
            }
            const objectKey = objectKeyFor(input.workspaceId, input.exportId)
            // The object first: a row marked `ready` must point at bytes that
            // exist. A crash between the two leaves an orphan object the
            // lifecycle rule collects and a pending row the retry completes.
            yield* unavailable(
              Effect.tryPromise({
                try: () =>
                  bucket.put(objectKey, input.archive, {
                    httpMetadata: { contentType: 'application/zip' }
                  }),
                catch: (cause) => cause
              })
            )
            const completedAt = yield* DateTime.now
            const expiresAt = workspaceExportExpiresAt(completedAt)
            const applied = yield* auditedMutation({
              matched: pendingMatched(input.exportId, input.workspaceId),
              auditEvent: {
                workspaceId: input.workspaceId,
                actorUserId: null,
                eventType: 'workspace.export_completed',
                targetType: 'workspace_export',
                targetId: input.exportId,
                metadata: { sizeBytes: input.archive.length }
              },
              write: () =>
                db
                  .update(workspaceExports)
                  .set({
                    status: 'ready',
                    objectKey,
                    sizeBytes: input.archive.length,
                    completedAt: DateTime.formatIso(completedAt),
                    expiresAt
                  })
                  .where(pendingWhere(input.exportId, input.workspaceId))
            })
            if (!applied) {
              return false
            }
            yield* feed.notify({
              workspaceId: input.workspaceId,
              userId: found.row.requestedByUserId,
              title: 'Workspace export ready',
              message: `Your export of ${found.workspace.name} is ready to download from workspace settings until ${expiresAt}.`
            })
            return true
          }),
        fail: (input) =>
          Effect.gen(function* () {
            const matched = yield* pendingMatched(input.exportId, input.workspaceId)
            if (!matched) {
              return false
            }
            yield* markFailed(input.exportId, input.workspaceId, input.reason)
            return true
          }),
        openDownload: (input) =>
          Effect.gen(function* () {
            const bucket = options.bucket
            if (!bucket) {
              return Option.none()
            }
            const now = yield* DateTime.now
            const found = yield* findRow(input.exportId)
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
              now
            })
            if (!valid) {
              return Option.none()
            }
            const object = yield* unavailable(
              Effect.tryPromise({
                try: () => bucket.get(objectKey),
                catch: (cause) => cause
              })
            )
            if (object === null) {
              return Option.none()
            }
            const body = yield* unavailable(
              Effect.tryPromise({
                try: () => object.arrayBuffer(),
                catch: (cause) => cause
              })
            )
            yield* audit.record({
              workspaceId: found.row.workspaceId,
              actorUserId: null,
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
