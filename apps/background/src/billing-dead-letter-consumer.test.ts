import { Billing } from '@b2b-saas-starter/billing/billing'
import { SeatSyncQueueMessage } from '@b2b-saas-starter/billing/seat-sync'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { processBillingDeadLetterMessage } from './billing-dead-letter-consumer.ts'
import { readDelivery } from './queue-consumer.ts'

function stubBilling(calls: Array<string>): Layer.Layer<Billing> {
  return Layer.succeed(Billing)({
    configured: Effect.succeed(true),
    currentPlanForWorkspace: () => Effect.die('unused'),
    lifecycleStatus: Effect.die('unused'),
    displayedPlans: Effect.die('unused'),
    currentPlan: Effect.die('unused in billing DLQ tests'),
    synchronizationStatus: Effect.die('unused in billing DLQ tests'),
    processProviderEvent: () => Effect.die('unused in billing DLQ tests'),
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
      const delivery = readDelivery(SeatSyncQueueMessage, {
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
      const delivery = readDelivery(SeatSyncQueueMessage, {
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
})
