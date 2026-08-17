import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithRouter } from '@/test/router-harness'
import { SignInPage, type SignInWithEmail } from './sign-in'

// The page's own `signIn` port, handed in as a prop. The router is real, so the
// redirect assertions read the resulting location instead of asking whether a
// `history.push` double was called.
const signIn = vi.fn<SignInWithEmail>()

async function renderPage(redirect?: string) {
  const rendered = await renderWithRouter(
    <SignInPage {...(redirect === undefined ? {} : { redirect })} signIn={signIn} />,
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
    await screen.findByText('Password must be at least 8 characters')
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

  it('keeps the GitHub button disabled until OAuth is configured', async () => {
    await renderPage()
    const github = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Continue with GitHub'
    })
    expect(github.disabled).toBe(true)
    screen.getByText('Configure GitHub OAuth secrets to enable.')
  })
})
