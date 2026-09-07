import { currentTraceparent } from '@b2b-saas-starter/logger'
import { Effect } from 'effect'

import {
  type CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { withTraceparent } from './traceparent.ts'

/**
 * The queue-port half every single-send producer below a capability shares:
 * build the message, stamp the producing request's trace context onto it, and
 * send it through the binding with a store failure mapped onto
 * `CapabilityUnavailable` — the recipe `SeatSyncPublisher.publish`,
 * `WebhookPublisher.enqueue`, and the export enqueue were three copies of.
 * (`WebhookPublisher.publish` batches and keeps its own `sendBatch` path.)
 *
 * Structural subset of Cloudflare's `Queue` binding so this package does not
 * depend on `@cloudflare/workers-types`.
 */
export type QueueSendBinding<Message> = {
  readonly send: (message: Message) => Promise<void>
}

/**
 * One `send` per input, provider-light: without a binding the returned
 * function no-ops instead of failing the mutation that produced the message —
 * local dev has no queue (CLAUDE.md rule 3).
 */
export function makeQueuePublisher<Message extends object, Input>(
  capability: string,
  queue: QueueSendBinding<Message> | undefined,
  buildMessage: (input: Input) => Message
): (input: Input) => Effect.Effect<void, CapabilityUnavailable> {
  const unavailable = orUnavailable(capability)
  return (input) =>
    Effect.gen(function* () {
      if (!queue) {
        return
      }
      // Absent outside a span (tests, direct calls); the consumer then starts
      // its own trace instead of continuing one (ADR 0050).
      const traceparent = yield* currentTraceparent
      yield* unavailable(
        Effect.tryPromise({
          try: () => queue.send(withTraceparent(buildMessage(input), traceparent)),
          catch: (cause) => cause
        })
      )
    })
}
