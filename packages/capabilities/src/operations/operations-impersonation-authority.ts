import { Context, Effect, Layer, Schema } from 'effect'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { operationsAuditEvents } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import {
  OperationsContractDenied,
  hasOperatorPermission,
  parseOperatorRoles
} from './operations-contracts.ts'
import {
  OperationsImpersonationLifecycle,
  makeOperationsImpersonationLifecycleLayer,
  type ImpersonationRevocationCause
} from './operations-impersonation-lifecycle.ts'

export const impersonatedMerchantActions = [
  'merchant.navigate',
  'merchant.read',
  'service.read',
  'service.update',
  'provider.read',
  'provider.update',
  'service-eligibility.update',
  'schedule.read',
  'schedule.update',
  'publication.update',
  'appointment.read',
  'customer.read',
  'financial.read',
  'credential-metadata.read',
  'walk-in.read',
  'walk-in.update',
  'identity-security.update',
  'mfa.update',
  'identity.delete',
  'merchant-ownership.update',
  'credential.create',
  'credential.rotate',
  'money.move',
  'payout-destination.update',
  'billing-destination.update',
  'entity.delete',
  'bulk-wipe.execute'
] as const

export const ImpersonatedMerchantAction = Schema.Literals(impersonatedMerchantActions)
export type ImpersonatedMerchantAction = typeof ImpersonatedMerchantAction.Type

const explicitImpersonationAllowlist = new Set<ImpersonatedMerchantAction>([
  'merchant.navigate',
  'merchant.read',
  'service.read',
  'service.update',
  'provider.read',
  'provider.update',
  'service-eligibility.update',
  'schedule.read',
  'schedule.update',
  'publication.update',
  'appointment.read',
  'customer.read',
  'financial.read',
  'credential-metadata.read',
  'walk-in.read',
  'walk-in.update'
])

const mutationActions = new Set<ImpersonatedMerchantAction>([
  'service.update',
  'provider.update',
  'service-eligibility.update',
  'schedule.update',
  'publication.update',
  'walk-in.update',
  'identity-security.update',
  'mfa.update',
  'identity.delete',
  'merchant-ownership.update',
  'credential.create',
  'credential.rotate',
  'money.move',
  'payout-destination.update',
  'billing-destination.update',
  'entity.delete',
  'bulk-wipe.execute'
])

export const isImpersonatedMerchantMutation = (
  action: ImpersonatedMerchantAction
): boolean => mutationActions.has(action)

export const intersectsImpersonatedMerchantAuthority = (input: {
  readonly targetAuthority: ReadonlySet<ImpersonatedMerchantAction>
  readonly action: ImpersonatedMerchantAction
}): boolean =>
  input.targetAuthority.has(input.action) &&
  explicitImpersonationAllowlist.has(input.action)

const sensitiveReadActions = new Set<ImpersonatedMerchantAction>([
  'customer.read',
  'financial.read',
  'credential-metadata.read'
])

type RawD1 = {
  readonly prepare: (sql: string) => {
    readonly bind: (...values: readonly unknown[]) => {
      readonly first: <T>() => Promise<T | null>
    }
  }
}

type AuthorityRow = {
  readonly impersonationId: string
  readonly operatorId: string
  readonly operatorName: string
  readonly operatorRole: string | null
  readonly operatorIdentityClass: string
  readonly operatorBanned: number
  readonly operatorEmailVerified: number
  readonly operatorTwoFactorEnabled: number
  readonly operatorSessionId: string
  readonly operatorSessionExpiresAt: number
  readonly operatorIdleExpiresAt: number | null
  readonly operatorAbsoluteExpiresAt: number | null
  readonly factorVerified: number
  readonly factorLockedUntil: number | null
  readonly targetMemberId: string
  readonly targetName: string
  readonly targetIdentityClass: string
  readonly targetBanned: number
  readonly merchantId: string
  readonly merchantName: string
  readonly merchantStatus: string
  readonly membershipRole: string | null
  readonly merchantSessionId: string
  readonly merchantSessionUserId: string
  readonly merchantSessionImpersonatedBy: string | null
  readonly merchantSessionExpiresAt: number
  readonly lifecycle: string
  readonly activeExpiresAt: number | null
  readonly terminationCause: string | null
  readonly internalReason: string
  readonly supportReference: string | null
}

