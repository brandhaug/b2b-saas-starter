import { describe, expect, it } from 'vitest'
import type { D1Database } from '@cloudflare/workers-types'
import { createOperationsWorker, type OperationsWorkerEnv } from './index.ts'

const production = {
  DB: {} as D1Database,
  OPERATIONS_AUTH_SECRET: 'operations-secret-that-is-at-least-thirty-two-bytes',
  OPERATIONS_APP_ORIGIN: 'https://operations.example.test',
  OPERATIONS_AUTH_TRUSTED_ORIGINS: 'https://operations.example.test',
  MERCHANT_APP_ORIGIN: 'https://merchant.example.test',
  MERCHANT_AUTH_SECRET: 'merchant-secret-that-is-at-least-thirty-two-bytes',
  OPERATIONS_RATE_LIMIT_SESSION_READ: '120',
  OPERATIONS_RATE_LIMIT_AUTHENTICATION: '10',
  OPERATIONS_RATE_LIMIT_TOTP: '5',
  OPERATIONS_RATE_LIMIT_SEARCH: '30',
  OPERATIONS_RATE_LIMIT_MANAGEMENT: '20',
  OPERATIONS_RATE_LIMIT_IMPERSONATION_START: '10',
  OPERATIONS_RATE_LIMIT_HANDOFF_EXCHANGE: '10',
  OPERATIONS_RATE_LIMIT_WINDOW_SECONDS: '60',
  OPERATIONS_SECURITY_CONTACT: 'security@example.test',
  CLOUDFLARE_EMAIL_FROM: 'operations@example.test',
  ENVIRONMENT: 'production'
} as const satisfies OperationsWorkerEnv

describe('Operations production readiness', () => {
  it('fails closed without the transactional email adapter', async () => {
    const response = await createOperationsWorker().fetch(
      new Request('https://operations.example.test/ready'),
      production
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: 'operations_email_unavailable'
    })
  })

  it('reports ready without Cloudflare Access when application controls are configured', async () => {
    const response = await createOperationsWorker().fetch(
      new Request('https://operations.example.test/ready'),
      { ...production, EMAIL: { send: async () => undefined } }
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ status: 'ready' })
  })
})
