import { backoffSeconds } from '@b2b-saas-starter/capabilities/developer-platform/webhook-delivery-plan'
import {
  type WorkspaceExportBucketBinding,
  type WorkspaceExportQueueBinding
} from '@b2b-saas-starter/capabilities/governance/workspace-export'
import { type NotificationEmailQueueBinding } from '@b2b-saas-starter/capabilities/notifications/notification-email-queue'
import { type WebhookQueueBinding } from '@b2b-saas-starter/capabilities/developer-platform/webhook-publisher'
import { type SendEmailBinding } from '@b2b-saas-starter/email'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import {
  makeOtlpLayer,
  parentSpanFromHeaders,
  WideEventLoggerLive,
  withTriggerScope
} from '@b2b-saas-starter/logger'
import { Effect, Layer, ManagedRuntime, Result, type Schema, type Scope } from 'effect'
import { FetchHttpClient, type HttpClient } from 'effect/unstable/http'

/**
 * The vocabulary and the infrastructure every queue consumer in this worker
 * shares — everything that is not queue-specific, so consumers cannot drift
 * apart: the worker-wide `Env`, the per-invocation runtime, the batch loop
 * every queue rides on, and the consumer-entry combinator that folds one
 * decoded delivery into a wide event plus an ack/retry outcome. Each queue
 * keeps its own message schema, its own `read…Delivery` one-liner, and its
 * own `process…` orchestration (exported with requirements open for tests);
 * those live beside their consumer.
 */

// Bindings plus optional env. The same shape `ApiEnv` describes for apps/api.
export type Env = Partial<ServerEnv> & {
  readonly DB?: D1Database
  // The producer port, not workers-types' `Queue`: this worker only forwards
  // the binding to `starterEnv`, and every other worker declares it the same
  // way, so one structural shape describes the queue across all three.
  readonly WEBHOOK_QUEUE?: WebhookQueueBinding
  // Workspace export (ADR 0055): the job queue this worker consumes and the
  // bucket it writes archives to. Both absent when `WORKSPACE_EXPORT_BUCKET`
  // was unset at deploy time; the capability then reports unavailable.
  readonly WORKSPACE_EXPORT_QUEUE?: WorkspaceExportQueueBinding
  readonly WORKSPACE_EXPORT_BUCKET?: WorkspaceExportBucketBinding
  // Producer port for instant notification emails — this worker both consumes
  // the queue and produces onto it (webhook deliveries that gave up create a
  // Notification). Absent, Notifications persist and no instant email goes out.
  readonly NOTIFICATION_EMAIL_QUEUE?: NotificationEmailQueueBinding
  // Cloudflare Email send binding, for the notification emails. Absent, the
  // dispatcher logs instead of sending (CLAUDE.md rule 3).
  readonly EMAIL?: SendEmailBinding
}

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

// One fetch client and one logger set per isolate: neither performs I/O on
// behalf of a single invocation, so both are safe to memoize for the isolate's
// life — and cheaper than rebuilding them per queue batch or cron tick.
const staticRuntime = ManagedRuntime.make(
  Layer.mergeAll(FetchHttpClient.layer, WideEventLoggerLive)
)

/**
 * Runs one worker invocation. The exporter half of observability is the part
 * that must be per invocation: `local: true` builds it fresh so the OTLP
 * exporters flush before the handler's promise settles — a Worker may not
 * perform I/O on behalf of an invocation that already ended, so a per-isolate
 * exporter would go silent after its first flush (see `makeOtlpLayer`). It is
 * provided inside `staticRuntime`, so the console loggers are already in
 * context when the OTLP layer merges with them.
 */
export function runInvocation<A, E>(
  env: Env,
  effect: Effect.Effect<A, E, HttpClient.HttpClient>
) {
  return staticRuntime.runPromise(
    Effect.provide(effect, makeOtlpLayer('background', env), { local: true })
  )
}

/**
 * The one consumer-entry skeleton, shared by every queue handler: the decoded
 * delivery's trace continuation as the scope's parent, a `consumer`-kind wide
 * event carrying the attempt count, and one named fold for whatever still
 * escapes the program. The `program` arrives fully provided (layers, env) and
 * keeps its own requirements open, so a consumer like the webhook delivery —
 * whose `HttpClient` comes from the isolate runtime — rides through unchanged.
 *
 * The fold sits OUTSIDE `withTriggerScope` on purpose: the wide event must
 * exit with the failure and its cause before the cause is folded away into a
 * queue outcome.
 */
export function consumerInvocation<R>(
  env: Env,
  options: {
    readonly event: string
    readonly delivery: QueueDelivery<{ readonly traceparent?: string | undefined }>
    readonly program: Effect.Effect<DeliveryOutcome, unknown, R>
    /**
     * What the queue does with a message the invocation could not settle:
     * `'retry'` folds an escaped cause into `'retry'`, riding the queue's
     * backoff (every retryable consumer); `'ack'` folds it into `'ack'` — the
     * DLQ entry, where throwing or looping would silently lose dead letters.
     */
    readonly onFailure: 'retry' | 'ack'
  }
): Effect.Effect<DeliveryOutcome, never, Exclude<R, Scope.Scope>> {
  return withTriggerScope(
    {
      service: 'background',
      event: options.event,
      parent: queueParentSpan(options.delivery),
      spanKind: 'consumer',
      env,
      metadata: { attempts: options.delivery.attempts }
    },
    options.program
  ).pipe(
    Effect.catchCause(() => {
      // `_cause` is deliberately unused: the wide event above logged the
      // failure cause on exit, and the queue needs an outcome, not an
      // exception.
      if (options.onFailure === 'retry') {
        return Effect.succeed<DeliveryOutcome>('retry')
      }
      return Effect.succeed<DeliveryOutcome>('ack')
    })
  )
}

/**
 * One batch loop for every queue this worker consumes: run `perMessage` over
 * each message concurrently, then ack or retry (`backoffSeconds(attempts)`
 * delay) per its outcome. Callers whose outcome is already settled — the DLQ
 * entry folds its own — simply pass their entry through.
 */
export function consumeBatch(
  env: Env,
  batch: MessageBatch<unknown>,
  perMessage: (
    message: Message<unknown>
  ) => Effect.Effect<DeliveryOutcome, never, HttpClient.HttpClient>
): Promise<void> {
  return runInvocation(
    env,
    // The batch loop adds no requirements of its own, so the loop's context is
    // `perMessage`'s: `HttpClient`, which the isolate runtime's
    // FetchHttpClient provides. Consumers needing nothing still fit — an
    // `Effect<_, _, never>` is an `Effect<_, _, HttpClient>`.
    Effect.forEach(
      batch.messages,
      (message) =>
        perMessage(message).pipe(
          Effect.flatMap((outcome) =>
            Effect.sync(() => {
              if (outcome === 'ack') {
                message.ack()
              } else {
                message.retry({ delaySeconds: backoffSeconds(message.attempts) })
              }
            })
          )
        ),
      { concurrency: 'unbounded', discard: true }
    )
  )
}
