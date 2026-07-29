import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, sql } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  auditEvents,
  merchantMessagingControls,
  messagingChannelControls,
  messagingIncidentEvents,
  messagingIncidents,
  messagingReconciliationCases,
  messagingReconciliationResolutions,
  messagingRecoveryApprovals
} from '@b2b-saas-starter/db'
import {
  hasOperatorPermission,
  makeOperationsAuthorizationLayer,
  OperationsAuthorization,
  type OperatorPermission,
  type OperatorPrincipal,
  type OperatorSessionReference
} from './operations-contracts.ts'

const severityValues = ['low', 'medium', 'high', 'critical'] as const
const scopeValues = ['merchant', 'provider_channel', 'callback_rule', 'global'] as const
type Severity = (typeof severityValues)[number]
type ContainmentScope = (typeof scopeValues)[number]
type Provider = 'meta' | 'smso'
type Channel = 'whatsapp' | 'sms'

export class MessagingGovernanceDenied extends Schema.TaggedErrorClass<MessagingGovernanceDenied>()(
  'MessagingGovernanceDenied',
  {
    operation: Schema.String,
    reason: Schema.String
  }
) {}

export const MessagingIncidentCommandResult = Schema.Struct({
  incidentId: Schema.String,
  status: Schema.Literals(['open', 'contained', 'recovering', 'resolved']),
  containmentScope: Schema.Literals(scopeValues)
})

type IncidentResult = typeof MessagingIncidentCommandResult.Type

type OpenIncidentInput = {
  readonly actor: OperatorSessionReference
  readonly kind: string
  readonly severity: Severity
  readonly safeSummary: string
  readonly containmentScope: ContainmentScope
  readonly environment: string
  readonly shopId?: string
  readonly provider?: Provider
  readonly channel?: Channel
  readonly reason: string
}

type IncidentActionInput = {
  readonly actor: OperatorSessionReference
  readonly incidentId: string
  readonly reason: string
  readonly confirmed: boolean
}

type ApprovalInput = {
  readonly actor: OperatorSessionReference
  readonly incidentId: string
  readonly reason: string
  readonly healthProbeReference: string
  readonly reconciliationReference: string
  readonly residualRisk: string
}

type ResolveCaseInput = {
  readonly actor: OperatorSessionReference
  readonly caseId: string
  readonly disposition: 'resolved' | 'waived'
  readonly classification: string
  readonly source: string
  readonly reason: string
}

export type MessagingGovernanceShape = {
  readonly openIncident: (
    input: OpenIncidentInput
  ) => Effect.Effect<IncidentResult, MessagingGovernanceDenied>
  readonly contain: (
    input: IncidentActionInput
  ) => Effect.Effect<IncidentResult, MessagingGovernanceDenied>
  readonly approveRecovery: (
    input: ApprovalInput
  ) => Effect.Effect<IncidentResult, MessagingGovernanceDenied>
  readonly completeRecovery: (
    input: IncidentActionInput
  ) => Effect.Effect<IncidentResult, MessagingGovernanceDenied>
  readonly resolveCase: (
    input: ResolveCaseInput
  ) => Effect.Effect<void, MessagingGovernanceDenied>
}

export class MessagingGovernance extends Context.Service<
  MessagingGovernance,
  MessagingGovernanceShape
>()('@b2b-saas-starter/capabilities/operations/MessagingGovernance') {}

