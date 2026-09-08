import { Effect, Schema } from 'effect'
import { failureMessage } from './index.ts'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried factory call, not an un-new-ed error constructor
export class CapabilityUnavailable extends Schema.TaggedError<CapabilityUnavailable>()(
  'CapabilityUnavailable',
  { capability: Schema.String, reason: Schema.String },
  { httpApiStatus: 503 }
) {}

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
