import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'
import * as m from '@b2b-saas-starter/i18n/messages'

// Preserve validation, opaque sent-state, mapped-error and code/link recovery cases.
// JSDOM cannot load another document. Assert the document-navigation boundary;
// the host/auth browser suite owns the actual cookie handoff and navigation.
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const requestReset = vi.mocked(authClient.requestPasswordReset)
const requestCode = vi.mocked(authClient.emailOtp.requestPasswordReset)
const resetWithCode = vi.mocked(authClient.emailOtp.resetPassword)

async function renderPage() {
  window.history.replaceState(null, '', '/forgot-password')
  const rendered = await renderAuth('forgot-password')
  await screen.findByLabelText('Email')
  return rendered
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    vi.mocked(navigateDocument).mockReset()
    requestReset.mockReset()
    requestReset.mockResolvedValue({ error: null })
    requestCode.mockReset()
    requestCode.mockResolvedValue({ error: null })
    resetWithCode.mockReset()
    resetWithCode.mockResolvedValue({ error: null })
  })

  it('shows validation errors and disables submit for invalid input', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'not-an-email')
    await screen.findByText(m.public_auth_valid_email())
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Send reset link'
    })
    expect(submit.disabled).toBe(true)
    expect(requestReset).not.toHaveBeenCalled()
  })

  it('submits the email and replaces the form with the sent state', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(requestReset).toHaveBeenCalledTimes(1))
    expect(requestReset).toHaveBeenCalledWith({
      email: 'demo@starter.local',
      redirectTo: `${window.location.origin}/reset-password`
    })
    await screen.findByText(m.reset_link_sent_notice())
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('never echoes the address or an account-existence signal in the sent state', async () => {
    // The endpoint answers identically for unknown emails (enumeration
    // defense) — the page must not know more than the endpoint does, so the
    // sent state stays constant and does not even name the address it sent to.
    await renderPage()
    await input(screen.getByLabelText('Email'), 'nobody@nowhere.test')
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const message = await screen.findByText(m.reset_link_sent_notice())
    expect(message.textContent).not.toContain('nobody@nowhere.test')
  })

  it('surfaces request errors as table copy and keeps the form', async () => {
    requestReset.mockResolvedValueOnce({
      error: { code: 'rate_limited' }
    })
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Too many attempts. Wait a moment and try again.')
    expect(alert.textContent).not.toContain('rate_limited')
    expect(screen.getByLabelText('Email')).toBeDefined()
  })

  it('links back to sign-in', async () => {
    await renderPage()
    // The public layout carries its own sign-in links, so the assertion is
    // that some sign-in link lands on /sign-in, not that exactly one exists.
    const hrefs = screen
      .getAllByRole('link', { name: 'Sign in' })
      .map((link) => link.getAttribute('href'))
    expect(hrefs).toContain('/sign-in')
  })

  it('sends a reset code from the typed email and moves to the code step', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: m.email_code_instead() }))
    await waitFor(() =>
      expect(requestCode).toHaveBeenCalledWith({ email: 'demo@starter.local' })
    )
    await screen.findByText('Enter your code')
    // The non-disclosure rule holds on the code path too: the confirmation
    // never echoes the address.
    const step = screen.getByText(m.reset_code_sent_notice())
    expect(step.textContent).not.toContain('demo@starter.local')
  })

  it('does not send a code for an invalid email and shows the field error', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'not-an-email')
    fireEvent.click(screen.getByRole('button', { name: m.email_code_instead() }))
    await screen.findByText(m.public_auth_valid_email())
    expect(requestCode).not.toHaveBeenCalled()
  })

  it('resets the password with the code and lands on sign-in', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: m.email_code_instead() }))
    await screen.findByText('Enter your code')
    await input(screen.getByLabelText('Digit 1 of 6'), '246813')
    await input(screen.getByLabelText('New password'), 'fresh-otp-password-1')
    await input(screen.getByLabelText('Confirm password'), 'fresh-otp-password-1')
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await waitFor(() =>
      expect(resetWithCode).toHaveBeenCalledWith({
        email: 'demo@starter.local',
        otp: '246813',
        password: 'fresh-otp-password-1'
      })
    )
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/sign-in'))
  })

  it('surfaces code-reset errors as table copy and keeps the code form', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: m.email_code_instead() }))
    await screen.findByText('Enter your code')
    // The reset rides the email-OTP plugin, whose wrong-code answer is
    // `INVALID_OTP` (not the two-factor plugin's `INVALID_CODE`) — the code
    // the port really sees on the wire.
    resetWithCode.mockResolvedValueOnce({
      error: { code: 'INVALID_OTP' }
    })
    await input(screen.getByLabelText('Digit 1 of 6'), '000000')
    await input(screen.getByLabelText('New password'), 'fresh-otp-password-1')
    await input(screen.getByLabelText('Confirm password'), 'fresh-otp-password-1')
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That code is incorrect. Check it and try again.')
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDefined()
  })

  it('returns to the link form from the code step', async () => {
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: m.email_code_instead() }))
    await screen.findByText('Enter your code')
    fireEvent.click(screen.getByText(m.use_link_instead()))
    expect(await screen.findByLabelText('Email')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDefined()
  })
})
