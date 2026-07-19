import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  merchantMemberships,
  merchants,
  publicBookingPages,
  user
} from '@b2b-saas-starter/db/schema'
import {
  createOperationsAuth,
  createOperationsAuthHandler,
  provisionLocalOperator
} from '@b2b-saas-starter/auth/operations'
import { createOperationsWorker, type OperationsWorkerEnv } from './index.ts'

const origin = 'http://operations.test'
const secret = 'operations-http-secret-that-is-at-least-thirty-two-bytes'

const cookieFor = (response: Response, name: string): string => {
  const cookie = response.headers
    .getSetCookie()
    .find((value) => value.startsWith(`${name}=`))
  if (!cookie) throw new Error(`missing ${name} cookie`)
  return cookie.split(';', 1)[0]!
}

describe('Operations Merchant discovery HTTP boundary', () => {
  let testD1: TestD1
  let env: OperationsWorkerEnv
  let readerCookie: string
  let auditorCookie: string

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    const db = createDb(testD1.d1)
    const auth = createOperationsAuth({
      db,
      secret,
      baseURL: origin,
      trustedOrigins: [origin],
      production: false,
      securityContact: 'security@example.test'
    })
    const authHandler = createOperationsAuthHandler({ auth, db })
    const authenticate = async (operator: {
      readonly id: string
      readonly email: string
      readonly name: string
      readonly password: string
      readonly totpSecret: string
      readonly roles: readonly ('merchant-reader' | 'impersonation-auditor')[]
    }) => {
      await provisionLocalOperator({ db, secret, mode: 'test', operator })
      const password = await authHandler(
        new Request(`${origin}/api/auth/sign-in/email`, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
          body: JSON.stringify({ email: operator.email, password: operator.password })
        })
      )
      const challenge = cookieFor(password, 'operations.two_factor')
      const { code } = await auth.api.generateTOTP({
        body: { secret: operator.totpSecret }
      })
      const verified = await authHandler(
        new Request(`${origin}/api/auth/two-factor/verify-totp`, {
          method: 'POST',
          headers: {
            origin,
            cookie: challenge,
            'content-type': 'application/json'
          },
          body: JSON.stringify({ code, trustDevice: false })
        })
      )
      return cookieFor(verified, 'operations.session_token')
    }
    readerCookie = await authenticate({
      id: 'opr_http_reader',
      email: 'http-reader@operations.test',
      name: 'HTTP Reader',
      password: 'http-reader-password',
      totpSecret: 'JBSWY3DPEHPK3PXP',
      roles: ['merchant-reader']
    })
    auditorCookie = await authenticate({
      id: 'opr_http_auditor',
      email: 'http-auditor@operations.test',
      name: 'HTTP Auditor',
      password: 'http-auditor-password',
      totpSecret: 'KRSXG5DSNFXGOIDB',
      roles: ['impersonation-auditor']
    })
    const now = new Date('2026-07-19T09:00:00.000Z')
    await db.insert(user).values({
      id: 'mem_http_target',
      email: 'member-http@example.test',
      name: 'HTTP Target',
      emailVerified: true,
      identityClass: 'merchant_member',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(merchants).values({
      id: 'mer_http_target',
      publicName: 'HTTP Merchant',
      slug: 'http-merchant',
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(merchantMemberships).values({
      merchantId: 'mer_http_target',
      userId: 'mem_http_target',
      role: 'owner',
      createdAt: now.toISOString()
    })
    await db.insert(publicBookingPages).values({
      id: 'pbp_http_target',
      merchantId: 'mer_http_target',
      status: 'unpublished',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    env = {
      DB: testD1.d1,
      OPERATIONS_AUTH_SECRET: secret,
      OPERATIONS_APP_ORIGIN: origin,
      OPERATIONS_AUTH_TRUSTED_ORIGINS: origin,
      ENVIRONMENT: 'test'
    }
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const get = (path: string, cookie?: string) =>
    createOperationsWorker().fetch(
      new Request(`${origin}${path}`, cookie ? { headers: { cookie } } : {}),
      env
    )

  it('requires an Operator Session and merchant:read on every endpoint', async () => {
    const anonymous = await get('/api/merchants/search?q=http')
    expect(anonymous.status).toBe(303)
    expect(anonymous.headers.get('location')).toBe('/sign-in')

    const denied = await get('/api/merchants/search?q=http', auditorCookie)
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'forbidden' })

    const deniedDetail = await get(
      '/api/merchants/mer_http_target/members/mem_http_target',
      auditorCookie
    )
    expect(deniedDetail.status).toBe(403)
  })

  it('serves bounded search and exact detail DTOs with neutral empty results', async () => {
    const search = await get('/api/merchants/search?q=mer_http_target', readerCookie)
    expect(search.status).toBe(200)
    expect(await search.json()).toMatchObject({
      results: [{ id: 'mer_http_target', publicName: 'HTTP Merchant' }]
    })

    const empty = await get('/api/members/search?q=nobody', readerCookie)
    expect(await empty.json()).toEqual({ results: [] })

    const memberSearch = await get(
      '/api/members/search?q=mem_http_target',
      readerCookie
    )
    expect(await memberSearch.json()).toMatchObject({
      results: [
        {
          id: 'mem_http_target',
          merchant: { id: 'mer_http_target', role: 'owner' }
        }
      ]
    })

    const invalid = await get('/api/merchants/search?q=%20%20', readerCookie)
    expect(invalid.status).toBe(400)

    const member = await get(
      '/api/merchants/mer_http_target/members/mem_http_target',
      readerCookie
    )
    const body = await member.text()
    expect(member.status).toBe(200)
    expect(JSON.parse(body)).toMatchObject({
      id: 'mem_http_target',
      membership: { merchantId: 'mer_http_target' },
      impersonationEligibility: { eligible: true }
    })
    expect(body).not.toMatch(/token|password|secret|backup|customer/i)
  })
})
