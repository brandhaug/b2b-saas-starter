import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OwnEmailResend } from './own-email-resend'
import { renderWithQueryClient } from '@/test/query-harness'
import { authClientDouble } from '@/test/fake-auth-client'
import type * as RouterModule from '@tanstack/react-router'

/**
 * Both buttons hit Turnstile-gated auth endpoints, so the component drives
 * the shared ports rather than the client directly — and the tests drive the
 * REAL ports over the fake client, which is what proves the header the auth
 * route demands actually rides the request (and rides nothing when the
 * provider is unconfigured).
 */
vi.mock('@/lib/auth-client', async () => {
  const doubles = await import('@/test/fake-auth-client')
  return { authClient: doubles.authClientDouble }
})
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate: vi.fn() })
}))

const origin = 'http://localhost:3000'

describe('own email resend', () => {
  beforeEach(() => {
    authClientDouble.sendVerificationEmail.mockReset()
    authClientDouble.requestPasswordReset.mockReset()
  })

  it('restarts the normal verification flow without replaying a stored delivery', async () => {
    authClientDouble.sendVerificationEmail.mockResolvedValue({ error: null })
    renderWithQueryClient(<OwnEmailResend email="owner@example.com" verified={false} />)
    fireEvent.click(
      screen.getByRole('button', { name: 'Send a fresh verification email' })
    )
    await screen.findByText('A new email was requested.')
    // The account page asks for its own landing, and with no configured
    // challenge the request carries no `fetchOptions` at all.
    expect(authClientDouble.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'owner@example.com',
      callbackURL: `${origin}/account`
    })
  })

  it('restores the recovery action after a network failure', async () => {
    authClientDouble.requestPasswordReset.mockRejectedValue(
      new Error('Network unavailable')
    )
    renderWithQueryClient(<OwnEmailResend email="owner@example.com" verified />)
    const button = screen.getByRole('button', { name: 'Start a new password reset' })
    fireEvent.click(button)
    await screen.findByText('The email request failed. Try again later.')
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false))
    expect(authClientDouble.requestPasswordReset).toHaveBeenCalledWith({
      email: 'owner@example.com',
      redirectTo: `${origin}/reset-password`
    })
    expect(
      screen.queryByRole('button', { name: 'Send a fresh verification email' })
    ).toBeNull()
  })

  it('refuses to send while a configured challenge is unanswered', async () => {
    renderWithQueryClient(
      <OwnEmailResend
        email="owner@example.com"
        verified={false}
        turnstileSiteKey="site-key"
      />
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'Send a fresh verification email' })
    )

    // The widget cannot issue a token here (no Turnstile script), which is
    // exactly the state a visitor is in before answering: the send is held
    // back rather than sent for the gate to reject.
    await screen.findByText('Complete the bot check.')
    expect(authClientDouble.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
