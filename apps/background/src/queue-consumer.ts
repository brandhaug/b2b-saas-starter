import { parentSpanFromHeaders } from '@b2b-saas-starter/logger'
import { Result, type Schema } from 'effect'

/**
 * The vocabulary every queue consumer in this worker shares: the platform's
 * envelope, the one-decode boundary result, the ack/retry outcome, and the
 * trace continuation. Each queue keeps its own message schema and its own
 * `read…Delivery` one-liner; this module is everything that is not
 * queue-specific, so two consumers cannot drift apart.
 */

/**
 * Structural subset of a Cloudflare queue `Message`: the untrusted body plus
 * the attempt count and the message id. This is what the platform hands the
 * batch loop; `readQueueDelivery` turns it into the decoded delivery the
 * consumers work from.
 */
export type QueueEnvelope = {
  readonly id?: string | undefined
  readonly body: unknown
  readonly attempts: number
}

/**
 * One queue message after the boundary decode, which runs exactly once per
 * delivery: the platform's own fields plus either the decoded message or the
 * named terminal outcome `malformed`.
 *
 * `malformed` is terminal by construction — redelivery can never fix a body's
 * shape — so both consumers record it on the wide event and ack. The trace
 * continuation reads the same decode, so an undecodable body simply starts
 * its own trace.
 */
export type QueueDelivery<M> = {
  readonly id?: string | undefined
  readonly attempts: number
} & ({ readonly kind: 'message'; readonly message: M } | { readonly kind: 'malformed' })

/**
 * Folds the platform fields and the consumer's own boundary decode into the
 * one delivery both the consumer and the trace continuation read. Callers run
 * their compiled schema decoder (`Schema.decodeUnknownResult(SomeMessage)`)
 * over `envelope.body` and hand the result here.
 */
export function queueDelivery<M>(
  envelope: QueueEnvelope,
  decoded: Result.Result<M, Schema.SchemaError>
): QueueDelivery<M> {
  const platform = { id: envelope.id, attempts: envelope.attempts }
  if (Result.isFailure(decoded)) {
    return { ...platform, kind: 'malformed' }
  }
  return { ...platform, kind: 'message', message: decoded.success }
}

/**
 * The upstream trace to continue, if the producer stamped a `traceparent` on
 * the message. Reads the delivery the consumer already decoded; a malformed
 * body carries no trusted `traceparent`, so it simply starts its own trace.
 */
export function queueParentSpan<M extends { traceparent?: string | undefined }>(
  delivery: QueueDelivery<M>
) {
  if (delivery.kind === 'message') {
    return parentSpanFromHeaders({ traceparent: delivery.message.traceparent })
  }
  return parentSpanFromHeaders({})
}

/** What a consumer tells the batch loop to do with one message. */
export type DeliveryOutcome = 'ack' | 'retry'
