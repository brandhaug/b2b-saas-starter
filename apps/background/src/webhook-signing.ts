import { hmacSha256Hex } from '@b2b-saas-starter/capabilities/crypto'
import { Effect } from 'effect'

/**
 * Stripe-style signature: HMAC-SHA256 over `"<timestamp>.<body>"` with the
 * endpoint's plaintext signing secret, hex-encoded. Signing the timestamp
 * makes captured deliveries non-replayable once the receiver enforces a
 * tolerance window. Composition over the shared Web Crypto boundary — this
 * module adds only the timestamp framing.
 */
export const computeWebhookSignature = Effect.fn('Webhooks.computeSignature')(
  function* (secret: string, timestamp: number, body: string) {
    return yield* Effect.promise(() => hmacSha256Hex(secret, `${timestamp}.${body}`))
  }
)

/** Value of the `x-b2b-starter-signature` header. */
export function signatureHeaderValue(timestamp: number, signatureHex: string): string {
  return `t=${timestamp},sha256=${signatureHex}`
}
