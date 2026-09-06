import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { VerifyEmailPage } from './verify-email'

// The page only reports what the auth handler's redirect already decided, so
// the report half takes no endpoint; the code alternative (error branch
// only) calls the client module directly and needs no double for these
// render-only cases.
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
    await renderWithRouter(<VerifyEmailPage error="INVALID_TOKEN" />, {
      path: '/verify-email'
    })
    screen.getByText('Or verify with a code')
    expect(screen.getByLabelText('Email')).toBeDefined()
  })
})
