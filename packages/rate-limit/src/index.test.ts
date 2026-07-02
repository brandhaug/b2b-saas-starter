import { Effect, type Scope } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimiterConfig
} from './index.ts'

type Bucket = 'read' | 'write'

const config = (
  binding?: (bucket: Bucket) => CloudflareRateLimit | undefined
): RateLimiterConfig<Bucket> => ({
  binding: binding ?? (() => undefined),
  fallbackLimits: { read: 60, write: 20 }
})

// `take` annotates the request's wide event, so it needs a Scope; tests
// supply it with `Effect.scoped`.
const runScoped = <A, E>(effect: Effect.Effect<A, E, Scope.Scope>): Promise<A> =>
  Effect.runPromise(Effect.scoped(effect) as Effect.Effect<A, E>)

const uniqueKey = () => `test-${Date.now()}-${Math.random()}`

describe('makeRateLimiter fallback (no Cloudflare bindings)', () => {
  it('enforces the per-bucket limit and keys buckets independently', async () => {
    const limiter = makeRateLimiter(config())
    const key = uniqueKey()
    const outcomes: boolean[] = []
    for (let i = 0; i < 21; i += 1) {
      outcomes.push(await runScoped(limiter.take({ bucket: 'write', key })))
    }
    // `write` allows 20 per window; the 21st take is denied.
    expect(outcomes.slice(0, 20).every(Boolean)).toBe(true)
    expect(outcomes[20]).toBe(false)
    // A different key is unaffected.
    expect(
      await runScoped(limiter.take({ bucket: 'write', key: `${key}-other` }))
    ).toBe(true)
    // The same key under a different bucket is unaffected.
    expect(await runScoped(limiter.take({ bucket: 'read', key }))).toBe(true)
  })

  it('shares fallback state across limiter instances (per-request layer rebuilds)', async () => {
    // Consumers rebuild the rate-limiter layer on every request; the fallback
    // store must live at module scope or the counters reset each request and
    // never limit anything.
    const key = uniqueKey()
    for (let i = 0; i < 20; i += 1) {
      const perRequest = makeRateLimiter(config())
      expect(await runScoped(perRequest.take({ bucket: 'write', key }))).toBe(true)
    }
    const fresh = makeRateLimiter(config())
    expect(await runScoped(fresh.take({ bucket: 'write', key }))).toBe(false)
  })
})

describe('makeRateLimiter with a Cloudflare binding', () => {
  it('delegates to the binding when it resolves', async () => {
    const limiter = makeRateLimiter(
      config(() => ({ limit: () => Promise.resolve({ success: false }) }))
    )
    expect(await runScoped(limiter.take({ bucket: 'write', key: uniqueKey() }))).toBe(
      false
    )
  })

  it('falls back to the in-memory store when the binding call fails', async () => {
    const limiter = makeRateLimiter(
      config(() => ({ limit: () => Promise.reject(new Error('boom')) }))
    )
    expect(await runScoped(limiter.take({ bucket: 'write', key: uniqueKey() }))).toBe(
      true
    )
  })
})

describe('clientKey', () => {
  const request = (headers: Record<string, string>) =>
    new Request('http://localhost/mcp', { headers })

  it('uses cf-connecting-ip and ignores attacker-controlled x-forwarded-for', () => {
    const key = clientKey(
      request({
        'cf-connecting-ip': '203.0.113.7',
        'x-forwarded-for': '10.0.0.1'
      })
    )
    expect(key).toBe('203.0.113.7')
  })

  it('falls back to a path-derived key when no client ip is present', () => {
    const key = clientKey(request({ 'x-forwarded-for': '10.0.0.1' }))
    expect(key).toBe('unkeyed:/mcp')
  })
})
