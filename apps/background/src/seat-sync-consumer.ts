import { Billing } from '@b2b-saas-starter/capabilities/billing/billing'
import { billingOptionsFromEnv } from '@b2b-saas-starter/capabilities/billing/billing.live'
import {
  selectCapabilitiesLayer,
  starterEnv,
  type StarterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  SeatSyncQueueMessage,
  type SeatSyncReason
} from '@b2b-saas-starter/capabilities/billing/seat-sync'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { Effect, type Scope } from 'effect'

import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  readDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

/**
 * The seat-sync consumer: per-seat billing's half of the background worker.
 * Membership and invitation mutations enqueue `SeatSyncQueueMessage`s onto
 * `BILLING_QUEUE` (see `seat-sync.ts` in the capabilities package) so they
 * never await Stripe; this consumer hands each message to
 * `Billing.syncSeats`, which mirrors the member count onto the Stripe
 * subscription item's quantity and batches the `billing.seats_changed` audit
 * event with the stored-quantity update.
 */

/**
 * Core of the seat-sync consumer: one message, one provider reconciliation.
 * Every no-op outcome (`no_subscription`, `quantity_unchanged`, …) acks —
 * they are honest answers, not failures — while a real
 * `CapabilityUnavailable` (Stripe unreachable or rejecting) propagates on the
 * error channel for `consumerInvocation`'s `'retry'` fold, the same shape
 * `processWebhookMessage` presents to its wrapper. Exported with requirements
 * open for tests, like its siblings.
 */
export function processSeatSyncMessage(
  delivery: QueueDelivery<SeatSyncQueueMessage>
): Effect.Effect<DeliveryOutcome, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.as(
    Effect.gen(function* () {
      if (delivery.kind === 'malformed') {
        yield* Effect.annotateLogsScoped({
          outcome: 'skipped',
          skipReason: 'malformed_message'
        })
        return
      }
      const message = delivery.message
      yield* Effect.annotateLogsScoped({
        workspaceId: message.workspaceId,
        reason: message.reason satisfies SeatSyncReason
      })
      const billing = yield* Billing
      const result = yield* billing.syncSeats({
        workspaceId: message.workspaceId,
        reason: message.reason
      })
      // Two annotate calls rather than a conditional spread or a widened
      // dictionary: the quantity key exists only when a quantity was stored.
      yield* Effect.annotateLogsScoped({ outcome: result.outcome })
      if (result.quantity !== null) {
        yield* Effect.annotateLogsScoped({ quantity: result.quantity })
      }
    }),
    'ack' satisfies DeliveryOutcome
  )
}

/**
 * The env the seat path builds its capabilities layer from: the projected
 * bindings plus the Stripe bag, mapped through the shared
 * `billingOptionsFromEnv`. Absent, `syncSeats` answers
 * `provider_not_configured` instead of failing — the honest no-op.
 */
function seatSyncEnv(env: Env): StarterEnv {
  return {
    ...starterEnv(env),
    billing: billingOptionsFromEnv(env)
  }
}

/**
 * Consumer entry: wraps `processSeatSyncMessage` with the real capabilities
 * layer and a wide event, continuing the trace the membership mutation
 * stamped onto the message. A provider failure reaches the entry's
 * `onFailure: 'retry'` fold — the same contract every other consumer rides.
 */
export function deliverSeatSync(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(SeatSyncQueueMessage, envelope)
  return consumerInvocation(env, {
    event: 'seat_sync',
    delivery,
    onFailure: 'retry',
    program: processSeatSyncMessage(delivery).pipe(
      // The layer needs the billing env only — the seat path reads D1 and,
      // when configured, talks to Stripe directly (no HTTP client service).
      Effect.provide(selectCapabilitiesLayer(seatSyncEnv(env)))
    )
  })
}
