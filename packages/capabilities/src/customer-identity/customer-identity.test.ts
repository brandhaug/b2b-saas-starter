import { describe, expect, it } from 'vitest'
import { Effect } from 'effect'
import {
  CustomerIdentity,
  SeedCustomerIdentity,
  customerIdentityProviderStates
} from './index.ts'

const run = <A, E>(effect: Effect.Effect<A, E, CustomerIdentity>) =>
  Effect.runPromise(effect.pipe(Effect.provide(SeedCustomerIdentity())))

describe('Customer Identity', () => {
  it('links a verified platform account to merchant interaction facts without changing historical Customer Details', async () => {
    const historical = { name: 'Original Name', email: 'old@example.test', phone: null }
    const result = await run(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        const account = yield* identity.verifyAccount({
          subject: 'google:customer-1',
          email: 'new@example.test',
          displayName: 'New Name',
          now: '2026-07-12T10:00:00.000Z'
        })
        yield* identity.associateBooking({
          customerAccountId: account.id,
          merchantId: 'mrc_one',
          bookingPartyId: 'bpt_one',
          confirmationRouteId: 'cnf_one',
          confirmationCredential: 'purpose-limited-secret',
          customerDetails: historical,
          now: '2026-07-12T10:01:00.000Z'
        })
        const ownership = yield* identity.lookupMerchantOwnership({
          customerAccountId: account.id,
          merchantId: 'mrc_one'
        })
        return { account, ownership }
      })
    )

    expect(result.account.merchantId).toBeUndefined()
    expect(result.ownership).toMatchObject({
      bookingPartyIds: ['bpt_one'],
      customerDetailsSnapshots: [historical]
    })
  })

  it('does not disclose ownership facts across merchants', async () => {
    await expect(
      run(
        Effect.gen(function* () {
          const identity = yield* CustomerIdentity
          const account = yield* identity.verifyAccount({
            subject: 'apple:customer-1',
            email: 'customer@example.test',
            displayName: null,
            now: '2026-07-12T10:00:00.000Z'
          })
          return yield* identity.lookupMerchantOwnership({
            customerAccountId: account.id,
            merchantId: 'mrc_other'
          })
        })
      )
    ).rejects.toMatchObject({ _tag: 'CustomerAccountNotFound' })
  })

  it('recovers only the original purpose-limited confirmation credential', async () => {
    const recovered = await run(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        const account = yield* identity.verifyAccount({
          subject: 'google:customer-2',
          email: 'customer@example.test',
          displayName: null,
          now: '2026-07-12T10:00:00.000Z'
        })
        yield* identity.associateBooking({
          customerAccountId: account.id,
          merchantId: 'mrc_one',
          bookingPartyId: 'bpt_one',
          confirmationRouteId: 'cnf_one',
          confirmationCredential: 'purpose-limited-secret',
          customerDetails: {
            name: 'Customer',
            email: 'customer@example.test',
            phone: null
          },
          now: '2026-07-12T10:01:00.000Z'
        })
        return yield* identity.recoverConfirmation({
          customerAccountId: account.id,
          merchantId: 'mrc_one',
          confirmationRouteId: 'cnf_one'
        })
      })
    )
    expect(recovered).toEqual({
      routeId: 'cnf_one',
      credential: 'purpose-limited-secret'
    })
  })

  it('binds short-lived provider proof to one Booking Session and Provider', async () => {
    const result = await run(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        yield* identity.configureProviderPasscode({
          merchantId: 'mrc_one',
          providerId: 'prv_one',
          passcode: '2468'
        })
        const proof = yield* identity.verifyProviderPasscode({
          merchantId: 'mrc_one',
          bookingSessionId: 'bks_one',
          providerId: 'prv_one',
          passcode: '2468',
          now: '2026-07-12T10:00:00.000Z'
        })
        return yield* Effect.all({
          accepted: identity.authorizeProviderProof({
            proof: proof.proof,
            bookingSessionId: 'bks_one',
            providerId: 'prv_one',
            now: '2026-07-12T10:04:59.000Z'
          }),
          wrongSession: Effect.result(
            identity.authorizeProviderProof({
              proof: proof.proof,
              bookingSessionId: 'bks_two',
              providerId: 'prv_one',
              now: '2026-07-12T10:04:59.000Z'
            })
          ),
          expired: Effect.result(
            identity.authorizeProviderProof({
              proof: proof.proof,
              bookingSessionId: 'bks_one',
              providerId: 'prv_one',
              now: '2026-07-12T10:05:01.000Z'
            })
          )
        })
      })
    )
    expect(result.accepted).toBe(true)
    expect(result.wrongSession._tag).toBe('Failure')
    expect(result.expired._tag).toBe('Failure')
  })
})

describe('optional customer identity providers', () => {
  it('reports disabled, needs-configuration, and configured states independently', () => {
    expect(customerIdentityProviderStates({})).toEqual({
      google: 'disabled',
      apple: 'disabled'
    })
    expect(customerIdentityProviderStates({ googleEnabled: true })).toEqual({
      google: 'needs_configuration',
      apple: 'disabled'
    })
    expect(
      customerIdentityProviderStates({
        googleEnabled: true,
        googleClientId: 'id',
        googleClientSecret: 'secret',
        appleEnabled: true,
        appleClientId: 'id',
        appleClientSecret: 'secret'
      })
    ).toEqual({ google: 'configured', apple: 'configured' })
  })
})