export type ImpersonationAuthorization = {
  readonly impersonationId: string
  readonly operatorId: string
  readonly operatorName: string
  readonly operatorSessionId: string
  readonly targetMemberId: string
  readonly targetName: string
  readonly merchantId: string
  readonly merchantName: string
  readonly merchantSessionId: string
  readonly internalReason: string
  readonly supportReference: string | null
}

export type ImpersonationAuthorityRequest = {
  readonly merchantSessionId: string
  readonly action: ImpersonatedMerchantAction
}

export type ImpersonationMutationResult = {
  readonly businessEventId: string
  readonly authorization: ImpersonationAuthorization
  readonly action: ImpersonatedMerchantAction
  readonly result: 'accepted' | 'rejected'
}

export class OperationsImpersonationAuthority extends Context.Service<
  OperationsImpersonationAuthority,
  {
    readonly authorize: (
      input: ImpersonationAuthorityRequest
    ) => Effect.Effect<
      ImpersonationAuthorization,
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly recordMutation: (
      input: ImpersonationMutationResult
    ) => Effect.Effect<void, CapabilityUnavailable>
  }
>()('@b2b-saas-starter/capabilities/OperationsImpersonationAuthority') {}

const denied = () =>
  new OperationsContractDenied({ reason: 'impersonation authority denied' })

const unavailable = () =>
  new CapabilityUnavailable({
    capability: 'operations-impersonation-authority',
    reason: 'impersonation authority is unavailable'
  })

const twoYearsAfter = (occurredAt: Date): string => {
  const retained = new Date(occurredAt)
  retained.setUTCFullYear(retained.getUTCFullYear() + 2)
  return retained.toISOString()
}

const authorizationFrom = (row: AuthorityRow): ImpersonationAuthorization => ({
  impersonationId: row.impersonationId,
  operatorId: row.operatorId,
  operatorName: row.operatorName,
  operatorSessionId: row.operatorSessionId,
  targetMemberId: row.targetMemberId,
  targetName: row.targetName,
  merchantId: row.merchantId,
  merchantName: row.merchantName,
  merchantSessionId: row.merchantSessionId,
  internalReason: row.internalReason,
  supportReference: row.supportReference
})

const rowIsAuthoritative = (row: AuthorityRow, nowEpoch: number): boolean =>
  row.lifecycle === 'active' &&
  row.terminationCause === null &&
  row.activeExpiresAt !== null &&
  row.activeExpiresAt > nowEpoch &&
  row.merchantSessionExpiresAt > nowEpoch &&
  row.merchantSessionUserId === row.targetMemberId &&
  row.merchantSessionImpersonatedBy === row.operatorId &&
  row.operatorIdentityClass === 'system_operator' &&
  row.operatorBanned === 0 &&
  row.operatorEmailVerified === 1 &&
  row.operatorTwoFactorEnabled === 1 &&
  row.operatorSessionExpiresAt > nowEpoch &&
  row.operatorIdleExpiresAt !== null &&
  row.operatorIdleExpiresAt > nowEpoch &&
  row.operatorAbsoluteExpiresAt !== null &&
  row.operatorAbsoluteExpiresAt > nowEpoch &&
  row.factorVerified === 1 &&
  (row.factorLockedUntil === null || row.factorLockedUntil <= nowEpoch) &&
  hasOperatorPermission(parseOperatorRoles(row.operatorRole), 'merchant:impersonate') &&
  row.targetIdentityClass === 'merchant_member' &&
  row.targetBanned === 0 &&
  row.merchantStatus === 'enabled' &&
  row.membershipRole === 'owner'

