import { Context, Effect, Layer, Schema } from 'effect'
import { and, asc, eq, gt, isNull, or, sql, type SQL } from 'drizzle-orm'
import {
  appointments,
  batch,
  batchQueries,
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  bookingSessionAdditionalServices,
  bookingSessions,
  blockedTimes,
  Database,
  merchantActivationStates,
  merchantSubscriptions,
  merchants,
  providers,
  providerServiceEligibility,
  scheduleRules,
  scheduleExceptions,
  services,
  shopProviders,
  shopServices,
  shops,
  timeSlotHolds,
  type CompiledBatchQuery,
  type StoredBookingQuote
} from '@b2b-saas-starter/db'
import { CapabilityUnavailable } from '../errors.ts'
import { newCapabilityId } from '../internal/ids.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import type { SeedBookingScenario } from '../merchant-catalog/merchant-onboarding.ts'
import {
  deriveControlledAvailability,
  type AvailabilityControls,
  type ScheduleRule
} from '../scheduling/scheduling.ts'
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
  bookingRequestId: Schema.optional(Schema.String),
  createdAt: Schema.String,
  expiresAt: Schema.String,
  quote: BookingQuote
})
export type TimeSlotHold = typeof TimeSlotHold.Type

export const BookingAvailability = Schema.Struct({
  timezone: Schema.String,
  range: Schema.Struct({
    from: Schema.String,
    days: Schema.Number
  }),
  slots: Schema.Array(BookingTimeSlot),
  hold: Schema.NullOr(TimeSlotHold)
})
export type BookingAvailability = typeof BookingAvailability.Type

export const BOOKING_AVAILABILITY_HORIZON_DAYS = 60

export const HoldTimeSlotInput = Schema.Struct({ startsAt: Schema.String })
export type HoldTimeSlotInput = typeof HoldTimeSlotInput.Type

export const CoordinatedHoldInput = Schema.Struct({
  requests: Schema.NonEmptyArray(
    Schema.Struct({
      bookingRequestId: Schema.String,
      startsAt: Schema.String
    })
  ),
  now: Schema.String
})
export type CoordinatedHoldInput = typeof CoordinatedHoldInput.Type

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
type AvailabilityRange = {
  readonly from: string
  readonly days?: number
  readonly now: string
}
export type BookingSchedulingShape = {
  readonly availability: (
    session: BookingSession,
    input: AvailabilityRange
  ) => Effect.Effect<BookingAvailability, Failure>
  readonly hold: (
    session: BookingSession,
    input: { readonly startsAt: string; readonly now: string }
  ) => Effect.Effect<TimeSlotHold, Failure>
  readonly holdParty: (
    session: BookingSession,
    input: CoordinatedHoldInput
  ) => Effect.Effect<readonly TimeSlotHold[], Failure>
  readonly currentHold: (
    session: BookingSession,
    input: { readonly now: string }
  ) => Effect.Effect<TimeSlotHold | null, CapabilityUnavailable>
  readonly release: (
    session: BookingSession
  ) => Effect.Effect<void, CapabilityUnavailable>
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
  readonly beforeBufferMinutes: number
  readonly afterBufferMinutes: number
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
  readonly shopId: string
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
  readonly controls: AvailabilityControls
  readonly subscriptionAccess: boolean
}

type StoredHold = TimeSlotHold & {
  readonly merchantId: string
  readonly providerId: string
  readonly startsAt: string
  readonly endsAt: string
}
export type CoordinatedHoldCandidate = StoredHold & {
  readonly bookingRequestId: string
}

/**
 * Commits a complete prevalidated group hold set to the seed repository. The
 * validation pass is deliberately side-effect free, so a conflict cannot leave
 * a partly held Booking Party behind.
 */
