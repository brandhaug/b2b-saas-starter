import { Effect, Fiber, Logger } from 'effect'
import { TestClock } from 'effect/testing'
import { describe, expect, it } from '@effect/vitest'
import { withRequestScope } from '@b2b-saas-starter/logger'
import { diagnosticAnnotations } from '@b2b-saas-starter/logger/sanitization'
import {
  makeTurnstileVerifier,
  SiteverifyNoResponse,
  type SiteverifyRequest,
  type SiteverifyTransport
} from './turnstile-verification.ts'

// Each step answers one attempt, in order; the last step repeats.
type Step = Response | 'no-response' | 'hang'

function scriptedTransport(
  seen: Array<SiteverifyRequest>,
  steps: ReadonlyArray<Step>
): SiteverifyTransport {
  return (request) =>
    Effect.suspend(() => {
      seen.push(request)
      const step = steps[Math.min(seen.length, steps.length) - 1]
      if (step === undefined) {
        return Effect.die('no scripted step')
      }
      if (step === 'no-response') {
        return Effect.fail(new SiteverifyNoResponse())
      }
      if (step === 'hang') {
        return Effect.never
      }
      return Effect.succeed(step)
    })
}

function verdict(body: unknown, status = 200) {
  return Response.json(body, { status })
}

/** Runs verify while advancing the TestClock past every retry and deadline. */
function verifyWithClock(transport: SiteverifyTransport, token = 'tok') {
  return Effect.gen(function* () {
    const verifier = makeTurnstileVerifier({ secretKey: 'secret', transport })
    const fiber = yield* Effect.forkChild(verifier.verify({ token }))
    yield* TestClock.adjust('1 minute')
    return yield* Fiber.join(fiber)
  })
}

/** verifyWithClock inside a request scope, returning the outcome and its sanitized wide event. */
function verifyCapturingEvent(transport: SiteverifyTransport) {
  const records: Array<ReturnType<typeof diagnosticAnnotations>> = []
  const capture = Logger.layer([
    Logger.map(Logger.formatStructured, (record) => {
      records.push(diagnosticAnnotations(record.annotations))
    })
  ])
  return Effect.gen(function* () {
    const verifier = makeTurnstileVerifier({ secretKey: 'secret', transport })
    const fiber = yield* Effect.forkChild(
      withRequestScope(
        { service: 'web', event: 'auth.sign_up' },
        verifier.verify({ token: 'tok' })
      )
    )
    yield* TestClock.adjust('1 minute')
    const outcome = yield* Fiber.join(fiber)
    return { outcome, records }
  }).pipe(Effect.provide(capture))
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
      const seen: Array<SiteverifyRequest> = []
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        transport: scriptedTransport(seen, [verdict({ success: true })])
      })
      expect(verifier.enabled).toBe(true)
      expect(yield* verifier.verify({ token: '' })).toEqual({
        outcome: 'rejected',
        codes: ['missing-input-response']
      })
      expect(seen).toEqual([])
    })
  )

  it.effect('reports verified and sends the token with an idempotency key', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const verifier = makeTurnstileVerifier({
        secretKey: 'secret',
        transport: scriptedTransport(seen, [verdict({ success: true })])
      })
      expect(yield* verifier.verify({ token: 'tok', remoteIp: '203.0.113.9' })).toEqual(
        { outcome: 'verified' }
      )
      expect(seen).toEqual([
        {
          secret: 'secret',
          response: 'tok',
          remoteip: '203.0.113.9',
          idempotency_key: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
          )
        }
      ])
    })
  )

  it.effect('reports rejected with cloudflare codes on a 2xx failure verdict', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const outcome = yield* verifyWithClock(
        scriptedTransport(seen, [
          verdict({ success: false, 'error-codes': ['invalid-input-response'] })
        ])
      )
      expect(outcome).toEqual({
        outcome: 'rejected',
        codes: ['invalid-input-response']
      })
      expect(seen).toHaveLength(1)
    })
  )

  it.effect('retries a request that got no response, reusing its idempotency key', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const outcome = yield* verifyWithClock(
        scriptedTransport(seen, [
          'no-response',
          'no-response',
          verdict({ success: true })
        ])
      )
      expect(outcome).toEqual({ outcome: 'verified' })
      expect(seen).toHaveLength(3)
      expect(new Set(seen.map((request) => request.idempotency_key)).size).toBe(1)
    })
  )

  it.effect('gives up as unavailable after bounded no-response retries', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const outcome = yield* verifyWithClock(scriptedTransport(seen, ['no-response']))
      expect(outcome).toEqual({ outcome: 'unavailable' })
      expect(seen).toHaveLength(3)
    })
  )

  it.effect(
    'a non-2xx response is unavailable even when its body decodes as a verdict',
    () =>
      Effect.gen(function* () {
        const seen: Array<SiteverifyRequest> = []
        const outcome = yield* verifyWithClock(
          scriptedTransport(seen, [
            verdict({ success: false, 'error-codes': ['internal-error'] }, 500),
            verdict({ success: true })
          ])
        )
        expect(outcome).toEqual({ outcome: 'unavailable' })
        expect(seen).toHaveLength(1)
      })
  )

  it.effect('a timed-out request is unavailable and not retried', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const outcome = yield* verifyWithClock(
        scriptedTransport(seen, ['hang', verdict({ success: true })])
      )
      expect(outcome).toEqual({ outcome: 'unavailable' })
      expect(seen).toHaveLength(1)
    })
  )

  it.effect('an unparseable 2xx body is unavailable and not retried', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const outcome = yield* verifyWithClock(
        scriptedTransport(seen, [
          new Response('<html>edge error</html>', { status: 200 }),
          verdict({ success: true })
        ])
      )
      expect(outcome).toEqual({ outcome: 'unavailable' })
      expect(seen).toHaveLength(1)
    })
  )

  it.effect('a verdict-less 2xx body is unavailable, not rejected', () =>
    Effect.gen(function* () {
      const seen: Array<SiteverifyRequest> = []
      const outcome = yield* verifyWithClock(scriptedTransport(seen, [verdict({})]))
      expect(outcome).toEqual({ outcome: 'unavailable' })
      expect(seen).toHaveLength(1)
    })
  )
})

