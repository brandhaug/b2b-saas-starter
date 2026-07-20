import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  createOperationsWorker,
  type OperationsWorkerEnv
} from './operations-worker.ts'

const origin = 'http://operations.localhost:3076'
const secret = 'operations-rate-limit-secret-that-is-at-least-thirty-two-bytes'

const envFor = (
  testD1: TestD1,
  overrides: Partial<OperationsWorkerEnv> = {}
): OperationsWorkerEnv => ({
  DB: testD1.d1,
  OPERATIONS_AUTH_SECRET: secret,
  OPERATIONS_APP_ORIGIN: origin,
  OPERATIONS_AUTH_TRUSTED_ORIGINS: origin,
  ENVIRONMENT: 'test',
  ...overrides
})

const formRequest = (path: string, form: Record<string, string>) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'cf-connecting-ip': '203.0.113.7',
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(form)
  })

describe('Operations Worker authentication limits', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  it('returns the same retryable response for every submitted sign-in identity', async () => {
    const denied = { limit: () => Promise.resolve({ success: false }) }
    const worker = createOperationsWorker()
    const env = envFor(testD1, {
      RATE_LIMITER_OPERATIONS_AUTHENTICATION: denied
    })

    const first = await worker.fetch(
      formRequest('/sign-in', {
        email: 'known@example.test',
        password: 'not-relevant'
      }),
      env
    )
    const second = await worker.fetch(
      formRequest('/sign-in', {
        email: 'unknown@example.test',
        password: 'not-relevant'
      }),
      env
    )
    const direct = await worker.fetch(
      new Request(`${origin}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          origin,
          'cf-connecting-ip': '203.0.113.7',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          email: 'direct-api@example.test',
          password: 'not-relevant'
        })
      }),
      env
    )

    expect(first.status).toBe(429)
    expect(second.status).toBe(429)
    expect(direct.status).toBe(429)
    expect(first.headers.get('retry-after')).toBe('60')
    expect(await first.text()).toBe(await second.text())
    expect(await direct.text()).toBe(
      JSON.stringify({
        error: 'authentication_temporarily_unavailable',
        retryable: true
      })
    )
  })

  it('does not let protected read traffic consume the password or TOTP controls', async () => {
    const reads = vi.fn(() => Promise.resolve({ success: true }))
    const authentication = vi.fn(() => Promise.resolve({ success: false }))
    const totp = vi.fn(() => Promise.resolve({ success: false }))
    const worker = createOperationsWorker()
    const env = envFor(testD1, {
      RATE_LIMITER_OPERATIONS_READ: { limit: reads },
      RATE_LIMITER_OPERATIONS_AUTHENTICATION: { limit: authentication },
      RATE_LIMITER_OPERATIONS_TOTP: { limit: totp }
    })

    await worker.fetch(
      new Request(`${origin}/`, {
        headers: { 'cf-connecting-ip': '203.0.113.8' }
      }),
      env
    )
    await worker.fetch(
      new Request(`${origin}/api/auth/get-session`, {
        headers: { 'cf-connecting-ip': '203.0.113.8' }
      }),
      env
    )
    await worker.fetch(
      formRequest('/sign-in', {
        email: 'operator@example.test',
        password: 'not-relevant'
      }),
      env
    )
    await worker.fetch(formRequest('/verify-totp', { code: '000000' }), env)

    expect(reads).toHaveBeenCalledTimes(2)
    expect(authentication).toHaveBeenCalledTimes(1)
    expect(totp).toHaveBeenCalledTimes(1)
  })

  it('keys production-prefixed challenge cookies independently', async () => {
    const keys: string[] = []
    const worker = createOperationsWorker()
    const env = envFor(testD1, {
      RATE_LIMITER_OPERATIONS_TOTP: {
        limit: ({ key }) => {
          keys.push(key)
          return Promise.resolve({ success: false })
        }
      }
    })
    const request = (challenge: string) =>
      new Request(`${origin}/verify-totp`, {
        method: 'POST',
        headers: {
          cookie: `__Secure-operations.two_factor=${challenge}`,
          'cf-connecting-ip': '203.0.113.9',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: new URLSearchParams({ code: '000000' })
      })

    await worker.fetch(request('challenge-one'), env)
    await worker.fetch(request('challenge-two'), env)

    expect(new Set(keys)).toHaveLength(2)
  })
})
