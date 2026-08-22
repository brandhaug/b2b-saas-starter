import { type Meta, type StoryObj } from '@storybook/react-vite'
import {
  EmailVerificationBanner,
  type SendVerificationEmail
} from '@/components/email-verification-banner'

// The banner's own `sendVerificationEmail` port, handed in as a prop: the
// story exercises the component states, not the auth client.
function storySend(): ReturnType<SendVerificationEmail> {
  return Promise.resolve({ error: null })
}

function BannerCard({ sendError }: { readonly sendError?: string }) {
  return (
    <div className="w-112">
      <EmailVerificationBanner
        email="demo@starter.local"
        sendVerificationEmail={
          sendError
            ? () => Promise.resolve({ error: { message: sendError } })
            : storySend
        }
      />
    </div>
  )
}

const meta = {
  title: 'Auth/EmailVerificationBanner',
  component: BannerCard
} satisfies Meta<typeof BannerCard>

export default meta
type Story = StoryObj<typeof meta>

// Click "Resend verification email" in the Default story to see the sent
// state; it confirms with the address and hides the button.
export const Default: Story = {}

export const WithSendError: Story = {
  args: { sendError: 'Email already verified' }
}
