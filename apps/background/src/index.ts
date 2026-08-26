import { verifyStripeSignature } from '@b2b-saas-starter/capabilities/src/billing/billing.ts'
import {
  makeSentryOptions,
  wireWideEventProviders
} from '@b2b-saas-starter/logger/src/providers.ts'
import * as Sentry from '@sentry/cloudflare'
import { Effect } from 'effect'
import { handleStripeWebhook } from './stripe-endpoint.ts'
import {
  consumeBatch,
  deliverWebhook,
  recordDeadLetter,
  runInvocation,
  type Env
} from './webhook-consumer.ts'

/** Queue name of the dead-letter consumer branch (see wrangler.jsonc). */
const DEAD_LETTER_QUEUE = 'b2b-saas-starter-webhooks-dlq'

export default Sentry.withSentry((env: Env) => makeSentryOptions('background', env), {
  // Inbound Stripe webhooks (see docs/integrations/stripe-billing.mdx). The
  // route verifies Stripe's signature scheme against `STRIPE_WEBHOOK_SECRET`
  // and applies subscription changes to `workspaces.planId` through the
  // billing capability — unset env degrades to a 503, never to an unverified
  // state change. Failures answer 500 so Stripe schedules a redelivery.
  // oxlint-disable-next-line effect/noAsyncFunction -- the Workers fetch handler contract is a plain async function; this is the platform adapter boundary
  async fetch(request: Request, env: Env): Promise<Response> {
    wireWideEventProviders(env)
    const { pathname } = new URL(request.url)
    if (pathname !== '/webhooks/stripe') {
      return new Response('Not found', { status: 404 })
    }
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 })
    }
    const secret = env.STRIPE_WEBHOOK_SECRET
    if (secret === undefined || secret.length === 0) {
      return Response.json({ error: 'billing_not_configured' }, { status: 503 })
    }
    // oxlint-disable-next-line effect/noAsyncFunction -- reading the raw body and verifying the HMAC are the handler's two awaits, both total here
    const payload = await request.text()
    // oxlint-disable-next-line effect/noAsyncFunction -- see above
    const valid = await verifyStripeSignature({
      secret,
      payload,
      header: request.headers.get('stripe-signature')
    })
    if (!valid) {
      return Response.json({ error: 'invalid_signature' }, { status: 400 })
    }
    return runInvocation(env, handleStripeWebhook(payload, env)).then(
      () => new Response(null, { status: 200 }),
      () => Response.json({ error: 'processing_failed' }, { status: 500 })
    )
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
