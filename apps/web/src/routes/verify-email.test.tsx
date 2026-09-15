import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import * as m from '@b2b-saas-starter/i18n/messages'
import { VerifyEmailPage } from './verify-email'

// The report half reads only the server-projected verification bit; the code
// alternative (error branch only) calls the client module directly and needs
// no double for these render-only cases.
describe('VerifyEmailPage', () => {
  it('keeps an anonymous visit neutral without an error param', async () => {
    await renderWithRouter(<VerifyEmailPage />, { path: '/verify-email' })
    screen.getByText(m.auth_design_email_verification_pending())
    expect(screen.queryByText(m.email_verified())).toBeNull()
    expect(screen.getByRole('link', { name: m.go_to_workspaces() })).toBeDefined()
    expect(screen.queryByText(m.email_verification_failed())).toBeNull()
    expect(screen.queryByText(m.verify_with_code())).toBeNull()
  })

  it('reports success only when the session confirms a verified email', async () => {
    await renderWithRouter(<VerifyEmailPage emailVerified />, {
      path: '/verify-email'
    })
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
