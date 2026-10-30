import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { authClientDouble as fake } from '@/test/fake-auth-client'
import { SignInPage } from './sign-in-page'
import { EmailCodeExchangePage } from './email-code-exchange'
import { ForgotPasswordPage } from '@/routes/forgot-password'
import { EmailVerificationBanner } from '@/components/email-verification-banner'
import { TwoFactorChallengePage } from '@/routes/two-factor'
import { ResetPasswordPage } from '@/routes/reset-password'
import { OAuthConsentPage } from '@/routes/oauth.consent'
import { m } from '@b2b-saas-starter/i18n/messages'
import { deferred } from './auth-deferred.test-support'

vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return { authClient: authClientDouble }
})

beforeEach(() => vi.clearAllMocks())

it('ignores verification after switching to a different email', async () => {
  const result = deferred<{ error: null }>()
  const verify = vi.fn(() => result.promise)
  const onVerified = vi.fn()
  await renderWithRouter(
    <EmailCodeExchangePage
      purpose="sign-in"
      email="first@example.com"
      verify={verify}
      onVerified={onVerified}
      title="Code"
      codeSentNotice="Sent"
      codeSubmitLabel="Verify"
      codeSubmittingLabel="Verifying"
    />
  )
  fireEvent.change(screen.getByLabelText('Digit 1 of 6'), {
    target: { value: '123456' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Verify' }))
  await waitFor(() => expect(verify).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: m.use_different_email() }))
  await screen.findByLabelText('Email')
  await act(async () => result.resolve({ error: null }))
  expect(onVerified).not.toHaveBeenCalled()
})

it('deduplicates resend and ignores its failure after changing email', async () => {
  const result = deferred<{ error: { code: string } }>()
  const send = vi.fn(() => result.promise)
  await renderWithRouter(
    <EmailCodeExchangePage
      purpose="sign-in"
      email="first@example.com"
      send={send}
      verify={async () => ({ error: null })}
      onVerified={vi.fn()}
      title="Code"
      codeSentNotice="Sent"
      codeSubmitLabel="Verify"
      codeSubmittingLabel="Verifying"
    />
  )
  const resend = screen.getByRole('button', { name: m.resend_code() })
  fireEvent.click(resend)
  fireEvent.click(resend)
  await waitFor(() => expect(send).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: m.use_different_email() }))
  await act(async () => result.resolve({ error: { code: 'rate_limited' } }))
  expect(screen.queryByRole('alert')).toBeNull()
})

it('excludes duplicate recovery codes and competing reset links', async () => {
  const result = deferred<{ error: null }>()
  const requestResetCode = vi.fn(() => result.promise)
  const requestReset = vi.fn(async () => ({ error: null }))
  await renderWithRouter(
    <ForgotPasswordPage
      requestReset={requestReset}
      requestResetCode={requestResetCode}
    />
  )
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'first@example.com' }
  })
  const code = screen.getByRole('button', { name: m.email_code_instead() })
  fireEvent.click(code)
  fireEvent.click(code)
  fireEvent.click(screen.getByRole('button', { name: m.form_send_reset_link() }))
  await waitFor(() => expect(requestResetCode).toHaveBeenCalledOnce())
  expect(requestReset).not.toHaveBeenCalled()
  await act(async () => result.resolve({ error: null }))
  await screen.findByText(m.enter_your_code())
})

it('deduplicates verification email sends and permits a failed send retry', async () => {
  const result = deferred<{ error: { code: string } }>()
  const send = vi.fn(() => result.promise)
  await renderWithRouter(
    <EmailVerificationBanner email="first@example.com" sendVerificationEmail={send} />
  )
  const button = screen.getByRole('button', { name: m.workspace_resend_verification() })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(send).toHaveBeenCalledOnce())
  await act(async () => result.resolve({ error: { code: 'rate_limited' } }))
  await screen.findByRole('alert')
  fireEvent.click(button)
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2))
})

