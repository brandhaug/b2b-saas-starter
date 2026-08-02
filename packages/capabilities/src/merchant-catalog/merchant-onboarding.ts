import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  batch,
  Database,
  merchantMemberships,
  merchantSubscriptions,
  merchantSubscriptionTrialClaims,
  merchants,
  providers,
  publicBookingPages,
  user,
  type DbBatchError,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { createSoloTrialProjection } from '../subscriptions/merchant-subscriptions.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { isSupportedCurrency } from './currency.ts'
import type { BookingConfiguration } from './booking-configuration.ts'
import {
  cancellationPolicyDisclosure,
  DEFAULT_BOOKING_CANCELLATION_POLICY
} from '../booking/booking-cancellation.ts'

export const RESERVED_MERCHANT_SLUGS = [
  'admin',
  'api',
  'app',
  'auth',
  'booking',
  'help',
  'login',
  'merchant',
  'register',
  'settings',
  'sign-in',
  'sign-up',
  'support',
  'www'
] as const

export const MerchantOnboardingPayload = Schema.Struct({
  publicName: Schema.String.check(Schema.isMinLength(2), Schema.isMaxLength(80)),
  slug: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(63)),
  timezone: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  currency: Schema.String.check(Schema.isMinLength(3), Schema.isMaxLength(3)),
  billingInterval: Schema.optional(Schema.Literals(['monthly', 'annual'])),
  idempotencyKey: Schema.optional(Schema.String)
})
export type MerchantOnboardingPayload = typeof MerchantOnboardingPayload.Type

export const MerchantRecord = Schema.Struct({
  id: Schema.String,
  publicName: Schema.String,
  slug: Schema.String,
  timezone: Schema.String,
  currency: Schema.String,
  plan: Schema.Literal('solo'),
  ownerUserId: Schema.String,
  defaultProvider: Schema.Struct({
    id: Schema.String,
    displayName: Schema.String,
    status: Schema.Literals(['active', 'inactive'])
  }),
  publicBookingPage: Schema.Struct({
    id: Schema.String,
    status: Schema.Literals(['published', 'unpublished'])
  })
})
export type MerchantRecord = typeof MerchantRecord.Type

export const merchantPublicBookingUrl = (
  merchant: MerchantRecord,
  publicSiteOrigin: string
): string | undefined =>
  merchant.publicBookingPage.status === 'published'
    ? new URL(
        `/${encodeURIComponent(merchant.slug)}/booking`,
        publicSiteOrigin
      ).toString()
    : undefined

export class MerchantOnboardingDenied extends Schema.TaggedErrorClass<MerchantOnboardingDenied>()(
  'MerchantOnboardingDenied',
  {
    reason: Schema.Literals([
      'user_not_found',
      'email_verification_required',
      'already_owns_merchant',
      'invalid_public_name',
      'invalid_slug',
      'reserved_slug',
      'invalid_timezone',
      'invalid_currency',
      'slug_unavailable',
      'idempotency_conflict'
    ])
  }
) {}

export class MerchantNotFound extends Schema.TaggedErrorClass<MerchantNotFound>()(
  'MerchantNotFound',
  {}
) {}

export const MerchantOnboardingStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal('verification-required') }),
  Schema.Struct({ state: Schema.Literal('onboarding') }),
  Schema.Struct({ state: Schema.Literal('merchant'), merchant: MerchantRecord })
])
export type MerchantOnboardingStatus = typeof MerchantOnboardingStatus.Type

export type MerchantOnboardingShape = {
  readonly status: (
    userId: string
  ) => Effect.Effect<
    MerchantOnboardingStatus,
    MerchantOnboardingDenied | CapabilityUnavailable
  >
  readonly complete: (
    userId: string,
    input: MerchantOnboardingPayload
  ) => Effect.Effect<MerchantRecord, MerchantOnboardingDenied | CapabilityUnavailable>
}

export class MerchantOnboarding extends Context.Service<
  MerchantOnboarding,
  MerchantOnboardingShape
