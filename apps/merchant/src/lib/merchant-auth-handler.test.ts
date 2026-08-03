import { describe, expect, it, vi } from 'vitest'
import { createMerchantAuthHandler } from './merchant-auth-handler.ts'

describe('Merchant authentication HTTP boundary', () => {
  it('allows an existing verified Merchant to sign in while email delivery is unavailable', async () => {
    const auth = {
      handler: vi.fn().mockResolvedValue(Response.json({ token: null }))
    }
    const handler = createMerchantAuthHandler({
      auth,
      emailDelivery: { isConfigured: false },
      environment: 'production',
      rateLimiter: { take: vi.fn().mockResolvedValue(true) }
    })

    const request = new Request('https://app.example.test/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'verified@example.test',
        password: 'correct-horse-battery-staple'
      })
    })
    const response = await handler(request)

    expect(response.status).toBe(200)
    expect(auth.handler).toHaveBeenCalledWith(request)
  })

  it('returns a needs-configuration response before production sign-up when verification email is unavailable', async () => {
    const auth = { handler: vi.fn() }
    const handler = createMerchantAuthHandler({
      auth,
      emailDelivery: { isConfigured: false },
      environment: 'production',
      rateLimiter: { take: vi.fn().mockResolvedValue(true) }
    })

    const response = await handler(
      new Request('https://app.example.test/api/auth/sign-up/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: 'Morgan Merchant',
          email: 'morgan@example.test',
          password: 'correct-horse-battery-staple'
        })
      })
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      code: 'merchant_email_needs_configuration',
      message: 'Merchant email verification is not configured yet.'
    })
    expect(auth.handler).not.toHaveBeenCalled()
  })

  it('limits authentication by both IP and a normalized email hash without passing the email onward', async () => {
    const auth = {
      handler: vi.fn().mockResolvedValue(new Response('{}', { status: 200 }))
    }
    const rateLimiter = { take: vi.fn().mockResolvedValue(true) }
    const handler = createMerchantAuthHandler({
      auth,
      emailDelivery: { isConfigured: true },
      environment: 'production',
      rateLimiter
    })

    const response = await handler(
      new Request('https://app.example.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: {
          'cf-connecting-ip': '203.0.113.8',
          'content-type': 'application/json'
        },
        body: JSON.stringify({ email: ' OWNER@EXAMPLE.TEST ', password: 'not-logged' })
      })
    )

    expect(response.status).toBe(200)
    expect(rateLimiter.take).toHaveBeenNthCalledWith(1, {
      bucket: 'auth_write',
      key: 'ip:203.0.113.8'
    })
    const emailLimit = rateLimiter.take.mock.calls[1]?.[0]
    expect(emailLimit).toMatchObject({ bucket: 'auth_write' })
    expect(emailLimit?.key).toMatch(/^email:[a-f0-9]{64}$/)
    expect(emailLimit?.key).not.toContain('OWNER@EXAMPLE.TEST')
    expect(auth.handler).toHaveBeenCalledTimes(1)
  })

  it('returns a typed 401 for an unauthenticated Merchant mutation', async () => {
    const auth = {
      handler: vi.fn(),
      getSession: vi.fn().mockResolvedValue(null)
    }
    const handler = createMerchantAuthHandler({
      auth,
      emailDelivery: { isConfigured: true },
      environment: 'production',
      rateLimiter: { take: vi.fn().mockResolvedValue(true) }
    })

    const response = await handler(
      new Request('https://app.example.test/api/auth/change-password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          currentPassword: 'not-logged',
          newPassword: 'not-logged'
        })
      })
    )

    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({
      error: 'merchant_unauthorized',
      message: 'Sign in and retry this change.'
    })
    expect(auth.handler).not.toHaveBeenCalled()
  })

  it.each([
    ['/api/auth/change-email', 'identity-security.update'],
    ['/api/auth/change-password', 'identity-security.update'],
    ['/api/auth/delete-user', 'identity.delete'],
    ['/api/auth/two-factor/enable', 'mfa.update'],
    ['/api/auth/link-social', 'identity-security.update'],
    ['/api/auth/revoke-session', 'identity-security.update']
  ] as const)(
    'denies impersonated requests to %s at the HTTP boundary',
    async (pathname, action) => {
      const auth = {
        handler: vi.fn(),
        getSession: vi.fn().mockResolvedValue({
          session: {
            id: 'mss_impersonated',
            impersonatedBy: 'opr_real',
            createdAt: new Date()
          }
        })
      }
      const authorizeImpersonated = vi
        .fn()
        .mockRejectedValue(new Error('impersonation authority denied'))
      const handler = createMerchantAuthHandler({
        auth,
        emailDelivery: { isConfigured: true },
        environment: 'production',
        rateLimiter: { take: vi.fn().mockResolvedValue(true) },
        authorizeImpersonated
      })

      const response = await handler(
        new Request(`https://app.example.test${pathname}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: '{}'
        })
      )

      expect(response.status).toBe(403)
      await expect(response.json()).resolves.toEqual({
        error: 'impersonation_authority_denied'
      })
      expect(authorizeImpersonated).toHaveBeenCalledWith({
        merchantSessionId: 'mss_impersonated',
        action
      })
      expect(auth.handler).not.toHaveBeenCalled()
    }
  )

  it('reauthorizes sensitive credential metadata reads before Better Auth', async () => {
    const auth = {
      handler: vi.fn().mockResolvedValue(Response.json({ sessions: [] })),
      getSession: vi.fn().mockResolvedValue({
        session: {
          id: 'mss_impersonated',
          impersonatedBy: 'opr_real',
          createdAt: new Date()
        }
      })
    }
    const authorizeImpersonated = vi.fn().mockResolvedValue(undefined)
    const handler = createMerchantAuthHandler({
      auth,
      emailDelivery: { isConfigured: true },
      environment: 'production',
      rateLimiter: { take: vi.fn().mockResolvedValue(true) },
      authorizeImpersonated
    })

    const response = await handler(
      new Request('https://app.example.test/api/auth/list-sessions')
    )

    expect(response.status).toBe(200)
    expect(authorizeImpersonated).toHaveBeenCalledWith({
      merchantSessionId: 'mss_impersonated',
      action: 'credential-metadata.read'
    })
    expect(auth.handler).toHaveBeenCalledTimes(1)
  })

  it('short-circuits a denied IP or email rate limit with 429', async () => {
    const auth = { handler: vi.fn() }
    const handler = createMerchantAuthHandler({
      auth,
      emailDelivery: { isConfigured: true },
      environment: 'production',
      rateLimiter: { take: vi.fn().mockResolvedValue(false) }
    })

    const response = await handler(
      new Request('https://app.example.test/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.test', password: 'not-logged' })
      })
    )

    expect(response.status).toBe(429)
    await expect(response.json()).resolves.toEqual({ error: 'rate_limited' })
    expect(auth.handler).not.toHaveBeenCalled()
  })
})
