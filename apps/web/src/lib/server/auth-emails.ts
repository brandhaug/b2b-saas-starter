import { type AuthEmailSender, type OneTimeCodePurpose } from '@b2b-saas-starter/auth'
import { AccountPreferencesService } from '@b2b-saas-starter/capabilities/governance/account-preferences'
import { EmailDelivery } from '@b2b-saas-starter/capabilities/email-delivery/email-delivery'
import { dispatchTrackedEmail } from '@b2b-saas-starter/email/tracked'
import * as m from '@b2b-saas-starter/i18n/messages'
import { DEFAULT_LOCALE, type Locale } from '@b2b-saas-starter/i18n/locale'
import {
  type EmailDispatcher,
  selectEmailDispatcherLayer
} from '@b2b-saas-starter/email'
import {
  AccountDeletedEmail,
  BackupCodesRotatedEmail,
  EmailVerificationEmail,
  MagicLinkEmail,
  OneTimeCodeEmail,
  PasskeyChangedEmail,
  PasswordChangedEmail,
  PasswordResetEmail,
  TwoFactorChangedEmail
} from '@b2b-saas-starter/email/templates'
import { env as cloudflareEnv } from 'cloudflare:workers'
import { Effect, type Layer } from 'effect'
import { type ReactElement } from 'react'

import { runCapabilities } from '../capabilities'

/**
 * The adapter that lets Better Auth's account-lifecycle callbacks reach the
 * email system. `packages/auth` declares the `AuthEmailSender` port because it
 * cannot import the sibling `email` package (ADR 0051's rule runs in both
 * directions); this module is the app's side of that seam.
 *
 * Provider-light by the same selector the invitation flow uses: with no
 * `EMAIL` binding configured this is the logging dispatcher, so password
 * reset, email verification, the one-time codes, and the magic link all work
 * end to end locally without an email provider — the link or code lands in
 * the console log instead of an inbox.
 *
 * Auth send failures propagate to Better Auth after their sanitized outcome
 * is recorded. Public recovery presentation still uses its generic response.
 * The log-mode dispatcher never fails; only a real, broken `EMAIL` binding
 * can, and failing loudly there is the honest behavior.
 */
let selected: Layer.Layer<EmailDispatcher> | undefined

/**
 * Provider-light by the same selector the invitation flow uses (`invitations.ts`
 * imports this): with no `EMAIL` binding configured this is the logging
 * dispatcher, so password reset and email verification work end to end locally
 * without an email provider — the link lands in the console log instead of an
 * inbox.
 *
 * Selected once per isolate, not once per send. Which dispatcher is right is a
 * function of the isolate's env bag, which cannot change under it, and the
 * layer is a `Layer.succeed` closing over the `EMAIL` binding — no I/O state of
 * its own, so it is isolate-safe for the same reason `WideEventLoggerLive` is.
 * The read stays behind the function so importing this module in an
 * environment without bindings does not touch env, exactly like
 * `AuthConfigLive`'s `Layer.sync`.
 */
export function emailDispatcherLayer(): Layer.Layer<EmailDispatcher> {
  // The env bag goes through as it is: `EmailDispatcherEnv` names the same
  // `CLOUDFLARE_EMAIL_FROM` the schema and the deploy do, so there is no
  // second name to translate between.
  selected ??= selectEmailDispatcherLayer(cloudflareEnv)
  return selected
}

function dispatch(input: {
  readonly to: string
  readonly subject: string
  readonly element: ReactElement
  readonly purpose?: 'security' | 'recovery' | 'verification'
}): Promise<void> {
  const dispatcher = Effect.gen(function* () {
    const delivery = yield* EmailDelivery
    const userId = yield* delivery.resolveUserId(input.to)
    yield* dispatchTrackedEmail(
      {
        id: crypto.randomUUID(),
        purpose: input.purpose ?? 'security',
        recipient: input.to,
        userId,
        workspaceId: null
      },
      {
        from: '',
        to: input.to,
        subject: input.subject,
        element: input.element
      }
    )
  })
  // The capability runner supplies durable metadata storage and the request's
  // observability scope. Rendered content remains in this invocation.
  return runCapabilities(
    Effect.asVoid(dispatcher).pipe(Effect.provide(emailDispatcherLayer()))
  )
}

