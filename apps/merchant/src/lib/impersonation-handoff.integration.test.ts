import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeSignature } from 'better-auth/crypto'
import { eq } from 'drizzle-orm'
import { createMerchantAuth } from '@b2b-saas-starter/auth'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  impersonationRecords,
  merchantMemberships,
  merchants,
  operationsNotificationIntents,
  session,
  twoFactor,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { createMerchantImpersonationHandoffHandler } from './impersonation-handoff.ts'

const merchantOrigin = 'https://merchant.example.test'
const operationsOrigin = 'https://operations.example.test'
const merchantSecret = 'merchant-secret-that-is-at-least-thirty-two-characters'
const now = new Date()

const sha256 = async (value: string) => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

describe('Merchant impersonation handoff HTTP boundary', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>
  let auth: ReturnType<typeof createMerchantAuth>

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
    auth = createMerchantAuth({
      db,
      secret: merchantSecret,
      baseURL: merchantOrigin,
      trustedOrigins: [merchantOrigin, operationsOrigin],
      production: true,
      sendVerificationEmail: async () => undefined,
      sendResetPassword: async () => undefined
    })
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const pending = async (suffix: string, ticket: string) => {
    const operatorId = `opr_${suffix}`
    const operatorSessionId = `ops_${suffix}`
    const targetMemberId = `mem_${suffix}`
    const merchantId = `mer_${suffix}`
    const impersonationId = `imp_${suffix}`
    const later = new Date(now.getTime() + 6 * 60 * 60 * 1_000)
    await db.insert(user).values([
      {
        id: operatorId,
        email: `${operatorId}@operations.test`,
        name: `Operator ${suffix}`,
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'merchant-impersonator',
        createdAt: now,
        updatedAt: now
      },
      {
        id: targetMemberId,
        email: `${targetMemberId}@merchant.test`,
        name: `Target ${suffix}`,
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values({
      id: operatorSessionId,
      token: `operator-token-${suffix}`,
      userId: operatorId,
      expiresAt: later,
      operatorIdleExpiresAt: later,
      operatorAbsoluteExpiresAt: later,
      operatorTotpVerifiedAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: now
    })
    await db.insert(twoFactor).values({
      id: `totp_${suffix}`,
      userId: operatorId,
      secret: 'encrypted-secret',
      backupCodes: 'encrypted-backup-codes',
      verified: true
    })
    await db.insert(merchants).values({
      id: merchantId,
      publicName: `Merchant ${suffix}`,
      slug: `merchant-${suffix}`,
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(merchantMemberships).values({
      merchantId,
      userId: targetMemberId,
      role: 'owner',
      createdAt: now.toISOString()
    })
    await db.insert(impersonationRecords).values({
      id: impersonationId,
      operatorId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      lifecycle: 'pending-handoff',
      reason: 'Investigate a customer report',
      supportReference: 'SUP-42',
      ticketHash: await sha256(ticket),
      handoffExpiresAt: new Date(now.getTime() + 60_000),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    return { operatorId, targetMemberId, merchantId, impersonationId }
  }

  const handler = (
    overrides: Partial<
      Parameters<typeof createMerchantImpersonationHandoffHandler>[0]
    > = {}
  ) =>
    createMerchantImpersonationHandoffHandler({
      db,
      auth,
      merchantSecret,
      merchantOrigin,
      operationsOrigin,
      production: true,
      securityContact: 'security@example.test',
      now: () => now,
      sessionId: () => 'impersonated_merchant_session',
      sessionToken: () => 'impersonated-merchant-session-token',
      notificationIntentId: () => 'opnti_impersonation_started',
      ...overrides
    })

  const exchange = (ticket: string, cookie?: string) => {
    const form = new FormData()
    form.set('ticket', ticket)
    return handler()(
      new Request(`${merchantOrigin}/impersonation/handoffs/exchange`, {
        method: 'POST',
        headers: { origin: operationsOrigin, ...(cookie ? { cookie } : {}) },
        body: form
      })
    )
  }

  it('activates by top-level POST and resolves the host-only Better Auth provenance', async () => {
    const ticket = 'ticket_dddddddddddddddddddddddddddddddddddd'
    const fixture = await pending('http_activation', ticket)

    const response = await exchange(ticket)

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe(`${merchantOrigin}/`)
    expect(response.headers.get('location')).not.toContain(ticket)
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('__Secure-merchant.session_token=')
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('Secure')
    expect(setCookie).toContain('SameSite=Lax')
    expect(setCookie).not.toMatch(/Domain=/i)
    const cookie = setCookie.split(';')[0]!
    const current = await auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(current).toMatchObject({
      user: { id: fixture.targetMemberId },
      session: { impersonatedBy: fixture.operatorId }
    })
    const [intent] = await db
      .select()
      .from(operationsNotificationIntents)
      .where(eq(operationsNotificationIntents.impersonationId, fixture.impersonationId))
    expect(intent).toMatchObject({ status: 'pending' })

    const replay = await exchange(ticket)
    expect(replay.status).toBe(400)
    expect(replay.headers.get('set-cookie')).toBeNull()
  })

  it('neutrally rejects an existing normal Merchant Session without modifying it', async () => {
    const ticket = 'ticket_eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    const fixture = await pending('normal_session', ticket)
    const normalToken = 'normal-merchant-session-token'
    await db.insert(session).values({
      id: 'normal_merchant_session',
      token: normalToken,
      userId: fixture.targetMemberId,
      expiresAt: new Date(now.getTime() + 6 * 60 * 60 * 1_000),
      createdAt: now,
      updatedAt: now
    })
    const signed = `${normalToken}.${await makeSignature(normalToken, merchantSecret)}`
    const cookie = `__Secure-merchant.session_token=${signed}`

    const response = await exchange(ticket, cookie)

    expect(response.status).toBe(409)
    expect(response.headers.get('set-cookie')).toBeNull()
    const current = await auth.api.getSession({ headers: new Headers({ cookie }) })
    expect(current).toMatchObject({
      user: { id: fixture.targetMemberId },
      session: { id: 'normal_merchant_session', impersonatedBy: null }
    })
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'pending-handoff',
      merchantSessionId: null
    })
  })

  it('does not overwrite a presented Merchant Session cookie even when it is invalid', async () => {
    const ticket = 'ticket_ffffffffffffffffffffffffffffffffffff'
    const fixture = await pending('invalid_cookie', ticket)

    const response = await exchange(
      ticket,
      '__Secure-merchant.session_token=invalid-session-cookie'
    )

    expect(response.status).toBe(409)
    expect(response.headers.get('set-cookie')).toBeNull()
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'pending-handoff',
      merchantSessionId: null
    })
  })

  it('rate-limits exchange before activation and returns a neutral retry response', async () => {
    const ticket = 'ticket_gggggggggggggggggggggggggggggggggggg'
    const fixture = await pending('rate_limited', ticket)
    const form = new FormData()
    form.set('ticket', ticket)
    const response = await handler({
      consumeRateLimit: async () => ({ allowed: false, retryAfterSeconds: 37 })
    })(
      new Request(`${merchantOrigin}/impersonation/handoffs/exchange`, {
        method: 'POST',
        headers: { origin: operationsOrigin },
        body: form
      })
    )

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('37')
    expect(await response.json()).toEqual({
      error: 'impersonation_handoff_rejected'
    })
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'pending-handoff',
      merchantSessionId: null
    })
  })
})
