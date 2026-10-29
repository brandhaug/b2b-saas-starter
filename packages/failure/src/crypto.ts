import { Effect } from 'effect'
import { SecureRandom } from 'effect/crypto'
import { Hex } from 'effect/encoding'

/** Credential bytes from the platform CSPRNG, never Effect's seedable Random. */
export function randomHex(byteLength: number): string {
  return Effect.runSync(
    SecureRandom.SecureRandom.use((random) => random.randomBytes(byteLength)).pipe(
      Effect.map(Hex.encode),
      Effect.provide(SecureRandom.layerWebCrypto)
    )
  )
}