it('keeps manual passkey fallback available during conditional discovery', async () => {
  vi.stubGlobal('PublicKeyCredential', {
    isConditionalMediationAvailable: async () => true
  })
  const passive = deferred<{ error: null; data: null }>()
  fake.signIn.passkey.mockImplementationOnce(() => passive.promise)
  fake.signIn.passkey.mockResolvedValue({ error: { code: 'AUTH_CANCELLED' } })
  try {
    await renderWithRouter(<SignInPage resolveRouting={async () => null} />)
    await waitFor(() => expect(fake.signIn.passkey).toHaveBeenCalledOnce())
    const button = screen.getByRole<HTMLButtonElement>('button', {
      name: m.public_auth_sign_in_with_passkey()
    })
    expect(button.disabled).toBe(false)
    fireEvent.click(button)
    await waitFor(() => expect(fake.signIn.passkey).toHaveBeenCalledTimes(2))
    await screen.findByRole('alert')
    await act(async () => passive.resolve({ error: null, data: null }))
    expect(screen.getByRole('alert')).toBeDefined()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('blocks social sign-in during a password request and ignores completion after navigation', async () => {
  const result = deferred<{ error: null }>()
  fake.signIn.email.mockImplementationOnce(() => result.promise)
  const { router } = await renderWithRouter(
    <SignInPage socialProviders={['github']} resolveRouting={async () => null} />,
    { path: '/sign-in', destinations: ['/elsewhere', '/workspaces'] }
  )
  fireEvent.change(screen.getByLabelText('Email'), {
    target: { value: 'first@example.com' }
  })
  fireEvent.change(screen.getByLabelText('Password'), {
    target: { value: 'password1234' }
  })
  fireEvent.click(screen.getByRole('button', { name: m.continue_action() }))
  await waitFor(() => expect(fake.signIn.email).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
  expect(fake.signIn.social).not.toHaveBeenCalled()
  await act(async () => {
    router.history.push('/elsewhere')
    await router.load()
  })
  await act(async () => result.resolve({ error: null }))
  expect(router.state.location.pathname).toBe('/elsewhere')
})

it('shows social failures and allows another method afterwards', async () => {
  fake.signIn.social.mockResolvedValue({ error: { code: 'rate_limited' } })
  await renderWithRouter(
    <SignInPage socialProviders={['github']} resolveRouting={async () => null} />
  )
  fireEvent.click(screen.getByRole('button', { name: 'Continue with GitHub' }))
  const alert = await screen.findByRole('alert')
  expect(alert.textContent).toContain('Too many attempts')
})

it('keeps a pending TOTP attempt authoritative until it fails', async () => {
  const result = deferred<{ error: { code: string } }>()
  fake.twoFactor.verifyTotp.mockImplementationOnce(() => result.promise)
  await renderWithRouter(<TwoFactorChallengePage />)
  fireEvent.change(screen.getByLabelText(m.form_verification_code()), {
    target: { value: '123456' }
  })
  fireEvent.click(screen.getByRole('button', { name: m.form_verify_sign_in() }))
  await waitFor(() => expect(fake.twoFactor.verifyTotp).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: m.use_backup_code() }))
  expect(screen.queryByLabelText(m.form_backup_code())).toBeNull()
  await act(async () => result.resolve({ error: { code: 'INVALID_CODE' } }))
  await screen.findByRole('alert')
  fireEvent.click(screen.getByRole('button', { name: m.use_backup_code() }))
  await screen.findByLabelText(m.form_backup_code())
})

it('does not navigate from a reset password response after leaving the screen', async () => {
  const result = deferred<{ error: null }>()
  fake.resetPassword.mockImplementationOnce(() => result.promise)
  const { router } = await renderWithRouter(<ResetPasswordPage token="token" />, {
    path: '/reset-password',
    destinations: ['/elsewhere', '/sign-in']
  })
  fireEvent.change(screen.getByLabelText(m.form_new_password()), {
    target: { value: 'password1234' }
  })
  fireEvent.change(screen.getByLabelText(m.form_confirm_password()), {
    target: { value: 'password1234' }
  })
  fireEvent.click(screen.getByRole('button', { name: m.form_reset_password() }))
  await waitFor(() => expect(fake.resetPassword).toHaveBeenCalledOnce())
  await act(async () => {
    router.history.push('/elsewhere')
    await router.load()
  })
  await act(async () => result.resolve({ error: null }))
  expect(router.state.location.pathname).toBe('/elsewhere')
})

it('deduplicates consent and suppresses its redirect after leaving', async () => {
  const result = deferred<{ url: string }>()
  const deny = vi.fn(() => result.promise)
  const assign = vi.fn()
  const { router } = await renderWithRouter(
    <OAuthConsentPage
      payload={{ client: null, workspaces: [], oauthQuery: 'client_id=x&sig=a' }}
      request={{ clientId: 'x', scopes: [] }}
      grant={vi.fn()}
      deny={deny}
      assign={assign}
    />,
    { destinations: ['/elsewhere'] }
  )
  const button = screen.getByRole('button', { name: m.oauth_decline() })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(deny).toHaveBeenCalledOnce())
  await act(async () => {
    router.history.push('/elsewhere')
    await router.load()
  })
  await act(async () => result.resolve({ url: 'https://client.example/callback' }))
  expect(assign).not.toHaveBeenCalled()
})