describe('turnstile unavailable evidence', () => {
  const cases: ReadonlyArray<readonly [string, () => ReadonlyArray<Step>, string]> = [
    ['no response after retries', () => ['no-response'], 'no_response'],
    ['a timeout', () => ['hang'], 'timeout'],
    ['a 5xx status', () => [verdict({ success: true }, 503)], 'status_5xx'],
    ['a 4xx status', () => [verdict({ success: true }, 429)], 'status_4xx'],
    [
      'an unparseable body',
      () => [new Response('<html>edge error</html>', { status: 200 })],
      'unparseable_body'
    ],
    ['a verdict-less body', () => [verdict({})], 'no_verdict']
  ]
  for (const [name, steps, reason] of cases) {
    it.effect(`annotates ${name} as turnstileUnavailable: ${reason}`, () =>
      Effect.gen(function* () {
        const { outcome, records } = yield* verifyCapturingEvent(
          scriptedTransport([], steps())
        )
        expect(outcome).toEqual({ outcome: 'unavailable' })
        expect(records).toHaveLength(1)
        expect(records[0]).toMatchObject({ status: 'ok', turnstileUnavailable: reason })
      })
    )
  }

  it.effect('leaves a verdict without turnstile failure evidence', () =>
    Effect.gen(function* () {
      const { records } = yield* verifyCapturingEvent(
        scriptedTransport([], [verdict({ success: false })])
      )
      expect(records[0]).not.toHaveProperty('turnstileUnavailable')
    })
  )

  it.effect('cancels the unread body of a non-2xx response', () =>
    Effect.gen(function* () {
      const response = verdict({ success: false }, 502)
      const { outcome } = yield* verifyCapturingEvent(scriptedTransport([], [response]))
      expect(outcome).toEqual({ outcome: 'unavailable' })
      expect(response.bodyUsed).toBe(true)
    })
  )
})