>()('@b2b-saas-starter/capabilities/MerchantOnboarding') {}

export type MerchantMembershipShape = {
  /** Resolves current ownership from persistence on every invocation. */
  readonly resolveForUser: (
    userId: string
  ) => Effect.Effect<MerchantRecord, MerchantNotFound | CapabilityUnavailable>
  /** Unknown and unauthorized slugs deliberately have the same result. */
  readonly resolveBySlug: (
    userId: string,
    slug: string
  ) => Effect.Effect<MerchantRecord, MerchantNotFound | CapabilityUnavailable>
}

export class MerchantMembership extends Context.Service<
  MerchantMembership,
  MerchantMembershipShape
>()('@b2b-saas-starter/capabilities/MerchantMembership') {}

export type SeedMerchantPerson = {
  readonly id: string
  readonly name: string
  readonly emailVerified: boolean
}

export type SeedMerchantCatalogStore = {
  readonly people: Map<string, SeedMerchantPerson>
  readonly merchants: Map<string, MerchantRecord>
  readonly onboardingRequests: Map<string, { fingerprint: string; merchantId: string }>
}

export const emptySeedMerchantCatalog = (
  people: readonly SeedMerchantPerson[]
): SeedMerchantCatalogStore => ({
  people: new Map(people.map((person) => [person.id, person])),
  merchants: new Map(),
  onboardingRequests: new Map()
})

const validTimezone = (timezone: string): boolean => {
  try {
    new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0)
    return timezone.includes('/') || timezone === 'UTC'
  } catch {
    return false
  }
}

const validateInput = (
  input: MerchantOnboardingPayload
): Effect.Effect<MerchantOnboardingPayload, MerchantOnboardingDenied> => {
  if (
    input.publicName !== input.publicName.trim() ||
    input.publicName.length < 2 ||
    input.publicName.length > 80
  ) {
    return Effect.fail(new MerchantOnboardingDenied({ reason: 'invalid_public_name' }))
  }
  if (
    input.slug.length < 3 ||
    input.slug.length > 63 ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.slug)
  ) {
    return Effect.fail(new MerchantOnboardingDenied({ reason: 'invalid_slug' }))
  }
  if ((RESERVED_MERCHANT_SLUGS as readonly string[]).includes(input.slug)) {
    return Effect.fail(new MerchantOnboardingDenied({ reason: 'reserved_slug' }))
  }
  if (!validTimezone(input.timezone)) {
    return Effect.fail(new MerchantOnboardingDenied({ reason: 'invalid_timezone' }))
  }
  if (!isSupportedCurrency(input.currency)) {
    return Effect.fail(new MerchantOnboardingDenied({ reason: 'invalid_currency' }))
  }
  return Effect.succeed(input)
}

const seedCreateRecord = (
  person: SeedMerchantPerson,
  input: MerchantOnboardingPayload
): MerchantRecord => ({
  id: `mer_${person.id}`,
  publicName: input.publicName,
  slug: input.slug,
  timezone: input.timezone,
  currency: input.currency,
  plan: 'solo',
  ownerUserId: person.id,
  defaultProvider: {
    id: `prv_${person.id}`,
    displayName: person.name,
    status: 'active'
  },
  publicBookingPage: {
    id: `pg_${person.id}`,
    status: 'unpublished'
  }
})

const findSeedForUser = (
  store: SeedMerchantCatalogStore,
  userId: string
): MerchantRecord | undefined =>
  [...store.merchants.values()].find((merchant) => merchant.ownerUserId === userId)

