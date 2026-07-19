import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  impersonationRecords,
  merchants,
  operationsAuditEvents,
  operationsNotificationIntents,
  session,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  OperationsImpersonationLifecycle,
  makeOperationsImpersonationLifecycleLayer
} from './operations-impersonation-lifecycle.ts'

const now = new Date('2026-07-19T15:00:00.000Z')
const hourLater = new Date('2026-07-19T16:00:00.000Z')

describe('Operations impersonation lifecycle', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const addActive = async (suffix: string, activeExpiresAt = hourLater) => {
    const operatorId = `opr_lifecycle_${suffix}`
    const operatorSessionId = `ops_lifecycle_${suffix}`
    const targetMemberId = `mem_lifecycle_${suffix}`
    const merchantId = `mer_lifecycle_${suffix}`
    const merchantSessionId = `mss_lifecycle_${suffix}`
    const impersonationId = `imp_lifecycle_${suffix}`
    await db.insert(user).values([
      {
        id: operatorId,
        email: `${operatorId}@operations.test`,
        name: `Lifecycle Operator ${suffix}`,
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
        name: `Lifecycle Target ${suffix}`,
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values([
      {
        id: operatorSessionId,
        token: `operator-token-${suffix}`,
        userId: operatorId,
        expiresAt: hourLater,
        operatorIdleExpiresAt: hourLater,
        operatorAbsoluteExpiresAt: hourLater,
        operatorTotpVerifiedAt: now,
        createdAt: now,
        updatedAt: now
      },
      {
        id: merchantSessionId,
        token: `merchant-token-${suffix}`,
        userId: targetMemberId,
        impersonatedBy: operatorId,
        expiresAt: activeExpiresAt,
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(merchants).values({
      id: merchantId,
      publicName: `Lifecycle Merchant ${suffix}`,
      slug: `lifecycle-merchant-${suffix}`,
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(impersonationRecords).values({
      id: impersonationId,
      operatorId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      lifecycle: 'active',
      reason: 'Reproduce an ordinary Merchant workflow',
      supportReference: 'SUP-42',
      ticketHash: `hash-lifecycle-${suffix}`,
      handoffExpiresAt: hourLater,
      merchantSessionId,
      activeExpiresAt,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    return {
      operatorId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      merchantSessionId,
      impersonationId
    }
  }

  const run = <A>(
    use: (
      lifecycle: OperationsImpersonationLifecycle['Service']
    ) => Effect.Effect<A, unknown>,
    requestedNow = now
  ) =>
    Effect.runPromise(
      Effect.flatMap(OperationsImpersonationLifecycle, use).pipe(
        Effect.provide(
          makeOperationsImpersonationLifecycleLayer(db, {
            now: () => requestedNow,
            securityContact: 'security@example.test',
            notificationIntentId: (event) => `opnti_${event}`,
            auditEventId: (event) => `oaud_${event}`
          })
        )
      )
    )

  it('presents the authoritative target, Merchant, and absolute expiry without sliding it', async () => {
    const fixture = await addActive('presentation')

    const first = await run((lifecycle) =>
      lifecycle.resolve({ merchantSessionId: fixture.merchantSessionId })
    )
    const later = await run(
      (lifecycle) =>
        lifecycle.resolve({ merchantSessionId: fixture.merchantSessionId }),
      new Date(now.getTime() + 30 * 60_000)
    )

    expect(first).toMatchObject({
      state: 'active',
      targetMemberId: fixture.targetMemberId,
      targetMemberName: 'Lifecycle Target presentation',
      merchantId: fixture.merchantId,
      merchantName: 'Lifecycle Merchant presentation',
      expiresAt: hourLater.toISOString()
    })
    expect(later).toEqual(first)
  })

  it('manually stops atomically, revokes only the impersonated session, and emits sanitized evidence', async () => {
    const fixture = await addActive('stop')

    const result = await run((lifecycle) =>
      lifecycle.stop({ merchantSessionId: fixture.merchantSessionId })
    )

    expect(result).toMatchObject({
      state: 'terminated',
      lifecycle: 'stopped',
      terminationCause: 'manual-stop',
      targetMemberId: fixture.targetMemberId,
      merchantId: fixture.merchantId
    })
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'stopped',
      terminationCause: 'manual-stop',
      terminalAt: now
    })
    const [revokedMerchantSession] = await db
      .select()
      .from(session)
      .where(eq(session.id, fixture.merchantSessionId))
    expect(revokedMerchantSession?.expiresAt).toEqual(now)
    expect(
      await db.select().from(session).where(eq(session.id, fixture.operatorSessionId))
    ).toHaveLength(1)
    const [intent] = await db
      .select()
      .from(operationsNotificationIntents)
      .where(eq(operationsNotificationIntents.impersonationId, fixture.impersonationId))
    expect(intent).toMatchObject({
      eventType: 'impersonation-stopped',
      merchantName: 'Lifecycle Merchant stop',
      supportReference: 'SUP-42',
      securityContact: 'security@example.test',
      status: 'pending'
    })
    expect(intent?.payloadJson).not.toContain('Lifecycle Operator')
    expect(intent?.payloadJson).not.toContain('Reproduce')
    const [audit] = await db
      .select()
      .from(operationsAuditEvents)
      .where(eq(operationsAuditEvents.impersonationId, fixture.impersonationId))
    expect(audit).toMatchObject({
      action: 'impersonation.stopped',
      result: 'accepted',
      actorOperatorId: fixture.operatorId,
      targetId: fixture.targetMemberId,
      merchantId: fixture.merchantId
    })
  })

  it('expires on the authoritative boundary and produces the transition exactly once', async () => {
    const expiresAt = new Date(now.getTime() - 1_000)
    const fixture = await addActive('expiry', expiresAt)

    const first = await run((lifecycle) =>
      lifecycle.resolve({ merchantSessionId: fixture.merchantSessionId })
    )
    const second = await run((lifecycle) =>
      lifecycle.resolve({ merchantSessionId: fixture.merchantSessionId })
    )

    expect(first).toMatchObject({
      state: 'terminated',
      lifecycle: 'expired',
      terminationCause: 'absolute-timeout'
    })
    expect(second).toEqual(first)
    expect(
      await db
        .select()
        .from(operationsNotificationIntents)
        .where(
          eq(operationsNotificationIntents.impersonationId, fixture.impersonationId)
        )
    ).toHaveLength(1)
    expect(
      await db
        .select()
        .from(operationsAuditEvents)
        .where(eq(operationsAuditEvents.impersonationId, fixture.impersonationId))
    ).toHaveLength(1)
  })

  it('records a stable revocation cause with its notification', async () => {
    const fixture = await addActive('revocation')

    const result = await run((lifecycle) =>
      lifecycle.revoke({
        merchantSessionId: fixture.merchantSessionId,
        cause: 'administrative-revocation'
      })
    )

    expect(result).toMatchObject({
      lifecycle: 'revoked',
      terminationCause: 'administrative-revocation'
    })
    const [intent] = await db
      .select()
      .from(operationsNotificationIntents)
      .where(eq(operationsNotificationIntents.impersonationId, fixture.impersonationId))
    expect(intent?.eventType).toBe('impersonation-revoked')
  })
})
