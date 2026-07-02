import { Effect, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import { clientKey, makeRateLimiterLayer, RateLimiter } from './rate-limit'

const request = (headers: Record<string, string>) =>
  new Request('http://localhost:3071/api/auth/sign-in', { headers })

// `take` annotates the request's wide event, so it needs a Scope; tests
// supply it with `Effect.scoped`.
const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

describe('rate limiter fallback (no Cloudflare bindings)', () => {
  it('enforces the auth_write limit across per-request layer rebuilds', async () => {
    // The auth route builds the layer on every request (api.auth.$.ts), so
    // this test rebuilds it per take — the fallback counters must survive.
    const take = (key: string) =>
      Effect.gen(function* () {
        const limiter = yield* RateLimiter
        return yield* limiter.take({ bucket: 'auth_write', key })
      }).pipe(Effect.provide(makeRateLimiterLayer({})))

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
