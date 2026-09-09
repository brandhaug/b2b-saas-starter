import {
  makeSentryOptions,
  wireWideEventProviders,
  withCronMonitor
} from '@b2b-saas-starter/logger/providers'
import * as Sentry from '@sentry/cloudflare'
import { Effect, Result } from 'effect'
// The queue names are single-sourced in `infra/bindings.ts`, which alchemy and
// the wrangler generator read too — the consumer branch must key off the same
// literal the consumer is bound to.
import {
  billingQueueName,
  billingDeadLetterQueueName,
  billingReconciliationCron,
  retentionCleanupCron,
  notificationDigestCron,
  notificationDigestRetryCron,
  emailEventsQueueName,
  notificationEmailQueueName,
  webhookDeadLetterQueueName,
  workspaceExportQueueName
} from '../../../infra/bindings.ts'
import { isMaintenanceMode } from '@b2b-saas-starter/env/server'
import {
  enforceSecureEndpoints,
  minimumTlsResponse
} from '@b2b-saas-starter/env/transport'
import { buildWorkspaceExport } from './export-consumer.ts'
import { sendDailyDigest } from './notification-digest.ts'
import { reconcileBillingEffect } from './billing-reconciliation.ts'
import { sendNotificationEmail } from './notification-email-consumer.ts'
import { consumeEmailEvent } from './email-events-consumer.ts'
import { monitorOperationalHealth } from './monitoring.ts'
import { handleStripeRequest } from './stripe-endpoint.ts'
import { deliverSeatSync } from './seat-sync-consumer.ts'
import { recoverBillingDeadLetter } from './billing-dead-letter-consumer.ts'
import { deliverWebhook, recordDeadLetter } from './webhook-consumer.ts'
import { cleanRetention } from './retention.ts'
import { consumeBatch, runInvocation, type Env } from './queue-consumer.ts'

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
    if (
      batch.queue === emailEventsQueueName ||
      /^b2b-saas-starter-[a-z0-9_-]+-email-events$/.test(batch.queue)
    ) {
      return consumeBatch(env, batch, (message) => consumeEmailEvent(message, env))
    }
    if (batch.queue === webhookDeadLetterQueueName) {
      return consumeBatch(env, batch, (message) => recordDeadLetter(message, env))
    }
    // Workspace export jobs (ADR 0055): build the archive into R2.
    if (batch.queue === workspaceExportQueueName) {
      return consumeBatch(env, batch, (message) => buildWorkspaceExport(message, env))
    }
    if (batch.queue === billingQueueName) {
      return consumeBatch(env, batch, (message) => deliverSeatSync(message, env))
    }
    if (batch.queue === billingDeadLetterQueueName) {
      return consumeBatch(env, batch, (message) =>
        recoverBillingDeadLetter(message, env)
      )
    }
    if (batch.queue === notificationEmailQueueName) {
      return consumeBatch(env, batch, (message) => sendNotificationEmail(message, env))
    }
    return consumeBatch(env, batch, (message) => deliverWebhook(message, env))
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
    const daily = controller.cron === notificationDigestCron
    const reconciliation = controller.cron === billingReconciliationCron
    const retention = controller.cron === retentionCleanupCron
    let effects: Array<Effect.Effect<void, unknown, never>> = []
    if (daily) {
      effects = [Effect.asVoid(sendDailyDigest(env, controller.scheduledTime))]
    }
    if (retention) {
      effects = [cleanRetention(env, controller.scheduledTime)]
    }
    if (controller.cron === notificationDigestRetryCron) {
      effects = [
        ...effects,
        Effect.asVoid(sendDailyDigest(env, controller.scheduledTime))
      ]
    }
    if (reconciliation) {
      effects = [
        ...effects,
        reconcileBillingEffect(env, controller.scheduledTime),
        monitorOperationalHealth(env, controller.scheduledTime)
      ]
    }
    let monitorSlug = 'b2b-saas-starter-background-digest-retry'
    if (daily) {
      monitorSlug = 'b2b-saas-starter-background-digest'
    } else if (reconciliation) {
      monitorSlug = 'b2b-saas-starter-background-billing-reconciliation'
    } else if (retention) {
      monitorSlug = 'b2b-saas-starter-background-retention'
    }
    return withCronMonitor(monitorSlug, () =>
      runInvocation(
        env,
        Effect.all(effects, { concurrency: 'unbounded', mode: 'result' }).pipe(
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
