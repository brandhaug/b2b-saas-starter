import { failureMessage } from '@b2b-saas-starter/failure'
import { Effect } from 'effect'
import { CapabilityUnavailable } from '../errors.ts'

/**
 * Maps D1/query failures onto the shared `CapabilityUnavailable` (503) typed
 * error so callers see infrastructure failures in the error channel instead of
 * as defects. Apply to every Live-layer database call.
 */
export function orUnavailable(
  capability: string
): <A, E, R>(
  effect: Effect.Effect<A, E, R>
) => Effect.Effect<A, CapabilityUnavailable, R> {
  return (effect) =>
    Effect.mapError(
      effect,
      (error) =>
        new CapabilityUnavailable({ capability, reason: failureMessage(error) })
    )
}
