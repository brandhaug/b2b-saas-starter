import { describe, expect, it } from 'vite-plus/test'

import {
  isEmailOtpSignIn,
  isMagicLinkVerify,
  isSessionMintingSuccess,
  responseSessionCookies,
  twoFactorRefusal
} from './two-factor-sign-in-gate'

/**
 * The decision cores are pure; the one effectful wrapper (`enforceTwoFactorSignIn`)
 * reads a live session through `authRuntime`, which needs a worker and a D1 —
 * the plugin-level behavior it guards against is pinned by
 * `packages/auth/src/live-two-factor.test.ts` instead.
 */

const EMAIL_OTP = { method: 'POST', pathname: '/api/auth/sign-in/email-otp' }
const MAGIC_LINK = { method: 'GET', pathname: '/api/auth/magic-link/verify' }

function withCookies(cookies: ReadonlyArray<string>): Response {
  const headers = new Headers()
  for (const cookie of cookies) {
    headers.append('set-cookie', cookie)
  }
  return new Response(null, { status: 200, headers })
}

describe('path matchers', () => {
  it('matches the two mailbox-only sign-ins and nothing else', () => {
    expect(isEmailOtpSignIn(EMAIL_OTP)).toBe(true)
    expect(isMagicLinkVerify(MAGIC_LINK)).toBe(true)
    // The credential path is not this gate's — the plugin's own challenge
    // hop covers it.
    expect(
      isEmailOtpSignIn({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBe(false)
    expect(
      isMagicLinkVerify({ method: 'POST', pathname: '/api/auth/magic-link/verify' })
    ).toBe(false)
    expect(
      isEmailOtpSignIn({ method: 'GET', pathname: '/api/auth/sign-in/email-otp' })
    ).toBe(false)
    // The passkey bypass is deliberate (ADR 0056) and stays ungated.
    expect(
      isEmailOtpSignIn({
        method: 'POST',
        pathname: '/api/auth/passkey/verify-authentication'
      })
    ).toBe(false)
  })
})

describe('isSessionMintingSuccess', () => {
  it('takes only success shapes — every failure passes through untouched', () => {
    expect(
      isSessionMintingSuccess(EMAIL_OTP, new Response(null, { status: 200 }))
    ).toBe(true)
    // The plugin's own failures (wrong code, unknown address, lockout).
    expect(
      isSessionMintingSuccess(EMAIL_OTP, new Response(null, { status: 400 }))
    ).toBe(false)
    expect(
      isSessionMintingSuccess(EMAIL_OTP, new Response(null, { status: 403 }))
    ).toBe(false)
    expect(
      isSessionMintingSuccess(MAGIC_LINK, new Response(null, { status: 302 }))
    ).toBe(true)
    expect(
      isSessionMintingSuccess(MAGIC_LINK, new Response(null, { status: 400 }))
    ).toBe(false)
    // Other exchanges never reach a refusal, whatever they answer.
    expect(
      isSessionMintingSuccess(
        { method: 'POST', pathname: '/api/auth/sign-in/email' },
        new Response(null, { status: 200 })
      )
    ).toBe(false)
  })
})

describe('responseSessionCookies', () => {
  it('finds the better-auth session cookie among everything else the response set', () => {
    const cookie = responseSessionCookies(
      withCookies([
        'better-auth.session_token=jwt.token; Path=/; HttpOnly',
        'better-auth.csrf_token=csrf; Path=/',
        'better-auth.last_used_login_method=email; Path=/'
      ])
    )
    expect(cookie).toBe('better-auth.session_token=jwt.token')
  })

  it('matches the __Secure- prefixed spelling and joins rotations', () => {
    const cookie = responseSessionCookies(
      withCookies([
        '__Secure-better-auth.session_token=first; Path=/',
        '__Secure-better-auth.session_token=second; Path=/'
      ])
    )
    expect(cookie).toBe(
      '__Secure-better-auth.session_token=first; __Secure-better-auth.session_token=second'
    )
  })

  it('returns null when no session was minted — a failure redirect lands here too', () => {
    expect(
      responseSessionCookies(withCookies(['better-auth.csrf_token=csrf; Path=/']))
    ).toBeNull()
    expect(responseSessionCookies(new Response(null, { status: 302 }))).toBeNull()
  })
})

describe('twoFactorRefusal', () => {
  it('answers the code path with the better-call error body convention', async () => {
    const response = twoFactorRefusal(EMAIL_OTP)
    expect(response?.status).toBe(403)
    expect(response?.headers.get('content-type')).toBe(
      'application/json; charset=utf-8'
    )
    expect(await response?.json()).toEqual({
      code: 'two_factor_required',
      message:
        'This account uses two-factor authentication. Sign in with your password and authenticator.'
    })
  })

  it('answers the link path with the redirect the sign-in page already renders', () => {
    const response = twoFactorRefusal(MAGIC_LINK)
    expect(response?.status).toBe(302)
    expect(response?.headers.get('location')).toBe('/sign-in?error=two_factor_required')
  })

  it('carries no Set-Cookie — the minted session must not survive its refusal', () => {
    expect(twoFactorRefusal(EMAIL_OTP)?.headers.getSetCookie()).toHaveLength(0)
    expect(twoFactorRefusal(MAGIC_LINK)?.headers.getSetCookie()).toHaveLength(0)
  })

  it('stays null for exchanges it does not govern', () => {
    expect(
      twoFactorRefusal({ method: 'POST', pathname: '/api/auth/sign-in/email' })
    ).toBeNull()
    expect(
      twoFactorRefusal({
        method: 'POST',
        pathname: '/api/auth/passkey/verify-authentication'
      })
    ).toBeNull()
  })
})
