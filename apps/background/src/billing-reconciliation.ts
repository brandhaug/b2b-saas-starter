import { Billing } from '@b2b-saas-starter/billing/billing'
import {
  billingConfigured,
  billingOptionsFromEnv
} from '@b2b-saas-starter/billing/billing-config'
import { selectCapabilitiesLayer } from '@b2b-saas-starter/capabilities/runtime'
import { Effect } from 'effect'

import { billingCapabilitiesEnv } from './billing-runtime.ts'
import { type Env } from './queue-consumer.ts'

const RECONCILIATION_LIMIT = 25

/**
 * Runs one bounded provider reconciliation pass. Stripe is an optional
 * provider: with no secret configured this returns successfully without
 * constructing a provider client or claiming any synchronization work.
 * Results are folded into one wide event so drift and terminal conflicts are
 * visible to operators while one workspace result cannot hide another.
 */
/** Effect form used by the scheduled handler's existing invocation scope. */
export function reconcileBillingEffect(env: Env, scheduledTime: number) {
  const options = billingOptionsFromEnv(env)
  if (options === undefined || !billingConfigured(options)) {
    return Effect.void
  }
  const program = Effect.gen(function* () {
    yield* Effect.annotateLogsScoped({
      scheduledTime,
      limit: RECONCILIATION_LIMIT
    })
    const billing = yield* Billing
    const results = yield* billing.reconcileBatch({ limit: RECONCILIATION_LIMIT })
    const drifted = results.filter((result) => result.drift.length > 0)
    const terminal = results.filter((result) => result.outcome === 'conflict')
    yield* Effect.annotateLogsScoped({
      outcome: 'completed',
      workspaces: results.length,
      drifted: drifted.length,
      terminal: terminal.length
    })
    if (drifted.length > 0) {
      yield* Effect.annotateLogsScoped({
        driftWorkspaces: drifted.map((result) => result.workspaceId)
      })
    }
    if (terminal.length > 0) {
      yield* Effect.annotateLogsScoped({
        terminalWorkspaces: terminal.map((result) => result.workspaceId)
      })
    }
  })
  return program.pipe(
    Effect.provide(selectCapabilitiesLayer(billingCapabilitiesEnv(env, options))),
    Effect.scoped
  )
}
