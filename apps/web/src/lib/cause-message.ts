import { errorMessage } from '@b2b-saas-starter/failure'

/**
 * An unknown thrown value as copy a human can read, with the caller's own
 * sentence when the value carries none.
 *
 * The `instanceof Error` probe itself lives in `@b2b-saas-starter/failure`;
 * this is the app's fallback policy on top of it. `fallback` is required, not
 * optional: the call site always knows which action failed, and a generic
 * default would produce worse copy than the sentence it can supply.
 *
 * The parameter is `thrown`, not `cause`, so the error-named heuristic that
 * flags the raw idiom elsewhere stays off the helper that replaces it.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `unknown` is the input: this is the parse step for a rejected promise's value, which no schema can narrow before the catch handler runs
export function causeMessage(thrown: unknown, fallback: string): string {
  return errorMessage(thrown) ?? fallback
}