export const SeedMerchantOnboarding = (
  store: SeedMerchantCatalogStore
): Layer.Layer<MerchantOnboarding | MerchantMembership> => {
  const membership = Layer.succeed(MerchantMembership)({
    resolveForUser: (userId) => {
      const merchant = findSeedForUser(store, userId)
      return merchant ? Effect.succeed(merchant) : Effect.fail(new MerchantNotFound())
    },
    resolveBySlug: (userId, slug) => {
      const merchant = findSeedForUser(store, userId)
      return merchant?.slug === slug
        ? Effect.succeed(merchant)
        : Effect.fail(new MerchantNotFound())
    }
  } satisfies MerchantMembershipShape)

  const onboarding = Layer.succeed(MerchantOnboarding)({
    status: (userId) => {
      const person = store.people.get(userId)
      if (!person) {
        return Effect.fail(new MerchantOnboardingDenied({ reason: 'user_not_found' }))
      }
      if (!person.emailVerified) {
        return Effect.succeed({ state: 'verification-required' } as const)
      }
      const merchant = findSeedForUser(store, userId)
      return Effect.succeed(
        merchant
          ? ({ state: 'merchant', merchant } as const)
          : ({ state: 'onboarding' } as const)
      )
    },
    complete: (userId, input) =>
      Effect.gen(function* () {
        const person = store.people.get(userId)
        if (!person) {
          return yield* Effect.fail(
            new MerchantOnboardingDenied({ reason: 'user_not_found' })
          )
        }
        if (!person.emailVerified) {
          return yield* Effect.fail(
            new MerchantOnboardingDenied({ reason: 'email_verification_required' })
          )
        }
        const idempotencyKey = input.idempotencyKey ?? `merchant-onboarding:${userId}`
        const fingerprint = JSON.stringify({ userId, ...input })
        const replay = input.idempotencyKey
          ? store.onboardingRequests.get(idempotencyKey)
          : undefined
        if (replay) {
          if (replay.fingerprint !== fingerprint)
            return yield* Effect.fail(
              new MerchantOnboardingDenied({ reason: 'idempotency_conflict' })
            )
          const existing = findSeedForUser(store, userId)
          if (existing?.id === replay.merchantId) return existing
        }
        if (findSeedForUser(store, userId)) {
          return yield* Effect.fail(
            new MerchantOnboardingDenied({ reason: 'already_owns_merchant' })
          )
        }
        yield* validateInput(input)
        if (store.merchants.has(input.slug)) {
          return yield* Effect.fail(
            new MerchantOnboardingDenied({ reason: 'slug_unavailable' })
          )
        }
        const merchant = seedCreateRecord(person, input)
        // One mutation after all checks mirrors the Live adapter's one batch.
        store.merchants.set(input.slug, merchant)
        store.onboardingRequests.set(idempotencyKey, {
          fingerprint,
          merchantId: merchant.id
        })
        return merchant
      })
  } satisfies MerchantOnboardingShape)

  return Layer.merge(onboarding, membership)
}

type MerchantGraphRow = {
  readonly merchant: typeof merchants.$inferSelect
  readonly membership: typeof merchantMemberships.$inferSelect
  readonly provider: typeof providers.$inferSelect
  readonly page: typeof publicBookingPages.$inferSelect
}

const toMerchantRecord = (row: MerchantGraphRow): MerchantRecord => ({
  id: row.merchant.id,
  publicName: row.merchant.publicName,
  slug: row.merchant.slug,
  timezone: row.merchant.timezone,
  currency: row.merchant.currency,
  plan: row.merchant.plan,
  ownerUserId: row.membership.userId,
  defaultProvider: {
    id: row.provider.id,
    displayName: row.provider.displayName,
    status: row.provider.status
  },
  publicBookingPage: {
    id: row.page.id,
    status: row.page.status
  }
})

const merchantGraphQuery = (db: EffectDatabase) =>
  db
    .select({
      merchant: merchants,
      membership: merchantMemberships,
      provider: providers,
      page: publicBookingPages
    })
    .from(merchantMemberships)
    .innerJoin(merchants, eq(merchants.id, merchantMemberships.merchantId))
    .innerJoin(
      providers,
      and(eq(providers.merchantId, merchants.id), eq(providers.isDefault, true))
    )
    .innerJoin(publicBookingPages, eq(publicBookingPages.merchantId, merchants.id))

