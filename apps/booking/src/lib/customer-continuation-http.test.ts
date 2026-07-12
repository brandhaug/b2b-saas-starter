import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import { recoverVerifiedContinuation } from './customer-continuation-http.ts'

const principal = {
  provider: 'google' as const,
  providerSubject: 'subject',
  email: 'customer@example.test',
  emailVerified: true as const,
  displayName: null
}

describe('verified continuation HTTP edge', () => {
  it('reissues an exact-path purpose-limited confirmation cookie after verified ownership', async () => {
    const response = await recoverVerifiedContinuation(
      new Request('https://booking.test/mara/booking/customer/continuation/cnf_one', {
        method: 'POST'
      }),
      { merchantId: 'mrc_one', merchantSlug: 'mara', routeId: 'cnf_one' },
      {
        principal: async () => principal,
        establishSession: () =>
          Effect.succeed({
            id: 'cus_one',
            customerAccountId: 'cua_one',
            expiresAt: '2026-08-12T00:00:00.000Z'
          }),
        recover: () =>
          Effect.succeed({
            merchantId: 'mrc_one',
            bookingPartyId: 'bpt_one',
            confirmationRouteId: 'cnf_one'
          }),
        reissue: () =>
          Effect.succeed({
            routeId: 'cnf_one',
            cookieCredential: 'purpose-limited-cookie'
          })
      }
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/mara/booking/confirmations/cnf_one')
    expect(response.headers.get('set-cookie')).toContain(
      'confirmation_cnf_one=purpose-limited-cookie'
    )
    expect(response.headers.get('set-cookie')).toContain(
      'Path=/mara/booking/confirmations/cnf_one'
    )
  })

  it('does not disclose whether ownership or continuation was missing', async () => {
    const response = await recoverVerifiedContinuation(
      new Request('https://booking.test/mara/booking/customer/continuation/cnf_other', {
        method: 'POST'
      }),
      { merchantId: 'mrc_one', merchantSlug: 'mara', routeId: 'cnf_other' },
      {
        principal: async () => null,
        establishSession: () => Effect.die('unreachable'),
        recover: () => Effect.die('unreachable'),
        reissue: () => Effect.die('unreachable')
      }
    )
    expect(response.status).toBe(404)
  })
})
