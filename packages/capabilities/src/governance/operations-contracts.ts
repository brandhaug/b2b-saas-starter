import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { auditEvents, session, user } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'

export const operatorRoleNames = [
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
] as const
export const OperatorRole = Schema.Literals(operatorRoleNames)
export type OperatorRole = typeof OperatorRole.Type

export const operatorPermissionNames = [
  'merchant:read',
  'merchant:impersonate',
  'impersonation-audit:read',
  'operator:manage'
] as const
export const OperatorPermission = Schema.Literals(operatorPermissionNames)
export type OperatorPermission = typeof OperatorPermission.Type

export const operatorRolePermissions: Readonly<
  Record<OperatorRole, readonly OperatorPermission[]>
> = {
  'merchant-reader': ['merchant:read'],
  'merchant-impersonator': ['merchant:read', 'merchant:impersonate'],
  'impersonation-auditor': ['impersonation-audit:read'],
  'operator-manager': ['operator:manage']
}

export const hasOperatorPermission = (
  roles: readonly OperatorRole[],
  permission: OperatorPermission
): boolean => roles.some((role) => operatorRolePermissions[role].includes(permission))

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

export const MerchantLookup = Schema.Struct({
  actor: OperatorSessionReference,
  merchantId: Schema.String
})
export type MerchantLookup = typeof MerchantLookup.Type

export const MerchantMemberLookup = Schema.Struct({
  actor: OperatorSessionReference,
  merchantId: Schema.String,
  memberId: Schema.String
})
export type MerchantMemberLookup = typeof MerchantMemberLookup.Type

const MerchantOperationalStatus = Schema.Literals(['enabled', 'disabled'])
const MerchantMembershipRole = Schema.Literal('owner')

export const MerchantSearchResult = Schema.Struct({
  kind: Schema.Literal('merchant'),
  id: Schema.String,
  publicName: Schema.String,
  slug: Schema.String,
  status: MerchantOperationalStatus
})
export type MerchantSearchResult = typeof MerchantSearchResult.Type

export const MerchantMemberSearchResult = Schema.Struct({
  kind: Schema.Literal('merchant-member'),
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  status: MerchantOperationalStatus,
  merchant: Schema.Struct({
    id: Schema.String,
    publicName: Schema.String,
    role: MerchantMembershipRole
  }),
  impersonationEligible: Schema.Boolean
})
export type MerchantMemberSearchResult = typeof MerchantMemberSearchResult.Type

export const MerchantDiscoveryResult = Schema.Union([
  MerchantSearchResult,
  MerchantMemberSearchResult
])
export type MerchantDiscoveryResult = typeof MerchantDiscoveryResult.Type

export const MerchantDetail = Schema.Struct({
  id: Schema.String,
  publicName: Schema.String,
  slug: Schema.String,
  status: MerchantOperationalStatus,
  publicPage: Schema.Struct({
    status: Schema.Literals(['published', 'unpublished']),
    bookingPath: Schema.NullOr(Schema.String)
  }),
  readiness: Schema.Struct({
    ready: Schema.Boolean,
    incomplete: Schema.Array(Schema.String)
  }),
  members: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      email: Schema.String,
      status: MerchantOperationalStatus,
      role: MerchantMembershipRole
    })
  )
})
export type MerchantDetail = typeof MerchantDetail.Type

const ImpersonationIneligibilityReason = Schema.Literals([
  'member-disabled',
  'merchant-disabled',
  'unsupported-identity-class',
  'merchant-membership-mismatch'
])

export const MerchantMemberDetail = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String,
  identityClass: Schema.Literals([
    'system_operator',
    'merchant_member',
    'customer_account'
  ]),
  emailVerified: Schema.Boolean,
  enabled: Schema.Boolean,
  membership: Schema.Struct({
    merchantId: Schema.String,
    merchantName: Schema.String,
    role: MerchantMembershipRole
  }),
  activeSessionCount: Schema.Number,
  lastSignInAt: Schema.NullOr(Schema.String),
  impersonationEligibility: Schema.Struct({
    eligible: Schema.Boolean,
    reason: Schema.NullOr(ImpersonationIneligibilityReason)
  })
})
export type MerchantMemberDetail = typeof MerchantMemberDetail.Type

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
    'operator-totp',
    'merchant-discovery',
    'operator-management',
    'impersonation-start',
    'handoff-exchange'
  ]),
  subjectKey: Schema.String,
  sourceKey: Schema.String,
  operation: Schema.String
})
export type OperationsRateLimitRequest = typeof OperationsRateLimitRequest.Type

export const OperationsRateLimitDecision = Schema.Struct({
  allowed: Schema.Boolean,
  retryAfterSeconds: Schema.NullOr(Schema.Number)
})
export type OperationsRateLimitDecision = typeof OperationsRateLimitDecision.Type