export const acquireCoordinatedSeedHolds = (
  holds: Map<string, StoredHold>,
  candidates: readonly CoordinatedHoldCandidate[],
  now: string
): readonly TimeSlotHold[] | null => {
  if (
    candidates.length === 0 ||
    new Set(candidates.map((candidate) => candidate.bookingRequestId)).size !==
      candidates.length
  )
    return null
  const active = [...holds.values()].filter((hold) => hold.expiresAt > now)
  const conflicts = (left: StoredHold, right: StoredHold) =>
    left.providerId === right.providerId &&
    overlap(left, right) &&
    left.bookingSessionId !== right.bookingSessionId
  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index]!
    if (active.some((hold) => conflicts(candidate, hold))) return null
    if (
      candidates
        .slice(0, index)
        .some(
          (hold) => hold.providerId === candidate.providerId && overlap(candidate, hold)
        )
    )
      return null
  }
  const requestIds = new Set(candidates.map((candidate) => candidate.bookingRequestId))
  for (const [id, hold] of holds) {
    if (hold.bookingRequestId && requestIds.has(hold.bookingRequestId)) holds.delete(id)
  }
  for (const candidate of candidates) holds.set(candidate.id, candidate)
  return candidates.map(toPublicHold)
}
export type SeedBookingSchedulingStore = {
  readonly scenario: SeedBookingScenario
  readonly selections: SeedBookingSelectionStore
  readonly holds: Map<string, StoredHold>
  readonly requestSelections: Map<
    string,
    {
      readonly providerPreference: ProviderPreference
      readonly bookingSessionId: string
      readonly primaryServiceId: string
      readonly additionalServiceIds: readonly string[]
    }
  >
  readonly activeRequests: Map<string, string>
  readonly partyRequests: Map<string, ReadonlySet<string>>
}

const releaseSeedHolds = (store: SeedBookingSchedulingStore, sessionId: string) => {
  const activeRequestId = store.activeRequests.get(sessionId)
  for (const [holdId, hold] of store.holds) {
    if (
      hold.bookingSessionId === sessionId &&
      (!activeRequestId || hold.bookingRequestId === activeRequestId)
    )
      store.holds.delete(holdId)
  }
}

export const deleteTimeSlotHoldsForSelectionChange = (
  db: typeof Database.Service,
  sessionId: string,
  selectionGuard: SQL
): CompiledBatchQuery =>
  db
    .delete(timeSlotHolds)
    .where(
      and(
        eq(timeSlotHolds.bookingSessionId, sessionId),
        eq(
          timeSlotHolds.bookingRequestId,
          sql`(select active_request_id from booking_parties where booking_session_id = ${sessionId})`
        ),
        selectionGuard
      )
    )
    .toSQL()

export const emptySeedBookingSchedulingStore = (
  scenario: SeedBookingScenario,
  selections: SeedBookingSelectionStore
): SeedBookingSchedulingStore => {
  const store = {
    scenario,
    selections,
    holds: new Map<string, StoredHold>(),
    requestSelections: new Map(),
    activeRequests: new Map(),
    partyRequests: new Map()
  }
  selections.invalidateTimeSlotHolds = (sessionId) => releaseSeedHolds(store, sessionId)
  return store
}

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
  Number.isFinite(Date.parse(from)) &&
  Number.isInteger(days) &&
  days >= 1 &&
  days <= BOOKING_AVAILABILITY_HORIZON_DAYS
