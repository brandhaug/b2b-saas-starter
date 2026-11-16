import { Array as Arr, Effect } from 'effect'

/** D1 binds at most 100 parameters per statement. */
export const D1_BOUND_PARAMETER_LIMIT = 100

/**
 * Runs one `IN (...)` read per chunk of `ids`, each chunk sized so the ids plus
 * the statement's `reservedParameters` other bound values fit D1's limit, and
 * concatenates the rows. Chunks run one at a time: they share the invocation's
 * D1 connection, and a request that needs more than a few is already rare.
 */
export function selectInIdChunks<Id extends string, Row, E, R>(
  ids: ReadonlyArray<Id>,
  reservedParameters: number,
  select: (chunk: ReadonlyArray<Id>) => Effect.Effect<ReadonlyArray<Row>, E, R>
): Effect.Effect<ReadonlyArray<Row>, E, R> {
  return Effect.forEach(
    Arr.chunksOf(ids, D1_BOUND_PARAMETER_LIMIT - reservedParameters),
    select,
    { concurrency: 1 }
  ).pipe(Effect.map((chunks) => chunks.flat()))
}

/**
 * A grouped count per id across chunks: `count` returns `{ id, value }` rows
 * for the ids that have any, and every requested id without a row counts 0.
 */
export function countInIdChunks<Id extends string, E, R>(
  ids: ReadonlyArray<Id>,
  reservedParameters: number,
  count: (
    chunk: ReadonlyArray<Id>
  ) => Effect.Effect<
    ReadonlyArray<{ readonly id: Id | null; readonly value: number }>,
    E,
    R
  >
): Effect.Effect<ReadonlyMap<Id, number>, E, R> {
  return selectInIdChunks(ids, reservedParameters, count).pipe(
    Effect.map((rows) => {
      const counted = new Map(rows.map((row) => [row.id, row.value] as const))
      return new Map(ids.map((id) => [id, counted.get(id) ?? 0] as const))
    })
  )
}
