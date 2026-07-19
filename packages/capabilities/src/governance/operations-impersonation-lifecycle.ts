import { Context, Effect, Layer } from 'effect'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { OperationsContractDenied } from './operations-contracts.ts'

export const impersonationRevocationCauses = [
  'administrative-revocation',
  'operator-disabled',
  'operator-session-revoked',
  'operator-session-replaced',
  'totp-unenrolled',
  'permission-removed',
  'target-disabled',
  'membership-changed',
  'merchant-disabled',
  'security-state-revoked'
] as const

export type ImpersonationRevocationCause =
  (typeof impersonationRevocationCauses)[number]

export type ImpersonationLifecyclePresentation = {
  readonly state: 'active'
  readonly targetMemberId: string
  readonly targetMemberName: string
  readonly merchantId: string
  readonly merchantName: string
  readonly expiresAt: string
}

export type ImpersonationLifecycleTermination = {
  readonly state: 'terminated'
  readonly lifecycle: 'stopped' | 'expired' | 'revoked'
  readonly terminationCause:
    | 'manual-stop'
    | 'absolute-timeout'
    | ImpersonationRevocationCause
  readonly targetMemberId: string
  readonly merchantId: string
}

export type ImpersonationLifecycleResolution =
  | ImpersonationLifecyclePresentation
  | ImpersonationLifecycleTermination

export class OperationsImpersonationLifecycle extends Context.Service<
  OperationsImpersonationLifecycle,
  {
    readonly resolve: (input: {
      readonly merchantSessionId: string
    }) => Effect.Effect<
      ImpersonationLifecycleResolution,
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly stop: (input: {
      readonly merchantSessionId: string
    }) => Effect.Effect<
      ImpersonationLifecycleTermination,
      OperationsContractDenied | CapabilityUnavailable
    >
    readonly revoke: (input: {
      readonly merchantSessionId: string
      readonly cause: ImpersonationRevocationCause
    }) => Effect.Effect<
      ImpersonationLifecycleTermination,
      OperationsContractDenied | CapabilityUnavailable
    >
  }
>()('@b2b-saas-starter/capabilities/OperationsImpersonationLifecycle') {}

type LifecycleRow = {
  readonly impersonationId: string
  readonly operatorId: string
  readonly operatorName: string
  readonly operatorSessionId: string
  readonly targetMemberId: string
  readonly targetMemberName: string
  readonly targetEmail: string
  readonly merchantId: string
  readonly merchantName: string
  readonly merchantSessionId: string
  readonly lifecycle: string
  readonly activeExpiresAt: number | null
  readonly terminationCause: string | null
  readonly internalReason: string
  readonly supportReference: string | null
}

type RawD1Result = { readonly meta?: { readonly changes?: number } }
type RawD1 = {
  readonly prepare: (sql: string) => {
    readonly bind: (...values: readonly unknown[]) => {
      readonly first: <A>() => Promise<A | null>
    }
  }
  readonly batch: (statements: readonly unknown[]) => Promise<RawD1Result[]>
}

type TerminalLifecycle = ImpersonationLifecycleTermination['lifecycle']
type TerminationCause = ImpersonationLifecycleTermination['terminationCause']
const terminationCauses = new Set<string>([
  'manual-stop',
  'absolute-timeout',
  ...impersonationRevocationCauses
])

const isTerminationCause = (value: string): value is TerminationCause =>
  terminationCauses.has(value)

const denied = () =>
  new OperationsContractDenied({ reason: 'impersonation lifecycle is unavailable' })

const unavailable = () =>
  new CapabilityUnavailable({
    capability: 'operations-impersonation-lifecycle',
    reason: 'impersonation lifecycle persistence is unavailable'
  })

const twoYearsAfter = (occurredAt: Date): string => {
  const retained = new Date(occurredAt)
  retained.setUTCFullYear(retained.getUTCFullYear() + 2)
  return retained.toISOString()
}

