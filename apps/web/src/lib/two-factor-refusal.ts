/**
 * The TOTP gate's refusal vocabulary, stated once for the two halves that
 * spell it: the server-side gate (`lib/server/two-factor-sign-in-gate.ts`)
 * writes the code into its JSON body and its redirect, and the sign-in
 * surfaces render the message as guidance. One module because the halves
 * must not drift — the gate's refusal and the page's notice are the same
 * sentence, or the visitor reads two different stories about one event.
 *
 * A leaf on purpose: no imports, client-safe, importable from both the
 * server gate and the client ports without dragging the auth client into a
 * server bundle.
 */
export const TWO_FACTOR_REQUIRED_ERROR_CODE = 'two_factor_required'

export const TWO_FACTOR_REQUIRED_MESSAGE =
  'This account uses two-factor authentication. Sign in with your password and authenticator.'