function localeOf(value: { readonly locale?: Locale | null }): Locale {
  return value.locale ?? DEFAULT_LOCALE
}

/** Existing accounts get their saved locale; unknown recipients stay English. */
export async function recipientLocale(email: string): Promise<Locale> {
  // OTP and magic-link callbacks receive only an address because Better Auth
  // deliberately supports requests for accounts that do not exist yet.
  // oxlint-disable-next-line effect/noTryCatch -- an unavailable preference read must not block an auth email; English is the guest fallback
  try {
    const preferences = await runCapabilities(
      Effect.flatMap(AccountPreferencesService, (service) => service.getByEmail(email))
    )
    return preferences?.locale ?? DEFAULT_LOCALE
  } catch {
    return DEFAULT_LOCALE
  }
}

/**
 * The subject lines for one-time codes, keyed by Better Auth's own OTP type.
 * A record rather than branches so the four flows sit next to each other.
 */
type OneTimeCodeSubjectKey =
  | 'sign_in_code'
  | 'email_verification_code'
  | 'password_reset_code'
  | 'change_email_code'

const ONE_TIME_CODE_SUBJECTS = {
  'sign-in': 'sign_in_code',
  'email-verification': 'email_verification_code',
  'forget-password': 'password_reset_code',
  'change-email': 'change_email_code'
} satisfies Record<OneTimeCodePurpose, OneTimeCodeSubjectKey>

const ONE_TIME_CODE_PURPOSES = {
  'sign-in': 'security',
  'email-verification': 'verification',
  'forget-password': 'recovery',
  'change-email': 'security'
} satisfies Record<OneTimeCodePurpose, 'security' | 'verification' | 'recovery'>

export function oneTimeCodeSubject(
  type: Parameters<AuthEmailSender['sendOneTimeCode']>[0]['type'],
  locale: Locale
): string {
  const options = { locale }
  switch (ONE_TIME_CODE_SUBJECTS[type]) {
    case 'sign_in_code': {
      return m.backend_email_subject_sign_in_code({}, options)
    }
    case 'email_verification_code': {
      return m.backend_email_subject_email_verification_code({}, options)
    }
    case 'password_reset_code': {
      return m.backend_email_subject_password_reset_code({}, options)
    }
    case 'change_email_code': {
      return m.backend_email_subject_change_email_code({}, options)
    }
  }
}

/**
 * The `AuthEmailSender` the auth runtime provides. Subjects live here, beside
 * the other email senders, rather than in the auth package: the wording is the
 * app's voice, not the auth server's contract.
 */
export function makeAuthEmailSender(): AuthEmailSender {
  return {
    sendResetPassword: ({ user, url }) =>
      dispatch({
        purpose: 'recovery',
        to: user.email,
        subject: m.backend_email_subject_reset_password({}, { locale: localeOf(user) }),
        element: PasswordResetEmail({ url, locale: localeOf(user) })
      }),
    sendVerificationEmail: ({ user, url }) =>
      dispatch({
        purpose: 'verification',
        to: user.email,
        subject: m.backend_email_subject_verify_email({}, { locale: localeOf(user) }),
        element: EmailVerificationEmail({ url, locale: localeOf(user) })
      }),
    sendOneTimeCode: async ({ email, otp, type }) => {
      const locale = await recipientLocale(email)
      return dispatch({
        purpose: ONE_TIME_CODE_PURPOSES[type],
        to: email,
        subject: oneTimeCodeSubject(type, locale),
        element: OneTimeCodeEmail({ code: otp, purpose: type, locale })
      })
    },
    // The magic-link plugin's own callback shape — no `user`, because a link
    // can be requested for an address that has no account yet.
    sendMagicLink: async ({ email, url }) => {
      const locale = await recipientLocale(email)
      return dispatch({
        to: email,
        subject: m.backend_email_subject_sign_in_link({}, { locale }),
        element: MagicLinkEmail({ url, locale })
      })
    },
    // `onPasswordReset`: fired after a link reset succeeded and every prior
    // session was revoked, so the email is the holder-facing record of a
    // takeover response having run — one template with the signed-in change,
    // discriminated only by the flow sentence.
    sendPasswordResetConfirmation: ({ user }) =>
      dispatch({
        to: user.email,
        subject: m.backend_email_subject_password_reset_confirmation(
          {},
          { locale: localeOf(user) }
        ),
        element: PasswordChangedEmail({ via: 'reset', locale: localeOf(user) })
      })
  }
}

