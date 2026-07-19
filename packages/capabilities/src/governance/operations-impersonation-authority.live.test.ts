import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { eq } from 'drizzle-orm'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  impersonationRecords,
  merchantMemberships,
  merchants,
  operationsAuditEvents,
  operationsNotificationIntents,
  session,
  twoFactor,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  intersectsImpersonatedMerchantAuthority,
  OperationsImpersonationAuthority,
  makeOperationsImpersonationAuthorityLayer,
  type ImpersonatedMerchantAction
} from './operations-impersonation-authority.ts'

const now = new Date('2026-07-19T15:00:00.000Z')
const later = new Date('2026-07-19T16:00:00.000Z')

describe('reduced impersonation authority', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>
  let evidence = 0

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const addActive = async (suffix: string) => {
    const operatorId = `opr_authority_${suffix}`
    const operatorSessionId = `ops_authority_${suffix}`
    const targetMemberId = `mem_authority_${suffix}`
    const merchantId = `mer_authority_${suffix}`
    const merchantSessionId = `mss_authority_${suffix}`
    await db.insert(user).values([
      {
        id: operatorId,
        email: `${operatorId}@operations.test`,
        name: `Authority Operator ${suffix}`,
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
        name: `Authority Target ${suffix}`,
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
        expiresAt: later,
        operatorIdleExpiresAt: later,
        operatorAbsoluteExpiresAt: later,
        operatorTotpVerifiedAt: now,
        createdAt: now,
        updatedAt: now
      },
      {
        id: merchantSessionId,
        token: `merchant-token-${suffix}`,
        userId: targetMemberId,
        impersonatedBy: operatorId,
        expiresAt: later,
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(twoFactor).values({
      id: `totp_authority_${suffix}`,
      userId: operatorId,
      secret: 'encrypted-test-secret',
      backupCodes: 'encrypted-test-backup-codes',
      verified: true
    })
    await db.insert(merchants).values({
      id: merchantId,
      publicName: `Authority Merchant ${suffix}`,
      slug: `authority-merchant-${suffix}`,
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
      id: `imp_authority_${suffix}`,
      operatorId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      lifecycle: 'active',
      reason: 'Reproduce an ordinary Merchant workflow',
      supportReference: `SUP-${suffix}`,
      ticketHash: `hash-authority-${suffix}`,
      handoffExpiresAt: later,
      merchantSessionId,
      activeExpiresAt: later,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    return {
      operatorId,
      operatorSessionId,
      targetMemberId,
      merchantId,
      merchantSessionId,
      impersonationId: `imp_authority_${suffix}`
    }
  }

  const run = <A>(
    use: (
      authority: OperationsImpersonationAuthority['Service']
    ) => Effect.Effect<A, unknown>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const authority = yield* OperationsImpersonationAuthority
        return yield* use(authority)
      }).pipe(
        Effect.provide(
          makeOperationsImpersonationAuthorityLayer(db, {
            now: () => now,
            auditEventId: () => `oaud_authority_${++evidence}`,
            securityContact: 'security@example.test'
          })
        )
      )
    )

  it('intersects target authority with the explicit impersonation allowlist', () => {
    expect(
      intersectsImpersonatedMerchantAuthority({
        targetAuthority: new Set(['service.read']),
        action: 'service.update'
      })
    ).toBe(false)
    expect(
      intersectsImpersonatedMerchantAuthority({
        targetAuthority: new Set(['service.update']),
        action: 'service.update'
      })
    ).toBe(true)
    expect(
      intersectsImpersonatedMerchantAuthority({
        targetAuthority: new Set(['money.move']),
        action: 'money.move'
      })
    ).toBe(false)
  })

  it('reduces an otherwise allowlisted action when current target authority lacks it', async () => {
    const fixture = await addActive('target-reduction')
    await expect(
      Effect.runPromise(
        Effect.flatMap(OperationsImpersonationAuthority, (authority) =>
          authority.authorize({
            merchantSessionId: fixture.merchantSessionId,
            action: 'service.update'
          })
        ).pipe(
          Effect.provide(
            makeOperationsImpersonationAuthorityLayer(db, {
              now: () => now,
              securityContact: 'security@example.test',
              targetAuthority: () => new Set(['service.read'])
            })
          )
        )
      )
    ).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'impersonation authority denied'
    })
  })

  it.each<ImpersonatedMerchantAction>([
    'identity-security.update',
    'mfa.update',
    'identity.delete',
    'merchant-ownership.update',
    'credential.create',
    'credential.rotate',
    'money.move',
    'payout-destination.update',
    'billing-destination.update',
    'entity.delete',
    'bulk-wipe.execute'
  ])(
    'denies %s through the capability even when the target is an Owner',
    async (action) => {
      const fixture = await addActive(action.replaceAll('.', '-'))

      await expect(
        run((authority) =>
          authority.authorize({ merchantSessionId: fixture.merchantSessionId, action })
        )
      ).rejects.toMatchObject({
        _tag: 'OperationsContractDenied',
        reason: 'impersonation authority denied'
      })

      const [audit] = await db
        .select()
        .from(operationsAuditEvents)
        .where(eq(operationsAuditEvents.impersonationId, fixture.impersonationId))
      expect(audit).toMatchObject({
        actorOperatorId: fixture.operatorId,
        operatorSessionId: fixture.operatorSessionId,
        targetId: fixture.targetMemberId,
        merchantId: fixture.merchantId,
        action: `impersonation.${action}`,
        result: 'rejected',
        retentionPolicy: 'impersonation-two-years'
      })
    }
  )

  it('allows representative reversible Service and Schedule mutations and attributes their outcomes', async () => {
    const fixture = await addActive('reversible')

    for (const action of ['service.update', 'schedule.update'] as const) {
      const authorized = await run((authority) =>
        authority.authorize({ merchantSessionId: fixture.merchantSessionId, action })
      )
      expect(authorized).toMatchObject(fixture)
      const outcome = {
        businessEventId: `mutation-${action}`,
        authorization: authorized,
        action,
        result:
          action === 'service.update' ? ('accepted' as const) : ('rejected' as const)
      }
      await run((authority) => authority.recordMutation(outcome))
      if (action === 'service.update') {
        await run((authority) =>
          authority.recordMutation({
            ...outcome,
            authorization: authorized,
            result: 'accepted'
          })
        )
      }
    }

    const audits = await db
      .select()
      .from(operationsAuditEvents)
      .where(eq(operationsAuditEvents.impersonationId, fixture.impersonationId))
    expect(audits.map(({ action, result }) => ({ action, result }))).toEqual([
      { action: 'impersonation.service.update', result: 'accepted' },
      { action: 'impersonation.schedule.update', result: 'rejected' }
    ])
  })

  it('audits designated sensitive reads without adding routine navigation noise', async () => {
    const fixture = await addActive('reads')

    await run((authority) =>
      authority.authorize({
        merchantSessionId: fixture.merchantSessionId,
        action: 'merchant.navigate'
      })
    )
    await run((authority) =>
      authority.authorize({
        merchantSessionId: fixture.merchantSessionId,
        action: 'financial.read'
      })
    )

    const audits = await db
      .select()
      .from(operationsAuditEvents)
      .where(eq(operationsAuditEvents.impersonationId, fixture.impersonationId))
    expect(audits.map((audit) => audit.action)).toEqual([
      'impersonation.financial.read'
    ])
  })

  it('binds the authoritative Operator Session to the real operator', async () => {
    const fixture = await addActive('operator-binding')
    const other = await addActive('operator-binding-other')
    await db
      .update(impersonationRecords)
      .set({ operatorSessionId: other.operatorSessionId })
      .where(eq(impersonationRecords.id, fixture.impersonationId))

    await expect(
      run((authority) =>
        authority.authorize({
          merchantSessionId: fixture.merchantSessionId,
          action: 'service.read'
        })
      )
    ).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'impersonation authority denied'
    })
  })

  it('atomically expires the lifecycle on the first protected request after the absolute limit', async () => {
    const fixture = await addActive('absolute-expiry')
    const expiredAt = new Date(later.getTime() + 1_000)

    await expect(
      Effect.runPromise(
        Effect.flatMap(OperationsImpersonationAuthority, (authority) =>
          authority.authorize({
            merchantSessionId: fixture.merchantSessionId,
            action: 'merchant.navigate'
          })
        ).pipe(
          Effect.provide(
            makeOperationsImpersonationAuthorityLayer(db, {
              now: () => expiredAt,
              securityContact: ''
            })
          )
        )
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })

    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'expired',
      terminationCause: 'absolute-timeout',
      terminalAt: expiredAt
    })
    expect(
      await db
        .select()
        .from(operationsNotificationIntents)
        .where(
          eq(operationsNotificationIntents.impersonationId, fixture.impersonationId)
        )
    ).toHaveLength(1)
  })

  it('revokes the lifecycle on the first protected request after permission removal', async () => {
    const fixture = await addActive('permission-revocation')
    await db
      .update(user)
      .set({ role: 'merchant-reader' })
      .where(eq(user.id, fixture.operatorId))

    await expect(
      run((authority) =>
        authority.authorize({
          merchantSessionId: fixture.merchantSessionId,
          action: 'merchant.navigate'
        })
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })

    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, fixture.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'revoked',
      terminationCause: 'permission-removed',
      terminalAt: now
    })
    const [revokedSession] = await db
      .select()
      .from(session)
      .where(eq(session.id, fixture.merchantSessionId))
    expect(revokedSession?.expiresAt).toEqual(now)
    const [intent] = await db
      .select()
      .from(operationsNotificationIntents)
      .where(eq(operationsNotificationIntents.impersonationId, fixture.impersonationId))
    expect(intent?.eventType).toBe('impersonation-revoked')
  })

  it.each([
    [
      'disabled operator',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db.update(user).set({ banned: true }).where(eq(user.id, fixture.operatorId))
    ],
    [
      'inactive Operator Session',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db
          .update(session)
          .set({ operatorIdleExpiresAt: new Date(now.getTime() - 1) })
          .where(eq(session.id, fixture.operatorSessionId))
    ],
    [
      'missing TOTP enrollment',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db
          .update(user)
          .set({ twoFactorEnabled: false })
          .where(eq(user.id, fixture.operatorId))
    ],
    [
      'removed permission',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db
          .update(user)
          .set({ role: 'merchant-reader' })
          .where(eq(user.id, fixture.operatorId))
    ],
    [
      'disabled target',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db.update(user).set({ banned: true }).where(eq(user.id, fixture.targetMemberId))
    ],
    [
      'mismatched target authority',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db
          .update(impersonationRecords)
          .set({ merchantId: `mismatched-${fixture.merchantId}` })
          .where(eq(impersonationRecords.id, fixture.impersonationId))
    ],
    [
      'inactive lifecycle',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db
          .update(impersonationRecords)
          .set({ lifecycle: 'revoked' })
          .where(eq(impersonationRecords.id, fixture.impersonationId))
    ],
    [
      'released security state',
      async (fixture: Awaited<ReturnType<typeof addActive>>) =>
        db
          .update(impersonationRecords)
          .set({ terminationCause: 'security-state-released' })
          .where(eq(impersonationRecords.id, fixture.impersonationId))
    ]
  ])('rechecks %s on every protected request', async (name, invalidate) => {
    const fixture = await addActive(`recheck-${name.replaceAll(' ', '-')}`)
    await invalidate(fixture)

    await expect(
      run((authority) =>
        authority.authorize({
          merchantSessionId: fixture.merchantSessionId,
          action: 'service.read'
        })
      )
    ).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'impersonation authority denied'
    })

    if (name === 'released security state') {
      const [record] = await db
        .select()
        .from(impersonationRecords)
        .where(eq(impersonationRecords.id, fixture.impersonationId))
      const [merchantSession] = await db
        .select()
        .from(session)
        .where(eq(session.id, fixture.merchantSessionId))
      expect(record).toMatchObject({
        lifecycle: 'revoked',
        terminationCause: 'security-state-revoked'
      })
      expect(merchantSession?.expiresAt).toEqual(now)
    }
  })
})
