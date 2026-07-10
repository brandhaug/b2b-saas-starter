import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, eq, gt } from 'drizzle-orm'
import {
  appointments,
  batchQueries,
  bookingSessionAdditionalServices,
  bookingSessions,
  Database,
  merchants,
  providers,
  providerServiceEligibility,
  scheduleRules,
  services,
  timeSlotHolds,
  type CompiledBatchQuery,
  type StoredBookingQuote
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { SeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'
import { deriveSlots, type ScheduleRule } from '../scheduling/scheduling.ts'
import type {
  ProviderPreference,
  SeedBookingSelectionStore
} from './booking-selection.ts'
import type { BookingSession } from './booking-sessions.ts'

export const BookingTimeSlot = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String
})
export type BookingTimeSlot = typeof BookingTimeSlot.Type

export const BookingQuote = Schema.Struct({
  startsAt: Schema.String,
  endsAt: Schema.String,
  providerPreference: Schema.Union([
    Schema.Struct({ kind: Schema.Literal('any') }),
    Schema.Struct({ kind: Schema.Literal('specific'), providerId: Schema.String })
  ]),
  assignedProvider: Schema.Struct({ id: Schema.String, displayName: Schema.String }),
  services: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      role: Schema.Literals(['primary', 'additional']),
      name: Schema.String,
      durationMinutes: Schema.Number,
      priceMinor: Schema.Number,
      currency: Schema.String
    })
  ),
  durationMinutes: Schema.Number,
  currency: Schema.String,
  totalMinor: Schema.Number
})
export type BookingQuote = typeof BookingQuote.Type

export const TimeSlotHold = Schema.Struct({
  id: Schema.String,
  bookingSessionId: Schema.String,
  createdAt: Schema.String,
  expiresAt: Schema.String,
  quote: BookingQuote
})
export type TimeSlotHold = typeof TimeSlotHold.Type

export const BookingAvailability = Schema.Struct({
  timezone: Schema.String,
  slots: Schema.Array(BookingTimeSlot),
  hold: Schema.NullOr(TimeSlotHold)
})
export type BookingAvailability = typeof BookingAvailability.Type

export const HoldTimeSlotInput = Schema.Struct({ startsAt: Schema.String })
export type HoldTimeSlotInput = typeof HoldTimeSlotInput.Type

export const BookingSchedulingRecovery = Schema.Struct({
  kind: Schema.Literals(['slot_lost', 'not_ready']),
  message: Schema.String
})
export type BookingSchedulingRecovery = typeof BookingSchedulingRecovery.Type

export class BookingSchedulingRejected extends Schema.TaggedErrorClass<BookingSchedulingRejected>()(
  'BookingSchedulingRejected',
  {
    reason: Schema.Literals(['not_ready', 'invalid_range', 'slot_lost']),
    message: Schema.String
  }
) {}

type Failure = BookingSchedulingRejected | CapabilityUnavailable
export type BookingSchedulingShape = {
  readonly availability: (
    session: BookingSession,
    input: { readonly from: string; readonly days?: number; readonly now: string }
  ) => Effect.Effect<BookingAvailability, Failure>
  readonly hold: (
    session: BookingSession,
    input: { readonly startsAt: string; readonly now: string }
  ) => Effect.Effect<TimeSlotHold, Failure>
  readonly currentHold: (
    session: BookingSession,
    input: { readonly now: string }
  ) => Effect.Effect<TimeSlotHold | null, CapabilityUnavailable>
}

export class BookingScheduling extends Context.Service<
  BookingScheduling,
  BookingSchedulingShape
>()('@b2b-saas-starter/capabilities/BookingScheduling') {}

type SchedulingProvider = {
  readonly id: string
  readonly displayName: string
  readonly status: 'active' | 'inactive'
}
type SchedulingService = {
  readonly id: string
  readonly name: string
  readonly priceMinor: number
  readonly currency: string
  readonly durationMinutes: number
  readonly status: 'active' | 'inactive'
}
type Conflict = {
  readonly providerId: string
  readonly startsAt: string
  readonly endsAt: string
  readonly bookingSessionId?: string
  readonly expiresAt?: string
}
type SchedulingInputs = {
  readonly merchantId: string
  readonly timezone: string
  readonly preference: ProviderPreference
  readonly primaryServiceId: string
  readonly additionalServiceIds: readonly string[]
  readonly providers: readonly SchedulingProvider[]
  readonly services: readonly SchedulingService[]
  readonly eligibility: ReadonlySet<string>
  readonly rules: readonly ScheduleRule[]
  readonly appointments: readonly Conflict[]
  readonly holds: readonly Conflict[]
}

