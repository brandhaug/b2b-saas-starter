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

interface WorkspaceInvitationEmailProps {
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
              invitation to review modules, readiness, reports, and settings.
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
              © {new Date().getFullYear()} B2B SaaS Starter
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
