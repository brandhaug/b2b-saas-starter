import { createHash } from 'node:crypto'
import { makeOAuthClient } from 'alchemy/Auth/OAuthFlow'
import { PlatformServices } from 'alchemy/Util/PlatformServices'
import { Effect } from 'effect'
import { it } from '@effect/vitest'
import { expect } from 'vite-plus/test'

// Failure cases: removed crypto imports, missing runtime services, non-random
// state/verifiers, or a PKCE challenge that no longer hashes the verifier.
// (beta.85 no longer maps an unavailable entropy service to OAuthCryptoError;
// such a failure surfaces as a fiber defect inside alchemy's OAuthFlow.)

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