type StoredHold = TimeSlotHold & {
  readonly merchantId: string
  readonly providerId: string
  readonly startsAt: string
  readonly endsAt: string
}
export type SeedBookingSchedulingStore = {
  readonly scenario: SeedBookingScenario
  readonly selections: SeedBookingSelectionStore
  readonly holds: Map<string, StoredHold>
}

export const emptySeedBookingSchedulingStore = (
  scenario: SeedBookingScenario,
  selections: SeedBookingSelectionStore
): SeedBookingSchedulingStore => ({ scenario, selections, holds: new Map() })

const eligibilityKey = (providerId: string, serviceId: string) =>
  `${providerId}\0${serviceId}`
const overlap = (left: BookingTimeSlot, right: BookingTimeSlot) =>
  left.startsAt < right.endsAt && left.endsAt > right.startsAt
const failure = (reason: BookingSchedulingRejected['reason']) =>
  new BookingSchedulingRejected({
    reason,
    message:
      reason === 'slot_lost'
        ? 'That time was just booked'
        : 'Booking time could not be accepted'
  })
const validRange = (from: string, days: number) =>
  Number.isFinite(Date.parse(from)) && Number.isInteger(days) && days >= 1 && days <= 31
const toPublicHold = (hold: StoredHold): TimeSlotHold => ({
  id: hold.id,
  bookingSessionId: hold.bookingSessionId,
  createdAt: hold.createdAt,
  expiresAt: hold.expiresAt,
  quote: hold.quote
})

const selectedServices = (input: SchedulingInputs): readonly SchedulingService[] => {
  const ids = [input.primaryServiceId, ...input.additionalServiceIds]
  const selected = ids.map((id) => input.services.find((service) => service.id === id))
  if (
    selected.some((service) => !service || service.status !== 'active') ||
    new Set(ids).size !== ids.length ||
    selected.some(
      (service) => !service || service.priceMinor <= 0 || service.durationMinutes <= 0
    ) ||
    new Set(selected.map((service) => service?.currency)).size !== 1
  ) {
    return []
  }
  return selected as readonly SchedulingService[]
}

const eligibleProviders = (
  input: SchedulingInputs,
  selected: readonly SchedulingService[]
): readonly SchedulingProvider[] => {
  const providerIds =
    input.preference.kind === 'specific'
      ? [input.preference.providerId]
      : input.providers.map((provider) => provider.id)
  return input.providers
    .filter(
      (provider) =>
        provider.status === 'active' &&
        providerIds.includes(provider.id) &&
        selected.every((service) =>
          input.eligibility.has(eligibilityKey(provider.id, service.id))
        )
    )
    .sort((left, right) => left.id.localeCompare(right.id))
}

const providerSlots = (
  input: SchedulingInputs,
  providerId: string,
  durationMinutes: number,
  from: string,
  days: number,
  now: string,
  sessionId: string
): readonly BookingTimeSlot[] => {
  const conflicts = [
    ...input.appointments,
    ...input.holds.filter(
      (hold) => hold.expiresAt! > now && hold.bookingSessionId !== sessionId
    )
  ].filter((conflict) => conflict.providerId === providerId)
  return deriveSlots(
    input.rules.filter((rule) => rule.providerId === providerId),
    input.timezone,
    durationMinutes,
    from,
    days
  ).slots.filter((slot) => !conflicts.some((conflict) => overlap(slot, conflict)))
}