const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`
const denied = (operation: string, reason: string) =>
  new MessagingGovernanceDenied({ operation, reason })

const substantive = (value: string) => value.trim().length >= 12

const requiredScopeFor = (kind: string): ContainmentScope | undefined => {
  if (kind === 'duplicate_delivery' || kind === 'financial_uncertainty')
    return 'merchant'
  if (kind === 'credential_compromise') return 'provider_channel'
  if (kind === 'platform_integrity' || kind === 'encryption_key_compromise')
    return 'global'
  return undefined
}

const authorize = async (
  db: PromiseDrizzleDatabase,
  actor: OperatorSessionReference,
  permission: OperatorPermission,
  operation: string,
  now: Date
): Promise<OperatorPrincipal> => {
  let principal: OperatorPrincipal
  try {
    principal = await Effect.runPromise(
      Effect.flatMap(OperationsAuthorization, (authorization) =>
        authorization.authorize(actor, now)
      ).pipe(Effect.provide(makeOperationsAuthorizationLayer(db)))
    )
  } catch {
    throw denied(operation, 'operator_session_not_authorized')
  }
  if (!hasOperatorPermission(principal.roles, permission))
    throw denied(operation, `${permission}_required`)
  return principal
}

type IncidentRow = typeof messagingIncidents.$inferSelect
type IncidentMetadata = {
  readonly environment: string
  readonly shopId?: string
  readonly provider?: Provider
  readonly channel?: Channel
  readonly compromisedCredential: boolean
}

const incidentResult = (incident: IncidentRow): IncidentResult => ({
  incidentId: incident.id,
  status: incident.status,
  containmentScope: incident.containmentScope
})

const parseMetadata = (value: unknown): IncidentMetadata => {
  const metadata = (value ?? {}) as Partial<IncidentMetadata>
  if (typeof metadata.environment !== 'string')
    throw new Error('incident_scope_unavailable')
  return {
    environment: metadata.environment,
    ...(typeof metadata.shopId === 'string' ? { shopId: metadata.shopId } : {}),
    ...(metadata.provider === 'meta' || metadata.provider === 'smso'
      ? { provider: metadata.provider }
      : {}),
    ...(metadata.channel === 'whatsapp' || metadata.channel === 'sms'
      ? { channel: metadata.channel }
      : {}),
    compromisedCredential: metadata.compromisedCredential === true
  }
}

const audit = (input: {
  readonly principal: OperatorPrincipal
  readonly eventType: string
  readonly targetType: string
  readonly targetId: string
  readonly merchantId?: string
  readonly reason: string
  readonly now: Date
  readonly metadata?: Record<string, unknown>
}) =>
  ({
    id: id('aud'),
    merchantId: input.merchantId ?? null,
    actorUserId: input.principal.id,
    eventType: input.eventType,
    targetType: input.targetType,
    targetId: input.targetId,
    metadata: {
      reason: input.reason.trim(),
      operatorSessionId: input.principal.sessionId,
      ...(input.metadata ?? {})
    },
    createdAt: input.now.toISOString()
  }) satisfies typeof auditEvents.$inferInsert

export const makeMessagingGovernanceLayer = (
  db: PromiseDrizzleDatabase,
  options: { readonly now?: () => Date } = {}
): Layer.Layer<MessagingGovernance> => {
  const currentTime = options.now ?? (() => new Date())

  const loadIncident = async (incidentId: string, operation: string) => {
    const [row] = await db
      .select({
        incident: messagingIncidents,
        safeMetadata: messagingIncidentEvents.safeMetadata
      })
      .from(messagingIncidents)
      .innerJoin(
        messagingIncidentEvents,
        and(
          eq(messagingIncidentEvents.incidentId, messagingIncidents.id),
          eq(messagingIncidentEvents.kind, 'opened')
        )
      )
      .where(eq(messagingIncidents.id, incidentId))
      .limit(1)
    if (!row) throw denied(operation, 'incident_not_found')
    return { incident: row.incident, metadata: parseMetadata(row.safeMetadata) }
  }

  const effect = <A>(operation: string, run: () => Promise<A>) =>
    Effect.tryPromise({
      try: run,
      catch: (cause) =>
        cause instanceof MessagingGovernanceDenied
          ? cause
          : denied(
              operation,
              cause instanceof Error && cause.message.includes('UNIQUE')
                ? 'command_already_recorded'
                : 'governance_command_unavailable'
            )
    })

  return Layer.succeed(MessagingGovernance)({
    openIncident: (input) =>
      effect('open-incident', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:incident',
          'open-incident',
          now
        )
        if (!substantive(input.reason) || !substantive(input.safeSummary))
          throw denied('open-incident', 'substantive_reason_required')
        const required = requiredScopeFor(input.kind)
        if (required && input.containmentScope !== required)
          throw denied('open-incident', 'containment_scope_too_broad')
        if (input.containmentScope === 'merchant' && !input.shopId)
          throw denied('open-incident', 'merchant_scope_required')
        if (
          (input.containmentScope === 'provider_channel' ||
            input.containmentScope === 'callback_rule') &&
          (!input.provider || !input.channel)
        )
          throw denied('open-incident', 'provider_channel_scope_required')

        const incidentId = id('minc')
        const occurredAt = now.toISOString()
        const metadata: IncidentMetadata = {
          environment: input.environment,
          ...(input.shopId ? { shopId: input.shopId } : {}),
          ...(input.provider ? { provider: input.provider } : {}),
          ...(input.channel ? { channel: input.channel } : {}),
          compromisedCredential: input.kind === 'credential_compromise'
        }
        const incident: typeof messagingIncidents.$inferInsert = {
          id: incidentId,
          shopId: input.shopId ?? null,
          provider: input.provider ?? null,
          channel: input.channel ?? null,
          kind: input.kind,
          status: 'open',
          severity: input.severity,
          safeSummary: input.safeSummary.trim(),
          containmentScope: input.containmentScope,
          openedByActorType: 'system_operator',
          openedByActorId: principal.id,
          openedAt: occurredAt,
          createdAt: occurredAt,
          updatedAt: occurredAt
        }
        await db.batch([
          db.insert(messagingIncidents).values(incident),
          db.insert(messagingIncidentEvents).values({
            id: id('minev'),
            incidentId,
            kind: 'opened',
            actorOperatorId: principal.id,
            reason: input.reason.trim(),
            safeMetadata: metadata,
            createdAt: occurredAt
          }),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.incident.opened',
              targetType: 'messaging-incident',
              targetId: incidentId,
              ...(input.shopId ? { merchantId: input.shopId } : {}),
              reason: input.reason,
              now,
              metadata: { kind: input.kind, containmentScope: input.containmentScope }
            })
          )
        ])
        return incidentResult(incident as IncidentRow)
      }),

    contain: (input) =>
      effect('contain-incident', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:control',
          'contain-incident',
          now
        )
        if (!input.confirmed) throw denied('contain-incident', 'confirmation_required')
        if (!substantive(input.reason))
          throw denied('contain-incident', 'substantive_reason_required')
        const { incident, metadata } = await loadIncident(
          input.incidentId,
          'contain-incident'
        )
        if (incident.status !== 'open')
          throw denied('contain-incident', 'incident_not_open')
        const updates = []
        if (incident.containmentScope === 'merchant') {
          if (!metadata.shopId)
            throw denied('contain-incident', 'merchant_scope_required')
          updates.push(
            db
              .update(merchantMessagingControls)
              .set({
                frozen: true,
                freezeReason: input.reason.trim(),
                updatedAt: now.toISOString()
              })
              .where(eq(merchantMessagingControls.shopId, metadata.shopId))
          )
        } else if (
          incident.containmentScope === 'provider_channel' ||
          incident.containmentScope === 'callback_rule'
        ) {
          if (!metadata.provider || !metadata.channel)
            throw denied('contain-incident', 'provider_channel_scope_required')
          updates.push(
            db
              .update(messagingChannelControls)
              .set({
                enabled: false,
                reason: input.reason.trim(),
                changedByOperatorId: principal.id,
                updatedAt: now.toISOString()
              })
              .where(
                and(
                  eq(messagingChannelControls.environment, metadata.environment),
                  eq(messagingChannelControls.provider, metadata.provider),
                  eq(messagingChannelControls.channel, metadata.channel)
                )
              )
          )
        } else {
          updates.push(
            db
              .update(messagingChannelControls)
              .set({
                enabled: false,
                reason: input.reason.trim(),
                changedByOperatorId: principal.id,
                updatedAt: now.toISOString()
              })
              .where(eq(messagingChannelControls.environment, metadata.environment))
          )
        }
        const containmentUpdate = updates[0]
        if (!containmentUpdate)
          throw denied('contain-incident', 'containment_scope_unavailable')
        await db.batch([
          containmentUpdate,
          db
            .update(messagingIncidents)
            .set({ status: 'contained', updatedAt: now.toISOString() })
            .where(
              and(
                eq(messagingIncidents.id, incident.id),
                eq(messagingIncidents.status, 'open')
              )
            ),
          db.insert(messagingIncidentEvents).values({
            id: id('minev'),
            incidentId: incident.id,
            kind: 'contained',
            actorOperatorId: principal.id,
            reason: input.reason.trim(),
            safeMetadata: { containmentScope: incident.containmentScope },
            createdAt: now.toISOString()
          }),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.incident.contained',
              targetType: 'messaging-incident',
              targetId: incident.id,
              reason: input.reason,
              now,
              metadata: { containmentScope: incident.containmentScope }
            })
          )
        ])
        return { ...incidentResult(incident), status: 'contained' }
      }),

    approveRecovery: (input) =>
      effect('approve-recovery', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:control',
          'approve-recovery',
          now
        )
        if (
          !substantive(input.reason) ||
          !input.healthProbeReference.trim() ||
          !input.reconciliationReference.trim() ||
          !input.residualRisk.trim()
        )
          throw denied('approve-recovery', 'recovery_evidence_required')
        const { incident } = await loadIncident(input.incidentId, 'approve-recovery')
        if (incident.status !== 'contained' && incident.status !== 'recovering')
          throw denied('approve-recovery', 'incident_not_contained')
        await db.batch([
          db.insert(messagingRecoveryApprovals).values({
            id: id('mrap'),
            incidentId: incident.id,
            actorOperatorId: principal.id,
            healthProbeReference: input.healthProbeReference.trim(),
            reconciliationReference: input.reconciliationReference.trim(),
            residualRisk: input.residualRisk.trim(),
            createdAt: now.toISOString()
          }),
          db
            .update(messagingIncidents)
            .set({ status: 'recovering', updatedAt: now.toISOString() })
            .where(eq(messagingIncidents.id, incident.id)),
          db.insert(messagingIncidentEvents).values({
            id: id('minev'),
            incidentId: incident.id,
            kind: 'recovery_started',
            actorOperatorId: principal.id,
            reason: input.reason.trim(),
            safeMetadata: {
              healthProbeReference: input.healthProbeReference.trim(),
              reconciliationReference: input.reconciliationReference.trim()
            },
            createdAt: now.toISOString()
          }),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.incident.recovery-approved',
              targetType: 'messaging-incident',
              targetId: incident.id,
              reason: input.reason,
              now
            })
          )
        ])
        return { ...incidentResult(incident), status: 'recovering' }
      }),

    completeRecovery: (input) =>
      effect('complete-recovery', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:control',
          'complete-recovery',
          now
        )
        if (!input.confirmed) throw denied('complete-recovery', 'confirmation_required')
        if (!substantive(input.reason))
          throw denied('complete-recovery', 'substantive_reason_required')
        const { incident, metadata } = await loadIncident(
          input.incidentId,
          'complete-recovery'
        )
        if (incident.status !== 'recovering')
          throw denied('complete-recovery', 'incident_not_recovering')
        const approvalRows = await db
          .select({
            count: sql<number>`count(distinct ${messagingRecoveryApprovals.actorOperatorId})`
          })
          .from(messagingRecoveryApprovals)
          .where(eq(messagingRecoveryApprovals.incidentId, incident.id))
        const count = approvalRows[0]?.count ?? 0
        const requiresTwo =
          incident.containmentScope === 'global' || metadata.compromisedCredential
        if (requiresTwo && Number(count ?? 0) < 2)
          throw denied('complete-recovery', 'two_person_approval_required')

        const updates = []
        if (incident.containmentScope === 'merchant') {
          if (!metadata.shopId)
            throw denied('complete-recovery', 'merchant_scope_required')
          updates.push(
            db
              .update(merchantMessagingControls)
              .set({ frozen: false, freezeReason: null, updatedAt: now.toISOString() })
              .where(eq(merchantMessagingControls.shopId, metadata.shopId))
          )
        } else if (
          incident.containmentScope === 'provider_channel' ||
          incident.containmentScope === 'callback_rule'
        ) {
          if (!metadata.provider || !metadata.channel)
            throw denied('complete-recovery', 'provider_channel_scope_required')
          updates.push(
            db
              .update(messagingChannelControls)
              .set({
                enabled: true,
                reason: input.reason.trim(),
                changedByOperatorId: principal.id,
                updatedAt: now.toISOString()
              })
              .where(
                and(
                  eq(messagingChannelControls.environment, metadata.environment),
                  eq(messagingChannelControls.provider, metadata.provider),
                  eq(messagingChannelControls.channel, metadata.channel)
                )
              )
          )
        } else {
          updates.push(
            db
              .update(messagingChannelControls)
              .set({
                enabled: true,
                reason: input.reason.trim(),
                changedByOperatorId: principal.id,
                updatedAt: now.toISOString()
              })
              .where(eq(messagingChannelControls.environment, metadata.environment))
          )
        }
        const recoveryUpdate = updates[0]
        if (!recoveryUpdate)
          throw denied('complete-recovery', 'containment_scope_unavailable')
        await db.batch([
          recoveryUpdate,
          db
            .update(messagingIncidents)
            .set({
              status: 'resolved',
              resolvedAt: now.toISOString(),
              updatedAt: now.toISOString()
            })
            .where(
              and(
                eq(messagingIncidents.id, incident.id),
                eq(messagingIncidents.status, 'recovering')
              )
            ),
          db.insert(messagingIncidentEvents).values({
            id: id('minev'),
            incidentId: incident.id,
            kind: 'resolved',
            actorOperatorId: principal.id,
            reason: input.reason.trim(),
            safeMetadata: { approvalsRequired: requiresTwo ? 2 : 1 },
            createdAt: now.toISOString()
          }),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.incident.recovered',
              targetType: 'messaging-incident',
              targetId: incident.id,
              reason: input.reason,
              now
            })
          )
        ])
        return { ...incidentResult(incident), status: 'resolved' }
      }),

    resolveCase: (input) =>
      effect('resolve-case', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:reconcile',
          'resolve-case',
          now
        )
        if (
          !substantive(input.reason) ||
          !input.classification.trim() ||
          !input.source.trim()
        )
          throw denied('resolve-case', 'resolution_evidence_required')
        const [caseRow] = await db
          .select()
          .from(messagingReconciliationCases)
          .where(eq(messagingReconciliationCases.id, input.caseId))
          .limit(1)
        if (!caseRow) throw denied('resolve-case', 'case_not_found')
        if (caseRow.status === 'resolved' || caseRow.status === 'waived')
          throw denied('resolve-case', 'case_already_closed')
        await db.batch([
          db.insert(messagingReconciliationResolutions).values({
            id: id('mrres'),
            caseId: caseRow.id,
            disposition: input.disposition,
            classification: input.classification.trim(),
            source: input.source.trim(),
            reason: input.reason.trim(),
            actorOperatorId: principal.id,
            createdAt: now.toISOString()
          }),
          db
            .update(messagingReconciliationCases)
            .set({
              status: input.disposition,
              resolutionClassification: input.classification.trim(),
              resolutionSource: input.source.trim(),
              resolutionReason: input.reason.trim(),
              ...(input.disposition === 'resolved'
                ? { resolvedAt: now.toISOString() }
                : { waivedAt: now.toISOString() }),
              updatedAt: now.toISOString()
            })
            .where(eq(messagingReconciliationCases.id, caseRow.id)),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: `messaging.reconciliation.${input.disposition}`,
              targetType: 'messaging-reconciliation-case',
              targetId: caseRow.id,
              reason: input.reason,
              now,
              metadata: {
                classification: input.classification.trim(),
                source: input.source.trim()
              }
            })
          )
        ])
      })
  })
}
