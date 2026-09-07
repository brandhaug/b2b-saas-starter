import {
  EmailDelivery,
  type ClaimEmail,
  type SendOutcome
} from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import { Effect, Metric } from 'effect'
import { EmailDispatcher, type EmailMessage, type EmailSendError } from './index.ts'

const outcomes = Metric.counter('starter.email.send.outcomes')

function failedOutcome(error: EmailSendError): SendOutcome {
  switch (error.failureKind) {
    case 'permanent': {
      return { status: 'failed', reason: 'provider_rejected' }
    }
    case 'suppressed': {
      return { status: 'suppressed', reason: 'provider_suppressed' }
    }
    case 'transient': {
      return { status: 'temporary_failure', reason: 'transport_unavailable' }
    }
    case 'ambiguous':
    case undefined: {
      return { status: 'ambiguous', reason: 'timeout' }
    }
  }
}

/** Rendered content stays in this invocation; only the sanitized outcome persists. */
export const dispatchTrackedEmail = Effect.fn('Email.dispatchTracked')(function* (
  input: ClaimEmail,
  message: EmailMessage
) {
  const delivery = yield* EmailDelivery
  const claim = yield* delivery.claim(input)
  if (claim === null) {
    return { status: 'skipped' } satisfies { status: 'skipped' }
  }
  const dispatcher = yield* EmailDispatcher
  const result = yield* dispatcher.send(message).pipe(
    Effect.tapError((error) => {
      let outcome: SendOutcome = { status: 'failed', reason: 'provider_rejected' }
      if (error._tag === 'EmailSendError') {
        outcome = failedOutcome(error)
      }
      return delivery.recordOutcome(input.id, claim.token, outcome).pipe(
        Effect.andThen(
          Metric.update(
            Metric.withAttributes(outcomes, {
              purpose: input.purpose,
              status: outcome.status
            }),
            1
          )
        )
      )
    })
  )
  let outcome: SendOutcome = { status: 'logged' }
  if (result.mode === 'cloudflare-email') {
    outcome = {
      status: 'accepted',
      providerMessageId: result.providerMessageId ?? null
    }
  }
  yield* delivery.recordOutcome(input.id, claim.token, outcome)
  yield* Metric.update(
    Metric.withAttributes(outcomes, {
      purpose: input.purpose,
      status: outcome.status
    }),
    1
  )
  return { status: outcome.status }
})
