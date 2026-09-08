import { newCapabilityId } from '../internal/ids.ts'
import { currentTraceparent } from '@b2b-saas-starter/logger'
import { Database, type RawD1 } from '@b2b-saas-starter/db/service'
import { webhookDeliveries, webhookEndpoints } from '@b2b-saas-starter/db/schema'
import { Context, Effect, Layer, Result, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  CapabilityUnavailable,
  orUnavailable
} from '@b2b-saas-starter/failure/capability'
import { bestEffort } from '../internal/best-effort.ts'
import {
  makeQueuePublisher,
  type QueueSendBinding
} from '../internal/queue-publisher.ts'
import { withTraceparent } from '../internal/traceparent.ts'
import { WorkspaceContext } from '../workspace-context.ts'
import { type AuditEventLog } from '../governance/audit-event-log.ts'
import { makeLiveWebhookEnqueueFailure } from './webhook-enqueue-failure.live.ts'

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
  /** Stable across queue retries and transfer to the dead-letter queue. */
  deliveryId: Schema.String,
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
export type WebhookQueueBinding = QueueSendBinding<WebhookQueueMessage> & {
  readonly sendBatch: (
    messages: Iterable<{ readonly body: WebhookQueueMessage }>
  ) => Promise<void>
}

type PublishWebhookEventInput = {
  readonly eventType: string
  readonly payload: typeof Schema.Json.Type
}

/**
 * One addressed message for {@link WebhookPublisher.enqueue}: the operator
 * surface (replay, test send) already knows the exact endpoint, delivery row,
 * and payload, so there is nothing to fan out — the publisher only adds the
 * trace context and sends.
 */
type EnqueueWebhookMessageInput = {
  readonly endpointId: string
  readonly workspaceId: string
  readonly eventType: string
  readonly deliveryId: string
  readonly payload: typeof Schema.Json.Type
}

type WebhookPublisherInterface = {
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

export function LiveWebhookPublisher(
  queue?: WebhookQueueBinding
): Layer.Layer<WebhookPublisher, never, Database | RawD1 | AuditEventLog> {
  return Layer.effect(WebhookPublisher)(
    Effect.gen(function* () {
      const db = yield* Database
      const recordEnqueueFailure = yield* makeLiveWebhookEnqueueFailure

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
            const messages = yield* Effect.forEach(subscribed, (endpoint) =>
              Effect.gen(function* () {
                return {
                  body: withTraceparent(
                    {
                      endpointId: endpoint.id,
                      deliveryId: yield* newCapabilityId('whd'),
                      workspaceId: ctx.workspace.id,
                      eventType: input.eventType,
                      payload: input.payload
                    },
                    traceparent
                  )
                }
              })
            )
            // Fan-out used to create the delivery row only when the consumer
            // observed the message. That left deliveryId unauthenticated at
            // the queue boundary: a message could pair this workspace's
            // endpoint with another delivery id and payload, dispatching
            // before persistence rejected the mismatch. Reserve every
            // delivery before enqueueing so the consumer can bind all three
            // identities (delivery, endpoint, workspace) before releasing a
            // signing secret.
            yield* unavailable(
              db.insert(webhookDeliveries).values(
                messages.map(({ body }): typeof webhookDeliveries.$inferInsert => ({
                  id: body.deliveryId,
                  endpointId: body.endpointId,
                  eventType: body.eventType,
                  status: 'pending',
                  attempts: 0,
                  lastAttemptAt: null,
                  nextAttemptAt: null,
                  responseStatus: null,
                  payload: body.payload,
                  requestHeaders: null,
                  responseBody: null,
                  replayedFrom: null,
                  lastAttemptToken: null
                }))
              )
            )
            const enqueued = yield* Effect.result(
              unavailable(
                Effect.tryPromise({
                  try: () => queue.sendBatch(messages),
                  catch: (cause) => cause
                })
              )
            )
            if (Result.isFailure(enqueued)) {
              yield* Effect.annotateLogs({ webhookEnqueue: 'confirmation_failed' })(
                recordEnqueueFailure(messages).pipe(
                  Effect.catchTag('CapabilityUnavailable', (failure) =>
                    Effect.logError('webhook_enqueue_evidence_failed', failure).pipe(
                      Effect.annotateLogs({ webhookEnqueueEvidence: 'failed' })
                    )
                  )
                )
              )
              return yield* Effect.fail(enqueued.failure)
            }
          }),
        enqueue: (message) => {
          if (!queue) {
            return Effect.fail(
              new CapabilityUnavailable({
                capability: 'webhook-publisher',
                reason: 'not_configured; nothing enqueued'
              })
            )
          }
          return makeQueuePublisher(
            'webhook-publisher',
            queue,
            (input: EnqueueWebhookMessageInput) => ({
              endpointId: input.endpointId,
              workspaceId: input.workspaceId,
              eventType: input.eventType,
              payload: input.payload,
              deliveryId: input.deliveryId
            })
          )(message).pipe(
            Effect.mapError(
              () =>
                new CapabilityUnavailable({
                  capability: 'webhook-publisher',
                  reason: 'enqueue_not_confirmed'
                })
            )
          )
        }
      }
    })
  )
}
