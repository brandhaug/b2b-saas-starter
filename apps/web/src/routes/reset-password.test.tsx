import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { ResetPasswordPage, type ResetPassword } from './reset-password'

// The page's own `resetPassword` port, handed in as a prop. The router is
// real, so the redirect assertion reads the resulting location.
const resetPassword = vi.fn<ResetPassword>()

async function renderPage(search: { token?: string; error?: string } = {}) {
  const rendered = await renderWithRouter(
    <ResetPasswordPage {...search} resetPassword={resetPassword} />,
    { path: '/reset-password', destinations: ['/sign-in', '/forgot-password'] }
  )
  return rendered
}

function fillValidPasswords() {
  fireEvent.change(screen.getByLabelText('New password'), {
    target: { value: 'correct-horse-battery' }
  })
  fireEvent.change(screen.getByLabelText('Confirm password'), {
    target: { value: 'correct-horse-battery' }
  })
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    resetPassword.mockReset()
    resetPassword.mockResolvedValue({ error: null })
  })

  it('shows the single opaque failure state without a token', async () => {
    await renderPage()
    screen.getByText('This link cannot be used')
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toBeDefined()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('shows the same failure state when the token exchange rejected the link', async () => {
    await renderPage({ error: 'INVALID_TOKEN' })
    screen.getByText('This link cannot be used')
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('submits the new password and redirects to sign-in', async () => {
    const { router } = await renderPage({ token: 'tok_reset_123' })
    fillValidPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1))
    expect(resetPassword).toHaveBeenCalledWith({
      newPassword: 'correct-horse-battery',
      token: 'tok_reset_123'
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('rejects mismatched passwords without calling the port', async () => {
    await renderPage({ token: 'tok_reset_123' })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'correct-horse-battery' }
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'different-horse' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Passwords do not match')
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('surfaces reset errors and keeps the form', async () => {
    resetPassword.mockResolvedValueOnce({
      error: { message: 'The reset token is invalid' }
    })
    const { router } = await renderPage({ token: 'tok_reset_123' })
    fillValidPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('The reset token is invalid')
    expect(router.state.location.pathname).toBe('/reset-password')
  })
})
