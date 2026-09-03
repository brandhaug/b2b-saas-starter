import { currentTraceparent } from '@b2b-saas-starter/logger'
import { Context, Effect, Layer, Result, Schema } from 'effect'

import { type CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'

/**
 * The seat-sync half of per-seat billing: the queue message, the producer
 * port, and the `SeatSyncPublisher` service membership and invitation
 * mutations call after their write. The consumer lives in
 * `apps/background` (`seat-sync-consumer.ts`) and hands the message to
 * `Billing.syncSeats`, so a membership mutation never awaits Stripe (see
 * `billing.ts`). Sibling of `developer-platform/webhook-publisher.ts` on
 * purpose: same shape, different queue.
 */

/**
 * Why one seat sync was enqueued. Rides onto the message and lands in the
 * `billing.seats_changed` audit metadata, so an operator reading the trail can
 * tell an invitation acceptance from a removal.
 */
// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
export const SEAT_SYNC_REASONS = [
  'member_added',
  'member_removed',
  'invitation_accepted'
] as const
export type SeatSyncReason = (typeof SEAT_SYNC_REASONS)[number]

const SeatSyncReasonSchema = Schema.Literals(SEAT_SYNC_REASONS)

/**
 * Message enqueued per membership-changing mutation. The background worker's
 * seat-sync consumer imports this schema, so producer and consumer share one
 * wire shape — the same contract `WebhookQueueMessage` holds for deliveries.
 * The `kind` discriminant names the billing queue's one message type, so the
 * queue can grow more billing work without a second decode becoming ambiguous.
 */
export const SeatSyncQueueMessage = Schema.Struct({
  kind: Schema.Literal('billing.seat_sync'),
  workspaceId: Schema.String,
  reason: SeatSyncReasonSchema,
  traceparent: Schema.optionalKey(Schema.String)
})
export type SeatSyncQueueMessage = typeof SeatSyncQueueMessage.Type

/**
 * Structural subset of Cloudflare's `Queue` binding so this package does not
 * depend on `@cloudflare/workers-types` — the same terms
 * `WebhookQueueBinding` is declared on. `send` only: seat sync enqueues one
 * message at a time, so there is no `sendBatch` to port.
 */
export type SeatSyncQueueBinding = {
  readonly send: (message: SeatSyncQueueMessage) => Promise<void>
}

export type SeatSyncPublisherInterface = {
  /**
   * Enqueues one seat sync for a workspace. Identity-keyed on the workspace
   * id rather than reading `WorkspaceContext`, because the invitation-accept
   * trigger has no context to read — the accepter is not a member until the
   * write this follows completes.
   */
  readonly publish: (input: {
    readonly workspaceId: string
    readonly reason: SeatSyncReason
  }) => Effect.Effect<void, CapabilityUnavailable>
}

export class SeatSyncPublisher extends Context.Service<
  SeatSyncPublisher,
  SeatSyncPublisherInterface
>()('@b2b-saas-starter/capabilities/SeatSyncPublisher') {}

export const SeedSeatSyncPublisher: Layer.Layer<SeatSyncPublisher> = Layer.succeed(
  SeatSyncPublisher
)({
  // No queue in the fixture: the seed Billing adapter simulates quantity
  // changes in memory (`SeedBilling.syncSeats`), which tests drive directly.
  publish: () => Effect.void
})

const unavailable = orUnavailable('seat-sync-publisher')

/**
 * Best-effort seat-sync trigger: a queue outage annotates the wide event but
 * never fails the membership mutation that produced it — the same contract
 * `publishWebhookEventWith` holds for webhook fan-out. Drift heals on the
 * next mutation and on the next `customer.subscription.updated` reconcile.
 */
export function publishSeatSyncWith(
  publisher: SeatSyncPublisherInterface,
  input: {
    readonly workspaceId: string
    readonly reason: SeatSyncReason
  }
): Effect.Effect<void> {
  return Effect.gen(function* () {
    const published = yield* Effect.result(publisher.publish(input))
    if (Result.isFailure(published)) {
      yield* Effect.void.pipe(
        Effect.annotateLogs({
          seatSyncPublish: 'failed',
          seatSyncPublishReason: published.failure.reason
        })
      )
    }
  })
}

/**
 * Adds the producing request's `traceparent` onto a queue message — the same
 * continuation the webhook publisher stamps, so the background consumer joins
 * the trace the membership mutation opened instead of starting an unrelated
 * one. Absent outside a span (tests, direct calls).
 */
function withTraceparent(
  message: SeatSyncQueueMessage,
  traceparent: string | undefined
): SeatSyncQueueMessage {
  if (traceparent === undefined) {
    return message
  }
  return { ...message, traceparent }
}

export function LiveSeatSyncPublisher(
  queue?: SeatSyncQueueBinding
): Layer.Layer<SeatSyncPublisher> {
  return Layer.succeed(SeatSyncPublisher)({
    publish: (input) =>
      Effect.gen(function* () {
        // Provider-light: without a queue binding the publisher no-ops
        // instead of failing the mutation — local dev has no queue.
        if (!queue) {
          return
        }
        const traceparent = yield* currentTraceparent
        yield* unavailable(
          Effect.tryPromise({
            try: () =>
              queue.send(
                withTraceparent(
                  {
                    kind: 'billing.seat_sync',
                    workspaceId: input.workspaceId,
                    reason: input.reason
                  },
                  traceparent
                )
              ),
            catch: (cause) => cause
          })
        )
      })
  })
}
