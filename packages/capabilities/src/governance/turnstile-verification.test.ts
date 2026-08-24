import { Effect } from 'effect'
import { describe, expect, it } from '@effect/vitest'
import { CapabilityUnavailable } from '../errors.ts'
import {
  makeTurnstileVerifier,
  type SiteverifyCaller,
  type SiteverifyRequest
} from './turnstile-verification.ts'

function callerRecording(seen: Array<SiteverifyRequest>): SiteverifyCaller {
  return (request) =>
    Effect.sync(() => {
      seen.push(request)
      return { success: true, 'error-codes': [] }
    })
}

describe('turnstile verification', () => {
  it.effect('is inactive without a secret key — provider-light', () =>
    Effect.gen(function* () {
      const verifier = makeTurnstileVerifier({})
      expect(verifier.enabled).toBe(false)
      const outcome = yield* verifier.verify({ token: 'any-token' })
      expect(outcome).toEqual({ outcome: 'inactive' })
    })
  )

  it.effect('is inactive with an empty secret key', () =>
    Effect.gen(function* () {
      const verifier = makeTurnstileVerifier({ secretKey: '' })
      expect(verifier.enabled).toBe(false)
      expect(yield* verifier.verify({ token: 'x' })).toEqual({
        outcome: 'inactive'
      })
    })
  )

  it.effect('rejects an empty token without calling siteverify', () =>
    Effect.gen(function* () {
      let calls = 0
      function countingCaller(): SiteverifyCaller {
        return () =>
          Effect.sync(() => {
            calls += 1
            return { success: true }
          })
      }
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        siteverify: countingCaller()
      })
      expect(verifier.enabled).toBe(true)
      expect(yield* verifier.verify({ token: '' })).toEqual({
        outcome: 'rejected',
        codes: ['missing-input-response']
      })
      expect(calls).toBe(0)
    })
  )

  it.effect('reports verified on a successful siteverify response', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        siteverify: callerRecording(seen)
      })
      expect(yield* verifier.verify({ token: 'tok', remoteIp: '203.0.113.9' })).toEqual(
        { outcome: 'verified' }
      )
      expect(seen).toEqual([
        { secret: 'secret', response: 'tok', remoteip: '203.0.113.9' }
      ])
    })
  )

  it.effect('reports rejected with cloudflare codes on failure', () =>
    Effect.gen(function* () {
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        siteverify: () =>
          Effect.succeed({
            success: false,
            'error-codes': ['invalid-input-response']
          })
      })
      expect(yield* verifier.verify({ token: 'bad' })).toEqual({
        outcome: 'rejected',
        codes: ['invalid-input-response']
      })
    })
  )

  it.effect('surfaces transport failure as unavailable, not rejected', () =>
    Effect.gen(function* () {
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        siteverify: () =>
          Effect.fail(
            new CapabilityUnavailable({
              capability: 'turnstile-verification',
              reason: 'network down'
            })
          )
      })
      expect(yield* verifier.verify({ token: 'tok' })).toEqual({
        outcome: 'unavailable'
      })
    })
  )

  it.effect('a verdict-less response classifies as rejected', () =>
    Effect.gen(function* () {
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        siteverify: () => Effect.succeed({})
      })
      expect(yield* verifier.verify({ token: 'tok' })).toEqual({
        outcome: 'rejected',
        codes: []
      })
    })
  )
})
