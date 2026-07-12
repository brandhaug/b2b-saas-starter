import { describe, expect, it } from 'vitest'
import { handleCustomerIdentityProviderRequest } from './customer-identity-http.ts'

describe('customer identity provider edge', () => {
  it('exposes optional provider readiness without blocking anonymous booking', async () => {
    const response = handleCustomerIdentityProviderRequest(
      new Request('https://booking.test/customer-identity/providers'),
      { googleEnabled: true }
    )
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      anonymousBooking: 'available',
      providers: { google: 'needs_configuration', apple: 'disabled' }
    })
  })

  it('returns an explicit provider error while preserving anonymous continuation', async () => {
    const response = handleCustomerIdentityProviderRequest(
      new Request('https://booking.test/customer-identity/providers?error=google'),
      { googleEnabled: true, googleClientId: 'id', googleClientSecret: 'secret' }
    )
    expect(await response.json()).toMatchObject({
      anonymousBooking: 'available',
      providerError: 'google'
    })
  })
})