const revocationCauseFrom = (
  row: AuthorityRow,
  nowEpoch: number
): ImpersonationRevocationCause => {
  if (row.operatorBanned !== 0) return 'operator-disabled'
  if (
    row.operatorSessionExpiresAt <= nowEpoch ||
    row.operatorIdleExpiresAt === null ||
    row.operatorIdleExpiresAt <= nowEpoch ||
    row.operatorAbsoluteExpiresAt === null ||
    row.operatorAbsoluteExpiresAt <= nowEpoch
  )
    return 'operator-session-revoked'
  if (
    row.operatorTwoFactorEnabled !== 1 ||
    row.factorVerified !== 1 ||
    (row.factorLockedUntil !== null && row.factorLockedUntil > nowEpoch)
  )
    return 'totp-unenrolled'
  if (
    !hasOperatorPermission(parseOperatorRoles(row.operatorRole), 'merchant:impersonate')
  )
    return 'permission-removed'
  if (row.targetBanned !== 0) return 'target-disabled'
  if (row.merchantStatus !== 'enabled') return 'merchant-disabled'
  if (row.membershipRole !== 'owner') return 'membership-changed'
  return 'security-state-revoked'
}

const selectAuthorityRow = async (
  db: PromiseDrizzleDatabase,
  merchantSessionId: string
): Promise<AuthorityRow | null> => {
  const raw = db.$client as unknown as RawD1
  return raw
    .prepare(
      `SELECT
         record.id AS impersonationId,
         operator.id AS operatorId,
         operator.name AS operatorName,
         operator.role AS operatorRole,
         operator.identityClass AS operatorIdentityClass,
         coalesce(operator.banned, 0) AS operatorBanned,
         operator.emailVerified AS operatorEmailVerified,
         operator.twoFactorEnabled AS operatorTwoFactorEnabled,
         operator_session.id AS operatorSessionId,
         operator_session.expiresAt AS operatorSessionExpiresAt,
         operator_session.operatorIdleExpiresAt AS operatorIdleExpiresAt,
         operator_session.operatorAbsoluteExpiresAt AS operatorAbsoluteExpiresAt,
         factor.verified AS factorVerified,
         factor.lockedUntil AS factorLockedUntil,
         target.id AS targetMemberId,
         target.name AS targetName,
         target.identityClass AS targetIdentityClass,
         coalesce(target.banned, 0) AS targetBanned,
         merchant.id AS merchantId,
         merchant.public_name AS merchantName,
         merchant.status AS merchantStatus,
         membership.role AS membershipRole,
         merchant_session.id AS merchantSessionId,
         merchant_session.userId AS merchantSessionUserId,
         merchant_session.impersonatedBy AS merchantSessionImpersonatedBy,
         merchant_session.expiresAt AS merchantSessionExpiresAt,
         record.lifecycle AS lifecycle,
         record.active_expires_at AS activeExpiresAt,
         record.termination_cause AS terminationCause,
         record.reason AS internalReason,
         record.support_reference AS supportReference
       FROM impersonation_records AS record
       JOIN session AS merchant_session ON merchant_session.id = record.merchant_session_id
       JOIN session AS operator_session ON operator_session.id = record.operator_session_id
       JOIN user AS operator
         ON operator.id = record.operator_id
        AND operator_session.userId = operator.id
       JOIN twoFactor AS factor ON factor.userId = operator.id
       JOIN user AS target ON target.id = record.target_member_id
       LEFT JOIN merchant_memberships AS membership
         ON membership.user_id = target.id AND membership.merchant_id = record.merchant_id
       JOIN merchants AS merchant ON merchant.id = record.merchant_id
       WHERE merchant_session.id = ?1
       LIMIT 1`
    )
    .bind(merchantSessionId)
    .first<AuthorityRow>()
}

