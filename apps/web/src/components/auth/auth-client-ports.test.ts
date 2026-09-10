import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'

/**
 * The gated sends and their Turnstile header. Every path in the auth route's
 * `TURNSTILE_GATED_POST_PATHS` has an adapter here, and the gate refuses a
 * request without the header once TURNSTILE is configured — so "the adapter
 * puts the token on `x-turnstile-token`" is the contract that keeps the
 * screens working when the provider is on, and "no token, no header" is the
 * provider-light half.
 */
vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return { authClient: authClientDouble }
})

import { authClientDouble } from '@/test/fake-auth-client'
import {
  requestPasswordResetCodeWithAuthClient,
  requestPasswordResetWithAuthClient,
  sendEmailCodeWithAuthClient,
  sendVerificationEmailWithAuthClient,
  signUpWithAuthClient
} from './auth-client-ports'

const answer = { error: null }

beforeEach(() => {
  authClientDouble.signUp.email.mockReset().mockResolvedValue(answer)
  authClientDouble.requestPasswordReset.mockReset().mockResolvedValue(answer)
  authClientDouble.sendVerificationEmail.mockReset().mockResolvedValue(answer)
  authClientDouble.emailOtp.sendVerificationOtp.mockReset().mockResolvedValue(answer)
  authClientDouble.emailOtp.requestPasswordReset.mockReset().mockResolvedValue(answer)
})

// oxlint-disable-next-line effect/noAs -- `as const`, not a type assertion
const gatedSends = [
  {
    name: 'sign-up',
    send: (turnstileToken?: string) =>
      signUpWithAuthClient({
        name: 'Ada',
        email: 'ada@example.com',
        password: 'correct horse battery',
        turnstileToken
      }),
    endpoint: () => authClientDouble.signUp.email
  },
  {
    name: 'the reset link',
    send: (turnstileToken?: string) =>
      requestPasswordResetWithAuthClient({ email: 'ada@example.com', turnstileToken }),
    endpoint: () => authClientDouble.requestPasswordReset
  },
  {
    name: 'the reset code',
    send: (turnstileToken?: string) =>
      requestPasswordResetCodeWithAuthClient({
        email: 'ada@example.com',
        turnstileToken
      }),
    endpoint: () => authClientDouble.emailOtp.requestPasswordReset
  },
  {
    name: 'the verification email',
    send: (turnstileToken?: string) =>
      sendVerificationEmailWithAuthClient({ email: 'ada@example.com', turnstileToken }),
    endpoint: () => authClientDouble.sendVerificationEmail
  },
  {
    name: "the account page's verification email",
    send: (turnstileToken?: string) =>
      sendVerificationEmailWithAuthClient({
        email: 'ada@example.com',
        callbackPath: '/account',
        turnstileToken
      }),
    endpoint: () => authClientDouble.sendVerificationEmail
  },
  {
    name: 'the one-time code',
    send: (turnstileToken?: string) =>
      sendEmailCodeWithAuthClient({
        email: 'ada@example.com',
        purpose: 'sign-in',
        turnstileToken
      }),
    endpoint: () => authClientDouble.emailOtp.sendVerificationOtp
  }
] as const

describe('the Turnstile-gated sends', () => {
  it('lands the account page back on /account after verification', async () => {
    await sendVerificationEmailWithAuthClient({
      email: 'ada@example.com',
      callbackPath: '/account'
    })

    expect(authClientDouble.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'ada@example.com',
      callbackURL: `${window.location.origin}/account`
    })
  })

  it.each(gatedSends)('$name rides the challenge token on the header', async (row) => {
    await row.send('turnstile-token')

    expect(row.endpoint()).toHaveBeenCalledWith(
      expect.objectContaining({
        fetchOptions: { headers: { 'x-turnstile-token': 'turnstile-token' } }
      })
    )
  })

  it.each(gatedSends)('$name sends no header without a challenge', async (row) => {
    await row.send(undefined)

    const [payload] = row.endpoint().mock.calls[0] ?? []
    expect(payload).not.toHaveProperty('fetchOptions')
  })
})
