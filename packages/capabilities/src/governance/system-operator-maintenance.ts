import { Context, Effect, Layer, Schema } from 'effect'
import type {
  D1Database,
  D1PreparedStatement,
  D1Result
} from '@cloudflare/workers-types'
import { operatorRoleNames, type OperatorRole } from './operations-contracts.ts'
import { CapabilityUnavailable } from '../errors.ts'
import { activeImpersonationRevocationStatements } from './operations-impersonation-revocation.ts'

export const OperatorMaintenanceEnvironment = Schema.Literals(['local', 'production'])
export type OperatorMaintenanceEnvironment = typeof OperatorMaintenanceEnvironment.Type

export type OperatorMaintenanceStatement = {
  readonly sql: string
  readonly params: readonly unknown[]
}

export type OperatorMaintenanceBatchResult = {
  readonly changes: number
}

export type OperatorMaintenanceDatabase = {
  readonly first: <Row>(statement: OperatorMaintenanceStatement) => Promise<Row | null>
  readonly batch: (
    statements: readonly OperatorMaintenanceStatement[]
  ) => Promise<readonly OperatorMaintenanceBatchResult[]>
}

export class OperatorMaintenanceRejected extends Schema.TaggedErrorClass<OperatorMaintenanceRejected>()(
  'OperatorMaintenanceRejected',
  { reason: Schema.String }
) {}

export const BootstrapSystemOperatorRequest = Schema.Struct({
  actor: Schema.String,
  environment: OperatorMaintenanceEnvironment,
  remote: Schema.Boolean,
  email: Schema.String,
  confirmedEmail: Schema.String,
  roles: Schema.Array(Schema.Literals(operatorRoleNames))
})
export type BootstrapSystemOperatorRequest = typeof BootstrapSystemOperatorRequest.Type

export const RecoverSystemOperatorRequest = Schema.Struct({
  actor: Schema.String,
  environment: OperatorMaintenanceEnvironment,
  remote: Schema.Boolean,
  email: Schema.String,
  confirmedEmail: Schema.String
})
export type RecoverSystemOperatorRequest = typeof RecoverSystemOperatorRequest.Type

export type BootstrapSystemOperatorResult = {
  readonly operatorId: string
  readonly enrollmentRequired: true
  readonly changed: boolean
}

export type RecoverSystemOperatorResult = {
  readonly operatorId: string
  readonly enrollmentRequired: true
}

export type SystemOperatorMaintenanceShape = {
  readonly bootstrap: (
    request: BootstrapSystemOperatorRequest
  ) => Effect.Effect<
    BootstrapSystemOperatorResult,
    OperatorMaintenanceRejected | CapabilityUnavailable
  >
  readonly recover: (
    request: RecoverSystemOperatorRequest
  ) => Effect.Effect<
    RecoverSystemOperatorResult,
    OperatorMaintenanceRejected | CapabilityUnavailable
  >
}

export class SystemOperatorMaintenance extends Context.Service<
  SystemOperatorMaintenance,
  SystemOperatorMaintenanceShape
>()('@b2b-saas-starter/capabilities/SystemOperatorMaintenance') {}

type MaintenanceOptions = {
  readonly now?: () => Date
  readonly id?: () => string
  readonly securityContact: string
}

type IdentityRow = {
  readonly id: string
  readonly email: string
  readonly email_verified: number
  readonly identity_class: string
  readonly role: string | null
  readonly banned: number | null
  readonly has_membership: number
}

const targetIdentity = (email: string): OperatorMaintenanceStatement => ({
  sql: `SELECT
          candidate.id,
          candidate.email,
          candidate.emailVerified AS email_verified,
          candidate.identityClass AS identity_class,
          candidate.role,
          candidate.banned,
          EXISTS (
            SELECT 1 FROM merchant_memberships AS membership
            WHERE membership.user_id = candidate.id
          ) AS has_membership
        FROM user AS candidate
        WHERE candidate.email = ?1
        LIMIT 1`,
  params: [email]
})

