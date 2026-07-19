import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { session, user } from '@b2b-saas-starter/db'

export const operatorRoleNames = [
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
] as const
export const OperatorRole = Schema.Literals(operatorRoleNames)
export type OperatorRole = typeof OperatorRole.Type

export const OperatorSessionReference = Schema.Struct({
  operatorSessionId: Schema.String
})
export type OperatorSessionReference = typeof OperatorSessionReference.Type

export const OperatorPrincipal = Schema.Struct({
  id: Schema.String,
  sessionId: Schema.String,
  email: Schema.String,
  name: Schema.String,
  roles: Schema.Array(OperatorRole),
  idleExpiresAt: Schema.Date,
  absoluteExpiresAt: Schema.Date
})
export type OperatorPrincipal = typeof OperatorPrincipal.Type

export const ProvisionOperatorRequest = Schema.Struct({
  actor: OperatorSessionReference,
  email: Schema.String,
  name: Schema.String,
  roles: Schema.Array(OperatorRole)
})
export type ProvisionOperatorRequest = typeof ProvisionOperatorRequest.Type

export const ProvisionOperatorResult = Schema.Struct({
  operatorId: Schema.String,
  enrollmentRequired: Schema.Boolean
})
export type ProvisionOperatorResult = typeof ProvisionOperatorResult.Type

export const MerchantDiscoveryQuery = Schema.Struct({
  actor: OperatorSessionReference,
  kind: Schema.Literals(['merchant', 'merchant-member']),
  query: Schema.String,
  limit: Schema.Number
})
export type MerchantDiscoveryQuery = typeof MerchantDiscoveryQuery.Type

export const MerchantDiscoveryResult = Schema.Struct({
  id: Schema.String,
  merchantId: Schema.String,
  displayName: Schema.String,
  status: Schema.Literals(['enabled', 'disabled'])
})
export type MerchantDiscoveryResult = typeof MerchantDiscoveryResult.Type

export const OperationsAuditRecord = Schema.Struct({
  id: Schema.String,
  actorOperatorId: Schema.String,
  targetId: Schema.NullOr(Schema.String),
  merchantId: Schema.NullOr(Schema.String),
  action: Schema.String,
  result: Schema.Literals(['accepted', 'rejected']),
  occurredAt: Schema.String
})
export type OperationsAuditRecord = typeof OperationsAuditRecord.Type

export const OperationsRateLimitRequest = Schema.Struct({
  category: Schema.Literals([
    'operator-session-read',
    'operator-authentication',
    'merchant-discovery',
    'operator-management',
    'impersonation-start',
    'handoff-exchange'
  ]),
  subjectKey: Schema.String,
  sourceKey: Schema.String
})
export type OperationsRateLimitRequest = typeof OperationsRateLimitRequest.Type

export const OperationsRateLimitDecision = Schema.Struct({
  allowed: Schema.Boolean,
  retryAfterSeconds: Schema.NullOr(Schema.Number)
})
export type OperationsRateLimitDecision = typeof OperationsRateLimitDecision.Type

export const ImpersonationStartRequest = Schema.Struct({
  actor: OperatorSessionReference,
  targetMemberId: Schema.String,
  merchantId: Schema.String,
  reason: Schema.String,
  supportReference: Schema.NullOr(Schema.String)
})
export type ImpersonationStartRequest = typeof ImpersonationStartRequest.Type

export const ImpersonationStartResult = Schema.Struct({
  impersonationId: Schema.String,
  lifecycle: Schema.Literal('pending-handoff'),
  expiresAt: Schema.String
})
export type ImpersonationStartResult = typeof ImpersonationStartResult.Type

export class OperationsContractDenied extends Schema.TaggedErrorClass<OperationsContractDenied>()(
  'OperationsContractDenied',
  { reason: Schema.String }
) {}

export class OperationsProvisioning extends Context.Service<
  OperationsProvisioning,
  {
    readonly provision: (
      input: ProvisionOperatorRequest
    ) => Effect.Effect<ProvisionOperatorResult, OperationsContractDenied>
  }
>()('@b2b-saas-starter/capabilities/OperationsProvisioning') {}

export class OperationsDiscovery extends Context.Service<
  OperationsDiscovery,
  {
    readonly search: (
      input: MerchantDiscoveryQuery
    ) => Effect.Effect<readonly MerchantDiscoveryResult[], OperationsContractDenied>
  }
>()('@b2b-saas-starter/capabilities/OperationsDiscovery') {}

