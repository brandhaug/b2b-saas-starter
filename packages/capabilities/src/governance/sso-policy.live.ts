import { Database, RawD1, batch } from '@b2b-saas-starter/db/service'
import {
  account,
  passkey,
  session,
  ssoRecoveryAuthEvidence,
  twoFactor,
  workspaceMembers,
  workspaceSsoAuthProofs,
  workspaceSsoRecoveryExceptions
} from '@b2b-saas-starter/db/schema'
import { and, eq, exists, gt, gte, isNotNull, isNull, lte, or, sql } from 'drizzle-orm'
import { DateTime, Effect, Layer } from 'effect'

import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  acceptsSsoProof,
  hasRecentAuthentication,
  proofExpiry,
  recoveryExpiry,
  requireRecentAuthentication,
  SsoPolicy,
  type SsoPolicyInterface,
  type SsoPolicyOptions,
  type SsoRecoveryException,
  type SsoRecoveryNotificationAction
} from './sso-policy.ts'

type RecoveryRow = typeof workspaceSsoRecoveryExceptions.$inferSelect
type RecoveryNotification = {
  readonly title: string
  readonly message: string
  readonly event: {
    readonly type: 'sso.recovery'
    readonly exceptionId: string
    readonly action: SsoRecoveryNotificationAction
    readonly ownerUserId: string
    readonly expiresAt: string
  }
}
const RECOVERY_NOTIFICATION_ACTIONS: ReadonlyArray<SsoRecoveryNotificationAction> = [
  'created',
  'used',
  'expired'
]

function toRecoveryException(row: RecoveryRow): SsoRecoveryException {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    userId: row.userId,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    expiredAt: row.expiredAt,
    sessionId: row.sessionId
  }
}

function notificationCopy(
  row: RecoveryRow,
  action: SsoRecoveryNotificationAction
): RecoveryNotification {
  let actionText = 'expired'
  if (action === 'created') {
    actionText = 'was granted'
  } else if (action === 'used') {
    actionText = 'was activated'
  }
  return {
    title: 'SSO recovery exception',
    message: `Recovery exception ${row.id} ${actionText} for workspace owner ${row.userId}.`,
    event: {
      type: 'sso.recovery',
      exceptionId: row.id,
      action,
      ownerUserId: row.userId,
      expiresAt: row.expiresAt
    }
  }
}

function notificationPending(row: RecoveryRow, action: SsoRecoveryNotificationAction) {
  switch (action) {
    case 'created': {
      return row.createdNotifiedAt === null
    }
    case 'used': {
      return row.usedAt !== null && row.usedNotifiedAt === null
    }
    case 'expired': {
      return row.expiredAt !== null && row.expiredNotifiedAt === null
    }
  }
}

function notifiedUpdate(action: SsoRecoveryNotificationAction, now: string) {
  switch (action) {
    case 'created': {
      return { createdNotifiedAt: now }
    }
    case 'used': {
      return { usedNotifiedAt: now }
    }
    case 'expired': {
      return { expiredNotifiedAt: now }
    }
  }
}

