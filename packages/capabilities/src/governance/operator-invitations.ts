import { Context, Effect, Layer } from 'effect'
import { and, eq, gt, isNull } from 'drizzle-orm'
import type { Database } from '@b2b-saas-starter/db/client'
import {
  auditEvents,
  operatorEnrollments,
  operatorInvitations,
  twoFactor,
  user
} from '@b2b-saas-starter/db'
import {
  authorizeOperatorSession,
  hasOperatorPermission,
  operatorRoleNames,
  type OperatorRole,
  type OperatorSessionReference
} from './operations-contracts.ts'

const invitationLifetimeMs = 24 * 60 * 60_000
const enrollmentLifetimeMs = 30 * 60_000

export class OperatorInvitationDenied extends Error {
  readonly _tag = 'OperatorInvitationDenied'
}

export type InviteOperatorInput = {
  readonly actor: OperatorSessionReference
  readonly email: string
  readonly roles: readonly string[]
  readonly tokenHash: string
}

export type OperatorInvitationResult = {
  readonly id: string
  readonly email: string
  readonly roles: readonly OperatorRole[]
  readonly expiresAt: Date
}

export type AcceptOperatorInvitationInput = {
  readonly tokenHash: string
  readonly enrollmentTokenHash: string
  readonly name: string
  readonly passwordHash: string
}

export type OperatorEnrollmentResult = {
  readonly invitationId: string
  readonly operatorId: string
  readonly expiresAt: Date
}

export type OperatorEnrollmentState = {
  readonly operatorId: string
  readonly email: string
  readonly expiresAt: Date
  readonly totpConfigured: boolean
}

type OperatorInvitationsShape = {
  readonly invite: (
    input: InviteOperatorInput,
    now?: Date
  ) => Effect.Effect<OperatorInvitationResult, OperatorInvitationDenied>
  readonly revoke: (
    input: {
      readonly actor: OperatorSessionReference
      readonly invitationId: string
    },
    now?: Date
  ) => Effect.Effect<void, OperatorInvitationDenied>
  readonly accept: (
    input: AcceptOperatorInvitationInput,
    now?: Date
  ) => Effect.Effect<OperatorEnrollmentResult, OperatorInvitationDenied>
  readonly resume: (
    input: { readonly operatorId: string; readonly enrollmentTokenHash: string },
    now?: Date
  ) => Effect.Effect<OperatorEnrollmentResult, OperatorInvitationDenied>
  readonly inspect: (
    input: { readonly enrollmentTokenHash: string },
    now?: Date
  ) => Effect.Effect<OperatorEnrollmentState, OperatorInvitationDenied>
  readonly complete: (
    input: { readonly enrollmentTokenHash: string },
    now?: Date
  ) => Effect.Effect<void, OperatorInvitationDenied>
}

export class OperatorInvitations extends Context.Service<
  OperatorInvitations,
  OperatorInvitationsShape
>()('@b2b-saas-starter/capabilities/OperatorInvitations') {}

const normalizedRoles = (values: readonly string[]): readonly OperatorRole[] => [
  ...new Set(
    values.filter((value): value is OperatorRole =>
      operatorRoleNames.includes(value as OperatorRole)
    )
  )
]

const sessionEpoch = (date: Date): number => Math.floor(date.getTime() / 1_000)

