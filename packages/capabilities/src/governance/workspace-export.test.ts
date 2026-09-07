import { BillingAuditLayer, BillingNotificationLayer } from '../billing-adapters.ts'
import { DateTime, Effect, Layer, Option } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from '@effect/vitest'

import { SeedLayer } from '../layers.ts'
import {
  demoMemberIdentity,
  demoUserIdentity,
  seedMembers,
  seedWorkspaceExportFixture,
  seedWorkspaceRecord
} from '../seed-fixture.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  testWorkspaceContext,
  type WorkspaceContext,
  type Actor
} from '../workspace-context.ts'
import {
  AUDIT_EVENT_PAGE_SIZE,
  AuditEventLog,
  type SeedAuditEventRow,
  SeedAuditEventLog
} from './audit-event-log.ts'
import { SeedApiTokenRegistry } from '../developer-platform/api-token-registry.seed.ts'
import { SeedWebhookEndpoints } from '../developer-platform/webhook-endpoints.seed.ts'
import { SeedWebhookPublisher } from '../developer-platform/webhook-publisher.ts'
import { SeedNotificationFeed } from '../notifications/notification-feed.seed.ts'
import { SeedNotificationPreferences } from '../notifications/notification-preferences.ts'
import { SeedAccountPreferences } from './account-preferences.ts'
import { SeedSeatSyncPublisher } from '@b2b-saas-starter/billing/seat-sync'
import { SeedBilling } from '@b2b-saas-starter/billing/billing.seed'
import { SeedResourceEntitlements } from '@b2b-saas-starter/billing/resource-entitlements.seed'
import { makeSeedRoster, SeedWorkspaceMembership } from './workspace-membership.ts'
import { SeedWorkspaceInvitations } from './workspace-invitations.seed.ts'
import { failureTag } from '../internal/failure-tag.ts'
import {
  collectWorkspaceExportSnapshot,
  type WorkspaceExportSnapshotServices
} from './workspace-export-snapshot.ts'
import {
  issueWorkspaceExportDownloadLink,
  signWorkspaceExportDownload,
  verifyWorkspaceExportDownload,
  WORKSPACE_EXPORT_LINK_TTL_SECONDS,
  WorkspaceExports,
  workspaceExportExpiresAt
} from './workspace-export.ts'

const owner: Actor = {
  userId: demoUserIdentity.id,
  role: 'owner',
  systemRole: 'admin'
}

const member: Actor = {
  userId: demoMemberIdentity.id,
  role: 'member',
  systemRole: 'user'
}

const ownerLayer = Layer.merge(
  SeedLayer,
  testWorkspaceContext(seedWorkspaceRecord, owner)
)

/** Reads `expires` and `signature` back off an issued link's query string. */
function linkParams(path: string) {
  const url = new URL(path, 'https://api.test')
  return {
    expires: Number(url.searchParams.get('expires')),
    signature: url.searchParams.get('signature') ?? ''
  }
}

