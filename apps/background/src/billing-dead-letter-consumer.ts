import { SeatSyncQueueMessage } from '@b2b-saas-starter/capabilities/billing/seat-sync'
import { Billing } from '@b2b-saas-starter/capabilities/billing/billing'
import { billingOptionsFromEnv } from '@b2b-saas-starter/capabilities/billing/billing-config'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/runtime'
import { Effect, type Scope } from 'effect'

import {
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
  delivery: QueueDelivery<typeof SeatSyncQueueMessage.Type>
): Effect.Effect<DeliveryOutcome, unknown, Billing | Scope.Scope> {
  return Effect.as(
    Effect.gen(function* () {
      if (delivery.kind === 'malformed') {
        yield* Effect.annotateLogsScoped({
          outcome: 'terminal',
          skipReason: 'malformed_message'
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

export function recoverBillingDeadLetter(
  envelope: QueueEnvelope,
  env: Env
): Effect.Effect<DeliveryOutcome> {
  const delivery = readDelivery(SeatSyncQueueMessage, envelope)
  return consumerInvocation(env, {
    event: 'billing_dead_letter',
    delivery,
    onFailure: 'retry',
    program: processBillingDeadLetterMessage(delivery).pipe(
      Effect.provide(
        selectCapabilitiesLayer({
          ...starterEnv(env),
          billing: billingOptionsFromEnv(env)
        })
      )
    )
  })
}
