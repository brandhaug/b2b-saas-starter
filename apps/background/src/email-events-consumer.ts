import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import {
  EmailDelivery,
  type EmailProviderEvent
} from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/errors'
import { type ServerEnv } from '@b2b-saas-starter/env/server'
import { Effect, Metric, Schema, type Scope } from 'effect'

import {
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  readDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

/** The Cloudflare Email Sending event envelope published to the queue. */
export const CloudflareEmailSendingEvent = Schema.Struct({
  type: Schema.String,
  source: Schema.Struct({
    type: Schema.String,
    domain: Schema.String
  }),
  payload: Schema.Struct({
    eventId: Schema.String,
    messageId: Schema.String,
    sender: Schema.String,
    recipient: Schema.String,
    terminal: Schema.Boolean,
    delivery: Schema.Struct({ status: Schema.String }),
    bounce: Schema.optional(Schema.Struct({ type: Schema.Literals(['hard', 'soft']) })),
    rejection: Schema.optional(Schema.Struct({ reason: Schema.String }))
  }),
  metadata: Schema.Struct({ eventTimestamp: Schema.String }),
  traceparent: Schema.optional(Schema.String)
})
export type CloudflareEmailSendingEvent = typeof CloudflareEmailSendingEvent.Type

const emailEventCount = Metric.counter('starter.email.events', {
  description: 'Cloudflare Email Sending events consumed by outcome.',
  incremental: true
})

function recordEventMetric(outcome: string): Effect.Effect<void> {
  return Metric.update(Metric.withAttributes(emailEventCount, { outcome }), 1)
}

function normalized(value: string): string {
  return value.trim().toLowerCase()
}

function senderDomain(sender: string): string | undefined {
  const at = sender.lastIndexOf('@')
  if (at < 1 || at === sender.length - 1) {
    return undefined
  }
  return normalized(sender.slice(at + 1))
}

function isTrustedEvent(
  event: CloudflareEmailSendingEvent,
  configuredFrom: string
): boolean {
  const configuredDomain = senderDomain(configuredFrom)
  return (
    event.source.type === 'email.sending' &&
    configuredDomain !== undefined &&
    normalized(event.source.domain) === configuredDomain &&
    normalized(event.payload.sender) === normalized(configuredFrom)
  )
}

type NormalizedProviderOutcome = Pick<EmailProviderEvent, 'status'> &
  Partial<Pick<EmailProviderEvent, 'reason'>>

function providerOutcome(
  event: CloudflareEmailSendingEvent
): NormalizedProviderOutcome | undefined {
  switch (event.type) {
    case 'cf.email.sending.message.delivered': {
      return { status: 'delivered' }
    }
    case 'cf.email.sending.message.deferred': {
      return { status: 'delayed', reason: 'temporary_failure' }
    }
    case 'cf.email.sending.message.bounced': {
      if (event.payload.bounce?.type === 'hard') {
        return { status: 'failed', reason: 'hard_bounce' }
      }
      return { status: 'failed', reason: 'temporary_failure' }
    }
    case 'cf.email.sending.message.failed': {
      return { status: 'failed', reason: 'provider_rejected' }
    }
    case 'cf.email.sending.message.rejected': {
      if (event.payload.rejection?.reason === 'suppressed') {
        return { status: 'suppressed', reason: 'provider_suppressed' }
      }
      return { status: 'failed', reason: 'provider_rejected' }
    }
    case 'cf.email.sending.message.complained': {
      return { status: 'failed', reason: 'complaint' }
    }
    default: {
      return undefined
    }
  }
}

function toProviderEvent(
  event: CloudflareEmailSendingEvent,
  outcome: NormalizedProviderOutcome
): EmailProviderEvent {
  const base = {
    eventId: event.payload.eventId,
    messageId: event.payload.messageId,
    recipient: normalized(event.payload.recipient),
    status: outcome.status,
    occurredAt: event.metadata.eventTimestamp
  }
  if (outcome.reason === undefined) {
    return base
  }
  return { ...base, reason: outcome.reason }
}

/**
 * Applies one trusted provider event. Unknown correlations are retried for a
 * bounded number of queue attempts because an event can beat the send-result
 * write. The capability distinguishes an applied/ignored event from an
 * unmatched message, so duplicates ack immediately while a race retries.
 */
export function processEmailEventMessage(
  delivery: QueueDelivery<CloudflareEmailSendingEvent>,
  env: Pick<ServerEnv, 'CLOUDFLARE_EMAIL_FROM'>
): Effect.Effect<DeliveryOutcome, CapabilityUnavailable, EmailDelivery | Scope.Scope> {
  return Effect.gen(function* () {
    if (delivery.kind === 'malformed') {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'malformed_message'
      })
      yield* recordEventMetric('malformed')
      return 'ack' satisfies DeliveryOutcome
    }

    const configuredFrom = env.CLOUDFLARE_EMAIL_FROM
    if (configuredFrom === undefined || configuredFrom.trim() === '') {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'provider_unconfigured'
      })
      yield* recordEventMetric('provider_unconfigured')
      return 'ack' satisfies DeliveryOutcome
    }

    const event = delivery.message
    const outcome = providerOutcome(event)
    if (outcome === undefined) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'unsupported_event'
      })
      yield* recordEventMetric('unsupported')
      return 'ack' satisfies DeliveryOutcome
    }
    if (!isTrustedEvent(event, configuredFrom)) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'untrusted_event'
      })
      yield* recordEventMetric('untrusted')
      return 'ack' satisfies DeliveryOutcome
    }

    const emailDelivery = yield* EmailDelivery
    const applied = yield* emailDelivery.applyProviderEvent(
      toProviderEvent(event, outcome)
    )
    if (applied === 'updated') {
      yield* Effect.annotateLogsScoped({ outcome: 'applied', status: outcome.status })
      yield* recordEventMetric(outcome.status)
      return 'ack' satisfies DeliveryOutcome
    }
    if (applied === 'ignored') {
      yield* Effect.annotateLogsScoped({ outcome: 'ignored', status: outcome.status })
      yield* recordEventMetric('ignored')
      return 'ack' satisfies DeliveryOutcome
    }

    yield* recordEventMetric('unmatched')
    yield* Effect.annotateLogsScoped({
      outcome: 'retry',
      skipReason: 'correlation_pending'
    })
    return 'retry' satisfies DeliveryOutcome
  })
}

/** Queue entry point; the main worker wires this to the dedicated event queue. */
export function consumeEmailEvent(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(CloudflareEmailSendingEvent, envelope)
  return consumerInvocation(env, {
    event: 'email_event',
    delivery,
    onFailure: 'retry',
    program: processEmailEventMessage(delivery, env).pipe(
      Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
    )
  })
}
