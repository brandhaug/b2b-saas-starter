// oxlint-disable effect/noGlobals -- Fixed timestamp boundary cases for a pure policy function.
import { describe, expect, it } from 'vite-plus/test'
import { passwordTOTPCanPair, recoveryExpiresAt } from './assurance.ts'

const now = new Date('2026-01-01T00:00:00.000Z')

describe('session-bound assurance policy', () => {
  it('requires password evidence within five minutes for TOTP pairing', () => {
    expect(
      passwordTOTPCanPair({ passwordVerifiedAt: now }, new Date('2026-01-01T00:05:00Z'))
    ).toBe(true)
    expect(
      passwordTOTPCanPair({ passwordVerifiedAt: now }, new Date('2026-01-01T00:05:01Z'))
    ).toBe(false)
  })

  it('recovery expiry is bounded to one hour', () => {
    expect(recoveryExpiresAt(now)).toEqual(new Date('2026-01-01T01:00:00.000Z'))
  })
})
