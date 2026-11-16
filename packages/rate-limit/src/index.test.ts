import { Effect, References } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from '@effect/vitest'
import {
  clientKey,
  makeRateLimiter,
  type CloudflareRateLimit,
  type RateLimiterConfig
} from './index.ts'

type Bucket = 'read' | 'write'

function config(
  binding?: (bucket: Bucket) => CloudflareRateLimit | undefined
): RateLimiterConfig<Bucket> {
  return {
    binding: binding ?? (() => undefined),
    fallbackLimits: { read: 60, write: 20 }
  }
}

// `take` annotates the request's wide event, so it needs a Scope; the
// TestContext behind `it.effect` provides it.

// The fallback store lives at module scope, so each test needs a key no other
// test has used. A counter keeps that deterministic — no clock, no randomness.
let keyCounter = 0
function uniqueKey(): string {
  keyCounter += 1
  return `test-${keyCounter}`
}

describe('makeRateLimiter fallback (no Cloudflare bindings)', () => {
  it.effect('enforces the per-bucket limit and keys buckets independently', () =>
    Effect.gen(function* () {
      const limiter = makeRateLimiter(config())
      const key = uniqueKey()
      const outcomes: Array<boolean> = []
      for (let i = 0; i < 21; i += 1) {
        outcomes.push(yield* limiter.take({ bucket: 'write', key }))
      }
      // `write` allows 20 per window; the 21st take is denied.
      expect(outcomes.slice(0, 20).every(Boolean)).toBe(true)
      expect(outcomes[20]).toBe(false)
      // A different key is unaffected.
      expect(yield* limiter.take({ bucket: 'write', key: `${key}-other` })).toBe(true)
      // The same key under a different bucket is unaffected.
      expect(yield* limiter.take({ bucket: 'read', key })).toBe(true)
    })
  )

  it.effect(
    'shares fallback state across limiter instances (per-request layer rebuilds)',
    () =>
      Effect.gen(function* () {
        // Consumers rebuild the rate-limiter layer on every request; the fallback
        // store must live at module scope or the counters reset each request and
        // never limit anything.
        const key = uniqueKey()
        for (let i = 0; i < 20; i += 1) {
          const perRequest = makeRateLimiter(config())
          expect(yield* perRequest.take({ bucket: 'write', key })).toBe(true)
        }
        const fresh = makeRateLimiter(config())
        expect(yield* fresh.take({ bucket: 'write', key })).toBe(false)
      })
  )
})

describe('makeRateLimiter fallback capacity', () => {
  // Each case owns its bucket name: the store is per bucket at module scope.
  function capped(bucket: string) {
    return makeRateLimiter<string>({
      binding: () => undefined,
      fallbackLimits: { [bucket]: 2, other: 2 },
      fallbackCapacity: 3
    })
  }

  it.effect(
    'refuses new keys once a bucket is full, without forgetting tracked ones',
    () =>
      Effect.gen(function* () {
        const limiter = capped('capacity-full')
        for (const key of ['a', 'b', 'c']) {
          expect(yield* limiter.take({ bucket: 'capacity-full', key })).toBe(true)
        }
        // Full: a fourth caller is refused rather than growing the store or
        // evicting a tracked caller's count.
        expect(yield* limiter.take({ bucket: 'capacity-full', key: 'd' })).toBe(false)
        expect(yield* limiter.take({ bucket: 'capacity-full', key: 'a' })).toBe(true)
        expect(yield* limiter.take({ bucket: 'capacity-full', key: 'a' })).toBe(false)
        // Another bucket keeps its own room.
        expect(yield* limiter.take({ bucket: 'other', key: uniqueKey() })).toBe(true)
      })
  )

  it.effect('records a capacity refusal, unlike a tracked caller over its limit', () =>
    Effect.gen(function* () {
      const limiter = capped('capacity-evidence')
      for (const key of ['a', 'b', 'c']) {
        expect(yield* limiter.take({ bucket: 'capacity-evidence', key })).toBe(true)
      }
      const overLimit = yield* Effect.scoped(
        Effect.gen(function* () {
          yield* limiter.take({ bucket: 'capacity-evidence', key: 'a' })
          expect(yield* limiter.take({ bucket: 'capacity-evidence', key: 'a' })).toBe(
            false
          )
          return yield* References.CurrentLogAnnotations
        })
      )
      expect(overLimit).toMatchObject({ rateLimitFallback: 'missing_binding' })
      expect(overLimit).not.toHaveProperty('rateLimitCapacityRefused')
      const refused = yield* Effect.scoped(
        Effect.gen(function* () {
          expect(yield* limiter.take({ bucket: 'capacity-evidence', key: 'd' })).toBe(
            false
          )
          return yield* References.CurrentLogAnnotations
        })
      )
      expect(refused).toMatchObject({
        rateLimitDegraded: true,
        rateLimitFallback: 'missing_binding',
        rateLimitBucket: 'capacity-evidence',
        rateLimitCapacityRefused: true
      })
    })
  )

  it.effect('frees room as the window expires', () =>
    Effect.gen(function* () {
      const limiter = capped('capacity-expiry')
      for (const key of ['a', 'b', 'c']) {
        expect(yield* limiter.take({ bucket: 'capacity-expiry', key })).toBe(true)
      }
      yield* TestClock.adjust('61 seconds')
      expect(yield* limiter.take({ bucket: 'capacity-expiry', key: 'd' })).toBe(true)
      expect(yield* limiter.take({ bucket: 'capacity-expiry', key: 'e' })).toBe(true)
      expect(yield* limiter.take({ bucket: 'capacity-expiry', key: 'a' })).toBe(true)
      expect(yield* limiter.take({ bucket: 'capacity-expiry', key: 'f' })).toBe(false)
    })
  )
})

describe('makeRateLimiter with a Cloudflare binding', () => {
  it.effect('delegates to the binding when it resolves', () =>
    Effect.gen(function* () {
      const limiter = makeRateLimiter(
        config(() => ({ limit: () => Promise.resolve({ success: false }) }))
      )
      expect(yield* limiter.take({ bucket: 'write', key: uniqueKey() })).toBe(false)
    })
  )

  it.effect('falls back to the in-memory store when the binding call fails', () =>
    Effect.gen(function* () {
      const limiter = makeRateLimiter(
        config(() => ({ limit: () => Promise.reject(new Error('boom')) }))
      )
      expect(yield* limiter.take({ bucket: 'write', key: uniqueKey() })).toBe(true)
    })
  )
})

describe('clientKey', () => {
  function request(headers: Record<string, string>) {
    return new Request('http://localhost/mcp', { headers })
  }

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
