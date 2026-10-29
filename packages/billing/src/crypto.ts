import { Effect, Layer } from 'effect'
import { Mac, SecureRandom } from 'effect/crypto'
import { Hex } from 'effect/encoding'

const macLayer = Mac.layerWebCrypto.pipe(Layer.provide(SecureRandom.layerWebCrypto))

// Keep platform selection here and rejection mapping in the Stripe adapter.
export function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const mac = yield* Mac.Mac
      const key = yield* Mac.key(Mac.hmacSha256, new TextEncoder().encode(secret))
      return Hex.encode(yield* mac.sign(key, new TextEncoder().encode(payload)))
    }).pipe(Effect.provide(macLayer))
  )
}
