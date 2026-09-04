import { fireEvent, screen, waitFor, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import {
  type SendEmailCode,
  type SignInWithEmailCode
} from '@/components/auth/auth-client-ports'
import { EmailCodeSignInPage } from './sign-in_.email-code'

// The page's own ports, handed in as props. The router is real, so the
// redirect assertion reads the resulting location.
const sendCode = vi.fn<SendEmailCode>()
const signIn = vi.fn<SignInWithEmailCode>()

async function renderPage(redirect?: string) {
  const rendered = await renderWithRouter(
    <EmailCodeSignInPage
      {...(redirect === undefined ? {} : { redirect })}
      sendCode={sendCode}
      signIn={signIn}
    />,
    { path: '/sign-in/email-code', destinations: ['/workspaces', '/sign-in'] }
  )
  await screen.findByLabelText('Email')
  return rendered
}

/**
 * Fake-timer-safe variants: `findBy*` polls on a timer interval, which never
 * fires under `vi.useFakeTimers()`, so after a click the tests flush the
 * send's microtasks inside `act` and then query synchronously.
 */
async function renderPageWithFakeTimers(redirect?: string) {
  const rendered = await renderWithRouter(
    <EmailCodeSignInPage
      {...(redirect === undefined ? {} : { redirect })}
      sendCode={sendCode}
      signIn={signIn}
    />,
    { path: '/sign-in/email-code', destinations: ['/workspaces', '/sign-in'] }
  )
  screen.getByLabelText('Email')
  return rendered
}

async function requestCode(email = 'demo@starter.local') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
  await screen.findByText('Enter your code')
}

async function requestCodeWithFakeTimers(email = 'demo@starter.local') {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
  await act(async () => {
    await Promise.resolve()
  })
  screen.getByText('Enter your code')
}

describe('EmailCodeSignInPage', () => {
  beforeEach(() => {
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
      purpose: 'sign-in'
    })
    expect(screen.getByText(/we emailed a six-digit code/i)).toBeDefined()
    expect(screen.queryByLabelText('Email')).toBeNull()
  })

  it('exchanges the code for a session and follows the redirect', async () => {
    const { router } = await renderPage('/workspaces')
    await requestCode()
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
      target: { value: '654321' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    await waitFor(() =>
      expect(signIn).toHaveBeenCalledWith({
        email: 'demo@starter.local',
        otp: '654321'
      })
    )
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
  })

  it('surfaces verify errors and stays on the code step', async () => {
    await renderPage()
    await requestCode()
    signIn.mockResolvedValueOnce({ error: { message: 'Too many attempts' } })
    fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
      target: { value: '000000' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Too many attempts')
    expect(screen.getByLabelText('Digit 1 of 6')).toBeDefined()
  })

  it('shows the resend cooldown and re-sends when it expires', async () => {
    // Fake timers go in BEFORE the send so the cooldown's interval is a fake
    // one and advancing reaches it.
    vi.useFakeTimers()
    try {
      await renderPageWithFakeTimers()
      await requestCodeWithFakeTimers()

      // The cooldown starts at 60 and the disabled label shows the wait.
      const counting = screen.getByRole<HTMLButtonElement>('button', {
        name: /Resend code \(\d+s\)/
      })
      expect(counting.disabled).toBe(true)

      await act(async () => {
        vi.advanceTimersByTime(61_000)
      })
      const ready = screen.getByRole<HTMLButtonElement>('button', {
        name: 'Resend code'
      })
      expect(ready.disabled).toBe(false)
      fireEvent.click(ready)
      // The resend's promise resolves on microtasks, which fake timers leave
      // alone; flush them before asserting.
      await act(async () => {
        await Promise.resolve()
      })
      expect(sendCode).toHaveBeenCalledTimes(2)
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

  it('surfaces send errors and keeps the email form', async () => {
    sendCode.mockResolvedValueOnce({ error: { message: 'Rate limited' } })
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a code' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Rate limited')
    expect(screen.getByLabelText('Email')).toBeDefined()
  })

  it('links back to the password form, carrying the redirect', async () => {
    const { router } = await renderPage('/workspaces')
    fireEvent.click(screen.getByText('Sign in that way'))
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/sign-in')
      expect(router.state.location.searchStr).toContain('redirect=%2Fworkspaces')
    })
  })
})
