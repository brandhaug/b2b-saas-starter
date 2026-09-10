import { Billing } from '@b2b-saas-starter/billing/billing'
import { BillingQueueMessage } from '@b2b-saas-starter/billing/seat-sync'
import { Effect, Layer, Logger } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import {
  boundedRecoveryOutcome,
  processBillingDeadLetterMessage,
  recoverBillingDeadLetter
} from './billing-dead-letter-consumer.ts'
import { consumerInvocation, readDelivery } from './queue-consumer.ts'

function stubBilling(
  calls: Array<string>,
  providerEvents: Array<string> = []
): Layer.Layer<Billing> {
  return Layer.succeed(Billing)({
    configured: Effect.succeed(true),
    currentPlanForWorkspace: () => Effect.die('unused'),
    lifecycleStatus: Effect.die('unused'),
    displayedPlans: Effect.die('unused'),
    currentPlan: Effect.die('unused in billing DLQ tests'),
    synchronizationStatus: Effect.die('unused in billing DLQ tests'),
    processProviderEvent: ({ providerEventId }) =>
      Effect.sync(() => {
        providerEvents.push(providerEventId)
        return { outcome: 'applied', providerEventId }
      }),
    recordProviderEvent: () => Effect.die('unused in billing DLQ tests'),
    reconcileWorkspace: ({ workspaceId }) =>
      Effect.sync(() => {
        calls.push(workspaceId)
        return { workspaceId, outcome: 'repaired', drift: [] }
      }),
    reconcileBatch: () => Effect.die('unused in billing DLQ tests'),
    startCheckout: () => Effect.die('unused in billing DLQ tests'),
    startPortalSession: () => Effect.die('unused in billing DLQ tests'),
    syncSeats: () => Effect.die('unused in billing DLQ tests')
  })
}

describe('processBillingDeadLetterMessage', () => {
  it.effect('reconciles an exhausted message before acknowledging it', () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const delivery = readDelivery(BillingQueueMessage, {
        id: 'billing-dlq-1',
        attempts: 1,
        body: {
          kind: 'billing.seat_sync',
          workspaceId: 'wrk_starter',
          reason: 'member_added'
        }
      })
      const outcome = yield* processBillingDeadLetterMessage(delivery).pipe(
        Effect.provide(stubBilling(calls))
      )
      expect(outcome).toBe('ack')
      expect(calls).toEqual(['wrk_starter'])
    })
  )

  it.effect('acknowledges malformed dead letters without provider work', () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const delivery = readDelivery(BillingQueueMessage, {
        id: 'billing-dlq-2',
        attempts: 1,
        body: { malformed: true }
      })
      const outcome = yield* processBillingDeadLetterMessage(delivery).pipe(
        Effect.provide(stubBilling(calls))
      )
      expect(outcome).toBe('ack')
      expect(calls).toEqual([])
    })
  )

  it.effect('processes a provider event dead letter before acknowledging', () =>
    Effect.gen(function* () {
      const calls: Array<string> = []
      const providerEvents: Array<string> = []
      const delivery = readDelivery(BillingQueueMessage, {
        id: 'billing-dlq-provider',
        attempts: 1,
        body: {
          kind: 'billing.provider_event',
          providerEventId: 'evt_dlq',
          eventType: 'customer.subscription.updated',
          workspaceId: 'wrk_starter'
        }
      })
      const outcome = yield* processBillingDeadLetterMessage(delivery).pipe(
        Effect.provide(stubBilling(calls, providerEvents))
      )
      expect(outcome).toBe('ack')
      expect(calls).toEqual([])
      expect(providerEvents).toEqual(['evt_dlq'])
    })
  )
})

/** The seat-sync dead letter every case below recovers, or fails to. */
const seatSyncBody = {
  kind: 'billing.seat_sync',
  workspaceId: 'wrk_starter',
  reason: 'member_added'
}

/**
 * A D1 binding whose every read rejects. The `Billing` layer the entry builds
 * for itself then answers `CapabilityUnavailable`, which is the failure the
 * bounded fold exists for; the test env configures Stripe so the entry selects
 * the live layer rather than the seed no-op.
 */
