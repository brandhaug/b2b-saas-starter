import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  EmailVerificationBanner,
  type SendVerificationEmail
} from './email-verification-banner'

// The component's own `sendVerificationEmail` port, handed in as a prop. No
// `turnstileSiteKey`: the unconfigured provider is what local development and
// these tests run with — no widget, no token, nothing about the banner
// changes.
const sendVerificationEmail = vi.fn<SendVerificationEmail>()

function banner() {
  return (
    <EmailVerificationBanner
      email="demo@starter.local"
      sendVerificationEmail={sendVerificationEmail}
    />
  )
}

function resendButton(): HTMLElement {
  return screen.getByRole('button', { name: 'Resend verification email' })
}

describe('EmailVerificationBanner', () => {
  beforeEach(() => {
    sendVerificationEmail.mockReset()
    sendVerificationEmail.mockResolvedValue({ error: null })
  })

  it('nudges with the address and a resend button', () => {
    render(banner())
    screen.getByText(/Your email address is not verified yet/)
    expect(resendButton()).not.toBeNull()
  })

  it('sends to the signed-in address and confirms', async () => {
    render(banner())
    fireEvent.click(resendButton())
    await waitFor(() => expect(sendVerificationEmail).toHaveBeenCalledTimes(1))
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: 'demo@starter.local',
      // No configured challenge, so no token rides the header.
      turnstileToken: undefined
    })
    // The sent confirmation is a polite live region (`role="status"`), not an
    // assertive alert — it reports an action the user just took.
    const status = await screen.findByRole('status')
    expect(status.textContent).toContain('demo@starter.local')
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' })
    ).toBeNull()
  })

  it('surfaces send errors as table copy and keeps the resend button', async () => {
    sendVerificationEmail.mockResolvedValueOnce({
      error: { code: 'rate_limited' }
    })
    render(banner())
    fireEvent.click(resendButton())
    const alert = await screen.findByRole('alert')
    // The banner carries the error inline after its own sentence, so the
    // match is on the mapped copy, not the whole text content.
    expect(alert.textContent).toContain(
      'Too many attempts. Wait a moment and try again.'
    )
    expect(
      screen.getByRole('button', { name: 'Resend verification email' })
    ).not.toBeNull()
  })
})
