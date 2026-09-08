import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  pixelBasedPreset,
  Preview,
  Section,
  Tailwind,
  Text
} from 'react-email'
import { type ReactNode } from 'react'
import { DEFAULT_LOCALE, intlLocale, type Locale } from '@b2b-saas-starter/i18n/locale'
import * as m from '@b2b-saas-starter/i18n/messages'

/**
 * A React Email template renders synchronously through `react-email`,
 * outside any Effect, so there is no Clock or DateTime to read the footer's
 * copyright year from.
 */
function footerYear(): number {
  // oxlint-disable-next-line effect/noGlobals -- no Effect context in a render function
  return new Date().getFullYear()
}

type EmailLayoutProps = {
  readonly preview: string
  readonly heading: ReactNode
  readonly children: ReactNode
  readonly locale?: Locale | undefined
}

/**
 * The one document every starter email is: brand theme, card container,
 * heading, body copy, and the footer rule. A template supplies its preview
 * text, its heading and its copy; everything else is this layout.
 */
export function EmailLayout({
  preview,
  heading,
  children,
  locale = DEFAULT_LOCALE
}: EmailLayoutProps) {
  return (
    <Html lang={intlLocale(locale)}>
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                // Email clients need literal sRGB values, not the app's CSS variables.
                // Keep these aligned with apps/web/src/index.css (Catppuccin Mocha).
                background: '#1e1e2e',
                card: '#181825',
                foreground: '#cdd6f4',
                primary: '#cba6f7',
                'primary-foreground': '#11111b',
                muted: '#313244',
                'muted-foreground': '#a6adc8',
                border: '#313244'
              },
              fontFamily: {
                sans: ['Geist Variable', 'Arial', 'Helvetica', 'sans-serif'],
                mono: ['Geist Mono Variable', 'Consolas', 'Courier New', 'monospace']
              }
            }
          }
        }}
      >
        <Head>
          <meta name="color-scheme" content="dark" />
          <meta name="supported-color-schemes" content="dark" />
        </Head>
        <Preview>{preview}</Preview>
        <Body
          lang={intlLocale(locale)}
          className="bg-background text-foreground font-sans m-0 p-4"
        >
          <Container
            className="bg-card border border-solid border-border w-full mx-auto px-6 py-8"
            style={{
              maxWidth: '576px',
              tableLayout: 'fixed',
              overflowWrap: 'anywhere'
            }}
          >
            <Heading
              as="h1"
              className="text-2xl leading-8 font-semibold text-foreground m-0"
            >
              {heading}
            </Heading>
            {children}
            <Hr
              className="border-t border-border my-8"
              style={{ borderTop: undefined }}
            />
            <Text className="text-sm text-muted-foreground m-0">
              © {footerYear()} B2B SaaS Starter
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

type ActionLinkProps = {
  readonly href: string
  readonly label: string
  readonly locale?: Locale | undefined
}

/**
 * The call to action and its fallback URL. Email clients that strip or fail to
 * render the button still leave the recipient a copyable link.
 */
export function ActionLink({ href, label, locale = DEFAULT_LOCALE }: ActionLinkProps) {
  return (
    <>
      <Section className="mt-6">
        <Button
          href={href}
          className="bg-primary text-primary-foreground px-6 py-3 rounded-[6px] text-base leading-6 font-medium box-border"
        >
          {label}
        </Button>
      </Section>
      <Text className="text-sm text-muted-foreground mt-6">
        {m.backend_email_auth_action_fallback({}, { locale })}{' '}
        <Link href={href} className="text-primary underline break-all">
          {href}
        </Link>
      </Text>
    </>
  )
}

type WorkspaceInvitationEmailProps = {
  readonly workspaceName: string
  readonly inviteUrl: string
  readonly locale?: Locale | undefined
}

export function WorkspaceInvitationEmail({
  workspaceName,
  inviteUrl,
  locale = DEFAULT_LOCALE
}: WorkspaceInvitationEmailProps) {
  return (
    <EmailLayout
      preview={m.backend_email_auth_invitation_preview({ workspaceName }, { locale })}
      heading={m.backend_email_auth_invitation_heading({ workspaceName }, { locale })}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_invitation_body({}, { locale })}
      </Text>
      <ActionLink
        href={inviteUrl}
        label={m.backend_email_auth_invitation_action({}, { locale })}
        locale={locale}
      />
    </EmailLayout>
  )
}

WorkspaceInvitationEmail.PreviewProps = {
  workspaceName: 'Starter Lab',
  inviteUrl: 'http://localhost:3071/invitations/accept?invitation=preview-invitation'
} satisfies WorkspaceInvitationEmailProps

