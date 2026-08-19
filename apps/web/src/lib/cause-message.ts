/**
 * The one place in `apps/web` that turns an unknown thrown value into a string
 * a human can read. Every `Effect.tryPromise` boundary here catches `unknown`
 * — a server function rejection, a Better Auth rejection, a failed `json()` —
 * and needs one sentence out of it, so the `instanceof Error` probe lives here
 * instead of being re-typed at each call site.
 *
 * The parameter is `thrown`, not `cause`: this module is the sanctioned reader
 * of an unknown failure's `message`, and the name keeps the error-named
 * heuristic that flags the idiom elsewhere off the helper that replaces it.
 *
 * `fallback` is required, not optional: the caller always knows which action
 * failed, and a generic default would produce worse copy than the sentence the
 * call site can supply. An empty `Error.message` counts as no message and falls
 * through to `fallback` — `new Error()` must not render as an empty toast.
 */
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `unknown` is the input: this is the parse step for a rejected promise's value, which no schema can narrow before the catch handler runs
export function causeMessage(thrown: unknown, fallback: string): string {
  if (thrown instanceof Error && thrown.message.length > 0) return thrown.message
  return fallback
}
