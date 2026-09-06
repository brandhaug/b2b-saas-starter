import { hmacSha256Base64 } from '@b2b-saas-starter/capabilities/crypto'
import { Effect } from 'effect'

/** Standard Webhooks signs the message identity, timestamp, and exact UTF-8 body. */
export const computeWebhookSignature = Effect.fn('Webhooks.computeSignature')(
  function* (secret: string, messageId: string, timestamp: number, body: string) {
    return yield* Effect.promise(() =>
      hmacSha256Base64(secret, `${messageId}.${timestamp}.${body}`)
    )
  }
)

/** Current key first; the previous key also signs throughout rotation grace. */
export function signatureHeaderValue(signatures: ReadonlyArray<string>): string {
  return signatures.map((signature) => `v1,${signature}`).join(' ')
}
