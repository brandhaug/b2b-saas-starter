import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { auditEvents, session, user } from '@b2b-saas-starter/db'
import {
  OperationsAuthorization,
  OperationsContractDenied,
  OperatorSessionReference,
  hasOperatorPermission,
  makeOperationsAuthorizationLayer,
  operatorRoleNames,
  type OperatorRole
} from './operations-contracts.ts'
import { CapabilityUnavailable } from '../errors.ts'
import { activeImpersonationRevocationStatements } from './operations-impersonation-revocation.ts'

const ManagedOperatorEnrollmentState = Schema.Literals(['complete', 'incomplete'])

const managementUnavailable = () =>
  new CapabilityUnavailable({
    capability: 'operations-management',
    reason: 'D1 operation failed'
  })

const authorizeOperator = (
  db: PromiseDrizzleDatabase,
  reference: OperatorSessionReference,
  now?: Date
) =>
  Effect.gen(function* () {
    const authorization = yield* OperationsAuthorization
    return yield* authorization.authorize(reference, now)
  }).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))

export const OperatorActiveSession = Schema.Struct({
  active: Schema.Boolean,
  idleExpiresAt: Schema.NullOr(Schema.Date),
  absoluteExpiresAt: Schema.NullOr(Schema.Date)
})

export const ManagedOperator = Schema.Struct({
  id: Schema.String,
  email: Schema.String,
  name: Schema.String,
  enabled: Schema.Boolean,
  enrollmentState: ManagedOperatorEnrollmentState,
  roles: Schema.Array(Schema.Literals(operatorRoleNames)),
  activeSession: OperatorActiveSession,
  createdAt: Schema.Date,
  updatedAt: Schema.Date,
  lastSignInAt: Schema.NullOr(Schema.Date)
})
export type ManagedOperator = typeof ManagedOperator.Type

export const UpdateOperatorRolesRequest = Schema.Struct({
  actor: OperatorSessionReference,
  targetOperatorId: Schema.String,
  expectedUpdatedAt: Schema.Date,
  roles: Schema.Array(Schema.Literals(operatorRoleNames)),
  now: Schema.optional(Schema.Date)
})
export type UpdateOperatorRolesInput = typeof UpdateOperatorRolesRequest.Type

export const SetOperatorEnabledRequest = Schema.Struct({
  actor: OperatorSessionReference,
  targetOperatorId: Schema.String,
  expectedUpdatedAt: Schema.Date,
  enabled: Schema.Boolean,
  now: Schema.optional(Schema.Date)
})
export type SetOperatorEnabledInput = typeof SetOperatorEnabledRequest.Type

export const DeleteOperatorRequest = Schema.Struct({
  actor: OperatorSessionReference,
  targetOperatorId: Schema.String,
  expectedUpdatedAt: Schema.Date,
  now: Schema.optional(Schema.Date)
})
export type DeleteOperatorInput = typeof DeleteOperatorRequest.Type

export class OperationsManagement extends Context.Service<
  OperationsManagement,
  {
    readonly list: (
      actor: OperatorSessionReference,
      now?: Date
    ) => Effect.Effect<
      readonly ManagedOperator[],
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly updateRoles: (
      input: UpdateOperatorRolesInput
    ) => Effect.Effect<void, OperationsContractDenied | CapabilityUnavailable>
    readonly setEnabled: (
      input: SetOperatorEnabledInput
    ) => Effect.Effect<void, OperationsContractDenied | CapabilityUnavailable>
    readonly deleteOperator: (
      input: DeleteOperatorInput
    ) => Effect.Effect<void, OperationsContractDenied | CapabilityUnavailable>
  }
>()('@b2b-saas-starter/capabilities/OperationsManagement') {}

const canonicalRoles = (roles: readonly OperatorRole[]): OperatorRole[] =>
  operatorRoleNames.filter((role) => roles.includes(role))

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

const hasManagementPermission = (roles: readonly OperatorRole[]): boolean =>
  hasOperatorPermission(roles, 'operator:manage')

const managerRoleSql = sql`instr(',' || coalesce(${user.role}, '') || ',', ',operator-manager,') > 0`

const anotherEnabledManager = (targetOperatorId: string) =>
  sql`exists (
    select 1 from user as enabled_manager
    where enabled_manager.id <> ${targetOperatorId}
      and enabled_manager.identityClass = 'system_operator'
      and enabled_manager.banned = 0
      and instr(',' || coalesce(enabled_manager.role, '') || ',', ',operator-manager,') > 0
  )`

const mutationTime = (expected: Date, requested?: Date): Date =>
  new Date(
    Math.ceil(
      Math.max(requested?.getTime() ?? Date.now(), expected.getTime() + 1_000) / 1_000
    ) * 1_000
  )

