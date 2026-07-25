import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'
import {
  MerchantMembership,
  MerchantOnboarding,
  SeedMerchantOnboarding,
  buildSeedBookingScenario,
  deriveIncompleteSeedBookingScenario,
  deriveSoloSeedBookingScenario,
  emptySeedMerchantCatalog,
  merchantPublicBookingUrl
} from './merchant-onboarding.ts'

const verifiedOwner = {
  id: 'usr_verified',
  name: 'Ada Owner',
  emailVerified: true
} as const

const onboardingInput = {
  publicName: 'Ada Studio',
  slug: 'ada-studio',
  timezone: 'Europe/Bucharest',
  currency: 'EUR'
} as const

describe('Merchant public booking destination', () => {
  const scenario = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')
  const merchant = {
    ...scenario.merchant,
    defaultProvider: scenario.provider,
    publicBookingPage: scenario.publicBookingPage
  }

  it('exposes a published booking page on the public origin', () => {
    expect(
      merchantPublicBookingUrl(
        {
          ...merchant,
          publicBookingPage: { id: 'page_1', status: 'published' }
        },
        'https://book.example/'
      )
    ).toBe('https://book.example/mara-booking-studio/booking')
  })

  it('keeps an unpublished booking page unavailable', () => {
    expect(
      merchantPublicBookingUrl(
        {
          ...merchant,
          publicBookingPage: { id: 'page_1', status: 'unpublished' }
        },
        'https://book.example/'
      )
    ).toBeUndefined()
  })
})

const runSeed = <A, E>(
  effect: Effect.Effect<A, E, MerchantOnboarding | MerchantMembership>
) =>
  Effect.runPromise(
    Effect.provide(
      effect,
      SeedMerchantOnboarding(
        emptySeedMerchantCatalog([
          verifiedOwner,
          { id: 'usr_unverified', name: 'Una Verified', emailVerified: false },
          { id: 'usr_outsider', name: 'Other Owner', emailVerified: true }
        ])
      )
    )
  )

describe('Merchant Onboarding seed adapter', () => {
  it('keeps an unverified person outside the Merchant boundary', async () => {
    const result = await runSeed(
      Effect.gen(function* () {
        const onboarding = yield* MerchantOnboarding
        const status = yield* onboarding.status('usr_unverified')
        const denied = yield* Effect.flip(
          onboarding.complete('usr_unverified', onboardingInput)
        )
        return { status, denied }
      })
    )

    expect(result.status).toEqual({ state: 'verification-required' })
    expect(result.denied.reason).toBe('email_verification_required')
  })

  it('atomically creates the minimum Merchant graph once', async () => {
    const result = await runSeed(
      Effect.gen(function* () {
        const onboarding = yield* MerchantOnboarding
        const memberships = yield* MerchantMembership
        const before = yield* onboarding.status(verifiedOwner.id)
        const created = yield* onboarding.complete(verifiedOwner.id, onboardingInput)
        const after = yield* onboarding.status(verifiedOwner.id)
        const resolved = yield* memberships.resolveForUser(verifiedOwner.id)
        const duplicate = yield* Effect.flip(
          onboarding.complete(verifiedOwner.id, {
            ...onboardingInput,
            slug: 'another-studio'
          })
        )
        return { before, created, after, resolved, duplicate }
      })
    )

    expect(result.before).toEqual({ state: 'onboarding' })
    expect(result.created).toMatchObject({
      publicName: 'Ada Studio',
      slug: 'ada-studio',
      timezone: 'Europe/Bucharest',
      currency: 'EUR',
      ownerUserId: verifiedOwner.id,
      defaultProvider: { displayName: 'Ada Owner', status: 'active' },
      publicBookingPage: { status: 'unpublished' }
    })
    expect(result.after).toEqual({
      state: 'merchant',
      merchant: result.created
    })
    expect(result.resolved).toEqual(result.created)
    expect(result.duplicate.reason).toBe('already_owns_merchant')
  })

  it('rejects reserved slugs and does not leave partial records', async () => {
    const result = await runSeed(
      Effect.gen(function* () {
        const onboarding = yield* MerchantOnboarding
        const denied = yield* Effect.flip(
          onboarding.complete(verifiedOwner.id, {
            ...onboardingInput,
            slug: 'api'
          })
        )
        const status = yield* onboarding.status(verifiedOwner.id)
        return { denied, status }
      })
    )

    expect(result.denied.reason).toBe('reserved_slug')
    expect(result.status).toEqual({ state: 'onboarding' })
  })

  it('requires an IANA timezone and ISO 4217 currency', async () => {
    const result = await runSeed(
      Effect.gen(function* () {
        const onboarding = yield* MerchantOnboarding
        const timezone = yield* Effect.flip(
          onboarding.complete(verifiedOwner.id, {
            ...onboardingInput,
            timezone: 'Bucharest'
          })
        )
        const currency = yield* Effect.flip(
          onboarding.complete(verifiedOwner.id, {
            ...onboardingInput,
            currency: 'ZZZ'
          })
        )
        return { timezone, currency }
      })
    )

    expect(result.timezone.reason).toBe('invalid_timezone')
    expect(result.currency.reason).toBe('invalid_currency')
  })

  it('does not disclose another Merchant through a requested slug', async () => {
    const result = await runSeed(
      Effect.gen(function* () {
        const onboarding = yield* MerchantOnboarding
        const memberships = yield* MerchantMembership
        yield* onboarding.complete(verifiedOwner.id, onboardingInput)
        const unknown = yield* Effect.flip(
          memberships.resolveBySlug('usr_outsider', onboardingInput.slug)
        )
        return unknown
      })
    )

    expect(result._tag).toBe('MerchantNotFound')
  })
})

