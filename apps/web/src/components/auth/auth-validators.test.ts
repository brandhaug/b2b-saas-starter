import { describe, expect, it } from 'vite-plus/test'
import { emailValidator, passwordValidator } from './auth-validators'
import { m } from '@b2b-saas-starter/i18n/messages'

describe('passwordValidator', () => {
  it('mirrors the server policy: 12 minimum, 256 maximum', () => {
    expect(passwordValidator({ value: 'short' })).toBe(m.public_auth_password_min())
    expect(passwordValidator({ value: 'a'.repeat(12) })).toBeUndefined()
    expect(passwordValidator({ value: 'a'.repeat(256) })).toBeUndefined()
    expect(passwordValidator({ value: 'a'.repeat(257) })).toBe(
      m.public_auth_password_max()
    )
  })
})

describe('emailValidator', () => {
  it('requires a shaped address', () => {
    expect(emailValidator({ value: '' })).toBe(m.public_auth_email_required())
    expect(emailValidator({ value: 'not-an-email' })).toBe(m.public_auth_valid_email())
    expect(emailValidator({ value: 'you@example.com' })).toBeUndefined()
  })
})
