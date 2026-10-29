import { it } from '@effect/vitest'
import { Effect } from 'effect'
import { describe, expect, vi } from 'vite-plus/test'

import {
  hashSha256,
  hmacSha256Base64,
  hmacSha256Hex,
  randomWebhookSecret
} from './crypto'

// Failure cases: encoding drift (UTF-8, hex, base64), empty/malformed keys,
// platform rejection, or generating fewer than 32 secure bytes.
describe('crypto wire compatibility', () => {
  it.effect('keeps SHA-256 fixtures, including UTF-8 and empty input', () =>
    Effect.gen(function* () {
      expect(yield* Effect.promise(() => hashSha256('abc'))).toBe(
        'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'
      )
      expect(yield* Effect.promise(() => hashSha256(''))).toBe(
        'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
      )
      expect(yield* Effect.promise(() => hashSha256('雪'))).toBe(
        '53058fe2e03c00d93c4ba9361889dd7569d7d7b9674ed172266ee66265208cc6'
      )
    })
  )

  it.effect('keeps RFC 4231 HMAC bytes in hex and Standard Webhooks base64', () =>
    Effect.gen(function* () {
      expect(
        yield* Effect.promise(() =>
          hmacSha256Hex('Jefe', 'what do ya want for nothing?')
        )
      ).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843')
      expect(
        yield* Effect.promise(() =>
          hmacSha256Base64('whsec_SmVmZQ==', 'what do ya want for nothing?')
        )
      ).toBe('W9zBRr9gdU5qBCQmCJV1x1oAPwidJzmDnexYuWTsOEM=')
    })
  )

  it.effect('rejects empty HMAC keys and malformed base64', () =>
    Effect.gen(function* () {
      yield* Effect.promise(() =>
        expect(hmacSha256Hex('', 'payload')).rejects.toBeDefined()
      )
      yield* Effect.promise(() =>
        expect(hmacSha256Base64('whsec_', 'payload')).rejects.toBeDefined()
      )
      yield* Effect.promise(() =>
        expect(hmacSha256Base64('whsec_!!!!', 'payload')).rejects.toBeDefined()
      )
    })
  )

  it.effect('rejects when the platform digest or signing operation fails', () =>
    Effect.gen(function* () {
      vi.spyOn(crypto.subtle, 'digest').mockRejectedValue(new Error('digest refused'))
      vi.spyOn(crypto.subtle, 'sign').mockRejectedValue(new Error('sign refused'))
      yield* Effect.promise(() => expect(hashSha256('abc')).rejects.toBeDefined())
      yield* Effect.promise(() =>
        expect(hmacSha256Hex('key', 'payload')).rejects.toBeDefined()
      )
      yield* Effect.promise(() =>
        expect(hmacSha256Base64('whsec_a2V5', 'payload')).rejects.toBeDefined()
      )
    }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())))
  )

  it.effect('encodes all 32 CSPRNG bytes as a padded Standard Webhooks secret', () =>
    Effect.sync(() => {
      const random = vi.spyOn(crypto, 'getRandomValues').mockImplementation((array) => {
        const bytes = new Uint8Array(array.buffer, array.byteOffset, array.byteLength)
        bytes.set(Array.from({ length: bytes.length }, (_, index) => index))
        return array
      })
      expect(randomWebhookSecret()).toBe(
        'whsec_AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8='
      )
      expect(random).toHaveBeenCalledExactlyOnceWith(
        new Uint8Array(Array.from({ length: 32 }, (_, index) => index))
      )
    }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())))
  )

  it.effect('does not fall back when secure randomness fails', () =>
    Effect.sync(() => {
      vi.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
        throw new Error('entropy unavailable')
      })
      expect(() => randomWebhookSecret()).toThrow('entropy unavailable')
    }).pipe(Effect.ensuring(Effect.sync(() => vi.restoreAllMocks())))
  )
})
