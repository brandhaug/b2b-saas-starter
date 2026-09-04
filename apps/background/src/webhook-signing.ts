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

/**
 * Value of the `x-b2b-starter-signature` header: `t=<unix>` followed by one
 * `sha256=<hex>` per active signing secret. More than one entry appears only
 * inside a rotation's 24-hour grace window — the sender signs with the
 * replaced secret too, so a receiver that has not installed the rotated one
 * yet keeps verifying. Receivers should try every `sha256` entry against every
 * secret they hold.
 */
export function signatureHeaderValue(
  timestamp: number,
  signatureHexes: ReadonlyArray<string>
): string {
  return [`t=${timestamp}`, ...signatureHexes.map((hex) => `sha256=${hex}`)].join(',')
}