/**
 * The two-factor wording of the credential-change notification (driven by
 * `credential-change-notification.ts`): best-effort by contract, so a
 * dispatcher rejection never fails the enable/disable exchange it observes —
 * the caller swallows it.
 */
export async function sendTwoFactorChangedEmail(input: {
  readonly email: string
  readonly enabled: boolean
  readonly locale?: Locale | null
}): Promise<void> {
  const locale = input.locale ?? (await recipientLocale(input.email))
  return dispatch({
    to: input.email,
    subject: m.backend_email_subject_two_factor_changed({}, { locale }),
    element: TwoFactorChangedEmail({ enabled: input.enabled, locale })
  })
}

/**
 * The passkey wording of the credential-change notification, on the same
 * best-effort contract as the two-factor one.
 */
export async function sendPasskeyChangedEmail(input: {
  readonly email: string
  readonly added: boolean
  readonly locale?: Locale | null
}): Promise<void> {
  const locale = input.locale ?? (await recipientLocale(input.email))
  let subject = m.backend_email_subject_passkey_added({}, { locale })
  if (!input.added) {
    subject = m.backend_email_subject_passkey_removed({}, { locale })
  }
  return dispatch({
    to: input.email,
    subject,
    element: PasskeyChangedEmail({ added: input.added, locale })
  })
}

/**
 * The password-change wording of the credential-change notification, on the
 * same best-effort contract as the two-factor one: the signed-in change
 * (`/change-password`) emails the account holder so a hijacked session
 * cannot swap the password out silently.
 */
export async function sendPasswordChangedEmail(input: {
  readonly email: string
  readonly locale?: Locale | null
}): Promise<void> {
  const locale = input.locale ?? (await recipientLocale(input.email))
  return dispatch({
    to: input.email,
    subject: m.backend_email_subject_password_changed({}, { locale }),
    element: PasswordChangedEmail({ via: 'password-change', locale })
  })
}

/**
 * The backup-code-rotation wording of the credential-change notification, on
 * the same best-effort contract: rotation invalidates every previously saved
 * recovery code, which the holder must hear about from somewhere other than
 * a locked-out sign-in.
 */
export async function sendBackupCodesRotatedEmail(input: {
  readonly email: string
  readonly locale?: Locale | null
}): Promise<void> {
  const locale = input.locale ?? (await recipientLocale(input.email))
  return dispatch({
    to: input.email,
    subject: m.backend_email_subject_backup_codes_rotated({}, { locale }),
    element: BackupCodesRotatedEmail({ locale })
  })
}

/**
 * The account-deletion confirmation (`account-delete-hooks.ts` drives it):
 * best-effort by the same contract — the account row is already gone when this
 * runs, so there is nothing left to fail on its behalf.
 */
export function sendAccountDeletedEmail(input: {
  readonly email: string
  readonly workspacesLeft: number
  readonly workspacesDeleted: number
  readonly locale?: Locale | null
}): Promise<void> {
  const locale = input.locale ?? DEFAULT_LOCALE
  return dispatch({
    to: input.email,
    subject: m.backend_email_subject_account_deleted({}, { locale }),
    element: AccountDeletedEmail({
      workspacesLeft: input.workspacesLeft,
      workspacesDeleted: input.workspacesDeleted,
      locale
    })
  })
}