type CompiledQuery = { readonly sql: string; readonly params: readonly unknown[] }
type Statement = { readonly toSQL: () => CompiledQuery }
type MutationResult = { readonly meta?: { readonly changes?: number } }
type RawD1 = {
  readonly prepare: (query: string) => {
    readonly bind: (...params: readonly unknown[]) => unknown
  }
  readonly batch: (statements: unknown[]) => Promise<MutationResult[]>
}

const runAtomic = async (
  db: PromiseDrizzleDatabase,
  statements: readonly Statement[]
): Promise<readonly MutationResult[]> => {
  const raw = db.$client as unknown as RawD1
  const queries = statements.map((statement) => statement.toSQL() as CompiledQuery)
  return raw.batch(queries.map((query) => raw.prepare(query.sql).bind(...query.params)))
}

const asStatements = (
  statements: readonly { readonly sql: string; readonly params: readonly unknown[] }[]
): readonly Statement[] => statements.map((statement) => ({ toSQL: () => statement }))

const conditionalInsertAfterChange = (statement: Statement): Statement => ({
  toSQL: () => {
    const query = statement.toSQL()
    const marker = ' values ('
    const markerIndex = query.sql.lastIndexOf(marker)
    const values = query.sql.slice(markerIndex + marker.length, -1)
    return {
      sql: `${query.sql.slice(0, markerIndex)} select ${values} where changes() > 0`,
      params: query.params
    }
  }
})

const auditInsert =
  (input: {
    readonly id?: string
    readonly actorId: string
    readonly actorName?: string | undefined
    readonly actorSessionId?: string | undefined
    readonly targetId: string
    readonly eventType: string
    readonly result: 'accepted' | 'rejected'
    readonly occurredAt: Date
    readonly details?: Record<string, unknown>
  }) =>
  ({ db }: { readonly db: PromiseDrizzleDatabase }) =>
    db.insert(auditEvents).values({
      id: input.id ?? `oaud_${crypto.randomUUID()}`,
      actorUserId: input.actorId,
      merchantId: null,
      eventType: input.eventType,
      targetType: 'system_operator',
      targetId: input.targetId,
      metadata: {
        actorName: input.actorName ?? input.actorId,
        operatorSessionId: input.actorSessionId ?? null,
        result: input.result,
        ...input.details
      },
      createdAt: input.occurredAt.toISOString()
    })

const rejectWithAudit = async (
  db: PromiseDrizzleDatabase,
  input: {
    readonly actorId: string
    readonly actorName?: string | undefined
    readonly actorSessionId?: string | undefined
    readonly targetId: string
    readonly eventType: string
    readonly reason: string
    readonly occurredAt: Date
  }
): Promise<never> => {
  await auditInsert({
    actorId: input.actorId,
    actorName: input.actorName,
    actorSessionId: input.actorSessionId,
    targetId: input.targetId,
    eventType: input.eventType,
    result: 'rejected',
    occurredAt: input.occurredAt,
    details: { reason: input.reason }
  })({ db })
  throw new OperationsContractDenied({ reason: input.reason })
}

const authorizeManager = async (
  db: PromiseDrizzleDatabase,
  actor: OperatorSessionReference,
  targetId: string,
  eventType: string,
  occurredAt: Date
) => {
  const principal = await Effect.runPromise(authorizeOperator(db, actor, occurredAt))
  if (!hasManagementPermission(principal.roles)) {
    await rejectWithAudit(db, {
      actorId: principal.id,
      actorName: principal.name,
      actorSessionId: principal.sessionId,
      targetId,
      eventType,
      reason: 'operator management is not authorized',
      occurredAt
    })
  }
  if (principal.id === targetId) {
    await rejectWithAudit(db, {
      actorId: principal.id,
      actorName: principal.name,
      actorSessionId: principal.sessionId,
      targetId,
      eventType,
      reason: 'operators cannot manage themselves',
      occurredAt
    })
  }
  return principal
}

const rejectionReason = async (
  db: PromiseDrizzleDatabase,
  targetId: string,
  expectedUpdatedAt: Date,
  protectsManager: boolean
): Promise<string> => {
  const [target] = await db
    .select({ updatedAt: user.updatedAt, role: user.role, banned: user.banned })
    .from(user)
    .where(and(eq(user.id, targetId), eq(user.identityClass, 'system_operator')))
    .limit(1)
  if (!target) return 'operator was not found'
  if (target.updatedAt.getTime() !== expectedUpdatedAt.getTime())
    return 'operator management page is stale'
  if (
    protectsManager &&
    !target.banned &&
    parseRoles(target.role).includes('operator-manager')
  )
    return 'the last enabled Operator Manager cannot be changed'
  return 'operator management was rejected'
}

