import { fireEvent, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import {
  SignInPage,
  type SendMagicLink,
  type SignInWithEmail,
  type SignInWithPasskey
} from './sign-in'
import {
  type SignInWithSocial,
  type SignInWithSso
} from '@/components/auth/auth-client-ports'

// The page's own `signIn` port, handed in as a prop. The router is real, so the
// redirect assertions read the resulting location instead of asking whether a
// `history.push` double was called.
const signIn = vi.fn<SignInWithEmail>()
const signInPasskey = vi.fn<SignInWithPasskey>()

// The social port, same treatment: a fake of the same shape, so the button
// tests drive the real component without the Better Auth client.
const signInSocial = vi.fn<SignInWithSocial>()

// The link-mode port, same contract: driven with a real function of the same
// shape instead of replacing the auth client singleton.
const sendMagicLink = vi.fn<SendMagicLink>()

async function renderPage(
  redirect?: string,
  socialProviders: ReadonlyArray<'github' | 'google'> = []
) {
  const rendered = await renderWithRouter(
    <SignInPage
      {...(redirect === undefined ? {} : { redirect })}
      socialProviders={socialProviders}
      signIn={signIn}
      signInPasskey={signInPasskey}
      signInSocial={signInSocial}
      sendMagicLink={sendMagicLink}
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

  describe('social providers', () => {
    beforeEach(() => {
      signInSocial.mockReset()
      signInSocial.mockResolvedValue({ error: null })
    })

    // The accept criterion: with no env vars set, the sign-in UI is unchanged.
    it('renders no provider buttons and no divider when none are configured', async () => {
      await renderPage()
      expect(screen.queryByRole('button', { name: 'Continue with GitHub' })).toBeNull()
      expect(screen.queryByText('or continue with email')).toBeNull()
      // The email form is exactly the page that existed before social.
      expect(screen.getByLabelText('Email')).toBeDefined()
      expect(screen.getByLabelText('Password')).toBeDefined()
    })

    it('renders one button per active provider and starts the flow on click', async () => {
      await renderPage(undefined, ['github', 'google'])
      const github = screen.getByRole('button', { name: 'Continue with GitHub' })
      expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeDefined()
      expect(screen.getByText('or continue with email')).toBeDefined()

      fireEvent.click(github)
      await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1))
      expect(signInSocial).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: `${window.location.origin}/workspaces`
      })
    })

    it('carries a same-origin redirect target into the provider callback', async () => {
      await renderPage('/workspaces/starter-lab', ['github'])
      fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
      await waitFor(() => expect(signInSocial).toHaveBeenCalledTimes(1))
      expect(signInSocial).toHaveBeenCalledWith({
        provider: 'github',
        callbackURL: `${window.location.origin}/workspaces/starter-lab`
      })
    })
  })

  it('routes a matched domain to its IdP instead of the password path', async () => {
    const signInWithSso = vi.fn<SignInWithSso>()
    signInWithSso.mockResolvedValue({
      data: { url: 'https://login.acme.com/authorize?state=x', redirect: true },
      error: null
    })
    const assign = vi.fn()
    const { router } = await renderWithRouter(
      <SignInPage
        signIn={signIn}
        signInWithSso={signInWithSso}
        resolveRouting={async () => ({
          providerId: 'sso_test',
          protocol: 'oidc',
          workspaceId: 'wrk_test',
          requireSso: false
        })}
      />,
      { path: '/sign-in', destinations: ['/workspaces'] }
    )
    await screen.findByLabelText('Email')
    // The domain the mock connection owns — not the seeded demo address.
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'person@acme.com' }
    })
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'demo-password-1' }
    })
    // SAFETY: jsdom forbids assigning `window.location`; the page's redirect
    // target is exactly what this assertion needs, so `location` is replaced
    // with a double whose `assign` records the target.
    Object.defineProperty(window, 'location', {
      value: { assign },
      writable: true
    })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1))
    expect(assign).toHaveBeenCalledWith('https://login.acme.com/authorize?state=x')
    // The IdP's landing URL is absolute — Better Auth validates `callbackURL`
    // against trusted origins — with the safe redirect target as its path.
    expect(signInWithSso).toHaveBeenCalledWith({
      email: 'person@acme.com',
      callbackURL: `${window.location.origin}/workspaces`
    })
    // The credential path never ran, and no navigation happened client-side.
    expect(signIn).not.toHaveBeenCalled()
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('explains instead of failing when the gate refuses the password path', async () => {
    // What better-fetch puts on a non-OK response: the parsed body spread
    // over `status`/`statusText`. The gate answers better-call's
    // `{ code, message }` body; the page probes `error.code`.
    const refused = {
      code: 'sso_required',
      message: 'This workspace requires single sign-on for your email domain.',
      status: 403,
      statusText: 'Forbidden'
    } satisfies {
      readonly code: string
      readonly message: string
      readonly status: number
      readonly statusText: string
    }
    signIn.mockResolvedValueOnce({ error: refused })
    await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    // The guidance notice, not the destructive failed-sign-in alert: the
    // notice carries the "sign in with your identity provider" suffix the
    // error path never renders. (`Alert` is `role="alert"` in both variants,
    // so the text is the discriminator.)
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toBe(
      'This workspace requires single sign-on for your email domain. Sign in with your identity provider.'
    )
  })

  it('explains the two-factor refusal a magic-link hop lands with', async () => {
    // The TOTP gate refuses the link before consumption and redirects the
    // browser to /sign-in?error=two_factor_required — the search param is the
    // refusal's only channel, so the page renders it as guidance naming the
    // path that still works, not a failed sign-in.
    await renderWithRouter(
      <SignInPage searchError="two_factor_required" signIn={signIn} />,
      { path: '/sign-in', destinations: ['/workspaces'] }
    )
    const notice = await screen.findByRole('alert')
    expect(notice.textContent).toBe(
      'This account uses two-factor authentication. Sign in with your password and authenticator.'
    )
    // Guidance, not a dead end: the credential form the message points at is
    // right there under the notice.
    expect(screen.getByLabelText('Password')).toBeDefined()
  })

  it('renders nothing for an unknown error search param', async () => {
    await renderWithRouter(
      <SignInPage searchError="something_else" signIn={signIn} />,
      { path: '/sign-in', destinations: ['/workspaces'] }
    )
    await screen.findByLabelText('Email')
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('offers the email-code path without touching the credential form', async () => {
    await renderPage('/workspaces')
    const entry = screen.getByRole('link', { name: 'Email me a code instead' })
    expect(entry.getAttribute('href')).toBe(
      '/sign-in/email-code?redirect=%2Fworkspaces'
    )
    // The entry point is additive: the credential form still submits as-is.
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(signIn).toHaveBeenCalledTimes(1))
  })
})

