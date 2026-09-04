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
import {
  consumeBatch,
  deliverWebhook,
  recordDeadLetter,
  runInvocation,
  type Env
} from './webhook-consumer.ts'

export default Sentry.withSentry((env: Env) => makeSentryOptions('background', env), {
  // Pure platform adapter: routing, signature checks, and Stripe processing
  // live in `stripe-endpoint.ts`, the same way queue logic stays out of here.
  // oxlint-disable-next-line effect/noAsyncFunction -- the Workers fetch handler contract is a plain async function; this is the platform adapter boundary
  async fetch(request: Request, env: Env): Promise<Response> {
    wireWideEventProviders(env)
    return handleStripeRequest(request, env)
  },

  // Queue message bodies are untyped at runtime; `processWebhookMessage` and
  // `processDeadLetterMessage` decode the envelope at their boundary. Both
  // consumers share one batch loop (`consumeBatch`); dead letters always ack.
  // The seat-sync branch routes on its own queue the same way, so its messages
  // never reach the webhook delivery reader.
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    wireWideEventProviders(env)
    if (batch.queue === webhookDeadLetterQueueName) {
      return consumeBatch(env, batch, (message) =>
        Effect.as(recordDeadLetter(message, env), 'ack')
      )
    }
    // Workspace export jobs (ADR 0055): build the archive into R2.
    if (batch.queue === workspaceExportQueueName) {
      return consumeBatch(env, batch, (message) => buildWorkspaceExport(message, env))
    }
    if (batch.queue === billingQueueName) {
      return consumeBatch(env, batch, (message) => deliverSeatSync(message, env))    }
    if (batch.queue === notificationEmailQueueName) {
      return consumeBatch(env, batch, (message) => sendNotificationEmail(message, env))
    }
    return consumeBatch(env, batch, (message) => deliverWebhook(message, env))
  },

  // The daily notification digest (ADR 0057): one cron trigger, declared in
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
