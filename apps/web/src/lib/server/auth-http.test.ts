import { type Session } from '@b2b-saas-starter/auth'
import { type Context, Effect, Layer } from 'effect'
import type * as RateLimitModule from '@/lib/rate-limit'
import type * as BetterAuthModule from 'effectful-better-auth'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

const state = vi.hoisted(() => ({
  strong: vi.fn(),
  suspension: vi.fn(),
  impersonation: vi.fn(),
  ssoRequired: vi.fn(),
  disabledSso: vi.fn(),
  plugin: vi.fn(),
  twoFactor: vi.fn(),
  audit: vi.fn(),
  ssoAudit: vi.fn(),
  notification: vi.fn(),
  evidence: vi.fn()
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
  withWebRequestScope: (_metadata: unknown, effect: Effect.Effect<unknown>) => effect
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
vi.mock('@/lib/server/strong-authentication-http', () => ({
  strongAuthenticationHttpResponse: state.strong
}))
vi.mock('@/lib/server/auth-organization-suspension', () => ({
  isOrganizationProductAction: (exchange: { pathname: string }) =>
    exchange.pathname.includes('/organization/'),
  suspendedOrganizationResponse: state.suspension
}))
vi.mock('@/lib/server/impersonation-guard', () => ({
  impersonationForbiddenAction: () => null,
  impersonationGuardResponse: state.impersonation
}))
vi.mock('@/lib/server/sso-sign-in-gate', () => ({
  enforceSsoRequired: state.ssoRequired,
  refuseDisabledConnection: state.disabledSso
}))
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
vi.mock('@/lib/server/turnstile.effects', () => ({
  makeTurnstileLayer: () => Layer.empty
}))
vi.mock('effectful-better-auth', async () => {
  const actual = await vi.importActual<typeof BetterAuthModule>('effectful-better-auth')
  return { ...actual, handleWebRequest: state.plugin }
})

import { handleAuth } from './auth-http'

function request(pathname: string) {
  return new Request(`https://example.test${pathname}`, { method: 'POST' })
}

beforeEach(() => {
  state.strong.mockResolvedValue(null)
  state.suspension.mockResolvedValue(null)
  state.impersonation.mockReturnValue(Effect.succeed(null))
  state.ssoRequired.mockReturnValue(Effect.succeed(null))
  state.disabledSso.mockReturnValue(Effect.succeed(null))
  state.plugin.mockReturnValue(Effect.succeed(new Response('plugin')))
  state.twoFactor.mockReturnValue(Effect.succeed(null))
  state.audit.mockReturnValue(Effect.succeed('skipped'))
  state.ssoAudit.mockReturnValue(Effect.succeed(undefined))
  state.notification.mockReturnValue(Effect.succeed(undefined))
  state.evidence.mockReturnValue(Effect.succeed(undefined))
})

describe('auth HTTP handler', () => {
  it('returns a pre-handler refusal without running the plugin or post handlers', async () => {
    state.suspension.mockResolvedValue(
      new Response(JSON.stringify({ code: 'workspace_suspended' }), {
        status: 403
      })
    )
    const response = await handleAuth(request('/api/auth/organization/update'))

    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ code: 'workspace_suspended' })
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
