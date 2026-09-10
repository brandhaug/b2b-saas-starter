import { Effect, Layer } from 'effect'
import type * as RateLimitModule from '@/lib/rate-limit'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * The sign-in page's routing ask is session-free by design (ADR 0069), which
 * leaves the client key as the only thing metering it: without a budget it is
 * a free domain-enumeration oracle over the connection table. The bucket is
 * sign-in's own (ADR 0030), and a throttled ask answers `null` — the same
 * answer a domain that does not route gets, so the flood learns nothing.
 */
const state = vi.hoisted(() => ({
  allowed: true,
  takes: new Array<{ readonly bucket: string; readonly key: string }>(),
  resolved: 0
}))

vi.mock('../request-context', () => ({
  currentRequest: () =>
    new Request('https://example.test/_serverFn/resolveSsoRouting', {
      method: 'POST',
      headers: {
        'cf-connecting-ip': '203.0.113.7',
        // Attacker-controlled and deliberately ignored by `clientKey`.
        'x-forwarded-for': '198.51.100.1'
      }
    })
}))
vi.mock('../rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('../rate-limit')
  return {
    ...actual,
    makeRateLimiterLayer: () =>
      Layer.succeed(actual.RateLimiter)({
        take: (input: { readonly bucket: string; readonly key: string }) => {
          state.takes.push(input)
          return Effect.succeed(state.allowed)
        }
      })
  }
})
// The table read itself belongs to the capability's own tests; what matters
// here is whether the handler reaches for it at all.
vi.mock('../capabilities', async () => {
  const { Option } = await import('effect')
  return {
    runCapabilities: () => {
      state.resolved += 1
      return Promise.resolve(
        Option.some({
          providerId: 'sso_test',
          protocol: 'oidc',
          workspaceId: 'wrk_test',
          requireSso: true
        })
      )
    }
  }
})

import { resolveSsoRoutingHandler } from './workspace-sso.effects'

beforeEach(() => {
  state.allowed = true
  state.takes = []
  state.resolved = 0
})

describe('resolveSsoRoutingHandler', () => {
  it('meters the ask in the sign-in bucket, keyed on the platform client ip', async () => {
    const decision = await resolveSsoRoutingHandler({ email: 'someone@acme.test' })

    expect(state.takes).toEqual([{ bucket: 'auth_sign_in', key: '203.0.113.7' }])
    expect(state.resolved).toBe(1)
    expect(decision).toMatchObject({ providerId: 'sso_test', requireSso: true })
  })

  it('answers a throttled ask with no decision and never reads the table', async () => {
    state.allowed = false

    const decision = await resolveSsoRoutingHandler({ email: 'someone@acme.test' })

    expect(decision).toBeNull()
    expect(state.resolved).toBe(0)
  })
})
