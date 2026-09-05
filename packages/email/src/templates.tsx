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
} from '@react-email/components'
import { type ReactNode } from 'react'

/**
 * A React Email template renders synchronously through `@react-email/render`,
 * outside any Effect, so there is no Clock or DateTime to read the footer's
 * copyright year from.
 */
function footerYear(): number {
  // oxlint-disable-next-line effect/noGlobals -- no Effect context in a render function
  return new Date().getFullYear()
}

export type EmailLayoutProps = {
  readonly preview: string
  readonly heading: ReactNode
  readonly children: ReactNode
}

/**
 * The one document every starter email is: brand theme, card container,
 * heading, body copy, and the footer rule. A template supplies its preview
 * text, its heading and its copy; everything else is this layout.
 */
export function EmailLayout({ preview, heading, children }: EmailLayoutProps) {
  return (
    <Html lang="en">
      <Tailwind
        config={{
          presets: [pixelBasedPreset],
          theme: {
            extend: {
              colors: {
                brand: '#2563eb'
              }
            }
          }
        }}
      >
        <Head />
        <Preview>{preview}</Preview>
        <Body className="bg-gray-100 font-sans py-10">
          <Container className="bg-white max-w-xl mx-auto rounded-lg px-8 py-10">
            <Heading className="text-2xl font-bold text-gray-900 m-0">
              {heading}
            </Heading>
            {children}
            <Hr className="border-solid border-gray-200 my-8" />
            <Text className="text-xs text-gray-500 m-0">
              © {footerYear()} B2B SaaS Starter
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  )
}

export type ActionLinkProps = {
  readonly href: string
  readonly label: string
}

/**
 * The call to action and its fallback URL. Email clients that strip or fail to
 * render the button still leave the recipient a copyable link.
 */
export function ActionLink({ href, label }: ActionLinkProps) {
  return (
    <>
      <Section className="mt-6">
        <Button
          href={href}
          className="bg-brand text-white px-6 py-3 rounded-md font-medium box-border"
        >
          {label}
        </Button>
      </Section>
      <Text className="text-sm text-gray-500 mt-6">
        If the button does not work, copy this URL into your browser:{' '}
        <Link href={href} className="text-brand underline">
          {href}
        </Link>
      </Text>
    </>
  )
}

type WorkspaceInvitationEmailProps = {
  readonly workspaceName: string
  readonly inviteUrl: string
}

export function WorkspaceInvitationEmail({
  workspaceName,
  inviteUrl
}: WorkspaceInvitationEmailProps) {
  return (
    <EmailLayout
      preview={`You have been invited to ${workspaceName}`}
      heading={<>Join {workspaceName}</>}
    >
      <Text className="text-base text-gray-700 mt-4">
        You have been invited to a B2B SaaS Starter workspace. Accept the invitation to
        review reports, tokens, and settings.
      </Text>
      <ActionLink href={inviteUrl} label="Accept invitation" />
    </EmailLayout>
  )
}

WorkspaceInvitationEmail.PreviewProps = {
  workspaceName: 'Starter Lab',
  inviteUrl: 'http://localhost:3071/invitations/accept'
} satisfies WorkspaceInvitationEmailProps

export default WorkspaceInvitationEmail

type PasswordResetEmailProps = {
  readonly url: string
}

/**
 * The Better Auth password-reset link, as an email. `url` points at the auth
 * handler's token-exchange route, which validates the token and redirects to
 * the app's `/reset-password` page — the template never learns the token.
 */
export function PasswordResetEmail({ url }: PasswordResetEmailProps) {
  return (
    <EmailLayout preview="Reset your password" heading="Reset your password">
      <Text className="text-base text-gray-700 mt-4">
        Somebody asked to reset the password for your B2B SaaS Starter account. If that
        was you, choose a new password within thirty minutes; the link works once and
        then expires.
      </Text>
      <ActionLink href={url} label="Choose a new password" />
      <Text className="text-sm text-gray-500 mt-4">
        If you did not ask for a reset, you can ignore this email; your password stays
        unchanged.
      </Text>
    </EmailLayout>
  )
}

PasswordResetEmail.PreviewProps = {
  url: 'http://localhost:3071/api/auth/reset-password/example-token?callbackURL=http%3A%2F%2Flocalhost%3A3071%2Freset-password'
} satisfies PasswordResetEmailProps

type EmailVerificationEmailProps = {
  readonly url: string
}

