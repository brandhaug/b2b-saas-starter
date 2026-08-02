import { Effect, Layer } from 'effect'
import { count, eq } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  Database,
  layerFromD1,
  merchantMemberships,
  merchants,
  providers,
  publicBookingPages,
  user
} from '@b2b-saas-starter/db'
import { provisionTestD1, type TestD1 } from '@b2b-saas-starter/db/testing'
import {
  LiveMerchantOnboarding,
  MerchantMembership,
  MerchantOnboarding
} from './merchant-onboarding.ts'

let test: TestD1

const input = {
  publicName: 'Live Booking Studio',
  slug: 'live-booking-studio',
  timezone: 'Europe/Bucharest',
  currency: 'RON'
} as const

beforeAll(async () => {
  test = await provisionTestD1()
  await runDb(
    Effect.gen(function* () {
      const db = yield* Database
      yield* db.insert(user).values([
        {
          id: 'usr_live_verified',
          email: 'verified@merchant.test',
          name: 'Verified Owner',
          emailVerified: true
        },
        {
          id: 'usr_live_other',
          email: 'other@merchant.test',
          name: 'Other Owner',
          emailVerified: true
        },
        {
          id: 'usr_live_unverified',
          email: 'unverified@merchant.test',
          name: 'Unverified Owner',
          emailVerified: false
        },
        {
          id: 'usr_live_rollback',
          email: 'rollback@merchant.test',
          name: 'Rollback Owner',
          emailVerified: true
        }
      ])
    })
  )
}, 60_000)

afterAll(async () => {
  await test.dispose()
})

const runDb = <A, E>(effect: Effect.Effect<A, E, Database>) =>
  Effect.runPromise(Effect.provide(effect, layerFromD1(test.d1)))

const runMerchant = <A, E>(
  effect: Effect.Effect<A, E, MerchantOnboarding | MerchantMembership>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      LiveMerchantOnboarding.pipe(Layer.provide(layerFromD1(test.d1)))
    )
  )

describe('Live Merchant Onboarding', () => {
  it('rechecks verification and persists the minimum graph in one completion', async () => {
    const denied = await runMerchant(
      Effect.flatMap(MerchantOnboarding, (onboarding) =>
        Effect.flip(onboarding.complete('usr_live_unverified', input))
      )
    )
    expect(denied.reason).toBe('email_verification_required')

    const created = await runMerchant(
      Effect.flatMap(MerchantOnboarding, (onboarding) =>
        onboarding.complete('usr_live_verified', input)
      )
    )
    expect(created).toMatchObject({
      ownerUserId: 'usr_live_verified',
      defaultProvider: { displayName: 'Verified Owner', status: 'active' },
      publicBookingPage: { status: 'unpublished' }
    })

    const counts = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return {
          merchants: (yield* db.select({ value: count() }).from(merchants))[0]?.value,
          memberships: (yield* db
            .select({ value: count() })
            .from(merchantMemberships))[0]?.value,
          providers: (yield* db.select({ value: count() }).from(providers))[0]?.value,
          pages: (yield* db.select({ value: count() }).from(publicBookingPages))[0]
            ?.value
        }
      })
    )
    expect(counts).toEqual({ merchants: 1, memberships: 1, providers: 1, pages: 1 })
  })

  it('rolls back the entire graph when a slug is already owned', async () => {
    const denied = await runMerchant(
      Effect.flatMap(MerchantOnboarding, (onboarding) =>
        Effect.flip(onboarding.complete('usr_live_other', input))
      )
    )
    expect(denied.reason).toBe('slug_unavailable')

    const membershipRows = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db
          .select()
          .from(merchantMemberships)
          .where(eq(merchantMemberships.userId, 'usr_live_other'))
      })
    )
    expect(membershipRows).toEqual([])
  })

  it('rolls back earlier inserts when the final Public Booking Page insert fails', async () => {
    const rollbackInput = {
      ...input,
      publicName: 'Rollback Studio',
      slug: 'rollback-studio'
    }
    await test.d1
      .prepare(
        `CREATE TRIGGER fail_rollback_public_page
         BEFORE INSERT ON public_booking_pages
         WHEN NEW.merchant_id IN (SELECT id FROM merchants WHERE slug = 'rollback-studio')
         BEGIN SELECT RAISE(ABORT, 'forced final insert failure'); END`
      )
      .run()
    try {
      const failed = await Effect.runPromise(
        Effect.exit(
          Effect.provide(
            Effect.flatMap(MerchantOnboarding, (onboarding) =>
              onboarding.complete('usr_live_rollback', rollbackInput)
            ),
            LiveMerchantOnboarding.pipe(Layer.provide(layerFromD1(test.d1)))
          )
        )
      )
      expect(failed._tag).toBe('Failure')
    } finally {
      await test.d1.prepare('DROP TRIGGER fail_rollback_public_page').run()
    }

    const partialRows = await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        return {
          merchants: yield* db
            .select()
            .from(merchants)
            .where(eq(merchants.slug, rollbackInput.slug)),
          memberships: yield* db
            .select()
            .from(merchantMemberships)
            .where(eq(merchantMemberships.userId, 'usr_live_rollback')),
          providers: yield* db
            .select()
            .from(providers)
            .where(eq(providers.linkedUserId, 'usr_live_rollback'))
        }
      })
    )
    expect(partialRows).toEqual({ merchants: [], memberships: [], providers: [] })
  })

  it('resolves authorization from current membership and hides cross-Merchant access', async () => {
    const resolved = await runMerchant(
      Effect.flatMap(MerchantMembership, (membership) =>
        membership.resolveBySlug('usr_live_verified', input.slug)
      )
    )
    expect(resolved.slug).toBe(input.slug)

    const hidden = await runMerchant(
      Effect.flatMap(MerchantMembership, (membership) =>
        Effect.flip(membership.resolveBySlug('usr_live_other', input.slug))
      )
    )
    expect(hidden._tag).toBe('MerchantNotFound')

    await runDb(
      Effect.gen(function* () {
        const db = yield* Database
        yield* db
          .delete(publicBookingPages)
          .where(eq(publicBookingPages.merchantId, resolved.id))
      })
    )
    const staleClaimRejected = await runMerchant(
      Effect.flatMap(MerchantMembership, (membership) =>
        Effect.flip(membership.resolveForUser('usr_live_verified'))
      )
    )
    expect(staleClaimRejected._tag).toBe('MerchantNotFound')
  })
})