export class OperationsAudit extends Context.Service<
  OperationsAudit,
  {
    readonly record: (input: OperationsAuditRecord) => Effect.Effect<void>
    readonly list: (
      actor: OperatorSessionReference
    ) => Effect.Effect<readonly OperationsAuditRecord[], OperationsContractDenied>
  }
>()('@b2b-saas-starter/capabilities/OperationsAudit') {}

export class OperationsRateLimit extends Context.Service<
  OperationsRateLimit,
  {
    readonly consume: (
      input: OperationsRateLimitRequest
    ) => Effect.Effect<OperationsRateLimitDecision>
  }
>()('@b2b-saas-starter/capabilities/OperationsRateLimit') {}

export class OperationsImpersonation extends Context.Service<
  OperationsImpersonation,
  {
    readonly start: (
      input: ImpersonationStartRequest
    ) => Effect.Effect<ImpersonationStartResult, OperationsContractDenied>
  }
>()('@b2b-saas-starter/capabilities/OperationsImpersonation') {}

export class OperationsAuthorization extends Context.Service<
  OperationsAuthorization,
  {
    readonly authorize: (
      reference: OperatorSessionReference,
      now?: Date
    ) => Effect.Effect<OperatorPrincipal, OperationsContractDenied>
  }
>()('@b2b-saas-starter/capabilities/OperationsAuthorization') {}

const operatorIdleLifetimeMs = 30 * 60 * 1_000

const parseRoles = (value: string | null): OperatorRole[] => [
  ...new Set(
    (value ?? '')
      .split(',')
      .map((role) => role.trim())
      .filter((role): role is OperatorRole =>
        operatorRoleNames.includes(role as OperatorRole)
      )
  )
]

export const makeOperationsAuthorizationLayer = (
  db: PromiseDrizzleDatabase
): Layer.Layer<OperationsAuthorization> =>
  Layer.succeed(OperationsAuthorization)({
    authorize: (reference, requestedNow) =>
      Effect.tryPromise({
        try: async () => {
          const now = requestedNow ?? new Date()
          const [authoritative] = await db
            .select({ operator: user, session })
            .from(session)
            .innerJoin(user, eq(user.id, session.userId))
            .where(
              and(
                eq(session.id, reference.operatorSessionId),
                eq(user.identityClass, 'system_operator')
              )
            )
            .limit(1)
          const idleExpiresAt = authoritative?.session.operatorIdleExpiresAt
          const absoluteExpiresAt = authoritative?.session.operatorAbsoluteExpiresAt
          if (
            !authoritative ||
            authoritative.operator.banned ||
            !authoritative.operator.emailVerified ||
            !authoritative.operator.twoFactorEnabled ||
            !idleExpiresAt ||
            !absoluteExpiresAt ||
            now >= idleExpiresAt ||
            now >= absoluteExpiresAt
          ) {
            throw new Error('operator session is not authorized')
          }
          const nextIdle = new Date(
            Math.min(
              now.getTime() + operatorIdleLifetimeMs,
              absoluteExpiresAt.getTime()
            )
          )
          await db
            .update(session)
            .set({ operatorIdleExpiresAt: nextIdle })
            .where(eq(session.id, authoritative.session.id))
          return {
            id: authoritative.operator.id,
            sessionId: authoritative.session.id,
            email: authoritative.operator.email,
            name: authoritative.operator.name,
            roles: parseRoles(authoritative.operator.role),
            idleExpiresAt: nextIdle,
            absoluteExpiresAt
          }
        },
        catch: () =>
          new OperationsContractDenied({ reason: 'operator session is not authorized' })
      })
  })

const fixtureActor: OperatorSessionReference = {
  operatorSessionId: 'ops_local'
}

export const makeOperationsContractFixtures = () =>
  ({
    provisioning: {
      actor: fixtureActor,
      email: 'next-operator@example.test',
      name: 'Next System Operator',
      roles: ['merchant-reader']
    },
    discovery: {
      actor: fixtureActor,
      kind: 'merchant',
      query: 'mer_fixture',
      limit: 20
    },
    audit: {
      id: 'oaud_fixture',
      actorOperatorId: 'opr_local',
      targetId: null,
      merchantId: 'mer_fixture',
      action: 'merchant.discovery',
      result: 'accepted',
      occurredAt: '2026-07-19T09:00:00.000Z'
    },
    rateLimit: {
      category: 'operator-authentication',
      subjectKey: 'operator-email-hash',
      sourceKey: 'source-fingerprint-hash'
    },
    impersonation: {
      actor: fixtureActor,
      targetMemberId: 'usr_target',
      merchantId: 'mer_fixture',
      reason: 'Reproduce a reported scheduling issue',
      supportReference: 'SUP-42'
    }
  }) as const