export default WorkspaceInvitationEmail

type PasswordResetEmailProps = {
  readonly url: string
  readonly locale?: Locale | undefined
}

/**
 * The Better Auth password-reset link, as an email. `url` points at the auth
 * handler's token-exchange route, which validates the token and redirects to
 * the app's `/reset-password` page — the template never learns the token.
 */
export function PasswordResetEmail({
  url,
  locale = DEFAULT_LOCALE
}: PasswordResetEmailProps) {
  return (
    <EmailLayout
      preview={m.backend_email_subject_reset_password({}, { locale })}
      heading={m.backend_email_subject_reset_password({}, { locale })}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_reset_description({}, { locale })}
      </Text>
      <ActionLink
        href={url}
        label={m.backend_email_auth_reset_action({}, { locale })}
        locale={locale}
      />
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_reset_ignore({}, { locale })}
      </Text>
    </EmailLayout>
  )
}

PasswordResetEmail.PreviewProps = {
  url: 'http://localhost:3071/api/auth/reset-password/example-token?callbackURL=http%3A%2F%2Flocalhost%3A3071%2Freset-password'
} satisfies PasswordResetEmailProps

type EmailVerificationEmailProps = {
  readonly url: string
  readonly locale?: Locale | undefined
}

/**
 * The Better Auth email-verification link. Like the reset link, `url` points
 * at the auth handler, which verifies the token and redirects to the app's
 * `/verify-email` page.
 */
export function EmailVerificationEmail({
  url,
  locale = DEFAULT_LOCALE
}: EmailVerificationEmailProps) {
  return (
    <EmailLayout
      preview={m.backend_email_subject_verify_email({}, { locale })}
      heading={m.backend_email_subject_verify_email({}, { locale })}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_verify_description({}, { locale })}
      </Text>
      <ActionLink
        href={url}
        label={m.backend_email_auth_verify_action({}, { locale })}
        locale={locale}
      />
    </EmailLayout>
  )
}

EmailVerificationEmail.PreviewProps = {
  url: 'http://localhost:3071/api/auth/verify-email?token=example&callbackURL=http%3A%2F%2Flocalhost%3A3071%2Fverify-email'
} satisfies EmailVerificationEmailProps

type OneTimeCodePurpose =
  | 'sign-in'
  | 'email-verification'
  | 'forget-password'
  | 'change-email'

type OneTimeCodeEmailProps = {
  readonly code: string
  readonly purpose: OneTimeCodePurpose
  readonly locale?: Locale | undefined
}

/**
 * The one-time code, as an email — the code alternative to the emailed
 * lifecycle links (sign-in, verification, password reset). `code` is the
 * secret itself, so the template renders it and nothing else clickable: no
 * action link on purpose, there is nothing to click through to.
 */
export function OneTimeCodeEmail({
  code,
  purpose,
  locale = DEFAULT_LOCALE
}: OneTimeCodeEmailProps) {
  let subject = m.backend_email_subject_change_email_code({}, { locale })
  let heading = m.backend_email_auth_one_time_code_heading({}, { locale })
  if (purpose === 'sign-in') {
    subject = m.backend_email_subject_sign_in_code({}, { locale })
    heading = m.backend_email_auth_sign_in_code_heading({}, { locale })
  } else if (purpose === 'email-verification') {
    subject = m.backend_email_subject_email_verification_code({}, { locale })
    heading = m.backend_email_auth_verification_heading({}, { locale })
  } else if (purpose === 'forget-password') {
    subject = m.backend_email_subject_password_reset_code({}, { locale })
    heading = m.backend_email_auth_reset_heading({}, { locale })
  }
  return (
    <EmailLayout preview={subject} heading={heading} locale={locale}>
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_otp_description({}, { locale })}
      </Text>
      <Section className="mt-6">
        <Text className="text-3xl leading-10 font-semibold tracking-[0.2em] text-foreground m-0 font-mono">
          {code}
        </Text>
      </Section>
      <Text className="text-sm text-muted-foreground mt-6">
        {m.backend_email_auth_otp_expiry({}, { locale })}
      </Text>
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_otp_ignore({}, { locale })}
      </Text>
    </EmailLayout>
  )
}

type MagicLinkEmailProps = {
  readonly url: string
  readonly locale?: Locale | undefined
}

/**
 * The Better Auth magic-link sign-in link. The same hop shape as the reset
 * and verification links: `url` points at the auth handler's
 * `/magic-link/verify` route, which consumes the token, opens the session,
 * and redirects into the app — the template never learns the token. Copy
 * names the ten-minute window pinned in `packages/auth`
 * (`MAGIC_LINK_EXPIRES_IN_SECONDS`), stated here rather than imported so the
 * two packages stay siblings.
 */
