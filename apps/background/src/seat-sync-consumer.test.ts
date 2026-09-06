import {
  Billing,
  type SeatSyncResult
} from '@b2b-saas-starter/capabilities/billing/billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { SeatSyncQueueMessage } from '@b2b-saas-starter/capabilities/billing/seat-sync'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from '@effect/vitest'

import { processSeatSyncMessage } from './seat-sync-consumer.ts'
import {
  consumerInvocation,
  readDelivery,
  type DeliveryOutcome
} from './queue-consumer.ts'

/**
 * The seat-sync consumer against a recording `Billing` stub: the outcomes the
 * queue acts on. Sync decisions themselves are the capability's (covered in
 * `packages/capabilities/src/billing/billing.test.ts`); what this owns is the
 * boundary — malformed messages ack, honest no-ops ack, provider failures
 * reach the consumer entry's retry fold.
 */

type SyncCall = { readonly workspaceId: string; readonly reason: string }

function stubBilling(
  calls: Array<SyncCall>,
  result: () => Effect.Effect<SeatSyncResult, CapabilityUnavailable>
) {
  return Layer.succeed(Billing)({
    configured: Effect.succeed(false),
    currentPlan: Effect.die('not used here'),
    startCheckout: () => Effect.die('not used here'),
    startPortalSession: () => Effect.die('not used here'),
    applyProviderEvent: () => Effect.die('not used here'),
    applySubscriptionEvent: () => Effect.die('not used here'),
    syncSeats: (input: SyncCall) =>
      Effect.tap(result(), () => Effect.sync(() => calls.push(input)))
  })
}

function run(body: unknown, billing: Layer.Layer<Billing>) {
  return Effect.map(
    processSeatSyncMessage(
      readDelivery(SeatSyncQueueMessage, { id: 'qmsg_seat', body, attempts: 0 })
    ).pipe(Effect.provide(billing)),
    (outcome) => ({ outcome })
  )
}

const message = {
  kind: 'billing.seat_sync',
  workspaceId: 'wrk_starter',
  reason: 'member_added'
}

describe('readDelivery', () => {
  it('decodes a seat-sync message', () => {
    const delivery = readDelivery(SeatSyncQueueMessage, {
      id: 'qmsg_1',
      body: message,
      attempts: 1
    })
    expect(delivery.kind).toBe('message')
    if (delivery.kind === 'message') {
      expect(delivery.message.workspaceId).toBe('wrk_starter')
    }
  })

  it('reports a malformed body instead of throwing', () => {
    expect(
      readDelivery(SeatSyncQueueMessage, {
        id: 'qmsg_2',
        body: { nope: true },
        attempts: 1
      }).kind
    ).toBe('malformed')
    // A webhook delivery body is not a seat-sync body, even though it decodes
    // as an object — the `kind` discriminant is what the consumer trusts.
    expect(
      readDelivery(SeatSyncQueueMessage, {
        id: 'qmsg_3',
        body: { endpointId: 'wh_1', workspaceId: 'wrk_starter', payload: {} },
        attempts: 1
      }).kind
    ).toBe('malformed')
  })
})

describe('processSeatSyncMessage', () => {
  it.effect('acks an honest no-op outcome', () =>
    Effect.gen(function* () {
      const calls: Array<SyncCall> = []
      const { outcome } = yield* run(
        message,
        stubBilling(calls, () =>
          Effect.succeed({ outcome: 'no_subscription', quantity: null })
        )
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(calls).toEqual([{ workspaceId: 'wrk_starter', reason: 'member_added' }])
    })
  )

  it.effect('acks a synced outcome', () =>
    Effect.gen(function* () {
      const { outcome } = yield* run(
        message,
        stubBilling([], () => Effect.succeed({ outcome: 'synced', quantity: 5 }))
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
    })
  )

  it.effect('acks a malformed message without calling the capability', () =>
    Effect.gen(function* () {
      const calls: Array<SyncCall> = []
      const { outcome } = yield* run(
        { nope: true },
        stubBilling(calls, () => Effect.die('not reached'))
      )
      expect(outcome).toBe<DeliveryOutcome>('ack')
      expect(calls).toEqual([])
    })
  )

  it.effect('propagates a provider failure for the consumer entry to fold', () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        run(
          message,
          stubBilling([], () =>
            Effect.fail(
              new CapabilityUnavailable({
                capability: 'billing',
                reason: 'stripe request failed'
              })
            )
          )
        )
      )
      expect(error._tag).toBe('CapabilityUnavailable')
    })
  )

  it.effect("folds an escaped provider failure into the entry's retry outcome", () =>
    Effect.gen(function* () {
      // The fold in `consumerInvocation` — outside `withTriggerScope`, so
      // the wide event exits with the cause before it becomes an outcome —
      // went from dead code to the load-bearing path for every retryable
      // consumer when the per-consumer wrapper was deleted. Drive it
      // directly: a program that fails must answer `retry`.
      const outcome = yield* consumerInvocation(
        {},
        {
          event: 'seat_sync',
          delivery: readDelivery(SeatSyncQueueMessage, {
            id: 'qmsg_fold',
            body: message,
            attempts: 1
          }),
          program: Effect.fail(
            new CapabilityUnavailable({
              capability: 'billing',
              reason: 'stripe request failed'
            })
          ),
          onFailure: 'retry'
        }
      )
      expect(outcome).toBe<DeliveryOutcome>('retry')
    })
  )
})
