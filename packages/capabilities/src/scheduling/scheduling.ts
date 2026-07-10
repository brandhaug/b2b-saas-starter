import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  batch,
  Database,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  scheduleRules,
  services,
  type EffectDatabase
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import { MerchantContext } from '../merchant-catalog/merchant-context.ts'
import type { SeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'

export const ScheduleRuleInput = Schema.Struct({
  weekday: Schema.Number.check(
    Schema.isInt(),
    Schema.isBetween({ minimum: 0, maximum: 6 })
  ),
  startTime: Schema.String,
  endTime: Schema.String
})
export type ScheduleRuleInput = typeof ScheduleRuleInput.Type

export const ScheduleRule = Schema.Struct({
  id: Schema.String,
  providerId: Schema.String,
  ...ScheduleRuleInput.fields
})
export type ScheduleRule = typeof ScheduleRule.Type

export const Availability = Schema.Struct({
  timezone: Schema.String,
  slots: Schema.Array(Schema.Struct({ startsAt: Schema.String, endsAt: Schema.String }))
})
export type Availability = typeof Availability.Type

export const BookingReadiness = Schema.Struct({
  ready: Schema.Boolean,
  incomplete: Schema.Array(
    Schema.Literals([
      'public-name',
      'slug',
      'active-service',
      'eligible-provider',
      'schedule-rules'
    ])
  )
})
export type BookingReadiness = typeof BookingReadiness.Type
type ReadinessCheck = BookingReadiness['incomplete'][number]

export const PublicBookingPage = Schema.Struct({
  merchantSlug: Schema.String,
  publicName: Schema.String,
  status: Schema.Literals(['published', 'unpublished']),
  services: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.String,
      description: Schema.NullOr(Schema.String),
      category: Schema.NullOr(Schema.String),
      priceMinor: Schema.Number,
      currency: Schema.String,
      durationMinutes: Schema.Number
    })
  ),
  bookingPath: Schema.String
})
export type PublicBookingPage = typeof PublicBookingPage.Type

export class SchedulingValidationError extends Schema.TaggedErrorClass<SchedulingValidationError>()(
  'SchedulingValidationError',
  {
    reason: Schema.Literals([
      'provider_not_found',
      'service_not_found',
      'invalid_rule',
      'invalid_range'
    ])
  }
) {}

export class PublicationNotReady extends Schema.TaggedErrorClass<PublicationNotReady>()(
  'PublicationNotReady',
  { incomplete: Schema.Array(Schema.String) }
) {}

export class PublicBookingPageNotFound extends Schema.TaggedErrorClass<PublicBookingPageNotFound>()(
  'PublicBookingPageNotFound',
  { reason: Schema.Literals(['unknown', 'unpublished']) }
) {}

type SchedulingShape = {
  readonly listProviderRules: (
    providerId: string
  ) => Effect.Effect<
    readonly ScheduleRule[],
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly saveProviderRules: (
    providerId: string,
    rules: readonly ScheduleRuleInput[]
  ) => Effect.Effect<
    readonly ScheduleRule[],
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly availability: (input: {
    readonly providerId: string
    readonly serviceId: string
    readonly from: string
    readonly days?: number
  }) => Effect.Effect<
    Availability,
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
}

export class Scheduling extends Context.Service<Scheduling, SchedulingShape>()(
  '@b2b-saas-starter/capabilities/Scheduling'
) {}

type BookingPublicationShape = {
  readonly readiness: () => Effect.Effect<
    BookingReadiness,
    CapabilityUnavailable,
    MerchantContext
  >
  readonly current: () => Effect.Effect<
    {
      readonly status: 'published' | 'unpublished'
      readonly readiness: BookingReadiness
    },
    CapabilityUnavailable,
    MerchantContext
  >
  readonly publish: () => Effect.Effect<
    { readonly status: 'published' },
    PublicationNotReady | CapabilityUnavailable,
    MerchantContext
  >
  readonly unpublish: () => Effect.Effect<
    { readonly status: 'unpublished' },
    CapabilityUnavailable,
    MerchantContext
  >
  readonly resolvePublished: (
    slug: string
  ) => Effect.Effect<
    PublicBookingPage,
    PublicBookingPageNotFound | CapabilityUnavailable
  >
}

