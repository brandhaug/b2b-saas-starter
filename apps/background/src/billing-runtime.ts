import { Billing } from '@b2b-saas-starter/billing/billing'
import {
  billingOptionsFromEnv,
  type BillingOptions
} from '@b2b-saas-starter/billing/billing-config'
import { type StripeProviderEventQueueMessage } from '@b2b-saas-starter/billing/seat-sync'
import { starterEnv, type StarterEnv } from '@b2b-saas-starter/capabilities/runtime'
import { Effect } from 'effect'

import { type Env } from './queue-consumer.ts'

/**
 * The two things every billing entry in this worker needs and none of them
 * owns: the capability env the Stripe-backed layer is selected from, and the
 * one translation from a queued provider event into a `Billing` call.
 */

/**
 * The env a billing-facing capabilities layer is built from: the projected
 * bindings plus the Stripe bag, because `starterEnv` projects bindings only.
 * Absent options are the honest no-op — `syncSeats` answers
 * `provider_not_configured` instead of failing (CLAUDE.md rule 3). Callers
 * that already resolved the options (the reconciliation pass gates on them,
 * the Stripe endpoint verified them) pass theirs in rather than re-reading.
 */
export function billingCapabilitiesEnv(
  env: Env,
  billing: BillingOptions | undefined = billingOptionsFromEnv(env)
): StarterEnv {
  return {
    ...starterEnv(env),
    billing
  }
}

/**
 * Applies one queued provider event. Both billing consumers — the primary
 * queue and its dead letters — carry the same union, so the message-to-input
 * mapping (including the detail evidence operators join back to Stripe) lives
 * here once; each consumer annotates the result in its own vocabulary.
 */
export function applyProviderEvent(message: StripeProviderEventQueueMessage) {
  return Effect.flatMap(Billing, (billing) =>
    billing.processProviderEvent({
      providerEventId: message.providerEventId,
      eventType: message.eventType,
      providerCreatedAt: message.providerCreatedAt,
      workspaceId: message.workspaceId,
      subscription: message.subscription,
      detail: {
        source: message.eventType,
        providerEventId: message.providerEventId,
        providerCreatedAt: message.providerCreatedAt ?? ''
      }
    })
  )
}
