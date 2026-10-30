import { fireEvent, screen, waitFor } from '@testing-library/dom'
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test'
import { renderAccount } from './test-runtime'
import * as Email from './email'
import { authClientDouble as fake } from '@/test/fake-auth-client'

vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return { authClient: authClientDouble }
})
beforeEach(() => {
  vi.resetAllMocks()
  fake.sendVerificationEmail.mockResolvedValue({ error: null })
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: {
      href: 'http://localhost:3000/account',
      origin: 'http://localhost:3000',
      pathname: '/account',
      search: '',
      hash: ''
    }
  })
})
function render(overrides: Partial<Email.Flags> = {}) {
  return renderAccount({
    email: Email.init({
      email: 'owner@example.com',
      verified: false,
      recovery: false,
      siteKey: null,
      callbackPath: '/account',
      ...overrides
    }).model
  })
}
function click(name: string) {
  fireEvent.click(screen.getByRole('button', { name }))
}

describe('email-verification-banner migration', () => {
  it('nudges with the address and a resend button', async () => {
    await render()
    expect(screen.getByText(/Your email address is not verified yet/)).not.toBeNull()
    expect(
      screen.getByRole('button', { name: 'Resend verification email' })
    ).not.toBeNull()
  })

  it('sends to the signed-in address and confirms', async () => {
    await render()
    click('Resend verification email')
    await waitFor(() =>
      expect(fake.sendVerificationEmail).toHaveBeenCalledWith({
        email: 'owner@example.com',
        callbackURL: 'http://localhost:3000/account'
      })
    )
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('owner@example.com')
    )
    expect(
      screen.queryByRole('button', { name: 'Resend verification email' })
    ).toBeNull()
  })

  it('surfaces send errors as table copy and keeps the resend button', async () => {
    fake.sendVerificationEmail.mockResolvedValue({ error: { code: 'rate_limited' } })
    await render()
    click('Resend verification email')
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain(
      'Too many attempts. Wait a moment and try again.'
    )
    expect(
      screen.getByRole('button', { name: 'Resend verification email' })
    ).not.toBeNull()
  })
})
describe('own-email-resend migration', () => {
  it('restarts the normal verification flow without replaying a stored delivery', async () => {
    await render({ recovery: true })
    click('Send a fresh verification email')
    await screen.findByText('A new email was requested.')
    expect(fake.sendVerificationEmail).toHaveBeenCalledWith({
      email: 'owner@example.com',
      callbackURL: 'http://localhost:3000/account'
    })
  })

  it('restores the recovery action after a network failure', async () => {
    fake.requestPasswordReset.mockRejectedValue(new Error('Network unavailable'))
    await render({ recovery: true, verified: true })
    click('Start a new password reset')
    await screen.findByText('The email request failed. Try again later.')
    expect(
      screen.getByRole('button', { name: 'Start a new password reset' })
    ).toHaveProperty('disabled', false)
    expect(fake.requestPasswordReset).toHaveBeenCalledWith({
      email: 'owner@example.com',
      redirectTo: 'http://localhost:3000/reset-password'
    })
    expect(
      screen.queryByRole('button', { name: 'Send a fresh verification email' })
    ).toBeNull()
  })

  it('refuses to send while a configured challenge is unanswered', async () => {
    await render({ recovery: true, siteKey: 'site-key' })
    click('Send a fresh verification email')
    await screen.findByText('Complete the bot check.')
    expect(fake.sendVerificationEmail).not.toHaveBeenCalled()
  })
})
