import { DateTime, Effect, Layer, Option, Result, Scope } from 'effect'

import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { newCapabilityId } from '../internal/ids.ts'

import {
  NotificationFeed,
  type NotificationFeedInterface
} from '../notifications/notification-feed.ts'
import { type SystemNotificationEvent } from '../notifications/notification-events.ts'
import { testWorkspaceContext, WorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog, type AuditEventLogInterface } from './audit-event-log.ts'
import { workspaceExportFileName } from './workspace-export-archive.ts'
import {
  buildWorkspaceExportArchiveEffect,
  workspaceExportGenerationEffect,
  type WorkspaceExportGenerationResult
} from './workspace-export-generation.ts'
import {
  workspaceExportSnapshotContextEffect,
  type WorkspaceExportSnapshotServices
} from './workspace-export-snapshot.ts'
import {
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
  type WorkspaceExportsInterface
} from './workspace-export.ts'
import { type Workspace } from './workspace-identity.ts'
import { WorkspaceSuspensionService } from './workspace-suspension.ts'

/**
 * A fixture export the Seed layer starts with: `ready`, with a deterministic
 * download secret, so the settings page and the download route have something
 * to show and serve before anyone clicks "Request export". Its timestamps are
 * offsets from the layer's construction time (read from `Clock`) so the
 * fixture stays downloadable on any day the demo runs.
 */
export type SeedWorkspaceExportFixture = {
  readonly id: string
  /** The requester — an owner of the fixture workspace. */
  readonly requestedByUserId: string
  readonly downloadSecret: string
  /** How long before "now" the export was requested. */
  readonly ageMs: number
  /** How long the build took; `completedAt = requestedAt + buildMs`. */
  readonly buildMs: number
}

type SeedExportRow = {
  record: WorkspaceExport
  readonly workspaceId: string
  readonly workspaceSlug: string
  /**
   * The workspace's name at request time, for the completion notification —
   * Live joins `workspaces` per row; the seed row carries its own copy so
   * `complete` does not name the fixture workspace for a row another
   * workspace's context created.
   */
  readonly workspaceName: string
  readonly requestedByUserId: string | null
  readonly downloadSecret: string
  archive: Uint8Array | null
  /**
   * The build the fixture owes this row, standing in for the queued job Live
   * hands a worker. `request` leaves it here and returns a `pending`
   * projection, exactly as Live does; the next read drains it, which is the
   * fixture's version of a worker that drained the queue immediately.
   * `null` once drained (or for a row that never had one).
   */
  deferredBuild: Effect.Effect<
    WorkspaceExportGenerationResult,
    CapabilityUnavailable
  > | null
}

/** Newest first, like Live's `ORDER BY created_at DESC`. */
function byRequestedAtDesc(a: SeedExportRow, b: SeedExportRow): number {
  if (a.record.requestedAt > b.record.requestedAt) {
    return -1
  }
  if (a.record.requestedAt < b.record.requestedAt) {
    return 1
  }
  return 0
}

function readyNotification(workspaceName: string, expiresAt: string) {
  return {
    title: 'Workspace export ready',
    message: `Your export of ${workspaceName} is ready to download from workspace settings until ${expiresAt}.`,
    event: {
      type: 'workspace.export_ready',
      workspaceName,
      expiresAt
    }
  } satisfies { title: string; message: string; event: SystemNotificationEvent }
}

/**
 * In-memory exports: the Seed adapter has no queue and no bucket, so
 * `request` leaves a pending row and drains the shared generation policy on
 * the next read. The archive is the same bytes the background worker writes.
 *
 * Depends on the read services because it takes the snapshot itself; Live
 * leaves that to the consumer. `layers.ts` provides the shared seed instances
 * so the archive reflects what the rest of the fixture shows.
 */
export function SeedWorkspaceExports(options: {
  readonly workspace: Workspace
  readonly fixture?: SeedWorkspaceExportFixture | undefined
}): Layer.Layer<
  WorkspaceExports,
  never,
  | AuditEventLog
  | NotificationFeed
  | WorkspaceExportSnapshotServices
  | WorkspaceSuspensionService