export class OperationsRateLimitUnavailable extends Schema.TaggedErrorClass<OperationsRateLimitUnavailable>()(
  'OperationsRateLimitUnavailable',
  { reason: Schema.String }
) {}

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
  expiresAt: Schema.String,
  handoffTicket: Schema.String
})
export type ImpersonationStartResult = typeof ImpersonationStartResult.Type

export const ImpersonationActivationRequest = Schema.Struct({
  handoffTicket: Schema.String
})
export type ImpersonationActivationRequest = typeof ImpersonationActivationRequest.Type

export const ImpersonationActivationResult = Schema.Struct({
  impersonationId: Schema.String,
  lifecycle: Schema.Literal('active'),
  merchantSessionId: Schema.String,
  sessionToken: Schema.String,
  expiresAt: Schema.String
})
export type ImpersonationActivationResult = typeof ImpersonationActivationResult.Type

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
    ) => Effect.Effect<
      readonly (MerchantSearchResult | MerchantMemberSearchResult)[],
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly getMerchant: (
      input: MerchantLookup
    ) => Effect.Effect<MerchantDetail, OperationsContractDenied | CapabilityUnavailable>
    readonly getMember: (
      input: MerchantMemberLookup
    ) => Effect.Effect<
      MerchantMemberDetail,
      OperationsContractDenied | CapabilityUnavailable
    >
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
    ) => Effect.Effect<OperationsRateLimitDecision, OperationsRateLimitUnavailable>
  }
>()('@b2b-saas-starter/capabilities/OperationsRateLimit') {}

type OperationsRateLimitCategory = OperationsRateLimitRequest['category']

export type OperationsRateLimitAdapter = {
  readonly consume: (input: {
    readonly category: OperationsRateLimitCategory
    readonly key: string
  }) => Promise<boolean>
  readonly recordDenied: (input: {
    readonly id: string
    readonly category: OperationsRateLimitCategory
    readonly operation: string
    readonly keyHash: string
    readonly occurredAt: string
  }) => Promise<void>
}

export const makeOperationsRateLimitAuditRecorder =
  (db: PromiseDrizzleDatabase): OperationsRateLimitAdapter['recordDenied'] =>
  async (denial) => {
    await db
      .insert(auditEvents)
      .values({
        id: denial.id,
        merchantId: null,
        actorUserId: null,
        eventType: 'operations.authentication.rate-limited',
        targetType: 'system-operator-authentication',
        targetId: null,
        metadata: {
          category: denial.category,
          operation: denial.operation,
          compositeKeyHash: denial.keyHash,
          retryable: true
        },
        createdAt: denial.occurredAt
      })
      .onConflictDoNothing()
  }

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const makeOperationsRateLimitLayer = (input: {
  readonly adapter: OperationsRateLimitAdapter
  readonly retryAfterSeconds: Readonly<Record<OperationsRateLimitCategory, number>>
  readonly now?: () => Date
}): Layer.Layer<OperationsRateLimit> =>
  Layer.succeed(OperationsRateLimit)({
    consume: (request) =>
      Effect.tryPromise({
        try: async () => {
          const key = await sha256(
            [
              request.category,
              request.operation,
              request.subjectKey,
              request.sourceKey
            ].join('\u0000')
          )
          const allowed = await input.adapter.consume({
            category: request.category,
            key
          })
          const retryAfterSeconds = input.retryAfterSeconds[request.category]
          if (!allowed) {
            const occurredAt = (input.now ?? (() => new Date()))()
            const window = Math.floor(
              occurredAt.getTime() / (retryAfterSeconds * 1_000)
            )
            const evidenceHash = await sha256(`${key}\u0000${window}`)
            await input.adapter.recordDenied({
              id: `oaud_auth_abuse_${evidenceHash.slice(0, 32)}`,
              category: request.category,
              operation: request.operation,
              keyHash: key,
              occurredAt: occurredAt.toISOString()
            })
          }
          return {
            allowed,
            retryAfterSeconds: allowed ? null : retryAfterSeconds
          }
        },
        catch: () =>
          new OperationsRateLimitUnavailable({
            reason: 'operations rate limit is unavailable'
          })
      })
  })

export class OperationsImpersonation extends Context.Service<
  OperationsImpersonation,
  {
    readonly start: (
      input: ImpersonationStartRequest
    ) => Effect.Effect<
      ImpersonationStartResult,
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly recordRejectedStart: (
      input: ImpersonationStartRequest
    ) => Effect.Effect<void, OperationsContractDenied | CapabilityUnavailable>
    readonly activate: (
      input: ImpersonationActivationRequest
    ) => Effect.Effect<
      ImpersonationActivationResult,
      OperationsContractDenied | CapabilityUnavailable
    >
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
      sourceKey: 'source-fingerprint-hash',
      operation: 'sign-in'
    },
    impersonation: {
      actor: fixtureActor,
      targetMemberId: 'usr_target',
      merchantId: 'mer_fixture',
      reason: 'Reproduce a reported scheduling issue',
      supportReference: 'SUP-42'
    }
  }) as const
