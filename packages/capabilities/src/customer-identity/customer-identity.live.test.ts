import { Effect, Layer } from 'effect'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layerFromD1 } from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import { CustomerIdentity } from './index.ts'
import { LiveCustomerIdentity } from './adapters.ts'

let test: TestD1
const now = '2026-07-12T10:00:00.000Z'
const expiresAt = '2026-07-12T11:00:00.000Z'
const principal = {
  provider: 'apple' as const,
  providerSubject: 'apple-live-1',
  email: 'customer@example.test',
  emailVerified: true as const,
  displayName: 'Customer'
}

beforeAll(async () => {
  test = await provisionTestD1()
  const statements = [
    `INSERT INTO merchants (id, public_name, slug, timezone, currency, plan, created_at, updated_at) VALUES ('mrc_identity', 'Identity', 'identity', 'UTC', 'EUR', 'solo', '${now}', '${now}')`,
    `INSERT INTO brands (id, merchant_id, name, created_at, updated_at) VALUES ('brd_identity', 'mrc_identity', 'Identity', '${now}', '${now}')`,
    `INSERT INTO shops (id, brand_id, merchant_id, slug, public_name, timezone, currency, created_at, updated_at) VALUES ('shp_identity', 'brd_identity', 'mrc_identity', 'identity', 'Identity', 'UTC', 'EUR', '${now}', '${now}')`,
    `INSERT INTO booking_sessions (id, merchant_id, capability_hash, checkout_path, lifecycle, created_at, last_activity_at, idle_expires_at, absolute_expires_at) VALUES ('bsn_identity', 'mrc_identity', 'hash', 'pay_in_person', 'active', '${now}', '${now}', '${expiresAt}', '${expiresAt}')`,
    `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at) VALUES ('bpt_identity', 'bsn_identity', 'shp_identity', 'active', 'EUR', 'en', 1, '${now}', '${now}')`
  ]
  for (const statement of statements) await test.d1.prepare(statement).run()
}, 60_000)
afterAll(async () => test.dispose())

const layer = () => LiveCustomerIdentity.pipe(Layer.provide(layerFromD1(test.d1)))

describe('LiveCustomerIdentity', () => {
  it('persists verified sessions and merchant-isolated immutable associations', async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const identity = yield* CustomerIdentity
        const session = yield* identity.establishSession({ principal, now, expiresAt })
        yield* identity.associateBooking({
          session,
          merchantId: 'mrc_identity',
          bookingPartyId: 'bpt_identity',
          confirmationRouteId: 'cnf_identity',
          customerDetails: {
            name: 'Historical',
            email: 'historical@example.test',
            phone: null
          },
          now
        })
        return {
          continuation: yield* identity.recoverContinuation({
            session,
            merchantId: 'mrc_identity',
            confirmationRouteId: 'cnf_identity',
            now
          }),
          crossMerchant: yield* Effect.result(
            identity.recoverContinuation({
              session,
              merchantId: 'mrc_other',
              confirmationRouteId: 'cnf_identity',
              now
            })
          ),
          ownership: yield* identity.listMerchantOwnership({
            session,
            merchantId: 'mrc_identity',
            now
          })
        }
      }).pipe(Effect.provide(layer()))
    )

    expect(result.continuation).toEqual({
      merchantId: 'mrc_identity',
      bookingPartyId: 'bpt_identity',
      confirmationRouteId: 'cnf_identity'
    })
    expect(result.crossMerchant._tag).toBe('Failure')
    expect(result.ownership[0]?.customerDetails.name).toBe('Historical')
  })
})
