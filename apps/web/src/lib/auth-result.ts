import { type AuthErrorPayload, copyForAuthCode } from './auth-error-copy'

/**
 * Better Auth's client resolves with `{ error }` instead of rejecting, so a
 * failed call reads as a success to anything that only watches the promise.
 * This module is the one place that converts that convention into a rejection,
 * which is the failure channel `callServerFn` — and so `useServerAction` —
 * already folds into a message.
 */
/**
 * The response shape the Better Auth client endpoints return. `data` is opaque
 * on purpose — Better Auth's client types don't expose every marker (the
 * two-factor redirect, the plugin's status flags), so consumers decode what
 * they need rather than assert on the body. The error envelope's `code` is
 * what user-facing copy comes from (`lib/auth-error-copy.ts`), never the
 * message.
 */
export type AuthResult<D = unknown> = {
  readonly data?: D | null | undefined
  readonly error?: AuthErrorPayload | null
}

/**
 * Rejects with a message, for the calls whose own response shape says the
 * request failed even though `error` is absent (an enrollment that came back
 * without a TOTP URI, say).
 */
export function authFailure(message: string): never {
  // oxlint-disable-next-line effect/noThrowStatement, effect/noNewError -- the rejection is the failure channel `callServerFn` folds into a message, and `causeMessage` reads `Error.message` off it; this is the single place that converts Better Auth's `{ error }` convention, which is why the disable lives here rather than at each panel
  throw new Error(message)
}

/** The data of a Better Auth call, or a rejection carrying its message. */
export async function unwrapAuthResult<D>(
  run: () => Promise<AuthResult<D>>,
  fallback: string
): Promise<D | null> {
  const result = await run()
  if (result.error) {
    // Known codes get the table's sentence; everything else gets the
    // caller's fallback. Never `error.message`: a raw message is whatever
    // the far end put on the wire — a class name from a proxy 500, a stack
    // fragment — and the account panels read this string to the visitor.
    return authFailure(copyForAuthCode(result.error) ?? fallback)
  }
  return result.data ?? null
}
