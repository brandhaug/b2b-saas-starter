import { Effect, Layer, Schema, Semaphore } from 'effect'
import { and, asc, eq } from 'drizzle-orm'
import {
  batch,
  bookingParties,
  bookingRequests,
  bookingRequestServices,
  bookingSessions,
  bookingSessionAdditionalServices,
  Database,
  timeSlotHolds
} from '@b2b-saas-starter/db'
import { newCapabilityId } from '../internal/ids.ts'
import { CapabilityUnavailable } from '../errors.ts'
import { orUnavailable } from '../internal/unavailable.ts'
import {
  BookingParties,
  BookingGuestDetails,
  BookingPartyConflict,
  BookingPartyNotFound,
  bookingPartyContinuation,
  type BookingParty,
  type BookingRequestMaterial
} from './foundations.ts'
import type { SeedBookingSessionStore } from './booking-sessions.ts'

export const SeedBookingParties = (
  records: readonly (typeof import('./foundations.ts').BookingParty.Type)[] = [],
  requestSelections: Map<
    string,
    {
      providerPreference:
        | { readonly kind: 'any' }
        | { readonly kind: 'specific'; readonly providerId: string }
      primaryServiceId: string
      bookingSessionId: string
      additionalServiceIds: readonly string[]
    }
  > = new Map(),
  activeRequests: Map<string, string> = new Map(),
  partyRequests: Map<string, ReadonlySet<string>> = new Map(),
  requestHolds: Map<
    string,
    {
      readonly id: string
      readonly bookingRequestId?: string | null | undefined
      readonly startsAt: string
      readonly endsAt: string
      readonly expiresAt: string
    }
  > = new Map(),
  sessionParties?: SeedBookingSessionStore['parties'],
  onActivate?: (
    sessionId: string,
    selection:
      | {
          providerPreference:
            | { readonly kind: 'any' }
            | { readonly kind: 'specific'; readonly providerId: string }
          primaryServiceId: string
          additionalServiceIds: readonly string[]
        }
      | undefined
  ) => void
): Layer.Layer<BookingParties> => {
  const parties = new Map(records.map((record) => [record.id, structuredClone(record)]))
  const refreshHolds = (party: BookingParty): BookingParty => ({
    ...party,
    requests: party.requests.map((request) => {
      const hold = [...requestHolds.values()].find(
        (candidate) => candidate.bookingRequestId === request.id
      )
      return {
        ...request,
        holdId: hold?.id ?? null,
        holdExpiresAt: hold?.expiresAt ?? null,
        startsAt: hold?.startsAt ?? null,
        endsAt: hold?.endsAt ?? null
      }
    })
  })
  const hydrate = (bookingPartyId: string) => {
    const source = sessionParties
      ? [...sessionParties.values()].find((party) => party.id === bookingPartyId)
      : undefined
    if (!source) return undefined
    const party: BookingParty = {
      id: source.id,
      bookingSessionId: source.bookingSessionId,
      shopId: source.shopId,
      activeRequestId: source.requestId,
      lifecycle: 'active',
      currency: 'RON',
      locale: source.locale,
      version: 1,
      requests: [
        {
          id: source.requestId,
          bookingPartyId: source.id,
          position: 0,
          providerPreference: null,
          providerId: null,
          primaryServiceId: null,
          serviceIds: [],
          holdId: null,
          customerAccountId: null,
          customerDetails: null,
          startsAt: null,
          endsAt: null
        }
      ]
    }
    parties.set(party.id, party)
    activeRequests.set(party.bookingSessionId, source.requestId)
    partyRequests.set(party.bookingSessionId, new Set([source.requestId]))
    return party
  }
  const get = (bookingPartyId: string) => {
    const stored = parties.get(bookingPartyId) ?? hydrate(bookingPartyId)
    const party = stored ? refreshHolds(stored) : undefined
    if (party) parties.set(bookingPartyId, party)
    return party
      ? Effect.succeed(party)
      : Effect.fail(new BookingPartyNotFound({ bookingPartyId }))
  }
  const change = (
    bookingPartyId: string,
    expectedVersion: number,
    mutate: (party: BookingParty) => BookingParty
  ) =>
    Effect.gen(function* () {
      const party = yield* get(bookingPartyId)
      if (party.version !== expectedVersion)
        return yield* new BookingPartyConflict({ bookingPartyId, expectedVersion })
      const next = mutate(structuredClone(party))
      parties.set(bookingPartyId, next)
      partyRequests.set(
        next.bookingSessionId,
        new Set(next.requests.map((request) => request.id))
      )
      return next
    })
  return Layer.succeed(BookingParties)({
    findForSession: (sessionId) => {
      let party = [...parties.values()].find(
        (item) => item.bookingSessionId === sessionId
      )
      if (!party && sessionParties) {
        const source = sessionParties.get(sessionId)
        if (source) party = hydrate(source.id)
      }
      return party
        ? get(party.id)
        : Effect.fail(new BookingPartyNotFound({ bookingPartyId: `bpt_${sessionId}` }))
    },
    findById: (bookingPartyId) => {
      return get(bookingPartyId)
    },
    addRequest: (id, version) =>
      change(id, version, (party) => ({
        ...party,
        version: version + 1,
        requests: [
          ...party.requests,
          {
            id: newCapabilityId('brq'),
            bookingPartyId: id,
            position: party.requests.length,
            providerPreference: null,
            providerId: null,
            primaryServiceId: null,
            serviceIds: [],
            holdId: null,
            customerAccountId: null,
            customerDetails: null,
            startsAt: null,
            endsAt: null
          }
        ]
      })),
    removeRequest: (id, requestId, version) =>
      change(id, version, (party) => {
        if (
          party.requests.length <= 1 ||
          !party.requests.some((request) => request.id === requestId)
        )
          return party
        return {
          ...party,
          version: version + 1,
          activeRequestId:
            party.activeRequestId === requestId
              ? (party.requests.find((request) => request.id !== requestId)?.id ?? null)
              : party.activeRequestId,
          requests: party.requests
            .filter((request) => request.id !== requestId)
            .map((request, position) => ({ ...request, position }))
        }
      }),
    reorderRequests: (id, requestIds, version) =>
      change(id, version, (party) => {
        if (
          requestIds.length !== party.requests.length ||
          new Set(requestIds).size !== requestIds.length ||
          requestIds.some(
            (requestId) => !party.requests.some((request) => request.id === requestId)
          )
        )
          return party
        return {
          ...party,
          version: version + 1,
          requests: requestIds.map((requestId, position) => ({
            ...party.requests.find((request) => request.id === requestId)!,
            position
          }))
        }
      }),
    updateRequest: (id, requestId, material, version) =>
      change(id, version, (party) => {
        if (!party.requests.some((request) => request.id === requestId)) return party
        const schedulingChanged =
          material.providerPreference !== undefined ||
          material.providerId !== undefined ||
          material.primaryServiceId !== undefined ||
          material.serviceIds !== undefined
        return {
          ...party,
          version: schedulingChanged ? version + 1 : version,
          requests: party.requests.map((request) => {
            if (request.id !== requestId) return request
            const providerChanged =
              material.providerPreference !== undefined ||
              material.providerId !== undefined
            const providerPreference =
              material.providerPreference === undefined
                ? request.providerPreference
                : material.providerPreference
            const providerId =
              material.providerId === undefined
                ? request.providerId
                : material.providerId
            const primaryServiceId = providerChanged
              ? null
              : (material.primaryServiceId ?? request.primaryServiceId)
            const serviceIds = providerChanged
              ? []
              : material.serviceIds
                ? [...material.serviceIds]
                : request.serviceIds
            if (providerPreference && primaryServiceId) {
              requestSelections.set(request.id, {
                bookingSessionId: party.bookingSessionId,
                providerPreference:
                  providerPreference === 'any'
                    ? { kind: 'any' }
                    : { kind: 'specific', providerId: providerId ?? '' },
                primaryServiceId,
                additionalServiceIds: serviceIds.filter(
                  (serviceId) => serviceId !== primaryServiceId
                )
              })
            } else requestSelections.delete(request.id)
            return {
              ...request,
              providerPreference,
              providerId,
              customerDetails:
                material.customerDetails === undefined
                  ? request.customerDetails
                  : material.customerDetails,
              primaryServiceId,
              serviceIds,
              ...(schedulingChanged
                ? { holdId: null, startsAt: null, endsAt: null }
                : {})
            }
          })
        }
      }),
    activateRequest: (id, requestId, version) =>
      change(id, version, (party) => {
        if (!party.requests.some((request) => request.id === requestId)) return party
        activeRequests.set(party.bookingSessionId, requestId)
        const selection = requestSelections.get(requestId)
        onActivate?.(party.bookingSessionId, selection)
        return { ...party, activeRequestId: requestId }
      }),
    continuation: (id, now) =>
      Effect.map(get(id), (party) => bookingPartyContinuation(party, now))
  })
}