const candidates = (
  input: SchedulingInputs,
  range: { readonly from: string; readonly days: number; readonly now: string },
  sessionId: string
) => {
  const selected = selectedServices(input)
  if (!selected.length) return { selected, providers: [], slots: [] }
  const providers = eligibleProviders(input, selected)
  const durationMinutes = selected.reduce(
    (total, service) => total + service.durationMinutes,
    0
  )
  const slots = new Map<string, BookingTimeSlot>()
  for (const provider of providers) {
    for (const slot of providerSlots(
      input,
      provider.id,
      durationMinutes,
      range.from,
      range.days,
      range.now,
      sessionId
    )) {
      slots.set(`${slot.startsAt}\0${slot.endsAt}`, slot)
    }
  }
  return {
    selected,
    providers,
    slots: [...slots.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  }
}

const quoteFor = (
  input: SchedulingInputs,
  selected: readonly SchedulingService[],
  provider: SchedulingProvider,
  slot: BookingTimeSlot
): BookingQuote => {
  const snapshots = selected.map((service, index) => ({
    id: service.id,
    role: index === 0 ? ('primary' as const) : ('additional' as const),
    name: service.name,
    durationMinutes: service.durationMinutes,
    priceMinor: service.priceMinor,
    currency: service.currency
  }))
  return {
    ...slot,
    providerPreference: input.preference,
    assignedProvider: { id: provider.id, displayName: provider.displayName },
    services: snapshots,
    durationMinutes: snapshots.reduce(
      (sum, service) => sum + service.durationMinutes,
      0
    ),
    currency: snapshots[0]!.currency,
    totalMinor: snapshots.reduce((sum, service) => sum + service.priceMinor, 0)
  }
}

const providersAvailableForSlot = (
  input: SchedulingInputs,
  generated: ReturnType<typeof candidates>,
  slot: BookingTimeSlot,
  now: string,
  sessionId: string
) => {
  const duration = generated.selected.reduce(
    (sum, service) => sum + service.durationMinutes,
    0
  )
  return generated.providers.filter((provider) =>
    providerSlots(input, provider.id, duration, slot.startsAt, 1, now, sessionId).some(
      (candidate) => candidate.startsAt === slot.startsAt
    )
  )
}

const makeStoredHold = (input: {
  readonly scheduling: SchedulingInputs
  readonly selected: readonly SchedulingService[]
  readonly provider: SchedulingProvider
  readonly slot: BookingTimeSlot
  readonly sessionId: string
  readonly now: string
}): StoredHold => ({
  id: newCapabilityId('hld'),
  merchantId: input.scheduling.merchantId,
  bookingSessionId: input.sessionId,
  providerId: input.provider.id,
  startsAt: input.slot.startsAt,
  endsAt: input.slot.endsAt,
  createdAt: input.now,
  expiresAt: new Date(Date.parse(input.now) + 10 * 60_000).toISOString(),
  quote: quoteFor(input.scheduling, input.selected, input.provider, input.slot)
})

const seedInputs = (
  store: SeedBookingSchedulingStore,
  session: BookingSession
): Effect.Effect<SchedulingInputs, BookingSchedulingRejected> => {
  const scenario = store.scenario
  const selection = store.selections.selections.get(session.id)
  if (
    scenario.merchant.slug !== session.merchantSlug ||
    !selection?.providerPreference ||
    !selection.primaryServiceId
  ) {
    return Effect.fail(failure('not_ready'))
  }
  return Effect.succeed({
    merchantId: scenario.merchant.id,
    timezone: scenario.merchant.timezone,
    preference: selection.providerPreference,
    primaryServiceId: selection.primaryServiceId,
    additionalServiceIds: selection.additionalServiceIds,
    providers: scenario.providers,
    services: scenario.services,
    eligibility: new Set(
      scenario.eligibility.map((pair) =>
        eligibilityKey(pair.providerId, pair.serviceId)
      )
    ),
    rules: scenario.scheduleRules,
    appointments: scenario.appointments
      .filter((appointment) => appointment.status === 'scheduled')
      .map((appointment) => appointment),
    holds: [...store.holds.values()]
  })
}

export const SeedBookingScheduling = (
  store: SeedBookingSchedulingStore
): Layer.Layer<BookingScheduling> =>
  Layer.succeed(BookingScheduling)({
    currentHold: (session, input) =>
      Effect.succeed(
        [...store.holds.values()].find(
          (hold) => hold.bookingSessionId === session.id && hold.expiresAt > input.now
        ) ?? null
      ).pipe(Effect.map((hold) => (hold ? toPublicHold(hold) : null))),
    availability: (session, range) =>
      Effect.gen(function* () {
        const days = range.days ?? 14
        if (!validRange(range.from, days)) return yield* failure('invalid_range')
        const hold = [...store.holds.values()].find(
          (item) => item.bookingSessionId === session.id && item.expiresAt > range.now
        )
        const inputResult = yield* Effect.result(seedInputs(store, session))
        if (inputResult._tag === 'Failure') {
          if (hold)
            return {
              timezone: store.scenario.merchant.timezone,
              slots: [],
              hold: toPublicHold(hold)
            }
          return yield* inputResult.failure
        }
        const input = inputResult.success
        const generated = candidates(input, { ...range, days }, session.id)
        if (!generated.selected.length || !generated.providers.length) {
          if (hold)
            return {
              timezone: input.timezone,
              slots: [],
              hold: toPublicHold(hold)
            }
          return yield* failure('not_ready')
        }
        return {
          timezone: input.timezone,
          slots: generated.slots,
          hold: hold ? toPublicHold(hold) : null
        }
      }),
    hold: (session, command) =>
      Effect.gen(function* () {
        if (!Number.isFinite(Date.parse(command.startsAt)))
          return yield* failure('slot_lost')
        const existing = [...store.holds.values()].find(
          (hold) =>
            hold.bookingSessionId === session.id &&
            hold.expiresAt > command.now &&
            hold.startsAt === command.startsAt
        )
        if (existing) return toPublicHold(existing)
        const input = yield* seedInputs(store, session)
        const generated = candidates(
          input,
          { from: command.startsAt, days: 1, now: command.now },
          session.id
        )
        const slot = generated.slots.find((item) => item.startsAt === command.startsAt)
        if (!slot) return yield* failure('slot_lost')
        const provider = providersAvailableForSlot(
          input,
          generated,
          slot,
          command.now,
          session.id
        )[0]
        if (!provider) return yield* failure('slot_lost')
        const stored = makeStoredHold({
          scheduling: input,
          selected: generated.selected,
          provider,
          slot,
          sessionId: session.id,
          now: command.now
        })
        for (const [existingId, existing] of store.holds) {
          if (existing.bookingSessionId === session.id) store.holds.delete(existingId)
        }
        store.holds.set(stored.id, stored)
        return toPublicHold(stored)
      })
  })

const liveInputs = (
  db: typeof Database.Service,
  session: BookingSession
): Effect.Effect<SchedulingInputs, Failure> =>
  Effect.gen(function* () {
    const sessionRows = yield* orUnavailable('booking-scheduling')(
      db
        .select({
          merchantId: merchants.id,
          timezone: merchants.timezone,
          preference: bookingSessions.providerPreference,
          providerId: bookingSessions.providerId,
          primaryServiceId: bookingSessions.primaryServiceId
        })
        .from(bookingSessions)
        .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
        .where(
          and(
            eq(bookingSessions.id, session.id),
            eq(merchants.slug, session.merchantSlug)
          )
        )
        .limit(1)
    )
    const row = sessionRows[0]
    if (!row?.preference || !row.primaryServiceId) return yield* failure('not_ready')
    const [
      providerRows,
      serviceRows,
      eligibilityRows,
      ruleRows,
      additionalRows,
      appointmentRows,
      holdRows
    ] = yield* Effect.all([
      orUnavailable('booking-scheduling')(
        db.select().from(providers).where(eq(providers.merchantId, row.merchantId))
      ),
      orUnavailable('booking-scheduling')(
        db.select().from(services).where(eq(services.merchantId, row.merchantId))
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(providerServiceEligibility)
          .where(eq(providerServiceEligibility.merchantId, row.merchantId))
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(scheduleRules)
          .where(eq(scheduleRules.merchantId, row.merchantId))
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(bookingSessionAdditionalServices)
          .where(eq(bookingSessionAdditionalServices.bookingSessionId, session.id))
          .orderBy(asc(bookingSessionAdditionalServices.position))
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.merchantId, row.merchantId),
              eq(appointments.status, 'scheduled')
            )
          )
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(timeSlotHolds)
          .where(eq(timeSlotHolds.merchantId, row.merchantId))
      )
    ])
    return {
      merchantId: row.merchantId,
      timezone: row.timezone,
      preference:
        row.preference === 'any'
          ? { kind: 'any' }
          : { kind: 'specific', providerId: row.providerId ?? '' },
      primaryServiceId: row.primaryServiceId,
      additionalServiceIds: additionalRows.map((item) => item.serviceId),
      providers: providerRows,
      services: serviceRows,
      eligibility: new Set(
        eligibilityRows.map((pair) => eligibilityKey(pair.providerId, pair.serviceId))
      ),
      rules: ruleRows,
      appointments: appointmentRows,
      holds: holdRows
    }
  })

