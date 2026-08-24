import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/router-harness'
import { SignUpPage, type SignUpWithEmail } from './sign-up'

// The page's own `signUp` port, handed in as a prop. The router is real, so
// the redirect assertions read the resulting location instead of asking
// whether a `history.push` double was called.
const signUp = vi.fn<SignUpWithEmail>()

async function renderPage(redirect?: string, turnstileSiteKey?: string) {
  const rendered = await renderWithRouter(
    <SignUpPage
      {...(redirect === undefined ? {} : { redirect })}
      {...(turnstileSiteKey === undefined ? {} : { turnstileSiteKey })}
      signUp={signUp}
    />,
    { path: '/sign-up', destinations: ['/workspaces', '/sign-in'] }
  )
  await screen.findByLabelText('Name')
  return rendered
}

function fillValidValues() {
  fireEvent.change(screen.getByLabelText('Name'), {
    target: { value: 'Ada Lovelace' }
  })
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'ada@example.com' }
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'correct-horse-battery' }
  })
}

describe('SignUpPage', () => {
  beforeEach(() => {
    signUp.mockReset()
    signUp.mockResolvedValue({ error: null })
  })

  it('shows validation errors and disables submit for invalid input', async () => {
    await renderPage()
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: '   ' }
    })
    await screen.findByText('Name is required')
    fireEvent.change(screen.getByLabelText('Email'), {
      target: { value: 'not-an-email' }
    })
    await screen.findByText('Enter a valid email')
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'short' }
    })
    await screen.findByText('Password must be at least 8 characters')
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create account'
    })
    expect(submit.disabled).toBe(true)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('submits the account and redirects to /workspaces by default', async () => {
    const { router } = await renderPage()
    fillValidValues()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp).toHaveBeenCalledWith({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      turnstileToken: undefined
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
  })

  it('renders no Turnstile widget and sends no token when unconfigured', async () => {
    await renderPage()
    fillValidValues()
    expect(screen.queryByTestId('turnstile-widget')).toBeNull()
  })

  it('passes the solved challenge token through the signUp port', async () => {
    // Fake the Turnstile Web script environment: `window.turnstile` present
    // means the widget's loader resolves without any network.
    let solve: ((token: string) => void) | undefined
    const previous = window.turnstile
    window.turnstile = {
      render: (_container, params) => {
        solve = params.callback
        return 'widget-id'
      },
      remove: () => {},
      reset: () => {}
    }
    try {
      await renderPage(undefined, 'site-key')
      await screen.findByTestId('turnstile-widget')
      fillValidValues()
      // First attempt fails server-side (the closed gate) so the form stays
      // mounted for the retry after the challenge is solved.
      signUp.mockResolvedValueOnce({ error: { message: 'Human verification failed' } })
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
      await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
      // Unsolved challenge: the port still receives the explicit undefined,
      // and the server gate is what fails the request closed.
      expect(signUp.mock.calls[0]?.[0]?.turnstileToken).toBeUndefined()

      solve?.('tok-123')
      signUp.mockClear()
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
      await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
      expect(signUp.mock.calls[0]?.[0]?.turnstileToken).toBe('tok-123')
    } finally {
      if (previous) window.turnstile = previous
      else delete window.turnstile
    }
  })

  it('honours a same-origin redirect search param', async () => {
    const { router } = await renderPage('/workspaces/starter-lab')
    fillValidValues()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/workspaces/starter-lab')
    )
  })

  it('surfaces sign-up errors and does not navigate', async () => {
    signUp.mockResolvedValueOnce({
      error: { message: 'User already exists' }
    })
    const { router } = await renderPage()
    fillValidValues()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('User already exists')
    expect(router.state.location.pathname).toBe('/sign-up')
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
})
