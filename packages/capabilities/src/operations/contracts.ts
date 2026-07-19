import { Context, Effect, Schema } from 'effect'

export const OperatorRole = Schema.Literals([
  'merchant-reader',
  'merchant-impersonator',
  'impersonation-auditor',
  'operator-manager'
])
export type OperatorRole = typeof OperatorRole.Type

export const OperatorAuthorization = Schema.Struct({
  operatorId: Schema.String,
  operatorSessionId: Schema.String,
  roles: Schema.Array(OperatorRole)
})
export type OperatorAuthorization = typeof OperatorAuthorization.Type

export const ProvisionOperatorRequest = Schema.Struct({
  actor: OperatorAuthorization,
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
  actor: OperatorAuthorization,
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
  actor: OperatorAuthorization,
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
      actor: OperatorAuthorization
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

const fixtureActor: OperatorAuthorization = {
  operatorId: 'opr_local',
  operatorSessionId: 'ops_local',
  roles: ['merchant-impersonator', 'impersonation-auditor', 'operator-manager']
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
      actorOperatorId: fixtureActor.operatorId,
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