/**
 * The Better Auth email-verification link. Like the reset link, `url` points
 * at the auth handler, which verifies the token and redirects to the app's
 * `/verify-email` page.
 */
export function EmailVerificationEmail({ url }: EmailVerificationEmailProps) {
  return (
    <EmailLayout
      preview="Verify your email address"
      heading="Verify your email address"
    >
      <Text className="text-base text-gray-700 mt-4">
        Confirm your email address to finish setting up your B2B SaaS Starter account.
        The link works once and expires in an hour.
      </Text>
      <ActionLink href={url} label="Verify my email" />
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

type OneTimeCodeCopy = {
  readonly preview: string
  readonly heading: string
  readonly body: string
}

/**
 * Per-purpose wording, stated as a lookup so the four flows sit side by side.
 * The keys are Better Auth's own OTP type names.
 */
const ONE_TIME_CODE_COPY = {
  'sign-in': {
    preview: 'Your sign-in code',
    heading: 'Sign in to B2B SaaS Starter',
    body: 'Use the code below to finish signing in to your B2B SaaS Starter account.'
  },
  'email-verification': {
    preview: 'Your verification code',
    heading: 'Verify your email address',
    body: 'Use the code below to confirm your email address.'
  },
  'forget-password': {
    preview: 'Your password reset code',
    heading: 'Reset your password',
    body: 'Use the code below to choose a new password for your B2B SaaS Starter account.'
  },
  'change-email': {
    preview: 'Your email change code',
    heading: 'Confirm your new email address',
    body: 'Use the code below to confirm your new email address.'
  }
} satisfies Record<OneTimeCodePurpose, OneTimeCodeCopy>

type OneTimeCodeEmailProps = {
  readonly code: string
  readonly purpose: OneTimeCodePurpose
}

/**
 * The one-time code, as an email — the code alternative to the emailed
 * lifecycle links (sign-in, verification, password reset). `code` is the
 * secret itself, so the template renders it and nothing else clickable: no
 * action link on purpose, there is nothing to click through to.
 */
export function OneTimeCodeEmail({ code, purpose }: OneTimeCodeEmailProps) {
  const copy = ONE_TIME_CODE_COPY[purpose]
  return (
    <EmailLayout preview={copy.preview} heading={copy.heading}>
      <Text className="text-base text-gray-700 mt-4">{copy.body}</Text>
      <Section className="mt-6">
        <Text className="text-4xl font-bold tracking-[0.3em] text-gray-900 m-0 font-mono">
          {code}
        </Text>
      </Section>
      <Text className="text-sm text-gray-500 mt-6">
        The code works once, expires in ten minutes, and stops working after three
        failed attempts.
      </Text>
      <Text className="text-sm text-gray-500 mt-4">
        If you did not request this code, you can ignore this email; your account is
        unchanged.
      </Text>
    </EmailLayout>
  )
}

type MagicLinkEmailProps = {
  readonly url: string
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
export function MagicLinkEmail({ url }: MagicLinkEmailProps) {
  return (
    <EmailLayout preview="Your sign-in link" heading="Sign in to B2B SaaS Starter">
      <Text className="text-base text-gray-700 mt-4">
        Somebody asked for a sign-in link for this email address. If that was you, open
        the link to sign in without a password. It works once and expires in ten
        minutes.
      </Text>
      <ActionLink href={url} label="Sign in" />
      <Text className="text-sm text-gray-500 mt-4">
        If you did not ask for the link, you can ignore this email; opening it is the
        only thing the link can do.
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
}

/**
 * Security notification for a two-factor state change (enable or disable). No
 * action link on purpose: the recipient secures their account from the app's
 * `/account` page, and the email must not become a clickable attack surface.
 */
export function TwoFactorChangedEmail({ enabled }: TwoFactorChangedEmailProps) {
  // The rule against ternaries applies here too; plain branches keep the
  // two wordings next to each other.
  let verb = 'enabled'
  let preview = 'Two-factor authentication enabled'
  if (!enabled) {
    verb = 'disabled'
    preview = 'Two-factor authentication disabled'
  }
  return (
    <EmailLayout preview={preview} heading={<>Two-factor authentication {verb}</>}>
      <Text className="text-base text-gray-700 mt-4">
        Two-factor authentication was just {verb} for your B2B SaaS Starter account. If
        that was you, no action is needed.
      </Text>
      <Text className="text-sm text-gray-500 mt-4">
        If you did not make this change, reset your password immediately and review your
        account security settings.
      </Text>
    </EmailLayout>
  )
}

TwoFactorChangedEmail.PreviewProps = {
  enabled: true
} satisfies TwoFactorChangedEmailProps

type PasskeyChangedEmailProps = {
  readonly added: boolean
}

/**
 * Security notification for a passkey change (added or removed). Same shape
 * as the two-factor notification: no action link on purpose — the recipient
 * manages passkeys from the app's `/account` page, and the email must not
 * become a clickable attack surface.
 */
export function PasskeyChangedEmail({ added }: PasskeyChangedEmailProps) {
  // The rule against ternaries applies here too; plain branches keep the
  // two wordings next to each other.
  let verb = 'added'
  let preview = 'A passkey was added to your account'
  if (!added) {
    verb = 'removed'
    preview = 'A passkey was removed from your account'
  }
  return (
    <EmailLayout preview={preview} heading={<>Passkey {verb}</>}>
      <Text className="text-base text-gray-700 mt-4">
        A passkey was just {verb} for your B2B SaaS Starter account. If that was you, no
        action is needed.
      </Text>
      <Text className="text-sm text-gray-500 mt-4">
        If you did not make this change, reset your password immediately and review your
        account security settings.
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
}

/**
 * Security notification that the password was replaced — sent for both flows
 * that can do it without the old password in hand afterwards (the reset's
 * confirmation, and the signed-in change). No action link on purpose, same
 * rule as the two-factor and passkey notifications: a "sign in" button in an
 * email the true owner did not ask for is a phishing assist, and the copy
 * only needs to say what happened and what to do about it.
 */
export function PasswordChangedEmail({ via }: PasswordChangedEmailProps) {
  // Plain branches keep the two wordings next to each other, per the rule
  // TwoFactorChangedEmail follows.
  let flow = 'reset through the link we emailed you'
  let preview = 'Your password was reset'
  let heading = 'Your password was reset'
  if (via === 'password-change') {
    flow = 'changed from your account settings'
    preview = 'Your password was changed'
    heading = 'Your password was changed'
  }
  return (
    <EmailLayout preview={preview} heading={heading}>
      <Text className="text-base text-gray-700 mt-4">
        The password for your B2B SaaS Starter account was just {flow}. If that was you,
        sign in with the new password the next time you need it.
      </Text>
      <Text className="text-sm text-gray-500 mt-4">
        If you did not make this change, reset your password immediately and review your
        account security settings.
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
export function BackupCodesRotatedEmail() {
  return (
    <EmailLayout
      preview="Your two-factor recovery codes were replaced"
      heading="Recovery codes replaced"
    >
      <Text className="text-base text-gray-700 mt-4">
        New two-factor recovery codes were just generated for your B2B SaaS Starter
        account. Every code you saved before this change has stopped working.
      </Text>
      <Text className="text-sm text-gray-500 mt-4">
        If that was you, store the new codes somewhere safe. If you did not make this
        change, reset your password immediately and review your account security
        settings.
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
  workspacesDeleted
}: AccountDeletedEmailProps) {
  // Plain branches keep the four wordings next to each other, per the rule
  // TwoFactorChangedEmail follows.
  let deletedSentence = 'No workspace was deleted with your account.'
  if (workspacesDeleted === 1) {
    deletedSentence = '1 workspace was deleted because you were the only member.'
  } else if (workspacesDeleted > 1) {
    deletedSentence = `${workspacesDeleted} workspaces were deleted because you were the only member.`
  }
  let leftSentence = ''
  if (workspacesLeft === 1) {
    leftSentence = ' You were removed from 1 workspace where other owners remain.'
  } else if (workspacesLeft > 1) {
    leftSentence = ` You were removed from ${workspacesLeft} workspaces where other owners remain.`
  }
  return (
    <EmailLayout
      preview="Your B2B SaaS Starter account was deleted"
      heading="Your account was deleted"
    >
      <Text className="text-base text-gray-700 mt-4">
        Your B2B SaaS Starter account has been permanently deleted, along with every
        session signed in as you.
      </Text>
      <Text className="text-base text-gray-700 mt-4">
        {deletedSentence}
        {leftSentence}
      </Text>
      <Text className="text-sm text-gray-500 mt-4">
        If you did not delete this account, reset the password of any account that
        shares this password and contact support immediately.
      </Text>
    </EmailLayout>
  )
}

AccountDeletedEmail.PreviewProps = {
  workspacesLeft: 2,
  workspacesDeleted: 1
} satisfies AccountDeletedEmailProps
