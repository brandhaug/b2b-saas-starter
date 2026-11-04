// Keep this entry point dependency-free; typed Effect errors live in ./capability.

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
