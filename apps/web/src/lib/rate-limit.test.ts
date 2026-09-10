import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import {
  authRateLimitBucket,
  clientKey,
  makeRateLimiterLayer,
  RateLimiter
} from './rate-limit'

function request(headers: Record<string, string>): Request {
  return new Request('http://localhost:3071/api/auth/sign-in', { headers })
}

describe('rate limiter fallback (no Cloudflare bindings)', () => {
  it.effect('enforces the auth_write limit across per-request layer rebuilds', () =>
    Effect.gen(function* () {
      // The auth route builds the layer on every request (api.auth.$.ts), so
      // this test rebuilds it per take — the fallback counters must survive.
      function take(key: string) {
        return Effect.gen(function* () {
          const limiter = yield* RateLimiter
          return yield* limiter.take({ bucket: 'auth_write', key })
        }).pipe(Effect.provide(makeRateLimiterLayer({})))
      }

      const key = `test-${Date.now()}-${Math.random()}`
      const outcomes: Array<boolean> = []
      for (let i = 0; i < 21; i += 1) {
        outcomes.push(yield* take(key))
      }
      // auth_write allows 20 per window; the 21st take is denied.
      expect(outcomes.slice(0, 20).every(Boolean)).toBe(true)
      expect(outcomes[20]).toBe(false)
      // A different key is unaffected.
      expect(yield* take(`${key}-other`)).toBe(true)
    })
  )
})

describe('authRateLimitBucket', () => {
  it.each([
    ['POST', '/api/auth/sign-in/email', 'auth_sign_in'],
    ['POST', '/api/auth/sign-in/username', 'auth_sign_in'],
    // Email one-time codes are credential material: sending and verifying
    // them sit in the same tight bucket as a password guess.
    ['POST', '/api/auth/sign-in/email-otp', 'auth_sign_in'],
    ['POST', '/api/auth/email-otp/send-verification-otp', 'auth_sign_in'],
    ['POST', '/api/auth/email-otp/verify-email', 'auth_sign_in'],
    // The link-based reset send: same mail-an-arbitrary-address primitive as
    // its /email-otp sibling, so the same tight bucket.
    ['POST', '/api/auth/request-password-reset', 'auth_sign_in'],
    ['POST', '/api/auth/email-otp/request-password-reset', 'auth_sign_in'],
    ['POST', '/api/auth/email-otp/reset-password', 'auth_sign_in'],
    // The second factor is a six-digit guessable secret, so its verification
    // hops share the sign-in budget with the password hop before them.
    ['POST', '/api/auth/two-factor/verify-totp', 'auth_sign_in'],
    ['POST', '/api/auth/two-factor/verify-backup-code', 'auth_sign_in'],
    // Session-management and other POSTs keep the generic write bucket.
    ['POST', '/api/auth/list-sessions', 'auth_write'],
    ['POST', '/api/auth/two-factor/enable', 'auth_write'],
    ['GET', '/api/auth/get-session', 'auth_read']
  ])('%s %s → %s', (method, pathname, expected) => {
    expect(authRateLimitBucket(method, pathname)).toBe(expected)
  })

  it.effect('enforces the tighter auth_sign_in fallback limit', () =>
    Effect.gen(function* () {
      function take(key: string) {
        return Effect.gen(function* () {
          const limiter = yield* RateLimiter
          return yield* limiter.take({ bucket: 'auth_sign_in', key })
        }).pipe(Effect.provide(makeRateLimiterLayer({})))
      }
      const key = `sign-in-${Date.now()}-${Math.random()}`
      const outcomes: Array<boolean> = []
      for (let i = 0; i < 6; i += 1) {
        outcomes.push(yield* take(key))
      }
      // auth_sign_in allows 5 per window; the 6th take is denied.
      expect(outcomes.slice(0, 5).every(Boolean)).toBe(true)
      expect(outcomes[5]).toBe(false)
    })
  )
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
