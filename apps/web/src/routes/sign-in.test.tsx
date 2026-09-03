import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { SignInPage, type SignInWithEmail, type SignInWithPasskey } from './sign-in'

// The page's own `signIn` port, handed in as a prop. The router is real, so the
// redirect assertions read the resulting location instead of asking whether a
// `history.push` double was called.
const signIn = vi.fn<SignInWithEmail>()
const signInPasskey = vi.fn<SignInWithPasskey>()

async function renderPage(redirect?: string) {
  const rendered = await renderWithRouter(
    <SignInPage
      {...(redirect === undefined ? {} : { redirect })}
      signIn={signIn}
      signInPasskey={signInPasskey}
    />,
    { path: '/sign-in', destinations: ['/workspaces', '/workspaces/starter-lab'] }
  )
  await screen.findByLabelText('Email')
  return rendered
}

function fillValidCredentials() {
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'demo@starter.local' }
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'demo-password-1' }
  })
}

describe('SignInPage', () => {
  beforeEach(() => {
    signIn.mockReset()
    signIn.mockResolvedValue({ error: null })
    signInPasskey.mockReset()
    signInPasskey.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('shows validation errors and disables submit for invalid input', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' }
    })
    await screen.findByText('Enter a valid email')
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' }
    })
    await screen.findByText('Password must be at least 12 characters')
    const submit = screen.getByRole<HTMLButtonElement>('button', { name: 'Continue' })
    expect(submit.disabled).toBe(true)
    expect(signIn).not.toHaveBeenCalled()
  })

  it('submits credentials and redirects to /workspaces by default', async () => {
    const { router } = await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1))
    expect(signIn).toHaveBeenCalledWith({
      email: 'demo@starter.local',
      password: 'demo-password-1'
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
  })

  it('honours a same-origin redirect search param', async () => {
    const { router } = await renderPage('/workspaces/starter-lab')
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/starter-lab')
    )
  })

  it('falls back to /workspaces for unsafe redirect targets', async () => {
    const { router } = await renderPage('//evil.example.com/phish')
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
  })

  it('surfaces sign-in errors and does not navigate', async () => {
    signIn.mockResolvedValueOnce({ error: { message: 'Invalid email or password' } })
    const { router } = await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid email or password')
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('offers the passkey button alongside the credential form', async () => {
    await renderPage()
    const passkey = screen.getByRole('button', { name: 'Sign in with a passkey' })
    expect(passkey).toBeDefined()
    // The conditional-UI half of the contract: the email field carries the
    // `webauthn` autocomplete token, last.
    expect(screen.getByLabelText('Email').getAttribute('autocomplete')).toBe(
      'email webauthn'
    )
  })

  it('signs in through the passkey port and redirects on success', async () => {
    const { router } = await renderPage('/workspaces/starter-lab')
    signInPasskey.mockResolvedValue({
      data: { user: { id: 'usr_demo' } },
      error: null
    })

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))

    // The button opens the modal ceremony: no autofill option at all.
    await waitFor(() => expect(signInPasskey).toHaveBeenCalledWith(undefined))
    // A passkey sign-in opens the session in the ceremony itself — there is
    // no two-factor hop to route through.
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/starter-lab')
    )
  })

  it('surfaces a cancelled passkey ceremony without navigating', async () => {
    const { router } = await renderPage()
    signInPasskey.mockResolvedValue({ error: { message: 'Auth cancelled' } })

    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a passkey' }))

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Auth cancelled')
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('preloads conditional UI where the browser supports passkey autofill', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: () => Promise.resolve(true)
    })
    await renderPage()

    await waitFor(() => expect(signInPasskey).toHaveBeenCalledWith({ autoFill: true }))
  })

  it('does not preload conditional UI where the browser lacks support', async () => {
    vi.stubGlobal('PublicKeyCredential', {
      isConditionalMediationAvailable: () => Promise.resolve(false)
    })
    await renderPage()

    const button = screen.getByRole('button', { name: 'Sign in with a passkey' })
    expect(button).toBeDefined()
    expect(signInPasskey).not.toHaveBeenCalled()
  })
})
