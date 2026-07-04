import type { ComponentType } from 'react'
import { Suspense } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountRoute } from '@/test/router-mock'

const mocks = vi.hoisted(() => ({
  search: { value: {} as { redirect?: string } },
  historyPush: vi.fn(),
  navigate: vi.fn(),
  signInEmail: vi.fn()
}))

vi.mock('@tanstack/react-router', async (importOriginal) => {
  const { routerMock } = await import('@/test/router-mock')
  return routerMock({
    actual: await importOriginal<Record<string, unknown>>(),
    routeHooks: { useSearch: () => mocks.search.value },
    useRouter: () => ({
      history: { push: mocks.historyPush },
      navigate: mocks.navigate
    }),
    useNavigate: () => mocks.navigate
  })
})

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    signIn: { email: (input: unknown) => mocks.signInEmail(input) }
  }
}))

import { Route } from './sign-in'

let SignInPage: ComponentType

beforeAll(async () => {
  SignInPage = await mountRoute(Route)
})

async function renderPage() {
  render(
    <Suspense fallback={null}>
      <SignInPage />
    </Suspense>
  )
  await screen.findByLabelText('Email')
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
    mocks.search.value = {}
    mocks.historyPush.mockReset()
    mocks.signInEmail.mockReset()
    mocks.signInEmail.mockResolvedValue({ error: null })
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
    const submit = screen.getByRole('button', { name: 'Continue' })
    expect((submit as HTMLButtonElement).disabled).toBe(true)
    expect(mocks.signInEmail).not.toHaveBeenCalled()
  })

  it('submits credentials and redirects to /workspaces by default', async () => {
    await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mocks.signInEmail).toHaveBeenCalledTimes(1))
    expect(mocks.signInEmail).toHaveBeenCalledWith({
      email: 'demo@starter.local',
      password: 'demo-password-1'
    })
    await waitFor(() => expect(mocks.historyPush).toHaveBeenCalledWith('/workspaces'))
  })

  it('honours a same-origin redirect search param', async () => {
    mocks.search.value = { redirect: '/workspaces/starter-lab' }
    await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() =>
      expect(mocks.historyPush).toHaveBeenCalledWith('/workspaces/starter-lab')
    )
  })

  it('falls back to /workspaces for unsafe redirect targets', async () => {
    mocks.search.value = { redirect: '//evil.example.com/phish' }
    await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await waitFor(() => expect(mocks.historyPush).toHaveBeenCalledWith('/workspaces'))
  })

  it('surfaces sign-in errors and does not navigate', async () => {
    mocks.signInEmail.mockResolvedValueOnce({
      error: { message: 'Invalid email or password' }
    })
    await renderPage()
    fillValidCredentials()
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Invalid email or password')
    expect(mocks.historyPush).not.toHaveBeenCalled()
  })

  it('keeps the GitHub button disabled until OAuth is configured', async () => {
    await renderPage()
    const github = screen.getByRole('button', { name: 'Continue with GitHub' })
    expect((github as HTMLButtonElement).disabled).toBe(true)
    screen.getByText('Configure GitHub OAuth secrets to enable.')
  })
})
