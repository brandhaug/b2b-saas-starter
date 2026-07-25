import { describe, expect, it, vi } from 'vitest'
import { registerMerchantServiceWorker } from './merchant-service-worker.ts'

describe('Merchant App service worker registration', () => {
  it('registers the lifecycle worker at the authenticated origin root', async () => {
    const registration = {} as ServiceWorkerRegistration
    const register = vi.fn().mockResolvedValue(registration)

    await expect(registerMerchantServiceWorker({ register }, true)).resolves.toBe(
      registration
    )
    expect(register).toHaveBeenCalledWith('/merchant-sw.js', { scope: '/' })
  })

  it('does not leave a stale worker behind during local development', async () => {
    const register = vi.fn()

    await expect(registerMerchantServiceWorker({ register }, false)).resolves.toBeNull()
    expect(register).not.toHaveBeenCalled()
  })

  it('treats registration failures as an unavailable optional enhancement', async () => {
    const register = vi.fn().mockRejectedValue(new Error('token in a URL'))

    await expect(registerMerchantServiceWorker({ register }, true)).resolves.toBeNull()
  })
})
