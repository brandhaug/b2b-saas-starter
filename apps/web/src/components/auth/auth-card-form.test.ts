import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import { authClient } from '@/lib/auth-client'

vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})
vi.mock('@/lib/server/workspace-sso', () => ({
  resolveSsoRoutingServerFn: vi.fn(async () => null)
}))
vi.mock('@/lib/document-navigation', () => ({ navigateDocument: vi.fn() }))

beforeEach(() => {
  vi.mocked(authClient.signIn.email).mockReset().mockResolvedValue({ error: null })
})

describe('native auth form', () => {
  it('uses a safe POST fallback and delegates hydrated submits', async () => {
    await renderAuth('sign-in')
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    await input(screen.getByLabelText('Password'), 'demo-password-1')
    const form = screen.getByLabelText('Email').closest('form')
    if (!(form instanceof HTMLFormElement)) {
      throw new Error('Missing auth form')
    }
    expect(form.getAttribute('method')).toBe('post')
    expect(form.getAttribute('data-hydrated')).toBe('true')
    const fieldset = form.querySelector('fieldset')
    if (!(fieldset instanceof HTMLFieldSetElement)) {
      throw new Error('Missing auth fieldset')
    }
    expect(fieldset.disabled).toBe(false)
    fireEvent.submit(form)
    await waitFor(() =>
      expect(authClient.signIn.email).toHaveBeenCalledExactlyOnceWith({
        email: 'demo@starter.local',
        password: 'demo-password-1'
      })
    )
  })

  it('keeps the dedicated entry shell to one main landmark', async () => {
    await renderAuth('sign-in')
    expect(screen.getAllByRole('main')).toHaveLength(1)
    expect(document.querySelectorAll('#main-content')).toHaveLength(1)
  })
})
