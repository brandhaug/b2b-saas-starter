import { BillingQueueMessage } from '@b2b-saas-starter/billing/seat-sync'
import { Billing } from '@b2b-saas-starter/billing/billing'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { type CapabilityUnavailable } from '@b2b-saas-starter/failure/capability'
import { Effect, type Scope } from 'effect'

import { billingDlqConsumerSettings } from '../../../infra/bindings.ts'
import { applyProviderEvent, billingCapabilitiesEnv } from './billing-runtime.ts'
import { finalQueueAttempt } from './monitoring.ts'
import {
  annotateMalformed,
  consumerInvocation,
  readDelivery,
  type DeliveryOutcome,
  type Env,
  type QueueDelivery,
  type QueueEnvelope
} from './queue-consumer.ts'

/**
 * A billing message that exhausted the primary queue is durable evidence of
 * unresolved synchronization. Marking the workspace for the next bounded
 * reconciliation pass makes the failure recoverable and gives operators an
 * audited retry trail without an unauthenticated HTTP recovery endpoint.
 */
export function processBillingDeadLetterMessage(
  delivery: QueueDelivery<typeof BillingQueueMessage.Type>
): Effect.Effect<DeliveryOutcome, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.as(
    Effect.gen(function* () {
      if (delivery.kind === 'malformed') {
        yield* annotateMalformed('terminal')
        return
      }
      if (delivery.message.kind === 'billing.provider_event') {
        const message = delivery.message
        const result = yield* applyProviderEvent(message)
        yield* Effect.annotateLogsScoped({
          outcome: 'terminal',
          providerEventId: message.providerEventId,
          recovery: 'provider_event',
          billingOutcome: result.outcome
        })
        return
      }
      const billing = yield* Billing
      const result = yield* billing.reconcileWorkspace({
        workspaceId: delivery.message.workspaceId
      })
      yield* Effect.annotateLogsScoped({
        outcome: 'terminal',
        workspaceId: delivery.message.workspaceId,
        recovery: result.outcome,
        drift: result.drift
      })
    }),
    'ack' satisfies DeliveryOutcome
  )
}

/**
 * The bounded recovery arm, shared by every way this consumer can fail to
 * recover a dead letter: retry while Cloudflare will still redeliver, ack on
 * the last attempt. Unbounded retry would spin on a permanent fault; acking
 * the first failure would drop the only evidence of unresolved billing drift.
 * Exported so the defect fold can be driven directly in a test — the entry
 * below hands this same function to `consumerInvocation`.
 */
export function boundedRecoveryOutcome(attempts: number): DeliveryOutcome {
  if (finalQueueAttempt(attempts, billingDlqConsumerSettings)) {
    return 'ack'
  }
  return 'retry'
}

/**
 * Dead-letter consumer entry, folded the way the webhook DLQ folds: the
 * recovery attempt is the only thing standing between an exhausted billing
 * message and silent drift, so a provider or store failure rides a bounded
 * retry — and past the bound acks with the loss annotated on the wide event
 * instead of looping. `onFailure` takes the same bounded arm, so a defect (a
 * decode bug, an unexpected throw) cannot ack the dead letter on its first
 * delivery either; the wide event carries the cause it exited with.
 */
export function recoverBillingDeadLetter(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(BillingQueueMessage, envelope)
  const program: Effect.Effect<DeliveryOutcome, never, Scope.Scope> =
    processBillingDeadLetterMessage(delivery).pipe(
      Effect.provide(selectCapabilitiesLayer(billingCapabilitiesEnv(env))),
      Effect.catchTag(
        'CapabilityUnavailable',
        (): Effect.Effect<DeliveryOutcome, never, Scope.Scope> => {
          if (boundedRecoveryOutcome(delivery.attempts) === 'retry') {
            return Effect.annotateLogsScoped({
              outcome: 'retry',
              skipReason: 'recovery_failed'
            }).pipe(Effect.as<'retry'>('retry'))
          }
          return Effect.annotateLogsScoped({
            outcome: 'unrecovered',
            skipReason: 'recovery_failed'
          }).pipe(Effect.as<'ack'>('ack'))
        }
      )
    )
  return consumerInvocation(env, {
    event: 'billing_dead_letter',
    delivery,
    onFailure: boundedRecoveryOutcome,
    program
  })
}
