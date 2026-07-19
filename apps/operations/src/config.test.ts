import { describe, expect, it } from 'vitest'
import { parseOperationsConfig } from './config.ts'

const valid = {
  OPERATIONS_AUTH_SECRET: 'operations-secret-that-is-at-least-thirty-two-bytes',
  OPERATIONS_APP_ORIGIN: 'https://operations.example.com',
  OPERATIONS_AUTH_TRUSTED_ORIGINS: 'https://operations.example.com',
  MERCHANT_APP_ORIGIN: 'https://merchant.example.com',
  MERCHANT_AUTH_SECRET: 'different-merchant-secret-that-is-long-enough',
  OPERATIONS_RATE_LIMIT_SESSION_READ: '120',
  OPERATIONS_RATE_LIMIT_AUTHENTICATION: '10',
  OPERATIONS_RATE_LIMIT_TOTP: '5',
  OPERATIONS_RATE_LIMIT_SEARCH: '30',
  OPERATIONS_RATE_LIMIT_MANAGEMENT: '20',
  OPERATIONS_RATE_LIMIT_IMPERSONATION_START: '10',
  OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE: '10',
  OPERATIONS_RATE_LIMIT_WINDOW_SECONDS: '60',
  ENVIRONMENT: 'production'
} as const

describe('Operations Worker configuration', () => {
  it('accepts an isolated production origin and secret', () => {
    expect(parseOperationsConfig(valid)).toMatchObject({
      baseURL: valid.OPERATIONS_APP_ORIGIN,
      merchantBaseURL: valid.MERCHANT_APP_ORIGIN,
      production: true,
      trustedOrigins: [valid.OPERATIONS_APP_ORIGIN]
    })
  })

  it.each([
    [{ ...valid, OPERATIONS_AUTH_SECRET: 'short' }, 'OPERATIONS_AUTH_SECRET'],
    [{ ...valid, OPERATIONS_APP_ORIGIN: 'http://operations.example.com' }, 'https'],
    [
      { ...valid, OPERATIONS_AUTH_TRUSTED_ORIGINS: 'https://merchant.example.com' },
      'trusted origins'
    ],
    [{ ...valid, MERCHANT_AUTH_SECRET: valid.OPERATIONS_AUTH_SECRET }, 'distinct'],
    [{ ...valid, MERCHANT_APP_ORIGIN: valid.OPERATIONS_APP_ORIGIN }, 'distinct'],
    [{ ...valid, MERCHANT_APP_ORIGIN: 'http://merchant.example.com' }, 'https'],
    [{ ...valid, OPERATIONS_LOCAL_SEED: 'enabled' }, 'local seed']
  ])('fails closed for invalid isolated configuration', (env, message) => {
    expect(() => parseOperationsConfig(env)).toThrow(message)
  })

  it.each([undefined, 'staging', 'preview', 'production'])(
    'rejects deterministic credentials in %s',
    (environment) => {
      expect(() =>
        parseOperationsConfig({
          ...valid,
          ...(environment === undefined ? {} : { ENVIRONMENT: environment }),
          OPERATIONS_LOCAL_SEED: 'enabled'
        })
      ).toThrow('outside local development')
    }
  )

  it('requires valid deployment-owned rate-limit thresholds in production', () => {
    const {
      OPERATIONS_RATE_LIMIT_AUTHENTICATION: _authentication,
      ...missingAuthentication
    } = valid
    expect(() => parseOperationsConfig(missingAuthentication)).toThrow(
      'OPERATIONS_RATE_LIMIT_AUTHENTICATION is required'
    )
    expect(() =>
      parseOperationsConfig({
        ...valid,
        OPERATIONS_RATE_LIMIT_TOTP: '0'
      })
    ).toThrow('OPERATIONS_RATE_LIMIT_TOTP must be a positive integer')
  })

  it('uses finite deterministic limits in local test mode', () => {
    const local = parseOperationsConfig({
      OPERATIONS_AUTH_SECRET: valid.OPERATIONS_AUTH_SECRET,
      OPERATIONS_APP_ORIGIN: 'http://operations.localhost:3076',
      OPERATIONS_AUTH_TRUSTED_ORIGINS: 'http://operations.localhost:3076',
      ENVIRONMENT: 'test'
    })
    expect(local.rateLimits).toEqual({
      fallbackLimits: {
        'operator-session-read': 1_000,
        'operator-authentication': 100,
        'operator-totp': 100,
        'merchant-discovery': 100,
        'operator-management': 100,
        'impersonation-start': 100,
        'handoff-exchange': 100
      },
      retryAfterSeconds: 60
    })
  })
})