/** D1 implementation of authoritative SSO proof and bounded owner recovery. */
export function LiveSsoPolicy(
  options: SsoPolicyOptions = {}
): Layer.Layer<SsoPolicy, never, Database | RawD1 | AuditEventLog | NotificationFeed> {
  return Layer.effect(SsoPolicy)(
    Effect.gen(function* () {
      const db = yield* Database
      const d1 = yield* RawD1
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed
      const unavailable = orUnavailable('sso-policy')
      function runBatch(statements: Parameters<typeof batch>[0]) {
        return unavailable(batch(statements)).pipe(Effect.provideService(RawD1, d1))
      }

      const expireOne = Effect.fn('SsoPolicy.Live.expireOne')(function* (
        row: RecoveryRow,
        now: string
      ) {
        if (row.expiredAt !== null || row.expiresAt > now) {
          return false
        }
        const stillExpired = exists(
          db
            .select({ value: sql`1` })
            .from(workspaceSsoRecoveryExceptions)
            .where(
              and(
                eq(workspaceSsoRecoveryExceptions.id, row.id),
                isNull(workspaceSsoRecoveryExceptions.expiredAt),
                lte(workspaceSsoRecoveryExceptions.expiresAt, now)
              )
            )
        )
        const auditStatement = yield* audit.prepareRecord(
          {
            workspaceId: row.workspaceId,
            actorUserId: null,
            actorType: 'system',
            eventType: 'workspace_sso.recovery_exception_expired',
            targetType: 'workspace_sso_recovery_exception',
            targetId: row.id,
            metadata: { ownerUserId: row.userId }
          },
          stillExpired
        )
        yield* runBatch([
          auditStatement,
          db
            .update(workspaceSsoRecoveryExceptions)
            .set({ expiredAt: now })
            .where(
              and(
                eq(workspaceSsoRecoveryExceptions.id, row.id),
                isNull(workspaceSsoRecoveryExceptions.expiredAt),
                lte(workspaceSsoRecoveryExceptions.expiresAt, now)
              )
            )
        ])
        return true
      })

      const hasQualifyingEvidence = Effect.fn('SsoPolicy.Live.hasQualifyingEvidence')(
        function* (
          row: RecoveryRow,
          userId: string,
          sessionId: string,
          now: string,
          nowDate: Date
        ) {
          const [found] = yield* unavailable(
            db
              .select({
                method: ssoRecoveryAuthEvidence.method,
                authenticatedAt: ssoRecoveryAuthEvidence.authenticatedAt,
                passkeyId: ssoRecoveryAuthEvidence.passkeyId,
                passkeyCreatedAt: passkey.createdAt,
                passwordAccountId: ssoRecoveryAuthEvidence.passwordAccountId,
                passwordCreatedAt: account.createdAt,
                passwordProviderId: account.providerId,
                twoFactorId: ssoRecoveryAuthEvidence.twoFactorId,
                twoFactorCreatedAt: twoFactor.createdAt,
                twoFactorVerified: twoFactor.verified
              })
              .from(ssoRecoveryAuthEvidence)
              .innerJoin(
                session,
                and(
                  eq(session.id, ssoRecoveryAuthEvidence.sessionId),
                  eq(session.userId, ssoRecoveryAuthEvidence.userId),
                  gt(session.expiresAt, nowDate),
                  isNull(session.impersonatedBy)
                )
              )
              .leftJoin(
                passkey,
                and(
                  eq(passkey.id, ssoRecoveryAuthEvidence.passkeyId),
                  eq(passkey.userId, ssoRecoveryAuthEvidence.userId)
                )
              )
              .leftJoin(
                account,
                and(
                  eq(account.id, ssoRecoveryAuthEvidence.passwordAccountId),
                  eq(account.userId, ssoRecoveryAuthEvidence.userId)
                )
              )
              .leftJoin(
                twoFactor,
                and(
                  eq(twoFactor.id, ssoRecoveryAuthEvidence.twoFactorId),
                  eq(twoFactor.userId, ssoRecoveryAuthEvidence.userId)
                )
              )
              .where(
                and(
                  eq(ssoRecoveryAuthEvidence.sessionId, sessionId),
                  eq(ssoRecoveryAuthEvidence.userId, userId),
                  gte(ssoRecoveryAuthEvidence.authenticatedAt, row.createdAt),
                  lte(ssoRecoveryAuthEvidence.authenticatedAt, now)
                )
              )
              .limit(1)
          )
          if (found === undefined) {
            return false
          }
          if (
            !hasRecentAuthentication(
              found.authenticatedAt,
              now,
              options.configurationAuthRecencyMs
            )
          ) {
            return false
          }
          if (found.method === 'passkey') {
            return (
              found.passkeyId !== null &&
              found.passkeyCreatedAt !== null &&
              found.passkeyCreatedAt.toISOString() < row.createdAt
            )
          }
          return (
            found.passwordAccountId !== null &&
            found.passwordProviderId === 'credential' &&
            found.passwordCreatedAt !== null &&
            found.passwordCreatedAt.toISOString() < row.createdAt &&
            found.twoFactorId !== null &&
            found.twoFactorVerified === true &&
            found.twoFactorCreatedAt !== null &&
            found.twoFactorCreatedAt.toISOString() < row.createdAt
          )
        }
      )

      const service: SsoPolicyInterface = {
        recordAuthenticationProof: Effect.fn('SsoPolicy.Live.recordProof')(
          function* (input) {
            const id = yield* newCapabilityId('sso-proof')
            const proof = {
              ...input,
              id,
              expiresAt: proofExpiry(input.authenticatedAt, options.proofTtlMs)
            }
            yield* unavailable(
              db
                .insert(workspaceSsoAuthProofs)
                .values({ ...proof, createdAt: input.authenticatedAt })
                .onConflictDoUpdate({
                  target: [
                    workspaceSsoAuthProofs.sessionId,
                    workspaceSsoAuthProofs.workspaceId
                  ],
                  set: {
                    userId: proof.userId,
                    providerId: proof.providerId,
                    connectionGeneration: proof.connectionGeneration,
                    authenticatedAt: proof.authenticatedAt,
                    expiresAt: proof.expiresAt
                  }
                })
            )
            return proof
          }
        ),
        checkAuthenticationProof: Effect.fn('SsoPolicy.Live.checkProof')(
          function* (check) {
            const [row] = yield* unavailable(
              db
                .select()
                .from(workspaceSsoAuthProofs)
                .where(
                  and(
                    eq(workspaceSsoAuthProofs.workspaceId, check.workspaceId),
                    eq(workspaceSsoAuthProofs.userId, check.userId),
                    eq(workspaceSsoAuthProofs.sessionId, check.sessionId),
                    eq(workspaceSsoAuthProofs.providerId, check.providerId),
                    gt(workspaceSsoAuthProofs.expiresAt, check.now)
                  )
                )
                .limit(1)
            )
            return row !== undefined && acceptsSsoProof(row, check)
          }
        ),
        requireRecentAuthentication: (input) =>
          requireRecentAuthentication(input, options.configurationAuthRecencyMs),
        createRecoveryException: Effect.fn('SsoPolicy.Live.createRecovery')(
          function* (input) {
            const [owner] = yield* unavailable(
              db
                .select({ id: workspaceMembers.id })
                .from(workspaceMembers)
                .where(
                  and(
                    eq(workspaceMembers.workspaceId, input.workspaceId),
                    eq(workspaceMembers.userId, input.userId),
                    eq(workspaceMembers.role, 'owner')
                  )
                )
                .limit(1)
            )
            if (owner === undefined) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'owner_required' })
              )
            }
            if (input.grantedBy.trim() === '' || input.reason.trim() === '') {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'recovery_grant_details_required'
                })
              )
            }
            const now = DateTime.formatIso(yield* DateTime.now)
            const id = yield* newCapabilityId('sso-recovery')
            const row: RecoveryRow = {
              id,
              ...input,
              createdAt: now,
              expiresAt: recoveryExpiry(now),
              usedAt: null,
              expiredAt: null,
              sessionId: null,
              createdNotifiedAt: null,
              usedNotifiedAt: null,
              expiredNotifiedAt: null
            }
            const auditStatement = yield* audit.prepareRecord({
              workspaceId: row.workspaceId,
              actorUserId: null,
              actorType: 'system',
              eventType: 'workspace_sso.recovery_exception_created',
              targetType: 'workspace_sso_recovery_exception',
              targetId: row.id,
              metadata: {
                ownerUserId: row.userId,
                grantedBy: row.grantedBy,
                reason: row.reason,
                expiresAt: row.expiresAt
              }
            })
            yield* runBatch([
              db.insert(workspaceSsoRecoveryExceptions).values(row),
              auditStatement
            ])
            return toRecoveryException(row)
          }
        ),
        useRecoveryException: Effect.fn('SsoPolicy.Live.useRecovery')(
          function* (input) {
            const [row] = yield* unavailable(
              db
                .select()
                .from(workspaceSsoRecoveryExceptions)
                .where(
                  and(
                    eq(workspaceSsoRecoveryExceptions.id, input.exceptionId),
                    eq(workspaceSsoRecoveryExceptions.userId, input.userId)
                  )
                )
                .limit(1)
            )
            if (row === undefined) {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'recovery_exception_not_found'
                })
              )
            }
            const nowDateTime = yield* DateTime.now
            const now = DateTime.formatIso(nowDateTime)
            yield* expireOne(row, now)
            if (row.expiredAt !== null || row.expiresAt <= now) {
              return yield* Effect.fail(
                new MembershipChangeRejected({ reason: 'recovery_exception_expired' })
              )
            }
            if (row.usedAt !== null) {
              if (row.sessionId === input.sessionId) {
                return toRecoveryException(row)
              }
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'recovery_exception_already_used'
                })
              )
            }
            if (
              !(yield* hasQualifyingEvidence(
                row,
                input.userId,
                input.sessionId,
                now,
                DateTime.toDate(nowDateTime)
              ))
            ) {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'independent_authentication_required'
                })
              )
            }
            const stillUnused = exists(
              db
                .select({ value: sql`1` })
                .from(workspaceSsoRecoveryExceptions)
                .where(
                  and(
                    eq(workspaceSsoRecoveryExceptions.id, row.id),
                    isNull(workspaceSsoRecoveryExceptions.usedAt),
                    isNull(workspaceSsoRecoveryExceptions.expiredAt),
                    gt(workspaceSsoRecoveryExceptions.expiresAt, now)
                  )
                )
            )
            const auditStatement = yield* audit.prepareRecord(
              {
                workspaceId: row.workspaceId,
                actorUserId: row.userId,
                actorType: 'user',
                eventType: 'workspace_sso.recovery_exception_used',
                targetType: 'workspace_sso_recovery_exception',
                targetId: row.id,
                metadata: { sessionId: input.sessionId }
              },
              stillUnused
            )
            yield* runBatch([
              auditStatement,
              db
                .update(workspaceSsoRecoveryExceptions)
                .set({ usedAt: now, sessionId: input.sessionId })
                .where(
                  and(
                    eq(workspaceSsoRecoveryExceptions.id, row.id),
                    isNull(workspaceSsoRecoveryExceptions.usedAt),
                    isNull(workspaceSsoRecoveryExceptions.expiredAt),
                    gt(workspaceSsoRecoveryExceptions.expiresAt, now)
                  )
                )
            ])
            const [activated] = yield* unavailable(
              db
                .select()
                .from(workspaceSsoRecoveryExceptions)
                .where(
                  and(
                    eq(workspaceSsoRecoveryExceptions.id, row.id),
                    eq(workspaceSsoRecoveryExceptions.sessionId, input.sessionId),
                    gt(workspaceSsoRecoveryExceptions.expiresAt, now),
                    isNull(workspaceSsoRecoveryExceptions.expiredAt)
                  )
                )
                .limit(1)
            )
            if (activated === undefined) {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'recovery_exception_already_used'
                })
              )
            }
            return toRecoveryException(activated)
          }
        ),
        hasActiveRecoveryException: Effect.fn('SsoPolicy.Live.hasActiveRecovery')(
          function* (input) {
            const nowDateTime = yield* DateTime.now
            const now = DateTime.formatIso(nowDateTime)
            const [row] = yield* unavailable(
              db
                .select({ id: workspaceSsoRecoveryExceptions.id })
                .from(workspaceSsoRecoveryExceptions)
                .innerJoin(
                  session,
                  and(
                    eq(session.id, workspaceSsoRecoveryExceptions.sessionId),
                    eq(session.userId, workspaceSsoRecoveryExceptions.userId),
                    gt(session.expiresAt, DateTime.toDate(nowDateTime)),
                    isNull(session.impersonatedBy)
                  )
                )
                .where(
                  and(
                    eq(workspaceSsoRecoveryExceptions.workspaceId, input.workspaceId),
                    eq(workspaceSsoRecoveryExceptions.userId, input.userId),
                    eq(workspaceSsoRecoveryExceptions.sessionId, input.sessionId),
                    gt(workspaceSsoRecoveryExceptions.expiresAt, now),
                    isNull(workspaceSsoRecoveryExceptions.expiredAt),
                    isNotNull(workspaceSsoRecoveryExceptions.usedAt)
                  )
                )
                .limit(1)
            )
            return row !== undefined
          }
        ),
        expireRecoveryExceptions: Effect.fn('SsoPolicy.Live.expireRecoveries')(
          function* () {
            const now = DateTime.formatIso(yield* DateTime.now)
            const rows = yield* unavailable(
              db
                .select()
                .from(workspaceSsoRecoveryExceptions)
                .where(
                  and(
                    isNull(workspaceSsoRecoveryExceptions.expiredAt),
                    lte(workspaceSsoRecoveryExceptions.expiresAt, now)
                  )
                )
            )
            let count = 0
            for (const row of rows) {
              if (yield* expireOne(row, now)) {
                count += 1
              }
            }
            return count
          }
        )(),
        flushRecoveryNotifications: Effect.fn(
          'SsoPolicy.Live.flushRecoveryNotifications'
        )(function* () {
          const rows = yield* unavailable(
            db
              .select()
              .from(workspaceSsoRecoveryExceptions)
              .where(
                or(
                  isNull(workspaceSsoRecoveryExceptions.createdNotifiedAt),
                  and(
                    isNotNull(workspaceSsoRecoveryExceptions.usedAt),
                    isNull(workspaceSsoRecoveryExceptions.usedNotifiedAt)
                  ),
                  and(
                    isNotNull(workspaceSsoRecoveryExceptions.expiredAt),
                    isNull(workspaceSsoRecoveryExceptions.expiredNotifiedAt)
                  )
                )
              )
          )
          let count = 0
          for (const row of rows) {
            for (const action of RECOVERY_NOTIFICATION_ACTIONS) {
              if (!notificationPending(row, action)) {
                continue
              }
              yield* feed.notifyWorkspaceOwners({
                workspaceId: row.workspaceId,
                deduplicationKey: `${row.id}:${action}`,
                kind: 'sso.recovery',
                ...notificationCopy(row, action)
              })
              const notifiedAt = DateTime.formatIso(yield* DateTime.now)
              yield* unavailable(
                db
                  .update(workspaceSsoRecoveryExceptions)
                  .set(notifiedUpdate(action, notifiedAt))
                  .where(eq(workspaceSsoRecoveryExceptions.id, row.id))
              )
              count += 1
            }
          }
          return count
        })()
      }
      return SsoPolicy.of(service)
    })
  )
}
