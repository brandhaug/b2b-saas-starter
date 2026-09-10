import { withTriggerScope } from '@b2b-saas-starter/logger'
import {
  makeSentryOptions,
  wireWideEventProviders,
  withCronMonitor
} from '@b2b-saas-starter/logger/providers'
import * as Sentry from '@sentry/cloudflare'
import { Effect, Result } from 'effect'
import { isMaintenanceMode } from '@b2b-saas-starter/env/server'
import {
  enforceSecureEndpoints,
  minimumTlsResponse
} from '@b2b-saas-starter/env/transport'
import { handleStripeRequest } from './stripe-endpoint.ts'
import { consumeBatch, runInvocation, type Env } from './queue-consumer.ts'
import { queueConsumerFor } from './queue-routing.ts'
import { scheduledRun, skipUnknownCron } from './scheduled-routing.ts'

/**
 * A batch from an unrecognized queue. Acking through the webhook consumer
 * would report every message as a malformed webhook, so the batch exits as one
 * annotated wide event instead: the messages ack (redelivery cannot conjure a
 * handler) and the queue name is on the event for the operator who bound it.
 */
function ackUnroutableBatch(env: Env, batch: MessageBatch<unknown>): Promise<void> {
  return runInvocation(
    env,
    withTriggerScope(
      {
        service: 'background',
        event: 'queue_unrouted',
        spanKind: 'consumer',
        env,
        metadata: { queue: batch.queue, messages: batch.messages.length }
      },
      Effect.gen(function* () {
        yield* Effect.annotateLogsScoped({
          outcome: 'failed',
          skipReason: 'unknown_queue'
        })
        yield* Effect.sync(() => {
          for (const message of batch.messages) {
            message.ack()
          }
        })
      })
    )
  )
}

function makeBackgroundSentryOptions(env: Env) {
  enforceSecureEndpoints(env)
  return makeSentryOptions('background', env)
}

export default Sentry.withSentry(makeBackgroundSentryOptions, {
  // Pure platform adapter: routing, signature checks, and Stripe processing
  // live in `stripe-endpoint.ts`, the same way queue logic stays out of here.
  // oxlint-disable-next-line effect/noAsyncFunction -- the Workers fetch handler contract is a plain async function; this is the platform adapter boundary
  async fetch(request: Request, env: Env): Promise<Response> {
    // Sentry deliberately skips its options callback for HEAD and OPTIONS.
    // Keep the gate at the actual Worker seam too, before provider wiring.
    enforceSecureEndpoints(env)
    const tlsResponse = minimumTlsResponse(request, env.ENVIRONMENT)
    if (tlsResponse !== undefined) {
      return tlsResponse
    }
    wireWideEventProviders(env)
    if (isMaintenanceMode(env.MAINTENANCE_MODE)) {
      return Response.json({ error: 'maintenance_mode' }, { status: 503 })
    }
    return handleStripeRequest(request, env)
  },

  // Queue message bodies are untyped at runtime; every consumer decodes the
  // envelope at its own boundary. All queues share one batch loop
  // (`consumeBatch`); dead letters ack, unless the terminal-row write itself
  // just failed — that one failure folds into a bounded retry so the
  // `dead_lettered` evidence is not lost to a store blip.
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    enforceSecureEndpoints(env)
    wireWideEventProviders(env)
    const consume = queueConsumerFor(batch.queue)
    if (consume === undefined) {
      return ackUnroutableBatch(env, batch)
    }
    return consumeBatch(env, batch, (message) => consume(message, env))
  },

  // The digest and billing-reconciliation cron triggers are declared in
  // `infra/bindings.ts`. Their work is selected by the platform cron string,
  // so the digest remains daily while the bounded billing repair pass runs
  // every minute (at most 25 workspaces per pass). Each failure rejects so the failed invocation is
  // visible to the worker's existing observability.
  scheduled(controller: ScheduledController, env: Env): Promise<void> {
    enforceSecureEndpoints(env)
    wireWideEventProviders(env)
    if (isMaintenanceMode(env.MAINTENANCE_MODE)) {
      return Effect.runPromise(Effect.void)
    }
    const run = scheduledRun(controller.cron, env, controller.scheduledTime)
    if (run === undefined) {
      return skipUnknownCron(env, controller)
    }
    return withCronMonitor(run.monitorSlug, () =>
      runInvocation(
        env,
        Effect.all(run.effects, { concurrency: 'unbounded', mode: 'result' }).pipe(
          Effect.flatMap((results) => {
            const failed = results.find(Result.isFailure)
            if (failed) {
              return Effect.fail(failed.failure)
            }
            return Effect.void
          })
        )
      )
    )
  }
})
