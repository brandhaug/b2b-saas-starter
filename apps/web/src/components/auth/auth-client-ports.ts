import { type SOCIAL_PROVIDER_IDS } from '@b2b-saas-starter/env/social'
import { authClient } from '@/lib/auth-client'
import { type AuthResult } from '@/lib/auth-result'
import {
  TWO_FACTOR_REQUIRED_ERROR_CODE,
  TWO_FACTOR_REQUIRED_MESSAGE
} from '@/lib/two-factor-refusal'

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
 * domain to a stored connection and answers with the IdP redirect URL. The
 * page (not this adapter) decides *whether* to call it — the routing decision
 * is the starter's own rule (ADR 0069), asked through
 * `resolveSsoRoutingServerFn` first, and the auth gate refuses the endpoint
 * when the resolution is a disabled connection.
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

/**
 * Magic-link sign-in: asks Better Auth to email a single-use link. The
 * response is non-disclosing by design (`{ status: true }` whether or not the
 * address has an account) — the screen must not know more than the endpoint
 * does.
 */
export type SendMagicLink = AuthPort<{
  readonly email: string
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

/**
 * Every callback lands on the app's `/magic-link/verify` page: success arrives
 * with a session cookie, failure with `?error=…`. `newUserCallbackURL` gets
 * the same destination so a first-time link lands signed-in as well — the
 * plugin creates the account (verified) when the link is consumed.
 */
export function sendMagicLinkWithAuthClient(
  input: Parameters<SendMagicLink>[0]
): ReturnType<SendMagicLink> {
  const payload = {
    email: input.email,
    callbackURL: `${window.location.origin}/magic-link/verify`,
    newUserCallbackURL: `${window.location.origin}/magic-link/verify`,
    errorCallbackURL: `${window.location.origin}/magic-link/verify`
  }
  if (input.turnstileToken === undefined) {
    return authClient.signIn.magicLink(payload)
  }
  return authClient.signIn.magicLink({
    ...payload,
    fetchOptions: { headers: { 'x-turnstile-token': input.turnstileToken } }
  })
}

export type RequestPasswordReset = AuthPort<{ readonly email: string }> /**
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

/* -------------------------------------------------------------------------- */
/* Social sign-in                                                              */
/* -------------------------------------------------------------------------- */

/**
 * The providers the auth screens can offer — the same closed set the server
 * resolver owns (`SOCIAL_PROVIDER_IDS` in `@b2b-saas-starter/env/social`),
 * derived rather than restated so the env gate and the UI cannot disagree
 * about which providers exist.
 */
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

/**
 * Social sign-in initiation. Better Auth's client answers with the provider's
 * authorize URL and follows it itself (its redirect plugin navigates on
 * `{ url, redirect: true }`), so the component only supplies the provider and
 * where to land afterwards. The method the visitor used is remembered by the
 * `lastLoginMethod` plugin's cookie, surfaced on the next sign-in page visit.
 */
export type SignInWithSocial = AuthPort<{
  readonly provider: SocialProviderId
  /** Absolute URL — Better Auth validates it against trusted origins. */
  readonly callbackURL: string
}>

export function signInSocialWithAuthClient(
  input: Parameters<SignInWithSocial>[0]
): ReturnType<SignInWithSocial> {
  return authClient.signIn.social(input)
}

/**
 * The last authentication method this browser used ('github', 'google',
 * 'email', …), from the `lastLoginMethod` plugin's client-readable cookie.
 * Synchronous and SSR-safe (null without a document); null means "no
 * remembered method" — the hint simply does not render.
 */
export type ReadLastLoginMethod = () => string | null

export function readLastLoginMethodWithAuthClient(): string | null {
  return authClient.getLastUsedLoginMethod()
}

/* -------------------------------------------------------------------------- */
/* Linked accounts                                                             */
/* -------------------------------------------------------------------------- */

/**
 * One linked sign-in method, narrowed to the fields the account page reads.
 * `id` is the account row's id — the value `unlinkAccount` takes — and
 * `providerId` is the method ('credential' for email and password).
 */
export type LinkedAccountRecord = {
  readonly id: string
  readonly providerId: string
  readonly createdAt: Date
}

export type ListLinkedAccounts = AuthPort<void, ReadonlyArray<LinkedAccountRecord>>

export function listAccountsWithAuthClient(): ReturnType<ListLinkedAccounts> {
  return authClient.listAccounts()
}

/**
 * Unlinking one sign-in method. Better Auth refuses the last remaining
 * account (`allowUnlinkingAll` stays off), so the UI disables the control
 * when only one is left — the endpoint refusal is the backstop.
 */
export type UnlinkAccount = AuthPort<{ readonly accountId: string }>

export function unlinkAccountWithAuthClient(
  input: Parameters<UnlinkAccount>[0]
): ReturnType<UnlinkAccount> {
  return authClient.unlinkAccount(input)
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

/**
 * Verifying the second factor: the sign-in challenge page and the account
 * panel. `trustDevice` signs the 30-day trust cookie (`trustDeviceMaxAge` in
 * `packages/auth`) — a sign-in-page concern only, so it stays optional and
 * the account panel's enrollment verify simply omits it.
 */
export type VerifyTotpCode = AuthPort<{
  readonly code: string
  readonly trustDevice?: boolean | undefined
}>

export function verifyTotpWithAuthClient(
  input: Parameters<VerifyTotpCode>[0]
): ReturnType<VerifyTotpCode> {
  return authClient.twoFactor.verifyTotp({
    code: input.code,
    trustDevice: input.trustDevice
  })
}

/**
 * Redeeming a one-time backup code instead of the authenticator: enrollment
 * promises the ten codes and shows them once, and this is the only endpoint
 * that spends them — each code dies on use. A sign-in-page method only: the
 * account panel manages its codes behind a password and never verifies with
 * one.
 */
export type VerifyBackupCode = AuthPort<{
  readonly code: string
  readonly trustDevice?: boolean | undefined
}>

export function verifyBackupCodeWithAuthClient(
  input: Parameters<VerifyBackupCode>[0]
): ReturnType<VerifyBackupCode> {
  return authClient.twoFactor.verifyBackupCode({
    code: input.code,
    trustDevice: input.trustDevice
  })
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

/**
 * The backup-code field validator: something besides whitespace. Deliberately
 * shallow for the same reason as the TOTP one — Better Auth owns the real
 * check, and the code's exact shape (length, casing, the dash) is the
 * plugin's to define.
 */
export function backupCodeValidator({ value }: { value: string }): string | undefined {
  return value.trim().length > 0 ? undefined : 'Enter a backup code'
}

/**
 * The TOTP gate's refusal vocabulary, re-exported from
 * `lib/two-factor-refusal.ts` — the one module the server gate and this
 * side both read, so the gate's refusal and the page's notice cannot drift.
 * The server-side gate refuses magic-link and email-code sign-in for a
 * two-factor-enabled account (those hops cannot carry a second factor) and
 * redirects the browser to `/sign-in?error=two_factor_required`; the
 * message names the path that still works. The shared code table
 * (`lib/auth-error-copy.ts`) maps the code to that same sentence, so no
 * screen needs its own probe for it.
 */
export { TWO_FACTOR_REQUIRED_ERROR_CODE, TWO_FACTOR_REQUIRED_MESSAGE }

/* -------------------------------------------------------------------------- */
/* Passkeys                                                                    */
/* -------------------------------------------------------------------------- */

/** One Better Auth passkey row, as the account panel reads it. */
export type PasskeyRecord = {
  readonly id: string
  readonly name?: string | null | undefined
  readonly createdAt: Date
  readonly backedUp: boolean
}

export type ListPasskeys = AuthPort<void, ReadonlyArray<PasskeyRecord>>

export function listPasskeysWithAuthClient(): ReturnType<ListPasskeys> {
  return authClient.passkey.listUserPasskeys()
}

/**
 * Registers a passkey for the signed-in user. The name is the label the
 * management list shows; the WebAuthn ceremony runs between this call's two
 * server round-trips (options, then verification).
 */
export type AddPasskey = AuthPort<{ readonly name?: string }>

export function addPasskeyWithAuthClient(
  input: Parameters<AddPasskey>[0]
): ReturnType<AddPasskey> {
  return authClient.passkey.addPasskey(input)
}

/** Renames a passkey — the label only, never the credential. */
export type UpdatePasskeyName = AuthPort<{
  readonly id: string
  readonly name: string
}>

export function updatePasskeyWithAuthClient(
  input: Parameters<UpdatePasskeyName>[0]
): ReturnType<UpdatePasskeyName> {
  return authClient.passkey.updatePasskey(input)
}

export type DeletePasskey = AuthPort<{ readonly id: string }>

export function deletePasskeyWithAuthClient(
  input: Parameters<DeletePasskey>[0]
): ReturnType<DeletePasskey> {
  return authClient.passkey.deletePasskey(input)
}

/**
 * Passkey sign-in. `autoFill: true` arms conditional UI (the browser's
 * passkey autofill); without it the call opens the modal ceremony when a
 * button invokes it. A success resolves with the session Better Auth set.
 */
export type SignInWithPasskey = (input?: {
  readonly autoFill?: boolean
}) => Promise<AuthResult<{ readonly user: { readonly id: string } } | null>>

export function signInPasskeyWithAuthClient(input?: {
  readonly autoFill?: boolean
}): ReturnType<SignInWithPasskey> {
  return authClient.signIn.passkey(input)
}

/* -------------------------------------------------------------------------- */
/* Email one-time codes                                                        */
/* -------------------------------------------------------------------------- */

/**
 * The code purposes the UI sends. (`change-email` exists in Better Auth's
 * union but no starter surface sends it.)
 */
export type EmailCodePurpose = 'sign-in' | 'email-verification' | 'forget-password'

/**
 * Sends a six-digit one-time code. The endpoint answers `{ success: true }`
 * whether or not the email exists (enumeration defense), and so does the UI.
 */
export type SendEmailCode = AuthPort<{
  readonly email: string
  readonly purpose: EmailCodePurpose
}>

export function sendEmailCodeWithAuthClient(
  input: Parameters<SendEmailCode>[0]
): ReturnType<SendEmailCode> {
  return authClient.emailOtp.sendVerificationOtp({
    email: input.email,
    type: input.purpose
  })
}

/**
 * Exchanges a code for a session — the second hop of the sign-in code flow.
 * `disableSignUp` is on server-side, so the email must already be registered.
 */
export type SignInWithEmailCode = AuthPort<{
  readonly email: string
  readonly otp: string
}>

export function signInWithEmailCodeWithAuthClient(
  input: Parameters<SignInWithEmailCode>[0]
): ReturnType<SignInWithEmailCode> {
  return authClient.signIn.emailOtp({ email: input.email, otp: input.otp })
}

/**
 * Verifies an email address with a code — the alternative to the emailed link.
 * Like the link hop, a successful verify carries a session cookie
 * (autoSignInAfterVerification).
 */
export type VerifyEmailWithCode = AuthPort<{
  readonly email: string
  readonly otp: string
}>

export function verifyEmailWithCodeWithAuthClient(
  input: Parameters<VerifyEmailWithCode>[0]
): ReturnType<VerifyEmailWithCode> {
  return authClient.emailOtp.verifyEmail({ email: input.email, otp: input.otp })
}

/** Sends the password-reset code — the code sibling of `requestPasswordReset`. */
export type RequestPasswordResetCode = AuthPort<{ readonly email: string }>

export function requestPasswordResetCodeWithAuthClient(
  input: Parameters<RequestPasswordResetCode>[0]
): ReturnType<RequestPasswordResetCode> {
  return authClient.emailOtp.requestPasswordReset({ email: input.email })
}

/**
 * Completes a password reset with a code: verify + set in one endpoint, so
 * the code and the new password travel together. Like the link reset, the
 * server revokes every prior session.
 */
export type ResetPasswordWithCode = AuthPort<{
  readonly email: string
  readonly otp: string
  readonly newPassword: string
}>

export function resetPasswordWithCodeWithAuthClient(
  input: Parameters<ResetPasswordWithCode>[0]
): ReturnType<ResetPasswordWithCode> {
  return authClient.emailOtp.resetPassword({
    email: input.email,
    otp: input.otp,
    password: input.newPassword
  })
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
