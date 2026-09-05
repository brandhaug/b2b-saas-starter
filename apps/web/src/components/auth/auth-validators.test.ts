import { describe, expect, it } from 'vite-plus/test'
import { emailValidator, passwordValidator } from './auth-validators'

describe('passwordValidator', () => {
  it('mirrors the server policy: 12 minimum, 256 maximum', () => {
    expect(passwordValidator({ value: 'short' })).toBe(
      'Password must be at least 12 characters'
    )
    expect(passwordValidator({ value: 'a'.repeat(12) })).toBeUndefined()
    expect(passwordValidator({ value: 'a'.repeat(256) })).toBeUndefined()
    expect(passwordValidator({ value: 'a'.repeat(257) })).toBe(
      'Password must be at most 256 characters'
    )
  })
})

describe('emailValidator', () => {
  it('requires a shaped address', () => {
    expect(emailValidator({ value: '' })).toBe('Email is required')
    expect(emailValidator({ value: 'not-an-email' })).toBe('Enter a valid email')
    expect(emailValidator({ value: 'you@example.com' })).toBeUndefined()
  })
})
