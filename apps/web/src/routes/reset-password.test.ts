import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'
import * as m from '@b2b-saas-starter/i18n/messages'

// Preserve opaque invalid links, reset payload/destination, mismatches and safe errors.
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const resetPassword = vi.mocked(authClient.resetPassword)

async function renderPage(search: { token?: string; error?: string } = {}) {
  return renderAuth('reset-password', { search: `?${new URLSearchParams(search)}` })
}

async function fillValidPasswords() {
  await input(screen.getByLabelText('New password'), 'correct-horse-battery')
  await input(screen.getByLabelText('Confirm password'), 'correct-horse-battery')
}

describe('ResetPasswordPage', () => {
  beforeEach(() => {
    vi.mocked(navigateDocument).mockReset()
    resetPassword.mockReset()
    resetPassword.mockResolvedValue({ error: null })
  })

  it('shows the same failure state when the token exchange rejected the link', async () => {
    await renderPage({ error: 'INVALID_TOKEN' })
    screen.getByText(m.reset_link_unusable())
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('submits the new password and redirects to sign-in', async () => {
    await renderPage({ token: 'tok_reset_123' })
    await fillValidPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await waitFor(() => expect(resetPassword).toHaveBeenCalledTimes(1))
    expect(resetPassword).toHaveBeenCalledWith({
      newPassword: 'correct-horse-battery',
      token: 'tok_reset_123'
    })
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/sign-in'))
  })

  it('rejects mismatched passwords without calling the port', async () => {
    await renderPage({ token: 'tok_reset_123' })
    await input(screen.getByLabelText('New password'), 'correct-horse-battery')
    await input(screen.getByLabelText('Confirm password'), 'different-horse')
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByText(m.passwords_do_not_match())
    expect(alert.textContent).toContain('Passwords do not match')
    expect(screen.getByLabelText('Confirm password').getAttribute('aria-invalid')).toBe(
      'true'
    )
    expect(resetPassword).not.toHaveBeenCalled()
  })

  it('surfaces reset errors as table copy and keeps the form', async () => {
    resetPassword.mockResolvedValueOnce({
      error: { code: 'INVALID_TOKEN' }
    })
    await renderPage({ token: 'tok_reset_123' })
    await fillValidPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That link or code is invalid. Request a new one.')
    expect(navigateDocument).not.toHaveBeenCalled()
  })
})
