import { type Session } from '@b2b-saas-starter/auth'
import { type Context, Effect, Layer } from 'effect'
import type * as RateLimitModule from '@/lib/rate-limit'
import type * as BetterAuthModule from 'effectful-better-auth'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * The catchall's own contract, and only that: the request reaches the plugin
 * exactly once, a refusal skips every post-handler step, and the Turnstile
 * gate holds for the paths that mail an address. The guard's own decisions
 * (classification, refusal order, the session read) belong to
 * `auth-request-guard.test.ts`, which drives the real refusal modules — so
 * the guard is NOT mocked here either. Mocked below: the plugin boundary, the
 * capability runtime, and the post-handler collaborators this file asserts
 * were (or were not) reached.
 */
const state = vi.hoisted(() => ({
  plugin: vi.fn(),
  twoFactor: vi.fn(),
  audit: vi.fn(),
  ssoAudit: vi.fn(),
  notification: vi.fn(),
  evidence: vi.fn(),
  /**
   * The Turnstile verdict the double answers with. Neither flag set is the
   * unconfigured provider (`inactive`), which is what local development and
   * these tests run with.
   */
  turnstile: { rejected: false, unavailable: false },
  turnstileTokens: new Array<string>()
}))

const testAuth = vi.hoisted(async () => {
  const { Context } = await import('effect')
  class TestAuth extends Context.Service<
    TestAuth,
    { readonly api: { readonly getSession: () => Effect.Effect<Session> } }
  >()('AuthHttpTest') {}
  return { TestAuth }
})

vi.mock('@b2b-saas-starter/auth', async () => {
  const { TestAuth } = await testAuth
  return { Auth: { Tag: TestAuth } }
})
vi.mock('@/lib/auth-runtime', async () => {
  const { TestAuth } = await testAuth
  const { fixtureSession } = await import('@/test/fixture-session')
  return {
    authRuntime: {
      runPromise: <A, E>(
        effect: Effect.Effect<A, E, Context.Service.Identifier<typeof TestAuth>>
      ) =>
        // oxlint-disable-next-line starter/no-run-promise-in-tests -- bridges the HTTP handler's promise runtime with the test Auth service
        Effect.runPromise(
          effect.pipe(
            Effect.provideService(TestAuth, {
              api: {
                getSession: () =>
                  Effect.succeed(fixtureSession({ userId: 'usr_actor' }))
              }
            }),
            Effect.scoped
          )
        )
    }
  }
})
vi.mock('@/lib/observability', () => ({
  withWebRequestScope: (_metadata: unknown, effect: Effect.Effect<unknown>) => effect,
  memoizePerRequest: <A>(_key: string, make: () => Promise<A>) => make()
}))
vi.mock('@/lib/rate-limit', async () => {
  const actual = await vi.importActual<typeof RateLimitModule>('@/lib/rate-limit')
  return {
    ...actual,
    makeRateLimiterLayer: () =>
      Layer.succeed(actual.RateLimiter)({
        take: () => Effect.succeed(true)
      })
  }
})
vi.mock('@/lib/capabilities', () => ({ runCapabilities: vi.fn() }))
vi.mock('@/lib/server/auth-audit/record', () => ({
  recordAuthAudit: state.audit
}))
vi.mock('@/lib/server/auth-audit/sso-sign-in', () => ({
  recordSsoSignInAudit: state.ssoAudit
}))
vi.mock('@/lib/server/two-factor-sign-in-gate', () => ({
  enforceTwoFactorSignIn: state.twoFactor
}))
vi.mock('@/lib/server/credential-change-notification', () => ({
  notifyCredentialChangedEffect: state.notification
}))
vi.mock('@/lib/server/security-evidence-sink', () => ({
  recordEvidence: state.evidence
}))
vi.mock('@/lib/server/auth-emails', () => ({
  recipientLocale: vi.fn(),
  sendBackupCodesRotatedEmail: vi.fn(),
  sendPasskeyChangedEmail: vi.fn(),
  sendPasswordChangedEmail: vi.fn(),
  sendTwoFactorChangedEmail: vi.fn()
}))
vi.mock('@/lib/server/turnstile.effects', async () => {
  const effect = await import('effect')
  const { TurnstileVerifier } =
    await import('@b2b-saas-starter/capabilities/governance/turnstile-verification')
  return {
    makeTurnstileLayer: () =>
      effect.Layer.succeed(TurnstileVerifier)({
        // "Configured" is exactly "not the inactive verdict".
        enabled: state.turnstile.rejected || state.turnstile.unavailable,
        verify: (input: { readonly token: string }) => {
          state.turnstileTokens.push(input.token)
          // The verdict shape is the capability's: `rejected` names the
          // siteverify error codes, the others carry nothing.
          if (state.turnstile.rejected) {
            return effect.Effect.succeed({
              outcome: 'rejected',
              codes: ['invalid-input-response']
            })
          }
          return effect.Effect.succeed({
            outcome: state.turnstile.unavailable ? 'unavailable' : 'inactive'
          })
        }
      })
  }
})
vi.mock('effectful-better-auth', async () => {
  const actual = await vi.importActual<typeof BetterAuthModule>('effectful-better-auth')
  return { ...actual, handleWebRequest: state.plugin }
})

