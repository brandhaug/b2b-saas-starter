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
import { parentSpanFromHeaders, withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Result, Schema, type Scope } from 'effect'

import { type DeliveryOutcome } from './queue-consumer.ts'
import { type Env } from './webhook-consumer.ts'

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
 * The one compiled codec for the queue boundary. A malformed body is terminal
 * by construction — redelivery can never fix a body's shape — so it is
 * annotated and acked, exactly like the webhook consumer treats one.
 */
const decodeSeatSyncMessage = Schema.decodeUnknownResult(SeatSyncQueueMessage)

export type SeatSyncDelivery =
  | { readonly kind: 'message'; readonly message: typeof SeatSyncQueueMessage.Type }
  | { readonly kind: 'malformed' }

/** Decodes one queue envelope's untrusted body. The only decode per message. */
export function readSeatSyncDelivery(envelope: {
  readonly body: unknown
}): SeatSyncDelivery {
  const decoded = decodeSeatSyncMessage(envelope.body)
  if (Result.isFailure(decoded)) {
    return { kind: 'malformed' }
  }
  return { kind: 'message', message: decoded.success }
}

/**
 * Core of the seat-sync consumer: one message, one provider reconciliation.
 * Every no-op outcome (`no_subscription`, `quantity_unchanged`, …) acks —
 * they are honest answers, not failures — while a real `CapabilityUnavailable`
 * (Stripe unreachable or rejecting) propagates on the error channel, the same
 * shape `processStripeEvent` presents to its wrapper.
 */
function processSeatSyncCore(
  delivery: SeatSyncDelivery
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
 * The queue's contract: an outcome, never an exception. A provider failure
 * folds into `'retry'` so the queue's backoff takes over — the wide event
 * above already carries the failure cause.
 */
export function processSeatSyncMessage(
  delivery: SeatSyncDelivery
): Effect.Effect<DeliveryOutcome, never, Billing | Scope.Scope> {
  return processSeatSyncCore(delivery).pipe(
    Effect.catchCause(() => Effect.succeed<DeliveryOutcome>('retry'))
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
 * stamped onto the message. Failures already folded into `'retry'` above —
 * this wrapper only owns scope and layer provision.
 */
export function deliverSeatSync(
  envelope: { readonly body: unknown },
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readSeatSyncDelivery(envelope)
  // The same trace continuation the webhook consumers make: a decoded message
  // joins the trace the membership mutation stamped, anything else starts its
  // own — `parentSpanFromHeaders` treats an absent `traceparent` as no parent.
  let traceparent: string | undefined
  if (delivery.kind === 'message') {
    traceparent = delivery.message.traceparent
  }
  const parent = parentSpanFromHeaders({ traceparent })
  const program = processSeatSyncMessage(delivery).pipe(
    // The layer needs the billing env only — the seat path reads D1 and,
    // when configured, talks to Stripe directly (no HTTP client service).
    Effect.provide(selectCapabilitiesLayer(seatSyncEnv(env)))
  )
  return withTriggerScope(
    {
      service: 'background',
      event: 'seat_sync',
      parent,
      spanKind: 'consumer',
      env
    },
    program
  )
}
