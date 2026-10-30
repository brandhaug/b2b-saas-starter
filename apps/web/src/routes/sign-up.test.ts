import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import * as m from '@b2b-saas-starter/i18n/messages'
import { authClient } from '@/lib/auth-client'
import { navigateDocument } from '@/lib/document-navigation'

// Preserve validation, payload/destination, refusal copy, recovery link and Turnstile gate.
vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))
const signUp = vi.mocked(authClient.signUp.email)
afterEach(() => {
  vi.unstubAllGlobals()
})

async function renderPage(redirect?: string) {
  const rendered = await renderAuth('sign-up', {
    search: redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''
  })
  await screen.findByLabelText('Name')
  return rendered
}

async function fillValidValues() {
  await input(screen.getByLabelText('Name'), 'Ada Lovelace')
  await input(screen.getByLabelText('Email'), 'ada@example.com')
  await input(screen.getByLabelText('Password'), 'correct-horse-battery')
}

describe('SignUpPage', () => {
  beforeEach(() => {
    vi.mocked(navigateDocument).mockReset()
    signUp.mockReset()
    signUp.mockResolvedValue({ error: null })
  })

  it('shows validation errors and disables submit for invalid input', async () => {
    await renderPage()
    await input(screen.getByLabelText('Name'), '   ')
    await screen.findByText(m.name_required())
    await input(screen.getByLabelText('Email'), 'not-an-email')
    await screen.findByText(m.public_auth_valid_email())
    await input(screen.getByLabelText('Password'), 'short')
    await screen.findByText(m.public_auth_password_min())
    const submit = screen.getByRole<HTMLButtonElement>('button', {
      name: 'Create account'
    })
    expect(submit.disabled).toBe(true)
    expect(signUp).not.toHaveBeenCalled()
  })

  it('submits the account and redirects to /workspaces by default', async () => {
    await renderPage()
    await fillValidValues()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() => expect(signUp).toHaveBeenCalledTimes(1))
    expect(signUp).toHaveBeenCalledWith({
      name: 'Ada Lovelace',
      email: 'ada@example.com',
      password: 'correct-horse-battery',
      callbackURL: `${window.location.origin}/verify-email`
    })
    await waitFor(() => expect(navigateDocument).toHaveBeenCalledWith('/workspaces'))
  })

  it('honours a same-origin redirect search param', async () => {
    await renderPage('/workspaces/starter-lab')
    await fillValidValues()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    await waitFor(() =>
      expect(navigateDocument).toHaveBeenCalledWith('/workspaces/starter-lab')
    )
  })

  it('surfaces sign-up errors as table copy and does not navigate', async () => {
    signUp.mockResolvedValueOnce({
      error: { code: 'USER_ALREADY_EXISTS' }
    })
    await renderPage()
    await fillValidValues()
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(m.public_auth_account_exists())
    expect(navigateDocument).not.toHaveBeenCalled()
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
    // Drive the widget callback while retaining the real subscription and auth port.
    async function renderWithTurnstile() {
      const rendered = await renderAuth('sign-up', { turnstileSiteKey: 'site-key' })
      await screen.findByLabelText('Name')
      return rendered
    }

    it('blocks submit until the widget reports a token, then forwards it', async () => {
      const render = vi.fn(
        (_element: HTMLElement, _params: TurnstileRenderParameters) => 'widget'
      )
      const remove = vi.fn()
      vi.stubGlobal('turnstile', {
        render,
        remove,
        reset: vi.fn()
      } satisfies TurnstileApi)
      await renderWithTurnstile()
      await fillValidValues()
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
      const alert = await screen.findByRole('alert')
      expect(alert.textContent).toContain('bot check')
      expect(signUp).not.toHaveBeenCalled()
      await waitFor(() => expect(render).toHaveBeenCalledTimes(1))
      const parameters = render.mock.calls[0]?.[1]
      if (!parameters) {
        throw new Error('Missing Turnstile widget parameters')
      }
      parameters.callback('solved-token')
      // Wait for the native message commit before submitting the form again.
      await input(screen.getByLabelText('Name'), 'Ada Lovelace')
      fireEvent.click(screen.getByRole('button', { name: 'Create account' }))
      await waitFor(() =>
        expect(signUp).toHaveBeenCalledWith({
          name: 'Ada Lovelace',
          email: 'ada@example.com',
          password: 'correct-horse-battery',
          callbackURL: `${window.location.origin}/verify-email`,
          fetchOptions: { headers: { 'x-turnstile-token': 'solved-token' } }
        })
      )
    })
  })
})