export class BookingPublication extends Context.Service<
  BookingPublication,
  BookingPublicationShape
>()('@b2b-saas-starter/capabilities/BookingPublication') {}

type StoredRule = ScheduleRule & { readonly merchantId: string }
export type SeedSchedulingStore = {
  readonly scenario: SeedBookingScenario
  readonly rules: Map<string, StoredRule>
  pageStatus: 'published' | 'unpublished'
}

export const emptySeedSchedulingStore = (
  scenario: SeedBookingScenario
): SeedSchedulingStore => ({
  scenario,
  rules: new Map((scenario.scheduleRules ?? []).map((rule) => [rule.id, rule])),
  pageStatus: scenario.publicBookingPage.status
})

const timePattern = /^([01]\d|2[0-3]):([0-5]\d)$/
const validRules = (rules: readonly ScheduleRuleInput[]) =>
  rules.every(
    (rule) =>
      timePattern.test(rule.startTime) &&
      timePattern.test(rule.endTime) &&
      rule.startTime < rule.endTime &&
      Number.isInteger(rule.weekday) &&
      rule.weekday >= 0 &&
      rule.weekday <= 6
  )

const localParts = (instant: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(read('weekday'))
  }
}

const zonedInstant = (date: string, time: string, timezone: string): Date => {
  const desired = Date.parse(`${date}T${time}:00.000Z`)
  let candidate = desired
  for (let index = 0; index < 3; index++) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    }).formatToParts(new Date(candidate))
    const read = (type: Intl.DateTimeFormatPartTypes) =>
      parts.find((part) => part.type === type)!.value
    const represented = Date.parse(
      `${read('year')}-${read('month')}-${read('day')}T${read('hour')}:${read('minute')}:00.000Z`
    )
    candidate += desired - represented
  }
  return new Date(candidate)
}

const deriveSlots = (
  rules: readonly ScheduleRule[],
  timezone: string,
  durationMinutes: number,
  from: string,
  days: number
): Availability => {
  const start = new Date(from)
  const slots: Array<{ startsAt: string; endsAt: string }> = []
  for (let offset = 0; offset < days; offset++) {
    const probe = new Date(start.getTime() + offset * 86_400_000)
    const local = localParts(probe, timezone)
    for (const rule of rules.filter((item) => item.weekday === local.weekday)) {
      let cursor = zonedInstant(local.date, rule.startTime, timezone)
      const end = zonedInstant(local.date, rule.endTime, timezone)
      while (cursor.getTime() + durationMinutes * 60_000 <= end.getTime()) {
        const endsAt = new Date(cursor.getTime() + durationMinutes * 60_000)
        if (cursor.getTime() >= start.getTime()) {
          slots.push({ startsAt: cursor.toISOString(), endsAt: endsAt.toISOString() })
        }
        cursor = endsAt
      }
    }
  }
  return { timezone, slots }
}

const seedRulesFor = (
  store: SeedSchedulingStore,
  merchantId: string,
  providerId: string
) =>
  [...store.rules.values()]
    .filter((rule) => rule.merchantId === merchantId && rule.providerId === providerId)
    .sort((a, b) => a.weekday - b.weekday || a.startTime.localeCompare(b.startTime))

