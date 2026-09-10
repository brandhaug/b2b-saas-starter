import {
  Billing,
  type ReconcileWorkspaceInput
} from '@b2b-saas-starter/billing/billing'
import {
  BillingQueueMessage,
  type SeatSyncQueueReason,
  type SeatSyncRecoveryEvidence
} from '@b2b-saas-starter/billing/seat-sync'
import { AuditEventLog } from '@b2b-saas-starter/capabilities/governance/audit-event-log'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, type Scope } from 'effect'

import { applyProviderEvent, billingCapabilitiesEnv } from './billing-runtime.ts'
import {
  annotateMalformed,
  consumerInvocation,
  type DeliveryOutcome,
  type Env,
  readDelivery,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

type OperatorRetryAuditMetadata = {
  operatorId: string
  reason: string
  customerId?: string
  checkoutSessionId?: string
}

/**
 * The audited evidence of one operator-requested retry. Assembled key by key
 * rather than spread: `exactOptionalPropertyTypes` makes an absent key differ
 * from an explicit `undefined`, and only the evidence the operator supplied
 * belongs on the row.
 */
function operatorRetryMetadata(
  operatorId: string,
  recovery: SeatSyncRecoveryEvidence | undefined
): OperatorRetryAuditMetadata {
  const metadata: OperatorRetryAuditMetadata = {
    operatorId,
    reason: 'operator_retry'
  }
  if (recovery?.customerId !== undefined) {
    metadata.customerId = recovery.customerId
  }
  if (recovery?.checkoutSessionId !== undefined) {
    metadata.checkoutSessionId = recovery.checkoutSessionId
  }
  return metadata
}

/**
 * The seat-sync consumer: per-seat billing's half of the background worker.
 * Membership and invitation mutations enqueue `SeatSyncQueueMessage`s onto
 * `BILLING_QUEUE` (see `seat-sync.ts` in the capabilities package) so they
 * never await Stripe; this consumer hands each message to
 * `Billing.syncSeats`, which mirrors the member count onto the Stripe
 * subscription item's quantity and batches the `billing.seats_changed` audit
 * event with the stored-quantity update.
 */

/**
 * Core of the seat-sync consumer: one message, one provider reconciliation.
 * Every no-op outcome (`no_subscription`, `quantity_unchanged`, …) acks —
 * they are honest answers, not failures — while a real
 * `CapabilityUnavailable` (Stripe unreachable or rejecting) propagates on the
 * error channel for `consumerInvocation`'s `'retry'` fold, the same shape
 * `processWebhookMessage` presents to its wrapper. Exported with requirements
 * open for tests, like its siblings.
 */
export function processSeatSyncMessage(
  delivery: QueueDelivery<typeof BillingQueueMessage.Type>
): Effect.Effect<
  DeliveryOutcome,
  CapabilityUnavailable,
  Billing | AuditEventLog | Scope.Scope
> {
  return Effect.as(
    Effect.gen(function* () {
      if (delivery.kind === 'malformed') {
        yield* annotateMalformed('skipped')
        return
      }
      const message = delivery.message
      if (message.kind === 'billing.provider_event') {
        const result = yield* applyProviderEvent(message)
        yield* Effect.annotateLogsScoped({
          outcome: result.outcome,
          providerEventId: message.providerEventId
        })
        return
      }
      yield* Effect.annotateLogsScoped({
        workspaceId: message.workspaceId,
        reason: message.reason satisfies SeatSyncQueueReason
      })
      const billing = yield* Billing
      if (message.reason === 'operator_retry') {
        const { operatorId } = message
        if (operatorId === undefined) {
          yield* Effect.annotateLogsScoped({
            outcome: 'skipped',
            skipReason: 'operator_identity_missing'
          })
          return
        }
        let recoveryInput: ReconcileWorkspaceInput = {
          workspaceId: message.workspaceId,
          reason: message.reason
        }
        if (message.recovery !== undefined) {
          recoveryInput = { ...recoveryInput, recovery: message.recovery }
        }
        const result = yield* billing.reconcileWorkspace(recoveryInput)
        // The retry-requested row goes in only once the reconcile settled: a
        // provider failure retries this message, and an event written before
        // the call would append a second row per redelivery.
        yield* Effect.flatMap(AuditEventLog, (audit) =>
          audit.record({
            workspaceId: message.workspaceId,
            actorUserId: null,
            actorType: 'system',
            eventType: 'billing.sync_retry_requested',
            targetType: 'workspace',
            targetId: message.workspaceId,
            metadata: operatorRetryMetadata(operatorId, message.recovery)
          })
        )
        yield* Effect.annotateLogsScoped({
          outcome: 'reconciled',
          recovery: result.outcome,
          drift: result.drift
        })
        return
      }
      const result = yield* billing.syncSeats({
        workspaceId: message.workspaceId,
        reason: message.reason
      })
      // Two annotate calls rather than a conditional spread or a widened
      // dictionary: the quantity key exists only when a quantity was stored.
      yield* Effect.annotateLogsScoped({ outcome: result.outcome })
      if (result.quantity !== null) {
        yield* Effect.annotateLogsScoped({ quantity: result.quantity })
      }
    }),
    'ack' satisfies DeliveryOutcome
  )
}

/**
 * Consumer entry: wraps `processSeatSyncMessage` with the real capabilities
 * layer and a wide event, continuing the trace the membership mutation
 * stamped onto the message. A provider failure reaches the entry's
 * `onFailure: 'retry'` fold — the same contract every other consumer rides.
 */
export function deliverSeatSync(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(BillingQueueMessage, envelope)
  return consumerInvocation(env, {
    event: 'seat_sync',
    delivery,
    onFailure: 'retry',
    program: processSeatSyncMessage(delivery).pipe(
      // The layer needs the billing env only — the seat path reads D1 and,
      // when configured, talks to Stripe directly (no HTTP client service).
      Effect.provide(selectCapabilitiesLayer(billingCapabilitiesEnv(env)))
    )
  })
}