const liveMembership = (db: EffectDatabase): MerchantMembershipShape => ({
  resolveForUser: (userId) =>
    orUnavailable('merchant-membership')(
      merchantGraphQuery(db).where(eq(merchantMemberships.userId, userId)).limit(1)
    ).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(toMerchantRecord(rows[0]))
          : Effect.fail(new MerchantNotFound())
      )
    ),
  resolveBySlug: (userId, slug) =>
    orUnavailable('merchant-membership')(
      merchantGraphQuery(db)
        .where(and(eq(merchantMemberships.userId, userId), eq(merchants.slug, slug)))
        .limit(1)
    ).pipe(
      Effect.flatMap((rows) =>
        rows[0]
          ? Effect.succeed(toMerchantRecord(rows[0]))
          : Effect.fail(new MerchantNotFound())
      )
    )
})

const findLiveForUser = (db: EffectDatabase, userId: string) =>
  orUnavailable('merchant-membership')(
    merchantGraphQuery(db).where(eq(merchantMemberships.userId, userId)).limit(1)
  ).pipe(Effect.map((rows) => (rows[0] ? toMerchantRecord(rows[0]) : undefined)))

const mapBatchFailure = (
  error: DbBatchError
): MerchantOnboardingDenied | CapabilityUnavailable => {
  const reason = error.reason.toLowerCase()
  if (reason.includes('merchants.slug')) {
    return new MerchantOnboardingDenied({ reason: 'slug_unavailable' })
  }
  if (reason.includes('merchant_memberships.user_id')) {
    return new MerchantOnboardingDenied({ reason: 'already_owns_merchant' })
  }
  // Keep infrastructure failures behind the package's standard typed error.
  return new CapabilityUnavailable({
    capability: 'merchant-onboarding',
    reason: error.reason
  })
}

const LiveMerchantMembership: Layer.Layer<MerchantMembership, never, Database> =
  Layer.effect(
    MerchantMembership,
    Effect.gen(function* () {
      const db = yield* Database
      return liveMembership(db)
    })
  )

