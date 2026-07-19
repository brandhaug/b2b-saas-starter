import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { createDb } from '@b2b-saas-starter/db/client'
import { auditEvents, merchants, session, user } from '@b2b-saas-starter/db/schema'
import { eq } from 'drizzle-orm'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  GlobalOperationsAudit,
  OperationsContractDenied,
  makeOperationsAuditLayer
} from './operations-audit.ts'

const occurredAt = '2026-07-19T09:00:00.000Z'

describe('Global Operations audit', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  }, 30_000)

  afterAll(async () => testD1?.dispose())

  const addOperator = async (input: {
    readonly id: string
    readonly sessionId: string
    readonly roles: string
  }) => {
    const db = createDb(testD1.d1)
    const now = new Date()
    await db.insert(user).values({
      id: input.id,
      email: `${input.id}@operations.test`,
      name: input.id,
      emailVerified: true,
      identityClass: 'system_operator',
      twoFactorEnabled: true,
      role: input.roles,
      createdAt: now,
      updatedAt: now
    })
    await db.insert(session).values({
      id: input.sessionId,
      token: `token-${input.sessionId}`,
      userId: input.id,
      expiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1_000),
      operatorIdleExpiresAt: new Date(now.getTime() + 30 * 60 * 1_000),
      operatorAbsoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60 * 1_000),
      createdAt: now,
      updatedAt: now
    })
    return db
  }

  it('allows only an Impersonation Auditor to review one business event after retries', async () => {
    const db = await addOperator({
      id: 'opr_auditor',
      sessionId: 'ops_auditor',
      roles: 'impersonation-auditor'
    })
    await addOperator({
      id: 'opr_reader',
      sessionId: 'ops_reader',
      roles: 'merchant-reader'
    })
    const program = Effect.gen(function* () {
      const audit = yield* GlobalOperationsAudit
      const event = {
        businessEventId: 'bootstrap:opr_target:accepted',
        actor: { id: 'opr_auditor', displayName: 'Ada Auditor' },
        operatorSessionId: 'ops_auditor',
        impersonationId: null,
        target: { id: 'opr_target', displayName: 'Target Operator' },
        merchant: null,
        action: 'operator.bootstrap',
        result: 'accepted' as const,
        occurredAt,
        internalReason: null,
        supportReference: null
      }
      yield* audit.record(event)
      yield* audit.record(event)
      const visible = yield* audit.list({ operatorSessionId: 'ops_auditor' }, {})
      const denied = yield* Effect.flip(
        audit.list({ operatorSessionId: 'ops_reader' }, {})
      )
      return { visible, denied }
    }).pipe(Effect.provide(makeOperationsAuditLayer(db)))

    const result = await Effect.runPromise(program)
    expect(result.visible.events).toEqual([
      expect.objectContaining({
        actor: { id: 'opr_auditor', displayName: 'Ada Auditor' },
        target: { id: 'opr_target', displayName: 'Target Operator' },
        action: 'operator.bootstrap',
        result: 'accepted',
        occurredAt
      })
    ])
    expect(result.denied).toBeInstanceOf(OperationsContractDenied)
  })

  it('filters stable snapshots after identity deletion and protects sensitive detail', async () => {
    const db = await addOperator({
      id: 'opr_reviewer',
      sessionId: 'ops_reviewer',
      roles: 'impersonation-auditor'
    })
    const now = new Date(occurredAt)
    await db.insert(user).values([
      {
        id: 'opr_historical',
        email: 'historical@operations.test',
        name: 'Historical Operator',
        emailVerified: true,
        identityClass: 'system_operator',
        twoFactorEnabled: true,
        role: 'merchant-impersonator',
        createdAt: now,
        updatedAt: now
      },
      {
        id: 'usr_historical_target',
        email: 'target@merchant.test',
        name: 'Historical Target',
        emailVerified: true,
        identityClass: 'merchant_member',
        createdAt: now,
        updatedAt: now
      }
    ])
    await db.insert(merchants).values({
      id: 'mer_historical',
      publicName: 'Historical Merchant',
      slug: 'historical-merchant',
      timezone: 'UTC',
      currency: 'EUR',
      createdAt: occurredAt,
      updatedAt: occurredAt
    })

    const program = Effect.gen(function* () {
      const audit = yield* GlobalOperationsAudit
      yield* audit.record({
        businessEventId: 'impersonation:imp_42:activated',
        actor: { id: 'opr_historical', displayName: 'Historical Operator' },
        operatorSessionId: 'ops_historical',
        impersonationId: 'imp_42',
        target: { id: 'usr_historical_target', displayName: 'Historical Target' },
        merchant: { id: 'mer_historical', displayName: 'Historical Merchant' },
        action: 'impersonation.activated',
        result: 'accepted',
        occurredAt,
        internalReason: 'Reproduce a private scheduling report',
        supportReference: 'SUP-42'
      })
      yield* Effect.promise(() => db.delete(user).where(eq(user.id, 'opr_historical')))
      yield* Effect.promise(() =>
        db.delete(user).where(eq(user.id, 'usr_historical_target'))
      )
      yield* Effect.promise(() =>
        db.delete(merchants).where(eq(merchants.id, 'mer_historical'))
      )
      const actor = { operatorSessionId: 'ops_reviewer' }
      const events = yield* audit.list(actor, {
        action: 'impersonation.activated',
        result: 'accepted',
        actorOperatorId: 'opr_historical',
        merchantId: 'mer_historical',
        targetId: 'usr_historical_target'
      })
      const detail = yield* audit.get(actor, events.events[0]!.id)
      return { events, detail }
    }).pipe(Effect.provide(makeOperationsAuditLayer(db)))

    const result = await Effect.runPromise(program)
    expect(result.events.events).toEqual([
      expect.objectContaining({
        actor: { id: 'opr_historical', displayName: 'Historical Operator' },
        target: {
          id: 'usr_historical_target',
          displayName: 'Historical Target'
        },
        merchant: { id: 'mer_historical', displayName: 'Historical Merchant' },
        retentionPolicy: 'impersonation-two-years',
        retainUntil: '2028-07-19T09:00:00.000Z'
      })
    ])
    expect(JSON.stringify(result.events.events)).not.toContain('private scheduling')
    expect(JSON.stringify(result.events.events)).not.toContain('SUP-42')
    expect(result.detail).toMatchObject({
      operatorSessionId: 'ops_historical',
      impersonationId: 'imp_42',
      internalReason: 'Reproduce a private scheduling report',
      supportReference: 'SUP-42'
    })
  })

  it('projects existing Operations producers without copying arbitrary metadata', async () => {
    const db = await addOperator({
      id: 'opr_projection_reviewer',
      sessionId: 'ops_projection_reviewer',
      roles: 'impersonation-auditor'
    })
    await db.insert(auditEvents).values({
      id: 'aud_legacy_invitation',
      actorUserId: 'opr_projection_reviewer',
      eventType: 'operator.invitation.created',
      targetType: 'system_operator',
      targetId: null,
      metadata: {
        result: 'accepted',
        reason: 'Enrollment completed',
        supportReference: 'STAFF-42',
        tokenHash: 'must-never-enter-global-audit',
        backupCodes: ['must-never-enter-global-audit']
      },
      createdAt: occurredAt
    })
    await db.insert(auditEvents).values({
      id: 'aud_auth_rate_limited',
      actorUserId: null,
      eventType: 'operations.authentication.rate-limited',
      targetType: 'system-operator-authentication',
      targetId: null,
      metadata: { category: 'operator-authentication', retryable: true },
      createdAt: occurredAt
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const audit = yield* GlobalOperationsAudit
        const events = yield* audit.list(
          { operatorSessionId: 'ops_projection_reviewer' },
          { action: 'operator.invitation.created' }
        )
        return yield* audit.get(
          { operatorSessionId: 'ops_projection_reviewer' },
          events.events[0]!.id
        )
      }).pipe(Effect.provide(makeOperationsAuditLayer(db)))
    )

    expect(result).toMatchObject({
      actor: {
        id: 'opr_projection_reviewer',
        displayName: 'opr_projection_reviewer'
      },
      action: 'operator.invitation.created',
      result: 'accepted',
      internalReason: 'Enrollment completed',
      supportReference: 'STAFF-42'
    })
    expect(JSON.stringify(result)).not.toContain('must-never-enter-global-audit')

    const rateLimited = await Effect.runPromise(
      Effect.gen(function* () {
        const audit = yield* GlobalOperationsAudit
        return yield* audit.list(
          { operatorSessionId: 'ops_projection_reviewer' },
          { action: 'operations.authentication.rate-limited' }
        )
      }).pipe(Effect.provide(makeOperationsAuditLayer(db)))
    )
    expect(rateLimited.events[0]?.result).toBe('rejected')
  })

  it('paginates the complete global history with a stable cursor', async () => {
    const db = await addOperator({
      id: 'opr_pagination_reviewer',
      sessionId: 'ops_pagination_reviewer',
      roles: 'impersonation-auditor'
    })
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const audit = yield* GlobalOperationsAudit
        for (const [index, time] of [
          '2026-07-19T09:03:00.000Z',
          '2026-07-19T09:02:00.000Z',
          '2026-07-19T09:01:00.000Z'
        ].entries()) {
          yield* audit.record({
            businessEventId: `pagination:${index}`,
            actor: {
              id: 'opr_pagination_reviewer',
              displayName: 'Pagination Reviewer'
            },
            operatorSessionId: 'ops_pagination_reviewer',
            impersonationId: null,
            target: null,
            merchant: null,
            action: 'operator.pagination-proof',
            result: 'accepted',
            occurredAt: time,
            internalReason: null,
            supportReference: null
          })
        }
        const first = yield* audit.list(
          { operatorSessionId: 'ops_pagination_reviewer' },
          { action: 'operator.pagination-proof', limit: 2 }
        )
        const second = yield* audit.list(
          { operatorSessionId: 'ops_pagination_reviewer' },
          {
            action: 'operator.pagination-proof',
            limit: 2,
            cursor: first.nextCursor!
          }
        )
        return { first, second }
      }).pipe(Effect.provide(makeOperationsAuditLayer(db)))
    )

    expect(result.first.events).toHaveLength(2)
    expect(result.first.nextCursor).not.toBeNull()
    expect(result.second.events).toHaveLength(1)
    expect(result.second.nextCursor).toBeNull()
  })
})