export const makeOperationsImpersonationAuthorityLayer = (
  db: PromiseDrizzleDatabase,
  options: {
    readonly now?: () => Date
    readonly auditEventId?: () => string
    readonly securityContact: string
    readonly targetAuthority?: (input: {
      readonly targetMemberId: string
      readonly membershipRole: string | null
    }) => ReadonlySet<ImpersonatedMerchantAction>
  }
): Layer.Layer<OperationsImpersonationAuthority> => {
  const now = options.now ?? (() => new Date())
  const auditEventId = options.auditEventId ?? (() => `oaud_${crypto.randomUUID()}`)
  const lifecycleLayer = makeOperationsImpersonationLifecycleLayer(db, {
    now,
    securityContact: options.securityContact
  })
  const terminate = (
    merchantSessionId: string,
    cause: 'absolute-timeout' | ImpersonationRevocationCause
  ) =>
    Effect.runPromise(
      Effect.flatMap(OperationsImpersonationLifecycle, (lifecycle) =>
        cause === 'absolute-timeout'
          ? lifecycle.resolve({ merchantSessionId })
          : lifecycle.revoke({ merchantSessionId, cause })
      ).pipe(Effect.provide(lifecycleLayer))
    )

  const recordEvidence = async (input: {
    readonly businessEventId?: string
    readonly authorization: ImpersonationAuthorization
    readonly action: ImpersonatedMerchantAction
    readonly result: 'accepted' | 'rejected'
    readonly occurredAt: Date
  }) => {
    const id = input.businessEventId ?? auditEventId()
    const occurredAt = input.occurredAt.toISOString()
    await db
      .insert(operationsAuditEvents)
      .values({
        id,
        businessEventId: id,
        actorOperatorId: input.authorization.operatorId,
        actorDisplayName: input.authorization.operatorName,
        operatorSessionId: input.authorization.operatorSessionId,
        impersonationId: input.authorization.impersonationId,
        targetId: input.authorization.targetMemberId,
        targetDisplayName: input.authorization.targetName,
        merchantId: input.authorization.merchantId,
        merchantDisplayName: input.authorization.merchantName,
        action: `impersonation.${input.action}`,
        result: input.result,
        occurredAt,
        retentionPolicy: 'impersonation-two-years',
        retainUntil: twoYearsAfter(input.occurredAt),
        internalReason: input.authorization.internalReason,
        supportReference: input.authorization.supportReference,
        createdAt: occurredAt
      })
      .onConflictDoNothing({ target: operationsAuditEvents.businessEventId })
  }

  return Layer.succeed(OperationsImpersonationAuthority)({
    authorize: (input) =>
      Effect.tryPromise({
        try: async () => {
          const requestedAt = now()
          const row = await selectAuthorityRow(db, input.merchantSessionId)
          if (!row) {
            try {
              await terminate(input.merchantSessionId, 'security-state-revoked')
            } catch (error) {
              if (!(error instanceof OperationsContractDenied)) throw error
            }
            throw denied()
          }
          const authorization = authorizationFrom(row)
          const targetAuthority = options.targetAuthority
            ? options.targetAuthority({
                targetMemberId: row.targetMemberId,
                membershipRole: row.membershipRole
              })
            : row.membershipRole === 'owner'
              ? new Set<ImpersonatedMerchantAction>(impersonatedMerchantActions)
              : new Set<ImpersonatedMerchantAction>()
          const allowed = intersectsImpersonatedMerchantAuthority({
            targetAuthority,
            action: input.action
          })
          if (!rowIsAuthoritative(row, Math.floor(requestedAt.getTime() / 1_000))) {
            if (
              row.lifecycle === 'active' &&
              row.activeExpiresAt !== null &&
              row.activeExpiresAt <= Math.floor(requestedAt.getTime() / 1_000)
            ) {
              await terminate(row.merchantSessionId, 'absolute-timeout')
            } else if (row.lifecycle === 'active') {
              await terminate(
                row.merchantSessionId,
                revocationCauseFrom(row, Math.floor(requestedAt.getTime() / 1_000))
              )
            }
            if (isImpersonatedMerchantMutation(input.action)) {
              await recordEvidence({
                authorization,
                action: input.action,
                result: 'rejected',
                occurredAt: requestedAt
              })
            }
            throw denied()
          }
          if (!allowed) {
            if (isImpersonatedMerchantMutation(input.action)) {
              await recordEvidence({
                authorization,
                action: input.action,
                result: 'rejected',
                occurredAt: requestedAt
              })
            }
            throw denied()
          }
          if (sensitiveReadActions.has(input.action)) {
            await recordEvidence({
              authorization,
              action: input.action,
              result: 'accepted',
              occurredAt: requestedAt
            })
          }
          return authorization
        },
        catch: (error) =>
          error instanceof OperationsContractDenied ? error : unavailable()
      }),
    recordMutation: (input) =>
      Effect.tryPromise({
        try: () =>
          recordEvidence({
            ...input,
            occurredAt: now()
          }),
        catch: unavailable
      })
  })
}
