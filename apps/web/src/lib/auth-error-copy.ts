import { TWO_FACTOR_REQUIRED_MESSAGE } from './two-factor-refusal'

/**
 * Human sentences for the machine codes the auth screens can fail with.
 *
 * The screens never render `error.message`: a raw message is whatever the
 * far end put on the wire — a JavaScript class name when a proxy 500s, a
 * stack fragment, a provider's English — none of it copy a visitor should
 * read, and screen-reader users get whatever lands there read out
 * assertively. `error.code` is the stable contract (Better Auth's base and
 * plugin codes, plus the starter's own `{ code }` gate bodies), so the code
 * → sentence mapping lives here, once, and every auth surface reads its
 * copy through `authErrorCopy`.
 *
 * A leaf beside `two-factor-refusal.ts` on purpose: no imports beyond that
 * sibling, client-safe, importable from the sign-in card, the panels, and
 * the server routes that answer these codes without dragging anything heavy
 * across the boundary.
 */

/** The one sentence every unclassified sign-in failure shows. */
export const SIGN_IN_FAILED = 'Sign in failed. Check your credentials and try again.'

/**
 * The wire code and sentence for the no-local-D1 state: the dev server is
 * running without a migrated local D1, so every auth request that needs the
 * database answers 503 with this code (see `lib/server/auth-local-d1.ts`).
 * The client maps the code to the sentence, so the card shows the fix rather
 * than a wrong-password failure.
 */
export const LOCAL_D1_UNAVAILABLE_ERROR_CODE = 'local_d1_unavailable'

export const LOCAL_D1_UNAVAILABLE_MESSAGE =
  'The local database is not set up yet. Run pnpm run db:migrate:local && pnpm run db:seed, then restart the dev server and try again.'

/**
 * The error envelope's readable half: `code` is the machine discriminant
 * this module maps, `message` the far end's own words (kept for callers
 * that know their port promises readable messages — never the sign-in
 * surfaces).
 */
export type AuthErrorPayload = {
  readonly code?: string | undefined
  readonly message?: string | undefined
}

/**
 * The table. Codes that must not disclose more than the endpoint does
 * (wrong password, unknown account) all collapse into the same sentence;
 * codes whose meaning the visitor can act on get their own.
 */
// oxlint-disable-next-line anti-slop/no-known-value-widening -- the table is open on purpose: an unknown code from a newer server must fall through to the caller's fallback, so the key set is not a closed contract to preserve
const AUTH_ERROR_COPY: Readonly<Record<string, string>> = {
  // Credential exchange — non-disclosing by rule, one sentence for all of it.
  INVALID_EMAIL_OR_PASSWORD: SIGN_IN_FAILED,
  USER_NOT_FOUND: SIGN_IN_FAILED,
  USER_EMAIL_NOT_FOUND: SIGN_IN_FAILED,
  CREDENTIAL_ACCOUNT_NOT_FOUND: SIGN_IN_FAILED,
  INVALID_EMAIL: 'Enter a valid email address and try again.',
  INVALID_PASSWORD: 'That password is incorrect. Try again.',
  EMAIL_NOT_VERIFIED:
    'Your email is not verified yet. Check your inbox for a verification email.',
  USER_ALREADY_EXISTS: 'An account with that email already exists. Sign in instead.',
  FAILED_TO_CREATE_USER: 'Could not create the account. Try again.',
  FAILED_TO_CREATE_SESSION: 'Could not start a session. Try again.',
  FAILED_TO_GET_SESSION: 'Could not read the session. Try again.',
  SESSION_EXPIRED: 'Your session expired. Sign in again.',
  SESSION_NOT_FRESH:
    'Your session is no longer fresh enough for this. Sign in again and retry.',
  INVALID_TOKEN: 'That link or code is invalid. Request a new one.',
  TOKEN_EXPIRED: 'That link or code has expired. Request a new one.',
  // The two-factor plugin's codes.
  INVALID_CODE: 'That code is incorrect. Check it and try again.',
  INVALID_BACKUP_CODE:
    'That backup code is invalid. Each code works once. Try the next one.',
  OTP_HAS_EXPIRED: 'That code has expired. Request a new one.',
  OTP_NOT_ENABLED: 'Email codes are not on for this account.',
  OTP_NOT_CONFIGURED: 'Email codes are not available for this account.',
  // The email-OTP plugin's codes (the email-code sign-in flow; distinct from
  // the two-factor plugin's `OTP_*` set above).
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  INVALID_OTP: 'That code is incorrect. Check it and try again.',
  TOO_MANY_ATTEMPTS: 'Too many attempts. Wait a moment and try again.',
  TOTP_NOT_ENABLED: 'An authenticator app is not set up for this account.',
  TOTP_NOT_CONFIGURED: 'An authenticator app is not set up for this account.',
  TWO_FACTOR_NOT_ENABLED: 'Two-factor authentication is not on for this account.',
  BACKUP_CODES_NOT_ENABLED: 'Backup codes are not on for this account.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE:
    'Too many attempts. Request a new code and try again.',
  ACCOUNT_TEMPORARILY_LOCKED:
    'Too many failed attempts. The account is temporarily locked. Try again later.',
  // The passkey plugin's client codes (the ceremony's own failures).
  AUTH_CANCELLED: 'The passkey action was cancelled. Try again when you are ready.',
  CHALLENGE_NOT_FOUND: 'The passkey challenge expired. Start the sign-in again.',
  PASSKEY_NOT_FOUND:
    'No passkey on this device matches the account. Sign in with a password instead.',
  AUTHENTICATION_FAILED: 'The passkey did not verify. Try again.',
  ERROR_CEREMONY_ABORTED:
    'The passkey prompt was dismissed before it finished. Try again when you are ready.',
  UNKNOWN_ERROR:
    'The passkey did not work. Try again, or sign in with a password instead.',
  // The starter's own gates and limits — Better Auth's `{ code }` body
  // convention, answered by `api.auth.$.ts` and the auth runtime.
  rate_limited: 'Too many attempts. Wait a moment and try again.',
  sso_required:
    'This workspace requires single sign-on for your email domain. Sign in with your identity provider.',
  sso_connection_disabled:
    'Single sign-on for this domain is disabled. Sign in with your email and password.',
  two_factor_required: TWO_FACTOR_REQUIRED_MESSAGE,
  captcha_rejected: 'The bot check failed. Try the challenge again.',
  captcha_unavailable: 'The bot check is unavailable right now. Try again in a moment.',
  // The 503 the auth runtime answers without a local D1 (see above).
  [LOCAL_D1_UNAVAILABLE_ERROR_CODE]: LOCAL_D1_UNAVAILABLE_MESSAGE
}

/**
 * The copy for an error's code, or `undefined` when the code is absent or
 * unknown — the caller decides what the absence means (its own fallback, or
 * a message it trusts) rather than this module guessing.
 */
export function copyForAuthCode(
  error: AuthErrorPayload | null | undefined
): string | undefined {
  const code = error?.code
  return code === undefined ? undefined : AUTH_ERROR_COPY[code]
}

/**
 * The copy for a failed auth call: the table's sentence for a known code,
 * the caller's fallback otherwise. The fallback is required, not optional:
 * the call site always knows which action failed, and a generic default
 * would produce worse copy than the sentence it can supply.
 */
export function authErrorCopy(
  error: AuthErrorPayload | null | undefined,
  fallback: string
): string {
  return copyForAuthCode(error) ?? fallback
}