describe('SeedWorkspaceExports', () => {
  it.effect('starts with the fixture export ready and downloadable', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const listed = yield* exports.list
      expect(listed.map((row) => row.id)).toContain(seedWorkspaceExportFixture.id)
      const fixture = listed.find((row) => row.id === seedWorkspaceExportFixture.id)
      expect(fixture?.status).toBe('ready')
      expect(fixture?.sizeBytes).toBeGreaterThan(0)
      const link = yield* exports.issueDownloadLink({
        exportId: seedWorkspaceExportFixture.id
      })
      expect(Option.isSome(link)).toBe(true)
    }).pipe(Effect.provide(ownerLayer))
  )

  it.effect('refuses issue and open exactly at the artifact cutoff', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const fixture = (yield* exports.list).find(
        (row) => row.id === seedWorkspaceExportFixture.id
      )
      if (!fixture || fixture.expiresAt === null) {
        expect.fail('expected the seeded export horizon')
        return
      }
      const cutoff = DateTime.makeUnsafe(fixture.expiresAt)
      // Pin the test clock immediately before the pre-existing fixture's
      // horizon. The fixture is constructed by the layer before the test body.
      yield* TestClock.setTime(
        DateTime.toEpochMillis(DateTime.subtractDuration(cutoff, '1 millis'))
      )
      const link = yield* exports.issueDownloadLink({ exportId: fixture.id })
      if (Option.isNone(link)) {
        expect.fail('expected a link before the artifact cutoff')
        return
      }
      const params = linkParams(link.value.path)

      // The archive and its secret still exist; application validity is the
      // cutoff that matters even before asynchronous physical cleanup runs.
      yield* TestClock.setTime(DateTime.toEpochMillis(cutoff))
      expect(
        Option.isNone(yield* exports.issueDownloadLink({ exportId: fixture.id }))
      ).toBe(true)
      expect(
        Option.isNone(yield* exports.openDownload({ exportId: fixture.id, ...params }))
      ).toBe(true)
    }).pipe(Effect.provide(ownerLayer))
  )

  it.effect('reports available without any provider configuration', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      expect(yield* exports.availability).toEqual({ available: true })
    }).pipe(Effect.provide(ownerLayer))
  )

  it.effect('request lands ready, audits both steps, and notifies the requester', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const before = (yield* feed.list).length

      const created = yield* exports.request
      expect(created.status).toBe('ready')
      expect(created.completedAt).not.toBeNull()
      expect(created.expiresAt).not.toBeNull()
      expect(created.sizeBytes).toBeGreaterThan(0)

      const listed = yield* exports.list
      expect(listed[0]?.id).toBe(created.id)

      const events = (yield* audit.list()).items.filter(
        (event) => event.targetId === created.id
      )
      expect(events.map((event) => event.eventType).toSorted()).toEqual([
        'workspace.export_completed',
        'workspace.export_requested'
      ])

      const after = yield* feed.list
      expect(after).toHaveLength(before + 1)
      // The seed list orders by createdAt like Live's SQL, and the test clock
      // sits before the fixture rows — assert on the created row, not its
      // position.
      expect(
        after.some((notification) => notification.title === 'Workspace export ready')
      ).toBe(true)
    }).pipe(Effect.provide(ownerLayer))
  )

  it.effect('a link it issued opens the archive and audits the download', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const audit = yield* AuditEventLog
      const created = yield* exports.request
      const link = yield* exports.issueDownloadLink({ exportId: created.id })
      expect(Option.isSome(link)).toBe(true)
      if (Option.isNone(link)) {
        return
      }
      const params = linkParams(link.value.path)
      const download = yield* exports.openDownload({ exportId: created.id, ...params })
      expect(Option.isSome(download)).toBe(true)
      if (Option.isNone(download)) {
        return
      }
      expect(download.value.fileName).toBe(`starter-lab-export-${created.id}.json.gz`)
      expect(download.value.sizeBytes).toBe(created.sizeBytes)
      // Gzip magic bytes: 0x1f 0x8b.
      expect([...download.value.body.subarray(0, 2)]).toEqual([0x1f, 0x8b])

      const events = (yield* audit.list()).items.filter(
        (event) => event.eventType === 'workspace.export_downloaded'
      )
      expect(events.some((event) => event.targetId === created.id)).toBe(true)
      expect(events.find((event) => event.targetId === created.id)?.actorType).toBe(
        'user'
      )
    }).pipe(Effect.provide(ownerLayer))
  )

  it.effect('refuses a tampered or expired signature', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const created = yield* exports.request
      const link = yield* exports.issueDownloadLink({ exportId: created.id })
      if (Option.isNone(link)) {
        expect.fail('expected a link')
      }
      const params = linkParams(link.value.path)
      // Flip the last hex digit to one it is not — a fixed replacement would
      // leave the signature intact one time in sixteen.
      let flipped = '0'
      if (params.signature.endsWith('0')) {
        flipped = '1'
      }
      const tampered = yield* exports.openDownload({
        exportId: created.id,
        expires: params.expires,
        signature: `${params.signature.slice(0, -1)}${flipped}`
      })
      expect(Option.isNone(tampered)).toBe(true)
      const laterExpiry = yield* exports.openDownload({
        exportId: created.id,
        expires: params.expires + 60,
        signature: params.signature
      })
      expect(Option.isNone(laterExpiry)).toBe(true)
      const unknown = yield* exports.openDownload({
        exportId: 'exp_nope',
        ...params
      })
      expect(Option.isNone(unknown)).toBe(true)
    }).pipe(Effect.provide(ownerLayer))
  )

  it.effect('issues no link for an export of another workspace', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      const link = yield* exports.issueDownloadLink({
        exportId: seedWorkspaceExportFixture.id
      })
      expect(Option.isNone(link)).toBe(true)
    }).pipe(
      Effect.provide(
        Layer.merge(
          SeedLayer,
          testWorkspaceContext(
            { id: 'wrk_other', slug: 'other-lab', name: 'Other Lab', planId: 'team' },
            owner
          )
        )
      )
    )
  )

  it.effect('complete and fail only touch a pending row of their workspace', () =>
    Effect.gen(function* () {
      const exports = yield* WorkspaceExports
      // The fixture is already ready: neither transition applies.
      expect(
        yield* exports.complete({
          exportId: seedWorkspaceExportFixture.id,
          workspaceId: seedWorkspaceRecord.id,
          archive: new Uint8Array([1])
        })
      ).toBe(false)
      expect(
        yield* exports.fail({
          exportId: seedWorkspaceExportFixture.id,
          workspaceId: seedWorkspaceRecord.id,
          reason: 'nope'
        })
      ).toBe(false)
    }).pipe(
      Effect.provide(
        Layer.merge(SeedLayer, testWorkspaceContext(seedWorkspaceRecord, member))
      )
    )
  )
})

