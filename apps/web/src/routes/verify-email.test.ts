import { screen } from '@testing-library/dom'
import { describe, expect, it } from 'vite-plus/test'
import { renderAuth } from '@/components/native-test-harness'
import * as m from '@b2b-saas-starter/i18n/messages'

describe('VerifyEmailPage', () => {
  it('reports the opaque failure state with an error param', async () => {
    await renderAuth('verify-email', { search: '?error=INVALID_TOKEN' })
    screen.getByText(m.email_verification_failed())
    expect(screen.queryByText(m.email_verified())).toBeNull()
  })

  it('offers the code alternative on the failure branch only', async () => {
    await renderAuth('verify-email', { search: '?error=INVALID_TOKEN' })
    screen.getByText(m.verify_with_code())
    expect(screen.getByLabelText('Email')).toBeDefined()
  })
})
