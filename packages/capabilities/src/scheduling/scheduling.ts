import { Context, Effect, Layer, Schema } from 'effect'
import { and, eq } from 'drizzle-orm'
import {
  batch,
  Database,
  merchantSubscriptions,
  merchants,
  providerServiceEligibility,
  providers,
  publicBookingPages,
  promiseDatabaseFromEffect,
  scheduleRules,
  services,
  shopAddresses,
  shops,
  type EffectDatabase,
  type PromiseDrizzleDatabase
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
  closingTime: Schema.NullOr(Schema.String),
  teamMembers: Schema.Array(
    Schema.Struct({ id: Schema.String, displayName: Schema.String })
  ),
  location: Schema.NullOr(
    Schema.Struct({
      label: Schema.String,
      latitude: Schema.Number,
      longitude: Schema.Number
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
      'invalid_range',
      'invalid_override',
      'active_holds',
      'confirmation_required',
      'invalid_timezone'
    ])
  }
) {}

export class ScheduleRevisionConflict extends Schema.TaggedErrorClass<ScheduleRevisionConflict>()(
  'ScheduleRevisionConflict',
  { currentRevision: Schema.Number }
) {}

export const DateOverrideInput = Schema.Struct({
  localDate: Schema.String,
  kind: Schema.Literals(['closed', 'replacement_hours']),
  intervals: Schema.Array(
    Schema.Struct({ startTime: Schema.String, endTime: Schema.String })
  ),
  expectedRevision: Schema.Number
})
export type DateOverrideInput = typeof DateOverrideInput.Type

export const BlockedTimeInput = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String,
  reason: Schema.optional(Schema.String)
})
export type BlockedTimeInput = typeof BlockedTimeInput.Type

export type ScheduleControls = {
  readonly dateOverrides: readonly {
    readonly id: string
    readonly localDate: string
    readonly kind: 'closed' | 'replacement_hours'
    readonly intervals: readonly {
      readonly startTime: string
      readonly endTime: string
    }[]
    readonly revision: number
  }[]
  readonly blockedTimes: readonly {
    readonly id: string
    readonly startsAt: string
    readonly endsAt: string
    readonly reason: string | null
    readonly revision: number
  }[]
}

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
  readonly previewProviderRulesImpact: (
    providerId: string,
    rules: readonly ScheduleRuleInput[]
  ) => Effect.Effect<
    { readonly conflictingAppointmentIds: readonly string[] },
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly availability: (input: {
    readonly providerId: string
    readonly serviceId: string
    readonly from: string
    readonly days?: number
    readonly durationMinutes?: number
  }) => Effect.Effect<
    Availability,
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly previewAvailability: (input: {
    readonly from: string
    readonly days?: number
  }) => Effect.Effect<
    Availability | null,
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly listControls: () => Effect.Effect<
    ScheduleControls,
    CapabilityUnavailable,
    MerchantContext
  >
  readonly saveDateOverride: (
    input: DateOverrideInput
  ) => Effect.Effect<
    ScheduleControls['dateOverrides'][number],
    SchedulingValidationError | ScheduleRevisionConflict | CapabilityUnavailable,
    MerchantContext
  >
  readonly previewDateOverrideImpact: (
    input: DateOverrideInput
  ) => Effect.Effect<
    { readonly conflictingAppointmentIds: readonly string[] },
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly addBlockedTime: (input: BlockedTimeInput) => Effect.Effect<
    {
      readonly blockedTime: ScheduleControls['blockedTimes'][number]
      readonly conflictingAppointmentIds: readonly string[]
    },
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly previewBlockedTimeImpact: (
    input: BlockedTimeInput
  ) => Effect.Effect<
    { readonly conflictingAppointmentIds: readonly string[] },
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly previewTimezoneImpact: (timezone: string) => Effect.Effect<
    {
      readonly activeHold: boolean
      readonly conflictingAppointmentIds: readonly string[]
    },
    SchedulingValidationError | CapabilityUnavailable,
    MerchantContext
  >
  readonly changeTimezone: (input: {
    readonly timezone: string
    readonly confirmed: boolean
  }) => Effect.Effect<
    {
      readonly timezone: string
      readonly conflictingAppointmentIds: readonly string[]
    },
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

const localDate = (instant: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value
  return `${read('year')}-${read('month')}-${read('day')}`
}