describe('Seed Booking Scenario builder', () => {
  it('uses an explicit anchor and deterministic IDs', () => {
    const first = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')
    const second = buildSeedBookingScenario('2026-07-10T09:30:00.000Z')

    expect(second).toEqual(first)
    expect(first.anchorTime).toBe('2026-07-10T09:30:00.000Z')
    expect(first.merchant.id).toBe('mer_seed_booking_studio')
    expect(first.membership.userId).not.toBe(first.provider.id)
    expect(first.publicBookingPage.status).toBe('published')
    expect(first.scheduleRules).toHaveLength(10)
    expect(first.providers).toHaveLength(2)
    expect(first.services.map((service) => service.name)).toEqual([
      'Signature Cut',
      'Beard Detail',
      'Skin Fade',
      'Buzz Cut',
      'Hot Towel Shave',
      'Hair & Beard Combo',
      'Premium Grooming Package',
      'Style Consultation'
    ])
    const activeServiceIds = first.services
      .filter((service) => service.status === 'active')
      .map((service) => service.id)
    expect(
      activeServiceIds.every((serviceId) =>
        first.eligibility.some((pair) => pair.serviceId === serviceId)
      )
    ).toBe(true)
    expect(
      Object.fromEntries(
        first.providers.map((provider) => [
          provider.id,
          first.eligibility
            .filter((pair) => pair.providerId === provider.id)
            .map((pair) => pair.serviceId)
        ])
      )
    ).toEqual({
      prv_seed_default: [
        'svc_seed_signature_cut',
        'svc_seed_beard_detail',
        'svc_seed_skin_fade',
        'svc_seed_buzz_cut',
        'svc_seed_hot_towel_shave',
        'svc_seed_hair_beard_combo',
        'svc_seed_premium_grooming'
      ],
      prv_seed_elena: [
        'svc_seed_signature_cut',
        'svc_seed_beard_detail',
        'svc_seed_skin_fade',
        'svc_seed_hot_towel_shave',
        'svc_seed_hair_beard_combo',
        'svc_seed_style_consultation'
      ]
    })
    expect(
      first.services.find((service) => service.id === 'svc_seed_premium_grooming')
        ?.description
    ).toContain('personalized consultation')
    expect(first.checkoutPolicy).toEqual({
      id: 'pol_seed_checkout',
      kind: 'checkout',
      version: 2,
      disclosure: 'Cancel up to 1 hour before the appointment.',
      effectiveAt: first.anchorTime,
      retiredAt: null,
      createdAt: first.anchorTime
    })
    expect(first.appointments).toEqual([
      expect.objectContaining({ id: 'apt_seed_past', status: 'completed' }),
      expect.objectContaining({ id: 'apt_seed_future', status: 'scheduled' })
    ])
    expect(new Set(first.eligibility.map((pair) => pair.providerId)).size).toBe(2)
    expect(deriveSoloSeedBookingScenario(first)).toMatchObject({
      merchant: { plan: 'solo' },
      providers: [{ isDefault: true }]
    })
    expect(deriveIncompleteSeedBookingScenario(first).services).toEqual([])
    expect(() => buildSeedBookingScenario('not-a-time')).toThrow()
  })
})
