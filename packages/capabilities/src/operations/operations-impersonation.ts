import { Effect, Layer } from 'effect'
import { and, eq } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  impersonationRecords,
  operationsAuditEvents,
  session,
  user
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import {
  operatorRoleRegistry,
  OperationsContractDenied,
  OperationsImpersonation,
  type OperatorPermission
} from './operations-contracts.ts'

const handoffLifetimeMs = 60_000
const impersonationLifetimeMs = 60 * 60_000
const recentTotpLifetimeMs = 5 * 60_000
const maximumReasonLength = 1_000
const maximumSupportReferenceLength = 200

type RawD1Result = { readonly meta?: { readonly changes?: number } }
type RawD1 = {
  readonly prepare: (query: string) => {
    readonly bind: (...params: readonly unknown[]) => unknown
  }
  readonly batch: (statements: readonly unknown[]) => Promise<RawD1Result[]>
}

type AttemptActor = {
  readonly id: string
  readonly name: string
  readonly sessionId: string
}

export type OperationsImpersonationOptions = {
  readonly now?: () => Date
  readonly id?: () => string
  readonly ticket?: () => string
  readonly sessionId?: () => string
  readonly sessionToken?: () => string
  readonly notificationIntentId?: () => string
  readonly securityContact?: string
}

const denied = (reason: string) => new OperationsContractDenied({ reason })
const unavailable = () =>
  new CapabilityUnavailable({
    capability: 'operations-impersonation',
    reason: 'impersonation handoff persistence is unavailable'
  })

const impersonationRoleNames = Object.entries(operatorRoleRegistry)
  .filter(([, role]) =>
    (role.permissions as readonly OperatorPermission[]).includes('merchant:impersonate')
  )
  .map(([role]) => role)

