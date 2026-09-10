import { describe, expect, it } from '@effect/vitest'
import { Effect, Result } from 'effect'

import { SeedRetention } from './retention.seed.ts'
import { emptyCounts, Retention, type RetentionPolicy } from './retention.ts'
import { RETENTION_DEFAULTS, retentionPolicyDigest } from './retention-policy.ts'

const policy: RetentionPolicy = {
  ...RETENTION_DEFAULTS,
  target: 'seed-fixture',
  destructiveEnabled: false,
  recoveryVerified: false
}

describe('SeedRetention', () => {
  it.effect('is inert: it deletes nothing and reports no cutoffs', () =>
    Effect.gen(function* () {
      const retention = yield* Retention
      // The fixture has no store to age out of, so the Seed adapter answers
      // `inactive` rather than pretending to have swept one. A regression
      // here would let the operator console show a deletion count for a
      // deployment that never had a database.
      const modes: ReadonlyArray<'preview' | 'execute'> = ['preview', 'execute']
      for (const mode of modes) {
        const result = yield* retention.run({ mode, policy })
        expect(result.mode).toBe(mode)
        expect(result.status).toBe('inactive')
        expect(result.policyDigest).toBe(retentionPolicyDigest(policy))
        expect(result.cutoffs).toEqual({})
        expect(result.candidates).toEqual(emptyCounts())
        expect(result.deleted).toEqual(emptyCounts())
        expect(result.failed).toBe(0)
        expect(result.backlog).toBe(0)
        expect(result.records).toEqual([])
        expect(result.recovery).toEqual({ exports: 0, webhooks: 0, capped: false })
      }
    }).pipe(Effect.provide(SeedRetention))
  )

  it.effect('refuses a policy the shared validator rejects', () =>
    Effect.gen(function* () {
      const retention = yield* Retention
      expect(
        Result.isFailure(
          yield* Effect.result(
            retention.run({ mode: 'preview', policy: { ...policy, auditDays: 0 } })
          )
        )
      ).toBe(true)
    }).pipe(Effect.provide(SeedRetention))
  )

  it.effect('stamps the caller’s instant when one is given', () =>
    Effect.gen(function* () {
      const retention = yield* Retention
      const result = yield* retention.run({
        mode: 'preview',
        policy,
        // oxlint-disable-next-line effect/noGlobals -- fixed literal date, not a clock read; the interface takes a Date
        now: new Date('2026-09-07T12:00:00.000Z')
      })
      expect(result.evaluatedAt).toBe('2026-09-07T12:00:00.000Z')
    }).pipe(Effect.provide(SeedRetention))
  )
})