const canonicalRoles = (roles: readonly OperatorRole[]): string | null => {
  const unique = new Set(roles)
  if (unique.size === 0 || unique.size !== roles.length) return null
  if ([...unique].some((role) => !operatorRoleNames.includes(role))) return null
  return operatorRoleNames.filter((role) => unique.has(role)).join(',')
}

const normalizedTarget = (email: string): string => email.trim().toLowerCase()

const targetPolicyReason = (input: {
  readonly actor: string
  readonly environment: OperatorMaintenanceEnvironment
  readonly remote: boolean
  readonly email: string
  readonly confirmedEmail: string
  readonly requireConfirmation: boolean
}): string | null => {
  if (input.actor.trim().length === 0) return 'actor is required'
  if (normalizedTarget(input.email).length === 0) return 'target email is required'
  if (input.environment === 'production' && !input.remote)
    return 'production requires an explicit remote target'
  if (input.environment === 'local' && input.remote)
    return 'local execution cannot target the remote database'
  if (
    input.requireConfirmation &&
    normalizedTarget(input.confirmedEmail) !== normalizedTarget(input.email)
  )
    return 'confirmed email does not match the exact target'
  return null
}

const identityRejection = (
  candidate: IdentityRow | null,
  requestedRoles?: string
): string | null => {
  if (!candidate) return 'target identity does not exist'
  if (!candidate.email_verified) return 'target email is not verified'
  if (candidate.banned) return 'target identity is disabled'
  if (candidate.identity_class === 'customer_account')
    return 'identity belongs to a Customer Account'
  if (candidate.identity_class === 'merchant_member' || candidate.has_membership)
    return 'identity belongs to a Merchant Member'
  if (
    requestedRoles !== undefined &&
    candidate.identity_class === 'system_operator' &&
    candidate.role !== requestedRoles &&
    candidate.role !== null &&
    candidate.role !== '' &&
    candidate.role !== 'user'
  )
    return 'existing roles differ from requested roles'
  if (candidate.identity_class !== 'system_operator')
    return 'identity belongs to an unsupported identity class'
  return null
}

const auditStatement = (input: {
  readonly id: string
  readonly eventType: string
  readonly targetId: string | null
  readonly actor: string
  readonly targetEmail: string
  readonly result: 'accepted' | 'rejected'
  readonly environment: OperatorMaintenanceEnvironment
  readonly changed?: boolean
  readonly reason?: string
  readonly occurredAt: string
  readonly condition?: {
    readonly sql: string
    readonly params: readonly unknown[]
  }
}): OperatorMaintenanceStatement => ({
  sql: `INSERT INTO audit_events
        (id, merchant_id, actor_user_id, event_type, target_type, target_id, metadata, created_at)
        ${input.condition ? `SELECT ?1, NULL, NULL, ?2, 'system_operator', ?3, ?4, ?5 WHERE ${input.condition.sql}` : `VALUES (?1, NULL, NULL, ?2, 'system_operator', ?3, ?4, ?5)`}`,
  params: [
    input.id,
    input.eventType,
    input.targetId,
    JSON.stringify({
      actor: input.actor.trim(),
      targetEmail: input.targetEmail,
      result: input.result,
      environment: input.environment,
      ...(input.changed === undefined ? {} : { changed: input.changed }),
      ...(input.reason === undefined ? {} : { reason: input.reason })
    }),
    input.occurredAt,
    ...(input.condition?.params ?? [])
  ]
})

const unavailable = (cause: unknown): CapabilityUnavailable =>
  new CapabilityUnavailable({
    capability: 'system-operator-maintenance',
    reason: cause instanceof Error ? cause.message : String(cause)
  })

const rejected = (reason: string): OperatorMaintenanceRejected =>
  new OperatorMaintenanceRejected({ reason })

