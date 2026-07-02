import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import { Database, webhookEndpoints } from '@b2b-saas-starter/db'
import type { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { WorkspaceContext } from '../workspace-context.ts'

/**
 * Message enqueued per endpoint. The queue consumer in `apps/background`
 * imports this schema, so producer and consumer share one wire shape.
 */
export const WebhookQueueMessage = Schema.Struct({
  endpointId: Schema.String,
  eventType: Schema.String,
  payload: Schema.Unknown
})
export type WebhookQueueMessage = typeof WebhookQueueMessage.Type

/**
 * Structural subset of Cloudflare's `Queue` binding so this package does not
 * depend on `@cloudflare/workers-types`. Results may resolve to anything
 * (workers-types returns `QueueSendResponse`); they are discarded.
 */
export type WebhookQueueBinding = {
  readonly send: (message: WebhookQueueMessage) => Promise<unknown>
  readonly sendBatch: (
    messages: Iterable<{ readonly body: WebhookQueueMessage }>
  ) => Promise<unknown>
}

export type PublishWebhookEventInput = {
  readonly eventType: string
  readonly payload: unknown
}

export type WebhookPublisherShape = {
  readonly publish: (
    input: PublishWebhookEventInput
  ) => Effect.Effect<void, CapabilityUnavailable, WorkspaceContext>
}

export class WebhookPublisher extends Context.Service<
  WebhookPublisher,
  WebhookPublisherShape
>()('@b2b-saas-starter/capabilities/WebhookPublisher') {}

export const SeedWebhookPublisher: Layer.Layer<WebhookPublisher> = Layer.succeed(
  WebhookPublisher
)({
  publish: () => Effect.void
})

const unavailable = orUnavailable('webhook-publisher')

export const LiveWebhookPublisher = (
  queue?: WebhookQueueBinding
): Layer.Layer<WebhookPublisher, never, Database> =>
  Layer.effect(WebhookPublisher)(
    Effect.gen(function* () {
      const db = yield* Database

      return {
        publish: (input) =>
          Effect.gen(function* () {
            // Provider-light: without a queue binding the publisher no-ops
            // instead of failing the app.
            if (!queue) return
            const ctx = yield* WorkspaceContext
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
              endpoint.events.includes(input.eventType)
            )
            if (subscribed.length === 0) return
            yield* unavailable(
              Effect.tryPromise({
                try: () =>
                  queue.sendBatch(
                    subscribed.map((endpoint) => ({
                      body: {
                        endpointId: endpoint.id,
                        eventType: input.eventType,
                        payload: input.payload
                      }
                    }))
                  ),
                catch: (cause) => cause
              })
            )
          })
      }
    })
  )