const resolveAvailabilityRange = (range: AvailabilityRange) => {
  const days = range.days ?? 14
  return validRange(range.from, days) ? { from: range.from, days } : null
}
const toPublicHold = (hold: StoredHold): TimeSlotHold => ({
  id: hold.id,
  bookingSessionId: hold.bookingSessionId,
  ...(hold.bookingRequestId ? { bookingRequestId: hold.bookingRequestId } : {}),
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
  beforeBufferMinutes: number,
  afterBufferMinutes: number,
  from: string,
  days: number,
  now: string,
  sessionId: string
): readonly BookingTimeSlot[] => {
  if (!input.subscriptionAccess) return []
  const conflicts = [
    ...input.appointments,
    ...input.holds.filter(
      (hold) => hold.expiresAt! > now && hold.bookingSessionId !== sessionId
    )
  ].filter((conflict) => conflict.providerId === providerId)
  return deriveControlledAvailability({
    rules: input.rules.filter((rule) => rule.providerId === providerId),
    timezone: input.timezone,
    serviceDurationMinutes: durationMinutes,
    now,
    from,
    days,
    controls: {
      ...input.controls,
      beforeBufferMinutes,
      afterBufferMinutes
    },
    occupied: conflicts
  }).slots.filter(
    (slot) =>
      Date.parse(slot.startsAt) > Date.parse(now) &&
      Date.parse(slot.startsAt) >= Date.parse(from)
  )
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
  const beforeBufferMinutes = Math.max(
    0,
    ...selected.map((service) => service.beforeBufferMinutes)
  )
  const afterBufferMinutes = Math.max(
    0,
    ...selected.map((service) => service.afterBufferMinutes)
  )
  const slots = new Map<string, BookingTimeSlot>()
  for (const provider of providers) {
    for (const slot of providerSlots(
      input,
      provider.id,
      durationMinutes,
      beforeBufferMinutes,
      afterBufferMinutes,
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
  const beforeBufferMinutes = Math.max(
    0,
    ...generated.selected.map((service) => service.beforeBufferMinutes)
  )
  const afterBufferMinutes = Math.max(
    0,
    ...generated.selected.map((service) => service.afterBufferMinutes)
  )
  return generated.providers.filter((provider) =>
    providerSlots(
      input,
      provider.id,
      duration,
      beforeBufferMinutes,
      afterBufferMinutes,
      slot.startsAt,
      1,
      now,
      sessionId
    ).some((candidate) => candidate.startsAt === slot.startsAt)
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

const candidateForRequest = (
  input: SchedulingInputs,
  startsAt: string,
  now: string,
  sessionId: string
): StoredHold | null => {
  const generated = candidates(input, { from: startsAt, days: 1, now }, sessionId)
  const slot = generated.slots.find((item) => item.startsAt === startsAt)
  const provider = slot
    ? providersAvailableForSlot(input, generated, slot, now, sessionId)[0]
    : undefined
  if (!slot || !provider) return null
  return makeStoredHold({
    scheduling: input,
    selected: generated.selected,
    provider,
    slot,
    sessionId,
    now
  })
}

const seedInputs = (
  store: SeedBookingSchedulingStore,
  session: BookingSession
): Effect.Effect<SchedulingInputs, BookingSchedulingRejected> => {
  const scenario = store.scenario
  const selection = store.selections.selections.get(session.id)
  const activeRequestSelection = store.activeRequests.get(session.id)
    ? store.requestSelections.get(store.activeRequests.get(session.id)!)
    : undefined
  if (
    scenario.merchant.slug !== session.merchantSlug ||
    !selection?.providerPreference ||
    !selection.shopId ||
    !selection.primaryServiceId
  ) {
    return Effect.fail(failure('not_ready'))
  }
  return Effect.succeed({
    merchantId: scenario.merchant.id,
    shopId: selection.shopId,
    timezone:
      store.selections.shops.get(selection.shopId)?.timezone ??
      scenario.merchant.timezone,
    preference:
      activeRequestSelection?.providerPreference ?? selection.providerPreference,
    primaryServiceId:
      activeRequestSelection?.primaryServiceId ?? selection.primaryServiceId,
    additionalServiceIds:
      activeRequestSelection?.additionalServiceIds ?? selection.additionalServiceIds,
    providers: scenario.providers.filter((provider) =>
      store.selections.shopProviders.has(`${selection.shopId}\0${provider.id}`)
    ),
    services: scenario.services
      .filter((service) =>
        store.selections.shopServices.has(`${selection.shopId}\0${service.id}`)
      )
      .map((service) => ({
        ...service,
        beforeBufferMinutes: 0,
        afterBufferMinutes: 0
      })),
    eligibility: new Set(
      scenario.eligibility.map((pair) =>
        eligibilityKey(pair.providerId, pair.serviceId)
      )
    ),
    rules: scenario.scheduleRules,
    appointments: scenario.appointments
      .filter((appointment) => appointment.status === 'scheduled')
      .map((appointment) => appointment),
    holds: [...store.holds.values()],
    controls: {
      startTimeIntervalMinutes: 15,
      minimumNoticeMinutes: 0,
      bookingHorizonDays: BOOKING_AVAILABILITY_HORIZON_DAYS
    },
    subscriptionAccess: true
  })
}

export const SeedBookingScheduling = (
  store: SeedBookingSchedulingStore
): Layer.Layer<BookingScheduling> =>
  Layer.succeed(BookingScheduling)({
    release: (session) =>
      Effect.sync(() => {
        const activeRequestId = store.activeRequests.get(session.id)
        for (const [id, hold] of store.holds) {
          if (
            hold.bookingSessionId === session.id &&
            (!activeRequestId || hold.bookingRequestId === activeRequestId)
          )
            store.holds.delete(id)
        }
      }),
    currentHold: (session, input) =>
      Effect.succeed(
        [...store.holds.values()].find(
          (hold) =>
            hold.bookingSessionId === session.id &&
            hold.expiresAt > input.now &&
            (!store.activeRequests.get(session.id) ||
              hold.bookingRequestId === store.activeRequests.get(session.id))
        ) ?? null
      ).pipe(Effect.map((hold) => (hold ? toPublicHold(hold) : null))),
    holdParty: (session, command) =>
      Effect.gen(function* () {
        const input = yield* seedInputs(store, session)
        const submittedIds = new Set(
          command.requests.map((request) => request.bookingRequestId)
        )
        const partySelectionIds = [...(store.partyRequests.get(session.id) ?? [])]
        if (
          partySelectionIds.length > 0 &&
          (submittedIds.size !== partySelectionIds.length ||
            partySelectionIds.some((id) => !submittedIds.has(id)))
        )
          return yield* failure('not_ready')
        const candidates: CoordinatedHoldCandidate[] = []
        for (const request of command.requests) {
          const requestSelection = store.requestSelections.get(request.bookingRequestId)
          const requestInput = requestSelection
            ? {
                ...input,
                preference: requestSelection.providerPreference,
                primaryServiceId: requestSelection.primaryServiceId,
                additionalServiceIds: requestSelection.additionalServiceIds
              }
            : input
          const generated = candidateForRequest(
            requestInput,
            request.startsAt,
            command.now,
            session.id
          )
          if (!generated) return yield* failure('slot_lost')
          candidates.push({ ...generated, bookingRequestId: request.bookingRequestId })
        }
        const held = acquireCoordinatedSeedHolds(store.holds, candidates, command.now)
        return held ? held : yield* failure('slot_lost')
      }),
    availability: (session, range) =>
      Effect.gen(function* () {
        const resolvedRange = resolveAvailabilityRange(range)
        if (!resolvedRange) return yield* failure('invalid_range')
        const { days } = resolvedRange
        const hold = [...store.holds.values()].find(
          (item) =>
            item.bookingSessionId === session.id &&
            item.expiresAt > range.now &&
            (!store.activeRequests.get(session.id) ||
              item.bookingRequestId === store.activeRequests.get(session.id))
        )
        const inputResult = yield* Effect.result(seedInputs(store, session))
        if (inputResult._tag === 'Failure') {
          if (hold)
            return {
              timezone:
                store.selections.shops.get(
                  store.selections.selections.get(session.id)?.shopId ?? ''
                )?.timezone ?? store.scenario.merchant.timezone,
              range: resolvedRange,
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
              range: resolvedRange,
              slots: [],
              hold: toPublicHold(hold)
            }
          return yield* failure('not_ready')
        }
        return {
          timezone: input.timezone,
          range: resolvedRange,
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
        const activeRequestId = store.activeRequests.get(session.id)
        const requestStored = activeRequestId
          ? { ...stored, bookingRequestId: activeRequestId }
          : stored
        for (const [existingId, existing] of store.holds) {
          if (
            existing.bookingSessionId === session.id &&
            (!activeRequestId || existing.bookingRequestId === activeRequestId)
          )
            store.holds.delete(existingId)
        }
        store.holds.set(requestStored.id, requestStored)
        return toPublicHold(requestStored)
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
          shopId: bookingParties.shopId,
          timezone: shops.timezone,
          preference: bookingSessions.providerPreference,
          providerId: bookingSessions.providerId,
          primaryServiceId: bookingSessions.primaryServiceId
        })
        .from(bookingSessions)
        .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
        .innerJoin(
          bookingParties,
          eq(bookingParties.bookingSessionId, bookingSessions.id)
        )
        .innerJoin(shops, eq(shops.id, bookingParties.shopId))
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
      holdRows,
      activationRows,
      exceptionRows,
      blockedRows,
      subscriptionRows
    ] = yield* Effect.all([
      orUnavailable('booking-scheduling')(
        db
          .select({
            id: providers.id,
            displayName: providers.displayName,
            status: providers.status
          })
          .from(providers)
          .innerJoin(shopProviders, eq(shopProviders.providerId, providers.id))
          .where(
            and(
              eq(providers.merchantId, row.merchantId),
              eq(shopProviders.shopId, row.shopId)
            )
          )
      ),
      orUnavailable('booking-scheduling')(
        db
          .select({
            id: services.id,
            name: services.name,
            priceMinor: services.priceMinor,
            currency: services.currency,
            durationMinutes: services.durationMinutes,
            status: services.status,
            bookingConfigJson: services.bookingConfigJson
          })
          .from(services)
          .innerJoin(shopServices, eq(shopServices.serviceId, services.id))
          .where(
            and(
              eq(services.merchantId, row.merchantId),
              eq(shopServices.shopId, row.shopId)
            )
          )
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
          .select({
            providerId: appointments.providerId,
            startsAt: appointments.startsAt,
            endsAt: appointments.endsAt
          })
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
      ),
      orUnavailable('booking-scheduling')(
        db
          .select({ bookingPoliciesJson: merchantActivationStates.bookingPoliciesJson })
          .from(merchantActivationStates)
          .where(eq(merchantActivationStates.merchantId, row.merchantId))
          .limit(1)
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(scheduleExceptions)
          .where(eq(scheduleExceptions.merchantId, row.merchantId))
      ),
      orUnavailable('booking-scheduling')(
        db
          .select()
          .from(blockedTimes)
          .where(eq(blockedTimes.merchantId, row.merchantId))
      ),
      orUnavailable('booking-scheduling')(
        db
          .select({ status: merchantSubscriptions.status })
          .from(merchantSubscriptions)
          .where(eq(merchantSubscriptions.merchantId, row.merchantId))
          .limit(1)
      )
    ])
    const policies = activationRows[0]?.bookingPoliciesJson as
      | {
          minimumNoticeMinutes?: number
          bookingHorizonDays?: number
          startTimeIntervalMinutes?: 5 | 10 | 15 | 30
        }
      | null
      | undefined
    return {
      merchantId: row.merchantId,
      shopId: row.shopId,
      timezone: row.timezone,
      preference:
        row.preference === 'any'
          ? { kind: 'any' }
          : { kind: 'specific', providerId: row.providerId ?? '' },
      primaryServiceId: row.primaryServiceId,
      additionalServiceIds: additionalRows.map((item) => item.serviceId),
      providers: providerRows,
      services: serviceRows.map(({ bookingConfigJson, ...service }) => ({
        ...service,
        beforeBufferMinutes:
          typeof bookingConfigJson?.beforeBufferMinutes === 'number'
            ? bookingConfigJson.beforeBufferMinutes
            : 0,
        afterBufferMinutes:
          typeof bookingConfigJson?.afterBufferMinutes === 'number'
            ? bookingConfigJson.afterBufferMinutes
            : 0
      })),
      eligibility: new Set(
        eligibilityRows.map((pair) => eligibilityKey(pair.providerId, pair.serviceId))
      ),
      rules: ruleRows,
      appointments: appointmentRows,
      holds: holdRows,
      controls: {
        startTimeIntervalMinutes: policies?.startTimeIntervalMinutes ?? 15,
        minimumNoticeMinutes: policies?.minimumNoticeMinutes ?? 120,
        bookingHorizonDays: policies?.bookingHorizonDays ?? 60,
        exceptions: exceptionRows.map((exception) => ({
          localDate: exception.localDate,
          kind: exception.kind,
          intervals:
            exception.kind === 'closed'
              ? []
              : (JSON.parse(exception.intervalsJson) as Array<{
                  startTime: string
                  endTime: string
                }>)
        })),
        blocked: blockedRows.map((blocked) => ({
          startsAt: blocked.startsAt,
          endsAt: blocked.endsAt
        }))
      },
      subscriptionAccess: ['trialing', 'active', 'grace'].includes(
        subscriptionRows[0]?.status ?? ''
      )
    }
  })

const livePublicHold = (row: typeof timeSlotHolds.$inferSelect): TimeSlotHold => ({
  id: row.id,
  bookingSessionId: row.bookingSessionId,
  ...(row.bookingRequestId ? { bookingRequestId: row.bookingRequestId } : {}),
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  quote: row.quote
})

const liveHoldParty = (
  db: typeof Database.Service,
  session: BookingSession,
  command: CoordinatedHoldInput
): Effect.Effect<readonly TimeSlotHold[], Failure> =>
  Effect.gen(function* () {
    const base = yield* liveInputs(db, session)
    const partyRequestRows = yield* orUnavailable('booking-scheduling')(
      db
        .select({ id: bookingRequests.id })
        .from(bookingRequests)
        .innerJoin(
          bookingParties,
          eq(bookingParties.id, bookingRequests.bookingPartyId)
        )
        .where(
          and(
            eq(bookingParties.bookingSessionId, session.id),
            eq(bookingParties.lifecycle, 'active')
          )
        )
    )
    const submittedIds = new Set(
      command.requests.map((request) => request.bookingRequestId)
    )
    if (
      submittedIds.size !== partyRequestRows.length ||
      partyRequestRows.some((request) => !submittedIds.has(request.id))
    )
      return yield* failure('not_ready')
    const candidateRows: CoordinatedHoldCandidate[] = []
    for (const requested of command.requests) {
      const [requestRows, serviceRows] = yield* Effect.all([
        orUnavailable('booking-scheduling')(
          db
            .select()
            .from(bookingRequests)
            .innerJoin(
              bookingParties,
              eq(bookingParties.id, bookingRequests.bookingPartyId)
            )
            .where(
              and(
                eq(bookingRequests.id, requested.bookingRequestId),
                eq(bookingParties.bookingSessionId, session.id)
              )
            )
            .limit(1)
        ),
        orUnavailable('booking-scheduling')(
          db
            .select()
            .from(bookingRequestServices)
            .where(
              eq(bookingRequestServices.bookingRequestId, requested.bookingRequestId)
            )
            .orderBy(asc(bookingRequestServices.position))
        )
      ])
      const request = requestRows[0]?.booking_requests
      if (!request?.providerPreference || !request.primaryServiceId)
        return yield* failure('not_ready')
      const input: SchedulingInputs = {
        ...base,
        preference:
          request.providerPreference === 'any'
            ? { kind: 'any' }
            : { kind: 'specific', providerId: request.providerId ?? '' },
        primaryServiceId: request.primaryServiceId,
        additionalServiceIds: serviceRows
          .filter((item) => item.role === 'additional')
          .map((item) => item.serviceId)
      }
      const candidate = candidateForRequest(
        input,
        requested.startsAt,
        command.now,
        session.id
      )
      if (!candidate) return yield* failure('slot_lost')
      candidateRows.push({ ...candidate, bookingRequestId: requested.bookingRequestId })
    }
    if (
      new Set(candidateRows.map((item) => item.bookingRequestId)).size !==
      candidateRows.length
    )
      return yield* failure('slot_lost')
    const valueSql = candidateRows
      .map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .join(', ')
    const params = candidateRows.flatMap((item) => [
      item.id,
      item.merchantId,
      item.bookingSessionId,
      item.bookingRequestId,
      item.providerId,
      item.startsAt,
      item.endsAt,
      item.createdAt,
      item.expiresAt,
      JSON.stringify(item.quote)
    ])
    const insert: CompiledBatchQuery = {
      sql: `WITH candidates(id, merchant_id, booking_session_id, booking_request_id, provider_id, starts_at, ends_at, created_at, expires_at, quote) AS (VALUES ${valueSql})
        INSERT INTO time_slot_holds (id, merchant_id, booking_session_id, booking_request_id, provider_id, starts_at, ends_at, created_at, expires_at, quote)
        SELECT * FROM candidates c
        WHERE (SELECT COUNT(*) FROM candidates) = ?
          AND NOT EXISTS (SELECT 1 FROM candidates a JOIN candidates b ON a.id < b.id AND a.provider_id = b.provider_id AND a.starts_at < b.ends_at AND a.ends_at > b.starts_at)
          AND NOT EXISTS (SELECT 1 FROM candidates c2 JOIN time_slot_holds h ON h.provider_id = c2.provider_id AND h.expires_at > ? AND h.booking_session_id <> c2.booking_session_id AND h.starts_at < c2.ends_at AND h.ends_at > c2.starts_at)
          AND NOT EXISTS (SELECT 1 FROM candidates c2 JOIN appointments a ON a.provider_id = c2.provider_id AND a.status = 'scheduled' AND a.starts_at < c2.ends_at AND a.ends_at > c2.starts_at)
          AND NOT EXISTS (SELECT 1 FROM candidates c2 JOIN blocked_times b ON b.merchant_id = c2.merchant_id AND b.provider_id = c2.provider_id AND b.starts_at < c2.ends_at AND b.ends_at > c2.starts_at)
          AND NOT EXISTS (SELECT 1 FROM candidates c2 WHERE NOT EXISTS (SELECT 1 FROM merchant_subscriptions s WHERE s.merchant_id = c2.merchant_id AND s.status IN ('trialing', 'active', 'grace')))
          AND EXISTS (SELECT 1 FROM booking_requests r JOIN booking_parties p ON p.id = r.booking_party_id WHERE r.id = c.booking_request_id AND p.booking_session_id = c.booking_session_id AND p.lifecycle = 'active')`,
      params: [...params, candidateRows.length, command.now]
    }
    const requestPlaceholders = candidateRows.map(() => '?').join(', ')
    const requestIds = candidateRows.map((item) => item.bookingRequestId)
    const clearExistingHolds: CompiledBatchQuery = {
      sql: `DELETE FROM time_slot_holds WHERE booking_session_id = ? AND booking_request_id IN (${requestPlaceholders})`,
      params: [session.id, ...requestIds]
    }
    const clearExistingLinks: CompiledBatchQuery = {
      sql: `UPDATE booking_requests SET hold_id = NULL, starts_at = NULL, ends_at = NULL WHERE id IN (${requestPlaceholders})`,
      params: requestIds
    }
    const updates = candidateRows.map((item) =>
      db
        .update(bookingRequests)
        .set({ holdId: item.id, startsAt: item.startsAt, endsAt: item.endsAt })
        .where(
          and(
            eq(bookingRequests.id, item.bookingRequestId),
            sql`exists (select 1 from ${timeSlotHolds} where ${timeSlotHolds.id} = ${item.id})`
          )
        )
        .toSQL()
    )
    const results = yield* orUnavailable('booking-scheduling')(
      batchQueries(db, [clearExistingHolds, clearExistingLinks, insert, ...updates])
    )
    if ((results[2]?.meta.changes ?? 0) !== candidateRows.length)
      return yield* failure('slot_lost')
    return candidateRows.map(toPublicHold)
  })

const liveTimezone = (db: typeof Database.Service, session: BookingSession) =>
  orUnavailable('booking-scheduling')(
    db
      .select({ timezone: shops.timezone })
      .from(bookingSessions)
      .innerJoin(merchants, eq(merchants.id, bookingSessions.merchantId))
      .innerJoin(
        bookingParties,
        eq(bookingParties.bookingSessionId, bookingSessions.id)
      )
      .innerJoin(shops, eq(shops.id, bookingParties.shopId))
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
                gt(timeSlotHolds.expiresAt, now),
                or(
                  eq(
                    timeSlotHolds.bookingRequestId,
                    sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                  ),
                  isNull(timeSlotHolds.bookingRequestId)
                )
              )
            )
            .orderBy(asc(timeSlotHolds.createdAt))
            .limit(1)
        ).pipe(Effect.map((rows) => (rows[0] ? livePublicHold(rows[0]) : null)))

      return {
        release: (session) =>
          orUnavailable('booking-scheduling')(
            batch(db, [
              db
                .delete(timeSlotHolds)
                .where(
                  and(
                    eq(timeSlotHolds.bookingSessionId, session.id),
                    or(
                      eq(
                        timeSlotHolds.bookingRequestId,
                        sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                      ),
                      isNull(timeSlotHolds.bookingRequestId)
                    )
                  )
                ),
              db
                .update(bookingRequests)
                .set({ holdId: null, startsAt: null, endsAt: null })
                .where(
                  eq(
                    bookingRequests.id,
                    sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                  )
                )
            ])
          ).pipe(Effect.asVoid),
        currentHold: (session, input) => currentHold(session, input.now),
        holdParty: (session, command) => liveHoldParty(db, session, command),
        availability: (session, range) =>
          Effect.gen(function* () {
            const resolvedRange = resolveAvailabilityRange(range)
            if (!resolvedRange) return yield* failure('invalid_range')
            const { days } = resolvedRange
            const hold = yield* currentHold(session, range.now)
            const inputResult = yield* Effect.result(liveInputs(db, session))
            if (inputResult._tag === 'Failure') {
              if (hold && inputResult.failure instanceof BookingSchedulingRejected) {
                return {
                  timezone: yield* liveTimezone(db, session),
                  range: resolvedRange,
                  slots: [],
                  hold
                }
              }
              return yield* inputResult.failure
            }
            const input = inputResult.success
            const generated = candidates(input, { ...range, days }, session.id)
            if (!generated.selected.length || !generated.providers.length) {
              if (hold)
                return {
                  timezone: input.timezone,
                  range: resolvedRange,
                  slots: [],
                  hold
                }
              return yield* failure('not_ready')
            }
            return {
              timezone: input.timezone,
              range: resolvedRange,
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
              const catalogChecks = [
                `EXISTS (
                  SELECT 1 FROM booking_sessions
                  INNER JOIN booking_parties
                    ON booking_parties.booking_session_id = booking_sessions.id
                  WHERE booking_sessions.id = ?
                    AND booking_sessions.merchant_id = ?
                    AND booking_sessions.lifecycle = 'active'
                    AND booking_sessions.idle_expires_at > ?
                    AND booking_sessions.absolute_expires_at > ?
                    AND booking_parties.shop_id = ?
                    AND booking_sessions.provider_preference = ?
                    AND ${
                      input.preference.kind === 'any'
                        ? 'booking_sessions.provider_id IS NULL'
                        : 'booking_sessions.provider_id = ?'
                    }
                    AND booking_sessions.primary_service_id = ?
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
                  INNER JOIN shop_providers
                    ON shop_providers.provider_id = providers.id
                  WHERE providers.id = ? AND providers.merchant_id = ?
                    AND providers.status = 'active'
                    AND shop_providers.shop_id = ?
                    AND providers.display_name = ?
                )`,
                `EXISTS (
                  SELECT 1 FROM merchant_subscriptions
                  WHERE merchant_id = ? AND status IN ('trialing', 'active', 'grace')
                )`,
                ...generated.selected.map(
                  () => `EXISTS (
                    SELECT 1 FROM services
                    INNER JOIN provider_service_eligibility eligibility
                      ON eligibility.service_id = services.id
                     AND eligibility.provider_id = ?
                     AND eligibility.merchant_id = services.merchant_id
                    INNER JOIN shop_services
                      ON shop_services.service_id = services.id
                    WHERE services.id = ? AND services.merchant_id = ?
                      AND shop_services.shop_id = ?
                      AND services.status = 'active' AND services.name = ?
                      AND services.duration_minutes = ?
                      AND services.price_minor = ? AND services.currency = ?
                      AND COALESCE(json_extract(services.booking_config_json, '$.beforeBufferMinutes'), 0) = ?
                      AND COALESCE(json_extract(services.booking_config_json, '$.afterBufferMinutes'), 0) = ?
                  )`
                )
              ]
              const catalogParams = [
                session.id,
                input.merchantId,
                command.now,
                command.now,
                input.shopId,
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
                input.shopId,
                provider.displayName,
                input.merchantId,
                ...generated.selected.flatMap((service) => [
                  provider.id,
                  service.id,
                  input.merchantId,
                  input.shopId,
                  service.name,
                  service.durationMinutes,
                  service.priceMinor,
                  service.currency,
                  service.beforeBufferMinutes,
                  service.afterBufferMinutes
                ])
              ]
              const insertQuery = {
                sql: `INSERT INTO time_slot_holds (id, merchant_id, booking_session_id, booking_request_id, provider_id, starts_at, ends_at, created_at, expires_at, quote)
                         SELECT ?, ?, ?, (SELECT active_request_id FROM booking_parties WHERE booking_session_id = ?), ?, ?, ?, ?, ?, ?
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
                         ) AND NOT EXISTS (
                           SELECT 1 FROM blocked_times
                           WHERE merchant_id = ? AND provider_id = ?
                             AND starts_at < ? AND ends_at > ?
                         )`,
                params: [
                  id,
                  input.merchantId,
                  session.id,
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
                  slot.startsAt,
                  input.merchantId,
                  provider.id,
                  new Date(
                    Date.parse(slot.endsAt) +
                      Math.max(
                        0,
                        ...generated.selected.map(
                          (service) => service.afterBufferMinutes
                        )
                      ) *
                        60_000
                  ).toISOString(),
                  new Date(
                    Date.parse(slot.startsAt) -
                      Math.max(
                        0,
                        ...generated.selected.map(
                          (service) => service.beforeBufferMinutes
                        )
                      ) *
                        60_000
                  ).toISOString()
                ]
              } satisfies CompiledBatchQuery
              const removePreviousQuery = {
                sql: `DELETE FROM time_slot_holds
                         WHERE booking_request_id = (SELECT active_request_id FROM booking_parties WHERE booking_session_id = ?) AND id <> ?
                           AND EXISTS (SELECT 1 FROM time_slot_holds WHERE id = ?)`,
                params: [session.id, id, id]
              } satisfies CompiledBatchQuery
              const linkRequestQuery = db
                .update(bookingRequests)
                .set({ holdId: id, startsAt: slot.startsAt, endsAt: slot.endsAt })
                .where(
                  and(
                    eq(
                      bookingRequests.id,
                      sql`(select active_request_id from booking_parties where booking_session_id = ${session.id})`
                    ),
                    sql`exists (select 1 from ${timeSlotHolds} where ${timeSlotHolds.id} = ${id})`
                  )
                )
                .toSQL()
              const result = yield* orUnavailable('booking-scheduling')(
                batchQueries(db, [insertQuery, removePreviousQuery, linkRequestQuery])
              )
              if ((result[0]?.meta.changes ?? 0) > 0) {
                const [party] = yield* orUnavailable('booking-scheduling')(
                  db
                    .select({ activeRequestId: bookingParties.activeRequestId })
                    .from(bookingParties)
                    .where(eq(bookingParties.bookingSessionId, session.id))
                    .limit(1)
                )
                return {
                  id,
                  bookingSessionId: session.id,
                  ...(party?.activeRequestId
                    ? { bookingRequestId: party.activeRequestId }
                    : {}),
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
