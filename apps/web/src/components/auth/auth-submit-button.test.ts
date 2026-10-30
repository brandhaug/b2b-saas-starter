import { fireEvent, screen } from '@testing-library/dom'
import { describe, expect, it, vi } from 'vite-plus/test'
import { input, renderAuth } from '@/components/native-test-harness'
import { authClient } from '@/lib/auth-client'

vi.mock('@/lib/auth-client', async () => {
  const { fakeAuthClient } = await import('@/test/fake-auth-client')
  return { authClient: fakeAuthClient() }
})
vi.mock('@/lib/server/workspace-sso', () => ({
  resolveSsoRoutingServerFn: vi.fn(async () => null)
}))

describe('native auth submit button', () => {
  it('exposes the pending label through a live region outside the decorative spinner', async () => {
    vi.mocked(authClient.signIn.email).mockImplementation(() => new Promise(() => {}))
    await renderAuth('sign-in')
    await input(screen.getByLabelText('Email'), 'demo@starter.local')
    await input(screen.getByLabelText('Password'), 'demo-password-1')
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    const status = await screen.findByRole('status')
    const button = screen.getByRole('button', { name: 'Continue' })
    expect(button.getAttribute('aria-busy')).toBe('true')
    expect(button.hasAttribute('disabled')).toBe(true)
    expect(status.textContent).toContain('Signing in…')
    expect(status.closest('[aria-hidden="true"]')).toBeNull()
  })
})
