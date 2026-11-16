import { Effect, Predicate } from 'effect'

/** The HTTP-safe error a narrowing produces: code-owned and tagged. */
type CodeOwnedError = { readonly _tag: string }

// Each narrowed error remembers the first identity in its chain, so a second
// narrowing (storage failure -> CapabilityUnavailable -> ConversationUnavailable)
// still reports the storage failure instead of the intermediate wrapper.
const chainRoots = new WeakMap<object, string>()

/** The replaced failure's identity: its chain root, its own `_tag`, or `untagged`. Never its message. */
function identityOf(replaced: unknown): string {
  const root = narrowedCauseTag(replaced)
  if (root !== undefined) {
    return root
  }
  if (Predicate.hasProperty(replaced, '_tag') && Predicate.isString(replaced._tag)) {
    return replaced._tag
  }
  return 'untagged'
}

/**
 * The `causeTag` of an error produced by a narrowing, or `undefined` for any
 * other value. The logger reads it from a request's final failure.
 */
export function narrowedCauseTag(error: unknown): string | undefined {
  if (!Predicate.isObject(error)) {
    return undefined
  }
  return chainRoots.get(error)
}

/** Links `narrowed` to the identity of the failure it replaces. */
export function narrowedFrom<E extends CodeOwnedError>(
  replaced: unknown,
  narrowed: E
): E {
  chainRoots.set(narrowed, identityOf(replaced))
  return narrowed
}

/**
 * Replaces every typed failure with a code-owned one that remembers the
 * replaced failure's identity as its `causeTag`. Defects and interruptions
 * pass through untouched. Use it wherever a provider, storage or decode
 * failure becomes an HTTP-safe error that carries no cause.
 */
export function narrowFailure<E, E2 extends CodeOwnedError>(
  narrow: (failure: E) => E2
): <A, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E2, R> {
  return Effect.mapError((error) => narrowedFrom(error, narrow(error)))
}

/** `Effect.try` whose thrown value is narrowed into a code-owned error. */
export function attempt<A, E extends CodeOwnedError>(options: {
  readonly try: () => A
  readonly narrow: (thrown: unknown) => E
}): Effect.Effect<A, E> {
  return Effect.try({
    try: options.try,
    catch: (thrown) => narrowedFrom(thrown, options.narrow(thrown))
  })
}

/** `Effect.tryPromise` whose rejection is narrowed into a code-owned error. */
export function attemptPromise<A, E extends CodeOwnedError>(options: {
  readonly try: (signal: AbortSignal) => PromiseLike<A>
  readonly narrow: (thrown: unknown) => E
}): Effect.Effect<A, E> {
  return Effect.tryPromise({
    try: options.try,
    catch: (thrown) => narrowedFrom(thrown, options.narrow(thrown))
  })
}