export function MagicLinkEmail({ url, locale = DEFAULT_LOCALE }: MagicLinkEmailProps) {
  return (
    <EmailLayout
      preview={m.backend_email_subject_sign_in_link({}, { locale })}
      heading={m.backend_email_auth_magic_link_heading({}, { locale })}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_magic_description({}, { locale })}
      </Text>
      <ActionLink
        href={url}
        label={m.backend_email_auth_magic_action({}, { locale })}
        locale={locale}
      />
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_magic_ignore({}, { locale })}
      </Text>
    </EmailLayout>
  )
}

OneTimeCodeEmail.PreviewProps = {
  code: '123456',
  purpose: 'sign-in'
} satisfies OneTimeCodeEmailProps

MagicLinkEmail.PreviewProps = {
  url: 'http://localhost:3071/api/auth/magic-link/verify?token=example&callbackURL=http%3A%2F%2Flocalhost%3A3071%2Fmagic-link%2Fverify'
} satisfies MagicLinkEmailProps

type TwoFactorChangedEmailProps = {
  readonly enabled: boolean
  readonly locale?: Locale | undefined
}

/**
 * Security notification for a two-factor state change (enable or disable). No
 * action link on purpose: the recipient secures their account from the app's
 * `/account` page, and the email must not become a clickable attack surface.
 */
export function TwoFactorChangedEmail({ enabled, locale }: TwoFactorChangedEmailProps) {
  // The rule against ternaries applies here too; plain branches keep the
  // two wordings next to each other.
  const activeLocale = locale ?? DEFAULT_LOCALE
  let preview = m.backend_email_auth_two_factor_enabled_preview(
    {},
    { locale: activeLocale }
  )
  if (!enabled) {
    preview = m.backend_email_auth_two_factor_disabled_preview(
      {},
      { locale: activeLocale }
    )
  }
  let stateCopy = m.backend_email_auth_two_factor_enabled({}, { locale: activeLocale })
  let heading = m.backend_email_auth_two_factor_enabled_heading(
    {},
    { locale: activeLocale }
  )
  if (!enabled) {
    stateCopy = m.backend_email_auth_two_factor_disabled({}, { locale: activeLocale })
    heading = m.backend_email_auth_two_factor_disabled_heading(
      {},
      { locale: activeLocale }
    )
  }
  return (
    <EmailLayout preview={preview} heading={heading} locale={activeLocale}>
      <Text className="text-base text-foreground mt-4">{stateCopy}</Text>
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_security_warning({}, { locale: activeLocale })}
      </Text>
    </EmailLayout>
  )
}

TwoFactorChangedEmail.PreviewProps = {
  enabled: true
} satisfies TwoFactorChangedEmailProps

type PasskeyChangedEmailProps = {
  readonly added: boolean
  readonly locale?: Locale | undefined
}

/**
 * Security notification for a passkey change (added or removed). Same shape
 * as the two-factor notification: no action link on purpose — the recipient
 * manages passkeys from the app's `/account` page, and the email must not
 * become a clickable attack surface.
 */
export function PasskeyChangedEmail({ added, locale }: PasskeyChangedEmailProps) {
  // The rule against ternaries applies here too; plain branches keep the
  // two wordings next to each other.
  const activeLocale = locale ?? DEFAULT_LOCALE
  let preview = m.backend_email_auth_passkey_added_preview({}, { locale: activeLocale })
  if (!added) {
    preview = m.backend_email_auth_passkey_removed_preview({}, { locale: activeLocale })
  }
  let stateCopy = m.backend_email_auth_passkey_added({}, { locale: activeLocale })
  let heading = m.backend_email_auth_passkey_added_heading({}, { locale: activeLocale })
  if (!added) {
    stateCopy = m.backend_email_auth_passkey_removed({}, { locale: activeLocale })
    heading = m.backend_email_auth_passkey_removed_heading({}, { locale: activeLocale })
  }
  return (
    <EmailLayout preview={preview} heading={heading} locale={activeLocale}>
      <Text className="text-base text-foreground mt-4">{stateCopy}</Text>
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_security_warning({}, { locale: activeLocale })}
      </Text>
    </EmailLayout>
  )
}

PasskeyChangedEmail.PreviewProps = {
  added: true
} satisfies PasskeyChangedEmailProps

type PasswordChangedEmailProps = {
  /**
   * Which flow set the password: `reset` is the emailed-link reset (sessions
   * already revoked), `password-change` is a signed-in change. The email is
   * one template because the security message is the same either way — only
   * the sentence naming the flow differs.
   */
  readonly via: 'reset' | 'password-change'
  readonly locale?: Locale | undefined
}

