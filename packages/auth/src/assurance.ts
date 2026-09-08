// oxlint-disable effect/noGlobals -- Pure timestamp policy shared with native Better Auth callbacks; callers may provide their own clock.
const PASSWORD_TOTP_PAIRING_SECONDS = 60 * 5
const RECOVERY_SESSION_SECONDS = 60 * 60

export function passwordTOTPCanPair(
  input: { readonly passwordVerifiedAt?: Date | null },
  now = new Date()
): boolean {
  const at = input.passwordVerifiedAt?.getTime()
  return (
    at !== undefined &&
    now.getTime() >= at &&
    (now.getTime() - at) / 1000 <= PASSWORD_TOTP_PAIRING_SECONDS
  )
}

export function recoveryExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + RECOVERY_SESSION_SECONDS * 1000)
}
