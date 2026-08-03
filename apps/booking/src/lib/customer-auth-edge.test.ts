import { describe, expect, it } from 'vitest'
import {
  customerAuthProviderOutcome,
  customerAuthProviderState
} from './customer-auth-edge.ts'

const config = {
  db: {} as D1Database,
  secret: 'test-secret-that-is-long-enough-for-auth',
  baseURL: 'https://booking.test/api/customer-auth',
  trustedOrigin: 'https://booking.test',
  production: false,
  googleEnabled: false,
  appleEnabled: false
}

describe('customer auth edge', () => {
  it('keeps anonymous booking available when providers are disabled or incomplete', () => {
    expect(customerAuthProviderState(config)).toEqual({
      google: 'disabled',
      apple: 'disabled'
    })
    expect(customerAuthProviderState({ ...config, googleEnabled: true })).toEqual({
      google: 'needs_configuration',
      apple: 'disabled'
    })
  })

  it('configures Google and Apple independently', () => {
    expect(
      customerAuthProviderState({
        ...config,
        googleEnabled: true,
        googleClientId: 'google-id',
        googleClientSecret: 'google-secret',
        appleEnabled: true,
        appleClientId: 'apple-id',
        appleClientSecret: 'apple-secret'
      })
    ).toEqual({ google: 'configured', apple: 'configured' })
  })

  it('reports real callback error and authenticated success outcomes', () => {
    expect(
      customerAuthProviderOutcome(
        new URL(
          'https://booking.test/customer-identity/providers?provider=google&error=access_denied'
        ),
        null
      )
    ).toEqual({ state: 'error' })
    expect(
      customerAuthProviderOutcome(
        new URL('https://booking.test/customer-identity/providers?provider=apple'),
        'apple'
      )
    ).toEqual({ state: 'success', provider: 'apple' })
  })
})
