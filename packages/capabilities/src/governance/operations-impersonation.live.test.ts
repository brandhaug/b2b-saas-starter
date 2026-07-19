import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { createDb } from '@b2b-saas-starter/db/client'
import {
  impersonationRecords,
  merchantMemberships,
  merchants,
  operationsAuditEvents,
  session,
  twoFactor,
  user
} from '@b2b-saas-starter/db/schema'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { and, eq } from 'drizzle-orm'
import { CapabilityUnavailable } from '../errors.ts'
import {
  OperationsContractDenied,
  OperationsImpersonation
} from './operations-contracts.ts'
import { makeOperationsImpersonationLayer } from './operations-impersonation.ts'

const now = new Date('2026-07-19T12:00:00.000Z')
const ticket = 'pending-handoff-ticket-plaintext'

describe('Operations pending impersonation handoff', () => {
  let testD1: TestD1
  let db: ReturnType<typeof createDb>

  beforeAll(async () => {
    testD1 = await provisionTestD1()
    db = createDb(testD1.d1)
    const later = new Date('2026-07-19T18:00:00.000Z')
    await db.insert(user).values([
      {
        id: 'opr_handoff',
        email: 'handoff@operations.test',
        name: 'Handoff Operator',
        emailVerified: true,
        twoFactorEnabled: true,
        identityClass: 'system_operator',
        role: 'merchant-impersonator',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'mem_handoff_target',
        email: 'target@merchant.test',
        name: 'Handoff Target',
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(session).values({
      id: 'ops_handoff_session',
      token: 'operator-session-token',
      userId: 'opr_handoff',
      expiresAt: later,
      operatorIdleExpiresAt: later,
      operatorAbsoluteExpiresAt: later,
      operatorTotpVerifiedAt: new Date(now.getTime() - 60_000),
      createdAt: now,
      updatedAt: now
    })
    await db.insert(twoFactor).values({
      id: 'totp_opr_handoff',
      userId: 'opr_handoff',
      secret: 'encrypted-test-secret',
      backupCodes: 'encrypted-test-backup-codes',
      verified: true
    })
    await db.insert(merchants).values({
      id: 'mer_handoff',
      publicName: 'Handoff Merchant',
      slug: 'handoff-merchant',
      timezone: 'Europe/Bucharest',
      currency: 'RON',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString()
    })
    await db.insert(merchantMemberships).values({
      merchantId: 'mer_handoff',
      userId: 'mem_handoff_target',
      role: 'owner',
      createdAt: now.toISOString()
    })
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const addOperator = async (
    suffix: string,
    options: {
      readonly roles?: string
      readonly totpVerifiedAt?: Date | null
      readonly sessionExpiresAt?: Date
      readonly factorVerified?: boolean
      readonly factorLockedUntil?: Date | null
    } = {}
  ) => {
    const operatorId = `opr_${suffix}`
    const operatorSessionId = `ops_${suffix}`
    await db.insert(user).values({
      id: operatorId,
      email: `${suffix}@operations.test`,
      name: `Operator ${suffix}`,
      emailVerified: true,
      twoFactorEnabled: true,
      identityClass: 'system_operator',
      role: options.roles ?? 'merchant-impersonator',
      createdAt: now,
      updatedAt: now
    })
    await db.insert(session).values({
      id: operatorSessionId,
      token: `token-${suffix}`,
      userId: operatorId,
      expiresAt: options.sessionExpiresAt ?? new Date('2026-07-19T18:00:00.000Z'),
      operatorIdleExpiresAt: new Date('2026-07-19T18:00:00.000Z'),
      operatorAbsoluteExpiresAt: new Date('2026-07-19T18:00:00.000Z'),
      operatorTotpVerifiedAt:
        options.totpVerifiedAt === undefined
          ? new Date(now.getTime() - 60_000)
          : options.totpVerifiedAt,
      createdAt: now,
      updatedAt: now
    })
    await db.insert(twoFactor).values({
      id: `totp_${suffix}`,
      userId: operatorId,
      secret: 'encrypted-test-secret',
      backupCodes: 'encrypted-test-backup-codes',
      verified: options.factorVerified ?? true,
      lockedUntil: options.factorLockedUntil ?? null
    })
    return { operatorId, operatorSessionId }
  }

  const addTarget = async (
    suffix: string,
    options: {
      readonly identityClass?: 'merchant_member' | 'customer_account'
      readonly banned?: boolean
      readonly merchantStatus?: 'enabled' | 'disabled'
    } = {}
  ) => {
    const targetMemberId = `mem_${suffix}`
    const merchantId = `mer_${suffix}`
    await db.insert(user).values({
      id: targetMemberId,
      email: `${suffix}@merchant.test`,
      name: `Target ${suffix}`,
      emailVerified: true,
      identityClass: options.identityClass ?? 'merchant_member',
      banned: options.banned ?? false,
      createdAt: now,
      updatedAt: now
    })
    await db.insert(merchants).values({
      id: merchantId,
      publicName: `Merchant ${suffix}`,
      slug: `merchant-${suffix}`,
      status: options.merchantStatus ?? 'enabled',
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
    return { targetMemberId, merchantId }
  }

  const start = (
    input: {
      readonly operatorSessionId: string
      readonly targetMemberId: string
      readonly merchantId: string
      readonly reason?: string
      readonly supportReference?: string | null
    },
    options: Parameters<typeof makeOperationsImpersonationLayer>[1] = {}
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const impersonation = yield* OperationsImpersonation
        return yield* impersonation.start({
          actor: { operatorSessionId: input.operatorSessionId },
          targetMemberId: input.targetMemberId,
          merchantId: input.merchantId,
          reason: input.reason ?? 'Investigate a reported issue',
          supportReference: input.supportReference ?? null
        })
      }).pipe(
        Effect.provide(
          makeOperationsImpersonationLayer(db, { now: () => now, ...options })
        )
      )
    )

  const run = <A>(
    use: (
      impersonation: OperationsImpersonation['Service']
    ) => Effect.Effect<A, OperationsContractDenied | CapabilityUnavailable>
  ) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const impersonation = yield* OperationsImpersonation
        return yield* use(impersonation)
      }).pipe(
        Effect.provide(
          makeOperationsImpersonationLayer(db, {
            now: () => now,
            id: () => 'imp_handoff',
            ticket: () => ticket
          })
        )
      )
    )

  it('creates an accountable pending handoff without persisting its plaintext ticket', async () => {
    const result = await run((impersonation) =>
      impersonation.start({
        actor: { operatorSessionId: 'ops_handoff_session' },
        targetMemberId: 'mem_handoff_target',
        merchantId: 'mer_handoff',
        reason: ' Reproduce a reported scheduling issue ',
        supportReference: ' SUP-42 '
      })
    )

    expect(result).toEqual({
      impersonationId: 'imp_handoff',
      lifecycle: 'pending-handoff',
      expiresAt: '2026-07-19T12:01:00.000Z',
      handoffTicket: ticket
    })
    const [record] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, 'imp_handoff'))
    expect(record).toMatchObject({
      operatorId: 'opr_handoff',
      operatorSessionId: 'ops_handoff_session',
      targetMemberId: 'mem_handoff_target',
      merchantId: 'mer_handoff',
      lifecycle: 'pending-handoff',
      reason: 'Reproduce a reported scheduling issue',
      supportReference: 'SUP-42'
    })
    expect(record?.ticketHash).toMatch(/^[a-f0-9]{64}$/)
    expect(JSON.stringify(record)).not.toContain(ticket)

    const [audit] = await db
      .select()
      .from(operationsAuditEvents)
      .where(eq(operationsAuditEvents.impersonationId, 'imp_handoff'))
    expect(audit).toMatchObject({
      actorOperatorId: 'opr_handoff',
      targetId: 'mem_handoff_target',
      merchantId: 'mer_handoff',
      action: 'impersonation.start',
      result: 'accepted',
      internalReason: 'Reproduce a reported scheduling issue',
      supportReference: 'SUP-42',
      retentionPolicy: 'impersonation-two-years'
    })
    expect(JSON.stringify(audit)).not.toContain(ticket)
  })

  it('rejects an empty reason and retains rejected-attempt evidence without a record', async () => {
    const operator = await addOperator('empty_reason')
    const target = await addTarget('empty_reason')

    await expect(
      start({ ...operator, ...target, reason: '   ' })
    ).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'impersonation reason is required'
    })
    expect(
      await db
        .select()
        .from(impersonationRecords)
        .where(eq(impersonationRecords.operatorId, operator.operatorId))
    ).toEqual([])
    const [audit] = await db
      .select()
      .from(operationsAuditEvents)
      .where(
        and(
          eq(operationsAuditEvents.operatorSessionId, operator.operatorSessionId),
          eq(operationsAuditEvents.action, 'impersonation.start')
        )
      )
    expect(audit).toMatchObject({ result: 'rejected', internalReason: null })
  })

  it.each([
    {
      name: 'stale TOTP presence',
      operator: { totpVerifiedAt: new Date(now.getTime() - 5 * 60_000 - 1_000) },
      target: {}
    },
    {
      name: 'expired Better Auth session',
      operator: { sessionExpiresAt: new Date(now.getTime() - 1_000) },
      target: {}
    },
    {
      name: 'unverified TOTP factor',
      operator: { factorVerified: false },
      target: {}
    },
    {
      name: 'locked TOTP factor',
      operator: { factorLockedUntil: new Date(now.getTime() + 60_000) },
      target: {}
    },
    {
      name: 'stale permission',
      operator: { roles: 'merchant-reader' },
      target: {}
    },
    {
      name: 'disabled target',
      operator: {},
      target: { banned: true }
    },
    {
      name: 'unsupported identity class',
      operator: {},
      target: { identityClass: 'customer_account' as const }
    },
    {
      name: 'disabled Merchant',
      operator: {},
      target: { merchantStatus: 'disabled' as const }
    }
  ])('rechecks $name at the authoritative start decision', async (scenario) => {
    const suffix = `recheck_${scenario.name.replaceAll(' ', '_')}`
    const operator = await addOperator(suffix, scenario.operator)
    const target = await addTarget(suffix, scenario.target)

    await expect(start({ ...operator, ...target })).rejects.toMatchObject({
      _tag: 'OperationsContractDenied',
      reason: 'impersonation handoff is unavailable'
    })
    const [audit] = await db
      .select()
      .from(operationsAuditEvents)
      .where(eq(operationsAuditEvents.operatorSessionId, operator.operatorSessionId))
    expect(audit?.result).toBe('rejected')
  })

  it('rejects a Merchant mismatch even when the target is otherwise eligible', async () => {
    const operator = await addOperator('merchant_mismatch')
    const target = await addTarget('merchant_mismatch')
    const other = await addTarget('merchant_mismatch_other')

    await expect(
      start({ ...operator, ...target, merchantId: other.merchantId })
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })
  })

  it('locks one open handoff per operator and per target without replacing either', async () => {
    const firstOperator = await addOperator('operator_lock')
    const firstTarget = await addTarget('operator_lock_a')
    const secondTarget = await addTarget('operator_lock_b')
    await start(
      { ...firstOperator, ...firstTarget },
      { id: () => 'imp_operator_lock_a', ticket: () => 'ticket-operator-lock-a' }
    )
    await expect(
      start(
        { ...firstOperator, ...secondTarget },
        { id: () => 'imp_operator_lock_b', ticket: () => 'ticket-operator-lock-b' }
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })

    const secondOperator = await addOperator('target_lock')
    await expect(
      start(
        { ...secondOperator, ...firstTarget },
        { id: () => 'imp_target_lock', ticket: () => 'ticket-target-lock' }
      )
    ).rejects.toMatchObject({ _tag: 'OperationsContractDenied' })

    const open = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, 'imp_operator_lock_a'))
    expect(open).toHaveLength(1)
  })

  it('serializes concurrent starts so exactly one operator acquires the target slot', async () => {
    const firstOperator = await addOperator('target_race_a')
    const secondOperator = await addOperator('target_race_b')
    const target = await addTarget('target_race')
    const attempts = await Promise.allSettled([
      start(
        { ...firstOperator, ...target },
        { id: () => 'imp_target_race_a', ticket: () => 'ticket-target-race-a' }
      ),
      start(
        { ...secondOperator, ...target },
        { id: () => 'imp_target_race_b', ticket: () => 'ticket-target-race-b' }
      )
    ])

    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected')).toHaveLength(1)
    const records = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.targetMemberId, target.targetMemberId))
    expect(records).toHaveLength(1)
    const evidence = await db
      .select()
      .from(operationsAuditEvents)
      .where(eq(operationsAuditEvents.targetId, target.targetMemberId))
    expect(evidence.map((event) => event.result).sort()).toEqual([
      'accepted',
      'rejected'
    ])
  })

  it('expires a pending handoff before deterministically releasing both slots', async () => {
    const operator = await addOperator('expiry_release')
    const target = await addTarget('expiry_release')
    await start(
      { ...operator, ...target },
      { id: () => 'imp_expiring', ticket: () => 'ticket-expiring' }
    )
    const later = new Date(now.getTime() + 61_000)
    const replacement = await start(
      { ...operator, ...target },
      {
        now: () => later,
        id: () => 'imp_after_expiry',
        ticket: () => 'ticket-after-expiry'
      }
    )

    expect(replacement.impersonationId).toBe('imp_after_expiry')
    const [expired] = await db
      .select()
      .from(impersonationRecords)
      .where(eq(impersonationRecords.id, 'imp_expiring'))
    expect(expired).toMatchObject({
      lifecycle: 'expired',
      terminationCause: 'handoff-expired'
    })
  })
})
