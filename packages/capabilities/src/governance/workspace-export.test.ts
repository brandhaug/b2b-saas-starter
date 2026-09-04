import { DateTime, Effect, Layer, Option } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { SeedLayer } from '../layers.ts'
import {
  demoMemberIdentity,
  demoUserIdentity,
  seedWorkspaceExportFixture,
  seedWorkspaceRecord
} from '../seed-fixture.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { testWorkspaceContext, type Actor } from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
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

      const events = (yield* audit.list()).events.filter(
        (event) => event.targetId === created.id
      )
      expect(events.map((event) => event.eventType).toSorted()).toEqual([
        'workspace.export_completed',
        'workspace.export_requested'
      ])

      const after = yield* feed.list
      expect(after).toHaveLength(before + 1)
      expect(after[0]?.title).toBe('Workspace export ready')
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
      expect(download.value.fileName).toBe(`starter-lab-export-${created.id}.zip`)
      expect(download.value.sizeBytes).toBe(created.sizeBytes)
      // ZIP local-header signature: PK\x03\x04.
      expect([...download.value.body.subarray(0, 4)]).toEqual([0x50, 0x4b, 3, 4])

      const events = (yield* audit.list()).events.filter(
        (event) => event.eventType === 'workspace.export_downloaded'
      )
      expect(events.some((event) => event.targetId === created.id)).toBe(true)
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
