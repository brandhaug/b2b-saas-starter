import { Effect, Layer } from 'effect'
import { Digest, Mac, SecureRandom } from 'effect/crypto'
import { Base64, Hex } from 'effect/encoding'

// This adapter owns platform selection. Effect callers retain their context;
// only the synchronous credential API below bridges to the platform runtime.
const macLayer = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))

export function hashSha256(value: string) {
  return Digest.Digest.use((digest) =>
    digest.digestHex(Digest.sha256, new TextEncoder().encode(value))
  ).pipe(Effect.provide(Digest.layerWebCrypto))
}

const sign = Effect.fn('Crypto.sign')(function* (secret: Uint8Array, payload: string) {
  const mac = yield* Mac.Mac
  const key = yield* Mac.key(Mac.hmacSha256, secret)
  return yield* mac.sign(key, new TextEncoder().encode(payload))
})

export function hmacSha256Hex(secret: string, payload: string) {
  return sign(new TextEncoder().encode(secret), payload).pipe(
    Effect.map(Hex.encode),
    Effect.provide(macLayer)
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
