import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/router-harness'
import { SignUpPage, type SignUpWithEmail } from './sign-up'

// The page's own `signUp` port, handed in as a prop. The router is real, so
// the redirect assertions read the resulting location instead of asking
// whether a `history.push` double was called.
const signUp = vi.fn<SignUpWithEmail>()

async function renderPage(redirect?: string) {
  const rendered = await renderWithRouter(
    <SignUpPage {...(redirect === undefined ? {} : { redirect })} signUp={signUp} />,
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
    await screen.findByText('Password must be at least 12 characters')
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
      password: 'correct-horse-battery'
    })
    await waitFor(() => expect(router.state.location.pathname).toBe('/workspaces'))
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

  describe('with Turnstile configured', () => {
    // The site key mounts the real widget double-free: the script load fails
    // silently under jsdom (no network), so no token ever arrives — which is
    // exactly the state these cases exercise.
    async function renderWithTurnstile() {
      const rendered = await renderWithRouter(
        <SignUpPage turnstileSiteKey="site-key" signUp={signUp} />,
        { path: '/sign-up', destinations: ['/workspaces'] }
      )
      await screen.findByLabelText('Name')
      return rendered
    }

    it('blocks submit until the widget reports a token, then forwards it', async () => {
      await renderWithTurnstile()
      fillValidValues()
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('bot check')
      expect(signUp).not.toHaveBeenCalled()
    })
  })
})