> {
  return Layer.effect(WorkspaceExports)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const snapshotContext = yield* workspaceExportSnapshotContextEffect()
      const suspension = yield* WorkspaceSuspensionService
      const scope = yield* Effect.scope
      function requireProduct(workspaceId: string) {
        return suspension.requireAllowed(workspaceId, 'product')
      }
      const rows: Array<SeedExportRow> = []

      if (options.fixture) {
        const now = yield* DateTime.now
        const requestedAt = DateTime.subtractDuration(
          now,
          `${options.fixture.ageMs} millis`
        )
        const completedAt = DateTime.addDuration(
          requestedAt,
          `${options.fixture.buildMs} millis`
        )
        // Seed reads never fail in practice; if one did, the fixture export
        // lands `failed` with the reason rather than failing layer construction
        // for every other capability.
        const built = yield* Effect.result(
          buildWorkspaceExportArchiveEffect({
            exportId: options.fixture.id,
            generatedAt: completedAt
          }).pipe(
            Effect.provide(snapshotContext),
            Effect.provide(testWorkspaceContext(options.workspace, null, 'system'))
          )
        )
        const base = {
          workspaceId: options.workspace.id,
          workspaceSlug: options.workspace.slug,
          workspaceName: options.workspace.name,
          requestedByUserId: options.fixture.requestedByUserId,
          downloadSecret: options.fixture.downloadSecret
        }
        if (Result.isSuccess(built)) {
          rows.push({
            ...base,
            record: {
              id: options.fixture.id,
              status: 'ready',
              requestedAt: DateTime.formatIso(requestedAt),
              completedAt: DateTime.formatIso(completedAt),
              expiresAt: workspaceExportExpiresAt(completedAt),
              sizeBytes: built.success.archive.length,
              failureReason: null
            },
            archive: built.success.archive,
            deferredBuild: null
          })
        } else {
          rows.push({
            ...base,
            record: {
              id: options.fixture.id,
              status: 'failed',
              requestedAt: DateTime.formatIso(requestedAt),
              completedAt: DateTime.formatIso(yield* DateTime.now),
              expiresAt: null,
              sizeBytes: null,
              failureReason: built.failure.reason
            },
            archive: null,
            deferredBuild: null
          })
        }
      }

      /**
       * Runs every build `request` deferred. Reads call this first, so a
       * caller that looks again sees what a drained queue would have left —
       * while `complete` and `fail` still find the row pending, the way they
       * would against a worker that has not got to it yet.
       */
      const drainDeferredBuilds = Effect.gen(function* () {
        for (const row of rows) {
          const build = row.deferredBuild
          if (build === null || row.record.status !== 'pending') {
            continue
          }
          yield* build
          row.deferredBuild = null
        }
      })

      function findPending(exportId: string, workspaceId: string) {
        return rows.find(
          (row) =>
            row.record.id === exportId &&
            row.workspaceId === workspaceId &&
            row.record.status === 'pending'
        )
      }

      const service: WorkspaceExportsInterface = {
        availability: Effect.fn('WorkspaceExports.availability')(() =>
          Effect.succeed({ available: true } satisfies WorkspaceExportAvailability)
        )(),
        list: Effect.fn('WorkspaceExports.list')(function* () {
          const ctx = yield* WorkspaceContext
          yield* requireProduct(ctx.workspace.id)
          yield* drainDeferredBuilds
          return rows
            .filter((row) => row.workspaceId === ctx.workspace.id)
            .toSorted(byRequestedAtDesc)
            .map((row) => row.record)
        })(),
        request: Effect.fn('WorkspaceExports.request')(function* () {
          const ctx = yield* WorkspaceContext
          yield* requireProduct(ctx.workspace.id)
          const id = yield* newCapabilityId('exp')
          const requestedAt = yield* DateTime.now
          const row: SeedExportRow = {
            record: {
              id,
              status: 'pending',
              requestedAt: DateTime.formatIso(requestedAt),
              completedAt: null,
              expiresAt: null,
              sizeBytes: null,
              failureReason: null
            },
            workspaceId: ctx.workspace.id,
            workspaceSlug: ctx.workspace.slug,
            workspaceName: ctx.workspace.name,
            requestedByUserId: ctx.actor?.userId ?? null,
            downloadSecret: yield* newCapabilityId('sec'),
            archive: null,
            deferredBuild: null
          }
          rows.push(row)
          yield* audit.record({
            workspaceId: ctx.workspace.id,
            actorUserId: ctx.actor?.userId ?? null,
            actorType: ctx.actorType,
            eventType: 'workspace.export_requested',
            targetType: 'workspace_export',
            targetId: id,
            metadata: {}
          })
          // The projection the caller is handed is the one Live hands back:
          // a `pending` export whose artifact does not exist yet. The
          // fixture has no queue, so the build waits here and the next read
          // drains it — the state a caller sees is the same either way.
          // The build reads the workspace's own data with a trusted system
          // context, rather than inheriting the next reader's actor.
          row.deferredBuild = workspaceExportGenerationEffect(() =>
            testWorkspaceContext(ctx.workspace, null, 'system')
          ).pipe(
            Effect.provide(snapshotContext),
            Effect.provideService(WorkspaceExports, service),
            Effect.provideService(WorkspaceSuspensionService, suspension),
            Effect.provideService(Scope.Scope, scope),
            Effect.flatMap((generation) =>
              generation.generate({
                message: {
                  exportId: id,
                  workspaceId: ctx.workspace.id,
                  workspaceSlug: ctx.workspace.slug
                },
                finalAttempt: true
              })
            )
          )
          return row.record
        })(),
        issueDownloadLink: Effect.fn('WorkspaceExports.issueDownloadLink')(function* (
          input: IssueWorkspaceExportDownloadInput
        ) {
          const ctx = yield* WorkspaceContext
          yield* drainDeferredBuilds
          const row = rows.find(
            (candidate) =>
              candidate.record.id === input.exportId &&
              candidate.workspaceId === ctx.workspace.id
          )
          if (!row) {
            return Option.none()
          }
          yield* requireProduct(ctx.workspace.id)
          return yield* issueWorkspaceExportDownloadLink({
            downloadSecret: row.downloadSecret,
            record: row.record,
            now: yield* DateTime.now,
            human: workspaceExportHumanRecipient(input.recipient, ctx.workspace.slug)
          })
        }),
        complete: Effect.fn('WorkspaceExports.complete')(function* (
          input: CompleteWorkspaceExportInput
        ) {
          const row = findPending(input.exportId, input.workspaceId)
          yield* requireProduct(input.workspaceId)
          if (!row) {
            return false
          }
          yield* completeRow(row, input.archive, yield* DateTime.now, audit, feed)
          return true
        }),
        fail: Effect.fn('WorkspaceExports.fail')(function* (
          input: FailWorkspaceExportInput
        ) {
          const row = findPending(input.exportId, input.workspaceId)
          if (!row) {
            return false
          }
          const completedAt = yield* DateTime.now
          // Record the evidence before changing the row so an unavailable
          // audit service leaves the deferred export pending for retry.
          yield* audit.record({
            workspaceId: row.workspaceId,
            actorUserId: null,
            actorType: 'system',
            eventType: 'workspace.export_failed',
            targetType: 'workspace_export',
            targetId: row.record.id,
            metadata: { reason: input.reason }
          })
          row.record = {
            ...row.record,
            status: 'failed',
            completedAt: DateTime.formatIso(completedAt),
            failureReason: input.reason
          }
          // The same event Live commits beside the transition: a settled
          // failure is the outcome an operator most needs a trail for.
          return true
        }),
        openDownload: Effect.fn('WorkspaceExports.openDownload')(function* (
          input: OpenWorkspaceExportDownloadInput
        ) {
          const now = yield* DateTime.now
          yield* drainDeferredBuilds
          const row = rows.find((candidate) => candidate.record.id === input.exportId)
          if (row) {
            yield* requireProduct(row.workspaceId)
          }
          if (
            !row ||
            row.archive === null ||
            !isWorkspaceExportDownloadable(row.record, now)
          ) {
            return Option.none()
          }
          const valid = yield* verifyWorkspaceExportDownload({
            downloadSecret: row.downloadSecret,
            exportId: input.exportId,
            expires: input.expires,
            signature: input.signature,
            human: input.human,
            now
          })
          if (!valid) {
            return Option.none()
          }
          let actorType: 'user' | 'api_token' = 'api_token'
          if (input.human) {
            actorType = 'user'
          }
          yield* audit.record({
            workspaceId: row.workspaceId,
            actorUserId: input.human?.userId ?? null,
            actorType,
            eventType: 'workspace.export_downloaded',
            targetType: 'workspace_export',
            targetId: row.record.id,
            metadata: {}
          })
          return Option.some({
            fileName: workspaceExportFileName(row.workspaceSlug, row.record.id),
            sizeBytes: row.archive.length,
            body: row.archive
          })
        })
      }
      return service
    })
  )
}

/** The shared "the archive is built" step of `request` and `complete`. */
function completeRow(
  row: SeedExportRow,
  archive: Uint8Array,
  completedAt: DateTime.Utc,
  audit: AuditEventLogInterface,
  feed: NotificationFeedInterface
): Effect.Effect<void, CapabilityUnavailable> {
  return Effect.gen(function* () {
    const expiresAt = workspaceExportExpiresAt(completedAt)
    row.archive = archive
    row.record = {
      ...row.record,
      status: 'ready',
      completedAt: DateTime.formatIso(completedAt),
      expiresAt,
      sizeBytes: archive.length
    }
    yield* audit.record({
      workspaceId: row.workspaceId,
      actorUserId: null,
      actorType: 'system',
      eventType: 'workspace.export_completed',
      targetType: 'workspace_export',
      targetId: row.record.id,
      metadata: { sizeBytes: archive.length }
    })
    yield* feed.create({
      workspaceId: row.workspaceId,
      userId: row.requestedByUserId,
      kind: 'announcement',
      ...readyNotification(row.workspaceName, expiresAt)
    })
  })
}