const livePublicHold = (row: typeof timeSlotHolds.$inferSelect): TimeSlotHold => ({
  id: row.id,
  bookingSessionId: row.bookingSessionId,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  quote: row.quote
})

const liveTimezone = (db: typeof Database.Service, session: BookingSession) =>
  orUnavailable('booking-scheduling')(
    db
      .select({ timezone: merchants.timezone })
      .from(bookingSessions)
      .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
      .where(
        and(
          eq(bookingSessions.id, session.id),
          eq(merchants.slug, session.merchantSlug)
        )
      )
      .limit(1)
  ).pipe(
    Effect.flatMap((rows) =>
      rows[0] ? Effect.succeed(rows[0].timezone) : Effect.fail(failure('not_ready'))
    )
  )

export const LiveBookingScheduling: Layer.Layer<BookingScheduling, never, Database> =
  Layer.effect(
    BookingScheduling,
    Effect.gen(function* () {
      const db = yield* Database
      const currentHold = (session: BookingSession, now: string) =>
        orUnavailable('booking-scheduling')(
          db
            .select()
            .from(timeSlotHolds)
            .where(
              and(
                eq(timeSlotHolds.bookingSessionId, session.id),
                gt(timeSlotHolds.expiresAt, now)
              )
            )
            .orderBy(asc(timeSlotHolds.createdAt))
            .limit(1)
        ).pipe(Effect.map((rows) => (rows[0] ? livePublicHold(rows[0]) : null)))

      return {
        currentHold: (session, input) => currentHold(session, input.now),
        availability: (session, range) =>
          Effect.gen(function* () {
            const days = range.days ?? 14
            if (!validRange(range.from, days)) return yield* failure('invalid_range')
            const hold = yield* currentHold(session, range.now)
            const inputResult = yield* Effect.result(liveInputs(db, session))
            if (inputResult._tag === 'Failure') {
              if (hold && inputResult.failure instanceof BookingSchedulingRejected) {
                return {
                  timezone: yield* liveTimezone(db, session),
                  slots: [],
                  hold
                }
              }
              return yield* inputResult.failure
            }
            const input = inputResult.success
            const generated = candidates(input, { ...range, days }, session.id)
            if (!generated.selected.length || !generated.providers.length) {
              if (hold) return { timezone: input.timezone, slots: [], hold }
              return yield* failure('not_ready')
            }
            return {
              timezone: input.timezone,
              slots: generated.slots,
              hold
            }
          }),
        hold: (session, command) =>
          Effect.gen(function* () {
            if (!Number.isFinite(Date.parse(command.startsAt)))
              return yield* failure('slot_lost')
            const existing = yield* currentHold(session, command.now)
            if (existing?.quote.startsAt === command.startsAt) return existing
            const input = yield* liveInputs(db, session)
            const generated = candidates(
              input,
              { from: command.startsAt, days: 1, now: command.now },
              session.id
            )
            const slot = generated.slots.find(
              (candidate) => candidate.startsAt === command.startsAt
            )
            if (!slot) return yield* failure('slot_lost')
            const duration = generated.selected.reduce(
              (sum, service) => sum + service.durationMinutes,
              0
            )
            const providersForSlot = providersAvailableForSlot(
              input,
              generated,
              slot,
              command.now,
              session.id
            )
            for (const provider of providersForSlot) {
              const stored = makeStoredHold({
                scheduling: input,
                selected: generated.selected,
                provider,
                slot,
                sessionId: session.id,
                now: command.now
              })
              const { id, createdAt, expiresAt, quote } = stored
              const matchingRule = input.rules.find(
                (rule) =>
                  rule.providerId === provider.id &&
                  deriveSlots(
                    [rule],
                    input.timezone,
                    duration,
                    command.startsAt,
                    1
                  ).slots.some((candidate) => candidate.startsAt === slot.startsAt)
              )
              if (!matchingRule) continue
              const catalogChecks = [
                `EXISTS (
                  SELECT 1 FROM booking_sessions
                  WHERE id = ? AND merchant_id = ? AND lifecycle = 'active'
                    AND idle_expires_at > ? AND absolute_expires_at > ?
                    AND provider_preference = ?
                    AND ${
                      input.preference.kind === 'any'
                        ? 'provider_id IS NULL'
                        : 'provider_id = ?'
                    }
                    AND primary_service_id = ?
                )`,
                `(SELECT COUNT(*) FROM booking_session_additional_services
                  WHERE booking_session_id = ?) = ?`,
                ...input.additionalServiceIds.map(
                  () => `EXISTS (
                    SELECT 1 FROM booking_session_additional_services
                    WHERE booking_session_id = ? AND service_id = ? AND position = ?
                  )`
                ),
                `EXISTS (
                  SELECT 1 FROM providers
                  WHERE id = ? AND merchant_id = ? AND status = 'active'
                    AND display_name = ?
                )`,
                `EXISTS (
                  SELECT 1 FROM schedule_rules
                  WHERE id = ? AND merchant_id = ? AND provider_id = ?
                    AND weekday = ? AND start_time = ? AND end_time = ?
                )`,
                ...generated.selected.map(
                  () => `EXISTS (
                    SELECT 1 FROM services
                    INNER JOIN provider_service_eligibility eligibility
                      ON eligibility.service_id = services.id
                     AND eligibility.provider_id = ?
                     AND eligibility.merchant_id = services.merchant_id
                    WHERE services.id = ? AND services.merchant_id = ?
                      AND services.status = 'active' AND services.name = ?
                      AND services.duration_minutes = ?
                      AND services.price_minor = ? AND services.currency = ?
                  )`
                )
              ]
              const catalogParams = [
                session.id,
                input.merchantId,
                command.now,
                command.now,
                input.preference.kind,
                ...(input.preference.kind === 'specific'
                  ? [input.preference.providerId]
                  : []),
                input.primaryServiceId,
                session.id,
                input.additionalServiceIds.length,
                ...input.additionalServiceIds.flatMap((serviceId, position) => [
                  session.id,
                  serviceId,
                  position
                ]),
                provider.id,
                input.merchantId,
                provider.displayName,
                matchingRule.id,
                input.merchantId,
                provider.id,
                matchingRule.weekday,
                matchingRule.startTime,
                matchingRule.endTime,
                ...generated.selected.flatMap((service) => [
                  provider.id,
                  service.id,
                  input.merchantId,
                  service.name,
                  service.durationMinutes,
                  service.priceMinor,
                  service.currency
                ])
              ]
              const insertQuery = {
                sql: `INSERT INTO time_slot_holds (id, merchant_id, booking_session_id, provider_id, starts_at, ends_at, created_at, expires_at, quote)
                         SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
                         WHERE ${catalogChecks.join(' AND ')}
                         AND NOT EXISTS (
                           SELECT 1 FROM appointments
                           WHERE provider_id = ? AND status = 'scheduled'
                             AND starts_at < ? AND ends_at > ?
                         ) AND NOT EXISTS (
                           SELECT 1 FROM time_slot_holds
                           WHERE provider_id = ? AND expires_at > ?
                             AND booking_session_id <> ?
                             AND starts_at < ? AND ends_at > ?
                         )`,
                params: [
                  id,
                  input.merchantId,
                  session.id,
                  provider.id,
                  slot.startsAt,
                  slot.endsAt,
                  createdAt,
                  expiresAt,
                  JSON.stringify(quote satisfies StoredBookingQuote),
                  ...catalogParams,
                  provider.id,
                  slot.endsAt,
                  slot.startsAt,
                  provider.id,
                  command.now,
                  session.id,
                  slot.endsAt,
                  slot.startsAt
                ]
              } satisfies CompiledBatchQuery
              const removePreviousQuery = {
                sql: `DELETE FROM time_slot_holds
                         WHERE booking_session_id = ? AND id <> ?
                           AND EXISTS (SELECT 1 FROM time_slot_holds WHERE id = ?)`,
                params: [session.id, id, id]
              } satisfies CompiledBatchQuery
              const result = yield* orUnavailable('booking-scheduling')(
                batchQueries(db, [insertQuery, removePreviousQuery])
              )
              if ((result[0]?.meta.changes ?? 0) > 0) {
                return {
                  id,
                  bookingSessionId: session.id,
                  createdAt,
                  expiresAt,
                  quote
                }
              }
            }
            return yield* failure('slot_lost')
          })
      }
    })
  )
