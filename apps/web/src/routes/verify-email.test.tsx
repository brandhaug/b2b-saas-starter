import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import * as m from '@b2b-saas-starter/i18n/messages'
import { VerifyEmailPage } from './verify-email'

// The page only reports what the auth handler's redirect already decided, so
// the report half takes no endpoint; the code alternative (error branch
// only) calls the client module directly and needs no double for these
// render-only cases.
describe('VerifyEmailPage', () => {
  it('reports success without an error param and offers no code form', async () => {
    await renderWithRouter(<VerifyEmailPage />, { path: '/verify-email' })
    screen.getByText(m.email_verified())
    expect(screen.getByRole('link', { name: m.go_to_workspaces() })).toBeDefined()
    expect(screen.queryByText(m.email_verification_failed())).toBeNull()
    expect(screen.queryByText(m.verify_with_code())).toBeNull()
  })

  it('reports the opaque failure state with an error param', async () => {
    await renderWithRouter(<VerifyEmailPage error="INVALID_TOKEN" />, {
      path: '/verify-email'
    })
    screen.getByText(m.email_verification_failed())
    expect(screen.queryByText(m.email_verified())).toBeNull()
  })

  it('offers the code alternative on the failure branch only', async () => {
    await renderWithRouter(<VerifyEmailPage error="INVALID_TOKEN" />, {
      path: '/verify-email'
    })
    screen.getByText(m.verify_with_code())
    expect(screen.getByLabelText('Email')).toBeDefined()
  })
})
