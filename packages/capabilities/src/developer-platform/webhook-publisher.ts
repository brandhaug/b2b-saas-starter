import { currentTraceparent } from '@b2b-saas-starter/logger'
import { Database } from '@b2b-saas-starter/db/service'
import { webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { type CapabilityUnavailable } from '../errors.ts'
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
  // Deliberately an unchecked string, with no W3C pattern. A failed decode at
  // the consumer's queue boundary is treated as a malformed message and acked,
  // so a strict check here would turn a cosmetic trace defect into a silently
  // dropped webhook. The consumer's decoder (`parentSpanFromHeaders`) already
  // ignores a value it cannot parse and starts its own trace instead.
  traceparent: Schema.optionalKey(Schema.String),
  payload: Schema.Unknown
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
  readonly payload: unknown
}

export type WebhookPublisherInterface = {
  readonly publish: (
    input: PublishWebhookEventInput
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>
}

export class WebhookPublisher extends Context.Service<
  WebhookPublisher,
  WebhookPublisherInterface
>()('@b2b-saas-starter/capabilities/WebhookPublisher') {}

export const SeedWebhookPublisher: Layer.Layer<WebhookPublisher> = Layer.succeed(
  WebhookPublisher
)({
  publish: () => Effect.void
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
  return Effect.gen(function* () {
    const published = yield* Effect.result(publisher.publish(input))
    if (Result.isFailure(published)) {
      yield* Effect.void.pipe(
        Effect.annotateLogs({
          webhookPublish: 'failed',
          webhookPublishReason: published.failure.reason
        })
      )
    }
  })
}

const unavailable = orUnavailable('webhook-publisher')

/**
 * Adds the producing request's `traceparent` onto a queue message. The field
 * is an optional *key* on the wire schema, so it is only present when a span
 * exists (tests, direct calls run without one).
 */
function withTraceparent(
  message: WebhookQueueMessage,
  traceparent: string | undefined
): WebhookQueueMessage {
  if (traceparent === undefined) return message
  return { ...message, traceparent }
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
            if (!queue) return
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
            if (subscribed.length === 0) return
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
          })
      }
    })
  )
}
