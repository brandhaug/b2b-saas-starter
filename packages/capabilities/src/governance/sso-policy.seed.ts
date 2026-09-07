import { DateTime, Effect, Layer } from 'effect'

import { MembershipChangeRejected } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { NotificationFeed } from '../notifications/notification-feed.ts'
import { AuditEventLog } from './audit-event-log.ts'
import {
  acceptsSsoProof,
  hasRecentAuthentication,
  proofExpiry,
  recoveryExpiry,
  requireRecentAuthentication,
  SsoPolicy,
  type SsoProof,
  type SsoPolicyOptions,
  type SsoRecoveryException,
  type SsoRecoveryNotificationAction
} from './sso-policy.ts'

export type SeedSsoRecoveryEvidence = {
  readonly userId: string
  readonly sessionId: string
  readonly method: 'passkey' | 'password_mfa'
  readonly enrolledAt: string
  readonly authenticatedAt: string
}

export type SeedSsoPolicyOptions = SsoPolicyOptions & {
  readonly ownerUserIds?: ReadonlyArray<string>
  readonly recoveryEvidence?: ReadonlyArray<SeedSsoRecoveryEvidence>
}

type RecoveryRow = {
  readonly id: string
  readonly workspaceId: string
  readonly userId: string
  readonly reason: string
  readonly grantedBy: string
  readonly createdAt: string
  readonly expiresAt: string
  usedAt: string | null
  expiredAt: string | null
  sessionId: string | null
  createdNotifiedAt: string | null
  usedNotifiedAt: string | null
  expiredNotifiedAt: string | null
}
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

function wasNotified(row: RecoveryRow, action: SsoRecoveryNotificationAction): boolean {
  switch (action) {
    case 'created': {
      return row.createdNotifiedAt !== null
    }
    case 'used': {
      return row.usedNotifiedAt !== null
    }
    case 'expired': {
      return row.expiredNotifiedAt !== null
    }
  }
}

function markNotified(
  row: RecoveryRow,
  action: SsoRecoveryNotificationAction,
  now: string
): void {
  switch (action) {
    case 'created': {
      row.createdNotifiedAt = now
      return
    }
    case 'used': {
      row.usedNotifiedAt = now
      return
    }
    case 'expired': {
      row.expiredNotifiedAt = now
    }
  }
}

