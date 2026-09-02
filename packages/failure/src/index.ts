/**
 * One reader for an unknown thrown value.
 *
 * Every `Effect.tryPromise`, `Effect.try` and `.catch` boundary in the repo
 * catches `unknown` and needs one sentence out of it. That probe was written
 * seven times — in the logger, the db batch, the email dispatcher, the rate
 * limiter, the assistant, two capability boundaries and the web app — each
 * copy carrying its own pair of lint suppressions. This package is the leaf
 * every one of them can depend on, so the suppressions live here alone (see
 * the single-file override in `lint.config.ts`).
 *
 * It has no dependencies, not even `effect`: it is a string function.
 */

/**
 * The message an `Error` carries, or `undefined` for anything else —
 * including an `Error` whose message is empty, which reads as no message
 * rather than as an empty toast.
 *
 * Callers choose what absence means: {@link failureMessage} falls back to the
 * value's own string form, while a UI falls back to copy naming the action
 * that failed.
 */
export function errorMessage(thrown: unknown): string | undefined {
  if (thrown instanceof Error && thrown.message.length > 0) {
    return thrown.message
  }
  return undefined
}

/**
 * An unknown thrown value as a message, always. Use it where the string is
 * going into a log line or a typed error's `reason`, and there is no better
 * sentence to fall back to.
 */
export function failureMessage(thrown: unknown): string {
  return errorMessage(thrown) ?? String(thrown)
}
