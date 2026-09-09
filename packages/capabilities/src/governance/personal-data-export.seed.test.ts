import { expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { SeedLayer } from '../layers.ts'
import { PersonalDataExports } from './personal-data-export.ts'
import { PersonalDataExport } from './personal-data-export-archive.ts'

const decodeArchive = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersonalDataExport)
)

it.effect(
  'includes the demo member personal notification without leaking it to the owner',
  () =>
    Effect.gen(function* () {
      const exports = yield* PersonalDataExports
      const memberReceipt = yield* exports.request('usr_dev', 'seed-member-session')
      const member = yield* decodeArchive(
        (yield* exports.download('usr_dev', 'seed-member-session', memberReceipt.id))
          .json
      )
      expect(member.notifications).toEqual([
        expect.objectContaining({
          id: 'not_impersonation',
          workspaceId: 'wrk_starter',
          read: false
        })
      ])
      const ownerReceipt = yield* exports.request('usr_demo', 'seed-owner-session')
      const owner = yield* decodeArchive(
        (yield* exports.download('usr_demo', 'seed-owner-session', ownerReceipt.id))
          .json
      )
      expect(owner.notifications).toEqual([])
      const outsiderReceipt = yield* exports.request(
        'usr_outsider',
        'seed-outsider-session'
      )
      const outsider = yield* decodeArchive(
        (yield* exports.download(
          'usr_outsider',
          'seed-outsider-session',
          outsiderReceipt.id
        )).json
      )
      expect(outsider.user).toMatchObject({
        name: 'No Workspaces',
        email: 'outsider@example.com',
        emailVerified: true,
        createdAt: '2026-05-16T08:00:00.000Z',
        updatedAt: '2026-05-16T08:00:00.000Z'
      })
      expect(outsider.workspaces).toEqual([])
      expect(
        Result.isFailure(
          yield* Effect.result(exports.request('unknown-user', 'seed-session'))
        )
      ).toBe(true)
    }).pipe(Effect.provide(SeedLayer))
)

it.effect('keeps seed artifacts private across calls and applies the same expiry', () =>
  Effect.gen(function* () {
    const receipt = yield* Effect.flatMap(PersonalDataExports, (exports) =>
      exports.request('usr_dev', 'seed-session')
    ).pipe(Effect.provide(SeedLayer))
    const download = yield* Effect.flatMap(PersonalDataExports, (exports) =>
      exports.download('usr_dev', 'seed-session', receipt.id)
    ).pipe(Effect.provide(SeedLayer))
    const data = yield* decodeArchive(download.json)
    expect(data.notifications).toEqual([
      expect.objectContaining({ id: 'not_impersonation', workspaceId: 'wrk_starter' })
    ])
    expect(
      Result.isFailure(
        yield* Effect.result(
          Effect.flatMap(PersonalDataExports, (exports) =>
            exports.download('usr_demo', 'seed-session', receipt.id)
          ).pipe(Effect.provide(SeedLayer))
        )
      )
    ).toBe(true)
    yield* TestClock.adjust('24 hours')
    expect(
      Result.isFailure(
        yield* Effect.result(
          Effect.flatMap(PersonalDataExports, (exports) =>
            exports.download('usr_dev', 'seed-session', receipt.id)
          ).pipe(Effect.provide(SeedLayer))
        )
      )
    ).toBe(true)
  })
)
