import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import { VerifyEmailPage } from './verify-email'

// The page only reports what the auth handler's redirect already decided, so
// no port to inject: the two outcomes are pure props. It renders `Link`s, so
// it needs the router harness.
describe('VerifyEmailPage', () => {
  it('reports success without an error param', async () => {
    await renderWithRouter(<VerifyEmailPage />, { path: '/verify-email' })
    screen.getByText('Email verified')
    expect(screen.getByRole('link', { name: 'Go to your workspaces' })).toBeDefined()
    expect(screen.queryByText('Verification failed')).toBeNull()
  })

  it('reports the opaque failure state with an error param', async () => {
    await renderWithRouter(<VerifyEmailPage error="INVALID_TOKEN" />, {
      path: '/verify-email'
    })
    screen.getByText('Verification failed')
    expect(screen.queryByText('Email verified')).toBeNull()
  })
})
