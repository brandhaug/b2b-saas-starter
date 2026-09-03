import { authClient } from '@/lib/auth-client'
import { type AuthResult } from '@/lib/auth-result'

/**
 * One Better Auth client endpoint, as a port: the input it takes, and the
 * `{ data, error }` envelope its client resolves with.
 *
 * Every auth surface takes the endpoints it drives as props of this shape and
 * defaults them to the adapters below, rather than reaching for the
 * `authClient` singleton at the call site — so a test drives the screen with
 * real functions of the same shape instead of replacing `@/lib/auth-client`,
 * which is a Better Auth client with plugins attached and not something worth
 * re-creating. The adapters are hoisted to module scope rather than written
 * inline as defaults: a new function expression per render would be a fresh
 * prop value every time.
 *
 * This comment is the rationale for all of them; the ports below do not repeat
 * it.
 */
export type AuthPort<I = void, D = unknown> = (input: I) => Promise<AuthResult<D>>

/* -------------------------------------------------------------------------- */
/* Credentials                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Credential sign-in. The response body is opaque: Better Auth's client types
 * don't expose the two-factor marker, so `/sign-in` decodes it rather than
 * asserting on it.
 */
export type SignInWithEmail = AuthPort<{
  readonly email: string
  readonly password: string
}>

export function signInWithAuthClient(
  input: Parameters<SignInWithEmail>[0]
): ReturnType<SignInWithEmail> {
  return authClient.signIn.email(input)
}

/**
 * Domain-routed SSO sign-in: Better Auth's `/sign-in/sso` resolves the email's
 * domain to an enabled connection and answers with the IdP redirect URL. The
 * page (not this adapter) decides *whether* to call it — the routing decision
 * is the starter's own rule (ADR 0054), asked through
 * `resolveSsoRoutingServerFn` first.
 */
export type SignInWithSso = AuthPort<
  { readonly email: string; readonly callbackURL: string },
  { readonly url: string; readonly redirect: boolean }
>

export function signInWithSsoAuthClient(
  input: Parameters<SignInWithSso>[0]
): ReturnType<SignInWithSso> {
  return authClient.signIn.sso(input)
}

export type SignUpWithEmail = AuthPort<{
  readonly name: string
  readonly email: string
  readonly password: string
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

/**
 * `callbackURL` is where Better Auth's verification redirect lands after the
 * emailed token is exchanged — the default ('/') would verify silently and
 * drop the user on the marketing homepage. When Turnstile is configured the
 * widget's token rides the `x-turnstile-token` header; the auth route's
 * server-side gate verifies it before Better Auth sees the request.
 */
export function signUpWithAuthClient(
  input: Parameters<SignUpWithEmail>[0]
): ReturnType<SignUpWithEmail> {
  const payload = {
    name: input.name,
    email: input.email,
    password: input.password,
    callbackURL: `${window.location.origin}/verify-email`
  }
  if (input.turnstileToken === undefined) {
    return authClient.signUp.email(payload)
  }
  return authClient.signUp.email({
    ...payload,
    fetchOptions: { headers: { 'x-turnstile-token': input.turnstileToken } }
  })
}

export type RequestPasswordReset = AuthPort<{ readonly email: string }>

/**
 * `redirectTo` is where Better Auth's token-exchange redirect lands once the
 * emailed link is clicked: the handler validates the token, then forwards it
 * to `/reset-password?token=…` (or `?error=INVALID_TOKEN`).
 */
export function requestPasswordResetWithAuthClient(
  input: Parameters<RequestPasswordReset>[0]
): ReturnType<RequestPasswordReset> {
  return authClient.requestPasswordReset({
    email: input.email,
    redirectTo: `${window.location.origin}/reset-password`
  })
}

export type ResetPassword = AuthPort<{
  readonly newPassword: string
  readonly token: string
}>

export function resetPasswordWithAuthClient(
  input: Parameters<ResetPassword>[0]
): ReturnType<ResetPassword> {
  return authClient.resetPassword({
    newPassword: input.newPassword,
    token: input.token
  })
}

/* -------------------------------------------------------------------------- */
/* Two-factor                                                                  */
/* -------------------------------------------------------------------------- */

/** Verifying the second factor: the sign-in challenge page and the account panel. */
export type VerifyTotpCode = AuthPort<{ readonly code: string }>

export function verifyTotpWithAuthClient(
  input: Parameters<VerifyTotpCode>[0]
): ReturnType<VerifyTotpCode> {
  return authClient.twoFactor.verifyTotp({ code: input.code })
}

/**
 * Better Auth's enable response is a discriminated union on `method`
 * ('otp' | 'totp'); only the 'totp' variant carries `totpURI`, and the plugin
 * generates one-time backup codes alongside it.
 */
export type EnableTwoFactorData =
  | {
      readonly totpURI?: string | undefined
      readonly backupCodes?: Array<string> | undefined
    }
  | { readonly method?: string }

export type EnableTwoFactor = AuthPort<
  { readonly password: string },
  EnableTwoFactorData
>

export function enableTwoFactorWithAuthClient(
  input: Parameters<EnableTwoFactor>[0]
): ReturnType<EnableTwoFactor> {
  return authClient.twoFactor.enable(input)
}

export type DisableTwoFactor = AuthPort<{ readonly password: string }>

export function disableTwoFactorWithAuthClient(
  input: Parameters<DisableTwoFactor>[0]
): ReturnType<DisableTwoFactor> {
  return authClient.twoFactor.disable(input)
}

export type GenerateBackupCodes = AuthPort<
  { readonly password: string },
  { readonly backupCodes?: Array<string> | undefined }
>

export function generateBackupCodesWithAuthClient(
  input: Parameters<GenerateBackupCodes>[0]
): ReturnType<GenerateBackupCodes> {
  return authClient.twoFactor.generateBackupCodes(input)
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

/* -------------------------------------------------------------------------- */
/* Sessions                                                                    */
/* -------------------------------------------------------------------------- */

/** One Better Auth session row, as the account panel reads it. */
export type SessionRecord = {
  readonly token: string
  readonly createdAt: Date
  readonly expiresAt: Date
  readonly ipAddress?: string | null | undefined
  readonly userAgent?: string | null | undefined
}

export type ListSessions = AuthPort<void, ReadonlyArray<SessionRecord>>

export function listSessionsWithAuthClient(): ReturnType<ListSessions> {
  return authClient.listSessions()
}

export type RevokeSession = AuthPort<{ readonly token: string }>

export function revokeSessionWithAuthClient(
  input: Parameters<RevokeSession>[0]
): ReturnType<RevokeSession> {
  return authClient.revokeSession(input)
}

/** Better Auth's "revoke all sessions except the current one". */
export type RevokeOtherSessions = AuthPort

export function revokeOtherSessionsWithAuthClient(): ReturnType<RevokeOtherSessions> {
  return authClient.revokeOtherSessions()
}

/**
 * `callbackURL` is where Better Auth's verification redirect lands after the
 * emailed token is exchanged — without it the user would be dropped on '/'.
 */
export type SendVerificationEmail = AuthPort<{ readonly email: string }>

export function sendVerificationEmailWithAuthClient(
  input: Parameters<SendVerificationEmail>[0]
): ReturnType<SendVerificationEmail> {
  return authClient.sendVerificationEmail({
    email: input.email,
    callbackURL: `${window.location.origin}/verify-email`
  })
}

/**
 * Ending the session. The odd one out: it resolves `void`, because nothing
 * reads the response — a failed sign-out surfaces as a rejection.
 */
export type SignOut = () => Promise<void>

export async function signOutWithAuthClient(): Promise<void> {
  await authClient.signOut()
}
