/**
 * Better Auth's client resolves with `{ error }` instead of rejecting, so a
 * failed call reads as a success to anything that only watches the promise.
 * This module is the one place that converts that convention into a rejection,
 * which is the failure channel `callServerFn` — and so `useServerAction` —
 * already folds into a message.
 */
export type AuthResult<D> = {
  readonly data?: D | null
  readonly error?: { readonly message?: string | undefined } | null
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
    return authFailure(result.error.message ?? fallback)
  }
  return result.data ?? null
}