const terminalResult = (row: LifecycleRow): ImpersonationLifecycleTermination => {
  if (
    (row.lifecycle !== 'stopped' &&
      row.lifecycle !== 'expired' &&
      row.lifecycle !== 'revoked') ||
    !row.terminationCause ||
    !isTerminationCause(row.terminationCause)
  ) {
    throw denied()
  }
  return {
    state: 'terminated',
    lifecycle: row.lifecycle,
    terminationCause: row.terminationCause,
    targetMemberId: row.targetMemberId,
    merchantId: row.merchantId
  }
}

export const makeOperationsImpersonationLifecycleLayer = (
  db: PromiseDrizzleDatabase,
  options: {
    readonly now?: () => Date
    readonly securityContact: string
    readonly notificationIntentId?: (event: string) => string
    readonly auditEventId?: (event: string) => string
  }
): Layer.Layer<OperationsImpersonationLifecycle> => {
  const raw = db.$client as unknown as RawD1
  const now = options.now ?? (() => new Date())
  const notificationIntentId =
    options.notificationIntentId ?? ((event: string) => `opnti_${event}`)
  const auditEventId = options.auditEventId ?? ((event: string) => `oaud_${event}`)
  const securityContact = options.securityContact.trim()

  const read = (merchantSessionId: string): Promise<LifecycleRow | null> =>
    raw
      .prepare(
        `SELECT
           record.id AS impersonationId,
           record.operator_id AS operatorId,
           coalesce(operator.name, record.operator_id) AS operatorName,
           record.operator_session_id AS operatorSessionId,
           record.target_member_id AS targetMemberId,
           coalesce(target.name, record.target_member_id) AS targetMemberName,
           coalesce(target.email, '') AS targetEmail,
           record.merchant_id AS merchantId,
           coalesce(merchant.public_name, record.merchant_id) AS merchantName,
           record.merchant_session_id AS merchantSessionId,
           record.lifecycle AS lifecycle,
           record.active_expires_at AS activeExpiresAt,
           record.termination_cause AS terminationCause,
           record.reason AS internalReason,
           record.support_reference AS supportReference
         FROM impersonation_records AS record
         LEFT JOIN user AS operator ON operator.id = record.operator_id
         LEFT JOIN user AS target ON target.id = record.target_member_id
         LEFT JOIN merchants AS merchant ON merchant.id = record.merchant_id
         WHERE record.merchant_session_id = ?1
         LIMIT 1`
      )
      .bind(merchantSessionId)
      .first<LifecycleRow>()

  const transition = async (
    row: LifecycleRow,
    lifecycle: TerminalLifecycle,
    cause: TerminationCause,
    occurredAt: Date
  ): Promise<ImpersonationLifecycleTermination> => {
    if (!row.targetEmail) throw unavailable()
    if (row.lifecycle !== 'active') return terminalResult(row)

    const occurredAtIso = occurredAt.toISOString()
    const occurredAtEpoch = Math.floor(occurredAt.getTime() / 1_000)
    const eventType = `impersonation-${lifecycle}`
    const businessEventId = `impersonation:${row.impersonationId}:${lifecycle}`
    const statement = (sql: string, ...values: readonly unknown[]) =>
      raw.prepare(sql).bind(...values)
    const results = await raw.batch([
      statement(
        `UPDATE impersonation_records
         SET lifecycle = ?1, terminal_at = ?2, termination_cause = ?3,
             updated_at = ?4
         WHERE id = ?5 AND lifecycle = 'active'`,
        lifecycle,
        occurredAtEpoch,
        cause,
        occurredAtIso,
        row.impersonationId
      ),
      statement(
        `UPDATE session
         SET expiresAt = ?1, updatedAt = ?1
         WHERE id = ?2 AND EXISTS (
           SELECT 1 FROM impersonation_records
           WHERE id = ?3 AND lifecycle = ?4 AND updated_at = ?5
         )`,
        occurredAtEpoch,
        row.merchantSessionId,
        row.impersonationId,
        lifecycle,
        occurredAtIso
      ),
      statement(
        `INSERT INTO operations_notification_intents (
           id, impersonation_id, event_type, recipient_email,
           merchant_id, merchant_name, occurred_at, support_reference,
           security_contact, payload_json, status, available_at,
           created_at, updated_at
         )
         SELECT ?1, record.id, ?2, ?3, record.merchant_id, ?4, ?5,
                record.support_reference, ?6,
                json_object(
                  'merchant', ?4,
                  'timestamp', ?5,
                  'supportReference', record.support_reference,
                  'securityContact', ?6
                ),
                'pending', ?5, ?5, ?5
         FROM impersonation_records AS record
         WHERE record.id = ?7 AND record.lifecycle = ?8
           AND record.updated_at = ?5`,
        notificationIntentId(`${row.impersonationId}_${lifecycle}`),
        eventType,
        row.targetEmail,
        row.merchantName,
        occurredAtIso,
        securityContact,
        row.impersonationId,
        lifecycle
      ),
      statement(
        `INSERT INTO operations_audit_events (
           id, business_event_id, actor_operator_id, actor_display_name,
           operator_session_id, impersonation_id, target_id,
           target_display_name, merchant_id, merchant_display_name,
           action, result, occurred_at, retention_policy, retain_until,
           internal_reason, support_reference, created_at
         )
         SELECT ?1, ?2, record.operator_id, ?3,
                record.operator_session_id, record.id,
                record.target_member_id, ?4, record.merchant_id, ?5,
                ?6, 'accepted', ?7, 'impersonation-two-years', ?8,
                record.reason, record.support_reference, ?7
         FROM impersonation_records AS record
         WHERE record.id = ?9 AND record.lifecycle = ?10
           AND record.updated_at = ?7`,
        auditEventId(`${row.impersonationId}_${lifecycle}`),
        businessEventId,
        row.operatorName,
        row.targetMemberName,
        row.merchantName,
        `impersonation.${lifecycle}`,
        occurredAtIso,
        twoYearsAfter(occurredAt),
        row.impersonationId,
        lifecycle
      )
    ])
    if (results.some((result) => (result.meta?.changes ?? 0) !== 1)) throw unavailable()
    return {
      state: 'terminated',
      lifecycle,
      terminationCause: cause,
      targetMemberId: row.targetMemberId,
      merchantId: row.merchantId
    }
  }

  const resolve = async (
    merchantSessionId: string
  ): Promise<ImpersonationLifecycleResolution> => {
    const row = await read(merchantSessionId)
    if (!row) throw denied()
    if (row.lifecycle !== 'active') return terminalResult(row)
    const requestedAt = now()
    if (
      row.activeExpiresAt === null ||
      row.activeExpiresAt <= Math.floor(requestedAt.getTime() / 1_000)
    ) {
      return transition(row, 'expired', 'absolute-timeout', requestedAt)
    }
    return {
      state: 'active',
      targetMemberId: row.targetMemberId,
      targetMemberName: row.targetMemberName,
      merchantId: row.merchantId,
      merchantName: row.merchantName,
      expiresAt: new Date(row.activeExpiresAt * 1_000).toISOString()
    }
  }

  const effect = <A>(run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (error) =>
        error instanceof OperationsContractDenied ||
        error instanceof CapabilityUnavailable
          ? error
          : unavailable()
    })

  return Layer.succeed(OperationsImpersonationLifecycle)({
    resolve: ({ merchantSessionId }) => effect(() => resolve(merchantSessionId)),
    stop: ({ merchantSessionId }) =>
      effect(async () => {
        const resolved = await resolve(merchantSessionId)
        if (resolved.state === 'terminated') return resolved
        const row = await read(merchantSessionId)
        if (!row) throw denied()
        return transition(row, 'stopped', 'manual-stop', now())
      }),
    revoke: ({ merchantSessionId, cause }) =>
      effect(async () => {
        const resolved = await resolve(merchantSessionId)
        if (resolved.state === 'terminated') return resolved
        const row = await read(merchantSessionId)
        if (!row) throw denied()
        return transition(row, 'revoked', cause, now())
      })
  })
}
