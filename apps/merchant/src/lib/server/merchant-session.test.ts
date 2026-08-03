import { describe, expect, it } from 'vitest'
import { isRedirect } from '@tanstack/react-router'
import { merchantSessionOrRedirect } from './merchant-navigation-session.ts'

describe('Merchant navigation session', () => {
  it('redirects an anonymous navigation to sign-in with its return path', () => {
    try {
      merchantSessionOrRedirect(null, '/appointments?date=2026-07-22')
      throw new Error('expected a redirect')
    } catch (error) {
      expect(isRedirect(error)).toBe(true)
      if (!isRedirect(error)) return
      expect(error.options).toMatchObject({
        to: '/sign-in',
        search: { redirect: '/appointments?date=2026-07-22' }
      })
    }
  })

  it('returns an authenticated navigation session unchanged', () => {
    const session = {
      session: { id: 'mss_owner' },
      user: { id: 'mem_owner' }
    }
    expect(merchantSessionOrRedirect(session, '/appointments')).toBe(session)
  })
})