export const LiveBookingParties: Layer.Layer<BookingParties, never, Database> =
  Layer.effect(
    BookingParties,
    Effect.gen(function* () {
      const db = yield* Database
      const mutationSemaphore = yield* Semaphore.make(1)
      const findById = (bookingPartyId: string) =>
        Effect.gen(function* () {
          const [party] = yield* orUnavailable('booking-parties')(
            db
              .select()
              .from(bookingParties)
              .where(eq(bookingParties.id, bookingPartyId))
              .limit(1)
          )
          if (!party) return yield* new BookingPartyNotFound({ bookingPartyId })
          const requests = yield* orUnavailable('booking-parties')(
            db
              .select()
              .from(bookingRequests)
              .where(eq(bookingRequests.bookingPartyId, bookingPartyId))
              .orderBy(asc(bookingRequests.position))
          )
          const requestRecords = yield* Effect.all(
            requests.map((request) =>
              Effect.gen(function* () {
                const [services, hold] = yield* Effect.all([
                  orUnavailable('booking-parties')(
                    db
                      .select()
                      .from(bookingRequestServices)
                      .where(eq(bookingRequestServices.bookingRequestId, request.id))
                  ),
                  request.holdId
                    ? orUnavailable('booking-parties')(
                        db
                          .select({ expiresAt: timeSlotHolds.expiresAt })
                          .from(timeSlotHolds)
                          .where(eq(timeSlotHolds.id, request.holdId))
                          .limit(1)
                      )
                    : Effect.succeed([])
                ])
                const customerDetails = request.customerDetailsJson
                  ? yield* Effect.try({
                      try: () => JSON.parse(request.customerDetailsJson!),
                      catch: () => null
                    }).pipe(
                      Effect.flatMap((value) =>
                        Schema.decodeUnknownEffect(BookingGuestDetails)(value)
                      ),
                      Effect.mapError(
                        () =>
                          new CapabilityUnavailable({
                            capability: 'booking-parties',
                            reason: 'invalid_customer_details'
                          })
                      )
                    )
                  : null
                return { request, services, hold, customerDetails }
              })
            )
          )
          return {
            id: party.id,
            bookingSessionId: party.bookingSessionId,
            shopId: party.shopId,
            ...(party.activeRequestId
              ? { activeRequestId: party.activeRequestId }
              : {}),
            lifecycle: party.lifecycle,
            currency: party.currency,
            locale: party.locale,
            version: party.version,
            requests: requestRecords.map(
              ({ request, services, hold, customerDetails }) => ({
                id: request.id,
                bookingPartyId: request.bookingPartyId,
                position: request.position,
                providerPreference: request.providerPreference,
                providerId: request.providerId,
                primaryServiceId: request.primaryServiceId,
                serviceIds: services
                  .sort((left, right) => left.position - right.position)
                  .map((service) => service.serviceId),
                holdId: request.holdId,
                holdExpiresAt: hold[0]?.expiresAt ?? null,
                customerAccountId: request.customerAccountId,
                customerDetails,
                startsAt: request.startsAt,
                endsAt: request.endsAt
              })
            )
          }
        })
      const current = (bookingPartyId: string, expectedVersion: number) =>
        Effect.gen(function* () {
          const party = yield* findById(bookingPartyId)
          if (party.version !== expectedVersion)
            return yield* new BookingPartyConflict({ bookingPartyId, expectedVersion })
          return party
        })
      const finish = (bookingPartyId: string) => findById(bookingPartyId)
      const bump = (bookingPartyId: string, expectedVersion: number) =>
        db
          .update(bookingParties)
          .set({ version: expectedVersion + 1 })
          .where(
            and(
              eq(bookingParties.id, bookingPartyId),
              eq(bookingParties.version, expectedVersion)
            )
          )
      const atomicMutation = (
        bookingPartyId: string,
        expectedVersion: number,
        statements: Parameters<typeof batch>[1],
        bumpVersion = true
      ) =>
        mutationSemaphore.withPermit(
          batch(db, [
            {
              toSQL: () => ({
                sql: `INSERT INTO booking_parties (id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at)
                SELECT id, booking_session_id, shop_id, lifecycle, currency, locale, version, created_at, updated_at
                FROM booking_parties WHERE id = ? AND version <> ?`,
                params: [bookingPartyId, expectedVersion]
              })
            },
            ...statements,
            ...(bumpVersion ? [bump(bookingPartyId, expectedVersion)] : [])
          ]).pipe(
            Effect.mapError((error) =>
              /booking_parties\.(?:id|booking_session_id)/i.test(error.reason)
                ? new BookingPartyConflict({ bookingPartyId, expectedVersion })
                : new CapabilityUnavailable({
                    capability: 'booking-parties',
                    reason: error.reason
                  })
            )
          )
        )
      return {
        findForSession: (sessionId) =>
          Effect.gen(function* () {
            const [party] = yield* orUnavailable('booking-parties')(
              db
                .select({ id: bookingParties.id })
                .from(bookingParties)
                .where(eq(bookingParties.bookingSessionId, sessionId))
                .limit(1)
            )
            return yield* findById(party?.id ?? `bpt_${sessionId}`)
          }),
        findById,
        addRequest: (bookingPartyId, expectedVersion, now) =>
          Effect.gen(function* () {
            const party = yield* current(bookingPartyId, expectedVersion)
            const createdAt = now
            yield* atomicMutation(bookingPartyId, expectedVersion, [
              db.insert(bookingRequests).values({
                id: newCapabilityId('brq'),
                bookingPartyId,
                position: party.requests.length,
                createdAt,
                updatedAt: createdAt
              })
            ])
            return yield* finish(bookingPartyId)
          }),
        removeRequest: (bookingPartyId, requestId, expectedVersion) =>
          Effect.gen(function* () {
            const party = yield* current(bookingPartyId, expectedVersion)
            if (
              party.requests.length <= 1 ||
              !party.requests.some((request) => request.id === requestId)
            )
              return party
            const remaining = party.requests.filter(
              (request) => request.id !== requestId
            )
            yield* atomicMutation(bookingPartyId, expectedVersion, [
              db
                .delete(timeSlotHolds)
                .where(
                  eq(
                    timeSlotHolds.id,
                    party.requests.find((request) => request.id === requestId)
                      ?.holdId ?? ''
                  )
                ),
              db
                .delete(bookingRequests)
                .where(
                  and(
                    eq(bookingRequests.id, requestId),
                    eq(bookingRequests.bookingPartyId, bookingPartyId)
                  )
                ),
              ...(party.activeRequestId === requestId
                ? [
                    db
                      .update(bookingParties)
                      .set({ activeRequestId: remaining[0]?.id ?? null })
                      .where(eq(bookingParties.id, bookingPartyId))
                  ]
                : []),
              ...remaining.map((request, position) =>
                db
                  .update(bookingRequests)
                  .set({ position: -(position + 1) })
                  .where(eq(bookingRequests.id, request.id))
              ),
              ...remaining.map((request, position) =>
                db
                  .update(bookingRequests)
                  .set({ position })
                  .where(eq(bookingRequests.id, request.id))
              )
            ])
            return yield* finish(bookingPartyId)
          }),
        reorderRequests: (bookingPartyId, requestIds, expectedVersion) =>
          Effect.gen(function* () {
            const party = yield* current(bookingPartyId, expectedVersion)
            if (
              requestIds.length !== party.requests.length ||
              new Set(requestIds).size !== requestIds.length ||
              requestIds.some(
                (id) => !party.requests.some((request) => request.id === id)
              )
            )
              return party
            yield* atomicMutation(bookingPartyId, expectedVersion, [
              ...requestIds.map((id, position) =>
                db
                  .update(bookingRequests)
                  .set({ position: -(position + 1) })
                  .where(eq(bookingRequests.id, id))
              ),
              ...requestIds.map((id, position) =>
                db
                  .update(bookingRequests)
                  .set({ position })
                  .where(eq(bookingRequests.id, id))
              )
            ])
            return yield* finish(bookingPartyId)
          }),
        updateRequest: (
          bookingPartyId,
          requestId,
          material: BookingRequestMaterial,
          expectedVersion,
          now
        ) =>
          Effect.gen(function* () {
            const party = yield* current(bookingPartyId, expectedVersion)
            const request = party.requests.find((item) => item.id === requestId)
            if (!request) return party
            const schedulingChanged =
              material.providerPreference !== undefined ||
              material.providerId !== undefined ||
              material.primaryServiceId !== undefined ||
              material.serviceIds !== undefined
            const providerChanged =
              material.providerPreference !== undefined ||
              material.providerId !== undefined
            const serviceIds = material.serviceIds ?? request.serviceIds
            const createdAt = now
            yield* atomicMutation(
              bookingPartyId,
              expectedVersion,
              [
                ...(schedulingChanged && request.holdId
                  ? [
                      db
                        .delete(timeSlotHolds)
                        .where(eq(timeSlotHolds.id, request.holdId))
                    ]
                  : []),
                db
                  .update(bookingRequests)
                  .set({
                    ...(material.providerPreference !== undefined
                      ? { providerPreference: material.providerPreference }
                      : {}),
                    ...(material.providerId !== undefined
                      ? { providerId: material.providerId }
                      : {}),
                    ...(material.primaryServiceId !== undefined
                      ? { primaryServiceId: material.primaryServiceId }
                      : {}),
                    ...(providerChanged ? { primaryServiceId: null } : {}),
                    ...(material.customerDetails !== undefined
                      ? {
                          customerDetailsJson: material.customerDetails
                            ? JSON.stringify(material.customerDetails)
                            : null
                        }
                      : {}),
                    ...(schedulingChanged
                      ? { holdId: null, startsAt: null, endsAt: null }
                      : {})
                  })
                  .where(
                    and(
                      eq(bookingRequests.id, requestId),
                      eq(bookingRequests.bookingPartyId, bookingPartyId)
                    )
                  ),
                ...(material.serviceIds !== undefined || providerChanged
                  ? [
                      db
                        .delete(bookingRequestServices)
                        .where(eq(bookingRequestServices.bookingRequestId, requestId)),
                      ...(providerChanged ? [] : serviceIds).map(
                        (serviceId, position) =>
                          db.insert(bookingRequestServices).values({
                            bookingRequestId: requestId,
                            serviceId,
                            role: position === 0 ? 'primary' : 'additional',
                            position,
                            createdAt
                          })
                      )
                    ]
                  : [])
              ],
              schedulingChanged
            )
            return yield* finish(bookingPartyId)
          }),
        activateRequest: (bookingPartyId, requestId, expectedVersion) =>
          Effect.gen(function* () {
            const party = yield* current(bookingPartyId, expectedVersion)
            const request = party.requests.find((item) => item.id === requestId)
            if (!request) return party
            const additionalIds = request.serviceIds.filter(
              (serviceId) => serviceId !== request.primaryServiceId
            )
            yield* atomicMutation(
              bookingPartyId,
              expectedVersion,
              [
                db
                  .update(bookingParties)
                  .set({ activeRequestId: requestId })
                  .where(eq(bookingParties.id, bookingPartyId)),
                db
                  .update(bookingSessions)
                  .set({
                    providerPreference: request.providerPreference,
                    providerId: request.providerId,
                    primaryServiceId: request.primaryServiceId
                  })
                  .where(eq(bookingSessions.id, party.bookingSessionId)),
                db
                  .delete(bookingSessionAdditionalServices)
                  .where(
                    eq(
                      bookingSessionAdditionalServices.bookingSessionId,
                      party.bookingSessionId
                    )
                  ),
                ...additionalIds.map((serviceId, position) =>
                  db.insert(bookingSessionAdditionalServices).values({
                    bookingSessionId: party.bookingSessionId,
                    serviceId,
                    position
                  })
                )
              ],
              false
            )
            return yield* finish(bookingPartyId)
          }),
        continuation: (bookingPartyId, now) =>
          Effect.map(findById(bookingPartyId), (party) =>
            bookingPartyContinuation(party, now)
          )
      }
    })
  )
