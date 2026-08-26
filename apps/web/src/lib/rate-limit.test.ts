import { Effect, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  authRateLimitBucket,
  clientKey,
  makeRateLimiterLayer,
  RateLimiter
} from './rate-limit'

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost:3071/api/auth/sign-in', { headers })
}

// `take` annotates the request's wide event, so it needs a Scope; tests
// supply it with `Effect.scoped`.
function runScoped<A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> {
  return Effect.runPromise(Effect.scoped(effect))
}

describe('rate limiter fallback (no Cloudflare bindings)', () => {
  it('enforces the auth_write limit across per-request layer rebuilds', async () => {
    // The auth route builds the layer on every request (api.auth.$.ts), so
    // this test rebuilds it per take — the fallback counters must survive.
    function take(key: string) {
      return Effect.gen(function* () {
        const limiter = yield* RateLimiter
        return yield* limiter.take({ bucket: 'auth_write', key })
      }).pipe(Effect.provide(makeRateLimiterLayer({})))
    }

    const key = `test-${Date.now()}-${Math.random()}`
    const outcomes: boolean[] = []
    for (let i = 0; i < 21; i += 1) {
      outcomes.push(await runScoped(take(key)))
    }
    // auth_write allows 20 per window; the 21st take is denied.
    expect(outcomes.slice(0, 20).every(Boolean)).toBe(true)
    expect(outcomes[20]).toBe(false)
    // A different key is unaffected.
    expect(await runScoped(take(`${key}-other`))).toBe(true)
  })
})

describe('authRateLimitBucket', () => {
  it.each([
    ['POST', '/api/auth/sign-in/email', 'auth_sign_in'],
    ['POST', '/api/auth/sign-in/username', 'auth_sign_in'],
    // Session-management and other POSTs keep the generic write bucket.
    ['POST', '/api/auth/list-sessions', 'auth_write'],
    ['POST', '/api/auth/two-factor/enable', 'auth_write'],
    ['GET', '/api/auth/get-session', 'auth_read']
  ])('%s %s → %s', (method, pathname, expected) => {
    expect(authRateLimitBucket(method, pathname)).toBe(expected)
  })

  it('enforces the tighter auth_sign_in fallback limit', async () => {
    function take(key: string) {
      return Effect.gen(function* () {
        const limiter = yield* RateLimiter
        return yield* limiter.take({ bucket: 'auth_sign_in', key })
      }).pipe(Effect.provide(makeRateLimiterLayer({})))
    }
    const key = `sign-in-${Date.now()}-${Math.random()}`
    const outcomes: boolean[] = []
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await runScoped(take(key)))
    }
    // auth_sign_in allows 5 per window; the 6th take is denied.
    expect(outcomes.slice(0, 5).every(Boolean)).toBe(true)
    expect(outcomes[5]).toBe(false)
  })
})

describe('clientKey', () => {
  it('uses cf-connecting-ip and ignores attacker-controlled x-forwarded-for', () => {
    const key = clientKey(
      request({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '198.51.100.1, 10.0.0.1'
      })
    )
    expect(key).toBe('203.0.113.7')
  })

  it('falls back to a per-path shared bucket with no client ip', () => {
    const key = clientKey(request({ 'x-forwarded-for': '198.51.100.1' }))
    expect(key).toBe('unkeyed:/api/auth/sign-in')
  })
})