/**
 * Security notification that the password was replaced — sent for both flows
 * that can do it without the old password in hand afterwards (the reset's
 * confirmation, and the signed-in change). No action link on purpose, same
 * rule as the two-factor and passkey notifications: a "sign in" button in an
 * email the true owner did not ask for is a phishing assist, and the copy
 * only needs to say what happened and what to do about it.
 */
export function PasswordChangedEmail({ via, locale }: PasswordChangedEmailProps) {
  // Plain branches keep the two wordings next to each other, per the rule
  // TwoFactorChangedEmail follows.
  const activeLocale = locale ?? DEFAULT_LOCALE
  let flow = m.backend_email_auth_password_reset_via({}, { locale: activeLocale })
  let preview = m.backend_email_auth_password_reset_preview(
    {},
    { locale: activeLocale }
  )
  let heading = m.backend_email_auth_password_reset_heading(
    {},
    { locale: activeLocale }
  )
  if (via === 'password-change') {
    flow = m.backend_email_auth_password_changed_via({}, { locale: activeLocale })
    preview = m.backend_email_auth_password_changed_preview(
      {},
      { locale: activeLocale }
    )
    heading = m.backend_email_auth_password_changed_heading(
      {},
      { locale: activeLocale }
    )
  }
  return (
    <EmailLayout preview={preview} heading={heading} locale={locale}>
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_password_changed_body(
          { via: flow },
          { locale: activeLocale }
        )}
      </Text>
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_security_warning({}, { locale: activeLocale })}
      </Text>
    </EmailLayout>
  )
}

PasswordChangedEmail.PreviewProps = {
  via: 'password-change'
} satisfies PasswordChangedEmailProps

/**
 * Security notification that every two-factor recovery code was replaced.
 * Rotation invalidates the codes the account holder saved at enrollment, so
 * the email is the only honest warning that those no longer work — the new
 * codes travel in the endpoint response the account page shows, never here.
 * No action link on purpose, same rule as the other security notifications,
 * and no props: like its siblings, everything it says is flow state, not
 * per-recipient data (the address rides the envelope, not the template).
 */
export function BackupCodesRotatedEmail({
  locale
}: { readonly locale?: Locale | undefined } = {}) {
  const activeLocale = locale ?? DEFAULT_LOCALE
  return (
    <EmailLayout
      preview={m.backend_email_auth_backup_codes_preview({}, { locale: activeLocale })}
      heading={m.backend_email_auth_backup_codes_heading({}, { locale: activeLocale })}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_backup_codes({}, { locale: activeLocale })}
      </Text>
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_backup_codes_warning({}, { locale: activeLocale })}
      </Text>
    </EmailLayout>
  )
}

BackupCodesRotatedEmail.PreviewProps = {}

type AccountDeletedEmailProps = {
  /** Workspaces the account left because other owners remained. */
  readonly workspacesLeft: number
  /** Workspaces deleted with the account because the user was their only member. */
  readonly workspacesDeleted: number
  readonly locale?: Locale | undefined
}

/**
 * Confirmation that the account itself was deleted — the one email that can
 * never warn about a hijack in progress, because it takes the password to
 * trigger. No action link on purpose: the account no longer exists to sign
 * into, and a deletion email with a "recover your account" button would be an
 * account-takeover lure.
 */
export function AccountDeletedEmail({
  workspacesLeft,
  workspacesDeleted,
  locale
}: AccountDeletedEmailProps) {
  const activeLocale = locale ?? DEFAULT_LOCALE
  return (
    <EmailLayout
      preview={m.backend_email_auth_account_deleted_preview(
        {},
        { locale: activeLocale }
      )}
      heading={m.backend_email_auth_account_deleted_heading(
        {},
        { locale: activeLocale }
      )}
      locale={locale}
    >
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_account_deleted_body({}, { locale: activeLocale })}
      </Text>
      <Text className="text-base text-foreground mt-4">
        {m.backend_email_auth_workspaces_deleted(
          { count: workspacesDeleted },
          { locale: activeLocale }
        )}{' '}
        {m.backend_email_auth_workspaces_left(
          { count: workspacesLeft },
          { locale: activeLocale }
        )}
      </Text>
      <Text className="text-sm text-muted-foreground mt-4">
        {m.backend_email_auth_account_deleted_warning({}, { locale: activeLocale })}
      </Text>
    </EmailLayout>
  )
}

AccountDeletedEmail.PreviewProps = {
  workspacesLeft: 2,
  workspacesDeleted: 1
} satisfies AccountDeletedEmailProps
