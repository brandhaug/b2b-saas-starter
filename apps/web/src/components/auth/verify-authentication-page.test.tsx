import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { authClientDouble as fake } from '@/test/fake-auth-client'
import { VerifyAuthenticationPage } from './verify-authentication-page'
import {
  strongAuthenticationStatusServerFn,
  verifyCurrentPasswordServerFn
} from '@/lib/server/strong-authentication'
import { m } from '@b2b-saas-starter/i18n/messages'
import { deferred } from './auth-deferred.test-support'

vi.mock('@/lib/auth-client', async () => {
  const { authClientDouble } = await import('@/test/fake-auth-client')
  return { authClient: authClientDouble }
})
vi.mock('@/lib/server/strong-authentication', () => ({
  strongAuthenticationStatusServerFn: vi.fn(),
  verifyCurrentPasswordServerFn: vi.fn()
}))

it('rejects an empty passkey ceremony without checking or claiming stronger authentication', async () => {
  fake.signIn.passkey.mockResolvedValue({ data: null, error: null })
  await renderWithRouter(
    <VerifyAuthenticationPage
      status={{
        qualified: false,
        recent: false,
        recovering: false,
        hasFactors: false,
        passwordVerified: false
      }}
      twoFactorEnabled={false}
    />
  )
  fireEvent.click(screen.getByRole('button', { name: m.security_verify_passkey() }))
  await screen.findByRole('alert')
  expect(strongAuthenticationStatusServerFn).not.toHaveBeenCalled()
})

it('prevents competing verification and skips subsequent steps after unmount', async () => {
  vi.clearAllMocks()
  const result = deferred<boolean>()
  vi.mocked(verifyCurrentPasswordServerFn).mockImplementationOnce(() => result.promise)
  const { unmount } = await renderWithRouter(
    <VerifyAuthenticationPage
      status={{
        qualified: false,
        recent: false,
        recovering: false,
        hasFactors: true,
        passwordVerified: false
      }}
      twoFactorEnabled
      recent
    />
  )
  fireEvent.change(screen.getByLabelText(m.form_password()), {
    target: { value: 'password123' }
  })
  fireEvent.change(screen.getByLabelText(m.security_authenticator_code()), {
    target: { value: '123456' }
  })
  fireEvent.click(screen.getByRole('button', { name: m.security_verify_continue() }))
  await waitFor(() => expect(verifyCurrentPasswordServerFn).toHaveBeenCalledOnce())
  fireEvent.click(screen.getByRole('button', { name: m.security_verify_passkey() }))
  expect(fake.signIn.passkey).not.toHaveBeenCalled()
  unmount()
  await act(async () => result.resolve(true))
  expect(fake.twoFactor.verifyTotp).not.toHaveBeenCalled()
})
