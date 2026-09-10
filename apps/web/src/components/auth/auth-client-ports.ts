import { type SOCIAL_PROVIDER_IDS } from '@b2b-saas-starter/env/social'
import { authClient } from '@/lib/auth-client'
import { type AuthResult } from '@/lib/auth-result'
import { m } from '@b2b-saas-starter/i18n/messages'

/**
 * One Better Auth client endpoint, as a port: the input it takes, and the
 * `{ data, error }` envelope its client resolves with.
 *
 * Only the endpoints that **add behaviour** to the client call live here —
 * composing callback URLs, riding the Turnstile token on a header — because
 * those are worth a named function and a prop a test can drive. Everything
 * else calls `authClient.X(...)` at its own call site: a pure
 * `return authClient.X(input)` adapter behind a one-implementer port bought
 * nothing but indirection. The kept adapters are hoisted to module scope so
 * a component's default prop is one stable function value.
 */
type AuthPort<I = void, D = unknown> = (input: I) => Promise<AuthResult<D>>

/**
 * The Turnstile header on a Better Auth client call, or the payload untouched
 * when no challenge was answered. One helper rather than the same two-branch
 * `fetchOptions` spread at every gated send: the header name and the
 * "unconfigured means no header at all" rule live here (ADR 0031).
 */
function withTurnstile<Payload extends object>(
  payload: Payload,
  token: string | undefined
): Payload | (Payload & { readonly fetchOptions: TurnstileFetchOptions }) {
  if (token === undefined) {
    return payload
  }
  return { ...payload, fetchOptions: { headers: { 'x-turnstile-token': token } } }
}

type TurnstileFetchOptions = {
  readonly headers: { readonly 'x-turnstile-token': string }
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
  return authClient.signUp.email(
    withTurnstile(
      {
        name: input.name,
        email: input.email,
        password: input.password,
        callbackURL: `${window.location.origin}/verify-email`
      },
      input.turnstileToken
    )
  )
}

/**
 * Magic-link sign-in: asks Better Auth to email a single-use link. The
 * response is non-disclosing by design (`{ status: true }` whether or not the
 * address has an account) — the screen must not know more than the endpoint
 * does.
 *
 * Every callback lands on the app's `/magic-link/verify` page: success arrives
 * with a session cookie, failure with `?error=…`. `newUserCallbackURL` gets
 * the same destination so a first-time link lands signed-in as well — the
 * plugin creates the account (verified) when the link is consumed.
 */
export type SendMagicLink = AuthPort<{
  readonly email: string
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

export function sendMagicLinkWithAuthClient(
  input: Parameters<SendMagicLink>[0]
): ReturnType<SendMagicLink> {
  return authClient.signIn.magicLink(
    withTurnstile(
      {
        email: input.email,
        callbackURL: `${window.location.origin}/magic-link/verify`,
        newUserCallbackURL: `${window.location.origin}/magic-link/verify`,
        errorCallbackURL: `${window.location.origin}/magic-link/verify`
      },
      input.turnstileToken
    )
  )
}

export type RequestPasswordReset = AuthPort<{
  readonly email: string
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

/**
 * `redirectTo` is where Better Auth's token-exchange redirect lands once the
 * emailed link is clicked: the handler validates the token, then forwards it
 * to `/reset-password?token=…` (or `?error=INVALID_TOKEN`). The reset send
 * mails an address the caller names, so it rides the same Turnstile header as
 * sign-up and the magic link.
 */
export function requestPasswordResetWithAuthClient(
  input: Parameters<RequestPasswordReset>[0]
): ReturnType<RequestPasswordReset> {
  return authClient.requestPasswordReset(
    withTurnstile(
      {
        email: input.email,
        redirectTo: `${window.location.origin}/reset-password`
      },
      input.turnstileToken
    )
  )
}

/**
 * `callbackURL` is where Better Auth's verification redirect lands after the
 * emailed token is exchanged — without it the user would be dropped on '/'.
 * Anonymous callers can point this endpoint at any inbox, so it carries the
 * Turnstile header too.
 */
export type SendVerificationEmail = AuthPort<{
  readonly email: string
  /**
   * Where the verification redirect lands, as an app path. Defaults to the
   * `/verify-email` landing; the account page asks for `/account`, so the
   * visitor returns to the screen they pressed the button on.
   */
  readonly callbackPath?: string | undefined
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

export function sendVerificationEmailWithAuthClient(
  input: Parameters<SendVerificationEmail>[0]
): ReturnType<SendVerificationEmail> {
  return authClient.sendVerificationEmail(
    withTurnstile(
      {
        email: input.email,
        callbackURL: `${window.location.origin}${input.callbackPath ?? '/verify-email'}`
      },
      input.turnstileToken
    )
  )
}

/**
 * The email one-time-code send, as a port: the address, the flow's purpose,
 * and the Turnstile token the gate wants — this endpoint mails a code to any
 * address a caller names, exactly like the magic link.
 */
export type SendEmailOneTimeCode = AuthPort<{
  readonly email: string
  readonly purpose: EmailCodePurpose
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

export function sendEmailCodeWithAuthClient(
  input: Parameters<SendEmailOneTimeCode>[0]
): ReturnType<SendEmailOneTimeCode> {
  return authClient.emailOtp.sendVerificationOtp(
    withTurnstile({ email: input.email, type: input.purpose }, input.turnstileToken)
  )
}

/**
 * The password-reset code send, as a port: the `/email-otp` sibling of the
 * reset link, gated the same way (the auth route matches
 * `/request-password-reset` by suffix, so both spellings are covered).
 */
export type RequestPasswordResetCode = AuthPort<{
  readonly email: string
  /** The Turnstile widget's token — present only when Turnstile is configured. */
  readonly turnstileToken?: string | undefined
}>

export function requestPasswordResetCodeWithAuthClient(
  input: Parameters<RequestPasswordResetCode>[0]
): ReturnType<RequestPasswordResetCode> {
  return authClient.emailOtp.requestPasswordReset(
    withTurnstile({ email: input.email }, input.turnstileToken)
  )
}

/**
 * The providers the auth screens can offer — the same closed set the server
 * resolver owns (`SOCIAL_PROVIDER_IDS` in `@b2b-saas-starter/env/social`),
 * derived rather than restated so the env gate and the UI cannot disagree
 * about which providers exist.
 */
export type SocialProviderId = (typeof SOCIAL_PROVIDER_IDS)[number]

/**
 * The code purposes the UI sends. (`change-email` exists in Better Auth's
 * union but no starter surface sends it.)
 */
export type EmailCodePurpose = 'sign-in' | 'email-verification' | 'forget-password'

/**
 * The TOTP code field validator shared by both verify surfaces: exactly six
 * digits. Deliberately shallow — Better Auth owns the real check.
 */
export function sixDigitCodeValidator({
  value
}: {
  value: string
}): string | undefined {
  return /^\d{6}$/.test(value) ? undefined : m.public_auth_six_digit_code()
}

/**
 * The backup-code field validator: something besides whitespace. Deliberately
 * shallow for the same reason as the TOTP one — Better Auth owns the real
 * check, and the code's exact shape (length, casing, the dash) is the
 * plugin's to define.
 */
export function backupCodeValidator({ value }: { value: string }): string | undefined {
  return value.trim().length > 0 ? undefined : m.public_auth_backup_code_required()
}
