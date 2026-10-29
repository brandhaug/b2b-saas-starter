import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { expect, vi } from 'vite-plus/test'

import { hmacSha256Hex } from './crypto'

// Failure cases: signature byte drift, empty keys, rejected key import/signing.
it.effect('preserves the RFC 4231 HMAC-SHA256 fixture', () =>
  Effect.gen(function* () {
    expect(
      yield* Effect.promise(() => hmacSha256Hex('Jefe', 'what do ya want for nothing?'))
    ).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
  })
)

it.effect('rejects empty keys and platform import failures', () =>
  Effect.gen(function* () {
    yield* Effect.promise(() =>
      expect(hmacSha256Hex('', 'payload')).rejects.toBeDefined()
    )
    vi.spyOn(crypto.subtle, 'importKey').mockRejectedValue(new Error('import refused'))
    yield* Effect.promise(() =>
      expect(hmacSha256Hex('key', 'payload')).rejects.toBeDefined()
    )
  }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())))
)

it.effect('rejects platform signing failures', () =>
  Effect.gen(function* () {
    vi.spyOn(crypto.subtle, 'sign').mockRejectedValue(new Error('sign refused'))
    yield* Effect.promise(() =>
      expect(hmacSha256Hex('key', 'payload')).rejects.toBeDefined()
    )
  }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())))
)
