import { m } from '@b2b-saas-starter/i18n/messages'

/** The error envelope returned by Better Auth and the starter's auth gates. */
export type AuthErrorPayload = {
  readonly code?: string | undefined
  readonly message?: string | undefined
}

/** Stable code used when local development has no D1 binding. */
export const LOCAL_D1_UNAVAILABLE_ERROR_CODE = 'local_d1_unavailable'

/** Local-D1 guidance is resolved when called so it follows the request locale. */
export function localD1UnavailableMessage(): string {
  return m.public_auth_local_d1_unavailable()
}

/** Default credential failure; it intentionally does not disclose account state. */
export function signInFailed(): string {
  return m.public_auth_sign_in_failed()
}

type AuthCopy = () => string

/**
 * Maps stable auth codes to localized, safe copy. Unknown codes deliberately
 * fall through to the caller's action-specific fallback.
 */
const AUTH_ERROR_COPY = new Map<string, AuthCopy>([
  [
    'social_link_authentication_required',
    () => m.security_social_link_authentication_required()
  ],
  ['strong_authentication_required', () => m.security_authentication_required()],
  ['INVALID_EMAIL_OR_PASSWORD', signInFailed],
  ['USER_NOT_FOUND', signInFailed],
  ['USER_EMAIL_NOT_FOUND', signInFailed],
  ['CREDENTIAL_ACCOUNT_NOT_FOUND', signInFailed],
  ['INVALID_EMAIL', () => m.public_auth_invalid_email()],
  ['INVALID_PASSWORD', () => m.public_auth_invalid_password()],
  ['EMAIL_NOT_VERIFIED', () => m.public_auth_email_unverified()],
  ['USER_ALREADY_EXISTS', () => m.public_auth_account_exists()],
  ['FAILED_TO_CREATE_USER', () => m.public_auth_cannot_create_account()],
  ['FAILED_TO_CREATE_SESSION', () => m.public_auth_cannot_start_session()],
  ['FAILED_TO_GET_SESSION', () => m.public_auth_cannot_read_session()],
  ['SESSION_EXPIRED', () => m.public_auth_session_expired()],
  ['SESSION_NOT_FRESH', () => m.public_auth_session_not_fresh()],
  ['INVALID_TOKEN', () => m.public_auth_invalid_link()],
  ['TOKEN_EXPIRED', () => m.public_auth_expired_link()],
  ['INVALID_CODE', () => m.public_auth_invalid_code()],
  ['INVALID_BACKUP_CODE', () => m.public_auth_invalid_backup_code()],
  ['OTP_HAS_EXPIRED', () => m.public_auth_expired_code()],
  ['OTP_NOT_ENABLED', () => m.public_auth_email_codes_off()],
  ['OTP_NOT_CONFIGURED', () => m.public_auth_email_codes_unavailable()],
  ['OTP_EXPIRED', () => m.public_auth_expired_code()],
  ['INVALID_OTP', () => m.public_auth_invalid_code()],
  ['TOO_MANY_ATTEMPTS', () => m.public_auth_too_many_attempts()],
  ['TOTP_NOT_ENABLED', () => m.public_auth_authenticator_unavailable()],
  ['TOTP_NOT_CONFIGURED', () => m.public_auth_authenticator_unavailable()],
  ['TWO_FACTOR_NOT_ENABLED', () => m.public_auth_two_factor_off()],
  ['BACKUP_CODES_NOT_ENABLED', () => m.public_auth_backup_codes_off()],
  ['TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE', () => m.public_auth_request_new_code()],
  ['ACCOUNT_TEMPORARILY_LOCKED', () => m.public_auth_account_locked()],
  ['AUTH_CANCELLED', () => m.public_auth_cancelled()],
  ['CHALLENGE_NOT_FOUND', () => m.public_auth_passkey_challenge_expired()],
  ['PASSKEY_NOT_FOUND', () => m.public_auth_passkey_not_found()],
  ['AUTHENTICATION_FAILED', () => m.public_auth_passkey_failed()],
  ['ERROR_CEREMONY_ABORTED', () => m.public_auth_passkey_prompt_dismissed()],
  ['UNKNOWN_ERROR', () => m.public_auth_passkey_failed()],
  ['rate_limited', () => m.public_auth_too_many_attempts()],
  ['sso_required', () => m.public_auth_sso_required()],
  ['sso_connection_disabled', () => m.public_auth_sso_connection_disabled()],
  ['two_factor_required', () => m.public_auth_two_factor_required()],
  ['captcha_rejected', () => m.public_auth_captcha_rejected()],
  ['captcha_unavailable', () => m.public_auth_captcha_unavailable()],
  [LOCAL_D1_UNAVAILABLE_ERROR_CODE, localD1UnavailableMessage]
])

/** Returns localized copy for a known code, or undefined for an unknown one. */
export function copyForAuthCode(
  error: AuthErrorPayload | null | undefined
): string | undefined {
  const code = error?.code
  return code === undefined ? undefined : AUTH_ERROR_COPY.get(code)?.()
}

/** Resolves a known code and otherwise keeps the caller's localized fallback. */
export function authErrorCopy(
  error: AuthErrorPayload | null | undefined,
  fallback: string
): string {
  return copyForAuthCode(error) ?? fallback
}
