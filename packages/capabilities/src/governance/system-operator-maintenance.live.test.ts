import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  makeD1OperatorMaintenanceDatabase,
  makeSystemOperatorMaintenance
} from './system-operator-maintenance.ts'

const now = new Date('2026-07-19T12:00:00.000Z')

describe('System Operator maintenance commands', () => {
  let test: TestD1

  beforeAll(async () => {
    test = await provisionTestD1()
  }, 30_000)

  afterAll(async () => test.dispose())

  const insertIdentity = async (input: {
    readonly id: string
    readonly email: string
    readonly identityClass?: 'merchant_member' | 'customer_account' | 'system_operator'
    readonly verified?: boolean
    readonly roles?: string
  }) => {
    await test.d1
      .prepare(
        `INSERT INTO user
         (id, email, name, emailVerified, role, identityClass, twoFactorEnabled, banned, createdAt, updatedAt)
         VALUES (?1, ?2, 'Dedicated identity', ?3, ?4, ?5, 0, 0, ?6, ?6)`
      )
      .bind(
        input.id,
        input.email,
        input.verified === false ? 0 : 1,
        input.roles ?? 'user',
        input.identityClass ?? 'merchant_member',
        Math.floor(now.getTime() / 1_000)
      )
      .run()
  }

  const maintenance = () =>
    makeSystemOperatorMaintenance(makeD1OperatorMaintenanceDatabase(test.d1), {
      now: () => now,
      id: () => `oaud_${crypto.randomUUID()}`
    })

  it('bootstraps an existing verified dedicated identity with explicit roles idempotently', async () => {
    const email = `bootstrap-${crypto.randomUUID()}@example.test`
    const operatorId = `opr_${crypto.randomUUID()}`
    await insertIdentity({
      id: operatorId,
      email,
      identityClass: 'system_operator',
      roles: 'user'
    })

    const request = {
      actor: 'maintainer@example.test',
      environment: 'production' as const,
      remote: true,
      email,
      confirmedEmail: email,
      roles: ['merchant-reader', 'operator-manager'] as const
    }
    const first = await Effect.runPromise(maintenance().bootstrap(request))
    const second = await Effect.runPromise(maintenance().bootstrap(request))

    expect(first).toEqual({ operatorId, enrollmentRequired: true, changed: true })
    expect(second).toEqual({ operatorId, enrollmentRequired: true, changed: false })
    const operator = await test.d1
      .prepare(
        'SELECT identityClass, role, emailVerified, twoFactorEnabled FROM user WHERE id = ?1'
      )
      .bind(operatorId)
      .first<{
        identityClass: string
        role: string
        emailVerified: number
        twoFactorEnabled: number
      }>()
    expect(operator).toEqual({
      identityClass: 'system_operator',
      role: 'merchant-reader,operator-manager',
      emailVerified: 1,
      twoFactorEnabled: 0
    })
    const memberships = await test.d1
      .prepare('SELECT count(*) AS count FROM merchant_memberships WHERE user_id = ?1')
      .bind(operatorId)
      .first<{ count: number }>()
    expect(memberships?.count).toBe(0)
    const audits = await test.d1
      .prepare(
        `SELECT event_type, target_id, metadata, created_at
         FROM audit_events WHERE target_id = ?1 ORDER BY created_at`
      )
      .bind(operatorId)
      .all<{
        event_type: string
        target_id: string
        metadata: string
        created_at: string
      }>()
    expect(audits.results).toHaveLength(2)
    expect(audits.results[0]).toMatchObject({
      event_type: 'operations.operator.bootstrap.accepted',
      target_id: operatorId,
      created_at: now.toISOString()
    })
    expect(JSON.parse(audits.results[0]!.metadata)).toEqual({
      actor: 'maintainer@example.test',
      targetEmail: email,
      result: 'accepted',
      environment: 'production',
      changed: true
    })
  })

  it('rejects identity collisions, unverified identities, and implicit role broadening', async () => {
    const suffix = crypto.randomUUID()
    const merchantEmail = `merchant-${suffix}@example.test`
    const customerEmail = `customer-${suffix}@example.test`
    const detachedMerchantEmail = `detached-merchant-${suffix}@example.test`
    const unverifiedEmail = `unverified-${suffix}@example.test`
    const operatorEmail = `operator-${suffix}@example.test`
    await insertIdentity({ id: `usr_merchant_${suffix}`, email: merchantEmail })
    await test.d1
      .prepare(
        `INSERT INTO merchants
         (id, public_name, slug, timezone, currency, created_at, updated_at)
         VALUES (?1, 'Collision merchant', ?2, 'UTC', 'EUR', ?3, ?3)`
      )
      .bind(`mer_${suffix}`, `collision-${suffix}`, now.toISOString())
      .run()
    await test.d1
      .prepare(
        `INSERT INTO merchant_memberships (merchant_id, user_id, role, created_at)
         VALUES (?1, ?2, 'owner', ?3)`
      )
      .bind(`mer_${suffix}`, `usr_merchant_${suffix}`, now.toISOString())
      .run()
    await insertIdentity({
      id: `usr_customer_${suffix}`,
      email: customerEmail,
      identityClass: 'customer_account'
    })
    await insertIdentity({
      id: `usr_detached_merchant_${suffix}`,
      email: detachedMerchantEmail
    })
    await insertIdentity({
      id: `usr_unverified_${suffix}`,
      email: unverifiedEmail,
      verified: false
    })
    await insertIdentity({
      id: `opr_existing_${suffix}`,
      email: operatorEmail,
      identityClass: 'system_operator',
      roles: 'merchant-reader'
    })

    for (const [email, reason] of [
      [merchantEmail, 'identity belongs to a Merchant Member'],
      [detachedMerchantEmail, 'identity belongs to a Merchant Member'],
      [customerEmail, 'identity belongs to a Customer Account'],
      [unverifiedEmail, 'target email is not verified']
    ] as const) {
      await expect(
        Effect.runPromise(
          maintenance().bootstrap({
            actor: 'maintainer@example.test',
            environment: 'local',
            remote: false,
            email,
            confirmedEmail: email,
            roles: ['merchant-reader']
          })
        )
      ).rejects.toMatchObject({ reason })
    }
    await expect(
      Effect.runPromise(
        maintenance().bootstrap({
          actor: 'maintainer@example.test',
          environment: 'local',
          remote: false,
          email: operatorEmail,
          confirmedEmail: operatorEmail,
          roles: ['merchant-reader', 'operator-manager']
        })
      )
    ).rejects.toMatchObject({ reason: 'existing roles differ from requested roles' })
  })

  it('requires an explicit remote production target and exact confirmation', async () => {
    const email = `targeting-${crypto.randomUUID()}@example.test`
    await insertIdentity({
      id: `opr_${crypto.randomUUID()}`,
      email,
      identityClass: 'system_operator',
      roles: 'user'
    })

    for (const request of [
      { environment: 'production' as const, remote: false, confirmedEmail: email },
      {
        environment: 'production' as const,
        remote: true,
        confirmedEmail: `wrong-${email}`
      },
      { environment: 'local' as const, remote: true, confirmedEmail: email }
    ]) {
      await expect(
        Effect.runPromise(
          maintenance().bootstrap({
            actor: 'maintainer@example.test',
            email,
            roles: ['merchant-reader'],
            ...request
          })
        )
      ).rejects.toMatchObject({ _tag: 'OperatorMaintenanceRejected' })
    }
  })

  it('recovers only the exact operator after revoking Operator and derived sessions', async () => {
    const suffix = crypto.randomUUID()
    const operatorId = `opr_recovery_${suffix}`
    const targetId = `usr_target_${suffix}`
    const unrelatedId = `usr_unrelated_${suffix}`
    const email = `recovery-${suffix}@example.test`
    await insertIdentity({
      id: operatorId,
      email,
      identityClass: 'system_operator',
      roles: 'operator-manager'
    })
    await insertIdentity({ id: targetId, email: `target-${suffix}@example.test` })
    await insertIdentity({ id: unrelatedId, email: `unrelated-${suffix}@example.test` })
    const epoch = Math.floor(now.getTime() / 1_000)
    await test.d1.batch([
      test.d1
        .prepare(
          `INSERT INTO session
           (id, expiresAt, token, createdAt, updatedAt, userId, operatorIdleExpiresAt, operatorAbsoluteExpiresAt)
           VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?2, ?2)`
        )
        .bind(`ops_${suffix}`, epoch + 3600, `ops_token_${suffix}`, epoch, operatorId),
      test.d1
        .prepare(
          `INSERT INTO session
           (id, expiresAt, token, createdAt, updatedAt, userId, impersonatedBy)
           VALUES (?1, ?2, ?3, ?4, ?4, ?5, ?6)`
        )
        .bind(
          `imp_${suffix}`,
          epoch + 3600,
          `imp_token_${suffix}`,
          epoch,
          targetId,
          operatorId
        ),
      test.d1
        .prepare(
          `INSERT INTO session
           (id, expiresAt, token, createdAt, updatedAt, userId)
           VALUES (?1, ?2, ?3, ?4, ?4, ?5)`
        )
        .bind(
          `unrelated_${suffix}`,
          epoch + 3600,
          `unrelated_token_${suffix}`,
          epoch,
          unrelatedId
        ),
      test.d1
        .prepare(
          `INSERT INTO twoFactor
           (id, secret, backupCodes, userId, verified, failedVerificationCount)
           VALUES (?1, 'encrypted-secret', 'encrypted-backup-codes', ?2, 1, 0)`
        )
        .bind(`totp_${suffix}`, operatorId),
      test.d1
        .prepare('UPDATE user SET twoFactorEnabled = 1 WHERE id = ?1')
        .bind(operatorId)
    ])

    const result = await Effect.runPromise(
      maintenance().recover({
        actor: 'security@example.test',
        environment: 'production',
        remote: true,
        email,
        confirmedEmail: email
      })
    )

    expect(result).toEqual({ operatorId, enrollmentRequired: true })
    const sessions = await test.d1
      .prepare('SELECT id FROM session WHERE id LIKE ?1 ORDER BY id')
      .bind(`%${suffix}`)
      .all<{ id: string }>()
    expect(sessions.results).toEqual([{ id: `unrelated_${suffix}` }])
    expect(
      await test.d1
        .prepare('SELECT count(*) AS count FROM twoFactor WHERE userId = ?1')
        .bind(operatorId)
        .first<{ count: number }>()
    ).toEqual({ count: 0 })
    expect(
      await test.d1
        .prepare('SELECT twoFactorEnabled FROM user WHERE id = ?1')
        .bind(operatorId)
        .first<{ twoFactorEnabled: number }>()
    ).toEqual({ twoFactorEnabled: 0 })
    const audit = await test.d1
      .prepare(
        `SELECT event_type, target_id, metadata, created_at
         FROM audit_events
         WHERE target_id = ?1 AND event_type = 'operations.operator.recovery.accepted'`
      )
      .bind(operatorId)
      .first<{
        event_type: string
        target_id: string
        metadata: string
        created_at: string
      }>()
    expect(audit).toMatchObject({
      event_type: 'operations.operator.recovery.accepted',
      target_id: operatorId,
      created_at: now.toISOString()
    })
    expect(JSON.parse(audit!.metadata)).toEqual({
      actor: 'security@example.test',
      targetEmail: email,
      result: 'accepted',
      environment: 'production'
    })
  })

  it('rolls recovery back when durable audit persistence fails', async () => {
    const suffix = crypto.randomUUID()
    const operatorId = `opr_rollback_${suffix}`
    const email = `rollback-${suffix}@example.test`
    await insertIdentity({
      id: operatorId,
      email,
      identityClass: 'system_operator',
      roles: 'operator-manager'
    })
    const epoch = Math.floor(now.getTime() / 1_000)
    await test.d1
      .prepare(
        `INSERT INTO session (id, expiresAt, token, createdAt, updatedAt, userId)
         VALUES (?1, ?2, ?3, ?4, ?4, ?5)`
      )
      .bind(
        `ops_rollback_${suffix}`,
        epoch + 3600,
        `token_${suffix}`,
        epoch,
        operatorId
      )
      .run()
    await test.d1.batch([
      test.d1
        .prepare(
          `INSERT INTO twoFactor
           (id, secret, backupCodes, userId, verified, failedVerificationCount)
           VALUES (?1, 'encrypted-secret', 'encrypted-backup-codes', ?2, 1, 0)`
        )
        .bind(`totp_rollback_${suffix}`, operatorId),
      test.d1
        .prepare('UPDATE user SET twoFactorEnabled = 1 WHERE id = ?1')
        .bind(operatorId)
    ])
    const database = makeD1OperatorMaintenanceDatabase(test.d1)
    const failing = {
      ...database,
      batch: (statements: Parameters<typeof database.batch>[0]) =>
        database.batch([
          ...statements,
          {
            sql: 'INSERT INTO table_that_does_not_exist (id) VALUES (?1)',
            params: ['fail']
          }
        ])
    }

    await expect(
      Effect.runPromise(
        makeSystemOperatorMaintenance(failing, {
          now: () => now,
          id: () => `oaud_${crypto.randomUUID()}`
        }).recover({
          actor: 'security@example.test',
          environment: 'local',
          remote: false,
          email,
          confirmedEmail: email
        })
      )
    ).rejects.toMatchObject({
      _tag: 'CapabilityUnavailable',
      capability: 'system-operator-maintenance'
    })
    expect(
      await test.d1
        .prepare('SELECT count(*) AS count FROM session WHERE userId = ?1')
        .bind(operatorId)
        .first<{ count: number }>()
    ).toEqual({ count: 1 })
    expect(
      await test.d1
        .prepare(
          `SELECT candidate.twoFactorEnabled, count(factor.id) AS factorCount
           FROM user AS candidate
           LEFT JOIN twoFactor AS factor ON factor.userId = candidate.id
           WHERE candidate.id = ?1
           GROUP BY candidate.id`
        )
        .bind(operatorId)
        .first<{ twoFactorEnabled: number; factorCount: number }>()
    ).toEqual({ twoFactorEnabled: 1, factorCount: 1 })
  })
})
