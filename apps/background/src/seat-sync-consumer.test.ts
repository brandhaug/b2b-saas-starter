import {
  Billing,
  type SeatSyncResult
} from '@b2b-saas-starter/capabilities/billing/billing'
import { CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { Effect, Layer } from 'effect'
import { describe, expect, it } from 'vite-plus/test'

import { processSeatSyncMessage, readSeatSyncDelivery } from './seat-sync-consumer.ts'
import { type DeliveryOutcome } from './queue-consumer.ts'

/**
 * The seat-sync consumer against a recording `Billing` stub: the outcomes the
 * queue acts on. Sync decisions themselves are the capability's (covered in
 * `packages/capabilities/src/billing/billing.test.ts`); what this owns is the
 * boundary — malformed messages ack, honest no-ops ack, provider failures
 * fold into a retry.
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
    Effect.scoped(
      processSeatSyncMessage(readSeatSyncDelivery({ body })).pipe(
        Effect.provide(billing)
      )
    ),
    (outcome) => ({ outcome })
  )
}

const message = {
  kind: 'billing.seat_sync',
  workspaceId: 'wrk_starter',
  reason: 'member_added'
}

describe('readSeatSyncDelivery', () => {
  it('decodes a seat-sync message', () => {
    const delivery = readSeatSyncDelivery({ body: message })
    expect(delivery.kind).toBe('message')
    if (delivery.kind === 'message') {
      expect(delivery.message.workspaceId).toBe('wrk_starter')
    }
  })

  it('reports a malformed body instead of throwing', () => {
    expect(readSeatSyncDelivery({ body: { nope: true } }).kind).toBe('malformed')
    // A webhook delivery body is not a seat-sync body, even though it decodes
    // as an object — the `kind` discriminant is what the consumer trusts.
    expect(
      readSeatSyncDelivery({
        body: { endpointId: 'wh_1', workspaceId: 'wrk_starter', payload: {} }
      }).kind
    ).toBe('malformed')
  })
})

describe('processSeatSyncMessage', () => {
  it('acks an honest no-op outcome', () =>
    Effect.runPromise(
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
    ))

  it('acks a synced outcome', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { outcome } = yield* run(
          message,
          stubBilling([], () => Effect.succeed({ outcome: 'synced', quantity: 5 }))
        )
        expect(outcome).toBe<DeliveryOutcome>('ack')
      })
    ))

  it('acks a malformed message without calling the capability', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const calls: Array<SyncCall> = []
        const { outcome } = yield* run(
          { nope: true },
          stubBilling(calls, () => Effect.die('not reached'))
        )
        expect(outcome).toBe<DeliveryOutcome>('ack')
        expect(calls).toEqual([])
      })
    ))

  it('folds a provider failure into a retry so the queue backs off', () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const { outcome } = yield* run(
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
        expect(outcome).toBe<DeliveryOutcome>('retry')
      })
    ))
})
