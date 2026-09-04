import { currentTraceparent } from '@b2b-saas-starter/logger'
import { Database } from '@b2b-saas-starter/db/service'
import { webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { type CapabilityUnavailable } from '../errors.ts'
import { bestEffort } from '../internal/best-effort.ts'
import { withTraceparent } from '../internal/traceparent.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

/**
 * Message enqueued per endpoint. The queue consumer in `apps/background`
 * imports this schema, so producer and consumer share one wire shape.
 * `workspaceId` is stamped from the producing request's `WorkspaceContext`
 * and re-verified by `WebhookEndpoints.getDispatchTarget` before the
 * endpoint's signing secret is released to the consumer.
 */
export const WebhookQueueMessage = Schema.Struct({
  endpointId: Schema.String,
  workspaceId: Schema.String,
  eventType: Schema.String,
  /**
   * The delivery row this message drives. Present when the row already exists
   * (an operator replay or test send created it as `pending`); the consumer
   * records its attempts against this id instead of deriving one from the
   * queue message id. Absent on ordinary fan-out, where the consumer mints the
   * deterministic `whd_<message id>`.
   */
  deliveryId: Schema.optionalKey(Schema.String),
  // Deliberately an unchecked string, with no W3C pattern. A failed decode at
  // the consumer's queue boundary is treated as a malformed message and acked,
  // so a strict check here would turn a cosmetic trace defect into a silently
  // dropped webhook. The consumer's decoder (`parentSpanFromHeaders`) already
  // ignores a value it cannot parse and starts its own trace instead.
  traceparent: Schema.optionalKey(Schema.String),
  payload: Schema.Json
})
export type WebhookQueueMessage = typeof WebhookQueueMessage.Type

/**
 * Structural subset of Cloudflare's `Queue` binding so this package does not
 * depend on `@cloudflare/workers-types`.
 *
 * Resolving to `void`: the real binding resolves a `QueueSendResponse`, but this
 * package neither reads it nor wants it in the port's contract — enqueueing
 * either happened or rejected, and that is the whole signal the publisher acts
 * on. No worker env types its queue as workers-types' `Queue`; they all declare
 * this port, so nothing is assigned across the two shapes.
 */
export type WebhookQueueBinding = {
  readonly send: (message: WebhookQueueMessage) => Promise<void>
  readonly sendBatch: (
    messages: Iterable<{ readonly body: WebhookQueueMessage }>
  ) => Promise<void>
}

export type PublishWebhookEventInput = {
  readonly eventType: string
  readonly payload: typeof Schema.Json.Type
}

/**
 * One addressed message for {@link WebhookPublisher.enqueue}: the operator
 * surface (replay, test send) already knows the exact endpoint, delivery row,
 * and payload, so there is nothing to fan out — the publisher only adds the
 * trace context and sends.
 */
export type EnqueueWebhookMessageInput = {
  readonly endpointId: string
  readonly workspaceId: string
  readonly eventType: string
  readonly deliveryId?: string | undefined
  readonly payload: typeof Schema.Json.Type
}

export type WebhookPublisherInterface = {
  readonly publish: (
    input: PublishWebhookEventInput
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>

  /**
   * Sends one pre-addressed message (replay, test send). Unlike `publish`
   * there is no subscription filter to apply and no workspace to resolve —
   * the caller hands over the message it already assembled, so the interface
   * carries no `WorkspaceContext` requirement the queue path could not honor.
   */
  readonly enqueue: (
    input: EnqueueWebhookMessageInput
  ) => Effect.Effect<void, CapabilityUnavailable>
}

export class WebhookPublisher extends Context.Service<
  WebhookPublisher,
  WebhookPublisherInterface
>()('@b2b-saas-starter/capabilities/WebhookPublisher') {}

export const SeedWebhookPublisher: Layer.Layer<WebhookPublisher> = Layer.succeed(
  WebhookPublisher
)({
  publish: () => Effect.void,
  enqueue: () => Effect.void
})

/**
 * Best-effort fan-out to subscribed endpoints: a queue outage annotates the
 * wide event but never fails the mutation that produced the event. The
 * mutating capabilities call this with the publisher they were built with, so
 * `WebhookPublisher` never appears in any capability's interface — fan-out is
 * implementation detail below the seam, identical for every surface (REST,
 * MCP bearer flows, and the web app's session surface).
 */
export function publishWebhookEventWith(
  publisher: WebhookPublisherInterface,
  input: PublishWebhookEventInput
): Effect.Effect<void, never, WorkspaceContext> {
  return Effect.asVoid(
    bestEffort(publisher.publish(input), (failure) => ({
      webhookPublish: 'failed',
      webhookPublishReason: failure.reason
    }))
  )
}

const unavailable = orUnavailable('webhook-publisher')

/**
 * Stamps the pre-resolved delivery row onto an operator message. Schema types
 * are readonly, so the deliveryId variant is a new object rather than a
 * mutation of the base message.
 */
function withDeliveryId(
  message: WebhookQueueMessage,
  deliveryId: string | undefined,
  traceparent: string | undefined
): WebhookQueueMessage {
  if (deliveryId === undefined) {
    return withTraceparent(message, traceparent)
  }
  return withTraceparent({ ...message, deliveryId }, traceparent)
}

export function LiveWebhookPublisher(
  queue?: WebhookQueueBinding
): Layer.Layer<WebhookPublisher, never, Database> {
  return Layer.effect(WebhookPublisher)(
    Effect.gen(function* () {
      const db = yield* Database

      return {
        publish: (input) =>
          Effect.gen(function* () {
            // Provider-light: without a queue binding the publisher no-ops
            // instead of failing the app.
            if (!queue) {
              return
            }
            const ctx = yield* WorkspaceContext
            // Stamp the producing request's trace context onto the message so
            // the background consumer continues this trace instead of starting
            // an unrelated one. Absent outside a span (tests, direct calls).
            const traceparent = yield* currentTraceparent
            const endpoints = yield* unavailable(
              db
                .select({
                  id: webhookEndpoints.id,
                  events: webhookEndpoints.events
                })
                .from(webhookEndpoints)
                .where(
                  and(
                    eq(webhookEndpoints.workspaceId, ctx.workspace.id),
                    eq(webhookEndpoints.enabled, true)
                  )
                )
            )
            const subscribed = endpoints.filter((endpoint) =>
              endpoint.events.some((event) => event === input.eventType)
            )
            if (subscribed.length === 0) {
              return
            }
            yield* unavailable(
              Effect.tryPromise({
                try: () =>
                  queue.sendBatch(
                    subscribed.map((endpoint) => ({
                      body: withTraceparent(
                        {
                          endpointId: endpoint.id,
                          workspaceId: ctx.workspace.id,
                          eventType: input.eventType,
                          payload: input.payload
                        },
                        traceparent
                      )
                    }))
                  ),
                catch: (cause) => cause
              })
            )
          }),
        enqueue: (input) =>
          Effect.gen(function* () {
            // Same provider-light posture as `publish`: without a binding
            // there is nothing to send to, and the caller's row (a `pending`
            // delivery) still stands.
            if (!queue) {
              return
            }
            const traceparent = yield* currentTraceparent
            const message: WebhookQueueMessage = {
              endpointId: input.endpointId,
              workspaceId: input.workspaceId,
              eventType: input.eventType,
              payload: input.payload
            }
            yield* unavailable(
              Effect.tryPromise({
                try: () =>
                  queue.send(withDeliveryId(message, input.deliveryId, traceparent)),
                catch: (cause) => cause
              })
            )
          })
      }
    })
  )
}
