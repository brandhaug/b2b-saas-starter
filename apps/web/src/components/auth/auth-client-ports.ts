import { authClient } from '@/lib/auth-client'
import { type AuthResult } from '@/lib/auth-result'

/**
 * Verifying the second factor (both the sign-in challenge page and the
 * account panel), as a port. Injected rather than reaching for the
 * `authClient` singleton at the call site so a test drives the form with a
 * real function of this shape instead of replacing `@/lib/auth-client`.
 */
export type VerifyTotpCode = (input: { readonly code: string }) => Promise<AuthResult>

export function verifyTotpWithAuthClient(
  input: Parameters<VerifyTotpCode>[0]
): ReturnType<VerifyTotpCode> {
  return authClient.twoFactor.verifyTotp({ code: input.code })
}

/**
 * The TOTP code field validator shared by both verify surfaces: exactly six
 * digits. Deliberately shallow — Better Auth owns the real check.
 */
export function sixDigitCodeValidator({
  value
}: {
  value: string
}): string | undefined {
  return /^\d{6}$/.test(value) ? undefined : 'Enter the 6-digit code'
}
