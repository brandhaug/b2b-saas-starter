/**
 * The field validators shared by the auth forms. Kept out of
 * `auth-submit-button.tsx` so that file stays a components-only module.
 */
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * The email validator: required, and shaped like an address. Deliberately
 * shallow — Better Auth owns the real check.
 */
export function emailValidator({ value }: { value: string }): string | undefined {
  if (value.length === 0) {
    return m.public_auth_email_required()
  }
  if (!value.includes('@')) {
    return m.public_auth_valid_email()
  }
  return
}

/**
 * The password validator: mirrors the server's `minPasswordLength` (12) and
 * `maxPasswordLength` (256) in `packages/auth` so an out-of-policy password
 * fails in the form instead of as a round-trip server error. The cap is not
 * decoration — Better Auth refuses a longer one outright.
 */
export function passwordValidator({ value }: { value: string }): string | undefined {
  if (value.length < 12) {
    return m.public_auth_password_min()
  }
  if (value.length > 256) {
    return m.public_auth_password_max()
  }
  return
}
