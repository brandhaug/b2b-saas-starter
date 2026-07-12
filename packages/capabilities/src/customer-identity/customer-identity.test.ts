import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  CustomerIdentity,
  CustomerIdentityNotFound,
  CustomerIdentityRejected
} from './index.ts'
import { SeedCustomerIdentity } from './adapters.ts'

const now = '2026-07-12T10:00:00.000Z'
const expiresAt = '2026-07-12T11:00:00.000Z'
const principal = {
  provider: 'google' as const,
  providerSubject: 'google-customer-1',
  email: 'Customer@Example.test',
  emailVerified: true as const,
  displayName: 'Current Name'
}
const run = <A, E>(effect: Effect.Effect<A, E, CustomerIdentity>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SeedCustomerIdentity())))

describe('Customer Identity', () => {
  it('requires a live verified account session for merchant-scoped continuation', async () => {
    const result = await run(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        const session = yield* identity.establishSession({ principal, now, expiresAt })
        yield* identity.associateBooking({
          session,
          merchantId: 'mrc_one',
          bookingPartyId: 'bpt_one',
          confirmationRouteId: 'cnf_one',
          customerDetails: {
            name: 'Historical Name',
            email: 'old@example.test',
            phone: null
          },
          now
        })
        return {
          account: yield* identity.findAccount(session, now),
          ownership: yield* identity.listMerchantOwnership({
            session,
            merchantId: 'mrc_one',
            now
          }),
          continuation: yield* identity.recoverContinuation({
            session,
            merchantId: 'mrc_one',
            confirmationRouteId: 'cnf_one',
            now
          })
        }
      })
    )

    expect(result.account).toMatchObject({
      email: 'customer@example.test',
      provider: 'google'
    })
    expect(result.ownership[0]?.customerDetails).toEqual({
      name: 'Historical Name',
      email: 'old@example.test',
      phone: null
    })
    expect(result.continuation).toEqual({
      merchantId: 'mrc_one',
      bookingPartyId: 'bpt_one',
      confirmationRouteId: 'cnf_one'
    })
    expect(result.continuation).not.toHaveProperty('credential')
  })

  it('hides missing and cross-merchant ownership with the same failure', async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const identity = yield* CustomerIdentity
          const session = yield* identity.establishSession({
            principal,
            now,
            expiresAt
          })
          return yield* identity.recoverContinuation({
            session,
            merchantId: 'mrc_other',
            confirmationRouteId: 'cnf_missing',
            now
          })
        })
      )
    ).rejects.toBeInstanceOf(CustomerIdentityNotFound)
  })

  it('rejects forged and expired account sessions', async () => {
    const outcomes = await run(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        const session = yield* identity.establishSession({ principal, now, expiresAt })
        return yield* Effect.all({
          forged: Effect.result(
            identity.findAccount({ ...session, id: 'cus_forged' }, now)
          ),
          expired: Effect.result(identity.findAccount(session, expiresAt))
        })
      })
    )
    expect(outcomes.forged._tag).toBe('Failure')
    expect(outcomes.expired).toMatchObject({
      _tag: 'Failure',
      failure: expect.any(CustomerIdentityRejected)
    })
  })

  it('does not mutate historical Customer Details when the verified profile changes', async () => {
    const details = await run(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        const session = yield* identity.establishSession({ principal, now, expiresAt })
        yield* identity.associateBooking({
          session,
          merchantId: 'mrc_one',
          bookingPartyId: 'bpt_one',
          confirmationRouteId: 'cnf_one',
          customerDetails: {
            name: 'Historical Name',
            email: 'old@example.test',
            phone: null
          },
          now
        })
        yield* identity.establishSession({
          principal: {
            ...principal,
            email: 'changed@example.test',
            displayName: 'Changed'
          },
          now: '2026-07-12T10:05:00.000Z',
          expiresAt
        })
        return (yield* identity.listMerchantOwnership({
          session,
          merchantId: 'mrc_one',
          now
        }))[0]!.customerDetails
      })
    )
    expect(details).toEqual({
      name: 'Historical Name',
      email: 'old@example.test',
      phone: null
    })
  })
})
