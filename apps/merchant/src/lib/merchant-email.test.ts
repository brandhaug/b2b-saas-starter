import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMerchantEmailDelivery } from './merchant-email.ts'

describe('Merchant verification and recovery email delivery', () => {
  afterEach(() => vi.restoreAllMocks())

  it('exposes a local verification link without an external email provider or submitted email', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const delivery = createMerchantEmailDelivery({}, false)

    await delivery.sendVerificationEmail({
      user: { email: 'owner@example.test' },
      token: 'not-logged',
      url: 'http://localhost:3072/api/auth/verify-email?token=not-logged'
    })

    expect(delivery.isConfigured).toBe(true)
    expect(info).toHaveBeenCalledWith(
      'merchant auth verification link: http://localhost:3072/api/auth/verify-email?token=not-logged'
    )
    expect(info.mock.calls.flat().join(' ')).not.toContain('owner@example.test')
  })

  it('requires a configured sender and binding in production', () => {
    expect(createMerchantEmailDelivery({}, true).isConfigured).toBe(false)
  })
})
