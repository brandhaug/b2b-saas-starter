// Nothing below may be reported by automation/no-silent-error-swallow.

import { Data, Effect } from 'effect'

declare const risky: () => number
declare const attempt: Effect.Effect<number, { readonly _tag: 'Boom' }>
declare const promised: Promise<number>

class ParseError extends Data.TaggedError('ParseError')<{ readonly cause: unknown }> {}

export const logs = () => {
  try {
    risky()
  } catch (error) {
    console.error('risky failed', error)
  }
}

export const rethrows = () => {
  try {
    risky()
  } catch (error) {
    throw error
  }
}

export const wrapsInTaggedError = () => {
  try {
    risky()
  } catch (error) {
    throw new ParseError({ cause: error })
  }
}

export const feedsEffectCombinator = () =>
  Effect.try({ try: risky, catch: (cause) => new ParseError({ cause }) })

export const failsWithTheError = () => {
  try {
    return Effect.succeed(risky())
  } catch (error) {
    return Effect.fail(error)
  }
}

// No binding, but the body logs, so the failure is not silent.
export const logsWithoutBinding = () => {
  try {
    risky()
  } catch {
    console.warn('risky failed')
  }
}

// Underscore prefix is the deliberate opt-out.
export const deliberateDiscard = () => {
  try {
    return risky()
  } catch (_error) {
    return 0
  }
}

export const promiseCatchUsesError = () =>
  promised.catch((error) => {
    console.error(error)
    return 0
  })

export const effectCatchAllUsesError = () =>
  Effect.catchAll(attempt, (error) => Effect.logError(error).pipe(Effect.as(0)))

export const effectCatchTagsUsesError = () =>
  attempt.pipe(
    Effect.catchTags({ Boom: (error) => Effect.fail(new ParseError({ cause: error })) })
  )