const addCalendarDays = (date: string, days: number): string => {
  const value = new Date(`${date}T12:00:00.000Z`)
  value.setUTCDate(value.getUTCDate() + days)
  return value.toISOString().slice(0, 10)
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

const localParts = (instant: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'shortOffset'
  }).formatToParts(instant)
  const read = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${read('year')}-${read('month')}-${read('day')}`,
    time: `${read('hour')}:${read('minute')}`
  }
}

/** Returns zero instants for a DST gap and both instants for a DST fold. */
export const civilTimeInstants = (
  date: string,
  time: string,
  timezone: string
): readonly Date[] => {
  const nominal = Date.parse(`${date}T${time}:00.000Z`)
  if (!Number.isFinite(nominal)) return []
  const primary = zonedInstant(date, time, timezone)
  const matches = new Map<number, Date>()
  // Civil offset transitions are bounded and occur on quarter-hour boundaries
  // in the IANA database. Probe around the solved instant to find both sides
  // of a fold without scanning every possible UTC minute for every candidate.
  for (let delta = -180; delta <= 180; delta += 15) {
    const candidate = new Date(primary.getTime() + delta * 60_000)
    const local = localParts(candidate, timezone)
    if (local.date === date && local.time === time)
      matches.set(candidate.getTime(), candidate)
  }
  return [...matches.values()].sort((a, b) => a.getTime() - b.getTime())
}

export type AvailabilityControls = {
  readonly startTimeIntervalMinutes: 5 | 10 | 15 | 30
  readonly minimumNoticeMinutes: number
  readonly bookingHorizonDays: number
  readonly beforeBufferMinutes?: number
  readonly afterBufferMinutes?: number
  readonly exceptions?: readonly {
    readonly localDate: string
    readonly kind: 'closed' | 'replacement_hours'
    readonly intervals: readonly Pick<ScheduleRuleInput, 'startTime' | 'endTime'>[]
  }[]
  readonly blocked?: readonly OccupiedInterval[]
}

/** Civil-time availability with gaps/folds, overrides, windows, buffers and conflicts. */
export const deriveControlledAvailability = (input: {
  readonly rules: readonly ScheduleRule[]
  readonly timezone: string
  readonly serviceDurationMinutes: number
  readonly now: string
  readonly controls: AvailabilityControls
  readonly occupied?: readonly OccupiedInterval[]
}): Availability => {
  const now = new Date(input.now)
  const startDate = localDate(now, input.timezone)
  const latestDate = addCalendarDays(startDate, input.controls.bookingHorizonDays)
  const earliest = now.getTime() + input.controls.minimumNoticeMinutes * 60_000
  const before = input.controls.beforeBufferMinutes ?? 0
  const after = input.controls.afterBufferMinutes ?? 0
  const conflicts = [...(input.occupied ?? []), ...(input.controls.blocked ?? [])]
  const slots: Array<{ startsAt: string; endsAt: string }> = []
  for (let offset = 0; offset <= input.controls.bookingHorizonDays; offset++) {
    const date = addCalendarDays(startDate, offset)
    if (date > latestDate) break
    const exception = input.controls.exceptions?.find((item) => item.localDate === date)
    if (exception?.kind === 'closed') continue
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
    const intervals = exception
      ? exception.intervals
      : input.rules.filter((rule) => rule.weekday === weekday)
    for (const interval of intervals) {
      const [hour, minute] = interval.startTime.split(':').map(Number) as [
        number,
        number
      ]
      const [endHour, endMinute] = interval.endTime.split(':').map(Number) as [
        number,
        number
      ]
      const intervalStartMinute = hour * 60 + minute
      const intervalEndMinute = endHour * 60 + endMinute
      for (
        let localMinute = intervalStartMinute;
        localMinute + input.serviceDurationMinutes <= intervalEndMinute;
        localMinute += input.controls.startTimeIntervalMinutes
      ) {
        if (
          localMinute - before < intervalStartMinute ||
          localMinute + input.serviceDurationMinutes + after > intervalEndMinute
        )
          continue
        const time = `${String(Math.floor(localMinute / 60)).padStart(2, '0')}:${String(localMinute % 60).padStart(2, '0')}`
        for (const start of civilTimeInstants(date, time, input.timezone)) {
          if (start.getTime() < earliest) continue
          const end = new Date(start.getTime() + input.serviceDurationMinutes * 60_000)
          const occupiedStart = new Date(
            start.getTime() - before * 60_000
          ).toISOString()
          const occupiedEnd = new Date(end.getTime() + after * 60_000).toISOString()
          if (
            conflicts.some(
              (item) => occupiedStart < item.endsAt && occupiedEnd > item.startsAt
            )
          )
            continue
          slots.push({ startsAt: start.toISOString(), endsAt: end.toISOString() })
        }
      }
    }
  }
  slots.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return { timezone: input.timezone, slots }
}

export const deriveSlots = (
  rules: readonly ScheduleRule[],
  timezone: string,
  durationMinutes: number,
  from: string,
  days: number
): Availability => {
  const start = new Date(from)
  const startDate = localDate(start, timezone)
  const slots: Array<{ startsAt: string; endsAt: string }> = []
  for (let offset = 0; offset < days; offset++) {
    const date = addCalendarDays(startDate, offset)
    const weekday = new Date(`${date}T12:00:00.000Z`).getUTCDay()
    for (const rule of rules.filter((item) => item.weekday === weekday)) {
      let cursor = zonedInstant(date, rule.startTime, timezone)
      const end = zonedInstant(date, rule.endTime, timezone)
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

type OccupiedInterval = {
  readonly startsAt: string
  readonly endsAt: string
}

const withoutOccupiedSlots = (
  availability: Availability,
  occupied: readonly OccupiedInterval[]
): Availability => ({
  ...availability,
  slots: availability.slots.filter(
    (slot) =>
      !occupied.some(
        (appointment) =>
          slot.startsAt < appointment.endsAt && slot.endsAt > appointment.startsAt
      )
  )
})

const validDuration = (durationMinutes: number) =>
  Number.isInteger(durationMinutes) && durationMinutes >= 15 && durationMinutes <= 1440

const seedOccupiedIntervals = (
  store: SeedSchedulingStore,
  merchantId: string,
  providerId: string
) =>
  store.scenario.appointments.filter(
    (appointment) =>
      appointment.merchantId === merchantId &&
      appointment.providerId === providerId &&
      appointment.status !== 'cancelled'
  )

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
    previewProviderRulesImpact: () =>
      Effect.map(MerchantContext, () => ({ conflictingAppointmentIds: [] })),
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
        const provider = store.scenario.providers.find(
          (item) =>
            item.id === input.providerId &&
            item.merchantId === merchant.id &&
            item.status === 'active'
        )
        if (!service || !eligible || !provider)
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'service_not_found' })
          )
        const days = input.days ?? 14
        const durationMinutes = input.durationMinutes ?? service.durationMinutes
        if (
          !Number.isFinite(Date.parse(input.from)) ||
          days < 1 ||
          days > 31 ||
          !validDuration(durationMinutes)
        )
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'invalid_range' })
          )
        return withoutOccupiedSlots(
          deriveSlots(
            seedRulesFor(store, merchant.id, input.providerId),
            merchant.timezone,
            durationMinutes,
            input.from,
            days
          ),
          seedOccupiedIntervals(store, merchant.id, input.providerId)
        )
      }),
    previewAvailability: (input) =>
      Effect.gen(function* () {
        const merchant = yield* MerchantContext
        const service = store.scenario.services.find(
          (item) => item.merchantId === merchant.id && item.status === 'active'
        )
        const pair = service
          ? store.scenario.eligibility.find((item) => item.serviceId === service.id)
          : undefined
        const provider = pair
          ? store.scenario.providers.find(
              (item) =>
                item.id === pair.providerId &&
                item.merchantId === merchant.id &&
                item.status === 'active'
            )
          : undefined
        if (!service || !provider) return null
        const days = input.days ?? 14
        if (!Number.isFinite(Date.parse(input.from)) || days < 1 || days > 31)
          return yield* Effect.fail(
            new SchedulingValidationError({ reason: 'invalid_range' })
          )
        return withoutOccupiedSlots(
          deriveSlots(
            seedRulesFor(store, merchant.id, provider.id),
            merchant.timezone,
            service.durationMinutes,
            input.from,
            days
          ),
          seedOccupiedIntervals(store, merchant.id, provider.id)
        )
      }),
    listControls: () =>
      Effect.map(MerchantContext, () => ({ dateOverrides: [], blockedTimes: [] })),
    saveDateOverride: (input) =>
      Effect.map(MerchantContext, () => ({
        id: `sce_seed_${input.localDate}`,
        localDate: input.localDate,
        kind: input.kind,
        intervals: input.intervals,
        revision: input.expectedRevision + 1
      })),
    previewDateOverrideImpact: () =>
      Effect.map(MerchantContext, () => ({ conflictingAppointmentIds: [] })),
    addBlockedTime: (input) =>
      Effect.map(MerchantContext, () => ({
        blockedTime: {
          id: 'blk_seed',
          startsAt: input.startsAt,
          endsAt: input.endsAt,
          reason: input.reason ?? null,
          revision: 1
        },
        conflictingAppointmentIds: []
      })),
    previewBlockedTimeImpact: () =>
      Effect.map(MerchantContext, () => ({ conflictingAppointmentIds: [] })),
    previewTimezoneImpact: () =>
      Effect.map(MerchantContext, () => ({
        activeHold: false,
        conflictingAppointmentIds: []
      })),
    changeTimezone: (input) =>
      input.confirmed
        ? Effect.map(MerchantContext, () => ({
            timezone: input.timezone,
            conflictingAppointmentIds: []
          }))
        : Effect.fail(
            new SchedulingValidationError({ reason: 'confirmation_required' })
          )
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

const merchantBookingPath = (merchantSlug: string): string => `/${merchantSlug}/booking`

const seedPublicPage = (store: SeedSchedulingStore): PublicBookingPage => ({
  merchantSlug: store.scenario.merchant.slug,
  publicName: store.scenario.merchant.publicName,
  status: store.pageStatus,
  services: store.scenario.services
    .filter((service) => service.status === 'active')
    .map(({ merchantId: _, status: __, ...service }) => service),
  closingTime:
    store.scenario.scheduleRules
      .map((rule) => rule.endTime)
      .sort()
      .at(-1) ?? null,
  teamMembers: store.scenario.providers
    .filter((provider) => provider.status === 'active')
    .map((provider) => ({ id: provider.id, displayName: provider.displayName })),
  location: {
    label: 'Strada Lipscani 21, București',
    latitude: 44.4314,
    longitude: 26.1002
  },
  bookingPath: merchantBookingPath(store.scenario.merchant.slug)
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
      Effect.gen(function* () {
        yield* MerchantContext
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

const requireLiveProvider = (
  db: EffectDatabase,
  merchantId: string,
  providerId: string
) =>
  orUnavailable('scheduling')(
    db
      .select({ id: providers.id })
      .from(providers)
      .where(and(eq(providers.id, providerId), eq(providers.merchantId, merchantId)))
      .limit(1)
  ).pipe(
    Effect.flatMap((rows) =>
      rows[0]
        ? Effect.succeed(rows[0])
        : Effect.fail(new SchedulingValidationError({ reason: 'provider_not_found' }))
    )
  )

type LiveAvailabilityConfiguration = {
  booking_policies_json: string | null
  service_booking_config_json: string | null
  subscription_access: number
}

const liveControlledAvailability = (
  db: EffectDatabase,
  input: {
    merchantId: string
    providerId: string
    serviceId: string
    timezone: string
    durationMinutes: number
    from: string
    days?: number
  },
  rules: readonly ScheduleRule[]
) =>
  Effect.tryPromise({
    try: async () => {
      const raw = db.$client.config.db
      const configuration = await raw
        .prepare(
          `SELECT mas.booking_policies_json,
             json(s.booking_config_json) AS service_booking_config_json,
             CASE WHEN ms.status IN ('trialing','active','grace') THEN 1 ELSE 0 END AS subscription_access
           FROM services s
           LEFT JOIN merchant_activation_states mas ON mas.merchant_id=s.merchant_id
           LEFT JOIN merchant_subscriptions ms ON ms.merchant_id=s.merchant_id
           WHERE s.id=? AND s.merchant_id=? LIMIT 1`
        )
        .bind(input.serviceId, input.merchantId)
        .first<LiveAvailabilityConfiguration>()
      if (!configuration || configuration.subscription_access !== 1)
        return { timezone: input.timezone, slots: [] }
      const policies = configuration.booking_policies_json
        ? Schema.decodeUnknownOption(
            Schema.Struct({
              minimumNoticeMinutes: Schema.Number,
              bookingHorizonDays: Schema.Number,
              startTimeIntervalMinutes: Schema.Literals([5, 10, 15, 30])
            })
          )(JSON.parse(configuration.booking_policies_json))
        : { _tag: 'None' as const }
      const serviceConfiguration = configuration.service_booking_config_json
        ? (JSON.parse(configuration.service_booking_config_json) as Record<
            string,
            unknown
          >)
        : {}
      const exceptionRows = await raw
        .prepare(
          `SELECT local_date,kind,intervals_json FROM schedule_exceptions
           WHERE merchant_id=? ORDER BY local_date`
        )
        .bind(input.merchantId)
        .all<{
          local_date: string
          kind: 'closed' | 'replacement_hours'
          intervals_json: string
        }>()
      const conflictRows = await raw
        .prepare(
          `SELECT starts_at,ends_at FROM blocked_times WHERE merchant_id=? AND ends_at>?
           UNION ALL SELECT starts_at,ends_at FROM appointments
             WHERE merchant_id=? AND provider_id=? AND status='scheduled' AND ends_at>?
           UNION ALL SELECT starts_at,ends_at FROM time_slot_holds
             WHERE merchant_id=? AND provider_id=? AND expires_at>? AND ends_at>?`
        )
        .bind(
          input.merchantId,
          input.from,
          input.merchantId,
          input.providerId,
          input.from,
          input.merchantId,
          input.providerId,
          input.from,
          input.from
        )
        .all<{ starts_at: string; ends_at: string }>()
      const decodedPolicies = policies._tag === 'Some' ? policies.value : null
      const requestedDays = input.days ?? decodedPolicies?.bookingHorizonDays ?? 60
      const horizon = Math.min(requestedDays, decodedPolicies?.bookingHorizonDays ?? 60)
      return deriveControlledAvailability({
        rules,
        timezone: input.timezone,
        serviceDurationMinutes: input.durationMinutes,
        now: input.from,
        controls: {
          startTimeIntervalMinutes: decodedPolicies?.startTimeIntervalMinutes ?? 15,
          minimumNoticeMinutes: decodedPolicies?.minimumNoticeMinutes ?? 120,
          bookingHorizonDays: horizon,
          beforeBufferMinutes:
            typeof serviceConfiguration.beforeBufferMinutes === 'number'
              ? serviceConfiguration.beforeBufferMinutes
              : 0,
          afterBufferMinutes:
            typeof serviceConfiguration.afterBufferMinutes === 'number'
              ? serviceConfiguration.afterBufferMinutes
              : 0,
          exceptions: exceptionRows.results.map((row) => ({
            localDate: row.local_date,
            kind: row.kind,
            intervals:
              row.kind === 'closed'
                ? []
                : (JSON.parse(row.intervals_json) as Array<{
                    startTime: string
                    endTime: string
                  }>)
          })),
          blocked: conflictRows.results.map((row) => ({
            startsAt: row.starts_at,
            endsAt: row.ends_at
          }))
        }
      })
    },
    catch: (cause) =>
      new CapabilityUnavailable({
        capability: 'scheduling',
        reason: cause instanceof Error ? cause.message : String(cause)
      })
  })

export const LiveScheduling: Layer.Layer<Scheduling, never, Database> = Layer.effect(
  Scheduling,
  Effect.gen(function* () {
    const db = yield* Database
    return {
      listProviderRules: (providerId) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          yield* requireLiveProvider(db, merchant.id, providerId)
          return (yield* liveRules(db, merchant.id, providerId)).map(toRule)
        }),
      previewProviderRulesImpact: (providerId, rules) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (!validRules(rules))
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_rule' })
            )
          yield* requireLiveProvider(db, merchant.id, providerId)
          const rows = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `SELECT id,starts_at,ends_at FROM appointments WHERE merchant_id=?
               AND provider_id=? AND status='scheduled' AND starts_at>? ORDER BY starts_at`
                )
                .bind(merchant.id, providerId, new Date().toISOString())
                .all<{ id: string; starts_at: string; ends_at: string }>(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          return {
            conflictingAppointmentIds: rows.results
              .filter((row) => {
                const start = localParts(new Date(row.starts_at), merchant.timezone)
                const end = localParts(new Date(row.ends_at), merchant.timezone)
                const weekday = new Date(`${start.date}T12:00:00.000Z`).getUTCDay()
                return (
                  start.date !== end.date ||
                  !rules.some(
                    (rule) =>
                      rule.weekday === weekday &&
                      rule.startTime <= start.time &&
                      rule.endTime >= end.time
                  )
                )
              })
              .map((row) => row.id)
          }
        }),
      saveProviderRules: (providerId, rules) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (!validRules(rules))
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_rule' })
            )
          yield* requireLiveProvider(db, merchant.id, providerId)
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
              .innerJoin(
                providers,
                and(
                  eq(providers.id, input.providerId),
                  eq(providers.merchantId, merchant.id),
                  eq(providers.status, 'active')
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
          const durationMinutes =
            input.durationMinutes ?? rows[0].service.durationMinutes
          if (
            !Number.isFinite(Date.parse(input.from)) ||
            days < 1 ||
            days > 365 ||
            !validDuration(durationMinutes)
          )
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_range' })
            )
          return yield* liveControlledAvailability(
            db,
            {
              merchantId: merchant.id,
              providerId: input.providerId,
              serviceId: input.serviceId,
              timezone: merchant.timezone,
              durationMinutes,
              from: input.from,
              days
            },
            (yield* liveRules(db, merchant.id, input.providerId)).map(toRule)
          )
        }),
      previewAvailability: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const rows = yield* orUnavailable('scheduling')(
            db
              .select({
                serviceId: services.id,
                durationMinutes: services.durationMinutes,
                providerId: providers.id
              })
              .from(services)
              .innerJoin(
                providerServiceEligibility,
                eq(providerServiceEligibility.serviceId, services.id)
              )
              .innerJoin(
                providers,
                and(
                  eq(providers.id, providerServiceEligibility.providerId),
                  eq(providers.status, 'active')
                )
              )
              .where(
                and(eq(services.merchantId, merchant.id), eq(services.status, 'active'))
              )
              .limit(1)
          )
          const row = rows[0]
          if (!row) return null
          const days = input.days ?? 14
          if (!Number.isFinite(Date.parse(input.from)) || days < 1 || days > 365)
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_range' })
            )
          return yield* liveControlledAvailability(
            db,
            {
              merchantId: merchant.id,
              providerId: row.providerId,
              serviceId: row.serviceId,
              timezone: merchant.timezone,
              durationMinutes: row.durationMinutes,
              from: input.from,
              days
            },
            (yield* liveRules(db, merchant.id, row.providerId)).map(toRule)
          )
        }),
      listControls: () =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          return yield* Effect.tryPromise({
            try: async () => {
              const raw = db.$client.config.db
              const [overrides, blocked] = await Promise.all([
                raw
                  .prepare(
                    `SELECT id,local_date,kind,intervals_json,revision FROM schedule_exceptions
                     WHERE merchant_id=? ORDER BY local_date`
                  )
                  .bind(merchant.id)
                  .all<{
                    id: string
                    local_date: string
                    kind: 'closed' | 'replacement_hours'
                    intervals_json: string
                    revision: number
                  }>(),
                raw
                  .prepare(
                    `SELECT id,starts_at,ends_at,reason,revision FROM blocked_times
                     WHERE merchant_id=? ORDER BY starts_at`
                  )
                  .bind(merchant.id)
                  .all<{
                    id: string
                    starts_at: string
                    ends_at: string
                    reason: string | null
                    revision: number
                  }>()
              ])
              return {
                dateOverrides: overrides.results.map((row) => ({
                  id: row.id,
                  localDate: row.local_date,
                  kind: row.kind,
                  intervals: JSON.parse(row.intervals_json) as Array<{
                    startTime: string
                    endTime: string
                  }>,
                  revision: row.revision
                })),
                blockedTimes: blocked.results.map((row) => ({
                  id: row.id,
                  startsAt: row.starts_at,
                  endsAt: row.ends_at,
                  reason: row.reason,
                  revision: row.revision
                }))
              }
            },
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: cause instanceof Error ? cause.message : String(cause)
              })
          })
        }),
      saveDateOverride: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const validDate = /^\d{4}-\d{2}-\d{2}$/.test(input.localDate)
          const intervalsValid =
            input.kind === 'closed'
              ? input.intervals.length === 0
              : input.intervals.length > 0 &&
                validRules(input.intervals.map((item) => ({ ...item, weekday: 0 })))
          if (!validDate || !intervalsValid)
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_override' })
            )
          const now = new Date().toISOString()
          const id = newCapabilityId('sce')
          const result = yield* Effect.tryPromise({
            try: () =>
              input.expectedRevision === 0
                ? db.$client.config.db
                    .prepare(
                      `INSERT INTO schedule_exceptions
                     (id,merchant_id,local_date,kind,intervals_json,revision,created_at,updated_at)
                     VALUES (?,?,?,?,?,1,?,?) ON CONFLICT(merchant_id,local_date) DO NOTHING`
                    )
                    .bind(
                      id,
                      merchant.id,
                      input.localDate,
                      input.kind,
                      JSON.stringify(input.intervals),
                      now,
                      now
                    )
                    .run()
                : db.$client.config.db
                    .prepare(
                      `UPDATE schedule_exceptions SET kind=?,intervals_json=?,revision=revision+1,updated_at=?
                     WHERE merchant_id=? AND local_date=? AND revision=?`
                    )
                    .bind(
                      input.kind,
                      JSON.stringify(input.intervals),
                      now,
                      merchant.id,
                      input.localDate,
                      input.expectedRevision
                    )
                    .run(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: cause instanceof Error ? cause.message : String(cause)
              })
          })
          if ((result.meta.changes ?? 0) !== 1) {
            const current = yield* Effect.tryPromise({
              try: () =>
                db.$client.config.db
                  .prepare(
                    `SELECT revision FROM schedule_exceptions WHERE merchant_id=? AND local_date=?`
                  )
                  .bind(merchant.id, input.localDate)
                  .first<{ revision: number }>(),
              catch: (cause) =>
                new CapabilityUnavailable({
                  capability: 'scheduling',
                  reason: String(cause)
                })
            })
            return yield* Effect.fail(
              new ScheduleRevisionConflict({ currentRevision: current?.revision ?? 0 })
            )
          }
          return {
            id,
            localDate: input.localDate,
            kind: input.kind,
            intervals: input.intervals,
            revision: input.expectedRevision + 1
          }
        }),
      previewDateOverrideImpact: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const rows = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `SELECT id,starts_at,ends_at FROM appointments WHERE merchant_id=?
               AND status='scheduled' AND starts_at>? ORDER BY starts_at`
                )
                .bind(merchant.id, new Date().toISOString())
                .all<{ id: string; starts_at: string; ends_at: string }>(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          return {
            conflictingAppointmentIds: rows.results
              .filter((row) => {
                const start = localParts(new Date(row.starts_at), merchant.timezone)
                if (start.date !== input.localDate) return false
                if (input.kind === 'closed') return true
                const end = localParts(new Date(row.ends_at), merchant.timezone)
                return (
                  start.date !== end.date ||
                  !input.intervals.some(
                    (interval) =>
                      interval.startTime <= start.time && interval.endTime >= end.time
                  )
                )
              })
              .map((row) => row.id)
          }
        }),
      addBlockedTime: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          const starts = new Date(input.startsAt)
          const ends = new Date(input.endsAt)
          if (
            !Number.isFinite(starts.getTime()) ||
            !Number.isFinite(ends.getTime()) ||
            starts >= ends ||
            starts.getUTCMinutes() % 5 !== 0 ||
            ends.getUTCMinutes() % 5 !== 0
          )
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_range' })
            )
          const conflicts = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `SELECT id FROM appointments WHERE merchant_id=? AND status='scheduled'
               AND starts_at<? AND ends_at>? ORDER BY starts_at`
                )
                .bind(merchant.id, input.endsAt, input.startsAt)
                .all<{ id: string }>(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          const id = newCapabilityId('blk')
          const now = new Date().toISOString()
          yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `INSERT INTO blocked_times
               (id,merchant_id,starts_at,ends_at,reason,revision,created_at,updated_at)
               VALUES (?,?,?,?,?,1,?,?)`
                )
                .bind(
                  id,
                  merchant.id,
                  input.startsAt,
                  input.endsAt,
                  input.reason ?? null,
                  now,
                  now
                )
                .run(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          return {
            blockedTime: {
              id,
              startsAt: input.startsAt,
              endsAt: input.endsAt,
              reason: input.reason ?? null,
              revision: 1
            },
            conflictingAppointmentIds: conflicts.results.map((row) => row.id)
          }
        }),
      previewBlockedTimeImpact: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (
            !Number.isFinite(Date.parse(input.startsAt)) ||
            !Number.isFinite(Date.parse(input.endsAt)) ||
            input.startsAt >= input.endsAt
          )
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_range' })
            )
          const conflicts = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `SELECT id FROM appointments WHERE merchant_id=? AND status='scheduled'
                   AND starts_at<? AND ends_at>? ORDER BY starts_at`
                )
                .bind(merchant.id, input.endsAt, input.startsAt)
                .all<{ id: string }>(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          return { conflictingAppointmentIds: conflicts.results.map((row) => row.id) }
        }),
      previewTimezoneImpact: (timezone) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          try {
            new Intl.DateTimeFormat('en', { timeZone: timezone }).format()
          } catch {
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_timezone' })
            )
          }
          const now = new Date().toISOString()
          const [hold, conflicts] = yield* Effect.tryPromise({
            try: async () =>
              Promise.all([
                db.$client.config.db
                  .prepare(
                    `SELECT id FROM time_slot_holds WHERE merchant_id=? AND expires_at>? LIMIT 1`
                  )
                  .bind(merchant.id, now)
                  .first<{ id: string }>(),
                db.$client.config.db
                  .prepare(
                    `SELECT id FROM appointments WHERE merchant_id=? AND status='scheduled'
                     AND starts_at>? ORDER BY starts_at`
                  )
                  .bind(merchant.id, now)
                  .all<{ id: string }>()
              ]),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          return {
            activeHold: Boolean(hold),
            conflictingAppointmentIds: conflicts.results.map((row) => row.id)
          }
        }),
      changeTimezone: (input) =>
        Effect.gen(function* () {
          const merchant = yield* MerchantContext
          if (!input.confirmed)
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'confirmation_required' })
            )
          try {
            new Intl.DateTimeFormat('en', { timeZone: input.timezone }).format()
          } catch {
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'invalid_timezone' })
            )
          }
          const now = new Date().toISOString()
          const activeHold = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `SELECT id FROM time_slot_holds WHERE merchant_id=? AND expires_at>? LIMIT 1`
                )
                .bind(merchant.id, now)
                .first<{ id: string }>(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          if (activeHold)
            return yield* Effect.fail(
              new SchedulingValidationError({ reason: 'active_holds' })
            )
          const conflicts = yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db
                .prepare(
                  `SELECT id FROM appointments WHERE merchant_id=? AND status='scheduled' AND starts_at>? ORDER BY starts_at`
                )
                .bind(merchant.id, now)
                .all<{ id: string }>(),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          yield* Effect.tryPromise({
            try: () =>
              db.$client.config.db.batch([
                db.$client.config.db
                  .prepare(`UPDATE merchants SET timezone=?,updated_at=? WHERE id=?`)
                  .bind(input.timezone, now, merchant.id),
                db.$client.config.db
                  .prepare(
                    `UPDATE shops SET timezone=?,updated_at=? WHERE merchant_id=?`
                  )
                  .bind(input.timezone, now, merchant.id)
              ]),
            catch: (cause) =>
              new CapabilityUnavailable({
                capability: 'scheduling',
                reason: String(cause)
              })
          })
          return {
            timezone: input.timezone,
            conflictingAppointmentIds: conflicts.results.map((row) => row.id)
          }
        })
    }
  })
)

export const deriveBookingReadiness = (
  rows: readonly {
    readonly merchant: { readonly publicName: string; readonly slug: string } | null
    readonly serviceId: string | null
    readonly providerId: string | null
    readonly ruleId: string | null
  }[]
): BookingReadiness => {
  const merchant = rows[0]?.merchant
  const incomplete: ReadinessCheck[] = []
  if (!merchant?.publicName.trim()) incomplete.push('public-name')
  if (!merchant?.slug.trim()) incomplete.push('slug')
  if (!rows.some((row) => row.serviceId)) incomplete.push('active-service')
  if (!rows.some((row) => row.providerId)) incomplete.push('eligible-provider')
  if (!rows.some((row) => row.providerId && row.ruleId))
    incomplete.push('schedule-rules')
  return { ready: incomplete.length === 0, incomplete }
}

export const readBookingReadiness = async (
  db: PromiseDrizzleDatabase,
  merchantId: string
): Promise<BookingReadiness> =>
  deriveBookingReadiness(
    await db
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
  )

const liveReadiness = (db: EffectDatabase, merchantId: string) =>
  orUnavailable('booking-publication')(
    Effect.tryPromise({
      try: () => readBookingReadiness(promiseDatabaseFromEffect(db), merchantId),
      catch: (error) => error
    })
  )

const PublicShopAddress = Schema.Struct({
  street: Schema.optional(Schema.String),
  line1: Schema.optional(Schema.String),
  address1: Schema.optional(Schema.String),
  city: Schema.optional(Schema.String),
  locality: Schema.optional(Schema.String)
})

const publicLocationFromRow = (row: {
  readonly addressJson: string
  readonly latitude: string | null
  readonly longitude: string | null
}): PublicBookingPage['location'] => {
  const latitude = Number(row.latitude)
  const longitude = Number(row.longitude)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  try {
    const address = Schema.decodeUnknownSync(PublicShopAddress)(
      JSON.parse(row.addressJson)
    )
    const street = address.street ?? address.line1 ?? address.address1
    const city = address.city ?? address.locality
    const label = [street, city]
      .filter((part): part is string => typeof part === 'string' && part.length > 0)
      .join(', ')
    return label ? { label, latitude, longitude } : null
  } catch {
    return null
  }
}

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
                .select({
                  merchant: merchants,
                  page: publicBookingPages,
                  subscription: merchantSubscriptions
                })
                .from(merchants)
                .innerJoin(
                  publicBookingPages,
                  eq(publicBookingPages.merchantId, merchants.id)
                )
                .leftJoin(
                  merchantSubscriptions,
                  eq(merchantSubscriptions.merchantId, merchants.id)
                )
                .where(eq(merchants.slug, slug))
                .limit(1)
            )
            const row = merchantRows[0]
            if (!row)
              return yield* Effect.fail(
                new PublicBookingPageNotFound({ reason: 'unknown' })
              )
            if (
              row.page.status !== 'published' ||
              !row.subscription ||
              !['trialing', 'active', 'grace'].includes(row.subscription.status)
            )
              return yield* Effect.fail(
                new PublicBookingPageNotFound({ reason: 'unpublished' })
              )
            const readiness = yield* liveReadiness(db, row.merchant.id)
            if (!readiness.ready)
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
            const teamRows = yield* orUnavailable('booking-publication')(
              db
                .select({ id: providers.id, displayName: providers.displayName })
                .from(providers)
                .where(
                  and(
                    eq(providers.merchantId, row.merchant.id),
                    eq(providers.status, 'active')
                  )
                )
            )
            const closingRows = yield* orUnavailable('booking-publication')(
              db
                .select({ endTime: scheduleRules.endTime })
                .from(scheduleRules)
                .innerJoin(providers, eq(providers.id, scheduleRules.providerId))
                .where(
                  and(
                    eq(providers.merchantId, row.merchant.id),
                    eq(providers.status, 'active')
                  )
                )
            )
            const locationRows = yield* orUnavailable('booking-publication')(
              db
                .select({
                  addressJson: shopAddresses.addressJson,
                  latitude: shopAddresses.latitude,
                  longitude: shopAddresses.longitude
                })
                .from(shops)
                .innerJoin(shopAddresses, eq(shopAddresses.shopId, shops.id))
                .where(eq(shops.merchantId, row.merchant.id))
                .limit(1)
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
              closingTime:
                closingRows
                  .map((rule) => rule.endTime)
                  .sort()
                  .at(-1) ?? null,
              teamMembers: teamRows,
              location: locationRows[0] ? publicLocationFromRow(locationRows[0]) : null,
              bookingPath: merchantBookingPath(row.merchant.slug)
            }
          })
      }
    })
  )
