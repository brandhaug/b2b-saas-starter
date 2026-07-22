import { describe, expect, it } from 'vitest'
import { resolveMerchantAuthConfig } from './merchant-auth-config.ts'

const production = {
  MERCHANT_AUTH_SECRET:
    'merchant-production-secret-that-is-at-least-thirty-two-characters',
  MERCHANT_AUTH_URL: 'https://app.example.test',
  MERCHANT_AUTH_TRUSTED_ORIGINS: 'https://app.example.test'
}

describe('Merchant Better Auth runtime configuration', () => {
  it('keeps provider-light local defaults in development', () => {
    expect(resolveMerchantAuthConfig({}, false)).toEqual({
      secret: 'local-merchant-auth-secret-change-me-minimum-32-chars',
      baseURL: 'http://localhost:3072',
      trustedOrigins: ['http://localhost:3072']
    })
  })

  it.each([
    [
      {
        MERCHANT_AUTH_URL: production.MERCHANT_AUTH_URL,
        MERCHANT_AUTH_TRUSTED_ORIGINS: production.MERCHANT_AUTH_TRUSTED_ORIGINS
      },
      'MERCHANT_AUTH_SECRET'
    ],
    [
      {
        MERCHANT_AUTH_SECRET: production.MERCHANT_AUTH_SECRET,
        MERCHANT_AUTH_TRUSTED_ORIGINS: production.MERCHANT_AUTH_TRUSTED_ORIGINS
      },
      'MERCHANT_AUTH_URL'
    ],
    [
      {
        MERCHANT_AUTH_SECRET: production.MERCHANT_AUTH_SECRET,
        MERCHANT_AUTH_URL: production.MERCHANT_AUTH_URL
      },
      'MERCHANT_AUTH_TRUSTED_ORIGINS'
    ]
  ] as const)('fails closed when production is missing %s', (environment, name) => {
    expect(() => resolveMerchantAuthConfig(environment, true)).toThrow(name)
  })

  it.each(['http://localhost:3072', 'https://127.0.0.2', 'https://[0:0:0:0:0:0:0:1]'])(
    'rejects an insecure or loopback production origin: %s',
    (localOrigin) => {
      expect(() =>
        resolveMerchantAuthConfig(
          {
            ...production,
            MERCHANT_AUTH_URL: localOrigin,
            MERCHANT_AUTH_TRUSTED_ORIGINS: localOrigin
          },
          true
        )
      ).toThrow('HTTPS')
    }
  )

  it('requires the configured base URL to be trusted', () => {
    expect(() =>
      resolveMerchantAuthConfig(
        {
          ...production,
          MERCHANT_AUTH_TRUSTED_ORIGINS: 'https://other.example.test'
        },
        true
      )
    ).toThrow('base URL')
  })

  it('returns validated production configuration', () => {
    expect(resolveMerchantAuthConfig(production, true)).toEqual({
      secret: production.MERCHANT_AUTH_SECRET,
      baseURL: production.MERCHANT_AUTH_URL,
      trustedOrigins: [production.MERCHANT_AUTH_URL]
    })
  })
})
