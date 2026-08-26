import {
  makeSentryOptions,
  wireWideEventProviders
} from '@b2b-saas-starter/logger/providers'
import * as Sentry from '@sentry/cloudflare'
import { Effect } from 'effect'
import { handleStripeRequest } from './stripe-endpoint.ts'
import {
  consumeBatch,
  deliverWebhook,
  recordDeadLetter,
  type Env
} from './webhook-consumer.ts'

/** Queue name of the dead-letter consumer branch (see wrangler.jsonc). */
const DEAD_LETTER_QUEUE = 'b2b-saas-starter-webhooks-dlq'

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
  queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    wireWideEventProviders(env)
    if (batch.queue === DEAD_LETTER_QUEUE) {
      return consumeBatch(env, batch, (message) =>
        Effect.as(recordDeadLetter(message, env), 'ack')
      )
    }
    return consumeBatch(env, batch, (message) => deliverWebhook(message, env))
  }
})