describe('signed download links', () => {
  const now = DateTime.makeUnsafe('2026-08-25T10:00:00.000Z')

  it.effect('verify accepts the issuer signature and rejects everything else', () =>
    Effect.gen(function* () {
      const expires = 1_800_000_000
      const signature = yield* signWorkspaceExportDownload('secret', 'exp_1', expires)
      expect(signature).toMatch(/^[0-9a-f]{64}$/)
      function verify(input: {
        readonly exportId?: string
        readonly expires?: number
        readonly signature?: string
        readonly downloadSecret?: string
      }) {
        return verifyWorkspaceExportDownload({
          downloadSecret: input.downloadSecret ?? 'secret',
          exportId: input.exportId ?? 'exp_1',
          expires: input.expires ?? expires,
          signature: input.signature ?? signature,
          now
        })
      }
      expect(yield* verify({})).toBe(true)
      expect(yield* verify({ exportId: 'exp_2' })).toBe(false)
      expect(yield* verify({ downloadSecret: 'other' })).toBe(false)
      expect(yield* verify({ signature: 'abc' })).toBe(false)
      // Already past: the link's own expiry is before `now`.
      expect(yield* verify({ expires: 1000 })).toBe(false)
      expect(yield* verify({ expires: Number.NaN })).toBe(false)
    })
  )

  it.effect(
    'a link expires after the TTL, or with the artifact if that is sooner',
    () =>
      Effect.gen(function* () {
        const completedAt = DateTime.makeUnsafe('2026-08-25T09:00:00.000Z')
        const record = {
          id: 'exp_1',
          status: 'ready',
          expiresAt: workspaceExportExpiresAt(completedAt)
        } satisfies Parameters<typeof issueWorkspaceExportDownloadLink>[0]['record']
        const link = yield* issueWorkspaceExportDownloadLink({
          downloadSecret: 'secret',
          record,
          now
        })
        if (Option.isNone(link)) {
          expect.fail('expected a link')
        }
        expect(link.value.expiresAt).toBe(
          DateTime.formatIso(
            DateTime.addDuration(now, `${WORKSPACE_EXPORT_LINK_TTL_SECONDS} seconds`)
          )
        )
        expect(link.value.path).toMatch(
          /^\/exports\/exp_1\/download\?expires=\d+&signature=[0-9a-f]{64}$/
        )

        const almostGone = yield* issueWorkspaceExportDownloadLink({
          downloadSecret: 'secret',
          record: { ...record, expiresAt: '2026-08-25T10:05:00.000Z' },
          now
        })
        if (Option.isNone(almostGone)) {
          expect.fail('expected a link')
        }
        expect(almostGone.value.expiresAt).toBe('2026-08-25T10:05:00.000Z')

        expect(
          Option.isNone(
            yield* issueWorkspaceExportDownloadLink({
              downloadSecret: 'secret',
              record: { ...record, status: 'pending' },
              now
            })
          )
        ).toBe(true)
        expect(
          Option.isNone(
            yield* issueWorkspaceExportDownloadLink({
              downloadSecret: 'secret',
              record: { ...record, expiresAt: '2026-08-25T09:59:59.000Z' },
              now
            })
          )
        ).toBe(true)
      })
  )
})