export const SeedScheduling = (store: SeedSchedulingStore): Layer.Layer<Scheduling> =>
  Layer.succeed(Scheduling)({
    listProviderRules: (providerId) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        if (
          !store.scenario.providers.some(
            (provider) =>
              provider.merchantId === merchant.id && provider.id === providerId
          )
        )
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'provider_not_found' })
          )
        return seedRulesFor(store, merchant.id, providerId)
      }),
    saveProviderRules: (providerId, rules) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        if (
          !store.scenario.providers.some(
            (provider) =>
              provider.merchantId === merchant.id && provider.id === providerId
          )
        )
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'provider_not_found' })
          )
        if (!validRules(rules))
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'invalid_rule' })
          )
        for (const [id, rule] of store.rules)
          if (rule.merchantId === merchant.id && rule.providerId === providerId)
            store.rules.delete(id)
        rules.forEach((rule, index) =>
          store.rules.set(`sch_${providerId}_${index}`, {
            id: `sch_${providerId}_${index}`,
            merchantId: merchant.id,
            providerId,
            ...rule
          })
        )
        return seedRulesFor(store, merchant.id, providerId)
      }),
    availability: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const service = store.scenario.services.find(
          (item) =>
            item.id === input.serviceId &&
            item.merchantId === merchant.id &&
            item.status === 'active'
        )
        const eligible = store.scenario.eligibility.some(
          (pair) =>
            pair.providerId === input.providerId && pair.serviceId === input.serviceId
        )
        if (!service || !eligible)
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'service_not_found' })
          )
        const days = input.days ?? 14
        if (!Number.isFinite(Date.parse(input.from)) || days < 1 || days > 31)
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'invalid_range' })
          )
        return deriveSlots(
          seedRulesFor(store, merchant.id, input.providerId),
          merchant.timezone,
          service.durationMinutes,
          input.from,
          days
        )
      })
  })

const seedReadiness = (
  store: SeedSchedulingStore,
  merchantId: string
): BookingReadiness => {
  const scenario = store.scenario
  const activeServices = scenario.services.filter(
    (service) => service.merchantId === merchantId && service.status === 'active'
  )
  const eligibleProviderIds = new Set(
    scenario.eligibility
      .filter((pair) => activeServices.some((service) => service.id === pair.serviceId))
      .map((pair) => pair.providerId)
  )
  const eligible = scenario.providers.filter(
    (provider) =>
      provider.merchantId === merchantId &&
      provider.status === 'active' &&
      eligibleProviderIds.has(provider.id)
  )
  const incomplete: ReadinessCheck[] = []
  if (!scenario.merchant.publicName.trim()) incomplete.push('public-name')
  if (!scenario.merchant.slug.trim()) incomplete.push('slug')
  if (!activeServices.length) incomplete.push('active-service')
  if (!eligible.length) incomplete.push('eligible-provider')
  if (
    !eligible.some(
      (provider) => seedRulesFor(store, merchantId, provider.id).length > 0
    )
  )
    incomplete.push('schedule-rules')
  return { ready: incomplete.length === 0, incomplete }
}

const seedPublicPage = (store: SeedSchedulingStore): PublicBookingPage => ({
  merchantSlug: store.scenario.merchant.slug,
  publicName: store.scenario.merchant.publicName,
  status: store.pageStatus,
  services: store.scenario.services
    .filter((service) => service.status === 'active')
    .map(({ merchantId: _, status: __, ...service }) => service),
  bookingPath: `/${store.scenario.merchant.slug}/booking`
})

export const SeedBookingPublication = (
  store: SeedSchedulingStore
): Layer.Layer<BookingPublication> =>
  Layer.succeed(BookingPublication)({
    readiness: () =>
      Effect.map(MerchantContext, (merchant) => seedReadiness(store, merchant.id)),
    current: () =>
      Effect.map(MerchantContext, (merchant) => ({
        status: store.pageStatus,
        readiness: seedReadiness(store, merchant.id)
      })),
    publish: () =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const readiness = seedReadiness(store, merchant.id)
        if (!readiness.ready)
          return yield* Effect.fail(
            new PublicationNotReady({ incomplete: [...readiness.incomplete] })
          )
        store.pageStatus = 'published'
        return { status: 'published' as const }
      }),
    unpublish: () =>
      Effect.sync(() => {
        store.pageStatus = 'unpublished'
        return { status: 'unpublished' as const }
      }),
    resolvePublished: (slug) =>
      slug !== store.scenario.merchant.slug
        ? Effect.fail(new PublicBookingPageNotFound({ reason: 'unknown' }))
        : store.pageStatus !== 'published'
          ? Effect.fail(new PublicBookingPageNotFound({ reason: 'unpublished' }))
          : Effect.succeed(seedPublicPage(store))
  })

