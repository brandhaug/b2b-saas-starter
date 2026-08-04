import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq, isNull, notExists, sql } from 'drizzle-orm'
import type { PromiseDrizzleDatabase } from '@b2b-saas-starter/db'
import {
  appointmentEmailAttention,
  auditEvents,
  merchantMessagingControls,
  messagingIncidentQuarantine,
  messagingCallbackRejectionRules,
  messagingChannelControls,
  messagingIncidentEvents,
  messagingIncidents,
  messagingKeyRotations,
  messagingReconciliationCases,
  messagingReconciliationResolutions,
  messagingRecoveryApprovals,
  messagingRecoveryChecks,
  messagingRetentionHolds,
  messagingRetentionTombstones,
  notificationIntentControlledFacts,
  protectedMessagingDestinations,
  protectedProviderReferences,
  suppressionDirectives
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
const incidentKindValues = [
  'duplicate_delivery',
  'financial_uncertainty',
  'credential_compromise',
  'platform_integrity',
  'encryption_key_compromise',
  'privacy_exposure',
  'forged_callback'
] as const
type Severity = (typeof severityValues)[number]
type ContainmentScope = (typeof scopeValues)[number]
type IncidentKind = (typeof incidentKindValues)[number]
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
  readonly kind: IncidentKind
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

type RecoveryCheckInput = {
  readonly actor: OperatorSessionReference
  readonly incidentId: string
  readonly kind: 'health_probe' | 'reconciliation'
  readonly reference: string
  readonly status: 'passed' | 'failed'
  readonly observedAt: string
  readonly reason: string
}

type KeyRotationInput = {
  readonly actor: OperatorSessionReference
  readonly incidentId: string
  readonly kind: 'provider_credential' | 'destination_encryption' | 'provider_reference'
  readonly previousVersion: string
  readonly nextVersion: string
  readonly invalidatedAt: string
  readonly validatedAt: string
  readonly evidenceReference: string
  readonly reason: string
  readonly reencryptedResources?: readonly {
    readonly resourceType:
      | 'protected_messaging_destination'
      | 'protected_provider_reference'
    readonly resourceId: string
    readonly ciphertext: string
    readonly previousKeyVersion: number
    readonly nextKeyVersion: number
  }[]
}

type PlaceRetentionHoldInput = {
  readonly actor: OperatorSessionReference
  readonly resourceType:
    | 'protected_messaging_destination'
    | 'protected_provider_reference'
    | 'notification_intent_controlled_facts'
    | 'incident_quarantine'
    | 'suppression_directive'
  readonly resourceId: string
  readonly purpose: string
  readonly reason: string
}

type SchedulePrivacyDeletionInput = {
  readonly actor: OperatorSessionReference
  readonly shopId: string
  readonly reason: string
  readonly confirmed: boolean
}

type ReleaseRetentionHoldInput = {
  readonly actor: OperatorSessionReference
  readonly holdId: string
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
  readonly recordRecoveryCheck: (
    input: RecoveryCheckInput
  ) => Effect.Effect<void, MessagingGovernanceDenied>
  readonly recordKeyRotation: (
    input: KeyRotationInput
  ) => Effect.Effect<void, MessagingGovernanceDenied>
  readonly placeRetentionHold: (
    input: PlaceRetentionHoldInput
  ) => Effect.Effect<string, MessagingGovernanceDenied>
  readonly releaseRetentionHold: (
    input: ReleaseRetentionHoldInput
  ) => Effect.Effect<void, MessagingGovernanceDenied>
  readonly schedulePrivacyDeletion: (
    input: SchedulePrivacyDeletionInput
  ) => Effect.Effect<void, MessagingGovernanceDenied>
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
const validTimestamp = (value: string) => Number.isFinite(Date.parse(value))

const requiredScopeFor = (kind: IncidentKind): ContainmentScope => {
  if (
    kind === 'duplicate_delivery' ||
    kind === 'financial_uncertainty' ||
    kind === 'privacy_exposure'
  )
    return 'merchant'
  if (kind === 'credential_compromise') return 'provider_channel'
  if (kind === 'forged_callback') return 'callback_rule'
  return 'global'
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

  const validateRecoveryEvidence = async (
    incidentId: string,
    healthProbeReference: string,
    reconciliationReference: string,
    operation: string
  ) => {
    const checks = await db
      .select({
        kind: messagingRecoveryChecks.kind,
        reference: messagingRecoveryChecks.reference,
        status: messagingRecoveryChecks.status
      })
      .from(messagingRecoveryChecks)
      .where(eq(messagingRecoveryChecks.incidentId, incidentId))
    const passed = (kind: 'health_probe' | 'reconciliation', reference: string) =>
      checks.some(
        (check) =>
          check.kind === kind &&
          check.reference === reference.trim() &&
          check.status === 'passed'
      )
    if (!passed('health_probe', healthProbeReference))
      throw denied(operation, 'passed_health_probe_required')
    if (!passed('reconciliation', reconciliationReference))
      throw denied(operation, 'passed_reconciliation_required')
  }

  const validateRequiredRotation = async (
    incident: IncidentRow,
    metadata: IncidentMetadata,
    operation: string
  ) => {
    if (
      !metadata.compromisedCredential &&
      incident.kind !== 'encryption_key_compromise'
    )
      return
    const requiredKind = metadata.compromisedCredential
      ? 'provider_credential'
      : 'destination_encryption'
    const rows = await db
      .select()
      .from(messagingKeyRotations)
      .where(eq(messagingKeyRotations.incidentId, incident.id))
    const rotation = rows.find((row) => row.kind === requiredKind)
    if (
      !rotation ||
      rotation.environment !== metadata.environment ||
      (metadata.provider && rotation.provider !== metadata.provider) ||
      (metadata.channel && rotation.channel !== metadata.channel) ||
      Date.parse(rotation.invalidatedAt) < Date.parse(incident.openedAt) ||
      Date.parse(rotation.validatedAt) < Date.parse(rotation.invalidatedAt)
    )
      throw denied(operation, 'verified_key_rotation_required')
  }

  const scopeControlMutation = (input: {
    readonly incident: IncidentRow
    readonly metadata: IncidentMetadata
    readonly principal: OperatorPrincipal
    readonly reason: string
    readonly now: Date
    readonly contained: boolean
    readonly operation: string
  }) => {
    const { incident, metadata, principal, contained } = input
    const timestamp = input.now.toISOString()
    const reason = input.reason.trim()
    if (incident.containmentScope === 'merchant') {
      if (!metadata.shopId) throw denied(input.operation, 'merchant_scope_required')
      return db
        .update(merchantMessagingControls)
        .set({
          frozen: contained,
          freezeReason: contained ? reason : null,
          updatedAt: timestamp
        })
        .where(eq(merchantMessagingControls.shopId, metadata.shopId))
    }
    if (incident.containmentScope === 'callback_rule') {
      if (!metadata.provider || !metadata.channel)
        throw denied(input.operation, 'provider_channel_scope_required')
      if (!contained)
        return db
          .update(messagingCallbackRejectionRules)
          .set({
            enabled: false,
            reason,
            changedByOperatorId: principal.id,
            updatedAt: timestamp
          })
          .where(
            and(
              eq(messagingCallbackRejectionRules.environment, metadata.environment),
              eq(messagingCallbackRejectionRules.provider, metadata.provider),
              eq(messagingCallbackRejectionRules.ruleKey, metadata.channel)
            )
          )
      return db
        .insert(messagingCallbackRejectionRules)
        .values({
          id: id('mcrr'),
          incidentId: incident.id,
          environment: metadata.environment,
          provider: metadata.provider,
          ruleKey: metadata.channel,
          enabled: true,
          reason,
          changedByOperatorId: principal.id,
          createdAt: timestamp,
          updatedAt: timestamp
        })
        .onConflictDoUpdate({
          target: [
            messagingCallbackRejectionRules.environment,
            messagingCallbackRejectionRules.provider,
            messagingCallbackRejectionRules.ruleKey
          ],
          set: {
            incidentId: incident.id,
            enabled: true,
            reason,
            changedByOperatorId: principal.id,
            updatedAt: timestamp
          }
        })
    }
    const scope = incident.containmentScope
    if (scope === 'provider_channel' && (!metadata.provider || !metadata.channel))
      throw denied(input.operation, 'provider_channel_scope_required')
    return db
      .update(messagingChannelControls)
      .set({
        enabled: !contained,
        reason,
        changedByOperatorId: principal.id,
        updatedAt: timestamp
      })
      .where(
        scope === 'provider_channel'
          ? and(
              eq(messagingChannelControls.environment, metadata.environment),
              eq(messagingChannelControls.provider, metadata.provider!),
              eq(messagingChannelControls.channel, metadata.channel!)
            )
          : eq(messagingChannelControls.environment, metadata.environment)
      )
  }

  const retentionResourceExists = async (
    resourceType: PlaceRetentionHoldInput['resourceType'],
    resourceId: string
  ) => {
    if (resourceType === 'protected_messaging_destination')
      return (
        (
          await db
            .select({ id: protectedMessagingDestinations.id })
            .from(protectedMessagingDestinations)
            .where(eq(protectedMessagingDestinations.id, resourceId))
            .limit(1)
        ).length === 1
      )
    if (resourceType === 'protected_provider_reference')
      return (
        (
          await db
            .select({ id: protectedProviderReferences.id })
            .from(protectedProviderReferences)
            .where(eq(protectedProviderReferences.id, resourceId))
            .limit(1)
        ).length === 1
      )
    if (resourceType === 'notification_intent_controlled_facts')
      return (
        (
          await db
            .select({ id: notificationIntentControlledFacts.intentId })
            .from(notificationIntentControlledFacts)
            .where(eq(notificationIntentControlledFacts.intentId, resourceId))
            .limit(1)
        ).length === 1
      )
    if (resourceType === 'incident_quarantine')
      return (
        (
          await db
            .select({ id: messagingIncidentQuarantine.id })
            .from(messagingIncidentQuarantine)
            .where(eq(messagingIncidentQuarantine.id, resourceId))
            .limit(1)
        ).length === 1
      )
    return (
      (
        await db
          .select({ id: suppressionDirectives.id })
          .from(suppressionDirectives)
          .where(eq(suppressionDirectives.id, resourceId))
          .limit(1)
      ).length === 1
    )
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
        if (input.containmentScope !== required)
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
        const containmentUpdate = scopeControlMutation({
          incident,
          metadata,
          principal,
          reason: input.reason,
          now,
          contained: true,
          operation: 'contain-incident'
        })
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

    recordRecoveryCheck: (input) =>
      effect('record-recovery-check', async () => {
        const now = currentTime()
        const permission =
          input.kind === 'reconciliation'
            ? ('messaging:reconcile' as const)
            : ('messaging:control' as const)
        const principal = await authorize(
          db,
          input.actor,
          permission,
          'record-recovery-check',
          now
        )
        if (
          !substantive(input.reason) ||
          !input.reference.trim() ||
          !validTimestamp(input.observedAt)
        )
          throw denied('record-recovery-check', 'recovery_evidence_required')
        const { incident } = await loadIncident(
          input.incidentId,
          'record-recovery-check'
        )
        if (incident.status !== 'contained' && incident.status !== 'recovering')
          throw denied('record-recovery-check', 'incident_not_contained')
        await db.batch([
          db.insert(messagingRecoveryChecks).values({
            id: id('mrchk'),
            incidentId: incident.id,
            kind: input.kind,
            reference: input.reference.trim(),
            status: input.status,
            observedAt: input.observedAt,
            actorOperatorId: principal.id,
            createdAt: now.toISOString()
          }),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.incident.recovery-check-recorded',
              targetType: 'messaging-incident',
              targetId: incident.id,
              reason: input.reason,
              now,
              metadata: {
                kind: input.kind,
                reference: input.reference.trim(),
                status: input.status
              }
            })
          )
        ])
      }),

    recordKeyRotation: (input) =>
      effect('record-key-rotation', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:control',
          'record-key-rotation',
          now
        )
        if (
          !substantive(input.reason) ||
          !input.previousVersion.trim() ||
          !input.nextVersion.trim() ||
          input.previousVersion.trim() === input.nextVersion.trim() ||
          !input.evidenceReference.trim() ||
          !validTimestamp(input.invalidatedAt) ||
          !validTimestamp(input.validatedAt)
        )
          throw denied('record-key-rotation', 'key_rotation_evidence_required')
        const { incident, metadata } = await loadIncident(
          input.incidentId,
          'record-key-rotation'
        )
        const expectedKind =
          incident.kind === 'credential_compromise'
            ? 'provider_credential'
            : incident.kind === 'encryption_key_compromise'
              ? 'destination_encryption'
              : null
        if (!expectedKind || input.kind !== expectedKind)
          throw denied('record-key-rotation', 'rotation_kind_not_required')
        if (
          Date.parse(input.invalidatedAt) < Date.parse(incident.openedAt) ||
          Date.parse(input.validatedAt) < Date.parse(input.invalidatedAt)
        )
          throw denied('record-key-rotation', 'rotation_timeline_invalid')
        const reencryptedResources = input.reencryptedResources ?? []
        const previousKeyVersion = Number(input.previousVersion)
        const nextKeyVersion = Number(input.nextVersion)
        if (
          expectedKind === 'destination_encryption' &&
          (!Number.isInteger(previousKeyVersion) ||
            !Number.isInteger(nextKeyVersion) ||
            previousKeyVersion < 1 ||
            nextKeyVersion < 1)
        )
          throw denied('record-key-rotation', 'reencrypted_resources_required')
        if (expectedKind === 'destination_encryption') {
          const [destinations, references] = await Promise.all([
            db
              .select({ id: protectedMessagingDestinations.id })
              .from(protectedMessagingDestinations)
              .where(
                and(
                  eq(protectedMessagingDestinations.keyVersion, previousKeyVersion),
                  isNull(protectedMessagingDestinations.erasedAt)
                )
              ),
            db
              .select({ id: protectedProviderReferences.id })
              .from(protectedProviderReferences)
              .where(
                and(
                  eq(protectedProviderReferences.keyVersion, previousKeyVersion),
                  isNull(protectedProviderReferences.erasedAt)
                )
              )
          ])
          const supplied = new Set(
            reencryptedResources.map(
              (resource) => `${resource.resourceType}:${resource.resourceId}`
            )
          )
          const required = [
            ...destinations.map((row) => `protected_messaging_destination:${row.id}`),
            ...references.map((row) => `protected_provider_reference:${row.id}`)
          ]
          if (required.some((resource) => !supplied.has(resource)))
            throw denied('record-key-rotation', 'active_ciphertext_not_reencrypted')
        }
        for (const resource of reencryptedResources) {
          if (
            !resource.ciphertext.trim() ||
            resource.previousKeyVersion !== previousKeyVersion ||
            resource.nextKeyVersion !== nextKeyVersion ||
            resource.previousKeyVersion === resource.nextKeyVersion ||
            resource.previousKeyVersion < 1 ||
            resource.nextKeyVersion < 1
          )
            throw denied('record-key-rotation', 'reencryption_evidence_invalid')
          const rows =
            resource.resourceType === 'protected_messaging_destination'
              ? await db
                  .select({ keyVersion: protectedMessagingDestinations.keyVersion })
                  .from(protectedMessagingDestinations)
                  .where(
                    and(
                      eq(protectedMessagingDestinations.id, resource.resourceId),
                      isNull(protectedMessagingDestinations.erasedAt)
                    )
                  )
                  .limit(1)
              : await db
                  .select({ keyVersion: protectedProviderReferences.keyVersion })
                  .from(protectedProviderReferences)
                  .where(
                    and(
                      eq(protectedProviderReferences.id, resource.resourceId),
                      isNull(protectedProviderReferences.erasedAt)
                    )
                  )
                  .limit(1)
          if (rows[0]?.keyVersion !== resource.previousKeyVersion)
            throw denied('record-key-rotation', 'reencryption_source_version_mismatch')
        }
        const reencryptions = reencryptedResources.map((resource) =>
          resource.resourceType === 'protected_messaging_destination'
            ? db
                .update(protectedMessagingDestinations)
                .set({
                  ciphertext: resource.ciphertext,
                  keyVersion: resource.nextKeyVersion
                })
                .where(
                  and(
                    eq(protectedMessagingDestinations.id, resource.resourceId),
                    eq(
                      protectedMessagingDestinations.keyVersion,
                      resource.previousKeyVersion
                    ),
                    isNull(protectedMessagingDestinations.erasedAt)
                  )
                )
            : db
                .update(protectedProviderReferences)
                .set({
                  ciphertext: resource.ciphertext,
                  keyVersion: resource.nextKeyVersion
                })
                .where(
                  and(
                    eq(protectedProviderReferences.id, resource.resourceId),
                    eq(
                      protectedProviderReferences.keyVersion,
                      resource.previousKeyVersion
                    ),
                    isNull(protectedProviderReferences.erasedAt)
                  )
                )
        )
        await db.batch([
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.incident.key-rotation-recorded',
              targetType: 'messaging-incident',
              targetId: incident.id,
              reason: input.reason,
              now,
              metadata: { kind: input.kind, nextVersion: input.nextVersion.trim() }
            })
          ),
          ...reencryptions,
          db.insert(messagingKeyRotations).values({
            id: id('mkrot'),
            incidentId: incident.id,
            kind: input.kind,
            environment: metadata.environment,
            provider: metadata.provider ?? null,
            channel: metadata.channel ?? null,
            previousVersion: input.previousVersion.trim(),
            nextVersion: input.nextVersion.trim(),
            invalidatedAt: input.invalidatedAt,
            validatedAt: input.validatedAt,
            evidenceReference: input.evidenceReference.trim(),
            actorOperatorId: principal.id,
            createdAt: now.toISOString()
          })
        ])
      }),

    placeRetentionHold: (input) =>
      effect('place-retention-hold', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:incident',
          'place-retention-hold',
          now
        )
        if (
          !substantive(input.reason) ||
          !input.resourceType.trim() ||
          !input.resourceId.trim() ||
          !input.purpose.trim()
        )
          throw denied('place-retention-hold', 'exact_hold_scope_required')
        if (!(await retentionResourceExists(input.resourceType, input.resourceId)))
          throw denied('place-retention-hold', 'retention_resource_not_found')
        const holdId = id('mrhold')
        await db.batch([
          db.insert(messagingRetentionHolds).values({
            id: holdId,
            resourceType: input.resourceType.trim(),
            resourceId: input.resourceId.trim(),
            purpose: input.purpose.trim(),
            status: 'active',
            reason: input.reason.trim(),
            placedByOperatorId: principal.id,
            placedAt: now.toISOString(),
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          }),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.retention-hold.placed',
              targetType: input.resourceType.trim(),
              targetId: input.resourceId.trim(),
              reason: input.reason,
              now,
              metadata: { holdId, purpose: input.purpose.trim() }
            })
          )
        ])
        return holdId
      }),

    releaseRetentionHold: (input) =>
      effect('release-retention-hold', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:incident',
          'release-retention-hold',
          now
        )
        if (!substantive(input.reason))
          throw denied('release-retention-hold', 'substantive_reason_required')
        const [hold] = await db
          .select()
          .from(messagingRetentionHolds)
          .where(eq(messagingRetentionHolds.id, input.holdId))
          .limit(1)
        if (!hold || hold.status !== 'active')
          throw denied('release-retention-hold', 'active_hold_not_found')
        await db.batch([
          db
            .update(messagingRetentionHolds)
            .set({
              status: 'released',
              releasedByOperatorId: principal.id,
              releasedAt: now.toISOString(),
              updatedAt: now.toISOString()
            })
            .where(
              and(
                eq(messagingRetentionHolds.id, hold.id),
                eq(messagingRetentionHolds.status, 'active')
              )
            ),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.retention-hold.released',
              targetType: hold.resourceType,
              targetId: hold.resourceId,
              reason: input.reason,
              now,
              metadata: { holdId: hold.id, purpose: hold.purpose }
            })
          )
        ])
      }),

    schedulePrivacyDeletion: (input) =>
      effect('schedule-privacy-deletion', async () => {
        const now = currentTime()
        const principal = await authorize(
          db,
          input.actor,
          'messaging:incident',
          'schedule-privacy-deletion',
          now
        )
        if (!input.confirmed)
          throw denied('schedule-privacy-deletion', 'confirmation_required')
        if (!substantive(input.reason))
          throw denied('schedule-privacy-deletion', 'substantive_reason_required')
        const timestamp = now.toISOString()
        const activeHold = (resourceType: string, resourceId: unknown) =>
          notExists(
            db
              .select({ id: messagingRetentionHolds.id })
              .from(messagingRetentionHolds)
              .where(
                and(
                  eq(messagingRetentionHolds.resourceType, resourceType),
                  eq(messagingRetentionHolds.resourceId, resourceId as never),
                  eq(messagingRetentionHolds.status, 'active')
                )
              )
          )
        const destinationTombstones = db
          .insert(messagingRetentionTombstones)
          .select(
            db
              .select({
                id: sql<string>`'mrt_destination_' || ${protectedMessagingDestinations.id}`.as(
                  'id'
                ),
                shopId: protectedMessagingDestinations.shopId,
                resourceType: sql<string>`'protected_messaging_destination'`.as(
                  'resource_type'
                ),
                resourceId: protectedMessagingDestinations.id,
                action: sql<'erase_destination'>`'erase_destination'`.as('action'),
                status: sql<'pending'>`'pending'`.as('status'),
                dueAt: sql<string>`${timestamp}`.as('due_at'),
                attemptCount: sql<number>`0`.as('attempt_count'),
                createdAt: sql<string>`${timestamp}`.as('created_at'),
                updatedAt: sql<string>`${timestamp}`.as('updated_at')
              })
              .from(protectedMessagingDestinations)
              .where(
                and(
                  eq(protectedMessagingDestinations.shopId, input.shopId),
                  isNull(protectedMessagingDestinations.erasedAt),
                  activeHold(
                    'protected_messaging_destination',
                    protectedMessagingDestinations.id
                  )
                )
              )
          )
          .onConflictDoNothing()
        const referenceTombstones = db
          .insert(messagingRetentionTombstones)
          .select(
            db
              .select({
                id: sql<string>`'mrt_provider_reference_' || ${protectedProviderReferences.id}`.as(
                  'id'
                ),
                shopId: protectedProviderReferences.shopId,
                resourceType: sql<string>`'protected_provider_reference'`.as(
                  'resource_type'
                ),
                resourceId: protectedProviderReferences.id,
                action: sql<'erase_provider_reference'>`'erase_provider_reference'`.as(
                  'action'
                ),
                status: sql<'pending'>`'pending'`.as('status'),
                dueAt: sql<string>`${timestamp}`.as('due_at'),
                attemptCount: sql<number>`0`.as('attempt_count'),
                createdAt: sql<string>`${timestamp}`.as('created_at'),
                updatedAt: sql<string>`${timestamp}`.as('updated_at')
              })
              .from(protectedProviderReferences)
              .where(
                and(
                  eq(protectedProviderReferences.shopId, input.shopId),
                  isNull(protectedProviderReferences.erasedAt),
                  activeHold(
                    'protected_provider_reference',
                    protectedProviderReferences.id
                  )
                )
              )
          )
          .onConflictDoNothing()
        const factTombstones = db
          .insert(messagingRetentionTombstones)
          .select(
            db
              .select({
                id: sql<string>`'mrt_controlled_facts_' || ${notificationIntentControlledFacts.intentId}`.as(
                  'id'
                ),
                shopId: notificationIntentControlledFacts.shopId,
                resourceType: sql<string>`'notification_intent_controlled_facts'`.as(
                  'resource_type'
                ),
                resourceId: notificationIntentControlledFacts.intentId,
                action: sql<'erase_facts'>`'erase_facts'`.as('action'),
                status: sql<'pending'>`'pending'`.as('status'),
                dueAt: sql<string>`${timestamp}`.as('due_at'),
                attemptCount: sql<number>`0`.as('attempt_count'),
                createdAt: sql<string>`${timestamp}`.as('created_at'),
                updatedAt: sql<string>`${timestamp}`.as('updated_at')
              })
              .from(notificationIntentControlledFacts)
              .where(
                and(
                  eq(notificationIntentControlledFacts.shopId, input.shopId),
                  isNull(notificationIntentControlledFacts.erasedAt),
                  activeHold(
                    'notification_intent_controlled_facts',
                    notificationIntentControlledFacts.intentId
                  )
                )
              )
          )
          .onConflictDoNothing()
        await db.batch([
          destinationTombstones,
          referenceTombstones,
          factTombstones,
          db.delete(suppressionDirectives).where(
            and(
              eq(suppressionDirectives.shopId, input.shopId),
              notExists(
                db
                  .select({ id: messagingRetentionHolds.id })
                  .from(messagingRetentionHolds)
                  .where(
                    and(
                      eq(messagingRetentionHolds.resourceType, 'suppression_directive'),
                      eq(messagingRetentionHolds.resourceId, suppressionDirectives.id),
                      eq(messagingRetentionHolds.status, 'active')
                    )
                  )
              )
            )
          ),
          db.insert(auditEvents).values(
            audit({
              principal,
              eventType: 'messaging.privacy-deletion.scheduled',
              targetType: 'shop',
              targetId: input.shopId,
              reason: input.reason,
              now
            })
          )
        ])
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
        const { incident, metadata } = await loadIncident(
          input.incidentId,
          'approve-recovery'
        )
        if (incident.status !== 'contained' && incident.status !== 'recovering')
          throw denied('approve-recovery', 'incident_not_contained')
        await validateRecoveryEvidence(
          incident.id,
          input.healthProbeReference,
          input.reconciliationReference,
          'approve-recovery'
        )
        await validateRequiredRotation(incident, metadata, 'approve-recovery')
        await db.batch([
          db.insert(messagingRecoveryApprovals).values({
            id: id('mrap'),
            incidentId: incident.id,
            actorOperatorId: principal.id,
            operatorSessionId: principal.sessionId,
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
            actorOperatorId: messagingRecoveryApprovals.actorOperatorId,
            operatorSessionId: messagingRecoveryApprovals.operatorSessionId,
            healthProbeReference: messagingRecoveryApprovals.healthProbeReference,
            reconciliationReference: messagingRecoveryApprovals.reconciliationReference
          })
          .from(messagingRecoveryApprovals)
          .where(eq(messagingRecoveryApprovals.incidentId, incident.id))
        const requiresTwo =
          incident.containmentScope === 'global' || metadata.compromisedCredential
        const currentApprovers = new Set<string>()
        for (const approval of approvalRows) {
          try {
            const approver = await authorize(
              db,
              { operatorSessionId: approval.operatorSessionId },
              'messaging:control',
              'complete-recovery',
              now
            )
            if (approver.id === approval.actorOperatorId)
              currentApprovers.add(approver.id)
          } catch {
            // Stale approvals remain evidence but grant no current authority.
          }
        }
        if (requiresTwo && currentApprovers.size < 2)
          throw denied('complete-recovery', 'two_person_approval_required')
        for (const approval of approvalRows) {
          await validateRecoveryEvidence(
            incident.id,
            approval.healthProbeReference,
            approval.reconciliationReference,
            'complete-recovery'
          )
        }
        await validateRequiredRotation(incident, metadata, 'complete-recovery')

        const recoveryUpdate = scopeControlMutation({
          incident,
          metadata,
          principal,
          reason: input.reason,
          now,
          contained: false,
          operation: 'complete-recovery'
        })
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
        if (!caseRow) {
          const [emailAttention] = await db
            .select()
            .from(appointmentEmailAttention)
            .where(eq(appointmentEmailAttention.id, input.caseId))
            .limit(1)
          if (!emailAttention) throw denied('resolve-case', 'case_not_found')
          if (emailAttention.status === 'resolved')
            throw denied('resolve-case', 'case_already_closed')
          await db.batch([
            db
              .update(appointmentEmailAttention)
              .set({ status: 'resolved', resolvedAt: now.toISOString() })
              .where(eq(appointmentEmailAttention.id, emailAttention.id)),
            db.insert(auditEvents).values(
              audit({
                principal,
                eventType: `messaging.appointment-email.${input.disposition}`,
                targetType: 'appointment-email-attention',
                targetId: emailAttention.id,
                reason: input.reason,
                now,
                metadata: {
                  classification: input.classification.trim(),
                  source: input.source.trim()
                }
              })
            )
          ])
          return
        }
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
