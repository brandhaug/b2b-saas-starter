import {
  account,
  passkey,
  session,
  ssoRecoveryAuthEvidence,
  twoFactor,
  workspaceSsoConnections
} from '@b2b-saas-starter/db/schema'
import { Database } from '@b2b-saas-starter/db/service'
import { DateTime, Effect } from 'effect'
import * as TestClock from 'effect/testing/TestClock'
import { describe, expect, layer } from '@effect/vitest'
import { eq } from 'drizzle-orm'

import {
  inWorkspace,
  LIVE_SUITE_TIMEOUT,
  TestDatabase
} from '../testing/live-harness.ts'
import { failureTag } from '../internal/failure-tag.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import {
  liveWorkspaceContext,
  testWorkspaceContext,
  WorkspaceContext
} from '../workspace-context.ts'
import { AuditEventLog } from './audit-event-log.ts'
import { SsoPolicy } from './sso-policy.ts'

const grantedAt = '2026-09-07T12:00:00.000Z'

function setTime(iso: string) {
  return TestClock.setTime(DateTime.toEpochMillis(DateTime.makeUnsafe(iso)))
}

function date(iso: string): Date {
  return DateTime.toDate(DateTime.makeUnsafe(iso))
}

layer(TestDatabase, { timeout: LIVE_SUITE_TIMEOUT })(
  'live SSO recovery policy',
  (it) => {
    describe('bounded recovery', () => {
      it.effect('requires an existing owner and server-owned grant details', () =>
        inWorkspace(
          'live-lab',
          Effect.gen(function* () {
            yield* setTime(grantedAt)
            const policy = yield* SsoPolicy
            expect(
              failureTag(
                yield* Effect.exit(
                  policy.createRecoveryException({
                    workspaceId: 'wrk_live',
                    userId: 'usr_outsider',
                    grantedBy: 'operator@example.com',
                    reason: 'support-287'
                  })
                )
              )
            ).toBe('MembershipChangeRejected')
            expect(
              failureTag(
                yield* Effect.exit(
                  policy.createRecoveryException({
                    workspaceId: 'wrk_live',
                    userId: 'usr_owner',
                    grantedBy: '',
                    reason: 'support-287'
                  })
                )
              )
            ).toBe('MembershipChangeRejected')
          })
        )
      )

      it.effect(
        'activates only from post-grant proof of a previously enrolled passkey',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const db = yield* Database
              const policy = yield* SsoPolicy
              yield* setTime(grantedAt)
              yield* db.insert(passkey).values({
                id: 'passkey_recovery_old',
                name: 'Recovery key',
                publicKey: 'public-key',
                userId: 'usr_owner',
                credentialID: 'credential-recovery-old',
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
                createdAt: date('2026-09-07T11:00:00.000Z')
              })
              const grant = yield* policy.createRecoveryException({
                workspaceId: 'wrk_live',
                userId: 'usr_owner',
                grantedBy: 'operator@example.com',
                reason: 'verified support request 287'
              })
              expect(grant.expiresAt).toBe('2026-09-07T13:00:00.000Z')
              expect(
                yield* policy.hasActiveRecoveryException({
                  workspaceId: 'wrk_live',
                  userId: 'usr_owner',
                  sessionId: 'ses_sso_owner'
                })
              ).toBe(false)
              yield* db.insert(passkey).values({
                id: 'passkey_recovery_new',
                name: 'Late recovery key',
                publicKey: 'public-key-new',
                userId: 'usr_owner',
                credentialID: 'credential-recovery-new',
                counter: 0,
                deviceType: 'singleDevice',
                backedUp: false,
                createdAt: date(grantedAt)
              })
              yield* db.insert(ssoRecoveryAuthEvidence).values({
                sessionId: 'ses_sso_owner',
                userId: 'usr_owner',
                method: 'passkey',
                passkeyId: 'passkey_recovery_new',
                authenticatedAt: grantedAt
              })
              expect(
                failureTag(
                  yield* Effect.exit(
                    policy.useRecoveryException({
                      exceptionId: grant.id,
                      userId: 'usr_owner',
                      sessionId: 'ses_sso_owner'
                    })
                  )
                )
              ).toBe('MembershipChangeRejected')

              yield* db
                .update(ssoRecoveryAuthEvidence)
                .set({ passkeyId: 'passkey_recovery_old' })
                .where(eq(ssoRecoveryAuthEvidence.sessionId, 'ses_sso_owner'))
              const activated = yield* policy.useRecoveryException({
                exceptionId: grant.id,
                userId: 'usr_owner',
                sessionId: 'ses_sso_owner'
              })
              expect(activated.sessionId).toBe('ses_sso_owner')
              expect(activated.usedAt).toBe(grantedAt)
              expect(
                yield* policy.hasActiveRecoveryException({
                  workspaceId: 'wrk_live',
                  userId: 'usr_owner',
                  sessionId: 'ses_sso_owner'
                })
              ).toBe(true)

              yield* db
                .update(workspaceSsoConnections)
                .set({ requireSso: true })
                .where(eq(workspaceSsoConnections.id, 'sso_live_oidc'))
              const normal = yield* Effect.exit(
                Effect.provide(
                  Effect.void,
                  liveWorkspaceContext(
                    'live-lab',
                    { userId: 'usr_owner', sessionId: 'ses_sso_owner' },
                    'user'
                  )
                )
              )
              expect(normal._tag).toBe('Failure')
              const repairContext = yield* Effect.provide(
                WorkspaceContext,
                liveWorkspaceContext(
                  'live-lab',
                  { userId: 'usr_owner', sessionId: 'ses_sso_owner' },
                  'user',
                  'sso_repair'
                )
              )
              expect(repairContext.purpose).toBe('sso_repair')
            })
          )
      )

      it.effect(
        'accepts password plus MFA evidence, expires at one hour, and notifies owners once',
        () =>
          inWorkspace(
            'live-lab',
            Effect.gen(function* () {
              const db = yield* Database
              const policy = yield* SsoPolicy
              yield* setTime(grantedAt)
              yield* policy.flushRecoveryNotifications
              yield* db.insert(session).values({
                id: 'ses_recovery_password',
                token: 'recovery-password-session',
                userId: 'usr_owner',
                expiresAt: date('2026-09-08T12:00:00.000Z'),
                createdAt: date('2026-09-07T11:00:00.000Z'),
                updatedAt: date('2026-09-07T11:00:00.000Z')
              })
              yield* db.insert(account).values({
                id: 'acc_recovery_password',
                accountId: 'usr_owner',
                providerId: 'credential',
                issuer: 'credential',
                userId: 'usr_owner',
                password: 'hash',
                createdAt: date('2026-09-07T10:00:00.000Z'),
                updatedAt: date('2026-09-07T10:00:00.000Z')
              })
              yield* db.insert(twoFactor).values({
                id: '2fa_recovery_password',
                secret: 'encrypted',
                backupCodes: '[]',
                userId: 'usr_owner',
                verified: true,
                createdAt: date('2026-09-07T10:00:00.000Z'),
                updatedAt: date('2026-09-07T10:00:00.000Z')
              })
              const grant = yield* policy.createRecoveryException({
                workspaceId: 'wrk_live',
                userId: 'usr_owner',
                grantedBy: 'operator@example.com',
                reason: 'verified support request 288'
              })
              yield* db.insert(ssoRecoveryAuthEvidence).values({
                sessionId: 'ses_recovery_password',
                userId: 'usr_owner',
                method: 'password_mfa',
                passwordAccountId: 'acc_recovery_password',
                twoFactorId: '2fa_recovery_password',
                authenticatedAt: grantedAt
              })
              yield* setTime('2026-09-07T12:06:00.000Z')
              expect(
                failureTag(
                  yield* Effect.exit(
                    policy.useRecoveryException({
                      exceptionId: grant.id,
                      userId: 'usr_owner',
                      sessionId: 'ses_recovery_password'
                    })
                  )
                )
              ).toBe('MembershipChangeRejected')
              yield* db
                .update(ssoRecoveryAuthEvidence)
                .set({ authenticatedAt: '2026-09-07T12:06:00.000Z' })
                .where(eq(ssoRecoveryAuthEvidence.sessionId, 'ses_recovery_password'))
              yield* policy.useRecoveryException({
                exceptionId: grant.id,
                userId: 'usr_owner',
                sessionId: 'ses_recovery_password'
              })
              expect(yield* policy.flushRecoveryNotifications).toBe(2)
              expect(yield* policy.flushRecoveryNotifications).toBe(0)

              yield* setTime('2026-09-07T13:00:00.000Z')
              expect(
                yield* policy.hasActiveRecoveryException({
                  workspaceId: 'wrk_live',
                  userId: 'usr_owner',
                  sessionId: 'ses_recovery_password'
                })
              ).toBe(false)
              expect(yield* policy.expireRecoveryExceptions).toBeGreaterThanOrEqual(1)
              expect(yield* policy.flushRecoveryNotifications).toBeGreaterThanOrEqual(1)

              const audit = yield* AuditEventLog
              const recoveryAudits = yield* audit.list({
                eventType: 'workspace_sso.recovery_exception_created'
              })
              const grantAuditTypes = recoveryAudits.items
                .filter((event) => event.targetId === grant.id)
                .map((event) => event.eventType)
              const usedAudits = yield* audit.list({
                eventType: 'workspace_sso.recovery_exception_used'
              })
              const expiredAudits = yield* audit.list({
                eventType: 'workspace_sso.recovery_exception_expired'
              })
              grantAuditTypes.push(
                ...usedAudits.items
                  .filter((event) => event.targetId === grant.id)
                  .map((event) => event.eventType),
                ...expiredAudits.items
                  .filter((event) => event.targetId === grant.id)
                  .map((event) => event.eventType)
              )
              expect(grantAuditTypes.toSorted()).toEqual([
                'workspace_sso.recovery_exception_created',
                'workspace_sso.recovery_exception_expired',
                'workspace_sso.recovery_exception_used'
              ])
              const feed = yield* NotificationFeed
              const ownerNotices = yield* Effect.provide(
                feed.list,
                testWorkspaceContext(
                  {
                    id: 'wrk_live',
                    slug: 'live-lab',
                    name: 'Live Lab',
                    planId: 'starter'
                  },
                  { userId: 'usr_owner', role: 'owner', systemRole: 'user' },
                  'user',
                  'ses_recovery_password'
                )
              )
              const actions = ownerNotices.flatMap((notice) => {
                const event = notice.event
                if (event?.type !== 'sso.recovery' || event.exceptionId !== grant.id) {
                  return []
                }
                return [event.action]
              })
              expect(actions.toSorted()).toEqual(['created', 'expired', 'used'])
            })
          )
      )
    })
  }
)
