import type * as RateLimitModule from '../rate-limit'
import { BetterAuthApiError } from 'effectful-better-auth'
import { Effect, Layer, Schema } from 'effect'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * How a step-up password check can misreport an outage:
 * - the plugin's own 5xx folds into `false`, so the user is told the password
 *   was wrong while the auth store is failing;
 * - any other plugin refusal — a 429 from its own limiter, a 401 for a session
 *   that expired mid-ceremony — reads as a wrong password because it is a 4xx;
 * - a store failure that never reaches the plugin's typed error channel (a D1
 *   throw, a missing binding) surfaces as an anonymous rejection the page
 *   cannot tell apart from a refusal;
 * - the outage is raised with nothing on the request's wide event saying
 *   which failure it was.
 * Only the plugin's `INVALID_PASSWORD` is a wrong password and stays `false`.
 */

type Outcome =
  | { readonly kind: 'refused'; readonly statusCode: number; readonly code: string }
  | { readonly kind: 'unreachable' }
  | { readonly kind: 'verified' }
const plugin = vi.hoisted<{ outcome: Outcome }>(() => ({
  outcome: { kind: 'verified' }
}))

vi.mock('./auth', () => ({
  requireRequestSession: async () => ({
    user: { id: 'usr_demo' },
    session: { id: 'ses_demo', impersonatedBy: null }
  })
}))

vi.mock('../rate-limit', async (importOriginal) => {
  const original = await importOriginal<typeof RateLimitModule>()
  return {
    ...original,
    makeRateLimiterLayer: () =>
      Layer.succeed(original.RateLimiter)({ take: () => Effect.succeed(true) })
  }
})

vi.mock('./plugin-call', () => {
  const api = {
    verifyPassword: () => {
      if (plugin.outcome.kind === 'refused') {
        return Effect.fail(
          new BetterAuthApiError({
            statusCode: plugin.outcome.statusCode,
            code: plugin.outcome.code,
            message: 'provider detail',
            headers: {}
          })
        )
      }
      return Effect.succeed({ status: true })
    }
  }
  return {
    sessionCall: (
      build: (fake: typeof api, headers: Headers) => Effect.Effect<unknown, unknown>
    ) => {
      if (plugin.outcome.kind === 'unreachable') {
        return Promise.reject(new Error('D1_ERROR: storage unavailable'))
      }
      // oxlint-disable-next-line starter/no-run-promise-in-tests -- stands in for sessionCall, the Promise port the server function awaits
      return Effect.runPromise(build(api, new Headers()))
    }
  }
})

const lines = vi.spyOn(console, 'error').mockImplementation(() => {})

const { verifyCurrentPassword } = await import('./strong-authentication.effects')

const WideEventLine = Schema.fromJsonString(
  Schema.Struct({ annotations: Schema.Record(Schema.String, Schema.Json) })
)
const decodeLine = Schema.decodeUnknownSync(WideEventLine)

/** The wide events' fields, from the log lines the standalone scope emits. */
function wideEvents() {
  return lines.mock.calls.map(([line]) => decodeLine(String(line)).annotations)
}

describe('verifyCurrentPassword', () => {
  beforeEach(() => {
    plugin.outcome = { kind: 'verified' }
    lines.mockClear()
  })

  it('accepts the current password', async () => {
    await expect(verifyCurrentPassword('correct')).resolves.toBe(true)
  })

  it('reports a credential mismatch as a refusal', async () => {
    plugin.outcome = { kind: 'refused', statusCode: 400, code: 'INVALID_PASSWORD' }
    await expect(verifyCurrentPassword('wrong')).resolves.toBe(false)
  })

  it.each([
    [
      'the plugin fails internally',
      { kind: 'refused', statusCode: 500, code: 'INTERNAL_SERVER_ERROR' },
      { reason: 'plugin_failed' }
    ],
    [
      'the plugin rate-limits the check',
      { kind: 'refused', statusCode: 429, code: 'TOO_MANY_REQUESTS' },
      { reason: 'plugin_rate_limited' }
    ],
    [
      'the session expired before the check',
      { kind: 'refused', statusCode: 401, code: 'UNAUTHORIZED' },
      { reason: 'plugin_session_rejected' }
    ],
    [
      'the auth store is unreachable',
      { kind: 'unreachable' },
      { reason: 'auth_store_unavailable' }
    ]
  ] as const)(
    'reports an outage, not a wrong password, when %s',
    async (_, outcome, recorded) => {
      plugin.outcome = outcome
      await expect(verifyCurrentPassword('correct')).rejects.toMatchObject({
        code: 'unavailable'
      })
      expect(wideEvents()).toContainEqual(
        expect.objectContaining({
          capability: 'strong-authentication',
          ...recorded
        })
      )
    }
  )
})
