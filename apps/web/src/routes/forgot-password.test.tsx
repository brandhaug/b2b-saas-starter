import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import {
  type RequestPasswordReset,
  type RequestPasswordResetCode,
  type ResetPasswordWithCode
} from '@/components/auth/auth-client-ports'
import { ForgotPasswordPage } from './forgot-password'

// The page's own `requestReset` port, handed in as a prop.
const requestReset = vi.fn<RequestPasswordReset>()
const requestCode = vi.fn<RequestPasswordResetCode>()
const resetWithCode = vi.fn<ResetPasswordWithCode>()

async function renderPage() {
  const rendered = await renderWithRouter(
    <ForgotPasswordPage
      requestReset={requestReset}
      requestCode={requestCode}
      resetWithCode={resetWithCode}
    />,
    { path: '/forgot-password', destinations: ['/sign-in'] }
  )
  await screen.findByLabelText('Email')
  return rendered
}

describe('ForgotPasswordPage', () => {
  beforeEach(() => {
    requestReset.mockReset()
    requestReset.mockResolvedValue({ error: null })
    requestCode.mockReset()
    requestCode.mockResolvedValue({ error: null })
    resetWithCode.mockReset()
    resetWithCode.mockResolvedValue({ error: null })
  })

  it('shows validation errors and disables submit for invalid input', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' }
    })
    await screen.findByText('Enter a valid email')
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Send reset link'
    })
    expect(submit.disabled).toBe(true)
    expect(requestReset).not.toHaveBeenCalled()
  })

  it('submits the email and replaces the form with the sent state', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    await waitFor(() => expect(requestReset).toHaveBeenCalledTimes(1))
    expect(requestReset).toHaveBeenCalledWith({ email: 'demo@starter.local' })
    await screen.findByText(/check your inbox for a reset link/i)
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('never echoes the address or an account-existence signal in the sent state', async () => {
    // The endpoint answers identically for unknown emails (enumeration
    // defense) — the page must not know more than the endpoint does, so the
    // sent state stays constant and does not even name the address it sent to.
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'nobody@nowhere.test' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const message = await screen.findByText(/check your inbox for a reset link/i)
    expect(message.textContent).not.toContain('nobody@nowhere.test')
  })

  it('surfaces request errors and keeps the form', async () => {
    requestReset.mockResolvedValueOnce({
      error: { message: 'Too many requests' }
    })
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Too many requests')
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
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }))
    await waitFor(() =>
      expect(requestCode).toHaveBeenCalledWith({ email: 'demo@starter.local' })
    )
    await screen.findByText('Enter your code')
    // The non-disclosure rule holds on the code path too: the confirmation
    // never echoes the address.
    const step = screen.getByText(/six-digit code/i)
    expect(step.textContent).not.toContain('demo@starter.local')
  })

  it('does not send a code for an invalid email and shows the field error', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }))
    await screen.findByText('Enter a valid email')
    expect(requestCode).not.toHaveBeenCalled()
  })

  it('resets the password with the code and lands on sign-in', async () => {
    const { router } = await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }))
    await screen.findByText('Enter your code')
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
      target: { value: '246813' }
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'fresh-otp-password-1' }
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'fresh-otp-password-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    await waitFor(() =>
      expect(resetWithCode).toHaveBeenCalledWith({
        email: 'demo@starter.local',
        otp: '246813',
        newPassword: 'fresh-otp-password-1'
      })
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('surfaces code-reset errors and keeps the code form', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }))
    await screen.findByText('Enter your code')
    resetWithCode.mockResolvedValueOnce({
      error: { message: 'Too many attempts' }
    })
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
      target: { value: '000000' }
    })
    fireEvent.change(screen.getByLabelText('New password'), {
      target: { value: 'fresh-otp-password-1' }
    })
    fireEvent.change(screen.getByLabelText('Confirm password'), {
      target: { value: 'fresh-otp-password-1' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Reset password' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Too many attempts')
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDefined()
  })

  it('returns to the link form from the code step', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code instead' }))
    await screen.findByText('Enter your code')
    fireEvent.click(screen.getByText('Use the link instead'))
    expect(await screen.findByLabelText('Email')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Send reset link' })).toBeDefined()
  })
})
