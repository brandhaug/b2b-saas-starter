import { describe, expect, it } from '@effect/vitest'
import { Effect, Logger } from 'effect'

import {
  billingReconciliationCron,
  notificationDigestCron,
  notificationDigestRetryCron,
  retentionCleanupCron
} from '../../../infra/bindings.ts'
import { scheduledRun, unknownCronEvent } from './scheduled-routing.ts'

/**
 * One cron expression selects one row: the work and the monitor slug come from
 * the same match, so a trigger can neither run another trigger's work nor
 * report success under another trigger's slug. Every expression here is the
 * literal `infra/bindings.ts` declares and alchemy deploys.
 */
type ScheduledRow = {
  readonly cron: string
  readonly monitorSlug: string
  readonly effects: number
}

const EXPECTED: ReadonlyArray<ScheduledRow> = [
  {
    cron: notificationDigestCron,
    monitorSlug: 'b2b-saas-starter-background-digest',
    effects: 1
  },
  {
    cron: notificationDigestRetryCron,
    monitorSlug: 'b2b-saas-starter-background-digest-retry',
    effects: 1
  },
  {
    cron: retentionCleanupCron,
    monitorSlug: 'b2b-saas-starter-background-retention',
    effects: 1
  },
  {
    cron: billingReconciliationCron,
    monitorSlug: 'b2b-saas-starter-background-billing-reconciliation',
    // The reconciliation pass and the operational-health snapshot.
    effects: 2
  }
]

describe('scheduledRun', () => {
  it('maps every declared cron to its work and its own monitor slug', () => {
    for (const row of EXPECTED) {
      const run = scheduledRun(row.cron, {}, 0)
      expect(run?.monitorSlug).toBe(row.monitorSlug)
      expect(run?.effects).toHaveLength(row.effects)
    }
  })

  it('gives each declared cron a distinct expression and slug', () => {
    expect(new Set(EXPECTED.map((row) => row.cron)).size).toBe(EXPECTED.length)
    expect(new Set(EXPECTED.map((row) => row.monitorSlug)).size).toBe(EXPECTED.length)
  })

  it('claims no work — and so no monitor slug — for an undeclared cron', () => {
    // With no match there is no slug for `withCronMonitor`, which is what
    // keeps an unrecognized tick from checking in as the digest retry.
    expect(scheduledRun('13 13 13 13 13', {}, 0)).toBeUndefined()
    expect(scheduledRun('', {}, 0)).toBeUndefined()
  })

  it.effect('an undeclared cron exits as its own annotated skip event', () =>
    Effect.gen(function* () {
      const events: Array<{
        readonly message: unknown
        readonly annotations: Readonly<Record<string, unknown>>
      }> = []
      yield* unknownCronEvent(
        {},
        { cron: '13 13 13 13 13', scheduledTime: 1_757_500_000_000, noRetry: () => {} }
      ).pipe(
        Effect.provide(
          Logger.layer([
            Logger.map(Logger.formatStructured, (record) => {
              events.push({ message: record.message, annotations: record.annotations })
            })
          ])
        )
      )
      expect(events).toHaveLength(1)
      expect(events[0]?.message).toBe('scheduled_unrouted')
      expect(events[0]?.annotations).toMatchObject({
        event: 'scheduled_unrouted',
        outcome: 'failed',
        skipReason: 'unknown_cron',
        cron: '13 13 13 13 13',
        scheduledTime: 1_757_500_000_000
      })
    })
  )
})
