import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import {
  EmailVerificationBanner,
  type SendVerificationEmail
} from './email-verification-banner'

// The component's own `sendVerificationEmail` port, handed in as a prop.
const sendVerificationEmail = vi.fn<SendVerificationEmail>()

describe('EmailVerificationBanner', () => {
  beforeEach(() => {
    sendVerificationEmail.mockReset()
    sendVerificationEmail.mockResolvedValue({ error: null })
  })

  it('nudges with the address and a resend button', () => {
    render(
      <EmailVerificationBanner
        email="demo@starter.local"
        sendVerificationEmail={sendVerificationEmail}
      />
    )
    screen.getByText(/Your email address is not verified yet/)
    expect(
      screen.getByRole('button', { name: 'Resend verification email' })
    ).toBeDefined()
  })

  it('sends to the signed-in address and confirms', async () => {
    render(
      <EmailVerificationBanner
        email="demo@starter.local"
        sendVerificationEmail={sendVerificationEmail}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    await waitFor(() => expect(sendVerificationEmail).toHaveBeenCalledTimes(1))
    expect(sendVerificationEmail).toHaveBeenCalledWith({
      email: 'demo@starter.local'
    })
    const status = await screen.findByRole('alert')
    expect(status.textContent).toContain('demo@starter.local')
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' })
    ).toBeNull()
  })

  it('surfaces send errors and keeps the resend button', async () => {
    sendVerificationEmail.mockResolvedValueOnce({
      error: { message: 'Email already verified' }
    })
    render(
      <EmailVerificationBanner
        email="demo@starter.local"
        sendVerificationEmail={sendVerificationEmail}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Email already verified')
    expect(
      screen.getByRole('button', { name: 'Resend verification email' })
    ).toBeDefined()
  })
})
