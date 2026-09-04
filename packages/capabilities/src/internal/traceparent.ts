/**
 * Adds the producing request's `traceparent` onto a queue message. The field
 * is an optional *key* on every queue wire schema, so it is only present when
 * a span exists (tests, direct calls run without one).
 *
 * One helper for every queue producer — webhooks, seat sync, exports, instant
 * email — so the continuation contract stays one shape: the background
 * consumer joins the trace the producing request opened instead of starting
 * an unrelated one.
 */
export function withTraceparent<T extends object>(
  message: T,
  traceparent: string | undefined
): T {
  if (traceparent === undefined) {
    return message
  }
  return { ...message, traceparent }
}