const liveRules = (db: EffectDatabase, merchantId: string, providerId: string) =>
  orUnavailable('scheduling')(
    db
      .select()
      .from(scheduleRules)
      .where(
        and(
          eq(scheduleRules.merchantId, merchantId),
          eq(scheduleRules.providerId, providerId)
        )
      )
  )
const toRule = (row: typeof scheduleRules.$inferSelect): ScheduleRule => ({
  id: row.id,
  providerId: row.providerId,
  weekday: row.weekday,
  startTime: row.startTime,
  endTime: row.endTime
})

export const LiveScheduling: Layer.Layer<Scheduling, never, Database> = Layer.effect(
  Scheduling,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      listProviderRules: (providerId) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const provider = yield* orUnavailable('scheduling')(
            db
              .select({ id: providers.id })
              .from(providers)
              .where(
                and(eq(providers.id, providerId), eq(providers.merchantId, merchant.id))
              )
              .limit(1)
          )
          if (!provider[0])
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'provider_not_found' })
            )
          return (yield* liveRules(db, merchant.id, providerId)).map(toRule)
        }),
      saveProviderRules: (providerId, rules) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (!validRules(rules))
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_rule' })
            )
          const provider = yield* orUnavailable('scheduling')(
            db
              .select({ id: providers.id })
              .from(providers)
              .where(
                and(eq(providers.id, providerId), eq(providers.merchantId, merchant.id))
              )
              .limit(1)
          )
          if (!provider[0])
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'provider_not_found' })
            )
          const now = new Date().toISOString()
          yield* batch(db, [
            db
              .delete(scheduleRules)
              .where(
                and(
                  eq(scheduleRules.merchantId, merchant.id),
                  eq(scheduleRules.providerId, providerId)
                )
              ),
            ...rules.map((rule) =>
              db.insert(scheduleRules).values({
                id: newCapabilityId('sch'),
                merchantId: merchant.id,
                providerId,
                ...rule,
                createdAt: now,
                updatedAt: now
              })
            )
          ]).pipe(
            Effect.mapError(
              (error) =>
                new CapabilityUnavailable({
                  capability: 'scheduling',
                  reason: error.reason
                })
            )
          )
          return (yield* liveRules(db, merchant.id, providerId)).map(toRule)
        }),
      availability: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const rows = yield* orUnavailable('scheduling')(
            db
              .select({ service: services })
              .from(services)
              .innerJoin(
                providerServiceEligibility,
                and(
                  eq(providerServiceEligibility.serviceId, services.id),
                  eq(providerServiceEligibility.providerId, input.providerId)
                )
              )
              .where(
                and(
                  eq(services.id, input.serviceId),
                  eq(services.merchantId, merchant.id),
                  eq(services.status, 'active')
                )
              )
              .limit(1)
          )
          if (!rows[0])
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'service_not_found' })
            )
          const days = input.days ?? 14
          if (!Number.isFinite(Date.parse(input.from)) || days < 1 || days > 31)
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_range' })
            )
          return deriveSlots(
            (yield* liveRules(db, merchant.id, input.providerId)).map(toRule),
            merchant.timezone,
            rows[0].service.durationMinutes,
            input.from,
            days
          )
        })
    }
  })
)

