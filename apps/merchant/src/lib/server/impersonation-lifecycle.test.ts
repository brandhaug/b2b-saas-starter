import { describe, expect, it, vi } from 'vitest'
import { makeSignature } from 'better-auth/crypto'
import {
  clearImpersonationCookie,
  resolveMerchantImpersonationLifecycle,
  verifiedMerchantSessionToken
} from './impersonation-lifecycle.ts'

describe('Merchant impersonation lifecycle boundary', () => {
  it('does not inspect or disturb a normal Merchant Session', async () => {
    const resolve = vi.fn()

    const result = await resolveMerchantImpersonationLifecycle({
      session: {
        session: { id: 'normal_session', impersonatedBy: null }
      },
      resolve,
      operationsOrigin: 'https://operations.example.test'
    })

    expect(result).toBeNull()
    expect(resolve).not.toHaveBeenCalled()
  })

  it('builds the exact Operations Member return path for terminal lifecycles', async () => {
    const result = await resolveMerchantImpersonationLifecycle({
      session: {
        session: { id: 'imp_session', impersonatedBy: 'opr_1' }
      },
      resolve: async () => ({
        state: 'terminated',
        lifecycle: 'stopped',
        terminationCause: 'manual-stop',
        merchantId: 'merchant / one',
        targetMemberId: 'member / one'
      }),
      operationsOrigin: 'https://operations.example.test'
    })

    expect(result).toMatchObject({
      returnTo:
        'https://operations.example.test/merchants/merchant%20%2F%20one/members/member%20%2F%20one'
    })
  })

  it('clears only the host-only impersonation cookie', () => {
    expect(clearImpersonationCookie(true)).toBe(
      '__Secure-merchant.session_token=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Lax'
    )
    expect(clearImpersonationCookie(false)).toBe(
      'merchant.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax'
    )
  })

  it('recovers only an authentic presented session token after absolute expiry', async () => {
    const secret = 'merchant-secret-that-is-at-least-thirty-two-characters'
    const token = 'expired-impersonation-session-token'
    const signature = await makeSignature(token, secret)

    await expect(
      verifiedMerchantSessionToken({
        cookie: `theme=dark; __Secure-merchant.session_token=${encodeURIComponent(`${token}.${signature}`)}`,
        secret,
        production: true
      })
    ).resolves.toBe(token)
    await expect(
      verifiedMerchantSessionToken({
        cookie: `__Secure-merchant.session_token=${token}.tampered`,
        secret,
        production: true
      })
    ).resolves.toBeNull()
  })
})
