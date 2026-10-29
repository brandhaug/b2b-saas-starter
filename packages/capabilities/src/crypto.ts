import { Effect, Layer } from 'effect'
import { Digest, Mac, SecureRandom } from 'effect/crypto'
import { Base64, Hex } from 'effect/encoding'

// This adapter owns platform selection. Callers retain their Promise/synchronous
// interfaces and map rejected operations to their existing domain failures.
const macLayer = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))

export function hashSha256(value: string): Promise<string> {
  return Effect.runPromise(
    Digest.Digest.use((digest) =>
      digest.digestHex(Digest.sha256, new TextEncoder().encode(value))
    ).pipe(Effect.provide(Digest.layerWebCrypto))
  )
}

const sign = Effect.fn('Crypto.sign')(function* (secret: Uint8Array, payload: string) {
  const mac = yield* Mac.Mac
  const key = yield* Mac.key(Mac.hmacSha256, secret)
  return yield* mac.sign(key, new TextEncoder().encode(payload))
})

export function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  return Effect.runPromise(
    sign(new TextEncoder().encode(secret), payload).pipe(
      Effect.map(Hex.encode),
      Effect.provide(macLayer)
    )
  )
}

/** Standard Webhooks uses a base64-encoded 256-bit key with a whsec_ prefix. */
export function randomWebhookSecret(): string {
  return Effect.runSync(
    SecureRandom.SecureRandom.use((random) => random.randomBytes(32)).pipe(
      Effect.map((bytes) => `whsec_${Base64.encode(bytes)}`),
      Effect.provide(SecureRandom.layerWebCrypto)
    )
  )
}

export function hmacSha256Base64(secret: string, payload: string): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      // Keep Web Crypto's existing base64 acceptance, including whitespace.
      const bytes = yield* Effect.try(() =>
        // oxlint-disable-next-line effect/noGlobals -- preserve the platform base64 decoding contract at this adapter.
        Uint8Array.from(atob(secret.slice('whsec_'.length)), (char) =>
          char.charCodeAt(0)
        )
      )
      return Base64.encode(yield* sign(bytes, payload))
    }).pipe(Effect.provide(macLayer))
  )
}