export function SeedSsoPolicy(
  options: SeedSsoPolicyOptions = {}
): Layer.Layer<SsoPolicy, never, AuditEventLog | NotificationFeed> {
  const proofs = new Map<string, SsoProof>()
  const recovery = new Map<string, RecoveryRow>()
  const owners = new Set(options.ownerUserIds ?? [])
  const evidence = options.recoveryEvidence ?? []

  return Layer.effect(SsoPolicy)(
    Effect.gen(function* () {
      const audit = yield* AuditEventLog
      const feed = yield* NotificationFeed

      const expireOne = Effect.fn('SsoPolicy.Seed.expireOne')(function* (
        row: RecoveryRow,
        now: string
      ) {
        if (row.expiredAt !== null || row.expiresAt > now) {
          return false
        }
        row.expiredAt = now
        yield* audit.record({
          workspaceId: row.workspaceId,
          actorUserId: null,
          actorType: 'system',
          eventType: 'workspace_sso.recovery_exception_expired',
          targetType: 'workspace_sso_recovery_exception',
          targetId: row.id,
          metadata: { ownerUserId: row.userId }
        })
        return true
      })

      const flushOne = Effect.fn('SsoPolicy.Seed.flushOne')(function* (
        row: RecoveryRow,
        action: SsoRecoveryNotificationAction,
        now: string
      ) {
        if (wasNotified(row, action)) {
          return false
        }
        if (action === 'used' && row.usedAt === null) {
          return false
        }
        if (action === 'expired' && row.expiredAt === null) {
          return false
        }
        yield* feed.notifyWorkspaceOwners({
          workspaceId: row.workspaceId,
          deduplicationKey: `${row.id}:${action}`,
          kind: 'sso.recovery',
          ...notificationCopy(row, action)
        })
        markNotified(row, action, now)
        return true
      })

      return SsoPolicy.of({
        recordAuthenticationProof: Effect.fn('SsoPolicy.Seed.recordProof')(
          function* (input) {
            const proof = {
              ...input,
              id: yield* newCapabilityId('seed-sso-proof'),
              expiresAt: proofExpiry(input.authenticatedAt, options.proofTtlMs)
            }
            proofs.set(`${input.workspaceId}:${input.sessionId}`, proof)
            return proof
          }
        ),
        checkAuthenticationProof: Effect.fn('SsoPolicy.Seed.checkProof')((input) => {
          const proof = proofs.get(`${input.workspaceId}:${input.sessionId}`)
          return Effect.succeed(proof !== undefined && acceptsSsoProof(proof, input))
        }),
        requireRecentAuthentication: (input) =>
          requireRecentAuthentication(input, options.configurationAuthRecencyMs),
        createRecoveryException: Effect.fn('SsoPolicy.Seed.createRecovery')(
          function* (input) {
            if (!owners.has(input.userId)) {
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
            const row: RecoveryRow = {
              id: yield* newCapabilityId('seed-sso-recovery'),
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
            recovery.set(row.id, row)
            yield* audit.record({
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
            return toRecoveryException(row)
          }
        ),
        useRecoveryException: Effect.fn('SsoPolicy.Seed.useRecovery')(
          function* (input) {
            const row = recovery.get(input.exceptionId)
            const now = DateTime.formatIso(yield* DateTime.now)
            if (row === undefined || row.userId !== input.userId) {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'recovery_exception_not_found'
                })
              )
            }
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
            const qualifying = evidence.some(
              (candidate) =>
                candidate.userId === input.userId &&
                candidate.sessionId === input.sessionId &&
                candidate.enrolledAt < row.createdAt &&
                candidate.authenticatedAt >= row.createdAt &&
                candidate.authenticatedAt <= now &&
                hasRecentAuthentication(
                  candidate.authenticatedAt,
                  now,
                  options.configurationAuthRecencyMs
                )
            )
            if (!qualifying) {
              return yield* Effect.fail(
                new MembershipChangeRejected({
                  reason: 'independent_authentication_required'
                })
              )
            }
            row.usedAt = now
            row.sessionId = input.sessionId
            yield* audit.record({
              workspaceId: row.workspaceId,
              actorUserId: row.userId,
              actorType: 'user',
              eventType: 'workspace_sso.recovery_exception_used',
              targetType: 'workspace_sso_recovery_exception',
              targetId: row.id,
              metadata: { sessionId: input.sessionId }
            })
            return toRecoveryException(row)
          }
        ),
        hasActiveRecoveryException: Effect.fn('SsoPolicy.Seed.hasActiveRecovery')(
          function* (input) {
            const now = DateTime.formatIso(yield* DateTime.now)
            return [...recovery.values()].some(
              (row) =>
                row.workspaceId === input.workspaceId &&
                row.userId === input.userId &&
                row.sessionId === input.sessionId &&
                row.usedAt !== null &&
                row.expiredAt === null &&
                row.expiresAt > now
            )
          }
        ),
        expireRecoveryExceptions: Effect.fn('SsoPolicy.Seed.expireRecoveries')(
          function* () {
            const now = DateTime.formatIso(yield* DateTime.now)
            let count = 0
            for (const row of recovery.values()) {
              if (yield* expireOne(row, now)) {
                count += 1
              }
            }
            return count
          }
        )(),
        flushRecoveryNotifications: Effect.fn(
          'SsoPolicy.Seed.flushRecoveryNotifications'
        )(function* () {
          const now = DateTime.formatIso(yield* DateTime.now)
          let count = 0
          for (const row of recovery.values()) {
            for (const action of RECOVERY_NOTIFICATION_ACTIONS) {
              if (yield* flushOne(row, action, now)) {
                count += 1
              }
            }
          }
          return count
        })()
      })
    })
  )
}