export const makeOperatorInvitationsLayer = (
  db: Database
): Layer.Layer<OperatorInvitations> => {
  const raw = db.$client

  const audit = async (input: {
    readonly eventType: string
    readonly actorUserId?: string | null
    readonly targetId?: string | null
    readonly result: 'accepted' | 'rejected'
    readonly at: Date
    readonly metadata?: Record<string, unknown>
  }) => {
    await db.insert(auditEvents).values({
      id: `aud_${crypto.randomUUID()}`,
      actorUserId: input.actorUserId ?? null,
      eventType: input.eventType,
      targetType: 'system_operator',
      targetId: input.targetId ?? null,
      metadata: { result: input.result, ...input.metadata },
      createdAt: input.at.toISOString()
    })
  }

  const managerFor = async (reference: OperatorSessionReference, now: Date) => {
    const actor = await Effect.runPromise(authorizeOperatorSession(db, reference, now))
    if (!hasOperatorPermission(actor.roles, 'operator:manage')) {
      throw new OperatorInvitationDenied('operator manager permission is required')
    }
    return actor
  }

  const service: OperatorInvitationsShape = {
    invite: (input, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const actor = await managerFor(input.actor, now)
          const email = input.email.trim().toLowerCase()
          const roles = normalizedRoles(input.roles)
          if (
            !email ||
            roles.length === 0 ||
            roles.length !== new Set(input.roles).size
          ) {
            await audit({
              eventType: 'operator.invitation.creation-rejected',
              actorUserId: actor.id,
              result: 'rejected',
              at: now
            })
            throw new OperatorInvitationDenied('accepted operator role is required')
          }
          const [collision] = await db
            .select({ id: user.id })
            .from(user)
            .where(eq(user.email, email))
            .limit(1)
          if (collision) {
            await audit({
              eventType: 'operator.invitation.creation-rejected',
              actorUserId: actor.id,
              targetId: collision.id,
              result: 'rejected',
              at: now
            })
            throw new OperatorInvitationDenied('identity already exists')
          }
          const [active] = await db
            .select({ id: operatorInvitations.id })
            .from(operatorInvitations)
            .where(
              and(
                eq(operatorInvitations.email, email),
                isNull(operatorInvitations.revokedAt),
                isNull(operatorInvitations.acceptedAt),
                gt(operatorInvitations.expiresAt, now)
              )
            )
            .limit(1)
          if (active) throw new OperatorInvitationDenied('active invitation exists')
          const id = `oinv_${crypto.randomUUID()}`
          const expiresAt = new Date(now.getTime() + invitationLifetimeMs)
          await db.batch([
            db.insert(operatorInvitations).values({
              id,
              email,
              rolesJson: roles,
              tokenHash: input.tokenHash,
              invitedByOperatorId: actor.id,
              expiresAt,
              createdAt: now,
              updatedAt: now
            }),
            db.insert(auditEvents).values({
              id: `aud_${crypto.randomUUID()}`,
              actorUserId: actor.id,
              eventType: 'operator.invitation.created',
              targetType: 'operator_invitation',
              targetId: id,
              metadata: { result: 'accepted', email, roles },
              createdAt: now.toISOString()
            })
          ])
          return { id, email, roles, expiresAt }
        },
        catch: (error) =>
          error instanceof OperatorInvitationDenied
            ? error
            : new OperatorInvitationDenied('operator invitation could not be created')
      }),
    revoke: (input, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const actor = await managerFor(input.actor, now)
          const result = await db
            .update(operatorInvitations)
            .set({ revokedAt: now, updatedAt: now })
            .where(
              and(
                eq(operatorInvitations.id, input.invitationId),
                isNull(operatorInvitations.revokedAt),
                isNull(operatorInvitations.acceptedAt),
                gt(operatorInvitations.expiresAt, now)
              )
            )
          if (!result.meta.changes)
            throw new OperatorInvitationDenied('invitation is unavailable')
          await audit({
            eventType: 'operator.invitation.revoked',
            actorUserId: actor.id,
            targetId: input.invitationId,
            result: 'accepted',
            at: now
          })
        },
        catch: (error) =>
          error instanceof OperatorInvitationDenied
            ? error
            : new OperatorInvitationDenied('operator invitation could not be revoked')
      }),
    accept: (input, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const invitation = await db
            .select()
            .from(operatorInvitations)
            .where(eq(operatorInvitations.tokenHash, input.tokenHash))
            .limit(1)
            .then((rows) => rows[0])
          if (
            !invitation ||
            invitation.revokedAt ||
            invitation.acceptedAt ||
            invitation.expiresAt <= now
          ) {
            if (invitation?.expiresAt && invitation.expiresAt <= now) {
              await audit({
                eventType: 'operator.invitation.expired',
                targetId: invitation.id,
                result: 'rejected',
                at: now
              })
            }
            await audit({
              eventType: 'operator.invitation.acceptance-rejected',
              targetId: invitation?.id ?? null,
              result: 'rejected',
              at: now
            })
            throw new OperatorInvitationDenied('invitation is unavailable')
          }
          const operatorId = `opr_${crypto.randomUUID()}`
          const enrollmentId = `oenr_${crypto.randomUUID()}`
          const acceptedEpoch = sessionEpoch(now)
          const expiresAt = new Date(now.getTime() + enrollmentLifetimeMs)
          const results = await raw.batch([
            raw
              .prepare(
                `UPDATE operator_invitations
                 SET accepted_operator_id = ?1, accepted_at = ?2, updatedAt = ?2
                 WHERE id = ?3 AND accepted_operator_id IS NULL AND accepted_at IS NULL
                   AND revoked_at IS NULL AND expires_at > ?2`
              )
              .bind(operatorId, acceptedEpoch, invitation.id),
            raw
              .prepare(
                `INSERT INTO user (
                   id, email, name, emailVerified, role, identityClass,
                   twoFactorEnabled, banned, createdAt, updatedAt
                 )
                 SELECT accepted_operator_id, email, ?1, 1,
                        (SELECT group_concat(value, ',') FROM json_each(roles_json)),
                        'system_operator', 0, 0, ?2, ?2
                 FROM operator_invitations
                 WHERE id = ?3 AND accepted_operator_id = ?4 AND accepted_at = ?2`
              )
              .bind(input.name.trim(), acceptedEpoch, invitation.id, operatorId),
            raw
              .prepare(
                `INSERT INTO account (
                   id, accountId, providerId, userId, password, createdAt, updatedAt
                 )
                 SELECT ?1, id, 'credential', id, ?2, ?3, ?3
                 FROM user WHERE id = ?4`
              )
              .bind(
                `credential_${operatorId}`,
                input.passwordHash,
                acceptedEpoch,
                operatorId
              ),
            raw
              .prepare(
                `INSERT INTO operator_enrollments (
                   id, invitation_id, operator_id, session_token_hash,
                   session_expires_at, password_set_at, email_verified_at,
                   createdAt, updatedAt
                 )
                 SELECT ?1, id, accepted_operator_id, ?2, ?3, ?4, ?4, ?4, ?4
                 FROM operator_invitations
                 WHERE id = ?5 AND accepted_operator_id = ?6 AND accepted_at = ?4`
              )
              .bind(
                enrollmentId,
                input.enrollmentTokenHash,
                sessionEpoch(expiresAt),
                acceptedEpoch,
                invitation.id,
                operatorId
              ),
            raw
              .prepare(
                `INSERT INTO audit_events (
                   id, actor_user_id, event_type, target_type, target_id, metadata, created_at
                 )
                 SELECT ?1, accepted_operator_id, 'operator.invitation.accepted',
                        'system_operator', accepted_operator_id, ?2, ?3
                 FROM operator_invitations
                 WHERE id = ?4 AND accepted_operator_id = ?5 AND accepted_at = ?6`
              )
              .bind(
                `aud_${crypto.randomUUID()}`,
                JSON.stringify({ result: 'accepted' }),
                now.toISOString(),
                invitation.id,
                operatorId,
                acceptedEpoch
              )
          ])
          if (
            results.some(
              (result: unknown) =>
                ((result as { readonly meta: { readonly changes?: number } }).meta
                  .changes ?? 0) < 1
            )
          ) {
            throw new OperatorInvitationDenied('invitation is unavailable')
          }
          return { invitationId: invitation.id, operatorId, expiresAt }
        },
        catch: (error) =>
          error instanceof OperatorInvitationDenied
            ? error
            : new OperatorInvitationDenied('invitation is unavailable')
      }),
    resume: (input, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const expiresAt = new Date(now.getTime() + enrollmentLifetimeMs)
          const [enrollment] = await db
            .select()
            .from(operatorEnrollments)
            .where(
              and(
                eq(operatorEnrollments.operatorId, input.operatorId),
                isNull(operatorEnrollments.completedAt)
              )
            )
            .limit(1)
          if (!enrollment)
            throw new OperatorInvitationDenied('operator enrollment is unavailable')
          await db
            .update(operatorEnrollments)
            .set({
              sessionTokenHash: input.enrollmentTokenHash,
              sessionExpiresAt: expiresAt,
              updatedAt: now
            })
            .where(eq(operatorEnrollments.id, enrollment.id))
          return {
            invitationId: enrollment.invitationId,
            operatorId: input.operatorId,
            expiresAt
          }
        },
        catch: (error) =>
          error instanceof OperatorInvitationDenied
            ? error
            : new OperatorInvitationDenied('operator enrollment is unavailable')
      }),
    inspect: (input, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const [enrollment] = await db
            .select({
              enrollment: operatorEnrollments,
              operator: user,
              factor: twoFactor
            })
            .from(operatorEnrollments)
            .innerJoin(user, eq(user.id, operatorEnrollments.operatorId))
            .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
            .where(
              and(
                eq(operatorEnrollments.sessionTokenHash, input.enrollmentTokenHash),
                gt(operatorEnrollments.sessionExpiresAt, now),
                isNull(operatorEnrollments.completedAt)
              )
            )
            .limit(1)
          if (!enrollment)
            throw new OperatorInvitationDenied('operator enrollment is unavailable')
          return {
            operatorId: enrollment.operator.id,
            email: enrollment.operator.email,
            expiresAt: enrollment.enrollment.sessionExpiresAt,
            totpConfigured: enrollment.factor !== null
          }
        },
        catch: (error) =>
          error instanceof OperatorInvitationDenied
            ? error
            : new OperatorInvitationDenied('operator enrollment is unavailable')
      }),
    complete: (input, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const [enrollment] = await db
            .select({
              enrollment: operatorEnrollments,
              operator: user,
              factor: twoFactor
            })
            .from(operatorEnrollments)
            .innerJoin(user, eq(user.id, operatorEnrollments.operatorId))
            .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
            .where(
              and(
                eq(operatorEnrollments.sessionTokenHash, input.enrollmentTokenHash),
                gt(operatorEnrollments.sessionExpiresAt, now),
                isNull(operatorEnrollments.completedAt)
              )
            )
            .limit(1)
          if (
            !enrollment ||
            !enrollment.operator.emailVerified ||
            !enrollment.operator.twoFactorEnabled ||
            !enrollment.factor?.verified
          ) {
            await audit({
              eventType: 'operator.enrollment.failed',
              targetId: enrollment?.operator.id ?? null,
              result: 'rejected',
              at: now
            })
            throw new OperatorInvitationDenied('operator enrollment is incomplete')
          }
          await db.batch([
            db
              .update(operatorEnrollments)
              .set({
                totpVerifiedAt: now,
                backupCodesConfirmedAt: now,
                completedAt: now,
                updatedAt: now
              })
              .where(eq(operatorEnrollments.id, enrollment.enrollment.id)),
            db.insert(auditEvents).values({
              id: `aud_${crypto.randomUUID()}`,
              actorUserId: enrollment.operator.id,
              eventType: 'operator.enrollment.completed',
              targetType: 'system_operator',
              targetId: enrollment.operator.id,
              metadata: { result: 'accepted' },
              createdAt: now.toISOString()
            })
          ])
        },
        catch: (error) =>
          error instanceof OperatorInvitationDenied
            ? error
            : new OperatorInvitationDenied('operator enrollment could not be completed')
      })
  }

  return Layer.succeed(OperatorInvitations)(service)
}