function unreachable(): Promise<never> {
  return Promise.reject(new Error('d1 unreachable'))
}
const unreachableStatement: D1PreparedStatement = {
  bind: () => unreachableStatement,
  all: unreachable,
  run: unreachable,
  first: unreachable,
  raw: unreachable
}
const unreachableSession: D1DatabaseSession = {
  prepare: () => unreachableStatement,
  batch: unreachable,
  getBookmark: () => null
}
const unreachableDatabase: D1Database = {
  prepare: () => unreachableStatement,
  batch: unreachable,
  exec: unreachable,
  dump: unreachable,
  withSession: () => unreachableSession
}

/**
 * The consumer's fold with a dying program: what a decode bug or an
 * unexpected throw looks like to `consumerInvocation`, folded through the very
 * arm the entry passes as its `onFailure`.
 */
function foldDefect(attempts: number) {
  return consumerInvocation(
    {},
    {
      event: 'billing_dead_letter',
      delivery: { id: 'billing-dlq-defect', attempts, kind: 'malformed' },
      program: Effect.die('unexpected throw'),
      onFailure: boundedRecoveryOutcome
    }
  )
}

/** The wide event's own annotations, before the logger's output allowlist. */
type CapturedEvent = {
  readonly message: unknown
  readonly annotations: Readonly<Record<string, unknown>>
}

function recoverWithUnreachableDatabase(attempts: number) {
  const events: Array<CapturedEvent> = []
  return recoverBillingDeadLetter(
    { id: `billing-dlq-a${attempts}`, body: seatSyncBody, attempts },
    { DB: unreachableDatabase, STRIPE_SECRET_KEY: 'sk_test_x' }
  ).pipe(
    Effect.provide(
      Logger.layer([
        Logger.map(Logger.formatStructured, (record) => {
          events.push({ message: record.message, annotations: record.annotations })
        })
      ])
    ),
    Effect.map((outcome) => ({ outcome, events }))
  )
}

describe('recoverBillingDeadLetter bounded fold', () => {
  it('retries while the platform will redeliver and acks the last attempt', () => {
    // maxRetries 1 on this queue: attempt 1 has a redelivery left, attempt 2
    // is the platform's last.
    expect(boundedRecoveryOutcome(1)).toBe('retry')
    expect(boundedRecoveryOutcome(2)).toBe('ack')
  })

  it.effect('retries a failed recovery on the first attempt', () =>
    Effect.gen(function* () {
      const { outcome, events } = yield* recoverWithUnreachableDatabase(1)
      expect(outcome).toBe('retry')
      expect(events).toHaveLength(1)
      expect(events[0]?.message).toBe('billing_dead_letter')
      expect(events[0]?.annotations).toMatchObject({
        event: 'billing_dead_letter',
        attempts: 1,
        outcome: 'retry',
        skipReason: 'recovery_failed'
      })
    })
  )

  it.effect('acks the last attempt with the unrecovered loss annotated', () =>
    Effect.gen(function* () {
      const { outcome, events } = yield* recoverWithUnreachableDatabase(2)
      expect(outcome).toBe('ack')
      expect(events[0]?.annotations).toMatchObject({
        event: 'billing_dead_letter',
        attempts: 2,
        outcome: 'unrecovered',
        skipReason: 'recovery_failed'
      })
    })
  )

  it.effect('acks a recovered dead letter', () =>
    Effect.gen(function* () {
      // No `DB`: the seed capability layer recovers the workspace inline.
      expect(
        yield* recoverBillingDeadLetter(
          { id: 'billing-dlq-ok', body: seatSyncBody, attempts: 1 },
          {}
        )
      ).toBe('ack')
    })
  )

  it.effect('folds a defect into the same bounded arm instead of acking it', () =>
    Effect.gen(function* () {
      // A decode bug or an unexpected throw arrives as a defect, which escapes
      // the typed `catchTag` above. It must not ack the dead letter on its
      // first delivery either — `consumerInvocation` folds it through the same
      // `boundedRecoveryOutcome` the entry passes.
      expect(yield* foldDefect(1)).toBe('retry')
      expect(yield* foldDefect(2)).toBe('ack')
    })
  )
})
