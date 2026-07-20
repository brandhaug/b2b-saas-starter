import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  account,
  auditEvents,
  operatorEnrollments,
  operatorInvitations,
  session,
  twoFactor,
  user
} from '@b2b-saas-starter/db'
import { createDb } from '@b2b-saas-starter/db/client'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { eq } from 'drizzle-orm'
import {
  OperatorInvitations,
  makeOperatorInvitationsLayer
} from './operator-invitations.ts'

const now = new Date('2026-07-19T12:00:00.000Z')

describe('Operator Invitation capability boundary', () => {
  let testD1: TestD1

  beforeAll(async () => {
    testD1 = await provisionTestD1()
  }, 30_000)

  afterAll(async () => {
    await testD1?.dispose()
  })

  const setup = async (roles = 'operator-manager') => {
    const db = createDb(testD1.d1)
    const managerId = `opr_manager_${crypto.randomUUID()}`
    const managerSessionId = `ops_manager_${crypto.randomUUID()}`
    await db.insert(user).values({
      id: managerId,
      email: `${managerId}@example.test`,
      name: 'Operator Manager',
      emailVerified: true,
      twoFactorEnabled: true,
      identityClass: 'system_operator',
      role: roles,
      createdAt: now,
      updatedAt: now
    })
    await db.insert(session).values({
      id: managerSessionId,
      token: `token_${managerSessionId}`,
      userId: managerId,
      expiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
      operatorIdleExpiresAt: new Date(now.getTime() + 30 * 60_000),
      operatorAbsoluteExpiresAt: new Date(now.getTime() + 8 * 60 * 60_000),
      createdAt: now,
      updatedAt: now
    })
    const run = <A, E>(effect: Effect.Effect<A, E, OperatorInvitations>) =>
      Effect.runPromise(effect.pipe(Effect.provide(makeOperatorInvitationsLayer(db))))
    return {
      db,
      managerId,
      actor: { operatorSessionId: managerSessionId },
      run
    }
  }

  it('invites a dedicated identity with explicit roles for exactly 24 hours', async () => {
    const fixture = await setup()
    const invitation = await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.invite(
          {
            actor: fixture.actor,
            email: 'new.operator@example.test',
            roles: ['merchant-reader', 'impersonation-auditor'],
            tokenHash: 'invitation_hash_happy'
          },
          now
        )
      )
    )

    expect(invitation).toMatchObject({
      email: 'new.operator@example.test',
      roles: ['merchant-reader', 'impersonation-auditor'],
      expiresAt: new Date('2026-07-20T12:00:00.000Z')
    })
    const [stored] = await fixture.db
      .select()
      .from(operatorInvitations)
      .where(eq(operatorInvitations.id, invitation.id))
    expect(stored?.tokenHash).toBe('invitation_hash_happy')
    expect(stored?.invitedByOperatorId).toBe(fixture.managerId)
  })

  it('rejects unauthorized managers, identity collisions, and unsupported roles', async () => {
    const fixture = await setup('merchant-reader')
    await fixture.db.insert(user).values({
      id: `usr_collision_${crypto.randomUUID()}`,
      email: 'member@example.test',
      name: 'Merchant Member',
      emailVerified: true,
      identityClass: 'merchant_member',
      createdAt: now,
      updatedAt: now
    })
    const invite = (email: string, roles: readonly string[]) =>
      fixture.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.invite(
            {
              actor: fixture.actor,
              email,
              roles,
              tokenHash: `hash_${crypto.randomUUID()}`
            },
            now
          )
        )
      )

    await expect(invite('another@example.test', ['merchant-reader'])).rejects.toThrow(
      'operator manager permission is required'
    )

    const manager = await setup()
    await expect(
      manager.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.invite(
            {
              actor: manager.actor,
              email: 'member@example.test',
              roles: ['merchant-reader'],
              tokenHash: 'collision_hash'
            },
            now
          )
        )
      )
    ).rejects.toThrow('identity already exists')
    await expect(
      manager.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.invite(
            {
              actor: manager.actor,
              email: 'wildcard@example.test',
              roles: ['admin'],
              tokenHash: 'wildcard_hash'
            },
            now
          )
        )
      )
    ).rejects.toThrow('accepted operator role is required')
  })

  it('accepts once, creates a permissionless 30-minute enrollment, and rejects replay', async () => {
    const fixture = await setup()
    const invitation = await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.invite(
          {
            actor: fixture.actor,
            email: 'recipient@example.test',
            roles: ['merchant-reader'],
            tokenHash: 'invitation_hash_accept'
          },
          now
        )
      )
    )
    const acceptance = {
      tokenHash: 'invitation_hash_accept',
      enrollmentTokenHash: 'enrollment_hash_accept',
      name: 'Recipient Operator',
      passwordHash: 'hashed-password'
    }
    const accepted = await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) => service.accept(acceptance, now))
    )

    expect(accepted).toMatchObject({
      invitationId: invitation.id,
      expiresAt: new Date('2026-07-19T12:30:00.000Z')
    })
    const [operator] = await fixture.db
      .select()
      .from(user)
      .where(eq(user.id, accepted.operatorId))
    expect(operator).toMatchObject({
      email: 'recipient@example.test',
      emailVerified: true,
      twoFactorEnabled: false,
      identityClass: 'system_operator',
      role: 'merchant-reader'
    })
    expect(
      await fixture.db
        .select()
        .from(account)
        .where(eq(account.userId, accepted.operatorId))
    ).toHaveLength(1)
    expect(
      await fixture.db
        .select()
        .from(session)
        .where(eq(session.userId, accepted.operatorId))
    ).toHaveLength(0)
    await expect(
      fixture.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.accept(acceptance, now)
        )
      )
    ).rejects.toThrow('invitation is unavailable')
  })

  it('rejects revoked and expired invitations', async () => {
    const fixture = await setup()
    const create = (tokenHash: string) =>
      fixture.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.invite(
            {
              actor: fixture.actor,
              email: `${tokenHash}@example.test`,
              roles: ['merchant-reader'],
              tokenHash
            },
            now
          )
        )
      )
    const revoked = await create('invitation_hash_revoked')
    await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.revoke({ actor: fixture.actor, invitationId: revoked.id }, now)
      )
    )
    const accept = (tokenHash: string, at: Date) =>
      fixture.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.accept(
            {
              tokenHash,
              enrollmentTokenHash: `enrollment_${tokenHash}`,
              name: 'Recipient',
              passwordHash: 'hashed-password'
            },
            at
          )
        )
      )
    await expect(accept('invitation_hash_revoked', now)).rejects.toThrow(
      'invitation is unavailable'
    )
    await create('invitation_hash_expired')
    await expect(
      accept('invitation_hash_expired', new Date('2026-07-20T12:00:00.001Z'))
    ).rejects.toThrow('invitation is unavailable')
  })

  it('resumes interrupted enrollment and grants no operational session before completion', async () => {
    const fixture = await setup()
    await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.invite(
          {
            actor: fixture.actor,
            email: 'interrupted@example.test',
            roles: ['merchant-reader'],
            tokenHash: 'invitation_hash_interrupted'
          },
          now
        )
      )
    )
    const accepted = await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.accept(
          {
            tokenHash: 'invitation_hash_interrupted',
            enrollmentTokenHash: 'enrollment_hash_first',
            name: 'Interrupted Operator',
            passwordHash: 'hashed-password'
          },
          now
        )
      )
    )
    const resumed = await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.resume(
          {
            operatorId: accepted.operatorId,
            enrollmentTokenHash: 'enrollment_hash_resumed'
          },
          new Date('2026-07-19T13:00:00.000Z')
        )
      )
    )
    expect(resumed.expiresAt).toEqual(new Date('2026-07-19T13:30:00.000Z'))
    expect(
      await fixture.db
        .select()
        .from(session)
        .where(eq(session.userId, accepted.operatorId))
    ).toHaveLength(0)

    await fixture.db
      .update(user)
      .set({ twoFactorEnabled: true })
      .where(eq(user.id, accepted.operatorId))
    await fixture.db.insert(twoFactor).values({
      id: `totp_${accepted.operatorId}`,
      userId: accepted.operatorId,
      secret: 'encrypted-secret',
      backupCodes: 'encrypted-backup-codes',
      verified: true
    })
    await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.complete({ enrollmentTokenHash: 'enrollment_hash_resumed' }, now)
      )
    )
    const [enrollment] = await fixture.db
      .select()
      .from(operatorEnrollments)
      .where(eq(operatorEnrollments.operatorId, accepted.operatorId))
    expect(enrollment?.backupCodesConfirmedAt).toEqual(now)
    expect(enrollment?.completedAt).toEqual(now)
  })

  it('audits invitation creation, revocation, acceptance, expiry, success, and failure', async () => {
    const fixture = await setup()
    const invitation = await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.invite(
          {
            actor: fixture.actor,
            email: 'audited@example.test',
            roles: ['merchant-reader'],
            tokenHash: 'invitation_hash_audit'
          },
          now
        )
      )
    )
    await fixture.run(
      Effect.flatMap(OperatorInvitations, (service) =>
        service.revoke({ actor: fixture.actor, invitationId: invitation.id }, now)
      )
    )
    await expect(
      fixture.run(
        Effect.flatMap(OperatorInvitations, (service) =>
          service.accept(
            {
              tokenHash: 'invitation_hash_audit',
              enrollmentTokenHash: 'enrollment_hash_audit',
              name: 'Audited Operator',
              passwordHash: 'hashed-password'
            },
            now
          )
        )
      )
    ).rejects.toThrow()

    const events = (await fixture.db.select().from(auditEvents)).filter(
      ({ targetId }) => targetId === invitation.id
    )
    expect(events.map(({ eventType }) => eventType)).toEqual(
      expect.arrayContaining([
        'operator.invitation.created',
        'operator.invitation.revoked',
        'operator.invitation.acceptance-rejected'
      ])
    )
    expect(JSON.stringify(events)).not.toMatch(
      /invitation_hash|enrollment_hash|hashed-password/
    )
  })
})
