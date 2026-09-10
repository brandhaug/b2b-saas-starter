import { describe, expect, it } from '@effect/vitest'
import { Effect, Result, Schema } from 'effect'
import { SeedLayer } from '../layers.ts'
import { demoUserIdentity, seedWorkspaceRecord } from '../seed-fixture.ts'
import { PersonalDataExports } from './personal-data-export.ts'
import { PersonalDataExport } from './personal-data-export-archive.ts'
import { personalDataExportContractCases } from './personal-data-export.contract.ts'

const decodeArchive = Schema.decodeUnknownEffect(
  Schema.fromJsonString(PersonalDataExport)
)

// The Live half of this same list runs in `personal-data-export.live.test.ts`.
describe('seed personal data export contract', () => {
  const cases = personalDataExportContractCases(
    {
      userId: demoUserIdentity.id,
      sessionId: 'seed-owner-session',
      otherSessionId: 'seed-owner-other-session',
      otherUser: { userId: 'usr_dev', sessionId: 'seed-member-session' },
      unknownUserId: 'unknown-user',
      expected: {
        workspaceIds: [seedWorkspaceRecord.id],
        // The demo owner's own feed rows: the fixture's targeted
        // notifications belong to other members.
        notifications: [],
        sessionIds: ['ses_demo_local'],
        linkedAccountIds: ['acc_demo_github'],
        oauthClientIds: ['https://mcp-client.example.com/oauth/client-metadata.json'],
        oauthConsentIds: ['con_example_mcp'],
        passkeyIds: ['pky_demo_laptop']
      },
      // The fixture's other members and their private notification: the demo
      // owner's archive must carry none of it.
      secrets: ['A System Admin accessed your account', 'ops@example.com']
    },
    expect
  )
  for (const contractCase of cases) {
    it.effect(contractCase.name, () =>
      contractCase.assert.pipe(Effect.provide(SeedLayer))
    )
  }
})

describe('SeedPersonalDataExports', () => {
  it.effect('gives each member only the notifications addressed to them', () =>
    Effect.gen(function* () {
      const exports = yield* PersonalDataExports
      const memberReceipt = yield* exports.request('usr_dev', 'seed-member-session')
      const member = yield* decodeArchive(
        (yield* exports.download('usr_dev', 'seed-member-session', memberReceipt.id))
          .json
      ).pipe(Effect.orDie)
      expect(member.notifications).toEqual([
        expect.objectContaining({
          id: 'not_impersonation',
          workspaceId: seedWorkspaceRecord.id,
          read: false
        })
      ])
      const ownerReceipt = yield* exports.request('usr_demo', 'seed-owner-session')
      const owner = yield* decodeArchive(
        (yield* exports.download('usr_demo', 'seed-owner-session', ownerReceipt.id))
          .json
      ).pipe(Effect.orDie)
      expect(owner.notifications).toEqual([])
    }).pipe(Effect.provide(SeedLayer))
  )

  it.effect('exports an account that belongs to no workspace', () =>
    Effect.gen(function* () {
      const exports = yield* PersonalDataExports
      const receipt = yield* exports.request('usr_outsider', 'seed-outsider-session')
      const outsider = yield* decodeArchive(
        (yield* exports.download('usr_outsider', 'seed-outsider-session', receipt.id))
          .json
      ).pipe(Effect.orDie)
      expect(outsider.user).toMatchObject({
        name: 'No Workspaces',
        email: 'outsider@example.com',
        emailVerified: true,
        createdAt: '2026-05-16T08:00:00.000Z',
        updatedAt: '2026-05-16T08:00:00.000Z'
      })
      expect(outsider.workspaces).toEqual([])
      // No fixture artifacts for this account: the sections are present and
      // empty, exactly as Live reports an account with no rows.
      expect(outsider.sessions).toEqual([])
      expect(outsider.passkeys).toEqual([])
      expect(
        Result.isFailure(
          yield* Effect.result(exports.request('unknown-user', 'seed-session'))
        )
      ).toBe(true)
    }).pipe(Effect.provide(SeedLayer))
  )
})
