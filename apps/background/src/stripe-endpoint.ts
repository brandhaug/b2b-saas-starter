import { withTriggerScope } from '@b2b-saas-starter/logger'
import { Effect, Result, Schema, type Scope } from 'effect'
import {
  Billing,
  planForStripeEvent
} from '@b2b-saas-starter/capabilities/src/billing/billing.ts'
import { type CapabilityUnavailable } from '@b2b-saas-starter/capabilities/src/errors.ts'
import {
  selectCapabilitiesLayer,
  starterEnv
} from '@b2b-saas-starter/capabilities/src/runtime.ts'
import { type Env } from './webhook-consumer.ts'

/**
 * The subset of a Stripe event body this worker understands. Everything else
 * decodes fine and is ignored — an unknown event type is not an error, the
 * same leniency the webhook delivery reader applies.
 */
export const StripeEventBody = Schema.Struct({
  type: Schema.String,
  data: Schema.Struct({
    object: Schema.Struct({
      client_reference_id: Schema.optionalKey(Schema.String),
      metadata: Schema.optionalKey(
        Schema.Struct({
          workspaceId: Schema.optionalKey(Schema.String),
          planId: Schema.optionalKey(Schema.String)
        })
      )
    })
  })
})
// One codec for the raw-body boundary: JSON parse and shape decode in one
// total step, so malformed input is a `Result` failure rather than a throw.
const decodeStripeEvent = Schema.decodeUnknownResult(
  Schema.fromJsonString(StripeEventBody)
)

/**
 * Core of the Stripe webhook: map the event onto a plan change via the shared
 * billing policy (`planForStripeEvent`) and hand it to the billing capability,
 * which updates `workspaces.planId` and writes the matching audit event
 * atomically. Malformed or irrelevant events skip (log-and-return); real
 * failures fail so `handleStripeWebhook` rejects and the fetch handler answers
 * 500, which is what makes Stripe redeliver. Exported with requirements open
 * for tests, like `processWebhookMessage`.
 */
export function processStripeEvent(
  payload: string
): Effect.Effect<void, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.gen(function* () {
    const decoded = decodeStripeEvent(payload)
    if (Result.isFailure(decoded)) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'unexpected_shape'
      })
      return
    }
    const event = decoded.success
    const object = event.data.object
    const metadata = object.metadata ?? {}
    const workspaceId = metadata.workspaceId ?? object.client_reference_id
    yield* Effect.annotateLogsScoped({ stripeEventType: event.type })
    const plan = planForStripeEvent(event.type)
    if (!plan) {
      yield* Effect.annotateLogsScoped({
        outcome: 'ignored',
        reason: 'unhandled_event_type'
      })
      return
    }
    if (plan.kind === 'from_metadata') {
      if (!workspaceId || !metadata.planId) {
        yield* Effect.annotateLogsScoped({
          outcome: 'skipped',
          skipReason: 'missing_workspace_or_plan'
        })
        return
      }
      yield* applyPlan(workspaceId, metadata.planId, event.type)
      return
    }
    if (!workspaceId) {
      yield* Effect.annotateLogsScoped({
        outcome: 'skipped',
        skipReason: 'missing_workspace'
      })
      return
    }
    yield* applyPlan(workspaceId, plan.planId, event.type)
  })
}

/** One plan change per handled event; annotates applied vs unknown workspace. */
function applyPlan(
  workspaceId: string,
  planId: string,
  source: string
): Effect.Effect<void, CapabilityUnavailable, Billing | Scope.Scope> {
  return Effect.gen(function* () {
    const billing = yield* Billing
    const applied = yield* billing.applyProviderEvent({
      workspaceId,
      planId,
      detail: { source }
    })
    if (applied) {
      yield* Effect.annotateLogsScoped({ outcome: 'applied' })
    } else {
      yield* Effect.annotateLogsScoped({ outcome: 'unknown_workspace' })
    }
  })
}

/**
 * Entry wrapper for the Stripe webhook: provides the real capabilities layer
 * and a wide event so operators can see every inbound provider event. Failures
 * propagate on purpose — the fetch handler answers 500 on rejection so Stripe
 * schedules a redelivery.
 */
export function handleStripeWebhook(
  payload: string,
  env: Env
): Effect.Effect<void, CapabilityUnavailable, never> {
  const program = processStripeEvent(payload).pipe(
    Effect.provide(selectCapabilitiesLayer(starterEnv(env)))
  )
  return withTriggerScope(
    {
      service: 'background',
      event: 'stripe_webhook',
      env,
      spanKind: 'consumer'
    },
    program
  )
}