export const makeOperationsManagementLayer = (
  db: PromiseDrizzleDatabase,
  options: { readonly securityContact: string }
): Layer.Layer<OperationsManagement> =>
  Layer.succeed(OperationsManagement)({
    list: (actor, requestedNow) =>
      Effect.gen(function* () {
        const principal = yield* authorizeOperator(db, actor, requestedNow)
        if (!hasManagementPermission(principal.roles)) {
          yield* Effect.tryPromise({
            try: () =>
              auditInsert({
                actorId: principal.id,
                actorName: principal.name,
                actorSessionId: principal.sessionId,
                targetId: principal.id,
                eventType: 'operator.list_rejected',
                result: 'rejected',
                occurredAt: requestedNow ?? new Date(),
                details: { reason: 'operator management is not authorized' }
              })({ db }),
            catch: managementUnavailable
          })
          return yield* new OperationsContractDenied({
            reason: 'operator management is not authorized'
          })
        }
        const now = requestedNow ?? new Date()
        return yield* Effect.tryPromise({
          try: async () => {
            const rows = await db
              .select()
              .from(user)
              .where(eq(user.identityClass, 'system_operator'))
              .orderBy(asc(user.name), asc(user.email))
            const operatorIds = rows.map((operator) => operator.id)
            const sessions = operatorIds.length
              ? await db
                  .select()
                  .from(session)
                  .where(inArray(session.userId, operatorIds))
                  .orderBy(desc(session.createdAt))
              : []
            const latestSession = new Map<string, (typeof sessions)[number]>()
            for (const operatorSession of sessions) {
              if (!latestSession.has(operatorSession.userId))
                latestSession.set(operatorSession.userId, operatorSession)
            }
            return rows.map((operator) => {
              const activeSession = latestSession.get(operator.id)
              const idleExpiresAt = activeSession?.operatorIdleExpiresAt ?? null
              const absoluteExpiresAt = activeSession?.operatorAbsoluteExpiresAt ?? null
              const active = Boolean(
                idleExpiresAt &&
                absoluteExpiresAt &&
                activeSession &&
                now < activeSession.expiresAt &&
                now < idleExpiresAt &&
                now < absoluteExpiresAt
              )
              return {
                id: operator.id,
                email: operator.email,
                name: operator.name,
                enabled: !operator.banned,
                enrollmentState:
                  operator.emailVerified && operator.twoFactorEnabled
                    ? ('complete' as const)
                    : ('incomplete' as const),
                roles: parseRoles(operator.role),
                activeSession: {
                  active,
                  idleExpiresAt: active ? idleExpiresAt : null,
                  absoluteExpiresAt: active ? absoluteExpiresAt : null
                },
                createdAt: operator.createdAt,
                updatedAt: operator.updatedAt,
                lastSignInAt: activeSession?.createdAt ?? null
              }
            })
          },
          catch: managementUnavailable
        })
      }),
    updateRoles: (input) =>
      Effect.tryPromise({
        try: async () => {
          const occurredAt = mutationTime(input.expectedUpdatedAt, input.now)
          const actor = await authorizeManager(
            db,
            input.actor,
            input.targetOperatorId,
            'operator.roles.update_rejected',
            input.now ?? occurredAt
          )
          const roles = canonicalRoles(input.roles)
          const keepsManager = roles.includes('operator-manager')
          const update = db
            .update(user)
            .set({ role: roles.join(','), updatedAt: occurredAt })
            .where(
              and(
                eq(user.id, input.targetOperatorId),
                eq(user.identityClass, 'system_operator'),
                eq(user.updatedAt, input.expectedUpdatedAt),
                or(
                  sql`not (${managerRoleSql})`,
                  keepsManager
                    ? sql`1 = 1`
                    : anotherEnabledManager(input.targetOperatorId)
                )
              )
            )
          const managementAuditId = `oaud_${crypto.randomUUID()}`
          const audit = auditInsert({
            id: managementAuditId,
            actorId: actor.id,
            actorName: actor.name,
            actorSessionId: actor.sessionId,
            targetId: input.targetOperatorId,
            eventType: 'operator.roles.updated',
            result: 'accepted',
            occurredAt: input.now ?? occurredAt,
            details: { roles }
          })({ db })
          const results = await runAtomic(db, [
            update,
            conditionalInsertAfterChange(audit),
            ...(hasOperatorPermission(roles, 'merchant:impersonate')
              ? []
              : asStatements(
                  activeImpersonationRevocationStatements({
                    selector: { operatorId: input.targetOperatorId },
                    cause: 'permission-removed',
                    occurredAt: input.now ?? occurredAt,
                    requireAuditEventId: managementAuditId,
                    securityContact: options.securityContact
                  })
                ))
          ])
          if ((results[0]?.meta?.changes ?? 0) === 0) {
            const reason = await rejectionReason(
              db,
              input.targetOperatorId,
              input.expectedUpdatedAt,
              !keepsManager
            )
            await rejectWithAudit(db, {
              actorId: actor.id,
              actorName: actor.name,
              actorSessionId: actor.sessionId,
              targetId: input.targetOperatorId,
              eventType: 'operator.roles.update_rejected',
              reason,
              occurredAt: input.now ?? occurredAt
            })
          }
        },
        catch: (cause) =>
          cause instanceof OperationsContractDenied ? cause : managementUnavailable()
      }),
    setEnabled: (input) =>
      Effect.tryPromise({
        try: async () => {
          const occurredAt = mutationTime(input.expectedUpdatedAt, input.now)
          const action = input.enabled ? 'enabled' : 'disabled'
          const actor = await authorizeManager(
            db,
            input.actor,
            input.targetOperatorId,
            `operator.${action}_rejected`,
            input.now ?? occurredAt
          )
          const update = db
            .update(user)
            .set({ banned: !input.enabled, updatedAt: occurredAt })
            .where(
              and(
                eq(user.id, input.targetOperatorId),
                eq(user.identityClass, 'system_operator'),
                eq(user.updatedAt, input.expectedUpdatedAt),
                input.enabled
                  ? sql`1 = 1`
                  : or(
                      sql`not (${managerRoleSql})`,
                      anotherEnabledManager(input.targetOperatorId)
                    )
              )
            )
          const managementAuditId = `oaud_${crypto.randomUUID()}`
          const revoke = db
            .delete(session)
            .where(
              and(
                eq(session.userId, input.targetOperatorId),
                sql`exists (select 1 from ${auditEvents} where ${auditEvents.id} = ${managementAuditId})`
              )
            )
          const audit = auditInsert({
            id: managementAuditId,
            actorId: actor.id,
            actorName: actor.name,
            actorSessionId: actor.sessionId,
            targetId: input.targetOperatorId,
            eventType: `operator.${action}`,
            result: 'accepted',
            occurredAt: input.now ?? occurredAt
          })({ db })
          const results = await runAtomic(db, [
            update,
            conditionalInsertAfterChange(audit),
            ...(input.enabled ? [] : [revoke]),
            ...(input.enabled
              ? []
              : asStatements(
                  activeImpersonationRevocationStatements({
                    selector: { operatorId: input.targetOperatorId },
                    cause: 'operator-disabled',
                    occurredAt: input.now ?? occurredAt,
                    requireAuditEventId: managementAuditId,
                    securityContact: options.securityContact
                  })
                ))
          ])
          if ((results[0]?.meta?.changes ?? 0) === 0) {
            const reason = await rejectionReason(
              db,
              input.targetOperatorId,
              input.expectedUpdatedAt,
              !input.enabled
            )
            await rejectWithAudit(db, {
              actorId: actor.id,
              actorName: actor.name,
              actorSessionId: actor.sessionId,
              targetId: input.targetOperatorId,
              eventType: `operator.${action}_rejected`,
              reason,
              occurredAt: input.now ?? occurredAt
            })
          }
        },
        catch: (cause) =>
          cause instanceof OperationsContractDenied ? cause : managementUnavailable()
      }),
    deleteOperator: (input) =>
      Effect.tryPromise({
        try: async () => {
          const occurredAt = input.now ?? new Date()
          const actor = await authorizeManager(
            db,
            input.actor,
            input.targetOperatorId,
            'operator.delete_rejected',
            occurredAt
          )
          const remove = db
            .delete(user)
            .where(
              and(
                eq(user.id, input.targetOperatorId),
                eq(user.identityClass, 'system_operator'),
                eq(user.updatedAt, input.expectedUpdatedAt),
                or(
                  sql`not (${managerRoleSql})`,
                  anotherEnabledManager(input.targetOperatorId)
                )
              )
            )
          const audit = auditInsert({
            actorId: actor.id,
            actorName: actor.name,
            actorSessionId: actor.sessionId,
            targetId: input.targetOperatorId,
            eventType: 'operator.deleted',
            result: 'accepted',
            occurredAt
          })({ db })
          const results = await runAtomic(db, [
            remove,
            conditionalInsertAfterChange(audit)
          ])
          if ((results[0]?.meta?.changes ?? 0) === 0) {
            const reason = await rejectionReason(
              db,
              input.targetOperatorId,
              input.expectedUpdatedAt,
              true
            )
            await rejectWithAudit(db, {
              actorId: actor.id,
              actorName: actor.name,
              actorSessionId: actor.sessionId,
              targetId: input.targetOperatorId,
              eventType: 'operator.delete_rejected',
              reason,
              occurredAt
            })
          }
        },
        catch: (cause) =>
          cause instanceof OperationsContractDenied ? cause : managementUnavailable()
      })
  })