const liveReadiness = (db: EffectDatabase, merchantId: string) =>
  orUnavailable('booking-publication')(
    db
      .select({
        merchant: merchants,
        serviceId: services.id,
        providerId: providers.id,
        ruleId: scheduleRules.id
      })
      .from(merchants)
      .leftJoin(
        services,
        and(eq(services.merchantId, merchants.id), eq(services.status, 'active'))
      )
      .leftJoin(
        providerServiceEligibility,
        eq(providerServiceEligibility.serviceId, services.id)
      )
      .leftJoin(
        providers,
        and(
          eq(providers.id, providerServiceEligibility.providerId),
          eq(providers.status, 'active')
        )
      )
      .leftJoin(scheduleRules, eq(scheduleRules.providerId, providers.id))
      .where(eq(merchants.id, merchantId))
  ).pipe(
    Effect.map((rows) => {
      const merchant = rows[0]?.merchant
      const incomplete: ReadinessCheck[] = []
      if (!merchant?.publicName.trim()) incomplete.push('public-name')
      if (!merchant?.slug.trim()) incomplete.push('slug')
      if (!rows.some((row) => row.serviceId)) incomplete.push('active-service')
      if (!rows.some((row) => row.providerId)) incomplete.push('eligible-provider')
      if (!rows.some((row) => row.providerId && row.ruleId))
        incomplete.push('schedule-rules')
      return { ready: incomplete.length === 0, incomplete }
    })
  )

export const LiveBookingPublication: Layer.Layer<BookingPublication, never, Database> =
  Layer.effect(
    BookingPublication,
    Effect.gen(function* () {
      const db = yield* Database
      return {
        readiness: () =>
          Effect.flatMap(MerchantContext, (merchant) => liveReadiness(db, merchant.id)),
        current: () =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            const page = yield* orUnavailable('booking-publication')(
              db
                .select({ status: publicBookingPages.status })
                .from(publicBookingPages)
                .where(eq(publicBookingPages.merchantId, merchant.id))
                .limit(1)
            )
            return {
              status: page[0]?.status ?? 'unpublished',
              readiness: yield* liveReadiness(db, merchant.id)
            }
          }),
        publish: () =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            const readiness = yield* liveReadiness(db, merchant.id)
            if (!readiness.ready)
              return yield* Effect.fail(
                new PublicationNotReady({ incomplete: [...readiness.incomplete] })
              )
            yield* orUnavailable('booking-publication')(
              db
                .update(publicBookingPages)
                .set({ status: 'published', updatedAt: new Date().toISOString() })
                .where(eq(publicBookingPages.merchantId, merchant.id))
            )
            return { status: 'published' as const }
          }),
        unpublish: () =>
          Effect.gen(function* () {
            const merchant = yield* MerchantContext
            yield* orUnavailable('booking-publication')(
              db
                .update(publicBookingPages)
                .set({ status: 'unpublished', updatedAt: new Date().toISOString() })
                .where(eq(publicBookingPages.merchantId, merchant.id))
            )
            return { status: 'unpublished' as const }
          }),
        resolvePublished: (slug) =>
          Effect.gen(function* () {
            const merchantRows = yield* orUnavailable('booking-publication')(
              db
                .select({ merchant: merchants, page: publicBookingPages })
                .from(merchants)
                .innerJoin(
                  publicBookingPages,
                  eq(publicBookingPages.merchantId, merchants.id)
                )
                .where(eq(merchants.slug, slug))
                .limit(1)
            )
            const row = merchantRows[0]
            if (!row)
              return yield* Effect.fail(
                new PublicBookingPageNotFound({ reason: 'unknown' })
              )
            if (row.page.status !== 'published')
              return yield* Effect.fail(
                new PublicBookingPageNotFound({ reason: 'unpublished' })
              )
            const serviceRows = yield* orUnavailable('booking-publication')(
              db
                .select()
                .from(services)
                .where(
                  and(
                    eq(services.merchantId, row.merchant.id),
                    eq(services.status, 'active')
                  )
                )
            )
            return {
              merchantSlug: row.merchant.slug,
              publicName: row.merchant.publicName,
              status: 'published' as const,
              services: serviceRows.map((service) => ({
                id: service.id,
                name: service.name,
                description: service.description,
                category: service.category,
                priceMinor: service.priceMinor,
                currency: service.currency,
                durationMinutes: service.durationMinutes
              })),
              bookingPath: `/${row.merchant.slug}/booking`
            }
          })
      }
    })
  )
