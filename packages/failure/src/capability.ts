import { Cause, Effect, Schema } from 'effect'
import { failureMessage } from './index.ts'
import { isPersistenceDecodeError, persistenceReason } from './persistence.ts'

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
    Effect.catchCause(effect, (cause) =>
      Effect.failCause(
        Cause.fromReasons(
          cause.reasons.map((reason): Cause.Reason<CapabilityUnavailable> => {
            if (Cause.isFailReason(reason)) {
              return Cause.makeFailReason(
                new CapabilityUnavailable({
                  capability,
                  reason:
                    persistenceReason(reason.error) ?? failureMessage(reason.error)
                })
              )
            }
            // Drizzle's synchronous row mapper throws codec errors as defects.
            // Preserve all other defects and interruptions, including mixed causes.
            if (Cause.isDieReason(reason) && isPersistenceDecodeError(reason.defect)) {
              return Cause.makeFailReason(
                new CapabilityUnavailable({
                  capability,
                  reason: `persistence_decode:${reason.defect.column}:${reason.defect.operation}`
                })
              )
            }
            return reason
          })
        )
      )
    )
}
