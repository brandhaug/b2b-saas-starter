import { describe, expect, it } from 'vitest'
import { merchantSessionPolicy } from '@b2b-saas-starter/auth'

describe('Merchant session policy', () => {
  it('uses the settled rolling lifetime and reauthentication window', () => {
    expect(merchantSessionPolicy).toEqual({
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      freshAge: 60 * 15,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        hostOnly: true
      }
    })
  })
})
