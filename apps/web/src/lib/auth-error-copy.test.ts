import { describe, expect, it } from 'vite-plus/test'
import { m } from '@b2b-saas-starter/i18n/messages'
import { authErrorCopy, copyForAuthCode } from './auth-error-copy'

describe('auth error copy', () => {
  it('maps known Better Auth codes to localized copy', () => {
    expect(
      copyForAuthCode({ code: 'INVALID_PASSWORD', message: 'provider detail' })
    ).toBe(m.public_auth_invalid_password())
  })

  it('uses the caller fallback for unknown or missing codes', () => {
    const fallback = m.public_auth_verification_failed()
    expect(authErrorCopy({ code: 'NEW_SERVER_CODE' }, fallback)).toBe(fallback)
    expect(authErrorCopy({ message: 'provider detail' }, fallback)).toBe(fallback)
  })
})
