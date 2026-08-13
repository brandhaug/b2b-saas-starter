// Every `/* expect: ... */` marker below must produce exactly one report on
// that line. The test compares markers against oxlint's JSON output.

import { Effect } from 'effect'

declare const risky: () => number
declare const attempt: Effect.Effect<number, { readonly _tag: 'Boom' }>
declare const promised: Promise<number>

export const emptyCatch = () => {
  try {
    risky()
  } catch {} /* expect: no-silent-error-swallow */
}

export const unusedBinding = () => {
  try {
    return risky()
  } catch (error) /* expect: no-silent-error-swallow */ {
    return 0
  }
}

export const promiseCatchDiscards = () =>
  promised.catch(() => 0) /* expect: no-silent-error-swallow */

export const effectCatchAllDiscards = () =>
  Effect.catchAll(
    attempt,
    /* expect: no-silent-error-swallow */ () => Effect.succeed(0)
  )

export const effectCatchTagsDiscards = () =>
  attempt.pipe(
    Effect.catchTags({ Boom: () => Effect.void }) /* expect: no-silent-error-swallow */
  )