const LiveMerchantOnboardingService: Layer.Layer<MerchantOnboarding, never, Database> =
  Layer.effect(
    MerchantOnboarding,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        status: (userId: string) =>
          Effect.gen(function* () {
            const people = yield* orUnavailable('merchant-onboarding')(
              db.select().from(user).where(eq(user.id, userId)).limit(1)
            )
            const person = people[0]
            if (!person) {
              return yield* Effect.fail(
                new MerchantOnboardingDenied({ reason: 'user_not_found' })
              )
            }
            if (!person.emailVerified) {
              return { state: 'verification-required' } as const
            }
            const merchant = yield* findLiveForUser(db, userId)
            return merchant
              ? ({ state: 'merchant', merchant } as const)
              : ({ state: 'onboarding' } as const)
          }),
        complete: (userId: string, input: MerchantOnboardingPayload) =>
          Effect.gen(function* () {
            yield* validateInput(input)
            const people = yield* orUnavailable('merchant-onboarding')(
              db.select().from(user).where(eq(user.id, userId)).limit(1)
            )
            const person = people[0]
            if (!person) {
              return yield* Effect.fail(
                new MerchantOnboardingDenied({ reason: 'user_not_found' })
              )
            }
            if (!person.emailVerified) {
              return yield* Effect.fail(
                new MerchantOnboardingDenied({ reason: 'email_verification_required' })
              )
            }
            const idempotencyKey =
              input.idempotencyKey ?? `merchant-onboarding:${userId}`
            const requestFingerprint = JSON.stringify({ userId, ...input })
            const replay = input.idempotencyKey
              ? yield* orUnavailable('merchant-onboarding')(
                  db
                    .select()
                    .from(merchantSubscriptionTrialClaims)
                    .where(
                      eq(merchantSubscriptionTrialClaims.idempotencyKey, idempotencyKey)
                    )
                    .limit(1)
                )
              : []
            if (replay[0]) {
              if (replay[0].requestFingerprint !== requestFingerprint)
                return yield* Effect.fail(
                  new MerchantOnboardingDenied({ reason: 'idempotency_conflict' })
                )
              const replayed = yield* findLiveForUser(db, userId)
              if (replayed) return replayed
            }
            const existing = yield* findLiveForUser(db, userId)
            if (existing) {
              return yield* Effect.fail(
                new MerchantOnboardingDenied({ reason: 'already_owns_merchant' })
              )
            }
            const now = new Date().toISOString()
            const merchantId = newCapabilityId('mer')
            const providerId = newCapabilityId('prv')
            const pageId = newCapabilityId('pg')
            const trial = createSoloTrialProjection({
              merchantId,
              ownerUserId: userId,
              interval: input.billingInterval ?? 'monthly',
              now
            })
            yield* batch(db, [
              db.insert(merchants).values({
                id: merchantId,
                publicName: input.publicName,
                slug: input.slug,
                timezone: input.timezone,
                currency: input.currency,
                plan: 'solo',
                createdAt: now,
                updatedAt: now
              }),
              db.insert(merchantMemberships).values({
                merchantId,
                userId,
                role: 'owner',
                createdAt: now
              }),
              db.insert(providers).values({
                id: providerId,
                merchantId,
                linkedUserId: userId,
                displayName: person.name,
                status: 'active',
                isDefault: true,
                createdAt: now,
                updatedAt: now
              }),
              db.insert(publicBookingPages).values({
                id: pageId,
                merchantId,
                status: 'unpublished',
                createdAt: now,
                updatedAt: now
              }),
              db.insert(merchantSubscriptions).values({
                id: newCapabilityId('sub'),
                merchantId,
                ownerUserId: userId,
                plan: 'solo',
                interval: trial.interval,
                status: 'trialing',
                trialEndsAt: trial.trialEndsAt,
                createdAt: now,
                updatedAt: now
              }),
              db.insert(merchantSubscriptionTrialClaims).values({
                ownerUserId: userId,
                merchantId,
                idempotencyKey,
                requestFingerprint,
                claimedAt: now
              })
            ]).pipe(Effect.mapError(mapBatchFailure))
            return {
              id: merchantId,
              publicName: input.publicName,
              slug: input.slug,
              timezone: input.timezone,
              currency: input.currency,
              plan: 'solo',
              ownerUserId: userId,
              defaultProvider: {
                id: providerId,
                displayName: person.name,
                status: 'active'
              },
              publicBookingPage: { id: pageId, status: 'unpublished' }
            } as const
          })
      } satisfies MerchantOnboardingShape
    })
  )

export const LiveMerchantOnboarding: Layer.Layer<
  MerchantOnboarding | MerchantMembership,
  never,
  Database
> = Layer.merge(LiveMerchantOnboardingService, LiveMerchantMembership)

export type SeedBookingScenario = {
  readonly anchorTime: string
  readonly owner: SeedMerchantPerson
  readonly merchant: Omit<MerchantRecord, 'defaultProvider' | 'publicBookingPage'>
  readonly membership: {
    readonly merchantId: string
    readonly userId: string
    readonly role: 'owner'
  }
  readonly provider: MerchantRecord['defaultProvider'] & {
    readonly merchantId: string
    readonly linkedUserId: string
    readonly isDefault: true
    readonly bookingConfigJson: BookingConfiguration
  }
  readonly providers: ReadonlyArray<{
    readonly id: string
    readonly merchantId: string
    readonly linkedUserId: string | null
    readonly displayName: string
    readonly bookingConfigJson: BookingConfiguration
    readonly status: 'active' | 'inactive'
    readonly isDefault: boolean
  }>
  readonly services: ReadonlyArray<{
    readonly id: string
    readonly merchantId: string
    readonly name: string
    readonly description: string | null
    readonly category: string | null
    readonly priceMinor: number
    readonly currency: string
    readonly durationMinutes: number
    readonly status: 'active' | 'inactive'
  }>
  readonly checkoutPolicy: {
    readonly id: string
    readonly kind: 'checkout'
    readonly version: number
    readonly disclosure: string
    readonly effectiveAt: string
    readonly retiredAt: string | null
    readonly createdAt: string
  }
  readonly eligibility: ReadonlyArray<{
    readonly merchantId: string
    readonly providerId: string
    readonly serviceId: string
  }>
  readonly scheduleRules: ReadonlyArray<{
    readonly id: string
    readonly merchantId: string
    readonly providerId: string
    readonly weekday: number
    readonly startTime: string
    readonly endTime: string
  }>
  readonly appointments: ReadonlyArray<{
    readonly id: string
    readonly merchantId: string
    readonly providerId: string
    readonly status: 'scheduled' | 'completed' | 'cancelled' | 'no_show'
    readonly startsAt: string
    readonly endsAt: string
    readonly createdAt: string
    readonly customerDetails: {
      readonly name: string
      readonly email: string
      readonly phone: string | null
    }
  }>
  readonly confirmationAccess: ReadonlyArray<{
    readonly routeId: string
    readonly appointmentId: string
    readonly tokenVersion: number
    readonly signingKeyId: string
    readonly expiresAt: string
    readonly revokedAt: string | null
    readonly createdAt: string
  }>
  readonly publicBookingPage: MerchantRecord['publicBookingPage'] & {
    readonly merchantId: string
  }
}