const randomTicket = (): string => {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

const randomSessionCredential = (): string => randomTicket()

const validHandoffTicket = (value: string): boolean => /^[A-Za-z0-9_-]{43}$/.test(value)

const sha256 = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

const twoYearsAfter = (occurredAt: Date): string => {
  const retained = new Date(occurredAt)
  retained.setUTCFullYear(retained.getUTCFullYear() + 2)
  return retained.toISOString()
}

const normalizedIntent = (input: {
  readonly reason: string
  readonly supportReference: string | null
}) => {
  const reason = input.reason.trim()
  const supportReference = input.supportReference?.trim() || null
  if (!reason || reason.length > maximumReasonLength)
    throw denied('impersonation reason is required')
  if (
    supportReference !== null &&
    supportReference.length > maximumSupportReferenceLength
  )
    throw denied('support reference is invalid')
  return { reason, supportReference }
}

const rejectionAudit = async (input: {
  readonly db: PromiseDrizzleDatabase
  readonly principal: AttemptActor
  readonly impersonationId: string | null
  readonly targetMemberId: string
  readonly merchantId: string
  readonly reason: string | null
  readonly supportReference: string | null
  readonly occurredAt: Date
  readonly eventId: string
}): Promise<void> => {
  await input.db.insert(operationsAuditEvents).values({
    id: `oaud_${input.eventId}`,
    businessEventId: `impersonation:start:${input.eventId}:rejected`,
    actorOperatorId: input.principal.id,
    actorDisplayName: input.principal.name,
    operatorSessionId: input.principal.sessionId,
    impersonationId: input.impersonationId,
    targetId: input.targetMemberId,
    targetDisplayName: input.targetMemberId,
    merchantId: input.merchantId,
    merchantDisplayName: input.merchantId,
    action: 'impersonation.start',
    result: 'rejected',
    occurredAt: input.occurredAt.toISOString(),
    retentionPolicy: 'impersonation-two-years',
    retainUntil: twoYearsAfter(input.occurredAt),
    internalReason: input.reason,
    supportReference: input.supportReference,
    createdAt: input.occurredAt.toISOString()
  })
}

const readAttemptActor = async (
  db: PromiseDrizzleDatabase,
  operatorSessionId: string
): Promise<AttemptActor | null> => {
  const [actor] = await db
    .select({ id: user.id, name: user.name, sessionId: session.id })
    .from(session)
    .innerJoin(user, eq(user.id, session.userId))
    .where(
      and(eq(session.id, operatorSessionId), eq(user.identityClass, 'system_operator'))
    )
    .limit(1)
  return actor ?? null
}

export const makeOperationsImpersonationLayer = (
  db: PromiseDrizzleDatabase,
  options: OperationsImpersonationOptions = {}
): Layer.Layer<OperationsImpersonation> => {
  const occurredAt = () => (options.now ?? (() => new Date()))()
  const rejection = async (
    request: Parameters<OperationsImpersonation['Service']['recordRejectedStart']>[0],
    principal: AttemptActor,
    at: Date,
    eventId: string
  ) =>
    rejectionAudit({
      db,
      principal,
      impersonationId: null,
      targetMemberId: request.targetMemberId,
      merchantId: request.merchantId,
      reason: request.reason.trim().slice(0, maximumReasonLength) || null,
      supportReference:
        request.supportReference?.trim().slice(0, maximumSupportReferenceLength) ||
        null,
      occurredAt: at,
      eventId
    })

  return Layer.succeed(OperationsImpersonation)({
    activate: (request) =>
      Effect.tryPromise({
        try: async () => {
          if (!validHandoffTicket(request.handoffTicket))
            throw denied('impersonation handoff was rejected')
          const activatedAt = occurredAt()
          const activatedAtEpoch = Math.floor(activatedAt.getTime() / 1_000)
          const activatedAtIso = activatedAt.toISOString()
          const activeExpiresAt = new Date(
            activatedAt.getTime() + impersonationLifetimeMs
          )
          const activeExpiresAtEpoch = Math.floor(activeExpiresAt.getTime() / 1_000)
          const totpCutoffEpoch = Math.floor(
            (activatedAt.getTime() - recentTotpLifetimeMs) / 1_000
          )
          const merchantSessionId = (
            options.sessionId ?? (() => `imp_session_${crypto.randomUUID()}`)
          )()
          const sessionToken = (options.sessionToken ?? randomSessionCredential)()
          const notificationIntentId = (
            options.notificationIntentId ?? (() => `opnti_${crypto.randomUUID()}`)
          )()
          const securityContact = options.securityContact?.trim()
          if (!securityContact) throw unavailable()
          const ticketHash = await sha256(request.handoffTicket)
          const [pending] = await db
            .select({ lifecycle: impersonationRecords.lifecycle })
            .from(impersonationRecords)
            .where(eq(impersonationRecords.ticketHash, ticketHash))
            .limit(1)
          if (pending?.lifecycle !== 'pending-handoff')
            throw denied('impersonation handoff was rejected')
          const raw = db.$client as unknown as RawD1
          const statement = (sql: string, ...params: readonly unknown[]) =>
            raw.prepare(sql).bind(...params)
          const auditId = crypto.randomUUID()
          const retainUntil = twoYearsAfter(activatedAt)
          const results = await raw.batch([
            statement(
              `UPDATE impersonation_records AS record
               SET lifecycle = 'active', merchant_session_id = ?1,
                   active_expires_at = ?2, updated_at = ?3
               WHERE record.ticket_hash = ?4
                 AND record.lifecycle = 'pending-handoff'
                 AND record.merchant_session_id IS NULL
                 AND record.handoff_expires_at > ?5
                 AND NOT EXISTS (
                   SELECT 1 FROM impersonation_records AS other_operator
                   WHERE other_operator.id <> record.id
                     AND other_operator.operator_id = record.operator_id
                     AND other_operator.lifecycle IN ('pending-handoff', 'active')
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM impersonation_records AS other_target
                   WHERE other_target.id <> record.id
                     AND other_target.target_member_id = record.target_member_id
                     AND other_target.lifecycle IN ('pending-handoff', 'active')
                 )
                 AND EXISTS (
                   SELECT 1
                   FROM session AS operator_session
                   JOIN user AS operator ON operator.id = operator_session.userId
                   JOIN twoFactor AS factor ON factor.userId = operator.id
                   WHERE operator_session.id = record.operator_session_id
                     AND operator_session.userId = record.operator_id
                     AND operator.identityClass = 'system_operator'
                     AND operator.emailVerified = 1
                     AND operator.twoFactorEnabled = 1
                     AND (operator.banned IS NULL OR operator.banned = 0)
                     AND operator_session.expiresAt > ?5
                     AND operator_session.operatorIdleExpiresAt > ?5
                     AND operator_session.operatorAbsoluteExpiresAt > ?5
                     AND operator_session.operatorTotpVerifiedAt >= ?6
                     AND operator_session.operatorTotpVerifiedAt <= ?5
                     AND factor.verified = 1
                     AND (factor.lockedUntil IS NULL OR factor.lockedUntil <= ?5)
                     AND EXISTS (
                       SELECT 1 FROM json_each(?7) AS permitted_role
                       WHERE instr(
                         ',' || coalesce(operator.role, '') || ',',
                         ',' || permitted_role.value || ','
                       ) > 0
                     )
                 )
                 AND EXISTS (
                   SELECT 1
                   FROM user AS target
                   JOIN merchant_memberships AS membership
                     ON membership.user_id = target.id
                   JOIN merchants AS merchant
                     ON merchant.id = membership.merchant_id
                   WHERE target.id = record.target_member_id
                     AND membership.merchant_id = record.merchant_id
                     AND target.identityClass = 'merchant_member'
                     AND (target.banned IS NULL OR target.banned = 0)
                     AND merchant.status = 'enabled'
                 )`,
              merchantSessionId,
              activeExpiresAtEpoch,
              activatedAtIso,
              ticketHash,
              activatedAtEpoch,
              totpCutoffEpoch,
              JSON.stringify(impersonationRoleNames)
            ),
            statement(
              `INSERT INTO session (
                 id, expiresAt, token, createdAt, updatedAt, userId, impersonatedBy
               )
               SELECT ?1, ?2, ?3, ?4, ?4, record.target_member_id,
                      record.operator_id
               FROM impersonation_records AS record
               WHERE record.ticket_hash = ?5
                 AND record.lifecycle = 'active'
                 AND record.merchant_session_id = ?1
                 AND record.updated_at = ?6`,
              merchantSessionId,
              activeExpiresAtEpoch,
              sessionToken,
              activatedAtEpoch,
              ticketHash,
              activatedAtIso
            ),
            statement(
              `INSERT INTO operations_notification_intents (
                 id, impersonation_id, event_type, recipient_email,
                 merchant_id, merchant_name, occurred_at, support_reference,
                 security_contact, payload_json, status, available_at,
                 created_at, updated_at
               )
               SELECT ?1, record.id, 'impersonation-started', target.email,
                      merchant.id, merchant.public_name, ?2,
                      record.support_reference, ?3,
                      json_object(
                        'merchant', merchant.public_name,
                        'timestamp', ?2,
                        'supportReference', record.support_reference,
                        'securityContact', ?3
                      ),
                      'pending', ?2, ?2, ?2
               FROM impersonation_records AS record
               JOIN user AS target ON target.id = record.target_member_id
               JOIN merchants AS merchant ON merchant.id = record.merchant_id
               WHERE record.ticket_hash = ?4
                 AND record.lifecycle = 'active'
                 AND record.merchant_session_id = ?5
                 AND record.updated_at = ?2`,
              notificationIntentId,
              activatedAtIso,
              securityContact,
              ticketHash,
              merchantSessionId
            ),
            statement(
              `INSERT INTO operations_audit_events (
                 id, business_event_id, actor_operator_id, actor_display_name,
                 operator_session_id, impersonation_id, target_id,
                 target_display_name, merchant_id, merchant_display_name,
                 action, result, occurred_at, retention_policy, retain_until,
                 internal_reason, support_reference, created_at
               )
               SELECT ?1, 'impersonation:' || record.id || ':activated',
                      record.operator_id, operator.name,
                      record.operator_session_id, record.id,
                      record.target_member_id, target.name,
                      record.merchant_id, merchant.public_name,
                      'impersonation.activated', 'accepted', ?2,
                      'impersonation-two-years', ?3, record.reason,
                      record.support_reference, ?2
               FROM impersonation_records AS record
               JOIN user AS operator ON operator.id = record.operator_id
               JOIN user AS target ON target.id = record.target_member_id
               JOIN merchants AS merchant ON merchant.id = record.merchant_id
               WHERE record.ticket_hash = ?4
                 AND record.lifecycle = 'active'
                 AND record.merchant_session_id = ?5
                 AND record.updated_at = ?2`,
              `oaud_${auditId}`,
              activatedAtIso,
              retainUntil,
              ticketHash,
              merchantSessionId
            )
          ])
          if (results.slice(0, 4).some((result) => (result.meta?.changes ?? 0) !== 1))
            throw denied('impersonation handoff was rejected')
          const [record] = await db
            .select({ id: impersonationRecords.id })
            .from(impersonationRecords)
            .where(eq(impersonationRecords.merchantSessionId, merchantSessionId))
            .limit(1)
          if (!record) throw unavailable()
          return {
            impersonationId: record.id,
            lifecycle: 'active' as const,
            merchantSessionId,
            sessionToken,
            expiresAt: activeExpiresAt.toISOString()
          }
        },
        catch: (error) =>
          error instanceof OperationsContractDenied
            ? error
            : error instanceof CapabilityUnavailable
              ? error
              : unavailable()
      }),
    recordRejectedStart: (request) =>
      Effect.tryPromise({
        try: async () => {
          const at = occurredAt()
          const actor = await readAttemptActor(db, request.actor.operatorSessionId)
          if (!actor) throw denied('operator session is not authorized')
          await rejection(request, actor, at, crypto.randomUUID())
        },
        catch: (error) =>
          error instanceof OperationsContractDenied ? error : unavailable()
      }),
    start: (request) =>
      Effect.tryPromise({
        try: async () => {
          const startAt = occurredAt()
          const eventId = crypto.randomUUID()
          const actor = await readAttemptActor(db, request.actor.operatorSessionId)
          if (!actor) throw denied('operator session is not authorized')
          let intent: ReturnType<typeof normalizedIntent>
          try {
            intent = normalizedIntent(request)
          } catch (error) {
            await rejection(request, actor, startAt, eventId)
            throw error
          }

          const impersonationId = (options.id ?? (() => `imp_${crypto.randomUUID()}`))()
          const handoffTicket = (options.ticket ?? randomTicket)()
          if (!handoffTicket) throw denied('impersonation handoff is unavailable')
          const ticketHash = await sha256(handoffTicket)
          const expiresAt = new Date(startAt.getTime() + handoffLifetimeMs)
          const occurredAtEpoch = Math.floor(startAt.getTime() / 1_000)
          const totpCutoffEpoch = Math.floor(
            (startAt.getTime() - recentTotpLifetimeMs) / 1_000
          )
          const expiresAtEpoch = Math.floor(expiresAt.getTime() / 1_000)
          const occurredAtIso = startAt.toISOString()
          const retainUntil = twoYearsAfter(startAt)
          const raw = db.$client as unknown as RawD1
          const statement = (sql: string, ...params: readonly unknown[]) =>
            raw.prepare(sql).bind(...params)
          const results = await raw.batch([
            statement(
              `UPDATE impersonation_records
               SET lifecycle = 'expired', terminal_at = ?1,
                   termination_cause = 'handoff-expired', updated_at = ?2
               WHERE lifecycle = 'pending-handoff' AND handoff_expires_at <= ?1`,
              occurredAtEpoch,
              occurredAtIso
            ),
            statement(
              `INSERT INTO impersonation_records (
                 id, operator_id, operator_session_id, target_member_id, merchant_id,
                 lifecycle, reason, support_reference, ticket_hash,
                 handoff_expires_at, created_at, updated_at
               )
               SELECT ?1, operator.id, operator_session.id, target.id, merchant.id,
                      'pending-handoff', ?2, ?3, ?4, ?5, ?6, ?6
               FROM session AS operator_session
               JOIN user AS operator ON operator.id = operator_session.userId
               JOIN twoFactor AS factor ON factor.userId = operator.id
               JOIN user AS target ON target.id = ?7
               JOIN merchant_memberships AS membership
                 ON membership.user_id = target.id AND membership.merchant_id = ?8
               JOIN merchants AS merchant ON merchant.id = membership.merchant_id
               WHERE operator_session.id = ?9
                 AND operator.identityClass = 'system_operator'
                 AND operator.emailVerified = 1
                 AND operator.twoFactorEnabled = 1
                 AND (operator.banned IS NULL OR operator.banned = 0)
                 AND operator_session.operatorIdleExpiresAt > ?10
                 AND operator_session.operatorAbsoluteExpiresAt > ?10
                 AND operator_session.expiresAt > ?10
                 AND operator_session.operatorTotpVerifiedAt >= ?11
                 AND operator_session.operatorTotpVerifiedAt <= ?10
                 AND factor.verified = 1
                 AND (factor.lockedUntil IS NULL OR factor.lockedUntil <= ?10)
                 AND EXISTS (
                   SELECT 1 FROM json_each(?12) AS permitted_role
                   WHERE instr(
                     ',' || coalesce(operator.role, '') || ',',
                     ',' || permitted_role.value || ','
                   ) > 0
                 )
                 AND target.identityClass = 'merchant_member'
                 AND (target.banned IS NULL OR target.banned = 0)
                 AND merchant.status = 'enabled'
                 AND NOT EXISTS (
                   SELECT 1 FROM impersonation_records AS open_operator
                   WHERE open_operator.operator_id = operator.id
                     AND open_operator.lifecycle IN ('pending-handoff', 'active')
                 )
                 AND NOT EXISTS (
                   SELECT 1 FROM impersonation_records AS open_target
                   WHERE open_target.target_member_id = target.id
                     AND open_target.lifecycle IN ('pending-handoff', 'active')
                 )`,
              impersonationId,
              intent.reason,
              intent.supportReference,
              ticketHash,
              expiresAtEpoch,
              occurredAtIso,
              request.targetMemberId,
              request.merchantId,
              request.actor.operatorSessionId,
              occurredAtEpoch,
              totpCutoffEpoch,
              JSON.stringify(impersonationRoleNames)
            ),
            statement(
              `INSERT INTO operations_audit_events (
                 id, business_event_id, actor_operator_id, actor_display_name,
                 operator_session_id, impersonation_id, target_id,
                 target_display_name, merchant_id, merchant_display_name,
                 action, result, occurred_at, retention_policy, retain_until,
                 internal_reason, support_reference, created_at
               )
               SELECT ?1, ?2, record.operator_id, ?3, record.operator_session_id,
                      record.id, record.target_member_id, target.name,
                      record.merchant_id, merchant.public_name,
                      'impersonation.start', 'accepted', ?4,
                      'impersonation-two-years', ?5, record.reason,
                      record.support_reference, ?4
               FROM impersonation_records AS record
               JOIN user AS target ON target.id = record.target_member_id
               JOIN merchants AS merchant ON merchant.id = record.merchant_id
               WHERE record.id = ?6`,
              `oaud_${eventId}`,
              `impersonation:${impersonationId}:start:accepted`,
              actor.name,
              occurredAtIso,
              retainUntil,
              impersonationId
            ),
            statement(
              `INSERT INTO operations_audit_events (
                 id, business_event_id, actor_operator_id, actor_display_name,
                 operator_session_id, impersonation_id, target_id,
                 target_display_name, merchant_id, merchant_display_name,
                 action, result, occurred_at, retention_policy, retain_until,
                 internal_reason, support_reference, created_at
               )
               SELECT ?1, ?2, ?3, ?4, ?5, NULL, ?6,
                      coalesce((SELECT name FROM user WHERE id = ?6), ?6), ?7,
                      coalesce((SELECT public_name FROM merchants WHERE id = ?7), ?7),
                      'impersonation.start', 'rejected', ?8,
                      'impersonation-two-years', ?9, ?10, ?11, ?8
               WHERE NOT EXISTS (
                 SELECT 1 FROM impersonation_records WHERE id = ?12
               )`,
              `oaud_${eventId}`,
              `impersonation:start:${eventId}:rejected`,
              actor.id,
              actor.name,
              actor.sessionId,
              request.targetMemberId,
              request.merchantId,
              occurredAtIso,
              retainUntil,
              intent.reason,
              intent.supportReference,
              impersonationId
            )
          ])
          if ((results[1]?.meta?.changes ?? 0) !== 1)
            throw denied('impersonation handoff is unavailable')
          return {
            impersonationId,
            lifecycle: 'pending-handoff' as const,
            expiresAt: expiresAt.toISOString(),
            handoffTicket
          }
        },
        catch: (error) =>
          error instanceof OperationsContractDenied
            ? error
            : error instanceof CapabilityUnavailable
              ? error
              : unavailable()
      })
  })
}