export const makeSystemOperatorMaintenance = (
  database: OperatorMaintenanceDatabase,
  options: MaintenanceOptions
): SystemOperatorMaintenanceShape => {
  const currentTime = options.now ?? (() => new Date())
  const nextId = options.id ?? (() => `oaud_${crypto.randomUUID()}`)

  const rejectWithAudit = async (input: {
    readonly action: 'bootstrap' | 'recovery'
    readonly request: RecoverSystemOperatorRequest
    readonly targetId: string | null
    readonly reason: string
  }): Promise<never> => {
    const email = normalizedTarget(input.request.email)
    try {
      await database.batch([
        auditStatement({
          id: nextId(),
          eventType: `operations.operator.${input.action}.rejected`,
          targetId: input.targetId,
          actor: input.request.actor,
          targetEmail: email,
          result: 'rejected',
          environment: input.request.environment,
          reason: input.reason,
          occurredAt: currentTime().toISOString()
        })
      ])
    } catch (cause) {
      throw unavailable(cause)
    }
    throw rejected(input.reason)
  }

  const bootstrap = async (request: BootstrapSystemOperatorRequest) => {
    const email = normalizedTarget(request.email)
    const roles = canonicalRoles(request.roles)
    const policyReason =
      targetPolicyReason({
        ...request,
        requireConfirmation: request.environment === 'production'
      }) ?? (roles ? null : 'roles must be a non-empty explicit accepted set')
    let candidate: IdentityRow | null
    try {
      candidate = await database.first<IdentityRow>(targetIdentity(email))
    } catch (cause) {
      throw unavailable(cause)
    }
    if (policyReason)
      return rejectWithAudit({
        action: 'bootstrap',
        request,
        targetId: candidate?.id ?? null,
        reason: policyReason
      })
    const reason = identityRejection(candidate, roles!)
    if (reason)
      return rejectWithAudit({
        action: 'bootstrap',
        request,
        targetId: candidate?.id ?? null,
        reason
      })

    const changed = candidate!.role !== roles
    const auditId = nextId()
    const statements: OperatorMaintenanceStatement[] = [
      auditStatement({
        id: auditId,
        eventType: 'operations.operator.bootstrap.accepted',
        targetId: candidate!.id,
        actor: request.actor,
        targetEmail: email,
        result: 'accepted',
        environment: request.environment,
        changed,
        occurredAt: currentTime().toISOString(),
        condition: {
          sql: `EXISTS (
                    SELECT 1 FROM user AS target
                    WHERE target.id = ?6 AND target.emailVerified = 1
                      AND (target.banned IS NULL OR target.banned = 0)
                      AND target.identityClass = 'system_operator'
                      AND ${changed ? "(target.role IS NULL OR target.role = '' OR target.role = 'user')" : 'target.role = ?7'}
                      AND NOT EXISTS (
                        SELECT 1 FROM merchant_memberships WHERE user_id = target.id
                      )
                  )`,
          params: changed ? [candidate!.id] : [candidate!.id, roles!]
        }
      })
    ]
    if (changed) {
      statements.push(
        {
          sql: `DELETE FROM session WHERE userId = ?1
                  AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?2)`,
          params: [candidate!.id, auditId]
        },
        {
          sql: `DELETE FROM twoFactor WHERE userId = ?1
                  AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?2)`,
          params: [candidate!.id, auditId]
        },
        {
          sql: `UPDATE user
                  SET role = ?1, twoFactorEnabled = 0, updatedAt = ?2
                  WHERE id = ?3 AND emailVerified = 1
                    AND identityClass = 'system_operator'
                    AND (role IS NULL OR role = '' OR role = 'user')
                    AND NOT EXISTS (
                      SELECT 1 FROM merchant_memberships WHERE user_id = ?3
                    )
                    AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?4)`,
          params: [
            roles!,
            Math.floor(currentTime().getTime() / 1_000),
            candidate!.id,
            auditId
          ]
        }
      )
    }
    try {
      const results = await database.batch(statements)
      if ((results[0]?.changes ?? 0) < 1 || (changed && results[3]?.changes !== 1))
        throw new Error('bootstrap target changed concurrently')
    } catch (cause) {
      throw unavailable(cause)
    }
    return {
      operatorId: candidate!.id,
      enrollmentRequired: true as const,
      changed
    }
  }

  const recover = async (request: RecoverSystemOperatorRequest) => {
    const email = normalizedTarget(request.email)
    const policyReason = targetPolicyReason({
      ...request,
      requireConfirmation: true
    })
    let candidate: IdentityRow | null
    try {
      candidate = await database.first<IdentityRow>(targetIdentity(email))
    } catch (cause) {
      throw unavailable(cause)
    }
    const reason =
      policyReason ??
      identityRejection(candidate) ??
      (candidate?.identity_class === 'system_operator'
        ? null
        : 'target identity is not a System Operator')
    if (reason)
      return rejectWithAudit({
        action: 'recovery',
        request,
        targetId: candidate?.id ?? null,
        reason
      })

    const occurredAt = currentTime()
    const epoch = Math.floor(occurredAt.getTime() / 1_000)
    const auditId = nextId()
    const revocationStatements = activeImpersonationRevocationStatements({
      selector: { operatorId: candidate!.id },
      cause: 'totp-unenrolled',
      occurredAt,
      securityContact: options.securityContact,
      requireAuditEventId: auditId
    })
    try {
      const results = await database.batch([
        {
          ...auditStatement({
            id: auditId,
            eventType: 'operations.operator.recovery.accepted',
            targetId: candidate!.id,
            actor: request.actor,
            targetEmail: email,
            result: 'accepted',
            environment: request.environment,
            occurredAt: occurredAt.toISOString(),
            condition: {
              sql: `EXISTS (
                        SELECT 1 FROM user AS target
                        WHERE target.id = ?6
                          AND target.identityClass = 'system_operator'
                          AND target.emailVerified = 1
                          AND (target.banned IS NULL OR target.banned = 0)
                          AND NOT EXISTS (
                            SELECT 1 FROM merchant_memberships WHERE user_id = target.id
                          )
                      )`,
              params: [candidate!.id]
            }
          })
        },
        ...revocationStatements,
        {
          sql: `DELETE FROM session WHERE impersonatedBy = ?1
                  AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?2)`,
          params: [candidate!.id, auditId]
        },
        {
          sql: `DELETE FROM session WHERE userId = ?1
                  AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?2)`,
          params: [candidate!.id, auditId]
        },
        {
          sql: `DELETE FROM twoFactor WHERE userId = ?1
                  AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?2)`,
          params: [candidate!.id, auditId]
        },
        {
          sql: `UPDATE user SET twoFactorEnabled = 0, updatedAt = ?1
                  WHERE id = ?2 AND identityClass = 'system_operator'
                    AND EXISTS (SELECT 1 FROM audit_events WHERE id = ?3)`,
          params: [epoch, candidate!.id, auditId]
        }
      ])
      const targetUpdate = results[revocationStatements.length + 4]
      if ((results[0]?.changes ?? 0) < 1 || targetUpdate?.changes !== 1)
        throw new Error('recovery target changed concurrently')
    } catch (cause) {
      throw unavailable(cause)
    }
    return { operatorId: candidate!.id, enrollmentRequired: true as const }
  }

  const maintenanceError = (cause: unknown) =>
    cause instanceof OperatorMaintenanceRejected ||
    cause instanceof CapabilityUnavailable
      ? cause
      : unavailable(cause)

  return {
    bootstrap: (request: BootstrapSystemOperatorRequest) =>
      Effect.tryPromise({ try: () => bootstrap(request), catch: maintenanceError }),
    recover: (request: RecoverSystemOperatorRequest) =>
      Effect.tryPromise({ try: () => recover(request), catch: maintenanceError })
  }
}

export const makeSystemOperatorMaintenanceLayer = (
  database: OperatorMaintenanceDatabase,
  options: MaintenanceOptions
): Layer.Layer<SystemOperatorMaintenance> =>
  Layer.succeed(SystemOperatorMaintenance)(
    makeSystemOperatorMaintenance(database, options)
  )

const bind = (
  d1: D1Database,
  statement: OperatorMaintenanceStatement
): D1PreparedStatement => d1.prepare(statement.sql).bind(...statement.params)

export const makeD1OperatorMaintenanceDatabase = (
  d1: D1Database
): OperatorMaintenanceDatabase => ({
  first: (statement) => bind(d1, statement).first(),
  batch: async (statements) => {
    const results = await d1.batch(statements.map((statement) => bind(d1, statement)))
    return results.map((result: D1Result<unknown>) => ({
      changes: result.meta.changes ?? 0
    }))
  }
})
