import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { authClient } from '@/lib/auth-client'
import { ResetPasswordPage } from './reset-password'
import * as m from '@b2b-saas-starter/i18n/messages'

// The page calls the client module directly, so its reset endpoint is a
// double on the mocked module. The router is real, so the redirect
// assertion reads the resulting location.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const resetPassword = vi.mocked(authClient.resetPassword)

async function renderPage(search: { token?: string; error?: string } = {}) {
  const rendered = await renderWithRouter(<ResetPasswordPage {...search} />, {
    path: '/reset-password',
    destinations: ['/sign-in', '/forgot-password']
  })
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
    screen.getByText(m.reset_link_unusable())
    expect(screen.getByRole('link', { name: 'Request a new reset link' })).toBeDefined()
    expect(screen.queryByLabelText('New password')).toBeNull()
  })

  it('shows the same failure state when the token exchange rejected the link', async () => {
    await renderPage({ error: 'INVALID_TOKEN' })
    screen.getByText(m.reset_link_unusable())
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

  it('surfaces reset errors as table copy and keeps the form', async () => {
    resetPassword.mockResolvedValueOnce({
      error: { code: 'INVALID_TOKEN' }
    })
    const { router } = await renderPage({ token: 'tok_reset_123' })
    fillValidPasswords()
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That link or code is invalid. Request a new one.')
    expect(router.state.location.pathname).toBe('/reset-password')
  })
})
