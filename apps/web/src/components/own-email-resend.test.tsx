import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { OwnEmailResend } from './own-email-resend'
import { renderWithQueryClient } from '@/test/query-harness'
import { authClientDouble } from '@/test/fake-auth-client'
import type * as RouterModule from '@tanstack/react-router'

vi.mock('@/lib/auth-client', async () => {
  const doubles = await import('@/test/fake-auth-client')
  return { authClient: doubles.authClientDouble }
})
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof RouterModule>()),
  useRouter: () => ({ invalidate: vi.fn() })
}))

describe('own email resend (#285)', () => {
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
    expect(authClientDouble.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'owner@example.com',
      callbackURL: '/account'
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
      redirectTo: '/reset-password'
    })
    expect(
      screen.queryByRole('button', { name: 'Send a fresh verification email' })
    ).toBeNull()
  })
})