import { handleAuth } from './auth-http'

function request(pathname: string, headers: Record<string, string> = {}) {
  return new Request(`https://example.test${pathname}`, { method: 'POST', headers })
}

beforeEach(() => {
  state.plugin.mockReturnValue(Effect.succeed(new Response('plugin')))
  state.twoFactor.mockReturnValue(Effect.succeed(null))
  state.audit.mockReturnValue(Effect.succeed('skipped'))
  state.ssoAudit.mockReturnValue(Effect.succeed(undefined))
  state.notification.mockReturnValue(Effect.succeed(undefined))
  state.evidence.mockReturnValue(Effect.succeed(undefined))
  state.turnstile.rejected = false
  state.turnstile.unavailable = false
  state.turnstileTokens = []
})

describe('auth HTTP handler', () => {
  it('returns a pre-handler refusal without running the plugin or post handlers', async () => {
    // A workspace mutation on the plugin's own HTTP surface: the guard
    // refuses it as a capability route.
    const response = await handleAuth(request('/api/auth/organization/update'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({
      code: 'capability_route_required'
    })
    expect(state.plugin).not.toHaveBeenCalled()
    expect(state.twoFactor).not.toHaveBeenCalled()
    expect(state.audit).not.toHaveBeenCalled()
    expect(state.ssoAudit).not.toHaveBeenCalled()
    expect(state.notification).not.toHaveBeenCalled()
    expect(state.evidence).not.toHaveBeenCalled()
  })

  it('runs post-handler processing after the guard allows the plugin response', async () => {
    const response = await handleAuth(request('/api/auth/sign-out'))

    expect(response.status).toBe(200)
    expect(state.plugin).toHaveBeenCalledOnce()
    expect(state.twoFactor).toHaveBeenCalledOnce()
    expect(state.audit).toHaveBeenCalledOnce()
    expect(state.ssoAudit).toHaveBeenCalledOnce()
    expect(state.notification).toHaveBeenCalledOnce()
    expect(state.evidence).toHaveBeenCalledWith('sessions_revoked', 'usr_actor')
  })
})

describe('the Turnstile gate', () => {
  const gated = [
    '/api/auth/sign-up/email',
    '/api/auth/sign-in/magic-link',
    '/api/auth/email-otp/send-verification-otp',
    '/api/auth/request-password-reset',
    '/api/auth/email-otp/request-password-reset',
    '/api/auth/send-verification-email'
  ]

  it('verifies every mail-an-address send and refuses a rejected challenge', async () => {
    state.turnstile.rejected = true
    for (const path of gated) {
      state.plugin.mockClear()
      const response = await handleAuth(request(path, { 'x-turnstile-token': 'tok' }))
      expect(response.status).toBe(400)
      await expect(response.json()).resolves.toEqual({ code: 'captcha_rejected' })
      expect(state.plugin).not.toHaveBeenCalled()
    }
    expect(state.turnstileTokens).toEqual(gated.map(() => 'tok'))
  })

  it('refuses with 503 when siteverify itself is unreachable', async () => {
    state.turnstile.unavailable = true
    const response = await handleAuth(
      request('/api/auth/request-password-reset', { 'x-turnstile-token': 'tok' })
    )
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ code: 'captcha_unavailable' })
  })

  it('stays inactive with the provider unconfigured, token or not', async () => {
    for (const path of gated) {
      state.plugin.mockClear()
      const response = await handleAuth(request(path))
      expect(response.status).toBe(200)
      expect(state.plugin).toHaveBeenCalledOnce()
    }
    // The gate still asked — `inactive` is the verifier's answer, not a
    // skipped check — with the empty token an unconfigured screen sends.
    expect(state.turnstileTokens).toEqual(gated.map(() => ''))
  })

  it('leaves the sign-in and code-verification hops ungated', async () => {
    // A challenge on the sign-in hop would break password managers and the
    // programmatic clients; the rate limiter caps those instead.
    state.turnstile.rejected = true
    for (const path of [
      '/api/auth/sign-in/email',
      '/api/auth/sign-in/email-otp',
      '/api/auth/email-otp/verify-email',
      '/api/auth/email-otp/reset-password'
    ]) {
      state.plugin.mockClear()
      const response = await handleAuth(request(path))
      expect(response.status).toBe(200)
      expect(state.plugin).toHaveBeenCalledOnce()
    }
    expect(state.turnstileTokens).toEqual([])
  })
})
