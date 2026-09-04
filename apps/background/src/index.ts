import {
  makeSentryOptions,
  wireWideEventProviders
} from '@b2b-saas-starter/logger/providers'
import * as Sentry from '@sentry/cloudflare'
import { Effect } from 'effect'
// The queue names are single-sourced in `infra/bindings.ts`, which alchemy and
// the wrangler generator read too — the consumer branch must key off the same
// literal the consumer is bound to.
import {
  billingQueueName,
  notificationEmailQueueName,
  webhookDeadLetterQueueName,
  workspaceExportQueueName
} from '../../../infra/bindings.ts'
import { buildWorkspaceExport } from './export-consumer.ts'
import { sendDailyDigest } from './notification-digest.ts'
import { sendNotificationEmail } from './notification-email-consumer.ts'
import { handleStripeRequest } from './stripe-endpoint.ts'
import { deliverSeatSync } from './seat-sync-consumer.ts'
import { deliverWebhook, recordDeadLetter } from './webhook-consumer.ts'
import { consumeBatch, runInvocation, type Env } from './queue-consumer.ts'

export default Sentry.withSentry((env: Env) => makeSentryOptions('background', env), {
  // Pure platform adapter: routing, signature checks, and Stripe processing
  // live in `stripe-endpoint.ts`, the same way queue logic stays out of here.
  // oxlint-disable-next-line effect/noAsyncFunction -- the Workers fetch handler contract is a plain async function; this is the platform adapter boundary
  async fetch(request: Request, env: Env): Promise<Response> {
    wireWideEventProviders(env)
    return handleStripeRequest(request, env)
  },

  // Queue message bodies are untyped at runtime; every consumer decodes the
  // envelope at its own boundary. All queues share one batch loop
  // (`consumeBatch`); dead letters ack, unless the terminal-row write itself
  // just failed — that one failure folds into a bounded retry so the
  // `dead_lettered` evidence is not lost to a store blip.
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    wireWideEventProviders(env)
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
    if (batch.queue === notificationEmailQueueName) {
      return consumeBatch(env, batch, (message) => sendNotificationEmail(message, env))
    }
    return consumeBatch(env, batch, (message) => deliverWebhook(message, env))
  },

  // The daily notification digest (ADR 0061): one cron trigger, declared in
  // `infra/bindings.ts` as `notificationDigestCron`. The run reads its window
  // from `Clock`, so the handler only forwards the platform's scheduled time
  // for the wide event. Sends are counted inside the run, so a rejection
  // means nothing went out; `sendDailyDigest` retries the reads before the
  // failure reaches this boundary, and a final failure rejects so the failed
  // cron invocation is recorded.
  scheduled(controller: ScheduledController, env: Env): Promise<void> {
    wireWideEventProviders(env)
    return runInvocation(
      env,
      Effect.asVoid(sendDailyDigest(env, controller.scheduledTime))
    )
  }
})
