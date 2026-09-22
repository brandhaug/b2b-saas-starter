import { Effect, Result } from 'effect'
import { annotateWideEvent } from '@b2b-saas-starter/logger'

/**
 * Runs `effect` for its side effect and refuses to fail: a rejection is
 * downgraded to an annotation on the current span's wide event — the fields
 * `onFailure` derives from the failure — so the mutation that produced the
 * event never turns into an error because a side-channel (queue, email) was
 * down. The outcome is returned for a caller that words the success path
 * differently.
 *
 * Shared by webhook publication, delivery notifications, and instant email
 * fan-out, which all hold the same contract: durable record first,
 * best-effort delivery after.
 */
export function bestEffort<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  // oxlint-disable-next-line anti-slop/no-unsafe-dictionary-type -- the logger sanitizes the caller-derived annotation bag
  onFailure: (failure: E) => Record<string, unknown>
): Effect.Effect<Result.Result<A, E>, never, R> {
  return Effect.gen(function* () {
    const outcome = yield* Effect.result(effect)
    if (Result.isFailure(outcome)) {
      yield* annotateWideEvent(onFailure(outcome.failure))
    }
    return outcome
  })
}