describe('SignInPage link mode', () => {
  beforeEach(() => {
    signIn.mockReset()
    signIn.mockResolvedValue({ error: null })
    sendMagicLink.mockReset()
    sendMagicLink.mockResolvedValue({ error: null })
  })

  async function switchToLinkMode() {
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    await screen.findByText('Sign in with password instead')
  }

  it('switches to an email-only form and back', async () => {
    await renderPage()
    await switchToLinkMode()
    // Email-only: no password field, no forgot-password link in this mode.
    expect(screen.queryByLabelText('Password')).toBeNull()
    expect(screen.queryByText('Forgot your password?')).toBeNull()

    fireEvent.click(
      screen.getByRole('button', { name: 'Sign in with password instead' })
    )
    await screen.findByLabelText('Password')
    expect(screen.queryByText('Sign in with password instead')).toBeNull()
  })

  it('sends the link and shows the non-disclosing sent confirmation', async () => {
    await renderPage()
    await switchToLinkMode()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    await waitFor(() => expect(sendMagicLink).toHaveBeenCalledTimes(1))
    expect(sendMagicLink).toHaveBeenCalledWith({
      email: 'demo@starter.local',
      turnstileToken: undefined
    })
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('check your inbox for a sign-in link')
    expect(alert.textContent).toContain('ten minutes')
    // The password path stays untouched by a link request.
    expect(signIn).not.toHaveBeenCalled()
  })

  it('blocks submission while Turnstile is configured but unanswered', async () => {
    await renderWithRouter(
      <SignInPage
        signIn={signIn}
        sendMagicLink={sendMagicLink}
        turnstileSiteKey="site-key"
      />,
      { path: '/sign-in', destinations: ['/workspaces'] }
    )
    await screen.findByLabelText('Email')
    await switchToLinkMode()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Complete the bot check')
    expect(sendMagicLink).not.toHaveBeenCalled()
  })

  it('surfaces send errors without claiming the link was sent', async () => {
    sendMagicLink.mockResolvedValueOnce({ error: { message: 'rate_limited' } })
    await renderPage()
    await switchToLinkMode()
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'demo@starter.local' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Email me a sign-in link' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('rate_limited')
    expect(screen.queryByText(/check your inbox/)).toBeNull()
  })
})