/** The sole authored Booking fixture. The caller must supply its clock anchor. */
export const buildSeedBookingScenario = (anchorTime: string): SeedBookingScenario => {
  if (
    !Number.isFinite(Date.parse(anchorTime)) ||
    new Date(anchorTime).toISOString() !== anchorTime
  ) {
    throw new TypeError('Seed Booking Scenario anchorTime must be an ISO instant')
  }
  const owner = {
    id: 'usr_seed_merchant_owner',
    name: 'Mara Ionescu',
    emailVerified: true
  } as const
  const merchant = {
    id: 'mer_seed_booking_studio',
    publicName: 'Mara Booking Studio',
    slug: 'mara-booking-studio',
    timezone: 'Europe/Bucharest',
    currency: 'RON',
    plan: 'solo',
    ownerUserId: owner.id
  } as const
  const provider = {
    id: 'prv_seed_default',
    merchantId: merchant.id,
    linkedUserId: owner.id,
    displayName: owner.name,
    bookingConfigJson: { shortName: 'Mara I.' },
    status: 'active',
    isDefault: true
  } as const
  const services = [
    {
      id: 'svc_seed_signature_cut',
      merchantId: merchant.id,
      name: 'Signature Cut',
      description: 'Consultation, wash, and precision cut.',
      category: 'Hair',
      priceMinor: 9000,
      currency: merchant.currency,
      durationMinutes: 60,
      status: 'active'
    },
    {
      id: 'svc_seed_beard_detail',
      merchantId: merchant.id,
      name: 'Beard Detail',
      description: null,
      category: 'Grooming',
      priceMinor: 4500,
      currency: merchant.currency,
      durationMinutes: 30,
      status: 'active'
    },
    {
      id: 'svc_seed_skin_fade',
      merchantId: merchant.id,
      name: 'Skin Fade',
      description:
        'A clean skin fade blended through the sides and back, finished with detailed styling on top.',
      category: 'Hair',
      priceMinor: 8000,
      currency: merchant.currency,
      durationMinutes: 45,
      status: 'active'
    },
    {
      id: 'svc_seed_buzz_cut',
      merchantId: merchant.id,
      name: 'Buzz Cut',
      description: 'A precise clipper cut with clean edges and a polished finish.',
      category: 'Hair',
      priceMinor: 5500,
      currency: merchant.currency,
      durationMinutes: 30,
      status: 'active'
    },
    {
      id: 'svc_seed_hot_towel_shave',
      merchantId: merchant.id,
      name: 'Hot Towel Shave',
      description:
        'Traditional hot towel preparation, a close razor shave, and a soothing post-shave finish.',
      category: 'Grooming',
      priceMinor: 7000,
      currency: merchant.currency,
      durationMinutes: 45,
      status: 'active'
    },
    {
      id: 'svc_seed_hair_beard_combo',
      merchantId: merchant.id,
      name: 'Hair & Beard Combo',
      description:
        'A complete haircut and beard detail tailored together for a balanced, polished look.',
      category: 'Packages',
      priceMinor: 13000,
      currency: merchant.currency,
      durationMinutes: 90,
      status: 'active'
    },
    {
      id: 'svc_seed_premium_grooming',
      merchantId: merchant.id,
      name: 'Premium Grooming Package',
      description:
        'A personalized consultation followed by a precision haircut, beard shaping, hot towel treatment, wash, styling, and finishing care selected for your hair and skin.',
      category: 'Packages',
      priceMinor: 18000,
      currency: merchant.currency,
      durationMinutes: 120,
      status: 'active'
    },
    {
      id: 'svc_seed_style_consultation',
      merchantId: merchant.id,
      name: 'Style Consultation',
      description: 'A focused plan for a future appointment.',
      category: null,
      priceMinor: 2500,
      currency: merchant.currency,
      durationMinutes: 20,
      status: 'inactive'
    }
  ] as const
  type ServiceId = (typeof services)[number]['id']
  const maraServiceIds = [
    'svc_seed_signature_cut',
    'svc_seed_beard_detail',
    'svc_seed_skin_fade',
    'svc_seed_buzz_cut',
    'svc_seed_hot_towel_shave',
    'svc_seed_hair_beard_combo',
    'svc_seed_premium_grooming'
  ] as const satisfies ReadonlyArray<ServiceId>
  const instant = (offsetMinutes: number) =>
    new Date(Date.parse(anchorTime) + offsetMinutes * 60_000).toISOString()
  return {
    anchorTime,
    owner,
    merchant,
    membership: { merchantId: merchant.id, userId: owner.id, role: 'owner' },
    provider,
    providers: [provider],
    services,
    checkoutPolicy: {
      id: 'pol_seed_checkout',
      kind: 'checkout',
      version: 2,
      disclosure: cancellationPolicyDisclosure(DEFAULT_BOOKING_CANCELLATION_POLICY),
      effectiveAt: anchorTime,
      retiredAt: null,
      createdAt: anchorTime
    },
    eligibility: [
      ...maraServiceIds.map((serviceId) => ({
        merchantId: merchant.id,
        providerId: provider.id,
        serviceId
      }))
    ],
    scheduleRules: [
      ...[1, 2, 3, 4, 5].map((weekday) => ({
        id: `sch_seed_default_${weekday}`,
        merchantId: merchant.id,
        providerId: provider.id,
        weekday,
        startTime: '09:00',
        endTime: '17:00'
      }))
    ],
    appointments: [
      {
        id: 'apt_seed_past',
        merchantId: merchant.id,
        providerId: provider.id,
        status: 'completed',
        startsAt: instant(-24 * 60),
        endsAt: instant(-23 * 60),
        createdAt: anchorTime,
        customerDetails: {
          name: 'Past Customer',
          email: 'past@example.com',
          phone: null
        }
      },
      {
        id: 'apt_seed_future',
        merchantId: merchant.id,
        providerId: provider.id,
        status: 'scheduled',
        startsAt: instant(3 * 24 * 60),
        endsAt: instant(3 * 24 * 60 + 60),
        createdAt: anchorTime,
        customerDetails: {
          name: 'Future Customer',
          email: 'future@example.com',
          phone: null
        }
      }
    ],
    confirmationAccess: [
      {
        routeId: 'cnf_seed_future',
        appointmentId: 'apt_seed_future',
        tokenVersion: 1,
        signingKeyId: 'seed-current',
        expiresAt: instant(33 * 24 * 60 + 60),
        revokedAt: null,
        createdAt: anchorTime
      }
    ],
    publicBookingPage: {
      id: 'pg_seed_booking_studio',
      merchantId: merchant.id,
      status: 'published'
    }
  }
}

export const deriveIncompleteSeedBookingScenario = (
  scenario: SeedBookingScenario
): SeedBookingScenario => ({ ...scenario, services: [], eligibility: [] })