describe('collectWorkspaceExportSnapshot — the audit walk bound', () => {
  // The runaway guard of `walkKeysetPages`: 25 pages × the audit read's own
  // default page size. An export that hits it must refuse — a silently
  // partial archive would wear the README's "complete audit trail" promise.
  const BOUND = 25 * AUDIT_EVENT_PAGE_SIZE

  function auditRows(count: number): ReadonlyArray<SeedAuditEventRow> {
    return Array.from({ length: count }, (_, index) => ({
      id: `evt_${String(index).padStart(5, '0')}`,
      actorType: 'user',
      eventType: 'workspace.renamed',
      targetType: 'workspace',
      targetId: seedWorkspaceRecord.id,
      actor: 'Demo Admin',
      // oxlint-disable-next-line effect/noGlobals -- deterministic fixture timestamps: the rows need distinct millisecond positions, not the current time
      createdAt: new Date(Date.UTC(2026, 0, 1) + index).toISOString(),
      workspaceId: seedWorkspaceRecord.id,
      actorUserId: demoUserIdentity.id
    }))
  }

  /** The snapshot's service requirements over one staged audit log. */
  function layerOver(
    audit: Layer.Layer<AuditEventLog>
  ): Effect.Effect<Layer.Layer<WorkspaceContext | WorkspaceExportSnapshotServices>> {
    return Effect.map(makeSeedRoster(seedMembers), (roster) => {
      const feed = SeedNotificationFeed([]).pipe(
        Layer.provide(
          Layer.merge(
            SeedNotificationPreferences([]).pipe(Layer.provide(audit)),
            SeedAccountPreferences([]).pipe(Layer.provide(audit))
          )
        )
      )
      const billing = SeedBilling({
        workspacePlans: { [seedWorkspaceRecord.id]: 'team' }
      }).pipe(
        Layer.provide(BillingAuditLayer),
        Layer.provide(BillingNotificationLayer),
        Layer.provide(audit),
        Layer.provide(feed)
      )
      const entitlements = SeedResourceEntitlements().pipe(
        Layer.provide(BillingAuditLayer),
        Layer.provide(billing),
        Layer.provide(audit)
      )
      return Layer.mergeAll(
        audit,
        testWorkspaceContext(seedWorkspaceRecord),
        feed,
        billing,
        SeedApiTokenRegistry([]).pipe(
          Layer.provide(audit),
          Layer.provide(SeedWebhookPublisher),
          Layer.provide(SeedLayer),
          Layer.provide(entitlements)
        ),
        SeedWebhookEndpoints([]).pipe(
          Layer.provide(audit),
          Layer.provide(SeedWebhookPublisher),
          Layer.provide(SeedLayer),
          Layer.provide(entitlements),
          Layer.provide(feed)
        ),
        SeedWorkspaceInvitations({
          roster,
          workspace: seedWorkspaceRecord,
          seed: []
        }).pipe(Layer.provide(SeedSeatSyncPublisher)),
        SeedWorkspaceMembership(roster, seedWorkspaceRecord).pipe(
          Layer.provide(SeedSeatSyncPublisher)
        )
      )
    })
  }

  it.effect('collects every event when the trail sits exactly on the bound', () =>
    Effect.flatMap(layerOver(SeedAuditEventLog(auditRows(BOUND))), (layer) =>
      Effect.gen(function* () {
        const snapshot = yield* collectWorkspaceExportSnapshot({
          exportId: 'exp_at_bound',
          generatedAt: DateTime.makeUnsafe(0)
        })
        expect(snapshot.auditEvents).toHaveLength(BOUND)
      }).pipe(Effect.provide(layer))
    )
  )

  it.effect('refuses rather than truncating one event past the bound', () =>
    Effect.flatMap(layerOver(SeedAuditEventLog(auditRows(BOUND + 1))), (layer) =>
      Effect.gen(function* () {
        const outcome = yield* Effect.exit(
          collectWorkspaceExportSnapshot({
            exportId: 'exp_past_bound',
            generatedAt: DateTime.makeUnsafe(0)
          })
        )
        expect(failureTag(outcome)).toBe('CapabilityUnavailable')
      }).pipe(Effect.provide(layer))
    )
  )
})
