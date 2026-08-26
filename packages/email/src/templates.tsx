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

/**
 * A React Email template renders synchronously through `@react-email/render`,
 * outside any Effect, so there is no Clock or DateTime to read the footer's
 * copyright year from.
 */
function footerYear(): number {
  // oxlint-disable-next-line effect/noGlobals -- no Effect context in a render function
  return new Date().getFullYear()
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
        <Preview>You have been invited to {workspaceName}</Preview>
        <Body className="bg-gray-100 font-sans py-10">
          <Container className="bg-white max-w-xl mx-auto rounded-lg px-8 py-10">
            <Heading className="text-2xl font-bold text-gray-900 m-0">
              Join {workspaceName}
            </Heading>
            <Text className="text-base text-gray-700 mt-4">
              You have been invited to a B2B SaaS Starter workspace. Accept the
              invitation to review reports, tokens, and settings.
            </Text>
            <Section className="mt-6">
              <Button
                href={inviteUrl}
                className="bg-brand text-white px-6 py-3 rounded-md font-medium box-border"
              >
                Accept invitation
              </Button>
            </Section>
            <Text className="text-sm text-gray-500 mt-6">
              If the button does not work, copy this URL into your browser:{' '}
              <Link href={inviteUrl} className="text-brand underline">
                {inviteUrl}
              </Link>
            </Text>
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
        <Preview>Reset your password</Preview>
        <Body className="bg-gray-100 font-sans py-10">
          <Container className="bg-white max-w-xl mx-auto rounded-lg px-8 py-10">
            <Heading className="text-2xl font-bold text-gray-900 m-0">
              Reset your password
            </Heading>
            <Text className="text-base text-gray-700 mt-4">
              Somebody asked to reset the password for your B2B SaaS Starter account. If
              that was you, choose a new password within one hour; the link works once
              and then expires.
            </Text>
            <Section className="mt-6">
              <Button
                href={url}
                className="bg-brand text-white px-6 py-3 rounded-md font-medium box-border"
              >
                Choose a new password
              </Button>
            </Section>
            <Text className="text-sm text-gray-500 mt-6">
              If the button does not work, copy this URL into your browser:{' '}
              <Link href={url} className="text-brand underline">
                {url}
              </Link>
            </Text>
            <Text className="text-sm text-gray-500 mt-4">
              If you did not ask for a reset, you can ignore this email; your password
              stays unchanged.
            </Text>
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
        <Preview>Verify your email address</Preview>
        <Body className="bg-gray-100 font-sans py-10">
          <Container className="bg-white max-w-xl mx-auto rounded-lg px-8 py-10">
            <Heading className="text-2xl font-bold text-gray-900 m-0">
              Verify your email address
            </Heading>
            <Text className="text-base text-gray-700 mt-4">
              Confirm your email address to finish setting up your B2B SaaS Starter
              account. The link works once and expires in an hour.
            </Text>
            <Section className="mt-6">
              <Button
                href={url}
                className="bg-brand text-white px-6 py-3 rounded-md font-medium box-border"
              >
                Verify my email
              </Button>
            </Section>
            <Text className="text-sm text-gray-500 mt-6">
              If the button does not work, copy this URL into your browser:{' '}
              <Link href={url} className="text-brand underline">
                {url}
              </Link>
            </Text>
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

EmailVerificationEmail.PreviewProps = {
  url: 'http://localhost:3071/api/auth/verify-email?token=example&callbackURL=http%3A%2F%2Flocalhost%3A3071%2Fverify-email'
} satisfies EmailVerificationEmailProps

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
              Two-factor authentication {verb}
            </Heading>
            <Text className="text-base text-gray-700 mt-4">
              Two-factor authentication was just {verb} for your B2B SaaS Starter
              account. If that was you, no action is needed.
            </Text>
            <Text className="text-sm text-gray-500 mt-4">
              If you did not make this change, reset your password immediately and
              review your account security settings.
            </Text>
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

TwoFactorChangedEmail.PreviewProps = {
  enabled: true
} satisfies TwoFactorChangedEmailProps
