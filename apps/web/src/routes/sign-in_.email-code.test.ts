import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import { m } from '@b2b-saas-starter/i18n/messages'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'

// Preserve code exchange, refusal copy, expiry/resend, address changes and redirect links.
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})

const sendCode = vi.mocked(authClient.emailOtp.sendVerificationOtp)
const signIn = vi.mocked(authClient.signIn.emailOtp)

async function renderPage(redirect?: string) {
  const rendered = await renderAuth('email-code', {
    search: redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''
  })
  await screen.findByLabelText('Email')
  return rendered
}

async function requestCode(email = 'demo@starter.local') {
  await input(screen.getByLabelText('Email'), email)
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
  await screen.findByText('Enter your code')
}

describe('EmailCodeSignInPage', () => {
  beforeEach(() => {
    vi.mocked(navigateDocument).mockReset()
    sendCode.mockReset()
    sendCode.mockResolvedValue({ error: null })
    signIn.mockReset()
    signIn.mockResolvedValue({ error: null })
  })

  it('sends a sign-in code and moves to the code step', async () => {
    await renderPage()
    await requestCode()
    expect(sendCode).toHaveBeenCalledWith({
      email: 'demo@starter.local',
      type: 'sign-in'
    })
    expect(screen.getByText(/we emailed a six-digit code/i)).toBeDefined()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('exchanges the code for a session and follows the redirect', async () => {
    await renderPage('/workspaces')
    await requestCode()
    await input(screen.getByLabelText('Digit 1 of 6'), '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({
        email: 'demo@starter.local',
        otp: '654321'
      })
    )
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/workspaces'))
  })

  it('surfaces an incorrect email-OTP code as table copy and stays on the code step', async () => {
    await renderPage()
    await requestCode()
    signIn.mockResolvedValueOnce({ error: { code: 'INVALID_OTP' } })
    await input(screen.getByLabelText('Digit 1 of 6'), '000000')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That code is incorrect. Check it and try again.')
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDefined()
  })

  it('surfaces an expired email-OTP code as table copy and stays on the code step', async () => {
    await renderPage()
    await requestCode()
    signIn.mockResolvedValueOnce({ error: { code: 'OTP_EXPIRED' } })
    await input(screen.getByLabelText('Digit 1 of 6'), '000000')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('That code has expired. Request a new one.')
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDefined()
  })

  it('names the two-factor path when the gate refuses the code sign-in', async () => {
    // Same body shape as the sso_required refusal on /sign-in: the gate's
    // `{ code, message }` answer spread over better-fetch's status fields.
    // The shared code table maps the code to the sentence that names the
    // path that still works; the raw message never renders.
    const refused = {
      code: 'two_factor_required',
      message: 'two factor required'
    } satisfies {
      readonly code: string
      readonly message: string
    }
    signIn.mockResolvedValueOnce({ error: refused })
    await renderPage()
    await requestCode()
    await input(screen.getByLabelText('Digit 1 of 6'), '654321')
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(
      'This account uses two-factor authentication. Sign in with your password and authenticator.'
    )
  })

  it('shows the resend cooldown and re-sends when it expires', async () => {
    // Fake timers go in BEFORE the send so the cooldown's interval is a fake
    // one and advancing reaches it.
    await renderPage()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    try {
      await requestCode()

      // The cooldown starts at 60 and the disabled label shows the wait.
      const counting = screen.getByRole<HTMLButtonElement>('button', {
        name: m.resend_code_in_seconds({ count: 60 })
      })
      expect(counting.disabled).toBe(true)

      await vi.advanceTimersByTimeAsync(61_000)
      const ready = await screen.findByRole<HTMLButtonElement>('button', {
        name: 'Resend code'
      })
      expect(ready.disabled).toBe(false)
      fireEvent.click(ready)
      // The resend's promise resolves on microtasks, which fake timers leave
      // alone; flush them before asserting.
      await waitFor(() => expect(sendCode).toHaveBeenCalledTimes(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('goes back to the email step to use a different address', async () => {
    await renderPage()
    await requestCode()
    fireEvent.click(screen.getByText('Use a different email'))
    expect(await screen.findByLabelText('Email')).toBeDefined()
    expect(screen.queryByText(/we emailed a six-digit code/i)).toBeNull()
  })

  it('surfaces send errors as table copy and keeps the email form', async () => {
    sendCode.mockResolvedValueOnce({ error: { code: 'rate_limited' } })
    await renderPage()
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe('Too many attempts. Wait a moment and try again.')
    expect(screen.getByLabelText('Email')).toBeDefined()
  })

  it('links back to the password form, carrying the redirect', async () => {
    await renderPage('/workspaces')
    const link = screen.getByRole('link', { name: 'Sign in that way' })
    expect(link.getAttribute('href')).toBe('/sign-in?redirect=%2Fworkspaces')
  })
})
