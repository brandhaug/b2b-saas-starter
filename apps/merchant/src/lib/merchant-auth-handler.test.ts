import { describe, expect, it, vi } from 'vitest'
import { createMerchantAuthHandler } from './merchant-auth-handler.ts'

describe('Merchant authentication HTTP boundary', () => {
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
})
