/**
 * The field validators shared by the auth forms. Kept out of
 * `auth-submit-button.tsx` so that file stays a components-only module.
 */

/**
 * The email validator: required, and shaped like an address. Deliberately
 * shallow — Better Auth owns the real check.
 */
export function emailValidator({ value }: { value: string }): string | undefined {
  if (value.length === 0) {
    return 'Email is required'
  }
  if (!value.includes('@')) {
    return 'Enter a valid email'
  }
  return
}

/**
 * The password validator: mirrors the server's `minPasswordLength` (12) in
 * `packages/auth` so a too-short password fails in the form instead of as a
 * round-trip server error.
 */
export function passwordValidator({ value }: { value: string }): string | undefined {
  return value.length < 12 ? 'Password must be at least 12 characters' : undefined
}
