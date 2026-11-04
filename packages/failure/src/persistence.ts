import { Predicate, Schema } from 'effect'

// oxlint-disable-next-line unicorn/throw-new-error -- Schema.TaggedError is a curried error factory
export class PersistenceDecodeError extends Schema.TaggedError<PersistenceDecodeError>()(
  'PersistenceDecodeError',
  { column: Schema.String, operation: Schema.Literals(['read', 'write']) }
) {}

export const isPersistenceDecodeError = Schema.is(PersistenceDecodeError)

/** Driver messages can contain SQL, bound credentials and rejected JSON. */
export function persistenceReason(error: unknown): string | undefined {
  if (isPersistenceDecodeError(error)) {
    return `persistence_decode:${error.column}:${error.operation}`
  }
  if (Predicate.isTagged(error, 'SchemaError')) {
    return 'persistence_decode'
  }
  if (
    Predicate.isTagged(error, 'EffectDrizzleQueryError') ||
    Predicate.isTagged(error, 'SqlError') ||
    Predicate.isTagged(error, 'DbBatchError')
  ) {
    return 'persistence_sql'
  }
}
