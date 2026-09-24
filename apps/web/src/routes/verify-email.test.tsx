import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vite-plus/test'
import { renderWithRouter } from '@/test/router-harness'
import * as m from '@b2b-saas-starter/i18n/messages'
import { VerifyEmailPage } from './verify-email'

describe('VerifyEmailPage', () => {
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
