import { describe, expect, it } from 'vitest'
import { parseOperationsConfig } from './config.ts'

const valid = {
  OPERATIONS_AUTH_SECRET: 'operations-secret-that-is-at-least-thirty-two-bytes',
  OPERATIONS_APP_ORIGIN: 'https://operations.example.com',
  OPERATIONS_AUTH_TRUSTED_ORIGINS: 'https://operations.example.com',
  MERCHANT_AUTH_SECRET: 'different-merchant-secret-that-is-long-enough',
  ENVIRONMENT: 'production'
} as const

describe('Operations Worker configuration', () => {
  it('accepts an isolated production origin and secret', () => {
    expect(parseOperationsConfig(valid)).toMatchObject({
      baseURL: valid.OPERATIONS_APP_ORIGIN,
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
    [{ ...valid, OPERATIONS_LOCAL_SEED: 'enabled' }, 'local seed']
  ])('fails closed for invalid isolated configuration', (env, message) => {
    expect(() => parseOperationsConfig(env)).toThrow(message)
  })
})
