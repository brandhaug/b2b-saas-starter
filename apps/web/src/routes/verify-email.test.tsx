import { screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { VerifyEmailPage } from './verify-email'
import { type SendEmailCode } from '@/components/auth/auth-client-ports'

// The page only reports what the auth handler's redirect already decided, so
// the report half takes no port; the code alternative (error branch only) does.
describe('VerifyEmailPage', () => {
  it('reports success without an error param and offers no code form', async () => {
    await renderWithRouter(<VerifyEmailPage />, { path: '/verify-email' })
    screen.getByText('Email verified')
    expect(screen.getByRole('link', { name: 'Go to your workspaces' })).toBeDefined()
    expect(screen.queryByText('Verification failed')).toBeNull()
    expect(screen.queryByText('Or verify with a code')).toBeNull()
  })

  it('reports the opaque failure state with an error param', async () => {
    await renderWithRouter(<VerifyEmailPage error="INVALID_TOKEN" />, {
      path: '/verify-email'
    })
    screen.getByText('Verification failed')
    expect(screen.queryByText('Email verified')).toBeNull()
  })

  it('offers the code alternative on the failure branch only', async () => {
    const sendCode = vi.fn<SendEmailCode>().mockResolvedValue({ error: null })
    await renderWithRouter(
      <VerifyEmailPage error="INVALID_TOKEN" sendCode={sendCode} />,
      { path: '/verify-email' }
    )
    screen.getByText('Or verify with a code')
    expect(screen.getByLabelText('Email')).toBeDefined()
  })
})
