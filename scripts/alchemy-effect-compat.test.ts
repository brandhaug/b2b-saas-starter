import { createHash } from 'node:crypto'
import { makeOAuthClient } from 'alchemy/Auth/OAuthFlow'
import { PlatformServices } from 'alchemy/Util/PlatformServices'
import { Effect, Result } from 'effect'
import { SecureRandom } from 'effect/crypto'
import { it } from '@effect/vitest'
import { expect } from 'vite-plus/test'

// Failure cases: removed crypto imports, missing runtime services, non-random
// state/verifiers, or a PKCE challenge that no longer hashes the verifier.
// Platform entropy failures must remain catchable OAuthCryptoError failures.
it.effect('maps unavailable entropy to the OAuth crypto failure', () =>
  Effect.gen(function* () {
    const client = makeOAuthClient({
      clientId: 'compat-test',
      endpoints: {
        authorize: 'https://issuer.example/authorize',
        token: 'https://issuer.example/token'
      },
      redirectUri: 'http://localhost:1234/callback',
      localCallbackUri: 'http://localhost:1234/callback',
      auth: { kind: 'pkce' }
    })
    const result = yield* client.authorize(['read']).pipe(
      Effect.provideService(
        SecureRandom.SecureRandom,
        SecureRandom.make(() => {
          throw new Error('entropy unavailable')
        })
      ),
      Effect.provide(PlatformServices),
      Effect.result
    )
    expect(Result.isFailure(result)).toBe(true)
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: 'OAuthCryptoError',
        operation: 'Secure random generation'
      })
    }
  })
)

it.effect(
  'generates OAuth state and S256 PKCE through the installed Alchemy runtime',
  () =>
    Effect.gen(function* () {
      const client = makeOAuthClient({
        clientId: 'compat-test',
        endpoints: {
          authorize: 'https://issuer.example/authorize',
          token: 'https://issuer.example/token'
        },
        redirectUri: 'http://localhost:1234/callback',
        localCallbackUri: 'http://localhost:1234/callback',
        auth: { kind: 'pkce' }
      })
      const [first, second] = yield* Effect.all([
        client.authorize(['read']),
        client.authorize(['read'])
      ]).pipe(Effect.provide(PlatformServices))
      expect(first.state).toMatch(/^[A-Za-z0-9_-]+$/)
      expect(first.state).not.toBe(second.state)
      expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
      expect(first.verifier).not.toBe(second.verifier)
      if (first.verifier === undefined) {
        throw new Error('Missing PKCE verifier')
      }
      const url = new URL(first.url)
      expect(url.searchParams.get('state')).toBe(first.state)
      expect(url.searchParams.get('code_challenge_method')).toBe('S256')
      expect(url.searchParams.get('code_challenge')).toBe(
        createHash('sha256').update(first.verifier).digest('base64url')
      )
    })
)
