import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer, Option, Result, Schema } from 'effect'

import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'

import { SeedLayer } from '../layers.ts'
import { demoUserIdentity, seedWorkspaceRecord } from '../seed-fixture.ts'
import { Notification, NotificationFeed } from '../notifications/notification-feed.ts'
import { testWorkspaceContext } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { SeedWorkspaceExports } from './workspace-export.seed.ts'
import { WorkspaceExports } from './workspace-export.ts'

const ownerContext = testWorkspaceContext(seedWorkspaceRecord, {
  userId: demoUserIdentity.id,
  role: 'owner',
  systemRole: 'admin'
})
const dependencies = Layer.merge(SeedLayer, ownerContext)
const exportsLayer = SeedWorkspaceExports({ workspace: seedWorkspaceRecord })
const decodeNotifications = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.Struct({ notifications: Schema.Array(Notification) }))
)

describe('Seed Workspace Export generation', () => {
  it.effect('archives broadcasts and excludes private Notifications', () =>
    Effect.gen(function* () {
      const feed = yield* NotificationFeed
      const broadcast = yield* feed.create({
        workspaceId: seedWorkspaceRecord.id,
        userId: null,
        kind: 'announcement',
        title: 'Workspace announcement',
        message: 'This belongs in the Workspace archive.'
      })
      const personal = yield* feed.create({
        workspaceId: seedWorkspaceRecord.id,
        userId: demoUserIdentity.id,
        kind: 'announcement',
        title: 'Private account notice',
        message: 'This belongs only to the requesting Member.'
      })
      const exports = yield* WorkspaceExports
      const requested = yield* exports.request
      expect(requested.status).toBe('pending')
      const link = yield* exports.issueDownloadLink({
        exportId: requested.id,
        recipient: { type: 'api_token' }
      })
      if (Option.isNone(link)) {
        return expect.fail('expected the generated archive to have a download link')
      }
      const url = new URL(link.value.path, 'https://api.test')
      const download = yield* exports.openDownload({
        exportId: requested.id,
        expires: Number(url.searchParams.get('expires')),
        signature: url.searchParams.get('signature') ?? ''
      })
      if (Option.isNone(download)) {
        return expect.fail('expected the signed archive to download')
      }
      const body = download.value.body
      const json = yield* Effect.promise(() => {
        const compressed = new ReadableStream({
          start(controller) {
            controller.enqueue(body)
            controller.close()
          }
        })
        return new Response(
          compressed.pipeThrough(new DecompressionStream('gzip'))
        ).text()
      })
      const ids = decodeNotifications(json).notifications.map((notice) => notice.id)
      expect(ids).toContain(broadcast.id)
      expect(ids).not.toContain(personal.id)
    }).pipe(Effect.provide(exportsLayer), Effect.provide(dependencies))
  )

  it.effect(
    'settles an oversized audit trail as a failed export on the next read',
    () =>
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        // The documented archive walk is bounded at 2,500 audit events.
        for (let index = 0; index < 2501; index += 1) {
          yield* audit.record({
            workspaceId: seedWorkspaceRecord.id,
            actorUserId: demoUserIdentity.id,
            actorType: 'user',
            eventType: 'workspace.renamed',
            targetType: 'workspace',
            targetId: seedWorkspaceRecord.id,
            metadata: {}
          })
        }
        const exports = yield* WorkspaceExports
        const requested = yield* exports.request
        expect(requested.status).toBe('pending')
        const settled = (yield* exports.list).find((row) => row.id === requested.id)
        expect(settled?.status).toBe('failed')
        expect(settled?.failureReason).toBe(
          'unavailable: audit_trail_exceeds_export_walk_bound'
        )
        const failures = yield* audit.list({ eventType: 'workspace.export_failed' })
        expect(
          failures.items.filter((event) => event.targetId === requested.id)
        ).toHaveLength(1)
        expect(
          (yield* exports.list).find((row) => row.id === requested.id)?.status
        ).toBe('failed')
        expect(
          Option.isNone(
            yield* exports.issueDownloadLink({
              exportId: requested.id,
              recipient: { type: 'api_token' }
            })
          )
        ).toBe(true)
      }).pipe(Effect.provide(exportsLayer), Effect.provide(dependencies))
  )

  it.effect('retries deferred failure settlement after audit storage recovers', () => {
    const unavailableAudit = Layer.effect(AuditEventLog)(
      Effect.gen(function* () {
        const audit = yield* AuditEventLog
        let rejectFailureEvidence = true
        return AuditEventLog.of({
          ...audit,
          list: (input) => {
            if (input?.eventType) {
              return audit.list(input)
            }
            return Effect.fail(
              new CapabilityUnavailable({
                capability: 'audit-event-log',
                reason: 'snapshot_read_unavailable'
              })
            )
          },
          record: (input) => {
            if (
              input.eventType === 'workspace.export_failed' &&
              rejectFailureEvidence
            ) {
              rejectFailureEvidence = false
              return Effect.fail(
                new CapabilityUnavailable({
                  capability: 'audit-event-log',
                  reason: 'failure_evidence_unavailable'
                })
              )
            }
            return audit.record(input)
          }
        })
      })
    )
    return Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const audit = yield* AuditEventLog
      const requested = yield* exports.request
      const firstRead = yield* Effect.result(exports.list)
      expect(Result.isFailure(firstRead)).toBe(true)
      if (Result.isFailure(firstRead)) {
        expect(firstRead.failure).toMatchObject({
          _tag: 'CapabilityUnavailable',
          reason: 'failure_evidence_unavailable'
        })
      }
      const retried = (yield* exports.list).find((row) => row.id === requested.id)
      expect(retried?.status).toBe('failed')
      expect(retried?.failureReason).toBe('unavailable: snapshot_read_unavailable')
      yield* exports.list
      const evidence = yield* audit.list({ eventType: 'workspace.export_failed' })
      expect(
        evidence.items.filter((event) => event.targetId === requested.id)
      ).toHaveLength(1)
    }).pipe(
      Effect.provide(exportsLayer),
      Effect.provide(unavailableAudit),
      Effect.provide(dependencies)
    )
  })
})
