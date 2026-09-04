import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { SignInPage, type SignInWithEmail, type SignInWithSso } from './sign-in'

// The page's own `signIn` port, handed in as a prop. The router is real, so the
// redirect assertions read the resulting location instead of asking whether a
// `history.push` double was called.
const signIn = vi.fn<SignInWithEmail>()

// The routing ask defaults to "no connection" (the catch fallback), so the
// credential tests run the page exactly as a starter without SSO sees it.
const resolveRouting = vi.fn(async () => null)

async function renderPage(redirect?: string) {
  const rendered = await renderWithRouter(
    <SignInPage
      {...(redirect === undefined ? {} : { redirect })}
      signIn={signIn}
      resolveRouting={resolveRouting}
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
        resolveRouting={async () => ({ requireSso: false })}
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
})
