import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  auditEvents,
  impersonationRecords,
  merchantMemberships,
  merchants,
  operationsAuditEvents,
  operationsNotificationIntents,
  session,
  user
} from '@b2b-saas-starter/db'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { and, eq, ne } from 'drizzle-orm'
import {
  OperationsManagement,
  makeOperationsManagementLayer
} from './operations-management.ts'
import {
  OperationsAuthorization,
  makeOperationsAuthorizationLayer
} from './operations-contracts.ts'

const now = new Date('2026-07-19T10:00:00.000Z')

const authorize = (
  db: ReturnType<typeof createDb>,
  operatorSessionId: string,
  requestedNow: Date
) =>
  Effect.runPromise(
    Effect.flatMap(OperationsAuthorization, (authorization) =>
      authorization.authorize({ operatorSessionId }, requestedNow)
    ).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))
  )

describe('Operations management integration boundary', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  const setup = async () => {
    const db = createDb(testD1.d1)
    const managerId = `opr_manager_${crypto.randomUUID()}`
    const targetId = `opr_target_${crypto.randomUUID()}`
    const managerSessionId = `ops_manager_${crypto.randomUUID()}`
    const targetSessionId = `ops_target_${crypto.randomUUID()}`
    await db.insert(user).values([
      {
        id: managerId,
        email: `${managerId}@example.test`,
        name: 'Operations Manager',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'operator-manager',
        createdAt: now,
        updatedAt: now
      },
      {
        id: targetId,
        email: `${targetId}@example.test`,
        name: 'Support Operator',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'merchant-reader',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values([
      {
        id: managerSessionId,
        token: `token_${managerSessionId}`,
        userId: managerId,
        expiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        operatorIdleExpiresAt: new Date(now.getTime() + 30 * 60_000),
        operatorAbsoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        createdAt: now,
        updatedAt: now
      },
      {
        id: targetSessionId,
        token: `token_${targetSessionId}`,
        userId: targetId,
        expiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        operatorIdleExpiresAt: new Date(now.getTime() + 30 * 60_000),
        operatorAbsoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
        createdAt: now,
        updatedAt: now
      }
    ])
    const run = <A, E>(effect: Effect.Effect<A, E, OperationsManagement>) =>
      Effect.runPromise(
        effect.pipe(
          Effect.provide(
            makeOperationsManagementLayer(db, {
              securityContact: 'security@example.test'
            })
          )
        )
      )
    return {
      db,
      managerId,
      targetId,
      managerSessionId,
      targetSessionId,
      actor: { operatorSessionId: managerSessionId },
      run
    }
  }

  const addActiveImpersonation = async (
    fixture: Awaited<ReturnType<typeof setup>>,
    suffix: string
  ) => {
    const targetMemberId = `mem_management_${suffix}`
    const merchantId = `mer_management_${suffix}`
    const merchantSessionId = `mss_management_${suffix}`
    await fixture.db.insert(user).values({
      id: targetMemberId,
      email: `${targetMemberId}@example.test`,
      name: 'Managed impersonation target',
      emailVerified: true,
      identityClass: 'merchant_member',
      createdAt: now,
      updatedAt: now
    })
    await fixture.db.insert(merchants).values({
      id: merchantId,
      publicName: 'Managed Merchant',
      slug: `managed-${suffix}`,
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await fixture.db.insert(merchantMemberships).values({
      merchantId,
      userId: targetMemberId,
      role: 'owner',
      createdAt: now.toISOString()
    })
    await fixture.db.insert(session).values({
      id: merchantSessionId,
      token: `token_${merchantSessionId}`,
      userId: targetMemberId,
      impersonatedBy: fixture.targetId,
      expiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now,
      updatedAt: now
    })
    await fixture.db.insert(impersonationRecords).values({
      id: `imp_management_${suffix}`,
      operatorId: fixture.targetId,
      operatorSessionId: fixture.targetSessionId,
      targetMemberId,
      merchantId,
      lifecycle: 'active',
      reason: 'Resolve a support case',
      supportReference: 'SUP-MANAGEMENT',
      ticketHash: `hash_${suffix}`,
      handoffExpiresAt: new Date(now.getTime() + 60_000),
      merchantSessionId,
      activeExpiresAt: new Date(now.getTime() + 60 * 60_000),
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    return { merchantSessionId, impersonationId: `imp_management_${suffix}` }
  }

  it('lists operators without exposing credentials', async () => {
    const fixture = await setup()
    const operators = await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.list(fixture.actor, now)
      )
    )

    expect(operators).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: fixture.targetId,
          enabled: true,
          enrollmentState: 'complete',
          roles: ['merchant-reader'],
          activeSession: expect.objectContaining({ active: true })
        })
      ])
    )
    expect(JSON.stringify(operators)).not.toMatch(/token|password|secret|backup/i)
  })

  it('composes roles and applies removals on the next protected request', async () => {
    const fixture = await setup()
    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          roles: [
            'messaging-reader',
            'messaging-controller',
            'messaging-finance',
            'messaging-reconciler',
            'messaging-incident-responder'
          ],
          now: new Date('2026-07-19T10:00:01.000Z')
        })
      )
    )
    const [composed] = await fixture.db
      .select({ role: user.role, updatedAt: user.updatedAt })
      .from(user)
      .where(eq(user.id, fixture.targetId))
    expect(composed?.role).toBe(
      'messaging-reader,messaging-controller,messaging-finance,messaging-reconciler,messaging-incident-responder'
    )
    await expect(
      authorize(
        fixture.db,
        fixture.targetSessionId,
        new Date('2026-07-19T10:00:01.000Z')
      )
    ).resolves.toMatchObject({
      roles: [
        'messaging-reader',
        'messaging-controller',
        'messaging-finance',
        'messaging-reconciler',
        'messaging-incident-responder'
      ]
    })

    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: composed!.updatedAt,
          roles: ['impersonation-auditor'],
          now: new Date('2026-07-19T10:00:02.000Z')
        })
      )
    )
    const [removed] = await fixture.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, fixture.targetId))
    expect(removed?.role).toBe('impersonation-auditor')
    await expect(
      authorize(
        fixture.db,
        fixture.targetSessionId,
        new Date('2026-07-19T10:00:02.000Z')
      )
    ).resolves.toMatchObject({ roles: ['impersonation-auditor'] })
    await expect(
      fixture.run(
        Effect.flatMap(OperationsManagement, (management) =>
          management.list(
            { operatorSessionId: fixture.targetSessionId },
            new Date('2026-07-19T10:00:02.000Z')
          )
        )
      )
    ).rejects.toMatchObject({
      reason: 'operator management is not authorized'
    })
  })

  it('rejects self changes and preserves the last enabled management path', async () => {
    const fixture = await setup()
    const management = Effect.flatMap(OperationsManagement, (service) =>
      service.updateRoles({
        actor: fixture.actor,
        targetOperatorId: fixture.managerId,
        expectedUpdatedAt: now,
        roles: ['merchant-reader'],
        now: new Date('2026-07-19T10:00:01.000Z')
      })
    )
    await expect(fixture.run(management)).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'operators cannot manage themselves'
    })

    const [manager] = await fixture.db
      .select({ role: user.role, banned: user.banned })
      .from(user)
      .where(eq(user.id, fixture.managerId))
    expect(manager).toMatchObject({ role: 'operator-manager', banned: false })
  })

  it('rejects removing the last manager when authority changes concurrently', async () => {
    const fixture = await setup()
    await fixture.db
      .update(user)
      .set({ banned: true })
      .where(
        and(
          ne(user.id, fixture.managerId),
          ne(user.id, fixture.targetId),
          eq(user.identityClass, 'system_operator')
        )
      )
    await fixture.db
      .update(user)
      .set({ role: 'operator-manager' })
      .where(eq(user.id, fixture.targetId))
    const interceptedD1 = new Proxy(testD1.d1, {
      get(target, property) {
        if (property === 'batch')
          return async (statements: Parameters<typeof target.batch>[0]) => {
            await target
              .prepare(`UPDATE user SET role = 'merchant-reader' WHERE id = ?1`)
              .bind(fixture.managerId)
              .run()
            return target.batch(statements)
          }
        const value = Reflect.get(target, property)
        return typeof value === 'function' ? value.bind(target) : value
      }
    })
    const interceptedDb = createDb(interceptedD1)
    await expect(
      Effect.runPromise(
        Effect.flatMap(OperationsManagement, (management) =>
          management.updateRoles({
            actor: fixture.actor,
            targetOperatorId: fixture.targetId,
            expectedUpdatedAt: now,
            roles: ['merchant-reader'],
            now: new Date('2026-07-19T10:00:01.000Z')
          })
        ).pipe(
          Effect.provide(
            makeOperationsManagementLayer(interceptedDb, {
              securityContact: 'security@example.test'
            })
          )
        )
      )
    ).rejects.toMatchObject({
      reason: 'the last enabled Operator Manager cannot be changed'
    })
    const [target] = await fixture.db
      .select({ role: user.role })
      .from(user)
      .where(eq(user.id, fixture.targetId))
    expect(target?.role).toBe('operator-manager')
  })

  it('allows an operator to hold no operational roles', async () => {
    const fixture = await setup()
    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          roles: [],
          now: new Date('2026-07-19T10:00:01.000Z')
        })
      )
    )
    await expect(
      authorize(
        fixture.db,
        fixture.targetSessionId,
        new Date('2026-07-19T10:00:01.000Z')
      )
    ).resolves.toMatchObject({ roles: [] })
  })

  it('atomically disables another operator and revokes their active session', async () => {
    const fixture = await setup()
    const active = await addActiveImpersonation(fixture, crypto.randomUUID())
    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.setEnabled({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          enabled: false,
          now: new Date('2026-07-19T10:00:01.000Z')
        })
      )
    )
    const [target] = await fixture.db
      .select({ banned: user.banned, updatedAt: user.updatedAt })
      .from(user)
      .where(eq(user.id, fixture.targetId))
    const targetSessions = await fixture.db
      .select({ id: session.id })
      .from(session)
      .where(eq(session.userId, fixture.targetId))
    expect(target?.banned).toBe(true)
    expect(targetSessions).toEqual([])
    const [record] = await fixture.db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, active.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'revoked',
      terminationCause: 'operator-disabled'
    })
    expect(
      await fixture.db
        .select()
        .from(operationsNotificationIntents)
        .where(
          eq(operationsNotificationIntents.impersonationId, active.impersonationId)
        )
    ).toHaveLength(1)
    expect(
      await fixture.db
        .select()
        .from(operationsAuditEvents)
        .where(eq(operationsAuditEvents.impersonationId, active.impersonationId))
    ).toHaveLength(1)

    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.setEnabled({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: target!.updatedAt,
          enabled: true,
          now: new Date('2026-07-19T10:00:02.000Z')
        })
      )
    )
    await expect(
      authorize(
        fixture.db,
        fixture.targetSessionId,
        new Date('2026-07-19T10:00:02.000Z')
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
  })

  it('revokes derived impersonation atomically when merchant:impersonate is removed', async () => {
    const fixture = await setup()
    await fixture.db
      .update(user)
      .set({ role: 'merchant-impersonator' })
      .where(eq(user.id, fixture.targetId))
    const active = await addActiveImpersonation(fixture, crypto.randomUUID())

    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          roles: ['merchant-reader'],
          now: new Date('2026-07-19T10:00:01.000Z')
        })
      )
    )

    const [record] = await fixture.db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, active.impersonationId))
    expect(record).toMatchObject({
      lifecycle: 'revoked',
      terminationCause: 'permission-removed'
    })
    const [merchantSession] = await fixture.db
      .select()
      .from(session)
      .where(eq(session.id, active.merchantSessionId))
    expect(merchantSession?.expiresAt).toEqual(new Date('2026-07-19T10:00:01.000Z'))
    expect(
      await fixture.db
        .select()
        .from(operationsNotificationIntents)
        .where(
          eq(operationsNotificationIntents.impersonationId, active.impersonationId)
        )
    ).toHaveLength(1)
    expect(
      await fixture.db
        .select()
        .from(operationsAuditEvents)
        .where(eq(operationsAuditEvents.impersonationId, active.impersonationId))
    ).toHaveLength(1)
  })

  it('rejects stale submissions without overwriting newer state', async () => {
    const fixture = await setup()
    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          roles: ['merchant-impersonator'],
          now: new Date('2026-07-19T10:00:01.000Z')
        })
      )
    )
    await expect(
      fixture.run(
        Effect.flatMap(OperationsManagement, (management) =>
          management.setEnabled({
            actor: fixture.actor,
            targetOperatorId: fixture.targetId,
            expectedUpdatedAt: now,
            enabled: false,
            now: new Date('2026-07-19T10:00:02.000Z')
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'operator management page is stale' })
    const [target] = await fixture.db
      .select({ role: user.role, banned: user.banned })
      .from(user)
      .where(eq(user.id, fixture.targetId))
    expect(target).toMatchObject({ role: 'merchant-impersonator', banned: false })
    await expect(
      fixture.db
        .select({ id: session.id })
        .from(session)
        .where(eq(session.id, fixture.targetSessionId))
    ).resolves.toEqual([{ id: fixture.targetSessionId }])
  })

  it('does not revoke when a stale submission shares the winning timestamp', async () => {
    const fixture = await setup()
    const winningAt = new Date('2026-07-19T10:00:01.000Z')
    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          roles: ['merchant-impersonator'],
          now: winningAt
        })
      )
    )
    const active = await addActiveImpersonation(fixture, crypto.randomUUID())

    await expect(
      fixture.run(
        Effect.flatMap(OperationsManagement, (management) =>
          management.updateRoles({
            actor: fixture.actor,
            targetOperatorId: fixture.targetId,
            expectedUpdatedAt: now,
            roles: ['merchant-reader'],
            now: winningAt
          })
        )
      )
    ).rejects.toMatchObject({ reason: 'operator management page is stale' })

    const [record] = await fixture.db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, active.impersonationId))
    expect(record).toMatchObject({ lifecycle: 'active', terminationCause: null })
  })

  it('durably audits accepted actions and rejected attempts', async () => {
    const fixture = await setup()
    await fixture.run(
      Effect.flatMap(OperationsManagement, (management) =>
        management.updateRoles({
          actor: fixture.actor,
          targetOperatorId: fixture.targetId,
          expectedUpdatedAt: now,
          roles: ['merchant-reader', 'impersonation-auditor'],
          now: new Date('2026-07-19T10:00:01.000Z')
        })
      )
    )
    await expect(
      fixture.run(
        Effect.flatMap(OperationsManagement, (management) =>
          management.updateRoles({
            actor: fixture.actor,
            targetOperatorId: fixture.managerId,
            expectedUpdatedAt: now,
            roles: ['merchant-reader'],
            now: new Date('2026-07-19T10:00:02.000Z')
          })
        )
      )
    ).rejects.toBeDefined()

    const evidence = await fixture.db
      .select({
        actorUserId: auditEvents.actorUserId,
        targetId: auditEvents.targetId,
        eventType: auditEvents.eventType,
        metadata: auditEvents.metadata,
        createdAt: auditEvents.createdAt
      })
      .from(auditEvents)
      .where(eq(auditEvents.actorUserId, fixture.managerId))
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          actorUserId: fixture.managerId,
          targetId: fixture.targetId,
          eventType: 'operator.roles.updated',
          metadata: expect.objectContaining({ result: 'accepted' }),
          createdAt: '2026-07-19T10:00:01.000Z'
        }),
        expect.objectContaining({
          targetId: fixture.managerId,
          eventType: 'operator.roles.update_rejected',
          metadata: expect.objectContaining({ result: 'rejected' }),
          createdAt: '2026-07-19T10:00:02.000Z'
        })
      ])
    )
  })
})
