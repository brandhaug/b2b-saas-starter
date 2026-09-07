import {
  EmailDelivery,
  type ClaimEmail,
  type SendOutcome
} from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import { Effect } from 'effect'
import { EmailDispatcher, type EmailMessage, type EmailSendError } from './index.ts'

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
    case 'ambiguous': {
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
  const dispatcher = yield* EmailDispatcher
  return yield* delivery.trackedAttempt(
    input,
    Effect.suspend(() => dispatcher.send(message)).pipe(
      Effect.map((result) => {
        if (result.mode === 'cloudflare-email') {
          return {
            status: 'accepted',
            providerMessageId: result.providerMessageId ?? null
          } satisfies SendOutcome
        }
        return { status: 'logged' } satisfies SendOutcome
      })
    ),
    (error): SendOutcome => {
      if (error._tag === 'EmailSendError') {
        return failedOutcome(error)
      }
      return { status: 'failed', reason: 'provider_rejected' }
    }
  )
})
