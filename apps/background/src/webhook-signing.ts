import { CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { DateTime, Effect, Redacted } from 'effect'
import { Webhook } from 'standardwebhooks'

/** Standard Webhooks signs the message identity, timestamp, and exact UTF-8 body. */
export const computeWebhookSignature = Effect.fn('Webhooks.computeSignature')(
  function* (
    secret: Redacted.Redacted<string>,
    messageId: string,
    timestamp: number,
    body: string
  ) {
    return yield* Effect.try({
      try: () =>
        new Webhook(Redacted.value(secret)).sign(
          messageId,
          DateTime.toDateUtc(DateTime.makeUnsafe(timestamp * 1000)),
          body
        ),
      catch: () =>
        new CapabilityUnavailable({
          capability: 'Webhooks.computeSignature',
          reason: 'Webhook signing failed'
        })
    })
  }
)

/** Current key first; the previous key also signs throughout rotation grace. */
export function signatureHeaderValue(signatures: ReadonlyArray<string>): string {
  return signatures.join(' ')
}
